import { browseDirectory } from './directory.js'
import { check } from '../auth/devices.js'
export function sharedOperations({ drafts, follow, commands, store }) {
  return {
    'directory/list': (p, device) => { check(device.role === 'admin', 'admin-required', 403); return browseDirectory(p.path) },
    'draft/read': (p, device) => drafts.read(p.sessionId),
    'draft/write': (p, device) => { check(device.role !== 'viewer', 'read-only', 403); return drafts.write({ ...p, deviceId: device.deviceId }) },
    'draft/lease': (p, device) => { check(device.role !== 'viewer', 'read-only', 403); return drafts.acquire(p.sessionId, device.deviceId, p.takeover === true) },
    'draft/clear': (p, device) => { check(device.role !== 'viewer', 'read-only', 403); return drafts.clear(p.sessionId, p.expectedRevision, device.deviceId) },
    'draft/preserve': (p, device) => { check(device.role !== 'viewer', 'read-only', 403); return drafts.preserve({ ...p, deviceId: device.deviceId }) },
    'draft/resolve': (p, device) => { check(device.role !== 'viewer', 'read-only', 403); return drafts.resolve(p.sessionId, p.conflictId) },
    'follow/read': () => follow.read(),
    'follow/update': (p, device) => { check(device.role !== 'viewer', 'read-only', 403); return follow.update({ ...p, deviceId: device.deviceId }) },
    'commands/list': (p, device) => ({ commands: commands.list(device.deviceId) }),
  }
}
