const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createAutoLaunch } = require('../electron/auto-launch.cjs')

test('uses the portable exe path for both reading and toggling startup', () => {
  const executable = 'D:\\My Apps\\Anime Log.exe'
  let enabled = false
  const writes = []
  const app = {
    isPackaged: true,
    getLoginItemSettings: options => {
      assert.deepEqual(options, { path: `"${executable}"`, args: ['--autostart'] })
      return { openAtLogin: false, executableWillLaunchAtLogin: enabled,
        launchItems: enabled ? [{ name: 'AnimeLog', scope: 'user', enabled: true }] : [] }
    },
    setLoginItemSettings: options => { writes.push(options); enabled = options.openAtLogin }
  }
  const startup = createAutoLaunch(app, { platform: 'win32', executable })
  assert.deepEqual(startup.read(), { autoLaunch: false, autoLaunchSupported: true })
  assert.equal(writes.length, 0)
  startup.set(true)
  assert.equal(startup.read().autoLaunch, true)
  startup.set(false)
  assert.equal(startup.read().autoLaunch, false)
  assert.deepEqual(writes, [true, false].map(value => ({ path: `"${executable}"`, args: ['--autostart'], name: 'AnimeLog', openAtLogin: value, enabled: value })))
})

test('development mode never registers Electron as a login item', () => {
  const startup = createAutoLaunch({ isPackaged: false }, { platform: 'win32' })
  assert.deepEqual(startup.read(), { autoLaunch: false, autoLaunchSupported: false })
  assert.throws(() => startup.set(true), /打包版/)
})

test('reports OS startup disabling and failures instead of displaying a false success', () => {
  const startup = createAutoLaunch({ isPackaged: true,
    getLoginItemSettings: () => ({ openAtLogin: true, executableWillLaunchAtLogin: true,
      launchItems: [{ name: 'AnimeLog', scope: 'user', enabled: false },
        { name: 'OtherApp', scope: 'user', enabled: true },
        { name: 'AnimeLog', scope: 'machine', enabled: true }] }),
    setLoginItemSettings: () => {}
  }, { platform: 'win32' })
  assert.equal(startup.read().autoLaunch, false)
  assert.throws(() => startup.set(true), /未能更新/)
  assert.throws(() => startup.set('true'), /无效/)
})
