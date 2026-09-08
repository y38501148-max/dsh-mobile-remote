import { randomUUID, createHash } from 'node:crypto'
import { mkdirSync, openSync, closeSync, writeSync, fsyncSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { check } from '../auth/devices.js'

const TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
export class Uploads {
  constructor(store) { this.store = store; this.directory = store.path && `${store.path}.uploads`; if (this.directory) mkdirSync(this.directory, { recursive: true, mode: 0o700 }) }
  get(id) { check(typeof id === 'string' && /^[0-9a-f-]{36}$/.test(id), 'invalid-upload'); const entry = this.store.read().uploads?.[id]; check(entry, 'unknown-upload', 404); return entry }
  begin({ sessionId, name, type, size }, deviceId) {
    check(this.directory, 'persistent-state-required', 409)
    check(typeof sessionId === 'string' && sessionId.length > 0 && sessionId.length <= 256, 'invalid-session')
    check(typeof name === 'string' && name.length <= 255 && TYPES.has(type), 'unsupported-image')
    check(Number.isSafeInteger(size) && size > 0 && size <= 5 * 1024 * 1024, 'image-too-large', 413)
    const entries = Object.values(this.store.read().uploads ?? {})
    check(entries.length < 512 && entries.reduce((sum, e) => sum + e.size, 0) + size <= 128 * 1024 * 1024, 'upload-storage-full', 507)
    const entry = { id: randomUUID(), sessionId, deviceId, name, type, size, offset: 0, state: 'uploading', at: Date.now() }
    const fd = openSync(join(this.directory, entry.id + '.part'), 'wx', 0o600); closeSync(fd)
    this.store.update(value => { value.uploads ??= {}; value.uploads[entry.id] = entry })
    return entry
  }
  chunk({ id, offset, data }, deviceId) {
    const entry = this.get(id)
    check(entry.deviceId === deviceId && entry.state === 'uploading', 'upload-not-owned', 403)
    check(typeof data === 'string' && data.length <= 44000 && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data), 'invalid-chunk')
    const bytes = Buffer.from(data, 'base64')
    check(offset === entry.offset && bytes.length > 0 && offset + bytes.length <= entry.size, 'upload-offset-mismatch', 409)
    const fd = openSync(join(this.directory, id + '.part'), 'r+')
    try { writeSync(fd, bytes, 0, bytes.length, offset); fsyncSync(fd) } finally { closeSync(fd) }
    this.store.update(value => { value.uploads[id].offset = offset + bytes.length })
    return this.get(id)
  }
  commit({ id, sha256 }, deviceId) {
    const entry = this.get(id)
    check(entry.deviceId === deviceId, 'upload-not-owned', 403)
    if (entry.state === 'ready') { check(entry.sha256 === sha256, 'upload-hash-mismatch', 409); return entry }
    check(entry.offset === entry.size, 'upload-incomplete', 409)
    const path = join(this.directory, id + '.part'), bytes = readFileSync(path)
    check(bytes.length === entry.size && createHash('sha256').update(bytes).digest('hex') === sha256, 'upload-hash-mismatch', 409)
    const valid = entry.type === 'image/png' ? bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) : entry.type === 'image/jpeg' ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 : entry.type === 'image/gif' ? /^GIF8[79]a$/.test(bytes.subarray(0, 6).toString()) : bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP'
    check(valid, 'invalid-image')
    // Keep one stable filename so a crash between file fsync and state commit
    // cannot strand a completed upload under an unrecorded name.
    this.store.update(value => { value.uploads[id].state = 'ready'; value.uploads[id].sha256 = sha256 })
    return this.get(id)
  }
  validate(ids, sessionId) {
    check(Array.isArray(ids) && ids.length <= 20 && new Set(ids).size === ids.length, 'invalid-attachments')
    for (const id of ids) { const entry = this.get(id); check(entry.sessionId === sessionId && entry.state === 'ready', 'attachment-not-ready-or-wrong-session', 403) }
  }
  read({ id, sessionId, offset = 0 }, deviceId) {
    const entry = this.get(id)
    check(entry.sessionId === sessionId && (entry.state === 'ready' || entry.deviceId === deviceId), 'upload-not-authorized', 403)
    check(Number.isSafeInteger(offset) && offset >= 0 && offset <= entry.offset, 'invalid-offset')
    const bytes = readFileSync(join(this.directory, id + '.part')).subarray(offset, Math.min(entry.offset, offset + 32768))
    return { ...entry, data: bytes.toString('base64') }
  }
}
