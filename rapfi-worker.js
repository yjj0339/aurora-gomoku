const ENGINE_NAME = 'Rapfi 2026 冠军同源核心 · 官方 mix9svq NNUE'
const BOARD_SIZE = 15
const BOARD_CELLS = BOARD_SIZE * BOARD_SIZE
const ENGINE_DATA_FILE = 'rapfi-single-simd128.data'
const CONFIG_BYTES = 6709
const FREESTYLE_WEIGHT_START = 6709
const FREESTYLE_WEIGHT_END = 10037107
const FREESTYLE_WEIGHT_SHA256 = '6bc0d1b0ff8e1d857f7f412923cd458f38f1a435087c91ae71fec3676c23ef62'
const LEGACY_MODEL_ENTRY = 'binary_file = "model210901.bin"'

let engine = null
let loading = null
let currentRequest = null
let currentGameId = null
let startingRequest = false
let sessionGeneration = 0
let queue = []
let legacyCounter = 0
let legacyMoves = []
let legacyInitialized = false
let modelGate = null
let modelVerified = false
let enginePrimed = false
let primeSearchGate = null

function enginePath(file) {
  return new URL(`./engine/${file}`, self.location.href).href
}

function postStatus(requestId, phase, extra = {}) {
  self.postMessage({ type: 'status', requestId, phase, ...extra })
}

function bytesToHex(bytes) {
  return [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('')
}

function findBytes(haystack, needle, limit = haystack.length) {
  let found = -1
  let count = 0
  const end = Math.min(limit, haystack.length) - needle.length
  outer: for (let index = 0; index <= end; index++) {
    for (let offset = 0; offset < needle.length; offset++) {
      if (haystack[index + offset] !== needle[offset]) continue outer
    }
    found = index
    count++
  }
  return { found, count }
}

async function prepareEngineData() {
  const response = await fetch(enginePath(ENGINE_DATA_FILE), { cache: 'force-cache' })
  if (!response.ok) throw new Error(`NNUE 数据下载失败：HTTP ${response.status}`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.length < FREESTYLE_WEIGHT_END) throw new Error('NNUE 数据包不完整')

  const digest = await self.crypto.subtle.digest('SHA-256', bytes.subarray(FREESTYLE_WEIGHT_START, FREESTYLE_WEIGHT_END))
  const hash = bytesToHex(new Uint8Array(digest))
  if (hash !== FREESTYLE_WEIGHT_SHA256) throw new Error(`NNUE 权重校验失败：${hash}`)

  const marker = new TextEncoder().encode(LEGACY_MODEL_ENTRY)
  const { found, count } = findBytes(bytes, marker, CONFIG_BYTES)
  if (count !== 1) throw new Error(`Rapfi 配置兼容项数量异常：${count}`)
  // The pinned 2025 config references a legacy classical model that the 2026
  // core no longer accepts. Comment only that entry in memory; the official
  // mix9svq weight bytes and the on-disk package remain untouched.
  bytes[found] = '#'.charCodeAt(0)
  return { buffer: bytes.buffer, hash }
}

function createModelGate() {
  let resolvePromise
  let rejectPromise
  const promise = new Promise((resolve, reject) => {
    resolvePromise = resolve
    rejectPromise = reject
  })
  const gate = {
    evaluator: false,
    weight: false,
    settled: false,
    promise,
    resolve(value) {
      if (gate.settled) return
      gate.settled = true
      clearTimeout(gate.timer)
      resolvePromise(value)
    },
    reject(error) {
      if (gate.settled) return
      gate.settled = true
      clearTimeout(gate.timer)
      rejectPromise(error)
    },
  }
  gate.timer = setTimeout(() => gate.reject(new Error('Rapfi NNUE 模型就绪超时')), 15000)
  return gate
}

function createPrimeSearchGate() {
  let resolvePromise
  let rejectPromise
  const promise = new Promise((resolve, reject) => {
    resolvePromise = resolve
    rejectPromise = reject
  })
  const gate = {
    settled: false,
    promise,
    resolve(value) {
      if (gate.settled) return
      gate.settled = true
      clearTimeout(gate.timer)
      resolvePromise(value)
    },
    reject(error) {
      if (gate.settled) return
      gate.settled = true
      clearTimeout(gate.timer)
      rejectPromise(error)
    },
  }
  gate.timer = setTimeout(() => gate.reject(new Error('Rapfi NNUE 预热搜索超时')), 8000)
  return gate
}

function observeModelOutput(text, isError = false) {
  if (!modelGate || modelGate.settled) return
  if (/Evaluator set to mix9svq/i.test(text)) modelGate.evaluator = true
  if (/mix9svq nnue:\s*weight loaded/i.test(text)) modelGate.weight = true
  if (isError || /^ERROR\b/i.test(text) || /Failed to load (?:config|model|.*weight)/i.test(text)) {
    modelGate.reject(new Error(`Rapfi NNUE 加载失败：${text}`))
    return
  }
  if (modelGate.evaluator && modelGate.weight) modelGate.resolve({ evaluator: 'mix9svq' })
}

function failEngine(error) {
  const failure = error instanceof Error ? error : new Error(String(error || 'Rapfi 引擎异常'))
  modelGate?.reject(failure)
  primeSearchGate?.reject(failure)
  engine = null
  loading = null
  modelVerified = false
  enginePrimed = false
  if (currentRequest) {
    const request = currentRequest
    clearRequestTimer(request)
    currentRequest = null
    postStatus(request.id, 'model-error', { message: failure.message, gameId: request.gameId })
    self.postMessage({ type: 'error', requestId: request.id, message: failure.message })
  }
  for (const pending of queue.splice(0)) {
    postStatus(pending.requestId, 'model-error', { message: failure.message })
    self.postMessage({ type: 'error', requestId: pending.requestId, message: failure.message })
  }
}

function handleStderr(line) {
  const text = String(line || '').trim()
  if (!text) return
  observeModelOutput(text, true)
  self.postMessage({ type: 'log', level: 'error', message: text })
  if (modelVerified || currentRequest) failEngine(new Error(`Rapfi 运行失败：${text}`))
}

async function ensureEngine(requestId) {
  if (engine) return engine
  if (loading) return loading
  loading = (async () => {
    postStatus(requestId, 'model-loading', { message: '正在校验官方 mix9svq NNUE' })
    const data = await prepareEngineData()
    importScripts(enginePath('rapfi.js'))
    if (typeof self.Rapfi !== 'function') throw new Error('冠军引擎文件未就绪')
    modelGate = createModelGate()
    const enginePromise = self.Rapfi({
      getPreloadedPackage: () => data.buffer,
      locateFile: (file) => enginePath(file === 'rapfi.data' ? 'rapfi.data' : file),
      onReceiveStdout: handleStdout,
      onReceiveStderr: handleStderr,
      onExit: (code) => {
        const message = `Rapfi 引擎退出：${code}`
        self.postMessage({ type: 'log', level: 'error', message })
        failEngine(new Error(message))
      },
      noInitialRun: false,
    })
    const loadedEngine = await enginePromise
    // Rapfi maps the rule-specific NNUE only on its first search. Run one
    // bounded empty-board search, then let the first real game claim that
    // finished session without another START.
    primeSearchGate = createPrimeSearchGate()
    configureEngine(loadedEngine, 500)
    loadedEngine.sendCommand(`START ${BOARD_SIZE}`)
    loadedEngine.sendCommand('YXBOARD DONE')
    loadedEngine.sendCommand('YXNBEST 1')
    enginePrimed = true
    await Promise.all([modelGate.promise, primeSearchGate.promise])
    primeSearchGate = null
    engine = loadedEngine
    modelVerified = true
    postStatus(requestId, 'model-ready', {
      status: 'ready',
      message: '官方 mix9svq NNUE 已校验并载入',
      evaluator: 'mix9svq',
      modelHash: data.hash,
    })
    return engine
  })().catch((error) => {
    engine = null
    modelVerified = false
    enginePrimed = false
    primeSearchGate?.reject(error)
    primeSearchGate = null
    loading = null
    postStatus(requestId, 'model-error', { message: error.message })
    throw error
  })
  return loading
}

function normalizeMoves(moves) {
  if (!Array.isArray(moves)) return []
  return moves
    .map(({ x, y, side }) => ({ x: Number(x), y: Number(y), side: Number(side) }))
    .filter(({ x, y, side }) => Number.isInteger(x) && Number.isInteger(y)
      && x >= 0 && y >= 0 && x < BOARD_SIZE && y < BOARD_SIZE && (side === 1 || side === 2))
}

function movesContinueGame(previous, next) {
  if (next.length < previous.length) return false
  return previous.every((move, index) => {
    const candidate = next[index]
    return move.x === candidate?.x && move.y === candidate?.y && move.side === candidate?.side
  })
}

function resolveGameId(data) {
  if (data.gameId !== undefined && data.gameId !== null && String(data.gameId).trim()) return String(data.gameId)
  const nextMoves = normalizeMoves(data.moves)
  const samePosition = legacyInitialized && nextMoves.length === legacyMoves.length && movesContinueGame(legacyMoves, nextMoves)
  const continuation = legacyInitialized && nextMoves.length > legacyMoves.length && movesContinueGame(legacyMoves, nextMoves)
  const repeatedEmpty = legacyInitialized && nextMoves.length === 0 && legacyMoves.length === 0
  if (!legacyInitialized || repeatedEmpty || (!samePosition && !continuation)) legacyCounter++
  legacyInitialized = true
  legacyMoves = nextMoves
  return `legacy-game-${legacyCounter}`
}

function boardEntries(data) {
  if (Array.isArray(data.board) && data.board.length >= BOARD_CELLS) {
    const entries = []
    for (let index = 0; index < BOARD_CELLS; index++) {
      const side = Number(data.board[index])
      if (side !== 1 && side !== 2) continue
      entries.push({ x: index % BOARD_SIZE, y: Math.floor(index / BOARD_SIZE), side })
    }
    return entries
  }
  return normalizeMoves(data.moves)
}

function searchBudget(data) {
  const fallback = data.type === 'analyze' ? 3000 : Number(data.level) === 5 ? 8000 : 3000
  const requested = Number(data.budget)
  const maximum = data.type === 'analyze' ? 8000 : Number(data.level) === 5 ? 8000 : 3000
  return Math.max(500, Math.min(maximum, Number.isFinite(requested) && requested > 0 ? requested : fallback))
}

function configureEngine(module, budget) {
  module.sendCommand('INFO RULE 0')
  module.sendCommand('INFO THREAD_NUM 1')
  module.sendCommand('INFO STRENGTH 100')
  module.sendCommand(`INFO TIMEOUT_TURN ${budget}`)
  module.sendCommand('INFO TIMEOUT_MATCH 600000')
  module.sendCommand('INFO MAX_DEPTH 100')
  module.sendCommand('INFO MAX_NODE 0')
  module.sendCommand('INFO SHOW_DETAIL 1')
  module.sendCommand('INFO PONDERING 0')
}

function syncFullBoard(module, data) {
  let command = 'YXBOARD'
  for (const move of boardEntries(data)) command += ` ${move.x},${move.y},${move.side}`
  command += ' DONE'
  module.sendCommand(command)
}

function clearRequestTimer(request) {
  if (request?.statusTimer) clearInterval(request.statusTimer)
}

function parseCoordinates(text) {
  return [...text.matchAll(/(\d+),(\d+)/g)]
    .map((match) => ({ x: Number(match[1]), y: Number(match[2]) }))
    .filter(({ x, y }) => x >= 0 && y >= 0 && x < BOARD_SIZE && y < BOARD_SIZE)
}

function parseBoardLabels(text) {
  return [...text.matchAll(/\b([A-O])(1[0-5]|[1-9])\b/gi)]
    .map((match) => ({ x: match[1].toUpperCase().charCodeAt(0) - 65, y: Number(match[2]) - 1 }))
    .filter(({ x, y }) => x >= 0 && y >= 0 && x < BOARD_SIZE && y < BOARD_SIZE)
}

function parseCompactMetric(value) {
  const match = String(value || '').trim().match(/^([\d.]+)([KMG]?)$/i)
  if (!match) return undefined
  const multiplier = { '': 1, K: 1000, M: 1000000, G: 1000000000 }[match[2].toUpperCase()]
  const parsed = Number(match[1]) * multiplier
  return Number.isFinite(parsed) ? Math.round(parsed) : undefined
}

function parseEvaluation(value) {
  const text = String(value || '').trim().toUpperCase()
  const numeric = Number(text)
  if (Number.isFinite(numeric)) return numeric
  return /^[+-]?M\d+$/.test(text) ? text : undefined
}

function emitProgress(request, details = {}) {
  self.postMessage({
    type: 'progress',
    requestId: request.id,
    gameId: request.gameId,
    mode: request.mode,
    elapsed: Math.round(performance.now() - request.started),
    budget: request.budget,
    ...details,
  })
}

function completeRequest(coordinate) {
  const request = currentRequest
  if (!request) return
  clearRequestTimer(request)
  currentRequest = null
  const principalVariation = [coordinate, ...request.principalVariation.filter((move) => move.x !== coordinate.x || move.y !== coordinate.y)]
  const elapsed = Math.round(performance.now() - request.started)
  self.postMessage({
    type: 'result',
    requestId: request.id,
    result: {
      x: coordinate.x,
      y: coordinate.y,
      engine: ENGINE_NAME,
      elapsed,
      budget: request.budget,
      depth: request.depth,
      seldepth: request.seldepth,
      nodes: request.nodes,
      speed: request.speed,
      score: request.score,
      gameId: request.gameId,
      evaluator: 'mix9svq',
      modelVerified,
      analysis: request.mode === 'analyze',
      pv: principalVariation,
      principalVariation,
    },
  })
  postStatus(request.id, 'complete', { gameId: request.gameId, elapsed, budget: request.budget })
  Promise.resolve().then(processNext)
}

function handleStdout(line) {
  const text = String(line || '').trim()
  if (!text || text === 'OK') return
  observeModelOutput(text)
  if (/^ERROR\b/i.test(text) && (modelVerified || currentRequest)) {
    failEngine(new Error(`Rapfi 运行失败：${text}`))
    return
  }

  if (!currentRequest && primeSearchGate && !primeSearchGate.settled) {
    const primedMove = text.match(/^(\d+),(\d+)(?:\s|$)/)
    if (primedMove) {
      primeSearchGate.resolve({ x: Number(primedMove[1]), y: Number(primedMove[2]) })
      return
    }
  }

  if (currentRequest) {
    const realtime = text.match(/^MESSAGE REALTIME (BEST|POS)\s+(.+)$/i)
    if (realtime) {
      const variation = parseCoordinates(realtime[2])
      if (variation.length) {
        currentRequest.principalVariation = variation
        emitProgress(currentRequest, { candidate: variation[0], principalVariation: variation })
      }
      return
    }

    const statistic = text.match(/^MESSAGE REALTIME (DEPTH|NODES|EVAL|SPEED)\s+([^\s]+)/i)
    if (statistic) {
      const key = statistic[1].toLowerCase()
      const value = Number(statistic[2])
      if (Number.isFinite(value)) {
        if (key === 'depth') currentRequest.depth = value
        else if (key === 'nodes') currentRequest.nodes = value
        else if (key === 'eval') currentRequest.score = value
        emitProgress(currentRequest, { [key]: value })
      }
      return
    }

    const depthLine = text.match(/^MESSAGE Depth\s+(\d+)(?:-(\d+))?\s+\|\s+Eval\s+([+-]?(?:M\d+|\d+))\s+\|\s+Time\s+(\d+)ms(?:\s+\|\s+(.+))?$/i)
    if (depthLine) {
      const depth = Number(depthLine[1])
      const seldepth = Number(depthLine[2] || depthLine[1])
      const score = parseEvaluation(depthLine[3])
      const variation = parseBoardLabels(depthLine[5] || '')
      currentRequest.depth = depth
      currentRequest.seldepth = seldepth
      currentRequest.score = score
      if (variation.length) currentRequest.principalVariation = variation
      emitProgress(currentRequest, {
        depth,
        seldepth,
        score,
        ...(variation.length ? { candidate: variation[0], principalVariation: variation } : {}),
      })
      return
    }

    const summary = text.match(/^MESSAGE Speed\s+([\d.]+[KMG]?)\s+\|\s+Depth\s+(\d+)(?:-(\d+))?\s+\|\s+Eval\s+([+-]?(?:M\d+|\d+))\s+\|\s+Node(?:s)?\s+([\d.]+[KMG]?)\s+\|\s+Time\s+(\d+)ms$/i)
    if (summary) {
      const speed = parseCompactMetric(summary[1])
      const depth = Number(summary[2])
      const seldepth = Number(summary[3] || summary[2])
      const score = parseEvaluation(summary[4])
      const nodes = parseCompactMetric(summary[5])
      Object.assign(currentRequest, { speed, depth, seldepth, score, nodes })
      emitProgress(currentRequest, { speed, depth, seldepth, score, nodes })
      return
    }

    const bestline = text.match(/^MESSAGE Bestline\s+(.+)$/i)
    if (bestline) {
      const variation = parseBoardLabels(bestline[1])
      if (variation.length) {
        currentRequest.principalVariation = variation
        emitProgress(currentRequest, { candidate: variation[0], principalVariation: variation })
      }
      return
    }

    const coordinate = text.match(/^(\d+),(\d+)(?:\s|$)/)
    if (coordinate) {
      completeRequest({ x: Number(coordinate[1]), y: Number(coordinate[2]) })
      return
    }
  }

  self.postMessage({ type: 'log', level: /^ERROR\b/i.test(text) ? 'error' : 'info', message: text })
}

async function beginSearch(data) {
  const module = await ensureEngine(data.requestId)
  const gameId = resolveGameId(data)
  const budget = searchBudget(data)
  const newSession = currentGameId !== gameId

  configureEngine(module, budget)
  if (newSession) {
    const reusedPrimedSession = enginePrimed && currentGameId === null
    if (!reusedPrimedSession) module.sendCommand(`START ${BOARD_SIZE}`)
    enginePrimed = false
    currentGameId = gameId
    sessionGeneration++
    postStatus(data.requestId, 'session', { gameId, newSession: true, reusedPrimedSession, sessionGeneration })
  }

  currentRequest = {
    id: data.requestId,
    gameId,
    mode: data.type,
    budget,
    started: performance.now(),
    depth: undefined,
    seldepth: undefined,
    nodes: undefined,
    speed: undefined,
    score: undefined,
    principalVariation: [],
    statusTimer: null,
  }
  postStatus(data.requestId, 'syncing', { gameId, newSession, sessionGeneration, budget })
  syncFullBoard(module, data)
  postStatus(data.requestId, data.type === 'analyze' ? 'analyzing' : 'thinking', { gameId, budget })
  currentRequest.statusTimer = setInterval(() => {
    if (!currentRequest || currentRequest.id !== data.requestId) return
    postStatus(data.requestId, data.type === 'analyze' ? 'analyzing' : 'thinking', {
      gameId,
      budget,
      elapsed: Math.round(performance.now() - currentRequest.started),
    })
  }, 250)
  module.sendCommand('YXNBEST 1')
}

async function processNext() {
  if (currentRequest || startingRequest || !queue.length) return
  const data = queue.shift()
  startingRequest = true
  try {
    await beginSearch(data)
  } catch (error) {
    if (currentRequest?.id === data.requestId) {
      clearRequestTimer(currentRequest)
      currentRequest = null
    }
    self.postMessage({ type: 'error', requestId: data.requestId, message: error.message })
  } finally {
    startingRequest = false
    if (!currentRequest) Promise.resolve().then(processNext)
  }
}

function enqueue(data) {
  queue.push(data)
  if (currentRequest || startingRequest) postStatus(data.requestId, 'queued', { position: queue.length })
  processNext()
}

async function warmup(data, legacyInit = false) {
  postStatus(data.requestId, 'warming', { message: '正在载入 Rapfi 核心与官方 NNUE' })
  await ensureEngine(data.requestId)
  if (!modelVerified) throw new Error('Rapfi NNUE 未通过就绪校验')
  postStatus(data.requestId, 'ready', { status: 'ready', message: 'Rapfi 与官方 mix9svq NNUE 已就绪' })
  const payload = {
    ready: true,
    engine: ENGINE_NAME,
    evaluator: 'mix9svq',
    modelVerified: true,
    modelHash: FREESTYLE_WEIGHT_SHA256,
  }
  self.postMessage(legacyInit
    ? { type: 'ready', requestId: data.requestId, result: payload }
    : { type: 'result', requestId: data.requestId, result: payload })
}

self.onmessage = async ({ data }) => {
  try {
    if (data.type === 'init' || data.type === 'warmup') await warmup(data, data.type === 'init')
    else if (data.type === 'think' || data.type === 'analyze') enqueue(data)
    else self.postMessage({ type: 'error', requestId: data.requestId, message: `不支持的 AI 请求：${data.type}` })
  } catch (error) {
    self.postMessage({ type: 'error', requestId: data.requestId, message: error.message })
  }
}
