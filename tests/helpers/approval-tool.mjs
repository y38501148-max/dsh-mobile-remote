import { defineTool } from '@deepseek-ai/dsh-tools'
export const name = 'synthetic-approval'
export const inject = ['tools', 'approval']
export function apply(ctx) {
  ctx.tools.register(defineTool({ name: 'synthetic_approval', description: 'Synthetic no-side-effect approval test.', parameters: {}, output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] }, async execute(_args, exec) {
    return await ctx.approval.request({ agent: exec.agent, toolName: 'synthetic_approval', callId: exec.callId, reason: 'Synthetic approval only; no file or network operation.', signal: exec.signal })
  } }))
}
