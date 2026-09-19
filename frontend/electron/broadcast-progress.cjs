function shanghaiDate(value = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(value)
  const get = type => parts.find(part => part.type === type)?.value
  return `${get('year')}-${get('month')}-${get('day')}`
}

function shanghaiHour(value = new Date()) {
  const hour = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', hour: '2-digit', hourCycle: 'h23' })
    .formatToParts(value).find(part => part.type === 'hour')?.value
  return Number(hour)
}

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

function calculateProgress(episodes, now = new Date()) {
  const today = shanghaiDate(now)
  const main = episodes
    .filter(item => item.episodeType === 0 && Number.isFinite(item.episodeNumber) && validDate(item.airDate))
    .sort((a, b) => a.airDate.localeCompare(b.airDate) || a.sortNumber - b.sortNumber)
  const aired = main.filter(item => item.airDate < today)
  const todayEpisodes = main.filter(item => item.airDate === today)
  const upcoming = main.filter(item => item.airDate >= today)
  const nextDate = upcoming[0]?.airDate || null
  return {
    estimatedAiredEpisode: aired.length ? Math.max(...aired.map(item => item.episodeNumber)) : null,
    todayEpisodes: todayEpisodes.map(item => ({ id: item.bangumiEpisodeId, episodeNumber: item.episodeNumber })),
    next: nextDate ? {
      date: nextDate,
      episodes: upcoming.filter(item => item.airDate === nextDate).map(item => ({ id: item.bangumiEpisodeId, episodeNumber: item.episodeNumber }))
    } : null
  }
}

module.exports = { calculateProgress, shanghaiDate, shanghaiHour, validDate }
