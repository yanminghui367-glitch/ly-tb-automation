import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {setup,shop} from './skip-independent-fixture.mjs';
import {RoundItemRetry} from '../round-item-retry.mjs';
import {RoundItemApi} from '../round-item-api.mjs';
import {RoundItemHostGuard} from '../round-item-host.mjs';
import {RoundItemRetryApi,retryIssue} from '../round-item-retry-api.mjs';

async function fixture(t,{attempts=3,baseline=0,extra=0,state='FAILED',reason='ATTRIBUTE_SELECTION_MISMATCH',paused=true}={}){
 const f=await setup(t);if(paused)await f.pause();
 const product={round:f.round,source:f.flow,batch:f.batch,shop,capturing:false,reconciling:false,integrity:async()=>({ok:true}),roundVerifier:{reset(){}}};
 const host=new RoundItemHostGuard(product,{isShopRemoved:()=>false}),retry=new RoundItemRetry(host);
 const key=f.scope().key,x=f.round.item(f.r.id,key);
 if(paused){
  f.store.db.prepare('UPDATE batch_items SET attempts=?,state=? WHERE id=?').run(attempts,state,x.queue_id);
  f.store.db.prepare('UPDATE runs SET state=?,reason=? WHERE id=?').run('PAUSED',reason,x.run_id);
  f.store.db.prepare('UPDATE round_items SET baseline_attempts=?,extra_attempts=?,state=?,reason=?,failure_stage=? WHERE round_id=? AND key=?').run(baseline,extra,'PENDING',reason,'attribute-style',f.r.id,key);
 }else f.round.update(f.r.id,key,{reason:'上次查询失败，尚未提交'});
 const request=(id='budget-fixture')=>({...f.scope(),expectedRevision:retry.reader.read(f.scope()).revision,requestId:id});
 const budget=()=>{const s=retry.reader.read(f.scope());return f.batch.store.assertClaimBudget(s.q,{round:s.r,entry:s.x});};
 const snapshot=()=>{
  const tables=f.store.db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
  return JSON.stringify({changes:f.store.db.prepare('SELECT total_changes() n').get().n,tables:Object.fromEntries(tables.map(({name})=>[name,f.store.db.prepare('SELECT * FROM "'+name.replaceAll('"','""')+'" ORDER BY rowid').all()]))});
 };
 return {...f,x,product,host,retry,request,budget,snapshot};
}
async function http(t,f){
 const api=new RoundItemApi(f.retry.reader,{host:f.host,retry:f.retry});
 const server=createServer(async(req,res)=>{await api.handle(req,res,new URL(req.url,'http://localhost'),{body:async()=>{let raw='';for await(const b of req)raw+=b;return JSON.parse(raw);},json:(res,status,data)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(data));}});});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));assert.notEqual(server.address().port,4318);
 t.after(()=>new Promise(r=>server.close(r)));const base='http://127.0.0.1:'+server.address().port;
 return {get:async()=>{const r=await fetch(base+'/api/v1/rounds/item?'+new URLSearchParams(f.scope()));return {status:r.status,data:await r.json()};},post:async req=>{const r=await fetch(base+'/api/v1/rounds/item-retry',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(req)});return {status:r.status,data:await r.json()};}};
}

test('baseline zero at three attempts: GET is read-only; explicit POST adds one manual allowance and executes original task',async t=>{
 const f=await fixture(t),api=await http(t,f),req=f.request(),before=f.snapshot(),launches=f.flow.launches.length;
 const get=await api.get();assert.equal(get.status,200);assert.equal(get.data.capabilities.retry.allowed,true);assert.equal(get.data.capabilities.retry.manualBudget.willAdd,true);assert.equal(get.data.capabilities.retry.manualBudget.remaining,3);assert.equal(f.snapshot(),before);
 const post=await api.post(req);assert.equal(post.status,200);assert.equal(post.data.outcome.state,'NEW_SUCCESS');
 assert.equal(f.batch.store.item(f.x.queue_id).attempts,4);assert.equal(f.batch.store.item(f.x.queue_id).max_attempts,4);assert.equal(f.round.selections.manualBudgetUsed(f.x.queue_id),1);assert.equal(f.flow.launches.length,launches+1);assert.equal(f.flow.submits,1);
});
test('same frozen baseline-zero task below limit may use its last original attempt only',async t=>{
 const f=await fixture(t,{attempts:2}),api=await http(t,f),oldEvents=f.store.events(f.x.run_id),others=JSON.stringify(f.round.items(f.r.id).slice(1));
 assert.equal((await api.get()).data.capabilities.retry.allowed,true);
 const result=await api.post(f.request());assert.equal(result.status,200);assert.equal(result.data.outcome.state,'NEW_SUCCESS');
 assert.equal(f.batch.store.item(f.x.queue_id).attempts,3);assert.equal(f.batch.store.item(f.x.queue_id).max_attempts,3);assert.equal(f.round.item(f.r.id,f.x.key).baseline_attempts,0);assert.equal(f.round.item(f.r.id,f.x.key).extra_attempts,0);
 assert.equal(f.flow.submits,1);assert.equal(JSON.stringify(f.round.items(f.r.id).slice(1)),others);assert.deepEqual(f.store.events(f.x.run_id).slice(0,oldEvents.length),oldEvents);
});
test('new attempted query failure with no queue retains previous eligible behavior',async t=>{
 const f=await fixture(t,{paused:false}),before=f.snapshot();assert.equal(f.retry.inspect(f.scope()).allowed,true);assert.equal(f.snapshot(),before);
});
test('read-only extra budget matrix keeps original min(max+2,baseline+3), baseline and extra limits',async t=>{
 const cases=[
  {attempts:3,baseline:0,extra:0,ok:false},{attempts:3,baseline:-1,extra:0,ok:false},{attempts:3,baseline:1.5,extra:0,ok:false},
  {attempts:3,baseline:1,extra:0,ok:true},{attempts:4,baseline:1,extra:1,ok:false},
  {attempts:3,baseline:3,extra:0,ok:true},{attempts:4,baseline:3,extra:1,ok:true},{attempts:5,baseline:3,extra:1,ok:false},
  {attempts:3,baseline:3,extra:2,ok:false}
 ];
 for(const c of cases){const f=await fixture(t,c),before=f.snapshot();if(c.ok)assert.equal(f.budget().extra,true);else assert.throws(f.budget,e=>e.code==='ITEM_RETRY_BUDGET_EXTRA_UNSAFE');assert.equal(f.snapshot(),before);}
});
test('actual extra claims still consume exactly two extra events and never exceed old cap',async t=>{
 const f=await fixture(t,{baseline:3});f.store.db.prepare('UPDATE rounds SET state=? WHERE id=?').run('RUNNING',f.r.id);
 const oldEvents=f.batch.store.events(f.x.batch_id).length;
 for(const expected of [4,5]){
  f.store.db.prepare('UPDATE batch_items SET state=? WHERE id=?').run('RETRY',f.x.queue_id);
  f.batch.store.claim(f.x.queue_id,{roundId:f.r.id});assert.equal(f.batch.store.item(f.x.queue_id).attempts,expected);assert.equal(f.round.item(f.r.id,f.x.key).extra_attempts,expected-3);
  f.batch.store.move(f.x.queue_id,'FAILED','ATTRIBUTE_SELECTION_MISMATCH');
 }
 f.batch.store.move(f.x.queue_id,'RETRY');const before=f.snapshot();assert.throws(()=>f.batch.store.claim(f.x.queue_id,{roundId:f.r.id}),e=>e.code==='ITEM_RETRY_BUDGET_EXTRA_UNSAFE');assert.equal(f.snapshot(),before);
 const extras=f.batch.store.events(f.x.batch_id).slice(oldEvents).filter(e=>e.kind==='SYSTEM_REPAIR_EXTRA_CLAIM');assert.equal(extras.length,2);assert.deepEqual(extras.map(e=>e.payload.extraAttempt),[1,2]);assert(extras.every(e=>e.payload.limit===2));assert.equal(f.flow.submits,0);
});
test('claim keeps required RUNNING roundPermit and cannot use a preview as execution authorization',async t=>{
 const f=await fixture(t,{attempts:2,state:'RETRY'}),before=f.snapshot();assert.equal(f.budget().extra,false);
 assert.throws(()=>f.batch.store.claim(f.x.queue_id,{roundId:f.r.id}),/轮次不在执行状态/);assert.equal(f.snapshot(),before);
});
test('ordinary queue without round permit keeps hard three-attempt cap',async t=>{
 const f=await fixture(t,{state:'RETRY'}),before=f.snapshot();assert.throws(()=>f.batch.store.claim(f.x.queue_id),e=>e.code==='ITEM_RETRY_BUDGET_EXHAUSTED'&&/已达重试上限/.test(e.message));assert.equal(f.snapshot(),before);
});
test('WAITING_HUMAN resumes retain zero additional attempt consumption at old limit',async t=>{
 const f=await fixture(t,{state:'WAITING_HUMAN'}),before=f.snapshot();assert.equal(f.budget().extra,false);assert.equal(f.retry.inspect(f.scope()).allowed,true);assert.equal(f.snapshot(),before);
 f.store.db.prepare('UPDATE rounds SET state=? WHERE id=?').run('RUNNING',f.r.id);
 const n=f.batch.store.events(f.x.batch_id).filter(e=>e.kind==='SYSTEM_REPAIR_EXTRA_CLAIM').length;f.batch.store.claim(f.x.queue_id,{roundId:f.r.id});
 assert.equal(f.batch.store.item(f.x.queue_id).attempts,3);assert.equal(f.round.item(f.r.id,f.x.key).extra_attempts,0);assert.equal(f.batch.store.events(f.x.batch_id).filter(e=>e.kind==='SYSTEM_REPAIR_EXTRA_CLAIM').length,n);
});
test('missing original run or non-paused run remains ineligible for extra claim',async t=>{
 for(const state of ['QUEUED','RUNNING']){const f=await fixture(t,{baseline:3});f.store.db.prepare('UPDATE runs SET state=? WHERE id=?').run(state,f.x.run_id);const before=f.snapshot();assert.throws(f.budget,e=>e.code==='ITEM_RETRY_BUDGET_EXTRA_UNSAFE');assert.equal(f.snapshot(),before);}
 const f=await fixture(t,{baseline:3});const q=f.batch.store.item(f.x.queue_id);const before=f.snapshot();assert.throws(()=>f.batch.store.assertClaimBudget({...q,run_id:null},{round:f.round.round(f.r.id),entry:f.round.item(f.r.id,f.x.key)}),e=>e.code==='ITEM_RETRY_BUDGET_EXTRA_UNSAFE');assert.equal(f.snapshot(),before);
});
test('submission events forbid extra claims; UI submission protection keeps precedence',async t=>{
 for(const kind of ['SUBMITTING','RESULT_UNKNOWN','VERIFIED']){const f=await fixture(t,{baseline:3});f.store.event(f.x.run_id,kind,{});const before=f.snapshot();assert.throws(f.budget,e=>e.code==='ITEM_RETRY_BUDGET_EXTRA_UNSAFE');assert.equal(f.retry.inspect(f.scope()).code,'ITEM_RETRY_SUBMISSION_PROTECTED');assert.equal(f.snapshot(),before);}
});
test('CAPTCHA, login and identity reasons still prohibit extra budget',async t=>{
 for(const reason of ['CAPTCHA Timeout','验证码 Timeout','登录失效 Timeout','店铺身份 Timeout']){const f=await fixture(t,{baseline:3,reason});const before=f.snapshot();assert.throws(f.budget,e=>e.code==='ITEM_RETRY_BUDGET_EXTRA_UNSAFE');assert.equal(f.retry.inspect(f.scope()).code,'ITEM_RETRY_RUN_PROTECTED');assert.equal(f.snapshot(),before);}
});
test('legacy automatic extra budget still requires system signatures; manual explicit addition is separate and GET is read-only',async t=>{
 const f=await fixture(t,{baseline:3,reason:'ordinary unknown failure'}),before=f.snapshot();assert.throws(f.budget,e=>e.code==='ITEM_RETRY_BUDGET_SYSTEM_UNCONFIRMED');
 const cap=new RoundItemRetryApi(f.retry).capability(f.retry.reader.read(f.scope()),null);assert.equal(cap.allowed,true);assert.equal(cap.manualBudget.willAdd,true);assert.match(cap.reason,/追加1次/);assert.equal(f.snapshot(),before);
 for(const reason of ['expect(locator) failed','MATERIAL_X','ATTRIBUTE_X','FORM_X','Timeout','页面失败','控件失败']){f.store.db.prepare('UPDATE runs SET reason=? WHERE id=?').run(reason,f.x.run_id);assert.equal(f.budget().extra,true);}
});
for(const boundary of ['assertExecution','checkFiles','host.assert'])test('concurrent budget exhaustion during '+boundary+' rejects before any action or additional write',async t=>{
 const f=await fixture(t,{attempts:2}),req=f.request();let afterOtherWriter,mutated=false;
 const mutate=()=>{if(mutated)return;mutated=true;f.store.db.prepare('UPDATE batch_items SET attempts=3 WHERE id=?').run(f.x.queue_id);afterOtherWriter=f.snapshot();};
 if(boundary==='host.assert'){const original=f.host.assert.bind(f.host);let n=0;f.host.assert=async()=>{await original();if(++n===2)mutate();};}else f.round[boundary]=async()=>mutate();
 const launchCount=f.flow.launches.length;await assert.rejects(f.retry.retry(req),e=>e.code==='ITEM_RETRY_STALE_REVISION');assert(mutated);assert.equal(f.snapshot(),afterOtherWriter);assert.equal(f.retry.lookup(req),null);assert.equal(f.flow.launches.length,launchCount);assert.equal(f.flow.submits,0);
});
test('baseline and extra mutation after preview also reject without spending a new attempt',async t=>{
 for(const change of ['baseline_attempts=0','extra_attempts=2']){const f=await fixture(t,{baseline:3}),req=f.request();let afterOtherWriter;f.round.checkFiles=async()=>{f.store.db.prepare('UPDATE round_items SET '+change+' WHERE round_id=? AND key=?').run(f.r.id,f.x.key);afterOtherWriter=f.snapshot();};await assert.rejects(f.retry.retry(req),e=>e.code==='ITEM_RETRY_STALE_REVISION');assert.equal(f.snapshot(),afterOtherWriter);assert.equal(f.retry.lookup(req),null);}
});
test('sealed response replay remains readable even when original queue is now at budget limit',async t=>{
 const f=await fixture(t,{attempts:2}),req=f.request(),receipt=await f.retry.retry(req),before=f.snapshot();const replay=await f.retry.retry(req);assert.equal(replay.attemptId,receipt.attemptId);assert.equal(replay.replayed,true);assert.equal(f.snapshot(),before);assert.equal(f.flow.submits,1);
});
test('new budget API messages are explicit and never promise an automatic reset',()=>{
 for(const code of ['ITEM_RETRY_BUDGET_EXHAUSTED','ITEM_RETRY_BUDGET_EXTRA_UNSAFE','ITEM_RETRY_BUDGET_SYSTEM_UNCONFIRMED']){const issue=retryIssue({code});assert.equal(issue.code,code);assert.match(issue.error,/不能继续重试/);}
});
