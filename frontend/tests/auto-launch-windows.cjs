const { _electron } = require('@playwright/test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

// Exercise Electron's actual Windows registry integration with an isolated entry.
;(async () => {
  if (process.platform !== 'win32') return
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'anime-startup-test-'))
  let electron
  try {
    electron = await _electron.launch({
      executablePath: path.resolve('release/win-unpacked/Anime Log.exe'),
      env: { ...process.env, ANIME_LOG_USER_DATA_DIR: directory }
    })
    const results = await electron.evaluate(({ app }, { source, executable, name }) => {
      const startup = new Function(`${source}; return createAutoLaunch` )()(app, {
        platform: 'win32', executable, name
      })
      try {
        const before = startup.read().autoLaunch
        startup.set(true)
        const enabled = startup.read().autoLaunch
        const items = app.getLoginItemSettings({ path: `"${executable}"`, args: ['--autostart'] }).launchItems
        const registration = process.mainModule.require('node:child_process').execFileSync('reg.exe', ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run', '/v', name], { encoding: 'utf8', windowsHide: true })
        startup.set(false)
        return { before, enabled, after: startup.read().autoLaunch,
          item: items.find(item => item.name === name), registration }
      } finally {
        app.setLoginItemSettings({ path: `"${executable}"`, args: ['--autostart'], name, openAtLogin: false })
      }
    }, { source: fs.readFileSync('electron/auto-launch.cjs', 'utf8').replace('module.exports = { createAutoLaunch }', ''),
      executable: path.resolve('release/Anime-Log-0.1.0-portable.exe'),
      name: `AnimeLog-Test-${process.pid}-${Date.now()}` })
    assert.equal(results.before, false)
    assert.equal(results.enabled, true)
    assert.equal(results.after, false)
    assert.equal(results.item.path, path.resolve('release/Anime-Log-0.1.0-portable.exe'))
    assert(results.registration.includes('"' + path.resolve('release/Anime-Log-0.1.0-portable.exe') + '" --autostart'))
    assert.equal(results.item.enabled, true)
    console.log('Windows startup registration, path with spaces, readback and removal passed')
  } finally {
    if (electron) await electron.close()
    fs.rmSync(directory, { recursive: true, force: true })
  }
})().catch(error => { console.error(error); process.exitCode = 1 })
