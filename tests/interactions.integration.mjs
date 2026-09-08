import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import WebSocket from 'ws'
import { fullHost } from './helpers/full-host.mjs'
async function rpc(origin, method, payload) {
  const r = await fetch(`${origin}/api/${method}`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ type: 'client-request', rpcId: randomUUID(), method, payload }) }); return await r.json()
}
function stream(origin, path = '/api/events.mux') {
  const frames = [], ws = new WebSocket(origin.replace('http:', 'ws:') + path, { origin })
  ws.on('message', data => frames.push(JSON.parse(data.toString())))
  return { ws, frames, ready: new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject) }) }
}
async function until(fn, label) { for (let i = 0; i < 200; i++) { if (fn()) return; await new Promise(r => setTimeout(r,25)) } throw Error(`timed out ${label}`) }
for (const kind of ['question', 'approval']) test(`two native clients compete for one ${kind}; reconnect restores pending identity`, { timeout: 30000 }, async () => {
  const question = kind === 'question'
  const host = await fullHost({ agentPlugins: [{ id: 'interaction', name: question ? '@deepseek-ai/dsh-tool-ask-user' : fileURLToPath(new URL('./helpers/approval-tool.mjs', import.meta.url)) }], mock: { sequence: ['tool_call_success', 'success'], toolName: question ? 'ask_user_question' : 'synthetic_approval', toolArguments: question ? JSON.stringify({ questions: [{ id: 'choice', question: 'Synthetic test choice?', options: [{ label: 'A' }, { label: 'B' }] }] }) : '{}' } })
  const clients = [stream(host.origin), stream(host.origin)], hostStream = stream(host.origin, '/api/events.host')
  try {
    await Promise.all([...clients.map(c => c.ready), hostStream.ready])
    const created = await rpc(host.origin, 'session.create', { agentPreset: 'remote-test' }), sessionId = created.result.value.sessionId
    const result = await rpc(host.origin, 'session.prompt', { sessionId, mode: 'queue', content: [{ type: 'text', text: 'synthetic interaction' }] })
    assert.equal(result.result.ok, true)
    await until(() => clients.every(c => c.frames.some(f => f.payload?.type === `${kind}/requested`)), JSON.stringify(clients[0].frames.slice(-3)))
    const pending = clients[0].frames.find(f => f.payload?.type === `${kind}/requested`)
    assert.equal(clients[1].frames.find(f => f.payload?.type === `${kind}/requested`).rpcId, pending.rpcId)
    clients[1].ws.terminate(); clients[1] = stream(host.origin); await clients[1].ready
    await until(() => clients[1].frames.some(f => f.rpcId === pending.rpcId), 'pending baseline after mux reconnection')
    const respond = value => fetch(`${host.origin}/api/respond`, { method: 'POST', headers: { origin: host.origin, 'content-type': 'application/json' }, body: JSON.stringify({ type: 'client-response', rpcId: pending.rpcId, result: { ok: true, value } }) }).then(r => r.json())
    const a = question ? { sessionId, answer: { answers: [{ id: 'choice', selected: ['A'] }] } } : { sessionId, approvalId: pending.payload.approvalId, outcome: 'allowed-once' }
    const b = question ? { sessionId, answer: { answers: [{ id: 'choice', selected: ['B'] }] } } : { sessionId, approvalId: pending.payload.approvalId, outcome: 'rejected' }
    const responses = await Promise.all([respond(a), respond(b)])
    assert.equal(responses.filter(r => r.accepted).length, 1, JSON.stringify(responses))
    assert.equal(responses.find(r => !r.accepted).reason, 'not-pending')
    await until(() => clients.every(c => c.frames.some(f => f.payload?.type === `${kind}/resolved`)), 'both clients remove pending request')
    assert.equal((await respond(a)).accepted, false)
  } finally { for (const c of clients) c.ws.terminate(); hostStream.ws.terminate(); await host.stop() }
})

test('concurrent queue edits reject stale content and replay the accepted command once', { timeout: 30000 }, async () => {
  const host = await fullHost({ mock: { chunkDelayMs: 200 } }), client = stream(host.origin)
  try {
    await client.ready
    const { hostEpoch } = await (await fetch(host.origin + '/api/plugin/mobile-remote/status')).json()
    const created = await rpc(host.origin, 'session.create', { agentPreset: 'remote-test' }), sessionId = created.result.value.sessionId
    await rpc(host.origin, 'session.prompt', { sessionId, mode: 'queue', content: [{ type: 'text', text: 'keep model running' }] })
    await until(() => client.frames.some(f => f.payload?.event?.type === 'assistant/chunk'), 'running response')
    await rpc(host.origin, 'session.prompt', { sessionId, mode: 'queue', content: [{ type: 'text', text: 'original queued message' }] })
    await until(() => client.frames.some(f => f.payload?.type === 'session/queue' && f.payload.items?.length), 'queued item')
    const row = client.frames.filter(f => f.payload?.type === 'session/queue' && f.payload.items?.length).at(-1).payload.items[0]
    const { createHash } = await import('node:crypto')
    const expectedHash = createHash('sha256').update(JSON.stringify(row.message.content)).digest('hex')
    const update = (clientId, text, commandId) => fetch(host.origin + '/api/plugin/mobile-remote/queue/update', { method: 'POST', headers: { origin: host.origin, 'content-type': 'application/json' }, body: JSON.stringify({ hostEpoch, clientId, sessionId, itemId: row.id, expectedHash, commandId, action: { kind: 'edit', content: [{ type: 'text', text }] } }) }).then(r => r.json())
    const a = randomUUID(), b = randomUUID()
    const results = await Promise.all([update('a', 'desktop edit', a), update('b', 'phone edit', b)])
    assert.equal(results.filter(r => r.ok).length, 1, JSON.stringify(results))
    assert.equal(results.find(r => !r.ok).error, 'queue-edit-conflict')
    const winner = results[0].ok ? ['a', 'desktop edit', a] : ['b', 'phone edit', b]
    assert.equal((await update(...winner)).ok, true)
    await rpc(host.origin, 'session.cancel', { sessionId })
  } finally { client.ws.terminate(); await host.stop() }
})
