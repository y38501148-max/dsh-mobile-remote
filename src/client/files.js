import { ImageVault } from './image-vault.js'
const digest = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(n => n.toString(16).padStart(2,'0')).join('')
export class SharedFiles {
  constructor(api, sessionId, notice, vault = new ImageVault()) { this.api = api; this.sessionId = sessionId; this.notice = notice; this.vault = vault; this.local = []; this.refs = new Map(); this.loaded = new Map(); this.saved = new Set() }
  bridge() { return globalThis.__DSH_MOBILE_PLUGIN_BRIDGES__?.['ui-tweaks'] }
  entries() { return this.bridge()?.read(this.sessionId) ?? this.local }
  replace(entries) { if (this.bridge()) this.bridge().replace(this.sessionId, entries); else this.local = entries }
  snapshot() {
    return this.entries().map(entry => {
      if (!this.refs.has(entry.id) && !this.saved.has(entry.id)) {
        this.saved.add(entry.id)
        this.vault.put(`${this.sessionId}:text:${entry.id}`, new File([entry.text], entry.name, { type: 'text/plain' })).catch(() => this.notice('文本文件离线保存失败，请保持本页直到上传完成。'))
      }
      return this.refs.get(entry.id) ?? `localfile:${entry.id}`
    })
  }
  canonical(ref) { return ref.startsWith('localfile:') ? this.refs.get(ref.slice(10)) ?? ref : ref }
  async prepare(content) {
    const files = []
    for (const ref of content.files ?? []) {
      if (!ref.startsWith('localfile:')) { files.push(ref); continue }
      const id = ref.slice(10)
      if (this.refs.has(id)) { files.push(this.refs.get(id)); continue }
      const entry = this.entries().find(e => e.id === id) ?? this.loaded.get(ref)
      if (!entry) throw Error('文本文件未找到，请重新选择。')
      const bytes = new TextEncoder().encode(entry.text)
      const sha256 = await digest(bytes)
      const upload = await this.api.call('upload/begin', { sessionId: this.sessionId, name: entry.name, type: 'text/plain', size: bytes.length, uploadKey: `${id}:${sha256}` })
      if (upload.error) throw Error(upload.error)
      for (let offset = upload.offset; offset < bytes.length; offset += 32768) {
        const part = bytes.subarray(offset, offset + 32768)
        const result = await this.api.call('upload/chunk', { id: upload.id, offset, data: btoa(String.fromCharCode(...part)) })
        if (result.error) throw Error(result.error)
      }
      const committed = await this.api.call('upload/commit', { id: upload.id, sha256 })
      if (committed.error) throw Error(committed.error)
      this.refs.set(id, upload.id); this.loaded.set(upload.id, entry); files.push(upload.id)
      await this.vault.delete(`${this.sessionId}:text:${id}`)
    }
    return { ...content, files }
  }
  async load(content) {
    for (const ref of content.files ?? []) {
      if (this.loaded.has(ref)) continue
      if (ref.startsWith('localfile:')) {
        const file = await this.vault.get(`${this.sessionId}:text:${ref.slice(10)}`)
        if (!file) throw Error('未完成上传的文本文件需要重新选择。')
        this.loaded.set(ref, { id: ref.slice(10), name: file.name, text: await file.text() }); continue
      }
      const parts = []; let offset = 0, entry
      do {
        entry = await this.api.call('upload/read', { sessionId: this.sessionId, id: ref, offset })
        if (entry.error || entry.type !== 'text/plain' || entry.state !== 'ready') throw Error(entry.error ?? '文本文件未就绪')
        const bytes = Uint8Array.from(atob(entry.data), c => c.charCodeAt(0))
        if (!bytes.length) throw Error('文本文件下载中断')
        parts.push(bytes); offset += bytes.length
      } while (offset < entry.size)
      const bytes = await new Blob(parts).arrayBuffer()
      if (await digest(bytes) !== entry.sha256) throw Error('文本文件校验失败')
      const value = { id: `shared-file:${ref}`, name: entry.name, text: new TextDecoder().decode(bytes) }
      this.loaded.set(ref, value); this.refs.set(value.id, ref)
    }
  }
  apply(content) {
    const entries = (content.files ?? []).map(ref => this.loaded.get(ref) ?? this.entries().find(e => this.refs.get(e.id) === ref))
    if (entries.some(e => !e)) throw Error('文本文件尚未恢复')
    this.replace(entries)
  }
  removeSubmitted(refs = []) {
    const sent = new Set(refs.map(ref => this.canonical(ref)))
    this.replace(this.entries().filter(entry => !sent.has(this.refs.get(entry.id) ?? `localfile:${entry.id}`)))
  }
  serialize(refs = []) {
    return refs.map(ref => this.loaded.get(this.canonical(ref)) ?? this.loaded.get(ref) ?? this.entries().find(e => this.canonical(`localfile:${e.id}`) === this.canonical(ref))).filter(Boolean).map(entry => `<file name="${entry.name.replace(/["<>]/g,'_')}">\n${entry.text}\n</file>`).join('\n')
  }
}
