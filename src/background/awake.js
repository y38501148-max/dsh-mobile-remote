import { spawn } from 'node:child_process'
import { check } from '../auth/devices.js'
export class KeepAwake {
  status() { return { supported: process.platform === 'darwin', enabled: !!this.child, error: this.error } }
  async enable() {
    check(process.platform === 'darwin', 'keep-awake-platform-unsupported', 409)
    if (this.child) return this.status()
    const child = spawn('/usr/bin/caffeinate', ['-i', '-w', String(process.pid)], { stdio: 'ignore' })
    await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject) })
    this.child = child; this.error = undefined
    child.once('exit', () => { if (this.child === child) { this.child = null; this.error = '防休眠进程已退出' } })
    return this.status()
  }
  disable() { const child = this.child; this.child = null; child?.kill('SIGTERM'); return this.status() }
}
