import { createServer as httpsServer } from 'node:https'
import { createServer as tcpServer } from 'node:net'
import { randomUUID, timingSafeEqual } from 'node:crypto'
import { WebSocketServer, createWebSocketStream } from 'ws'
import { check } from '../auth/devices.js'

// One explicitly configured Host per instance. The public listener only moves
// opaque TLS bytes. TLS for the business origin terminates at the Host gateway.
export class RelayServer {
  constructor({ cert, key, token, bind = '127.0.0.1', controlPort = 0, publicPort = 0, maxConnections = 64 }) {
    check(typeof token === 'string' && Buffer.byteLength(token) >= 32, 'relay-token-too-short')
    this.token = Buffer.from(`Bearer ${token}`); this.bind = bind; this.controlPort = controlPort; this.publicPort = publicPort; this.maxConnections = maxConnections
    this.pending = new Map(); this.channels = new Set(); this.sockets = new Set(); this.control = null
    this.controlServer = httpsServer({ cert, key, minVersion: 'TLSv1.2' }, (req, res) => { res.writeHead(404); res.end() })
    this.controlServer.headersTimeout = 10000; this.controlServer.requestTimeout = 10000
    this.wss = new WebSocketServer({ noServer: true, maxPayload: 65536, perMessageDeflate: false })
    this.controlServer.on('connection', socket => { this.sockets.add(socket); socket.once('close', () => this.sockets.delete(socket)) })
    this.controlServer.on('upgrade', (req, socket, head) => {
      const authorization = Buffer.from(req.headers.authorization ?? '')
      const authorized = authorization.length === this.token.length && timingSafeEqual(authorization, this.token)
      const id = req.url?.match(/^\/relay\/data\/([0-9a-f-]{36})$/)?.[1]
      if (!authorized || req.headers.origin || (req.url !== '/relay/control' && !id) || (id && !this.pending.has(id)) || (req.url === '/relay/control' && this.control)) {
        socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return
      }
      this.wss.handleUpgrade(req, socket, head, ws => {
        if (id) this.attach(id, ws)
        else {
          this.control = ws; ws.alive = true
          ws.on('pong', () => { ws.alive = true })
          ws.on('message', () => ws.close(1008, 'control is downstream-only'))
          ws.once('close', () => { if (this.control === ws) { this.control = null; this.disconnectClients() } })
          ws.on('error', () => ws.terminate())
          ws.send(JSON.stringify({ type: 'ready', protocolVersion: 1 }))
        }
      })
    })
    this.publicServer = tcpServer(socket => {
      if (!this.control || this.control.readyState !== 1 || this.channels.size + this.pending.size >= this.maxConnections) { socket.destroy(); return }
      socket.pause(); socket.setNoDelay(true)
      const id = randomUUID(), timer = setTimeout(() => { this.pending.delete(id); socket.destroy() }, 10000)
      this.pending.set(id, { socket, timer })
      socket.once('error', () => socket.destroy())
      socket.once('close', () => { clearTimeout(timer); this.pending.delete(id) })
      this.control.send(JSON.stringify({ type: 'open', id }))
    })
  }
  attach(id, ws) {
    const entry = this.pending.get(id)
    if (!entry) { ws.terminate(); return }
    this.pending.delete(id); clearTimeout(entry.timer)
    const stream = createWebSocketStream(ws, { highWaterMark: 65536 })
    const channel = { socket: entry.socket, ws }; this.channels.add(channel)
    const close = () => { this.channels.delete(channel); entry.socket.destroy(); stream.destroy(); ws.terminate() }
    stream.on('error', close); entry.socket.on('error', close)
    stream.once('close', close); entry.socket.once('close', close)
    entry.socket.pipe(stream).pipe(entry.socket)
  }
  async start() {
    const listen = (server, port) => new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, this.bind, () => { server.off('error', reject); resolve(server.address().port) }) })
    try { this.controlPort = await listen(this.controlServer, this.controlPort); this.publicPort = await listen(this.publicServer, this.publicPort) }
    catch (error) { await this.close(); throw error }
    this.heartbeat = setInterval(() => { const ws = this.control; if (ws) { if (!ws.alive) ws.terminate(); else { ws.alive = false; ws.ping() } } }, 15000)
    this.heartbeat.unref()
    return { controlPort: this.controlPort, publicPort: this.publicPort }
  }
  disconnectClients() {
    for (const { socket, timer } of this.pending.values()) { clearTimeout(timer); socket.destroy() }
    this.pending.clear()
    for (const channel of this.channels) { channel.socket.destroy(); channel.ws.terminate() }
    this.channels.clear()
  }
  async close() {
    clearInterval(this.heartbeat); this.control?.terminate(); this.disconnectClients()
    for (const socket of this.sockets) socket.destroy()
    this.wss.close()
    await Promise.all([this.controlServer, this.publicServer].map(server => new Promise(resolve => server.close(() => resolve()))))
  }
}
