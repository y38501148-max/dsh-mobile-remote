import { cp, mkdir, rm, readFile, writeFile } from 'node:fs/promises'
import { build } from 'esbuild'
const root = new URL('./', import.meta.url)
await rm(new URL('lib/', root), { recursive: true, force: true })
await mkdir(new URL('lib/', root), { recursive: true })
await cp(new URL('src/', root), new URL('lib/', root), { recursive: true })
const result = await build({ entryPoints: [new URL('src/client-body.js', root).pathname], bundle: true, write: false, format: 'cjs', platform: 'browser', external: ['react', '@deepseek-ai/*'], target: ['es2022'] })
const css = await readFile(new URL('src/mobile-remote.css', root), 'utf8')
const client = `window.__ModuleLoader__.load({id:'@muzermat/dsh-mobile-remote',factory:(require)=>{const module={exports:{}};const exports=module.exports;const style=document.createElement('style');style.dataset.pluginCss='mobile-remote';style.textContent=${JSON.stringify(css)};document.head.append(style);\n${result.outputFiles[0].text}\nreturn module.exports;}});`
await writeFile(new URL('lib/client.js', root), client)
