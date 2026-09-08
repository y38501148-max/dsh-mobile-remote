import { randomUUID } from 'node:crypto'
import { Devices, ProtocolError, check } from './auth/devices.js'
import { Drafts } from './sync/drafts.js'

export const name = 'mobile-remote'
export const inject = ['webServer', 'apiProxy']
export const BASE_PATH = '/api/plugin/mobile-remote'
export const STATUS_PATH = `${BASE_PATH}/status`

export function isLocalRequest(req, port) {
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress)) return false
  if (![ `127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}` ].includes(req.headers.host)) return false
  if (req.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(req.headers['sec-fetch-site'])) return false
  if (req.headers.origin !== undefined && req.headers.origin !== `http://${req.headers.host}`) return false
  return true
}

async function body(req) {
  check(req.headers['content-type']?.split(';')[0].trim().toLowerCase() === 'application/json', 'json-required', 415)
  let size = 0
  const chunks = []
  for await (const chunk of req) {
    size += chunk.length
    check(size <= 96 * 1024, 'body-too-large', 413)
    chunks.push(chunk)
  }
  let value
  try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { throw new ProtocolError('invalid-json') }
  check(value && typeof value === 'object' && !Array.isArray(value), 'invalid-body')
  return value
}

export function apply(ctx) {
  const hostEpoch = randomUUID(), devices = new Devices(), drafts = new Drafts()
  const routes = {
    status: ['GET', () => ({ protocolVersion: 1, hostEpoch, hostPort: ctx.webServer.port,
      enabled: false, phase: 'P0/P1-foundation', persistence: 'process-only',
      capabilities: { nativeHttp: true, mux: true, hostEvents: true, remoteAccess: false, pairingCore: true, draftCAS: true } })],
    devices: ['GET', () => ({ devices: devices.list() })],
    'pair/invite': ['POST', () => devices.invite()],
    'pair/claim': ['POST', p => devices.claim(p.code, p.name)],
    'pair/approve': ['POST', p => devices.approve(p.deviceId)],
    'devices/revoke': ['POST', p => devices.revoke(p.deviceId)],
    'draft/read': ['POST', p => drafts.read(p.sessionId)],
    'draft/write': ['POST', p => drafts.write(p)],
    'draft/clear': ['POST', p => drafts.clear(p.sessionId, p.expectedRevision)],
  }
  ctx.effect(() => {
    const disposers = []
    try {
      for (const [path, [method, execute]] of Object.entries(routes)) {
        disposers.push(ctx.webServer.register({ kind: 'exact', path: `${BASE_PATH}/${path}`,
          async handler(req, res) {
            const reply = (status, value) => {
              res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' })
              res.end(JSON.stringify(value))
            }
            try {
              check(isLocalRequest(req, ctx.webServer.port), 'forbidden', 403)
              check(req.method === method, 'method-not-allowed', 405)
              const p = method === 'POST' ? await body(req) : {}
              if (method === 'POST') check(p.hostEpoch === hostEpoch, 'host-epoch-mismatch', 409)
              const value = execute(p)
              reply(value?.error === 'revision-conflict' ? 409 : 200, value)
            } catch (error) {
              reply(error instanceof ProtocolError ? error.status : 500, { error: error instanceof ProtocolError ? error.message : 'internal-error' })
            }
          },
        }))
      }
    } catch (error) {
      for (const dispose of disposers.reverse()) dispose()
      devices.dispose()
      throw error
    }
    return () => { devices.dispose(); for (const dispose of disposers.reverse()) dispose() }
  }, 'mobile-remote: local management routes')
}
