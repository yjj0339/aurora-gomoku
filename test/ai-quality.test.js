import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { BLACK, WHITE, at, createBoard } from '../src/game.js'
import { adaptiveBudget, assessComplexity, findBestMove } from '../src/ai-core.js'
import { AiGameSessionTracker, movesContinueGame } from '../src/ai-client.js'

function place(board, side, points) {
  for (const [x, y] of points) board[at(x, y)] = side
  return board
}

const OFFICIAL_WEIGHT_START = 6709
const OFFICIAL_WEIGHT_END = 10037107
const OFFICIAL_WEIGHT_SHA256 = '6bc0d1b0ff8e1d857f7f412923cd458f38f1a435087c91ae71fec3676c23ef62'
const LEGACY_MODEL_ENTRY = 'binary_file = "model210901.bin"'

async function createRapfiHarness({ failModel = false } = {}) {
  const source = await readFile(new URL('../public/rapfi-worker.js', import.meta.url), 'utf8')
  const commands = []
  const messages = []
  const waiters = new Map()
  const dataBytes = new Uint8Array(OFFICIAL_WEIGHT_END)
  const marker = new TextEncoder().encode(LEGACY_MODEL_ENTRY)
  const markerOffset = 128
  dataBytes.set(marker, markerOffset)
  const digestBytes = Uint8Array.from(OFFICIAL_WEIGHT_SHA256.match(/../g), (value) => Number.parseInt(value, 16))
  let stdout = () => {}
  let exit = () => {}
  let failNextSearch = false
  let legacyEntryPatched = false

  const workerSelf = {
    location: { href: 'https://example.test/rapfi-worker.js' },
    crypto: { subtle: { digest: async () => digestBytes.buffer.slice(0) } },
    postMessage(message) {
      messages.push(message)
      if ((message.type === 'result' || message.type === 'error') && waiters.has(message.requestId)) {
        waiters.get(message.requestId)(message)
        waiters.delete(message.requestId)
      }
    },
    Rapfi: async (options) => {
      const patchedData = new Uint8Array(options.getPreloadedPackage())
      legacyEntryPatched = patchedData[markerOffset] === '#'.charCodeAt(0)
      stdout = options.onReceiveStdout
      exit = options.onExit
      if (failModel) stdout('ERROR Failed to load model from ["model210901.bin"].')
      else {
        stdout('MESSAGE Evaluator set to mix9svq.')
        stdout('MESSAGE mix9svq nnue: weight loaded in 3ms')
      }
      return {
        sendCommand(command) {
          commands.push(command)
          if (command === 'YXNBEST 1') queueMicrotask(() => {
            if (failNextSearch) {
              failNextSearch = false
              exit(7)
              return
            }
            stdout('MESSAGE Depth 14-21 | Eval -398 | Time 1982ms | G6 F7')
            stdout('MESSAGE Speed 38476 | Depth 14-21 | Eval -398 | Node 76K | Time 1982ms')
            stdout('MESSAGE Bestline G6 F7')
            stdout('MESSAGE Speed 167K | Depth 39-9 | Eval -M12 | Node 1040K | Time 6209ms')
            stdout('6,5')
          })
        },
      }
    },
  }
  const context = vm.createContext({
    self: workerSelf,
    importScripts() {},
    fetch: async () => ({ ok: true, status: 200, arrayBuffer: async () => dataBytes.buffer }),
    TextEncoder,
    URL,
    Uint8Array,
    performance,
    setInterval,
    clearInterval,
    setTimeout,
    clearTimeout,
    queueMicrotask,
    Promise,
  })
  vm.runInContext(source, context, { filename: 'rapfi-worker.js' })

  const run = async (data) => {
    const result = new Promise((resolve) => waiters.set(data.requestId, resolve))
    await workerSelf.onmessage({ data })
    return result
  }

  return {
    commands,
    messages,
    run,
    legacyEntryPatched: () => legacyEntryPatched,
    failNextSearch: () => { failNextSearch = true },
  }
}

test('quality gate: immediate wins and unique blocks always receive the full budget', () => {
  const winning = place(createBoard(), BLACK, [[4, 7], [5, 7], [6, 7], [7, 7]])
  winning[at(3, 7)] = WHITE
  const winAssessment = assessComplexity(winning, BLACK)
  assert.equal(winAssessment.immediateWin, true)
  assert.equal(adaptiveBudget(4, winning, BLACK), 3000)
  assert.equal(adaptiveBudget(5, winning, BLACK), 8000)
  const winningMove = findBestMove(winning, BLACK, 1)
  assert.deepEqual({ x: winningMove.x, y: winningMove.y }, { x: 8, y: 7 })

  const blocking = Uint8Array.from(winning)
  const blockAssessment = assessComplexity(blocking, WHITE)
  assert.equal(blockAssessment.immediateBlock, true)
  assert.equal(adaptiveBudget(5, blocking, WHITE), 8000)
  const blockingMove = findBestMove(blocking, WHITE, 2)
  assert.deepEqual({ x: blockingMove.x, y: blockingMove.y }, { x: 8, y: 7 })
})

test('quality gate: fours, open threes, and double threats use maximum search time', () => {
  const four = place(createBoard(), BLACK, [[6, 7], [7, 7], [8, 7]])
  const fourAssessment = assessComplexity(four, BLACK)
  assert.equal(fourAssessment.four, true)
  assert.equal(adaptiveBudget(4, four, BLACK), 3000)

  const openThree = place(createBoard(), BLACK, [[6, 7], [7, 7]])
  const threeAssessment = assessComplexity(openThree, BLACK)
  assert.equal(threeAssessment.openThree, true)
  assert.equal(adaptiveBudget(5, openThree, BLACK), 8000)

  const fork = place(createBoard(), BLACK, [[6, 7], [8, 7], [7, 6], [7, 8]])
  const forkAssessment = assessComplexity(fork, BLACK)
  assert.equal(forkAssessment.doubleThreat, true)
  assert.equal(adaptiveBudget(5, fork, BLACK), 8000)
})

test('quiet positions use faster deterministic budgets without mutating the board', () => {
  const board = place(createBoard(), BLACK, [[7, 7]])
  const snapshot = Array.from(board)
  assert.deepEqual(assessComplexity(board, WHITE), {
    tactical: false,
    immediateWin: false,
    immediateBlock: false,
    four: false,
    openThree: false,
    doubleThreat: false,
  })
  assert.equal(adaptiveBudget(4, board, WHITE), 2000)
  assert.equal(adaptiveBudget(5, board, WHITE), 5000)
  assert.deepEqual(Array.from(board), snapshot)
})

test('implicit session IDs persist only across a true move-list continuation', () => {
  const tracker = new AiGameSessionTracker('test-game')
  const first = [{ x: 7, y: 7, side: BLACK }]
  const continued = [...first, { x: 8, y: 7, side: WHITE }]
  const branched = [...first, { x: 6, y: 7, side: WHITE }]
  const firstId = tracker.resolve(undefined, first)
  assert.equal(tracker.resolve(undefined, continued), firstId)
  assert.notEqual(tracker.resolve(undefined, branched), firstId)
  assert.equal(tracker.resolve('saved-game-42', []), 'saved-game-42')
  assert.equal(movesContinueGame(first, continued), true)
  assert.equal(movesContinueGame(continued, first), false)

  const emptyTracker = new AiGameSessionTracker('empty-game')
  assert.notEqual(emptyTracker.resolve(undefined, []), emptyTracker.resolve(undefined, []))
})

test('bundled freestyle NNUE is byte-identical to the pinned official weight', async () => {
  const data = await readFile(new URL('../public/engine/rapfi-single-simd128.data', import.meta.url))
  const hash = createHash('sha256').update(data.subarray(OFFICIAL_WEIGHT_START, OFFICIAL_WEIGHT_END)).digest('hex')
  assert.equal(hash, OFFICIAL_WEIGHT_SHA256)
})

test('Rapfi warmup rejects model failures instead of reporting a false ready state', async () => {
  const { messages, run } = await createRapfiHarness({ failModel: true })
  const response = await run({ type: 'warmup', requestId: 90 })
  assert.equal(response.type, 'error')
  assert.match(response.message, /NNUE 加载失败/)
  assert.equal(messages.some((message) => message.phase === 'model-error'), true)
  assert.equal(messages.some((message) => message.phase === 'ready'), false)
})

test('Rapfi worker verifies NNUE, parses real stats, and reuses only the current game session', async () => {
  const { commands, messages, run, legacyEntryPatched } = await createRapfiHarness()
  const boardA1 = createBoard()
  boardA1[at(7, 7)] = BLACK
  const boardA2 = Uint8Array.from(boardA1)
  boardA2[at(8, 7)] = WHITE
  const warmupMessage = await run({ type: 'warmup', requestId: 0 })
  assert.equal(warmupMessage.type, 'result')
  const warmup = warmupMessage.result
  assert.equal(warmup.ready, true)
  assert.equal(warmup.modelVerified, true)
  assert.equal(warmup.modelHash, OFFICIAL_WEIGHT_SHA256)
  assert.equal(legacyEntryPatched(), true)
  const first = await run({ type: 'think', requestId: 1, gameId: 'A', level: 4, budget: 2000, board: Array.from(boardA1), moves: [{ x: 7, y: 7, side: BLACK }] })
  assert.equal(first.type, 'result')
  await run({ type: 'think', requestId: 2, gameId: 'A', level: 4, budget: 2000, board: Array.from(boardA2), moves: [{ x: 7, y: 7, side: BLACK }, { x: 8, y: 7, side: WHITE }] })
  await run({ type: 'think', requestId: 3, gameId: 'B', level: 5, budget: 5000, board: Array.from(createBoard()), moves: [] })
  const analysisMessage = await run({ type: 'analyze', requestId: 4, gameId: 'B', budget: 3000, board: Array.from(boardA1), moves: [{ x: 7, y: 7, side: BLACK }] })
  assert.equal(analysisMessage.type, 'result')
  const analysis = analysisMessage.result

  assert.equal(commands.filter((command) => command === 'START 15').length, 2)
  const boardCommands = commands.filter((command) => command.startsWith('YXBOARD'))
  assert.equal(boardCommands.length, 5)
  assert.equal(boardCommands[0], 'YXBOARD DONE')
  assert.match(boardCommands[2], /7,7,1/)
  assert.match(boardCommands[2], /8,7,2/)
  assert.equal(commands.filter((command) => command === 'INFO STRENGTH 100').length, 5)
  assert.equal(commands.filter((command) => command === 'INFO MAX_DEPTH 100').length, 5)
  assert.deepEqual(commands.filter((command) => command.startsWith('INFO TIMEOUT_TURN')), [
    'INFO TIMEOUT_TURN 500',
    'INFO TIMEOUT_TURN 2000',
    'INFO TIMEOUT_TURN 2000',
    'INFO TIMEOUT_TURN 5000',
    'INFO TIMEOUT_TURN 3000',
  ])
  assert.equal(analysis.analysis, true)
  assert.equal(analysis.modelVerified, true)
  assert.equal(analysis.depth, 39)
  assert.equal(analysis.seldepth, 9)
  assert.equal(analysis.nodes, 1040000)
  assert.equal(analysis.score, '-M12')
  assert.deepEqual({ x: analysis.pv[0].x, y: analysis.pv[0].y }, { x: 6, y: 5 })
  assert.deepEqual({ x: analysis.pv[1].x, y: analysis.pv[1].y }, { x: 5, y: 6 })
  const sessionStatuses = messages.filter((message) => message.type === 'status' && message.phase === 'session')
  assert.deepEqual(sessionStatuses.map((message) => message.gameId), ['A', 'B'])
  const modelPhases = messages.filter((message) => message.type === 'status' && message.phase.startsWith('model-'))
  assert.deepEqual(modelPhases.map((message) => message.phase), ['model-loading', 'model-ready'])
  assert.equal(messages.some((message) => message.type === 'progress' && message.nodes === 1040000), true)
})

test('Rapfi runtime exit fails the active request instead of leaving the board waiting', async () => {
  const { run, failNextSearch, messages } = await createRapfiHarness()
  await run({ type: 'warmup', requestId: 100 })
  failNextSearch()
  const response = await run({
    type: 'think', requestId: 101, gameId: 'runtime-failure', level: 5, budget: 5000,
    board: Array.from(createBoard()), moves: [],
  })
  assert.equal(response.type, 'error')
  assert.match(response.message, /引擎退出：7/)
  assert.equal(messages.some((message) => message.requestId === 101 && message.phase === 'model-error'), true)
})
