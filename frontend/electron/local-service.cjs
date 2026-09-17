const { openDatabase } = require('./database.cjs')
const { parseAnime } = require('./yuc-parser.cjs')
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
async function createService({ filename, migrationPath, baseUrl = 'https://yuc.wiki', fetcher = fetch }) {
  const db = await openDatabase(filename, migrationPath)
  const one = (sql, params) => db.rows(sql, params)[0]
  const anime = id => camel(one('SELECT * FROM anime_sources WHERE id = ?', [id]))
  const requireAnime = id => anime(id) || fail('番剧不存在', 404)
  const record = row => ({ ...camel(row), anime: anime(row.anime_source_id) })
  const listAnime = season => db.rows('SELECT * FROM anime_sources WHERE season = ? ORDER BY air_day, air_time, title', [season]).map(camel)
  const pending = new Map()
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
          for (const a of items) db.run(`INSERT INTO anime_sources
            (season,title,image_url,air_day,air_time,total_episodes,source_url,created_at,updated_at)
            VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(source_url) DO UPDATE SET
            season=excluded.season,title=excluded.title,image_url=excluded.image_url,air_day=excluded.air_day,
            air_time=excluded.air_time,total_episodes=excluded.total_episodes,updated_at=excluded.updated_at`,
          [season, a.title, a.imageUrl, a.airDay, a.airTime, a.totalEpisodes, a.sourceUrl, now, now])
          const urls = new Set(items.map(a => a.sourceUrl))
          for (const a of db.rows(`SELECT id,source_url FROM anime_sources WHERE season = ?
            AND id NOT IN (SELECT anime_source_id FROM watch_records)
            AND id NOT IN (SELECT anime_source_id FROM anime_notes)`, [season])) {
            if (!urls.has(a.source_url)) db.run('DELETE FROM anime_sources WHERE id = ?', [a.id])
          }
          db.run('INSERT INTO season_refreshes VALUES (?,?) ON CONFLICT(season) DO UPDATE SET refreshed_at=excluded.refreshed_at', [season, now])
        })
        return listAnime(season)
      } catch (error) { fail(`刷新 yuc.wiki 失败：${error.message}`, 502) }
    })()
    pending.set(season, promise)
    try { return await promise } finally { pending.delete(season) }
  }
  async function request(method, target, body = {}) {
    const url = new URL(target, 'anime-log://local')
    const route = url.pathname
    if (method === 'GET' && route === '/api/seasons/current') return currentSeason()
    if ((method === 'GET' && route === '/api/anime') || (method === 'POST' && route === '/api/anime/refresh')) {
      const season = url.searchParams.get('season')
      if (!/^\d{4}(01|04|07|10)$/.test(season)) fail('季度格式必须为 YYYY01、YYYY04、YYYY07 或 YYYY10')
      const cached = one('SELECT refreshed_at FROM season_refreshes WHERE season = ?', [season])
      if (method === 'POST' || !cached || Date.now() - Date.parse(cached.refreshed_at) >= 24 * 3600000) return refresh(season)
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
  return { request, image, close: db.close }
}
module.exports = { createService, currentSeason }
