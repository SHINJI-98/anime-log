const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
function renderer() {
  const events = {}, sent = []
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../electron/ball-preload.cjs'), 'utf8'), {
    require: () => ({ ipcRenderer: { on() {}, send: (_channel, value) => sent.push(value) } }),
    window: { addEventListener: (name, handler) => { events[name] = handler } }
  })
  const down = (x = 10, y = 20) => events.pointerdown({ button: 0, screenX: x, screenY: y, pointerId: 1, target: { setPointerCapture() {} } })
  return { events, sent, down }
}
test('small hand movement remains a click; movement past six DIP is only a drag', () => {
  const { events, sent, down } = renderer()
  down()
  events.pointermove({ screenX: 13, screenY: 23 })
  events.pointerup()
  assert.equal(sent.map(v => v.action).join(','), 'down,click')
  sent.length = 0
  down()
  events.pointermove({ screenX: 18, screenY: 20 })
  events.pointermove({ screenX: 22, screenY: 24 })
  events.pointerup()
  assert.equal(sent.map(v => v.action).join(','), 'down,drag,drag,drop')
  assert.equal(sent[2].dx, 12)
  assert.equal(sent[2].dy, 4)
})
test('cancelled pointers do not click; double click and context menu have separate actions', () => {
  const { events, sent, down } = renderer()
  down()
  events.pointercancel()
  events.pointerup()
  assert.equal(sent.map(v => v.action).join(','), 'down,drop')
  events.dblclick()
  let prevented = false
  events.contextmenu({ preventDefault: () => { prevented = true } })
  assert.equal(sent.at(-2).action, 'open')
  assert.equal(sent.at(-1).action, 'menu')
  assert.equal(prevented, true)
})
