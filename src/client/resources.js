import React from 'react'
const h = React.createElement
export function ResourcePreview({ service }) {
  const [, tick] = React.useReducer(n => n + 1, 0)
  const [text, setText] = React.useState(null), [error, setError] = React.useState('')
  React.useEffect(() => service.subscribe(tick), [service])
  const resource = service.resource
  React.useEffect(() => {
    setText(null); setError('')
    const abort = new AbortController()
    if (resource?.type.startsWith('text/') && resource.size <= 2 * 1024 * 1024) fetch(resource.url, { signal: abort.signal }).then(async response => { if (!response.ok) throw Error('预览已过期或文件已变化，请重新打开。'); setText(await response.text()) }).catch(error => { if (!abort.signal.aborted) setError(error.message) })
    return () => abort.abort()
  }, [resource])
  if (!resource && service.resourceError) return h('div', { className: 'mr-modal-backdrop', style: { pointerEvents: 'auto' } }, h('section', { className: 'mr-modal', role: 'alertdialog', 'aria-label': '文件打开失败' }, h('p', null, service.resourceError), h('button', { className: 'mr-button', onClick: () => { service.resourceError = null; service.emit() } }, '关闭')))
  if (!resource) return null
  const close = () => { service.resource = null; service.emit() }
  let content
  if (resource.type.startsWith('image/')) content = h('img', { src: resource.url, alt: resource.name, style: { maxWidth: '100%', maxHeight: '65dvh', objectFit: 'contain' } })
  else if (resource.type.startsWith('video/')) content = h('video', { src: resource.url, controls: true, style: { width: '100%', maxHeight: '65dvh' } })
  else if (resource.type.startsWith('audio/')) content = h('audio', { src: resource.url, controls: true })
  else if (text !== null) content = h('pre', { style: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: '65dvh', overflow: 'auto' } }, text)
  else content = h('p', null, resource.size > 2 * 1024 * 1024 ? '文件较大，请下载查看。' : resource.type.startsWith('text/') ? '正在读取…' : '此文件可下载后在手机应用中查看。')
  return h('div', { className: 'mr-modal-backdrop', style: { pointerEvents: 'auto' } }, h('section', { className: 'mr-modal', role: 'dialog', 'aria-modal': true, 'aria-label': '文件预览' }, h('h2', null, resource.name), content, error && h('p', { role: 'alert' }, error), h('a', { className: 'mr-button', href: resource.url, download: resource.name }, '下载文件'), h('button', { className: 'mr-button', onClick: close }, '关闭')))
}
export function installResources(ctx, service) {
  const original = ctx.workspaces.openPath
  const open = async path => {
    const result = await service.api.call('resource/open', { sessionId: service.current(), path })
    if (result.error) throw Error(result.error)
    service.resourceError = null; service.resource = result; service.emit()
  }
  ctx.workspaces.openPath = open
  const click = event => {
    const link = event.target.closest?.('a[href]')
    if (!link || event.defaultPrevented) return
    const raw = link.getAttribute('href')
    if (!raw || (!raw.startsWith('file:') && !raw.startsWith('/'))) return
    if (/^\/(?:api|remote|assets|plugins)\//.test(raw)) return
    event.preventDefault(); event.stopPropagation()
    let path
    try { path = raw.startsWith('file:') ? decodeURIComponent(new URL(raw).pathname) : decodeURIComponent(raw) } catch { return }
    open(path).catch(e => { service.resourceError = `文件打开失败：${e.message}`; service.emit() })
  }
  const seen = new WeakMap()
  const adaptImage = async element => {
    const raw = element.getAttribute('src'), sessionId = service.current()
    if (!sessionId || !raw || seen.get(element) === raw || (!raw.startsWith('file:') && !raw.startsWith('/')) || /^\/(?:api|remote|assets|plugins)\//.test(raw)) return
    seen.set(element, raw)
    try {
      const path = raw.startsWith('file:') ? decodeURIComponent(new URL(raw).pathname) : decodeURIComponent(raw)
      const result = await service.api.call('resource/open', { sessionId, path })
      if (result.error) throw Error(result.error)
      if (element.getAttribute('src') === raw && service.current() === sessionId) { seen.set(element, result.url); element.src = result.url }
    } catch { element.alt = `${element.alt || '图片'}（暂不可读取，点击文件链接查看原因）` }
  }
  const scan = node => { if (node instanceof Element) { if (node.matches('img')) adaptImage(node); node.querySelectorAll('img').forEach(adaptImage) } }
  const observer = new MutationObserver(records => { for (const record of records) { if (record.type === 'attributes') adaptImage(record.target); else record.addedNodes.forEach(scan) } })
  observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['src'] }); scan(document.body)
  document.addEventListener('click', click, true)
  return () => { observer.disconnect(); document.removeEventListener('click', click, true); if (ctx.workspaces.openPath === open) ctx.workspaces.openPath = original }
}
