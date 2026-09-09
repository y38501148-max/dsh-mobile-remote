import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mobileSessions,mobileSessionStatus} from '../src/client/mobile-model.js'

test('mobile navigation respects archived/child sessions and keeps the selected blank draft',()=>{
  const rows=[{id:'a',updatedAt:1},{id:'archived',updatedAt:8},{id:'child',parentId:'a',updatedAt:7},{id:'blank',blank:true,updatedAt:6},{id:'current',blank:true,updatedAt:5},{id:'recent',updatedAt:10}]
  const state={ids:rows.map(r=>r.id),byId:Object.fromEntries(rows.map(r=>[r.id,r])),current:'current'}
  assert.deepEqual(mobileSessions(state,{archivedSessionIds:['archived']}).map(r=>r.id),['recent','current','a'])
  assert.equal(state.ids.length,6)
})
test('mobile search and attention filter retain pending questions independently of running state',()=>{
  const a={id:'a',displayTitle:'修复上传',cwd:'/projects/Android',pendingInteraction:{kind:'question'},updatedAt:2}
  const b={id:'b',displayTitle:'已结束',updatedAt:1,completed:true}
  const state={ids:['b','a'],byId:{a,b}}
  assert.deepEqual(mobileSessions(state,{},'ANDROID','active').map(r=>r.id),['a'])
  assert.equal(mobileSessionStatus(a),'等待确认')
  assert.equal(mobileSessionStatus(b),'已完成')
})
