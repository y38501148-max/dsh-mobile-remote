import { check } from '../auth/devices.js'
export class Follow {
  constructor({ now = Date.now } = {}) { this.now = now; this.state = { revision: 0, sessionId: null, panel: 'chat', controller: null, expiresAt: 0 } }
  read() { return structuredClone({ ...this.state, controller: this.state.expiresAt > this.now() ? this.state.controller : null }) }
  update({ deviceId, expectedRevision, sessionId, panel = 'chat', takeover = false }) {
    check(typeof deviceId === 'string' && deviceId.length <= 128 && deviceId.length > 0, 'invalid-device')
    check(sessionId === null || (typeof sessionId === 'string' && sessionId.length > 0 && sessionId.length <= 256), 'invalid-session')
    check(['chat', 'details', 'trajectory'].includes(panel), 'invalid-panel')
    const current = this.read()
    if (expectedRevision !== current.revision) return { ok: false, error: 'revision-conflict', current }
    if (current.controller && current.controller !== deviceId && !takeover) return { ok: false, error: 'lease-held', current }
    this.state = { revision: current.revision + 1, sessionId, panel, controller: deviceId, expiresAt: this.now() + 15000 }
    return { ok: true, state: this.read() }
  }
}
