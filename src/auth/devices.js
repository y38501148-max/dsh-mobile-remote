import { createHash, randomBytes, randomUUID } from 'node:crypto'
const digest = value => createHash('sha256').update(value).digest('hex')
const secret = () => randomBytes(32).toString('base64url')
export class ProtocolError extends Error {
  constructor(code, status = 400) { super(code); this.status = status }
}
export function check(condition, code, status) {
  if (!condition) throw new ProtocolError(code, status)
}

// Process-scoped preview: restarting the plugin invalidates every credential.
export class Devices {
  #invitations = new Map()
  #devices = new Map()
  #sessions = new Map()
  constructor({ now = Date.now, limit = 32, store } = {}) {
    this.now = now; this.limit = limit; this.store = store
    for (const device of store?.read().devices ?? []) this.#devices.set(device.deviceId, device)
    this.#prune()
  }
  #save() {
    try { this.store?.update(value => { value.devices = structuredClone([...this.#devices.values()]) }) }
    catch (error) {
      this.#devices = new Map(this.store.read().devices.map(device => [device.deviceId, device]))
      throw error
    }
  }
  #prune() {
    for (const [key, invite] of this.#invitations) if (invite.expiresAt <= this.now()) this.#invitations.delete(key)
    for (const [id, device] of this.#devices) if (device.state === 'pending' && device.expiresAt <= this.now()) this.#devices.delete(id)
  }
  invite() {
    this.#prune()
    check(this.#invitations.size < this.limit, 'invitation-limit', 429)
    const code = secret(), expiresAt = this.now() + 120_000
    this.#invitations.set(digest(code), { expiresAt })
    return { code, expiresAt }
  }
  claim(code, name) {
    this.#prune()
    check(typeof code === 'string' && typeof name === 'string' && name.trim().length > 0 && name.length <= 80, 'invalid-claim')
    const key = digest(code), invite = this.#invitations.get(key)
    check(invite, 'invalid-invitation', 403)
    check(this.#devices.size < this.limit, 'device-limit', 429)
    this.#invitations.delete(key)
    const deviceId = randomUUID(), credential = secret()
    this.#devices.set(deviceId, { deviceId, name: name.trim(), state: 'pending', expiresAt: invite.expiresAt, hash: digest(credential) })
    this.#save()
    return { deviceId, credential, state: 'pending' }
  }
  approve(deviceId, role = 'operator') {
    check(['viewer', 'operator', 'admin'].includes(role), 'invalid-role')
    this.#prune()
    const device = this.#devices.get(deviceId)
    check(device?.state === 'pending', 'not-pending', 409)
    device.state = 'approved'; device.role = role
    this.#save()
    return { deviceId, state: device.state }
  }
  identify(credential, allowPending = false) {
    this.#prune()
    check(typeof credential === 'string' && credential.length <= 128, 'unauthorized', 401)
    const hash = digest(credential)
    const device = [...this.#devices.values()].find(d => d.hash === hash && (allowPending || d.state === 'approved'))
    check(device, 'unauthorized', 401)
    const { deviceId, name, state, role } = device
    return { deviceId, name, state, role }
  }
  authenticate(credential) { return this.identify(credential).deviceId }
  attach(credential, close) {
    const id = this.authenticate(credential)
    const callbacks = this.#sessions.get(id) ?? new Set()
    callbacks.add(close); this.#sessions.set(id, callbacks)
    return () => { callbacks.delete(close); if (!callbacks.size) this.#sessions.delete(id) }
  }
  revoke(deviceId) {
    check(this.#devices.has(deviceId), 'unknown-device', 404)
    this.#devices.delete(deviceId)
    this.#save()
    const callbacks = this.#sessions.get(deviceId) ?? []
    this.#sessions.delete(deviceId)
    for (const close of callbacks) { try { close() } catch {} }
    return { deviceId, state: 'revoked' }
  }
  list() {
    this.#prune()
    return [...this.#devices.values()].map(({ deviceId, name, state, role }) => ({ deviceId, name, state, role }))
  }
  dispose() {
    for (const callbacks of this.#sessions.values()) for (const close of callbacks) { try { close() } catch {} }
    this.#sessions.clear(); this.#devices.clear(); this.#invitations.clear()
  }
}
