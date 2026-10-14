import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {fixture} from './verify-http-fixture.mjs';
import {ProductApi} from '../product-api.mjs';
import {RoundVerification} from '../round-verification.mjs';
import {getPageLedger} from '../page-ownership.mjs';

function close(f,state='COMPLETED'){
 f.round.windows.close(f.w.id,state,'synthetic historical window');
 if(state==='STOPPED')f.store.db.prepare('UPDATE rounds SET stopped=1 WHERE id=?').run(f.r.id);
 f.round.state(f.r.id,state==='STOPPED'?'STOPPED':'NEEDS_REVIEW','historical candidate');
 return {window:JSON.stringify(f.round.windows.get(f.w.id)),entries:JSON.stringify(f.round.windows.entries(f.w.id)),csv:f.round.windows.csv(f.w.id)};
}
function unchanged(f,before){
 assert.equal(JSON.stringify(f.round.windows.get(f.w.id)),before.window);
 assert.equal(JSON.stringify(f.round.windows.entries(f.w.id)),before.entries);
 assert.equal(f.round.windows.csv(f.w.id),before.csv);
}

test('sealed history gets linked verification while original outcome and CSV stay frozen',async t=>{
 const f=await fixture(t),before=close(f),other=f.round.item(f.r.id,f.scope(2).key);
 let input;f.round.verifyExisting=async x=>{input=x;return f.result;};
 const req=f.request(),receipt=await f.action.verify(req);
 assert.equal(receipt.outcome.state,'EXISTING_VERIFIED');
 assert.equal(input.executionWindowId,f.w.id);assert.equal(input.verificationAttemptId,receipt.attemptId);
 assert.equal(f.action.attempts.get(receipt.attemptId).window_id,f.w.id);
 assert.equal(f.round.item(f.r.id,req.key).result.itemId,'700001');
 unchanged(f,before);assert.deepEqual(f.round.item(f.r.id,f.scope(2).key),other);
 assert.equal(f.flow.launches.length,0);assert.equal(f.flow.submits,0);
 assert.equal((await f.action.verify(req)).replayed,true);unchanged(f,before);
});

test('stopped historical window remains stopped after verifying only its original item',async t=>{
 const f=await fixture(t),before=close(f,'STOPPED');
 await f.action.verify(f.request());
 unchanged(f,before);assert.equal(f.round.round(f.r.id).state,'STOPPED');
 assert.equal(f.round.round(f.r.id).stopped,1);assert.equal(f.round.active,null);
});

test('another open assignment cannot be borrowed by historical verification',async t=>{
 const f=await fixture(t),before=close(f);
 const next=f.round.windows.create(await f.round.windows.preview(f.r.id,{limit:2}));
 const nextBefore=JSON.stringify(f.round.windows.get(next.id));
 await assert.rejects(f.action.verify(f.request()),e=>e.code==='ITEM_VERIFY_OTHER_WINDOW_OPEN');
 assert.equal(f.calls(),0);assert.equal(f.action.attempts.list(f.r.id,f.scope().key).length,0);
 unchanged(f,before);assert.equal(JSON.stringify(f.round.windows.get(next.id)),nextBefore);
});

test('historical empty platform result preserves unknown and never republishes',async t=>{
 const f=await fixture(t),before=close(f);f.round.verifyExisting=async()=>null;
 await assert.rejects(f.action.verify(f.request()),e=>e.code==='ITEM_VERIFY_EVIDENCE_INCOMPLETE');
 unchanged(f,before);assert.equal(f.round.item(f.r.id,f.scope().key).state,'RESULT_UNKNOWN');
 assert.equal(f.store.completed(f.tasks[0]),null);assert.equal(f.flow.submits,0);
 assert.equal(f.action.attempts.list(f.r.id,f.scope().key)[0].outcome.disposition,'UNRESOLVED');
});

test('historical action rejects a missing original unknown snapshot',async t=>{
 const f=await fixture(t);f.round.update(f.r.id,f.scope().key,{state:'PENDING'});close(f);
 f.round.update(f.r.id,f.scope().key,{state:'RESULT_UNKNOWN'});
 await assert.rejects(f.action.verify(f.request()),e=>e.code==='ITEM_VERIFY_WINDOW_ADAPTER_REQUIRED');
 assert.equal(f.calls(),0);assert.equal(f.flow.submits,0);
});

test('stop during historical verification preserves scene and seals stop without changing history',async t=>{
 const f=await fixture(t),before=close(f);let enter,release;
 const ready=new Promise(r=>enter=r);
 f.round.verifyExisting=async()=>{enter();return new Promise(r=>release=()=>r(f.result));};
 const pending=f.action.verify(f.request());await ready;f.round.stop();release();
 await assert.rejects(pending,e=>e.code==='ROUND_PAUSE');
 unchanged(f,before);assert.equal(f.round.round(f.r.id).state,'STOPPED');
 assert.equal(f.flow.submits,0);assert.equal(f.round.active,null);
 assert.equal(f.round.item(f.r.id,f.scope().key).state,'RESULT_UNKNOWN');
});

test('historical stop finalization fault retains lease and exact replay finishes without second inspection',async t=>{
 const f=await fixture(t),before=close(f,'STOPPED'),req=f.request();
 const original=f.round.state.bind(f.round);let fail=true;
 f.round.state=(id,state,reason)=>{if(fail&&state==='STOPPED')throw Error('synthetic stop persistence');return original(id,state,reason);};
 await assert.rejects(f.action.verify(req),/synthetic stop/);
 assert.equal(f.round.active,f.r.id);assert(f.action.stopFinalizationBlocked);assert.equal(f.calls(),1);
 fail=false;const replay=await f.action.verify(req);
 assert(replay.replayed);assert.equal(f.calls(),1);assert.equal(f.round.round(f.r.id).state,'STOPPED');
 assert.equal(f.round.active,null);unchanged(f,before);
});

test('real ProductApi binds historical page ledger to the original assignment and open attempt',async t=>{
 const f=await fixture(t),before=close(f);
 const context={pages:()=>[],on:()=>{},off:()=>{}};
 const product=new ProductApi({source:f.flow,batch:f.batch,owner:{sessions:new Map([[f.round.shop.id,{context}]])},shop:f.round.shop,runtime:f.round.artifacts,
  integrity:async()=>({ok:true}),checkFiles:async()=>{},isShopRemoved:()=>false});
 t.after(()=>product.closeStreams());
 product.round.assertExecution=async()=>{};
 product.round.assertContentForTask=()=>({decision:'PASS'});
 await mkdir(product.round.artifacts,{recursive:true});
 const picture=join(product.round.artifacts,'synthetic.png');
 await writeFile(picture,await readFile(f.result.screenshot));
 const result={...f.result,screenshot:picture};
 let received;product.roundVerifier.verify=async input=>{
  received=input;
  for(const delta of [{verificationAttemptId:randomUUID()},{executionWindowId:'forged-window'},{key:f.scope(2).key},{task:{...f.tasks[0],shopId:'other-shop'}}]){
   assert.throws(()=>product.round.verifyExisting({...input,...delta}),/原处理记录/);
  }
  return result;
 };
 const action=product.roundItems.verification.verifier;
 const scope=f.scope(),req={...scope,expectedRevision:action.reader.read(scope).revision,requestId:'real-host-history'};
 const receipt=await action.verify(req);
 assert.equal(received.verificationAttemptId,receipt.attemptId);
 const ledger=getPageLedger(context);
 assert.equal(ledger.scope.executionWindowId,f.w.id);assert.equal(ledger.scope.taskKey,req.key);
 assert.equal(ledger.scope.runId,null);assert.equal(ledger.counts().owned,0);
 assert.equal(product.round.item(f.r.id,req.key).state,'EXISTING_VERIFIED');unchanged(f,before);
 assert.throws(()=>product.round.verifyExisting({...received,verificationAttemptId:randomUUID()}),/原处理记录/);
 assert.throws(()=>product.round.verifyExisting({...received,executionWindowId:'forged-window'}),/原处理记录/);
 assert.equal(f.flow.submits,0);
});

test('each action reads fresh inventory and writes exclusive evidence without replacing original files',async t=>{
 const f=await fixture(t),key=f.scope().key,root=join(f.round.artifacts,f.r.id),original=join(root,'verification',key);
 await mkdir(original,{recursive:true});
 await writeFile(join(root,'inventory-check.json'),'original inventory');
 await writeFile(join(original,'duplicate-check.json'),'original duplicate check');
 const records=[{itemId:'700001',title:f.tasks[0].listing.title,status:'出售中'}],queries=[];
 const v=new RoundVerification({context:()=>({}),guard:async()=>{},round:()=>({round:f.round.round(f.r.id),items:f.round.items(f.r.id)}),artifacts:f.round.artifacts,
  tableFactory:async()=>({search:async q=>{queries.push(q||{});return {records,total:1,at:new Date().toISOString()};}}),
  evidence:async(table,row,task,dir)=>{await writeFile(join(dir,'verification.json'),JSON.stringify({itemId:row.itemId}));return f.result;}});
 const args={task:f.tasks[0],roundId:f.r.id,key},first=randomUUID(),second=randomUUID();
 await v.verify({...args,verificationAttemptId:first});await v.verify({...args,verificationAttemptId:second});
 assert.equal(queries.filter(q=>Object.keys(q).length===0).length,2);
 assert.equal(await readFile(join(root,'inventory-check.json'),'utf8'),'original inventory');
 assert.equal(await readFile(join(original,'duplicate-check.json'),'utf8'),'original duplicate check');
 for(const id of [first,second]){
  const dir=join(original,'attempts',id);
  assert.equal(JSON.parse(await readFile(join(dir,'duplicate-check.json'),'utf8')).key,key);
  assert.equal(JSON.parse(await readFile(join(dir,'inventory-check.json'),'utf8')).total,1);
 }
 const count=queries.length;
 await assert.rejects(v.verify({...args,verificationAttemptId:first}),e=>e.code==='EEXIST');
 await assert.rejects(v.verify({...args,verificationAttemptId:'../escape'}),/编号无效/);
 assert.equal(queries.length,count);
});
