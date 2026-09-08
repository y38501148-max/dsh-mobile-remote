// Exact-source adapters for the user's rc.6 companion plugins. Work on a
// copied plugin tree; fail visibly on source drift instead of guessing edits.
function replaceOnce(source, before, after) {
  if (!source.includes(before) || source.indexOf(before) !== source.lastIndexOf(before)) throw Error('Companion plugin source changed; adapter needs review')
  return source.replace(before, after)
}
export function adaptModes(source) {
  if (source.includes('dsh-mobile-mode-change')) return source
  source = replaceOnce(source, "'subagent-catalog': 'conversation.session.header.tabs.actions'", "'subagent-catalog': 'conversation.session.header.utilities'")
  source = replaceOnce(source, '    }, entry.component)', '      ...entry.store === undefined ? {} : { store: entry.store },\n    }, entry.component)')
  source = replaceOnce(source, '  mode = next\n', "  mode = next\n  window.dispatchEvent(new CustomEvent('dsh-mobile-mode-change', { detail: { mode: next } }))\n")
  source = replaceOnce(source, '    buildModeSwitch()\n', `    const remoteMode = event => {
      if (!['work', 'chat'].includes(event.detail?.mode)) return
      setMode(event.detail.mode)
      syncModeSwitch()
    }
    window.addEventListener('dsh-mobile-mode-apply', remoteMode)
    window.dispatchEvent(new CustomEvent('dsh-mobile-plugin-ready', { detail: { plugin: 'harness-modes', version: 1 } }))
    buildModeSwitch()
`)
  source = replaceOnce(source, '      document.removeEventListener(\'click\', onDocumentClickCapture, true)\n', "      window.removeEventListener('dsh-mobile-mode-apply', remoteMode)\n      document.removeEventListener('click', onDocumentClickCapture, true)\n")
  return source
}
export function adaptTextFiles(source) {
  if (source.includes('dsh-mobile-files-change')) return source
  source = replaceOnce(source, 'function emitPendingTextFiles() {\n', "function emitPendingTextFiles() {\n  window.dispatchEvent(new CustomEvent('dsh-mobile-files-change'))\n")
  source = replaceOnce(source, 'function apply(ctx) {\n', `function apply(ctx) {
  window.__DSH_MOBILE_PLUGIN_BRIDGES__ ??= {}
  const filesBridge = {
    version: 1,
    read: sessionId => pendingTextFilesOf(sessionId),
    replace: (sessionId, files) => {
      if (files.length) pendingTextFiles.set(sessionId, files)
      else pendingTextFiles.delete(sessionId)
      emitPendingTextFiles()
    },
  }
  window.__DSH_MOBILE_PLUGIN_BRIDGES__['ui-tweaks'] = filesBridge
  ctx.effect(() => () => { if (window.__DSH_MOBILE_PLUGIN_BRIDGES__?.['ui-tweaks'] === filesBridge) delete window.__DSH_MOBILE_PLUGIN_BRIDGES__['ui-tweaks'] })
  window.dispatchEvent(new CustomEvent('dsh-mobile-plugin-ready', { detail: { plugin: 'ui-tweaks', version: 1 } }))
`)
  source = replaceOnce(source, '  pendingTextFiles.delete(sessionId)\n  emitPendingTextFiles()\n  return list\n', '  // Shared draft owner removes only accepted files after Host admission.\n  if (!window.__DSH_MOBILE_REMOTE_ACTIVE__) { pendingTextFiles.delete(sessionId); emitPendingTextFiles() }\n  return list\n')
  return source
}
