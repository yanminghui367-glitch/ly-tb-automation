import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {setup} from './skip-independent-fixture.mjs';
import {RoundItemVerify} from '../round-item-verify.mjs';
import {RoundItemHostGuard} from '../round-item-host.mjs';
import {RoundItemApi} from '../round-item-api.mjs';
import {RoundItemPark,parkFailureEvidence} from '../round-item-park.mjs';
import {ListingRound} from '../listing-round.mjs';
const mismatch='已点击提交、回执未读到；后台创建时间与本次提交时间不匹配，保持待核验，保持 RESULT_UNKNOWN，禁止再次提交';
const absent='已点击提交、回执未读到；后台三次只读查询仍未找到唯一匹配商品，保持 RESULT_UNKNOWN，禁止再次提交';
const ambiguous='已点击提交、回执未读到；后台同标题商品不唯一，不能自动认领，保持 RESULT_UNKNOWN，禁止再次提交';
async function fixture(t,{reason=mismatch,code='RESULT_UNKNOWN',verify=true,limit=3}={}){
 const f=await setup(t,{limit}),o=f.round;await f.pause();
 const x=o.item(f.r.id,f.scope().key),run=f.store.run(x.run_id);
 f.store.move(run.id,'QUEUED');f.store.move(run.id,'RUNNING');f.store.move(run.id,'SUBMITTING');f.store.event(run.id,'SUBMIT_CLICKED',{});f.store.move(run.id,'RESULT_UNKNOWN');
 o.update(f.r.id,x.key,{state:'RESULT_UNKNOWN',submitted:1,submission_uncertain:1,failure_stage:'verify-platform-result'});o.state(f.r.id,'RESULT_UNKNOWN','测试提交结果未知');
 const p={round:o,source:f.flow,batch:f.batch,shop:o.shop,owner:{sessions:new Map([[o.shop.id,{context:{}}]])},capturing:false,reconciling:false,integrity:async()=>({ok:true})};
 const host=new RoundItemHostGuard(p,{isShopRemoved:()=>false}),verifier=new RoundItemVerify(host),parking=o.parking;
 o.verifyExisting=async()=>{throw Object.assign(Error(reason),{code});};
 if(verify)await assert.rejects(verifier.verify({...f.scope(),expectedRevision:verifier.reader.read(f.scope()).revision,requestId:'verification'}));
 const request=(extra={})=>({...f.scope(),expectedRevision:parking.reader.read(f.scope()).revision,requestId:'park-1',confirmedBy:'测试操作者',reason:'原核验无法唯一认领，挂起并继续其余商品',...extra});
 return {...f,p,host,verifier,parking,request,api:new RoundItemApi(f.action,{host,verifier})};
}
const snapshot=f=>{const x=f.round.item(f.r.id,f.scope().key);return {item:x,run:f.store.run(x.run_id),queue:f.batch.store.item(x.queue_id),events:f.store.events(x.run_id),attempts:f.parking.attempts.list(f.r.id,x.key)};};
test('time mismatch / absent / ambiguous are the only accepted typed reasons',()=>{
 for(const message of [mismatch,absent,ambiguous])assert(parkFailureEvidence({code:'RESULT_UNKNOWN',message}));
 for(const message of ['generic unknown','验证码',mismatch+' extra',mismatch.replace('不匹配','精度不足')])assert.equal(parkFailureEvidence({code:'RESULT_UNKNOWN',message}),null);
 assert.equal(parkFailureEvidence({code:'PAUSED_CAPTCHA',message:mismatch}),null);
});
test('park audit is atomic and preserves every original item, run, queue, submit and attempt byte',async t=>{
 const f=await fixture(t);f.round.stop();const before=snapshot(f),req=f.request(),receipt=f.parking.park(req);
 assert.deepEqual(snapshot(f),before);assert.equal(receipt.state,'RESULT_UNKNOWN');assert.equal(receipt.submitted,true);assert.equal(receipt.retryBlocked,true);
 assert.equal(receipt.parking.actor.name,'测试操作者');assert.equal(receipt.parking.evidence.category,'TIME_MISMATCH');assert.equal(receipt.parking.evidence.kind,'VERIFY_ONLY');
 assert.equal(f.round.round(f.r.id).stopped,0);assert.equal(f.round.round(f.r.id).state,'PAUSED');
 const audit=f.round.events(f.r.id).filter(e=>e.kind==='ITEM_PARKED');assert.equal(audit.length,1);assert.equal(audit[0].payload.previousStopRequested,true);
 const replay=f.parking.park(req);assert.equal(replay.replayed,true);assert.equal(replay.eventSeq,receipt.eventSeq);assert.deepEqual(replay.continueRequest,receipt.continueRequest);assert.deepEqual(snapshot(f),before);
 assert.throws(()=>f.parking.park({...req,reason:'changed'}),e=>e.code==='ITEM_PARK_REQUEST_CONFLICT');
 assert.throws(()=>f.action.skip({...req,expectedRevision:f.action.read(req).revision}),e=>e.code==='ITEM_SKIP_SUBMISSION_PROTECTED');
});
test('original pump processes others once; unknown remains, denominator and success counts stay honest',async t=>{
 const f=await fixture(t),before=snapshot(f),receipt=f.parking.park(f.request());f.round.verifyExisting=async()=>null;
 f.round.start(f.r.id,receipt.continueRequest);await f.round.pending;
 assert.deepEqual(snapshot(f),before);assert.equal(f.flow.submits,2);assert.equal(f.flow.launches.filter(id=>id===before.run.id).length,1);
 const view=f.round.view(f.r.id);assert.equal(view.state,'NEEDS_REVIEW');assert.equal(view.total,3);assert.equal(view.processed,2);assert.equal(view.counts.NEW_SUCCESS,2);assert.equal(view.counts.RESULT_UNKNOWN,1);assert.equal(view.parkedCount,1);
 assert.equal(view.window.total,3);assert.equal(view.window.ended,2);assert.equal(view.window.state,'COMPLETED');assert.equal(view.window.parkedCount,1);assert.equal(view.window.counts.RESULT_UNKNOWN,1);
 const report=await f.round.report(f.r.id),json=JSON.parse(await readFile(join(report.directory,'report.json'),'utf8')),csv=await readFile(join(report.directory,'parked-items.csv'),'utf8');
 assert.equal(json.parkedItems.length,1);assert.equal(json.parkedItems[0].notice,'提交结果未定，需人工后台确认');assert.match(csv,/提交结果未定，需人工后台确认/);assert.match(csv,/测试操作者/);
 assert.match(f.round.windows.csv(f.w.id),/是否挂起/);
 await assert.rejects(f.round.executeItem(f.r.id,before.item),e=>e.code==='ITEM_PARK_EXECUTION_PROTECTED');assert.equal(f.flow.submits,2);
});
test('park survives coordinator restart, auto continuation never selects the parked task',async t=>{
 const f=await fixture(t,{limit:2}),receipt=f.parking.park(f.request()),before=snapshot(f);
 f.store.db.prepare('UPDATE round_windows SET auto_continue=1 WHERE id=?').run(f.w.id);
 // Changing window config also changes its signed assignment hash; use the original hash formula.
 const old=f.round.windows.get(f.w.id),rows=f.round.windows.entries(f.w.id).map(e=>f.round.item(f.r.id,e.key));
 f.store.db.prepare('UPDATE round_windows SET selection_hash=? WHERE id=?').run(f.round.windows.assignmentHash(f.round.round(f.r.id),{startPosition:old.scope_start,endPosition:old.scope_end,limit:old.limit_count,autoContinue:true},rows),f.w.id);
 const o=new ListingRound({batch:f.batch,source:f.flow,shop:f.round.shop,assertExecution:async()=>{},verifyExisting:async()=>null,checkFiles:async()=>{},contentReviews:{assertApproved:()=>({decision:'PASS'})},artifacts:f.round.artifacts});
 assert(o.parking.has(f.r.id,f.scope().key));assert.deepEqual(o.item(f.r.id,f.scope().key),before.item);
 o.start(f.r.id,receipt.continueRequest);await o.pending;
 const v=o.view(f.r.id);assert.equal(v.counts.NEW_SUCCESS,2);assert.equal(v.counts.RESULT_UNKNOWN,1);assert.equal(v.state,'NEEDS_REVIEW');assert.equal(v.windowHistory.length,2);assert.equal(v.windowHistory.reduce((n,w)=>n+w.total,0),3);assert.equal(f.flow.submits,2);
 assert.deepEqual(o.item(f.r.id,f.scope().key),before.item);
});
for(const [name,opts] of [['no verification',{verify:false}],['generic error',{reason:'unknown'}],['CAPTCHA',{code:'PAUSED_CAPTCHA',reason:'验证码'}],['login error',{code:'LOGIN_REQUIRED',reason:'请人工登录'}]])test(name+' cannot park or alter state',async t=>{
 const f=await fixture(t,opts),before=snapshot(f);assert.throws(()=>f.parking.park(f.request()));assert.deepEqual(snapshot(f),before);assert.equal(f.parking.list(f.r.id).length,0);
});
test('stale, active, foreign scope, missing actor and unsigned submitted claims all fail closed',async t=>{
 for(const mode of ['stale','active','scope','actor','state','result','open-attempt']){
  const f=await fixture(t),req=f.request();
  if(mode==='stale')f.round.event(f.r.id,null,'CHANGE',{});
  if(mode==='active')f.round.active=f.r.id;
  if(mode==='scope')req.key=f.scope(2).key;
  if(mode==='actor')req.confirmedBy=' ';
  if(mode==='state')f.round.update(f.r.id,req.key,{state:'PENDING'});
  if(mode==='result'){const x=f.round.item(f.r.id,req.key);f.store.checkpoint(x.run_id,{itemId:'999999'});}
  if(mode==='open-attempt')f.round.hasUnsettledExecution=()=>true;
  const before=snapshot(f);assert.throws(()=>f.parking.park(req),mode);assert.deepEqual(snapshot(f),before);f.round.active=null;
 }
});
test('failed audit transaction rolls everything back including stop intent',async t=>{
 const f=await fixture(t);f.round.stop();const before=snapshot(f),r=f.round.round(f.r.id),events=f.round.events(f.r.id),old=f.round.event.bind(f.round);
 f.round.event=(...args)=>{if(args[2]==='PARK_CONTINUE_REQUESTED')throw Error('disk full');return old(...args);};
 assert.throws(()=>f.parking.park(f.request()),/disk full/);assert.deepEqual(snapshot(f),before);assert.deepEqual(f.round.round(f.r.id),r);assert.deepEqual(f.round.events(f.r.id),events);assert.equal(f.parking.list(f.r.id).length,0);
});
test('detail and API expose separate park route; host guard and exact intent replay apply',async t=>{
 const f=await fixture(t),d=await f.api.detail(f.scope());assert.equal(d.retryBlocked,true);assert.equal(d.capabilities.park.allowed,true);assert.equal(d.capabilities.skip.allowed,false);assert(d.manifestHash);
 const req=f.request(),call=async(method,body,url='/api/v1/rounds/item-park')=>{let response;await f.api.handle({method},{setHeader:()=>{}},new URL(url,'http://localhost'),{body:async()=>body,json:(r,status,payload)=>response={status,payload}});return response;};
 assert.equal((await call('GET',req)).status,405);assert.equal((await call('POST',{...req,retryBlocked:true})).status,400);
 const ok=await call('POST',req);assert.equal(ok.status,200);assert.equal((await call('POST',req)).payload.replayed,true);assert.equal((await call('POST',{...req,reason:'other'})).status,409);
 const after=await f.api.detail(f.scope());assert(after.parking);assert.equal(after.capabilities.park.allowed,false);assert.equal(after.capabilities.skip.allowed,false);
 const g=await fixture(t);g.host.assert=async()=>{throw Object.assign(Error('removed'),{code:'ITEM_HOST_SHOP_REMOVED'});};let status;await g.api.handle({method:'POST'},{},new URL('/api/v1/rounds/item-park','http://localhost'),{body:async()=>g.request(),json:(r,s)=>status=s});assert.equal(status,409);assert.equal(g.parking.list(g.r.id).length,0);
});
