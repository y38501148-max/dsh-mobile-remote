// rc.6 exposes stable chat anchors and the conversation scrollport. Observe
// user UI events only; business state continues through the native client.
export function installReading(service) {
  let timer, suppressUntil = 0, intentUntil = 0, applied = 0
  const scrollport = () => document.querySelector('[data-conversation-scroll]')
  const capture = () => {
    const port = scrollport(); if (!port) return null
    const top = port.getBoundingClientRect().top
    const rows = [...port.querySelectorAll('[data-chat-anchor-key]')]
    const row = rows.find(e => e.getBoundingClientRect().bottom > top)
    return { anchor: row?.dataset.chatAnchorKey ?? null, offset: row ? row.getBoundingClientRect().top - top : 0, ratio: Math.max(0, Math.min(1, port.scrollTop / Math.max(1, port.scrollHeight - port.clientHeight))),
      expanded: rows.flatMap(row => [...row.querySelectorAll('[aria-expanded]')].map((el, index) => ({ anchor: row.dataset.chatAnchorKey, index, open: el.getAttribute('aria-expanded') === 'true' }))).slice(0, 128) }
  }
  const intent = event => { if (scrollport()?.contains(event.target)) intentUntil = Date.now() + 2000 }
  const changed = event => {
    if (!service.following || service.applying || Date.now() < suppressUntil) return
    const port = scrollport(); if (!port || (event.type === 'scroll' ? event.target !== port : !port.contains(event.target))) return
    if (event.type === 'click' && !event.target.closest('[aria-expanded]')) return
    if (event.type === 'scroll' && Date.now() > intentUntil) return
    clearTimeout(timer); timer = setTimeout(() => {
      service.readingState = capture(); service.publishFollow(false).catch(e => service.note(e.message))
    }, 250)
  }
  service.applyReading = state => {
    if (!state.reading || applied === state.revision || state.sessionId !== service.current()) return
    const port = scrollport(); if (!port) return
    clearTimeout(timer); intentUntil = 0
    applied = state.revision; suppressUntil = Date.now() + 600
    const rows = [...port.querySelectorAll('[data-chat-anchor-key]')]
    for (const value of state.reading.expanded) {
      const row = rows.find(e => e.dataset.chatAnchorKey === value.anchor)
      const el = row?.querySelectorAll('[aria-expanded]')[value.index]
      if (el && (el.getAttribute('aria-expanded') === 'true') !== value.open) el.click()
    }
    requestAnimationFrame(() => {
      if (state.sessionId !== service.current()) return
      const row = rows.find(e => e.dataset.chatAnchorKey === state.reading.anchor)
      port.scrollTop = row ? port.scrollTop + row.getBoundingClientRect().top - port.getBoundingClientRect().top - state.reading.offset : state.reading.ratio * Math.max(0, port.scrollHeight - port.clientHeight)
    })
  }
  for (const type of ['wheel', 'touchmove', 'pointerdown', 'keydown']) document.addEventListener(type, intent, true)
  document.addEventListener('scroll', changed, true); document.addEventListener('click', changed, true)
  return () => { for (const type of ['wheel', 'touchmove', 'pointerdown', 'keydown']) document.removeEventListener(type, intent, true); clearTimeout(timer); delete service.applyReading; document.removeEventListener('scroll', changed, true); document.removeEventListener('click', changed, true) }
}
