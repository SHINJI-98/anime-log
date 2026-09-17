const { spawn } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
let metrics = { memoryKB: 0, cpuSeconds: 0 }
function monitorFullscreen({ screen, callback, onError, directory }) {
  if (process.platform !== 'win32' || process.env.ANIME_LOG_DISABLE_FULLSCREEN === '1') return () => {}
  // PowerShell cannot read inside app.asar. Copy only our bundled helper script.
  const script = path.join(directory, 'fullscreen-monitor.ps1')
  fs.mkdirSync(directory, { recursive: true })
  fs.copyFileSync(path.join(__dirname, 'fullscreen-monitor.ps1'), script)
  const executable = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe')
  const child = spawn(executable, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-OwnerProcessId', String(process.pid)], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  let buffer = ''
  let stopped = false
  child.stdout.on('data', data => {
    if (stopped) return
    buffer += data.toString()
    let end
    while ((end = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, end); buffer = buffer.slice(end + 1)
      try {
        const state = JSON.parse(line)
        metrics = { memoryKB: state.memoryKB, cpuSeconds: state.cpuSeconds }
        callback(state.windows.map(bounds => screen.screenToDipRect(null, bounds)))
      } catch (error) { onError(error.message) }
    }
  })
  child.stderr.on('data', data => onError(String(data)))
  child.on('error', error => onError(error.message))
  child.on('exit', () => { if (!stopped) { callback([]); onError('全屏检测已停止，可重新显示悬浮球后重试。') } })
  return () => { stopped = true; child.kill(); metrics = { memoryKB: 0, cpuSeconds: 0 } }
}
module.exports = { monitorFullscreen, getMetrics: () => metrics }
