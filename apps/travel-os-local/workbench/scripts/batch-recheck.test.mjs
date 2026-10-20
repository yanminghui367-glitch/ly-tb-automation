import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {randomUUID} from 'node:crypto';
import {SourceStore,digest} from '../source-store.mjs';
import {BatchWorkflow} from '../batch-workflow.mjs';
import {ListingRound} from '../listing-round.mjs';

import {RoundManualSkip} from '../round-manual-skip.mjs';
import {handleOperationsSelection} from '../operations-api.mjs';
async function skippedFixture(t){
 const f=await fixture(t,4),origin=await f.create([1,2,3]);
 f.fail({position:1,code:'FORM_ERROR',reason:'页面控件异常'});await f.run(origin);
 const skipper=new RoundManualSkip(f.round);
 for(const key of f.keys.slice(0,2)){
  const scope={roundId:f.r.id,windowId:origin.window.id,key},s=skipper.read(scope);
  skipper.skip({...scope,expectedRevision:s.revision,requestId:randomUUID(),reason:'操作者跳过'});
 }
 f.fail(null);
 return {...f,origin,recheck:(positions=[1,2])=>f.preview(positions,{mode:'recheck',windowId:origin.window.id})};
}

test('recheck preserves original skipped history and runs only confirmed failed/skipped scope',async t=>{
 const f=await skippedFixture(t),p=await f.recheck();assert.equal(p.canCreate,true);assert.equal(p.count,2);
 const before=f.round.item(f.r.id,f.keys[0]),count=f.batch.store.item(before.queue_id).attempts,oldItems=f.round.windows.view(f.origin.window.id,{items:true}).items;
 const request=f.request(p),created=await f.round.selections.create(request);
 assert.equal(f.flow.launches.length,1,'creation itself cannot publish');
 assert.equal(f.round.windows.get(f.origin.window.id).state,'STOPPED');
 assert.deepEqual(f.round.windows.view(f.origin.window.id,{items:true}).items,oldItems);
 assert.equal(f.batch.store.item(before.queue_id).attempts,count);
 assert.equal((await f.round.selections.create(request)).replayed,true);
 await f.run(created);assert.deepEqual(f.flow.launches,[1,1,2]);assert.equal(f.flow.submits,2);
 const after=f.round.item(f.r.id,f.keys[0]);for(const key of ['run_id','queue_id','task_hash','batch_id'])assert.equal(after[key],before[key]);
 assert.equal(f.batch.store.item(after.queue_id).attempts,count+1);
 assert.equal(f.round.item(f.r.id,f.keys[2]).queue_id,null);assert.equal(f.round.item(f.r.id,f.keys[3]).queue_id,null);
 assert.deepEqual(f.round.windows.view(f.origin.window.id,{items:true}).items,oldItems);
 const again=await f.recheck();assert.equal(again.count,0);assert(again.excluded.every(x=>x.code==='SELECTION_SUBMISSION_PROTECTED'));
});
test('recheck rejects unassigned and untouched items, and requires explicit origin and bounded non-continuing scope',async t=>{
 const f=await skippedFixture(t);
 for(const positions of [[3],[4]])await assert.rejects(f.recheck(positions),{code:'SELECTION_RECHECK_SCOPE'});
 await assert.rejects(f.preview([1],{mode:'recheck'}),{code:'SELECTION_RECHECK_SCOPE'});
 await assert.rejects(f.preview([1],{mode:'recheck',windowId:f.origin.window.id,autoContinue:true}),{code:'SELECTION_RECHECK_SCOPE'});
 assert.equal((await f.preview([1],{mode:'retry'})).count,0,'ordinary retry still cannot reopen skipped');
});
test('late submission, exhausted budget, CAPTCHA and content holds remain excluded',async t=>{
 for(const kind of ['submit','budget','captcha','content']){
  const f=await skippedFixture(t),x=f.round.item(f.r.id,f.keys[0]);
  if(kind==='submit')f.store.event(x.run_id,'SUBMIT_CLICKED',{});
  if(kind==='budget')f.store.db.prepare('UPDATE batch_items SET attempts=max_attempts WHERE id=?').run(x.queue_id);
  if(kind==='captcha')f.store.db.prepare('UPDATE runs SET reason=? WHERE id=?').run('验证码尚未处理',x.run_id);
  if(kind==='content')f.round.assertContentForTask=()=>{throw Object.assign(Error('仍需审核'),{code:'CONTENT_REVIEW_REQUIRED'});};
  const p=await f.recheck([1]);assert.equal(p.count,0,kind);assert.equal(f.round.item(f.r.id,x.key).state,'MANUAL_SKIPPED');
 }
});
test('manual budget grant is scoped, audited, idempotent and never starts execution',async t=>{
 const f=await fixture(t,3),origin=await f.create([1]);f.fail({position:1,code:'FORM_ERROR',reason:'FORM_FAILURE: 页面控件未确认'});await f.run(origin);f.round.stop();
 const x=f.round.item(f.r.id,f.keys[0]);f.store.db.prepare("UPDATE batch_items SET attempts=max_attempts,state='FAILED' WHERE id=?").run(x.queue_id);
 const input={mode:'recheck',windowId:origin.window.id},p=await f.preview([1],input);assert.equal(p.count,0);assert.equal(p.excluded[0].code,'SELECTION_BUDGET_EXHAUSTED');assert.equal(p.excluded[0].manualBudgetGrantAvailable,true);
 const body={id:f.r.id,manifestHash:f.r.manifestHash,windowId:origin.window.id,keys:[x.key],addAttempts:1,reason:'已核对为提交前页面控件异常',requestId:randomUUID(),expectedRevision:p.expectedRevision};
 const product={round:f.round,roundItems:{host:{assert:async()=>{}}},capturing:false};
 const call=async()=>{let response;await handleOperationsSelection(product,{method:'POST'},{},new URL('http://localhost/api/v1/rounds/selection-budget'),{body:async()=>body,json:(_res,status,value)=>response={status,body:value}});return response;};
 const beforeLaunches=f.flow.launches.length,receipt=await call();assert.equal(receipt.status,200);assert.equal(receipt.body.granted[0].attempts,3);assert.equal(receipt.body.granted[0].maxAttempts,4);
 const after=f.batch.store.item(x.queue_id);assert.equal(after.attempts,3);assert.equal(after.max_attempts,4);assert.equal(f.round.item(f.r.id,x.key).extra_attempts,0);assert.equal(f.flow.launches.length,beforeLaunches);
 assert.equal(f.batch.store.events(after.batch).filter(e=>e.kind==='MANUAL_RETRY_BUDGET_GRANTED').length,1);assert.equal(f.round.events(f.r.id).filter(e=>e.kind==='MANUAL_RETRY_BUDGET_GRANTED').length,1);
 const replay=await call();assert.equal(replay.status,200);assert.equal(replay.body.replayed,true);assert.equal(f.batch.store.item(x.queue_id).max_attempts,4);assert.equal(f.flow.launches.length,beforeLaunches);
 const refreshed=await f.preview([1],input);assert.equal(refreshed.count,1);assert.equal(refreshed.eligible[0].maxAttempts,4);
 const selection=await f.round.selections.create(f.request(refreshed));assert.equal(f.flow.launches.length,beforeLaunches,'creating the newly allowed selection still does not execute it');
});
test('manual budget grant rechecks frozen files and writes nothing when files changed after preview',async t=>{
 const f=await fixture(t,2),origin=await f.create([1]);f.fail({position:1,code:'FORM_ERROR',reason:'FORM_FAILURE: 页面控件未确认'});await f.run(origin);f.round.stop();
 const x=f.round.item(f.r.id,f.keys[0]);f.store.db.prepare("UPDATE batch_items SET attempts=max_attempts,state='FAILED' WHERE id=?").run(x.queue_id);
 const input={mode:'recheck',windowId:origin.window.id},p=await f.preview([1],input),body={id:f.r.id,manifestHash:f.r.manifestHash,windowId:origin.window.id,keys:[x.key],addAttempts:1,reason:'已核对为提交前页面控件异常',requestId:randomUUID(),expectedRevision:p.expectedRevision};
 f.round.checkFiles=async()=>{throw Object.assign(Error('TASK_DATA: 图片文件已被移动'),{code:'TASK_DATA'});};
 const product={round:f.round,roundItems:{host:{assert:async()=>{}}},capturing:false};
 const call=async()=>{let response;await handleOperationsSelection(product,{method:'POST'},{},new URL('http://localhost/api/v1/rounds/selection-budget'),{body:async()=>body,json:(_res,status,value)=>response={status,body:value}});return response;};
 const before=f.batch.store.item(x.queue_id),response=await call();assert.equal(response.status,409);assert.equal(response.body.retainRequest,false);assert.match(response.body.error,/额度未增加：冻结资料复核失败/);assert.equal(f.batch.store.item(x.queue_id).max_attempts,before.max_attempts);
 assert.equal(f.batch.store.events(before.batch).filter(e=>e.kind==='MANUAL_RETRY_BUDGET_GRANTED').length,0);assert.equal(f.round.events(f.r.id,x.key).filter(e=>e.kind==='MANUAL_RETRY_BUDGET_GRANTED').length,0);
});
test('manual quota cannot be granted to submitted, unclear, skipped or products with three prior manual additions',async t=>{
 for(const kind of ['submitted','unclear','skipped','already-granted']){
  const f=await fixture(t,2),origin=await f.create([1]);f.fail({position:1,code:'FORM_ERROR',reason:'FORM_FAILURE: 页面控件未确认'});await f.run(origin);f.round.stop();
  const x=f.round.item(f.r.id,f.keys[0]);f.store.db.prepare("UPDATE batch_items SET attempts=max_attempts,state='FAILED' WHERE id=?").run(x.queue_id);
  if(kind==='submitted')f.store.event(x.run_id,'SUBMIT_CLICKED',{});
  if(kind==='unclear')f.store.db.prepare("UPDATE runs SET state='RESULT_UNKNOWN' WHERE id=?").run(x.run_id);
  if(kind==='skipped')f.store.db.prepare("UPDATE batch_items SET state='SKIPPED' WHERE id=?").run(x.queue_id);
  if(kind==='already-granted')for(let i=0;i<3;i++)f.batch.store.event(f.batch.store.item(x.queue_id).batch,x.queue_id,'MANUAL_RETRY_BUDGET_GRANTED',{addAttempts:1});
  const p=await f.preview([1],{mode:'recheck',windowId:origin.window.id}),body={roundId:f.r.id,windowId:origin.window.id,keys:[x.key],addAttempts:1,reason:'已核对原异常',requestId:randomUUID(),expectedRevision:p.expectedRevision};
  await assert.rejects(Promise.resolve().then(()=>f.round.selections.grantRetryBudget(body)),e=>e.code?.startsWith('SELECTION_'));
  assert.equal(f.batch.store.item(x.queue_id).max_attempts,3,kind);assert.equal(f.flow.launches.length,1,kind);
 }
});
test('changed preview cannot close original window or reopen any skipped task',async t=>{
 const f=await skippedFixture(t),p=await f.recheck();f.store.event(f.round.item(f.r.id,f.keys[0]).run_id,'STEP',{label:'新证据'});
 await assert.rejects(f.round.selections.create(f.request(p)),{code:'SELECTION_STALE_REVISION'});
 assert.equal(f.round.windows.history(f.r.id).length,1);assert.equal(f.round.item(f.r.id,f.keys[0]).state,'MANUAL_SKIPPED');assert.equal(f.round.windows.get(f.origin.window.id).finished,null);
});
test('transaction failure rolls back history sealing, selection and queue reopening together',async t=>{
 const f=await skippedFixture(t),p=await f.recheck(),before=f.round.windows.view(f.origin.window.id,{items:true});
 const update=f.round.update.bind(f.round);f.round.update=(...args)=>{if(args[2]?.reason?.includes('操作者确认重新检索'))throw Error('injected write failure');return update(...args);};
 await assert.rejects(f.round.selections.create(f.request(p)),/injected write failure/);
 assert.deepEqual(f.round.windows.view(f.origin.window.id,{items:true}),before);assert.equal(f.round.windows.history(f.r.id).length,1);assert.equal(f.batch.store.item(f.round.item(f.r.id,f.keys[0]).queue_id).state,'SKIPPED');
});
test('preflight skipped items must pass fresh file checks before requeueing',async t=>{
 const f=await fixture(t,2),origin=await f.create([1]);f.round.update(f.r.id,f.keys[0],{state:'PREFLIGHT_SKIPPED',reason:'缺少图片',failure_stage:'content-preflight'});
 const input={mode:'recheck',windowId:origin.window.id};
 f.round.checkFiles=async()=>{throw Object.assign(Error('TASK_DATA: 缺少图片'),{code:'TASK_DATA'});};assert.equal((await f.preview([1],input)).count,0);
 f.round.checkFiles=async()=>{};const p=await f.preview([1],input);assert.equal(p.count,1);const created=await f.round.selections.create(f.request(p));await f.run(created);assert.equal(f.flow.submits,1);
});
test('HTTP adapter accepts exact recheck scope and persisted create replay without launching',async t=>{
 const f=await skippedFixture(t),product={round:f.round,roundItems:{host:{assert:async()=>{}}},capturing:false};
 const input={id:f.r.id,manifestHash:f.r.manifestHash,windowId:f.origin.window.id,keys:f.keys.slice(0,2),mode:'recheck',limit:100,autoContinue:false,requestId:randomUUID()};
 const call=async(action,value)=>{let response;await handleOperationsSelection(product,{method:'POST'},{},new URL('http://localhost/api/v1/rounds/selection-'+action),{body:async()=>value,json:(res,status,body)=>response={status,body}});return response;};
 const p=await call('preview',input);assert.equal(p.status,200);assert.equal(p.body.count,2);assert.equal(p.body.windowId,input.windowId);
 const request={...input,expectedRevision:p.body.expectedRevision,selectionHash:p.body.selectionHash};
 const created=await call('create',request);assert.equal(created.status,200);assert.equal(created.body.selection.mode,'recheck');assert.equal(f.flow.launches.length,1);
 const replay=await call('create',request);assert.equal(replay.body.replayed,true);assert.equal(replay.body.windowId,created.body.windowId);assert.equal(f.flow.launches.length,1);
});
test('original completed window remains sealed and another open window blocks recheck',async t=>{
 const f=await skippedFixture(t);f.round.stop();
 const old=f.round.windows.view(f.origin.window.id,{items:true});const p=await f.recheck();assert.equal(p.canCreate,true);
 const next=await f.round.selections.create(f.request(p));assert.deepEqual(f.round.windows.view(f.origin.window.id,{items:true}),old);
 const again=await f.recheck();assert.equal(again.canCreate,false);assert(again.blockers.some(b=>b.code==='SELECTION_OLD_WINDOW_OPEN'));assert.equal(f.round.windows.open(f.r.id).id,next.window.id);
});
test('restart retains recheck origin, exact selected scope and read-only duplicate receipt',async t=>{
 const f=await skippedFixture(t),p=await f.recheck(),request=f.request(p),created=await f.round.selections.create(request),restarted=f.make();
 const receipt=await restarted.selections.create(request);assert.equal(receipt.replayed,true);assert.equal(receipt.window.id,created.window.id);assert.equal(f.flow.launches.length,1);
 restarted.start(f.r.id,{windowId:created.window.id});await restarted.pending;assert.deepEqual(f.flow.launches,[1,1,2]);assert.equal(f.flow.submits,2);
});
async function fixture(t,n=7){
 const dir=await mkdtemp(join(tmpdir(),'ly-selection-')),store=new SourceStore(join(dir,'source.sqlite'));
 t.after(async()=>{store.close();assert(resolve(dir).startsWith(resolve(tmpdir())+sep));await rm(dir,{recursive:true,force:true});});
 const shop={id:'selection-fixture',name:'隔离测试'},tasks=Array.from({length:n},(_,i)=>({shopId:shop.id,priority:i+1,source:{},listing:{type:'city',country:'测试',city:'城市'+(i+1),title:'标题'+(i+1)},assets:{main:[],secondary:[],details:[]},business:{shop_name:shop.name,price_cny:20,inventory:999999},adapterIssues:[]}));
 const importId=store.imported({sourceHash:'selection-fixture',tasks});let error=null,hold=false,release;
 const flow={store,artifacts:dir,active:null,launches:[],submits:0,stop:false,
  launch(id){assert(!this.active);this.active=id;this.stop=false;this.launches.push(store.run(id).task.priority);this.pending=(async()=>{
   store.move(id,'RUNNING');if(hold)await new Promise(r=>release=r);
   if(this.stop){store.move(id,'PAUSED','操作者暂停');return;}
   if(error&&store.run(id).task.priority===error.position){store.checkpoint(id,{step:error.step||'main-image-1',errorCode:error.code});store.move(id,error.state||'PAUSED',error.reason);return;}
   store.move(id,'SUBMITTING');this.submits++;store.event(id,'SUBMIT_CLICKED',{});store.move(id,'VERIFIED','',{itemId:String(888000+store.run(id).task.priority),status:'出售中',rowText:'隔离测试',screenshot:'fixture.png',verifiedAt:new Date().toISOString()});
  })().finally(()=>this.active=null);},async resume({id}){store.move(id,'QUEUED');this.launch(id);},pause(){this.stop=true;release?.();}
 };
 const batch=new BatchWorkflow(flow),make=()=>new ListingRound({source:flow,batch,shop,contentReviews:{assertApproved:()=>({decision:'PASS'})},checkFiles:async()=>{},assertExecution:async()=>{},verifyExisting:async({history})=>history||null,artifacts:join(dir,'rounds')});
 const round=make(),r=await round.create({importId,repairVersion:'fixture',expectedCount:n,authorization:{allowLive:true,maxSafeRecoveries:2,confirmedShop:shop.name,expectedCount:n}});
 store.db.prepare('UPDATE rounds SET gate=5 WHERE id=?').run(r.id);
 const keys=round.items(r.id).map(x=>x.key),preview=(positions,options={})=>round.selections.preview(r.id,{keys:positions.map(i=>keys[i-1]),...options});
 const request=p=>({roundId:r.id,keys:p.keys,mode:p.mode,limit:p.limit,autoContinue:p.autoContinue,selectionHash:p.selectionHash,expectedRevision:p.expectedRevision,requestId:randomUUID(),...(p.mode==='recheck'?{windowId:p.windowId}:{})});
 const create=async(positions,options={})=>round.selections.create(request(await preview(positions,options)));
 const run=async receipt=>{round.start(r.id,{windowId:receipt.window.id});await round.pending;};
 return {dir,store,flow,batch,round,r,keys,make,preview,request,create,run,fail:e=>error=e,hold:()=>hold=true,release:()=>{hold=false;release?.();}};
}

