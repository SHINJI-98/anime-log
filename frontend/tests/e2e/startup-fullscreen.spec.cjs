const { test, expect, _electron: electron } = require('@playwright/test')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { once } = require('node:events')
const root = path.resolve(__dirname, '../..')
const launch = (dir, args = []) => electron.launch({ args: ['.', ...args], cwd: root, env: {
  ...process.env, ANIME_LOG_LOAD_DIST: '1', ANIME_LOG_USER_DATA_DIR: dir, ANIME_LOG_MIGRATION_DB: path.join(dir, 'missing.db')
} })
test('automatic startup is quiet and does not replace the saved manual mode', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anime-quiet-'))
  let app
  try {
    for (const startupMode of ['ball', 'tray']) {
      fs.writeFileSync(path.join(dir, 'desktop-settings.json'), JSON.stringify({ mode: 'full', startupMode }))
      app = await launch(dir, ['--autostart'])
      const page = await app.firstWindow()
      await expect(page.locator('.sticky-note')).toBeAttached()
      await expect(page.locator('.app-shell')).toHaveCount(0)
      const state = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(w => ({ title: w.getTitle(), visible: w.isVisible(), focused: w.isFocused() })))
      expect(state.find(w => w.title === '我的追番').visible).toBe(false)
      expect(state.find(w => w.title === '我的追番 · 悬浮球').visible).toBe(startupMode === 'ball')
      expect(state.some(w => w.focused)).toBe(false)
      expect(JSON.parse(fs.readFileSync(path.join(dir, 'desktop-settings.json'))).mode).toBe('full')
      await app.close(); app = null
    }
    app = await launch(dir)
    const page = await app.firstWindow()
    await expect(page.locator('[data-testid="watchlist-view"]')).toBeVisible()
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.getTitle() === '我的追番').isVisible())).toBe(true)
  } finally {
    if (app) await app.close()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('background desktop-sized windows stay visible; foreground fullscreen hides and restores the widget', async () => {
  test.skip(process.platform !== 'win32', 'Windows native detector')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anime-native-fullscreen-'))
  let app, other
  try {
    app = await launch(dir)
    const page = await app.firstWindow()
    await expect(page.locator('[data-testid="watchlist-view"]')).toBeVisible()
    await page.evaluate(() => window.animeLogDesktop.setCompact(true))
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some(w => w.getTitle() === '我的追番 · 悬浮球' && w.isVisible()))).toBe(true)
    const saved = JSON.parse(fs.readFileSync(path.join(dir, 'desktop-settings.json')))
    // Use a native fixture process without a second Playwright inspector session.
    other = spawn(require('electron'), [path.join(root, 'tests/fixtures/fullscreen.cjs')], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] })
    await once(other, 'message')
    const command = async value => {
      const reply = once(other, 'message')
      other.send(value)
      await reply
    }
    await command('desktop')
    // Give the real one-second native scanner time to observe the background window.
    await page.waitForTimeout(2500)
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some(w => w.getTitle() === '我的追番 · 悬浮球' && w.isVisible())), { timeout: 15000 }).toBe(true)
    await command('fullscreen')
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().every(w => !w.isVisible())), { timeout: 15000 }).toBe(true)
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'desktop-settings.json')))).toEqual(saved)
    await command('desktop')
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some(w => w.getTitle() === '我的追番 · 悬浮球' && w.isVisible())), { timeout: 10000 }).toBe(true)
    expect(await page.evaluate(async () => (await window.animeLogDesktop.getSettings()).fullscreenError)).toBe('')
  } finally {
    if (other && other.exitCode === null) { const exited = once(other, 'exit'); other.kill(); await exited }
    if (app) await app.close()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
