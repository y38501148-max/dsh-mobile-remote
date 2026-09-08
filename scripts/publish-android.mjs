#!/usr/bin/env node
// Publish verified APK assets through a draft, then make the reviewed set public.
import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { resolve,join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
const exec=promisify(execFile), repo='y38501148-max/dsh-mobile-remote'
const [directory,notesFile]=process.argv.slice(2)
if(!directory||!notesFile)throw Error('Usage: node scripts/publish-android.mjs /release/directory /release/notes.md')
const root=resolve(directory), manifest=JSON.parse(await readFile(join(root,'release-manifest.json'),'utf8'))
if(!/^0\.2\.0-preview\.\d+$/.test(manifest.version))throw Error('Review the release policy before publishing a different version range')
if(manifest.appId!=='com.muzermat.harnessremote'||manifest.protocolVersion!==1||manifest.pluginSource.repository!==`https://github.com/${repo}`||manifest.androidSource.repository!=='https://github.com/y38501148-max/harness-remote-android')throw Error('Unexpected release identity')
const apk=`harness-remote-${manifest.version}-android.apk`
if(manifest.apk.filename!==apk)throw Error('Unexpected APK filename')
const hash=async path=>createHash('sha256').update(await readFile(path)).digest('hex')
if(await hash(join(root,apk))!==manifest.apk.sha256)throw Error('APK digest mismatch')
for(const line of (await readFile(join(root,'SHA256SUMS'),'utf8')).trim().split('\n')) {
 const m=/^([0-9a-f]{64})  ([a-zA-Z0-9_.-]+)$/.exec(line)
 if(!m||!([apk,'release-manifest.json'].includes(m[2]))||await hash(join(root,m[2]))!==m[1])throw Error('Checksum file mismatch')
}
for(const [repository,commit] of [[repo,manifest.pluginSource.commit],['y38501148-max/harness-remote-android',manifest.androidSource.commit]]) {
 if(!/^[0-9a-f]{40}$/.test(commit))throw Error('Full source commit required')
 await exec('gh',['api',`repos/${repository}/commits/${commit}`],{maxBuffer:2*1024*1024})
}
const tag=`android-v${manifest.version}`, files=[apk,'SHA256SUMS','release-manifest.json']
await exec('gh',['release','create',tag,...files.map(file=>join(root,file)),'--repo',repo,'--target',manifest.pluginSource.commit,'--draft','--prerelease','--title',`Harness Remote Android ${manifest.version}`,'--notes-file',resolve(notesFile)])
const check=await mkdtemp(join(tmpdir(),'harness-release-verify-'))
try {
 await exec('gh',['release','download',tag,'--repo',repo,'--dir',check])
 for(const file of files)if(await hash(join(root,file))!==await hash(join(check,file)))throw Error(`Uploaded asset mismatch: ${file}`)
 await exec('gh',['release','edit',tag,'--repo',repo,'--draft=false'])
 console.log(`https://github.com/${repo}/releases/tag/${tag}`)
} finally {await rm(check,{recursive:true,force:true})}
