const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createAniListClient } = require('../electron/anilist-client.cjs')

const response = data => new Response(JSON.stringify({ data }))

test('AniList search uses GraphQL variables, supports missing translations and partial dates', async () => {
  const client = createAniListClient({ fetcher: async (url, options) => {
    assert.equal(url, 'https://graphql.anilist.co')
    assert.equal(options.method, 'POST')
    assert.equal(options.redirect, 'error')
    assert.ok(options.headers['User-Agent'])
    const { query, variables } = JSON.parse(options.body)
    assert.ok(query.includes('type: ANIME'))
    assert.equal(variables.search, 'テスト " test')
    assert.ok(!query.includes(variables.search))
    return response({ Page: { media: [{ id: 1, type: 'ANIME', title: { native: 'テスト' }, startDate: { year: 2026, month: null, day: null } }] } })
  } })
  const items = await client.search('テスト " test')
  assert.equal(items[0].name, 'テスト')
  assert.equal(items[0].displayName, 'テスト')
  assert.equal(items[0].airDate, null)
})

test('AniList pages schedules and converts UTC timestamps to Shanghai dates', async () => {
  const pages = []
  const client = createAniListClient({ fetcher: async (_url, options) => {
    const { variables } = JSON.parse(options.body)
    pages.push(variables.page)
    assert.equal(variables.mediaId, 4)
    return response({ Page: { pageInfo: { hasNextPage: variables.page === 1 }, airingSchedules: [
      { id: variables.page, mediaId: 4, episode: variables.page, airingAt: Date.parse('2026-09-19T16:30:00Z') / 1000 }
    ] } })
  } })
  const items = await client.episodes(4)
  assert.deepEqual(pages, [1, 2])
  assert.equal(items[0].airDate, '2026-09-20')
  assert.deepEqual(items.map(item => item.episodeNumber), [1, 2])
})

test('AniList rejects HTTP-200 GraphQL errors, manga and incomplete/repeated schedule pages', async () => {
  let mode = 'graphql'
  const client = createAniListClient({ fetcher: async () => {
    if (mode === 'graphql') return new Response(JSON.stringify({ data: { Media: null }, errors: [{ status: 404, message: 'Not Found' }] }))
    if (mode === 'manga') return response({ Media: { id: 1, type: 'MANGA' } })
    if (mode === 'invalid') return response({ Page: { airingSchedules: [] } })
    return response({ Page: { pageInfo: { hasNextPage: true }, airingSchedules: [{ id: 2, mediaId: 1, episode: 1, airingAt: 1 }] } })
  } })
  await assert.rejects(client.subject(1), error => error.status === 404)
  mode = 'manga'
  await assert.rejects(client.subject(1), /动画条目不存在/)
  mode = 'invalid'
  await assert.rejects(client.episodes(1), /分页不完整/)
  mode = 'duplicate'
  await assert.rejects(client.episodes(1), /排期无效/)
})

test('AniList honors Retry-After and prevents immediate follow-up traffic', async () => {
  let now = new Date('2026-09-19T01:00:00Z')
  let calls = 0
  const client = createAniListClient({ clock: () => now, fetcher: async () => {
    calls++
    if (calls === 1) return new Response('', { status: 429, headers: { 'Retry-After': '120' } })
    return response({ Page: { media: [] } })
  } })
  await assert.rejects(client.search('Test'), error => error.status === 429 && error.retryAfter === 120)
  await assert.rejects(client.search('Test'), error => error.status === 429 && error.retryAfter === 120)
  assert.equal(calls, 1)
  now = new Date('2026-09-19T01:02:00Z')
  assert.deepEqual(await client.search('Test'), [])
  assert.equal(calls, 2)
})

test('AniList limits all queries to two simultaneous requests and cancels on shutdown', async () => {
  const controller = new AbortController()
  let active = 0
  let maximum = 0
  const client = createAniListClient({ signal: controller.signal, fetcher: async (_url, options) => {
    maximum = Math.max(maximum, ++active)
    assert.equal(options.signal.aborted, false)
    await new Promise(resolve => setTimeout(resolve, 5))
    active--
    return response({ Page: { media: [] } })
  } })
  await Promise.all(Array.from({ length: 6 }, () => client.search('Test')))
  assert.equal(maximum, 2)
  controller.abort()
  await assert.rejects(client.search('Test'), error => error.name === 'AbortError')
})
