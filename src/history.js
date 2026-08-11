const HISTORY_KEY = 'aurora-gomoku-history-v1'
const SETTINGS_KEY = 'aurora-gomoku-settings-v1'
const DATA_KEY = 'aurora-gomoku-data-v2'
const DATA_VERSION = 2
const HISTORY_LIMIT = 200
const BACKUP_FORMAT = 'aurora-gomoku-backup-v1'

function emptyData() {
  return {
    version: DATA_VERSION,
    history: [],
    settings: {},
    unfinishedGame: null,
    analysis: {},
  }
}

function parseStored(key, fallback) {
  try {
    const value = localStorage.getItem(key)
    return value === null ? fallback : JSON.parse(value)
  } catch {
    return fallback
  }
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function normalizeAnalysis(value) {
  if (!isObject(value)) return {}
  const normalized = {}
  for (const [recordId, moves] of Object.entries(value)) {
    if (!recordId || !isObject(moves)) continue
    normalized[recordId] = { ...moves }
  }
  return normalized
}

function normalizeData(value) {
  const data = emptyData()
  if (!isObject(value)) return data
  data.history = Array.isArray(value.history) ? value.history : []
  data.settings = isObject(value.settings) ? value.settings : {}
  data.unfinishedGame = isObject(value.unfinishedGame) ? value.unfinishedGame : null
  data.analysis = normalizeAnalysis(value.analysis)
  return data
}

function persistData(data) {
  localStorage.setItem(DATA_KEY, JSON.stringify({ ...data, version: DATA_VERSION }))
}

function readData() {
  const stored = parseStored(DATA_KEY, null)
  if (isObject(stored) && stored.version === DATA_VERSION) return normalizeData(stored)

  const data = emptyData()
  const oldHistory = parseStored(HISTORY_KEY, [])
  const oldSettings = parseStored(SETTINGS_KEY, {})
  data.history = Array.isArray(oldHistory) ? oldHistory : []
  data.settings = isObject(oldSettings) ? oldSettings : {}
  persistData(data)
  return data
}

function serializable(value) {
  return JSON.parse(JSON.stringify(value, (_key, item) => (
    ArrayBuffer.isView(item) ? Array.from(item) : item
  )))
}

function recordTimestamp(record) {
  for (const candidate of [record?.endedAt, record?.startedAt]) {
    const value = Date.parse(candidate || '')
    if (Number.isFinite(value)) return value
  }
  return 0
}

function sortNewest(records) {
  return records
    .map((record, index) => ({ record, index }))
    .sort((a, b) => recordTimestamp(b.record) - recordTimestamp(a.record) || a.index - b.index)
    .map(({ record }) => record)
}

export function loadHistory() {
  return readData().history
}

export function saveRecord(record) {
  const data = readData()
  const history = [record, ...data.history.filter((item) => item.id !== record.id)]
  data.history = history.slice(0, HISTORY_LIMIT)
  persistData(data)
  return history
}

export function deleteRecord(id) {
  const data = readData()
  const history = data.history.filter((item) => item.id !== id)
  data.history = history
  persistData(data)
  return history
}

export function loadSettings() {
  return readData().settings
}

export function saveSettings(settings) {
  const data = readData()
  data.settings = isObject(settings) ? settings : {}
  persistData(data)
}

export function loadUnfinishedGame() {
  return readData().unfinishedGame
}

export function saveUnfinishedGame(game) {
  if (!isObject(game)) throw new TypeError('Unfinished game must be an object')
  const data = readData()
  data.unfinishedGame = serializable(game)
  persistData(data)
  return data.unfinishedGame
}

export function clearUnfinishedGame() {
  const data = readData()
  data.unfinishedGame = null
  persistData(data)
}

export function loadAnalysisCache() {
  return readData().analysis
}

export function getAnalysis(recordId, moveIndex) {
  if (typeof recordId !== 'string' || !recordId || !Number.isInteger(moveIndex) || moveIndex < 0) return null
  const moves = readData().analysis[recordId]
  return moves && Object.prototype.hasOwnProperty.call(moves, moveIndex) ? moves[moveIndex] : null
}

export function saveAnalysis(recordId, moveIndex, result) {
  if (typeof recordId !== 'string' || !recordId) throw new TypeError('Record ID is required')
  if (!Number.isInteger(moveIndex) || moveIndex < 0) throw new TypeError('Move index must be a non-negative integer')
  if (result === undefined) throw new TypeError('Analysis result is required')
  const data = readData()
  const saved = serializable(result)
  data.analysis[recordId] = { ...(data.analysis[recordId] || {}), [moveIndex]: saved }
  persistData(data)
  return saved
}

function emptyBreakdown(extra = {}) {
  return { ...extra, total: 0, wins: 0, losses: 0, draws: 0, winRate: 0 }
}

function playerSide(record) {
  if (String(record?.blackName || '').trim() === '\u4f60') return 'black'
  if (String(record?.whiteName || '').trim() === '\u4f60') return 'white'
  return null
}

function winnerSide(record) {
  const winner = String(record?.winner).toLowerCase()
  if (record?.winner === 1 || winner === 'black' || winner === 'b') return 'black'
  if (record?.winner === 2 || winner === 'white' || winner === 'w') return 'white'

  const code = String(record?.resultCode || '').trim()
  if (/^B\+/i.test(code)) return 'black'
  if (/^W\+/i.test(code)) return 'white'
  return null
}

function outcomeFor(record, side) {
  const explicit = String(record?.result || '').toLowerCase()
  if (['win', 'won', 'victory'].includes(explicit)) return 'win'
  if (['loss', 'lose', 'lost', 'defeat'].includes(explicit)) return 'loss'
  if (['draw', 'tie'].includes(explicit)) return 'draw'

  const winner = winnerSide(record)
  if (winner) return winner === side ? 'win' : 'loss'
  return 'draw'
}

function addOutcome(bucket, outcome) {
  bucket.total += 1
  if (outcome === 'win') bucket.wins += 1
  else if (outcome === 'loss') bucket.losses += 1
  else bucket.draws += 1
}

function finishBreakdown(bucket) {
  bucket.winRate = bucket.total ? Math.round((bucket.wins / bucket.total) * 1000) / 10 : 0
  return bucket
}

export function computeStats(history) {
  const black = emptyBreakdown()
  const white = emptyBreakdown()
  const online = emptyBreakdown()
  const byLevel = Object.fromEntries(
    [1, 2, 3, 4, 5].map((level) => [level, emptyBreakdown({ level })]),
  )

  const games = (Array.isArray(history) ? history : [])
    .map((record) => ({ record, side: playerSide(record) }))
    .filter(({ side }) => side)
    .map(({ record, side }) => ({
      record,
      side,
      outcome: outcomeFor(record, side),
      timestamp: recordTimestamp(record),
    }))

  let moves = 0
  for (const game of games) {
    addOutcome(game.side === 'black' ? black : white, game.outcome)
    if (game.record.mode === 'online') addOutcome(online, game.outcome)
    const level = Number(game.record.level)
    if (game.record.mode === 'ai' && Number.isInteger(level) && byLevel[level]) {
      addOutcome(byLevel[level], game.outcome)
    }
    moves += Array.isArray(game.record.moves) ? game.record.moves.length : 0
  }

  const chronological = [...games].sort((a, b) => a.timestamp - b.timestamp)
  let streak = 0
  let bestStreak = 0
  for (const game of chronological) {
    streak = game.outcome === 'win' ? streak + 1 : 0
    bestStreak = Math.max(bestStreak, streak)
  }

  const wins = black.wins + white.wins
  const losses = black.losses + white.losses
  const draws = black.draws + white.draws
  const total = games.length
  const recent10 = [...games]
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, 10)
    .map(({ record, side, outcome }) => ({
      id: record.id,
      outcome,
      side,
      mode: record.mode,
      level: record.level ?? null,
      date: record.endedAt || record.startedAt || null,
    }))

  const challenges = [10, 50, 100].map((target) => ({
    target,
    current: Math.min(total, target),
    remaining: Math.max(0, target - total),
    progress: Math.min(100, Math.round((total / target) * 100)),
    completed: total >= target,
  }))

  finishBreakdown(black)
  finishBreakdown(white)
  finishBreakdown(online)
  Object.values(byLevel).forEach(finishBreakdown)

  return {
    total,
    wins,
    losses,
    draws,
    winRate: total ? Math.round((wins / total) * 1000) / 10 : 0,
    avgMoves: total ? Math.round((moves / total) * 10) / 10 : 0,
    bestStreak,
    black,
    white,
    online,
    byLevel,
    recent10,
    challenges,
  }
}

export function createBackup() {
  const data = readData()
  return serializable({
    format: BACKUP_FORMAT,
    exportedAt: new Date().toISOString(),
    settings: data.settings,
    history: data.history,
    unfinishedGame: data.unfinishedGame,
    analysis: data.analysis,
  })
}

function parseBackup(input) {
  let backup = input
  if (typeof input === 'string') {
    try {
      backup = JSON.parse(input)
    } catch {
      throw new TypeError('Backup is not valid JSON')
    }
  }
  if (!isObject(backup) || backup.format !== BACKUP_FORMAT) throw new TypeError('Unsupported backup format')
  if (!Array.isArray(backup.history)) throw new TypeError('Backup history is invalid')
  if (!isObject(backup.settings)) throw new TypeError('Backup settings are invalid')
  if (backup.unfinishedGame !== null && backup.unfinishedGame !== undefined && !isObject(backup.unfinishedGame)) {
    throw new TypeError('Backup unfinished game is invalid')
  }
  if (!isObject(backup.analysis)) throw new TypeError('Backup analysis cache is invalid')
  for (const [recordId, moves] of Object.entries(backup.analysis)) {
    if (!recordId || !isObject(moves)) throw new TypeError('Backup analysis cache is invalid')
  }
  for (const record of backup.history) {
    if (!isObject(record) || typeof record.id !== 'string' || !record.id) throw new TypeError('Backup contains an invalid record')
    if (record.moves !== undefined && !Array.isArray(record.moves)) throw new TypeError('Backup record moves are invalid')
  }
  return backup
}

export function importBackup(input) {
  const backup = parseBackup(input)
  const data = readData()
  const incomingById = new Map()
  for (const record of backup.history) {
    const previous = incomingById.get(record.id)
    if (!previous || recordTimestamp(record) > recordTimestamp(previous)) incomingById.set(record.id, record)
  }

  const recordsById = new Map(data.history.map((record) => [record.id, record]))
  let added = 0
  let updated = 0
  let unchanged = 0
  for (const [id, incoming] of incomingById) {
    const existing = recordsById.get(id)
    if (!existing) {
      recordsById.set(id, incoming)
      added += 1
    } else if (recordTimestamp(incoming) > recordTimestamp(existing)) {
      recordsById.set(id, incoming)
      updated += 1
    } else {
      unchanged += 1
    }
  }

  data.history = sortNewest([...recordsById.values()]).slice(0, HISTORY_LIMIT)
  data.settings = { ...data.settings, ...backup.settings }
  data.unfinishedGame = backup.unfinishedGame === undefined ? data.unfinishedGame : backup.unfinishedGame
  data.analysis = {
    ...data.analysis,
    ...Object.fromEntries(Object.entries(normalizeAnalysis(backup.analysis)).map(([recordId, moves]) => [
      recordId,
      { ...(data.analysis[recordId] || {}), ...moves },
    ])),
  }
  persistData(data)
  return { added, updated, unchanged, total: data.history.length }
}

export function downloadText(filename, text, type = 'text/plain;charset=utf-8') {
  const link = document.createElement('a')
  link.href = URL.createObjectURL(new Blob([text], { type }))
  link.download = filename
  link.click()
  setTimeout(() => URL.revokeObjectURL(link.href), 1000)
}
