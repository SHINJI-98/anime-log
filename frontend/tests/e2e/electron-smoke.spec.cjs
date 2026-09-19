const { test, expect, _electron: electron } = require('@playwright/test')
const fs = require('fs')
const http = require('http')
const os = require('os')
const path = require('path')

test('desktop app supports tracking, sticky mode and notes without Java or an HTTP backend', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'anime-log-e2e-'))
  const fakeYuc = await startFakeYucWiki()
  const fakeBangumi = await startFakeBangumi()
  let electronApp

  try {
    electronApp = await electron.launch({
      args: ['.'],
      cwd: path.resolve(__dirname, '..', '..'),
      env: {
        ...withoutJavaPath(),
        ANIME_LOG_LOAD_DIST: '1',
        ANIME_LOG_USER_DATA_DIR: userDataDir,
        ANIME_LOG_MIGRATION_DB: path.join(userDataDir, 'missing-source.db'),
        ANIME_LOG_YUC_BASE_URL: fakeYuc.baseUrl,
        ANIME_LOG_BANGUMI_BASE_URL: fakeBangumi.baseUrl
      }
    })

    const page = await electronApp.firstWindow()
    await expect(page.locator('[data-testid="watchlist-view"]')).toBeVisible()

    const apiBaseUrl = await page.evaluate(() => window.animeLogConfig.apiBaseUrl)
    expect(apiBaseUrl).toBe('anime-log://local/api')

    await page.locator('[data-testid="discover-tab"]').click()
    await expect(page.locator('[data-testid="discover-view"]')).toBeVisible()

    await page.locator('[data-testid="refresh-season"]').click()
    await expect(page.locator('[data-testid="schedule-item"]').first()).toContainText('E2E Anime')

    const search = page.locator('[data-testid="anime-search"]')
    await page.keyboard.press('Control+F')
    await expect(search).toBeFocused()
    await search.fill('missing')
    await expect(page.locator('[data-testid="schedule-item"]')).toHaveCount(0)
    await search.fill('E2E')
    await expect(page.locator('[data-testid="schedule-item"]')).toHaveCount(1)

    await page.locator('[data-testid="follow-anime"]').first().click()
    await expect(page.locator('[data-testid="watch-record-card"]')).toContainText('E2E Anime')
    await page.locator('[data-testid="open-broadcast-binding"]').click()
    await expect(page.getByRole('dialog', { name: '关联 Bangumi' })).toBeVisible()
    await expect(page.locator('[data-testid="bind-bangumi-candidate"]')).toHaveCount(1)
    await page.locator('[data-testid="bind-bangumi-candidate"]').click()
    await expect(page.locator('[data-testid="broadcast-status"]')).toContainText('按排期预计已播至第 1 集')
    await expect(page.locator('[data-testid="broadcast-status"]')).toContainText('今日预计播出第 2 集')
    await expect(page.locator('[data-testid="watchlist-view"] .day-section')).toHaveCount(1)
    await page.locator('.clickable-poster').first().click()
    await expect(page.locator('.poster-modal')).toBeVisible()
    await page.getByRole('button', { name: '关闭大图' }).click()

    await page.locator('[data-testid="discover-tab"]').click()
    await expect(page.locator('[data-testid="follow-anime"]').first()).toHaveText('已追番')
    await expect(page.locator('[data-testid="follow-anime"]').first()).toBeDisabled()
    await page.locator('[data-testid="watchlist-tab"]').click()

    const progress = page.locator('[data-testid="progress-input"]').first()
    await progress.fill('3')
    await progress.blur()
    await expect(progress).toHaveValue('3')

    await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.getTitle() === '我的追番').maximize())
    await expect.poll(() => electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.getTitle() === '我的追番').isMaximized())).toBe(true)
    await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.getTitle() === '我的追番').unmaximize())
    await expect.poll(() => electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.getTitle() === '我的追番').isMaximized())).toBe(false)
    const originalWidth = await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.getTitle() !== '我的追番 · 悬浮球').getNormalBounds().width)
    await page.getByRole('button', { name: '桌面便签', exact: true }).click()
    await hoverBall(electronApp)
    await expect(page.locator('.sticky-note')).toBeVisible()
    await expect(page.locator('.weekday-column')).toHaveCount(7)
    await expect(page.locator('.today-ribbon')).toHaveCount(1)
    await expect(page.locator('.weekday-column').first()).toContainText('E2E Anime')
    await expect(page.locator('.sticky-note li')).toContainText('已看 3 /')
    const nativePinned = await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.getTitle() !== '我的追番 · 悬浮球').isAlwaysOnTop())
    await expect(page.locator('.sticky-tools button').first()).toHaveAttribute('aria-pressed', String(nativePinned))
    await page.getByRole('button', { name: 'E2E Anime 已看加一集' }).click()
    await expect(page.locator('.sticky-note li')).toContainText('已看 4 /')
    await page.getByRole('button', { name: '撤销', exact: true }).click()
    await expect(page.locator('.sticky-note li')).toContainText('已看 3 /')
    await page.evaluate(() => {
      const original = window.fetch
      window.fetch = async (...args) => {
        if (args[1]?.method === 'PATCH') {
          window.fetch = original
          return new Response(JSON.stringify({ message: '测试：磁盘写入失败' }), { status: 500 })
        }
        return original(...args)
      }
    })
    await page.getByRole('button', { name: 'E2E Anime 已看加一集' }).click()
    await expect(page.locator('.sticky-note [role="alert"]')).toContainText('操作失败')
    await expect(page.locator('.sticky-note li')).toContainText('已看 3 /')
    await page.getByRole('button', { name: 'E2E Anime 已看加一集' }).click()
    await expect(page.locator('.sticky-note li')).toContainText('已看 4 /')
    await page.getByRole('button', { name: '今天', exact: true }).click()
    await expect(page.locator('.weekday-column')).toHaveCount(1)
    await page.getByRole('button', { name: '本周', exact: true }).click()
    if (nativePinned) {
      await page.getByRole('button', { name: '取消置顶', exact: true }).click()
      await expect.poll(() => electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.getTitle() !== '我的追番 · 悬浮球').isAlwaysOnTop())).toBe(false)
    }
    await page.reload()
    await expect(page.locator('.sticky-note')).toBeVisible()
    await page.getByRole('button', { name: '完整界面 ↗' }).click()
    const restoredWidth = await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.getTitle() !== '我的追番 · 悬浮球').getBounds().width)
    // Windows display scaling may round native window bounds by a few pixels.
    expect(Math.abs(restoredWidth - originalWidth)).toBeLessThanOrEqual(4)
    await expect(progress).toHaveValue('4')
    await progress.fill('3')
    await progress.blur()

    await page.locator('[data-testid="record-status-select"]').selectOption('completed')
    await page.locator('[data-testid="status-completed"]').click()
    await expect(page.locator('[data-testid="watch-record-card"]')).toContainText('E2E Anime')

    await page.locator('[data-testid="open-notes"]').first().click()
    await expect(page.locator('[data-testid="notes-view"]')).toBeVisible()

    await page.locator('[data-testid="summary-editor"]').fill('Great desktop summary')
    await page.locator('[data-testid="save-summary"]').click()

    await page.locator('[data-testid="episode-number-input"]').fill('4')
    await page.locator('[data-testid="new-episode-editor"]').fill('Episode three note')
    await page.locator('[data-testid="add-episode-note"]').click()
    await expect(page.locator('[data-testid="episode-note"]')).toContainText('第 4 集')

    const records = await readApi(page, `${apiBaseUrl}/watch-records?status=completed`)
    expect(records).toHaveLength(1)
    expect(records[0].watchedEpisodes).toBe(3)

    const notes = await readApi(page, `${apiBaseUrl}/anime/${records[0].anime.id}/notes`)
    expect(notes.summary.content).toContain('Great desktop summary')
    expect(notes.episodeNotes[0].content).toContain('Episode three note')

    await page.locator('[data-testid="summary-editor"]').fill('Unsaved draft survives desktop mode')
    const savedScroll = await page.evaluate(() => { window.scrollTo(0, 300); return window.scrollY })
    await page.evaluate(() => window.animeLogDesktop.setCompact(true))
    await hoverBall(electronApp)
    await page.getByRole('button', { name: '完整界面 ↗' }).click()
    await expect(page.locator('[data-testid="notes-view"]')).toBeVisible()
    await expect(page.locator('[data-testid="summary-editor"]')).toContainText('Unsaved draft survives desktop mode')
    await expect.poll(async () => Math.abs(await page.evaluate(() => window.scrollY) - savedScroll)).toBeLessThanOrEqual(5)

    expect(fs.existsSync(path.join(userDataDir, 'anime-log.db'))).toBe(true)
  } finally {
    if (electronApp) {
      await electronApp.close()
    }
    await fakeYuc.close()
    await fakeBangumi.close()
    fs.rmSync(userDataDir, { recursive: true, force: true })
  }
})

test('desktop app can relaunch immediately after closing', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'anime-log-relaunch-e2e-'))
  const fakeYuc = await startFakeYucWiki()
  let electronApp

  const launchApp = async () => {
    const app = await electron.launch({
      args: ['.'],
      cwd: path.resolve(__dirname, '..', '..'),
      env: {
        ...withoutJavaPath(),
        ANIME_LOG_LOAD_DIST: '1',
        ANIME_LOG_USER_DATA_DIR: userDataDir,
        ANIME_LOG_MIGRATION_DB: path.join(userDataDir, 'missing-source.db'),
        ANIME_LOG_YUC_BASE_URL: fakeYuc.baseUrl
      }
    })
    const page = await app.firstWindow()
    await expect(page.locator('[data-testid="watchlist-view"]')).toBeVisible()
    return app
  }

  try {
    electronApp = await launchApp()
    let page = await electronApp.firstWindow()
    await page.locator('[data-testid="discover-tab"]').click()
    await page.locator('[data-testid="follow-anime"]').first().click()
    const progress = page.locator('[data-testid="progress-input"]').first()
    await progress.fill('5')
    await progress.blur()
    await expect.poll(async () => (await readApi(page, 'anime-log://local/api/watch-records'))[0]?.watchedEpisodes).toBe(5)
    await electronApp.close()
    electronApp = null

    electronApp = await launchApp()
    page = await electronApp.firstWindow()
    await expect(page.locator('[data-testid="progress-input"]').first()).toHaveValue('5')
  } finally {
    if (electronApp) {
      await electronApp.close()
    }
    await fakeYuc.close()
    fs.rmSync(userDataDir, { recursive: true, force: true })
  }
})

function withoutJavaPath() {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toLowerCase() !== 'path' && key !== 'JAVA_HOME'))
  return { ...env, PATH: process.env.SystemRoot || 'C:\\Windows', ANIME_LOG_DISABLE_FULLSCREEN: '1' }
}

test('floating hover, tray close, restore and persisted quit setting', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anime-desktop-behavior-'))
  let app
  const launch = () => electron.launch({ args: ['.'], cwd: path.resolve(__dirname, '../..'), env: {
    ...withoutJavaPath(), ANIME_LOG_LOAD_DIST: '1', ANIME_LOG_USER_DATA_DIR: dir,
    ANIME_LOG_MIGRATION_DB: path.join(dir, 'missing.db')
  } })
  try {
    app = await launch()
    let page = await app.firstWindow()
    await expect(page.locator('[data-testid="watchlist-view"]')).toBeVisible()
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor)).toBe('rgb(14, 15, 17)')
    await page.getByRole('button', { name: '桌面便签', exact: true }).click()
    await hoverBall(app)
    const pane = app.windows().find(window => window.url().endsWith('floating-ball.html'))
    await expect(pane.locator('.floating-icon')).toHaveAttribute('alt', '我的追番')
    await expect.poll(() => pane.locator('.floating-icon').evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true)
    expect(await pane.locator('.floating-icon').evaluate(element => Number(getComputedStyle(element).opacity))).toBeLessThan(1)
    await pane.screenshot({ path: path.resolve(__dirname, '../../test-results/floating-icon.png'), omitBackground: true })
    await expect(page.locator('.weekday-column')).toHaveCount(7)
    await app.evaluate(() => { globalThis.testCursor = { x: -10000, y: -10000 } })
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.getTitle() !== '我的追番 · 悬浮球').isVisible())).toBe(false)
    await hoverBall(app)
    // Clicking keeps the panel open outside its bounds; Escape dismisses it.
    await app.evaluate(({ BrowserWindow, ipcMain }) => {
      const ball = BrowserWindow.getAllWindows().find(w => w.getTitle() === '我的追番 · 悬浮球')
      ipcMain.emit('anime-log-ball', { sender: ball.webContents }, { action: 'click' })
      globalThis.testCursor = { x: -10000, y: -10000 }
    })
    await page.waitForTimeout(800)
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.getTitle() !== '我的追番 · 悬浮球').isVisible())).toBe(true)
    await page.keyboard.press('Escape')
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.getTitle() !== '我的追番 · 悬浮球').isVisible())).toBe(false)
    await hoverBall(app)
    await page.getByRole('button', { name: '设置', exact: true }).click()
    await app.evaluate(() => { globalThis.testCursor = { x: -10000, y: -10000 } })
    await page.waitForTimeout(800)
    await expect(page.locator('dialog')).toBeVisible()
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.getTitle() !== '我的追番 · 悬浮球').isVisible())).toBe(true)
    await page.getByRole('button', { name: '关闭设置' }).click()
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.getTitle() !== '我的追番 · 悬浮球').close())
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().every(w => !w.isVisible()))).toBe(true)
    // A second launch uses the same restore action as the tray menu.
    await app.evaluate(({ app }) => app.emit('second-instance'))
    await expect(page.locator('[data-testid="watchlist-view"]')).toBeVisible()
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.getTitle() !== '我的追番 · 悬浮球').isVisible())).toBe(true)
    await page.getByRole('button', { name: '设置', exact: true }).click()
    await expect(page.locator('#close-action')).toHaveValue('tray')
    await page.locator('#close-action').selectOption('quit')
    await page.getByRole('button', { name: '保存设置' }).click()
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'desktop-settings.json'))).closeAction).toBe('quit')
    await app.close()
    app = await launch()
    page = await app.firstWindow()
    await page.getByRole('button', { name: '设置', exact: true }).click()
    await expect(page.locator('#close-action')).toHaveValue('quit')
    await page.getByRole('button', { name: '关闭设置' }).click()
    const closed = app.waitForEvent('close')
    await app.evaluate(({ BrowserWindow }) => { setTimeout(() => BrowserWindow.getAllWindows()[0].close(), 50) })
    await closed
    app = null
  } finally {
    if (app) await app.close()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

async function readApi(page, url) {
  return page.evaluate(async (targetUrl) => {
    const response = await fetch(targetUrl)
    if (!response.ok) {
      throw new Error(`API request failed with ${response.status}`)
    }
    return response.json()
  }, url)
}

test('ball drag persists, locked position stays fixed and display removal recovers', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anime-position-'))
  let app
  const launch = () => electron.launch({ args: ['.'], cwd: path.resolve(__dirname, '../..'), env: {
    ...withoutJavaPath(), ANIME_LOG_LOAD_DIST: '1', ANIME_LOG_USER_DATA_DIR: dir,
    ANIME_LOG_MIGRATION_DB: path.join(dir, 'missing.db')
  } })
  try {
    app = await launch()
    app.process().stderr.resume()
    let page = await app.firstWindow()
    await expect(page.locator('[data-testid="watchlist-view"]')).toBeVisible()
    await page.getByRole('button', { name: '桌面便签', exact: true }).click()
    await hoverBall(app)
    const result = await app.evaluate(({ BrowserWindow, ipcMain, screen }) => {
      const b = BrowserWindow.getAllWindows().find(w => w.getTitle() === '我的追番 · 悬浮球')
      const event = { sender: b.webContents }
      const old = b.getBounds()
      const sizes = []
      ipcMain.emit('anime-log-ball', event, { action: 'down' })
      for (let step = 1; step <= 120; step++) {
        ipcMain.emit('anime-log-ball', event, { action: 'drag', dx: -step, dy: -Math.round(step * .75) })
        sizes.push(b.getSize())
      }
      ipcMain.emit('anime-log-ball', event, { action: 'drop' })
      globalThis.testCursor = { x: -10000, y: -10000 }
      return { old, sizes, next: b.getBounds(), area: screen.getDisplayMatching(b.getBounds()).workArea }
    })
    expect(result.next.x).not.toBe(result.old.x)
    // Fractional Windows DPI can round bounds by a few DIP, but must not
    // accumulate that rounding on every pointer movement.
    for (const size of [...result.sizes, [result.next.width, result.next.height]]) {
      for (const dimension of size) expect(Math.abs(dimension - 64)).toBeLessThanOrEqual(4)
    }
    const saved = JSON.parse(fs.readFileSync(path.join(dir, 'desktop-settings.json')))
    expect(saved.position.displayId).toBeDefined()
    await app.close()
    app = await launch()
    page = await app.firstWindow()
    await hoverBall(app)
    const restored = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.getTitle() === '我的追番 · 悬浮球').getBounds())
    expect(Math.abs(restored.x - result.next.x)).toBeLessThanOrEqual(5)
    await page.evaluate(async () => {
      const s = await window.animeLogDesktop.getSettings()
      await window.animeLogDesktop.saveSettings({ ...s, lockPosition: true })
    })
    const locked = await app.evaluate(({ BrowserWindow, ipcMain, screen }) => {
      const b = BrowserWindow.getAllWindows().find(w => w.getTitle() === '我的追番 · 悬浮球')
      const event = { sender: b.webContents }
      ipcMain.emit('anime-log-ball', event, { action: 'down' })
      ipcMain.emit('anime-log-ball', event, { action: 'drag', dx: 200, dy: 200 })
      ipcMain.emit('anime-log-ball', event, { action: 'drop' })
      const bounds = b.getBounds()
      b.setPosition(-20000, -20000)
      screen.emit('display-removed', {}, { id: 999 })
      return { bounds, recovered: b.getBounds(), area: screen.getDisplayMatching(b.getBounds()).workArea }
    })
    expect(locked.bounds).toEqual(restored)
    expect(locked.recovered.x).toBeGreaterThanOrEqual(locked.area.x)
    expect(locked.recovered.y).toBeGreaterThanOrEqual(locked.area.y)
    expect(locked.recovered.x + locked.recovered.width).toBeLessThanOrEqual(locked.area.x + locked.area.width)
    expect(locked.recovered.y + locked.recovered.height).toBeLessThanOrEqual(locked.area.y + locked.area.height)
  } finally {
    if (app) await app.close()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('quarter sidebar handles rapid navigation and persists theme choices', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anime-sidebar-'))
  const fake = await startFakeYucWiki()
  let app
  try {
    app = await electron.launch({ args: ['.'], cwd: path.resolve(__dirname, '../..'), env: {
      ...withoutJavaPath(), ANIME_LOG_LOAD_DIST: '1', ANIME_LOG_USER_DATA_DIR: dir,
      ANIME_LOG_MIGRATION_DB: path.join(dir, 'missing.db'), ANIME_LOG_YUC_BASE_URL: fake.baseUrl
    } })
    const page = await app.firstWindow()
    await expect(page.locator('[data-testid="watchlist-view"]')).toBeVisible()
    await page.evaluate(() => {
      const original = window.fetch
      window.fetch = async (...args) => {
        const url = new URL(args[0])
        const season = url.searchParams.get('season')
        if (url.pathname === '/api/anime' && season?.startsWith('2024')) {
          await new Promise(resolve => setTimeout(resolve, season === '202401' ? 500 : 20))
          return new Response(JSON.stringify([{ id: season, title: `Season ${season}`, airDay: '周一 (月)' }]), { headers: { 'Content-Type': 'application/json' } })
        }
        return original(...args)
      }
    })
    await page.getByLabel('季度年份').selectOption('2024')
    await page.getByTestId('season-202401').click()
    await page.getByTestId('season-202404').click()
    await expect(page.getByTestId('schedule-item')).toContainText('Season 202404')
    await page.waitForTimeout(600)
    await expect(page.getByTestId('schedule-item')).toContainText('Season 202404')
    await expect(page.getByTestId('season-202404')).toHaveAttribute('aria-current', 'page')
    for (const theme of ['ocean', 'forest', 'paper']) {
      await page.getByLabel('界面配色').selectOption(theme)
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
    }
    await page.screenshot({ path: path.resolve(__dirname, '../../test-results/sidebar-paper.png') })
    await page.reload()
    await expect(page.getByLabel('界面配色')).toHaveValue('paper')
    await page.getByLabel('界面配色').selectOption('graphite')
    await page.setViewportSize({ width: 680, height: 850 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.screenshot({ path: path.resolve(__dirname, '../../test-results/sidebar-narrow.png') })
  } finally {
    if (app) await app.close()
    await fake.close()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

function startFakeYucWiki() {
  const server = http.createServer((request, response) => {
    if (request.url.endsWith('/poster.jpg')) {
      response.writeHead(200, { 'Content-Type': 'image/jpeg' })
      response.end(Buffer.from([0xff, 0xd8, 0xff, 0xd9]))
      return
    }

    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    response.end(`<!doctype html>
      <html>
        <body>
          <div class="date2">周一</div>
          <div class="main_box">
            <div class="div_date">
              <img src="/poster.jpg" />
              <p class="imgtext">22:00 全12话</p>
            </div>
            <table>
              <tr><td class="date_title">E2E Anime</td></tr>
            </table>
          </div>
        </body>
      </html>`)
  })

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port
      resolve({
        baseUrl: `http://127.0.0.1:${port}`,
        close: () => new Promise((closeResolve) => server.close(closeResolve))
      })
    })
  })
}

function startFakeBangumi() {
  const today = chinaDateOffset(0)
  const yesterday = chinaDateOffset(-1)
  const tomorrow = chinaDateOffset(1)
  const server = http.createServer((request, response) => {
    response.setHeader('Content-Type', 'application/json; charset=utf-8')
    if (request.url.startsWith('/v0/search/subjects')) {
      response.end(JSON.stringify({ data: [{ id: 321, type: 2, name: 'E2E Anime', name_cn: '端到端动画', date: yesterday, images: {} }] }))
      return
    }
    if (request.url === '/v0/subjects/321') {
      response.end(JSON.stringify({ id: 321, type: 2, name: 'E2E Anime', name_cn: '端到端动画', date: yesterday, images: {} }))
      return
    }
    if (request.url.startsWith('/v0/episodes')) {
      response.end(JSON.stringify({ total: 3, data: [
        { id: 8001, type: 0, ep: 1, sort: 1, name: '', name_cn: '', airdate: yesterday },
        { id: 8002, type: 0, ep: 2, sort: 2, name: '', name_cn: '', airdate: today },
        { id: 8003, type: 0, ep: 3, sort: 3, name: '', name_cn: '', airdate: tomorrow }
      ] }))
      return
    }
    response.writeHead(404)
    response.end(JSON.stringify({ message: 'not found' }))
  })
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise(closeResolve => server.close(closeResolve))
  })))
}

function chinaDateOffset(days) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date())
  const get = type => Number(parts.find(part => part.type === type).value)
  const date = new Date(Date.UTC(get('year'), get('month') - 1, get('day') + days))
  return date.toISOString().slice(0, 10)
}

// Drive the native hover poll deterministically; Playwright's DOM mouse does not
// move the Windows system cursor in every desktop test environment.
async function hoverBall(app) {
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some(w => w.getTitle() === '我的追番 · 悬浮球'))).toBe(true)
  await app.evaluate(({ BrowserWindow, screen }) => {
    const bounds = BrowserWindow.getAllWindows().find(w => w.getTitle() === '我的追番 · 悬浮球').getBounds()
    globalThis.testCursor = { x: bounds.x + 30, y: bounds.y + 30 }
    screen.getCursorScreenPoint = () => globalThis.testCursor
  })
  await expect.poll(async () => {
    try { return await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.getTitle() !== '我的追番 · 悬浮球').isVisible()) }
    catch (error) {
      if (error.message.includes('Execution context was destroyed')) return false
      throw error
    }
  }).toBe(true)
  await app.evaluate(({ BrowserWindow }) => {
    const b = BrowserWindow.getAllWindows().find(w => w.getTitle() !== '我的追番 · 悬浮球').getBounds()
    globalThis.testCursor = { x: b.x + 50, y: b.y + 50 }
  })
}
