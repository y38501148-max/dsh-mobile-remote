import React from 'react'
const h = React.createElement
const hash = async value => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value))))].map(n => n.toString(16).padStart(2,'0')).join('')
export function SharedQueue({ service, sessionId, useSession }) {
  const queue = useSession(state => state.queue), running = useSession(state => state.running), subagent = useSession(state => state.subagent)
  const [editing, setEditing] = React.useState(null), [busy, setBusy] = React.useState(false), [error, setError] = React.useState('')
  const act = async (row, action) => {
    setBusy(true); setError('')
    try {
      const result = await service.api.call('queue/update', { sessionId, itemId: row.id, action, expectedHash: await hash(row.message.content), commandId: crypto.randomUUID() })
      if (!result.ok) throw Error(result.error === 'queue-edit-conflict' ? '另一端已修改这条排队消息。你的编辑仍在，请复制后核对新内容。' : result.error === 'queue-item-no-longer-pending' ? '这条消息已离开队列。你的编辑仍在，请核对会话。' : result.error)
      setEditing(null)
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  if (!queue.length && !editing) return null
  return h('section', { className: 'mr-queue', 'aria-label': '待发送队列' },
    h('strong', null, `待发送 ${queue.length}`),
    error && h('p', { role: 'alert' }, error),
    editing && h('div', null, h('textarea', { 'aria-label': '编辑排队消息', value: editing.text, onChange: e => setEditing({ ...editing, text: e.target.value }), disabled: busy }), h('button', { disabled: busy || !editing.text.trim(), onClick: () => act(editing.row, { kind: 'edit', content: [{ type: 'text', text: editing.text }] }) }, '保存编辑'), h('button', { disabled: busy || row.message.content.some(b => b.type !== 'text'), onClick: () => { setEditing(null); setError('') } }, '取消编辑')),
    ...queue.map(row => h('div', { key: row.id, className: 'mr-queue-row' }, h('span', null, row.message.content.filter(b => b.type === 'text').map(b => b.text).join('\n') || '附件消息'), subagent === null && h('div', null,
      h('button', { disabled: busy || row.message.content.some(b => b.type !== 'text'), onClick: () => { setEditing({ row: structuredClone(row), text: row.message.content.filter(b => b.type === 'text').map(b => b.text).join('\n') }); setError('') } }, '编辑'),
      h('button', { disabled: busy, onClick: () => act(row, { kind: 'remove' }) }, '移除'),
      running && row.placement === 'queued' && h('button', { disabled: busy, onClick: () => act(row, { kind: 'steer' }) }, '现在引导')))))
}
