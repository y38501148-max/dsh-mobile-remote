import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SharedFiles } from '../src/client/files.js'
import { Uploads } from '../src/sync/uploads.js'
import { StateStore } from '../src/storage/store.js'
import { sharedOperations } from '../src/gateway/shared.js'

test('text files survive chunking, cross-device restore and adding a newer file during upload', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-files-'))
  try {
    const operations = sharedOperations({ uploads: new Uploads(new StateStore(join(directory, 'state.json'))) })
    const disk = new Map(), vault = { async put(id, file) { disk.set(id, file) }, async get(id) { return disk.get(id) }, async delete(id) { disk.delete(id) } }
    let release, entered
    const waiting = new Promise(resolve => entered = resolve), gate = new Promise(resolve => release = resolve)
    let blocked = false
    const api = deviceId => ({ async call(method, payload) {
      if (deviceId === 'a' && method === 'upload/chunk' && !blocked) { blocked = true; entered(); await gate }
      return operations[method](payload, { deviceId, role: 'operator' })
    } })
    const a = new SharedFiles(api('a'), 's', assert.fail, vault), b = new SharedFiles(api('b'), 's', assert.fail, vault)
    const original = { id: 'old', name: '说明.md', text: '中文与UTF-8\n'.repeat(7000) }
    a.replace([original]); const snapshot = { files: a.snapshot() }
    const uploading = a.prepare(snapshot); await waiting
    const newer = { id: 'new', name: 'new.txt', text: '发送期间新添加的文件' }
    a.replace([original, newer]); release()
    const shared = await uploading
    await b.load(shared); b.apply(shared)
    assert.equal(b.entries()[0].text, original.text)
    assert.equal(b.entries()[0].name, original.name)
    assert.match(b.serialize(shared.files), /中文与UTF-8/)
    a.removeSubmitted(snapshot.files)
    assert.deepEqual(a.entries(), [newer])
    const offline = new SharedFiles(api('a'), 's', assert.fail, vault)
    const local = { files: a.snapshot() }; await offline.load(local); offline.apply(local)
    assert.deepEqual(offline.entries(), [newer])
  } finally { await rm(directory, { recursive: true, force: true }) }
})
test('lost chunk receipt and browser reload resume the same durable upload at the acknowledged offset', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-files-resume-'))
  try {
    const store = new StateStore(join(directory, 'state.json')), operations = sharedOperations({ uploads: new Uploads(store) })
    const disk = new Map(), vault = { async put(id, file) { disk.set(id, file) }, async get(id) { return disk.get(id) }, async delete(id) { disk.delete(id) } }
    let fail = true; const offsets = []
    const api = { async call(method, payload) {
      const result = operations[method](payload, { deviceId: 'a', role: 'operator' })
      if (method === 'upload/chunk') { offsets.push(payload.offset); if (fail) { fail = false; throw Error('network response lost') } }
      return result
    } }
    const first = new SharedFiles(api, 's', assert.fail, vault)
    first.replace([{ id: 'retained-local-id', name: 'large.txt', text: 'x'.repeat(70000) }])
    const snapshot = { files: first.snapshot() }
    await assert.rejects(first.prepare(snapshot), /network response lost/)
    const second = new SharedFiles(api, 's', assert.fail, vault)
    await second.load(snapshot); second.apply(snapshot)
    const result = await second.prepare(snapshot)
    assert.equal(result.files.length, 1)
    assert.deepEqual(offsets, [0, 32768, 65536])
    assert.equal(Object.keys(store.read().uploads).length, 1)
  } finally { await rm(directory, { recursive: true, force: true }) }
})
