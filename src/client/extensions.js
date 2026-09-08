export function installExtensions(service) {
  window.__DSH_MOBILE_REMOTE_ACTIVE__ = true
  let applying = false, state, alive = true, inflight = Promise.resolve()
  const apply = next => {
    if (!alive) return
    state = next; applying = true
    try { window.dispatchEvent(new CustomEvent('dsh-mobile-mode-apply', { detail: { mode: next.mode } })) }
    finally { applying = false }
  }
  const refresh = async () => { const next = await service.api.call('extensions/read'); if (!next.error && (!state || next.revision > state.revision)) apply(next) }
  const changed = event => {
    if (applying) return
    const mode = event.detail?.mode
    inflight = inflight.then(async () => {
      if (!state) await refresh()
      if (!state || state.mode === mode) return
      const result = await service.api.call('extensions/mode', { mode, expectedRevision: state.revision })
      if (result.ok) apply(result.state)
      else { if (result.current) apply(result.current); service.note('模式已被另一设备更新，请核对后再次切换。') }
    }).catch(e => service.note(e.message))
  }
  const ready = event => { if (event.detail?.plugin === 'harness-modes' && state) apply(state) }
  window.addEventListener('dsh-mobile-mode-change', changed); window.addEventListener('dsh-mobile-plugin-ready', ready)
  refresh().catch(e => service.note(e.message))
  const timer = setInterval(() => refresh().catch(e => service.note(e.message)), 1500)
  return () => { alive = false; clearInterval(timer); window.removeEventListener('dsh-mobile-mode-change', changed); window.removeEventListener('dsh-mobile-plugin-ready', ready); delete window.__DSH_MOBILE_REMOTE_ACTIVE__ }
}
