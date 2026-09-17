const { app, BrowserWindow, Tray, Menu, nativeImage, screen, ipcMain, powerMonitor } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { createAutoLaunch } = require('./auto-launch.cjs')
const position = require('./window-position.cjs')
const { monitorFullscreen } = require('./fullscreen-monitor.cjs')

function setupDesktop(main, directory) {
  const panelTransparencySupported = process.platform === 'win32' && Number(os.release().split('.')[2]) >= 22621
  const settingsPath = path.join(directory, 'desktop-settings.json')
  const autoLaunch = createAutoLaunch(app)
  let settings = { closeAction: 'tray', ballSize: 64, ballOpacity: .72, panelOpacity: .95, mode: 'full', startupMode: 'ball' }
  try {
    const saved = JSON.parse(fs.readFileSync(settingsPath, 'utf8'))
    if (['tray', 'quit', 'ball'].includes(saved.closeAction)) settings.closeAction = saved.closeAction
    settings.position = saved.position
    settings.lockPosition = saved.lockPosition === true
    settings.mode = saved.mode === 'ball' ? 'ball' : 'full'
    settings.startupMode = saved.startupMode === 'tray' ? 'tray' : 'ball'
    if ([48, 64, 80].includes(saved.ballSize)) settings.ballSize = saved.ballSize
    if (saved.ballOpacity >= .3 && saved.ballOpacity <= 1) settings.ballOpacity = saved.ballOpacity
    if (saved.panelOpacity >= .5 && saved.panelOpacity <= 1) settings.panelOpacity = saved.panelOpacity
  } catch {}
  let compact = false
  let started = false
  const initialCompact = process.argv.includes('--autostart') || settings.mode === 'ball'
  let quitting = false
  let suspended = false
  let ball
  let tray
  let timer
  let fullBounds
  let lastInside = 0
  let hoverSince = 0
  let panelMode = 'closed'
  let interaction = false
  let pointerDown = false
  let dragOrigin
  let hoverBlockedUntil = 0
  let wasMaximized = false
  let fullscreenHidden = false
  let stopFullscreen
  let fullscreenError = ''
  function startFullscreen() {
    if (stopFullscreen) return
    fullscreenError = ''
    try {
    stopFullscreen = monitorFullscreen({ screen, directory, onError: message => { fullscreenError = message }, callback: bounds => {
      if (!compact || suspended || !ball) return
      const area = screen.getDisplayMatching(ball.getBounds()).bounds
      const hidden = bounds.some(b => Math.abs(b.x - area.x) <= 2 && Math.abs(b.y - area.y) <= 2 && Math.abs(b.width - area.width) <= 2 && Math.abs(b.height - area.height) <= 2)
      if (hidden === fullscreenHidden) return
      fullscreenHidden = hidden
      if (hidden) { main.hide(); ball.hide(); panelMode = 'closed' }
      else { ball.showInactive(); hoverSince = 0; hoverBlockedUntil = Date.now() + 650 }
    } })
    } catch (error) { fullscreenError = `全屏检测暂不可用：${error.message}` }
  }
  function endFullscreen() { stopFullscreen?.(); stopFullscreen = null; fullscreenHidden = false }
  function persist() {
    fs.mkdirSync(directory, { recursive: true })
    fs.writeFileSync(settingsPath + '.tmp', JSON.stringify(settings))
    fs.renameSync(settingsPath + '.tmp', settingsPath)
  }
  function savePosition() {
    if (!ball) return
    const bounds = ball.getBounds()
    settings.position = position.remember(bounds, screen.getDisplayMatching(bounds))
    try { persist() } catch (error) { console.error('保存悬浮球位置失败:', error.message) }
  }
  function applyAppearance(resize) {
    if (ball) {
      if (resize) recoverPosition()
      ball.webContents.send('anime-log-ball-opacity', settings.ballOpacity)
    }
    main.webContents.send('anime-log-appearance', { panelOpacity: settings.panelOpacity })
  }
  function moveBall(x, y) {
    // setPosition reuses rounded native bounds on Windows fractional DPI and
    // grows the window on each move. Always supply the configured DIP size.
    ball.setBounds({ x: Math.round(x), y: Math.round(y), width: settings.ballSize, height: settings.ballSize })
  }
  function resetPosition() {
    createBall()
    const b = position.restore(null, screen.getAllDisplays(), screen.getPrimaryDisplay(), settings.ballSize)
    moveBall(b.x, b.y)
    savePosition()
    if (compact && main.isVisible()) showPanel(panelMode === 'click')
  }
  function recoverPosition() {
    if (!compact) {
      const area = screen.getDisplayMatching(main.getBounds()).workArea
      main.setMinimumSize(Math.min(900, area.width), Math.min(620, area.height))
      main.setBounds(position.fit(main.getBounds(), area))
    }
    if (!ball) return
    const recovered = position.restore(settings.position, screen.getAllDisplays(), screen.getPrimaryDisplay(), settings.ballSize)
    moveBall(recovered.x, recovered.y)
    if (compact && main.isVisible()) showPanel(panelMode === 'click')
  }
  const contains = (bounds, point) => point.x >= bounds.x && point.y >= bounds.y && point.x < bounds.x + bounds.width && point.y < bounds.y + bounds.height
  const notify = () => main.webContents.send('anime-log-mode-changed', compact)
  function showPanel(pinned = false) {
    if (fullscreenHidden) return
    panelMode = pinned ? 'click' : 'hover'
    const anchor = ball.getBounds()
    const area = screen.getDisplayMatching(anchor).workArea
    main.setMinimumSize(Math.min(560, area.width), Math.min(380, area.height))
    main.setBounds(position.panel(anchor, area))
    if (pinned) { main.show(); main.focus() } else main.showInactive()
  }
  function dismiss(force = false) {
    if (!compact || (interaction && !force)) return
    panelMode = 'closed'
    main.hide()
    hoverSince = 0
    hoverBlockedUntil = Date.now() + 650
  }
  function tick() {
    if (!compact || suspended || fullscreenHidden || !ball?.isVisible() || pointerDown || interaction) return
    const cursor = screen.getCursorScreenPoint()
    if (contains(ball.getBounds(), cursor)) {
      lastInside = Date.now()
      if (!hoverSince) hoverSince = Date.now()
      if (!main.isVisible() && Date.now() >= hoverBlockedUntil && Date.now() - hoverSince >= 250) showPanel()
    } else if (main.isVisible() && contains(main.getBounds(), cursor)) {
      lastInside = Date.now()
    } else {
      hoverSince = 0
      if (panelMode === 'hover' && main.isVisible() && Date.now() - lastInside > 650) dismiss()
    }
  }
  function createBall() {
    if (ball) return
    ball = new BrowserWindow({ title: '我的追番 · 悬浮球',
      ...position.restore(settings.position, screen.getAllDisplays(), screen.getPrimaryDisplay(), settings.ballSize),
      frame: false, thickFrame: false, transparent: true, resizable: false, maximizable: false,
      skipTaskbar: true, alwaysOnTop: true, show: false,
      webPreferences: { preload: path.join(__dirname, 'ball-preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } })
    ball.loadFile(path.join(__dirname, 'floating-ball.html'))
    ball.webContents.on('did-finish-load', () => ball.webContents.send('anime-log-ball-opacity', settings.ballOpacity))
    ball.on('close', handleClose)
  }
  function setCompact(enabled, saveMode = true) {
    const value = enabled === true
    suspended = false
    if (value !== compact) {
      compact = value
      if (compact) {
        if (panelTransparencySupported) main.setBackgroundMaterial('acrylic')
        fullBounds = main.getNormalBounds()
        wasMaximized = main.isMaximized()
        main.unmaximize()
        main.setMinimumSize(560, 380)
        main.setAlwaysOnTop(true)
        main.setSkipTaskbar(true)
        main.hide()
      } else {
        if (panelTransparencySupported) main.setBackgroundMaterial('none')
        endFullscreen()
        clearInterval(timer)
        timer = null
        ball?.hide()
        main.setSkipTaskbar(false)
        main.setAlwaysOnTop(false)
        const area = screen.getDisplayMatching(fullBounds || main.getBounds()).workArea
        main.setMinimumSize(Math.min(900, area.width), Math.min(620, area.height))
        if (fullBounds) main.setBounds(position.fit(fullBounds, area))
        if (wasMaximized) main.maximize()
      }
    }
    if (compact) {
      createBall()
      if (!fullscreenHidden) ball.showInactive()
      startFullscreen()
      if (!timer) timer = setInterval(tick, 150)
    } else { main.restore(); main.show(); main.focus() }
    notify()
    if (saveMode) {
      settings.mode = compact ? 'ball' : 'full'
      try { persist() } catch (error) { console.error('保存桌面模式失败:', error.message) }
    }
    updateTray()
    return compact
  }
  function hideToTray() {
    suspended = true
    clearInterval(timer)
    timer = null
    main.hide()
    ball?.hide()
    endFullscreen()
    panelMode = 'closed'
    updateTray()
  }
  function handleClose(event) {
    if (quitting) return
    event.preventDefault()
    if (settings.closeAction === 'ball') { setCompact(true); dismiss(true) }
    else if (settings.closeAction === 'tray' && tray) hideToTray()
    else app.quit()
  }
  // A small built-in icon avoids bundling another large artwork asset.
  const bitmap = Buffer.alloc(16 * 16 * 4)
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const offset = (y * 16 + x) * 4
    if ((x - 7.5) ** 2 + (y - 7.5) ** 2 <= 56) {
      const white = x >= 5 && x <= 11 && Math.abs(y - 7.5) < (12 - x) * .65
      bitmap.set(white ? [245, 245, 255, 255] : [194, 105, 127, 255], offset)
    }
  }
  try {
    tray = new Tray(nativeImage.createFromBitmap(bitmap, { width: 16, height: 16 }))
    tray.setToolTip('我的追番')
    updateTray()
    tray.on('click', () => setCompact(false))
    tray.on('double-click', () => setCompact(false))
  } catch (error) { console.error('Tray unavailable:', error.message) }
  function menuItems() {
    return [
      { label: '打开主界面', click: () => setCompact(false) },
      { label: compact && !suspended ? '隐藏悬浮球' : '显示悬浮球', click: () => compact && !suspended ? hideToTray() : setCompact(true) },
      { label: '设置', click: () => { setCompact(false); main.webContents.send('anime-log-open-settings') } },
      { label: '锁定悬浮球位置', type: 'checkbox', checked: settings.lockPosition === true, click: item => { settings.lockPosition = item.checked; persist(); updateTray() } },
      { label: '重置悬浮球位置', click: resetPosition },
      { type: 'separator' },
      { label: '退出', click: () => app.quit() }
    ]
  }
  function updateTray() { tray?.setContextMenu(Menu.buildFromTemplate(menuItems())) }
  const onBall = (event, value) => {
    if (event.sender !== ball?.webContents || !value) return
    if (value.action === 'down') { pointerDown = true; dragOrigin = ball.getBounds() }
    if (value.action === 'drag' && pointerDown && !settings.lockPosition && Number.isFinite(value.dx) && Number.isFinite(value.dy)) {
      dismiss()
      moveBall(dragOrigin.x + value.dx, dragOrigin.y + value.dy)
    }
    if (value.action === 'drop' || value.action === 'click') {
      pointerDown = false
      hoverSince = 0
      hoverBlockedUntil = Date.now() + 650
      if (value.action === 'drop' && !settings.lockPosition) {
        const bounds = ball.getBounds()
        const fitted = position.fit(bounds, screen.getDisplayMatching(bounds).workArea, 12)
        if (bounds.x !== fitted.x || bounds.y !== fitted.y) moveBall(fitted.x, fitted.y)
        savePosition()
      }
      if (value.action === 'click') showPanel(true)
    }
    if (value.action === 'open') setCompact(false)
    if (value.action === 'menu') {
      interaction = true
      Menu.buildFromTemplate(menuItems()).popup({ window: ball, callback: () => { interaction = false; lastInside = Date.now() } })
    }
  }
  const onInteraction = (event, value) => { if (event.sender === main.webContents) interaction = value === true }
  const onPanelAction = (event, action) => {
    if (event.sender !== main.webContents || !compact) return
    if (action === 'dismiss') dismiss()
    if (action === 'pin') panelMode = 'click'
  }
  ipcMain.on('anime-log-ball', onBall)
  ipcMain.on('anime-log-interaction', onInteraction)
  ipcMain.on('anime-log-panel-action', onPanelAction)
  main.on('blur', () => { if (panelMode === 'click' && !pointerDown) dismiss() })
  main.on('close', handleClose)
  screen.on('display-added', recoverPosition)
  screen.on('display-removed', recoverPosition)
  screen.on('display-metrics-changed', recoverPosition)
  powerMonitor.on('resume', recoverPosition)
  app.on('before-quit', () => {
    quitting = true
    clearInterval(timer)
    endFullscreen()
    ipcMain.removeListener('anime-log-ball', onBall)
    ipcMain.removeListener('anime-log-interaction', onInteraction)
    ipcMain.removeListener('anime-log-panel-action', onPanelAction)
    screen.removeListener('display-added', recoverPosition)
    screen.removeListener('display-removed', recoverPosition)
    screen.removeListener('display-metrics-changed', recoverPosition)
    powerMonitor.removeListener('resume', recoverPosition)
    tray?.destroy()
    ball?.destroy()
  })
  return {
    setCompact,
    getCompact: () => started ? compact : initialCompact,
    start: () => {
      const automatic = process.argv.includes('--autostart')
      setCompact(initialCompact, false)
      if (automatic && settings.startupMode === 'tray') hideToTray()
      started = true
    },
    restore: () => setCompact(false),
    resetPosition,
    getSettings: () => ({ ...settings, ...autoLaunch.read(), fullscreenError, panelTransparencySupported }),
    saveSettings: value => {
      if (!value || !['tray', 'quit', 'ball'].includes(value.closeAction)) throw new Error('关闭行为无效')
      const previous = autoLaunch.read()
      const next = { ...settings, closeAction: value.closeAction, lockPosition: value.lockPosition ?? settings.lockPosition, autoLaunch: value.autoLaunch ?? previous.autoLaunch,
        ballSize: value.ballSize ?? settings.ballSize, ballOpacity: value.ballOpacity ?? settings.ballOpacity, panelOpacity: value.panelOpacity ?? settings.panelOpacity,
        startupMode: value.startupMode ?? settings.startupMode }
      if (!['tray', 'ball'].includes(next.startupMode)) throw new Error('启动模式无效')
      if (![48, 64, 80].includes(next.ballSize) || !Number.isFinite(next.ballOpacity) || next.ballOpacity < .3 || next.ballOpacity > 1 || !Number.isFinite(next.panelOpacity) || next.panelOpacity < .5 || next.panelOpacity > 1) throw new Error('外观设置无效')
      if (typeof next.autoLaunch !== 'boolean') throw new Error('自启动选项无效')
      const changed = next.autoLaunch !== previous.autoLaunch || next.autoLaunch === true
      fs.mkdirSync(directory, { recursive: true })
      fs.writeFileSync(settingsPath + '.tmp', JSON.stringify(next))
      try {
        if (changed) autoLaunch.set(next.autoLaunch)
        fs.renameSync(settingsPath + '.tmp', settingsPath)
      } catch (error) {
        if (changed) {
          try { autoLaunch.set(previous.autoLaunch) }
          catch (rollbackError) { throw new Error(`${error.message}；恢复原自启动设置失败：${rollbackError.message}`) }
        }
        throw error
      }
      const resize = settings.ballSize !== next.ballSize
      settings = next
      applyAppearance(resize)
      updateTray()
      return { ...settings, ...autoLaunch.read() }
    }
  }
}
module.exports = { setupDesktop }
