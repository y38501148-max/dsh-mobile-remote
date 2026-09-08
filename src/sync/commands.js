import { createHash } from 'node:crypto'
import { check } from '../auth/devices.js'

// Write the inbox record BEFORE dispatch. A crash after dispatch leaves an
// explicit unknown outcome, never a replay. Native admission reconciliation
// can later promote that record using source.rpcId and the native history.
export class Commands {
  #pending = new Map()
  constructor(store, epoch) { this.store = store; this.epoch = epoch }
  async execute(deviceId, commandId, bytes, dispatch, reconcile) {
    check(typeof commandId === 'string' && commandId.length > 0 && commandId.length <= 128, 'invalid-command-id')
    const key = createHash('sha256').update(`${deviceId}\0${commandId}`).digest('hex')
    const hash = createHash('sha256').update(bytes).digest('hex')
    const prior = this.store.read().commands[key]
    if (prior) {
      check(prior.hash === hash, 'command-id-reused', 409)
      if (prior.state === 'complete') return prior.response
      if (this.#pending.has(key)) return this.#pending.get(key)
      if (reconcile) {
        const recovered = await reconcile()
        if (recovered) {
          this.store.update(value => { value.commands[key].state = 'complete'; value.commands[key].response = recovered })
          return recovered
        }
      }
      return { status: 409, body: JSON.stringify({ error: 'outcome-unknown', commandId, hostEpoch: this.epoch }), headers: { 'content-type': 'application/json' } }
    }
    // No silent expiry: forgetting a receipt could re-execute an old command.
    check(Object.keys(this.store.read().commands).length < 10000, 'command-ledger-full', 507)
    this.store.update(value => { value.commands[key] = { deviceId, commandId, hash, epoch: this.epoch, state: 'pending', at: Date.now() } })
    const pending = (async () => {
      try {
        const response = await dispatch()
        check(Buffer.byteLength(response.body) < 2 * 1024 * 1024, 'receipt-too-large', 502)
        this.store.update(value => { value.commands[key].state = 'complete'; value.commands[key].response = response })
        return response
      } finally { this.#pending.delete(key) }
    })()
    this.#pending.set(key, pending)
    return pending
  }
  list(deviceId) {
    return Object.values(this.store.read().commands).filter(c => c.deviceId === deviceId).map(({ commandId, state, epoch, at }) => ({ commandId, state: state === 'pending' && epoch !== this.epoch ? 'outcome-unknown' : state, epoch, at }))
  }
}
