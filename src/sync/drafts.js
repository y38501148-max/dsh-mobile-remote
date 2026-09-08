import { check } from '../auth/devices.js'

// CAS retains the submitted version on conflict. Clients must keep it until resolved.
export class Drafts {
  #values = new Map()
  constructor({ limit = 128 } = {}) { this.limit = limit }
  #key(sessionId) {
    check(typeof sessionId === 'string' && sessionId.length > 0 && sessionId.length <= 256, 'invalid-session')
    return sessionId
  }
  read(sessionId) {
    return structuredClone(this.#values.get(this.#key(sessionId)) ?? { revision: 0, text: '', attachments: [] })
  }
  write({ sessionId, expectedRevision, text, attachments = [] }) {
    this.#key(sessionId)
    check(Number.isSafeInteger(expectedRevision) && expectedRevision >= 0, 'invalid-revision')
    check(typeof text === 'string' && Buffer.byteLength(text) <= 65536, 'invalid-draft')
    // Upload references require an ownership adapter; preview accepts text only.
    check(Array.isArray(attachments) && attachments.length === 0, 'attachments-not-supported')
    const current = this.read(sessionId)
    if (current.revision !== expectedRevision) return { ok: false, error: 'revision-conflict', current, conflict: { text, attachments } }
    check(this.#values.has(sessionId) || this.#values.size < this.limit, 'draft-limit', 429)
    const value = { revision: current.revision + 1, text, attachments: [] }
    this.#values.set(sessionId, value)
    return { ok: true, draft: structuredClone(value) }
  }
  clear(sessionId, expectedRevision) { return this.write({ sessionId, expectedRevision, text: '' }) }
}
