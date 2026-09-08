export class RemoteApi {
  constructor({ remote, clientId, fetch = globalThis.fetch.bind(globalThis) }) { this.remote = remote; this.clientId = clientId; this.fetch = fetch; this.epoch = null }
  async status() {
    const response = await this.fetch(this.remote ? '/remote/session' : '/api/plugin/mobile-remote/status')
    const value = await response.json()
    if (!response.ok) throw Error(value.error || `HTTP ${response.status}`)
    this.epoch = value.hostEpoch; this.deviceId = value.deviceId ?? `desktop:${this.clientId}`
    return value
  }
  async call(path, payload = {}) {
    if (!this.epoch) await this.status()
    const base = this.remote ? '/remote/shared/' : '/api/plugin/mobile-remote/'
    const response = await this.fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...payload, hostEpoch: this.epoch, clientId: this.clientId }) })
    const value = await response.json()
    if (!response.ok && response.status !== 409) throw Error(value.error || `HTTP ${response.status}`)
    if (value.error === 'host-epoch-mismatch') { await this.status(); throw Error('Host 已重启，请先核对草稿和待确认操作。') }
    return value
  }
}
function snapshot(input, images) {
  const state = input.state.getSnapshot()
  return { text: state.draft, attachments: images?.snapshot(state.imageIds) ?? [], occurrences: state.occurrences.map(({ source, ref, offset, label, clipboardText }) => ({ source, ref, offset, label, clipboardText })) }
}
function equivalent(a, b) { return a.text === b.text && JSON.stringify(a.occurrences ?? []) === JSON.stringify(b.occurrences ?? []) && JSON.stringify(a.attachments ?? []) === JSON.stringify(b.attachments ?? []) }

export class DraftClient {
  constructor({ api, sessionId, input, storage, images, changed = () => {} }) {
    this.images = images; this.api = api; this.sessionId = sessionId; this.input = input; this.storage = storage; this.changed = changed
    this.key = `dsh-remote-draft:${sessionId}`; this.state = { status: 'loading', conflicts: [] }
    this.revision = undefined; this.dirty = false; this.busy = false; this.applying = false; this.sending = false; this.skipEmpty = false
    this.pending = Promise.resolve(); this.alive = true
    try {
      const recovered = JSON.parse(storage?.getItem(this.key) || 'null')
      if (recovered) {
        this.recovered = recovered
        if (!input.state.getSnapshot().draft) { this.input.setDraft(recovered.text); this.dirty = true }
      }
    } catch {}
    this.lastInput = snapshot(input, this.images)
    this.unsubscribe = input.state.subscribe(() => this.onInput())
    this.initial = this.refresh(true)
    this.timer = setInterval(() => this.refresh().catch(error => this.notice(error.message)), 1500)
  }
  publish(extra) { this.state = { ...this.state, ...extra }; this.changed() }
  notice(message) { this.publish({ status: this.state.status === 'conflict' ? 'conflict' : 'unsynced', message }) }
  persist(value = snapshot(this.input, this.images)) {
    try { this.storage?.setItem(this.key, JSON.stringify(value)) } catch { this.notice('本机草稿存储空间不足，请复制保留输入。') }
  }
  apply(value) {
    this.applying = true
    try {
      this.images?.apply(value, this.input)
      this.input.setDraft(value.text)
      for (const occurrence of value.occurrences ?? []) {
        const { offset, ...reference } = occurrence
        const accepted = this.input.insertReference(reference, { start: offset, end: offset + 1, draftRev: this.input.state.getSnapshot().draftRev })
        if (!accepted) throw Error('引用恢复失败，草稿副本已保留。')
      }
    } finally { this.applying = false }
  }
  onInput() {
    if (this.applying || !this.alive) return
    const state = this.input.state.getSnapshot()
    if (['submitting', 'adjudicating'].includes(state.phase)) return
    const value = snapshot(this.input, this.images)
    if (this.lastInput && equivalent(this.lastInput, value)) return
    if (!value.text && !value.attachments.length && (this.lastInput?.text || this.lastInput?.attachments?.length)) this.clearedSnapshot = this.lastInput
    this.lastInput = value; this.dirty = true; this.persist(value)
    if (this.sending) return
    if (this.state.status === 'conflict') { this.publish({ message: '本机修改已保留，请先选择要使用的草稿。' }); return }
    if (equivalent(value, this.state.remote ?? { text: '' })) { this.dirty = false; return }
    this.publish({ status: 'unsynced', message: '正在同步草稿…' })
    clearTimeout(this.debounce)
    this.debounce = setTimeout(() => this.flush().catch(error => this.notice(error.message)), 300)
  }
  async refresh(initial = false) {
    if (!this.alive || this.busy || this.sending) return
    try {
      const remote = await this.api.call('draft/read', { sessionId: this.sessionId })
      if (!this.alive || this.sending) return
      if (this.revision !== undefined && remote.revision < this.revision) return
      this.publish({ conflicts: remote.conflicts ?? [], lease: remote.lease })
      const local = snapshot(this.input, this.images)
      if (initial || this.revision === undefined) {
        this.revision = remote.revision
        this.publish({ remote })
        if (this.recovered?.attachments?.length) {
          const before = snapshot(this.input, this.images)
          await this.images?.load(this.recovered)
          if (!equivalent(before, snapshot(this.input, this.images))) return
          this.apply(this.recovered)
          this.lastInput = snapshot(this.input, this.images)
          this.dirty = !equivalent(this.lastInput, remote)
          this.recovered = null
          if (this.dirty) { this.publish({ status: 'conflict', message: '已恢复本机图片草稿，请核对共享版本后接管。', remote }); return }
          await this.refresh(); return
        }
        // Native rc.6 restores text separately from runtime-only image ids.
        // A matching text-only native mirror is incomplete, not an intentional
        // attachment deletion. Restore the complete authoritative draft.
        if (!this.recovered && local.text === remote.text && !local.attachments.length && remote.attachments?.length && JSON.stringify(local.occurrences ?? []) === JSON.stringify(remote.occurrences ?? [])) {
          await this.images?.load(remote)
          if (!equivalent(local, snapshot(this.input, this.images))) return
          this.apply(remote); this.lastInput = snapshot(this.input, this.images); this.dirty = false
          this.publish({ status: 'synced', message: '草稿已同步', remote }); return
        }
        if ((local.text || local.attachments.length) && !equivalent(local, remote)) {
          this.dirty = true; this.persist(local)
          if (remote.revision > 0 || remote.text || remote.attachments?.length) { this.publish({ status: 'conflict', message: '本机与共享草稿不同，两份内容均已保留。', remote }); return }
          await this.flush(); return
        }
      }
      if (!this.dirty && !['submitting', 'adjudicating'].includes(this.input.state.getSnapshot().phase)) {
        this.revision = remote.revision
        if (!equivalent(local, remote)) {
          await this.images?.load(remote)
          if (this.dirty || this.sending || !equivalent(local, snapshot(this.input, this.images))) return
          this.apply(remote)
        }
        this.lastInput = snapshot(this.input, this.images)
        this.publish({ status: 'synced', message: '草稿已同步', remote })
      }
    } catch (error) { if (this.recovered) this.publish({ status: 'conflict', message: error.message }); else this.notice(error.message) }
  }
  flush(takeover = false, captured) {
    const run = async () => {
      if (!this.alive || this.revision === undefined) return
      if (!this.dirty && !takeover) return this.revision
      this.busy = true
      try {
        let content = captured ?? snapshot(this.input, this.images); this.persist(content)
        if (this.images) { content = await this.images.prepare(content); this.persist(content) }
        if (takeover) {
          const acquired = await this.api.call('draft/lease', { sessionId: this.sessionId, takeover: true })
          if (!acquired.ok) throw Error(acquired.error)
          this.revision = acquired.draft.revision
        }
        const result = await this.api.call('draft/write', { sessionId: this.sessionId, expectedRevision: this.revision, ...content, clientMutationId: crypto.randomUUID() })
        if (!result.ok) { this.publish({ status: 'conflict', message: result.error === 'lease-held' ? '另一设备正在编辑；你的输入已保留为冲突副本。' : '草稿版本冲突；你的输入已保留。', conflicts: result.current?.conflicts ?? [], remote: result.current }); throw Error(this.state.message) }
        this.revision = result.draft.revision
        this.state.remote = result.draft
        if (equivalent(snapshot(this.input, this.images), content)) {
          this.dirty = false; this.storage?.removeItem(this.key)
          this.publish({ status: 'synced', message: '草稿已同步', remote: result.draft })
        }
        return this.revision
      } finally { this.busy = false }
    }
    const operation = this.pending.then(run); this.pending = operation.catch(() => {}); return operation
  }
  async useRemote() {
    const local = snapshot(this.input, this.images)
    // Explicit replacement keeps the current local copy in Host conflict history.
    const remote = await this.api.call('draft/read', { sessionId: this.sessionId })
    if ((local.text || local.attachments.length) && !equivalent(local, remote)) {
      await this.api.call('draft/preserve', { sessionId: this.sessionId, ...local, clientMutationId: crypto.randomUUID() })
    }
    await this.images?.load(remote)
    this.dirty = false; this.revision = remote.revision; this.apply(remote); this.storage?.removeItem(this.key); await this.refresh()
  }
  beginPrompt() {
    // rc.6's normal sink commits an optimistic clear immediately before
    // calling ConversationController.sendSession. Capture that exact previous
    // input, cancel its queued empty write, and allow the user to type anew.
    const current = snapshot(this.input, this.images)
    this.submittingSnapshot = (current.text || current.attachments.length) ? current : this.clearedSnapshot ?? current
    this.sending = true; clearTimeout(this.debounce)
    this.persist(this.submittingSnapshot)
  }
  async beforePrompt() {
    await this.initial
    if (this.state.status === 'conflict') throw Error('请先处理草稿冲突，再发送。')
    const submitted = this.submittingSnapshot ?? snapshot(this.input, this.images)
    this.dirty = !equivalent(submitted, this.state.remote ?? { text: '' })
    await this.flush(false, submitted)
    return this.revision
  }
  async afterPrompt(revision, accepted) {
    try {
      if (accepted && revision !== undefined) {
        const result = await this.api.call('draft/clear', { sessionId: this.sessionId, expectedRevision: revision })
        if (result.ok) { this.revision = result.draft.revision; this.state.remote = result.draft }
        const current = snapshot(this.input, this.images)
        this.dirty = !!(current.text || current.attachments.length)
        this.lastInput = current
        if (!this.dirty) this.storage?.removeItem(this.key)
        else this.persist(current)
      }
    } catch (error) { this.notice('消息已被接收，但草稿清理未确认。' + error.message) }
    finally {
      this.sending = false; this.clearedSnapshot = null; this.submittingSnapshot = null
      if (accepted) {
        if (this.dirty) this.flush().catch(e => this.notice(e.message))
        else this.refresh()
      }
    }
  }
  dispose() { this.alive = false; clearInterval(this.timer); clearTimeout(this.debounce); this.unsubscribe(); if (this.dirty) this.persist() }
}
