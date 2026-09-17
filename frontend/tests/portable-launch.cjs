const { chromium } = require('@playwright/test')
const { spawn, execFileSync } = require('node:child_process')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const net = require('node:net')
const os = require('node:os')
const path = require('node:path')
;(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anime-outer-portable-'))
  fs.writeFileSync(path.join(dir, 'desktop-settings.json'), JSON.stringify({ closeAction: 'quit', mode: 'full' }))
  const reservation = net.createServer()
  await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve))
  const port = reservation.address().port
  await new Promise(resolve => reservation.close(resolve))
  const child = spawn(path.resolve('release/Anime-Log-0.1.0-portable.exe'), ['--autostart', `--remote-debugging-port=${port}`], {
    env: { ...process.env, ANIME_LOG_USER_DATA_DIR: dir, ANIME_LOG_DISABLE_FULLSCREEN: '1' }, windowsHide: true, stdio: 'ignore'
  })
  let browser
  try {
    let endpoint
    for (let i = 0; i < 120; i++) {
      try { endpoint = (await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()).webSocketDebuggerUrl; break } catch {}
      await new Promise(resolve => setTimeout(resolve, 250))
    }
    assert(endpoint, 'Portable wrapper did not start an inspectable Electron app within 30 seconds')
    browser = await chromium.connectOverCDP(endpoint)
    const page = browser.contexts()[0].pages().find(page => !page.url().endsWith('floating-ball.html'))
    await page.waitForFunction(() => window.animeLogDesktop && document.querySelector('.sticky-note'))
    const state = await page.evaluate(async () => ({ base: window.animeLogConfig.apiBaseUrl,
      visible: await window.animeLogDesktop.getVisibility(), fullViewLoaded: !!document.querySelector('.app-shell') }))
    assert.equal(state.base, 'anime-log://local/api')
    assert.equal(state.visible, false)
    assert.equal(state.fullViewLoaded, false)
    assert(fs.existsSync(path.join(dir, 'anime-log.db')))
    await page.evaluate(() => window.close())
    console.log('Outer portable EXE starts, forwards --autostart, keeps main hidden and creates only isolated SQLite data.')
  } finally {
    if (browser) await browser.close().catch(() => {})
    if (child.exitCode === null) {
      await Promise.race([new Promise(resolve => child.once('exit', resolve)), new Promise(resolve => setTimeout(resolve, 3000))])
    }
    if (child.exitCode === null) {
      try { execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }) } catch {}
    }
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 })
  }
})().catch(error => { console.error(error); process.exitCode = 1 })
