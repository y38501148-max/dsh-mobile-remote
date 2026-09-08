// Isolated real Host for emulator QA. Nothing here connects to production conversations.
import { fullHost } from '../tests/helpers/full-host.mjs'
import { directCertificate } from '../src/direct/identity.js'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
const host=await fullHost({clientProbe:true})
const status=await (await fetch(`${host.origin}/api/plugin/mobile-remote/status`)).json()
const local=async(path,value={})=>{const r=await fetch(`${host.origin}/api/plugin/mobile-remote/${path}`,{method:'POST',headers:{origin:host.origin,'content-type':'application/json'},body:JSON.stringify({hostEpoch:status.hostEpoch,...value})});const v=await r.json();if(!r.ok)throw Error(JSON.stringify(v));return v}
const cert=await directCertificate(join(host.sandbox,'android-tls'),status.hostId,'10.0.2.2')
const origin='https://10.0.2.2:18443'
await local('gateway/enable',{publicOrigin:origin,bind:'127.0.0.1',port:18443,certPath:cert.certPath,keyPath:cert.keyPath})
async function invite(){const v=await local('pair/invite');const url=origin+'/remote/pair#'+new URLSearchParams({v:'1',hostId:status.hostId,pin:cert.pin,expires:String(v.expiresAt),invite:v.code});await writeFile('/tmp/harness-android-fixture.json',JSON.stringify({localOrigin:host.origin,origin,hostId:status.hostId,pin:cert.pin,pairing:url,hostEpoch:status.hostEpoch}),{mode:0o600})}
await invite();const invitationTimer=setInterval(invite,90000)
const approveTimer=setInterval(async()=>{try{const d=await(await fetch(`${host.origin}/api/plugin/mobile-remote/devices`)).json();for(const device of d.devices??d)if(device.state==='pending')await local('pair/approve',{deviceId:device.deviceId,role:'operator'})}catch{}},1000)
console.log('Android fixture ready; private pairing data in /tmp/harness-android-fixture.json')
const stop=async()=>{clearInterval(approveTimer);clearInterval(invitationTimer);await host.stop();process.exit(0)};process.on('SIGTERM',stop);process.on('SIGINT',stop)
