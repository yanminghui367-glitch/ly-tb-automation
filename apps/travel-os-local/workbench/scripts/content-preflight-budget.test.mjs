import test from 'node:test';
import assert from 'node:assert/strict';
import {SourceStore,digest} from '../source-store.mjs';
import {BatchWorkflow} from '../batch-workflow.mjs';
import {ListingRound} from '../listing-round.mjs';
import {contentPreflightRepairPlan as plan,applyContentPreflightRepair as apply} from '../content-preflight-budget.mjs';

const reason='CONTENT_REVIEW_REQUIRED: 缺少固定清单与主图内容审核';
async function fixture(t){
 const store=new SourceStore(':memory:');t.after(()=>store.close());
 const task={shopId:'shop-budget-test',taskId:'queue-budget-test',listing:{type:'country',country:'英国',title:'英国导游'},business:{shop_name:'隔离店'},assets:{main:[]},adapterIssues:[]};
 const importId=store.imported({sourceHash:'isolated',tasks:[task]}),source={store,artifacts:'unused',active:null},batch=new BatchWorkflow(source);
 const b=batch.store.create(importId,[task],task.shopId,'LIVE',{reviewed:true,selectionHash:digest([task]),authorization:'isolated'}),q=batch.store.items(b.id)[0];
 const run=store.create(importId,task,'LIVE','SOURCE',{reviewed:true,taskHash:digest(task)});batch.store.attach(q.id,run.id);
 for(let n=0;n<3;n++){
  if(n){batch.store.move(q.id,'RETRY');store.move(run.id,'QUEUED','操作者请求恢复；重新校验页面');}
  batch.store.claim(q.id);store.move(run.id,'RUNNING');
  store.checkpoint(run.id,{pausedAt:new Date().toISOString(),reason,errorCode:'CONTENT_REVIEW_REQUIRED',screenshot:null,screenshotAt:new Date().toISOString(),screenshotError:'当前没有可截图的页面'});
  store.move(run.id,'PAUSED',reason);batch.store.move(q.id,'FAILED',reason);
 }
 batch.store.setBatch(b.id,'PAUSED',reason);
 const roundOwner=new ListingRound({batch,source,shop:{id:task.shopId,name:'隔离店'},artifacts:'unused',rules:null,contentReviews:{},assertExecution:async()=>{},verifyExisting:async()=>null,checkFiles:async()=>{}});
 // Persist the same adopted legacy mapping; no execution or browser is involved.
 const at=new Date().toISOString(),r={id:'round-budget',shop:task.shopId,import_id:importId,state:'PAUSED',repair_version:'isolated',authorization:{allowLive:true,maxSafeRecoveries:2}};
 store.db.prepare('INSERT INTO rounds(id,shop,import_id,manifest_hash,authorization_hash,authorization,repair_version,state,at,updated) VALUES(?,?,?,?,?,?,?,?,?,?)').run(r.id,r.shop,importId,'manifest','auth',JSON.stringify(r.authorization),r.repair_version,r.state,at,at);
 store.db.prepare('INSERT INTO round_items(round_id,key,position,task,task_hash,queue_id,batch_id,run_id,baseline_attempts,updated) VALUES(?,?,?,?,?,?,?,?,?,?)').run(r.id,q.key,1,JSON.stringify(task),digest(task),q.id,b.id,run.id,3,at);
 const input=()=>({source,batch,round:roundOwner.round(r.id),item:roundOwner.item(r.id,q.key)});
 const snapshot=()=>JSON.stringify({q:batch.store.item(q.id),events:store.events(run.id),credits:store.db.prepare('SELECT * FROM content_preflight_credits').all(),batchEvents:batch.store.events(b.id)});
 return {store,source,batch,q,run,r,roundOwner,input,snapshot};
}

test('exact legacy preflight failures gain one bounded append-only credit; raw history is retained',async t=>{
 const f=await fixture(t),before=f.snapshot(),events=f.store.events(f.run.id);
 assert.equal(plan(f.input()).eligible,true);assert.equal(f.snapshot(),before,'preview does not write');
 const repaired=apply(f.input());assert.equal(repaired.credit,3);assert.equal(repaired.executionStarted,false);
 assert.equal(f.batch.store.item(f.q.id).attempts,3);assert.equal(f.batch.store.item(f.q.id).max_attempts,3);assert.equal(f.batch.store.item(f.q.id).state,'RETRY');
 assert.deepEqual(f.store.events(f.run.id),events);assert.deepEqual(f.batch.store.preflightBudget(f.q.id),{preflightCredit:3,effectiveAttempts:0});
 const after=f.snapshot();assert.equal(apply(f.input()).alreadyApplied,true);assert.equal(f.snapshot(),after);assert.equal(plan(f.input()).alreadyApplied,true);
 assert.throws(()=>f.store.db.exec('DELETE FROM content_preflight_credits'),/append-only/);assert.throws(()=>f.store.db.exec('UPDATE content_preflight_credits SET credit=4'),/append-only/);
 f.store.db.prepare("UPDATE rounds SET state='RUNNING' WHERE id=?").run(f.r.id);
 for(let n=4;n<=6;n++){
  f.batch.store.claim(f.q.id,{roundId:f.r.id});assert.equal(f.batch.store.item(f.q.id).attempts,n);
  f.batch.store.move(f.q.id,'FAILED',reason);f.batch.store.move(f.q.id,'RETRY');
 }
 const exhausted=f.snapshot();assert.throws(()=>f.batch.store.claim(f.q.id,{roundId:f.r.id}),e=>e.code==='ITEM_RETRY_BUDGET_SYSTEM_UNCONFIRMED');assert.equal(f.snapshot(),exhausted);
 assert.equal(f.store.db.prepare('SELECT COUNT(*) n FROM content_preflight_credits').get().n,1);assert.equal(f.roundOwner.item(f.r.id,f.q.key).extra_attempts,0);
});

test('credit cannot change a legacy claim without a round permit',async t=>{
 const f=await fixture(t);apply(f.input());assert.throws(()=>f.batch.store.claim(f.q.id),e=>e.code==='ITEM_RETRY_BUDGET_EXHAUSTED');
});

test('credited legacy baseline retains exactly two authorized pre-submit system recoveries',async t=>{
 const f=await fixture(t);apply(f.input());const originalEvents=f.store.events(f.run.id);
 f.store.db.prepare("UPDATE rounds SET state='RUNNING' WHERE id=?").run(f.r.id);
 f.store.db.prepare('UPDATE batch_items SET attempts=6 WHERE id=?').run(f.q.id);
 f.store.db.prepare("UPDATE runs SET reason='FORM_BRAND_OPTION_MISSING' WHERE id=?").run(f.run.id);
 for(const n of [7,8]){
  f.batch.store.claim(f.q.id,{roundId:f.r.id});
  assert.equal(f.batch.store.item(f.q.id).attempts,n);assert.equal(f.roundOwner.item(f.r.id,f.q.key).baseline_attempts,3);
  assert.equal(f.roundOwner.item(f.r.id,f.q.key).extra_attempts,n-6);
  f.batch.store.move(f.q.id,'FAILED','FORM_BRAND_OPTION_MISSING');f.batch.store.move(f.q.id,'RETRY');
 }
 const exhausted=f.snapshot();assert.throws(()=>f.batch.store.claim(f.q.id,{roundId:f.r.id}),e=>e.code==='ITEM_RETRY_BUDGET_EXTRA_UNSAFE');assert.equal(f.snapshot(),exhausted);
 assert.deepEqual(f.store.events(f.run.id),originalEvents);
 const claims=f.batch.store.events(f.q.batch).filter(e=>e.kind==='SYSTEM_REPAIR_EXTRA_CLAIM');
 assert.deepEqual(claims.map(e=>e.payload.extraAttempt),[1,2]);assert(claims.every(e=>e.payload.limit===2));
 assert.deepEqual(f.batch.store.preflightBudget(f.q.id),{preflightCredit:3,effectiveAttempts:5});
});

for(const evidence of ['SUBMITTING','SUBMIT_CLICKED','SUBMIT_EVIDENCE','RESULT_UNKNOWN','VERIFIED','INVALID_CREDIT'])test('credited exhausted task still rejects '+evidence+' without a claim',async t=>{
 const f=await fixture(t);apply(f.input());f.store.db.prepare("UPDATE rounds SET state='RUNNING' WHERE id=?").run(f.r.id);
 f.store.db.prepare('UPDATE batch_items SET attempts=6 WHERE id=?').run(f.q.id);
 f.store.db.prepare("UPDATE runs SET reason='FORM_BRAND_OPTION_MISSING' WHERE id=?").run(f.run.id);
 if(evidence==='INVALID_CREDIT')f.store.db.prepare("UPDATE events SET payload='{}' WHERE run=? AND kind='PAUSED'").run(f.run.id);
 else f.store.event(f.run.id,evidence,{});
 const before=f.snapshot();assert.throws(()=>f.batch.store.claim(f.q.id,{roundId:f.r.id}),e=>e.code==='ITEM_RETRY_BUDGET_EXTRA_UNSAFE');assert.equal(f.snapshot(),before);
});

test('legacy ProductApi error without a structured code is eligible only with its exact reason',async t=>{
 const f=await fixture(t);f.store.checkpoint(f.run.id,{errorCode:null});assert.equal(plan(f.input()).eligible,true);assert.equal(apply(f.input()).credit,3);
});

const changes={
 'different shop':f=>f.store.db.prepare("UPDATE batches SET shop='another-shop' WHERE id=?").run(f.q.batch),
 'changed task':f=>f.store.db.prepare("UPDATE batch_items SET task=? WHERE id=?").run(JSON.stringify({...f.q.task,other:'changed'}),f.q.id),
 'changed run mapping':f=>f.store.db.prepare("UPDATE round_items SET run_id='other' WHERE round_id=?").run(f.r.id),
 'form checkpoint':f=>f.store.checkpoint(f.run.id,{formUrl:'https://publish.test/form'}),
 'item id checkpoint':f=>f.store.checkpoint(f.run.id,{itemId:'123'}),
 'STEP_INTENT':f=>f.store.event(f.run.id,'STEP_INTENT',{name:'open-new-form'}),
 'STEP_PAUSED':f=>f.store.event(f.run.id,'STEP_PAUSED',{}),
 'STEP_VERIFIED':f=>f.store.event(f.run.id,'STEP_VERIFIED',{}),
 'SUBMITTING':f=>f.store.event(f.run.id,'SUBMITTING',{}),
 'SUBMIT_CLICKED':f=>f.store.event(f.run.id,'SUBMIT_CLICKED',{}),
 'RESULT_UNKNOWN':f=>f.store.event(f.run.id,'RESULT_UNKNOWN',{}),
 'VERIFIED':f=>f.store.event(f.run.id,'VERIFIED',{}),
 'OPEN_PAGE':f=>f.store.event(f.run.id,'OPEN_PAGE',{}),
 'captcha':f=>f.store.db.prepare("UPDATE runs SET reason='CAPTCHA' WHERE id=?").run(f.run.id),
 'other paused reason':f=>f.store.db.prepare("UPDATE events SET payload=? WHERE run=? AND kind='PAUSED' AND seq=(SELECT MAX(seq) FROM events WHERE run=?)").run(JSON.stringify({reason:'Timeout'}),f.run.id,f.run.id),
 'count mismatch':f=>f.store.db.prepare('UPDATE batch_items SET attempts=2 WHERE id=?').run(f.q.id),
 'queue result':f=>f.store.db.prepare("UPDATE batch_items SET result='{}' WHERE id=?").run(f.q.id),
 'run result':f=>f.store.db.prepare("UPDATE runs SET result='{}' WHERE id=?").run(f.run.id),
 'history':f=>f.store.history(f.q.task,{itemId:'123'}),
 'round entered page':f=>f.store.db.prepare('UPDATE round_items SET entered_publish=1 WHERE round_id=?').run(f.r.id),
 'round submission uncertain':f=>f.store.db.prepare('UPDATE round_items SET submission_uncertain=1 WHERE round_id=?').run(f.r.id),
};
for(const [name,change] of Object.entries(changes))test('reject '+name+' without writes or credit',async t=>{
 const f=await fixture(t);change(f);const before=f.snapshot();assert.equal(plan(f.input()).eligible,false);assert.throws(()=>apply(f.input()),e=>e.code==='CONTENT_PREFLIGHT_REPAIR_INELIGIBLE');assert.equal(f.snapshot(),before);
});

test('credit loses effect if its original event prefix or frozen scope is altered',async t=>{
 for(const change of [f=>f.store.db.prepare("UPDATE events SET payload='{}' WHERE run=? AND kind='PAUSED'").run(f.run.id),f=>f.store.db.prepare("UPDATE round_items SET task_hash='changed' WHERE round_id=?").run(f.r.id)]){
  const f=await fixture(t);apply(f.input());change(f);f.store.db.prepare("UPDATE rounds SET state='RUNNING' WHERE id=?").run(f.r.id);
  assert.equal(f.batch.store.preflightBudget(f.q.id).preflightCredit,0);assert.throws(()=>f.batch.store.claim(f.q.id,{roundId:f.r.id}));
 }
});
