import { mkdir, readFile, writeFile, cp } from 'node:fs/promises'
import { join } from 'node:path'
import { build } from 'esbuild'
export async function prepareInjector(source, output) {
  const pkg = JSON.parse(await readFile(join(source, 'package.json'), 'utf8'))
  await mkdir(output); await mkdir(join(output, 'lib'))
  let host = (await readFile(join(source, 'src/index.ts'), 'utf8')).replace("from 'cordis'", "from '@deepseek-ai/cordis'").replace("from 'schemastery'", "from '@deepseek-ai/schemastery'")
  const begin = host.indexOf('  async function startIngest(dir: string, title?: string): Promise<string> {')
  const end = host.indexOf("\n  ctx.effect(() => ctx.webServer.register({", begin)
  if (begin < 0 || end < 0) throw Error('Injector ingest source changed; adapter needs review')
  const original = host.slice(begin, end), promptStart = original.indexOf('    const prompt = `'), promptEnd = original.indexOf('\n    const seed =', promptStart)
  if (promptStart < 0 || promptEnd < 0) throw Error('Injector ingest prompt changed; adapter needs review')
  host = host.slice(0, begin) + `  async function startIngest(dir: string, title?: string): Promise<string> {
    const abs = resolve(dir)
    if (!existsSync(abs)) return 'ERROR: 目录不存在: ' + abs
${original.slice(promptStart, promptEnd)}
    const api = ctx.get('apiProxy') as any
    if (!api?.sessions?.create || !api?.sessions?.prompt) return 'ERROR: 当前 Host 缺少原生会话接口'
    const created = await api.sessions.create({ type: 'client-request', rpcId: crypto.randomUUID(), method: 'session.create', payload: { cwd: abs } })
    if (!created.result.ok) return 'ERROR: ' + created.result.error.message
    const sessionId = created.result.value.sessionId
    const sent = await api.sessions.prompt({ type: 'client-request', rpcId: crypto.randomUUID(), method: 'session.prompt', payload: { sessionId, mode: 'queue', content: [{ type: 'text', text: prompt }] } })
    if (!sent.result.ok) return 'ERROR: ' + sent.result.error.message
    auditLog('ingest-session', abs + ' → ' + sessionId)
    return 'OK: 内化会话已创建（' + sessionId + '）'
  }
` + host.slice(end)
  const result = await build({ stdin: { contents: host, loader: 'ts', sourcefile: 'injector.ts' }, bundle: false, write: false, platform: 'node', format: 'esm', target: 'node22' })
  await writeFile(join(output, 'lib/index.js'), result.outputFiles[0].text)
  const client = await build({ entryPoints: [new URL('./injector-client.js', import.meta.url).pathname], bundle: true, external: ['react'], write: false, platform: 'browser', format: 'cjs', target: 'es2022' })
  await writeFile(join(output, 'lib/client.js'), `window.__ModuleLoader__.load({id:${JSON.stringify(pkg.name)},factory:require=>{const module={exports:{}};const exports=module.exports;${client.outputFiles[0].text}\nreturn module.exports;}});`)
  delete pkg.peerDependencies.cordis; delete pkg.peerDependencies.schemastery
  pkg.peerDependencies['@deepseek-ai/cordis'] = '4.0.1'
  pkg.peerDependencies['@deepseek-ai/schemastery'] = '*'
  pkg.dsh.client.inject.push('@deepseek-ai/dsh-client-web-react')
  await writeFile(join(output, 'package.json'), JSON.stringify(pkg, null, 2)); await cp(join(source, 'cordis.patch.yml'), join(output, 'cordis.patch.yml'))
  return { id: 'dsh-super-injector', name: pkg.name, path: output }
}
