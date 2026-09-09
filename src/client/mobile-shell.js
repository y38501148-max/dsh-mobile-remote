import React from 'react'
import { mobileSessions, mobileSessionStatus } from './mobile-model.js'
const h = React.createElement
const icons = {
  chat: 'M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9H13a8.5 8.5 0 0 1 8 8v.5Z',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  folder: 'M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z',
  plus: 'M12 5v14M5 12h14', back: 'm15 18-6-6 6-6', close: 'm6 6 12 12M6 18 18 6',
  search: 'm21 21-4.4-4.4M19 10.5a8.5 8.5 0 1 1-17 0 8.5 8.5 0 0 1 17 0Z',
  settings: 'M4 7h16M4 17h16M8 4v6M16 14v6', chevron: 'm9 5 7 7-7 7',
}
function Icon({name}) { return h('svg', {width:22,height:22,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',strokeWidth:1.8,strokeLinecap:'round',strokeLinejoin:'round','aria-hidden':true},h('path',{d:icons[name]})) }
function Action({icon,label,onClick,...rest}) {return h('button',{type:'button',className:'mr-phone-icon','aria-label':label,onClick,...rest},h(Icon,{name:icon}))}
function useSource(source) {
  return React.useSyncExternalStore(React.useCallback(fn=>source.subscribe(fn),[source]),React.useCallback(()=>source.getSnapshot(),[source]))
}
function usePhone() {
  const [phone,setPhone]=React.useState(()=>matchMedia('(max-width:700px)').matches)
  React.useEffect(()=>{const q=matchMedia('(max-width:700px)');const change=()=>setPhone(q.matches);q.addEventListener('change',change);return()=>q.removeEventListener('change',change)},[])
  return phone
}
const basename = path => path?.split(/[\\/]/).filter(Boolean).at(-1) || '电脑工作区'

export function MobileShell({service,DirectoryFlow,Settings}) {
  const phone=usePhone(),ctx=service.ctx
  const sessions=useSource(ctx.sessions.list),workspaces=useSource(ctx.workspaces.list)
  const [panel,setPanel]=React.useState(null),[query,setQuery]=React.useState(''),[filter,setFilter]=React.useState('all')
  const [directory,setDirectory]=React.useState(false),[busy,setBusy]=React.useState(false),[error,setError]=React.useState('')
  const [keyboard,setKeyboard]=React.useState(!!window.__HARNESS_KEYBOARD__)
  const current=sessions.byId[sessions.current]
  const shown=mobileSessions(sessions,workspaces,query,filter)
  React.useEffect(()=>{
    if(!phone)return
    document.body.classList.add('mr-phone')
    const change=e=>setKeyboard(!!e.detail)
    window.addEventListener('harness-keyboard',change)
    return()=>{document.body.classList.remove('mr-phone','mr-phone-keyboard','mr-phone-panel');window.removeEventListener('harness-keyboard',change)}
  },[phone])
  React.useEffect(()=>{if(phone)document.body.classList.toggle('mr-phone-keyboard',keyboard)},[phone,keyboard])
  React.useEffect(()=>{
    if(!phone)return
    document.body.classList.toggle('mr-phone-panel',!!panel)
    const center=document.querySelector('.pI_x6G_centerCol')
    if(center)center.inert=!!panel
    // Android Back dismisses mobile navigation before leaving the connected computer.
    const back=()=>{
      if(directory){setDirectory(false);return true}
      const settings=document.querySelector('.VOzbGW_overlay')
      if(settings){document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));return true}
      if(panel){setPanel(null);return true}
      if(document.querySelector('.pI_x6G_frame:not([data-details-collapsed])')){ctx.layout.closeDetails();return true}
      return false
    }
    window.__HARNESS_MOBILE_BACK__=back
    return()=>{if(center)center.inert=false;if(window.__HARNESS_MOBILE_BACK__===back)delete window.__HARNESS_MOBILE_BACK__}
  },[phone,panel,directory,ctx])
  if(!phone)return null
  const navigate=next=>{document.activeElement?.blur?.();setError('');setPanel(next);ctx.layout.closeDetails()}
  const open=id=>{try{ctx.sessions.open(id);navigate(null)}catch(e){setError(e.message)}}
  const start=async workspaceId=>{setBusy(true);setError('');try{const id=await ctx.workspaces.connectWorkspace(workspaceId);ctx.sessions.open(id);navigate(null)}catch(e){setError(e.message)}finally{setBusy(false)}}
  const add=async path=>{setBusy(true);setError('');try{const workspace=await ctx.workspaces.create({path});setDirectory(false);await start(workspace.workspaceId)}catch(e){setError(e.message)}finally{setBusy(false)}}
  const settings=()=>{
    const trigger=document.querySelector('.hHd-Xa_settingsArea button[aria-haspopup="dialog"]')
    if(trigger)trigger.click();else setError('电脑设置暂未加载，请稍后重试。')
  }
  const title=panel==='sessions'?'会话':panel==='workspaces'?'选择工作区':panel==='settings'?'设置':!current || current.blank?'新的对话':current.displayTitle
  return h(React.Fragment,null,
    h('header',{className:'mr-phone-header'},
      h('div',{className:'mr-phone-heading'},h('strong',null,title),h('span',null,panel==='workspaces'?'在电脑上的目录中开始任务':panel?'同一台电脑 · 同一份进度':current?`${basename(current.cwd)} · ${mobileSessionStatus(current)}`:'选择工作区，开始一个新任务')),
      panel?h(Action,{icon:'close',label:'返回对话',onClick:()=>navigate(null)}):h(Action,{icon:'plus',label:'新建手机会话',onClick:()=>navigate('workspaces')})),
    panel && h('section',{className:'mr-phone-screen','aria-label':title},
      error&&h('p',{className:'mr-phone-error',role:'alert'},error),
      panel==='sessions'&&h(React.Fragment,null,
        h('label',{className:'mr-phone-search'},h(Icon,{name:'search'}),h('input',{type:'search',value:query,placeholder:'搜索会话或工作区','aria-label':'搜索手机会话',onChange:e=>setQuery(e.target.value)})),
        h('div',{className:'mr-phone-filters'},...[["all","全部会话"],["active","进行中 / 待确认"]].map(([key,label])=>h('button',{key,type:'button','aria-pressed':filter===key,onClick:()=>setFilter(key)},label))),
        shown.length===0&&h('div',{className:'mr-phone-empty'},h(Icon,{name:'chat'}),h('h2',null,query?'没有匹配的会话':filter==='active'?'暂时没有进行中的任务':sessions.phase==='ready'?'从一个新任务开始':'正在读取电脑会话…'),h('p',null,query?'试试会话标题或工作区名称。':'电脑上的任务会在这里显示。'),!query&&h('button',{className:'mr-phone-primary',onClick:()=>navigate('workspaces')},'新建会话')),
        h('div',{className:'mr-phone-session-list'},...shown.map(row=>h('button',{key:row.id,type:'button',className:'mr-phone-session','data-session-id':row.id,'aria-current':row.id===sessions.current?'true':undefined,onClick:()=>open(row.id)},
          h('span',{className:'mr-phone-session-top'},h('strong',null,row.displayTitle || '未命名会话'),h('span',{className:'mr-phone-state','data-state':row.pendingInteraction?'pending':row.running?'running':'idle'},mobileSessionStatus(row))),
          h('span',{className:'mr-phone-session-meta'},h('span',null,basename(row.cwd)),h('time',null,new Date(row.updatedAt).toLocaleDateString(undefined,{month:'short',day:'numeric'}))))))),
      panel==='workspaces'&&h(React.Fragment,null,
        h('p',{className:'mr-phone-caption'},'任务在电脑上运行，离开 App 后仍会继续。'),
        ...workspaces.items.map(item=>h('button',{key:item.workspaceId,type:'button',className:'mr-phone-workspace',disabled:busy,onClick:()=>start(item.workspaceId)},h(Icon,{name:'folder'}),h('span',null,h('strong',null,item.title || basename(item.path)),h('small',null,item.path)),h(Icon,{name:'chevron'}))),
        workspaces.items.length===0&&h('p',{className:'mr-phone-caption'},workspaces.baselinesReady?'还没有工作区，可以添加电脑上的目录。':'正在读取工作区…'),
        h('button',{className:'mr-phone-secondary',disabled:busy,onClick:()=>setDirectory(true)},h(Icon,{name:'plus'}),'添加电脑目录')),
      panel==='settings'&&h(React.Fragment,null,
        h('div',{className:'mr-phone-settings-card'},h('h2',null,'电脑与模型'),h('p',null,'切换模型、权限和电脑端插件设置。'),h('button',{className:'mr-phone-secondary',onClick:settings},'打开电脑设置',h(Icon,{name:'chevron'}))),
        h('div',{className:'mr-phone-settings-card'},h(Settings,{service})))),
    h('nav',{className:'mr-phone-nav','aria-label':'手机导航'},...[[null,'chat','对话'],['sessions','list','会话'],['settings','settings','设置']].map(([key,icon,label])=>h('button',{key:label,id:'mr-phone-nav-'+(key||'chat'),type:'button','aria-current':panel===key?'page':undefined,onClick:()=>navigate(key)},h(Icon,{name:icon}),h('span',null,label)))),
    directory&&h(DirectoryFlow,{open:true,busy,onPicked:add,onCancel:()=>setDirectory(false),service}))
}
