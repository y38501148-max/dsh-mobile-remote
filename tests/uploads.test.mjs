import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { Uploads } from '../src/sync/uploads.js'
import { StateStore } from '../src/storage/store.js'
import { Drafts } from '../src/sync/drafts.js'
import { SharedImages } from '../src/client/images.js'
import { sharedOperations } from '../src/gateway/shared.js'
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1sAAAAASUVORK5CYII=', 'base64')
test('upload is bounded, owner-only while incomplete, session-bound after durable commit', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-upload-'))
  try {
    const path = join(directory, 'state.json'), store = new StateStore(path), uploads = new Uploads(store)
    const entry = uploads.begin({ sessionId: 's', name: 'image.png', type: 'image/png', size: png.length }, 'a')
    assert.throws(() => uploads.chunk({ id: entry.id, offset: 0, data: png.toString('base64') }, 'b'), /not-owned/)
    assert.throws(() => uploads.validate([entry.id], 's'), /not-ready/)
    uploads.chunk({ id: entry.id, offset: 0, data: png.toString('base64') }, 'a')
    const restarted = new Uploads(new StateStore(path))
    restarted.commit({ id: entry.id, sha256: createHash('sha256').update(png).digest('hex') }, 'a')
    assert.throws(() => restarted.read({ id: entry.id, sessionId: 'other' }, 'a'), /not-authorized/)
    assert.equal(restarted.read({ id: entry.id, sessionId: 's' }, 'b').data, png.toString('base64'))
    const drafts = new Drafts({ store: restarted.store, uploads: restarted })
    assert.equal(drafts.write({ sessionId: 's', expectedRevision: 0, text: '', attachments: [entry.id], deviceId: 'b' }).ok, true)
    assert.throws(() => drafts.write({ sessionId: 'other', expectedRevision: 0, text: '', attachments: [entry.id], deviceId: 'b' }), /wrong-session/)
  } finally { await rm(directory, { recursive: true, force: true }) }
})
test('two browser image adapters exchange original image bytes through shared upload references', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-image-client-'))
  try {
    const store = new StateStore(join(directory, 'state.json')), uploads = new Uploads(store), operations = sharedOperations({ uploads })
    const conversation = () => {
      const files = new Map()
      return { createDraftImages(inputs) { return inputs.map(file => { const value = { id: crypto.randomUUID(), file }; files.set(value.id, value); return value }) }, draftImages(ids) { return ids.map(id => files.get(id)).filter(Boolean) } }
    }
    const a = conversation(), b = conversation()
    const api = deviceId => ({ call: async (method, payload) => operations[method](payload, { deviceId, role: 'operator' }) })
    const sender = new SharedImages(api('a'), 's', a, () => {}), receiver = new SharedImages(api('b'), 's', b, () => {})
    const local = a.createDraftImages([new File([png], 'test.png', { type: 'image/png' })])[0]
    const shared = await sender.prepare({ text: 'image draft', attachments: sender.snapshot([local.id]) })
    await receiver.load(shared)
    const restored = b.draftImages([receiver.native.get(shared.attachments[0])])[0]
    assert.deepEqual(Buffer.from(await restored.file.arrayBuffer()), png)
    assert.equal(restored.file.name, 'test.png')
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('native text-only reload restores shared image instead of publishing attachment deletion', async () => {
  const { DraftClient } = await import('../src/client/sync-client.js')
  let state = { draft: 'restored native text', imageIds: [], occurrences: [], phase: 'plain', draftRev: 1 }
  const subscribers = new Set(), writes = []
  const emit = () => { for (const fn of subscribers) fn() }
  const input = { state: { getSnapshot: () => state, subscribe: fn => { subscribers.add(fn); return () => subscribers.delete(fn) } }, setDraft(text) { state = { ...state, draft: text }; emit() } }
  const remote = { revision: 1, text: state.draft, attachments: ['shared-image'], occurrences: [], conflicts: [] }
  const images = { snapshot: ids => ids, load: async () => {}, apply(value) { state = { ...state, imageIds: value.attachments }; emit() } }
  const api = { async call(method, payload) { if (method === 'draft/read') return remote; writes.push(payload); throw Error('unexpected write') } }
  const client = new DraftClient({ api, sessionId: 's', input, images })
  try { await client.initial; assert.deepEqual(state.imageIds, ['shared-image']); assert.equal(client.state.status, 'synced'); assert.equal(writes.length, 0) }
  finally { client.dispose() }
})
