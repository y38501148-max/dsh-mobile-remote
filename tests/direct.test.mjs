import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp,rm,readFile,stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID,X509Certificate } from 'node:crypto'
import { globalIPv6,parseIfconfig } from '../src/direct/network.js'
import { directCertificate,certificateIdentity } from '../src/direct/identity.js'
import { DirectController } from '../src/direct/controller.js'
test('IPv6 discovery excludes private, temporary and unusable addresses',()=>{
 for(const ip of ['127.0.0.1','fe80::1','fd12::1','::1','2001:db8::1'])assert.equal(globalIPv6(ip),false,ip)
 assert.equal(globalIPv6('2001:250::1'),true)
 assert.deepEqual(parseIfconfig('en0: flags=8863\n inet6 fe80::1%en0 prefixlen 64\n inet6 2001:250::1 prefixlen 64 autoconf secured\n inet6 2001:250::2 prefixlen 64 temporary\n inet6 2001:250::3 prefixlen 64 deprecated\nen1: flags=8863\n inet6 240e::1 prefixlen 64\n'),[{interface:'en0',address:'2001:250::1'},{interface:'en1',address:'240e::1'}])
})
test('certificate renewal and changed IP preserve identity and restrict key permissions',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'remote-identity-'))
 try{const hostId=randomUUID();const first=await directCertificate(dir,hostId,'2001:250::1');const next=await directCertificate(dir,hostId,'2001:250::2');assert.equal(first.pin,next.pin);assert.deepEqual(first.key,next.key);assert.equal(new X509Certificate(next.cert).checkIP('2001:250::2'),'2001:250::2');assert.equal(new X509Certificate(next.cert).checkIP('2001:250::1'),undefined);assert.equal((await stat(next.keyPath)).mode&0o777,0o600);assert.equal(certificateIdentity(await readFile(next.certPath),next.key).pin,first.pin);assert.throws(()=>certificateIdentity(first.cert,Buffer.from('wrong key')))}finally{await rm(dir,{recursive:true,force:true})}
})
test('address watcher requires stability, stays on interface and retains gateway on renewal failure',async()=>{
 let state={directConfig:{interface:'en0',address:'2001:250::1',port:8443},directIdentity:{expiresAt:Date.now()+90*86400000},remoteConfig:{}};let list=[{interface:'en0',address:'2001:250::2'}];let reload=0,fail=false
 const gateway={reloadTls:()=>{if(fail)throw Error('bad certificate');reload++}}
 const controller=new DirectController({store:{path:'/tmp/state.json',read:()=>structuredClone(state),update:f=>f(state)},hostId:randomUUID(),getGateway:()=>gateway,scan:async()=>list,install:async()=>{},issue:async()=>({pin:'same',expiresAt:Date.now()+90*86400000})})
 await controller.refresh();assert.equal(reload,0);await controller.refresh();assert.equal(reload,1);assert.equal(state.directConfig.address,'2001:250::2')
 list=[{interface:'en1',address:'2001:250::3'}];await controller.refresh();assert.match(controller.error,/没有可用/);assert.equal(reload,1)
 list=[{interface:'en0',address:'2001:250::4'}];fail=true;await controller.refresh();await controller.refresh();assert.equal(state.directConfig.address,'2001:250::2');assert.match(controller.error,/失败/);controller.close();await controller.refresh();assert.equal(reload,1)
})
