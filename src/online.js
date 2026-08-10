import { Peer } from 'peerjs'

const PREFIX = 'aurora-gomoku-'
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

function makeCode() {
  return Array.from({ length: 6 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join('')
}

export class OnlineRoom {
  constructor(handlers = {}) {
    this.handlers = handlers
    this.peer = null
    this.connection = null
    this.role = null
    this.code = null
    this.closed = false
    this.reconnectTimer = null
  }

  emit(type, payload) {
    this.handlers[type]?.(payload)
  }

  create(code = makeCode()) {
    this.close()
    this.closed = false
    this.role = 'host'
    this.code = code.toUpperCase()
    this.emit('status', { phase: 'connecting', text: '正在建立安全房间…' })
    this.peer = new Peer(`${PREFIX}${this.code.toLowerCase()}`, { debug: 0 })
    this.peer.on('open', () => this.emit('status', { phase: 'waiting', text: '等待对手加入', code: this.code }))
    this.peer.on('connection', (connection) => this.bindConnection(connection))
    this.peer.on('error', (error) => this.handleError(error))
    this.peer.on('disconnected', () => this.reopenPeer())
    return this.code
  }

  join(code) {
    this.close()
    this.closed = false
    this.role = 'guest'
    this.code = String(code || '').trim().toUpperCase()
    if (!/^[A-Z2-9]{6}$/.test(this.code)) throw new Error('请输入正确的 6 位房间码')
    this.emit('status', { phase: 'connecting', text: '正在加入房间…' })
    this.peer = new Peer(undefined, { debug: 0 })
    this.peer.on('open', () => this.connectToHost())
    this.peer.on('error', (error) => this.handleError(error))
    this.peer.on('disconnected', () => this.reopenPeer())
  }

  connectToHost() {
    if (!this.peer || this.closed) return
    const connection = this.peer.connect(`${PREFIX}${this.code.toLowerCase()}`, {
      reliable: true,
      serialization: 'json',
      metadata: { version: 1 },
    })
    this.bindConnection(connection)
  }

  bindConnection(connection) {
    if (this.connection?.open && this.role === 'host') {
      connection.close()
      return
    }
    this.connection = connection
    connection.on('open', () => {
      clearTimeout(this.reconnectTimer)
      this.emit('status', { phase: 'connected', text: '对手已连接', code: this.code })
      this.emit('connected', { role: this.role, code: this.code })
    })
    connection.on('data', (message) => {
      if (message && typeof message === 'object') this.emit('message', message)
    })
    connection.on('close', () => this.scheduleReconnect())
    connection.on('error', (error) => this.handleError(error))
  }

  send(message) {
    if (!this.connection?.open) return false
    this.connection.send({ ...message, sentAt: Date.now() })
    return true
  }

  scheduleReconnect() {
    if (this.closed) return
    this.emit('status', { phase: 'reconnecting', text: '连接中断，正在自动重连…', code: this.code })
    if (this.role === 'guest') {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = setTimeout(() => this.connectToHost(), 1600)
    }
  }

  reopenPeer() {
    if (this.closed) return
    setTimeout(() => {
      if (this.peer?.disconnected && !this.peer.destroyed) this.peer.reconnect()
    }, 900)
  }

  handleError(error) {
    const messages = {
      'peer-unavailable': '没有找到这个房间，请核对房间码',
      unavailable_id: '房间码刚被占用，请重新创建',
      network: '网络暂时不可用，正在重试',
      'webrtc': '当前网络限制了点对点连接',
    }
    const text = messages[error?.type] || error?.message || '联机发生未知错误'
    this.emit('error', { error, text })
    if (error?.type === 'network') this.scheduleReconnect()
  }

  close() {
    this.closed = true
    clearTimeout(this.reconnectTimer)
    this.connection?.close()
    this.peer?.destroy()
    this.connection = null
    this.peer = null
  }
}
