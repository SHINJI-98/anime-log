const { test } = require('node:test')
const assert = require('node:assert/strict')
const { fit, remember, restore, panel } = require('../electron/window-position.cjs')
function inside(b, a) {
  assert.ok(b.x >= a.x && b.y >= a.y)
  assert.ok(b.x + b.width <= a.x + a.width && b.y + b.height <= a.y + a.height)
}
test('four corners fit work areas across negative origins, arrangements and 100/125/150/200% DIP scales', () => {
  for (const scale of [1, 1.25, 1.5, 2]) for (const origin of [[0, 0], [-1920, 0], [0, -1080], [1920, -300]]) {
    const a = { x: origin[0], y: origin[1], width: Math.floor(1920 / scale), height: Math.floor(1040 / scale) }
    for (const dx of [0, a.width - 64]) for (const dy of [0, a.height - 64]) {
      const anchor = { x: a.x + dx, y: a.y + dy, width: 64, height: 64 }
      const b = panel(anchor, a)
      inside(b, a)
      assert.equal(b.y, dy === 0 ? a.y : a.y + a.height - b.height)
      inside(restore(remember(anchor, { id: 2, workArea: a }), [{ id: 2, workArea: a }], null), a)
    }
  }
})
test('unplugged display and malformed position recover visibly; resolution changes preserve proportions', () => {
  const primary = { id: 1, workArea: { x: 0, y: 0, width: 1280, height: 680 } }
  inside(restore({ displayId: 9, x: 1, y: 1 }, [primary], primary), primary.workArea)
  inside(restore({ displayId: 1, x: 'invalid', y: null }, [primary], primary), primary.workArea)
  const center = restore({ displayId: 1, x: .5, y: .5 }, [primary], primary)
  assert.equal(center.x, 608)
  assert.equal(center.y, 308)
  assert.equal(fit({ x: 8, y: 10, width: 64, height: 64 }, primary.workArea, 12).x, 0)
})
