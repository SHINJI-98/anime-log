// Electron screen/window coordinates are DIP, including negative monitor origins.
const clamp = (n, min, max) => Math.max(min, Math.min(n, Math.max(min, max)))
function fit(bounds, area, snap = 0) {
  const width = Math.min(bounds.width, area.width)
  const height = Math.min(bounds.height, area.height)
  let x = clamp(bounds.x, area.x, area.x + area.width - width)
  let y = clamp(bounds.y, area.y, area.y + area.height - height)
  if (x - area.x <= snap) x = area.x
  if (area.x + area.width - width - x <= snap) x = area.x + area.width - width
  if (y - area.y <= snap) y = area.y
  if (area.y + area.height - height - y <= snap) y = area.y + area.height - height
  return { x: Math.round(x), y: Math.round(y), width, height }
}
function remember(bounds, display) {
  const a = display.workArea
  return { displayId: display.id, x: clamp((bounds.x - a.x) / Math.max(1, a.width - bounds.width), 0, 1),
    y: clamp((bounds.y - a.y) / Math.max(1, a.height - bounds.height), 0, 1) }
}
function restore(saved, displays, primary, size = 64) {
  const display = displays.find(d => d.id === saved?.displayId) || primary
  const a = display.workArea
  const valid = saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)
  return fit({ x: valid ? a.x + saved.x * (a.width - size) : a.x + a.width - size - 24,
    y: valid ? a.y + saved.y * (a.height - size) : a.y + (a.height - size) / 2,
    width: size, height: size }, a)
}
function panel(anchor, area) {
  const width = Math.min(1060, area.width)
  const height = Math.min(680, area.height)
  return fit({ width, height,
    x: anchor.x + anchor.width / 2 > area.x + area.width / 2 ? anchor.x - width - 4 : anchor.x + anchor.width + 4,
    y: anchor.y + anchor.height / 2 > area.y + area.height / 2 ? anchor.y + anchor.height - height : anchor.y
  }, area)
}
module.exports = { fit, remember, restore, panel }
