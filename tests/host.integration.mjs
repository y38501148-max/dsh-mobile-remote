import { test } from 'node:test'
import assert from 'node:assert/strict'
import { request as httpRequest } from 'node:http'
import { Context } from '@deepseek-ai/cordis'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import * as plugin from '../src/index.js'

test('real rc.6 webServer: two clients share epoch and CAS state, enforce boundary, unload cleanly', async () => {
  const ctx = new Context()
  const server = ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
  await server.await()
  try {
    assert.ok(ctx.webServer.port > 0)
    // This fixture validates the real route carrier, not session/admission APIs.
    ctx.provide('apiProxy', {})
    let remote = ctx.plugin(plugin)
    await remote.await()
    const origin = `http://127.0.0.1:${ctx.webServer.port}`
    const request = (path, payload, headers = {}) => fetch(`${origin}${plugin.BASE_PATH}/${path}`, {
      method: payload === undefined ? 'GET' : 'POST',
      headers: { origin, 'content-type': 'application/json', ...headers },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    })
    const desktop = await (await request('status')).json()
    const phone = await (await request('status')).json()
    assert.equal(desktop.hostEpoch, phone.hostEpoch)
    assert.equal(desktop.hostPort, ctx.webServer.port)
    assert.equal(phone.enabled, false)
    assert.equal((await request('status', undefined, { origin: 'https://evil.test' })).status, 403)
    const spoofed = await new Promise((resolve, reject) => {
      const req = httpRequest(`${origin}${plugin.STATUS_PATH}`, { headers: { host: 'evil.test' } }, res => { res.resume(); resolve(res.statusCode) })
      req.on('error', reject); req.end()
    })
    assert.equal(spoofed, 403)
    assert.equal((await request('status', {})).status, 405)
    assert.equal((await request('pair/invite', {})).status, 409)
    const post = (path, payload = {}) => request(path, { hostEpoch: desktop.hostEpoch, ...payload })
    const invitation = await (await post('pair/invite')).json()
    const claim = await (await post('pair/claim', { code: invitation.code, name: 'test phone' })).json()
    assert.equal(claim.state, 'pending')
    assert.equal((await post('pair/approve', { deviceId: claim.deviceId })).status, 200)
    assert.equal((await post('pair/claim', { code: invitation.code, name: 'replay' })).status, 403)
    const writes = await Promise.all(['desktop input', 'phone input'].map(text => post('draft/write', { sessionId: 'synthetic', expectedRevision: 0, text })))
    assert.deepEqual(writes.map(r => r.status).sort(), [200, 409])
    const results = await Promise.all(writes.map(r => r.json()))
    const conflict = results.find(r => !r.ok)
    assert.notEqual(conflict.current.text, conflict.conflict.text)
    assert.equal((await post('draft/clear', { sessionId: 'synthetic', expectedRevision: 0 })).status, 409)
    assert.equal((await post('devices/revoke', { deviceId: claim.deviceId })).status, 200)
    assert.deepEqual((await (await request('devices')).json()).devices, [])
    const malformed = await fetch(`${origin}${plugin.BASE_PATH}/pair/invite`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: '{' })
    assert.equal(malformed.status, 400)
    assert.equal((await request('pair/invite', {}, { 'content-type': 'text/plain' })).status, 415)
    await remote.dispose()
    assert.equal((await request('status')).status, 404)
    remote = ctx.plugin(plugin)
    await remote.await()
    assert.notEqual((await (await request('status')).json()).hostEpoch, desktop.hostEpoch)
    assert.equal((await post('pair/invite')).status, 409)
    await remote.dispose()
  } finally { await server.dispose() }
})
