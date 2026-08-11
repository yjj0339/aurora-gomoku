import { adaptiveBudget } from './ai-core.js'

function normalizeMoves(moves) {
  if (!Array.isArray(moves)) return []
  return moves.map(({ x, y, side }) => ({ x: Number(x), y: Number(y), side: Number(side) }))
}

function sameMove(a, b) {
  return a?.x === b?.x && a?.y === b?.y && a?.side === b?.side
}

export function movesContinueGame(previous, next) {
  if (next.length < previous.length) return false
  return previous.every((move, index) => sameMove(move, next[index]))
}

/**
 * Supplies stable IDs to legacy callers that do not yet pass a gameId. A
 * shortened, reset, or branched move list starts a fresh engine session.
 */
export class AiGameSessionTracker {
  constructor(namespace = 'implicit-game') {
    this.namespace = namespace
    this.counter = 0
    this.initialized = false
    this.previousMoves = []
  }

  resolve(explicitGameId, moves = []) {
    if (explicitGameId !== undefined && explicitGameId !== null && String(explicitGameId).trim()) return String(explicitGameId)

    const nextMoves = normalizeMoves(moves)
    const samePosition = this.initialized
      && nextMoves.length === this.previousMoves.length
      && movesContinueGame(this.previousMoves, nextMoves)
    const continuation = this.initialized
      && nextMoves.length > this.previousMoves.length
      && movesContinueGame(this.previousMoves, nextMoves)
    // Two successive empty requests cannot be proven to be the same game;
    // favor isolation because there is no useful transposition state to keep.
    const repeatedEmpty = this.initialized && nextMoves.length === 0 && this.previousMoves.length === 0

    if (!this.initialized || repeatedEmpty || (!samePosition && !continuation)) this.counter++
    this.initialized = true
    this.previousMoves = nextMoves
    return `${this.namespace}-${this.counter}`
  }
}

export class AiClient {
  constructor(onProgress = () => {}) {
    this.onProgress = onProgress
    this.requests = new Map()
    this.counter = 0
    this.thinkSessions = new AiGameSessionTracker('implicit-game')
    this.analysisSessions = new AiGameSessionTracker('implicit-analysis')
    this.fallback = new Worker(new URL('./ai.worker.js', import.meta.url), { type: 'module' })
    this.fallback.onmessage = (event) => this.handle(event.data, 'fallback')
    this.fallback.onerror = (event) => this.rejectSource('fallback', new Error(event.message || '内置 AI 工作线程异常'))
    this.rapfi = null
    this.rapfiFailed = false
    this.rapfiWarmup = null
  }

  handle(data, source) {
    if (data.type === 'progress' || data.type === 'status') this.onProgress({ ...data, source })
    const pending = this.requests.get(data.requestId)
    if (!pending) return
    if (data.type === 'result' || data.type === 'ready') {
      this.requests.delete(data.requestId)
      clearTimeout(pending.timeout)
      pending.resolve(data.result ?? { ready: true })
    } else if (data.type === 'error') {
      this.requests.delete(data.requestId)
      clearTimeout(pending.timeout)
      pending.reject(new Error(data.message))
    }
  }

  rejectSource(source, error) {
    for (const [requestId, pending] of this.requests) {
      if (pending.source !== source) continue
      this.requests.delete(requestId)
      clearTimeout(pending.timeout)
      pending.reject(error)
    }
  }

  disableRapfi(error) {
    this.rapfiFailed = true
    this.rapfiWarmup = null
    this.onProgress({
      type: 'status',
      phase: 'model-error',
      source: 'rapfi',
      message: error?.message || 'Rapfi NNUE 引擎不可用',
    })
    this.rejectSource('rapfi', error)
    this.rapfi?.terminate()
    this.rapfi = null
  }

  ensureRapfi() {
    if (this.rapfi || this.rapfiFailed) return this.rapfi
    const baseUrl = import.meta.env?.BASE_URL || '/'
    this.rapfi = new Worker(`${baseUrl}rapfi-worker.js`)
    this.rapfi.onmessage = (event) => this.handle(event.data, 'rapfi')
    this.rapfi.onerror = (event) => this.disableRapfi(new Error(event.message || 'Rapfi 工作线程异常'))
    return this.rapfi
  }

  request(worker, payload, source) {
    if (!worker) return Promise.reject(new Error(`${source} AI 不可用`))
    const requestId = ++this.counter
    return new Promise((resolve, reject) => {
      const timeoutMs = payload.type === 'warmup'
        ? 30000
        : source === 'rapfi'
          ? Math.max(15000, (Number(payload.budget) || 0) + 10000)
          : 20000
      const timeout = setTimeout(() => {
        if (!this.requests.has(requestId)) return
        this.requests.delete(requestId)
        reject(new Error(`${source === 'rapfi' ? 'Rapfi' : '兼容'} AI 请求超时`))
      }, timeoutMs)
      this.requests.set(requestId, { resolve, reject, source, timeout })
      worker.postMessage({ ...payload, requestId })
    })
  }

  /** Preloads the Rapfi module and its model without starting or resetting a game. */
  warmup() {
    if (this.rapfiFailed) return Promise.reject(new Error('Rapfi NNUE 引擎不可用'))
    if (this.rapfiWarmup) return this.rapfiWarmup
    const engine = this.ensureRapfi()
    this.rapfiWarmup = this.request(engine, { type: 'warmup' }, 'rapfi')
      .then((result) => ({ ready: true, ...result }))
      .catch((error) => {
        console.warn('Rapfi preload failed; the built-in engine remains available.', error)
        this.disableRapfi(error)
        throw error
      })
    return this.rapfiWarmup
  }

  async think(board, side, level, moves, gameId) {
    const serializedBoard = Array.from(board)
    const serializedMoves = normalizeMoves(moves)
    if (level >= 4 && !this.rapfiFailed) {
      try {
        const warmup = await this.warmup()
        const engine = this.ensureRapfi()
        if (warmup.ready && engine) {
          return await this.request(engine, {
            type: 'think',
            board: serializedBoard,
            side,
            level,
            moves: serializedMoves,
            gameId: this.thinkSessions.resolve(gameId, serializedMoves),
            budget: adaptiveBudget(level, serializedBoard, side),
          }, 'rapfi')
        }
      } catch (error) {
        console.warn('Rapfi unavailable; using the built-in deep-search engine.', error)
        this.disableRapfi(error)
      }
    }
    return this.request(this.fallback, { type: 'think', board: serializedBoard, side, level, moves: serializedMoves }, 'fallback')
  }

  async analyze(board, side, moves, options = {}) {
    const { gameId, budget = 3000 } = options || {}
    const analysisBudget = Math.max(500, Math.min(8000, Number(budget) || 3000))
    const serializedBoard = Array.from(board)
    const serializedMoves = normalizeMoves(moves)

    if (!this.rapfiFailed) {
      try {
        const warmup = await this.warmup()
        const engine = this.ensureRapfi()
        if (warmup.ready && engine) {
          return await this.request(engine, {
            type: 'analyze',
            board: serializedBoard,
            side,
            moves: serializedMoves,
            gameId: this.analysisSessions.resolve(gameId, serializedMoves),
            budget: analysisBudget,
          }, 'rapfi')
        }
      } catch (error) {
        console.warn('Rapfi analysis unavailable; using the built-in deep-search engine.', error)
        this.disableRapfi(error)
      }
    }

    const result = await this.request(this.fallback, {
      type: 'think', board: serializedBoard, side, level: 4, moves: serializedMoves,
    }, 'fallback')
    const principalVariation = result.principalVariation || result.pv || [{ x: result.x, y: result.y }]
    return {
      ...result,
      analysis: true,
      budget: analysisBudget,
      pv: principalVariation,
      principalVariation,
    }
  }

  dispose() {
    const error = new Error('AI 客户端已关闭')
    this.rejectSource('fallback', error)
    this.rejectSource('rapfi', error)
    this.fallback.terminate()
    this.rapfi?.terminate()
  }
}
