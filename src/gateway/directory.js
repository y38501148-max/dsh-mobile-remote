import { readdir, realpath, stat } from 'node:fs/promises'
import { dirname, join, isAbsolute } from 'node:path'
import { check, ProtocolError } from '../auth/devices.js'
export async function browseDirectory(path = process.cwd()) {
  check(typeof path === 'string' && path.length <= 4096 && isAbsolute(path), 'absolute-directory-required')
  try {
    const resolved = await realpath(path)
    check((await stat(resolved)).isDirectory(), 'not-a-directory')
    const entries = await readdir(resolved, { withFileTypes: true })
    const directories = entries.filter(entry => entry.isDirectory() && !entry.name.startsWith('.')).sort((a, b) => a.name.localeCompare(b.name))
    return { path: resolved, parent: dirname(resolved), directories: directories.slice(0, 1000).map(entry => ({ name: entry.name, path: join(resolved, entry.name) })), truncated: directories.length > 1000 }
  } catch (error) { if (error instanceof ProtocolError) throw error; throw new ProtocolError('directory-unreadable', 403) }
}
