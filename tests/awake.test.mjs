import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter, once } from 'node:events'
import { KeepAwake } from '../src/background/awake.js'
test('concurrent enable shares one child and disable during spawn cannot leak it', async () => {
  let count = 0, kills = 0
  const child = new EventEmitter(); child.kill = () => kills++
  const awake = new KeepAwake({ platform: 'darwin', spawnProcess: () => { count++; return child } })
  const a = awake.enable(), b = awake.enable()
  awake.disable(); child.emit('spawn')
  await Promise.all([a, b]); assert.equal(count, 1); assert.ok(kills >= 1); assert.equal(awake.status().enabled, false)
})
test('macOS keep-awake process starts and is terminated on disable', { skip: process.platform !== 'darwin' }, async () => {
  const awake = new KeepAwake()
  try {
    assert.equal((await awake.enable()).enabled, true)
    const child = awake.child, exited = once(child, 'exit')
    awake.disable(); await exited
    assert.equal(awake.status().enabled, false)
  } finally { awake.disable() }
})
