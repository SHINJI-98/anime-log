const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { createService, currentSeason } = require('../electron/local-service.cjs')
const { openDatabase } = require('../electron/database.cjs')
const { parseAnime, javaHash } = require('../electron/yuc-parser.cjs')
const { calculateProgress, shanghaiDate, validDate } = require('../electron/broadcast-progress.cjs')
const media = id => ({ id, type: 'ANIME', title: { native: 'テスト', english: 'Test Anime' }, startDate: { year: 2026, month: 7, day: 1 } })
const graphql = data => new Response(JSON.stringify({ data }))
const schedule = (mediaId, id, episode, day) => ({ mediaId, id, episode, airingAt: Date.parse(`${day}T12:00:00+08:00`) / 1000 })
const page = items => graphql({ Page: { pageInfo: { hasNextPage: false }, airingSchedules: items } })

function card(title = '测试番剧', episodes = '全12话') {
  return `<div><div><div class="div_date_"><img data-src="http://i0.hdslb.com/a.jpg"><p class="imgtext5">23:00</p></div><div><table><tr><td class="date_title_">${title}</td></tr><tr><td>${episodes}</td></tr></table></div></div></div>`
}

test('unique Chinese titles auto-link, manual unlink persists, and late auto-link cannot undo unlink', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anime-auto-link-'))
  let hold = false
  let release
  let started
  const fetcher = async (_url, options) => {
    if (!options?.body) return new Response(card('欺诈游戏'))
    const { query, variables } = JSON.parse(options.body)
    if (query.includes('AnimeSubject')) {
      if (hold) { started(); await new Promise(resolve => { release = resolve }) }
      return graphql({ Media: media(variables.id) })
    }
    if (query.includes('AnimeCandidates')) return graphql({ Page: { media: variables.ids.map(media) } })
    return page([schedule(197754, 1, 1, '2026-09-18')])
  }
  const options = { filename: path.join(dir, 'test.db'), fetcher }
  let service = await createService(options)
  t.after(() => { service.close(); fs.rmSync(dir, { recursive: true, force: true }) })
  const anime = (await service.request('GET', '/api/anime?season=202607'))[0]
  const record = await service.request('POST', '/api/watch-records', { animeSourceId: anime.id, watchedEpisodes: 5 })
  assert.equal(record.broadcast.subject.id, 197754)
  assert.equal(record.watchedEpisodes, 5)
  const candidates = await service.request('GET', '/api/anime/search?keyword=欺诈游戏')
  assert.equal(candidates[0].id, 197754)
  assert.equal(candidates[0].metadataUnavailable, undefined)
  assert.equal(candidates[0].name, 'テスト')
  await service.request('DELETE', `/api/anime/${anime.id}/broadcast-binding`)
  service.close()
  service = await createService(options)
  await service.refreshBroadcasts()
  assert.equal((await service.request('GET', '/api/watch-records'))[0].broadcast, null)
  // A fresh title has no opt-out; unlink while verification is pending must win.
  const db = await openDatabase(path.join(dir, 'race.db'))
  db.write(() => {
    db.run("INSERT INTO anime_sources VALUES (1,'202607','欺诈游戏',NULL,NULL,NULL,28,'test','now','now')")
    db.run("INSERT INTO watch_records VALUES (1,1,'watching',2,'now','now')")
  })
  db.close()
  const raceService = await createService({ ...options, filename: path.join(dir, 'race.db') })
  hold = true
  const waiting = new Promise(resolve => { started = resolve })
  const refresh = raceService.refreshBroadcasts()
  await waiting
  await raceService.request('DELETE', '/api/anime/1/broadcast-binding')
  release()
  await refresh
  assert.equal((await raceService.request('GET', '/api/watch-records'))[0].broadcast, null)
  raceService.close()
})
test('parser preserves Java source IDs, weekday, images, episode count and fallback cards', () => {
  const url = 'https://yuc.wiki/202607/'
  const results = parseAnime('<div class="date2">周一 (月)</div>' + card() + '<div class="date2">网络放送 &amp; 其他</div>' + card('Other', ''), url)
  assert.equal(results.length, 2)
  assert.equal(results[0].airDay, '周一 (月)')
  assert.equal(results[0].imageUrl, 'https://i0.hdslb.com/a.jpg')
  assert.equal(results[0].airTime, '23:00')
  assert.equal(results[0].totalEpisodes, 12)
  assert.equal(results[1].airDay, '网络放送 & 其他')
  assert.equal(results[1].totalEpisodes, null)
  assert.equal(javaHash('abc'), '17862')
  assert.equal(results[0].sourceUrl, url + '#date-' + javaHash('测试番剧'))
  const fallback = parseAnime('<div class="main_box" id="a1"><h3>测试番剧 A</h3><img src="/a.jpg"><p class="time">周六 23:30</p><p>全 12 话</p></div>', url)[0]
  assert.equal(fallback.title, '测试番剧 A')
  assert.equal(fallback.sourceUrl, url + '#a1')
  assert.equal(fallback.imageUrl, 'https://yuc.wiki/a.jpg')
  const wrapped = parseAnime(card('碧蓝之海<br>第3期'), url)[0]
  assert.equal(wrapped.title, '碧蓝之海 第3期')
  assert.equal(wrapped.sourceUrl, url + '#date-' + javaHash('碧蓝之海 第3期'))
})

test('season advances 14 days before next quarter including year rollover', () => {
  assert.equal(currentSeason(new Date(2026, 8, 16)).season, '202607')
  assert.equal(currentSeason(new Date(2026, 8, 17)).season, '202610')
  assert.deepEqual(currentSeason(new Date(2026, 11, 18)), { season: '202701', previousSeason: '202610', nextSeason: '202704' })
})

test('broadcast progress uses Shanghai dates, excludes today from aired progress and keeps fractional episodes', () => {
  const now = new Date('2026-09-19T01:00:00Z')
  const episodes = [
    { providerEpisodeId: 1, episodeType: 0, episodeNumber: 1, sortNumber: 1, airDate: '2026-09-18' },
    { providerEpisodeId: 2, episodeType: 0, episodeNumber: 1.5, sortNumber: 1.5, airDate: '2026-09-19' },
    { providerEpisodeId: 3, episodeType: 0, episodeNumber: 2, sortNumber: 2, airDate: '2026-09-20' },
    { providerEpisodeId: 4, episodeType: 1, episodeNumber: 9, sortNumber: 9, airDate: '2026-09-17' },
    { providerEpisodeId: 5, episodeType: 0, episodeNumber: 99, sortNumber: 99, airDate: 'not-a-date' }
  ]
  const result = calculateProgress(episodes, now)
  assert.equal(shanghaiDate(now), '2026-09-19')
  assert.equal(result.estimatedAiredEpisode, 1)
  assert.deepEqual(result.todayEpisodes, [{ id: 2, episodeNumber: 1.5 }])
  assert.deepEqual(result.next, { date: '2026-09-19', episodes: [{ id: 2, episodeNumber: 1.5 }] })
  assert.equal(validDate('2026-02-29'), false)
  assert.equal(validDate('2028-02-29'), true)
})

test('local CRUD persists, refresh preserves followed/noted anime, validates and keeps cache on failures', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anime-service-'))
  let html = card() + card('Removed') + card('With notes')
  let count = 0
  const options = { filename: path.join(dir, 'anime-log.db'), fetcher: async () => { count++; return new Response(html) } }
  let service = await createService(options)
  t.after(() => { service.close(); fs.rmSync(dir, { recursive: true, force: true }) })
  let items = await service.request('GET', '/api/anime?season=202607')
  assert.equal(items.length, 3)
  await service.request('GET', '/api/anime?season=202607')
  assert.equal(count, 1)
  const a = items.find(a => a.title === '测试番剧')
  const noted = items.find(a => a.title === 'With notes')
  let record = await service.request('POST', '/api/watch-records', { animeSourceId: a.id })
  await service.request('PATCH', `/api/watch-records/${record.id}`, { watchedEpisodes: 3 })
  await service.request('PUT', `/api/anime/${a.id}/notes/summary`, { content: '<p>中文总评</p>' })
  await service.request('PUT', `/api/anime/${noted.id}/notes/episodes/2`, { content: '保留分集笔记' })
  await assert.rejects(service.request('PATCH', `/api/watch-records/${record.id}`, { watchedEpisodes: -1 }), /整数/)
  await assert.rejects(service.request('GET', '/api/watch-records?status=wrong'), /状态/)
  await assert.rejects(service.request('GET', '/api/anime?season=202609'), /季度/)
  await assert.rejects(service.request('POST', '/api/watch-records', { animeSourceId: 999 }), /不存在/)
  html = card('New')
  items = await service.request('POST', '/api/anime/refresh?season=202607')
  assert.deepEqual(items.map(a => a.title).sort(), ['New', 'With notes', '测试番剧'].sort())
  html = '<h1>Unavailable</h1>'
  await assert.rejects(service.request('POST', '/api/anime/refresh?season=202607'), /未识别到/)
  assert.equal((await service.request('GET', '/api/anime?season=202607')).length, 3)
  service.close()
  service = await createService(options)
  record = (await service.request('GET', '/api/watch-records'))[0]
  assert.equal(record.watchedEpisodes, 3)
  assert.equal((await service.request('GET', `/api/anime/${a.id}/notes`)).summary.content, '<p>中文总评</p>')
  await service.request('DELETE', `/api/anime/${noted.id}/notes/episodes/2`)
  assert.deepEqual((await service.request('GET', `/api/anime/${noted.id}/notes`)).episodeNotes, [])
  await service.request('DELETE', `/api/watch-records/${record.id}`)
  assert.deepEqual(await service.request('GET', '/api/watch-records'), [])
})

test('AniList search and confirmed binding persist without changing watch progress or notes', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anime-anilist-binding-'))
  const requests = []
  const fetcher = async (url, options = {}) => {
    requests.push({ url: String(url), options })
    const query = options.body ? JSON.parse(options.body).query : ''
    if (query.includes('SearchAnime')) return graphql({ Page: { media: [media(900001)] } })
    if (query.includes('AnimeSubject')) return graphql({ Media: media(900001) })
    if (query.includes('AiringEpisodes')) return page([schedule(900001, 501, 1, '2026-07-02')])
    return new Response(card())
  }
  let service = await createService({ filename: path.join(dir, 'anime.db'), fetcher })
  t.after(() => { service.close(); fs.rmSync(dir, { recursive: true, force: true }) })
  const anime = (await service.request('GET', '/api/anime?season=202607'))[0]
  const record = await service.request('POST', '/api/watch-records', { animeSourceId: anime.id, watchedEpisodes: 4 })
  await service.request('PUT', `/api/anime/${anime.id}/notes/summary`, { content: '保留笔记' })
  const results = await service.request('GET', '/api/anilist/search?keyword=FixtureNonCatalog')
  assert.equal(results.length, 1)
  assert.equal(results[0].displayName, 'Test Anime')
  const binding = await service.request('PUT', `/api/anime/${anime.id}/broadcast-binding`, { anilistSubjectId: 900001 })
  assert.equal(binding.subject.id, 900001)
  assert.equal(binding.notifyEnabled, true)
  service.close()
  service = await createService({ filename: path.join(dir, 'anime.db'), fetcher })
  const saved = (await service.request('GET', '/api/watch-records'))[0]
  assert.equal(saved.id, record.id)
  assert.equal(saved.watchedEpisodes, 4)
  assert.equal(saved.broadcast.subject.displayName, 'Test Anime')
  assert.equal(saved.broadcast.provider, 'anilist')
  assert.equal((await service.request('GET', `/api/anime/${anime.id}/notes`)).summary.content, '保留笔记')
  await service.request('DELETE', `/api/anime/${anime.id}/broadcast-binding`)
  assert.equal((await service.request('GET', '/api/watch-records'))[0].broadcast, null)
  assert.ok(requests.find(item => item.url === 'https://graphql.anilist.co').options.headers['User-Agent'])
})

test('today alerts wait until 09:00 Shanghai time, persist de-duplication and respect disabled notifications', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anime-broadcast-alert-'))
  let now = new Date('2026-09-19T00:30:00Z')
  const fetcher = async (url, options = {}) => {
    const { query = '', variables } = options.body ? JSON.parse(options.body) : {}
    if (query.includes('AnimeSubject')) return graphql({ Media: media(variables.id) })
    if (query.includes('AiringEpisodes')) return page([schedule(variables.mediaId, variables.mediaId === 124 ? 502 : 501, 7, '2026-09-19')])
    return new Response(card('First') + card('Second'))
  }
  const service = await createService({ filename: path.join(dir, 'anime.db'), fetcher, clock: () => now })
  t.after(() => { service.close(); fs.rmSync(dir, { recursive: true, force: true }) })
  const anime = await service.request('GET', '/api/anime?season=202607')
  for (const item of anime) await service.request('POST', '/api/watch-records', { animeSourceId: item.id })
  await service.request('PUT', `/api/anime/${anime[0].id}/broadcast-binding`, { anilistSubjectId: 123 })
  await service.request('PUT', `/api/anime/${anime[1].id}/broadcast-binding`, { anilistSubjectId: 124, notifyEnabled: false })
  assert.deepEqual(service.claimTodayAlerts({ notificationsEnabled: true }), [])
  now = new Date('2026-09-19T01:00:00Z')
  const alerts = service.claimTodayAlerts({ notificationsEnabled: true })
  assert.equal(alerts.length, 1)
  assert.equal(alerts[0].episodeNumber, 7)
  service.markAlerts(alerts, 'delivered')
  assert.deepEqual(service.claimTodayAlerts({ notificationsEnabled: true }), [])
})

test('a late AniList response cannot overwrite a newer binding', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anime-broadcast-race-'))
  let releaseOld
  const oldEpisodes = new Promise(resolve => { releaseOld = resolve })
  const fetcher = async (url, options = {}) => {
    const { query = '', variables } = options.body ? JSON.parse(options.body) : {}
    if (query.includes('AnimeSubject')) return graphql({ Media: media(variables.id) })
    if (query.includes('AiringEpisodes') && variables.mediaId === 123) {
      await oldEpisodes
      return page([schedule(123, 501, 1, '2026-01-01')])
    }
    if (query.includes('AiringEpisodes') && variables.mediaId === 124) return page([schedule(124, 502, 2, '2026-01-02')])
    return new Response(card())
  }
  const service = await createService({ filename: path.join(dir, 'anime.db'), fetcher, clock: () => new Date('2026-01-03T02:00:00Z') })
  t.after(() => { service.close(); fs.rmSync(dir, { recursive: true, force: true }) })
  const anime = (await service.request('GET', '/api/anime?season=202601'))[0]
  await service.request('POST', '/api/watch-records', { animeSourceId: anime.id })
  const first = service.request('PUT', `/api/anime/${anime.id}/broadcast-binding`, { anilistSubjectId: 123 })
  await new Promise(resolve => setTimeout(resolve, 10))
  const second = service.request('PUT', `/api/anime/${anime.id}/broadcast-binding`, { anilistSubjectId: 124 })
  await second
  releaseOld()
  await first
  const saved = (await service.request('GET', '/api/watch-records'))[0].broadcast
  assert.equal(saved.subject.id, 124)
  assert.equal(saved.estimatedAiredEpisode, 2)
})

test('Bangumi database migration preserves user data and requires a new AniList binding even for identical IDs', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anime-provider-migration-'))
  const filename = path.join(dir, 'anime.db')
  const db = await openDatabase(filename)
  db.write(() => {
    db.run("INSERT INTO anime_sources(id,season,title,source_url,created_at,updated_at) VALUES (42,'202607','原有番剧','https://yuc.wiki/legacy','2026-01-01','2026-01-01')")
    db.run("INSERT INTO watch_records VALUES (8,42,'watching',7,'2026-01-01','2026-01-01')")
    db.run("INSERT INTO anime_notes VALUES (9,42,0,'原有笔记','2026-01-01','2026-01-01')")
    const legacySchema = `DROP TABLE broadcast_alerts; DROP TABLE broadcast_episodes; DROP TABLE broadcast_bindings;
      CREATE TABLE broadcast_bindings (
        anime_source_id INTEGER PRIMARY KEY, bangumi_subject_id INTEGER NOT NULL,
        subject_name TEXT NOT NULL, subject_name_cn TEXT, subject_image_url TEXT, subject_air_date TEXT,
        notify_enabled INTEGER NOT NULL DEFAULT 1, last_attempt_at TEXT, last_success_at TEXT, last_error TEXT,
        failure_count INTEGER NOT NULL DEFAULT 0, next_retry_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        FOREIGN KEY(anime_source_id) REFERENCES anime_sources(id) ON DELETE CASCADE);
      CREATE INDEX idx_broadcast_bindings_subject ON broadcast_bindings(bangumi_subject_id);
      CREATE TABLE broadcast_episodes (
        bangumi_episode_id INTEGER PRIMARY KEY, anime_source_id INTEGER NOT NULL,
        episode_type INTEGER NOT NULL, episode_number REAL, sort_number REAL NOT NULL,
        name TEXT NOT NULL, name_cn TEXT, air_date TEXT,
        FOREIGN KEY(anime_source_id) REFERENCES anime_sources(id) ON DELETE CASCADE);
      CREATE INDEX idx_broadcast_episodes_anime ON broadcast_episodes(anime_source_id);
      CREATE TABLE broadcast_alerts (
        anime_source_id INTEGER NOT NULL, bangumi_episode_id INTEGER NOT NULL,
        alert_type TEXT NOT NULL, schedule_date TEXT NOT NULL, handled_at TEXT NOT NULL, disposition TEXT NOT NULL,
        PRIMARY KEY(anime_source_id,bangumi_episode_id,alert_type,schedule_date),
        FOREIGN KEY(anime_source_id) REFERENCES anime_sources(id) ON DELETE CASCADE);
      INSERT INTO broadcast_bindings VALUES (42,123,'Old','旧番剧',NULL,NULL,0,'2026-09-19T01:00:00Z','2026-09-19T01:00:00Z',NULL,3,'2027-01-01','2026-01-01','2026-01-01');
      INSERT INTO broadcast_episodes VALUES (501,42,0,12,12,'old','旧集','2026-09-19');
      INSERT INTO broadcast_alerts VALUES (42,501,'scheduled_today','2026-09-19','2026-09-19T01:00:00Z','delivered');`
    for (const sql of legacySchema.split(';').filter(sql => sql.trim())) db.run(sql)
  })
  assert.equal(db.rows('SELECT * FROM broadcast_bindings').length, 1)
  db.close()
  const original = fs.readFileSync(filename)
  let calls = 0
  let failEpisodes = true
  const fetcher = async (url, options) => {
    calls++
    assert.equal(url, 'https://graphql.anilist.co')
    const { query } = JSON.parse(options.body)
    if (query.includes('AnimeSubject')) return graphql({ Media: media(123) })
    if (failEpisodes) return new Response(JSON.stringify({ errors: [{ message: 'unavailable' }] }))
    return page([schedule(123, 501, 8, '2026-09-18')])
  }
  let service = await createService({ filename, fetcher, clock: () => new Date('2026-09-19T02:00:00Z') })
  t.after(() => { service.close(); fs.rmSync(dir, { recursive: true, force: true }) })
  let record = (await service.request('GET', '/api/watch-records'))[0]
  assert.equal(record.broadcast.requiresRelink, true)
  assert.equal(record.broadcast.subject.id, 123)
  assert.equal(record.broadcast.estimatedAiredEpisode, null)
  assert.equal(record.watchedEpisodes, 7)
  assert.equal((await service.request('GET', '/api/anime/42/notes')).summary.content, '原有笔记')
  assert.deepEqual(await service.refreshBroadcasts({ force: true }), [])
  assert.deepEqual(service.claimTodayAlerts(), [])
  assert.equal(calls, 0)
  assert.deepEqual(fs.readFileSync(filename + '.pre-desktop.bak'), original)
  const bound = await service.request('PUT', '/api/anime/42/broadcast-binding', { anilistSubjectId: 123, notifyEnabled: false })
  assert.equal(bound.requiresRelink, false)
  assert.equal(bound.lastSuccessAt, null)
  assert.equal(bound.estimatedAiredEpisode, null)
  assert.ok(bound.error)
  failEpisodes = false
  await service.refreshBroadcasts({ force: true })
  service.close()
  service = await createService({ filename, fetcher, clock: () => new Date('2026-09-19T02:00:00Z') })
  record = (await service.request('GET', '/api/watch-records'))[0]
  assert.equal(record.broadcast.provider, 'anilist')
  assert.equal(record.broadcast.notifyEnabled, false)
  assert.equal(record.broadcast.estimatedAiredEpisode, 8)
  assert.equal(record.watchedEpisodes, 7)
})

test('partial AniList pagination failure retains prior progress and sets retry state', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anime-anilist-failure-'))
  let failSecondPage = false
  let now = new Date('2026-09-19T01:00:00Z')
  let calls = 0
  const service = await createService({ filename: path.join(dir, 'anime.db'), clock: () => now, fetcher: async (_url, options = {}) => {
    const { query = '', variables } = options.body ? JSON.parse(options.body) : {}
    if (query.includes('AnimeSubject')) return graphql({ Media: media(123) })
    if (query.includes('AiringEpisodes')) {
      calls++
      if (variables.page === 2) return new Response(JSON.stringify({ errors: [{ message: 'upstream failure' }] }))
      return graphql({ Page: { pageInfo: { hasNextPage: failSecondPage }, airingSchedules: [schedule(123, 501, failSecondPage ? 9 : 7, '2026-09-18')] } })
    }
    return new Response(card())
  } })
  t.after(() => { service.close(); fs.rmSync(dir, { recursive: true, force: true }) })
  const anime = (await service.request('GET', '/api/anime?season=202607'))[0]
  await service.request('POST', '/api/watch-records', { animeSourceId: anime.id })
  await service.request('PUT', `/api/anime/${anime.id}/broadcast-binding`, { anilistSubjectId: 123 })
  assert.equal(service.broadcast(anime.id).estimatedAiredEpisode, 7)
  failSecondPage = true
  now = new Date('2026-09-19T02:00:00Z')
  await service.refreshBroadcasts()
  assert.equal(service.broadcast(anime.id).estimatedAiredEpisode, 7)
  assert.match(service.broadcast(anime.id).error, /upstream failure/)
  const attempts = calls
  await service.refreshBroadcasts()
  assert.equal(calls, attempts)
  now = new Date('2026-09-19T02:05:00Z')
  failSecondPage = false
  await service.refreshBroadcasts()
  assert.equal(service.broadcast(anime.id).error, null)
})

test('migration preserves existing SQLite IDs and makes a byte-for-byte backup without touching source', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anime-migration-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const source = path.join(dir, 'legacy.db')
  const old = await openDatabase(source)
  old.write(() => {
    old.run("INSERT INTO anime_sources(id,season,title,source_url,created_at,updated_at) VALUES (42,'202607','原有番剧','https://yuc.wiki/202607/#legacy','2026-01-01','2026-01-01')")
    old.run("INSERT INTO watch_records VALUES (8,42,'watching',7,'2026-01-01','2026-01-01')")
    old.run("INSERT INTO anime_notes VALUES (9,42,0,'原有笔记','2026-01-01','2026-01-01')")
  })
  old.close()
  const bytes = fs.readFileSync(source)
  const filename = path.join(dir, 'desktop.db')
  const service = await createService({ filename, migrationPath: source })
  try {
    const record = (await service.request('GET', '/api/watch-records'))[0]
    assert.equal(record.id, 8)
    assert.equal(record.anime.id, 42)
    assert.equal(record.watchedEpisodes, 7)
    assert.equal((await service.request('GET', '/api/anime/42/notes')).summary.content, '原有笔记')
    await service.request('PATCH', '/api/watch-records/8', { watchedEpisodes: 8 })
    assert.deepEqual(fs.readFileSync(source), bytes)
    assert.deepEqual(fs.readFileSync(filename + '.pre-desktop.bak'), bytes)
  } finally { service.close() }
})

test('failed disk save rolls back memory and leaves database intact', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anime-disk-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const filename = path.join(dir, 'anime.db')
  const db = await openDatabase(filename)
  try {
    const bytes = fs.readFileSync(filename)
    fs.mkdirSync(filename + '.tmp')
    assert.throws(() => db.write(() => db.run("INSERT INTO season_refreshes VALUES ('202607','now')")))
    assert.deepEqual(db.rows('SELECT * FROM season_refreshes'), [])
    assert.deepEqual(fs.readFileSync(filename), bytes)
  } finally { db.close() }
})

test('rejects uncheckpointed legacy WAL without changing database', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anime-wal-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const filename = path.join(dir, 'anime.db')
  const db = await openDatabase(filename)
  db.close()
  const bytes = fs.readFileSync(filename)
  fs.writeFileSync(filename + '-wal', 'pending')
  await assert.rejects(openDatabase(filename), /日志/)
  assert.deepEqual(fs.readFileSync(filename), bytes)
})

test('external writes are not overwritten by an in-memory desktop database', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anime-external-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const filename = path.join(dir, 'anime.db')
  const first = await openDatabase(filename)
  const second = await openDatabase(filename)
  try {
    second.write(() => second.run("INSERT INTO season_refreshes VALUES ('202607','external')"))
    const bytes = fs.readFileSync(filename)
    assert.throws(() => first.write(() => first.run("INSERT INTO season_refreshes VALUES ('202610','stale')")), /其他程序修改/)
    assert.deepEqual(fs.readFileSync(filename), bytes)
  } finally { first.close(); second.close() }
})

test('image proxy enforces host/type limits, upgrades HTTPS and disables redirects', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anime-image-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const service = await createService({ filename: path.join(dir, 'anime.db'), fetcher: async (url, options) => {
    assert.equal(url.protocol, 'https:')
    assert.equal(options.redirect, 'error')
    return new Response('image', { headers: { 'Content-Type': 'image/png' } })
  } })
  try {
    assert.equal((await service.image('http://i0.hdslb.com/a.png')).bytes.toString(), 'image')
    await assert.rejects(service.image('http://127.0.0.1/private'), /不被允许/)
    await assert.rejects(service.image('https://i0.hdslb.com.evil.com/a'), /不被允许/)
  } finally { service.close() }
})
