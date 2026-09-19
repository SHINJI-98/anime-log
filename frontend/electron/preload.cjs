const { contextBridge, ipcRenderer } = require('electron')

const config = ipcRenderer.sendSync('anime-log-config')

contextBridge.exposeInMainWorld('animeLogConfig', Object.freeze({
  apiBaseUrl: config.apiBaseUrl || '',
  compact: config.compact === true,
  visible: config.visible === true
}))

contextBridge.exposeInMainWorld('animeLogDesktop', Object.freeze({
  setInteraction: value => ipcRenderer.send('anime-log-interaction', value),
  getVisibility: () => ipcRenderer.invoke('anime-log-visible'),
  onVisibilityChanged: callback => {
    const listener = (_event, visible) => callback(visible)
    ipcRenderer.on('anime-log-visible-changed', listener)
    return () => ipcRenderer.removeListener('anime-log-visible-changed', listener)
  },
  resetPosition: () => ipcRenderer.invoke('anime-log-reset-position'),
  onSettingsRequested: callback => {
    const listener = () => callback()
    ipcRenderer.on('anime-log-open-settings', listener)
    return () => ipcRenderer.removeListener('anime-log-open-settings', listener)
  },
  setCompact: (enabled) => ipcRenderer.invoke('anime-log-window-mode', enabled),
  setPinned: (enabled) => ipcRenderer.invoke('anime-log-pin', enabled),
  getPinned: () => ipcRenderer.invoke('anime-log-pin-state'),
  getSettings: () => ipcRenderer.invoke('anime-log-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('anime-log-settings', settings),
  onModeChanged: (callback) => {
    const listener = (_event, compact) => callback(compact)
    ipcRenderer.on('anime-log-mode-changed', listener)
    return () => ipcRenderer.removeListener('anime-log-mode-changed', listener)
  },
  onBroadcastUpdated: callback => {
    const listener = (_event, results) => callback(results)
    ipcRenderer.on('anime-log-broadcast-updated', listener)
    return () => ipcRenderer.removeListener('anime-log-broadcast-updated', listener)
  },
  onBroadcastFocus: callback => {
    const listener = (_event, animeSourceId) => callback(animeSourceId)
    ipcRenderer.on('anime-log-focus-broadcast', listener)
    return () => ipcRenderer.removeListener('anime-log-focus-broadcast', listener)
  }
}))

window.addEventListener('pointerdown', () => ipcRenderer.send('anime-log-panel-action', 'pin'), true)
ipcRenderer.on('anime-log-appearance', (_event, value) => document.documentElement.style.setProperty('--panel-opacity', String(value.panelOpacity)))
window.addEventListener('DOMContentLoaded', async () => {
  const settings = await ipcRenderer.invoke('anime-log-settings')
  document.documentElement.style.setProperty('--panel-opacity', String(settings.panelOpacity))
})
window.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !document.querySelector('dialog[open]')) ipcRenderer.send('anime-log-panel-action', 'dismiss')
})
