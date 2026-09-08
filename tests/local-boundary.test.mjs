import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isLocalRequest, apply } from '../src/index.js'

test('custom routes require local peer, exact authority and same-origin browser', () => {
  const request = (headers = {}, address = '127.0.0.1') => ({ headers: { host: '127.0.0.1:43123', ...headers }, socket: { remoteAddress: address } })
  assert.equal(isLocalRequest(request(), 43123), true)
  for (const req of [request({}, '192.168.1.2'), request({ host: 'evil.test:43123' }), request({ origin: 'http://evil.test' }), request({ origin: 'null' }), request({ 'sec-fetch-site': 'cross-site' }), request({ host: '127.0.0.1:3080' })]) {
    assert.equal(isLocalRequest(req, 43123), false)
  }
})

test('plugin registers on the injected Host and owns its route disposer', async () => {
  let removed = false
  const routes = []
  let dispose
  await apply({ webServer: { port: 43123, register(value) { routes.push(value); return () => { removed = true } } }, effect(fn) { dispose = fn() } })
  assert.ok(routes.some(route => route.path === '/api/plugin/mobile-remote/status'))
  assert.equal(new Set(routes.map(route => route.path)).size, routes.length)
  await dispose()
  assert.equal(removed, true)
})
