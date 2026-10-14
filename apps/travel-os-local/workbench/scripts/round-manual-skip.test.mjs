import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {SourceStore,digest,destinationKey} from '../source-store.mjs';
import {BatchWorkflow} from '../batch-workflow.mjs';
import {ListingRound} from '../listing-round.mjs';
import {RoundManualSkip} from '../round-manual-skip.mjs';
const shop={id:'wuzhou-changyou',name:'五洲畅游'};
const task=n=>({schemaVersion:2,taskId:'isolated-'+n,shopId:shop.id,priority:n,source:{},listing:{type:'city',country:'fixture-country',city:'fixture-city-'+n,title:'fixture-title-'+n},assets:{main:[],secondary:[],details:[]},business:{shop_name:shop.name,price_cny:20,inventory:999999},adapterIssues:[]});
const result=n=>({itemId:String(100000+n),status:'仓库中',rowText:'isolated fixture only',screenshot:'fixture.png',verifiedAt:new Date().toISOString()});
async function setup(t,{limit=3}={}){
 const artifacts=join(import.meta.dirname,'../output/item-action-tests','skip-fixture-'+randomUUID());await mkdir(artifacts,{recursive:true});
 const store=new SourceStore(':memory:');t.after(()=>store.close());const tasks=[task(1),task(2),task(3)],importId=store.imported({sourceHash:'fixture',tasks,summary:{total:3}});
 let hold=false,release;
 const flow={store,artifacts,active:null,queueLease:null,submits:0,launches:[],stop:false,
  launch(id){assert.equal(this.active,null);this.active=id;this.stop=false;this.launches.push(id);this.pending=(async()=>{let r=store.run(id);store.move(id,'RUNNING');if(hold)await new Promise(r=>release=r);if(this.stop){store.move(id,'PAUSED','操作者暂停');return;}store.move(id,'SUBMITTING');store.event(id,'SUBMIT_CLICKED',{});this.submits++;store.move(id,'VERIFIED','',result(r.task.priority));})().finally(()=>this.active=null);},
  async resume({id}){store.move(id,'QUEUED');this.launch(id);},pause(){this.stop=true;release?.();},preflight:async()=>{}};
 const batch=new BatchWorkflow(flow),round=new ListingRound({batch,source:flow,shop,assertExecution:async()=>{},verifyExisting:async({history})=>history||null,checkFiles:async()=>{},contentReviews:{assertApproved:()=>({decision:'PASS'})},artifacts});
 const authorization={allowLive:true,maxSafeRecoveries:2,confirmedShop:shop.name,expectedCount:3};
 const r=await round.create({importId,authorization,repairVersion:'ISOLATED_SKIP_ONLY',expectedCount:3});
 store.db.prepare('UPDATE rounds SET gate=5 WHERE id=?').run(r.id);
 const preview=await round.windows.preview(r.id,{limit}),w=round.windows.create(preview),action=new RoundManualSkip(round);
 const scope=(n=1)=>({roundId:r.id,windowId:w.id,key:destinationKey(tasks[n-1])});
 const request=(n=1,extra={})=>({...scope(n),expectedRevision:action.inspect(scope(n)).revision,requestId:'request-'+n,reason:'operator fixture skip',...extra});
 const pause=async()=>{hold=true;round.start(r.id,{windowId:w.id});for(let i=0;!flow.active&&i<1000;i++)await new Promise(r=>setTimeout(r,1));assert(flow.active);round.pause();release?.();await round.pending;hold=false;assert.equal(flow.submits,0);};
 return {store,tasks,flow,batch,round,action,r,w,scope,request,pause};
}
test('unstarted skip is a distinct terminal state, changes one item and creates no run',async t=>{
 const f=await setup(t),out=f.action.skip(f.request());
 assert.equal(out.outcome.state,'MANUAL_SKIPPED');assert.equal(f.round.view(f.r.id).total,3);assert.equal(f.round.view(f.r.id).counts.MANUAL_SKIPPED,1);
 assert.equal(f.round.windows.view(f.w.id).ended,1);assert.equal(f.round.windows.view(f.w.id).counts.MANUAL_SKIPPED,1);assert.match(f.round.windows.csv(f.w.id),/MANUAL_SKIPPED/);
 assert.equal(f.store.db.prepare('SELECT COUNT(*) n FROM runs').get().n,0);assert.equal(f.action.attempts.list(f.r.id,f.scope().key).length,1);
 assert.equal(f.action.attempts.get(out.attemptId).before.historyCoverage,'PRIOR_HISTORY_NOT_SEGMENTED');assert.equal(f.flow.submits,0);
});
test('normal pump does not publish manually skipped item and preserves frozen identities',async t=>{
 const f=await setup(t),keys=f.round.items(f.r.id).map(x=>[x.key,x.task_hash]);f.action.skip(f.request());
 f.round.start(f.r.id,{windowId:f.w.id});await f.round.pending;
 assert.equal(f.flow.submits,2);assert.equal(f.round.view(f.r.id).counts.MANUAL_SKIPPED,1);assert.equal(f.round.view(f.r.id).counts.NEW_SUCCESS,2);
 assert.equal(f.round.windows.view(f.w.id).ended,3);assert.equal(f.round.windows.view(f.w.id).state,'COMPLETED');
 assert.deepEqual(f.round.items(f.r.id).map(x=>[x.key,x.task_hash]),keys);assert.equal(f.flow.launches.some(id=>f.store.run(id).task.priority===1),false);
});
test('same request replays after window completion, changed reason or target conflicts',async t=>{
 const f=await setup(t),req=f.request(),a=f.action.skip(req);f.round.start(f.r.id,{windowId:f.w.id});await f.round.pending;
 const before=f.store.db.prepare('SELECT COUNT(*) n FROM round_events').get().n;
 assert.deepEqual(f.action.skip(req),{replayed:true,attemptId:a.attemptId,outcome:a.outcome});
 assert.throws(()=>f.action.skip({...req,reason:'different'}),/REQUEST_CONFLICT/);assert.throws(()=>f.action.skip({...req,key:f.scope(2).key}),/REQUEST_CONFLICT/);
 assert.equal(f.store.db.prepare('SELECT COUNT(*) n FROM round_events').get().n,before);
});
test('mandatory reason, exact scope and stale revision are enforced',async t=>{
 const f=await setup(t,{limit:2});assert.throws(()=>f.action.skip(f.request(1,{reason:'  '})),/REQUEST_INVALID/);
 assert.throws(()=>f.action.inspect(f.scope(3)),/SCOPE_MISMATCH/);assert.throws(()=>f.action.inspect({...f.scope(),windowId:'missing'}));
 const req=f.request();f.round.event(f.r.id,null,'NEW_STATE_EVENT',{});assert.throws(()=>f.action.skip(req),/STALE_REVISION/);
 assert.equal(f.round.item(f.r.id,f.scope().key).state,'PENDING');
});
test('all existing owner leases and an unsettled source block skip',async t=>{
 const f=await setup(t);
 for(const [object,field] of [[f.round,'active'],[f.batch,'active'],[f.flow,'active'],[f.flow,'queueLease']]){object[field]='other-owner';assert.equal(f.action.inspect(f.scope()).allowed,false);object[field]=null;}
 const req=f.request();f.round.creating=true;assert.throws(()=>f.action.skip(req),/NOT_SETTLED/);f.round.creating=false;
});
test('paused original task retains run and attempt counters after atomic skip',async t=>{
 const f=await setup(t);await f.pause();const x=f.round.item(f.r.id,f.scope().key),beforeRun=f.store.run(x.run_id),beforeQ=f.batch.store.item(x.queue_id);
 const a=f.action.skip(f.request());assert.equal(f.round.item(f.r.id,x.key).state,'MANUAL_SKIPPED');assert.deepEqual(f.store.run(x.run_id),beforeRun);
 const q=f.batch.store.item(x.queue_id);assert.equal(q.state,'SKIPPED');assert.equal(q.attempts,beforeQ.attempts);assert.equal(q.run_id,x.run_id);assert.equal(f.action.attempts.get(a.attemptId).run_id,x.run_id);
});
test('submitted evidence of every supported kind forbids skipping, even if parent is stale',async t=>{
 for(const kind of ['SUBMITTING','SUBMIT_CLICKED','SUBMIT_EVIDENCE','RESULT_UNKNOWN','VERIFIED']){
  const f=await setup(t);await f.pause();const x=f.round.item(f.r.id,f.scope().key);
  f.store.event(x.run_id,kind,{});const req=f.request();assert.equal(f.action.inspect(f.scope()).allowed,false);
  assert.throws(()=>f.action.skip(req),/SUBMISSION_PROTECTED/);
 }
});
test('candidate, content, human and prior success states cannot be hidden by skip',async t=>{
 const f=await setup(t);for(const [state,stage] of [['RESULT_UNKNOWN','existing-listing-check'],['RESULT_UNKNOWN','content-review'],['WAITING_HUMAN','content-preflight'],['NEW_SUCCESS',''],['EXISTING_VERIFIED','']]){
  f.round.update(f.r.id,f.scope().key,{state,failure_stage:stage});assert.equal(f.action.inspect(f.scope()).allowed,false);assert.throws(()=>f.action.skip(f.request()),/PROTECTED/);
 }
});
test('failure after queue write rolls back queue, parent, events and attempt together',async t=>{
 const f=await setup(t);await f.pause();const x=f.round.item(f.r.id,f.scope().key),q=f.batch.store.item(x.queue_id),events=f.batch.store.events(q.batch),roundEvents=f.round.events(f.r.id),attempts=f.action.attempts.list(f.r.id,x.key);
 f.store.db.exec("CREATE TRIGGER injected_failure BEFORE UPDATE ON round_items WHEN NEW.state='MANUAL_SKIPPED' BEGIN SELECT RAISE(ABORT,'injected'); END");
 assert.throws(()=>f.action.skip(f.request()),/injected/);assert.deepEqual(f.round.item(f.r.id,x.key),x);assert.deepEqual(f.batch.store.item(q.id),q);
 assert.deepEqual(f.batch.store.events(q.batch),events);assert.deepEqual(f.round.events(f.r.id),roundEvents);assert.deepEqual(f.action.attempts.list(f.r.id,x.key),attempts);
});
test('open execution attempt closes honestly and links a separate manual decision',async t=>{
 const f=await setup(t);await f.pause();const x=f.round.item(f.r.id,f.scope().key),history=f.action.attempts.list(f.r.id,x.key),parent=history.at(-1);assert.equal(parent.kind,'INITIAL');assert(parent.finished_at);
 const old=f.store.transaction(()=>f.action.attempts.begin({scope:{...f.scope(),shopId:shop.id,taskHash:x.task_hash,repairVersion:f.r.repairVersion},kind:'RESUME',parentAttemptId:parent.id,requestId:'execution',before:{state:'PENDING'}}));
 const a=f.action.skip(f.request()),prior=f.action.attempts.get(old.id),decision=f.action.attempts.get(a.attemptId);
 assert.equal(prior.outcome.disposition,'ENDED_BY_MANUAL_SKIP');assert.equal(prior.before.state,'PENDING');assert.equal(decision.parent_attempt_id,old.id);assert.equal(decision.kind,'MANUAL_SKIP');assert.equal(f.action.attempts.openFor(x.key),null);
 assert.deepEqual(f.action.attempts.list(f.r.id,x.key),[...history,prior,decision]);
});
test('unmapped original result-unknown run cannot be hidden by an empty parent run id',async t=>{
 const f=await setup(t),req=f.request(),r=f.store.create(f.r.importId,f.tasks[0],'LIVE','SOURCE',{reviewed:true,taskHash:digest(f.tasks[0])});
 f.store.move(r.id,'RUNNING');f.store.move(r.id,'SUBMITTING');f.store.move(r.id,'RESULT_UNKNOWN');
 assert.throws(()=>f.action.inspect(f.scope()),/RUN_MISMATCH/);assert.throws(()=>f.action.skip(req),/RUN_MISMATCH/);
 assert.equal(f.store.run(r.id).state,'RESULT_UNKNOWN');assert.equal(f.round.item(f.r.id,f.scope().key).state,'PENDING');
});
test('unmapped original queue fails closed instead of leaving two conflicting outcomes',async t=>{
 const f=await setup(t);await f.pause();const req=f.request(),x=f.round.item(f.r.id,f.scope().key),q=f.batch.store.item(x.queue_id);
 f.store.db.prepare('UPDATE round_items SET queue_id=NULL,batch_id=NULL WHERE round_id=? AND key=?').run(f.r.id,x.key);
 assert.throws(()=>f.action.skip(req),/QUEUE_MISMATCH/);assert.deepEqual(f.batch.store.item(q.id),q);
});
test('checkpoint IDs, success addresses, submit steps and each result store independently protect the original outcome',async t=>{
 const cases=[
  (f,x)=>f.store.checkpoint(x.run_id,{itemId:'1234567890123'}),
  (f,x)=>f.store.checkpoint(x.run_id,{successUrl:'https://item.upload.taobao.com/sell/publish/success?primaryId=1234567890123'}),
  (f,x)=>f.store.checkpoint(x.run_id,{reconciliation:{itemId:'1234567890123'}}),
  (f,x)=>f.store.checkpoint(x.run_id,{step:'submit-once'}),
  (f,x)=>f.store.checkpoint(x.run_id,{name:'verify-platform-result'}),
  (f,x)=>f.store.db.prepare('UPDATE runs SET result=? WHERE id=?').run(JSON.stringify({itemId:'1234567890123'}),x.run_id),
  (f,x)=>f.round.update(f.r.id,x.key,{result:{itemId:'1234567890123'}}),
  (f,x)=>f.store.db.prepare('UPDATE batch_items SET result=? WHERE id=?').run(JSON.stringify({itemId:'1234567890123'}),x.queue_id)
 ];
 for(const inject of cases){const f=await setup(t);await f.pause();const x=f.round.item(f.r.id,f.scope().key);inject(f,x);
   const before=f.store.run(x.run_id),attempts=f.action.attempts.list(f.r.id,x.key);assert.equal(f.action.inspect(f.scope()).allowed,false);assert.throws(()=>f.action.skip(f.request()),/SUBMISSION_PROTECTED/);
   assert.deepEqual(f.store.run(x.run_id),before);assert.equal(f.round.item(f.r.id,x.key).state,'PENDING');assert.deepEqual(f.action.attempts.list(f.r.id,x.key),attempts);
 }
});
