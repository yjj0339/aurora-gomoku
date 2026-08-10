export class AiClient {
  constructor(onProgress = () => {}) {
    this.onProgress = onProgress
    this.requests = new Map()
    this.counter = 0
    this.fallback = new Worker(new URL('./ai.worker.js', import.meta.url), { type: 'module' })
    this.fallback.onmessage = (event) => this.handle(event.data, 'fallback')
    this.rapfi = null
    this.rapfiFailed = false
  }

  handle(data, source) {
    if (data.type === 'progress') this.onProgress({ ...data, source })
    const pending = this.requests.get(data.requestId)
    if (!pending) return
    if (data.type === 'result') {
      this.requests.delete(data.requestId)
      pending.resolve(data.result)
    } else if (data.type === 'error') {
      this.requests.delete(data.requestId)
      pending.reject(new Error(data.message))
    }
  }

  ensureRapfi() {
    if (this.rapfi || this.rapfiFailed) return this.rapfi
    this.rapfi = new Worker(`${import.meta.env.BASE_URL}rapfi-worker.js`)
    this.rapfi.onmessage = (event) => this.handle(event.data, 'rapfi')
    this.rapfi.onerror = () => { this.rapfiFailed = true }
    return this.rapfi
  }

  request(worker, payload) {
    const requestId = ++this.counter
    return new Promise((resolve, reject) => {
      this.requests.set(requestId, { resolve, reject })
      worker.postMessage({ ...payload, requestId })
    })
  }

  async think(board, side, level, moves) {
    if (level >= 4 && !this.rapfiFailed) {
      try {
        const engine = this.ensureRapfi()
        if (engine) return await this.request(engine, { type: 'think', board: Array.from(board), side, level, moves })
      } catch (error) {
        console.warn('Rapfi unavailable; using the built-in deep-search engine.', error)
        this.rapfiFailed = true
      }
    }
    return this.request(this.fallback, { type: 'think', board: Array.from(board), side, level, moves })
  }

  dispose() {
    this.fallback.terminate()
    this.rapfi?.terminate()
  }
}
