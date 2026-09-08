import webpush from 'web-push'
import { randomUUID } from 'node:crypto'
import { check } from '../auth/devices.js'

export function validateSubscription(value) {
  check(value && typeof value.endpoint === 'string' && value.endpoint.length <= 4096, 'invalid-push-subscription')
  let url
  try { url = new URL(value.endpoint) } catch { check(false, 'invalid-push-endpoint') }
  const allowed = ['fcm.googleapis.com', 'updates.push.services.mozilla.com'].includes(url.hostname) || /^[a-z0-9-]+\.push\.apple\.com$/.test(url.hostname)
  check(url.protocol === 'https:' && allowed && !url.username && !url.password && !url.port && !url.hash, 'push-provider-not-allowed', 403)
  for (const [key, length] of [['auth', 16], ['p256dh', 65]]) {
    check(typeof value.keys?.[key] === 'string' && /^[A-Za-z0-9_-]+$/.test(value.keys[key]) && Buffer.from(value.keys[key], 'base64url').length === length, 'invalid-push-key')
  }
  return { endpoint: url.href, keys: { auth: value.keys.auth, p256dh: value.keys.p256dh } }
}

export class Push {
  constructor(store, devices, { send = webpush.sendNotification.bind(webpush) } = {}) { this.store = store; this.devices = devices; this.send = send; this.inflight = new Map(); this.last = new Map(); this.pending = new Map(); this.active = false }
  key() {
    check(this.store.path, 'persistent-state-required', 409)
    if (!this.store.read().pushKeys) this.store.update(state => { state.pushKeys = webpush.generateVAPIDKeys() })
    return { publicKey: this.store.read().pushKeys.publicKey }
  }
  status(deviceId) { return { enabled: !!this.store.read().pushSubscriptions?.[deviceId], active: this.active } }
  subscribe(deviceId, subscription) {
    check(this.devices.list().some(d => d.deviceId === deviceId && d.state === 'approved'), 'paired-device-required', 403)
    const value = validateSubscription(subscription); this.key()
    this.store.update(state => { state.pushSubscriptions ??= {}; state.pushSubscriptions[deviceId] = value })
    return this.status(deviceId)
  }
  remove(deviceId) { this.store.update(state => { if (state.pushSubscriptions) delete state.pushSubscriptions[deviceId] }); this.pending.delete(deviceId); return { enabled: false } }
  async deliver(deviceId, kind) {
    if (!this.active) return
    const subscription = this.store.read().pushSubscriptions?.[deviceId]
    if (!subscription || !this.devices.list().some(d => d.deviceId === deviceId)) return
    const keys = this.store.read().pushKeys
    try {
      await this.send(subscription, JSON.stringify({ kind }), { vapidDetails: { subject: 'https://github.com/y38501148-max/dsh-mobile-remote', ...keys }, TTL: 3600, urgency: kind === 'attention' ? 'high' : 'normal', timeout: 10000, topic: 'dsh-remote-task' })
      this.store.audit({ type: 'push-delivered', deviceId, kind })
    } catch (error) {
      if ([404, 410].includes(error.statusCode)) this.remove(deviceId)
      this.store.audit({ type: 'push-failed', deviceId, code: error.statusCode ?? 'network-error' })
    }
  }
  notify(kind) {
    if (!this.active) return
    for (const deviceId of Object.keys(this.store.read().pushSubscriptions ?? {})) {
      if (this.pending.get(deviceId) !== 'attention') this.pending.set(deviceId, kind)
      if (!this.inflight.has(deviceId)) {
        const timer = setTimeout(async () => {
          const next = this.pending.get(deviceId); this.pending.delete(deviceId)
          await this.deliver(deviceId, next); this.last.set(deviceId, Date.now()); this.inflight.delete(deviceId)
          if (this.pending.has(deviceId)) this.notifyDevice(deviceId, this.pending.get(deviceId))
        }, Math.max(0, 5000 - (Date.now() - (this.last.get(deviceId) ?? 0))))
        timer.unref(); this.inflight.set(deviceId, timer)
      }
    }
  }
  notifyDevice(deviceId, kind) {
    if (!this.active || this.inflight.has(deviceId)) return
    const timer = setTimeout(async () => {
      const next = this.pending.get(deviceId) ?? kind; this.pending.delete(deviceId)
      await this.deliver(deviceId, next); this.last.set(deviceId, Date.now()); this.inflight.delete(deviceId)
      if (this.pending.has(deviceId)) this.notifyDevice(deviceId, this.pending.get(deviceId))
    }, 5000)
    timer.unref(); this.inflight.set(deviceId, timer)
  }
  start(api) {
    if (this.active || !api.events?.mux) return
    this.active = true; this.abort = new AbortController()
    const run = async () => {
      try {
        for await (const frame of api.events.mux({ rpcId: randomUUID(), payload: {} }, this.abort.signal)) {
          const p = frame.payload
          if (['approval/requested', 'question/requested'].includes(p.type)) this.notify('attention')
          else if (p.type === 'session/event' && p.event.type === 'turn/end') this.notify('complete')
        }
      } catch { if (!this.abort.signal.aborted) this.store.audit({ type: 'push-event-stream-failed' }) }
    }
    this.consumer = run()
  }
  close() { this.active = false; this.abort?.abort(); for (const timer of this.inflight.values()) clearTimeout(timer); this.inflight.clear(); this.pending.clear() }
}
