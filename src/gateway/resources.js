import { realpath, open, stat } from 'node:fs/promises'
import { constants } from 'node:fs'
import { resolve, relative, isAbsolute, basename, extname } from 'node:path'
import { randomBytes, randomUUID } from 'node:crypto'
import { check } from '../auth/devices.js'
const TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.pdf': 'application/pdf', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg' }
const TEXT = new Set(['.txt','.md','.markdown','.json','.jsonl','.csv','.tsv','.diff','.patch','.log','.js','.ts','.py','.cs','.yml','.yaml','.html','.svg','.css','.xml','.sh'])
const within = (root, target) => { const path = relative(root, target); return path === '' || (!path.startsWith('..') && !isAbsolute(path)) }
export class Resources {
  constructor(api, { now = Date.now } = {}) { this.api = api; this.now = now; this.tickets = new Map() }
  async root(sessionId) {
    check(typeof sessionId === 'string' && sessionId.length <= 256, 'invalid-session')
    const response = await this.api.sessions.list({ rpcId: randomUUID(), payload: {} })
    check(response.result.ok, 'session-list-unavailable', 503)
    const session = response.result.value.items.find(s => s.sessionId === sessionId)
    check(session?.cwd, 'session-workspace-required', 403)
    return realpath(session.cwd)
  }
  async issue({ sessionId, path }, device) {
    check(typeof path === 'string' && path.length > 0 && path.length <= 4096 && !path.includes('\0'), 'invalid-resource-path')
    const root = await this.root(sessionId), target = await realpath(resolve(root, path))
    const external = !within(root, target)
    check(!external || device.role === 'admin', 'resource-outside-session-workspace', 403)
    const info = await stat(target)
    check(info.isFile() && info.size <= 512 * 1024 * 1024, 'resource-too-large-or-not-file', 413)
    for (const [id, ticket] of this.tickets) if (ticket.expiresAt < this.now()) this.tickets.delete(id)
    check(this.tickets.size < 512, 'resource-ticket-limit', 429)
    const id = randomBytes(24).toString('base64url'), expiresAt = this.now() + 5 * 60 * 1000
    this.tickets.set(id, { deviceId: device.deviceId, sessionId, root, target, external, dev: info.dev, ino: info.ino, expiresAt })
    const extension = extname(target).toLowerCase(), type = TYPES[extension] ?? (TEXT.has(extension) ? 'text/plain; charset=utf-8' : 'application/octet-stream')
    return { url: `${device.deviceId.startsWith('desktop:') ? '/api/plugin/mobile-remote/resource/' : '/remote/resource/'}${id}`, name: basename(target), size: info.size, type, expiresAt }
  }
  async serve(id, deviceId, req, res) {
    const ticket = this.tickets.get(id)
    check(ticket && ticket.expiresAt > this.now() && (ticket.deviceId === deviceId || (deviceId === 'desktop' && ticket.deviceId.startsWith('desktop:'))), 'resource-ticket-invalid', 403)
    const root = await this.root(ticket.sessionId), target = await realpath(ticket.target)
    check(root === ticket.root && target === ticket.target && (ticket.external || within(root, target)), 'resource-scope-changed', 403)
    const file = await open(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
    try {
      const info = await file.stat()
      check(info.dev === ticket.dev && info.ino === ticket.ino && info.isFile() && info.size <= 512 * 1024 * 1024, 'resource-changed', 409)
      let start = 0, end = Math.max(0, info.size - 1), status = 200
      if (req.headers.range) {
        const match = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range)
        check(match && info.size > 0, 'invalid-range', 416)
        start = Number(match[1]); end = match[2] ? Number(match[2]) : info.size - 1
        check(Number.isSafeInteger(start) && start >= 0 && end >= start && end < info.size, 'invalid-range', 416); status = 206
      }
      const extension = extname(target).toLowerCase(), type = TYPES[extension] ?? (TEXT.has(extension) ? 'text/plain; charset=utf-8' : 'application/octet-stream')
      const size = info.size ? end - start + 1 : 0
      res.writeHead(status, { 'content-type': type, 'content-length': size, 'accept-ranges': 'bytes', ...status === 206 ? { 'content-range': `bytes ${start}-${end}/${info.size}` } : {}, 'content-disposition': `${type === 'application/octet-stream' ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(basename(target))}`, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'content-security-policy': "sandbox; default-src 'none'", 'referrer-policy': 'no-referrer' })
      if (req.method === 'HEAD' || !size) { res.end(); return }
      await new Promise((resolveDone, reject) => {
        const stream = file.createReadStream({ start, end, autoClose: false })
        const closed = () => { stream.destroy(); resolveDone() }
        res.once('close', closed); res.once('finish', resolveDone); stream.once('error', reject); stream.pipe(res)
      })
    } finally { await file.close() }
  }
  close() { this.tickets.clear() }
}
