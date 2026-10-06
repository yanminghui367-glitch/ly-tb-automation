import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {SourceStore} from '../source-store.mjs';
import {BatchWorkflow} from '../batch-workflow.mjs';
import {ProductApi} from '../product-api.mjs';

async function fixture(t){
 const dir=await mkdtemp(join(tmpdir(),'travel-scope-')),store=new SourceStore(join(dir,'state.sqlite'));
 t.after(async()=>{store.close();assert.equal(dirname(resolve(dir)),resolve(tmpdir()));await rm(dir,{recursive:true,force:true});});
 const shop={id:'scope-fixture',name:'隔离店铺'},tasks=[1,2,3].map(n=>({shopId:shop.id,priority:n,source:{sheet:'境外城市热度'},listing:{type:'city',country:'隔离国家',city:'隔离城市'+n,title:'商品'+n},business:{price_cny:20,inventory:10},assets:{main:[],secondary:[],details:[]},adapterIssues:[]}));
 const flow={store,active:null,runtime:dir,artifacts:join(dir,'artifacts'),pause(){}};
 const batch=new BatchWorkflow(flow),owner={sessions:new Map(),status:async()=>({running:true,loggedIn:true,loginState:'LOGGED_IN',checkedAt:new Date().toISOString()})};
 const api=new ProductApi({source:flow,batch,owner,shop,runtime:dir,launch:async()=>{throw Error('NO_BROWSER');},integrity:async()=>({ok:true}),checkFiles:async()=>{}});
 const imported=store.imported({sheet:'境外城市热度',sourceHash:'SYNTHETIC',tasks});
 const create=(mode='DRY_RUN',limit=1)=>batch.create({importId:imported,mode,limit,review:{reviewed:true,selectionHash:batch.preview(imported,limit).selectionHash,authorization:'isolated only'}},shop);
 const b=create();let calls=0;
 batch.start=id=>{calls++;batch.store.setBatch(id,'PAUSED','isolated dispatch');return {id};};
 batch.retry=id=>{calls++;batch.store.setBatch(id,'PAUSED','isolated retry');return {id};};
 const call=async(action,body)=>{let result;await api.handle({method:'POST'},{},new URL('http://127.0.0.1/api/v1/'+action),{body:async()=>body,json:(_r,_s,d)=>result=d});return result;};
 await api.saveSettings({executionEnabled:true,confirmShop:shop.name});
 return {api,store,batch,owner,b,create,call,flow,calls:()=>calls};
}
test('missing scope and a scope from another batch cannot dispatch',async t=>{
 const x=await fixture(t),scope=x.api.executionScope(x.b.id);
 await assert.rejects(x.call('start',{id:x.b.id,requestId:randomUUID()}),/范围确认/);
 x.batch.skip(x.b.id,x.batch.store.items(x.b.id)[0].id,'isolated');const next=x.create('LIVE',2);
 await assert.rejects(x.call('start',{id:next.id,scope,requestId:randomUUID()}),/范围或状态/);
 assert.equal(x.calls(),0);assert.equal(x.store.db.prepare('SELECT COUNT(*) n FROM product_actions').get().n,0);
});
test('mode, item set, shop and state revisions invalidate a confirmation',async t=>{
 const x=await fixture(t),scope=x.api.executionScope(x.b.id);
 x.store.db.prepare("UPDATE batches SET mode='LIVE' WHERE id=?").run(x.b.id);
 await assert.rejects(x.call('start',{id:x.b.id,scope,requestId:randomUUID()}),/范围或状态/);
 x.store.db.prepare("UPDATE batches SET mode='DRY_RUN' WHERE id=?").run(x.b.id);
 x.batch.store.setBatch(x.b.id,'PAUSED');x.batch.store.setBatch(x.b.id,'READY');
 await assert.rejects(x.call('start',{id:x.b.id,scope,requestId:randomUUID()}),/范围或状态/);
 const nextScope=x.api.executionScope(x.b.id),item=x.batch.store.items(x.b.id)[0];
 x.store.db.prepare('UPDATE batch_items SET task=? WHERE id=?').run(JSON.stringify({...item.task,listing:{...item.task.listing,title:'changed'}}),item.id);
 assert.notEqual(x.api.executionScope(x.b.id),nextScope);
 const beforeShop=x.api.executionScope(x.b.id);x.store.db.prepare("UPDATE batches SET shop='other' WHERE id=?").run(x.b.id);
 assert.notEqual(x.api.executionScope(x.b.id),beforeShop);
 await assert.rejects(x.call('start',{id:x.b.id,scope:x.api.executionScope(x.b.id),requestId:randomUUID()}),/当前执行店铺/);assert.equal(x.calls(),0);
});
test('state changing during awaited login check is rejected immediately before dispatch',async t=>{
 const x=await fixture(t),scope=x.api.executionScope(x.b.id);
 const status=x.owner.status;x.owner.status=async()=>{x.batch.store.setBatch(x.b.id,'PAUSED');x.batch.store.setBatch(x.b.id,'READY');return status();};
 await assert.rejects(x.call('start',{id:x.b.id,scope,requestId:randomUUID()}),/范围或状态/);assert.equal(x.calls(),0);
});
test('continue and retry must retain the confirmed scope through recovery checks',async t=>{
 for(const action of ['continue','retry']){
  const x=await fixture(t),scope=x.api.executionScope(x.b.id);
  x.api.recovery=async()=>{x.batch.store.setBatch(x.b.id,'PAUSED');return {ready:true};};
  await assert.rejects(x.call(action,{id:x.b.id,scope,requestId:randomUUID(),humanVerified:true}),/范围或状态/);assert.equal(x.calls(),0);
 }
});
test('same confirmed request replays after acceptance without a second dispatch',async t=>{
 const x=await fixture(t),input={id:x.b.id,scope:x.api.executionScope(x.b.id),requestId:randomUUID()};
 await x.call('start',input);const replay=await x.call('start',input);
 assert.equal(replay.replayed,true);assert.equal(x.calls(),1);
});
test('simultaneous confirmed requests can dispatch the scope only once',async t=>{
 const x=await fixture(t),scope=x.api.executionScope(x.b.id);
 const results=await Promise.allSettled([1,2].map(()=>x.call('start',{id:x.b.id,scope,requestId:randomUUID()})));
 assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal(x.calls(),1);
});
test('unchanged snapshots yield a stable scope and retain confirmed successful targets',async t=>{
 const x=await fixture(t),a=await x.api.snapshot(x.b.id),b=await x.api.snapshot(x.b.id);
 assert.equal(a.batch.executionScope,b.batch.executionScope);await x.call('start',{id:x.b.id,scope:a.batch.executionScope,requestId:randomUUID()});assert.equal(x.calls(),1);
});
