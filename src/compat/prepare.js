import { mkdir, cp, readFile, writeFile, symlink, access } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { prepareInjector } from './injector.js'
import { adaptModes, adaptTextFiles } from './patches.js'
const exec = promisify(execFile)
export const COMPANIONS = ['repair', 'harness-modes', 'ui-tweaks', 'browser-view', 'newapi-monitor', 'haibara-ai', 'step-narrator']
export async function prepareCompanions(source, output, { nodeModules } = {}) {
  source = resolve(source); output = resolve(output)
  await mkdir(output) // Never overwrite a previously prepared/user-edited tree.
  if (nodeModules) await symlink(nodeModules, join(output, 'node_modules'), 'dir')
  const plugins = []
  for (const id of COMPANIONS) {
    const from = join(source, id), to = join(output, id)
    const pkg = JSON.parse(await readFile(join(from, 'package.json'), 'utf8'))
    await mkdir(to)
    for (const path of ['package.json','src','build.mjs','cordis.patch.yml', ...id === 'haibara-ai' ? ['artwork'] : []]) {
      try { await access(join(from, path)); await cp(join(from, path), join(to, path), { recursive: true }) }
      catch (error) { if (path !== 'cordis.patch.yml' || error.code !== 'ENOENT') throw error }
    }
    if (['harness-modes','ui-tweaks'].includes(id)) {
      const path = join(to, 'src/client-body.js'), text = await readFile(path, 'utf8')
      await writeFile(path, id === 'harness-modes' ? adaptModes(text) : adaptTextFiles(text))
    }
    await exec(process.execPath, ['build.mjs'], { cwd: to })
    plugins.push({ id, name: pkg.name, path: to })
  }
  const injector = join(source, 'dsh-routing-suite/injector')
  try { await access(join(injector, 'package.json')); plugins.push(await prepareInjector(injector, join(output, 'dsh-super-injector'))) } catch (error) { if (error.code !== 'ENOENT') throw error }
  await writeFile(join(output, 'companions.json'), JSON.stringify({ protocolVersion: 1, plugins }, null, 2))
  return plugins
}
