// Browser-owned files survive a reload until their Host upload is committed.
// IndexedDB is origin-scoped; no authorization or model credentials live here.
export class ImageVault {
  constructor() { this.pending = new Map() }
  async db() {
    if (!globalThis.indexedDB) return null
    if (!this.opening) this.opening = new Promise((resolve, reject) => {
      const request = indexedDB.open('dsh-mobile-image-drafts-v1', 1)
      request.onupgradeneeded = () => request.result.createObjectStore('images')
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error)
    })
    return this.opening
  }
  async transaction(mode, action) {
    const db = await this.db(); if (!db) return
    return new Promise((resolve, reject) => {
      const tx = db.transaction('images', mode), request = action(tx.objectStore('images'))
      tx.oncomplete = () => resolve(request.result); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error)
    })
  }
  put(key, file) {
    const operation = this.transaction('readwrite', store => store.put(file, key))
    this.pending.set(key, operation)
    return operation.finally(() => this.pending.delete(key))
  }
  async get(key) { await this.pending.get(key); return this.transaction('readonly', store => store.get(key)) }
  async delete(key) { await this.pending.get(key); return this.transaction('readwrite', store => store.delete(key)) }
}
