import test from 'node:test'
import assert from 'node:assert/strict'
import { BLACK, WHITE, at, createBoard, recordToSgf, sgfToRecord, winnerFrom } from '../src/game.js'
import { findBestMove } from '../src/ai-core.js'

test('detects five stones in every main direction', () => {
  for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
    const board = createBoard()
    const origin = dy < 0 ? { x: 4, y: 9 } : { x: 4, y: 4 }
    for (let i = 0; i < 5; i++) board[at(origin.x + dx * i, origin.y + dy * i)] = BLACK
    const result = winnerFrom(board, origin.x + dx * 4, origin.y + dy * 4)
    assert.equal(result.side, BLACK)
    assert.equal(result.line.length, 5)
  }
})

test('round-trips an SGF record', () => {
  const record = {
    title: '测试棋谱', blackName: '甲', whiteName: '乙', resultCode: 'B+R',
    moves: [{ x: 7, y: 7, side: BLACK }, { x: 8, y: 7, side: WHITE }, { x: 6, y: 6, side: BLACK }],
  }
  const restored = sgfToRecord(recordToSgf(record))
  assert.equal(restored.title, record.title)
  assert.deepEqual(restored.moves, record.moves)
})

test('AI always takes an immediate win', () => {
  const board = createBoard()
  for (let x = 4; x < 8; x++) board[at(x, 7)] = WHITE
  board[at(3, 7)] = BLACK
  const result = findBestMove(board, WHITE, 1)
  assert.deepEqual({ x: result.x, y: result.y }, { x: 8, y: 7 })
})

test('AI blocks an immediate opponent win', () => {
  const board = createBoard()
  for (let x = 4; x < 8; x++) board[at(x, 6)] = BLACK
  board[at(3, 6)] = WHITE
  const result = findBestMove(board, WHITE, 2)
  assert.deepEqual({ x: result.x, y: result.y }, { x: 8, y: 6 })
})
