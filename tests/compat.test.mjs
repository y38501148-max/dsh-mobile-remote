import { test } from 'node:test'
import assert from 'node:assert/strict'
import { quotaView, PLUGIN_ROUTES } from '../src/compat/routes.js'
import { adaptModes, adaptTextFiles } from '../src/compat/patches.js'
test('quota adapter returns only declared display fields and no backend errors or credentials', () => {
  const source = { ok: false, error: 'secret token and database path', checkedAt: { token: 'secret' }, databasePath: '/private/database', channel: { id: 1, name: 'channel', token: 'secret' }, quotaError: 'secret', latest: { model_name: 'model', token_name: 'secret' } }
  const result = quotaView(source)
  assert.doesNotMatch(JSON.stringify(result), /secret|private|token/)
  assert.equal(result.channel.name, 'channel')
  assert.equal(PLUGIN_ROUTES.get('/api/plugin/repair/hot-reset').method, 'POST')
  assert.equal(PLUGIN_ROUTES.get('/super-injector/api/inject').role, 'admin')
})
test('companion source drift fails instead of silently claiming compatibility', () => {
  assert.throws(() => adaptModes('new incompatible source'), /source changed/)
  assert.throws(() => adaptTextFiles('new incompatible source'), /source changed/)
})

test('read-only onboarding exception cannot mutate another setting', async () => {
  const { authorizeRoute, validateRoutePayload } = await import('../src/gateway/policy.js')
  const route = authorizeRoute('/api/settings.mutate', 'POST', 'viewer')
  const payload = { ns: 'ui-onboarding', ops: [{ op: 'set', path: ['welcomeNoticeVersion'], value: '2026-08-13.1' }] }
  validateRoutePayload(route, { payload })
  for (const changed of [{ ...payload, ns: 'llm' }, { ...payload, ops: [...payload.ops, { op: 'set', path: ['secret'], value: 'x' }] }, { ...payload, ops: [{ ...payload.ops[0], path: ['other'] }] }]) assert.throws(() => validateRoutePayload(route, { payload: changed }), /not-authorized/)
})
