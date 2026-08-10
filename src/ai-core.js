import { BLACK, EMPTY, SIZE, at, inside, other, winnerFrom } from './game.js'

const WIN = 50_000_000
const DIRS = [[1, 0], [0, 1], [1, 1], [1, -1]]

export const LEVELS = [
  { id: 1, name: '初见', subtitle: '轻松熟悉棋盘', time: 120, depth: 1, width: 8, noise: 0.34 },
  { id: 2, name: '进阶', subtitle: '会进攻也会防守', time: 260, depth: 2, width: 10, noise: 0.12 },
  { id: 3, name: '大师', subtitle: '多步算路与反击', time: 720, depth: 4, width: 12, noise: 0 },
  { id: 4, name: '天穹', subtitle: '冠军引擎 · 极难', time: 2800, depth: 8, width: 14, noise: 0 },
  { id: 5, name: '神域', subtitle: '冠军引擎 · 全力', time: 7800, depth: 12, width: 18, noise: 0 },
]

function lineShape(board, x, y, side, dx, dy) {
  let count = 1
  let open = 0
  let gapBonus = 0
  for (const sign of [-1, 1]) {
    let step = 1
    let gap = false
    while (step <= 5) {
      const nx = x + dx * step * sign
      const ny = y + dy * step * sign
      if (!inside(nx, ny)) break
      const cell = board[at(nx, ny)]
      if (cell === side) {
        count++
        if (gap) gapBonus++
      } else if (cell === EMPTY && !gap) {
        const fx = nx + dx * sign
        const fy = ny + dy * sign
        if (inside(fx, fy) && board[at(fx, fy)] === side) {
          gap = true
          step++
          continue
        }
        open++
        break
      } else break
      step++
    }
  }
  return { count, open, gapBonus }
}

export function pointScore(board, x, y, side) {
  if (board[at(x, y)] !== EMPTY) return -1
  board[at(x, y)] = side
  let score = 0
  let fours = 0
  let threes = 0
  for (const [dx, dy] of DIRS) {
    const { count, open, gapBonus } = lineShape(board, x, y, side, dx, dy)
    if (count >= 5 && gapBonus === 0) score += WIN
    else if (count >= 5) score += open ? 620_000 : 210_000
    else if (count === 4 && open === 2) score += 2_000_000, fours++
    else if (count === 4 && open === 1) score += 380_000, fours++
    else if (count === 3 && open === 2) score += 120_000, threes++
    else if (count === 3 && open === 1) score += 18_000
    else if (count === 2 && open === 2) score += 4_000
    else if (count === 2 && open === 1) score += 600
    else score += count * count * 20 + open * 8
    score += gapBonus * (count >= 4 ? 90_000 : count >= 3 ? 8_000 : 500)
  }
  if (fours >= 2) score += 8_000_000
  if (fours && threes) score += 3_000_000
  if (threes >= 2) score += 700_000
  board[at(x, y)] = EMPTY
  return score
}

export function candidates(board, side, limit = 14) {
  if (!board.some((v) => v !== EMPTY)) return [{ x: 7, y: 7, score: 1 }]
  const seen = new Uint8Array(SIZE * SIZE)
  const list = []
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      if (board[at(x, y)] === EMPTY) continue
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const nx = x + dx
          const ny = y + dy
          if (!inside(nx, ny) || board[at(nx, ny)] !== EMPTY || seen[at(nx, ny)]) continue
          seen[at(nx, ny)] = 1
          const attack = pointScore(board, nx, ny, side)
          const defense = pointScore(board, nx, ny, other(side))
          const center = 14 - Math.abs(nx - 7) - Math.abs(ny - 7)
          list.push({ x: nx, y: ny, attack, defense, score: Math.max(attack, defense * 0.93) + Math.min(attack, defense) * 0.08 + center })
        }
      }
    }
  }
  list.sort((a, b) => b.score - a.score)
  const forced = list.filter((m) => m.attack >= WIN || m.defense >= WIN)
  return forced.length ? forced : list.slice(0, limit)
}

function evaluate(board, aiSide) {
  const mine = candidates(board, aiSide, 5)
  const theirs = candidates(board, other(aiSide), 5)
  const mineScore = mine.reduce((sum, move, index) => sum + move.attack / (index + 1), 0)
  const theirScore = theirs.reduce((sum, move, index) => sum + move.attack / (index + 1), 0)
  return mineScore - theirScore * 1.08
}

function hashBoard(board, side) {
  let hash = side === BLACK ? 2166136261 : 16777619
  for (let i = 0; i < board.length; i++) {
    if (board[i]) hash = Math.imul(hash ^ ((i + 1) * (board[i] + 11)), 16777619)
  }
  return hash >>> 0
}

export function findBestMove(inputBoard, side, level = 3, onProgress = () => {}) {
  const board = Uint8Array.from(inputBoard)
  const config = LEVELS[Math.max(0, Math.min(LEVELS.length - 1, level - 1))]
  const started = performance.now()
  const deadline = started + config.time
  const table = new Map()
  let nodes = 0
  let timedOut = false
  let root = candidates(board, side, config.width)
  if (!root.length) return { x: 7, y: 7, depth: 0, nodes: 0, score: 0 }

  const immediateWin = root.find((m) => m.attack >= WIN)
  if (immediateWin) return { ...immediateWin, depth: 1, nodes: 1 }
  const immediateBlock = root.find((m) => m.defense >= WIN)
  if (immediateBlock) root = [immediateBlock, ...root.filter((m) => m !== immediateBlock)]

  if (config.noise) {
    const pool = root.slice(0, Math.min(5, root.length))
    if (Math.random() < config.noise) return { ...pool[Math.floor(Math.random() * pool.length)], depth: 1, nodes: pool.length }
  }

  const search = (depth, alpha, beta, current, lastMove, ply) => {
    nodes++
    if ((nodes & 1023) === 0 && performance.now() >= deadline) {
      timedOut = true
      return 0
    }
    if (lastMove && winnerFrom(board, lastMove.x, lastMove.y)) return -WIN + ply
    if (depth <= 0) return (current === side ? 1 : -1) * evaluate(board, side)
    const key = `${hashBoard(board, current)}:${depth}`
    const cached = table.get(key)
    if (cached && cached.depth >= depth) return cached.score
    const width = Math.max(5, Math.min(config.width, config.width - ply * 2))
    const moves = candidates(board, current, width)
    if (!moves.length) return 0
    let best = -Infinity
    for (const move of moves) {
      board[at(move.x, move.y)] = current
      const value = -search(depth - 1, -beta, -alpha, other(current), move, ply + 1)
      board[at(move.x, move.y)] = EMPTY
      if (timedOut) return 0
      if (value > best) best = value
      if (value > alpha) alpha = value
      if (alpha >= beta) break
    }
    table.set(key, { depth, score: best })
    return best
  }

  let bestMove = root[0]
  let bestScore = -Infinity
  let completedDepth = 0
  const maxDepth = level <= 2 ? config.depth : config.depth
  for (let depth = 1; depth <= maxDepth; depth++) {
    let iterationBest = root[0]
    let iterationScore = -Infinity
    for (const move of root) {
      board[at(move.x, move.y)] = side
      const value = -search(depth - 1, -Infinity, Infinity, other(side), move, 1)
      board[at(move.x, move.y)] = EMPTY
      if (timedOut) break
      move.searchScore = value
      if (value > iterationScore) iterationScore = value, iterationBest = move
    }
    if (timedOut) break
    bestMove = iterationBest
    bestScore = iterationScore
    completedDepth = depth
    root.sort((a, b) => (b.searchScore ?? -Infinity) - (a.searchScore ?? -Infinity))
    onProgress({ depth, nodes, score: bestScore })
    if (Math.abs(bestScore) >= WIN - 100) break
  }
  return { x: bestMove.x, y: bestMove.y, score: bestScore, depth: completedDepth, nodes, elapsed: Math.round(performance.now() - started), engine: '雾弈策略引擎' }
}
