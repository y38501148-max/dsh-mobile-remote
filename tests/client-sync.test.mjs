import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DraftClient } from '../src/client/sync-client.js'
import { Drafts } from '../src/sync/drafts.js'
import { sharedOperations } from '../src/gateway/shared.js'
function input() {
  let current = { draft: '', draftRev: 0, occurrences: [], phase: 'plain', imageIds: [] }
  const listeners = new Set()
  return {
    state: { getSnapshot: () => structuredClone(current), subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn) } },
    setDraft(text) { current.draft = text; current.draftRev++; current.occurrences = []; for (const fn of listeners) fn() },
    insertReference(reference, span) { current.occurrences.push({ ...reference, offset: span.start }); return true },
  }
}
function client(drafts, deviceId) {
  const facade = input(), recovery = new Map()
  const operations = sharedOperations({ drafts })
  const api = { call: async (method, args) => operations[method](args, { deviceId, role: 'admin' }) }
  const bridge = new DraftClient({ api, sessionId: 's', input: facade, storage: { getItem: k => recovery.get(k), setItem: (k, v) => recovery.set(k, v), removeItem: k => recovery.delete(k) } })
  return { bridge, facade, recovery }
}
test('native optimistic input clear never publishes empty before Host acceptance', async () => {
  const drafts = new Drafts(), phone = client(drafts, 'phone'), desktop = client(drafts, 'desktop')
  try {
    await Promise.all([phone.bridge.initial, desktop.bridge.initial])
    phone.facade.setDraft('preserve this prompt'); await phone.bridge.flush()
    await desktop.bridge.refresh(); assert.equal(desktop.facade.state.getSnapshot().draft, 'preserve this prompt')
    desktop.facade.setDraft('') // native commitSend before sendSession
    desktop.bridge.beginPrompt(); const revision = await desktop.bridge.beforePrompt()
    assert.equal(drafts.read('s').text, 'preserve this prompt')
    assert.equal(revision, 1)
    await desktop.bridge.afterPrompt(revision, true)
    await phone.bridge.refresh()
    assert.equal(drafts.read('s').text, ''); assert.equal(phone.facade.state.getSnapshot().draft, '')
  } finally { phone.bridge.dispose(); desktop.bridge.dispose() }
})
test('typing during admission survives the submitted-version clear', async () => {
  const drafts = new Drafts(), phone = client(drafts, 'phone')
  try {
    await phone.bridge.initial; phone.facade.setDraft('first')
    phone.facade.setDraft(''); phone.bridge.beginPrompt()
    const revision = await phone.bridge.beforePrompt()
    phone.facade.setDraft('second, not yet sent')
    await phone.bridge.afterPrompt(revision, true); await phone.bridge.pending
    assert.equal(drafts.read('s').text, 'second, not yet sent')
    assert.equal(phone.facade.state.getSnapshot().draft, 'second, not yet sent')
  } finally { phone.bridge.dispose() }
})
test('a competing editor causes visible recoverable conflict, not a silent overwrite', async () => {
  const drafts = new Drafts(), a = client(drafts, 'a'), b = client(drafts, 'b')
  try {
    await Promise.all([a.bridge.initial, b.bridge.initial])
    a.facade.setDraft('A'); await a.bridge.flush()
    b.facade.setDraft('B'); await assert.rejects(b.bridge.flush(), /另一设备|冲突/)
    b.bridge.notice('network report')
    assert.equal(b.bridge.state.status, 'conflict')
    assert.equal(b.facade.state.getSnapshot().draft, 'B')
    assert.equal(drafts.read('s').text, 'A')
    assert.equal(drafts.read('s').conflicts[0].text, 'B')
    await b.bridge.flush(true)
    assert.equal(drafts.read('s').text, 'B')
  } finally { a.bridge.dispose(); b.bridge.dispose() }
})
