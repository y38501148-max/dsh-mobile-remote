import { createServer } from 'node:https'
import { request as httpRequest } from 'node:http'
import { readFileSync } from 'node:fs'
import WebSocket, { WebSocketServer } from 'ws'
import { check } from '../auth/devices.js'
import { authorizeRoute, canonicalPath, STREAM_PATHS, WRITE_METHODS, ADMIN_METHODS } from './policy.js'
import { mobileIndex } from './html.js'
import { PWA_RESOURCES } from './pwa.js'
import { credentialFrom, failure, jsonBody, parseBody, readBody, reply, sessionCookie } from './http.js'

const BOOTSTRAP = readFileSync(new URL('../client/bootstrap.js', import.meta.url), 'utf8').replace('WRITE_METHODS_PLACEHOLDER', JSON.stringify([...WRITE_METHODS, ...ADMIN_METHODS]))
const PAIR_HTML = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>连接 DeepSeek Harness</title><style>body{font:17px system-ui;background:#f7f8fc;color:#18213a;max-width:440px;margin:10vh auto;padding:24px}input,button{box-sizing:border-box;width:100%;font:inherit;padding:14px;margin:10px 0;border:1px solid #b9c4d5;border-radius:12px}button{background:#345bea;color:white}#status{white-space:pre-wrap}</style><h1>连接你的电脑</h1><p>在电脑端生成邀请，扫码或输入邀请码。随后在电脑确认此设备。</p><form id="pair"><label>设备名称<input id="name" maxlength="80" value="我的手机" required></label><label>邀请码<input id="code" required autocomplete="off"></label><button>请求连接</button></form><p id="status" role="status"></p><script src="/remote/pair.js"></script></html>`
const PAIR_JS = `const status=document.querySelector('#status');const code=document.querySelector('#code');code.value=new URLSearchParams(location.hash.slice(1)).get('invite')||'';history.replaceState(null,'',location.pathname);let timer;async function poll(){try{const r=await fetch('/remote/session');const v=await r.json();if(r.ok&&v.state==='approved'){location.replace('/');return}if(r.ok){status.textContent='等待电脑确认设备…';timer=setTimeout(poll,1500)}else status.textContent='连接已失效，请在电脑生成新邀请。'}catch{status.textContent='连接中断，正在重试…';timer=setTimeout(poll,3000)}}document.querySelector('#pair').onsubmit=async e=>{e.preventDefault();clearTimeout(timer);try{const r=await fetch('/remote/claim',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({code:code.value,name:document.querySelector('#name').value})});const v=await r.json();if(!r.ok)throw Error(v.error);code.value='';poll()}catch(e){status.textContent='连接失败：'+e.message}};poll();`

export class Gateway {
  constructor({ hostPort, epoch, devices, commands, shared = {}, cert, key, publicOrigin, bind = '127.0.0.1', port = 0 }) {
    this.hostPort = hostPort; this.epoch = epoch; this.devices = devices; this.commands = commands; this.shared = shared
    this.origin = publicOrigin; this.bind = bind; this.port = port
    const origin = new URL(publicOrigin)
    check(origin.protocol === 'https:' && origin.origin === publicOrigin && !origin.username && !origin.password, 'https-origin-required')
    this.server = createServer({ cert, key, minVersion: 'TLSv1.2' }, (req, res) => this.handle(req, res).catch(error => failure(res, error)))
    this.server.requestTimeout = 30_000; this.server.headersTimeout = 10_000
    this.wss = new WebSocketServer({ noServer: true, maxPayload: 1024, perMessageDeflate: false })
    this.sockets = new Set(); this.channels = new Set(); this.attempts = new Map()
    this.server.on('connection', socket => { this.sockets.add(socket); socket.once('close', () => this.sockets.delete(socket)) })
    this.server.on('upgrade', (req, socket, head) => {
      try { this.upgrade(req, socket, head) } catch { socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n') }
    })
  }
  async start() {
    await new Promise((resolve, reject) => { this.server.once('error', reject); this.server.listen(this.port, this.bind, () => { this.server.off('error', reject); resolve() }) })
    this.port = this.server.address().port
    return { origin: this.origin, port: this.port }
  }
  boundary(req, requireOrigin = false) {
    check(req.headers.host === new URL(this.origin).host, 'forbidden-host', 403)
    check(!req.headers.origin || req.headers.origin === this.origin, 'forbidden-origin', 403)
    check(!requireOrigin || req.headers.origin === this.origin, 'origin-required', 403)
    check(!req.headers['sec-fetch-site'] || ['same-origin', 'none'].includes(req.headers['sec-fetch-site']), 'cross-site', 403)
    canonicalPath(req.url)
  }
  rateLimit(req) {
    const now = Date.now(), key = req.socket.remoteAddress
    for (const [id, value] of this.attempts) if (value.until < now) this.attempts.delete(id)
    const value = this.attempts.get(key) ?? { count: 0, until: now + 60_000 }
    check(this.attempts.has(key) || this.attempts.size < 1000, 'rate-limited', 429)
    check(++value.count <= 10, 'rate-limited', 429)
    this.attempts.set(key, value)
  }
  async handle(req, res) {
    this.boundary(req, !['GET', 'HEAD'].includes(req.method))
    const path = canonicalPath(req.url)
    if (PWA_RESOURCES.has(path) && req.method === 'GET') {
      const [type, content] = PWA_RESOURCES.get(path)
      res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store', 'service-worker-allowed': '/', 'x-content-type-options': 'nosniff' }); res.end(content); return
    }
    if (path === '/remote/pair' && req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'content-security-policy': "default-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'" }); res.end(PAIR_HTML); return
    }
    if (path === '/remote/pair.js' && req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' }); res.end(PAIR_JS); return
    }
    if (path === '/remote/claim' && req.method === 'POST') {
      this.rateLimit(req)
      const value = await jsonBody(req, 2048)
      const phone = this.devices.claim(value.code, value.name)
      reply(res, 200, { deviceId: phone.deviceId, state: phone.state }, { 'set-cookie': sessionCookie(phone.credential) }); return
    }
    let credential
    try { credential = credentialFrom(req) } catch (error) {
      if (path === '/' && req.method === 'GET') { res.writeHead(302, { location: '/remote/pair', 'cache-control': 'no-store' }); res.end(); return }
      throw error
    }
    if (path === '/remote/session' && req.method === 'GET') { reply(res, 200, { ...this.devices.identify(credential, true), hostEpoch: this.epoch, protocolVersion: 1 }); return }
    const device = this.devices.identify(credential)
    if (path === '/remote/bootstrap.js' && req.method === 'GET') { res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' }); res.end(BOOTSTRAP); return }
    const detach = this.devices.attach(credential, () => res.destroy())
    res.once('close', detach)
    if (path === '/remote/logout' && req.method === 'POST') {
      reply(res, 200, { ok: true }, { 'set-cookie': sessionCookie('', 0) }); return
    }
    if (path === '/remote/commands' && req.method === 'GET') { reply(res, 200, { commands: this.commands.list(device.deviceId) }); return }
    const operation = path.startsWith('/remote/shared/') ? this.shared[path.slice('/remote/shared/'.length)] : undefined
    if (operation && req.method === 'POST') {
      const p = await jsonBody(req)
      check(p.hostEpoch === this.epoch, 'host-epoch-mismatch', 409)
      this.devices.identify(credential)
      const result = await operation(p, device)
      reply(res, result?.ok === false ? 409 : 200, result); return
    }
    const route = authorizeRoute(req.url, req.method, device.role)
    check(route, 'route-not-authorized', 403)
    check(route.kind !== 'stream', 'websocket-required', 426)
    let bytes
    if (req.method === 'POST') {
      bytes = await readBody(req, 32 * 1024 * 1024)
      const envelope = parseBody(bytes)
      check(req.headers['content-type']?.split(';')[0] === 'application/json', 'json-required', 415)
      check(route.rpc === 'respond' ? envelope.type === 'client-response' : envelope.method === route.rpc, 'method-mismatch')
      this.devices.identify(credential)
      if (route.write) {
        check(req.headers['x-dsh-host-epoch'] === this.epoch, 'host-epoch-mismatch', 409)
        const response = await this.commands.execute(device.deviceId, envelope.rpcId, bytes, () => this.forwardBuffered(req, bytes))
        res.writeHead(response.status, { ...response.headers, 'cache-control': 'no-store' }); res.end(response.body); return
      }
    }
    if ((path === '/' || path === '/index.html') && req.method === 'GET') {
      const response = await this.forwardBuffered(req)
      res.writeHead(response.status, { ...response.headers, 'cache-control': 'no-store' })
      res.end(mobileIndex(response.body))
      return
    }
    await this.forward(req, res, bytes)
  }
  upstream(req) {
    const headers = { host: `127.0.0.1:${this.hostPort}`, origin: `http://127.0.0.1:${this.hostPort}` }
    for (const key of ['content-type', 'accept', 'range']) if (req.headers[key]) headers[key] = req.headers[key]
    return { hostname: '127.0.0.1', port: this.hostPort, path: req.url, method: req.method, headers }
  }
  responseHeaders(headers) {
    const selected = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' }
    for (const key of ['content-type', 'content-disposition', 'content-range', 'accept-ranges']) if (headers[key]) selected[key] = headers[key]
    return selected
  }
  forwardBuffered(req, bytes) {
    return new Promise((resolve, reject) => {
      const upstream = httpRequest(this.upstream(req), incoming => {
        const chunks = []; let size = 0
        incoming.on('data', chunk => { size += chunk.length; if (size > 2 * 1024 * 1024) incoming.destroy(Error('receipt-too-large')); else chunks.push(chunk) })
        incoming.on('error', reject)
        incoming.on('end', () => resolve({ status: incoming.statusCode, headers: this.responseHeaders(incoming.headers), body: Buffer.concat(chunks).toString('utf8') }))
      })
      upstream.setTimeout(60_000, () => upstream.destroy(Error('host-timeout')))
      upstream.on('error', reject); upstream.end(bytes)
    })
  }
  forward(req, res, bytes) {
    return new Promise((resolve, reject) => {
      const upstream = httpRequest(this.upstream(req), incoming => {
        res.writeHead(incoming.statusCode, this.responseHeaders(incoming.headers))
        incoming.on('error', reject); incoming.on('end', resolve); incoming.pipe(res)
      })
      upstream.setTimeout(60_000, () => upstream.destroy(Error('host-timeout')))
      res.once('close', () => upstream.destroy()); upstream.on('error', reject); upstream.end(bytes)
    })
  }
  upgrade(req, socket, head) {
    this.boundary(req, true)
    check(STREAM_PATHS.has(canonicalPath(req.url)), 'route-not-authorized', 403)
    const credential = credentialFrom(req)
    this.devices.identify(credential)
    this.wss.handleUpgrade(req, socket, head, downstream => {
      const upstream = new WebSocket(`ws://127.0.0.1:${this.hostPort}${req.url}`, { origin: `http://127.0.0.1:${this.hostPort}`, maxPayload: 8 * 1024 * 1024, perMessageDeflate: false })
      const close = () => { downstream.terminate(); upstream.terminate() }
      this.channels.add(close)
      let detach
      try { detach = this.devices.attach(credential, close) } catch { close(); return }
      downstream.on('message', () => downstream.close(1008, 'downlink-only'))
      upstream.on('message', (data, binary) => {
        if (downstream.readyState !== WebSocket.OPEN) return
        if (downstream.bufferedAmount > 2 * 1024 * 1024) { downstream.close(1013, 'resync-required'); upstream.terminate(); return }
        downstream.send(data, { binary })
      })
      downstream.on('error', () => upstream.terminate())
      upstream.on('error', () => downstream.close(1011, 'host-unavailable'))
      downstream.on('close', () => { detach(); this.channels.delete(close); upstream.terminate() })
      upstream.on('close', () => downstream.close(1012, 'host-disconnected'))
    })
  }
  async close() {
    for (const close of this.channels) close()
    this.channels.clear(); this.wss.close()
    for (const socket of this.sockets) socket.destroy()
    await new Promise(resolve => this.server.close(resolve))
  }
}

export function tlsFiles({ certPath, keyPath }) {
  check(typeof certPath === 'string' && typeof keyPath === 'string', 'tls-files-required')
  return { cert: readFileSync(certPath), key: readFileSync(keyPath) }
}
