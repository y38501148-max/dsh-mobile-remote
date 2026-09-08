import { test } from 'node:test'
import assert from 'node:assert/strict'
import { request } from 'node:https'
import { createServer } from 'node:net'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import WebSocket from 'ws'
import { fullHost } from './helpers/full-host.mjs'

async function freePort() { const s = createServer(); await new Promise(r => s.listen(0, '127.0.0.1', r)); const p = s.address().port; await new Promise(r => s.close(r)); return p }
function secure(port, origin, ca, path, { method = 'GET', cookie, payload, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port, path, method, ca, headers: { host: new URL(origin).host, origin, ...(cookie ? { cookie } : {}), ...(payload ? { 'content-type': 'application/json' } : {}), ...headers } }, res => {
      const chunks = []; res.on('data', c => chunks.push(c)); res.on('error', reject); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString() }))
    }); req.on('error', reject); req.end(payload ? JSON.stringify(payload) : undefined)
  })
}

test('real Host through TLS gateway: pairing, native UI, write receipt replay, both WS, revocation', { timeout: 60000 }, async () => {
  let host = await fullHost()
  const streams = []
  try {
    const certPath = join(host.sandbox, 'cert.pem'), keyPath = join(host.sandbox, 'key.pem')
    await promisify(execFile)('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', keyPath, '-out', certPath, '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1'])
    const ca = await readFile(certPath), port = await freePort(), origin = `https://localhost:${port}`
    let status = await (await fetch(`${host.origin}/api/plugin/mobile-remote/status`)).json()
    const local = async (path, value) => {
      const response = await fetch(`${host.origin}/api/plugin/mobile-remote/${path}`, { method: 'POST', headers: { origin: host.origin, 'content-type': 'application/json' }, body: JSON.stringify({ hostEpoch: status.hostEpoch, ...value }) })
      const body = await response.json(); assert.equal(response.status, 200, JSON.stringify(body)); return body
    }
    await local('gateway/enable', { publicOrigin: origin, port, certPath, keyPath })
    const call = (path, options) => secure(port, origin, ca, path, options)
    assert.equal((await call('/')).status, 302)
    assert.equal((await call('/assets/private.js')).status, 401)
    assert.equal((await call('/remote/pair')).status, 200)
    assert.equal((await call('/remote/pair', { headers: { origin: 'https://evil.test' } })).status, 403)
    const invite = await local('pair/invite', {})
    const claimed = await call('/remote/claim', { method: 'POST', payload: { code: invite.code, name: 'synthetic phone' } })
    assert.equal(claimed.status, 200)
    const cookie = claimed.headers['set-cookie'][0].split(';')[0], deviceId = JSON.parse(claimed.text).deviceId
    assert.match(claimed.headers['set-cookie'][0], /Secure; HttpOnly; SameSite=Strict/)
    assert.equal((await call('/api/session.list', { method: 'POST', cookie, payload: {} })).status, 401)
    await local('pair/approve', { deviceId, role: 'operator' })
    assert.equal((await call('/', { cookie, headers: { 'x-dsh-mobile-protocol': '999' } })).status, 409)
    const page = await call('/', { cookie }); assert.equal(page.status, 200); assert.match(page.text, /remote\/bootstrap.js/)
    assert.equal((await call('/api/settings.replace', { method: 'POST', cookie, payload: {} })).status, 403)
    assert.equal((await call('/api/plugin/repair/hot-reset', { cookie })).status, 403)
    assert.equal((await call('/assets/%2e%2e/secrets', { cookie })).status, 400)
    const envelope = { type: 'client-request', rpcId: randomUUID(), method: 'session.create', payload: { agentPreset: 'remote-test' } }
    const options = { method: 'POST', cookie, payload: envelope, headers: { 'x-dsh-host-epoch': status.hostEpoch } }
    const created = await call('/api/session.create', options)
    assert.equal(created.status, 200, created.text)
    const replay = await call('/api/session.create', options)
    assert.equal(replay.text, created.text)
    assert.equal(JSON.parse(created.text).result.ok, true, created.text)
    for (const path of ['/api/events.mux', '/api/events.host']) {
      const ws = new WebSocket(`wss://127.0.0.1:${port}${path}`, { ca, origin, headers: { host: new URL(origin).host, cookie } })
      streams.push(ws)
      const message = new Promise((resolve, reject) => { ws.once('message', resolve); ws.once('error', reject) })
      await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject) })
      if (path.endsWith('mux')) await message
    }
    const closed = streams.map(ws => new Promise(resolve => ws.once('close', resolve)))
    const sandbox = host.sandbox, oldEpoch = status.hostEpoch
    await host.stop({ preserve: true }); await Promise.all(closed)
    host = await fullHost({ sandbox })
    status = await (await fetch(`${host.origin}/api/plugin/mobile-remote/status`)).json()
    assert.notEqual(status.hostEpoch, oldEpoch); assert.equal(status.enabled, true)
    assert.equal((await call('/', { cookie })).status, 200, 'authorized gateway is restored after Host restart')
    assert.equal((await call('/api/session.create', options)).status, 409, 'old epoch cannot write after restart')
    const resumed = new WebSocket(`wss://127.0.0.1:${port}/api/events.mux`, { ca, origin, headers: { host: new URL(origin).host, cookie } }); streams.push(resumed)
    await new Promise((resolve, reject) => { resumed.once('open', resolve); resumed.once('error', reject) })
    const revoked = new Promise(resolve => resumed.once('close', resolve))
    await local('devices/revoke', { deviceId }); await revoked
    assert.equal((await call('/', { cookie })).status, 401)
    await local('gateway/disable', {})
  } finally { for (const ws of streams) ws.terminate(); await host.stop() }
})
