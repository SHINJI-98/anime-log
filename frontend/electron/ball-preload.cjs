const { ipcRenderer } = require('electron')
ipcRenderer.on('anime-log-ball-opacity', (_event, opacity) => {
  document.documentElement.style.setProperty('--ball-opacity', String(opacity))
})
let start
let dragging = false
window.addEventListener('pointerdown', event => {
  if (event.button !== 0) return
  start = { x: event.screenX, y: event.screenY }
  dragging = false
  event.target.setPointerCapture(event.pointerId)
  ipcRenderer.send('anime-log-ball', { action: 'down' })
})
window.addEventListener('pointermove', event => {
  if (!start) return
  const dx = event.screenX - start.x
  const dy = event.screenY - start.y
  if (Math.hypot(dx, dy) > 6) dragging = true
  if (dragging) ipcRenderer.send('anime-log-ball', { action: 'drag', dx, dy })
})
window.addEventListener('pointerup', () => {
  if (!start) return
  ipcRenderer.send('anime-log-ball', { action: dragging ? 'drop' : 'click' })
  start = null
})
window.addEventListener('pointercancel', () => {
  start = null
  ipcRenderer.send('anime-log-ball', { action: 'drop' })
})
window.addEventListener('dblclick', () => ipcRenderer.send('anime-log-ball', { action: 'open' }))
window.addEventListener('contextmenu', event => {
  event.preventDefault()
  ipcRenderer.send('anime-log-ball', { action: 'menu' })
})
