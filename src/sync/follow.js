import { check } from '../auth/devices.js'
export class Follow {
  constructor({ now = Date.now } = {}) { this.now = now; this.state = { revision: 0, sessionId: null, panel: 'chat', controller: null, expiresAt: 0 } }
  read() { return structuredClone({ ...this.state, controller: this.state.expiresAt > this.now() ? this.state.controller : null }) }
  update({ deviceId, expectedRevision, sessionId, panel = 'chat', selection = null, reading = null, takeover = false }) {
    check(typeof deviceId === 'string' && deviceId.length <= 128 && deviceId.length > 0, 'invalid-device')
    check(sessionId === null || (typeof sessionId === 'string' && sessionId.length > 0 && sessionId.length <= 256), 'invalid-session')
    check(['chat', 'details', 'trajectory'].includes(panel), 'invalid-panel')
    if (selection !== null) {
      check(selection && Number.isSafeInteger(selection.turnSeq) && selection.turnSeq >= 0, 'invalid-selection')
      check(selection.stepSeq === undefined || (Number.isSafeInteger(selection.stepSeq) && selection.stepSeq >= 0), 'invalid-selection')
      for (const key of ['callId', 'toolName']) check(selection[key] === undefined || (typeof selection[key] === 'string' && selection[key].length <= 256), 'invalid-selection')
      selection = { turnSeq: selection.turnSeq, ...selection.stepSeq === undefined ? {} : { stepSeq: selection.stepSeq }, ...selection.callId === undefined ? {} : { callId: selection.callId }, ...selection.toolName === undefined ? {} : { toolName: selection.toolName } }
    }
    if (reading !== null) {
      check(reading && (reading.anchor === null || (typeof reading.anchor === 'string' && reading.anchor.length <= 256)), 'invalid-reading')
      check(Number.isFinite(reading.offset) && Math.abs(reading.offset) <= 1e7 && Number.isFinite(reading.ratio) && reading.ratio >= 0 && reading.ratio <= 1, 'invalid-reading')
      check(Array.isArray(reading.expanded) && reading.expanded.length <= 128, 'invalid-reading')
      reading = { anchor: reading.anchor, offset: reading.offset, ratio: reading.ratio, expanded: reading.expanded.map(value => {
        check(typeof value.anchor === 'string' && value.anchor.length <= 256 && Number.isSafeInteger(value.index) && value.index >= 0 && value.index < 128 && typeof value.open === 'boolean', 'invalid-reading')
        return { anchor: value.anchor, index: value.index, open: value.open }
      }) }
    }
    const current = this.read()
    if (expectedRevision !== current.revision) return { ok: false, error: 'revision-conflict', current }
    if (current.controller && current.controller !== deviceId && !takeover) return { ok: false, error: 'lease-held', current }
    this.state = { revision: current.revision + 1, sessionId, panel, selection, reading, controller: deviceId, expiresAt: this.now() + 15000 }
    return { ok: true, state: this.read() }
  }
}
