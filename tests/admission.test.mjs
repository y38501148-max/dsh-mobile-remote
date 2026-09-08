import { test } from 'node:test'
import assert from 'node:assert/strict'
import { StateStore } from '../src/storage/store.js'
import { Commands } from '../src/sync/commands.js'
import { installAdmission } from '../src/sync/admission.js'

const request = { type: 'client-request', rpcId: 'stable-prompt', method: 'session.prompt', payload: { sessionId: 'session-test', content: [{ type: 'text', text: 'keep once' }], mode: 'queue' } }
const accepted = { rpcId: request.rpcId, result: { ok: true, value: { accepted: true } } }
test('admission flush failure reconciles logged inbox without admitting twice', async () => {
  const store = new StateStore()
  let calls = 0, flushes = 0, fail = true
  const api = { async prompt() { calls++; return accepted }, async history() { return { result: { ok: true, value: { hasMore: false, events: [{ event: { type: 'agent/inbox/spliced', seq: 4, data: { inserted: [{ source: { rpcId: request.rpcId } }] } } }] } } } } }
  const ctx = { apiProxy: { sessions: api }, get: () => ({ get: () => ({}), async flush() { flushes++; if (fail) throw Error('disk failure') } }) }
  const first = installAdmission(ctx, new Commands(store, 'before-crash'))
  await assert.rejects(api.prompt(request), /disk failure/)
  first.dispose(); fail = false
  const restored = installAdmission(ctx, new Commands(store, 'after-crash'))
  assert.deepEqual(await api.prompt(request), accepted)
  assert.equal(calls, 1); assert.equal(flushes, 2)
  assert.deepEqual(await api.prompt(request), accepted)
  assert.equal(calls, 1)
  restored.dispose()
})
test('missing native evidence stays unknown and never invokes admission', async () => {
  const store = new StateStore(), ledger = new Commands(store, 'old')
  await assert.rejects(ledger.execute('native-admission', request.rpcId, JSON.stringify(request), async () => { throw Error('crash') }))
  let calls = 0
  const ctx = { apiProxy: { sessions: { async prompt() { calls++; return accepted }, async history() { return { result: { ok: true, value: { hasMore: false, events: [] } } } } } }, get: () => undefined }
  const hook = installAdmission(ctx, new Commands(store, 'new'))
  const result = await ctx.apiProxy.sessions.prompt(request)
  assert.equal(result.result.ok, false); assert.equal(result.result.error.code, 'outcome-unknown'); assert.equal(calls, 0)
  hook.dispose()
})
