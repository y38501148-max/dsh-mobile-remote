import { randomUUID } from 'node:crypto'

const receipt = value => ({ status: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) })

// rc.6 compatibility seam: all physical carriers resolve this namespace on
// each request. Persist intent before native admission and flush its inbox log
// before acknowledging. A crash between those steps is resolved from native
// source.rpcId evidence, never by invoking admission again.
export function installAdmission(ctx, commands) {
  const api = ctx.apiProxy?.sessions
  if (!api?.prompt) return { dispose() {}, reconcile: async () => undefined }
  const original = api.prompt
  const flush = async sessionId => {
    const sessions = ctx.get('sessions'), session = sessions?.get(sessionId)
    if (session) await sessions.flush(session)
  }
  const reconcile = async request => {
    if (request.method !== 'session.prompt') return
    await flush(request.payload.sessionId)
    let beforeSeq
    for (let page = 0; page < 100; page++) {
      const history = await api.history({ type: 'client-request', rpcId: randomUUID(), method: 'session.history', payload: { sessionId: request.payload.sessionId, maxMessages: 100, ...beforeSeq === undefined ? {} : { beforeSeq } } })
      if (!history.result.ok) return
      const { events, hasMore } = history.result.value
      const found = events.some(({ event }) =>
        (event.type === 'user/message' && event.data?.source?.rpcId === request.rpcId) ||
        (event.type === 'agent/inbox/spliced' && event.data?.inserted?.some(message => message.source?.rpcId === request.rpcId)))
      if (found) return receipt({ rpcId: request.rpcId, result: { ok: true, value: { accepted: true } } })
      if (!hasMore || !events.length) return
      const next = Math.min(...events.map(({ event }) => event.seq))
      if (beforeSeq !== undefined && next >= beforeSeq) return
      beforeSeq = next
    }
  }
  const wrapped = async request => {
    const response = await commands.execute('native-admission', request.rpcId, JSON.stringify(request), async () => {
      const result = await original.call(api, request)
      if (result.result.ok) await flush(request.payload.sessionId)
      return receipt(result)
    }, () => reconcile({ ...request, method: 'session.prompt' }))
    if (response.status !== 200) return { rpcId: request.rpcId, result: { ok: false, error: { code: 'outcome-unknown', message: '消息接收结果待确认。请保留草稿并核对历史，不要自动重发。', details: {} } } }
    return JSON.parse(response.body)
  }
  api.prompt = wrapped
  return { reconcile, dispose() { if (api.prompt === wrapped) api.prompt = original } }
}
