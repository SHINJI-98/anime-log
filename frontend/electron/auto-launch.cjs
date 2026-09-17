// Portable builds must register the outer exe, not Electron's temporary extraction path.
function createAutoLaunch(app, {
  platform = process.platform,
  executable = process.env.PORTABLE_EXECUTABLE_FILE || process.execPath,
  name = 'AnimeLog'
} = {}) {
  const supported = platform === 'win32' && app.isPackaged
  // Electron writes this verbatim to Run; Windows must see one executable token.
  const options = { path: `"${executable}"`, args: ['--autostart'] }
  function read() {
    if (!supported) return { autoLaunch: false, autoLaunchSupported: false }
    const state = app.getLoginItemSettings(options)
    // openAtLogin checks Electron's default entry, not our custom registration name.
    const enabled = state.launchItems?.some(item =>
      item.name === name && item.scope === 'user' && item.enabled)
    return { autoLaunch: Boolean(enabled), autoLaunchSupported: true }
  }
  function set(enabled) {
    if (typeof enabled !== 'boolean') throw new Error('自启动选项无效')
    if (!supported) throw new Error('请在 Windows 打包版中设置开机自启动')
    app.setLoginItemSettings({ ...options, name, openAtLogin: enabled, enabled })
    if (read().autoLaunch !== enabled) throw new Error('系统未能更新自启动设置，请检查 Windows 启动应用设置')
  }
  return { read, set }
}
module.exports = { createAutoLaunch }
