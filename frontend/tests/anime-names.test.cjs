const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { openDatabase } = require('../electron/database.cjs')
const { createAnimeNames, normalize } = require('../electron/anime-names.cjs')

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
