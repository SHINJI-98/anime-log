const fs = require('node:fs')
const path = require('node:path')
const initSqlJs = require('sql.js')

const schema = `
CREATE TABLE IF NOT EXISTS anime_sources (
 id INTEGER PRIMARY KEY AUTOINCREMENT, season TEXT NOT NULL, title TEXT NOT NULL,
 image_url TEXT, air_day TEXT, air_time TEXT, total_episodes INTEGER,
 source_url TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_anime_sources_season ON anime_sources(season);
CREATE TABLE IF NOT EXISTS season_refreshes (season TEXT PRIMARY KEY, refreshed_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS watch_records (
 id INTEGER PRIMARY KEY AUTOINCREMENT, anime_source_id INTEGER NOT NULL UNIQUE,
 status TEXT NOT NULL CHECK(status IN ('watching','completed','dropped')),
 watched_episodes INTEGER NOT NULL CHECK(watched_episodes >= 0),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 FOREIGN KEY(anime_source_id) REFERENCES anime_sources(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS anime_notes (
 id INTEGER PRIMARY KEY AUTOINCREMENT, anime_source_id INTEGER NOT NULL,
 episode_number INTEGER NOT NULL CHECK(episode_number >= 0), content TEXT NOT NULL,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(anime_source_id, episode_number),
 FOREIGN KEY(anime_source_id) REFERENCES anime_sources(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS broadcast_bindings (
 anime_source_id INTEGER PRIMARY KEY, bangumi_subject_id INTEGER NOT NULL,
 subject_name TEXT NOT NULL, subject_name_cn TEXT, subject_image_url TEXT, subject_air_date TEXT,
 notify_enabled INTEGER NOT NULL DEFAULT 1 CHECK(notify_enabled IN (0,1)),
 last_attempt_at TEXT, last_success_at TEXT, last_error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 FOREIGN KEY(anime_source_id) REFERENCES anime_sources(id) ON DELETE CASCADE);
CREATE INDEX IF NOT EXISTS idx_broadcast_bindings_subject ON broadcast_bindings(bangumi_subject_id);
CREATE TABLE IF NOT EXISTS broadcast_episodes (
 bangumi_episode_id INTEGER PRIMARY KEY, anime_source_id INTEGER NOT NULL,
 episode_type INTEGER NOT NULL, episode_number REAL, sort_number REAL NOT NULL,
 name TEXT NOT NULL, name_cn TEXT, air_date TEXT,
 FOREIGN KEY(anime_source_id) REFERENCES anime_sources(id) ON DELETE CASCADE);
CREATE INDEX IF NOT EXISTS idx_broadcast_episodes_anime ON broadcast_episodes(anime_source_id);
CREATE TABLE IF NOT EXISTS broadcast_alerts (
 anime_source_id INTEGER NOT NULL, bangumi_episode_id INTEGER NOT NULL,
 alert_type TEXT NOT NULL, schedule_date TEXT NOT NULL, handled_at TEXT NOT NULL, disposition TEXT NOT NULL,
 PRIMARY KEY(anime_source_id,bangumi_episode_id,alert_type,schedule_date),
 FOREIGN KEY(anime_source_id) REFERENCES anime_sources(id) ON DELETE CASCADE);`

async function openDatabase(filename, migrationPath) {
  const SQL = await initSqlJs({ locateFile: () => require.resolve('sql.js/dist/sql-wasm.wasm') })
  fs.mkdirSync(path.dirname(filename), { recursive: true })
  const source = fs.existsSync(filename) ? filename : migrationPath
  // A WASM SQLite connection cannot replay another process's WAL or rollback journal.
  if (source && ['-wal', '-journal'].some(suffix => fs.existsSync(source + suffix) && fs.statSync(source + suffix).size > 0)) {
    throw new Error('数据库仍有未合并的日志，请先正常关闭旧版应用或后端，再启动。原数据库未被修改。')
  }
  const original = source && fs.existsSync(source) ? fs.readFileSync(source) : undefined
  let diskSnapshot = fs.existsSync(filename) ? fs.readFileSync(filename) : null
  let db = new SQL.Database(original)
  if (db.exec('PRAGMA integrity_check')[0].values[0][0] !== 'ok') throw new Error('数据库检查失败，原文件未被修改。')
  if (original && !fs.existsSync(filename + '.pre-desktop.bak')) {
    fs.writeFileSync(filename + '.pre-desktop.bak', original, { flag: 'wx' })
  }
  const rows = (sql, params = []) => {
    const statement = db.prepare(sql)
    try {
      statement.bind(params)
      const result = []
      while (statement.step()) result.push(statement.getAsObject())
      return result
    } finally { statement.free() }
  }
  const run = (sql, params = []) => db.run(sql, params)
  function write(action) {
    const currentDisk = fs.existsSync(filename) ? fs.readFileSync(filename) : null
    if ((currentDisk === null) !== (diskSnapshot === null) || (currentDisk && !currentDisk.equals(diskSnapshot))) {
      throw new Error('数据库已被其他程序修改，请关闭旧版应用并重新打开。为保护数据，本次保存已取消。')
    }
    const before = db.export()
    db.run('PRAGMA foreign_keys = ON')
    try {
      db.run('BEGIN')
      const result = action()
      db.run('COMMIT')
      const bytes = db.export()
      const temporary = filename + '.tmp'
      const fd = fs.openSync(temporary, 'w')
      try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
      fs.renameSync(temporary, filename)
      diskSnapshot = Buffer.from(bytes)
      db.run('PRAGMA foreign_keys = ON')
      return result
    } catch (error) {
      db.close()
      db = new SQL.Database(before)
      db.run('PRAGMA foreign_keys = ON')
      throw error
    }
  }
  write(() => {
    db.run(schema)
    if (!rows('PRAGMA table_info(anime_sources)').some(column => column.name === 'air_day')) {
      db.run('ALTER TABLE anime_sources ADD COLUMN air_day TEXT')
    }
  })
  return { rows, run, write, close: () => db.close() }
}
module.exports = { openDatabase }
