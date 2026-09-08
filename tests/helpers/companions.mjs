import { mkdir, symlink } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import { prepareCompanions } from '../../src/compat/prepare.js'
export async function companionSetup(sandbox, sourceRoot) {
  const prepared = await prepareCompanions(sourceRoot, join(sandbox, 'companions'), { nodeModules: fileURLToPath(new URL('../../node_modules', import.meta.url)) })
  for (const plugin of prepared) {
    const link = join(sandbox, 'node_modules', plugin.name)
    await mkdir(dirname(link), { recursive: true }); await symlink(plugin.path, link, 'dir')
  }
  const dbPath = join(sandbox, 'synthetic-monitor.db'), db = new DatabaseSync(dbPath)
  db.exec('CREATE TABLE logs (id INTEGER, created_at INTEGER, model_name TEXT, token_name TEXT, channel_id INTEGER, channel_name TEXT, type INTEGER)'); db.close()
  return { plugins: prepared.map(({ id, name }) => ({ id, name, ...(id === 'dsh-super-injector' ? { config: { registryFile: join(sandbox, 'injector/registry.json'), profileNodeModules: join(sandbox, 'profiles/web/node_modules'), autoRestore: false, intervalMs: 60000, watches: [] } } : {}) })), env: { NEWAPI_DB_PATH: dbPath, NEWAPI_BASE_URL: 'http://127.0.0.1:1' } }
}
