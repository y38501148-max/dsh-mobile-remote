import { mkdirSync, readFileSync, openSync, writeFileSync, fsyncSync, closeSync, renameSync, unlinkSync } from 'node:fs'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'

// Persist-before-publish. Sync fsync keeps the small control-plane transaction
// indivisible relative to other requests in this process. One Host owns a store.
export class StateStore {
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
  read() { return structuredClone(this.value) }
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
