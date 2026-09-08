import { createHash } from 'node:crypto'
import { check } from '../auth/devices.js'
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
export class QueueCommands {
  constructor(ctx, commands) { this.ctx = ctx; this.commands = commands }
  async update({ sessionId, itemId, action, expectedHash, commandId }, deviceId) {
    check(typeof sessionId === 'string' && sessionId.length <= 256 && typeof itemId === 'string' && itemId.length <= 256, 'invalid-queue-item')
    check(typeof commandId === 'string' && commandId.length > 0 && commandId.length <= 128 && /^[0-9a-f]{64}$/.test(expectedHash), 'invalid-queue-command')
    check(action && ['edit','remove','steer'].includes(action.kind), 'invalid-queue-action')
    if (action.kind === 'edit') check(Array.isArray(action.content) && action.content.length > 0 && action.content.every(block => block.type === 'text' && typeof block.text === 'string') && Buffer.byteLength(JSON.stringify(action.content)) <= 65536, 'invalid-queue-content')
    const request = { type: 'client-request', method: 'session.updateQueue', rpcId: commandId, payload: { sessionId, itemId, action } }
    const receipt = await this.commands.execute(deviceId, commandId, JSON.stringify({ request, expectedHash }), async () => {
      const agent = this.ctx.get('agents')?.get(sessionId)
      const message = [...agent?.inbox.nextTurn ?? [], ...agent?.inbox.nextStep ?? []].find(m => m.id === itemId)
      const response = value => ({ status: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) })
      if (!message) return response({ ok: false, error: 'queue-item-no-longer-pending' })
      if (hash(message.content) !== expectedHash) return response({ ok: false, error: 'queue-edit-conflict' })
      // Comparison and the native synchronous inbox splice share one JS turn.
      const result = await this.ctx.apiProxy.sessions.updateQueue(request)
      if (result.result.ok) await this.ctx.get('sessions')?.flush(agent.session)
      return response(result.result.ok ? { ok: true } : { ok: false, error: result.result.error.code })
    })
    return JSON.parse(receipt.body)
  }
}
