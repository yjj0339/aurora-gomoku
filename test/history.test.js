import test, { beforeEach } from 'node:test'
import assert from 'node:assert/strict'

import {
  clearUnfinishedGame,
  computeStats,
  createBackup,
  getAnalysis,
  importBackup,
  loadAnalysisCache,
  loadHistory,
  loadSettings,
  loadUnfinishedGame,
  saveAnalysis,
  saveRecord,
  saveSettings,
  saveUnfinishedGame,
} from '../src/history.js'

class LocalStorageMock {
  #values = new Map()

  getItem(key) {
    return this.#values.has(String(key)) ? this.#values.get(String(key)) : null
  }

  setItem(key, value) {
    this.#values.set(String(key), String(value))
  }

  removeItem(key) {
    this.#values.delete(String(key))
  }

  clear() {
    this.#values.clear()
  }
}

globalThis.localStorage = new LocalStorageMock()

beforeEach(() => {
  localStorage.clear()
})

test('migrates v1 history and settings into the versioned v2 store', () => {
  const legacyRecord = { id: 'legacy-1', blackName: '\u4f60', whiteName: 'AI', moves: [] }
  localStorage.setItem('aurora-gomoku-history-v1', JSON.stringify([legacyRecord]))
  localStorage.setItem('aurora-gomoku-settings-v1', JSON.stringify({ theme: 'mist', sound: false }))

  assert.deepEqual(loadHistory(), [legacyRecord])
  assert.deepEqual(loadSettings(), { theme: 'mist', sound: false })

  const migrated = JSON.parse(localStorage.getItem('aurora-gomoku-data-v2'))
  assert.equal(migrated.version, 2)
  assert.deepEqual(migrated.history, [legacyRecord])
  assert.deepEqual(migrated.settings, { theme: 'mist', sound: false })

  localStorage.setItem('aurora-gomoku-history-v1', '[]')
  assert.deepEqual(loadHistory(), [legacyRecord])
})

test('computes player-only statistics without mutating history', () => {
  const history = [
    { id: 'r4', blackName: 'AI', whiteName: '\u4f60', mode: 'ai', level: 5, resultCode: '0', endedAt: '2026-01-04T00:00:00Z', moves: Array(8) },
    { id: 'r3', blackName: '\u4f60', whiteName: 'AI', mode: 'ai', level: 5, resultCode: 'W+R', endedAt: '2026-01-03T00:00:00Z', moves: Array(6) },
    { id: 'r2', blackName: 'Opponent', whiteName: '\u4f60', mode: 'online', resultCode: 'W+R', endedAt: '2026-01-02T00:00:00Z', moves: Array(4) },
    { id: 'r1', blackName: '\u4f60', whiteName: 'AI', mode: 'ai', level: 1, resultCode: 'B+R', endedAt: '2026-01-01T00:00:00Z', moves: Array(2) },
    { id: 'ignored', blackName: 'A', whiteName: 'B', mode: 'online', resultCode: 'B+R', moves: Array(100) },
  ]
  const originalOrder = history.map((record) => record.id)

  const stats = computeStats(history)

  assert.deepEqual(history.map((record) => record.id), originalOrder)
  assert.deepEqual(
    { total: stats.total, wins: stats.wins, losses: stats.losses, draws: stats.draws },
    { total: 4, wins: 2, losses: 1, draws: 1 },
  )
  assert.equal(stats.winRate, 50)
  assert.equal(stats.avgMoves, 5)
  assert.equal(stats.bestStreak, 2)
  assert.deepEqual(stats.black, { total: 2, wins: 1, losses: 1, draws: 0, winRate: 50 })
  assert.deepEqual(stats.white, { total: 2, wins: 1, losses: 0, draws: 1, winRate: 50 })
  assert.deepEqual(stats.online, { total: 1, wins: 1, losses: 0, draws: 0, winRate: 100 })
  assert.deepEqual(stats.byLevel[5], { level: 5, total: 2, wins: 0, losses: 1, draws: 1, winRate: 0 })
  assert.deepEqual(stats.recent10.map(({ id, outcome }) => [id, outcome]), [
    ['r4', 'draw'], ['r3', 'loss'], ['r2', 'win'], ['r1', 'win'],
  ])
  assert.deepEqual(stats.challenges[0], {
    target: 10, current: 4, remaining: 6, progress: 40, completed: false,
  })
})

test('saves, loads and clears an unfinished game with typed board data', () => {
  const game = { id: 'game-1', mode: 'ai', board: new Uint8Array([1, 0, 2]), moves: [{ x: 0, y: 0, side: 1 }] }

  assert.deepEqual(saveUnfinishedGame(game), {
    id: 'game-1', mode: 'ai', board: [1, 0, 2], moves: [{ x: 0, y: 0, side: 1 }],
  })
  assert.deepEqual(loadUnfinishedGame(), {
    id: 'game-1', mode: 'ai', board: [1, 0, 2], moves: [{ x: 0, y: 0, side: 1 }],
  })

  clearUnfinishedGame()
  assert.equal(loadUnfinishedGame(), null)
})

test('creates a full backup and imports records using newest-wins merge semantics', () => {
  saveSettings({ theme: 'cloud', sound: true })
  saveRecord({ id: 'same', title: 'local-newer', endedAt: '2026-03-03T00:00:00Z', moves: [] })
  saveRecord({ id: 'update', title: 'local-older', startedAt: '2026-01-01T00:00:00Z', moves: [] })
  saveUnfinishedGame({ id: 'local-game', mode: 'ai', moves: [] })
  saveAnalysis('same', 0, { score: 12 })

  const created = createBackup()
  assert.equal(created.format, 'aurora-gomoku-backup-v1')
  assert.deepEqual(created.settings, { theme: 'cloud', sound: true })
  assert.equal(created.history.length, 2)
  assert.deepEqual(created.unfinishedGame, { id: 'local-game', mode: 'ai', moves: [] })
  assert.deepEqual(created.analysis, { same: { 0: { score: 12 } } })

  const summary = importBackup(JSON.stringify({
    format: 'aurora-gomoku-backup-v1',
    settings: { theme: 'mint' },
    history: [
      { id: 'same', title: 'incoming-older', endedAt: '2026-02-02T00:00:00Z', moves: [] },
      { id: 'update', title: 'incoming-newer', endedAt: '2026-04-04T00:00:00Z', moves: [] },
      { id: 'added', title: 'incoming-new', endedAt: '2026-05-05T00:00:00Z', moves: [] },
    ],
    unfinishedGame: { id: 'restored-game', mode: 'ai', moves: [] },
    analysis: { same: { 2: { score: 99 } } },
  }))

  assert.deepEqual(summary, { added: 1, updated: 1, unchanged: 1, total: 3 })
  assert.deepEqual(loadHistory().map(({ id, title }) => ({ id, title })), [
    { id: 'added', title: 'incoming-new' },
    { id: 'update', title: 'incoming-newer' },
    { id: 'same', title: 'local-newer' },
  ])
  assert.deepEqual(loadSettings(), { theme: 'mint', sound: true })
  assert.deepEqual(loadUnfinishedGame(), { id: 'restored-game', mode: 'ai', moves: [] })
  assert.deepEqual(getAnalysis('same', 0), { score: 12 })
  assert.deepEqual(getAnalysis('same', 2), { score: 99 })
  assert.deepEqual(loadAnalysisCache(), { same: { 0: { score: 12 }, 2: { score: 99 } } })
})
