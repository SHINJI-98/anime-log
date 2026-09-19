const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { createService, currentSeason } = require('../electron/local-service.cjs')
const { openDatabase } = require('../electron/database.cjs')
const { parseAnime, javaHash } = require('../electron/yuc-parser.cjs')
const { calculateProgress, shanghaiDate, validDate } = require('../electron/broadcast-progress.cjs')

function card(title = '测试番剧', episodes = '全12话') {
  return `<div><div><div class="div_date_"><img data-src="http://i0.hdslb.com/a.jpg"><p class="imgtext5">23:00</p></div><div><table><tr><td class="date_title_">${title}</td></tr><tr><td>${episodes}</td></tr></table></div></div></div>`
}
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
    { bangumiEpisodeId: 1, episodeType: 0, episodeNumber: 1, sortNumber: 1, airDate: '2026-09-18' },
    { bangumiEpisodeId: 2, episodeType: 0, episodeNumber: 1.5, sortNumber: 1.5, airDate: '2026-09-19' },
    { bangumiEpisodeId: 3, episodeType: 0, episodeNumber: 2, sortNumber: 2, airDate: '2026-09-20' },
    { bangumiEpisodeId: 4, episodeType: 1, episodeNumber: 9, sortNumber: 9, airDate: '2026-09-17' },
    { bangumiEpisodeId: 5, episodeType: 0, episodeNumber: 99, sortNumber: 99, airDate: 'not-a-date' }
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

test('Bangumi search and confirmed binding persist without changing watch progress or notes', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anime-bangumi-binding-'))
  const requests = []
  const fetcher = async (url, options = {}) => {
    requests.push({ url: String(url), options })
    if (String(url).includes('/v0/search/subjects')) return new Response(JSON.stringify({ data: [
      { id: 123, type: 2, name: 'Test Anime', name_cn: '测试番剧', date: '2026-07-01', images: { common: 'https://lain.bgm.tv/pic.jpg' } },
      { id: 999, type: 1, name: 'Book', name_cn: '书' }
    ] }))
    if (String(url).endsWith('/v0/subjects/123')) return new Response(JSON.stringify({
      id: 123, type: 2, name: 'Test Anime', name_cn: '测试番剧', date: '2026-07-01', images: { common: 'https://lain.bgm.tv/pic.jpg' }
    }))
    if (String(url).includes('/v0/episodes')) return new Response(JSON.stringify({ total: 1, data: [
      { id: 501, type: 0, ep: 1, sort: 1, name: 'Episode 1', name_cn: '第一集', airdate: '2026-07-02' }
    ] }))
    return new Response(card())
  }
  let service = await createService({ filename: path.join(dir, 'anime.db'), fetcher })
  t.after(() => { service.close(); fs.rmSync(dir, { recursive: true, force: true }) })
  const anime = (await service.request('GET', '/api/anime?season=202607'))[0]
  const record = await service.request('POST', '/api/watch-records', { animeSourceId: anime.id, watchedEpisodes: 4 })
  await service.request('PUT', `/api/anime/${anime.id}/notes/summary`, { content: '保留笔记' })
  const results = await service.request('GET', '/api/bangumi/search?keyword=%E6%B5%8B%E8%AF%95')
  assert.equal(results.length, 1)
  assert.equal(results[0].nameCn, '测试番剧')
  const binding = await service.request('PUT', `/api/anime/${anime.id}/broadcast-binding`, { bangumiSubjectId: 123 })
  assert.equal(binding.subject.id, 123)
  assert.equal(binding.notifyEnabled, true)
  service.close()
  service = await createService({ filename: path.join(dir, 'anime.db'), fetcher })
  const saved = (await service.request('GET', '/api/watch-records'))[0]
  assert.equal(saved.id, record.id)
  assert.equal(saved.watchedEpisodes, 4)
  assert.equal(saved.broadcast.subject.nameCn, '测试番剧')
  assert.equal((await service.request('GET', `/api/anime/${anime.id}/notes`)).summary.content, '保留笔记')
  await service.request('DELETE', `/api/anime/${anime.id}/broadcast-binding`)
  assert.equal((await service.request('GET', '/api/watch-records'))[0].broadcast, null)
  assert.ok(requests.find(item => item.url.includes('/v0/search/subjects')).options.headers['User-Agent'])
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
