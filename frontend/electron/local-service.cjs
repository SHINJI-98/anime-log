const { openDatabase } = require('./database.cjs')
const { parseAnime, PARSER_VERSION } = require('./yuc-parser.cjs')
const { createAniListClient } = require('./anilist-client.cjs')
const { createAnimeNames } = require('./anime-names.cjs')
const { calculateProgress, shanghaiDate, shanghaiHour } = require('./broadcast-progress.cjs')
const camel = row => row && Object.fromEntries(Object.entries(row).map(([key, value]) => [key.replace(/_([a-z])/g, (_, c) => c.toUpperCase()), value]))
const statuses = ['watching', 'completed', 'dropped']
function fail(message, status = 400) { throw Object.assign(new Error(message), { status }) }
function integer(value, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) fail('集数或 ID 必须为有效整数')
  return value
}
function currentSeason(today = new Date()) {
  const next = new Date(today.getFullYear(), Math.floor(today.getMonth() / 3) * 3 + 3, 1)
  const early = new Date(next)
  early.setDate(early.getDate() - 14)
  const date = today >= early ? next : today
  const quarter = Math.floor(date.getMonth() / 3) * 3
  const season = offset => {
    const d = new Date(date.getFullYear(), quarter + offset, 1)
    return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`
  }
  return { season: season(0), previousSeason: season(-3), nextSeason: season(3) }
}
async function readRemote(url, { maxBytes, fetcher = fetch, headers = {} }) {
  const response = await fetcher(url, { signal: AbortSignal.timeout(15000), redirect: 'error', headers })
  if (!response.ok) throw new Error(`远程请求失败 (${response.status})`)
  const reader = response.body.getReader()
  const chunks = []
  let length = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      length += value.length
      if (length > maxBytes) throw new Error('远程内容过大')
      chunks.push(Buffer.from(value))
    }
  } finally { await reader.cancel() }
  return { bytes: Buffer.concat(chunks), type: response.headers.get('content-type') || '' }
}
async function createService({ filename, migrationPath, baseUrl = 'https://yuc.wiki', anilistUrl = 'https://graphql.anilist.co', fetcher = fetch, clock = () => new Date(), nameCatalogUpdates = false }) {
  const db = await openDatabase(filename, migrationPath)
  const abortController = new AbortController()
  let closed = false
  const anilist = createAniListClient({ fetcher, url: anilistUrl, signal: abortController.signal, clock })
  const names = createAnimeNames({ db, client: anilist, fetcher, clock, signal: abortController.signal })
  const one = (sql, params) => db.rows(sql, params)[0]
  const anime = id => camel(one('SELECT * FROM anime_sources WHERE id = ?', [id]))
  const requireAnime = id => anime(id) || fail('番剧不存在', 404)
  const binding = animeSourceId => camel(one('SELECT * FROM broadcast_bindings WHERE anime_source_id = ?', [animeSourceId]))
  const episodeRows = animeSourceId => db.rows('SELECT * FROM broadcast_episodes WHERE anime_source_id = ?', [animeSourceId]).map(camel)
  function broadcast(animeSourceId, watchedEpisodes = 0) {
    const linked = binding(animeSourceId)
    if (!linked) return null
    const requiresRelink = linked.provider !== 'anilist'
    const progress = calculateProgress(requiresRelink ? [] : episodeRows(animeSourceId), clock())
    return {
      provider: linked.provider, requiresRelink,
      subject: { id: linked.providerSubjectId, name: linked.subjectName, displayName: linked.subjectDisplayName,
        imageUrl: linked.subjectImageUrl, airDate: linked.subjectAirDate },
      notifyEnabled: linked.notifyEnabled === 1,
      lastAttemptAt: linked.lastAttemptAt, lastSuccessAt: requiresRelink ? null : linked.lastSuccessAt, error: requiresRelink ? null : linked.lastError,
      stale: !linked.lastSuccessAt || clock().getTime() - Date.parse(linked.lastSuccessAt) >= 24 * 3600000,
      ...progress,
      hasUnwatchedUpdate: progress.estimatedAiredEpisode !== null && progress.estimatedAiredEpisode > watchedEpisodes
    }
  }
  const record = row => ({ ...camel(row), anime: anime(row.anime_source_id), broadcast: broadcast(row.anime_source_id, row.watched_episodes) })
  const listAnime = season => db.rows('SELECT * FROM anime_sources WHERE season = ? ORDER BY air_day, air_time, title', [season]).map(camel)
  const pending = new Map()
  const broadcastPending = new Map()
  const broadcastGeneration = new Map()
  let lastManualBroadcastRefresh = 0
  const autoAttempts = new Map()
  async function autoLink(id) {
    if (closed || binding(id) || one('SELECT auto_link FROM anime_link_preferences WHERE anime_source_id=?', [id])?.auto_link === 0) return
    if (one('SELECT status FROM watch_records WHERE anime_source_id=?', [id])?.status !== 'watching') return
    if (autoAttempts.has(id) && clock().getTime() - autoAttempts.get(id) < 3600000) return
    autoAttempts.set(id, clock().getTime())
    const subjectId = names.exactId(anime(id)?.title || '')
    if (!subjectId) return
    const generation = broadcastGeneration.get(id) || 0
    try { await request('PUT', `/api/anime/${id}/broadcast-binding`, { anilistSubjectId: subjectId }, generation) } catch {}
  }
  async function refresh(season) {
    if (pending.has(season)) return pending.get(season)
    const promise = (async () => {
      try {
        const url = `${baseUrl.replace(/\/$/, '')}/${season}/`
        const { bytes } = await readRemote(url, { maxBytes: 8 * 1024 * 1024, fetcher })
        const items = parseAnime(bytes.toString('utf8'), url)
        if (!items.length) throw new Error('页面中未识别到番剧，已保留原有缓存')
        const now = new Date().toISOString()
        db.write(() => {
          for (const a of items) {
            // Repair old detail-parser URLs while preserving referenced local IDs.
            if (!one('SELECT id FROM anime_sources WHERE source_url=?', [a.sourceUrl])) {
              const previous = db.rows('SELECT id,source_url FROM anime_sources WHERE season=? AND title=?', [season, a.title])
              if (previous.length === 1 && !previous[0].source_url.includes('#date-')) {
                db.run('UPDATE anime_sources SET source_url=? WHERE id=?', [a.sourceUrl, previous[0].id])
              }
            }
            db.run(`INSERT INTO anime_sources
            (season,title,image_url,air_day,air_time,total_episodes,source_url,created_at,updated_at)
            VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(source_url) DO UPDATE SET
            season=excluded.season,title=excluded.title,image_url=excluded.image_url,air_day=excluded.air_day,
            air_time=excluded.air_time,total_episodes=excluded.total_episodes,updated_at=excluded.updated_at`,
          [season, a.title, a.imageUrl, a.airDay, a.airTime, a.totalEpisodes, a.sourceUrl, now, now])
          }
          const urls = new Set(items.map(a => a.sourceUrl))
          for (const a of db.rows(`SELECT id,source_url FROM anime_sources WHERE season = ?
            AND id NOT IN (SELECT anime_source_id FROM watch_records)
            AND id NOT IN (SELECT anime_source_id FROM anime_notes)`, [season])) {
            if (!urls.has(a.source_url)) db.run('DELETE FROM anime_sources WHERE id = ?', [a.id])
          }
          db.run('INSERT INTO season_refreshes (season,refreshed_at,parser_version) VALUES (?,?,?) ON CONFLICT(season) DO UPDATE SET refreshed_at=excluded.refreshed_at,parser_version=excluded.parser_version', [season, now, PARSER_VERSION])
        })
        return listAnime(season)
      } catch (error) { fail(`刷新 yuc.wiki 失败：${error.message}`, 502) }
    })()
    pending.set(season, promise)
    try { return await promise } finally { pending.delete(season) }
  }
  async function refreshBroadcast(animeSourceId) {
    const generation = broadcastGeneration.get(animeSourceId) || 0
    const pendingKey = `${animeSourceId}:${generation}`
    if (broadcastPending.has(pendingKey)) return broadcastPending.get(pendingKey)
    const linked = binding(animeSourceId)
    if (closed) fail('应用正在退出', 503)
    if (!linked || linked.provider !== 'anilist') fail('请先关联 AniList 条目', 409)
    const subjectId = linked.providerSubjectId
    const attemptedAt = clock().toISOString()
    db.write(() => db.run('UPDATE broadcast_bindings SET last_attempt_at=?,updated_at=? WHERE anime_source_id=?', [attemptedAt, attemptedAt, animeSourceId]))
    const promise = (async () => {
      try {
        const episodes = await anilist.episodes(subjectId)
        if (closed || (broadcastGeneration.get(animeSourceId) || 0) !== generation) return null
        const current = binding(animeSourceId)
        if (!current || current.provider !== 'anilist' || current.providerSubjectId !== subjectId) return null
        const successAt = clock().toISOString()
        db.write(() => {
          db.run('DELETE FROM broadcast_episodes WHERE anime_source_id = ?', [animeSourceId])
          for (const item of episodes) {
            if (!Number.isSafeInteger(item.id) || item.type !== 0 || !Number.isFinite(item.sortNumber)) continue
            db.run(`INSERT INTO broadcast_episodes
              (provider_episode_id,anime_source_id,episode_type,episode_number,sort_number,name,name_cn,air_date)
              VALUES (?,?,?,?,?,?,?,?)`, [item.id, animeSourceId, item.type, item.episodeNumber, item.sortNumber, item.name, item.displayName, item.airDate])
          }
          db.run(`UPDATE broadcast_bindings SET last_success_at=?,last_error=NULL,failure_count=0,next_retry_at=NULL,updated_at=?
            WHERE anime_source_id=? AND provider_subject_id=?`, [successAt, successAt, animeSourceId, subjectId])
        })
        return broadcast(animeSourceId)
      } catch (error) {
        const current = closed ? null : binding(animeSourceId)
        if (current?.provider === 'anilist' && current.providerSubjectId === subjectId && (broadcastGeneration.get(animeSourceId) || 0) === generation) {
          const failures = Math.min(3, (current.failureCount || 0) + 1)
          const retrySeconds = error.retryAfter ?? [300, 900, 3600][failures - 1]
          const retryAt = new Date(clock().getTime() + retrySeconds * 1000).toISOString()
          db.write(() => db.run(`UPDATE broadcast_bindings SET last_error=?,failure_count=?,next_retry_at=?,updated_at=?
            WHERE anime_source_id=? AND provider_subject_id=?`,
          [error.message, failures, retryAt, clock().toISOString(), animeSourceId, subjectId]))
        }
        throw error
      }
    })()
    broadcastPending.set(pendingKey, promise)
    try { return await promise } finally { broadcastPending.delete(pendingKey) }
  }
  async function refreshBroadcasts({ force = false, animeSourceId = null } = {}) {
    if (nameCatalogUpdates) void names.update().catch(() => {})
    const unlinked = db.rows(`SELECT w.anime_source_id FROM watch_records w LEFT JOIN broadcast_bindings b ON b.anime_source_id=w.anime_source_id WHERE w.status='watching' AND b.anime_source_id IS NULL`)
    let autoCursor = 0
    async function linkWorker() {
      while (!closed && autoCursor < unlinked.length) await autoLink(unlinked[autoCursor++].anime_source_id)
    }
    await Promise.all([linkWorker(), linkWorker()])
    if (closed) return []
    let ids
    if (animeSourceId) ids = [animeSourceId]
    else ids = db.rows(`SELECT b.anime_source_id,b.last_success_at,b.next_retry_at
      FROM broadcast_bindings b JOIN watch_records w ON w.anime_source_id=b.anime_source_id WHERE w.status='watching' AND b.provider='anilist'`)
      .filter(row => force || (row.next_retry_at
        ? Date.parse(row.next_retry_at) <= clock().getTime()
        : !row.last_success_at || clock().getTime() - Date.parse(row.last_success_at) >= 3600000))
      .map(row => row.anime_source_id)
    const results = []
    let cursor = 0
    async function worker() {
      while (!closed && cursor < ids.length) {
        const id = ids[cursor++]
        try { results.push({ animeSourceId: id, broadcast: await refreshBroadcast(id) }) }
        catch (error) { results.push({ animeSourceId: id, error: error.message }) }
      }
    }
    await Promise.all([worker(), worker()])
    return results
  }
  function claimTodayAlerts({ notificationsEnabled = true } = {}) {
    if (shanghaiHour(clock()) < 9) return []
    const today = shanghaiDate(clock())
    const freshAfter = new Date(clock().getTime() - 24 * 3600000).toISOString()
    const candidates = db.rows(`SELECT e.anime_source_id,e.provider_episode_id,e.episode_number,a.title,b.notify_enabled
      FROM broadcast_episodes e
      JOIN broadcast_bindings b ON b.anime_source_id=e.anime_source_id
      JOIN anime_sources a ON a.id=e.anime_source_id
      JOIN watch_records w ON w.anime_source_id=e.anime_source_id
      WHERE e.episode_type=0 AND e.air_date=? AND w.status='watching' AND b.provider='anilist' AND b.last_success_at>=?
      AND NOT EXISTS (SELECT 1 FROM broadcast_alerts x WHERE x.anime_source_id=e.anime_source_id
        AND x.provider_episode_id=e.provider_episode_id AND x.alert_type='scheduled_today' AND x.schedule_date=?)
      ORDER BY a.title,e.sort_number`, [today, freshAfter, today])
    if (!candidates.length) return []
    const handledAt = clock().toISOString()
    db.write(() => {
      for (const item of candidates) db.run(`INSERT INTO broadcast_alerts
        (anime_source_id,provider_episode_id,alert_type,schedule_date,handled_at,disposition) VALUES (?,?,?,?,?,?)`,
      [item.anime_source_id, item.provider_episode_id, 'scheduled_today', today, handledAt,
        notificationsEnabled && item.notify_enabled === 1 ? 'pending' : 'silent'])
    })
    return candidates.filter(item => notificationsEnabled && item.notify_enabled === 1).map(camel)
  }
  function markAlerts(items, disposition) {
    if (!['delivered', 'failed'].includes(disposition)) return
    db.write(() => {
      for (const item of items) db.run(`UPDATE broadcast_alerts SET disposition=?,handled_at=?
        WHERE anime_source_id=? AND provider_episode_id=? AND alert_type='scheduled_today' AND schedule_date=?`,
      [disposition, clock().toISOString(), item.animeSourceId, item.providerEpisodeId, shanghaiDate(clock())])
    })
  }
  async function request(method, target, body = {}, autoGeneration = null) {
    const url = new URL(target, 'anime-log://local')
    const route = url.pathname
    if (method === 'GET' && route === '/api/seasons/current') return currentSeason()
    if (method === 'POST' && route === '/api/broadcast/refresh') {
      if (clock().getTime() - lastManualBroadcastRefresh < 60000) fail('放送进度刷新过于频繁，请稍后再试', 429)
      lastManualBroadcastRefresh = clock().getTime()
      const animeSourceId = body.animeSourceId == null ? null : integer(Number(body.animeSourceId), 1)
      return refreshBroadcasts({ force: true, animeSourceId })
    }
    if (method === 'GET' && ['/api/anime/search', '/api/anilist/search'].includes(route)) {
      try { return await names.search(url.searchParams.get('keyword')) }
      catch (error) { fail(error.message, error.status >= 400 && error.status < 500 ? error.status : 502) }
    }
    const anilistSubject = route.match(/^\/api\/anilist\/subjects\/(\d+)$/)
    if (method === 'GET' && anilistSubject) {
      try { return names.decorate(await anilist.subject(integer(Number(anilistSubject[1]), 1))) }
      catch (error) { fail(error.message, error.status >= 400 && error.status < 500 ? error.status : 502) }
    }
    const broadcastBinding = route.match(/^\/api\/anime\/(\d+)\/broadcast-binding$/)
    if (broadcastBinding) {
      const animeSourceId = integer(Number(broadcastBinding[1]), 1)
      requireAnime(animeSourceId)
      if (method === 'DELETE') {
        broadcastGeneration.set(animeSourceId, (broadcastGeneration.get(animeSourceId) || 0) + 1)
        db.write(() => {
          db.run('INSERT INTO anime_link_preferences VALUES (?,0) ON CONFLICT(anime_source_id) DO UPDATE SET auto_link=0', [animeSourceId])
          db.run('DELETE FROM broadcast_episodes WHERE anime_source_id = ?', [animeSourceId])
          db.run('DELETE FROM broadcast_alerts WHERE anime_source_id = ?', [animeSourceId])
          db.run('DELETE FROM broadcast_bindings WHERE anime_source_id = ?', [animeSourceId])
        })
        return null
      }
      if (method === 'PUT') {
        const subjectId = integer(Number(body.anilistSubjectId), 1)
        let subject
        try { subject = names.decorate(await anilist.subject(subjectId)) }
        catch (error) { fail(error.message, error.status >= 400 && error.status < 500 ? error.status : 502) }
        if (closed) fail('应用正在退出', 503)
        if (autoGeneration !== null && (binding(animeSourceId) || (broadcastGeneration.get(animeSourceId) || 0) !== autoGeneration || one('SELECT status FROM watch_records WHERE anime_source_id=?', [animeSourceId])?.status !== 'watching')) return null
        const notifyEnabled = body.notifyEnabled !== false ? 1 : 0
        const now = new Date().toISOString()
        const previousBinding = binding(animeSourceId)
        const sameSubject = previousBinding?.provider === 'anilist' && previousBinding.providerSubjectId === subjectId
        if (!sameSubject) broadcastGeneration.set(animeSourceId, (broadcastGeneration.get(animeSourceId) || 0) + 1)
        db.write(() => {
          db.run('INSERT INTO anime_link_preferences VALUES (?,1) ON CONFLICT(anime_source_id) DO UPDATE SET auto_link=1', [animeSourceId])
          if (!sameSubject) {
            db.run('DELETE FROM broadcast_episodes WHERE anime_source_id = ?', [animeSourceId])
            db.run('DELETE FROM broadcast_alerts WHERE anime_source_id = ?', [animeSourceId])
          }
          db.run(`INSERT INTO broadcast_bindings
            (anime_source_id,provider,provider_subject_id,subject_name,subject_display_name,subject_image_url,subject_air_date,notify_enabled,created_at,updated_at)
            VALUES (?,'anilist',?,?,?,?,?,?,?,?) ON CONFLICT(anime_source_id) DO UPDATE SET
            provider=excluded.provider,provider_subject_id=excluded.provider_subject_id,subject_name=excluded.subject_name,subject_display_name=excluded.subject_display_name,
            subject_image_url=excluded.subject_image_url,subject_air_date=excluded.subject_air_date,notify_enabled=excluded.notify_enabled,
            last_attempt_at=CASE WHEN provider=excluded.provider AND provider_subject_id=excluded.provider_subject_id THEN last_attempt_at ELSE NULL END,
            last_success_at=CASE WHEN provider=excluded.provider AND provider_subject_id=excluded.provider_subject_id THEN last_success_at ELSE NULL END,
            last_error=CASE WHEN provider=excluded.provider AND provider_subject_id=excluded.provider_subject_id THEN last_error ELSE NULL END,
            failure_count=CASE WHEN provider=excluded.provider AND provider_subject_id=excluded.provider_subject_id THEN failure_count ELSE 0 END,
            next_retry_at=CASE WHEN provider=excluded.provider AND provider_subject_id=excluded.provider_subject_id THEN next_retry_at ELSE NULL END,updated_at=excluded.updated_at`,
          [animeSourceId, subject.id, subject.name, subject.displayName, subject.imageUrl, subject.airDate, notifyEnabled, now, now])
        })
        try { await refreshBroadcast(animeSourceId) } catch {}
        return broadcast(animeSourceId)
      }
    }
    if ((method === 'GET' && route === '/api/anime') || (method === 'POST' && route === '/api/anime/refresh')) {
      const season = url.searchParams.get('season')
      if (!/^\d{4}(01|04|07|10)$/.test(season)) fail('季度格式必须为 YYYY01、YYYY04、YYYY07 或 YYYY10')
      const cached = one('SELECT refreshed_at,parser_version FROM season_refreshes WHERE season = ?', [season])
      if (method === 'POST' || !cached || cached.parser_version !== PARSER_VERSION || Date.now() - Date.parse(cached.refreshed_at) >= 24 * 3600000) return refresh(season)
      return listAnime(season)
    }
    if (route === '/api/watch-records') {
      if (method === 'GET') {
        const status = url.searchParams.get('status')
        if (status && !statuses.includes(status)) fail('追番状态无效')
        return db.rows(`SELECT * FROM watch_records ${status ? 'WHERE status = ?' : ''} ORDER BY updated_at DESC`, status ? [status] : []).map(record)
      }
      if (method === 'POST') {
        const id = integer(body.animeSourceId, 1)
        requireAnime(id)
        const status = body.status ?? 'watching'
        if (!statuses.includes(status)) fail('追番状态无效')
        const episodes = integer(body.watchedEpisodes ?? 0)
        const now = new Date().toISOString()
        db.write(() => db.run(`INSERT INTO watch_records (anime_source_id,status,watched_episodes,created_at,updated_at)
          VALUES (?,?,?,?,?) ON CONFLICT(anime_source_id) DO UPDATE SET status=excluded.status,
          watched_episodes=excluded.watched_episodes,updated_at=excluded.updated_at`, [id, status, episodes, now, now]))
        await autoLink(id)
        return record(one('SELECT * FROM watch_records WHERE anime_source_id = ?', [id]))
      }
    }
    const watch = route.match(/^\/api\/watch-records\/(\d+)$/)
    if (watch) {
      const id = integer(Number(watch[1]), 1)
      if (method === 'DELETE') { db.write(() => db.run('DELETE FROM watch_records WHERE id = ?', [id])); return null }
      if (method === 'PATCH') {
        const previous = one('SELECT * FROM watch_records WHERE id = ?', [id])
        if (!previous) fail('追番记录不存在', 404)
        const status = body.status ?? previous.status
        if (!statuses.includes(status)) fail('追番状态无效')
        const episodes = integer(body.watchedEpisodes ?? previous.watched_episodes)
        db.write(() => db.run('UPDATE watch_records SET status=?,watched_episodes=?,updated_at=? WHERE id=?', [status, episodes, new Date().toISOString(), id]))
        await autoLink(previous.anime_source_id)
        return record(one('SELECT * FROM watch_records WHERE id = ?', [id]))
      }
    }
    const note = route.match(/^\/api\/anime\/(\d+)\/notes(?:\/(summary|episodes\/(\d+)))?$/)
    if (note) {
      const id = integer(Number(note[1]), 1)
      requireAnime(id)
      if (!note[2] && method === 'GET') {
        const notes = db.rows('SELECT * FROM anime_notes WHERE anime_source_id=? ORDER BY episode_number', [id]).map(camel)
        return { summary: notes.find(n => n.episodeNumber === 0) || null, episodeNotes: notes.filter(n => n.episodeNumber > 0) }
      }
      const episode = note[2] === 'summary' ? 0 : integer(Number(note[3]), 1)
      if (method === 'PUT') {
        if (typeof body.content !== 'string' || body.content.length > 1000000) fail('笔记内容无效或过长')
        const now = new Date().toISOString()
        db.write(() => db.run(`INSERT INTO anime_notes (anime_source_id,episode_number,content,created_at,updated_at)
          VALUES (?,?,?,?,?) ON CONFLICT(anime_source_id,episode_number) DO UPDATE SET content=excluded.content,updated_at=excluded.updated_at`, [id, episode, body.content, now, now]))
        return camel(one('SELECT * FROM anime_notes WHERE anime_source_id=? AND episode_number=?', [id, episode]))
      }
      if (method === 'DELETE' && episode > 0) {
        db.write(() => db.run('DELETE FROM anime_notes WHERE anime_source_id=? AND episode_number=?', [id, episode]))
        return null
      }
    }
    fail('接口不存在', 404)
  }
  async function image(target) {
    const url = new URL(target)
    if (!/^https?:$/.test(url.protocol) || !/^i[0-5]\.hdslb\.com$/.test(url.hostname) || url.username || url.password || url.port) fail('图片地址不被允许')
    url.protocol = 'https:'
    const result = await readRemote(url, { maxBytes: 12 * 1024 * 1024, fetcher })
    if (!/^image\/(jpeg|png|webp|gif|avif)(;|$)/i.test(result.type)) fail('图片格式不受支持')
    return result
  }
  return { request, image, refreshBroadcasts, broadcast, claimTodayAlerts, markAlerts, close: () => {
    closed = true
    abortController.abort()
    db.close()
  } }
}
module.exports = { createService, currentSeason }
