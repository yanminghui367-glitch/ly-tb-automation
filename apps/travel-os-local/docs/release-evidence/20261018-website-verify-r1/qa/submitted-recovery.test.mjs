import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {setup,load} from './fixture.mjs';
const {RoundItemHostGuard}=await load('round-item-host.mjs');
const {RoundItemVerify}=await load('round-item-verify.mjs');
const {RoundVerification}=await load('round-verification.mjs');

async function fixture(t,{known=false,submitted=true}={}){
 const f=await setup(t),o=f.round;
 let run;
 if(submitted){
  await f.pause();const x=o.item(f.r.id,f.scope().key);run=f.store.run(x.run_id);
  f.store.move(run.id,'QUEUED');f.store.move(run.id,'RUNNING');f.store.move(run.id,'SUBMITTING');
  f.store.event(run.id,'SUBMIT_CLICKED',{});f.store.checkpoint(run.id,{step:'submit-once',...(known?{itemId:'700001'}:{})});f.store.move(run.id,'RESULT_UNKNOWN');
  const times={SUBMITTING:'2026-10-18T12:00:00.000Z',SUBMIT_CLICKED:'2026-10-18T12:00:01.000Z',RESULT_UNKNOWN:'2026-10-18T12:00:30.000Z'};
  for(const [kind,at] of Object.entries(times))f.store.db.prepare('UPDATE events SET at=? WHERE run=? AND kind=?').run(at,run.id,kind);
  o.update(f.r.id,x.key,{state:'RESULT_UNKNOWN',submitted:1,submission_uncertain:1,failure_stage:'verify-platform-result'});o.state(f.r.id,'RESULT_UNKNOWN','isolated unknown');
 }else{o.update(f.r.id,f.scope().key,{state:'RESULT_UNKNOWN',failure_stage:'existing-listing-check'});o.state(f.r.id,'PAUSED','isolated candidate');}
 const product={round:o,source:f.flow,batch:f.batch,shop:o.shop,owner:{sessions:new Map([[o.shop.id,{context:{}}]])},capturing:false,reconciling:false,integrity:async()=>({ok:true})};
 const action=new RoundItemVerify(new RoundItemHostGuard(product,{isShopRemoved:()=>false}));
 const screenshot=join(o.artifacts,'independent-result.png');await writeFile(screenshot,Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1sAAAAASUVORK5CYII=','base64'));
 const result={itemId:'700001',url:'https://item.taobao.com/item.htm?id=700001',status:'出售中',rowText:'isolated matching seller row',screenshot,verifiedAt:new Date().toISOString(),observed:{price:20,inventory:999999},differences:[]};
 const row={itemId:'700001',title:f.tasks[0].listing.title,status:'出售中',cells:[{label:'价格',text:'20.00'},{label:'库存',text:'999999'},{label:'创建时间',text:'2026-10-18 20:00:05'}]};
 const calls=[];let captured,rows=[row],challenge=false;
 const verifier=new RoundVerification({context:()=>product.owner.sessions.get(o.shop.id).context,guard:async()=>{o.assertLease(f.r.id);if(challenge)throw Error('PAUSED_CAPTCHA');},round:()=>({round:o.round(f.r.id),items:o.items(f.r.id)}),artifacts:o.artifacts,
  tableFactory:async()=>({page:{},search:async q=>{calls.push(q);return {records:rows,total:rows.length,at:new Date().toISOString()};}}),evidence:async()=>result});
 o.verifyExisting=args=>{captured=args;return verifier.verify(args);};
 const request=(extra={})=>({...f.scope(),expectedRevision:action.reader.read(f.scope()).revision,requestId:'independent-verify',...extra});
 const assertProtected=()=>{const x=o.item(f.r.id,f.scope().key);assert.equal(x.state,'RESULT_UNKNOWN');if(run)assert.equal(f.store.run(run.id).state,'RESULT_UNKNOWN');assert.equal(f.store.completed(f.tasks[0]),null);assert.equal(f.flow.submits,0);assert.equal(o.active,null);};
 return {...f,action,product,result,row,run,calls,request,assertProtected,captured:()=>captured,setRows:r=>rows=r,setChallenge:()=>challenge=true};
}

test('no-ID submitted button supplies original events and ownership guard; records one success without new submit',async t=>{
 const f=await fixture(t),x=f.round.item(f.r.id,f.scope().key),q=f.batch.store.item(x.queue_id),other=f.round.item(f.r.id,f.scope(2).key),launches=f.flow.launches.length;
 const request=f.request({submissionEvents:[],assertUnusedItemId:()=>{throw Error('untrusted request callback');}});
 const receipt=await f.action.verify(request);
 assert.equal(receipt.outcome.state,'NEW_SUCCESS');assert.equal(receipt.outcome.submittedByThisAction,false);
 assert.equal(f.store.run(f.run.id).state,'VERIFIED');assert.equal(f.batch.store.item(x.queue_id).state,'SUCCEEDED');
 assert.equal(f.batch.store.item(x.queue_id).attempts,q.attempts);assert.equal(f.batch.store.item(x.queue_id).max_attempts,q.max_attempts);
 assert.equal(f.flow.launches.length,launches);assert.equal(f.flow.submits,0);assert.equal(f.store.events(f.run.id).filter(e=>e.kind==='SUBMIT_CLICKED').length,1);
 assert.deepEqual(f.round.item(f.r.id,f.scope(2).key),other);assert.equal(f.round.view(f.r.id).state,'PAUSED');
 assert.equal(typeof f.captured().assertUnusedItemId,'function');assert(f.captured().submissionEvents.some(e=>e.run===f.run.id&&e.kind==='SUBMIT_CLICKED'));
 assert.deepEqual(f.calls,[{title:f.tasks[0].listing.title}]);
 const replay=await f.action.verify(request);assert.equal(replay.replayed,true);assert.equal(f.calls.length,1);
});

test('missing actual click evidence fails closed before seller lookup',async t=>{
 const f=await fixture(t);f.store.db.prepare("DELETE FROM events WHERE run=? AND kind='SUBMIT_CLICKED'").run(f.run.id);
 await assert.rejects(f.action.verify(f.request()),/实际提交点击时间/);assert.equal(f.calls.length,0);f.assertProtected();
});

test('foreign historical item ID cannot be borrowed by recovery button',async t=>{
 const f=await fixture(t);f.store.history(f.tasks[1],{...f.result});
 await assert.rejects(f.action.verify(f.request()),/已有成功记录/);f.assertProtected();
});

test('other run checkpoint ID cannot be borrowed by recovery button',async t=>{
 const f=await fixture(t);f.store.db.prepare('INSERT INTO runs(id,key,batch,task,mode,target,state,at,checkpoint) VALUES(?,?,?,?,?,?,?,?,?)').run('foreign-run','foreign-key','fixture',JSON.stringify(f.tasks[1]),'LIVE','SOURCE','RESULT_UNKNOWN',new Date().toISOString(),JSON.stringify({itemId:'700001'}));
 await assert.rejects(f.action.verify(f.request()),/关联其他任务/);f.assertProtected();
});

test('old same-title row outside original click interval stays unknown',async t=>{
 const f=await fixture(t);f.row.cells[2].text='2026-10-18 19:00:00';
 await assert.rejects(f.action.verify(f.request()),/创建时间与本次提交时间不匹配/);f.assertProtected();
});

test('ambiguous title matches stay unknown and cannot be skipped',async t=>{
 const f=await fixture(t);f.setRows([f.row,{...f.row,itemId:'700002'}]);
 await assert.rejects(f.action.verify(f.request()),/同标题商品不唯一/);f.assertProtected();
 assert.equal(f.action.reader.inspect(f.scope()).allowed,false);
});

test('CAPTCHA on original recovery preserves the unknown and human gate',async t=>{
 const f=await fixture(t);f.setChallenge();
 await assert.rejects(f.action.verify(f.request()),/PAUSED_CAPTCHA/);f.assertProtected();assert.equal(f.round.view(f.r.id).state,'WAITING_HUMAN');
});

test('known-ID recovery keeps the existing branch without missing-ID recovery inputs',async t=>{
 const f=await fixture(t,{known:true});const r=await f.action.verify(f.request());assert.equal(r.outcome.state,'NEW_SUCCESS');
 assert.equal(f.captured().submissionEvents,undefined);assert.equal(f.captured().assertUnusedItemId,undefined);assert.deepEqual(f.calls,[{itemId:'700001'}]);
});

test('unsubmitted candidate receives no submitted recovery capability',async t=>{
 const f=await fixture(t,{submitted:false});f.round.verifyExisting=async args=>{assert.equal(args.submissionEvents,undefined);assert.equal(args.assertUnusedItemId,undefined);return f.result;};
 const r=await f.action.verify(f.request());assert.equal(r.outcome.state,'EXISTING_VERIFIED');assert.equal(f.flow.launches.length,0);assert.equal(f.flow.submits,0);
});
