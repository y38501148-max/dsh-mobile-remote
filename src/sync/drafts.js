import { randomUUID } from 'node:crypto'
import { check } from '../auth/devices.js'

export class Drafts {
  #values = new Map()
  #leases = new Map()
  constructor({ limit = 128, store, now = Date.now } = {}) {
    this.limit = limit; this.store = store; this.now = now
    for (const [id, value] of Object.entries(store?.read().drafts ?? {})) this.#values.set(id, value)
  }
  #key(sessionId) {
    check(typeof sessionId === 'string' && sessionId.length > 0 && sessionId.length <= 256 && !['__proto__', 'constructor', 'prototype'].includes(sessionId), 'invalid-session')
    return sessionId
  }
  #save(sessionId, value) {
    this.store?.update(state => { state.drafts[sessionId] = value })
    this.#values.set(sessionId, value)
  }
  read(sessionId) {
    const value = structuredClone(this.#values.get(this.#key(sessionId)) ?? { revision: 0, text: '', attachments: [], conflicts: [] })
    const lease = this.#leases.get(sessionId)
    value.lease = lease?.expiresAt > this.now() ? { ...lease } : null
    return value
  }
  acquire(sessionId, deviceId, takeover = false) {
    this.#key(sessionId)
    check(typeof deviceId === 'string' && deviceId.length > 0 && deviceId.length <= 128, 'invalid-device')
    const current = this.read(sessionId), lease = current.lease
    if (lease && lease.deviceId !== deviceId && !takeover) return { ok: false, error: 'lease-held', current }
    check(this.#leases.has(sessionId) || this.#leases.size < this.limit, 'draft-limit', 429)
    this.#leases.set(sessionId, { deviceId, expiresAt: this.now() + 15000 })
    return { ok: true, draft: this.read(sessionId) }
  }
  write({ sessionId, expectedRevision, text, attachments = [], occurrences = [], deviceId, clientMutationId }) {
    this.#key(sessionId)
    check(Number.isSafeInteger(expectedRevision) && expectedRevision >= 0, 'invalid-revision')
    check(typeof text === 'string' && Buffer.byteLength(text) <= 65536, 'invalid-draft')
    check(Array.isArray(attachments) && attachments.length === 0, 'attachments-not-supported')
    check(Array.isArray(occurrences) && occurrences.length <= 128, 'invalid-references')
    const offsets = new Set()
    for (const ref of occurrences) {
      check(ref && Number.isSafeInteger(ref.offset) && text[ref.offset] === '\uFFFC' && !offsets.has(ref.offset), 'invalid-reference-offset')
      for (const key of ['source', 'ref', 'label', 'clipboardText']) check(typeof ref[key] === 'string' && ref[key].length <= 2048, 'invalid-reference')
      offsets.add(ref.offset)
    }
    check(!clientMutationId || (typeof clientMutationId === 'string' && clientMutationId.length <= 128), 'invalid-mutation-id')
    check(this.#values.has(sessionId) || this.#values.size < this.limit, 'draft-limit', 429)
    const current = this.read(sessionId)
    if (clientMutationId && current.clientMutationId === clientMutationId && current.deviceId === deviceId) {
      check(current.text === text && JSON.stringify(current.occurrences ?? []) === JSON.stringify(occurrences), 'mutation-id-reused', 409)
      return { ok: true, draft: current }
    }
    const held = current.lease && deviceId && current.lease.deviceId !== deviceId
    if (current.revision !== expectedRevision || held) {
      const conflict = { id: randomUUID(), text, attachments, occurrences, deviceId, at: this.now() }
      if (clientMutationId) {
        const existing = current.conflicts?.find(c => c.clientMutationId === clientMutationId && c.deviceId === deviceId)
        if (existing) return { ok: false, error: held ? 'lease-held' : 'revision-conflict', current, conflict: existing }
        conflict.clientMutationId = clientMutationId
      }
      // Keep every conflict until explicit resolution. At capacity refuse to
      // accept more, so the browser retains its unsynchronized copy.
      check((current.conflicts ?? []).length < 32, 'conflict-storage-full', 507)
      const { lease, ...durable } = current
      durable.conflicts = [...(durable.conflicts ?? []), conflict]
      this.#save(sessionId, durable)
      return { ok: false, error: held ? 'lease-held' : 'revision-conflict', current: this.read(sessionId), conflict }
    }
    check(this.#values.has(sessionId) || this.#values.size < this.limit, 'draft-limit', 429)
    const value = { revision: current.revision + 1, text, attachments: [], occurrences, conflicts: current.conflicts ?? [], deviceId, clientMutationId }
    this.#save(sessionId, value)
    if (deviceId) this.#leases.set(sessionId, { deviceId, expiresAt: this.now() + 15000 })
    return { ok: true, draft: this.read(sessionId) }
  }
  clear(sessionId, expectedRevision, deviceId) {
    // Clearing a submitted draft doesn't acquire or displace an editor lease.
    const current = this.read(sessionId)
    if (current.revision !== expectedRevision) return { ok: false, error: 'revision-conflict', current }
    const { lease, ...value } = current
    value.text = ''; value.attachments = []; value.occurrences = []; value.revision++; delete value.clientMutationId
    this.#save(sessionId, value)
    return { ok: true, draft: this.read(sessionId) }
  }
  preserve({ sessionId, text, occurrences = [], deviceId, clientMutationId }) {
    // A deliberately mismatched positive revision takes the same validated,
    // bounded conflict path without replacing the shared draft.
    return this.write({ sessionId, text, occurrences, deviceId, clientMutationId, expectedRevision: this.read(sessionId).revision + 1 })
  }
  resolve(sessionId, conflictId) {
    const current = this.read(sessionId)
    check(current.conflicts?.some(c => c.id === conflictId), 'unknown-conflict', 404)
    const { lease, ...value } = current
    value.conflicts = value.conflicts.filter(c => c.id !== conflictId)
    this.#save(sessionId, value)
    return { ok: true, draft: this.read(sessionId) }
  }
}
