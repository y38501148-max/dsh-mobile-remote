import { cp, mkdir, rm } from 'node:fs/promises'
const root = new URL('./', import.meta.url)
await rm(new URL('lib/', root), { recursive: true, force: true })
await mkdir(new URL('lib/', root), { recursive: true })
await cp(new URL('src/', root), new URL('lib/', root), { recursive: true })
