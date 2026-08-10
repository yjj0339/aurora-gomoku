export const SIZE = 15
export const EMPTY = 0
export const BLACK = 1
export const WHITE = 2

export function createBoard(size = SIZE) {
  return new Uint8Array(size * size)
}

export const at = (x, y, size = SIZE) => y * size + x
export const inside = (x, y, size = SIZE) => x >= 0 && y >= 0 && x < size && y < size
export const other = (side) => (side === BLACK ? WHITE : BLACK)

export function play(board, x, y, side, size = SIZE) {
  if (!inside(x, y, size) || board[at(x, y, size)] !== EMPTY) return false
  board[at(x, y, size)] = side
  return true
}

export function winnerFrom(board, x, y, size = SIZE) {
  const side = board[at(x, y, size)]
  if (!side) return null
  const directions = [[1, 0], [0, 1], [1, 1], [1, -1]]
  for (const [dx, dy] of directions) {
    const line = [{ x, y }]
    for (const sign of [-1, 1]) {
      let nx = x + dx * sign
      let ny = y + dy * sign
      const segment = []
      while (inside(nx, ny, size) && board[at(nx, ny, size)] === side) {
        segment.push({ x: nx, y: ny })
        nx += dx * sign
        ny += dy * sign
      }
      if (sign < 0) line.unshift(...segment.reverse())
      else line.push(...segment)
    }
    if (line.length >= 5) return { side, line }
  }
  return null
}

export function isFull(board) {
  return !board.includes(EMPTY)
}

export function moveLabel(move) {
  const letter = String.fromCharCode(65 + move.x + (move.x >= 8 ? 1 : 0))
  return `${letter}${SIZE - move.y}`
}

export function recordToSgf(record) {
  const escape = (value) => String(value ?? '').replaceAll('\\', '\\\\').replaceAll(']', '\\]')
  const props = [
    '(;GM[4]FF[4]CA[UTF-8]AP[雾弈:1.0]',
    `SZ[${record.size || SIZE}]`,
    `GN[${escape(record.title || '雾弈对局')}]`,
    `DT[${escape((record.endedAt || record.startedAt || new Date().toISOString()).slice(0, 10))}]`,
    `PB[${escape(record.blackName || '黑方')}]`,
    `PW[${escape(record.whiteName || '白方')}]`,
    `RE[${escape(record.resultCode || 'Void')}]`,
  ]
  for (const move of record.moves || []) {
    const point = `${String.fromCharCode(97 + move.x)}${String.fromCharCode(97 + move.y)}`
    props.push(`;${move.side === BLACK ? 'B' : 'W'}[${point}]`)
  }
  props.push(')')
  return props.join('')
}

export function sgfToRecord(text) {
  const size = Number(text.match(/SZ\[(\d+)\]/)?.[1] || SIZE)
  if (size !== SIZE) throw new Error('目前仅支持 15×15 棋谱')
  const moves = []
  const matcher = /;([BW])\[([a-o])([a-o])\]/gi
  let match
  while ((match = matcher.exec(text))) {
    moves.push({
      x: match[2].toLowerCase().charCodeAt(0) - 97,
      y: match[3].toLowerCase().charCodeAt(0) - 97,
      side: match[1].toUpperCase() === 'B' ? BLACK : WHITE,
    })
  }
  if (!moves.length) throw new Error('没有识别到有效落子')
  const prop = (name, fallback) => text.match(new RegExp(`${name}\\[([^\\]]*)\\]`))?.[1] || fallback
  return {
    id: crypto.randomUUID(),
    size,
    title: prop('GN', '导入棋谱'),
    blackName: prop('PB', '黑方'),
    whiteName: prop('PW', '白方'),
    resultCode: prop('RE', 'Void'),
    startedAt: new Date().toISOString(),
    endedAt: new Date().toISOString(),
    mode: 'imported',
    moves,
  }
}

export function boardAtMove(moves, count = moves.length, size = SIZE) {
  const board = createBoard(size)
  for (const move of moves.slice(0, count)) board[at(move.x, move.y, size)] = move.side
  return board
}
