import './styles.css'
import { LEVELS, adaptiveBudget, candidates, pointScore } from './ai-core.js'
import { AiClient } from './ai-client.js'
import {
  BLACK,
  EMPTY,
  SIZE,
  WHITE,
  at,
  boardAtMove,
  createBoard,
  isFull,
  moveLabel,
  other,
  play,
  recordToSgf,
  sgfToRecord,
  winnerFrom,
} from './game.js'
import {
  clearUnfinishedGame,
  computeStats,
  createBackup,
  deleteRecord,
  downloadText,
  getAnalysis,
  importBackup,
  loadHistory,
  loadSettings,
  loadUnfinishedGame,
  saveAnalysis,
  saveRecord,
  saveSettings,
  saveUnfinishedGame,
} from './history.js'
import { OnlineRoom } from './online.js'

const THEMES = [
  { id: 'mist', name: '晨雾蓝', bg: '#edf3ff', color: '#6c7df4', accent: '#f59fc0' },
  { id: 'peach', name: '蜜桃茶', bg: '#fff3ee', color: '#ec7f86', accent: '#ffd071' },
  { id: 'jade', name: '薄荷玉', bg: '#edf9f5', color: '#3aa98a', accent: '#9bd5c4' },
  { id: 'lilac', name: '丁香紫', bg: '#f6efff', color: '#9470db', accent: '#efb1d6' },
  { id: 'sky', name: '晴空青', bg: '#eaf8ff', color: '#408ed6', accent: '#99c9ff' },
  { id: 'sunrise', name: '日出橙', bg: '#fff7e6', color: '#e9914f', accent: '#ffd66f' },
]

const SOURCES = [
  { abbr: 'RIF', title: '世界连珠锦标赛', desc: '历届世界冠军、举办地与赛事历史', url: 'https://www.renju.net/wc/' },
  { abbr: '谱', title: 'RIF 官方棋谱检索', desc: '超过 15 万局赛事记录，跳转官方数据库学习', url: 'https://www.renju.net/game/' },
  { abbr: '冠', title: '世界冠军档案', desc: '中村茂、Ando Meritee、曹冬、陆海等顶尖棋手', url: 'https://gomoku.renju.net/worldchampions/' },
  { abbr: '26', title: 'Gomocup 2026', desc: '全球五子棋 AI 锦标赛完整结果与引擎说明', url: 'https://gomocup.org/results/gomocup-result-2026/' },
  { abbr: 'LIVE', title: 'Gomocup 对局直播库', desc: '查看 Rapfi、KataGomo 等顶级引擎实战棋谱', url: 'https://live.gomocup.org/results/' },
  { abbr: 'AI', title: 'Rapfi 冠军引擎', desc: '最高两档所用开源引擎的算法、源码与许可证', url: 'https://github.com/dhbloo/rapfi' },
  { abbr: '规', title: 'RIF 国际规则', desc: '官方连珠规则与国际比赛规程', url: 'https://www.renju.net/documents/' },
]

const PUZZLES = [
  { id: 1, title: '一击封喉', desc: '黑先，找到立即获胜点', solution: { x: 9, y: 7 }, moves: [[5, 7, BLACK], [6, 7, BLACK], [7, 7, BLACK], [8, 7, BLACK], [7, 6, WHITE], [8, 6, WHITE]] },
  { id: 2, title: '唯一防线', desc: '黑先，挡住白方的致命冲四', solution: { x: 10, y: 5 }, moves: [[6, 5, WHITE], [7, 5, WHITE], [8, 5, WHITE], [9, 5, WHITE], [7, 7, BLACK], [8, 8, BLACK]] },
  { id: 3, title: '双向生长', desc: '黑先，制造无法同时防守的双活三', solution: { x: 7, y: 7 }, moves: [[5, 7, BLACK], [6, 7, BLACK], [7, 5, BLACK], [7, 6, BLACK], [6, 6, WHITE], [8, 8, WHITE]] },
]

const stored = loadSettings()
const roomFromUrl = new URLSearchParams(location.search).get('room')?.trim().toUpperCase()
const validRoomFromUrl = /^[A-Z2-9]{6}$/.test(roomFromUrl || '') ? roomFromUrl : ''
const RAPFI_DISPLAY_NAME = 'Rapfi 2026 冠军同源核心 · 官方 mix9svq NNUE'
const FALLBACK_DISPLAY_NAME = '弈境兼容引擎'
const LOBBY_MODES = [
  { id: 'ai', icon: 'cpu', title: 'AI 对决', subtitle: '五档棋力 · 冠军引擎' },
  { id: 'coach', icon: 'bulb', title: 'AI 教学', subtitle: '逐手提示 · 深度讲解' },
  { id: 'local', icon: 'users', title: '双人同屏', subtitle: '轮流落子 · 即开即玩' },
  { id: 'online', icon: 'wifi', title: '远程联机', subtitle: '六位房间码 · 实时同步' },
]
const validLobbyModes = new Set(LOBBY_MODES.map((mode) => mode.id))

const state = {
  view: 'home',
  theme: THEMES.some((theme) => theme.id === stored.theme) ? stored.theme : 'mist',
  sound: stored.sound !== false,
  modal: validRoomFromUrl ? { type: 'online', phase: 'choose', prefill: validRoomFromUrl } : null,
  game: null,
  replay: null,
  replayIndex: 0,
  replayTimer: null,
  replayAnnotations: [],
  analyzing: false,
  history: loadHistory(),
  unfinished: loadUnfinishedGame(),
  onlineStatus: null,
  analysis: { engine: '待命', depth: '—', nodes: '—', elapsed: '—', budget: 0 },
  filters: { query: '', mode: 'all', result: 'all', level: 'all', date: 'all' },
  hover: null,
  aiWarmup: 'idle',
  lobbyMode: validLobbyModes.has(stored.lobbyMode) ? stored.lobbyMode : 'ai',
  lobbyLevel: Number.isInteger(stored.lobbyLevel) && stored.lobbyLevel >= 1 && stored.lobbyLevel <= 5 ? stored.lobbyLevel : 5,
  lobbySide: stored.lobbySide === WHITE ? WHITE : BLACK,
  confirmMove: stored.confirmMove === true,
  showSituation: stored.showSituation !== false,
  showMoveNumbers: stored.showMoveNumbers === true,
  pendingMove: null,
  coach: { thinking: false, text: '需要时可调用冠军引擎分析下一手。', suggested: null },
}

let resizeObserver = null
let room = null
let deferredInstallPrompt = null
let thinkingTicker = null

const ai = new AiClient((progress) => {
  if (progress.depth) state.analysis.depth = progress.seldepth && progress.seldepth !== progress.depth
    ? `${progress.depth}/${progress.seldepth}`
    : progress.depth
  if (progress.nodes) state.analysis.nodes = compactNumber(progress.nodes)
  if (progress.source === 'rapfi' && progress.phase !== 'model-error') state.analysis.engine = RAPFI_DISPLAY_NAME
  if (progress.type === 'ready' || progress.status === 'ready' || progress.phase === 'model-ready') state.aiWarmup = 'ready'
  if (progress.phase === 'model-error') {
    state.aiWarmup = 'error'
    state.analysis.engine = FALLBACK_DISPLAY_NAME
  }
  updateAnalysisPanel()
})

const app = document.querySelector('#app')
document.documentElement.dataset.theme = state.theme

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault()
  deferredInstallPrompt = event
  document.querySelector('[data-install-status]')?.replaceChildren(document.createTextNode('可安装'))
})

function icon(name) {
  const paths = {
    grid: '<rect x="3" y="3" width="18" height="18" rx="5"/><path d="M8 3v18M16 3v18M3 8h18M3 16h18"/>',
    palette: '<path d="M12 3a9 9 0 1 0 0 18h1.1a1.9 1.9 0 0 0 1.2-3.4 2 2 0 0 1 1.2-3.6H18a3 3 0 0 0 3-3c0-4.4-4-8-9-8Z"/><path d="M7.5 10h.01M9.5 6.7h.01M14 6.5h.01M17.2 9h.01"/>',
    spark: '<path d="m12 3 1.3 4.2L17.5 9l-4.2 1.7L12 15l-1.3-4.3L6.5 9l4.2-1.8L12 3Z"/><path d="m18.5 14 .7 2.3 2.3.7-2.3.7-.7 2.3-.7-2.3-2.3-.7 2.3-.7.7-2.3Z"/>',
    wifi: '<path d="M4.4 10a11.4 11.4 0 0 1 15.2 0M7.5 13.3a6.8 6.8 0 0 1 9 0M10.4 16.5a2.4 2.4 0 0 1 3.2 0"/><circle cx="12" cy="19" r="1"/>',
    book: '<path d="M4 5.5A3.5 3.5 0 0 1 7.5 2H11v17H7.5A3.5 3.5 0 0 0 4 22V5.5ZM20 5.5A3.5 3.5 0 0 0 16.5 2H13v17h3.5A3.5 3.5 0 0 1 20 22V5.5Z"/>',
    history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>',
    chart: '<path d="M4 19V9m5 10V5m5 14v-7m5 7V3"/>',
    cpu: '<rect x="6" y="6" width="12" height="12" rx="3"/><path d="M9 1v5m6-5v5M9 18v5m6-5v5M1 9h5m-5 6h5m12-6h5m-5 6h5"/>',
    shield: '<path d="M12 22s8-3.5 8-10V5l-8-3-8 3v7c0 6.5 8 10 8 10Z"/><path d="m9 12 2 2 4-5"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
    install: '<path d="M12 3v12m-4-4 4 4 4-4"/><path d="M5 19h14"/>',
    share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 10.5 6.8-4m-6.8 7 6.8 4"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.5.5l2-2a5 5 0 0 0-7-7l-1.2 1.2"/><path d="M14 11a5 5 0 0 0-7.5-.5l-2 2a5 5 0 0 0 7 7l1.2-1.2"/>',
    arrow: '<path d="M5 12h14M14 7l5 5-5 5"/>',
    back: '<path d="m15 18-6-6 6-6"/>',
    play: '<path d="m8 5 11 7-11 7V5Z"/>',
    upload: '<path d="M12 16V4m-4 4 4-4 4 4M5 14v5h14v-5"/>',
    download: '<path d="M12 4v12m-4-4 4 4 4-4M5 19h14"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3m3 0-1 14H7L6 7m4 4v6m4-6v6"/>',
    undo: '<path d="m9 7-5 5 5 5"/><path d="M5 12h8a6 6 0 0 1 6 6"/>',
    refresh: '<path d="M20 7v5h-5M4 17v-5h5"/><path d="M6.1 8a7 7 0 0 1 11.2-2L20 12M4 12l2.7 6a7 7 0 0 0 11.2-2"/>',
    flag: '<path d="M5 21V4m0 1h11l-2 4 2 4H5"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
    chevron: '<path d="m9 18 6-6-6-6"/>',
    external: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h6"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
    users: '<circle cx="9" cy="8" r="3"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0"/><circle cx="17" cy="9" r="2.5"/><path d="M15.5 14.5a4.8 4.8 0 0 1 5 4.5"/>',
    sliders: '<path d="M4 7h10m4 0h2M4 17h2m4 0h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>',
    bulb: '<path d="M9 18h6M10 22h4"/><path d="M8.2 14.5A6 6 0 1 1 15.8 14.5c-.9.7-1.3 1.5-1.3 2.5h-5c0-1-.4-1.8-1.3-2.5Z"/>',
    more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    sound: '<path d="M4 10v4h3l4 4V6l-4 4H4Z"/><path d="M15 9a4 4 0 0 1 0 6M17.8 6.2a8 8 0 0 1 0 11.6"/>',
  }
  return `<svg class="button-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.grid}</svg>`
}

function compactNumber(number) {
  if (!Number.isFinite(number)) return '—'
  if (number >= 1_000_000) return `${(number / 1_000_000).toFixed(1)}M`
  if (number >= 1_000) return `${(number / 1_000).toFixed(1)}K`
  return String(number)
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character])
}

function formatDate(value) {
  return new Date(value || Date.now()).toLocaleString('zh-CN', { dateStyle: 'medium', timeStyle: 'short' })
}

function safeStats() {
  return {
    total: 0, wins: 0, losses: 0, draws: 0, winRate: 0, avgMoves: 0, bestStreak: 0,
    black: { total: 0, wins: 0, winRate: 0 }, white: { total: 0, wins: 0, winRate: 0 },
    online: { total: 0, wins: 0, winRate: 0 }, byLevel: {}, recent10: [],
    ...computeStats(state.history),
  }
}

function sideStats(stats, side) {
  const value = stats[side] || {}
  if (typeof value === 'number') return { total: value, wins: 0, winRate: 0 }
  return { total: value.total ?? value.games ?? 0, wins: value.wins ?? 0, winRate: value.winRate ?? 0 }
}

function resultLabel(record) {
  if (record.resultText) return record.resultText
  if (record.resultCode?.startsWith('B+')) return '黑方胜'
  if (record.resultCode?.startsWith('W+')) return '白方胜'
  return record.resultCode === '0' ? '和棋' : '未完'
}

function humanResult(record) {
  const humanSide = record.blackName === '你' ? BLACK : record.whiteName === '你' ? WHITE : null
  if (!humanSide || record.resultCode === 'Void') return 'other'
  if (record.resultCode === '0') return 'draw'
  const winner = record.resultCode?.startsWith('B+') ? BLACK : record.resultCode?.startsWith('W+') ? WHITE : null
  return winner === humanSide ? 'win' : winner ? 'loss' : 'other'
}

function renderHeader() {
  if (state.view === 'home') return `<header class="topbar yijing-topbar">
    <button class="brand yijing-brand" data-view="home" aria-label="弈境五子棋首页"><span class="brand-copy"><strong>弈境</strong></span></button>
    <div class="yijing-home-actions"><button class="icon-button" data-view="stats" aria-label="个人数据">${icon('chart')}<span>数据</span></button><button class="icon-button" data-view="records" aria-label="棋谱回忆">${icon('history')}<span>棋谱</span></button><button class="icon-button" data-action="toggle-sound" aria-label="音效开关">${icon('sound')}<span>${state.sound ? '音效开' : '音效关'}</span></button></div>
  </header>`
  const navItems = [['home', '对弈'], ['features', '功能'], ['records', '棋谱'], ['learn', '学堂']]
  const activeView = state.view === 'stats' ? 'features' : state.view
  return `<header class="topbar">
    <button class="brand" data-view="home" aria-label="返回首页">
      <span class="brand-mark">${icon('grid')}</span>
      <span class="brand-copy"><strong>弈境</strong><small>YIJING GOMOKU</small></span>
    </button>
    <nav class="nav" aria-label="主导航">${navItems.map(([id, label]) => `<button class="nav-button ${activeView === id ? 'active' : ''}" data-view="${id}">${label}</button>`).join('')}</nav>
    <div class="top-actions"><button class="icon-button" data-action="theme" aria-label="切换主题">${icon('palette')}</button></div>
  </header>`
}

function miniBoard() {
  const stones = [[5, 5, 'black'], [6, 5, 'white'], [4, 4, 'black'], [5, 4, 'white'], [3, 3, 'black'], [7, 6, 'white'], [6, 6, 'black']]
  const engineStatus = state.aiWarmup === 'ready'
    ? '官方 NNUE 已就绪'
    : state.aiWarmup === 'loading'
      ? '官方 NNUE 校验中'
      : state.aiWarmup === 'error' ? '兼容引擎待命' : '官方 NNUE 待校验'
  return `<div class="hero-visual tech-visual" aria-hidden="true">
    <div class="hero-glass"></div><div class="tech-grid"></div>
    <div class="mini-board">${stones.map(([x, y, color]) => `<i class="mini-stone ${color}" style="grid-column:${x};grid-row:${y}"></i>`).join('')}</div>
    <div class="floating-note one"><span class="note-icon">${icon('cpu')}</span><span>RAPFI CORE<br><small>${engineStatus}</small></span></div>
  </div>`
}

function persistUiSettings() {
  saveSettings({
    ...loadSettings(),
    theme: state.theme,
    sound: state.sound,
    lobbyMode: state.lobbyMode,
    lobbyLevel: state.lobbyLevel,
    lobbySide: state.lobbySide,
    confirmMove: state.confirmMove,
    showSituation: state.showSituation,
    showMoveNumbers: state.showMoveNumbers,
  })
}

function isEngineMode(gameOrMode) {
  const mode = typeof gameOrMode === 'string' ? gameOrMode : gameOrMode?.mode
  return mode === 'ai' || mode === 'coach'
}

function lobbyPlaySummary() {
  if (state.lobbyMode === 'ai') return `${LEVELS[state.lobbyLevel - 1].name} · ${state.lobbySide === BLACK ? '执黑' : '执白'} · 15 路`
  if (state.lobbyMode === 'coach') return `教学局 · ${state.lobbySide === BLACK ? '执黑' : '执白'} · 逐手提示`
  if (state.lobbyMode === 'local') return '双人轮流 · 黑方先行 · 15 路'
  return '六位房间码 · 15 路标准棋盘'
}

function lobbyStartLabel() {
  return { ai: '开始 AI 对决', coach: '进入 AI 教学局', local: '开始双人对弈', online: '进入远程棋室' }[state.lobbyMode]
}

function homeScoreTriplet(mode) {
  const records = state.history.filter((record) => mode === 'ai' ? record.mode === 'ai' || record.mode === 'coach' : record.mode === mode)
  if (mode === 'local') return {
    first: records.filter((record) => record.resultCode?.startsWith('B+')).length,
    second: records.filter((record) => record.resultCode?.startsWith('W+')).length,
    draw: records.filter((record) => record.resultCode === '0').length,
  }
  return {
    first: records.filter((record) => humanResult(record) === 'win').length,
    second: records.filter((record) => humanResult(record) === 'loss').length,
    draw: records.filter((record) => humanResult(record) === 'draw').length,
  }
}

function renderHome() {
  const unfinished = state.unfinished
  const pvp = homeScoreTriplet('local'); const aiScore = homeScoreTriplet('ai'); const online = homeScoreTriplet('online')
  return `<main class="main yijing-home-main">
    <section class="yijing-home" aria-label="弈境五子棋首页">
      <div class="yijing-hero">
        <div class="yijing-stones" aria-hidden="true"><i class="black"></i><i class="white"></i></div>
        <h1>弈境五子棋</h1>
        <p>拟真棋盘 · AI 教学 · 实时教练 · 远程联机</p>
      </div>

      <div class="yijing-mode-grid">${LOBBY_MODES.map((mode) => `<button class="yijing-mode-card ${state.lobbyMode === mode.id ? 'selected' : ''}" data-action="select-lobby-mode" data-mode="${mode.id}"><span class="yijing-mode-icon">${icon(mode.icon)}</span><span><strong>${mode.title}</strong><small>${mode.id === 'ai' ? '五档棋力 · 纯粹对弈' : mode.id === 'coach' ? '逐手引导 · 边下边学' : mode.id === 'local' ? '同屏面对面过弈' : '房间码邀请朋友'}</small></span><i class="mode-check">${icon('check')}</i></button>`).join('')}</div>

      <div class="yijing-setting-list">
        <button data-action="open-play-settings"><span class="setting-icon">${icon('sliders')}</span><span><strong>玩法设置</strong><small>${escapeHtml(lobbyPlaySummary())}</small></span>${icon('chevron')}</button>
        <button data-action="theme"><span class="setting-icon">${icon('palette')}</span><span><strong>外观设置</strong><small>${THEMES.find((theme) => theme.id === state.theme)?.name} · 毛玻璃界面</small></span>${icon('chevron')}</button>
      </div>

      <div class="yijing-score-strip">
        <span><strong>${pvp.first} · ${pvp.second} · ${pvp.draw}</strong><small>双人 · 黑 / 白 / 和</small></span>
        <span><strong>${aiScore.first} · ${aiScore.second} · ${aiScore.draw}</strong><small>人机 · 胜 / 负 / 和</small></span>
        <span><strong>${online.first} · ${online.second} · ${online.draw}</strong><small>联机 · 胜 / 负 / 和</small></span>
      </div>

      <button class="yijing-start" data-action="start-lobby"><span>开始对局</span>${icon('arrow')}</button>
      ${unfinished ? `<button class="yijing-resume" data-action="resume-game">${icon('history')}继续未完对局 · 第 ${unfinished.moves?.length || 0} 手${icon('chevron')}</button>` : ''}
    </section>
  </main>`
}

function capabilityStatus() {
  const installed = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true
  return {
    engine: state.aiWarmup === 'ready' ? '已预热' : state.aiWarmup === 'loading' ? '加载中' : state.aiWarmup === 'error' ? '兼容引擎' : '按需加载',
    online: 'RTCPeerConnection' in window ? '可用' : '受限',
    pwa: installed ? '已安装' : deferredInstallPrompt ? '可安装' : '可添加桌面',
  }
}

function renderFeatures() {
  const status = capabilityStatus()
  const stats = safeStats()
  const modules = [
    { icon: 'cpu', title: 'AI 竞技场', desc: '五档棋力、自适应算力与冠军级威胁搜索。', status: status.engine, action: 'open-ai', cta: '选择难度' },
    { icon: 'wifi', title: '远程棋室', desc: '六位房间码或邀请链接，双方棋步实时同步。', status: status.online, action: 'open-online', cta: '创建房间' },
    { icon: 'history', title: '棋谱管理', desc: '自动保存、搜索筛选、SGF 导入导出与完整备份。', status: `${state.history.length} 份`, view: 'records', cta: '查看棋谱' },
    { icon: 'spark', title: '智能复盘', desc: '快速标记转折，点击任意一手再由冠军引擎深算。', status: '按需计算', action: state.history[0] ? 'replay' : 'open-ai', id: state.history[0]?.id, cta: state.history[0] ? '复盘最近一局' : '先下一局' },
    { icon: 'book', title: '世界学堂', desc: '权威棋谱入口、世界冠军资料与离线战术训练。', status: '7 个权威源', view: 'learn', cta: '进入学堂' },
    { icon: 'chart', title: '数据中心', desc: '战绩趋势、执子表现、等级统计与百局挑战。', status: `${stats.total} 局`, view: 'stats', cta: '打开数据中心' },
  ]
  return `<main class="main">
    <div class="page-head feature-head"><div><span class="eyebrow"><i class="eyebrow-dot"></i> CAPABILITY MATRIX</span><h1>一座完整的<br><span class="gradient-word">智能棋室。</span></h1><p>每项能力都可直接进入，每份数据都默认留在你的设备。</p></div><div class="readiness-card"><small>SYSTEM STATUS</small><span><i></i>AI 引擎 <b>${status.engine}</b></span><span><i></i>远程联机 <b>${status.online}</b></span><span><i></i>桌面应用 <b data-install-status>${status.pwa}</b></span></div></div>
    <section class="module-grid">${modules.map((module, index) => `<button class="module-card module-${index + 1}" ${module.view ? `data-view="${module.view}"` : `data-action="${module.action}"`} ${module.id ? `data-id="${module.id}"` : ''}><span class="module-top"><i class="module-icon">${icon(module.icon)}</i><em>${escapeHtml(module.status)}</em></span><span class="module-copy"><strong>${module.title}</strong><small>${module.desc}</small></span><span class="module-cta">${module.cta}${icon('arrow')}</span></button>`).join('')}</section>
    <section class="data-utility glass-panel"><div><span class="section-kicker">DEVICE & DATA</span><h2>在任意设备，带走整座棋室</h2><p>导出一个弈境备份，即可迁移主题、棋谱、未完对局与分析结果。</p></div><div class="utility-actions"><button class="secondary-button" data-action="install-pwa">${icon('install')}安装到桌面</button><button class="secondary-button" data-action="export-backup">${icon('download')}导出完整备份</button><button class="primary-button" data-action="import-backup">${icon('upload')}导入备份</button></div><input id="backup-file" type="file" accept=".json,application/json" hidden></section>
    ${renderFooter()}
  </main>`
}

function progressCard(target, total) {
  const percent = Math.min(100, Math.round((total / target) * 100))
  return `<article class="challenge-card"><span><small>${target} 局挑战</small><strong>${Math.min(total, target)} / ${target}</strong></span><div class="challenge-track"><i style="width:${percent}%"></i></div><em>${percent >= 100 ? '已完成' : `还差 ${target - total} 局`}</em></article>`
}

function renderStats() {
  const stats = safeStats()
  const black = sideStats(stats, 'black')
  const white = sideStats(stats, 'white')
  const recent = Array.isArray(stats.recent10) ? stats.recent10 : []
  return `<main class="main">
    <button class="back-button" data-view="features">${icon('back')}返回功能页</button>
    <div class="page-head stats-head"><div><span class="eyebrow"><i class="eyebrow-dot"></i> PERSONAL TELEMETRY</span><h1>个人数据中心</h1><p>所有统计从本机棋谱实时生成，不上传账号或云端。</p></div><div class="utility-actions"><button class="secondary-button" data-action="export-backup">${icon('download')}备份</button><button class="secondary-button" data-action="import-backup">${icon('upload')}恢复</button></div></div><input id="backup-file" type="file" accept=".json,application/json" hidden>
    <section class="stats-overview">
      <article class="stat-hero glass-panel"><div class="win-ring" style="--ring:${Math.round(stats.winRate || 0)}"><span><strong>${Math.round(stats.winRate || 0)}%</strong><small>总胜率</small></span></div><div><small>ALL MATCHES</small><strong>${stats.total}</strong><span>胜 ${stats.wins} · 负 ${stats.losses} · 和 ${stats.draws}</span></div></article>
      <article class="metric-card"><small>BEST STREAK</small><strong>${stats.bestStreak || 0}</strong><span>最佳连胜</span></article>
      <article class="metric-card"><small>AVG. LENGTH</small><strong>${Math.round(stats.avgMoves || 0)}</strong><span>平均手数</span></article>
      <article class="metric-card"><small>ONLINE</small><strong>${stats.online?.total ?? stats.online?.games ?? 0}</strong><span>联机对局</span></article>
    </section>
    <section class="dashboard-grid">
      <article class="dashboard-panel glass-panel"><div class="panel-title"><div><small>SIDE PERFORMANCE</small><h2>执子表现</h2></div></div><div class="side-bars"><div><span><i class="stone-avatar black"></i><b>执黑</b><em>${black.total} 局 · ${Math.round(black.winRate || 0)}%</em></span><div><i style="width:${black.winRate || 0}%"></i></div></div><div><span><i class="stone-avatar white"></i><b>执白</b><em>${white.total} 局 · ${Math.round(white.winRate || 0)}%</em></span><div><i style="width:${white.winRate || 0}%"></i></div></div></div></article>
      <article class="dashboard-panel glass-panel"><div class="panel-title"><div><small>RECENT FORM</small><h2>最近十局</h2></div></div><div class="recent-form">${recent.length ? recent.slice(0, 10).reverse().map((item, index) => { const result = typeof item === 'string' ? item : item.result || item.outcome; return `<i class="form-${result || 'other'}" title="第 ${index + 1} 局"></i>` }).join('') : '<span>完成对局后显示趋势</span>'}</div><p class="dashboard-note">绿色为胜，红色为负，蓝灰色为和棋。</p></article>
    </section>
    <section class="section compact-section"><div class="section-heading"><div><span class="section-kicker">AI PERFORMANCE</span><h2>各等级战绩</h2></div></div><div class="level-stats">${LEVELS.map((level) => { const item = stats.byLevel?.[level.id] || stats.byLevel?.[level.name] || {}; const total = item.total ?? item.games ?? 0; const wins = item.wins ?? 0; const rate = item.winRate ?? (total ? wins / total * 100 : 0); return `<article><span class="level-number">0${level.id}</span><div><strong>${level.name}</strong><small>${total} 局 · ${Math.round(rate)}% 胜率</small></div><div class="mini-meter"><i style="width:${Math.min(100, rate)}%"></i></div></article>` }).join('')}</div></section>
    <section class="section compact-section"><div class="section-heading"><div><span class="section-kicker">LONG RUN</span><h2>连续挑战</h2><p>10 局、50 局、100 局，每一步都会留下记录。</p></div></div><div class="challenge-grid">${[10, 50, 100].map((target) => progressCard(target, stats.total)).join('')}</div></section>
    ${renderFooter()}
  </main>`
}

function filteredHistory() {
  const now = Date.now()
  return state.history.filter((record) => {
    const query = state.filters.query.trim().toLowerCase()
    if (query && !`${record.title || ''} ${record.blackName || ''} ${record.whiteName || ''} ${record.levelName || ''}`.toLowerCase().includes(query)) return false
    if (state.filters.mode !== 'all' && record.mode !== state.filters.mode) return false
    if (state.filters.result !== 'all' && humanResult(record) !== state.filters.result) return false
    if (state.filters.level !== 'all' && String(record.level || '') !== state.filters.level) return false
    if (state.filters.date !== 'all') {
      const days = Number(state.filters.date)
      if (now - new Date(record.endedAt || record.startedAt).getTime() > days * 86400000) return false
    }
    return true
  })
}

function recordModeLabel(record) {
  if (record.mode === 'online') return '远程联机'
  if (record.mode === 'local') return '双人同屏'
  if (record.mode === 'coach') return `AI 教学 · ${record.levelName || ''}`
  if (record.mode === 'ai') return `AI 对决 · ${record.levelName || ''}`
  return '导入棋谱'
}

function recordsGridHtml() {
  const records = filteredHistory()
  if (!records.length) return `<section class="record-empty glass-panel"><span class="feature-icon">${icon('history')}</span><h2>${state.history.length ? '没有符合条件的棋谱' : '这里还没有棋谱'}</h2><p class="hero-copy" style="margin:0 auto 1rem">${state.history.length ? '调整筛选条件再试一次。' : '完成第一局后，棋谱会自动出现在这里。'}</p>${state.history.length ? '' : '<button class="primary-button" data-action="open-ai">开始一局</button>'}</section>`
  return records.map((record) => `<article class="record-card">
    <div class="record-top"><span>${formatDate(record.endedAt || record.startedAt)}</span><span class="result-badge result-${humanResult(record)}">${escapeHtml(resultLabel(record))}</span></div>
    <h3>${escapeHtml(record.title || '五子棋对局')}</h3><p>${escapeHtml(record.blackName)} · 黑　vs　${escapeHtml(record.whiteName)} · 白<br>${record.moves.length} 手 · ${escapeHtml(recordModeLabel(record))}</p>
    <div class="record-actions"><button class="ghost-button" data-action="replay" data-id="${record.id}">${icon('play')}智能复盘</button><button class="ghost-button" data-action="export" data-id="${record.id}">${icon('download')}SGF</button><button class="ghost-button danger" data-action="delete-record" data-id="${record.id}" aria-label="删除棋谱">${icon('trash')}</button></div>
  </article>`).join('')
}

function renderRecords() {
  return `<main class="main">
    <div class="page-head"><div><span class="eyebrow"><i class="eyebrow-dot"></i> LOCAL KIFU</span><h1>我的棋谱</h1><p>搜索、筛选、导出，再回到任何一手。</p></div><button class="secondary-button" data-action="import-record">${icon('upload')}导入棋谱</button></div>
    <input id="record-file" type="file" accept=".sgf,.json,application/json,text/plain" hidden>
    <section class="filter-bar glass-panel"><label class="search-field">${icon('search')}<input id="record-search" value="${escapeHtml(state.filters.query)}" placeholder="搜索标题、对手或等级"></label><select data-record-filter="mode"><option value="all">全部模式</option><option value="ai" ${state.filters.mode === 'ai' ? 'selected' : ''}>AI 对决</option><option value="coach" ${state.filters.mode === 'coach' ? 'selected' : ''}>AI 教学</option><option value="local" ${state.filters.mode === 'local' ? 'selected' : ''}>双人同屏</option><option value="online" ${state.filters.mode === 'online' ? 'selected' : ''}>远程联机</option><option value="imported" ${state.filters.mode === 'imported' ? 'selected' : ''}>导入棋谱</option></select><select data-record-filter="result"><option value="all">全部结果</option><option value="win" ${state.filters.result === 'win' ? 'selected' : ''}>我的胜局</option><option value="loss" ${state.filters.result === 'loss' ? 'selected' : ''}>我的负局</option><option value="draw" ${state.filters.result === 'draw' ? 'selected' : ''}>和棋</option></select><select data-record-filter="level"><option value="all">全部等级</option>${LEVELS.map((level) => `<option value="${level.id}" ${state.filters.level === String(level.id) ? 'selected' : ''}>${level.name}</option>`).join('')}</select><select data-record-filter="date"><option value="all">全部日期</option><option value="7" ${state.filters.date === '7' ? 'selected' : ''}>近 7 天</option><option value="30" ${state.filters.date === '30' ? 'selected' : ''}>近 30 天</option></select></section>
    <div class="record-summary"><span>共 ${filteredHistory().length} 份棋谱</span><button class="chip-button" data-action="clear-filters">清除筛选</button></div>
    <div class="record-grid">${recordsGridHtml()}</div>${renderFooter()}
  </main>`
}

function renderLearn() {
  return `<main class="main">
    <div class="page-head"><div><span class="eyebrow"><i class="eyebrow-dot"></i> WORLD KIFU</span><h1>世界棋谱学堂</h1><p>已于 2026 年 8 月核对的权威赛事与顶尖棋手资源。</p></div></div>
    <div class="notice">RIF 官方棋谱库不允许把其内容复制到其他在线系统，因此弈境只提供经过核实的官方直达入口，并用原创局面提供离线训练。</div>
    <div class="learn-grid"><section><div class="section-heading"><div><span class="section-kicker">VERIFIED SOURCES</span><h2>权威棋谱源</h2><p>世界冠军、人类赛事与顶级 AI 实战。</p></div></div><div class="source-list">${SOURCES.map((source) => `<a class="source-card" href="${source.url}" target="_blank" rel="noopener noreferrer"><span class="source-logo">${source.abbr}</span><span class="source-copy"><strong>${source.title}</strong><small>${source.desc}</small></span><span class="external-arrow">${icon('external')}</span></a>`).join('')}</div></section><section><div class="section-heading"><div><span class="section-kicker">TACTICAL LAB</span><h2>战术训练</h2><p>原创局面，不依赖网络也能练习。</p></div></div><div class="training-list">${PUZZLES.map((puzzle, index) => `<article class="training-card"><h3>第 ${index + 1} 课 · ${puzzle.title}</h3><p>${puzzle.desc}</p><div class="progress-line"><i style="width:${34 + index * 24}%"></i></div><button class="ghost-button" style="margin-top:.8rem;width:100%" data-action="puzzle" data-id="${puzzle.id}">${icon('play')}开始解题</button></article>`).join('')}</div></section></div>${renderFooter()}
  </main>`
}

function currentTurnText(game) {
  if (!game) return ''
  if (game.status === 'ended') return game.resultText
  if (game.thinking) return `${LEVELS[game.level - 1]?.name || 'AI'} 正在推演`
  if (game.mode === 'online') return game.current === game.humanSide ? '轮到你落子' : '等待对手落子'
  if (game.mode === 'local') return `${game.current === BLACK ? '黑方' : '白方'}回合`
  return game.current === game.humanSide ? '轮到你落子' : 'AI 正在思考'
}

function situationName(game) {
  if (!game || game.status === 'ended') return game?.resultText || '对局结束'
  const count = game.moves.length
  if (count === 0) return '开局 · 天元争夺'
  if (count <= 6) return '开局 · 布局展开'
  if (count <= 20) return '中盘 · 攻防试探'
  if (count <= 45) return '中盘 · 战术交锋'
  return '残局 · 胜负收束'
}

function playerCard(side, name, game) {
  const active = game.status === 'playing' && game.current === side
  const isAi = game.aiSide === side
  const thinking = active && isAi && game.thinking
  const role = game.mode === 'local'
    ? `本地玩家 · ${side === BLACK ? '黑方' : '白方'}`
    : game.humanSide === side ? `你 · ${side === BLACK ? '黑方' : '白方'}` : isAi ? `AI · ${side === BLACK ? '黑方' : '白方'}` : `对手 · ${side === BLACK ? '黑方' : '白方'}`
  return `<div class="player-card ${active ? 'active' : ''} ${thinking ? 'thinking-player' : ''}"><span class="avatar-wrap"><i class="stone-avatar ${side === BLACK ? 'black' : 'white'}"></i>${thinking ? '<i class="thinking-orbit"></i>' : ''}</span><span class="player-info"><strong>${escapeHtml(name)}</strong><small>${role}</small></span>${thinking ? '<span class="micro-thinking"><i></i><i></i><i></i></span>' : active ? '<span class="turn-badge">行棋</span>' : ''}</div>`
}

function renderGame() {
  const game = state.game
  const engineMode = isEngineMode(game)
  const gameLabel = game.mode === 'online' ? `房间 ${game.roomCode || ''}` : game.mode === 'local' ? '双人同屏' : game.mode === 'coach' ? `AI 教学 · ${LEVELS[game.level - 1]?.name || ''}` : `AI 对决 · ${LEVELS[game.level - 1]?.name || ''}`
  return `<main class="main game-main">
    <button class="back-button" data-view="home">${icon('back')}返回棋室</button>
    ${game.mode === 'coach' ? `<section class="coach-strip glass-panel"><span class="coach-orb">${icon('bulb')}</span><div><small>AI 教练</small><strong>${escapeHtml(state.coach.text)}</strong></div><button class="chip-button" data-action="coach-hint" ${state.coach.thinking || game.thinking || game.current !== game.humanSide ? 'disabled' : ''}>${state.coach.thinking ? '分析中…' : '提示下一手'}</button></section>` : ''}
    <div class="game-layout"><section class="board-panel glass-panel">
      <div class="board-topline"><span class="status-pill ${game.thinking ? 'thinking-status' : ''}"><i class="pulse"></i><span>${escapeHtml(currentTurnText(game))}</span>${game.thinking ? '<b id="thinking-clock">0.0s</b>' : ''}</span><span class="game-meta">${escapeHtml(gameLabel)}　${game.moves.length} 手</span></div>
      ${game.showSituation ? `<div class="situation-bar"><span>${icon('spark')}${escapeHtml(situationName(game))}</span><small>仅描述局势，不提供落子暗示</small></div>` : ''}
      <div class="canvas-wrap"><canvas id="game-board" aria-label="十五路五子棋棋盘"></canvas></div>
      ${state.pendingMove ? `<div class="move-confirm-bar"><span><small>预览落点</small><strong>${moveLabel(state.pendingMove)}</strong></span><button class="ghost-button" data-action="cancel-move">取消</button><button class="primary-button" data-action="confirm-move">确认落子</button></div>` : ''}
    </section><aside class="side-panel glass-panel">
      ${playerCard(BLACK, game.blackName, game)}${playerCard(WHITE, game.whiteName, game)}<div class="panel-divider"></div>
      ${engineMode ? `<div class="analysis-card"><div class="analysis-head"><strong id="engine-name">${escapeHtml(state.analysis.engine)}</strong><span>${game.thinking ? '自适应算力' : game.mode === 'coach' ? '教学引擎待命' : '实时计算'}</span></div><div class="analysis-grid"><span class="analysis-stat"><strong id="depth-value">${state.analysis.depth}</strong><small>深度</small></span><span class="analysis-stat"><strong id="nodes-value">${state.analysis.nodes}</strong><small>节点</small></span><span class="analysis-stat"><strong id="elapsed-value">${state.analysis.elapsed}</strong><small>耗时</small></span></div>${game.thinking ? `<div class="thinking-track"><i id="thinking-progress" style="width:2%"></i></div>` : ''}</div>` : game.mode === 'online' ? `<div class="analysis-card"><div class="analysis-head"><strong>端到端实时连接</strong><span>${escapeHtml(state.onlineStatus?.text || '已连接')}</span></div><div class="progress-line"><i style="width:${state.onlineStatus?.phase === 'connected' ? '100' : '55'}%"></i></div></div>` : `<div class="analysis-card local-match-card"><div class="analysis-head"><strong>双人同屏对弈</strong><span>本机轮流落子</span></div><p>黑方先行，棋谱和胜负结果会在结束后自动保存。</p></div>`}
      <div class="moves-box"><div class="moves-title"><span>落子记录</span><span>${game.moves.length} / 225</span></div><div class="move-chips">${game.moves.slice(-36).map((move, index) => `<span class="move-chip"><b>${game.moves.length - Math.min(36, game.moves.length) + index + 1}</b>${moveLabel(move)}</span>`).join('') || '<span class="empty-hint">等待第一手…</span>'}</div></div>
      <div class="game-toolbar">${game.mode !== 'online' ? `<button data-action="undo">${icon('undo')}<span>悔棋</span></button>` : `<button data-action="save-current">${icon('download')}<span>棋谱</span></button>`}<button data-action="restart">${icon('refresh')}<span>重开</span></button>${game.mode === 'coach' ? `<button data-action="coach-hint">${icon('bulb')}<span>提示</span></button>` : `<button data-action="game-tools">${icon('more')}<span>更多</span></button>`}<button class="danger" data-action="resign">${icon('flag')}<span>认输</span></button></div>
    </aside></div>
  </main>`
}

function annotateRecord(record) {
  const board = createBoard()
  return record.moves.map((move, index) => {
    const top = candidates(board, move.side, 3)[0]
    const actual = pointScore(board, move.x, move.y, move.side)
    let tag = ''
    let label = ''
    if (top && top.attack >= 50_000_000 && actual < 50_000_000) tag = 'mistake', label = '错过胜机'
    else if (top && top.attack >= 380_000 && actual < top.attack * .25) tag = 'question', label = '疑问手'
    else if (actual >= 2_000_000) tag = 'great', label = '强手'
    board[at(move.x, move.y)] = move.side
    return { index: index + 1, tag, label, suggested: top ? { x: top.x, y: top.y } : null }
  })
}

function renderReviewInsight(record) {
  if (state.replayIndex === 0) return `<div class="review-insight"><span class="insight-icon">${icon('spark')}</span><div><strong>从第一手开始</strong><p>选择任意落子，可查看快速判断并调用冠军引擎深度分析。</p></div></div>`
  const move = record.moves[state.replayIndex - 1]
  const quick = state.replayAnnotations[state.replayIndex - 1]
  const cached = getAnalysis(record.id, state.replayIndex)
  if (state.analyzing) return `<div class="review-insight analyzing"><span class="insight-icon">${icon('cpu')}</span><div><strong>冠军引擎正在深算</strong><p>棋盘保持可见，分析完成后会缓存到本机。</p><div class="thinking-track"><i style="width:68%"></i></div></div></div>`
  if (cached) {
    const best = cached.result || cached
    const bestMove = best.x != null ? moveLabel(best) : best.move ? moveLabel(best.move) : '—'
    const pv = (best.pv || []).slice(0, 5).map(moveLabel).join(' → ')
    return `<div class="review-insight result"><span class="insight-icon">${icon('cpu')}</span><div><strong>第 ${state.replayIndex} 手深度分析</strong><p>实战 ${moveLabel(move)} · 推荐 <b>${bestMove}</b>${pv ? `<br>主变化：${pv}` : ''}</p><small>${escapeHtml(best.engine || RAPFI_DISPLAY_NAME)} · ${best.elapsed ? `${(best.elapsed / 1000).toFixed(1)}s` : '已缓存'}</small></div><button class="chip-button" data-action="analyze-move">重新分析</button></div>`
  }
  return `<div class="review-insight"><span class="insight-icon ${quick?.tag || ''}">${icon(quick?.tag === 'mistake' ? 'flag' : 'spark')}</span><div><strong>${quick?.label || '局面平稳'}</strong><p>实战落子 ${moveLabel(move)}${quick?.suggested ? ` · 快速候选 ${moveLabel(quick.suggested)}` : ''}</p></div><button class="primary-button compact-button" data-action="analyze-move">${icon('cpu')}深度分析</button></div>`
}

function renderReplay() {
  const record = state.replay
  const move = record.moves[Math.max(0, state.replayIndex - 1)]
  return `<main class="main game-main"><button class="back-button" data-view="records">${icon('back')}返回棋谱</button>
    <div class="page-head"><div><span class="eyebrow"><i class="eyebrow-dot"></i> INTELLIGENT REPLAY</span><h1>${escapeHtml(record.title || '棋谱复盘')}</h1><p>${escapeHtml(record.blackName)} vs ${escapeHtml(record.whiteName)} · ${resultLabel(record)}</p></div><button class="secondary-button" data-action="export" data-id="${record.id}">${icon('download')}导出 SGF</button></div>
    <div class="game-layout"><section class="board-panel glass-panel"><div class="board-topline"><span class="status-pill"><i class="pulse"></i>${state.replayIndex === 0 ? '开局' : `第 ${state.replayIndex} 手 · ${moveLabel(move)}`}</span><span class="game-meta">${state.replayIndex} / ${record.moves.length}</span></div><div class="canvas-wrap"><canvas id="replay-board"></canvas></div></section>
    <aside class="side-panel replay-panel glass-panel">${playerCard(BLACK, record.blackName, { mode: record.mode, status: 'ended', current: 0, humanSide: record.blackName === '你' ? BLACK : WHITE, aiSide: isEngineMode(record.mode) ? (record.blackName === '你' ? WHITE : BLACK) : null, thinking: false })}${playerCard(WHITE, record.whiteName, { mode: record.mode, status: 'ended', current: 0, humanSide: record.whiteName === '你' ? WHITE : BLACK, aiSide: isEngineMode(record.mode) ? (record.whiteName === '你' ? BLACK : WHITE) : null, thinking: false })}<div class="moves-box replay-moves"><div class="move-chips">${record.moves.map((item, index) => { const annotation = state.replayAnnotations[index]; return `<button class="move-chip ${index + 1 === state.replayIndex ? 'active' : ''} ${annotation?.tag || ''}" data-action="replay-jump" data-index="${index + 1}"><b>${index + 1}</b>${moveLabel(item)}${annotation?.tag ? '<i></i>' : ''}</button>` }).join('')}</div></div><input id="replay-range" type="range" min="0" max="${record.moves.length}" value="${state.replayIndex}"><div class="control-grid"><button class="ghost-button" data-action="replay-prev">${icon('back')}上一步</button><button class="ghost-button" data-action="replay-next">下一步${icon('chevron')}</button><button class="primary-button" style="grid-column:1/-1" data-action="replay-auto">${icon('play')}${state.replayTimer ? '暂停播放' : '自动播放'}</button></div></aside></div>
    ${renderReviewInsight(record)}
  </main>`
}

function renderFooter() {
  return `<footer class="footer"><span>弈境五子棋 · Champion intelligence, quietly local.</span><span>15×15 自由规则 · 数据默认只保存在本机</span></footer>`
}

function renderModal() {
  if (!state.modal) return ''
  if (state.modal.type === 'play-settings') {
    const engineMode = state.lobbyMode === 'ai' || state.lobbyMode === 'coach'
    return `<div class="modal-backdrop settings-backdrop" data-action="close-modal"><section class="modal settings-modal" role="dialog" aria-modal="true" aria-label="玩法设置" data-modal><div class="modal-head"><div><span class="section-kicker">MATCH SETTINGS</span><h2>玩法设置</h2><p>${escapeHtml(lobbyPlaySummary())}</p></div><button class="modal-close" data-action="close-modal">${icon('close')}</button></div>
      ${engineMode ? `<div class="settings-group"><div class="settings-title"><strong>AI 棋力</strong><small>${state.lobbyMode === 'coach' ? '教学对手同样使用真实引擎' : '最高两档使用官方 NNUE'}</small></div><div class="settings-level-grid">${LEVELS.map((level) => `<button class="settings-choice ${state.lobbyLevel === level.id ? 'selected' : ''}" data-action="select-lobby-level" data-level="${level.id}"><small>0${level.id}</small><strong>${level.name}</strong><span>${level.subtitle}</span></button>`).join('')}</div></div>
      <div class="settings-group"><div class="settings-title"><strong>你的执子</strong><small>人机与教学局生效</small></div><div class="side-choice"><button class="select-card ${state.lobbySide === BLACK ? 'selected' : ''}" data-action="select-lobby-side" data-side="1"><i class="stone-avatar black"></i><strong>执黑先行</strong></button><button class="select-card ${state.lobbySide === WHITE ? 'selected' : ''}" data-action="select-lobby-side" data-side="2"><i class="stone-avatar white"></i><strong>执白后行</strong></button></div></div>` : `<div class="notice settings-mode-notice">${state.lobbyMode === 'local' ? '双人同屏固定黑方先行，双方在同一设备轮流落子。' : '房主执黑、加入者执白，连接成功后自动开始。'}</div>`}
      <div class="settings-group"><div class="settings-title"><strong>对局辅助</strong><small>只改变交互，不降低 AI 强度</small></div><div class="settings-toggle-list"><button data-action="toggle-setting" data-key="confirmMove"><span><strong>落子确认</strong><small>先预览，再确认落子</small></span><i class="switch ${state.confirmMove ? 'on' : ''}"><b></b></i></button><button data-action="toggle-setting" data-key="showSituation"><span><strong>局势名称</strong><small>仅显示阶段名称，不给提示</small></span><i class="switch ${state.showSituation ? 'on' : ''}"><b></b></i></button><button data-action="toggle-setting" data-key="showMoveNumbers"><span><strong>棋子手数</strong><small>在棋子上显示落子顺序</small></span><i class="switch ${state.showMoveNumbers ? 'on' : ''}"><b></b></i></button></div></div>
      <div class="settings-fixed"><span>${icon('grid')}<span><strong>15 × 15 标准棋盘</strong><small>与 Rapfi 冠军模型及现有棋谱保持一致</small></span></span><i>固定</i></div>
      <div class="modal-actions"><button class="primary-button" data-action="close-modal">完成设置${icon('check')}</button></div></section></div>`
  }
  if (state.modal.type === 'theme') return `<div class="modal-backdrop" data-action="close-modal"><section class="modal" role="dialog" aria-modal="true" aria-label="选择主题" data-modal><div class="modal-head"><div><h2>选择你的雾色</h2><p>浅色毛玻璃与棋盘会随主题一起变化。</p></div><button class="modal-close" data-action="close-modal">${icon('close')}</button></div><div class="theme-grid">${THEMES.map((theme) => `<button class="theme-card ${state.theme === theme.id ? 'selected' : ''}" data-action="select-theme" data-theme-id="${theme.id}" style="--preview-bg:${theme.bg};--preview-color:${theme.color};--preview-accent:${theme.accent}"><span class="theme-preview"><i></i></span><span>${theme.name}</span></button>`).join('')}</div></section></div>`
  if (state.modal.type === 'game-tools') return `<div class="modal-backdrop settings-backdrop" data-action="close-modal"><section class="modal game-tools-modal" role="dialog" aria-modal="true" aria-label="更多对局工具" data-modal><div class="modal-head"><div><span class="section-kicker">GAME TOOLS</span><h2>更多操作</h2><p>棋盘显示与棋谱导出。</p></div><button class="modal-close" data-action="close-modal">${icon('close')}</button></div><div class="tool-sheet-list"><button data-action="theme"><span>${icon('palette')}<span><strong>棋盘与主题</strong><small>${THEMES.find((theme) => theme.id === state.theme)?.name}</small></span></span>${icon('chevron')}</button><button data-action="toggle-game-numbers"><span>${icon('history')}<span><strong>显示棋子手数</strong><small>${state.game?.showMoveNumbers ? '当前已开启' : '当前已关闭'}</small></span></span><i class="switch ${state.game?.showMoveNumbers ? 'on' : ''}"><b></b></i></button><button data-action="export-json"><span>${icon('download')}<span><strong>导出 JSON</strong><small>包含完整落子与对局信息</small></span></span>${icon('chevron')}</button><button data-action="export-png"><span>${icon('download')}<span><strong>保存棋盘图片</strong><small>导出当前棋盘 PNG</small></span></span>${icon('chevron')}</button><button data-action="save-current"><span>${icon('history')}<span><strong>导出 SGF 棋谱</strong><small>通用棋谱交换格式</small></span></span>${icon('chevron')}</button></div></section></div>`
  if (state.modal.type === 'ai') {
    const selected = state.modal.level || 5
    return `<div class="modal-backdrop" data-action="close-modal"><section class="modal" role="dialog" aria-modal="true" data-modal><div class="modal-head"><div><h2>选择挑战强度</h2><p>最高两档使用 Rapfi 2026 冠军同源核心与官方 mix9svq NNUE。</p></div><button class="modal-close" data-action="close-modal">${icon('close')}</button></div><div class="engine-ready ${state.aiWarmup}"><i></i><span>${state.aiWarmup === 'ready' ? '官方 NNUE 已预热' : state.aiWarmup === 'loading' ? '正在校验并预热官方 NNUE' : state.aiWarmup === 'error' ? 'NNUE 加载失败，将使用兼容引擎' : 'NNUE 将在需要时加载'}</span></div><div class="select-list">${LEVELS.map((level) => `<button class="select-card ${selected === level.id ? 'selected' : ''}" data-action="select-level" data-level="${level.id}"><span class="select-number">${level.id}</span><span><strong>${level.name}</strong><small>${level.subtitle}</small></span>${level.id >= 4 ? '<span class="tag">极难</span>' : ''}</button>`).join('')}</div><span class="field-label">选择执子</span><div class="side-choice"><button class="select-card ${state.modal.side !== WHITE ? 'selected' : ''}" data-action="select-side" data-side="1"><i class="stone-avatar black"></i><strong>执黑先行</strong></button><button class="select-card ${state.modal.side === WHITE ? 'selected' : ''}" data-action="select-side" data-side="2"><i class="stone-avatar white"></i><strong>执白后行</strong></button></div><div class="modal-actions"><button class="primary-button" data-action="start-ai">开始对弈${icon('arrow')}</button></div></section></div>`
  }
  if (state.modal.type === 'online') {
    const phase = state.modal.phase || 'choose'
    if (phase === 'room') return `<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true" data-modal><div class="modal-head"><div><h2>远程棋室</h2><p>发送房间链接或六位代码给对手。</p></div><button class="modal-close" data-action="cancel-online">${icon('close')}</button></div><div class="room-code"><small>六位房间码</small><strong>${escapeHtml(state.modal.code)}</strong></div><div class="room-status"><i class="eyebrow-dot"></i>${escapeHtml(state.onlineStatus?.text || '正在连接…')}</div><div class="modal-actions"><button class="secondary-button" data-action="copy-room">${icon('copy')}复制代码</button><button class="primary-button" data-action="share-room">${icon('share')}分享邀请链接</button></div></section></div>`
    return `<div class="modal-backdrop" data-action="close-modal"><section class="modal" role="dialog" aria-modal="true" data-modal><div class="modal-head"><div><h2>远程联机</h2><p>创建房间，或输入好友发来的房间码。</p></div><button class="modal-close" data-action="close-modal">${icon('close')}</button></div><button class="select-card selected" data-action="create-room"><span class="select-number">${icon('wifi')}</span><span><strong>创建新房间</strong><small>你执黑先行，生成邀请链接</small></span>${icon('chevron')}</button><span class="field-label">加入已有房间</span><input class="input" id="join-code" maxlength="6" autocomplete="off" value="${escapeHtml(state.modal.prefill || '')}" placeholder="输入 6 位房间码" aria-label="房间码">${state.modal.prefill ? '<div class="invite-hint">已从邀请链接识别房间码，确认后即可加入。</div>' : ''}<div class="modal-actions"><button class="primary-button" data-action="join-room">加入房间${icon('arrow')}</button></div></section></div>`
  }
  if (state.modal.type === 'puzzle') {
    const puzzle = PUZZLES.find((item) => item.id === state.modal.id)
    return `<div class="modal-backdrop" data-action="close-modal"><section class="modal" role="dialog" aria-modal="true" data-modal><div class="modal-head"><div><h2>${puzzle.title}</h2><p>${puzzle.desc}</p></div><button class="modal-close" data-action="close-modal">${icon('close')}</button></div><div class="canvas-wrap"><canvas id="puzzle-board"></canvas></div><div class="notice" style="margin:1rem 0 0">点击你认为正确的交叉点。答错可以继续尝试。</div></section></div>`
  }
  if (state.modal.type === 'result') return `<div class="modal-backdrop"><section class="modal result-modal" role="dialog" aria-modal="true" data-modal><div class="modal-head"><div><h2>${escapeHtml(state.game.resultText)}</h2><p>本局 ${state.game.moves.length} 手，棋谱与数据统计已经更新。</p></div></div><div class="result-summary"><span>${icon('history')}</span><div><small>自动棋谱</small><strong>已保存至本机</strong></div></div><div class="modal-actions"><button class="secondary-button" data-action="view-last-record">${icon('spark')}智能复盘</button><button class="primary-button" data-action="restart">再来一局</button></div></section></div>`
  if (state.modal.type === 'backup-preview') {
    const backup = state.modal.payload
    return `<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true" data-modal><div class="modal-head"><div><h2>确认导入完整备份</h2><p>同 ID 数据将保留更新时间较新的版本。</p></div><button class="modal-close" data-action="close-modal">${icon('close')}</button></div><div class="backup-preview"><span><small>棋谱</small><strong>${backup.history?.length || 0}</strong></span><span><small>未完对局</small><strong>${backup.unfinishedGame ? 1 : 0}</strong></span><span><small>分析缓存</small><strong>${Object.keys(backup.analysis || {}).length}</strong></span></div><div class="notice">数据只会写入当前浏览器，不会上传到服务器。</div><div class="modal-actions"><button class="secondary-button" data-action="close-modal">取消</button><button class="primary-button" data-action="confirm-backup">确认合并</button></div></section></div>`
  }
  if (state.modal.type === 'install') return `<div class="modal-backdrop" data-action="close-modal"><section class="modal" role="dialog" aria-modal="true" data-modal><div class="modal-head"><div><h2>安装弈境五子棋到桌面</h2><p>安装后可像原生应用一样全屏打开。</p></div><button class="modal-close" data-action="close-modal">${icon('close')}</button></div><div class="notice">iPhone：使用 Safari 的“分享 → 添加到主屏幕”。<br>安卓：打开浏览器菜单，选择“安装应用”或“添加到主屏幕”。</div></section></div>`
  return ''
}

function render() {
  if (state.view !== 'replay' && state.replayTimer) clearInterval(state.replayTimer), state.replayTimer = null
  const views = { home: renderHome, features: renderFeatures, stats: renderStats, records: renderRecords, learn: renderLearn, game: renderGame, replay: renderReplay }
  const content = (views[state.view] || renderHome)()
  app.innerHTML = `<div class="app">${renderHeader()}${content}${renderModal()}<div class="toast-stack" id="toasts"></div></div>`
  bindCanvas()
  syncThinkingTicker()
}

function setView(view) {
  state.view = view
  state.modal = null
  if (view !== 'replay') state.analyzing = false
  render()
}

function gameSnapshot(game) {
  return { id: game.id, mode: game.mode, moves: game.moves, current: game.current, humanSide: game.humanSide, aiSide: game.aiSide, level: game.level, startedAt: game.startedAt, blackName: game.blackName, whiteName: game.whiteName, status: game.status, confirmMove: game.confirmMove, showSituation: game.showSituation, showMoveNumbers: game.showMoveNumbers }
}

function persistActiveGame() {
  if (state.game?.mode === 'ai' && state.game.status === 'playing') {
    saveUnfinishedGame(gameSnapshot(state.game))
    state.unfinished = loadUnfinishedGame()
  }
}

function newGame(mode, options = {}) {
  const humanSide = options.humanSide || BLACK
  const engineMode = isEngineMode(mode)
  const aiSide = engineMode ? other(humanSide) : null
  if (mode === 'ai') clearUnfinishedGame()
  const level = options.level || state.lobbyLevel || 5
  const aiName = mode === 'coach' ? `教练 · ${LEVELS[level - 1].name}` : LEVELS[level - 1].name
  const blackName = engineMode ? (humanSide === BLACK ? '你' : aiName) : mode === 'local' ? '黑方玩家' : (humanSide === BLACK ? '你' : '远程对手')
  const whiteName = engineMode ? (humanSide === WHITE ? '你' : aiName) : mode === 'local' ? '白方玩家' : (humanSide === WHITE ? '你' : '远程对手')
  state.game = {
    id: crypto.randomUUID(), mode, board: createBoard(), moves: [], current: BLACK, status: 'playing', humanSide, aiSide,
    level, startedAt: new Date().toISOString(), thinking: false,
    blackName, whiteName,
    roomCode: options.roomCode || null, winnerLine: null, resultText: '', resultCode: '',
    confirmMove: state.confirmMove, showSituation: state.showSituation, showMoveNumbers: state.showMoveNumbers,
  }
  state.pendingMove = null
  state.coach = { thinking: false, text: '需要时可调用冠军引擎分析下一手。', suggested: null }
  state.analysis = { engine: engineMode && level >= 4 ? (state.aiWarmup === 'error' ? FALLBACK_DISPLAY_NAME : RAPFI_DISPLAY_NAME) : '弈境策略引擎', depth: '—', nodes: '—', elapsed: '—', budget: 0 }
  state.view = 'game'; state.modal = null
  persistActiveGame(); render()
  if (engineMode && aiSide === BLACK) setTimeout(triggerAi, 180)
}

function resumeGame() {
  const saved = loadUnfinishedGame()
  if (!saved || saved.mode !== 'ai' || saved.status !== 'playing') return toast('没有可继续的 AI 对局', 'error')
  state.game = { ...saved, board: boardAtMove(saved.moves || []), thinking: false, winnerLine: null, resultText: '', resultCode: '', roomCode: null, confirmMove: saved.confirmMove ?? state.confirmMove, showSituation: saved.showSituation ?? state.showSituation, showMoveNumbers: saved.showMoveNumbers ?? state.showMoveNumbers }
  state.pendingMove = null
  state.analysis = { engine: saved.level >= 4 ? (state.aiWarmup === 'error' ? FALLBACK_DISPLAY_NAME : RAPFI_DISPLAY_NAME) : '弈境策略引擎', depth: '—', nodes: '—', elapsed: '—', budget: 0 }
  state.view = 'game'; state.modal = null; render()
  if (state.game.current === state.game.aiSide) setTimeout(triggerAi, 180)
}

function applyMove(x, y, side, remote = false) {
  const game = state.game
  if (!game || game.status !== 'playing' || side !== game.current || !play(game.board, x, y, side)) return false
  const move = { x, y, side, at: Date.now() }
  game.moves.push(move); game.current = other(side); state.pendingMove = null; state.coach.suggested = null
  const won = winnerFrom(game.board, x, y)
  if (won) finishGame(side, `${side === BLACK ? '黑方' : '白方'}获胜`, `${side === BLACK ? 'B' : 'W'}+R`, won.line)
  else if (isFull(game.board)) finishGame(null, '和棋', '0', null)
  else persistActiveGame()
  if (game.mode === 'online' && !remote) room?.send({ type: 'move', move, index: game.moves.length })
  render()
  if (isEngineMode(game) && game.status === 'playing' && game.current === game.aiSide) setTimeout(triggerAi, 140)
  return true
}

async function triggerAi() {
  const game = state.game
  if (!game || !isEngineMode(game) || game.status !== 'playing' || game.current !== game.aiSide || game.thinking) return
  game.thinking = true
  state.analysis = { engine: game.level >= 4 ? (state.aiWarmup === 'error' ? FALLBACK_DISPLAY_NAME : RAPFI_DISPLAY_NAME) : '弈境策略引擎', depth: '—', nodes: '—', elapsed: '0.0s', budget: adaptiveBudget(game.level, game.board, game.aiSide) }
  game.thinkingStartedAt = performance.now()
  render()
  const token = game.id
  try {
    const result = await ai.think(game.board, game.aiSide, game.level, game.moves, game.id)
    if (state.game?.id !== token || state.game.status !== 'playing') return
    state.analysis.engine = game.level >= 4 && state.aiWarmup === 'error'
      ? FALLBACK_DISPLAY_NAME
      : result.engine || state.analysis.engine
    state.analysis.depth = result.depth
      ? result.seldepth && result.seldepth !== result.depth ? `${result.depth}/${result.seldepth}` : result.depth
      : state.analysis.depth
    state.analysis.nodes = result.nodes ? compactNumber(result.nodes) : state.analysis.nodes
    state.analysis.elapsed = result.elapsed ? `${(result.elapsed / 1000).toFixed(1)}s` : state.analysis.elapsed
    game.thinking = false
    applyMove(result.x, result.y, game.aiSide)
  } catch (error) {
    if (state.game?.id === token) {
      game.thinking = false
      toast(`AI 暂时无法落子：${error.message}`, 'error')
      render()
    }
  }
}

function finishGame(winner, text, code, line) {
  const game = state.game
  game.status = 'ended'; game.winner = winner; game.resultText = text; game.resultCode = code; game.winnerLine = line; game.endedAt = new Date().toISOString(); game.thinking = false
  clearUnfinishedGame(); state.unfinished = null
  state.history = saveRecord(gameToRecord(game))
  setTimeout(() => { if (state.game?.id === game.id) state.modal = { type: 'result' }, render() }, 360)
}

function gameToRecord(game) {
  const title = game.mode === 'online' ? '远程棋室对局' : game.mode === 'local' ? '双人同屏对局' : game.mode === 'coach' ? `AI 教学 · ${LEVELS[game.level - 1]?.name || ''}` : `挑战 ${LEVELS[game.level - 1]?.name || 'AI'}`
  return { id: game.id, size: SIZE, title, mode: game.mode, level: game.level, levelName: LEVELS[game.level - 1]?.name, blackName: game.blackName, whiteName: game.whiteName, startedAt: game.startedAt, endedAt: game.endedAt || new Date().toISOString(), moves: game.moves, resultText: game.resultText || '未完', resultCode: game.resultCode || 'Void' }
}

function setupRoom() {
  room?.close()
  room = new OnlineRoom({
    status: (status) => { state.onlineStatus = status; if (state.modal?.type === 'online' || state.view === 'game') render() },
    error: ({ text }) => toast(text, 'error'),
    connected: ({ role, code }) => {
      if (role === 'host') {
        if (state.game?.mode === 'online' && state.game.roomCode === code) state.onlineStatus = { phase: 'connected', text: '对手已重新连接' }, room.send({ type: 'sync', code, game: onlineSnapshot() }), render()
        else newGame('online', { humanSide: BLACK, roomCode: code }), room.send({ type: 'start', code, blackName: '房主', whiteName: '挑战者' })
      } else state.onlineStatus = { phase: 'connected', text: '已连接，正在同步棋局' }, room.send({ type: 'sync-request' })
    },
    message: handleOnlineMessage,
  })
}

function onlineSnapshot() {
  if (!state.game) return null
  return { moves: state.game.moves, current: state.game.current, status: state.game.status, resultText: state.game.resultText, resultCode: state.game.resultCode, blackName: state.game.blackName, whiteName: state.game.whiteName, startedAt: state.game.startedAt }
}

function handleOnlineMessage(message) {
  if (message.type === 'start') newGame('online', { humanSide: WHITE, roomCode: message.code }), Object.assign(state.game, { blackName: '远程对手', whiteName: '你' }), render()
  else if (message.type === 'move' && state.game?.mode === 'online') message.index === state.game.moves.length + 1 ? applyMove(message.move.x, message.move.y, message.move.side, true) : room.send({ type: 'sync-request' })
  else if (message.type === 'sync-request' && state.game) room.send({ type: 'sync', code: state.game.roomCode, game: onlineSnapshot() })
  else if (message.type === 'sync' && message.game) {
    if (!state.game || state.game.mode !== 'online') newGame('online', { humanSide: WHITE, roomCode: message.code || room?.code }), Object.assign(state.game, { blackName: '远程对手', whiteName: '你' })
    state.game.moves = message.game.moves; state.game.board = boardAtMove(state.game.moves); Object.assign(state.game, { current: message.game.current, status: message.game.status, resultText: message.game.resultText, resultCode: message.game.resultCode, startedAt: message.game.startedAt || state.game.startedAt }); render()
  } else if (message.type === 'restart' && state.game?.mode === 'online') newGame('online', { humanSide: state.game.humanSide, roomCode: state.game.roomCode })
  else if (message.type === 'resign' && state.game?.status === 'playing') { const winner = state.game.humanSide; finishGame(winner, '对手认输，你获胜', `${winner === BLACK ? 'B' : 'W'}+R`, null); render() }
}

function drawBoard(canvas, board, moves = [], options = {}) {
  if (!canvas) return
  const rect = canvas.getBoundingClientRect(); const dpr = Math.min(window.devicePixelRatio || 1, 2); const size = Math.max(280, rect.width)
  canvas.width = Math.round(size * dpr); canvas.height = Math.round(size * dpr)
  const context = canvas.getContext('2d'); context.scale(dpr, dpr); context.clearRect(0, 0, size, size)
  const margin = size * .058; const step = (size - margin * 2) / 14
  context.lineWidth = Math.max(1, size / 620); context.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--board-line').trim() || 'rgba(83,68,48,.52)'
  for (let index = 0; index < SIZE; index++) { const point = margin + index * step; context.beginPath(); context.moveTo(margin, point); context.lineTo(size - margin, point); context.stroke(); context.beginPath(); context.moveTo(point, margin); context.lineTo(point, size - margin); context.stroke() }
  context.fillStyle = context.strokeStyle
  for (const [x, y] of [[3, 3], [11, 3], [7, 7], [3, 11], [11, 11]]) { context.beginPath(); context.arc(margin + x * step, margin + y * step, Math.max(2, size / 155), 0, Math.PI * 2); context.fill() }
  const moveNumbers = new Map(moves.map((move, index) => [at(move.x, move.y), index + 1]))
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    const side = board[at(x, y)]; if (!side) continue
    const centerX = margin + x * step; const centerY = margin + y * step; const radius = step * .43
    context.save(); context.shadowColor = 'rgba(31,36,49,.24)'; context.shadowBlur = radius * .32; context.shadowOffsetY = radius * .17
    const gradient = context.createRadialGradient(centerX - radius * .3, centerY - radius * .36, radius * .08, centerX, centerY, radius)
    if (side === BLACK) gradient.addColorStop(0, '#687385'), gradient.addColorStop(.43, '#252c3a'), gradient.addColorStop(1, '#0f141e')
    else gradient.addColorStop(0, '#fff'), gradient.addColorStop(.55, '#f2f5f9'), gradient.addColorStop(1, '#cfd6e2')
    context.fillStyle = gradient; context.beginPath(); context.arc(centerX, centerY, radius, 0, Math.PI * 2); context.fill(); context.restore()
    if (options.showMoveNumbers) {
      const number = moveNumbers.get(at(x, y)); if (number) { context.fillStyle = side === BLACK ? 'rgba(255,255,255,.9)' : 'rgba(35,46,68,.8)'; context.font = `700 ${Math.max(7, step * .28)}px system-ui`; context.textAlign = 'center'; context.textBaseline = 'middle'; context.fillText(number, centerX, centerY + .4) }
    }
  }
  const last = moves[moves.length - 1]
  if (last) { const x = margin + last.x * step; const y = margin + last.y * step; context.strokeStyle = last.side === BLACK ? 'rgba(255,255,255,.8)' : 'rgba(65,78,104,.62)'; context.lineWidth = Math.max(1.5, size / 350); context.beginPath(); context.arc(x, y, step * .15, 0, Math.PI * 2); context.stroke() }
  if (options.hover && board[at(options.hover.x, options.hover.y)] === EMPTY) { context.globalAlpha = .24; context.fillStyle = options.hover.side === BLACK ? '#111827' : '#fff'; context.beginPath(); context.arc(margin + options.hover.x * step, margin + options.hover.y * step, step * .4, 0, Math.PI * 2); context.fill(); context.globalAlpha = 1 }
  if (options.pending && board[at(options.pending.x, options.pending.y)] === EMPTY) { const x = margin + options.pending.x * step; const y = margin + options.pending.y * step; context.globalAlpha = .62; context.fillStyle = options.pending.side === BLACK ? '#141b28' : '#fff'; context.beginPath(); context.arc(x, y, step * .41, 0, Math.PI * 2); context.fill(); context.globalAlpha = 1; context.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--primary').trim(); context.lineWidth = Math.max(2, size / 230); context.beginPath(); context.arc(x, y, step * .5, 0, Math.PI * 2); context.stroke() }
  if (options.suggested && board[at(options.suggested.x, options.suggested.y)] === EMPTY) { const x = margin + options.suggested.x * step; const y = margin + options.suggested.y * step; context.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--primary').trim(); context.globalAlpha = .18; context.beginPath(); context.arc(x, y, step * .47, 0, Math.PI * 2); context.fill(); context.globalAlpha = 1; context.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--primary').trim(); context.lineWidth = Math.max(2, size / 250); context.setLineDash([step * .16, step * .12]); context.beginPath(); context.arc(x, y, step * .53, 0, Math.PI * 2); context.stroke(); context.setLineDash([]) }
  if (options.winnerLine?.length) { const start = options.winnerLine[0]; const end = options.winnerLine.at(-1); context.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--primary').trim(); context.lineWidth = Math.max(3, size / 125); context.lineCap = 'round'; context.beginPath(); context.moveTo(margin + start.x * step, margin + start.y * step); context.lineTo(margin + end.x * step, margin + end.y * step); context.stroke() }
  canvas._metrics = { margin, step, size }
}

function canvasPoint(canvas, event) {
  const rect = canvas.getBoundingClientRect(); const { margin, step } = canvas._metrics
  const x = Math.round((event.clientX - rect.left - margin) / step); const y = Math.round((event.clientY - rect.top - margin) / step)
  return x >= 0 && y >= 0 && x < SIZE && y < SIZE ? { x, y } : null
}

function bindCanvas() {
  resizeObserver?.disconnect()
  const canvas = document.querySelector('#game-board')
  if (canvas && state.game) {
    const redraw = () => drawBoard(canvas, state.game.board, state.game.moves, { hover: state.hover, pending: state.pendingMove, suggested: state.coach.suggested, showMoveNumbers: state.game.showMoveNumbers, winnerLine: state.game.winnerLine })
    redraw(); resizeObserver = new ResizeObserver(redraw); resizeObserver.observe(canvas)
    canvas.addEventListener('pointermove', (event) => { const point = canvasPoint(canvas, event); if (point?.x !== state.hover?.x || point?.y !== state.hover?.y) state.hover = point, redraw() })
    canvas.addEventListener('pointerleave', () => { state.hover = null; redraw() })
    canvas.addEventListener('pointerdown', (event) => {
      const point = canvasPoint(canvas, event); const game = state.game; const playableSide = game?.mode === 'local' ? game.current : game?.humanSide
      if (!point || !game || game.status !== 'playing' || game.thinking || game.current !== playableSide || game.board[at(point.x, point.y)] !== EMPTY) return
      if (game.confirmMove) {
        if (state.pendingMove?.x === point.x && state.pendingMove?.y === point.y) { if (applyMove(point.x, point.y, playableSide)) vibrate(12) }
        else state.pendingMove = { ...point, side: playableSide }, vibrate(7), render()
      } else if (applyMove(point.x, point.y, playableSide)) vibrate(12)
    })
  }
  const replay = document.querySelector('#replay-board')
  if (replay && state.replay) { const redraw = () => drawBoard(replay, boardAtMove(state.replay.moves, state.replayIndex), state.replay.moves.slice(0, state.replayIndex)); redraw(); resizeObserver = new ResizeObserver(redraw); resizeObserver.observe(replay) }
  const puzzleCanvas = document.querySelector('#puzzle-board')
  if (puzzleCanvas && state.modal?.type === 'puzzle') {
    const puzzle = PUZZLES.find((item) => item.id === state.modal.id); const board = createBoard(); const moves = puzzle.moves.map(([x, y, side]) => ({ x, y, side })); for (const move of moves) board[at(move.x, move.y)] = move.side
    const redraw = () => drawBoard(puzzleCanvas, board, moves); redraw(); resizeObserver = new ResizeObserver(redraw); resizeObserver.observe(puzzleCanvas)
    puzzleCanvas.addEventListener('pointerdown', (event) => { const point = canvasPoint(puzzleCanvas, event); if (!point) return; if (point.x === puzzle.solution.x && point.y === puzzle.solution.y) board[at(point.x, point.y)] = BLACK, moves.push({ ...point, side: BLACK }), redraw(), vibrate([20, 40, 20]), toast('漂亮！这是唯一的关键手。', 'success'); else vibrate(35), toast('这手还不够强，再看一看对方的威胁。', 'error') })
  }
}

function syncThinkingTicker() {
  clearInterval(thinkingTicker); thinkingTicker = null
  if (!state.game?.thinking) return
  const started = state.game.thinkingStartedAt || performance.now(); const budget = Math.max(1, state.analysis.budget || 8000)
  const update = () => {
    const elapsed = performance.now() - started
    const text = `${(elapsed / 1000).toFixed(1)}s`
    const clock = document.querySelector('#thinking-clock'); if (clock) clock.textContent = text
    const elapsedNode = document.querySelector('#elapsed-value'); if (elapsedNode) elapsedNode.textContent = text
    const progress = document.querySelector('#thinking-progress'); if (progress) progress.style.width = `${Math.min(96, elapsed / budget * 100)}%`
  }
  update(); thinkingTicker = setInterval(update, 100)
}

function updateAnalysisPanel() {
  const set = (selector, value) => { const element = document.querySelector(selector); if (element) element.textContent = value }
  set('#engine-name', state.analysis.engine); set('#depth-value', state.analysis.depth); set('#nodes-value', state.analysis.nodes)
}

function vibrate(pattern) { if ('vibrate' in navigator) navigator.vibrate(pattern) }

function toast(message, type = '') {
  const container = document.querySelector('#toasts'); if (!container) return
  const item = document.createElement('div'); item.className = `toast ${type}`; item.textContent = message; container.append(item); setTimeout(() => item.remove(), 3200)
}

function exportRecord(record) {
  if (!record) return
  const safe = (record.title || '弈境棋谱').replace(/[\\/:*?"<>|]/g, '-')
  downloadText(`${safe}.sgf`, recordToSgf(record), 'application/x-go-sgf;charset=utf-8'); toast('SGF 棋谱已导出', 'success')
}

function openReplay(record) {
  state.replay = record; state.replayIndex = record.moves.length; state.replayAnnotations = annotateRecord(record); state.analyzing = false; state.view = 'replay'; state.modal = null; render()
}

async function warmupAi() {
  if (state.aiWarmup === 'ready' || state.aiWarmup === 'loading') return
  state.aiWarmup = 'loading'
  try { await ai.warmup(); state.aiWarmup = 'ready' } catch { state.aiWarmup = 'error' }
  if (state.modal?.type === 'ai' || state.modal?.type === 'play-settings' || state.view === 'features' || state.view === 'home') render()
}

async function analyzeCurrentMove() {
  if (!state.replay || state.replayIndex < 1 || state.analyzing) return
  const record = state.replay; const index = state.replayIndex; const move = record.moves[index - 1]
  state.analyzing = true; render()
  try {
    const board = boardAtMove(record.moves, index - 1)
    const result = await ai.analyze(board, move.side, record.moves.slice(0, index - 1), { gameId: `analysis-${record.id}-${index}`, budget: 3000 })
    saveAnalysis(record.id, index, result); state.analyzing = false; render(); toast('深度分析已缓存', 'success')
  } catch (error) { state.analyzing = false; render(); toast(`分析失败：${error.message}`, 'error') }
}

async function requestCoachHint() {
  const game = state.game
  if (!game || game.mode !== 'coach' || game.status !== 'playing' || game.thinking || game.current !== game.humanSide || state.coach.thinking) return
  state.coach = { thinking: true, text: '冠军引擎正在比较候选落点…', suggested: null }; render()
  const token = `${game.id}-${game.moves.length}`
  try {
    const result = await ai.analyze(game.board, game.humanSide, game.moves, { gameId: `coach-${token}`, budget: 3000 })
    if (!state.game || `${state.game.id}-${state.game.moves.length}` !== token || state.game.current !== state.game.humanSide) return
    const suggested = result.move || (result.x != null ? { x: result.x, y: result.y } : null)
    state.coach = { thinking: false, suggested, text: suggested ? `推荐关注 ${moveLabel(suggested)}，虚线光环已标在棋盘上。` : '当前局面没有稳定的单一推荐手。' }
    render()
  } catch (error) {
    state.coach = { thinking: false, text: `提示暂不可用：${error.message}`, suggested: null }; render()
  }
}

function exportCurrentJson() {
  if (!state.game) return
  downloadText(`弈境对局-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(gameToRecord(state.game), null, 2), 'application/json;charset=utf-8')
  toast('JSON 对局数据已导出', 'success')
}

function exportCurrentPng() {
  const canvas = document.querySelector('#game-board')
  if (!canvas) return toast('棋盘尚未准备好', 'error')
  canvas.toBlob((blob) => {
    if (!blob) return toast('棋盘图片生成失败', 'error')
    const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `弈境棋盘-${new Date().toISOString().slice(0, 10)}.png`; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 1000); toast('棋盘图片已保存', 'success')
  }, 'image/png')
}

function inviteUrl(code) {
  const url = new URL(location.href); url.search = ''; url.hash = ''; url.searchParams.set('room', code); return url.toString()
}

app.addEventListener('click', async (event) => {
  const target = event.target.closest('[data-action], [data-view]'); if (!target) return
  if (target.dataset.modal !== undefined) return
  if (target.dataset.view) return setView(target.dataset.view)
  const action = target.dataset.action
  if (action === 'theme') state.modal = { type: 'theme' }, render()
  else if (action === 'toggle-sound') { state.sound = !state.sound; persistUiSettings(); vibrate(8); render() }
  else if (action === 'close-modal') { if (event.target.closest('[data-modal]') && !event.target.closest('.modal-close') && target.dataset.action !== 'close-modal') return; state.modal = null; render() }
  else if (action === 'select-theme') state.theme = target.dataset.themeId, document.documentElement.dataset.theme = state.theme, persistUiSettings(), render()
  else if (action === 'select-lobby-mode') { state.lobbyMode = target.dataset.mode; persistUiSettings(); render(); if (state.lobbyMode === 'ai' || state.lobbyMode === 'coach') warmupAi() }
  else if (action === 'open-play-settings') { state.modal = { type: 'play-settings' }; render(); if (state.lobbyMode === 'ai' || state.lobbyMode === 'coach') warmupAi() }
  else if (action === 'select-lobby-level') { state.lobbyLevel = Number(target.dataset.level); persistUiSettings(); render() }
  else if (action === 'select-lobby-side') { state.lobbySide = Number(target.dataset.side); persistUiSettings(); render() }
  else if (action === 'toggle-setting') { const key = target.dataset.key; if (['confirmMove', 'showSituation', 'showMoveNumbers'].includes(key)) state[key] = !state[key], persistUiSettings(), render() }
  else if (action === 'start-lobby') { if (state.lobbyMode === 'online') state.modal = { type: 'online', phase: 'choose' }, render(); else newGame(state.lobbyMode, { level: state.lobbyLevel, humanSide: state.lobbyMode === 'local' ? BLACK : state.lobbySide }) }
  else if (action === 'open-ai') { state.modal = { type: 'ai', level: Number(target.dataset.level || 5), side: BLACK }; render(); warmupAi() }
  else if (action === 'select-level') state.modal.level = Number(target.dataset.level), render()
  else if (action === 'select-side') state.modal.side = Number(target.dataset.side), render()
  else if (action === 'start-ai') newGame('ai', { level: state.modal.level, humanSide: state.modal.side })
  else if (action === 'resume-game') resumeGame()
  else if (action === 'open-online') state.modal = { type: 'online', phase: 'choose' }, render()
  else if (action === 'create-room') { setupRoom(); const code = room.create(); state.modal = { type: 'online', phase: 'room', code }; render() }
  else if (action === 'join-room') { try { const code = document.querySelector('#join-code')?.value; setupRoom(); room.join(code); history.replaceState({}, '', location.pathname); state.modal = { type: 'online', phase: 'room', code: String(code).trim().toUpperCase() }; render() } catch (error) { toast(error.message, 'error') } }
  else if (action === 'copy-room') { await navigator.clipboard.writeText(state.modal.code); toast('房间码已复制', 'success') }
  else if (action === 'share-room') { const url = inviteUrl(state.modal.code); try { if (navigator.share) await navigator.share({ title: '加入我的弈境棋室', text: `房间码 ${state.modal.code}`, url }); else await navigator.clipboard.writeText(url), toast('邀请链接已复制', 'success') } catch (error) { if (error.name !== 'AbortError') await navigator.clipboard.writeText(url), toast('邀请链接已复制', 'success') } }
  else if (action === 'cancel-online') room?.close(), state.modal = null, render()
  else if (action === 'cancel-move') state.pendingMove = null, render()
  else if (action === 'confirm-move') { const game = state.game; const move = state.pendingMove; if (game && move && game.status === 'playing' && !game.thinking && game.current === move.side) applyMove(move.x, move.y, move.side), vibrate(12) }
  else if (action === 'undo') { const game = state.game; if (game && game.mode !== 'online' && game.status === 'playing' && !game.thinking && game.moves.length) { const count = isEngineMode(game) ? (game.current === game.humanSide ? 2 : 1) : 1; game.moves.splice(Math.max(0, game.moves.length - count), count); game.board = boardAtMove(game.moves); game.current = game.moves.length % 2 ? WHITE : BLACK; state.pendingMove = null; state.coach.suggested = null; persistActiveGame(); render() } }
  else if (action === 'restart') { const game = state.game; state.modal = null; if (game.mode === 'online') room?.send({ type: 'restart' }), newGame('online', { humanSide: game.humanSide, roomCode: game.roomCode }); else newGame(game.mode, { level: game.level, humanSide: game.humanSide }) }
  else if (action === 'resign') { const game = state.game; if (game?.status === 'playing') { if (game.mode === 'online') room?.send({ type: 'resign' }); const resigningSide = game.mode === 'local' ? game.current : game.humanSide; const winner = other(resigningSide); finishGame(winner, `${resigningSide === BLACK ? '黑方' : '白方'}认输`, `${winner === BLACK ? 'B' : 'W'}+R`, null); render() } }
  else if (action === 'coach-hint') requestCoachHint()
  else if (action === 'game-tools') state.modal = { type: 'game-tools' }, render()
  else if (action === 'toggle-game-numbers') { state.showMoveNumbers = !state.showMoveNumbers; if (state.game) state.game.showMoveNumbers = state.showMoveNumbers; persistUiSettings(); render() }
  else if (action === 'export-json') exportCurrentJson()
  else if (action === 'export-png') exportCurrentPng()
  else if (action === 'save-current') exportRecord(gameToRecord(state.game))
  else if (action === 'replay') { const record = state.history.find((item) => item.id === target.dataset.id); if (record) openReplay(record) }
  else if (action === 'view-last-record') { const record = state.history.find((item) => item.id === state.game.id); if (record) openReplay(record) }
  else if (action === 'export') exportRecord(state.history.find((item) => item.id === target.dataset.id) || state.replay)
  else if (action === 'delete-record') state.history = deleteRecord(target.dataset.id), render(), toast('棋谱已删除')
  else if (action === 'import-record') document.querySelector('#record-file')?.click()
  else if (action === 'clear-filters') state.filters = { query: '', mode: 'all', result: 'all', level: 'all', date: 'all' }, render()
  else if (action === 'replay-prev') state.replayIndex = Math.max(0, state.replayIndex - 1), render()
  else if (action === 'replay-next') state.replayIndex = Math.min(state.replay.moves.length, state.replayIndex + 1), render()
  else if (action === 'replay-jump') state.replayIndex = Number(target.dataset.index), render()
  else if (action === 'replay-auto') { if (state.replayTimer) clearInterval(state.replayTimer), state.replayTimer = null, render(); else { if (state.replayIndex >= state.replay.moves.length) state.replayIndex = 0; state.replayTimer = setInterval(() => { state.replayIndex++; if (state.replayIndex >= state.replay.moves.length) clearInterval(state.replayTimer), state.replayTimer = null; renderReplayFrameOnly() }, 520); render() } }
  else if (action === 'analyze-move') analyzeCurrentMove()
  else if (action === 'puzzle') state.modal = { type: 'puzzle', id: Number(target.dataset.id) }, render()
  else if (action === 'export-backup') downloadText(`弈境完整备份-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(createBackup(), null, 2), 'application/json;charset=utf-8'), toast('完整备份已导出', 'success')
  else if (action === 'import-backup') document.querySelector('#backup-file')?.click()
  else if (action === 'confirm-backup') {
    const summary = importBackup(state.modal.payload)
    const restoredSettings = loadSettings()
    state.history = loadHistory()
    state.unfinished = loadUnfinishedGame()
    if (THEMES.some((theme) => theme.id === restoredSettings.theme)) state.theme = restoredSettings.theme
    state.sound = restoredSettings.sound !== false
    if (validLobbyModes.has(restoredSettings.lobbyMode)) state.lobbyMode = restoredSettings.lobbyMode
    if (Number.isInteger(restoredSettings.lobbyLevel) && restoredSettings.lobbyLevel >= 1 && restoredSettings.lobbyLevel <= 5) state.lobbyLevel = restoredSettings.lobbyLevel
    state.lobbySide = restoredSettings.lobbySide === WHITE ? WHITE : BLACK
    state.confirmMove = restoredSettings.confirmMove === true
    state.showSituation = restoredSettings.showSituation !== false
    state.showMoveNumbers = restoredSettings.showMoveNumbers === true
    document.documentElement.dataset.theme = state.theme
    state.modal = null
    render()
    toast(`已合并：新增 ${summary.added}，更新 ${summary.updated}`, 'success')
  }
  else if (action === 'install-pwa') { if (deferredInstallPrompt) { await deferredInstallPrompt.prompt(); await deferredInstallPrompt.userChoice; deferredInstallPrompt = null } else state.modal = { type: 'install' }, render() }
})

app.addEventListener('input', (event) => {
  if (event.target.id === 'replay-range') state.replayIndex = Number(event.target.value), renderReplayFrameOnly()
  else if (event.target.id === 'join-code') event.target.value = event.target.value.toUpperCase().replace(/[^A-Z2-9]/g, '')
  else if (event.target.id === 'record-search') { state.filters.query = event.target.value; const grid = document.querySelector('.record-grid'); if (grid) grid.innerHTML = recordsGridHtml(); const count = document.querySelector('.record-summary span'); if (count) count.textContent = `共 ${filteredHistory().length} 份棋谱` }
})

app.addEventListener('change', async (event) => {
  if (event.target.dataset.recordFilter) { state.filters[event.target.dataset.recordFilter] = event.target.value; render(); return }
  if (event.target.id === 'record-file' && event.target.files?.[0]) {
    try { const file = event.target.files[0]; const text = await file.text(); let record; if (file.name.toLowerCase().endsWith('.json')) { record = JSON.parse(text); record.id = crypto.randomUUID(); if (!Array.isArray(record.moves)) throw new Error('JSON 中没有有效落子') } else record = sgfToRecord(text); state.history = saveRecord(record); render(); toast('棋谱导入成功', 'success') } catch (error) { toast(`导入失败：${error.message}`, 'error') }
  } else if (event.target.id === 'backup-file' && event.target.files?.[0]) {
    try { const payload = JSON.parse(await event.target.files[0].text()); if (payload.format !== 'aurora-gomoku-backup-v1') throw new Error('不是有效的弈境完整备份'); state.modal = { type: 'backup-preview', payload }; render() } catch (error) { toast(`备份读取失败：${error.message}`, 'error') }
  }
})

function renderReplayFrameOnly() {
  const canvas = document.querySelector('#replay-board'); if (canvas) drawBoard(canvas, boardAtMove(state.replay.moves, state.replayIndex), state.replay.moves.slice(0, state.replayIndex))
  const range = document.querySelector('#replay-range'); if (range) range.value = state.replayIndex
  const status = document.querySelector('.board-topline .status-pill'); if (status) { const move = state.replay.moves[Math.max(0, state.replayIndex - 1)]; status.innerHTML = `<i class="pulse"></i>${state.replayIndex === 0 ? '开局' : `第 ${state.replayIndex} 手 · ${moveLabel(move)}`}` }
  const meta = document.querySelector('.board-topline .game-meta'); if (meta) meta.textContent = `${state.replayIndex} / ${state.replay.moves.length}`
}

window.addEventListener('beforeunload', () => { ai.dispose(); room?.close() })
if ('serviceWorker' in navigator && import.meta.env.PROD) window.addEventListener('load', () => navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(console.warn))

render()
