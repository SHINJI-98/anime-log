const { Converter } = require('opencc-js')
const simplify = Converter({ from: 'tw', to: 'cn' })
const SOURCE = 'https://raw.githubusercontent.com/soruly/anilist-chinese/master/anilist-chinese.json'
const normalize = value => simplify(String(value).normalize('NFKC')).toLowerCase().replace(/[\p{P}\p{Z}\s]/gu, '')

function validate(data) {
  if (!Array.isArray(data) || !data.length || data.length > 100000) throw new Error('中文名称库格式无效')
  const seen = new Set()
  for (const row of data) {
    if (!Number.isSafeInteger(row.id) || row.id < 1 || seen.has(row.id) || typeof row.title !== 'string' || row.title.length > 500 || !Array.isArray(row.synonyms) || row.synonyms.length > 200 || row.synonyms.some(s => typeof s !== 'string' || s.length > 500)) throw new Error('中文名称库条目无效')
    seen.add(row.id)
  }
  return data
}

function createAnimeNames({ db, client, fetcher = fetch, clock = () => new Date(), signal, bundled = require('./data/anilist-chinese.json') }) {
  let data = validate(bundled)
  const cached = db.rows('SELECT * FROM anime_name_catalog WHERE source=?', [SOURCE])[0]
  if (cached) { try { data = validate(JSON.parse(cached.content)) } catch {} }
  let index
  function rebuild() {
    index = new Map(data.filter(row => row.title.trim()).map(row => [row.id, { title: simplify(row.title), names: [row.title, ...row.synonyms].map(normalize).filter(Boolean) }]))
  }
  rebuild()
  let pending
  let lastAttempt = 0
  async function update() {
    if (pending) return pending
    const now = clock().getTime()
    const stored = db.rows('SELECT updated_at FROM anime_name_catalog WHERE source=?', [SOURCE])[0]
    if (now - lastAttempt < 3600000 || (stored && now - Date.parse(stored.updated_at) < 7 * 86400000)) return
    lastAttempt = now
    pending = (async () => {
      const response = await fetcher(SOURCE, { redirect: 'error', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000) })
      if (!response.ok) throw new Error(`中文名称库更新失败 (${response.status})`)
      const reader = response.body.getReader()
      const chunks = []
      let size = 0
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          size += value.length
          if (size > 16 * 1024 * 1024) throw new Error('中文名称库过大')
          chunks.push(Buffer.from(value))
        }
      } finally { await reader.cancel() }
      const content = Buffer.concat(chunks).toString('utf8')
      const next = validate(JSON.parse(content))
      if (next.length < data.length * 0.8) throw new Error('中文名称库疑似不完整，保留旧版本')
      signal?.throwIfAborted()
      db.write(() => db.run('INSERT INTO anime_name_catalog VALUES (?,?,?) ON CONFLICT(source) DO UPDATE SET content=excluded.content,updated_at=excluded.updated_at', [SOURCE, content, clock().toISOString()]))
      data = next
      rebuild()
    })().finally(() => { pending = null })
    return pending
  }
  function decorate(subject) {
    const title = index.get(subject.id)?.title
    return title ? { ...subject, displayName: title } : subject
  }
  async function search(keyword) {
    const query = String(keyword || '').trim()
    if (!query || query.length > 120 || !normalize(query)) throw Object.assign(new Error('搜索关键词无效'), { status: 400 })
    const key = normalize(query)
    const candidates = new Map()
    for (const [id, row] of index) {
      const score = row.names.some(name => name === key) ? 0 : row.names.some(name => name.includes(key)) ? 2 : 9
      if (score < 9) candidates.set(id, { id, title: row.title, score })
    }
    // Confirmed local bindings are authoritative aliases; unbinding removes them.
    for (const row of db.rows(`SELECT b.provider_subject_id AS id,a.title FROM broadcast_bindings b JOIN anime_sources a ON a.id=b.anime_source_id WHERE b.provider='anilist'`)) {
      const name = normalize(row.title)
      if (name.includes(key)) candidates.set(row.id, { id: row.id, title: row.title, score: name === key ? -1 : 1 })
    }
    const selected = [...candidates.values()].sort((a, b) => a.score - b.score || a.id - b.id).slice(0, 10)
    if (!selected.length) return (await client.search(query)).map(decorate)
    try {
      const subjects = await client.subjects(selected.map(row => row.id))
      return selected.flatMap(row => {
        const subject = subjects.find(item => item.id === row.id)
        return subject ? [{ ...subject, displayName: row.title }] : []
      })
    } catch {
      signal?.throwIfAborted()
      return selected.map(row => ({ id: row.id, name: '', displayName: row.title, imageUrl: null, airDate: null, metadataUnavailable: true }))
    }
  }
  function exactId(title) {
    const key = normalize(title)
    if (!key) return null
    const ids = [...index].filter(([, row]) => row.names.includes(key)).map(([id]) => id)
    return ids.length === 1 ? ids[0] : null
  }
  return { search, update, decorate, exactId }
}
module.exports = { createAnimeNames, normalize, validate }
