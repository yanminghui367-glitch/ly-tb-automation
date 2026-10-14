import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {SourceStore,digest,destinationKey} from '../source-store.mjs';
import {BatchWorkflow} from '../batch-workflow.mjs';
import {ListingRound} from '../listing-round.mjs';

// Every store below is temporary; no production DB, Chrome or network is used.
const shop={id:'aggregate-test-shop',name:'隔离测试店铺'};
const task=n=>({taskId:'aggregate-task-'+n,shopId:shop.id,priority:n,source:{},listing:{type:'city',country:'测试国家',city:'测试城市'+n,title:'测试标题'+n},assets:{main:[],secondary:[],details:[]},business:{shop_name:shop.name,price_cny:20,inventory:999999},adapterIssues:[]});
const result=n=>({itemId:String(200000+n),status:'仓库中',rowText:'隔离测试结果',screenshot:'mock.png',verifiedAt:new Date().toISOString()});
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const ambiguity=()=>Object.assign(Error('完整后台清单存在候选；未提交'),{code:'EXISTENCE_AMBIGUOUS',isolated:true,candidateIds:['999999']});

async function fixture(t,n=6){
 const dir=await mkdtemp(join(tmpdir(),'ly-round-aggregate-'));
 assert(resolve(dir).startsWith(resolve(tmpdir())+sep));
 const store=new SourceStore(join(dir,'test.sqlite')),tasks=Array.from({length:n},(_,i)=>task(i+1));
 const importId=store.imported({sourceHash:'test-only-pool',tasks,summary:{total:n}});
 t.after(async()=>{store.close();await rm(dir,{recursive:true,force:true});});
 let inspect=async({history})=>history||null,executionCheck=async()=>{},behavior=()=>({state:'VERIFIED'}),held=null,onLaunch=()=>{};
 const flow={store,artifacts:dir,runtime:dir,active:null,queueLease:null,pending:null,stop:false,launches:[],submits:0,
  launch(id){
   assert.equal(this.active,null);this.active=id;this.stop=false;this.launches.push(id);
   this.pending=(async()=>{const run=store.run(id);store.move(id,'RUNNING');onLaunch(run);if(held)await held.promise;
    if(this.stop){store.move(id,'PAUSED','操作者暂停');return;}
    const outcome=behavior(run);if(outcome.state==='VERIFIED'||outcome.state==='RESULT_UNKNOWN'){
     store.move(id,'SUBMITTING');this.submits++;store.event(id,'SUBMIT_CLICKED',{});
     store.move(id,outcome.state,outcome.state==='RESULT_UNKNOWN'?'提交结果不明':'',outcome.state==='VERIFIED'?result(run.task.priority):undefined);
    }else store.move(id,outcome.state,outcome.reason);
   })().finally(()=>this.active=null);
  },
  async resume({id}){store.move(id,'QUEUED');this.launch(id);},pause(){this.stop=true;},preflight:async()=>{}
 };
 const batch=new BatchWorkflow(flow),round=new ListingRound({batch,source:flow,shop,contentReviews:{assertApproved:()=>({decision:"PASS"})},assertExecution:v=>executionCheck(v),verifyExisting:v=>inspect(v),checkFiles:async()=>{},artifacts:join(dir,'reports')});
 // Exports are exercised in the existing coordinator suite. Keep these tests
 // focused on durable state, execution ordering and aggregate transitions.
 round.report=async id=>round.summary(id);
 const authorization={source:'isolated-test',objectiveSha256:'b'.repeat(64),allowLive:true,maxSafeRecoveries:2,confirmedShop:shop.name,expectedCount:n};
 const create=()=>round.create({importId,authorization,repairVersion:'aggregate-test',expectedCount:n});
 const finish=async id=>{round.start(id);await round.pending;if(round.round(id).state==='PAUSED'&&round.round(id).gate===1){round.resume(id);await round.pending;}return round.view(id);};
 const seedBatch=(id,selected=tasks)=>{
  round.state(id,'RUNNING','隔离测试设置');const r=round.round(id),b=batch.store.create(importId,selected,shop.id,'LIVE',{reviewed:true,selectionHash:digest(selected),authorization,roundId:id,manifestHash:r.manifest_hash},{roundId:id});
  for(const q of batch.store.items(b.id))round.update(id,q.key,{queue_id:q.id,batch_id:b.id});batch.store.setBatch(b.id,'RUNNING','隔离测试计时');return b;
 };
 return {store,tasks,flow,batch,round,create,finish,seedBatch,importId,setInspect:f=>inspect=f,setExecutionCheck:f=>executionCheck=f,setBehavior:f=>behavior=f,onLaunch:f=>onLaunch=f,hold:()=>held=deferred(),release:()=>{held?.resolve();held=null;}};
}

test('mixed success and readonly isolation settle before entering next internal batch',async t=>{
 const x=await fixture(t),r=await x.create();x.setInspect(async({task,history})=>{if([3,5].includes(task.priority))throw ambiguity();return history||null;});
 let boundaryChecked=false;x.onLaunch(run=>{if(run.task.priority!==6)return;const previous=x.round.item(r.id,destinationKey(x.tasks[1])).batch_id;
  assert.equal(x.batch.store.batch(previous).state,'PAUSED');assert.equal(x.batch.store.batch(previous).segment_started,null);
  assert.deepEqual(x.batch.store.items(previous).map(q=>q.state),['SUCCEEDED','PENDING','SUCCEEDED','PENDING']);boundaryChecked=true;
 });
 const view=await x.finish(r.id);assert(boundaryChecked);assert.equal(view.state,'NEEDS_REVIEW');assert.equal(view.counts.NEW_SUCCESS,4);assert.equal(view.counts.RESULT_UNKNOWN,2);assert.equal(x.flow.submits,4);
 for(const n of [3,5]){const item=x.round.item(r.id,destinationKey(x.tasks[n-1])),q=x.batch.store.item(item.queue_id);assert.equal(q.state,'PENDING');assert.equal(q.attempts,0);assert.equal(item.failure_stage,'existing-listing-check');assert.equal(item.entered_publish,0);}
 assert.equal(x.store.db.prepare("SELECT COUNT(*) n FROM batches WHERE state='RUNNING'").get().n,0);
});

test('terminal batch stays COMPLETED, while isolated batch stays PAUSED after idempotent settlement',async t=>{
 const x=await fixture(t,2),r=await x.create(),b=x.seedBatch(r.id),items=x.batch.store.items(b.id),before=x.round.items(r.id);
 for(const item of before)x.round.update(r.id,item.key,{state:'RESULT_UNKNOWN',failure_stage:'existing-listing-check',reason:'候选待核验'});
 x.store.db.prepare('UPDATE batches SET elapsed_ms=?,segment_started=? WHERE id=?').run(12345,new Date(Date.now()-2000).toISOString(),b.id);
 const immutable=x.store.db.prepare('SELECT * FROM round_items WHERE round_id=? ORDER BY position').all(r.id),queues=x.batch.store.items(b.id);
 x.round.settleInternalBatches(r.id);const settled=x.batch.store.batch(b.id),eventCount=x.round.events(r.id).length;
 assert.equal(settled.state,'PAUSED');assert.equal(settled.segment_started,null);assert(settled.elapsed_ms>=14345);assert.match(settled.reason,/候选或内容隔离待核验/);
 x.round.settleInternalBatches(r.id);assert.equal(x.batch.store.batch(b.id).elapsed_ms,settled.elapsed_ms);assert.equal(x.round.events(r.id).length,eventCount);
 assert.deepEqual(x.store.db.prepare('SELECT * FROM round_items WHERE round_id=? ORDER BY position').all(r.id),immutable);assert.deepEqual(x.batch.store.items(b.id),queues);assert.equal(items.length,2);
});

test('all genuine terminal results can complete without leaving active timing',async t=>{
 const x=await fixture(t,2),r=await x.create(),b=x.seedBatch(r.id);
 for(const q of x.batch.store.items(b.id)){x.batch.store.claim(q.id,{roundId:r.id});x.batch.store.move(q.id,'SUCCEEDED','隔离测试',result(q.position));x.round.update(r.id,q.key,{state:'NEW_SUCCESS',result:result(q.position)});}
 x.round.settleInternalBatches(r.id);assert.equal(x.batch.store.batch(b.id).state,'COMPLETED');assert.equal(x.batch.store.batch(b.id).segment_started,null);
 const finished=x.batch.store.batch(b.id).finished;x.round.settleInternalBatches(r.id);assert.equal(x.batch.store.batch(b.id).finished,finished);
});

test('last queue success cannot complete a batch containing published content hold',async t=>{
 const x=await fixture(t,2),r=await x.create(),b=x.seedBatch(r.id),[first,last]=x.batch.store.items(b.id);
 for(const q of [first,last]){x.batch.store.claim(q.id,{roundId:r.id});x.batch.store.move(q.id,'SUCCEEDED','原平台核验',result(q.position));}
 x.round.update(r.id,first.key,{state:'RESULT_UNKNOWN',failure_stage:'content-review',reason:'已发布主图内容待核验',result:result(1)});
 x.round.update(r.id,last.key,{state:'NEW_SUCCESS',result:result(2)});
 const queues=x.batch.store.items(b.id),entries=x.round.items(r.id);
 x.round.syncQueue(x.round.item(r.id,last.key),'SUCCEEDED',result(2),'最后一项核验完成');
 assert.notEqual(x.batch.store.batch(b.id).state,'COMPLETED');x.round.settleInternalBatches(r.id);
 assert.equal(x.batch.store.batch(b.id).state,'PAUSED');assert.equal(x.batch.store.batch(b.id).segment_started,null);assert.match(x.batch.store.batch(b.id).reason,/内容隔离待核验/);
 assert.deepEqual(x.batch.store.items(b.id),queues);assert.deepEqual(x.round.items(r.id),entries);assert.equal(x.flow.submits,0);
});

test('finishInternal requires a complete terminal round mapping instead of queue success alone',async t=>{
 const x=await fixture(t,2),r=await x.create(),b=x.seedBatch(r.id),items=x.batch.store.items(b.id);
 for(const q of items){x.batch.store.claim(q.id,{roundId:r.id});x.batch.store.move(q.id,'SUCCEEDED','原平台核验',result(q.position));x.round.update(r.id,q.key,{state:'NEW_SUCCESS',result:result(q.position)});}
 x.round.update(r.id,items[0].key,{queue_id:null});x.round.finishInternal(b.id);assert.equal(x.batch.store.batch(b.id).state,'RUNNING');
 x.round.update(r.id,items[0].key,{queue_id:items[0].id});x.round.finishInternal(b.id);assert.equal(x.batch.store.batch(b.id).state,'COMPLETED');assert.equal(x.batch.store.batch(b.id).segment_started,null);
});

test('pause or stop during initial async permission check closes only idle aggregate timing',async t=>{
 for(const action of ['pause','stop'])await t.test(action,async t=>{
  const x=await fixture(t,2),r=await x.create(),b=x.seedBatch(r.id),gate=deferred();x.setExecutionCheck(()=>gate.promise);
  x.round.start(r.id);x.round[action]();assert.equal(x.batch.store.batch(b.id).state,'RUNNING');assert.equal(x.batch.active,'round:'+r.id);gate.resolve();await x.round.pending;
  assert.equal(x.round.round(r.id).state,action==='stop'?'STOPPED':'PAUSED');assert.equal(x.batch.store.batch(b.id).state,'PAUSED');assert.equal(x.batch.store.batch(b.id).segment_started,null);assert.equal(x.flow.launches.length,0);assert.equal(x.batch.active,null);
 });
});

test('pending source keeps owner and batch timing until actual safe stop',async t=>{
 const x=await fixture(t,2),r=await x.create();x.hold();x.round.start(r.id);while(!x.flow.active)await tick();const item=x.round.item(r.id,destinationKey(x.tasks[0]));x.round.pause();
 await tick();assert.equal(x.batch.active,'round:'+r.id);assert.equal(x.flow.queueLease,'round:'+r.id);assert.equal(x.batch.store.batch(item.batch_id).state,'RUNNING');assert(x.batch.store.batch(item.batch_id).segment_started);
 assert.throws(()=>x.round.settleInternalBatches(r.id),/尚未结束/);x.release();await x.round.pending;
 assert.equal(x.round.round(r.id).state,'PAUSED');assert.equal(x.batch.store.batch(item.batch_id).state,'PAUSED');assert.equal(x.batch.store.batch(item.batch_id).segment_started,null);assert.equal(x.batch.store.item(item.queue_id).state,'WAITING_HUMAN');assert.equal(x.batch.store.item(item.queue_id).attempts,1);assert.equal(x.flow.submits,0);assert.equal(x.flow.launches.length,1);assert.equal(x.batch.active,null);
});

test('unknown result and CAPTCHA remain explicit blockers after aggregate settlement',async t=>{
 for(const sourceState of ['RESULT_UNKNOWN','PAUSED_CAPTCHA'])await t.test(sourceState,async t=>{
  const x=await fixture(t,2),r=await x.create();x.setBehavior(()=>({state:sourceState,reason:'PAUSED_CAPTCHA'}));x.round.start(r.id);await x.round.pending;
  const item=x.round.items(r.id)[0],expected=sourceState==='RESULT_UNKNOWN'?'RESULT_UNKNOWN':'WAITING_HUMAN';assert.equal(x.round.round(r.id).state,expected);assert.equal(item.state,expected);assert.equal(x.store.run(item.run_id).state,sourceState);assert.equal(x.batch.store.item(item.queue_id).state,'WAITING_HUMAN');assert.equal(x.batch.store.batch(item.batch_id).state,'PAUSED');assert.equal(x.batch.store.batch(item.batch_id).segment_started,null);assert.match(x.batch.store.batch(item.batch_id).reason,new RegExp(expected));assert.equal(x.flow.launches.length,1);
 });
});

test('100 to 100 handoff with isolated rows keeps one owner and <=100 identities per batch',async t=>{
 const x=await fixture(t,207),r=await x.create();
 x.setInspect(async({task,history})=>{if([2,100,102,200].includes(task.priority))throw ambiguity();return history||null;});
 const owners=[];let handoffChecked=false;x.onLaunch(run=>{owners.push(x.flow.queueLease);assert.equal(x.batch.active,'round:'+r.id);if(run.task.priority===107){const first=x.round.item(r.id,destinationKey(x.tasks[6]));assert.equal(x.batch.store.items(first.batch_id).length,100);assert.equal(x.batch.store.batch(first.batch_id).state,'PAUSED');assert.equal(x.batch.store.batch(first.batch_id).segment_started,null);for(const n of [100,102]){const item=x.round.item(r.id,destinationKey(x.tasks[n-1]));assert.equal(item.batch_id,first.batch_id);assert.equal(item.state,'RESULT_UNKNOWN');assert.equal(item.failure_stage,'existing-listing-check');assert.equal(x.batch.store.item(item.queue_id).state,'PENDING');assert.equal(x.batch.store.item(item.queue_id).attempts,0);}handoffChecked=true;}});
 const v=await x.finish(r.id),internal=x.round.events(r.id).filter(e=>e.kind==='INTERNAL_BATCH_CREATED');assert(handoffChecked);assert.deepEqual(internal.map(e=>e.payload.count),[1,4,100,100,1]);assert.equal(v.state,'NEEDS_REVIEW');assert.equal(v.counts.NEW_SUCCESS,203);assert.equal(v.counts.RESULT_UNKNOWN,4);assert.equal(Object.values(v.counts).reduce((a,b)=>a+b),207);assert.equal(new Set(x.flow.launches).size,203);assert.equal(x.flow.submits,203);assert(owners.every(owner=>owner==='round:'+r.id));assert.equal(x.store.db.prepare("SELECT COUNT(*) n FROM batches WHERE state='RUNNING'").get().n,0);
});

test('wrong shop, hash, partial mapping and run identity fail before any aggregate mutation',async t=>{
 for(const corruption of ['shop','reviewHash','taskHash','mapping','run'])await t.test(corruption,async t=>{
  const x=await fixture(t,2),r=await x.create(),b=x.seedBatch(r.id),q=x.batch.store.items(b.id)[0];
  if(corruption==='shop')x.store.db.prepare('UPDATE batches SET shop=? WHERE id=?').run('other-shop',b.id);
  if(corruption==='reviewHash'){const review=x.batch.store.batch(b.id).review;review.manifestHash='changed';x.store.db.prepare('UPDATE batches SET review=? WHERE id=?').run(JSON.stringify(review),b.id);}
  if(corruption==='taskHash'){const changed=structuredClone(q.task);changed.listing.title='改动';x.store.db.prepare('UPDATE batch_items SET task=? WHERE id=?').run(JSON.stringify(changed),q.id);}
  if(corruption==='mapping')x.store.db.prepare('UPDATE round_items SET queue_id=NULL,batch_id=NULL WHERE round_id=? AND key=?').run(r.id,q.key);
  if(corruption==='run'){const run=x.store.create(x.importId,x.tasks[1],'LIVE','SOURCE',{reviewed:true,taskHash:digest(x.tasks[1])});x.batch.store.attach(q.id,run.id);x.round.update(r.id,q.key,{run_id:run.id});}
  const original=x.batch.store.batch(b.id);assert.throws(()=>x.round.settleInternalBatches(r.id),/不一致|完整映射/);assert.deepEqual(x.batch.store.batch(b.id),original);
 });
});

test('a failing candidate rolls back settlement of an earlier valid candidate',async t=>{
 const x=await fixture(t,2),r=await x.create(),b1=x.seedBatch(r.id,[x.tasks[0]]),b2=x.seedBatch(r.id,[x.tasks[1]]);
 x.store.db.prepare('UPDATE batches SET shop=? WHERE id=?').run('other-shop',b2.id);const before=[b1,b2].map(b=>x.batch.store.batch(b.id));
 assert.throws(()=>x.round.settleInternalBatches(r.id),/归属/);assert.deepEqual([b1,b2].map(b=>x.batch.store.batch(b.id)),before);assert.equal(x.round.events(r.id).filter(e=>e.kind==='INTERNAL_BATCH_SETTLED').length,0);
});

test('unrelated batch aggregate is not touched by settlement',async t=>{
 const x=await fixture(t,1),r=await x.create(),b=x.seedBatch(r.id);x.store.db.prepare(`INSERT INTO batches(id,imported,shop,mode,state,review,at,segment_started) VALUES(?,?,?,?,?,?,?,?)`).run('unrelated',x.importId,'other-shop','LIVE','RUNNING','{}',new Date().toISOString(),new Date().toISOString());
 const before=x.batch.store.batch('unrelated');x.round.settleInternalBatches(r.id);assert.equal(x.batch.store.batch(b.id).state,'PAUSED');assert.deepEqual(x.batch.store.batch('unrelated'),before);
});

test('finally waits source promise even when aggregate rows look idle',async t=>{
 const x=await fixture(t,1),r=await x.create(),b=x.seedBatch(r.id),pending=deferred();x.flow.pending=pending.promise;x.round.pump=async()=>x.round.state(r.id,'PAUSED','测试安全停止');x.round.start(r.id);await tick();
 assert.equal(x.batch.active,'round:'+r.id);assert.equal(x.batch.store.batch(b.id).state,'RUNNING');pending.resolve();await x.round.pending;assert.equal(x.batch.store.batch(b.id).state,'PAUSED');assert.equal(x.batch.active,null);
});

test('aggregate failure overrides COMPLETED with SYSTEM_BLOCKED and preserves bad identity',async t=>{
 const x=await fixture(t,1),r=await x.create(),b=x.seedBatch(r.id);x.round.pump=async()=>{x.store.db.prepare('UPDATE batches SET shop=? WHERE id=?').run('wrong-shop',b.id);x.round.state(r.id,'COMPLETED','测试已结束');};
 x.round.start(r.id);await x.round.pending;assert.equal(x.round.round(r.id).state,'SYSTEM_BLOCKED');assert.equal(x.batch.store.batch(b.id).state,'RUNNING');assert.equal(x.batch.store.batch(b.id).shop,'wrong-shop');assert(x.round.events(r.id).some(e=>e.kind==='INTERNAL_BATCH_SETTLE_ERROR'));assert.equal(x.batch.active,null);assert.equal(x.flow.launches.length,0);
});

test('unsettled real source retains owner even after outer coordinator returns',async t=>{
 const x=await fixture(t,1),r=await x.create(),b=x.seedBatch(r.id);x.round.pump=async()=>{const run=x.store.create(x.importId,x.tasks[0],'LIVE','SOURCE',{reviewed:true,taskHash:digest(x.tasks[0])});x.store.move(run.id,'RUNNING');x.flow.active=run.id;x.flow.pending=Promise.resolve();x.round.state(r.id,'PAUSED','测试外层结束');};
 x.round.start(r.id);await x.round.pending;assert.equal(x.round.round(r.id).state,'SYSTEM_BLOCKED');assert.equal(x.round.active,r.id);assert.equal(x.batch.active,'round:'+r.id);assert.equal(x.flow.queueLease,'round:'+r.id);assert.equal(x.batch.store.batch(b.id).state,'RUNNING');assert.throws(()=>x.round.start(r.id),/已有执行/);
});

test('self-referential source pending cannot deadlock or release owner',async t=>{
 const x=await fixture(t,1),r=await x.create();x.round.pump=async()=>{await tick();x.flow.pending=x.round.pending;x.round.state(r.id,'PAUSED','测试自等待');};
 x.round.start(r.id);await x.round.pending;assert.equal(x.round.round(r.id).state,'SYSTEM_BLOCKED');assert.match(x.round.round(r.id).reason,/自等待/);assert.equal(x.batch.active,'round:'+r.id);assert.equal(x.flow.queueLease,'round:'+r.id);
});
