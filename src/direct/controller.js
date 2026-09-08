import { dirname, join } from 'node:path'
import { addresses } from './network.js'
import { directCertificate, installCertificate } from './identity.js'
import { check } from '../auth/devices.js'
export class DirectController {
  constructor({store,hostId,enable,disable,getGateway,scan=addresses,issue=directCertificate,install=installCertificate}) {
    Object.assign(this,{store,hostId,enable,disable,getGateway,scan,issue,install})
    this.revision = 0; this.running = false; this.closed = false; this.error = null; this.stable = null
  }
  async inspect() {
    const candidates = await this.scan()
    return { candidates, configured:this.store.read().directConfig ?? null, status:this.getGateway() ? 'enabled' : 'disabled', error:this.error }
  }
  async start({interface:networkInterface,address,port=8443}) {
    check(!this.running,'direct-operation-busy',409)
    check(this.store.path,'persistent-state-required',409)
    check(!this.getGateway(),'close-current-gateway-first',409)
    check(typeof networkInterface==='string' && Number.isInteger(port) && port>=1024 && port<=65535,'invalid-direct-config')
    check(!this.closed,'plugin-unloaded',409)
    this.running=true
    const revision=this.revision
    try {
      const selected=(await this.scan()).find(x=>x.interface===networkInterface && x.address===address)
      check(selected,'stable-global-ipv6-required')
      check(!this.closed && revision===this.revision,'direct-operation-cancelled',409)
      const identity=await this.issue(join(dirname(this.store.path),'direct'),this.hostId,address)
      check(!this.closed && revision===this.revision,'direct-operation-cancelled',409)
      const result=await this.enable({publicOrigin:`https://[${address}]:${port}`,bind:'::',port,certPath:identity.certPath,keyPath:identity.keyPath})
      check(!this.closed && revision===this.revision,'direct-operation-cancelled',409)
      this.store.update(s=>{s.directConfig={interface:networkInterface,address,port};s.directIdentity={pin:identity.pin,expiresAt:identity.expiresAt}})
      this.error=null; this.schedule(); return result
    } finally {this.running=false}
  }
  schedule() { clearInterval(this.timer); if (!this.closed) {this.timer=setInterval(()=>this.refresh().catch(()=>{}),30000);this.timer.unref?.()} }
  async refresh() {
    const config=this.store.read().directConfig, gateway=this.getGateway()
    if (!config || !gateway || this.running || this.closed) return
    this.running=true
    const revision=this.revision
    try {
      const candidates=(await this.scan()).filter(x=>x.interface===config.interface)
      if(this.closed || revision!==this.revision)return
      const candidate=candidates.find(x=>x.address===config.address) ?? candidates[0]
      if (!candidate) {this.error='当前接口没有可用的非临时公网 IPv6。已有任务继续运行；远程入口等待网络恢复。'; return}
      const address=candidate.address, retained=this.store.read().directIdentity
      if (address===config.address && retained?.expiresAt>Date.now()+30*86400000) {this.error=null;return}
      // Two consecutive observations prevent briefly appearing addresses from replacing the endpoint.
      if(address!==config.address && this.stable!==address){this.stable=address;return}
      const identity=await this.issue(join(dirname(this.store.path),'direct'),this.hostId,address,{install:false})
      if(this.closed || revision!==this.revision || gateway!==this.getGateway() || !this.store.read().directConfig)return
      const previousTls=gateway.tls, previousOrigin=gateway.origin
      gateway.reloadTls(identity)
      try {
        await this.install(identity)
        if(this.closed || revision!==this.revision || gateway!==this.getGateway())return
        gateway.origin=`https://[${address}]:${config.port}`
        this.store.update(s=>{s.directConfig.address=address;s.directIdentity={pin:identity.pin,expiresAt:identity.expiresAt};s.remoteConfig.publicOrigin=gateway.origin})
      } catch(error) {
        if(previousTls) {gateway.reloadTls(previousTls); await this.install({...identity,...previousTls}).catch(()=>{})}
        gateway.origin=previousOrigin
        throw error
      }
      this.error=address!==config.address?'IPv6 地址已变化。请在手机更新地址或重新扫描电脑二维码；电脑身份未改变。':null
    }catch{this.error='直连地址或证书更新失败；保留现有身份，请检查网络。'}finally{this.running=false}
  }
  invalidate(){this.revision++;this.stable=null;clearInterval(this.timer)}
  close(){this.closed=true;this.invalidate()}
}
