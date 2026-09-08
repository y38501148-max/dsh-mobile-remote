import { check } from '../auth/devices.js'

// Checked against rc.6 carrier contracts. Unknown routes stay closed even for
// administrators; adding a plugin requires an explicit adapter entry.
export const READ_METHODS = new Set([
  'session.list', 'session.history', 'session.attachment', 'session.models', 'session.search',
  'workspace.list', 'host.describe', 'agentPreset.list', 'llm.providers', 'llm.models',
  'skill.list', 'subagent.list', 'subagent.history', 'credentials.describe',
  'commands/list', 'pluginInventory/list', 'messageFeedback/list',
  'projectFiles/search', 'settings.describe',
])
export const WRITE_METHODS = new Set([
  'session.create', 'session.prompt', 'session.cancel', 'session.rename', 'session.fork',
  'session.updateQueue', 'session.selectModel', 'subagent.prompt', 'subagent.interrupt',
  'workspace.create', 'workspace.rename', 'workspace.delete', 'workspace.insertBefore',
  'workspace.insertSessionBefore', 'workspace.archiveSession', 'agentPreset.select', 'respond',
  'goal.create', 'goal.edit', 'goal.pause', 'goal.resume', 'goal.complete', 'goal.clear',
  'commands/execute', 'goals/clear', 'goals/complete', 'goals/create', 'goals/edit', 'goals/pause', 'goals/resume',
  'messageFeedback/delete', 'messageFeedback/put',
])
export const ADMIN_METHODS = new Set([
  'agentPreset.read', 'agentPreset.copy', 'agentPreset.remove', 'agentPreset.openDocument',
  'host.openPath', 'host.pickDirectory', 'host.listDirectory', 'host.createDirectory',
  'settings.update', 'settings.replace', 'settings.mutate',
  'settings.openDocument', 'llm.discoverModels',
  'dynamicCordisRunner/getClientCode', 'dynamicCordisRunner/inventory', 'dynamicCordisRunner/invoke',
  'dynamicCordisRunner/reportClientGuardFailure', 'dynamicCordisRunner/reportRenderFailure',
  'dynamicCordisRunner/resolveInspectQuery', 'dynamicCordisRunner/resolveRequestRun',
  'dynamicCordisRunner/runHostHalf', 'dynamicCordisRunner/settleUserRun',
  'dynamicCordisRunner/stopFromPanel', 'dynamicCordisRunner/syncInspectManifest', 'dynamicCordisRunner/undefineFromPanel',
])
export const STREAM_PATHS = new Set(['/api/events.mux', '/api/events.host'])
export function canonicalPath(raw) {
  check(typeof raw === 'string' && raw.startsWith('/') && !raw.startsWith('//') && !/[\\\x00-\x20]/.test(raw), 'invalid-path', 400)
  const path = raw.split('?')[0]
  check(!/%(?:2e|2f|5c|00)/i.test(path) && !path.split('/').some(p => p === '.' || p === '..'), 'invalid-path', 400)
  return path
}
export function authorizeRoute(raw, method, role) {
  const path = canonicalPath(raw)
  if (STREAM_PATHS.has(path)) return method === 'GET' ? { kind: 'stream' } : undefined
  if (path === '/api/session.export' && ['GET', 'HEAD'].includes(method)) return { kind: 'asset' }
  if (path.startsWith('/api/')) {
    const rpc = path.slice(5)
    if (method !== 'POST') return undefined
    if (rpc === 'settings.mutate' && role !== 'admin') return { kind: 'rpc', rpc, write: true, guard: 'onboarding' }
    if (READ_METHODS.has(rpc)) return { kind: 'rpc', rpc, write: false }
    if (WRITE_METHODS.has(rpc) && role !== 'viewer') return { kind: 'rpc', rpc, write: true }
    if (ADMIN_METHODS.has(rpc) && role === 'admin') return { kind: 'rpc', rpc, write: true }
    return undefined
  }
  if (method !== 'GET' && method !== 'HEAD') return undefined
  if (path === '/' || path === '/index.html' || path === '/favicon.ico' || path === '/favicon.svg' || /^\/assets\/[a-zA-Z0-9_.\/-]+$/.test(path) || /^\/plugins\/[a-zA-Z0-9_@.\/-]+\/(?:client\.js|client\.css)$/.test(path)) return { kind: 'asset' }
  return undefined
}

export function validateRoutePayload(route, envelope) {
  if (route.guard !== 'onboarding') return
  const p = envelope.payload, op = p?.ops?.[0]
  check(p?.ns === 'ui-onboarding' && Array.isArray(p.ops) && p.ops.length === 1 && op?.op === 'set' && Array.isArray(op.path) && op.path.length === 1 && op.path[0] === 'welcomeNoticeVersion' && op.value === '2026-08-13.1' && Object.keys(op).length === 3, 'settings-write-not-authorized', 403)
}
