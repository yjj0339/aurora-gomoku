import './styles.css'
import { LEVELS } from './ai-core.js'
import { AiClient } from './ai-client.js'
import { BLACK, EMPTY, SIZE, WHITE, at, boardAtMove, createBoard, isFull, moveLabel, other, play, recordToSgf, sgfToRecord, winnerFrom } from './game.js'
import { deleteRecord, downloadText, loadHistory, loadSettings, saveRecord, saveSettings } from './history.js'
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
  {
    id: 1, title: '一击封喉', desc: '黑先，找到立即获胜点', solution: { x: 9, y: 7 },
    moves: [[5,7,BLACK],[6,7,BLACK],[7,7,BLACK],[8,7,BLACK],[7,6,WHITE],[8,6,WHITE]],
  },
  {
    id: 2, title: '唯一防线', desc: '黑先，挡住白方的致命冲四', solution: { x: 10, y: 5 },
    moves: [[6,5,WHITE],[7,5,WHITE],[8,5,WHITE],[9,5,WHITE],[7,7,BLACK],[8,8,BLACK]],
  },
  {
    id: 3, title: '双向生长', desc: '黑先，制造无法同时防守的双活三', solution: { x: 7, y: 7 },
    moves: [[5,7,BLACK],[6,7,BLACK],[7,5,BLACK],[7,6,BLACK],[6,6,WHITE],[8,8,WHITE]],
  },
]

const stored = loadSettings()
const state = {
  view: 'home',
  theme: THEMES.some((t) => t.id === stored.theme) ? stored.theme : 'mist',
  sound: stored.sound !== false,
  modal: null,
  game: null,
  replay: null,
  replayIndex: 0,
  replayTimer: null,
  history: loadHistory(),
  onlineStatus: null,
  analysis: { engine: '待命', depth: '—', nodes: '—', elapsed: '—' },
  hover: null,
}

let resizeObserver = null
let room = null
const ai = new AiClient((progress) => {
  if (progress.depth) state.analysis.depth = progress.depth
  if (progress.nodes) state.analysis.nodes = compactNumber(progress.nodes)
  if (progress.source === 'rapfi') state.analysis.engine = 'Rapfi 冠军引擎'
  updateAnalysisPanel()
})

const app = document.querySelector('#app')
document.documentElement.dataset.theme = state.theme

function icon(name) {
  const paths = {
    grid: '<rect x="3" y="3" width="18" height="18" rx="5"/><path d="M8 3v18M16 3v18M3 8h18M3 16h18"/>',
    palette: '<path d="M12 3a9 9 0 1 0 0 18h1.1a1.9 1.9 0 0 0 1.2-3.4 2 2 0 0 1 1.2-3.6H18a3 3 0 0 0 3-3c0-4.4-4-8-9-8Z"/><path d="M7.5 10h.01M9.5 6.7h.01M14 6.5h.01M17.2 9h.01"/>',
    spark: '<path d="m12 3 1.3 4.2L17.5 9l-4.2 1.7L12 15l-1.3-4.3L6.5 9l4.2-1.8L12 3Z"/><path d="m18.5 14 .7 2.3 2.3.7-2.3.7-.7 2.3-.7-2.3-2.3-.7 2.3-.7.7-2.3Z"/>',
    wifi: '<path d="M4.4 10a11.4 11.4 0 0 1 15.2 0M7.5 13.3a6.8 6.8 0 0 1 9 0M10.4 16.5a2.4 2.4 0 0 1 3.2 0"/><circle cx="12" cy="19" r="1"/>',
    book: '<path d="M4 5.5A3.5 3.5 0 0 1 7.5 2H11v17H7.5A3.5 3.5 0 0 0 4 22V5.5ZM20 5.5A3.5 3.5 0 0 0 16.5 2H13v17h3.5A3.5 3.5 0 0 1 20 22V5.5Z"/>',
    history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>',
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
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char])
}

function renderHeader() {
  const navItems = [['home', '对弈'], ['records', '棋谱'], ['learn', '学堂']]
  return `<header class="topbar">
    <button class="brand" data-view="home" aria-label="返回首页">
      <span class="brand-mark">${icon('grid')}</span>
      <span class="brand-copy"><strong>雾弈</strong><small>AURORA GOMOKU</small></span>
    </button>
    <nav class="nav" aria-label="主导航">${navItems.map(([id, label]) => `<button class="nav-button ${state.view === id ? 'active' : ''}" data-view="${id}">${label}</button>`).join('')}</nav>
    <div class="top-actions">
      <button class="icon-button" data-action="theme" aria-label="切换主题">${icon('palette')}</button>
    </div>
  </header>`
}

function miniBoard() {
  const stones = [[5,5,'black'],[6,5,'white'],[4,4,'black'],[5,4,'white'],[3,3,'black'],[7,6,'white'],[6,6,'black']]
  return `<div class="hero-visual" aria-hidden="true"><div class="hero-glass"></div><div class="mini-board">${stones.map(([x,y,c]) => `<i class="mini-stone ${c}" style="grid-column:${x};grid-row:${y}"></i>`).join('')}</div>
    <div class="floating-note one"><span class="note-icon">${icon('spark')}</span><span>冠军级 AI<br><small>本机深度计算</small></span></div>
    <div class="floating-note two"><span class="note-icon">${icon('wifi')}</span><span>点对点联机<br><small>加密直连</small></span></div></div>`
}

function renderHome() {
  return `<main class="main">
    <section class="home-hero">
      <div class="hero-copy-wrap">
        <span class="eyebrow"><i class="eyebrow-dot"></i> 一盘安静而锋利的棋</span>
        <h1>在雾与光之间，<span class="gradient-word">落下一子。</span></h1>
        <p class="hero-copy">轻盈的毛玻璃棋室，五档渐进 AI、远程实时对弈、自动棋谱与逐手复盘。最高两档接入 Gomocup 冠军引擎，每一步都经过严密推演。</p>
        <div class="hero-actions">
          <button class="primary-button" data-action="open-ai">${icon('spark')}挑战 AI</button>
          <button class="secondary-button" data-action="open-online">${icon('wifi')}远程联机</button>
        </div>
      </div>${miniBoard()}
    </section>
    <section class="section">
      <div class="section-heading"><div><h2>五重棋力，层层进阶</h2><p>从第一盘的从容，到冠军引擎的近乎无解。</p></div></div>
      <div class="level-grid">${LEVELS.map((level) => `<article class="level-card ${level.id >= 4 ? 'extreme' : ''}"><span class="level-number">0${level.id}</span><h3>${level.name}</h3><p>${level.subtitle}</p></article>`).join('')}</div>
    </section>
    <section class="section">
      <div class="section-heading"><div><h2>一座完整的棋室</h2><p>对弈、记录、复盘与学习，在任意设备延续。</p></div></div>
      <div class="feature-grid">
        <article class="feature-card"><span class="feature-icon">${icon('wifi')}</span><h3>远程实时联机</h3><p>六位房间码快速邀请。棋步通过 WebRTC 加密点对点同步，断线后自动尝试重连并恢复局面。</p></article>
        <article class="feature-card"><span class="feature-icon">${icon('history')}</span><h3>自动棋谱与复盘</h3><p>每局结束立即生成棋谱，保留最近 200 局。逐手回看、自动播放，并支持标准 SGF 与雾弈 JSON 导出。</p></article>
        <article class="feature-card"><span class="feature-icon">${icon('book')}</span><h3>世界棋谱学堂</h3><p>直达 RIF 世界锦标赛、官方棋谱库与 Gomocup 顶级引擎实战，另有原创战术题可随时练习。</p></article>
      </div>
    </section>
    ${renderFooter()}
  </main>`
}

function resultLabel(record) {
  if (record.resultText) return record.resultText
  if (record.resultCode?.startsWith('B+')) return '黑方胜'
  if (record.resultCode?.startsWith('W+')) return '白方胜'
  return '和棋'
}

function renderRecords() {
  return `<main class="main">
    <div class="page-head"><div><span class="eyebrow"><i class="eyebrow-dot"></i> LOCAL KIFU</span><h1>我的棋谱</h1><p>每一局都有迹可循，点击即可逐手回到当时。</p></div><button class="secondary-button" data-action="import-record">${icon('upload')}导入棋谱</button></div>
    <input id="record-file" type="file" accept=".sgf,.json,application/json,text/plain" hidden />
    <div class="record-grid">${state.history.length ? state.history.map((record) => `<article class="record-card">
      <div class="record-top"><span>${new Date(record.endedAt || record.startedAt).toLocaleString('zh-CN', { dateStyle: 'medium', timeStyle: 'short' })}</span><span class="result-badge">${escapeHtml(resultLabel(record))}</span></div>
      <h3>${escapeHtml(record.title || '五子棋对局')}</h3><p>${escapeHtml(record.blackName)} · 黑　vs　${escapeHtml(record.whiteName)} · 白<br>${record.moves.length} 手 · ${record.mode === 'online' ? '远程联机' : record.mode === 'ai' ? `AI ${record.levelName || ''}` : '导入棋谱'}</p>
      <div class="record-actions"><button class="ghost-button" data-action="replay" data-id="${record.id}">${icon('play')}复盘</button><button class="ghost-button" data-action="export" data-id="${record.id}">${icon('download')}SGF</button><button class="ghost-button danger" data-action="delete-record" data-id="${record.id}">${icon('trash')}</button></div>
    </article>`).join('') : `<section class="record-empty glass-panel"><span class="feature-icon">${icon('history')}</span><h2>这里还没有棋谱</h2><p class="hero-copy" style="margin:0 auto 1rem">完成第一局后，棋谱会自动出现在这里。</p><button class="primary-button" data-action="open-ai">开始一局</button></section>`}</div>
    ${renderFooter()}
  </main>`
}

function renderLearn() {
  return `<main class="main">
    <div class="page-head"><div><span class="eyebrow"><i class="eyebrow-dot"></i> WORLD KIFU</span><h1>世界棋谱学堂</h1><p>已于 2026 年 8 月核对的权威赛事与顶尖棋手资源。</p></div></div>
    <div class="notice">RIF 官方棋谱库的使用条款禁止把其内容复制到其他在线系统，因此雾弈不镜像棋谱正文，而是提供经过核实的官方直达入口；这样既尊重原站规则，也能始终看到最新赛事数据。</div>
    <div class="learn-grid">
      <section><div class="section-heading"><div><h2>权威棋谱源</h2><p>世界冠军、人类赛事与顶级 AI 实战。</p></div></div><div class="source-list">${SOURCES.map((source) => `<a class="source-card" href="${source.url}" target="_blank" rel="noopener noreferrer"><span class="source-logo">${source.abbr}</span><span class="source-copy"><strong>${source.title}</strong><small>${source.desc}</small></span><span class="external-arrow">${icon('external')}</span></a>`).join('')}</div></section>
      <section><div class="section-heading"><div><h2>战术训练</h2><p>原创局面，不依赖网络也能练习。</p></div></div><div class="training-list">${PUZZLES.map((puzzle, i) => `<article class="training-card"><h3>第 ${i + 1} 课 · ${puzzle.title}</h3><p>${puzzle.desc}</p><div class="progress-line"><i style="width:${34 + i * 24}%"></i></div><button class="ghost-button" style="margin-top:.8rem;width:100%" data-action="puzzle" data-id="${puzzle.id}">${icon('play')}开始解题</button></article>`).join('')}</div></section>
    </div>${renderFooter()}
  </main>`
}

function currentTurnText(game) {
  if (!game) return ''
  if (game.status === 'ended') return game.resultText
  if (game.thinking) return 'AI 正在推演'
  if (game.mode === 'online') return game.current === game.humanSide ? '轮到你落子' : '等待对手落子'
  return game.current === game.humanSide ? '轮到你落子' : 'AI 正在思考'
}

function renderGame() {
  const game = state.game
  const blackName = game.blackName
  const whiteName = game.whiteName
  const activeBlack = game.status === 'playing' && game.current === BLACK
  const activeWhite = game.status === 'playing' && game.current === WHITE
  return `<main class="main" style="padding-top:1.4rem">
    <button class="back-button" data-view="home">${icon('back')}返回棋室</button>
    <div class="game-layout">
      <section class="board-panel glass-panel">
        <div class="board-topline"><span class="status-pill"><i class="pulse"></i>${escapeHtml(currentTurnText(game))}</span><span class="game-meta">${game.mode === 'online' ? `房间 ${game.roomCode || ''}` : `AI · ${LEVELS[game.level - 1]?.name || ''}`}　${game.moves.length} 手</span></div>
        <div class="canvas-wrap"><canvas id="game-board" aria-label="十五路五子棋棋盘"></canvas>${game.thinking ? `<div class="thinking-surface"><div class="thinking-card"><span class="thinking-dots"><i></i><i></i><i></i></span><strong>正在深度推演</strong></div></div>` : ''}</div>
      </section>
      <aside class="side-panel glass-panel">
        <div class="player-card ${activeBlack ? 'active' : ''}"><i class="stone-avatar black"></i><span class="player-info"><strong>${escapeHtml(blackName)}</strong><small>${game.humanSide === BLACK ? '你 · 黑方' : game.aiSide === BLACK ? 'AI · 黑方' : '对手 · 黑方'}</small></span>${activeBlack ? '<span class="turn-badge">行棋</span>' : ''}</div>
        <div class="player-card ${activeWhite ? 'active' : ''}"><i class="stone-avatar white"></i><span class="player-info"><strong>${escapeHtml(whiteName)}</strong><small>${game.humanSide === WHITE ? '你 · 白方' : game.aiSide === WHITE ? 'AI · 白方' : '对手 · 白方'}</small></span>${activeWhite ? '<span class="turn-badge">行棋</span>' : ''}</div>
        <div class="panel-divider"></div>
        ${game.mode === 'ai' ? `<div class="analysis-card"><div class="analysis-head"><strong id="engine-name">${escapeHtml(state.analysis.engine)}</strong><span>实时计算</span></div><div class="analysis-grid"><span class="analysis-stat"><strong id="depth-value">${state.analysis.depth}</strong><small>深度</small></span><span class="analysis-stat"><strong id="nodes-value">${state.analysis.nodes}</strong><small>节点</small></span><span class="analysis-stat"><strong id="elapsed-value">${state.analysis.elapsed}</strong><small>耗时</small></span></div></div>` : `<div class="analysis-card"><div class="analysis-head"><strong>端到端加密连接</strong><span>${escapeHtml(state.onlineStatus?.text || '已连接')}</span></div><div class="progress-line"><i style="width:${state.onlineStatus?.phase === 'connected' ? '100' : '55'}%"></i></div></div>`}
        <div class="moves-box"><div class="moves-title"><span>落子记录</span><span>${game.moves.length} / 225</span></div><div class="move-chips">${game.moves.slice(-36).map((move, i) => `<span class="move-chip"><b>${game.moves.length - Math.min(36, game.moves.length) + i + 1}</b>${moveLabel(move)}</span>`).join('') || '<span style="color:var(--muted);font-size:.7rem">等待第一手…</span>'}</div></div>
        <div class="control-grid">${game.mode === 'ai' ? `<button class="ghost-button" data-action="undo">${icon('undo')}悔棋</button>` : ''}<button class="ghost-button" data-action="restart">${icon('refresh')}重开</button><button class="ghost-button" data-action="save-current">${icon('download')}导出</button><button class="ghost-button danger" data-action="resign">${icon('flag')}认输</button></div>
      </aside>
    </div>
  </main>`
}

function renderReplay() {
  const record = state.replay
  const move = record.moves[Math.max(0, state.replayIndex - 1)]
  return `<main class="main" style="padding-top:1.4rem"><button class="back-button" data-view="records">${icon('back')}返回棋谱</button>
    <div class="page-head"><div><span class="eyebrow"><i class="eyebrow-dot"></i> REPLAY</span><h1>${escapeHtml(record.title || '棋谱复盘')}</h1><p>${escapeHtml(record.blackName)} vs ${escapeHtml(record.whiteName)} · ${resultLabel(record)}</p></div><button class="secondary-button" data-action="export" data-id="${record.id}">${icon('download')}导出 SGF</button></div>
    <div class="game-layout"><section class="board-panel glass-panel"><div class="board-topline"><span class="status-pill"><i class="pulse"></i>${state.replayIndex === 0 ? '开局' : `第 ${state.replayIndex} 手 · ${moveLabel(move)}`}</span><span class="game-meta">${state.replayIndex} / ${record.moves.length}</span></div><div class="canvas-wrap"><canvas id="replay-board"></canvas></div></section>
    <aside class="side-panel glass-panel"><div class="player-card"><i class="stone-avatar black"></i><span class="player-info"><strong>${escapeHtml(record.blackName)}</strong><small>黑方</small></span></div><div class="player-card"><i class="stone-avatar white"></i><span class="player-info"><strong>${escapeHtml(record.whiteName)}</strong><small>白方</small></span></div><div class="moves-box" style="grid-column:1/-1;max-height:18rem"><div class="move-chips">${record.moves.map((m, i) => `<button class="move-chip ${i + 1 === state.replayIndex ? 'active' : ''}" style="border:0;cursor:pointer" data-action="replay-jump" data-index="${i + 1}"><b>${i + 1}</b>${moveLabel(m)}</button>`).join('')}</div></div><input id="replay-range" type="range" min="0" max="${record.moves.length}" value="${state.replayIndex}" style="grid-column:1/-1;width:100%;accent-color:var(--primary)"><div class="control-grid"><button class="ghost-button" data-action="replay-prev">${icon('back')}上一步</button><button class="ghost-button" data-action="replay-next">下一步${icon('chevron')}</button><button class="primary-button" style="grid-column:1/-1" data-action="replay-auto">${icon('play')}${state.replayTimer ? '暂停播放' : '自动播放'}</button></div></aside></div></main>`
}

function renderFooter() {
  return `<footer class="footer"><span>雾弈 · 让每一盘棋都有回响</span><span>15×15 自由规则 · 数据默认只保存在本机</span></footer>`
}

function renderModal() {
  if (!state.modal) return ''
  if (state.modal.type === 'theme') return `<div class="modal-backdrop" data-action="close-modal"><section class="modal" role="dialog" aria-modal="true" aria-label="选择主题" data-modal><div class="modal-head"><div><h2>选择你的雾色</h2><p>浅色毛玻璃与棋盘会随主题一起变化。</p></div><button class="modal-close" data-action="close-modal">${icon('close')}</button></div><div class="theme-grid">${THEMES.map((theme) => `<button class="theme-card ${state.theme === theme.id ? 'selected' : ''}" data-action="select-theme" data-theme-id="${theme.id}" style="--preview-bg:${theme.bg};--preview-color:${theme.color};--preview-accent:${theme.accent}"><span class="theme-preview"><i></i></span><span>${theme.name}</span></button>`).join('')}</div></section></div>`
  if (state.modal.type === 'ai') {
    const selected = state.modal.level || 5
    return `<div class="modal-backdrop" data-action="close-modal"><section class="modal" role="dialog" aria-modal="true" data-modal><div class="modal-head"><div><h2>选择挑战强度</h2><p>最高两档使用 Gomocup 2026 冠军引擎。</p></div><button class="modal-close" data-action="close-modal">${icon('close')}</button></div><div class="select-list">${LEVELS.map((level) => `<button class="select-card ${selected === level.id ? 'selected' : ''}" data-action="select-level" data-level="${level.id}"><span class="select-number">${level.id}</span><span><strong>${level.name}</strong><small>${level.subtitle}</small></span>${level.id >= 4 ? '<span class="tag">极难</span>' : ''}</button>`).join('')}</div><span class="field-label">选择执子</span><div class="side-choice"><button class="select-card ${state.modal.side !== WHITE ? 'selected' : ''}" data-action="select-side" data-side="1"><i class="stone-avatar black"></i><strong>执黑先行</strong></button><button class="select-card ${state.modal.side === WHITE ? 'selected' : ''}" data-action="select-side" data-side="2"><i class="stone-avatar white"></i><strong>执白后行</strong></button></div><div class="modal-actions"><button class="primary-button" data-action="start-ai">开始对弈${icon('arrow')}</button></div></section></div>`
  }
  if (state.modal.type === 'online') {
    const phase = state.modal.phase || 'choose'
    if (phase === 'room') return `<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true" data-modal><div class="modal-head"><div><h2>远程棋室</h2><p>把房间码发给你的对手。</p></div><button class="modal-close" data-action="cancel-online">${icon('close')}</button></div><div class="room-code"><small>六位房间码</small><strong>${escapeHtml(state.modal.code)}</strong></div><div class="room-status"><i class="eyebrow-dot"></i>${escapeHtml(state.onlineStatus?.text || '正在连接…')}</div><div class="modal-actions"><button class="secondary-button" data-action="copy-room">${icon('copy')}复制房间码</button></div></section></div>`
    return `<div class="modal-backdrop" data-action="close-modal"><section class="modal" role="dialog" aria-modal="true" data-modal><div class="modal-head"><div><h2>远程联机</h2><p>创建房间，或输入好友发来的房间码。</p></div><button class="modal-close" data-action="close-modal">${icon('close')}</button></div><button class="select-card selected" data-action="create-room"><span class="select-number">${icon('wifi')}</span><span><strong>创建新房间</strong><small>你执黑先行，生成六位邀请代码</small></span>${icon('chevron')}</button><span class="field-label">加入已有房间</span><input class="input" id="join-code" maxlength="6" autocomplete="off" placeholder="输入 6 位房间码" aria-label="房间码"><div class="modal-actions"><button class="primary-button" data-action="join-room">加入房间${icon('arrow')}</button></div></section></div>`
  }
  if (state.modal.type === 'puzzle') {
    const puzzle = PUZZLES.find((item) => item.id === state.modal.id)
    return `<div class="modal-backdrop" data-action="close-modal"><section class="modal" role="dialog" aria-modal="true" data-modal><div class="modal-head"><div><h2>${puzzle.title}</h2><p>${puzzle.desc}</p></div><button class="modal-close" data-action="close-modal">${icon('close')}</button></div><div class="canvas-wrap" style="width:100%"><canvas id="puzzle-board"></canvas></div><div class="notice" style="margin:1rem 0 0">点击你认为正确的交叉点。答错可以继续尝试。</div></section></div>`
  }
  if (state.modal.type === 'result') return `<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true" data-modal><div class="modal-head"><div><h2>${escapeHtml(state.game.resultText)}</h2><p>本局 ${state.game.moves.length} 手，棋谱已经自动保存。</p></div></div><div class="room-code"><small>对局结果</small><strong style="letter-spacing:0;font-size:1.55rem">${escapeHtml(state.game.resultText)}</strong></div><div class="modal-actions"><button class="secondary-button" data-action="view-last-record">复盘本局</button><button class="primary-button" data-action="restart">再来一局</button></div></section></div>`
  return ''
}

function render() {
  clearInterval(state.replayTimer)
  state.replayTimer = null
  let content = state.view === 'home' ? renderHome() : state.view === 'records' ? renderRecords() : state.view === 'learn' ? renderLearn() : state.view === 'game' && state.game ? renderGame() : state.view === 'replay' && state.replay ? renderReplay() : renderHome()
  app.innerHTML = `<div class="app">${renderHeader()}${content}${renderModal()}<div class="toast-stack" id="toasts"></div></div>`
  bindCanvas()
}

function setView(view) {
  if (view !== 'game' && state.game?.mode === 'online' && state.game.status === 'playing') toast('联机棋局仍在后台保持连接')
  state.view = view
  state.modal = null
  render()
}

function newGame(mode, options = {}) {
  const humanSide = options.humanSide || BLACK
  const aiSide = mode === 'ai' ? other(humanSide) : null
  state.game = {
    id: crypto.randomUUID(), mode, board: createBoard(), moves: [], current: BLACK, status: 'playing',
    humanSide, aiSide, level: options.level || 5, startedAt: new Date().toISOString(), thinking: false,
    blackName: mode === 'ai' ? (humanSide === BLACK ? '你' : LEVELS[(options.level || 5) - 1].name) : (humanSide === BLACK ? '你' : '远程对手'),
    whiteName: mode === 'ai' ? (humanSide === WHITE ? '你' : LEVELS[(options.level || 5) - 1].name) : (humanSide === WHITE ? '你' : '远程对手'),
    roomCode: options.roomCode || null, winnerLine: null, resultText: '', resultCode: '',
  }
  state.analysis = { engine: mode === 'ai' && options.level >= 4 ? 'Rapfi 冠军引擎' : '雾弈策略引擎', depth: '—', nodes: '—', elapsed: '—' }
  state.view = 'game'
  state.modal = null
  render()
  if (mode === 'ai' && aiSide === BLACK) setTimeout(triggerAi, 280)
}

function applyMove(x, y, side, remote = false) {
  const game = state.game
  if (!game || game.status !== 'playing' || side !== game.current || !play(game.board, x, y, side)) return false
  const move = { x, y, side, at: Date.now() }
  game.moves.push(move)
  game.current = other(side)
  const won = winnerFrom(game.board, x, y)
  if (won) finishGame(side, `${side === BLACK ? '黑方' : '白方'}获胜`, `${side === BLACK ? 'B' : 'W'}+R`, won.line)
  else if (isFull(game.board)) finishGame(null, '和棋', '0', null)
  if (game.mode === 'online' && !remote) room?.send({ type: 'move', move, index: game.moves.length })
  render()
  if (game.mode === 'ai' && game.status === 'playing' && game.current === game.aiSide) setTimeout(triggerAi, 220)
  return true
}

async function triggerAi() {
  const game = state.game
  if (!game || game.mode !== 'ai' || game.status !== 'playing' || game.current !== game.aiSide || game.thinking) return
  game.thinking = true
  state.analysis.depth = '—'; state.analysis.nodes = '—'; state.analysis.elapsed = '—'
  render()
  const token = game.id
  try {
    const result = await ai.think(game.board, game.aiSide, game.level, game.moves)
    if (state.game?.id !== token || state.game.status !== 'playing') return
    state.analysis.engine = result.engine || state.analysis.engine
    state.analysis.depth = result.depth || state.analysis.depth
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
  const record = gameToRecord(game)
  state.history = saveRecord(record)
  setTimeout(() => { if (state.game?.id === game.id) { state.modal = { type: 'result' }; render() } }, 380)
}

function gameToRecord(game) {
  return {
    id: game.id, size: SIZE, title: game.mode === 'online' ? '远程棋室对局' : `挑战 ${LEVELS[game.level - 1]?.name || 'AI'}`,
    mode: game.mode, level: game.level, levelName: LEVELS[game.level - 1]?.name, blackName: game.blackName, whiteName: game.whiteName,
    startedAt: game.startedAt, endedAt: game.endedAt || new Date().toISOString(), moves: game.moves, resultText: game.resultText || '未完', resultCode: game.resultCode || 'Void',
  }
}

function setupRoom() {
  room?.close()
  room = new OnlineRoom({
    status: (status) => { state.onlineStatus = status; if (state.modal?.type === 'online' || state.view === 'game') render() },
    error: ({ text }) => toast(text, 'error'),
    connected: ({ role, code }) => {
      if (role === 'host') {
        if (state.game?.mode === 'online' && state.game.roomCode === code) {
          state.onlineStatus = { phase: 'connected', text: '对手已重新连接' }
          room.send({ type: 'sync', code, game: onlineSnapshot() })
          render()
        } else {
          newGame('online', { humanSide: BLACK, roomCode: code })
          room.send({ type: 'start', code, blackName: '房主', whiteName: '挑战者' })
        }
      } else {
        state.onlineStatus = { phase: 'connected', text: '已连接，正在同步棋局' }
        room.send({ type: 'sync-request' })
      }
    },
    message: handleOnlineMessage,
  })
}

function onlineSnapshot() {
  if (!state.game) return null
  return {
    moves: state.game.moves,
    current: state.game.current,
    status: state.game.status,
    resultText: state.game.resultText,
    resultCode: state.game.resultCode,
    blackName: state.game.blackName,
    whiteName: state.game.whiteName,
    startedAt: state.game.startedAt,
  }
}

function handleOnlineMessage(message) {
  if (message.type === 'start') {
    newGame('online', { humanSide: WHITE, roomCode: message.code })
    state.game.blackName = '远程对手'; state.game.whiteName = '你'; render()
  } else if (message.type === 'move' && state.game?.mode === 'online') {
    if (message.index === state.game.moves.length + 1) applyMove(message.move.x, message.move.y, message.move.side, true)
    else room.send({ type: 'sync-request' })
  } else if (message.type === 'sync-request' && state.game) {
    room.send({ type: 'sync', code: state.game.roomCode, game: onlineSnapshot() })
  } else if (message.type === 'sync' && message.game) {
    if (!state.game || state.game.mode !== 'online') {
      newGame('online', { humanSide: WHITE, roomCode: message.code || room?.code })
      state.game.blackName = '远程对手'
      state.game.whiteName = '你'
    }
    state.game.moves = message.game.moves
    state.game.board = boardAtMove(state.game.moves)
    Object.assign(state.game, { current: message.game.current, status: message.game.status, resultText: message.game.resultText, resultCode: message.game.resultCode, startedAt: message.game.startedAt || state.game.startedAt })
    render()
  } else if (message.type === 'restart' && state.game?.mode === 'online') {
    newGame('online', { humanSide: state.game.humanSide, roomCode: state.game.roomCode })
    if (state.game.humanSide === WHITE) { state.game.blackName = '远程对手'; state.game.whiteName = '你' }
  } else if (message.type === 'resign' && state.game?.status === 'playing') {
    const winner = state.game.humanSide
    finishGame(winner, '对手认输，你获胜', `${winner === BLACK ? 'B' : 'W'}+R`, null); render()
  }
}

function drawBoard(canvas, board, moves = [], options = {}) {
  if (!canvas) return
  const rect = canvas.getBoundingClientRect()
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  const size = Math.max(280, rect.width)
  canvas.width = Math.round(size * dpr); canvas.height = Math.round(size * dpr)
  const ctx = canvas.getContext('2d'); ctx.scale(dpr, dpr); ctx.clearRect(0, 0, size, size)
  const margin = size * .058; const step = (size - margin * 2) / 14
  ctx.lineWidth = Math.max(1, size / 620); ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--board-line').trim() || 'rgba(83,68,48,.52)'
  for (let i = 0; i < SIZE; i++) { const p = margin + i * step; ctx.beginPath(); ctx.moveTo(margin, p); ctx.lineTo(size - margin, p); ctx.stroke(); ctx.beginPath(); ctx.moveTo(p, margin); ctx.lineTo(p, size - margin); ctx.stroke() }
  ctx.fillStyle = ctx.strokeStyle
  for (const [x,y] of [[3,3],[11,3],[7,7],[3,11],[11,11]]) { ctx.beginPath(); ctx.arc(margin + x*step, margin + y*step, Math.max(2, size/155), 0, Math.PI*2); ctx.fill() }
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    const side = board[at(x,y)]; if (!side) continue
    const cx = margin + x*step, cy = margin + y*step, radius = step * .43
    ctx.save(); ctx.shadowColor = 'rgba(31,36,49,.24)'; ctx.shadowBlur = radius*.32; ctx.shadowOffsetY = radius*.17
    const grad = ctx.createRadialGradient(cx-radius*.3, cy-radius*.36, radius*.08, cx, cy, radius)
    if (side === BLACK) { grad.addColorStop(0,'#687385'); grad.addColorStop(.43,'#252c3a'); grad.addColorStop(1,'#0f141e') }
    else { grad.addColorStop(0,'#ffffff'); grad.addColorStop(.55,'#f2f5f9'); grad.addColorStop(1,'#cfd6e2') }
    ctx.fillStyle = grad; ctx.beginPath(); ctx.arc(cx,cy,radius,0,Math.PI*2); ctx.fill(); ctx.restore()
  }
  const last = moves[moves.length-1]
  if (last) { const cx=margin+last.x*step, cy=margin+last.y*step; ctx.strokeStyle=last.side===BLACK?'rgba(255,255,255,.8)':'rgba(65,78,104,.62)'; ctx.lineWidth=Math.max(1.5,size/350); ctx.beginPath(); ctx.arc(cx,cy,step*.15,0,Math.PI*2); ctx.stroke() }
  if (options.hover && board[at(options.hover.x, options.hover.y)] === EMPTY) { ctx.globalAlpha=.24; ctx.fillStyle=options.hover.side===BLACK?'#111827':'#fff'; ctx.beginPath(); ctx.arc(margin+options.hover.x*step,margin+options.hover.y*step,step*.4,0,Math.PI*2); ctx.fill(); ctx.globalAlpha=1 }
  if (options.winnerLine?.length) { const a=options.winnerLine[0], b=options.winnerLine.at(-1); ctx.strokeStyle=getComputedStyle(document.documentElement).getPropertyValue('--primary').trim(); ctx.lineWidth=Math.max(3,size/125); ctx.lineCap='round'; ctx.beginPath(); ctx.moveTo(margin+a.x*step,margin+a.y*step); ctx.lineTo(margin+b.x*step,margin+b.y*step); ctx.stroke() }
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
    const redraw = () => drawBoard(canvas, state.game.board, state.game.moves, { hover: state.hover, winnerLine: state.game.winnerLine })
    redraw(); resizeObserver = new ResizeObserver(redraw); resizeObserver.observe(canvas)
    canvas.addEventListener('pointermove', (event) => { const point=canvasPoint(canvas,event); if (point?.x !== state.hover?.x || point?.y !== state.hover?.y) { state.hover=point; redraw() } })
    canvas.addEventListener('pointerleave', () => { state.hover=null; redraw() })
    canvas.addEventListener('pointerdown', (event) => { const point=canvasPoint(canvas,event); const game=state.game; if (!point || !game || game.status!=='playing' || game.thinking || game.current!==game.humanSide) return; if (applyMove(point.x,point.y,game.humanSide)) vibrate(12) })
  }
  const replay = document.querySelector('#replay-board')
  if (replay && state.replay) { const redraw=()=>drawBoard(replay,boardAtMove(state.replay.moves,state.replayIndex),state.replay.moves.slice(0,state.replayIndex)); redraw(); resizeObserver=new ResizeObserver(redraw); resizeObserver.observe(replay) }
  const puzzleCanvas = document.querySelector('#puzzle-board')
  if (puzzleCanvas && state.modal?.type === 'puzzle') {
    const puzzle=PUZZLES.find((p)=>p.id===state.modal.id); const board=createBoard(); const moves=puzzle.moves.map(([x,y,side])=>({x,y,side})); for(const m of moves) board[at(m.x,m.y)]=m.side
    const redraw=()=>drawBoard(puzzleCanvas,board,moves); redraw(); resizeObserver=new ResizeObserver(redraw); resizeObserver.observe(puzzleCanvas)
    puzzleCanvas.addEventListener('pointerdown',(event)=>{ const point=canvasPoint(puzzleCanvas,event); if(!point)return; if(point.x===puzzle.solution.x&&point.y===puzzle.solution.y){ board[at(point.x,point.y)]=BLACK; moves.push({...point,side:BLACK}); redraw(); vibrate([20,40,20]); toast('漂亮！这是唯一的关键手。','success') } else { vibrate(35); toast('这手还不够强，再看一看对方的威胁。','error') } })
  }
}

function updateAnalysisPanel() {
  const set=(id,value)=>{ const el=document.querySelector(id); if(el)el.textContent=value }
  set('#engine-name',state.analysis.engine); set('#depth-value',state.analysis.depth); set('#nodes-value',state.analysis.nodes); set('#elapsed-value',state.analysis.elapsed)
}

function vibrate(pattern) { if ('vibrate' in navigator) navigator.vibrate(pattern) }

function toast(message, type = '') {
  const container = document.querySelector('#toasts')
  if (!container) return
  const item = document.createElement('div'); item.className=`toast ${type}`; item.textContent=message; container.append(item); setTimeout(()=>item.remove(),3200)
}

function exportRecord(record) {
  if (!record) return
  const safe=(record.title||'雾弈棋谱').replace(/[\\/:*?"<>|]/g,'-')
  downloadText(`${safe}.sgf`,recordToSgf(record),'application/x-go-sgf;charset=utf-8')
  toast('SGF 棋谱已导出','success')
}

app.addEventListener('click', async (event) => {
  const target = event.target.closest('[data-action], [data-view]')
  if (!target) return
  if (target.dataset.modal !== undefined) return
  if (target.dataset.view) { setView(target.dataset.view); return }
  const action = target.dataset.action
  if (action === 'theme') state.modal={type:'theme'},render()
  else if (action === 'close-modal') { if (event.target.closest('[data-modal]') && !event.target.closest('.modal-close')) return; state.modal=null; render() }
  else if (action === 'select-theme') { state.theme=target.dataset.themeId; document.documentElement.dataset.theme=state.theme; saveSettings({theme:state.theme,sound:state.sound}); render() }
  else if (action === 'open-ai') state.modal={type:'ai',level:5,side:BLACK},render()
  else if (action === 'select-level') state.modal.level=Number(target.dataset.level),render()
  else if (action === 'select-side') state.modal.side=Number(target.dataset.side),render()
  else if (action === 'start-ai') newGame('ai',{level:state.modal.level,humanSide:state.modal.side})
  else if (action === 'open-online') state.modal={type:'online',phase:'choose'},render()
  else if (action === 'create-room') { setupRoom(); const code=room.create(); state.modal={type:'online',phase:'room',code}; render() }
  else if (action === 'join-room') { try { const code=document.querySelector('#join-code')?.value; setupRoom(); room.join(code); state.modal={type:'online',phase:'room',code:String(code).trim().toUpperCase()}; render() } catch(error){ toast(error.message,'error') } }
  else if (action === 'copy-room') { await navigator.clipboard.writeText(state.modal.code); toast('房间码已复制','success') }
  else if (action === 'cancel-online') { room?.close(); state.modal=null; render() }
  else if (action === 'undo') {
    const game=state.game; if(game?.mode==='ai'&&game.status==='playing'&&!game.thinking&&game.moves.length){ const count=game.current===game.humanSide?2:1; game.moves.splice(Math.max(0,game.moves.length-count),count); game.board=boardAtMove(game.moves); game.current=game.moves.length%2?WHITE:BLACK; render() }
  }
  else if (action === 'restart') {
    const game=state.game; state.modal=null
    if(game.mode==='online'){ room?.send({type:'restart'}); newGame('online',{humanSide:game.humanSide,roomCode:game.roomCode}) }
    else newGame('ai',{level:game.level,humanSide:game.humanSide})
  }
  else if (action === 'resign') { const game=state.game; if(game?.status==='playing'){ if(game.mode==='online')room?.send({type:'resign'}); const winner=other(game.humanSide); finishGame(winner,'你已认输',`${winner===BLACK?'B':'W'}+R`,null); render() } }
  else if (action === 'save-current') exportRecord(gameToRecord(state.game))
  else if (action === 'replay') { const record=state.history.find((r)=>r.id===target.dataset.id); if(record){state.replay=record;state.replayIndex=record.moves.length;state.view='replay';render()} }
  else if (action === 'view-last-record') { const record=state.history.find((r)=>r.id===state.game.id); if(record){state.modal=null;state.replay=record;state.replayIndex=record.moves.length;state.view='replay';render()} }
  else if (action === 'export') exportRecord(state.history.find((r)=>r.id===target.dataset.id) || state.replay)
  else if (action === 'delete-record') { state.history=deleteRecord(target.dataset.id); render(); toast('棋谱已删除') }
  else if (action === 'import-record') document.querySelector('#record-file')?.click()
  else if (action === 'replay-prev') { state.replayIndex=Math.max(0,state.replayIndex-1);render() }
  else if (action === 'replay-next') { state.replayIndex=Math.min(state.replay.moves.length,state.replayIndex+1);render() }
  else if (action === 'replay-jump') { state.replayIndex=Number(target.dataset.index);render() }
  else if (action === 'replay-auto') {
    if(state.replayTimer){clearInterval(state.replayTimer);state.replayTimer=null;render()} else { if(state.replayIndex>=state.replay.moves.length)state.replayIndex=0; state.replayTimer=setInterval(()=>{ state.replayIndex++; if(state.replayIndex>=state.replay.moves.length){clearInterval(state.replayTimer);state.replayTimer=null} renderReplayFrameOnly() },520); renderReplayFrameOnly() }
  }
  else if (action === 'puzzle') { state.modal={type:'puzzle',id:Number(target.dataset.id)};render() }
})

app.addEventListener('input',(event)=>{ if(event.target.id==='replay-range'){state.replayIndex=Number(event.target.value);renderReplayFrameOnly()} if(event.target.id==='join-code')event.target.value=event.target.value.toUpperCase().replace(/[^A-Z2-9]/g,'') })

app.addEventListener('change', async (event) => {
  if(event.target.id!=='record-file'||!event.target.files?.[0])return
  try { const file=event.target.files[0]; const text=await file.text(); let record
    if(file.name.toLowerCase().endsWith('.json')){record=JSON.parse(text);record.id=crypto.randomUUID();if(!Array.isArray(record.moves))throw new Error('JSON 中没有有效落子')}
    else record=sgfToRecord(text)
    state.history=saveRecord(record);render();toast('棋谱导入成功','success')
  } catch(error){toast(`导入失败：${error.message}`,'error')}
})

function renderReplayFrameOnly() {
  const canvas=document.querySelector('#replay-board'); if(canvas)drawBoard(canvas,boardAtMove(state.replay.moves,state.replayIndex),state.replay.moves.slice(0,state.replayIndex))
  const range=document.querySelector('#replay-range'); if(range)range.value=state.replayIndex
  const status=document.querySelector('.board-topline .status-pill'); if(status){const move=state.replay.moves[Math.max(0,state.replayIndex-1)];status.innerHTML=`<i class="pulse"></i>${state.replayIndex===0?'开局':`第 ${state.replayIndex} 手 · ${moveLabel(move)}`}`}
  const meta=document.querySelector('.board-topline .game-meta'); if(meta)meta.textContent=`${state.replayIndex} / ${state.replay.moves.length}`
}

window.addEventListener('beforeunload',()=>{ai.dispose();room?.close()})
if('serviceWorker' in navigator && import.meta.env.PROD) window.addEventListener('load',()=>navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(console.warn))

render()
