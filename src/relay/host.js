import { connect } from 'node:net'
import WebSocket, { createWebSocketStream } from 'ws'
import { check } from '../auth/devices.js'

export class RelayHost {
  constructor({ url, token, gatewayPort, ca, maxConnections = 64 }) {
    const parsed = new URL(url)
    check(parsed.protocol === 'wss:' && parsed.pathname === '/relay/control' && !parsed.search && !parsed.hash && !parsed.username && !parsed.password, 'invalid-relay-url')
    check(typeof token === 'string' && token.length >= 32, 'relay-token-too-short')
    this.url = parsed; this.options = { headers: { authorization: `Bearer ${token}` }, ca, perMessageDeflate: false, maxPayload: 65536, handshakeTimeout: 10000 }
    this.gatewayPort = gatewayPort; this.maxConnections = maxConnections; this.channels = new Set(); this.stopped = false; this.attempts = 0; this.state = 'disconnected'
  }
  start() { this.connect(); return this }
  connect() {
    if (this.stopped) return
    this.state = 'connecting'
    const ws = new WebSocket(this.url, this.options); this.control = ws
    ws.on('message', bytes => {
      let message
      try { message = JSON.parse(bytes.toString()) } catch { ws.close(1008); return }
      if (message.type === 'ready' && message.protocolVersion === 1) { this.state = 'connected'; this.attempts = 0; return }
      if (message.type === 'open' && /^[0-9a-f-]{36}$/.test(message.id) && this.state === 'connected') this.open(message.id)
      else ws.close(1008, 'invalid relay protocol')
    })
    ws.on('error', () => { this.state = 'disconnected' })
    ws.once('close', () => {
      this.state = 'disconnected'
      for (const channel of this.channels) channel.close()
      if (!this.stopped) { this.timer = setTimeout(() => this.connect(), Math.min(30000, 1000 * 2 ** Math.min(this.attempts++, 5))); this.timer.unref() }
    })
  }
  open(id) {
    if (this.channels.size >= this.maxConnections) return
    const url = new URL(`/relay/data/${id}`, this.url)
    const ws = new WebSocket(url, this.options)
    const socket = connect({ host: '127.0.0.1', port: this.gatewayPort })
    const stream = createWebSocketStream(ws, { highWaterMark: 65536 })
    const channel = { close: () => { this.channels.delete(channel); socket.destroy(); stream.destroy(); ws.terminate() } }
    this.channels.add(channel)
    socket.on('error', channel.close); stream.on('error', channel.close); ws.on('error', channel.close)
    socket.once('close', channel.close); stream.once('close', channel.close)
    socket.pipe(stream).pipe(socket)
  }
  close() { this.stopped = true; clearTimeout(this.timer); this.control?.terminate(); for (const channel of this.channels) channel.close(); this.state = 'disconnected' }
}
