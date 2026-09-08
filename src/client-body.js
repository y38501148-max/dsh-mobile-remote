import React from 'react'
import QRCode from 'qrcode'
import { RemoteApi, DraftClient } from './client/sync-client.js'
const h = React.createElement
const remote = !!window.__DSH_REMOTE__
let clientId = sessionStorage.getItem('dsh-mobile-client-id')
if (!clientId) { clientId = crypto.randomUUID(); sessionStorage.setItem('dsh-mobile-client-id', clientId) }

function useTick(source) {
  const [, tick] = React.useReducer(n => n + 1, 0)
  React.useEffect(() => source.subscribe(tick), [source])
  return source
}
function Button({ children, ...props }) { return h('button', { ...props, className: 'mr-button ' + (props.className || '') }, children) }
function Settings({ service }) {
  useTick(service)
  const [status, setStatus] = React.useState(null), [devices, setDevices] = React.useState([]), [error, setError] = React.useState(''), [busy, setBusy] = React.useState(false)
  const [config, setConfig] = React.useState({ publicOrigin: '', certPath: '', keyPath: '', bind: '0.0.0.0', port: 8443 })
  const [invitation, setInvitation] = React.useState(null), [qr, setQr] = React.useState('')
  const refresh = React.useCallback(async () => {
    const current = await service.api.status(); setStatus(current)
    if (!remote) {
      const res = await fetch('/api/plugin/mobile-remote/devices'); const value = await res.json()
      if (!res.ok) throw Error(value.error); setDevices(value.devices)
    }
  }, [service])
  React.useEffect(() => { refresh().catch(e => setError(e.message)); const t = setInterval(() => refresh().catch(e => setError(e.message)), 2000); return () => clearInterval(t) }, [refresh])
  const run = async action => { setBusy(true); setError(''); try { await action(); await refresh() } catch (e) { setError(e.message) } finally { setBusy(false) } }
  const call = async (path, args) => { const result = await service.api.call(path, args); if (result.error) throw Error(result.error); return result }
  const invite = () => run(async () => {
    const value = await call('pair/invite', {})
    const url = `${status.remoteOrigin}/remote/pair#invite=${encodeURIComponent(value.code)}`
    setInvitation({ ...value, url }); setQr(await QRCode.toDataURL(url, { width: 240, margin: 2 }))
  })
  return h('section', { className: 'mr-settings' },
    h('h2', null, '手机远程'),
    h('p', { role: 'status' }, remote ? `已连接 · ${status?.name || ''} · ${status?.role || ''}` : status?.enabled ? `远程入口已开启：${status.remoteOrigin}` : '远程入口已关闭'),
    error && h('p', { className: 'mr-error', role: 'alert' }, error),
    !remote && h(React.Fragment, null,
      h('p', null, '手机连接当前电脑 Host，共享会话和执行队列。请使用手机可验证的 HTTPS 证书。'),
      ...[['publicOrigin', 'HTTPS 地址', 'https://your-host.example:8443'], ['certPath', '证书文件路径', '/path/fullchain.pem'], ['keyPath', '私钥文件路径', '/path/privkey.pem']].map(([key, label, placeholder]) => h('label', { key }, label, h('input', { value: config[key], placeholder, onChange: e => setConfig({ ...config, [key]: e.target.value }) }))),
      h('label', null, '监听端口', h('input', { type: 'number', value: config.port, min: 1, max: 65535, onChange: e => setConfig({ ...config, port: Number(e.target.value) }) })),
      h('label', null, '连接方式', h('select', { value: config.bind, onChange: e => setConfig({ ...config, bind: e.target.value }) }, h('option', { value: '0.0.0.0' }, '私人网络直连'), h('option', { value: '127.0.0.1' }, '仅本机测试'))),
      h(Button, { disabled: busy, onClick: () => run(() => call(status?.enabled ? 'gateway/disable' : 'gateway/enable', config)) }, status?.enabled ? '关闭远程入口' : '开启远程入口'),
      h(Button, { disabled: busy || !status?.enabled, onClick: invite }, '生成配对二维码'),
      invitation && h('div', null, h('p', null, `邀请有效至 ${new Date(invitation.expiresAt).toLocaleTimeString()}，仅可使用一次。`), h('img', { src: qr, alt: '手机配对二维码', width: 240, height: 240 }), h('input', { readOnly: true, value: invitation.url, 'aria-label': '配对链接' })),
      h('h3', null, '设备'),
      ...devices.map(device => h('div', { className: 'mr-device', key: device.deviceId },
        h('strong', null, device.name), h('span', null, device.state === 'pending' ? '等待电脑确认' : `已授权 · ${device.role}`),
        device.state === 'pending' && h(React.Fragment, null,
          h(Button, { disabled: busy, onClick: () => run(() => call('pair/approve', { deviceId: device.deviceId, role: 'viewer' })) }, '只读'),
          h(Button, { disabled: busy, onClick: () => run(() => call('pair/approve', { deviceId: device.deviceId, role: 'operator' })) }, '任务操作'),
          h(Button, { disabled: busy, onClick: () => run(() => call('pair/approve', { deviceId: device.deviceId, role: 'admin' })) }, '完整控制')),
        h(Button, { disabled: busy, onClick: () => run(() => call('devices/revoke', { deviceId: device.deviceId })) }, '撤销设备'))),
      h('p', null, '任务操作设备可读写全部会话。完整控制另含电脑目录、设置与动态插件操作。撤销立即断开现有连接。')),
    h('h3', null, '双端联动'),
    h(Button, { onClick: () => service.setFollow(!service.following) }, service.following ? '退出跟随' : '跟随另一端'),
    h(Button, { onClick: () => service.takeControl().catch(e => setError(e.message)) }, '接管会话与面板联动'),
    h('p', null, service.message),
    remote && h(Button, { onClick: async () => { await fetch('/remote/logout', { method: 'POST' }); location.assign('/remote/pair') } }, '退出连接'))
}
function DraftDock({ service, sessionId }) {
  useTick(service)
  const client = service.clients.get(sessionId)
  if (!client) return null
  const state = client.state
  const act = action => action().catch(e => { client.notice(e.message) })
  return h('div', { className: 'mr-draft' },
    h('span', { role: 'status' }, state.message || '正在同步草稿…'),
    state.status === 'conflict' && h('div', null,
      h(Button, { onClick: () => act(() => client.flush(true)) }, '接管并使用本机草稿'),
      h(Button, { onClick: () => act(() => client.useRemote()) }, '使用共享草稿'),
      state.remote && h('details', null, h('summary', null, '查看共享草稿'), h('pre', null, state.remote.text))),
    state.conflicts.length > 0 && h('details', null, h('summary', null, `保留的冲突副本（${state.conflicts.length}）`), ...state.conflicts.map(copy => h('div', { key: copy.id }, h('pre', null, copy.text), h(Button, { onClick: () => { client.apply(copy); client.dirty = true; client.persist(); client.publish({ status: 'conflict', message: '副本已载入，请接管后同步。' }) } }, '载入副本'), h(Button, { onClick: () => act(async () => { await service.api.call('draft/resolve', { sessionId, conflictId: copy.id }); await client.refresh() }) }, '删除此副本')))))
}
function FollowButton({ service }) {
  useTick(service)
  return h(Button, { title: service.message, onClick: () => service.following ? service.takeControl().catch(e => service.note(e.message)) : service.setFollow(true) }, service.following ? '双端联动' : '独立浏览')
}
function DirectoryFlow({ open, busy, onPicked, onCancel, service }) {
  const [listing, setListing] = React.useState(null), [path, setPath] = React.useState(''), [error, setError] = React.useState(''), [loading, setLoading] = React.useState(false)
  const load = async next => { setLoading(true); setError(''); try { const result = await service.api.call('directory/list', next ? { path: next } : {}); if (result.error) throw Error(result.error); setListing(result); setPath(result.path) } catch (e) { setError(e.message) } finally { setLoading(false) } }
  React.useEffect(() => { if (open) load() }, [open])
  if (!open) return null
  return h('div', { className: 'mr-modal-backdrop' }, h('div', { className: 'mr-modal', role: 'dialog', 'aria-label': '选择电脑目录', 'aria-modal': true },
    h('h2', null, '选择电脑目录'), h('input', { value: path, onChange: e => setPath(e.target.value), 'aria-label': '电脑目录路径' }),
    h(Button, { disabled: loading, onClick: () => load(path) }, '前往'), h(Button, { disabled: loading || !listing, onClick: () => load(listing.parent) }, '上一级'),
    error && h('p', { role: 'alert', className: 'mr-error' }, error),
    h('div', { className: 'mr-directories' }, ...(listing?.directories ?? []).map(entry => h(Button, { key: entry.path, disabled: loading, onClick: () => load(entry.path) }, entry.name))),
    listing?.truncated && h('p', null, '目录过多，仅显示前 1000 项；可输入完整路径。'),
    h(Button, { disabled: busy || loading || !listing, onClick: () => onPicked(listing.path) }, '选择此目录'), h(Button, { disabled: busy, onClick: onCancel }, '取消')))
}

class SyncService {
  constructor(ctx) {
    this.ctx = ctx; this.api = new RemoteApi({ remote, clientId }); this.clients = new Map(); this.listeners = new Set(); this.following = true; this.message = ''; this.followState = null; this.applying = false
  }
  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn) }
  note(message) { this.message = message; this.emit() }
  emit() { for (const fn of this.listeners) fn() }
  current() { return this.ctx.sessions.list.getSnapshot().current ?? null }
  attach() {
    const current = this.current()
    if (current && !this.clients.has(current)) {
      const scope = this.ctx.sessions.scope(current)
      if (scope) this.clients.set(current, new DraftClient({ api: this.api, sessionId: current, input: this.ctx.conversation.input.for(scope), storage: sessionStorage, changed: () => this.emit() }))
    }
    if (!this.applying && current !== this.lastCurrent) {
      this.lastCurrent = current
      if (this.following && this.followState) this.publishFollow(false).catch(e => this.note(e.message))
    }
  }
  setFollow(value) { this.following = value; this.note(value ? '跟随已开启' : '独立浏览，不改变另一端位置'); if (value) this.pollFollow() }
  async publishFollow(takeover, panel = 'chat') {
    const current = await this.api.call('follow/read')
    const result = await this.api.call('follow/update', { expectedRevision: current.revision, sessionId: this.current(), panel, takeover })
    if (!result.ok) { this.following = false; this.note('另一设备正在控制联动，已保留你的浏览位置。点击接管可重新联动。'); return }
    this.followState = result.state; this.note('由此设备控制联动')
  }
  async takeControl(panel = 'chat') { this.following = true; await this.publishFollow(true, panel) }
  async pollFollow() {
    try {
      const state = await this.api.call('follow/read')
      this.followState = state
      if (!this.following || !state.controller || state.controller === this.api.deviceId) return
      this.applying = true
      try {
        if (state.sessionId && this.current() !== state.sessionId && this.ctx.sessions.list.getSnapshot().byId[state.sessionId]) this.ctx.sessions.open(state.sessionId)
        if (state.sessionId === null && this.current()) this.ctx.sessions.clear()
        if (state.panel === 'details') this.ctx.layout.openDetails(); else this.ctx.layout.closeDetails()
        this.lastCurrent = this.current()
      } finally { this.applying = false }
      this.note('正在跟随另一设备')
    } catch (e) { this.note(e.message) }
  }
  dispose() { for (const client of this.clients.values()) client.dispose(); this.clients.clear(); this.listeners.clear() }
}

export const inject = ['slots', 'sessions', 'conversation', 'layout']
export function apply(ctx) {
  const service = new SyncService(ctx)
  ctx.effect(() => {
    const unsubscribe = ctx.sessions.list.subscribe(() => service.attach())
    service.api.status().then(() => { service.attach(); service.pollFollow() }).catch(e => service.note(e.message))
    const timer = setInterval(() => service.pollFollow(), 1500)
    const conversation = ctx.conversation
    const originalSend = conversation.sendSession
    const send = async function(session, text, imageIds, mode) {
      const client = service.clients.get(session.sessionId)
      client?.beginPrompt()
      let revision
      try {
        revision = await client?.beforePrompt()
        await originalSend.call(this, session, text, imageIds, mode)
        await client?.afterPrompt(revision, true)
      } catch (error) { await client?.afterPrompt(revision, false); throw error }
    }
    conversation.sendSession = send
    return () => { unsubscribe(); clearInterval(timer); service.dispose(); if (conversation.sendSession === send) conversation.sendSession = originalSend }
  }, 'mobile-remote: input and navigation synchronization')
  ctx.slots.inject('settings.section', () => ctx.slots.register({ name: 'settings.section', id: 'mobile-remote', order: 90, label: () => '手机远程', inject: () => ({ service }) }, Settings))
  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({ name: 'conversation.input.dock', id: 'mobile-remote-draft', order: 100, inject: () => ({ service }) }, DraftDock))
  ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({ name: 'conversation.session.header.utilities', id: 'mobile-remote-follow', inject: () => ({ service }) }, FollowButton))
  if (remote) for (const name of ['conversation.hero.workspace.directoryFlow', 'sidebar.workspaces.directoryFlow']) ctx.slots.inject(name, () => ctx.slots.register({ name, inject: () => ({ service }) }, DirectoryFlow))
}
