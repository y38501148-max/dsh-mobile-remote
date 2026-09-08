// Runs before the existing Harness modules. Reuses their state and renderer.
(() => {
  window.__DSH_REMOTE__ = true
  const originalFetch = window.fetch.bind(window)
  let session
  const ready = originalFetch('/remote/session').then(async response => {
    if (!response.ok) { location.replace('/remote/pair'); throw Error('device authorization required') }
    session = await response.json(); if (session.protocolVersion !== 1) throw Error('手机协议版本不兼容，请刷新或更新插件。'); return session
  })
  document.addEventListener('beforeinput', event => { if (session?.role === 'viewer' && event.target.closest?.('[data-composer-seat]')) event.preventDefault() }, true)
  const writeMethods = new Set(WRITE_METHODS_PLACEHOLDER)
  const pluginWrites = new Set(PLUGIN_WRITES_PLACEHOLDER)
  window.fetch = async (input, options) => {
    const request = new Request(input, options)
    const url = new URL(request.url)
    if (url.origin === location.origin && request.method === 'POST' && (writeMethods.has(url.pathname.slice(5)) || pluginWrites.has(url.pathname))) {
      await ready
      const headers = new Headers(request.headers)
      headers.set('x-dsh-host-epoch', session.hostEpoch)
      headers.set('x-dsh-mobile-protocol', '1')
      if (pluginWrites.has(url.pathname) && !headers.has('x-dsh-command-id')) headers.set('x-dsh-command-id', crypto.randomUUID())
      const response = await originalFetch(new Request(request, { headers }))
      if (response.status === 401) location.assign('/remote/pair')
      if (response.status === 409) {
        const error = await response.clone().json().catch(() => ({}))
        if (error.error === 'outcome-unknown') announce('操作结果待确认。请核对会话和队列，勿重复发送。')
        if (error.error === 'host-epoch-mismatch') announce('电脑 Host 已重新加载。请保留输入并刷新页面。')
      }
      return response
    }
    return originalFetch(request)
  }
  let label
  function announce(text) {
    if (!label) {
      label = document.createElement('div'); label.id = 'dsh-remote-status'; label.setAttribute('role', 'status')
      Object.assign(label.style, { pointerEvents: 'none', position: 'fixed', bottom: 'env(safe-area-inset-bottom, 0px)', left: '0', right: '0', padding: '8px', background: '#28334c', color: 'white', zIndex: '10000', textAlign: 'center', font: '13px system-ui' })
      document.body.append(label)
    }
    label.textContent = text; label.hidden = false
  }
  window.addEventListener('offline', () => announce('已离线。输入请保留，网络恢复后会重新同步。'))
  window.addEventListener('online', () => announce('网络已恢复，正在等待 Host 同步。'))
  const NativeWebSocket = window.WebSocket
  const channels = new Map()
  window.WebSocket = class extends NativeWebSocket {
    constructor(url, protocols) {
      super(url, protocols)
      const path = new URL(url, location.href).pathname
      if (!['/api/events.mux', '/api/events.host'].includes(path)) return
      channels.set(path, false)
      this.addEventListener('open', () => { channels.set(path, true); if (channels.size === 2 && [...channels.values()].every(Boolean) && label) label.hidden = true })
      this.addEventListener('close', () => { channels.set(path, false); announce('与电脑连接中断，正在恢复；未确认的操作不会自动重发。') })
    }
  }
  const meta = document.querySelector('meta[name=viewport]')
  if (meta) meta.content = 'width=device-width,initial-scale=1,viewport-fit=cover'
  const style = document.createElement('style')
  style.textContent = `@media(max-width:700px){body{overscroll-behavior:none}input,textarea,select{font-size:16px!important}button{min-height:36px}body{padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)}pre{max-width:100%;overflow:auto}img{max-width:100%}}`
  document.head.append(style)
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/remote/sw.js', { scope: '/' }).catch(() => {})
})()
