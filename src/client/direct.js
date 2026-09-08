import React from 'react'
const h=React.createElement
export function DirectSetup({status,call,run,busy}) {
  const [candidates,setCandidates]=React.useState([]),[selected,setSelected]=React.useState(''),[error,setError]=React.useState('')
  const scan=async()=>{try{const r=await fetch('/api/plugin/mobile-remote/direct/inspect');const value=await r.json();if(!r.ok)throw Error(value.error);setCandidates(value.candidates);setSelected(previous=>value.candidates.some(c=>c.address===previous)?previous:value.candidates[0]?.address??'');setError(value.error??'')}catch(e){setError(e.message)}}
  React.useEffect(()=>{scan()},[])
  return h('section',{className:'mr-direct'},h('h3',null,'安卓 App · IPv6 直连'),
    h('p',null,'自动准备电脑身份，手机安装 APK 后扫码即可；无需域名或安装证书。'),
    h('a',{href:'https://github.com/y38501148-max/dsh-mobile-remote/releases',target:'_blank',rel:'noopener noreferrer'},'下载安卓软件'),
    h('label',null,'校园网 IPv6',h('select',{value:selected,onChange:e=>setSelected(e.target.value),'aria-label':'校园网 IPv6'},...candidates.map(c=>h('option',{key:c.address,value:c.address},`${c.interface} · ${c.address}`)))),
    !candidates.length&&h('p',null,'未找到非临时公网 IPv6。请连接校园网后重新检测。'),
    h('button',{className:'mr-button',disabled:busy,onClick:scan},'重新检测'),
    h('button',{className:'mr-button',disabled:busy||!selected,onClick:()=>run(async()=>{if(status?.enabled)await call('gateway/disable',{});await call('direct/enable',{...candidates.find(c=>c.address===selected),port:8443})})},status?.enabled?'切换为 IPv6 直连':'开启 IPv6 直连'),
    (error||status?.directError)&&h('p',{role:'alert'},error||status.directError),
    status?.directConfig&&h('p',null,'直连已配置。地址变化时请在 App 更新地址或重新扫码；电脑身份保持不变。'))
}
