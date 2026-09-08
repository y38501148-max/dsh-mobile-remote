import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fullHost } from './helpers/full-host.mjs'
import { companionSetup } from './helpers/companions.mjs'
const source = process.env.DSH_COMPANION_SOURCE
test('prepared companion packages load together in an isolated rc.6 Host', { timeout: 60000, skip: !source && 'Set DSH_COMPANION_SOURCE to the existing companion source directory' }, async () => {
  const host = await fullHost({ setup: sandbox => companionSetup(sandbox, source) })
  try {
    const page = await (await fetch(host.origin)).text()
    for (const name of ['dsh-harness-modes', 'dsh-ui-tweaks', 'dsh-repair', 'dsh-client-ui-skin-haibara-ai']) assert.ok(page.includes(name), `client bundle missing: ${name}`)
    const status = await (await fetch(host.origin + '/api/plugin/newapi-monitor/status')).json()
    assert.equal(status.ok, true, JSON.stringify(status))
    const injected = await fetch(host.origin + '/super-injector/api/list')
    assert.equal(injected.status, 200, host.output())
    assert.deepEqual((await injected.json()).entries, [])
    const fixture = join(host.sandbox, 'synthetic-plugin'); await mkdir(fixture)
    await writeFile(join(fixture, 'package.json'), JSON.stringify({ name: '@dsh-test/synthetic-plugin', version: '0.0.0', type: 'module', main: './index.js' }))
    await writeFile(join(fixture, 'index.js'), `export const inject=['webServer']; export function apply(ctx){ctx.effect(()=>ctx.webServer.register({kind:'exact',path:'/synthetic-injected',handler:(req,res)=>{res.end('injected fixture')}}))}`)
    const invoke = async (path, payload) => (await fetch(host.origin + '/super-injector/api/' + path, { method: 'POST', headers: { origin: host.origin, 'content-type': 'application/json' }, body: JSON.stringify(payload) })).json()
    const added = await invoke('inject', { dir: fixture })
    assert.match(added.result, /^OK:/, JSON.stringify(added))
    assert.equal(await (await fetch(host.origin + '/synthetic-injected')).text(), 'injected fixture')
    const removed = await invoke('uninstall', { match: '@dsh-test/synthetic-plugin' })
    assert.match(removed.result, /^OK:/, JSON.stringify(removed))
    assert.equal((await fetch(host.origin + '/super-injector/api/list')).status, 200)
    const ingest = await invoke('ingest', { dir: fixture, title: 'Synthetic ingest' })
    assert.match(ingest.result, /^OK: 内化会话已创建/, JSON.stringify(ingest))
    const remote = await (await fetch(host.origin + '/api/plugin/mobile-remote/status')).json()
    assert.equal(remote.enabled, false)
    assert.doesNotMatch(host.output(), /Cannot find package|ERR_MODULE_NOT_FOUND/)
  } finally { await host.stop() }
})
