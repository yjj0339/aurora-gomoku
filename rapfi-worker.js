let engine = null
let loading = null
let currentRequest = null

function enginePath(file) {
  return new URL(`./engine/${file}`, self.location.href).href
}

async function ensureEngine() {
  if (engine) return engine
  if (loading) return loading
  loading = (async () => {
    importScripts(enginePath('rapfi.js'))
    if (typeof self.Rapfi !== 'function') throw new Error('冠军引擎文件未就绪')
    engine = await self.Rapfi({
      locateFile: (file) => enginePath(file === 'rapfi.data' ? 'rapfi.data' : file),
      onReceiveStdout: handleStdout,
      onReceiveStderr: (line) => self.postMessage({ type: 'log', level: 'error', message: line }),
      onExit: (code) => self.postMessage({ type: 'log', level: 'error', message: `引擎退出：${code}` }),
      noInitialRun: false,
    })
    return engine
  })()
  return loading
}

function handleStdout(line) {
  const text = String(line || '').trim()
  if (!text || text === 'OK') return
  const realtime = text.match(/^MESSAGE REALTIME (?:BEST|POS) (\d+),(\d+)/)
  if (realtime && currentRequest) {
    self.postMessage({ type: 'progress', requestId: currentRequest.id, candidate: { x: +realtime[1], y: +realtime[2] } })
    return
  }
  const coordinate = text.match(/^(\d+),(\d+)(?:\s|$)/)
  if (coordinate && currentRequest) {
    const request = currentRequest
    currentRequest = null
    self.postMessage({
      type: 'result',
      requestId: request.id,
      result: { x: +coordinate[1], y: +coordinate[2], engine: 'Rapfi 2025 · Gomocup 2026 冠军', elapsed: Math.round(performance.now() - request.started) },
    })
    return
  }
  self.postMessage({ type: 'log', level: 'info', message: text })
}

async function think(data) {
  const module = await ensureEngine()
  currentRequest = { id: data.requestId, started: performance.now() }
  const time = data.level === 5 ? 8000 : 3000
  module.sendCommand('INFO RULE 0')
  module.sendCommand('INFO THREAD_NUM 1')
  module.sendCommand('INFO STRENGTH 100')
  module.sendCommand(`INFO TIMEOUT_TURN ${time}`)
  module.sendCommand('INFO TIMEOUT_MATCH 600000')
  module.sendCommand('INFO MAX_DEPTH 100')
  module.sendCommand('INFO MAX_NODE 0')
  module.sendCommand('INFO SHOW_DETAIL 1')
  module.sendCommand('INFO PONDERING 0')
  module.sendCommand('START 15')
  let boardCommand = 'YXBOARD'
  for (const move of data.moves) boardCommand += ` ${move.x},${move.y},${move.side}`
  boardCommand += ' DONE'
  module.sendCommand(boardCommand)
  module.sendCommand('YXNBEST 1')
}

self.onmessage = async ({ data }) => {
  try {
    if (data.type === 'init') {
      await ensureEngine()
      self.postMessage({ type: 'ready' })
    } else if (data.type === 'think') {
      await think(data)
    }
  } catch (error) {
    if (data.requestId === currentRequest?.id) currentRequest = null
    self.postMessage({ type: 'error', requestId: data.requestId, message: error.message })
  }
}
