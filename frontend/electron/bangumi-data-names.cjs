// Only consume explicit AniList links. Bangumi IDs and title similarity are not mappings.
function parseBangumiNames(payload) {
  if (!Array.isArray(payload?.items)) throw new Error('中文补充名称库格式无效')
  const records = new Map()
  for (const item of payload.items) {
    if (!Array.isArray(item.sites)) throw new Error('中文补充名称库站点无效')
    const ids = [...new Set(item.sites.filter(site => String(site.site).toLowerCase() === 'anilist').map(site => Number(site.id)))]
    if (ids.some(id => !Number.isSafeInteger(id) || id < 1)) throw new Error('中文补充名称库 ID 无效')
    if (ids.length !== 1) continue
    const translations = item.titleTranslate || {}
    const titles = Object.values(translations).flat()
    if (typeof item.title !== 'string' || titles.some(title => typeof title !== 'string')) throw new Error('中文补充名称库标题无效')
    const id = ids[0]
    const title = translations['zh-Hans']?.[0] || translations['zh-Hant']?.[0] || item.title
    const previous = records.get(id)
    records.set(id, { id, title: previous?.title || title, synonyms: [...new Set([...(previous?.synonyms || []), title, item.title, ...titles])].filter(Boolean) })
  }
  return [...records.values()]
}
module.exports = { parseBangumiNames }
