const encode = bytes => btoa(String.fromCharCode(...bytes))
const decode = text => Uint8Array.from(atob(text), char => char.charCodeAt(0))
const digest = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(n => n.toString(16).padStart(2, '0')).join('')

export class SharedImages {
  constructor(api, sessionId, conversation, notice, vault = new ImageVault()) { this.api = api; this.sessionId = sessionId; this.conversation = conversation; this.notice = notice; this.uploads = new Map(); this.native = new Map(); this.pending = new Map(); this.vault = vault; this.saved = new Set() }
  snapshot(ids = []) {
    for (const id of ids) if (!this.saved.has(id) && !this.uploads.has(id)) {
      const descriptor = this.conversation.draftImages([id])[0]
      if (descriptor) { this.saved.add(id); this.vault.put(`${this.sessionId}:${id}`, descriptor.file).catch(() => this.notice('图片离线保存失败，请保持本页直到上传完成。')) }
    }
    return ids.map(id => this.uploads.get(id) ?? `local:${id}`)
  }
  async upload(id) {
    if (this.uploads.has(id)) return this.uploads.get(id)
    if (this.pending.has(id)) return this.pending.get(id)
    const operation = (async () => {
      const nativeId = this.native.get(`local:${id}`) ?? id
      const descriptor = this.conversation.draftImages([nativeId])[0]
      if (!descriptor) throw Error('本机图片已不可用，请重新选择附件。')
      const { file } = descriptor
      const bytes = new Uint8Array(await file.arrayBuffer())
      const sha256 = await digest(bytes)
      const entry = await this.api.call('upload/begin', { sessionId: this.sessionId, name: file.name, type: file.type, size: file.size, uploadKey: `${id}:${sha256}` })
      if (entry.error) throw Error(entry.error)
      for (let offset = entry.offset; offset < bytes.length; offset += 32768) {
        this.notice(`正在同步图片 ${Math.floor(offset / bytes.length * 100)}%`)
        const result = await this.api.call('upload/chunk', { id: entry.id, offset, data: encode(bytes.subarray(offset, offset + 32768)) })
        if (result.error) throw Error(result.error)
      }
      const result = await this.api.call('upload/commit', { id: entry.id, sha256 })
      if (result.error) throw Error(result.error)
      this.uploads.set(id, entry.id); this.uploads.set(nativeId, entry.id); this.native.set(entry.id, nativeId)
      await this.vault.delete(`${this.sessionId}:${id}`)
      return entry.id
    })()
    this.pending.set(id, operation)
    try { return await operation } finally { this.pending.delete(id) }
  }
  async prepare(content) {
    return { ...content, attachments: await Promise.all((content.attachments ?? []).map(id => id.startsWith('local:') ? this.upload(id.slice(6)) : id)) }
  }
  async load(content) {
    for (const id of content.attachments ?? []) {
      if (this.native.has(id)) continue
      if (id.startsWith('local:')) {
        const file = await this.vault.get(`${this.sessionId}:${id.slice(6)}`)
        if (!file) throw Error('未完成同步的本机图片需要重新选择，文字副本仍已保留。')
        const descriptor = this.conversation.createDraftImages([file])[0]
        this.native.set(id, descriptor.id); this.uploads.set(descriptor.id, id); continue
      }
      const parts = []; let offset = 0, entry
      do {
        entry = await this.api.call('upload/read', { sessionId: this.sessionId, id, offset })
        if (entry.error) throw Error(entry.error)
        if (entry.state !== 'ready') throw Error('另一设备仍在上传图片。')
        const bytes = decode(entry.data)
        if (!bytes.length) throw Error('图片下载中断，请重新同步。')
        parts.push(bytes); offset += bytes.length
      } while (offset < entry.size)
      const file = new File(parts, entry.name, { type: entry.type })
      if (await digest(await file.arrayBuffer()) !== entry.sha256) throw Error('图片校验失败，请重新同步。')
      const descriptor = this.conversation.createDraftImages([file])[0]
      this.uploads.set(descriptor.id, id); this.native.set(id, descriptor.id)
    }
  }
  apply(content, input) {
    const ids = (content.attachments ?? []).map(id => this.native.get(id)).filter(Boolean)
    if (ids.length !== (content.attachments ?? []).length) throw Error('图片尚未下载，请重新同步草稿。')
    if (JSON.stringify(input.state.getSnapshot().imageIds ?? []) === JSON.stringify(ids)) return
    for (const id of input.state.getSnapshot().imageIds ?? []) input.removeImage(id)
    if (ids.length && !input.addImages(ids)) throw Error('输入框忙，请稍后恢复图片。')
  }
}
import { ImageVault } from './image-vault.js'
