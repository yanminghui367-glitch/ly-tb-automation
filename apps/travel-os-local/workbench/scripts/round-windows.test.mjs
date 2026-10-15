import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {SourceStore} from '../source-store.mjs';
import {BatchWorkflow} from '../batch-workflow.mjs';
import {ListingRound} from '../listing-round.mjs';

async function fixture(t,n=6){
 const dir=await mkdtemp(join(tmpdir(),'ly-window-')),store=new SourceStore(join(dir,'source.sqlite'));
 t.after(async()=>{store.close();assert(resolve(dir).startsWith(resolve(tmpdir())+sep));await rm(dir,{recursive:true,force:true});});
 const shop={id:'window-test-shop',name:'隔离测试'},tasks=Array.from({length:n},(_,i)=>({shopId:shop.id,priority:i+1,source:{},listing:{type:'city',country:'测试',city:'城市'+(i+1),title:'标题'+(i+1)},assets:{main:[],secondary:[],details:[]},business:{shop_name:shop.name,price_cny:20,inventory:999999},adapterIssues:[]}));
 const importId=store.imported({sourceHash:'isolated-window',tasks});let held=false,release,failAt=0;
 const flow={store,artifacts:dir,active:null,launches:[],stop:false,submits:0,
  launch(id){assert(!this.active);this.active=id;this.stop=false;this.launches.push(id);this.pending=(async()=>{
   store.move(id,'RUNNING');if(held)await new Promise(r=>release=r);
   if(this.stop){store.move(id,'PAUSED','操作者暂停');return;}
   const task=store.run(id).task;
   if(task.priority===failAt){store.checkpoint(id,{step:'main-image-1',errorCode:'TASK_DATA'});store.move(id,'PAUSED','TASK_DATA: 单商品资料错误');return;}
   store.move(id,'SUBMITTING');this.submits++;store.event(id,'SUBMIT_CLICKED',{});
   store.move(id,'VERIFIED','',{itemId:String(999000+task.priority),status:'出售中',rowText:'隔离平台记录',screenshot:'fixture.png',verifiedAt:new Date().toISOString()});
  })().finally(()=>this.active=null);},
  async resume({id}){store.move(id,'QUEUED');this.launch(id);},pause(){this.stop=true;release?.();}
 };
 const batch=new BatchWorkflow(flow);let checked=[];
 const make=()=>new ListingRound({source:flow,batch,shop,contentReviews:{assertApproved:()=>({decision:'PASS'})},checkFiles:async task=>checked.push(task.priority),assertExecution:async()=>{},verifyExisting:async({history})=>history||null,artifacts:join(dir,'rounds')});
 const round=make(),r=await round.create({importId,repairVersion:'fixture',expectedCount:n,authorization:{allowLive:true,maxSafeRecoveries:2,confirmedShop:shop.name,expectedCount:n}});
 // This fixture targets the post-P5 window gate. Separate existing tests prove
 // the real 1 -> 5 publication gates; this is not platform acceptance evidence.
 store.db.prepare('UPDATE rounds SET gate=5 WHERE id=?').run(r.id);
 const create=async(config={})=>round.windows.create(await round.windows.preview(r.id,config));
 const run=async w=>{round.start(r.id,{windowId:w.id});await round.pending;};
 return {round,r,store,flow,batch,tasks,make,create,run,checked,hold:()=>held=true,release:()=>{held=false;release?.();},fail:n=>failAt=n};
}

for(const state of ['READY','STOPPED'])test('idle '+state+' manifest starts its original window after deployment without resetting history',async t=>{
 const x=await fixture(t,3);
 if(state==='STOPPED'){
  const old=await x.create({limit:1});x.round.stop();
  assert.equal(x.round.windows.get(old.id).state,'STOPPED');
 }
 const w=await x.create({limit:2}),before=x.round.round(x.r.id),events=x.round.events(x.r.id);
 assert.equal(before.state,state);
 x.round.start(x.r.id,{windowId:w.id,repairVersion:'fixture-deployed-v2'});
 assert.throws(()=>x.round.start(x.r.id,{windowId:w.id,repairVersion:'fixture-deployed-v3'}),/已有/);
 await x.round.pending;
 assert.equal(x.flow.submits,2);
 assert.equal(x.round.round(x.r.id).repair_version,'fixture-deployed-v2');
 assert.equal(x.round.round(x.r.id).manifest_hash,before.manifest_hash);
 assert.equal(x.round.round(x.r.id).authorization_hash,before.authorization_hash);
 assert.equal(x.round.windows.get(w.id).state,'COMPLETED');
 assert.deepEqual(x.round.events(x.r.id).filter(e=>events.some(old=>old.seq===e.seq)),events);
 const updated=x.round.events(x.r.id).find(e=>e.kind==='REPAIR_VERSION_UPDATED');
 assert.equal(updated.payload.from,'fixture');assert.equal(updated.payload.to,'fixture-deployed-v2');
 assert.equal(x.round.events(x.r.id).find(e=>e.kind==='START_ACCEPTED').payload.repairVersion,'fixture-deployed-v2');
});

test('fixed window stops exactly at selected limit without changing other entries or allocating them',async t=>{
 const x=await fixture(t),before=x.round.items(x.r.id).slice(2),w=await x.create({limit:2});await x.run(w);
 assert.equal(x.flow.submits,2);assert.equal(x.round.round(x.r.id).state,'PAUSED');assert.deepEqual(x.round.items(x.r.id).slice(2),before);
 assert.equal(x.round.windows.get(w.id).state,'COMPLETED');assert.equal(x.round.windows.view(w.id).counts.NEW_SUCCESS,2);
 assert(x.checked.every(n=>n<=2));assert.equal(x.round.items(x.r.id).filter(x=>x.queue_id).length,2);
 assert.throws(()=>x.round.resume(x.r.id),/创建下一轮/);
});
test('range plus autoContinue never grows beyond the selected positions',async t=>{
 const x=await fixture(t,9),w=await x.create({startPosition:3,endPosition:7,limit:2,autoContinue:true});await x.run(w);
 assert.equal(x.flow.submits,5);assert.equal(x.round.round(x.r.id).state,'PAUSED');
 assert.deepEqual(x.round.windows.history(x.r.id).map(w=>w.total),[1,2,2]);
 assert.deepEqual(x.round.items(x.r.id).filter(x=>x.state==='PENDING').map(x=>x.position),[1,2,8,9]);
 assert(x.checked.every(n=>n>=3&&n<=7));assert.equal(x.round.events(x.r.id).filter(e=>e.kind==='WINDOW_EXECUTION_BOUND').length,5);
});
test('100 different tasks advance with no per-item client calls, while task 101 stays unchanged',async t=>{
 const x=await fixture(t,101),last=x.round.items(x.r.id).at(-1),w=await x.create({limit:100});await x.run(w);
 assert.equal(x.flow.submits,100);assert.equal(new Set(x.flow.launches).size,100);assert.deepEqual(x.round.items(x.r.id).at(-1),last);
 const v=x.round.windows.view(w.id);assert.equal(v.total,100);assert.equal(v.submitted,100);assert.equal(v.resumedCount,0);assert.equal(v.counts.NEW_SUCCESS,100);
 assert.equal(x.round.windows.csv(w.id).split('\r\n').length,101);
});
test('pause then restart recovers same assignment and run, duplicate starts are refused',async t=>{
 const x=await fixture(t),w=await x.create({limit:2});x.hold();x.round.start(x.r.id,{windowId:w.id});
 while(!x.flow.active)await new Promise(r=>setTimeout(r,1));
 assert.throws(()=>x.round.start(x.r.id,{windowId:w.id}),/已有/);x.round.pause();x.release();await x.round.pending;
 const original=x.round.items(x.r.id)[0].run_id,recovered=x.make();
 assert.equal(recovered.windows.open(x.r.id).id,w.id);assert.throws(()=>recovered.resume(x.r.id,{windowId:'other'}),/执行轮次/);
 recovered.resume(x.r.id,{windowId:w.id});await recovered.pending;assert.equal(x.flow.submits,2);assert.equal(recovered.items(x.r.id)[0].run_id,original);
});
test('stop while paused seals historical outcomes and keeps unfinished items for a new window',async t=>{
 const x=await fixture(t),w=await x.create({limit:2});x.hold();x.round.start(x.r.id,{windowId:w.id});
 while(!x.flow.active)await new Promise(r=>setTimeout(r,1));x.round.pause();x.release();await x.round.pending;
 const key=x.round.items(x.r.id)[0].key;assert.equal(x.round.stop().stopped,true);
 const sealed=x.round.windows.view(w.id,{items:true});assert.equal(sealed.state,'STOPPED');assert.equal(sealed.counts.PENDING,2);
 const next=await x.create({limit:2});assert.equal(next.resumedCount,1);await x.run(next);
 assert.deepEqual(x.round.windows.view(w.id,{items:true}),sealed);assert.equal(x.round.item(x.r.id,key).state,'NEW_SUCCESS');assert.equal(x.flow.submits,2);
});
test('resumed current task cannot be silently omitted from a fresh window',async t=>{
 const x=await fixture(t),w=await x.create({limit:1});x.hold();x.round.start(x.r.id,{windowId:w.id});
 while(!x.flow.active)await new Promise(r=>setTimeout(r,1));x.round.stop();x.release();await x.round.pending;
 await assert.rejects(x.create({startPosition:2,limit:2}),/未结束断点/);assert.equal(x.flow.submits,0);
});
test('per-product failure remains in its original window while following item runs',async t=>{
 const x=await fixture(t);x.fail(1);const w=await x.create({limit:2});await x.run(w);
 const v=x.round.windows.view(w.id);assert.equal(v.counts.FAILED,1);assert.equal(v.counts.NEW_SUCCESS,1);assert.equal(v.submitted,1);assert.equal(x.flow.launches.length,2);
});
test('manifest, selection and bounded input tampering fail before any submit',async t=>{
 const x=await fixture(t);
 for(const input of [{limit:101},{limit:0},{startPosition:0},{endPosition:7},{autoContinue:'true'}])await assert.rejects(x.round.windows.preview(x.r.id,input));
 const p=await x.round.windows.preview(x.r.id,{limit:2});assert.throws(()=>x.round.windows.create({...p,selectionHash:'wrong'}),/版本/);
 const w=x.round.windows.create(p);x.store.db.prepare('UPDATE round_window_items SET task_hash=? WHERE window_id=? AND ordinal=1').run('changed',w.id);
 assert.throws(()=>x.round.start(x.r.id,{windowId:w.id}),/资料不一致/);assert.equal(x.flow.submits,0);
});
test('unknown submitted task prevents creating a fresh execution assignment',async t=>{
 const x=await fixture(t),entry=x.round.items(x.r.id)[0];x.round.update(x.r.id,entry.key,{state:'RESULT_UNKNOWN',submitted:1,failure_stage:'submit-once'});
 await assert.rejects(x.create({startPosition:2}),/核验原商品/);assert.equal(x.flow.submits,0);
});

test('window selection never rereads files; executor still checks each product before dispatch',async t=>{
 const x=await fixture(t,3);let checks=0;
 x.round.checkFiles=async()=>{checks++;throw Object.assign(Error('SOURCE_OR_ASSET_CHANGED'),{code:'TASK_DATA'});};
 const p=await x.round.windows.preview(x.r.id,{limit:3});assert.equal(p.count,3);assert.equal(checks,0);
 const w=x.round.windows.create(p);await x.run(w);
 assert(checks>0);assert.equal(x.flow.submits,0);assert.equal(x.round.items(x.r.id).filter(i=>i.state==='PREFLIGHT_SKIPPED').length,3);
});
