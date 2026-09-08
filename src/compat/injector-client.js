import React from 'react'
const h = React.createElement
function Manager() {
  const [entries, setEntries] = React.useState([]), [path, setPath] = React.useState(''), [message, setMessage] = React.useState(''), [busy, setBusy] = React.useState(false)
  const call = async (route, payload) => {
    const response = await fetch('/super-injector/api/' + route, payload ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) } : {})
    const value = await response.json()
    if (!response.ok || !value.ok) throw Error(value.error || '插件操作失败')
    return value
  }
  const refresh = async () => { const value = await call('list'); setEntries(value.entries) }
  React.useEffect(() => { refresh().catch(e => setMessage(e.message)); const timer = setInterval(() => refresh().catch(e => setMessage(e.message)), 5000); return () => clearInterval(timer) }, [])
  const run = async (route, payload) => {
    setBusy(true); setMessage('')
    try { const result = await call(route, payload); setMessage(String(result.result ?? '已完成')); await refresh() } catch (e) { setMessage(e.message) } finally { setBusy(false) }
  }
  return h('section', { style: { padding: 16, maxWidth: 720 } }, h('h2', null, '超级模组注入器'), h('p', null, '输入电脑上的插件目录，操作结果会同步到其他设备。'), h('input', { value: path, onChange: e => setPath(e.target.value), 'aria-label': '电脑插件目录', style: { width: '100%', boxSizing: 'border-box', padding: 8 } }),
    h('button', { disabled: busy || !path.trim(), onClick: () => run('inject', { dir: path.trim() }) }, '直接注入'),
    h('button', { disabled: busy || !path.trim(), onClick: () => run('ingest', { dir: path.trim(), title: '内化插件' }) }, '内化为插件'),
    message && h('p', { role: 'status', style: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } }, message),
    entries.length === 0 && h('p', null, '暂无注入插件'),
    ...entries.map(entry => h('div', { key: entry.name, style: { padding: 8, overflowWrap: 'anywhere' } }, h('strong', null, entry.name), h('div', null, entry.dir), h('span', null, entry.active ? '运行中' : '未激活'), h('button', { disabled: busy, onClick: () => run('uninstall', { match: entry.name }) }, '卸载'))))
}
export const inject = ['slots']
export function apply(ctx) { ctx.slots.inject('settings.section', () => ctx.slots.register({ name: 'settings.section', id: 'super-injector-plugins', order: 50, label: () => '超级模组', inject: () => ({}) }, Manager)) }
