const jsonHeaders = {
  'Content-Type': 'application/json'
}

async function request(path, options = {}) {
  const response = await fetch(apiUrl(path), options)
  if (!response.ok) {
    let message = '请求失败'
    try {
      const body = await response.json()
      message = body.message || message
    } catch (error) {
      message = response.statusText || message
    }
    throw new Error(message)
  }
  if (response.status === 204) {
    return null
  }
  const text = await response.text()
  return text ? JSON.parse(text) : null
}

export function apiUrl(path) {
  const apiBaseUrl = window.animeLogConfig && window.animeLogConfig.apiBaseUrl
  if (!path.startsWith('/api')) return path
  if (!apiBaseUrl) throw new Error('请在 Anime Log 桌面应用中打开此页面')
  return `${apiBaseUrl.replace(/\/$/, '')}${path.slice('/api'.length)}`
}

export function getCurrentSeason() {
  return request('/api/seasons/current')
}

export function getAnime(season) {
  return request(`/api/anime?season=${encodeURIComponent(season)}`)
}

export function refreshAnime(season) {
  return request(`/api/anime/refresh?season=${encodeURIComponent(season)}`, {
    method: 'POST'
  })
}

export function getWatchRecords(status) {
  const query = status === 'all' ? '' : `?status=${encodeURIComponent(status)}`
  return request(`/api/watch-records${query}`)
}

export function addWatchRecord(animeSourceId) {
  return request('/api/watch-records', {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({
      animeSourceId,
      status: 'watching',
      watchedEpisodes: 0
    })
  })
}

export function updateWatchRecord(id, payload) {
  return request(`/api/watch-records/${id}`, {
    method: 'PATCH',
    headers: jsonHeaders,
    body: JSON.stringify(payload)
  })
}

export function deleteWatchRecord(id) {
  return request(`/api/watch-records/${id}`, {
    method: 'DELETE'
  })
}

export function getAnimeNotes(animeSourceId) {
  return request(`/api/anime/${animeSourceId}/notes`)
}

export function saveSummaryNote(animeSourceId, content) {
  return request(`/api/anime/${animeSourceId}/notes/summary`, {
    method: 'PUT',
    headers: jsonHeaders,
    body: JSON.stringify({ content })
  })
}

export function saveEpisodeNote(animeSourceId, episodeNumber, content) {
  return request(`/api/anime/${animeSourceId}/notes/episodes/${episodeNumber}`, {
    method: 'PUT',
    headers: jsonHeaders,
    body: JSON.stringify({ content })
  })
}

export function deleteEpisodeNote(animeSourceId, episodeNumber) {
  return request(`/api/anime/${animeSourceId}/notes/episodes/${episodeNumber}`, {
    method: 'DELETE'
  })
}

export function searchAniList(keyword) {
  return request(`/api/anime/search?keyword=${encodeURIComponent(keyword)}`)
}

export function getAniListSubject(id) {
  return request(`/api/anilist/subjects/${encodeURIComponent(id)}`)
}

export function saveBroadcastBinding(animeSourceId, anilistSubjectId, notifyEnabled = true) {
  return request(`/api/anime/${animeSourceId}/broadcast-binding`, {
    method: 'PUT', headers: jsonHeaders, body: JSON.stringify({ anilistSubjectId, notifyEnabled })
  })
}

export function deleteBroadcastBinding(animeSourceId) {
  return request(`/api/anime/${animeSourceId}/broadcast-binding`, { method: 'DELETE' })
}

export function refreshBroadcast(animeSourceId) {
  return request('/api/broadcast/refresh', {
    method: 'POST', headers: jsonHeaders,
    body: JSON.stringify(animeSourceId ? { animeSourceId } : {})
  })
}
