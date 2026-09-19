const { shanghaiDate, validDate } = require('./broadcast-progress.cjs')
const USER_AGENT = 'AnimeLog/0.1 (desktop airing schedule tracker)'
const MEDIA_FIELDS = `id type title { native romaji english } coverImage { large } startDate { year month day }`

function apiError(message, status = 502, retryAfter = null) {
  return Object.assign(new Error(message), { status, retryAfter })
}

function normalizeSubject(media) {
  if (!media || !Number.isSafeInteger(media.id) || media.id < 1 || media.type !== 'ANIME') {
    throw apiError('AniList 动画条目不存在', 404)
  }
  const title = media.title || {}
  const date = media.startDate || {}
  const airDate = `${date.year}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`
  return {
    id: media.id,
    name: title.native || title.romaji || title.english || `AniList #${media.id}`,
    displayName: title.english || title.romaji || title.native || `AniList #${media.id}`,
    imageUrl: /^https:\/\//.test(media.coverImage?.large || '') ? media.coverImage.large : null,
    airDate: validDate(airDate) ? airDate : null
  }
}

function createAniListClient({ fetcher = fetch, url = 'https://graphql.anilist.co', signal, clock = () => new Date() } = {}) {
  let active = 0
  let blockedUntil = 0
  const waiting = []
  async function request(query, variables) {
    if (active >= 2) await new Promise(resolve => waiting.push(resolve))
    else active++
    try {
      signal?.throwIfAborted()
      const delay = Math.ceil((blockedUntil - clock().getTime()) / 1000)
      if (delay > 0) throw apiError('AniList 请求限流，请稍后重试', 429, delay)
      const response = await fetcher(url, {
        method: 'POST', redirect: 'error',
        signal: signal ? AbortSignal.any([AbortSignal.timeout(15000), signal]) : AbortSignal.timeout(15000),
        headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': USER_AGENT },
        body: JSON.stringify({ query, variables })
      })
      const retryHeader = response.headers.get('retry-after')
      const retrySeconds = retryHeader == null ? NaN : Number(retryHeader)
      const retryDate = Date.parse(retryHeader)
      const retryAfter = Number.isFinite(retrySeconds) && retrySeconds >= 0 ? retrySeconds
        : Number.isFinite(retryDate) ? Math.max(0, Math.ceil((retryDate - clock().getTime()) / 1000)) : null
      if (response.status === 429) blockedUntil = clock().getTime() + (retryAfter ?? 60) * 1000
      if (response.headers.get('x-ratelimit-remaining') === '0') {
        const reset = Number(response.headers.get('x-ratelimit-reset')) * 1000
        blockedUntil = Math.max(blockedUntil, reset > clock().getTime() ? reset : clock().getTime() + 60000)
      }
      if (!response.ok) throw apiError(`AniList 请求失败 (${response.status})`, response.status, response.status === 429 ? retryAfter ?? 60 : retryAfter)
      const reader = response.body.getReader()
      const chunks = []
      let length = 0
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          length += value.length
          if (length > 4 * 1024 * 1024) throw apiError('AniList 响应内容过大')
          chunks.push(Buffer.from(value))
        }
      } finally { await reader.cancel() }
      let result
      try { result = JSON.parse(Buffer.concat(chunks).toString('utf8')) }
      catch { throw apiError('AniList 返回了无效数据') }
      if (Array.isArray(result.errors) && result.errors.length) {
        const error = result.errors[0]
        if (error.status === 429) blockedUntil = clock().getTime() + (retryAfter ?? 60) * 1000
        throw apiError(`AniList：${error.message || '查询失败'}`, error.status || 502, error.status === 429 ? retryAfter ?? 60 : retryAfter)
      }
      if (!result.data || typeof result.data !== 'object') throw apiError('AniList 返回了无效数据')
      return result.data
    } finally {
      const next = waiting.shift()
      if (next) next()
      else active--
    }
  }
  return {
    async search(keyword) {
      const search = String(keyword || '').trim()
      if (!search || search.length > 120) throw apiError('搜索关键词无效', 400)
      const data = await request(`query SearchAnime($search: String!) {
        Page(page: 1, perPage: 10) { media(search: $search, type: ANIME, sort: SEARCH_MATCH) { ${MEDIA_FIELDS} } }
      }`, { search })
      if (!Array.isArray(data.Page?.media)) throw apiError('AniList 搜索结果不完整')
      return data.Page.media.map(normalizeSubject)
    },
    async subjects(ids) {
      if (!Array.isArray(ids) || !ids.length || ids.length > 10 || ids.some(id => !Number.isSafeInteger(id) || id < 1)) throw apiError('AniList 条目 ID 无效', 400)
      const data = await request(`query AnimeCandidates($ids: [Int]) {
        Page(page: 1, perPage: 10) { media(id_in: $ids, type: ANIME) { ${MEDIA_FIELDS} } }
      }`, { ids })
      if (!Array.isArray(data.Page?.media)) throw apiError('AniList 搜索结果不完整')
      return data.Page.media.map(normalizeSubject)
    },
    async subject(id) {
      if (!Number.isSafeInteger(id) || id < 1) throw apiError('AniList 条目 ID 无效', 400)
      const data = await request(`query AnimeSubject($id: Int!) { Media(id: $id, type: ANIME) { ${MEDIA_FIELDS} } }`, { id })
      return normalizeSubject(data.Media)
    },
    async episodes(subjectId) {
      const result = []
      const seen = new Set()
      for (let page = 1; page <= 100; page++) {
        const data = await request(`query AiringEpisodes($mediaId: Int!, $page: Int!) {
          Page(page: $page, perPage: 50) {
            pageInfo { hasNextPage }
            airingSchedules(mediaId: $mediaId, sort: [EPISODE, ID]) { id mediaId episode airingAt }
          }
        }`, { mediaId: subjectId, page })
        const items = data.Page?.airingSchedules
        const hasNextPage = data.Page?.pageInfo?.hasNextPage
        if (!Array.isArray(items) || typeof hasNextPage !== 'boolean' || (hasNextPage && !items.length)) {
          throw apiError('AniList 放送排期分页不完整，已保留缓存')
        }
        for (const item of items) {
          if (!item || !Number.isSafeInteger(item.id) || item.id < 1 || item.mediaId !== subjectId
            || !Number.isInteger(item.episode) || item.episode < 1 || seen.has(item.id)) {
            throw apiError('AniList 放送排期无效，已保留缓存')
          }
          seen.add(item.id)
          const date = Number.isSafeInteger(item.airingAt) && item.airingAt > 0 ? new Date(item.airingAt * 1000) : null
          result.push({
            id: item.id, type: 0, episodeNumber: item.episode, sortNumber: item.episode,
            name: '', displayName: '', airDate: date && Number.isFinite(date.getTime()) ? shanghaiDate(date) : null
          })
        }
        if (!hasNextPage) return result
      }
      throw apiError('AniList 放送排期超出分页范围，已保留缓存')
    }
  }
}

module.exports = { createAniListClient, normalizeSubject }
