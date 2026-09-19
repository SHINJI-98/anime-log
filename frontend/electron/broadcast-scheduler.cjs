function createBroadcastScheduler({ service, powerMonitor, onUpdated, intervalMs = 60000 }) {
  let timer = null
  let running = null
  async function tick() {
    if (running) return running
    running = service.refreshBroadcasts().then(results => {
      if (results.length) onUpdated?.(results)
      return results
    }).catch(error => {
      console.error('同步 Bangumi 放送进度失败:', error.message)
      return []
    }).finally(() => { running = null })
    return running
  }
  const resume = () => { tick() }
  return {
    start() {
      if (timer) return
      timer = setInterval(tick, intervalMs)
      powerMonitor?.on('resume', resume)
      tick()
    },
    tick,
    stop() {
      clearInterval(timer)
      timer = null
      powerMonitor?.removeListener('resume', resume)
    }
  }
}

module.exports = { createBroadcastScheduler }
