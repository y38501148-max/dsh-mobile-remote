import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { Devices, ProtocolError, check } from './auth/devices.js'
import { Drafts } from './sync/drafts.js'
import { StateStore } from './storage/store.js'
import { Follow } from './sync/follow.js'
import { sharedOperations } from './gateway/shared.js'
import { Commands } from './sync/commands.js'
import { installAdmission } from './sync/admission.js'
import { Uploads } from './sync/uploads.js'
import { RelayHost } from './relay/host.js'
import { Push } from './background/push.js'
import { KeepAwake } from './background/awake.js'
import { Gateway, tlsFiles } from './gateway/server.js'

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

export function apply(ctx, config = {}) {
  const hostEpoch = randomUUID(), store = new StateStore(config.statePath)
  const uploads = new Uploads(store)
  const devices = new Devices({ store }), drafts = new Drafts({ store, uploads }), follow = new Follow(), commands = new Commands(store, hostEpoch)
  const push = new Push(store, devices), awake = new KeepAwake()
  const shared = sharedOperations({ drafts, follow, commands, store, uploads, push })
  const admission = installAdmission(ctx, commands)
  let gateway, relay, gatewayChange = Promise.resolve(), disposed = false
  const changeGateway = action => {
    const operation = gatewayChange.then(action)
    gatewayChange = operation.catch(() => {})
    return operation
  }
  const enable = options => changeGateway(async () => {
    check(!disposed, 'plugin-unloaded', 409)
    check(!gateway, 'already-enabled', 409)
    check(config.statePath, 'persistent-state-required', 409)
    const candidate = new Gateway({ hostPort: ctx.webServer.port, epoch: hostEpoch, devices, commands, shared, reconcile: admission.reconcile, ...tlsFiles(options), publicOrigin: options.publicOrigin, bind: options.bind ?? '127.0.0.1', port: options.port ?? 0 })
    try { await candidate.start() } catch (error) { await candidate.close(); throw error }
    if (options.relayUrl) {
      try {
        check(typeof options.relayTokenPath === 'string', 'relay-token-file-required')
        relay = new RelayHost({ url: options.relayUrl, token: readFileSync(options.relayTokenPath, 'utf8').trim(), gatewayPort: candidate.port, ca: options.relayCaPath ? readFileSync(options.relayCaPath) : undefined }).start()
      } catch (error) { await candidate.close(); throw error }
    }
    gateway = candidate
    push.start(ctx.apiProxy)
    store.audit({ type: 'gateway-enabled' })
    return { enabled: true, origin: gateway.origin, port: gateway.port }
  })
  const routes = {
    status: ['GET', () => ({ protocolVersion: 1, hostEpoch, hostPort: ctx.webServer.port,
      enabled: !!gateway, keepAwake: awake.status(), relayState: relay?.state ?? 'disabled', phase: 'development', persistence: config.statePath ? 'durable' : 'process-only', remoteOrigin: gateway?.origin, remotePort: gateway?.port,
      capabilities: { nativeHttp: true, mux: true, hostEvents: true, remoteAccess: !!gateway, pairingCore: true, draftCAS: true } })],
    devices: ['GET', () => ({ devices: devices.list() })],
    'pair/invite': ['POST', () => devices.invite()],
    'pair/claim': ['POST', p => devices.claim(p.code, p.name)],
    'pair/approve': ['POST', p => devices.approve(p.deviceId, p.role)],
    'devices/revoke': ['POST', p => { const result = devices.revoke(p.deviceId); push.remove(p.deviceId); return result }],
    'keep-awake/set': ['POST', p => { check(typeof p.enabled === 'boolean', 'invalid-keep-awake'); if (p.enabled) { check(gateway, 'gateway-disabled', 409); return awake.enable() } return awake.disable() }],
    'gateway/enable': ['POST', p => enable(p)],
    'gateway/disable': ['POST', () => changeGateway(async () => { push.close(); awake.disable(); relay?.close(); relay = undefined; if (gateway) await gateway.close(); gateway = undefined; return { enabled: false } })],
    ...Object.fromEntries(Object.entries(shared).map(([path, execute]) => [path, ['POST', p => {
      check(typeof p.clientId === 'string' && /^[a-zA-Z0-9_-]{1,96}$/.test(p.clientId), 'client-id-required')
      return execute(p, { deviceId: `desktop:${p.clientId}`, role: 'admin' })
    }]])),
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
              const value = await execute(p)
              reply(value?.ok === false ? 409 : 200, value)
            } catch (error) {
              reply(error instanceof ProtocolError ? error.status : 500, { error: error instanceof ProtocolError ? error.message : 'internal-error' })
            }
          },
        }))
      }
    } catch (error) {
      for (const dispose of disposers.reverse()) dispose()
      devices.dispose()
      admission.dispose()
      throw error
    }
    return () => { disposed = true; push.close(); awake.disable(); devices.dispose(); admission.dispose(); relay?.close(); for (const dispose of disposers.reverse()) dispose(); return changeGateway(async () => { if (gateway) await gateway.close(); gateway = undefined }) }
  }, 'mobile-remote: local management routes')
}
