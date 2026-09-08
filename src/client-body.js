import React from 'react'
import { DirectSetup } from './client/direct.js'
import { SharedQueue } from './client/queue.js'
import { installReading } from './client/reading.js'
import QRCode from 'qrcode'
import { ResourcePreview, installResources } from './client/resources.js'
import { installExtensions } from './client/extensions.js'
import { SharedFiles } from './client/files.js'
import { SharedImages } from './client/images.js'
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
function CommandReceipts({ service }) {
  const [items, setItems] = React.useState([]), [error, setError] = React.useState('')
  React.useEffect(() => {
    let alive = true
    const refresh = async () => { try { const value = await service.api.call('commands/list'); if (alive) { setItems((value.commands ?? []).sort((a,b) => b.at - a.at).slice(0, 20)); setError('') } } catch (e) { if (alive) setError(e.message) } }
    refresh(); const timer = setInterval(refresh, 5000)
    return () => { alive = false; clearInterval(timer) }
  }, [service])
  return h('section', null, h('h3', null, '此设备的操作回执'), error && h('p', { role: 'alert' }, error),
    items.length === 0 && h('p', null, '暂无操作记录。'),
    ...items.map(item => h('div', { key: item.commandId, className: 'mr-device' }, h('span', null, item.method ?? '管理操作'), h('span', null, item.state === 'complete' ? '回执已返回' : item.state === 'pending' ? '等待 Host 回执' : '结果待确认'), h('time', null, new Date(item.at).toLocaleTimeString()),
      item.sessionId && service.ctx.sessions.list.getSnapshot().byId[item.sessionId] && h(Button, { onClick: () => service.ctx.sessions.open(item.sessionId) }, '核对会话'))),
    items.some(item => item.state !== 'complete') && h('p', null, '待确认操作不会自动重发。请先核对会话和队列中的实际结果。'))
}
function Settings({ service }) {
  useTick(service)
  const [status, setStatus] = React.useState(null), [devices, setDevices] = React.useState([]), [error, setError] = React.useState(''), [busy, setBusy] = React.useState(false)
  const [config, setConfig] = React.useState({ publicOrigin: '', certPath: '', keyPath: '', bind: '0.0.0.0', port: 8443 })
  const [invitation, setInvitation] = React.useState(null), [qr, setQr] = React.useState('')
  const [notifications, setNotifications] = React.useState(null)
  const refresh = React.useCallback(async () => {
    const current = await service.api.status(); setStatus(current)
    if (remote) setNotifications(await service.api.call('push/status'))
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
    const fragment = new URLSearchParams({invite:value.code,v:'1',hostId:value.hostId,pin:value.pin,expires:String(value.expiresAt)})
    const url = `${status.remoteOrigin}/remote/pair#${fragment}`
    setInvitation({ ...value, url }); setQr(await QRCode.toDataURL(url, { width: 240, margin: 2 }))
  })
  const enableNotifications = () => run(async () => {
    if (!('Notification' in window) || !('PushManager' in window) || !navigator.serviceWorker) throw Error('当前浏览器不支持推送。iPhone 请先将此网页添加到主屏幕，再从主屏幕打开。')
    const permission = await Notification.requestPermission()
    if (permission !== 'granted') throw Error('通知权限未开启，可在浏览器设置中调整。')
    const { publicKey } = await service.api.call('push/key')
    const registration = await navigator.serviceWorker.ready
    const applicationServerKey = Uint8Array.from(atob(publicKey.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0))
    const subscription = await registration.pushManager.getSubscription() ?? await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey })
    await call('push/subscribe', { subscription: subscription.toJSON() })
  })
  return h('section', { className: 'mr-settings' },
    h('h2', null, '手机远程'),
    h('p', { role: 'status' }, remote ? `已连接 · ${status?.name || ''} · ${status?.role || ''}` : status?.enabled ? `远程入口已开启：${status.remoteOrigin}` : '远程入口已关闭'),
    error && h('p', { className: 'mr-error', role: 'alert' }, error),
    !remote && h(React.Fragment, null,
      h(DirectSetup, {status,call,run,busy}),
      h('details',null,h('summary',null,'高级：浏览器 HTTPS / 中继配置'),
      h('p', null, '以下用于浏览器或已配置的中继；安卓 App 请使用上方 IPv6 直连。'),
      ...[['publicOrigin', 'HTTPS 地址', 'https://your-host.example:8443'], ['certPath', '证书文件路径', '/path/fullchain.pem'], ['keyPath', '私钥文件路径', '/path/privkey.pem'], ['relayUrl', '中继控制地址（可选）', 'wss://relay.example:8443/relay/control'], ['relayTokenPath', '中继令牌文件（可选）', '/path/relay-token']].map(([key, label, placeholder]) => h('label', { key }, label, h('input', { value: config[key] ?? '', placeholder, onChange: e => setConfig({ ...config, [key]: e.target.value }) }))),
      h('label', null, '监听端口', h('input', { type: 'number', value: config.port, min: 1, max: 65535, onChange: e => setConfig({ ...config, port: Number(e.target.value) }) })),
      h('label', null, '连接方式', h('select', { value: config.bind, onChange: e => setConfig({ ...config, bind: e.target.value }) }, h('option', { value: '0.0.0.0' }, '私人网络直连'), h('option', { value: '127.0.0.1' }, '仅本机测试'))),
      h(Button, { disabled: busy, onClick: () => run(() => call(status?.enabled ? 'gateway/disable' : 'gateway/enable', config)) }, status?.enabled ? '关闭远程入口' : '开启远程入口')),
      status?.enabled && h(Button,{disabled:busy,onClick:()=>run(()=>call('gateway/disable',{}))},'关闭远程入口'),
      status?.keepAwake?.supported && h(Button, { disabled: busy || !status?.enabled, onClick: () => run(() => call('keep-awake/set', { enabled: !status.keepAwake.enabled })) }, status.keepAwake.enabled ? '关闭防空闲休眠' : '远控期间防止电脑空闲休眠'),
      h(Button, { disabled: busy || !status?.enabled, onClick: invite }, '生成配对二维码'),
      invitation && h('div', null, h('p', null, `邀请有效至 ${new Date(invitation.expiresAt).toLocaleTimeString()}，仅可使用一次。`), h('img', { src: qr, alt: '手机配对二维码', width: 240, height: 240 }), h('input', { readOnly: true, value: invitation.url, 'aria-label': '配对链接' })),
      h('p', null, `中继：${status?.relayState || 'disabled'}`),
      h('h3', null, '设备'),
      ...devices.map(device => h('div', { className: 'mr-device', key: device.deviceId },
        h('strong', null, device.name), h('span', null, device.state === 'pending' ? '等待电脑确认' : `已授权 · ${device.role} · ${device.connected ? '在线' : '未连接'} · ${new Date(device.expiresAt).toLocaleDateString()} 到期`),
        device.state === 'pending' && h(React.Fragment, null,
          h(Button, { disabled: busy, onClick: () => run(() => call('pair/approve', { deviceId: device.deviceId, role: 'viewer' })) }, '只读'),
          h(Button, { disabled: busy, onClick: () => run(() => call('pair/approve', { deviceId: device.deviceId, role: 'operator' })) }, '任务操作'),
          h(Button, { disabled: busy, onClick: () => run(() => call('pair/approve', { deviceId: device.deviceId, role: 'admin' })) }, '完整控制')),
        h(Button, { disabled: busy, onClick: () => run(() => call('devices/revoke', { deviceId: device.deviceId })) }, '撤销设备'))),
      h('p', null, '任务操作设备可读写全部会话。完整控制另含电脑目录及文件读取、设置与动态插件操作。撤销立即断开现有连接。')),
    status?.startupError && h('p', { role: 'alert' }, `远程入口恢复失败：${status.startupError}`),
    h('h3', null, '双端联动'),
    h(Button, { onClick: () => service.setFollow(!service.following) }, service.following ? '退出跟随' : '跟随另一端'),
    h(Button, { onClick: () => service.takeControl().catch(e => setError(e.message)) }, '接管会话与面板联动'),
    h('p', null, service.message),
    remote && h(React.Fragment, null,
      h('h3', null, '后台通知'),
      h('p', null, window.__HARNESS_NATIVE__ ? '请使用 App 顶部「提醒」开启持续任务提醒。安卓限制后台时长，返回 App 后会补齐任务状态。' : notifications?.enabled ? '任务结束、审批和提问会发送通用提醒，通知不含会话正文。' : '通知尚未开启。手机后台暂停网页时，可通过系统推送收到任务提醒。'),
      !window.__HARNESS_NATIVE__ && h(Button, { disabled: busy, onClick: enableNotifications }, '开启此设备通知'),
      notifications?.enabled && h(Button, { disabled: busy, onClick: () => run(async () => { await call('push/unsubscribe'); const registration = await navigator.serviceWorker.ready; await (await registration.pushManager.getSubscription())?.unsubscribe() }) }, '关闭此设备通知')),
    h(CommandReceipts, { service }),
    remote && h(Button, { onClick: async () => { await fetch('/remote/logout', { method: 'POST' }); location.assign('/remote/pair') } }, '退出连接'))
}
function DraftDock({ service, sessionId }) {
  useTick(service)
  React.useEffect(() => { service.ensureClient(sessionId) }, [service, sessionId])
  const client = service.clients.get(sessionId)
  if (service.api.role === 'viewer') return h('p', { className: 'mr-draft', role: 'status' }, '只读设备：可查看会话、输出与文件。')
  if (!client) return null
  const state = client.state
  const act = action => action().catch(e => { client.notice(e.message) })
  return h('div', { className: 'mr-draft' },
    h(SharedFilePicker, { service, client, sessionId }),
    h('span', { role: 'status' }, state.message || '正在同步草稿…'),
    state.status === 'conflict' && h('div', null,
      h(Button, { onClick: () => act(() => client.flush(true)) }, '接管并使用本机草稿'),
      h(Button, { onClick: () => act(() => client.useRemote()) }, '使用共享草稿'),
      state.remote && h('details', null, h('summary', null, '查看共享草稿'), h('pre', null, state.remote.text))),
    state.conflicts.length > 0 && h('details', null, h('summary', null, `保留的冲突副本（${state.conflicts.length}）`), ...state.conflicts.map(copy => h('div', { key: copy.id }, h('pre', null, copy.text), h(Button, { onClick: () => act(async () => { await client.loadAssets(copy); client.apply(copy); client.dirty = true; client.persist(); client.publish({ status: 'conflict', message: '副本已载入，请接管后同步。' }) }) }, '载入副本'), h(Button, { onClick: () => act(async () => { await service.api.call('draft/resolve', { sessionId, conflictId: copy.id }); await client.refresh() }) }, '删除此副本')))))
}
function SharedFilePicker({ service, client, sessionId }) {
  const fileInput = React.useRef(null)
  const importFiles = async files => {
    for (const file of files) {
      if (file.type.startsWith('image/')) {
        if (file.size > 5 * 1024 * 1024) throw Error('单张图片不能超过 5 MiB。')
        const descriptors = service.ctx.conversation.createDraftImages([file])
        if (!client.input.addImages(descriptors.map(d => d.id))) throw Error('输入框忙，请稍后添加图片。')
      } else {
        if (file.size > 1024 * 1024) throw Error('文本文件不能超过 1 MiB。')
        const text = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer())
        if (text.includes('\0') || !text.length) throw Error('请选择非空 UTF-8 文本文件。')
        client.files.replace([...client.files.entries(), { id: crypto.randomUUID(), name: file.name, text }])
        client.onInput()
      }
    }
  }
  const files = client.files?.entries() ?? []
  return h('div', { className: 'mr-files' },
    !client.files?.bridge() && h(React.Fragment, null,
      h(Button, { onClick: () => fileInput.current.click() }, '添加图片或文本文件'),
      h('input', { ref: fileInput, type: 'file', multiple: true, accept: 'image/*,.txt,.md,.json,.csv,.tsv,.log,.diff,.patch', hidden: true, onChange: e => { importFiles([...e.target.files]).catch(error => client.notice(error.message)); e.target.value = '' } }),
      ...files.map(file => h('span', { key: file.id }, file.name, h(Button, { 'aria-label': `移除文件 ${file.name}`, onClick: () => { client.files.replace(files.filter(f => f.id !== file.id)); client.onInput() } }, '移除')))),
      files.length > 0 && !client.input.state.getSnapshot().draft && h(Button, { onClick: () => {
        const session = service.ctx.sessions.binding(sessionId)?.session
        if (session) service.ctx.conversation.sendSession(session, '', [], 'queue').catch(error => client.notice(error.message))
      } }, '发送文件'))
}
function FollowButton({ service, sessionId, useStore, actions }) {
  useTick(service)
  const view = useStore(state => state.view), selection = useStore(state => state.selection)
  React.useEffect(() => {
    service.viewChanged(sessionId, { view, selection, actions })
  }, [service, sessionId, view, selection, actions])
  React.useEffect(() => () => service.views.delete(sessionId), [service, sessionId])
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
    this.ctx = ctx; this.api = new RemoteApi({ remote, clientId }); this.clients = new Map(); this.views = new Map(); this.appliedViews = new Map(); this.listeners = new Set(); this.following = true; this.message = ''; this.followState = null; this.applying = false
  }
  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn) }
  note(message) { this.message = message; this.emit() }
  emit() { for (const fn of this.listeners) fn() }
  current() { return this.ctx.sessions.list.getSnapshot().current ?? null }
  ensureClient(current) {
    if (!current || this.clients.has(current)) return
    const scope = this.ctx.sessions.scope(current)
    if (!scope) return
    this.clients.set(current, new DraftClient({ files: new SharedFiles(this.api, current, message => this.note(message)), images: new SharedImages(this.api, current, this.ctx.conversation, message => this.note(message)), api: this.api, sessionId: current, input: this.ctx.conversation.input.for(scope), storage: sessionStorage, changed: () => this.emit() }))
    this.emit()
  }
  attach() {
    const current = this.current()
    if (!this.applying && current !== this.lastCurrent) {
      this.lastCurrent = current; this.readingState = null
      if (this.following && this.followState) this.publishFollow(false).catch(e => this.note(e.message))
    }
  }
  setFollow(value) { this.following = value; this.note(value ? '跟随已开启' : '独立浏览，不改变另一端位置'); if (value) this.pollFollow() }
  viewChanged(sessionId, value) {
    const previous = this.views.get(sessionId)
    this.views.set(sessionId, value)
    const signature = JSON.stringify({ view: value.view ?? 'chat', selection: value.selection })
    if (previous && signature === JSON.stringify({ view: previous.view ?? 'chat', selection: previous.selection })) return
    if (this.appliedViews.get(sessionId) === signature) { this.appliedViews.delete(sessionId); return }
    if (previous && this.following && sessionId === this.current()) this.publishFollow(false).catch(e => this.note(e.message))
  }
  async publishFollow(takeover, panel) {
    if (this.api.role === 'viewer') { this.note('只读设备可以跟随或独立浏览，不能接管另一端。'); return }
    const current = await this.api.call('follow/read')
    const view = this.views.get(this.current())
    const result = await this.api.call('follow/update', { expectedRevision: current.revision, sessionId: this.current(), panel: panel ?? (view?.view === 'trajectory' ? 'trajectory' : view?.selection ? 'details' : 'chat'), selection: view?.selection ?? null, reading: this.readingState ?? null, takeover })
    if (!result.ok) { this.followState = result.current; this.note('另一设备正在控制联动；点击接管可控制位置，或在设置中退出跟随。'); return }
    this.followState = result.state; this.note('由此设备控制联动')
  }
  async takeControl(panel) { this.following = true; await this.publishFollow(true, panel) }
  async pollFollow() {
    try {
      const state = await this.api.call('follow/read')
      this.followState = state
      if (!this.following || !state.controller || state.controller === this.api.deviceId) return
      this.applying = true
      try {
        if (state.sessionId && this.current() !== state.sessionId && this.ctx.sessions.list.getSnapshot().byId[state.sessionId]) this.ctx.sessions.open(state.sessionId)
        if (state.sessionId === null && this.current()) this.ctx.sessions.clear()
        const view = this.views.get(state.sessionId)
        if (view) {
          const next = { view: state.panel === 'trajectory' ? 'trajectory' : 'chat', selection: state.selection ?? null }
          this.appliedViews.set(state.sessionId, JSON.stringify(next))
          if ((view.view ?? 'chat') !== next.view) view.actions.setView(next.view)
          if (JSON.stringify(view.selection) !== JSON.stringify(next.selection)) view.actions.select(next.selection)
        }
        if (state.panel === 'details') this.ctx.layout.openDetails(); else this.ctx.layout.closeDetails()
        this.applyReading?.(state)
        this.lastCurrent = this.current()
      } finally { this.applying = false }
      this.note('正在跟随另一设备')
    } catch (e) { this.note(e.message) }
  }
  dispose() { for (const client of this.clients.values()) client.dispose(); this.clients.clear(); this.listeners.clear() }
}

export const inject = ['slots', 'sessions', 'conversation', 'layout', 'workspaces']
export function apply(ctx) {
  const service = new SyncService(ctx)
  ctx.effect(() => installReading(service), 'mobile-remote: reading position')
  ctx.effect(() => installExtensions(service), 'mobile-remote: companion plugin state')
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
        const fileText = client && !client.files?.bridge() ? client.files?.serialize(client.submittingSnapshot?.files) : ''
        await originalSend.call(this, session, fileText ? (text ? `${fileText}\n${text}` : fileText) : text, imageIds, mode)
        await client?.afterPrompt(revision, true)
      } catch (error) { await client?.afterPrompt(revision, false); throw error }
    }
    conversation.sendSession = send
    return () => { unsubscribe(); clearInterval(timer); service.dispose(); if (conversation.sendSession === send) conversation.sendSession = originalSend }
  }, 'mobile-remote: input and navigation synchronization')
  ctx.slots.inject('settings.section', () => ctx.slots.register({ name: 'settings.section', id: 'mobile-remote', order: 90, label: () => '手机远程', inject: () => ({ service }) }, Settings))
  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({ name: 'conversation.input.dock', id: 'queue', priority: -20, order: 20, inject: () => ({ service }) }, SharedQueue))
  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({ name: 'conversation.input.dock', id: 'mobile-remote-draft', order: 100, inject: () => ({ service }) }, DraftDock))
  ctx.slots.inject('conversation.session.header.utilities', () => {
    const store = ctx.slots.entries('conversation.session.header')[0]?.store
    if (!store) { service.note('当前会话插件未公开面板状态，面板联动需要适配。'); return }
    return ctx.slots.register({ name: 'conversation.session.header.utilities', id: 'mobile-remote-follow', store, inject: () => ({ service }) }, FollowButton)
  })
  if (remote) {
    ctx.effect(() => installResources(ctx, service), 'mobile-remote: scoped file previews')
    ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: 'mobile-remote-resource', inject: () => ({ service }) }, ResourcePreview))
  }
  if (remote) for (const name of ['conversation.hero.workspace.directoryFlow', 'sidebar.workspaces.directoryFlow']) ctx.slots.inject(name, () => ctx.slots.register({ name, inject: () => ({ service }) }, DirectoryFlow))
}
