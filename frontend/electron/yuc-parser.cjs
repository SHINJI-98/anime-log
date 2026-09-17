const { load } = require('cheerio/slim')
const normalize = value => String(value || '').replace(/\s+/g, ' ').trim()
function cleanTitle(value) {
  const title = normalize(value)
  return !title || title.length > 80 || /^(http|PV$)/i.test(title) || /新番|更新时间|动画官网/.test(title) ? null : title
}
// Preserve Java String.hashCode IDs, so refreshing does not orphan existing records.
function javaHash(value) {
  let hash = 0
  for (let i = 0; i < value.length; i++) hash = (Math.imul(hash, 31) + value.charCodeAt(i)) | 0
  return (hash >>> 0).toString(16)
}
function parseAnime(html, pageUrl) {
  const $ = load(html)
  // Match Jsoup Element.text(): line breaks/block boundaries become spaces.
  function textOf(element) {
    const copy = element.clone()
    copy.find('br').replaceWith(' ')
    copy.find('p, div, tr, td, th, li, h1, h2, h3, h4, h5, h6, section, article, table, ul, ol').each((_, node) => {
      $(node).prepend(' ').append(' ')
    })
    return normalize(copy.text())
  }
  const found = new Map()
  const absolute = value => {
    if (!value) return null
    try { return new URL(value, pageUrl).href } catch { return null }
  }
  const image = element => {
    const img = element.find('img').first()
    return absolute(img.attr('data-src') || img.attr('src'))?.replace(/^http:\/\/(i\d\.hdslb\.com\/)/, 'https://$1') || null
  }
  const episodes = text => Number(text.match(/(?:全|共)\s*(\d{1,3})\s*(?:话|話|集)/)?.[1]) || null
  function airTime(element, text) {
    for (const selector of ['.broadcast_r', 'p[class^=imgtext]', '.time', '.date', '.onair', '.broadcast', '.pub']) {
      const value = textOf(element.find(selector).first())
      if (value) return value
    }
    return text.match(/\d{1,2}[:：]\d{2}|\d{1,2}\/\d{1,2}|\d{1,2}月\d{1,2}日|周[一二三四五六日天]|星期[一二三四五六日天]/)?.[0] || null
  }
  let day = null
  $('.date2, td[class^=date_title]').each((_, node) => {
    const cell = $(node)
    if (cell.hasClass('date2')) { day = textOf(cell) || day; return }
    const title = cleanTitle(textOf(cell))
    if (!title) return
    const card = cell.closest('table').parent().parent()
    const dateBlock = card.find('.div_date, .div_date_').first()
    const text = textOf(card)
    const sourceUrl = `${pageUrl}#date-${javaHash(title)}`
    found.set(sourceUrl, { title, imageUrl: image(dateBlock), airDay: day,
      airTime: dateBlock.length ? airTime(dateBlock, text) : null, totalEpisodes: episodes(text), sourceUrl })
  })
  if (found.size) return [...found.values()]
  function titleOf(candidate) {
    for (const selector of ['td[class^=date_title]', '.title_main_r p[class^=title_cn]', 'p[class^=title_cn]', 'td[class^=future_title]', '.title', '.name', 'h1', 'h2', 'h3', 'h4', 'a[title]']) {
      const el = candidate.find(selector).first()
      const title = cleanTitle(el.attr('title') || textOf(el))
      if (title) return title
    }
    return cleanTitle(candidate.contents().filter((_, node) => node.type === 'text').text())
  }
  function candidateAnime(candidate) {
    const title = titleOf(candidate)
    const imageUrl = image(candidate)
    const text = textOf(candidate)
    if (!title || title.length < 2 || (!imageUrl && text.length < title.length + 8)) return false
    const anchor = candidate.find('[id]').addBack('[id]').first().attr('id')
    const sourceUrl = absolute(candidate.find('a[href]').first().attr('href')) || `${pageUrl}#${anchor || javaHash(title)}`
    found.set(sourceUrl, { title, imageUrl, airDay: null, airTime: airTime(candidate, text), totalEpisodes: episodes(text), sourceUrl })
    return true
  }
  $('.title_main_r, tr, .div_date, .date2, .main_box, .entry, .anime, .item, li, article').each((_, node) => candidateAnime($(node)))
  if (!found.size) $('img').each((_, node) => {
    let candidate = $(node).parent()
    for (let i = 0; i < 3 && candidate.length; i++, candidate = candidate.parent()) if (candidateAnime(candidate)) break
  })
  return [...found.values()]
}
module.exports = { parseAnime, javaHash }
