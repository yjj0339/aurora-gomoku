import { findBestMove } from './ai-core.js'

self.onmessage = ({ data }) => {
  if (data.type !== 'think') return
  try {
    const result = findBestMove(data.board, data.side, data.level, (progress) => {
      self.postMessage({ type: 'progress', requestId: data.requestId, ...progress })
    })
    self.postMessage({ type: 'result', requestId: data.requestId, result })
  } catch (error) {
    self.postMessage({ type: 'error', requestId: data.requestId, message: error.message })
  }
}
