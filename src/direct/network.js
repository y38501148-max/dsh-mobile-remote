import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { isIP } from 'node:net'
const exec = promisify(execFile)
export function globalIPv6(address) {
  if (isIP(address) !== 6) return false
  const first = parseInt(address.split(':')[0], 16)
  return first >= 0x2000 && first <= 0x3fff && !address.toLowerCase().startsWith('2001:db8:')
}
export function parseIfconfig(text) {
  const result = []; let name
  for (const line of text.split('\n')) {
    const head = /^([a-zA-Z0-9_.-]+):/.exec(line); if (head) name = head[1]
    const match = /\binet6\s+([^\s%]+)(?:%[^\s]+)?\s/.exec(line)
    if (match && name && globalIPv6(match[1]) && !/\b(temporary|deprecated|tentative|duplicated)\b/.test(line)) result.push({ interface: name, address: match[1].toLowerCase() })
  }
  return result
}
export async function addresses() {
  if (process.platform === 'darwin') return parseIfconfig((await exec('/sbin/ifconfig', [], { timeout: 5000, maxBuffer: 256 * 1024 })).stdout)
  if (process.platform === 'linux') {
    const { stdout } = await exec('ip', ['-j','-6','address','show'], { timeout: 5000, maxBuffer: 256 * 1024 })
    return JSON.parse(stdout).flatMap(n => (n.addr_info ?? []).filter(a => globalIPv6(a.local) && !a.temporary && !a.deprecated && !a.tentative && !(a.flags ?? []).some(f => ['temporary','deprecated','tentative'].includes(f)) && a.preferred_life_time !== 0).map(a => ({ interface: n.ifname, address: a.local.toLowerCase() })))
  }
  throw Error('ipv6-discovery-unsupported-platform')
}
