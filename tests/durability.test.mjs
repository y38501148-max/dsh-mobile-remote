import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { StateStore } from '../src/storage/store.js'
import { Devices } from '../src/auth/devices.js'
import { Drafts } from '../src/sync/drafts.js'
import { Commands } from '../src/sync/commands.js'

test('restart retains approved identity and drafts but never stores the bearer credential', () => {
  const directory = mkdtempSync(join(tmpdir(), 'remote-state-')), path = join(directory, 'state.json')
  try {
    const store = new StateStore(path), devices = new Devices({ store }), drafts = new Drafts({ store })
    const phone = devices.claim(devices.invite().code, 'test'); devices.approve(phone.deviceId, 'admin')
    drafts.write({ sessionId: 'test', expectedRevision: 0, text: 'draft after restart' })
    devices.dispose()
    const reopened = new StateStore(path), restored = new Devices({ store: reopened })
    assert.equal(restored.identify(phone.credential).role, 'admin')
    assert.equal(new Drafts({ store: reopened }).read('test').text, 'draft after restart')
    assert.equal(readFileSync(path, 'utf8').includes(phone.credential), false)
    assert.equal(statSync(path).mode & 0o077, 0)
    restored.revoke(phone.deviceId)
    assert.throws(() => new Devices({ store: new StateStore(path) }).authenticate(phone.credential), /unauthorized/)
  } finally { rmSync(directory, { recursive: true, force: true }) }
})
test('receipt lost in transit replays once; crash during dispatch remains unknown without reexecution', async () => {
  const store = new StateStore(), commands = new Commands(store, 'first')
  let calls = 0
  const response = { status: 200, body: '{"accepted":true}', headers: {} }
  const dispatch = async () => { calls++; return response }
  const a = await commands.execute('phone', 'stable', Buffer.from('payload'), dispatch)
  const b = await new Commands(store, 'next').execute('phone', 'stable', Buffer.from('payload'), dispatch)
  assert.deepEqual(a, b); assert.equal(calls, 1)
  await assert.rejects(commands.execute('phone', 'stable', Buffer.from('different'), dispatch), /command-id-reused/)
  await assert.rejects(commands.execute('phone', 'lost', Buffer.from('payload'), async () => { calls++; throw Error('simulated process interruption') }))
  const unresolved = await new Commands(store, 'restarted').execute('phone', 'lost', Buffer.from('payload'), dispatch)
  assert.equal(unresolved.status, 409); assert.match(unresolved.body, /outcome-unknown/); assert.equal(calls, 2)
})

test('a second Host cannot own the same state file; releasing ownership preserves data', { timeout: 20000 }, async () => {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-owner-')), path = join(directory, 'state.json')
  let first, next
  try {
    first = await StateStore.acquire(path)
    first.update(value => { value.audit.push({ type: 'retained' }) })
    await assert.rejects(StateStore.acquire(path), error => error.code === 'ELOCKED')
    await first.close(); first = null
    next = await StateStore.acquire(path)
    assert.equal(next.read().audit[0].type, 'retained')
  } finally { await first?.close(); await next?.close(); rmSync(directory, { recursive: true, force: true }) }
})
