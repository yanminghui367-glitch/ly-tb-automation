import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {setup} from './skip-independent-fixture.mjs';
import {RoundItemHostGuard} from '../round-item-host.mjs';
import {RoundItemVerify} from '../round-item-verify.mjs';
import {RoundVerification} from '../round-verification.mjs';

async function fixture(t,{submitted=false}={}){
 const f=await setup(t),o=f.round;
 if(submitted){
  await f.pause();const x=o.item(f.r.id,f.scope().key),run=f.store.run(x.run_id);
  f.store.move(run.id,'QUEUED');f.store.move(run.id,'RUNNING');f.store.move(run.id,'SUBMITTING');f.store.event(run.id,'SUBMIT_CLICKED',{});f.store.checkpoint(run.id,{itemId:'700001',step:'submit-once'});f.store.move(run.id,'RESULT_UNKNOWN');
  o.update(f.r.id,x.key,{state:'RESULT_UNKNOWN',submitted:1,submission_uncertain:1,failure_stage:'verify-platform-result'});o.state(f.r.id,'RESULT_UNKNOWN','synthetic unknown submit');
 }else{o.update(f.r.id,f.scope().key,{state:'RESULT_UNKNOWN',failure_stage:'existing-listing-check'});o.state(f.r.id,'PAUSED','synthetic candidate');}
 const p={round:o,source:f.flow,batch:f.batch,shop:o.shop,owner:{sessions:new Map([[o.shop.id,{context:{}}]])},capturing:false,reconciling:false,integrity:async()=>({ok:true})};
 let removed=false;const host=new RoundItemHostGuard(p,{isShopRemoved:()=>removed}),action=new RoundItemVerify(host);
 const screenshot=join(o.artifacts,'verify.png');await writeFile(screenshot,Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1sAAAAASUVORK5CYII=','base64'));
 const result={itemId:'700001',url:'https://item.taobao.com/item.htm?id=700001',status:'出售中',rowText:'synthetic seller row',screenshot,verifiedAt:new Date().toISOString(),observed:{price:20,inventory:999999},differences:[]};
 let calls=0;o.verifyExisting=async()=>{calls++;return result;};
 const request=(extra={})=>({...f.scope(),expectedRevision:action.reader.read(f.scope()).revision,requestId:'verify-1',...extra});
 return {...f,p,host,action,result,request,calls:()=>calls,remove:()=>removed=true};
}

test('V1 identical request waiting in Host check replays a receipt committed by its twin',async t=>{
 const f=await fixture(t),req=f.request();let calls=0,releaseSecond,enteredSecond;
 const secondGate=new Promise(r=>enteredSecond=r);f.p.integrity=async()=>{calls++;if(calls===2){enteredSecond();await new Promise(r=>releaseSecond=r);}return {ok:true};};
 const first=f.action.verify(req),second=f.action.verify(req);await secondGate;const receipt=await first;releaseSecond();
 const replay=await second;assert.equal(replay.replayed,true);assert.equal(replay.attemptId,receipt.attemptId);assert.deepEqual(replay.outcome,receipt.outcome);assert.equal(f.calls(),1);
});

test('V2 prior stop pending unknown result ends window when verification resolves the original run',async t=>{
 const f=await fixture(t,{submitted:true});f.round.stop();assert.equal(f.round.round(f.r.id).stopped,1);assert.equal(f.round.windows.get(f.w.id).state,'RESULT_UNKNOWN');
 const other=f.round.item(f.r.id,f.scope(2).key);const receipt=await f.action.verify(f.request());assert.equal(receipt.outcome.state,'NEW_SUCCESS');
 assert.equal(f.round.round(f.r.id).state,'STOPPED');assert.equal(f.round.windows.get(f.w.id).state,'STOPPED');assert.deepEqual(f.round.item(f.r.id,f.scope(2).key),other);assert.equal(f.flow.submits,0);
});

test('V3 unrecordable failure retains a closed execution boundary instead of advertising idle RUNNING',async t=>{
 const f=await fixture(t,{submitted:true});f.action.attempts.seal=()=>{throw Object.assign(Error('persistent storage failure'),{code:'SQLITE_FULL'});};
 await assert.rejects(f.action.verify(f.request()),/persistent storage failure/);
 const x=f.round.item(f.r.id,f.scope().key);assert.equal(x.state,'RESULT_UNKNOWN');assert.equal(f.store.run(x.run_id).state,'RESULT_UNKNOWN');assert.equal(f.store.completed(f.tasks[0]),null);assert.equal(f.action.attempts.openFor(x.key).kind,'VERIFY_ONLY');
 assert.throws(()=>f.round.assertIdle(),/./,'Failure to persist final outcome must not permit another owner before recovery');
});

test('identity change after remote result rejects success without touching another item',async t=>{
 const f=await fixture(t),other=f.round.item(f.r.id,f.scope(2).key);f.round.verifyExisting=async()=>{f.p.source={...f.flow};return f.result;};
 await assert.rejects(f.action.verify(f.request()),e=>e.code==='ITEM_VERIFY_HOST_CHANGED');assert.equal(f.store.completed(f.tasks[0]),null);assert.equal(f.round.item(f.r.id,f.scope().key).state,'RESULT_UNKNOWN');assert.deepEqual(f.round.item(f.r.id,f.scope(2).key),other);
});

test('content hold added during remote result cannot become success',async t=>{
 const f=await fixture(t);f.round.verifyExisting=async()=>{f.round.holdContent(f.r.id,f.round.item(f.r.id,f.scope().key),'isolated new content hold');return f.result;};
 await assert.rejects(f.action.verify(f.request()));assert.equal(f.store.completed(f.tasks[0]),null);assert.equal(f.round.item(f.r.id,f.scope().key).failure_stage,'content-review');assert.equal(f.flow.submits,0);
});

test('replay changed intent conflicts and never invokes verifier twice',async t=>{
 const f=await fixture(t),req=f.request();const receipt=await f.action.verify(req);await assert.rejects(f.action.verify({...req,expectedRevision:'different'}),e=>e.code==='ITEM_VERIFY_REQUEST_CONFLICT');
 assert.equal(f.action.attempts.list(f.r.id,req.key).length,1);assert.equal(f.calls(),1);assert.deepEqual((await f.action.verify(req)).outcome,receipt.outcome);
});

test('V1b concurrent recovery of the same unfinished request returns the same sealed interruption',async t=>{
 const f=await fixture(t),req=f.request(),s=f.action.reader.read(req);
 f.store.transaction(()=>f.action.attempts.begin({scope:{roundId:req.roundId,windowId:req.windowId,key:req.key,shopId:s.r.shop,taskHash:s.x.task_hash,repairVersion:s.r.repair_version},kind:'VERIFY_ONLY',requestId:'verify-only:'+req.requestId,before:{requestIntent:createHash('sha256').update(JSON.stringify(req)).digest('hex'),request:req,snapshot:s.snapshot}}));
 let calls=0,releaseSecond,enteredSecond;const gate=new Promise(r=>enteredSecond=r);f.p.integrity=async()=>{if(++calls===2){enteredSecond();await new Promise(r=>releaseSecond=r);}return {ok:true};};
 const first=f.action.verify(req),second=f.action.verify(req);await gate;const receipt=await first;releaseSecond();const replay=await second;
 assert.equal(receipt.outcome.disposition,'INTERRUPTED');assert.deepEqual(replay,receipt);assert.equal(f.calls(),0);assert.equal(f.action.attempts.list(req.roundId,req.key).length,1);
});

test('V3 recovery remains closed to ordinary controls and respects stop before a later fresh verification',async t=>{
 const f=await fixture(t,{submitted:true}),req=f.request(),original=f.action.attempts.seal.bind(f.action.attempts),other=f.round.item(f.r.id,f.scope(2).key);
 f.action.attempts.seal=()=>{throw Object.assign(Error('persistent storage failure'),{code:'SQLITE_FULL'});};await assert.rejects(f.action.verify(req));
 assert.throws(()=>f.round.start(f.r.id,{windowId:f.w.id}));assert.throws(()=>f.round.resume(f.r.id,{windowId:f.w.id}));await assert.rejects(f.action.verify({...req,requestId:'other'}),e=>e.code==='ITEM_VERIFY_PERSISTENCE_BLOCKED');
 f.round.pause();f.round.stop();assert.throws(()=>f.round.assertIdle());
 f.action.attempts.seal=original;const recovered=await f.action.verify(req);assert.equal(recovered.outcome.code,'ITEM_VERIFY_PERSISTENCE_RECOVERED');assert.equal(f.calls(),1);assert.equal(f.round.active,null);assert.equal(f.round.round(f.r.id).stopped,1);
 const resolved=await f.action.verify(f.request({requestId:'fresh-after-recovery'}));assert.equal(resolved.outcome.state,'NEW_SUCCESS');assert.equal(f.calls(),2);assert.equal(f.round.round(f.r.id).state,'STOPPED');assert.equal(f.round.windows.get(f.w.id).state,'STOPPED');assert.deepEqual(f.round.item(f.r.id,f.scope(2).key),other);
});

test('V4 failure to seal stopped window after successful attempt commit retains recovery boundary',async t=>{
 const f=await fixture(t,{submitted:true});f.round.stop();const req=f.request(),close=f.round.windows.close.bind(f.round.windows);
 f.round.windows.close=()=>{throw Object.assign(Error('window persistence failed'),{code:'SQLITE_FULL'});};await assert.rejects(f.action.verify(req),/window persistence failed/);
 const a=f.action.attempts.list(req.roundId,req.key).at(-1);assert.equal(a.outcome.disposition,'VERIFIED');assert.equal(f.store.run(f.round.item(req.roundId,req.key).run_id).state,'VERIFIED');
 assert.throws(()=>f.round.assertIdle(),/./,'Committed task success must not lose the unfinished stop/window finalization');
 f.round.windows.close=close;const receipt=await f.action.verify(req);assert.equal(receipt.attemptId,a.id);assert.deepEqual(receipt.outcome,a.outcome);assert.equal(f.calls(),1);assert.equal(f.round.windows.get(req.windowId).state,'STOPPED');assert.equal(f.round.round(req.roundId).state,'STOPPED');assert.equal(f.round.active,null);
});

test('V4 restart replay repairs durable unfinished stop using sealed success without another remote read',async t=>{
 const f=await fixture(t,{submitted:true});f.round.stop();const req=f.request(),close=f.round.windows.close.bind(f.round.windows);
 f.round.windows.close=()=>{throw Object.assign(Error('window persistence failed'),{code:'SQLITE_FULL'});};await assert.rejects(f.action.verify(req),/window persistence failed/);
 const sealedHistory=f.action.attempts.list(req.roundId,req.key),a=sealedHistory.at(-1);f.round.windows.close=close;
 assert.deepEqual(sealedHistory.map(row=>row.kind),['INITIAL','VERIFY_ONLY']);assert.equal(a.parent_attempt_id,sealedHistory[0].id);
 // Model only loss of process-local lease/latch; persisted SQLite and history remain intact.
 f.round.active=null;f.batch.active=null;f.flow.queueLease=null;f.round.currentOperation=null;
 const restarted=new RoundItemVerify(new RoundItemHostGuard(f.p,{isShopRemoved:()=>false}));const receipt=await restarted.verify(req);
 assert.equal(receipt.attemptId,a.id);assert.deepEqual(receipt.outcome,a.outcome);assert.equal(f.calls(),1);assert.equal(f.round.windows.get(req.windowId).state,'STOPPED');assert.equal(f.round.round(req.roundId).state,'STOPPED');assert.equal(f.round.active,null);assert.deepEqual(f.action.attempts.list(req.roundId,req.key),sealedHistory);
});

test('V4 stopped unresolved verification also holds lease when catch-path window seal fails',async t=>{
 const f=await fixture(t),req=f.request(),close=f.round.windows.close.bind(f.round.windows);let release,started,reads=0;
 const ready=new Promise(r=>started=r);f.round.verifyExisting=async()=>{reads++;started();return new Promise(r=>release=()=>r(f.result));};
 const pending=f.action.verify(req);await ready;f.round.stop();f.round.windows.close=()=>{throw Object.assign(Error('window persistence failed'),{code:'SQLITE_FULL'});};release();
 await assert.rejects(pending,/window persistence failed/);const a=f.action.attempts.list(req.roundId,req.key).at(-1);assert.equal(a.outcome.disposition,'UNRESOLVED');assert.equal(f.store.completed(f.tasks[0]),null);assert.throws(()=>f.round.assertIdle());
 f.round.windows.close=close;const replay=await f.action.verify(req);assert.equal(replay.attemptId,a.id);assert.deepEqual(replay.outcome,a.outcome);assert.equal(reads,1);assert.equal(f.round.windows.get(req.windowId).state,'STOPPED');assert.equal(f.round.round(req.roundId).state,'STOPPED');assert.equal(f.round.active,null);assert.equal(f.flow.submits,0);
});
