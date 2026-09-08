import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Devices } from '../src/auth/devices.js'
import { Drafts } from '../src/sync/drafts.js'

test('pairing is single-use, requires desktop approval, and revocation closes all channels', () => {
  const devices = new Devices()
  const invite = devices.invite(), phone = devices.claim(invite.code, 'phone')
  assert.throws(() => devices.claim(invite.code, 'again'), /invalid-invitation/)
  assert.throws(() => devices.authenticate(phone.credential), /unauthorized/)
  devices.approve(phone.deviceId)
  assert.equal(devices.authenticate(phone.credential), phone.deviceId)
  let closed = 0
  devices.attach(phone.credential, () => { closed++; throw Error('broken channel') })
  devices.attach(phone.credential, () => { closed++ })
  assert.equal(JSON.stringify(devices.list()).includes(phone.credential), false)
  devices.revoke(phone.deviceId)
  assert.equal(closed, 2)
  assert.throws(() => devices.authenticate(phone.credential), /unauthorized/)
})
test('expired invitations and pending approvals cannot be used; resource caps apply', () => {
  let now = 0
  const devices = new Devices({ now: () => now, limit: 1 })
  const invite = devices.invite()
  assert.throws(() => devices.invite(), /invitation-limit/)
  const phone = devices.claim(invite.code, 'phone')
  now = 120001
  assert.throws(() => devices.approve(phone.deviceId), /not-pending/)
  assert.throws(() => devices.claim(invite.code, 'expired'), /invalid-invitation/)
  const next = devices.claim(devices.invite().code, 'next')
  devices.approve(next.deviceId)
  devices.dispose()
  assert.throws(() => devices.authenticate(next.credential), /unauthorized/)
})
test('concurrent drafts preserve losing text and clearing an old sent version keeps newer input', () => {
  const drafts = new Drafts()
  assert.equal(drafts.write({ sessionId: 's', expectedRevision: 0, text: 'desktop' }).ok, true)
  const conflict = drafts.write({ sessionId: 's', expectedRevision: 0, text: 'phone' })
  assert.equal(conflict.current.text, 'desktop')
  assert.equal(conflict.conflict.text, 'phone')
  drafts.write({ sessionId: 's', expectedRevision: 1, text: 'newer input' })
  assert.equal(drafts.clear('s', 1).ok, false)
  assert.equal(drafts.read('s').text, 'newer input')
  const result = drafts.read('s'); result.text = 'mutation'
  assert.equal(drafts.read('s').text, 'newer input')
})
test('draft bounds and unsupported upload references fail explicitly', () => {
  const drafts = new Drafts({ limit: 1 })
  assert.throws(() => drafts.write({ sessionId: 's', expectedRevision: 0, text: 'a', attachments: ['local-path'] }), /attachments-not-supported/)
  assert.throws(() => drafts.write({ sessionId: 's', expectedRevision: 0, text: 'x'.repeat(65537) }), /invalid-draft/)
  drafts.write({ sessionId: 's', expectedRevision: 0, text: 'a' })
  assert.throws(() => drafts.write({ sessionId: 'next', expectedRevision: 0, text: 'a' }), /draft-limit/)
})
test('approved authorization expires on the Host and closes every live transport', () => {
  let now = 1000
  const devices = new Devices({ now: () => now, lifetimeMs: 5000 })
  try {
    const phone = devices.claim(devices.invite().code, 'phone'); devices.approve(phone.deviceId)
    let closed = 0
    devices.attach(phone.credential, () => closed++)
    devices.attach(phone.credential, () => closed++)
    assert.equal(devices.list()[0].connected, true)
    assert.equal(devices.list()[0].expiresAt, 6000)
    now = 6000
    assert.throws(() => devices.authenticate(phone.credential), /unauthorized/)
    assert.equal(closed, 2); assert.deepEqual(devices.list(), [])
  } finally { devices.dispose() }
})
test('reading position and disclosure state follow the controller lease with bounded payloads', async () => {
  const { Follow } = await import('../src/sync/follow.js')
  const follow = new Follow({ now: () => 0 })
  const reading = { anchor: 'turn:12', offset: -40, ratio: 0.4, expanded: [{ anchor: 'turn:12', index: 0, open: true }] }
  const result = follow.update({ deviceId: 'a', expectedRevision: 0, sessionId: 's', reading })
  assert.deepEqual(result.state.reading, reading)
  reading.expanded[0].open = false
  assert.equal(follow.read().reading.expanded[0].open, true)
  assert.equal(follow.update({ deviceId: 'b', expectedRevision: 1, sessionId: 's' }).error, 'lease-held')
  assert.throws(() => follow.update({ deviceId: 'a', expectedRevision: 1, sessionId: 's', reading: { ...reading, ratio: Infinity } }), /invalid-reading/)
})
