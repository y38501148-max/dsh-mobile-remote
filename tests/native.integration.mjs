import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import WebSocket from 'ws'
import { fullHost } from './helpers/full-host.mjs'

export async function rpc(origin, method, payload, rpcId = randomUUID()) {
  const res = await fetch(`${origin}/api/${method}`, { method: 'POST', headers: { 'content-type': 'application/json', origin }, body: JSON.stringify({ type: 'client-request', rpcId, method, payload }) })
  const body = await res.json()
  assert.equal(res.status, 200, JSON.stringify(body)); return body
}
function stream(origin, path) {
  const frames = []
  const ws = new WebSocket(origin.replace('http:', 'ws:') + path, { origin })
  ws.on('message', bytes => frames.push(JSON.parse(bytes.toString())))
  return { ws, frames, ready: new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject) }) }
}
async function until(predicate, label) {
  for (let n = 0; n < 200; n++) { if (predicate()) return; await new Promise(r => setTimeout(r, 50)) }
  throw Error(`timed out: ${label}`)
}

test('full rc.6 Host: two native clients see one streamed turn and identical paginated history', { timeout: 60000 }, async () => {
  const host = await fullHost()
  const desktop = stream(host.origin, '/api/events.mux'), phone = stream(host.origin, '/api/events.mux'), hostEvents = stream(host.origin, '/api/events.host')
  try {
    await Promise.all([desktop.ready, phone.ready, hostEvents.ready])
    const created = await rpc(host.origin, 'session.create', { agentPreset: 'remote-test' })
    assert.equal(created.result.ok, true, JSON.stringify(created))
    const sessionId = created.result.value.sessionId
    const sent = await rpc(host.origin, 'session.prompt', { sessionId, mode: 'queue', content: [{ type: 'text', text: 'synthetic phone prompt' }] }, 'native-phone-prompt')
    assert.equal(sent.result.ok, true, JSON.stringify(sent))
    await until(() => desktop.frames.some(f => f.payload?.event?.type === 'turn/end'), JSON.stringify(desktop.frames.slice(-3)))
    await until(() => phone.frames.length === desktop.frames.length, 'second client convergence')
    const events = source => source.frames.filter(f => f.payload?.type === 'session/event').map(f => f.payload.event)
    assert.deepEqual(events(phone), events(desktop))
    assert.ok(events(phone).some(e => e.type === 'assistant/chunk'))
    assert.ok(hostEvents.frames.some(f => f.payload?.type === 'host/session-added'))
    const a = await rpc(host.origin, 'session.history', { sessionId, maxMessages: 100 })
    const b = await rpc(host.origin, 'session.history', { sessionId, maxMessages: 100 })
    assert.deepEqual(a.result, b.result)
    assert.equal(host.mock.requests.length, 1)
  } finally { desktop.ws.terminate(); phone.ws.terminate(); hostEvents.ws.terminate(); await host.stop() }
})
