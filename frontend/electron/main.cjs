const { app, BrowserWindow, dialog, ipcMain, protocol, nativeTheme, powerMonitor, Notification } = require('electron')
const path = require('path')
const { setupDesktop } = require('./desktop-windows.cjs')
nativeTheme.themeSource = 'dark'
const { createService } = require('./local-service.cjs')
const { createBroadcastScheduler } = require('./broadcast-scheduler.cjs')
if (process.env.ANIME_LOG_USER_DATA_DIR) app.setPath('userData', process.env.ANIME_LOG_USER_DATA_DIR)
protocol.registerSchemesAsPrivileged([{ scheme: 'anime-log', privileges: {
  standard: true, secure: true, supportFetchAPI: true, corsEnabled: true
} }])
let mainWindow
let service
let broadcastScheduler
const apiBaseUrl = 'anime-log://local/api'
let desktopWindows
ipcMain.handle('anime-log-reset-position', event => {
  if (event.sender === mainWindow?.webContents) desktopWindows.resetPosition()
})
ipcMain.handle('anime-log-visible', event => event.sender === mainWindow?.webContents && mainWindow.isVisible())

ipcMain.handle('anime-log-window-mode', (event, enabled) => {
  if (event.sender !== mainWindow?.webContents) return
  return desktopWindows.setCompact(enabled)
})
ipcMain.handle('anime-log-pin', (event, enabled) => {
  if (event.sender !== mainWindow?.webContents) return false
  mainWindow.setAlwaysOnTop(enabled === true)
  return mainWindow.isAlwaysOnTop()
})
ipcMain.handle('anime-log-settings', (event, value) => {
  if (event.sender !== mainWindow?.webContents) return
  if (value === undefined) return desktopWindows.getSettings()
  const result = desktopWindows.saveSettings(value)
  broadcastScheduler?.tick()
  return result
})

ipcMain.handle('anime-log-pin-state', event => {
  return !!mainWindow && event.sender === mainWindow.webContents && mainWindow.isAlwaysOnTop()
})

ipcMain.on('anime-log-config', (event) => {
  event.returnValue = {
    apiBaseUrl,
    compact: desktopWindows?.getCompact() === true,
    visible: mainWindow?.isVisible() === true
  }
})

function isDev() {
  return !app.isPackaged || process.env.ANIME_LOG_ELECTRON_DEV === '1'
}

function userDataPath() {
  return process.env.ANIME_LOG_USER_DATA_DIR || app.getPath('userData')
}

async function startLocalService() {
  service = await createService({
    filename: path.join(userDataPath(), 'anime-log.db'),
    migrationPath: process.env.ANIME_LOG_MIGRATION_DB || (isDev()
      ? path.resolve(__dirname, '../../backend/data/anime-log.db')
      : undefined),
    baseUrl: process.env.ANIME_LOG_YUC_BASE_URL || 'https://yuc.wiki',
    anilistUrl: process.env.ANIME_LOG_ANILIST_URL || 'https://graphql.anilist.co'
  })
  protocol.handle('anime-log', async request => {
    const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json; charset=utf-8' }
    try {
      const url = new URL(request.url)
      if (url.hostname !== 'local') return new Response(null, { status: 404, headers })
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: {
        ...headers, 'Access-Control-Allow-Methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
      } })
      if (url.pathname === '/api/images/proxy' && request.method === 'GET') {
        const image = await service.image(url.searchParams.get('url'))
        return new Response(image.bytes, { headers: { ...headers, 'Content-Type': image.type, 'Cache-Control': 'public, max-age=86400' } })
      }
      const text = ['POST', 'PATCH', 'PUT'].includes(request.method) ? await request.text() : ''
      if (text.length > 1100000) return new Response(JSON.stringify({ message: '请求内容过大' }), { status: 413, headers })
      let body = {}
      try { body = text ? JSON.parse(text) : {} } catch { return new Response(JSON.stringify({ message: 'JSON 格式无效' }), { status: 400, headers }) }
      if (!body || typeof body !== 'object' || Array.isArray(body)) return new Response(null, { status: 400, headers })
      const result = await service.request(request.method, request.url, body)
      return result === null ? new Response(null, { status: 204, headers }) : new Response(JSON.stringify(result), { headers })
    } catch (error) {
      return new Response(JSON.stringify({ message: error.message }), { status: error.status || 500, headers })
    }
  })
}

function createWindow() {
  mainWindow = new BrowserWindow({
    show: false,
    width: 1180,
    height: 820,
    minWidth: 900,
    minHeight: 620,
    title: '我的追番',
    backgroundColor: '#00000000',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.cjs')
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
  desktopWindows = setupDesktop(mainWindow, userDataPath())
  mainWindow.on('show', () => mainWindow.webContents.send('anime-log-visible-changed', true))
  mainWindow.on('hide', () => mainWindow.webContents.send('anime-log-visible-changed', false))
  mainWindow.setMenuBarVisibility(false)
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  mainWindow.webContents.on('will-navigate', event => event.preventDefault())
}

function deliverBroadcastAlerts() {
  const enabled = desktopWindows?.getSettings().notificationsEnabled !== false
  const alerts = service?.claimTodayAlerts({ notificationsEnabled: enabled }) || []
  if (!alerts.length) return
  if (!Notification.isSupported()) { service.markAlerts(alerts, 'failed'); return }
  const anime = [...new Map(alerts.map(item => [item.animeSourceId, item])).values()]
  const title = anime.length === 1 ? `${anime[0].title} 今日更新` : `今日有 ${anime.length} 部番剧预计更新`
  const body = anime.length === 1
    ? `按 AniList 排期，今日预计播出第 ${alerts.map(item => item.episodeNumber).join('、')} 集`
    : anime.slice(0, 4).map(item => item.title).join('、') + (anime.length > 4 ? ` 等 ${anime.length} 部` : '')
  try {
    const notification = new Notification({ title, body, silent: false })
    notification.on('click', () => {
      desktopWindows?.restore()
      mainWindow?.webContents.send('anime-log-focus-broadcast', anime.length === 1 ? anime[0].animeSourceId : null)
    })
    notification.show()
    service.markAlerts(alerts, 'delivered')
  } catch (error) {
    console.error('番剧更新通知发送失败:', error.message)
    service.markAlerts(alerts, 'failed')
  }
}

async function loadApp() {
  const devServerUrl = process.env.VITE_DEV_SERVER_URL || 'http://127.0.0.1:5173'
  if (isDev() && process.env.ANIME_LOG_LOAD_DIST !== '1') {
    await mainWindow.loadURL(devServerUrl)
    return
  }

  await mainWindow.loadFile(path.resolve(__dirname, '..', 'dist', 'index.html'))
}

function loadErrorPage(error) {
  const message = error && error.message ? error.message : String(error)
  const errorPagePath = path.join(__dirname, 'startup-error.html')
  mainWindow.loadFile(errorPagePath, { query: { message } })
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else app.whenReady().then(async () => {
  createWindow()
  try {
    await startLocalService()
    await loadApp()
    desktopWindows.start()
    broadcastScheduler = createBroadcastScheduler({ service, powerMonitor, onUpdated: results => {
      if (results.length && mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('anime-log-broadcast-updated', results)
      deliverBroadcastAlerts()
    } })
    broadcastScheduler.start()
  } catch (error) {
    loadErrorPage(error)
    mainWindow.show()
  }
})

app.on('second-instance', () => desktopWindows?.restore())

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => { broadcastScheduler?.stop(); broadcastScheduler = null; service?.close(); service = null })

app.on('activate', async () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
    try {
      await loadApp()
    } catch (error) {
      loadErrorPage(error)
    }
  }
})

process.on('uncaughtException', (error) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    loadErrorPage(error)
  } else {
    dialog.showErrorBox('我的追番 · 启动失败', error.message)
  }
})
