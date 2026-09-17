const { _electron } = require('@playwright/test')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
;(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anime-perf-'))
  let app
  const samples = []
  const latencies = []
  const output = process.env.ANIME_LOG_PERF_OUTPUT || 'test-results/performance.json'
  const persist = complete => {
    fs.mkdirSync(path.dirname(output), { recursive: true })
    fs.writeFileSync(output, JSON.stringify({ complete, fixture: 'empty isolated SQLite; native detector runs with its display mapping moved offscreen to avoid unrelated fullscreen applications; image workload unmeasured', samples,
      openPaintLatencyMs: latencies.length ? { mean: latencies.reduce((a, b) => a + b, 0) / latencies.length, max: Math.max(...latencies) } : null }, null, 2))
  }
  try {
    app = await _electron.launch({ executablePath: path.resolve(process.env.ANIME_LOG_PERF_EXE || 'release/win-unpacked/Anime Log.exe'), env: {
      ...process.env, ANIME_LOG_USER_DATA_DIR: dir
    } })
    const page = await app.firstWindow()
    await page.locator('.app-shell').waitFor()
    await page.addInitScript(() => {
      const intervals = new Set()
      const nativeSet = window.setInterval
      const nativeClear = window.clearInterval
      window.setInterval = (...args) => { const id = nativeSet(...args); intervals.add(id); return id }
      window.clearInterval = id => { intervals.delete(id); nativeClear(id) }
      window.__intervalCount = () => intervals.size
    })
    await page.reload()
    await page.locator('.app-shell').waitFor()
    const cdp = await page.context().newCDPSession(page)
    // Keep unrelated fullscreen applications from altering the benchmark mode;
    // the native detector still runs, and its process is measured separately.
    await app.evaluate(({ screen }) => { screen.screenToDipRect = (_window, bounds) => ({ ...bounds, x: -100000 }) })
    async function sample(mode) {
      const metrics = await app.evaluate(({ app }) => app.getAppMetrics().map(p => ({ type: p.type, cpu: p.cpu.percentCPUUsage, memoryKB: p.memory.workingSetSize })))
      const dom = await page.evaluate(async () => ({ nodes: document.querySelectorAll('*').length, images: performance.getEntriesByType('resource').filter(r => r.initiatorType === 'img').length, intervals: window.__intervalCount() }))
      const visible = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.getTitle() !== '我的追番 · 悬浮球').isVisible())
      const heap = await cdp.send('Runtime.getHeapUsage')
      const helper = await app.evaluate(() => {
        try { return process.mainModule.require('./fullscreen-monitor.cjs').getMetrics() }
        catch { return { memoryKB: 0, cpuSeconds: 0 } }
      })
      const row = { time: new Date().toISOString(), mode, visible, cpu: metrics.reduce((n, p) => n + p.cpu, 0), memoryKB: metrics.reduce((n, p) => n + p.memoryKB, 0), helper, processes: metrics.length, heapBytes: heap.usedSize, ...dom }
      samples.push(row)
      persist(false)
      console.log(JSON.stringify(row))
    }
    await page.evaluate(() => window.animeLogDesktop.setCompact(true))
    await app.evaluate(({ screen }) => { screen.getCursorScreenPoint = () => ({ x: -10000, y: -10000 }) })
    await delay(3000)
    await sample('ball')
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.getTitle() !== '我的追番 · 悬浮球').close())
    await delay(3000)
    await sample('tray')
    await page.evaluate(() => window.animeLogDesktop.setCompact(true))
    async function toggle(action) {
      await app.evaluate(({ BrowserWindow, ipcMain }, action) => {
        const ball = BrowserWindow.getAllWindows().find(w => w.getTitle() === '我的追番 · 悬浮球')
        const main = BrowserWindow.getAllWindows().find(w => w !== ball)
        if (action === 'show') ipcMain.emit('anime-log-ball', { sender: ball.webContents }, { action: 'click' })
        else ipcMain.emit('anime-log-panel-action', { sender: main.webContents }, 'dismiss')
      }, action)
    }
    await toggle('show')
    await delay(3000)
    await sample('panel-before-cycles')
    for (let i = 0; i < 100; i++) {
      await toggle('hide')
      const start = performance.now()
      await toggle('show')
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
      latencies.push(performance.now() - start)
    }
    await delay(3000)
    await sample('panel-after-100-cycles')
    const minutes = Number(process.env.ANIME_LOG_SOAK_MINUTES || 0)
    for (let minute = 0; minute < minutes; minute++) {
      await delay(30000)
      console.log(`soak minute ${minute + 1}: halfway`)
      await delay(30000)
      await sample(`soak-${minute + 1}`)
    }
    persist(true)
  } finally {
    if (app) await app.close()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})().catch(error => { console.error(error); process.exitCode = 1 })
