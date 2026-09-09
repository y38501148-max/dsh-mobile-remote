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
import { Resources } from './gateway/resources.js'
import { QueueCommands } from './sync/queue.js'
import { Extensions } from './sync/extensions.js'
import { Gateway, tlsFiles } from './gateway/server.js'
import { DirectController } from './direct/controller.js'
import { certificateIdentity } from './direct/identity.js'

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

export async function apply(ctx, config = {}) {
  const hostEpoch = randomUUID(), store = await StateStore.acquire(config.statePath)
  if (!store.read().hostId) store.update(value => { value.hostId = randomUUID() })
  const hostId = store.read().hostId
  const uploads = new Uploads(store)
  const devices = new Devices({ store }), drafts = new Drafts({ store, uploads }), follow = new Follow(), commands = new Commands(store, hostEpoch)
  const push = new Push(store, devices), awake = new KeepAwake()
  const resources = new Resources(ctx.apiProxy)
  const extensions = new Extensions(store)
  const shared = sharedOperations({ drafts, follow, commands, store, uploads, push, resources, extensions, queue: new QueueCommands(ctx, commands) })
  const admission = installAdmission(ctx, commands)
  let gateway, relay, startupError, gatewayChange = Promise.resolve(), disposed = false
  store.onFault = () => { startupError = '状态文件归属已丢失，远控已停止'; devices.dispose(); push.close(); awake.disable(); relay?.close(); const previous = gateway; gateway = undefined; previous?.close().catch(() => {}) }
  const changeGateway = action => {
    const operation = gatewayChange.then(action)
    gatewayChange = operation.catch(() => {})
    return operation
  }
  const enable = options => changeGateway(async () => {
    check(!disposed, 'plugin-unloaded', 409)
    check(!gateway, 'already-enabled', 409)
    check(config.statePath, 'persistent-state-required', 409)
    const native = await ctx.apiProxy.host.describe({ type: 'client-request', rpcId: randomUUID(), method: 'host.describe', payload: {} })
    // rc.6 reports the constant 0.0.1 here; it is not a package-version proof.
    check(native.result.ok && ['prompt', 'history', 'updateQueue', 'list'].every(method => typeof ctx.apiProxy.sessions?.[method] === 'function') && typeof ctx.apiProxy.events?.mux === 'function', 'native-api-not-supported', 409)
    const candidate = new Gateway({ hostPort: ctx.webServer.port, epoch: hostEpoch, hostId, devices, commands, shared, resources, reconcile: admission.reconcile, ...tlsFiles(options), publicOrigin: options.publicOrigin, bind: options.bind ?? '127.0.0.1', port: options.port ?? 0 })
    try { await candidate.start() } catch (error) { await candidate.close(); throw error }
    if (options.relayUrl) {
      try {
        check(typeof options.relayTokenPath === 'string', 'relay-token-file-required')
        relay = new RelayHost({ url: options.relayUrl, token: readFileSync(options.relayTokenPath, 'utf8').trim(), gatewayPort: candidate.port, ca: options.relayCaPath ? readFileSync(options.relayCaPath) : undefined }).start()
      } catch (error) { await candidate.close(); throw error }
    }
    gateway = candidate
    push.start(ctx.apiProxy)
    const saved = Object.fromEntries(['publicOrigin','port','bind','certPath','keyPath','relayUrl','relayTokenPath','relayCaPath'].filter(key => options[key] !== undefined).map(key => [key, options[key]]))
    saved.port = candidate.port
    try { store.update(value => { value.remoteConfig = saved; value.audit.push({ at: Date.now(), type: 'gateway-enabled' }); value.audit = value.audit.slice(-1000) }); startupError = undefined }
    catch (error) { push.close(); relay?.close(); relay = undefined; await candidate.close(); gateway = undefined; throw error }
    return { enabled: true, origin: gateway.origin, port: gateway.port }
  })
  const direct = new DirectController({store,hostId,enable,getGateway:()=>gateway})
  const routes = {
    status: ['GET', () => ({ protocolVersion: 1, adapterTarget: '0.1.0-rc.6', hostEpoch, hostPort: ctx.webServer.port,
      hostId, pluginVersion: '0.2.1', directError: direct.error, directConfig: store.read().directConfig ?? null,
      enabled: !!gateway, startupError, keepAwake: awake.status(), relayState: relay?.state ?? 'disabled', phase: 'development', persistence: config.statePath ? 'durable' : 'process-only', remoteOrigin: gateway?.origin, remotePort: gateway?.port,
      capabilities: { nativeHttp: true, mux: true, hostEvents: true, remoteAccess: !!gateway, pairingCore: true, draftCAS: true } })],
    devices: ['GET', () => ({ devices: devices.list() })],
    'pair/invite': ['POST', () => ({ ...devices.invite(), hostId, pin: gateway?.identity?.pin, protocolVersion: 1, origin: gateway?.origin })],
    'direct/inspect': ['GET', () => direct.inspect()],
    'direct/enable': ['POST', p => direct.start(p)],
    'certificate/reload': ['POST', () => { check(gateway,'gateway-disabled',409); const saved=store.read().remoteConfig; const files=tlsFiles(saved); certificateIdentity(files.cert,files.key); gateway.reloadTls(files); return {ok:true} }],
    'pair/claim': ['POST', p => devices.claim(p.code, p.name)],
    'pair/approve': ['POST', p => devices.approve(p.deviceId, p.role)],
    'devices/revoke': ['POST', p => { const result = devices.revoke(p.deviceId); push.remove(p.deviceId); return result }],
    'keep-awake/set': ['POST', async p => { check(typeof p.enabled === 'boolean', 'invalid-keep-awake'); if (p.enabled) { check(gateway, 'gateway-disabled', 409); const result = await awake.enable(); store.update(value => { value.keepAwake = true }); return result } const result = awake.disable(); store.update(value => { value.keepAwake = false }); return result }],
    'gateway/enable': ['POST', p => enable(p)],
    'gateway/disable': ['POST', () => { direct.invalidate(); return changeGateway(async () => { store.update(value => { delete value.remoteConfig; delete value.directConfig; value.keepAwake = false }); push.close(); awake.disable(); relay?.close(); relay = undefined; if (gateway) await gateway.close(); gateway = undefined; return { enabled: false } }) }],
    ...Object.fromEntries(Object.entries(shared).map(([path, execute]) => [path, ['POST', p => {
      check(typeof p.clientId === 'string' && /^[a-zA-Z0-9_-]{1,96}$/.test(p.clientId), 'client-id-required')
      return execute(p, { deviceId: `desktop:${p.clientId}`, role: 'admin' })
    }]])),
  }
  ctx.effect(() => {
    const disposers = []
    try {
      disposers.push(ctx.webServer.register({ kind: 'prefix', path: `${BASE_PATH}/resource/`, async handler(req, res) {
        try {
          check(isLocalRequest(req, ctx.webServer.port) && ['GET', 'HEAD'].includes(req.method), 'forbidden', 403)
          await resources.serve(req.url.slice(`${BASE_PATH}/resource/`.length), 'desktop', req, res)
        } catch (error) { if (!res.headersSent) { res.writeHead(error.status ?? 500); res.end(error instanceof ProtocolError ? error.message : 'resource-unavailable') } else res.destroy() }
      } }))
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
      store.close().catch(() => {})
      throw error
    }
    return () => { disposed = true; direct.close(); resources.close(); push.close(); awake.disable(); devices.dispose(); admission.dispose(); relay?.close(); for (const dispose of disposers.reverse()) dispose(); return changeGateway(async () => { if (gateway) await gateway.close(); gateway = undefined; await commands.drain(); await store.close() }) }
  }, 'mobile-remote: local management routes')
  const retained = store.read()
  if (retained.remoteConfig) {
    try { await enable(retained.remoteConfig); if (retained.directConfig) direct.schedule(); if (retained.keepAwake) await awake.enable() }
    catch (error) { startupError = error.message; store.audit({ type: 'gateway-restore-failed' }) }
  }
}
