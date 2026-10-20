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

test('candidate verification stores one attempt and pauses without creating any run',async t=>{
 const f=await fixture(t),other=f.round.item(f.r.id,f.scope(2).key),req=f.request();
 const receipt=await f.action.verify(req);assert.equal(receipt.outcome.state,'EXISTING_VERIFIED');assert.equal(f.calls(),1);assert.equal(f.flow.submits,0);assert.equal(f.flow.launches.length,0);
 assert.deepEqual(f.round.item(f.r.id,f.scope(2).key),other);assert.equal(f.round.view(f.r.id).state,'PAUSED');assert.equal(f.round.active,null);assert.equal(f.batch.active,null);assert.equal(f.flow.queueLease,null);
 assert.equal(f.store.completed(f.tasks[0]).itemId,'700001');const a=f.action.attempts.get(receipt.attemptId);assert.equal(a.kind,'VERIFY_ONLY');assert(a.finished_at);assert.equal(a.before.snapshot.item.state,'RESULT_UNKNOWN');
 const replay=await f.action.verify(req);assert.equal(replay.replayed,true);assert.equal(replay.attemptId,a.id);assert.equal(f.calls(),1);
});

test('submitted unknown is verified atomically in original run queue round and attempt without extra submit',async t=>{
 const f=await fixture(t,{submitted:true}),x=f.round.item(f.r.id,f.scope().key),launches=f.flow.launches.length;
 const receipt=await f.action.verify(f.request());assert.equal(receipt.outcome.state,'NEW_SUCCESS');assert.equal(f.store.run(x.run_id).state,'VERIFIED');assert.equal(f.batch.store.item(x.queue_id).state,'SUCCEEDED');
 assert.equal(f.flow.launches.length,launches);assert.equal(f.store.events(x.run_id).filter(e=>e.kind==='SUBMIT_CLICKED').length,1);assert.equal(f.action.attempts.get(receipt.attemptId).run_id,x.run_id);
});

test('website verify-only recovers a missing ID through the real verifier using original submission evidence',async t=>{
 const f=await fixture(t,{submitted:true}),o=f.round,x=o.item(f.r.id,f.scope().key),originalQueue=f.batch.store.item(x.queue_id),calls=[];
 f.store.checkpoint(x.run_id,{itemId:null});
 for(const [kind,at] of [['SUBMITTING','2026-10-18T13:27:10.103Z'],['SUBMIT_CLICKED','2026-10-18T13:27:11.139Z'],['RESULT_UNKNOWN','2026-10-18T13:27:44.315Z']])f.store.db.prepare('UPDATE events SET at=? WHERE run=? AND kind=?').run(at,x.run_id,kind);
 const task=x.task,record={itemId:'700001',title:task.listing.title,status:'出售中',text:task.listing.title+' ID: 700001',cells:[{label:'价格',text:'20'},{label:'库存',text:'999999'},{label:'创建时间',text:'2026-10-18 21:27:20'}]};
 o.db.prepare('INSERT INTO round_policy_overrides(round_id,policy,payload,at) VALUES(?,?,?,?)').run(f.r.id,'ignore-destination-duplicates',JSON.stringify({enabled:true,scope:'THIS_ROUND_ONLY',manifestHash:o.round(f.r.id).manifest_hash,shop:task.shopId}),new Date().toISOString());
 const verifier=new RoundVerification({context:()=>({}),guard:async()=>o.assertLease(f.r.id),round:()=>({round:o.round(f.r.id),items:o.items(f.r.id)}),artifacts:o.artifacts,
  tableFactory:async()=>({page:{},search:async query=>{calls.push(query);return {records:[record]};}}),evidence:async()=>f.result});
 o.verifyExisting=input=>verifier.verify(input);
 const beforeEvents=f.store.events(x.run_id).filter(e=>['SUBMITTING','SUBMIT_CLICKED'].includes(e.kind));
 const req=f.request(),receipt=await f.action.verify(req);
 assert.equal(receipt.outcome.state,'NEW_SUCCESS');assert.equal(f.store.run(x.run_id).state,'VERIFIED');assert.equal(f.batch.store.item(x.queue_id).state,'SUCCEEDED');assert.equal(o.item(f.r.id,x.key).state,'NEW_SUCCESS');
 assert.equal(o.view(f.r.id).state,'PAUSED');assert.equal(o.item(f.r.id,f.scope(2).key).state,'PENDING');assert.equal(f.flow.submits,0);
 assert.deepEqual(calls,[{title:task.listing.title}]);assert.deepEqual(f.store.events(x.run_id).filter(e=>['SUBMITTING','SUBMIT_CLICKED'].includes(e.kind)),beforeEvents);
 const afterQueue=f.batch.store.item(x.queue_id);for(const key of ['attempts','max_attempts','extra_attempts'])assert.equal(afterQueue[key],originalQueue[key]);
 assert.equal((await f.action.verify(req)).replayed,true);assert.equal(calls.length,1);
});

test('ambiguous and absent results preserve unknown and record a sealed unsuccessful attempt',async t=>{
 for(const mode of ['absent','ambiguous']){
  const f=await fixture(t);f.round.verifyExisting=async()=>{if(mode==='ambiguous')throw Object.assign(Error('candidate remains'),{code:'EXISTENCE_AMBIGUOUS'});return null;};
  await assert.rejects(f.action.verify(f.request()));assert.equal(f.round.item(f.r.id,f.scope().key).state,'RESULT_UNKNOWN');assert.equal(f.store.completed(f.tasks[0]),null);assert.equal(f.flow.submits,0);
  const a=f.action.attempts.list(f.r.id,f.scope().key).at(-1);assert(a.finished_at);assert.equal(a.outcome.disposition,'UNRESOLVED');assert.equal(f.round.active,null);
 }
});

test('single owner excludes round and second item action while inspector is pending',async t=>{
 const f=await fixture(t);let release,started;const ready=new Promise(r=>started=r);f.round.verifyExisting=async()=>{started();return new Promise(r=>release=()=>r(f.result));};
 const pending=f.action.verify(f.request());await ready;assert.throws(()=>f.round.start(f.r.id,{windowId:f.w.id}),/已有/);
 await assert.rejects(f.action.verify(f.request({requestId:'second'})));release();await pending;assert.equal(f.action.attempts.list(f.r.id,f.scope().key).length,1);
});

test('pause during inspection cannot record a success or advance another task',async t=>{
 const f=await fixture(t);let release,started;const ready=new Promise(r=>started=r);f.round.verifyExisting=async()=>{started();return new Promise(r=>release=()=>r(f.result));};
 const pending=f.action.verify(f.request());await ready;f.round.pause();release();await assert.rejects(pending,e=>e.code==='ROUND_PAUSE');
 assert.equal(f.round.view(f.r.id).state,'PAUSED');assert.equal(f.store.completed(f.tasks[0]),null);assert.equal(f.flow.submits,0);assert.equal(f.round.active,null);
});

test('changed revision, content hold, manual ID override and removed shop reject before inspection',async t=>{
 for(const mode of ['revision','content','override','removed']){
  const f=await fixture(t),req=f.request();
  if(mode==='revision')f.round.event(f.r.id,null,'OTHER_CHANGE',{});
  if(mode==='content')f.round.update(f.r.id,f.scope().key,{failure_stage:'content-review'});
  if(mode==='override')req.itemId='888888';if(mode==='removed')f.remove();
  await assert.rejects(f.action.verify(req));assert.equal(f.calls(),0);assert.equal(f.action.attempts.list(f.r.id,f.scope().key).length,0);
 }
});

test('incomplete evidence and changed business values keep original unknown run protected',async t=>{
 for(const mode of ['id','price','inventory','png']){
  const f=await fixture(t,{submitted:true});if(mode==='id')f.result.itemId='999999';if(mode==='price')f.result.observed.price=21;if(mode==='inventory')f.result.observed.inventory=1;if(mode==='png')await writeFile(f.result.screenshot,'not PNG');
  await assert.rejects(f.action.verify(f.request()));const x=f.round.item(f.r.id,f.scope().key);assert.equal(f.store.run(x.run_id).state,'RESULT_UNKNOWN');assert.equal(f.store.completed(f.tasks[0]),null);assert.equal(x.state,'RESULT_UNKNOWN');
 }
});

test('transactional projection failure rolls back run history and queue before recording unresolved attempt',async t=>{
 const f=await fixture(t,{submitted:true});f.action.attempts.seal=(...args)=>{if(args[1].disposition==='VERIFIED')throw Object.assign(Error('simulated storage failure'),{code:'SQLITE_FULL'});return Object.getPrototypeOf(f.action.attempts).seal.apply(f.action.attempts,args);};
 await assert.rejects(f.action.verify(f.request()),/simulated storage/);const x=f.round.item(f.r.id,f.scope().key);assert.equal(f.store.run(x.run_id).state,'RESULT_UNKNOWN');assert.equal(f.batch.store.item(x.queue_id).state,'WAITING_HUMAN');assert.equal(f.store.completed(f.tasks[0]),null);assert.equal(x.state,'RESULT_UNKNOWN');
 const a=f.action.attempts.list(f.r.id,x.key).at(-1);assert.equal(a.outcome.code,'SQLITE_FULL');assert.equal(a.outcome.disposition,'UNRESOLVED');
});

test('CAPTCHA keeps verification scene and offers human handling without a submit',async t=>{
 const f=await fixture(t);f.round.verifyExisting=async()=>{throw Error('PAUSED_CAPTCHA');};
 await assert.rejects(f.action.verify(f.request()),/PAUSED_CAPTCHA/);assert.equal(f.round.view(f.r.id).state,'WAITING_HUMAN');assert.equal(f.round.item(f.r.id,f.scope().key).state,'RESULT_UNKNOWN');
 assert.equal(f.action.attempts.list(f.r.id,f.scope().key).at(-1).outcome.code,'PAUSED_CAPTCHA');assert.equal(f.flow.submits,0);
});

test('lost process unfinished receipt is sealed as interrupted and a new linked verification is allowed',async t=>{
 const f=await fixture(t),req=f.request(),s=f.action.reader.read(req);
 const a=f.store.transaction(()=>f.action.attempts.begin({scope:{roundId:req.roundId,windowId:req.windowId,key:req.key,shopId:s.r.shop,taskHash:s.x.task_hash,repairVersion:s.r.repair_version},kind:'VERIFY_ONLY',requestId:'verify-only:'+req.requestId,before:{requestIntent:createHash('sha256').update(JSON.stringify(req)).digest('hex'),request:req,snapshot:s.snapshot}}));
 const recovery=await f.action.verify(req);assert.equal(recovery.outcome.disposition,'INTERRUPTED');assert.equal(f.calls(),0);assert.equal(f.round.item(f.r.id,req.key).state,'RESULT_UNKNOWN');
 const success=await f.action.verify(f.request({requestId:'after-recovery'}));assert.equal(success.outcome.disposition,'VERIFIED');assert.equal(f.action.attempts.get(success.attemptId).parent_attempt_id,a.id);
 assert.equal(f.action.attempts.get(a.id).outcome.disposition,'INTERRUPTED');assert.equal(f.flow.submits,0);
});

test('database change during remote inspection blocks stale result persistence',async t=>{
 const f=await fixture(t);f.round.verifyExisting=async()=>{f.round.event(f.r.id, f.scope().key,'OTHER_DIAGNOSTIC',{});return f.result;};
 await assert.rejects(f.action.verify(f.request()),e=>e.code==='ITEM_VERIFY_STALE_REVISION');assert.equal(f.store.completed(f.tasks[0]),null);assert.equal(f.round.item(f.r.id,f.scope().key).state,'RESULT_UNKNOWN');
});

test('stop during remote inspection preserves unknown and never enters the following task',async t=>{
 const f=await fixture(t);let release,started;const ready=new Promise(r=>started=r);f.round.verifyExisting=async()=>{started();return new Promise(r=>release=()=>r(f.result));};
 const pending=f.action.verify(f.request());await ready;f.round.stop();release();await assert.rejects(pending,e=>e.code==='ROUND_PAUSE');
 assert.equal(f.round.view(f.r.id).state,'STOPPED');assert.equal(f.round.item(f.r.id,f.scope().key).state,'RESULT_UNKNOWN');assert.equal(f.round.item(f.r.id,f.scope(2).key).state,'PENDING');assert.equal(f.flow.submits,0);
});

test('browser or fresh identity change after inspection rejects result persistence',async t=>{
 for(const mode of ['context','identity']){
  const f=await fixture(t);f.round.verifyExisting=async()=>{if(mode==='context')f.p.owner.sessions.set(f.round.shop.id,{context:{}});else f.round.assertExecution=async()=>{throw Error('target shop identity changed');};return f.result;};
  await assert.rejects(f.action.verify(f.request()));assert.equal(f.store.completed(f.tasks[0]),null);assert.equal(f.round.item(f.r.id,f.scope().key).state,'RESULT_UNKNOWN');
 }
});

test('recovered storage seals the blocked attempt without another browser read then permits a fresh attempt',async t=>{
 const f=await fixture(t,{submitted:true}),req=f.request(),original=f.action.attempts.seal.bind(f.action.attempts);
 f.action.attempts.seal=()=>{throw Object.assign(Error('storage full'),{code:'SQLITE_FULL'});};
 await assert.rejects(f.action.verify(req),/storage full/);assert.equal(f.round.active,f.r.id);assert(f.action.persistenceBlocked);
 assert.throws(()=>f.round.start(f.r.id,{windowId:f.w.id}),/已有/);
 await assert.rejects(f.action.verify({...req,requestId:'different'}),e=>e.code==='ITEM_VERIFY_PERSISTENCE_BLOCKED');
 f.action.attempts.seal=original;
 const recovered=await f.action.verify(req);assert.equal(recovered.outcome.code,'ITEM_VERIFY_PERSISTENCE_RECOVERED');assert.equal(f.calls(),1);assert.equal(f.round.active,null);assert.equal(f.action.persistenceBlocked,null);
 const success=await f.action.verify(f.request({requestId:'after-storage-recovery'}));assert.equal(success.outcome.state,'NEW_SUCCESS');assert.equal(f.calls(),2);assert.equal(f.action.attempts.get(success.attemptId).parent_attempt_id,recovered.attemptId);
 const x=f.round.item(f.r.id,req.key);assert.equal(f.store.events(x.run_id).filter(e=>e.kind==='SUBMIT_CLICKED').length,1);
});

test('real RoundVerification connects to this controller for known ID and fresh inventory paths',async t=>{
 for(const submitted of [false,true]){
  const f=await fixture(t,{submitted}),calls=[],records=[{itemId:'700001',title:f.tasks[0].listing.title,status:'出售中'}];let newSubmission;
  const guard=async()=>{f.round.assertLease(f.r.id);await f.round.assertExecution();};
  const verifier=new RoundVerification({context:()=>f.p.owner.sessions.get(f.round.shop.id).context,guard,round:()=>({round:f.round.round(f.r.id),items:f.round.items(f.r.id)}),artifacts:f.round.artifacts,
   tableFactory:async(context,task,check)=>{await check();return {search:async query=>{calls.push(query||{});return {records,total:1,at:new Date().toISOString()};}};},
   evidence:async(table,row,task,dir,options)=>{await guard();newSubmission=options.newSubmission;return f.result;}});
  f.round.verifyExisting=args=>verifier.verify(args);
  const receipt=await f.action.verify(f.request());assert.equal(receipt.outcome.disposition,'VERIFIED');assert.equal(newSubmission,submitted);
  assert.deepEqual(calls,submitted?[{itemId:'700001'}]:[{}, {title:f.tasks[0].listing.city},{itemId:'700001'}]);
  assert.equal(f.flow.submits,0);
 }
});
