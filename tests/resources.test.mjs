import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { Resources } from '../src/gateway/resources.js'
test('scoped resource rejects traversal/symlinks, validates device and streams byte ranges with inert HTML', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-resource-')), root = join(directory, 'workspace')
  await mkdir(root); await writeFile(join(root, 'sample.html'), '<script>secret()</script>'); await writeFile(join(directory, 'outside.txt'), 'outside'); await symlink(join(directory, 'outside.txt'), join(root, 'escape.txt'))
  let now = 100
  const resources = new Resources({ sessions: { list: async () => ({ result: { ok: true, value: { items: [{ sessionId: 's', cwd: root }] } } }) } }, { now: () => now })
  const server = createServer(async (req, res) => { try { await resources.serve(req.url.slice(1), req.headers['x-device'], req, res) } catch (e) { res.writeHead(e.status ?? 500); res.end() } })
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  try {
    for (const path of ['../outside.txt', 'escape.txt']) await assert.rejects(resources.issue({ sessionId: 's', path }, { deviceId: 'phone' }), /outside-session/)
    const resource = await resources.issue({ sessionId: 's', path: 'sample.html' }, { deviceId: 'phone' })
    const url = `http://127.0.0.1:${server.address().port}/${resource.url.split('/').at(-1)}`
    assert.equal((await fetch(url, { headers: { 'x-device': 'other' } })).status, 403)
    const response = await fetch(url, { headers: { 'x-device': 'phone', range: 'bytes=0-7' } })
    assert.equal(response.status, 206); assert.equal(await response.text(), '<script>'); assert.match(response.headers.get('content-type'), /^text\/plain/); assert.match(response.headers.get('content-security-policy'), /sandbox/)
    const external = await resources.issue({ sessionId: 's', path: '../outside.txt' }, { deviceId: 'admin', role: 'admin' })
    const externalUrl = `http://127.0.0.1:${server.address().port}/${external.url.split('/').at(-1)}`
    assert.equal(await (await fetch(externalUrl, { headers: { 'x-device': 'admin' } })).text(), 'outside')
    assert.equal((await fetch(externalUrl, { headers: { 'x-device': 'phone' } })).status, 403)
    now += 300001; assert.equal((await fetch(url, { headers: { 'x-device': 'phone' } })).status, 403)
  } finally { await new Promise(r => server.close(r)); await rm(directory, { recursive: true, force: true }) }
})
