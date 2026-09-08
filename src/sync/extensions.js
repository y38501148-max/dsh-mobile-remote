import { check } from '../auth/devices.js'
export class Extensions {
  constructor(store) { this.store = store }
  read() { return this.store.read().extensionState ?? { revision: 0, mode: 'work' } }
  mode({ mode, expectedRevision }, deviceId) {
    check(['work', 'chat'].includes(mode), 'invalid-mode')
    const current = this.read()
    if (current.revision !== expectedRevision) return { ok: false, error: 'revision-conflict', current }
    const value = { revision: current.revision + 1, mode, deviceId }
    this.store.update(state => { state.extensionState = value })
    return { ok: true, state: value }
  }
}
