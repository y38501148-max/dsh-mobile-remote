import { spawn } from 'node:child_process'
import { check } from '../auth/devices.js'
export class KeepAwake {
  constructor({ platform = process.platform, spawnProcess = spawn } = {}) { this.platform = platform; this.spawnProcess = spawnProcess }
  status() { return { supported: this.platform === 'darwin', enabled: !!this.child, error: this.error } }
  async enable() {
    check(this.platform === 'darwin', 'keep-awake-platform-unsupported', 409)
    if (this.starting) { await this.starting; return this.status() }
    if (this.child) return this.status()
    const child = this.spawnProcess('/usr/bin/caffeinate', ['-i', '-w', String(process.pid)], { stdio: 'ignore' })
    this.child = child; this.error = undefined
    child.once('exit', () => { if (this.child === child) { this.child = null; this.error = '防休眠进程已退出' } })
    const starting = new Promise((resolve, reject) => {
      child.once('spawn', () => { if (this.child !== child) child.kill('SIGTERM'); resolve() })
      child.once('error', error => { if (this.child === child) { this.child = null; this.error = '防休眠启动失败' } reject(error) })
    })
    this.starting = starting
    try { await starting; return this.status() } finally { if (this.starting === starting) this.starting = null }
  }
  disable() { const child = this.child; this.child = null; child?.kill('SIGTERM'); return this.status() }
}
