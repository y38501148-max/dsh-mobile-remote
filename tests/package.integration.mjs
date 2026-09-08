import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
const exec = promisify(execFile), root = fileURLToPath(new URL('../', import.meta.url))
test('packed plugin installs, upgrades and uninstalls through the native profile CLI without changing retained state', { timeout: 120000 }, async () => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-package-'))
  try {
    const packed = JSON.parse((await exec('npm', ['pack', '--json', '--pack-destination', home], { cwd: root })).stdout)
    const artifact = join(home, packed[0].filename), cli = join(root, 'node_modules/@deepseek-ai/dsh/lib/bin.js')
    const run = args => exec(process.execPath, [cli, 'plugin', '--profile', 'web', ...args], { cwd: home, env: { ...process.env, DSH_HOME: home }, maxBuffer: 2 * 1024 * 1024 })
    const state = join(home, 'mobile-remote/state.json'); await mkdir(join(home, 'mobile-remote')); await writeFile(state, '{"retained":"device-and-draft-state"}')
    await run(['add', artifact])
    const profile = join(home, 'profiles/web/package.json')
    const installed = JSON.parse(await readFile(profile, 'utf8'))
    assert.ok(installed.dsh.profile.bundles.includes('@muzermat/dsh-mobile-remote'))
    const pluginRoot = join(home, 'profiles/web/node_modules/@muzermat/dsh-mobile-remote')
    const check = await exec(process.execPath, ['--input-type=module', '-e', `const p=await import(${JSON.stringify(join(pluginRoot, 'lib/index.js'))}); if(typeof p.apply!=='function')throw Error('entry missing')`], { cwd: home })
    assert.equal(check.stderr, '')
    await run(['add', artifact])
    assert.equal(await readFile(state, 'utf8'), '{"retained":"device-and-draft-state"}')
    await run(['remove', '@muzermat/dsh-mobile-remote'])
    const removed = JSON.parse(await readFile(profile, 'utf8'))
    assert.ok(!removed.dsh.profile.bundles.includes('@muzermat/dsh-mobile-remote'))
    assert.equal(await readFile(state, 'utf8'), '{"retained":"device-and-draft-state"}')
  } finally { await rm(home, { recursive: true, force: true }) }
})
