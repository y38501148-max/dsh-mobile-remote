import { mkdirSync, readFileSync, openSync, writeFileSync, fsyncSync, closeSync, renameSync, unlinkSync } from 'node:fs'
import lockfile from 'proper-lockfile'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'

// Persist-before-publish. Sync fsync keeps the small control-plane transaction
// indivisible relative to other requests in this process. One Host owns a store.
export class StateStore {
  static async acquire(path) {
    if (!path) return new StateStore()
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
    let store
    const release = await lockfile.lock(path, { realpath: false, stale: 10000, update: 2000, retries: { retries: 12, minTimeout: 250, maxTimeout: 1000 }, onCompromised: error => { if (store) { store.fault = error; store.onFault?.(error) } } })
    try { store = new StateStore(path); store.release = release; return store } catch (error) { await release(); throw error }
  }
  async close() { this.closed = true; if (this.release) { const release = this.release; this.release = null; await release() } }
  constructor(path) {
    this.path = path
    this.value = { version: 1, devices: [], drafts: {}, commands: {}, audit: [] }
    if (path) {
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
      try {
        const value = JSON.parse(readFileSync(path, 'utf8'))
        if (value.version !== 1 || !Array.isArray(value.devices) || !value.drafts || !value.commands || !Array.isArray(value.audit)) throw Error('unsupported or damaged mobile remote state')
        this.value = value
      } catch (error) { if (error.code !== 'ENOENT') throw error }
    }
  }
  read() { if (this.closed) throw Error('mobile-remote-state-closed'); if (this.fault) throw Error('mobile-remote-state-ownership-lost'); return structuredClone(this.value) }
  update(change) {
    const candidate = this.read()
    const result = change(candidate)
    if (this.path) {
      const temp = `${this.path}.${randomUUID()}.tmp`
      let fd
      try {
        fd = openSync(temp, 'wx', 0o600)
        writeFileSync(fd, JSON.stringify(candidate)); fsyncSync(fd); closeSync(fd); fd = undefined
        renameSync(temp, this.path)
        const directory = openSync(dirname(this.path), 'r')
        try { fsyncSync(directory) } finally { closeSync(directory) }
      } finally {
        if (fd !== undefined) closeSync(fd)
        try { unlinkSync(temp) } catch (error) { if (error.code !== 'ENOENT') throw error }
      }
    }
    this.value = candidate
    return result
  }
  audit(event) {
    this.update(value => {
      value.audit.push({ at: Date.now(), ...event })
      value.audit = value.audit.slice(-1000)
    })
  }
}
