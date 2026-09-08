import { browseDirectory } from './directory.js'
import { check } from '../auth/devices.js'
export function sharedOperations({ drafts, follow, commands, store, uploads, push, resources, extensions, queue }) {
  return {
    'queue/update': (p, d) => { check(d.role !== 'viewer', 'read-only', 403); return queue.update(p, d.deviceId) },
    'extensions/read': () => extensions.read(),
    'extensions/mode': (p, d) => { check(d.role !== 'viewer', 'read-only', 403); return extensions.mode(p, d.deviceId) },
    'resource/open': (p, d) => resources.issue(p, d),
    'push/key': () => push.key(),
    'push/status': (p, d) => push.status(d.deviceId),
    'push/subscribe': (p, d) => push.subscribe(d.deviceId, p.subscription),
    'push/unsubscribe': (p, d) => push.remove(d.deviceId),
    'upload/begin': (p, d) => { check(d.role !== 'viewer', 'read-only', 403); return uploads.begin(p, d.deviceId) },
    'upload/chunk': (p, d) => { check(d.role !== 'viewer', 'read-only', 403); return uploads.chunk(p, d.deviceId) },
    'upload/commit': (p, d) => { check(d.role !== 'viewer', 'read-only', 403); return uploads.commit(p, d.deviceId) },
    'upload/read': (p, d) => uploads.read(p, d.deviceId),
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
