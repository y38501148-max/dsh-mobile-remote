import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import webpush from 'web-push'
import { StateStore } from '../src/storage/store.js'
import { Push, validateSubscription } from '../src/background/push.js'
const subscription = { endpoint: 'https://fcm.googleapis.com/wp/synthetic', keys: { auth: Buffer.alloc(16).toString('base64url'), p256dh: webpush.generateVAPIDKeys().publicKey } }
test('push endpoints cannot target local or arbitrary servers', () => {
  assert.equal(validateSubscription(subscription).endpoint, subscription.endpoint)
  for (const endpoint of ['https://localhost/x', 'https://127.0.0.1/x', 'http://fcm.googleapis.com/x', 'https://fcm.googleapis.com.evil.test/x', 'https://fcm.googleapis.com:444/x', 'https://evil@fcm.googleapis.com/x']) assert.throws(() => validateSubscription({ ...subscription, endpoint }), /not-allowed/)
})
test('push retains only subscription, sends generic payload and stops after device revocation', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-push-'))
  try {
    let authorized = true
    const sent = [], store = new StateStore(join(directory, 'state'))
    const push = new Push(store, { list: () => authorized ? [{ deviceId: 'phone', state: 'approved' }] : [] }, { send: async (...args) => sent.push(args) })
    push.subscribe('phone', subscription); push.active = true
    await push.deliver('phone', 'attention')
    assert.equal(sent.length, 1); assert.deepEqual(JSON.parse(sent[0][1]), { kind: 'attention' })
    const publicKey = push.key().publicKey
    assert.equal(new Push(new StateStore(store.path), { list: () => [] }).key().publicKey, publicKey)
    authorized = false; await push.deliver('phone', 'complete'); assert.equal(sent.length, 1)
    push.close()
  } finally { await rm(directory, { recursive: true, force: true }) }
})
