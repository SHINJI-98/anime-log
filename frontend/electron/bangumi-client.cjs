const USER_AGENT = 'AnimeLog/0.1 (local desktop anime schedule tracker)'

function apiError(message, status, retryAfter) {
  return Object.assign(new Error(message), { status, retryAfter })
}

async function readJson(response, maxBytes = 4 * 1024 * 1024) {
  if (!response.ok) {
    const retry = Number(response.headers.get('retry-after'))
    throw apiError(`Bangumi 请求失败 (${response.status})`, response.status, Number.isFinite(retry) ? retry : null)
  }
  const bytes = Buffer.from(await response.arrayBuffer())
  if (bytes.length > maxBytes) throw apiError('Bangumi 响应内容过大', 502)
  try { return JSON.parse(bytes.toString('utf8')) } catch { throw apiError('Bangumi 返回了无效数据', 502) }
}

function normalizeSubject(subject) {
  if (!subject || !Number.isSafeInteger(subject.id) || subject.type !== 2) throw apiError('Bangumi 动画条目不存在', 404)
  return {
    id: subject.id,
    name: String(subject.name || '').trim(),
    nameCn: String(subject.name_cn || '').trim(),
    imageUrl: subject.images?.common || subject.images?.medium || subject.image || null,
    airDate: subject.date || subject.air_date || null
  }
}

function createBangumiClient({ fetcher = fetch, baseUrl = 'https://api.bgm.tv', signal } = {}) {
  const root = baseUrl.replace(/\/$/, '')
  async function request(path, options = {}) {
    const response = await fetcher(`${root}${path}`, {
      ...options,
      redirect: 'error',
      signal: signal ? AbortSignal.any([AbortSignal.timeout(15000), signal]) : AbortSignal.timeout(15000),
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT, ...options.headers }
    })
    return readJson(response)
  }
  return {
    async search(keyword) {
      const value = String(keyword || '').trim()
      if (!value || value.length > 120) throw apiError('搜索关键词无效', 400)
      const data = await request('/v0/search/subjects?limit=10&offset=0', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyword: value, sort: 'match', filter: { type: [2] } })
      })
      return (data.data || []).filter(item => item.type === 2).map(normalizeSubject)
    },
    async subject(id) {
      if (!Number.isSafeInteger(id) || id < 1) throw apiError('Bangumi 条目 ID 无效', 400)
      return normalizeSubject(await request(`/v0/subjects/${id}`))
    },
    async episodes(subjectId) {
      const result = []
      let offset = 0
      do {
        const page = await request(`/v0/episodes?subject_id=${subjectId}&type=0&limit=100&offset=${offset}`)
        const items = Array.isArray(page.data) ? page.data : []
        result.push(...items.map(item => ({
          id: item.id, type: item.type, episodeNumber: item.ep ?? null, sortNumber: item.sort,
          name: String(item.name || ''), nameCn: String(item.name_cn || ''), airDate: item.airdate || null
        })))
        offset += items.length
        if (!items.length || offset >= Number(page.total || 0)) break
      } while (offset < 2000)
      return result
    }
  }
}

module.exports = { createBangumiClient, normalizeSubject }
