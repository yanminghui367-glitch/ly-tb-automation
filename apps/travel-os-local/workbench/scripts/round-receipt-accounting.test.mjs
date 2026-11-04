import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {setup,digest} from './skip-independent-fixture.mjs';
import {RoundItemHostGuard} from '../round-item-host.mjs';
import {RoundItemVerify} from '../round-item-verify.mjs';

async function fixture(t){
 const f=await setup(t);await f.pause();const o=f.round,x=o.item(f.r.id,f.scope().key),run=f.store.run(x.run_id);
 f.store.move(run.id,'QUEUED');f.store.move(run.id,'RUNNING');f.store.move(run.id,'SUBMITTING');f.store.event(run.id,'STEP_INTENT',{name:'submit-once'});
 const form='https://item.upload.taobao.com/sell/v2/publish.htm?catId=50014945';f.store.checkpoint(run.id,{formUrl:form});f.store.move(run.id,'RESULT_UNKNOWN');o.update(f.r.id,x.key,{state:'RESULT_UNKNOWN',submitted:0,submission_uncertain:1,failure_stage:'submit-once'});o.state(f.r.id,'RESULT_UNKNOWN');
 const scope={runId:run.id,shopId:run.task.shopId,taskKey:run.key,taskHash:digest(run.task)};
 f.store.db.exec('CREATE TABLE IF NOT EXISTS page_owner_pages(id TEXT,session_id TEXT,origin TEXT,purpose TEXT,scope TEXT,target_id TEXT,browser_context_id TEXT,state TEXT)');
 f.store.db.prepare('INSERT INTO page_owner_pages VALUES(?,?,?,?,?,?,?,?)').run('page-record','session','executor-created','publish-form',JSON.stringify(scope),'target','context','retained');
 const screenshot=join(o.artifacts,'verify-receipt.png');await writeFile(screenshot,Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1sAAAAASUVORK5CYII=','base64'));
 const result={itemId:'700001',url:'https://item.taobao.com/item.htm?id=700001',status:'出售中',rowText:'synthetic seller row',screenshot,verifiedAt:new Date().toISOString(),observed:{price:20,inventory:999999},differences:[],
 submissionReceipt:{source:'ORIGINAL_PAGE_RECEIPT',runId:run.id,taskHash:digest(run.task),shopId:run.task.shopId,itemId:'700001',originalSubmitEvent:f.store.events(run.id).findLast(e=>e.kind==='SUBMITTING').seq,observedAt:new Date().toISOString(),formUrl:form,successUrl:'https://item.upload.taobao.com/sell/v2/success.htm?primaryId=700001&isEdit=false',pageId:'page-record',targetId:'target',browserContextId:'context'}};
 // Backend verification happens after receipt observation, never before it.
 result.verifiedAt=new Date().toISOString();
 o.verifyExisting=async()=>result;
 const product={round:o,source:f.flow,batch:f.batch,shop:o.shop,owner:{sessions:new Map([[o.shop.id,{context:{}}]])},capturing:false,reconciling:false,integrity:async()=>({ok:true})};
 const action=new RoundItemVerify(new RoundItemHostGuard(product,{isShopRemoved:()=>false}));
 const request=()=>({...f.scope(),expectedRevision:action.reader.read(f.scope()).revision,requestId:'original-receipt-verify'});
 return {...f,x,run,result,action,request};
}
for(const route of ['single-item','round-resume'])test(route+' recovered original receipt fixes submission accounting without another click or budget',async t=>{
 const f=await fixture(t),before=f.batch.store.item(f.x.queue_id),request=f.request();
 if(route==='single-item'){const r=await f.action.verify(request);assert.equal(r.outcome.state,'NEW_SUCCESS');assert.equal((await f.action.verify(request)).replayed,true);}
 else {f.round.active=f.r.id;f.batch.active='round:'+f.r.id;f.flow.queueLease='round:'+f.r.id;f.round.pauseRequested=false;assert.equal(await f.round.verify(f.r.id,f.round.item(f.r.id,f.x.key)),true);}
 const after=f.round.item(f.r.id,f.x.key);assert.equal(after.state,'NEW_SUCCESS');assert.equal(after.submitted,1);assert.equal(after.submission_uncertain,0);assert.equal(f.flow.submits,0);
 const events=f.store.events(f.run.id);assert.equal(events.filter(e=>e.kind==='SUBMIT_CLICKED').length,0);assert.equal(events.filter(e=>e.kind==='SUBMIT_EVIDENCE').length,1);assert.equal(events.find(e=>e.kind==='SUBMIT_EVIDENCE').payload.backendVerified,true);
 for(const k of ['attempts','max_attempts','extra_attempts'])assert.equal(f.batch.store.item(f.x.queue_id)[k],before[k]);
 assert.equal(f.round.item(f.r.id,f.scope(2).key).state,'PENDING');
});
for(const field of ['runId','taskHash','shopId','itemId','originalSubmitEvent','targetId','browserContextId','formUrl','successUrl'])test('foreign original receipt '+field+' cannot update state or accounting',async t=>{
 const f=await fixture(t);f.result.submissionReceipt[field]='foreign';await assert.rejects(f.action.verify(f.request()),/SUBMISSION_RECEIPT/);
 assert.equal(f.round.item(f.r.id,f.x.key).state,'RESULT_UNKNOWN');assert.equal(f.store.run(f.run.id).state,'RESULT_UNKNOWN');assert.equal(f.store.events(f.run.id).filter(e=>e.kind==='SUBMIT_EVIDENCE').length,0);
});
test('single-item projection rollback also rolls back recovered receipt event',async t=>{
 const f=await fixture(t),seal=f.action.attempts.seal.bind(f.action.attempts);f.action.attempts.seal=(id,outcome)=>{if(outcome.disposition==='VERIFIED')throw Error('simulated projection failure');return seal(id,outcome);};
 await assert.rejects(f.action.verify(f.request()),/projection failure/);assert.equal(f.store.events(f.run.id).filter(e=>e.kind==='SUBMIT_EVIDENCE').length,0);assert.equal(f.round.item(f.r.id,f.x.key).state,'RESULT_UNKNOWN');
});
