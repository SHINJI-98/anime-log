const { _electron } = require('@playwright/test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
;(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anime-image-perf-'))
  fs.writeFileSync(path.join(dir, 'desktop-settings.json'), JSON.stringify({ panelOpacity: .65 }))
  const total = 210
  const days = ['一', '二', '三', '四', '五', '六', '日']
  const html = Array.from({ length: total }, (_, i) => `<div class="date2">周${days[i % 7]}</div><div class="main_box"><div class="div_date"><img src="https://i0.hdslb.com/fixture-${i}.png"><p class="imgtext">22:00 全12话</p></div><div><table><tr><td class="date_title">周历测试 ${i + 1} · 长标题与封面展示</td></tr></table></div></div>`).join('')
  const server = http.createServer((_req, res) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(html) })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const png = fs.readFileSync('assets/app-icon.png')
  const output = path.resolve('release/validation')
  fs.mkdirSync(output, { recursive: true })
  let app
  try {
    app = await _electron.launch({ executablePath: path.resolve('release/win-unpacked/Anime Log.exe'), args: ['--autostart'], env: {
      ...process.env, ANIME_LOG_USER_DATA_DIR: dir, ANIME_LOG_DISABLE_FULLSCREEN: '1', ANIME_LOG_YUC_BASE_URL: `http://127.0.0.1:${server.address().port}`
    } })
    const page = await app.firstWindow()
    await page.locator('.sticky-note').waitFor({ state: 'attached' })
    await page.evaluate(async () => {
      const base = window.animeLogConfig.apiBaseUrl
      const current = await (await fetch(base + '/seasons/current')).json()
      const anime = await (await fetch(base + '/anime?season=' + current.season)).json()
      for (const item of anime) {
        const response = await fetch(base + '/watch-records', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ animeSourceId: item.id, status: 'watching', watchedEpisodes: 3 }) })
        if (!response.ok) throw new Error(await response.text())
      }
      await window.animeLogDesktop.setCompact(true)
    })
    const records = await page.evaluate(async () => (await fetch(window.animeLogConfig.apiBaseUrl + '/watch-records')).json())
    assert.equal(records.length, total)
    // Playwright routing does not intercept this native custom protocol. Replace
    // it inside this isolated test after seeding; retain the real saved records.
    await app.evaluate(({ protocol }, fixture) => {
      global.__imageRequests = 0
      protocol.unhandle('anime-log')
      protocol.handle('anime-log', request => {
        if (new URL(request.url).pathname === '/api/images/proxy') {
          global.__imageRequests++
          return new Response(Buffer.from(fixture.png, 'base64'), { headers: { 'Content-Type': 'image/png' } })
        }
        return new Response(JSON.stringify(fixture.records), { headers: { 'Content-Type': 'application/json' } })
      })
    }, { records, png: png.toString('base64') })
    const requestCount = () => app.evaluate(() => global.__imageRequests)
    await page.reload()
    await page.locator('.sticky-note').waitFor({ state: 'attached' })
    await app.evaluate(({ screen }) => { screen.getCursorScreenPoint = () => ({ x: -10000, y: -10000 }) })
    await pause(1000)
    const hiddenRequests = await requestCount()
    async function panel(action) {
      await app.evaluate(({ BrowserWindow, ipcMain }, action) => {
        const ball = BrowserWindow.getAllWindows().find(w => w.getTitle() === '我的追番 · 悬浮球')
        const main = BrowserWindow.getAllWindows().find(w => w !== ball)
        ipcMain.emit(action === 'show' ? 'anime-log-ball' : 'anime-log-panel-action', { sender: action === 'show' ? ball.webContents : main.webContents }, action === 'show' ? { action: 'click' } : 'dismiss')
      }, action)
    }
    await panel('show')
    await page.locator('.sticky-anime-card').first().waitFor()
    await page.waitForFunction(() => [...document.querySelectorAll('.sticky-cover img')].some(img => img.complete && img.naturalWidth > 0))
    await pause(1500)
    const firstOpenRequests = await requestCount()
    assert.equal(hiddenRequests, 0)
    assert(firstOpenRequests > 0 && firstOpenRequests < total)
    await page.screenshot({ path: path.join(output, 'week.png') })
    await app.evaluate(async ({ BrowserWindow, desktopCapturer }, target) => {
      const w = BrowserWindow.getAllWindows().find(w => w.getTitle() === '我的追番')
      const handle = w.getNativeWindowHandle().readBigUInt64LE().toString()
      const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 1600, height: 1000 } })
      const source = sources.find(source => source.id.startsWith('window:' + handle + ':'))
      if (source) process.mainModule.require('node:fs').writeFileSync(target, source.thumbnail.toPNG())
    }, path.join(output, 'native-week.png'))
    for (let i = 0; i < 5; i++) { await panel('hide'); await panel('show') }
    await pause(1000)
    const reopenedRequests = await requestCount()
    assert.equal(reopenedRequests, firstOpenRequests)
    await page.getByRole('button', { name: '今天', exact: true }).click()
    await page.locator('.today-view').waitFor()
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    await page.waitForFunction(() => {
      const visibleImages = [...document.querySelectorAll('.sticky-cover img')].filter(img => {
        const rect = img.getBoundingClientRect()
        return rect.top < innerHeight && rect.bottom > 0
      })
      return visibleImages.length > 0 && visibleImages.every(img => img.complete && img.naturalWidth > 0)
    })
    await page.screenshot({ path: path.join(output, 'today.png') })
    await page.getByRole('button', { name: '设置', exact: true }).click()
    await page.locator('dialog[open]').waitFor()
    await page.screenshot({ path: path.join(output, 'settings.png') })
    const result = { totalCards: total, fixtureImageBytes: png.length, hiddenRequests, firstOpenRequests, reopenedRequests,
      scope: 'Renderer lazy loading and retained DOM reuse. Intercepted local PNG fixture; not CDN latency or HTTP cache measurement.' }
    fs.writeFileSync(path.join(output, 'image-loading.json'), JSON.stringify(result, null, 2))
    console.log(JSON.stringify(result))
  } finally {
    if (app) await app.close()
    await new Promise(resolve => server.close(resolve))
    fs.rmSync(dir, { recursive: true, force: true })
  }
})().catch(error => { console.error(error); process.exitCode = 1 })
