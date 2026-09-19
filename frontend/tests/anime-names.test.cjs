const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { openDatabase } = require('../electron/database.cjs')
const { createAnimeNames, normalize } = require('../electron/anime-names.cjs')
const { parseBangumiNames } = require('../electron/bangumi-data-names.cjs')

const bundled = [
  { id: 1, title: '進擊的巨人', synonyms: ['巨人'] },
  { id: 2, title: '進擊的巨人 第二季', synonyms: ['巨人'] },
  { id: 3, title: '葬送的芙莉蓮', synonyms: [] }
]
async function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anime-names-'))
  const filename = path.join(dir, 'test.db')
  const db = await openDatabase(filename)
  t.after(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }) })
  return { db, filename }
}
test('real Chinese title 欺诈游戏 resolves to LIAR GAME by ID without forwarding Chinese to AniList', async t => {
  const { db } = await fixture(t)
  const names = createAnimeNames({ db, client: {
    search: async () => { assert.fail('Chinese title must resolve locally') },
    subjects: async ids => {
      assert.deepEqual(ids, [197754])
      return [{ id: 197754, name: 'LIAR GAME', displayName: 'LIAR GAME' }]
    }
  } })
  assert.equal(names.exactId('欺诈游戏'), 197754)
  assert.equal(names.exactId('LIAR GAME - 詐欺遊戲'), 197754)
  const result = await names.search('欺诈游戏')
  assert.equal(result[0].id, 197754)
  assert.equal(result[0].name, 'LIAR GAME')
  assert.equal(result[0].displayName, '欺诈游戏')
})
test('supplement uses explicit AniList IDs only, merging translations without confusing Bangumi IDs', () => {
  const item = { title: 'LIAR GAME', titleTranslate: { 'zh-Hans': ['欺诈游戏'], 'zh-Hant': ['詐欺遊戲'] }, sites: [{ site: 'bangumi', id: '580133' }, { site: 'aniList', id: '197754' }] }
  const rows = parseBangumiNames({ items: [item, { ...item, title: 'Original Alias' }, { ...item, sites: [{ site: 'bangumi', id: '197754' }] }, { ...item, sites: [{ site: 'aniList', id: '1' }, { site: 'aniList', id: '2' }] }] })
  assert.equal(rows.length, 1)
  assert.equal(rows[0].id, 197754)
  assert.ok(rows[0].synonyms.includes('Original Alias'))
  assert.ok(rows[0].synonyms.includes('詐欺遊戲'))
})
test('old primary cache cannot hide new supplement; one failed update preserves the other source and aliases', async t => {
  const { db } = await fixture(t)
  const primary = [{ id: 197754, title: 'LIAR GAME', synonyms: ['詐欺遊戲'] }]
  const supplemental = [{ id: 197754, title: '欺诈游戏', synonyms: [] }]
  db.write(() => db.run('INSERT INTO anime_name_catalog VALUES (?,?,?)', ['https://raw.githubusercontent.com/soruly/anilist-chinese/master/anilist-chinese.json', JSON.stringify(primary), '2026-01-01T00:00:00Z']))
  const options = { db, bundled: primary, supplemental, client: {}, clock: () => new Date('2026-09-20T00:00:00Z'), fetcher: async url => {
    if (url.includes('soruly')) throw new Error('offline')
    return new Response(JSON.stringify({ items: [{ title: 'LIAR GAME', titleTranslate: { 'zh-Hans': ['欺诈游戏', '别名测试'] }, sites: [{ site: 'aniList', id: '197754' }] }] }))
  } }
  const names = createAnimeNames(options)
  assert.equal(names.exactId('欺诈游戏'), 197754)
  await assert.rejects(names.update(), /offline/)
  assert.equal(names.exactId('诈欺游戏'), 197754)
  assert.equal(names.exactId('别名测试'), 197754)
  assert.equal(createAnimeNames(options).exactId('别名测试'), 197754)
  // Clear the test cache before checking cross-source ambiguity.
  db.write(() => db.run('DELETE FROM anime_name_catalog'))
  const clean = createAnimeNames({ db, bundled: [{ id: 1, title: '同名', synonyms: [] }], supplemental: [{ id: 2, title: '同名', synonyms: [] }], client: {} })
  assert.equal(clean.exactId('同名'), null)
})
test('Chinese search resolves simplified/traditional aliases to IDs, preserves seasons and refuses ambiguous auto-link', async t => {
  const { db } = await fixture(t)
  const names = createAnimeNames({ db, bundled, client: {
    subjects: async ids => ids.map(id => ({ id, name: 'Original', displayName: 'English' })),
    search: async query => [{ id: 999, name: query }]
  } })
  assert.equal(normalize('進擊的巨人　第二季！'), normalize('进击的巨人 第二季'))
  assert.equal(names.exactId('进击的巨人'), 1)
  assert.equal(names.exactId('进击的巨人 第二季'), 2)
  assert.equal(names.exactId('巨人'), null)
  assert.equal(names.exactId(''), null)
  const result = await names.search('进击的巨人')
  assert.deepEqual(result.map(row => row.id), [1, 2])
  assert.equal(result[0].displayName, '进击的巨人')
  assert.equal((await names.search('Unknown'))[0].name, 'Unknown')
  await assert.rejects(names.search('！！'), /无效/)
})
test('offline AniList keeps local candidates visible; cancelled searches do not continue', async t => {
  const { db } = await fixture(t)
  const controller = new AbortController()
  const names = createAnimeNames({ db, bundled, signal: controller.signal, client: { subjects: async () => { throw new Error('offline') } } })
  const result = await names.search('芙莉莲')
  assert.equal(result[0].id, 3)
  assert.equal(result[0].metadataUnavailable, true)
  controller.abort()
  await assert.rejects(names.search('芙莉莲'), { name: 'AbortError' })
})
test('catalog refresh is coalesced, persisted, weekly and retains old index on malformed data or disk failure', async t => {
  const { db } = await fixture(t)
  let now = new Date('2026-09-20T00:00:00Z')
  let calls = 0
  let payload = [...bundled, { id: 4, title: '新番', synonyms: [] }]
  const options = { db, bundled, client: {}, clock: () => now, fetcher: async () => { calls++; return new Response(JSON.stringify(payload)) } }
  const names = createAnimeNames(options)
  await Promise.all([names.update(), names.update()])
  assert.equal(calls, 1)
  assert.equal(names.exactId('新番'), 4)
  const restored = createAnimeNames(options)
  assert.equal(restored.exactId('新番'), 4)
  await restored.update()
  assert.equal(calls, 1)
  now = new Date('2026-09-28T00:00:00Z')
  payload = [{ id: 4, title: '坏数据', synonyms: [] }]
  await assert.rejects(restored.update(), /不完整/)
  assert.equal(restored.exactId('新番'), 4)
  now = new Date('2026-09-28T02:00:00Z')
  payload = [...bundled, { id: 5, title: '未保存', synonyms: [] }]
  const write = db.write
  db.write = () => { throw new Error('disk full') }
  await assert.rejects(restored.update(), /disk full/)
  db.write = write
  assert.equal(restored.exactId('未保存'), null)
  assert.equal(createAnimeNames(options).exactId('新番'), 4)
})
