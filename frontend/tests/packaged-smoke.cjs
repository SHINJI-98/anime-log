const { _electron } = require('@playwright/test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const net = require('node:net')
const http = require('node:http')
const asar = require('@electron/asar')

async function main() {
  const root = path.resolve(__dirname, '..')
  const output = path.join(root, 'release/win-unpacked')
  const files = asar.listPackage(path.join(output, 'resources/app.asar'))
  assert(files.some(file => file.endsWith('sql-wasm.wasm')))
  assert(files.some(file => file.endsWith('app-icon.png')))
  assert(files.some(file => file.endsWith('anilist-client.cjs')))
  assert(files.some(file => file.endsWith('anilist-chinese.json')))
  assert(files.some(file => file.endsWith('bangumi-data-names.json')))
  assert(files.some(file => file.endsWith('anime-names.cjs')))
  assert(!files.some(file => file.endsWith('bangumi-client.cjs')))
  assert(!files.some(file => /\.jar$|\.db$|node_modules[\\/]vite[\\/]/.test(file)))
  assert(!fs.existsSync(path.join(output, 'resources/backend')))
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anime-packaged-'))
  const blocker = net.createServer()
  await new Promise((resolve, reject) => {
    blocker.once('error', error => error.code === 'EADDRINUSE' ? resolve() : reject(error))
    blocker.listen(8080, '127.0.0.1', resolve)
  })
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toLowerCase() !== 'path' && key !== 'JAVA_HOME'))
  const fakeAniList = http.createServer(async (request, response) => {
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    const { variables } = JSON.parse(Buffer.concat(chunks).toString())
    response.setHeader('Content-Type', 'application/json')
    response.end(JSON.stringify({ data: { Page: { media: variables.ids?.includes(197754)
      ? [{ id: 197754, type: 'ANIME', title: { native: 'LIAR GAME' }, startDate: { year: 2026, month: 4, day: 7 } }] : [] } } }))
  })
  await new Promise(resolve => fakeAniList.listen(0, '127.0.0.1', resolve))
  let app
  try {
    app = await _electron.launch({ executablePath: path.join(output, 'Anime Log.exe'), env: {
      ...env, PATH: process.env.SystemRoot || 'C:\\Windows', ANIME_LOG_USER_DATA_DIR: dir, ANIME_LOG_NAME_CATALOG_UPDATES: '0',
      ANIME_LOG_ANILIST_URL: `http://127.0.0.1:${fakeAniList.address().port}`
    } })
    const page = await app.firstWindow()
    await page.locator('[data-testid="watchlist-view"]').waitFor()
    const result = await page.evaluate(async () => ({
      base: window.animeLogConfig.apiBaseUrl,
      records: await (await fetch(window.animeLogConfig.apiBaseUrl + '/watch-records')).json()
    }))
    assert.equal(result.base, 'anime-log://local/api')
    assert.deepEqual(result.records, [])
    const candidates = await page.evaluate(async () => (await fetch(window.animeLogConfig.apiBaseUrl + '/anime/search?keyword=' + encodeURIComponent('欺诈游戏'))).json())
    assert.equal(candidates.length, 1)
    assert.equal(candidates[0].id, 197754)
    assert.equal(candidates[0].name, 'LIAR GAME')
    assert.equal(candidates[0].displayName, '欺诈游戏')
    assert.equal(candidates[0].metadataUnavailable, undefined)
    await page.getByRole('button', { name: '设置', exact: true }).click()
    const startup = page.getByRole('checkbox', { name: '开机自启动' })
    await startup.waitFor()
    assert.equal(await startup.isEnabled(), true)
    await page.getByRole('button', { name: '关闭设置' }).click()
    const floatingWindow = app.waitForEvent('window')
    await page.getByRole('button', { name: '桌面便签', exact: true }).click()
    await page.locator('.sticky-note').waitFor()
    const ballPage = await floatingWindow
    await ballPage.waitForLoadState()
    await ballPage.waitForFunction(() => document.querySelector('.floating-icon')?.naturalWidth > 0)
    // Appearance tests must not read or modify this user's real startup entry.
    await app.evaluate(({ app }) => { app.getLoginItemSettings = () => ({ launchItems: [] }) })
    for (const size of [48, 80, 64]) {
      await page.evaluate(async ballSize => {
        const settings = await window.animeLogDesktop.getSettings()
        await window.animeLogDesktop.saveSettings({ ...settings, autoLaunch: false, ballSize })
      }, size)
      const sizes = await app.evaluate(({ BrowserWindow, ipcMain }) => {
        const ball = BrowserWindow.getAllWindows().find(w => w.getTitle() === '我的追番 · 悬浮球')
        const event = { sender: ball.webContents }
        const sizes = []
        ipcMain.emit('anime-log-ball', event, { action: 'down' })
        for (let step = 1; step <= 120; step++) {
          ipcMain.emit('anime-log-ball', event, { action: 'drag', dx: -step, dy: step % 30 })
          sizes.push(ball.getSize())
        }
        ipcMain.emit('anime-log-ball', event, { action: 'drop' })
        sizes.push(ball.getSize())
        return sizes
      })
      for (const bounds of sizes) for (const dimension of bounds) {
        assert(Math.abs(dimension - size) <= 4, `Ball grew while dragging: ${dimension}, configured ${size}`)
      }
    }
    await app.evaluate(({ BrowserWindow, screen }) => {
      const bounds = BrowserWindow.getAllWindows().find(w => w.getTitle() === '我的追番 · 悬浮球').getBounds()
      screen.getCursorScreenPoint = () => ({ x: bounds.x + 30, y: bounds.y + 30 })
    })
    await page.getByRole('button', { name: '完整界面 ↗' }).click()
    await page.locator('[data-testid="watchlist-view"]').waitFor()
    assert(fs.existsSync(path.join(dir, 'anime-log.db')))
    console.log('Packaged app starts without Java on PATH, works while port 8080 is unavailable, and supports sticky mode.')
  } finally {
    if (app) await app.close()
    if (blocker.listening) await new Promise(resolve => blocker.close(resolve))
    await new Promise(resolve => fakeAniList.close(resolve))
    fs.rmSync(dir, { recursive: true, force: true })
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
