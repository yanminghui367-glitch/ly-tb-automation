import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {fixture} from './continuous-round-fixture.mjs';
const results=[];
test.after(()=>writeFile(new URL('./circuit-outcomes.json',import.meta.url),JSON.stringify(results,null,2)));
const bad=(reason='selector disappeared',code)=>({state:'PAUSED',reason,code,step:'main-image-3'});
async function scenario(t,n,behavior){const f=await fixture(t,n);f.setBehavior(behavior);const r=await f.create(),v=await f.finish(r.id);results.push({name:t.name,state:v.state,counts:v.counts,launches:f.flow.launches.length,submits:f.flow.submits});return {f,r,v};}
test('one unclassified pre-submit failure is terminal once; the other four complete',async t=>{
 const {f,r,v}=await scenario(t,5,x=>x.task.priority===1?bad():{state:'VERIFIED'});assert.equal(v.state,'COMPLETED');assert.equal(v.counts.FAILED,1);assert.equal(v.counts.NEW_SUCCESS,4);assert.equal(f.flow.launches.length,5);
 const x=f.round.items(r.id)[0],q=f.batch.store.item(x.queue_id);assert.equal(x.state,'FAILED');assert.equal(q.attempts,1);assert.equal(q.max_attempts,3);assert.equal(x.extra_attempts,0);assert.equal(f.flow.launches.filter(id=>id===x.run_id).length,1);
 assert(!f.round.events(r.id).some(e=>e.kind==='SYSTEM_BLOCKED'));
});
test('third distinct item with same fingerprint opens circuit; all three are FAILED',async t=>{
 const {f,r,v}=await scenario(t,5,()=>bad());assert.equal(v.state,'SYSTEM_BLOCKED');assert.equal(v.counts.FAILED,3);assert.equal(v.counts.PENDING,2);assert.equal(new Set(f.flow.launches).size,3);assert.equal(f.flow.launches.length,3);
 const event=f.round.events(r.id).find(e=>e.kind==='FAILURE_CIRCUIT_OPENED');assert.equal(event.payload.sameFingerprint,3);assert.equal(event.payload.consecutiveFailures,3);
});
test('five consecutive different failures open circuit at fifth, never reselect terminal items',async t=>{
 const words=['alpha','bravo','charlie','delta','echo','foxtrot'];const {f,r,v}=await scenario(t,6,x=>bad(words[x.task.priority-1]));assert.equal(v.state,'SYSTEM_BLOCKED');assert.equal(v.counts.FAILED,5);assert.equal(v.counts.PENDING,1);assert.equal(f.flow.launches.length,5);const e=f.round.events(r.id).find(e=>e.kind==='FAILURE_CIRCUIT_OPENED');assert.equal(e.payload.sameFingerprint,1);assert.equal(e.payload.consecutiveFailures,5);
});
test('a success breaks both consecutive failure streaks',async t=>{
 const {f,v}=await scenario(t,6,x=>[1,2,4,5].includes(x.task.priority)?bad():{state:'VERIFIED'});assert.equal(v.state,'COMPLETED');assert.equal(v.counts.FAILED,4);assert.equal(v.counts.NEW_SUCCESS,2);assert.equal(f.flow.launches.length,6);
});
test('main readiness timeout uses bounded original step retries then final FAILED, other items continue',async t=>{
 const {f,r,v}=await scenario(t,5,x=>x.task.priority===1?bad('主图仍在渲染','SAFE_RETRY_MAIN_IMAGE_STATE'):{state:'VERIFIED'});assert.equal(v.state,'COMPLETED');assert.equal(v.counts.FAILED,1);assert.equal(v.counts.NEW_SUCCESS,4);const x=f.round.items(r.id)[0];assert.equal(x.retry_counts['main-image-3'],2);assert.equal(f.batch.store.item(x.queue_id).attempts,3);assert.equal(f.flow.launches.length,7);assert.equal(f.round.events(r.id).filter(e=>e.kind==='ITEM_FAILURE_FINALIZED').length,1);
});
for(const [reason,code,state,expected] of [['PAUSED_CAPTCHA',undefined,'PAUSED_CAPTCHA','WAITING_HUMAN'],['请人工登录目标店铺',undefined,'PAUSED','WAITING_HUMAN'],['PAGE_LEDGER_PERSISTENCE_FAILED',undefined,'PAUSED','SYSTEM_BLOCKED'],['DETAIL_MATERIAL_FRAME_ORIGIN',undefined,'PAUSED','SYSTEM_BLOCKED'],['数据库损坏','SQLITE_CORRUPT','PAUSED','SYSTEM_BLOCKED']])test('protected gate remains immediate: '+reason,async t=>{
 const {f,v}=await scenario(t,5,()=>({state,reason,code,step:'main-image-3'}));assert.equal(v.state,expected);assert.equal(v.counts.FAILED,0);assert.equal(f.flow.launches.length,1);
});
test('submission result unknown remains immediate and cannot be finalized FAILED',async t=>{
 const {f,v}=await scenario(t,5,()=>({state:'RESULT_UNKNOWN'}));assert.equal(v.state,'RESULT_UNKNOWN');assert.equal(v.counts.RESULT_UNKNOWN,1);assert.equal(v.counts.FAILED,0);assert.equal(f.flow.launches.length,1);assert.equal(f.flow.submits,1);
});
test('failure finalization storage errors still stop coordinator with continueLoop false',async t=>{
 const f=await fixture(t,3);f.setBehavior(()=>bad());const r=await f.create(),finish=f.round.executionAttempts.finish.bind(f.round.executionAttempts),observed=[];
 f.round.executionAttempts.finish=(a,o)=>{observed.push(o.continueLoop);return finish(a,o);};f.round.finalizeFailedItem=()=>{throw Object.assign(Error('write unavailable'),{code:'SQLITE_IOERR'});};f.round.start(r.id);await f.round.pending;
 assert.equal(f.round.view(r.id).state,'SYSTEM_BLOCKED');assert.deepEqual(observed,[false]);assert.equal(f.flow.launches.length,1);assert.equal(f.round.view(r.id).counts.FAILED,0);
});
test('circuit reads durable distinct-item failures across coordinator reconstruction',async t=>{
 const f=await fixture(t,5);f.setBehavior(()=>bad());const r=await f.create();f.round.start(r.id);await f.round.pending;assert.equal(f.round.view(r.id).counts.FAILED,3);
 const recovered=f.make();recovered.resume(r.id);await recovered.pending;assert.equal(recovered.view(r.id).state,'SYSTEM_BLOCKED');assert.equal(recovered.view(r.id).counts.FAILED,4);assert.equal(f.flow.launches.length,4);
});
test('same finalized key does not satisfy three distinct failed items',async t=>{
 const f=await fixture(t,3);f.setBehavior(x=>x.task.priority===1?bad():{state:'VERIFIED'});const r=await f.create(),v=await f.finish(r.id);assert.equal(v.counts.FAILED,1);const x=f.round.items(r.id)[0];
 f.round.finalizeFailedItem(r.id,x,{reason:'repeat audit',failure_stage:'main-image-3'},{fingerprint:'selector disappeared'});f.round.finalizeFailedItem(r.id,x,{reason:'repeat audit',failure_stage:'main-image-3'},{fingerprint:'selector disappeared'});
 assert(!f.round.events(r.id).some(e=>e.kind==='FAILURE_CIRCUIT_OPENED'));
});
for(const reason of ['MAIN_IMAGE_FORM_CHANGED','MAIN_IMAGE_ORIGIN_CHANGED','共享资料原任务快照变化'])test('identity and source invariants remain protected: '+reason,async t=>{
 const {f,v}=await scenario(t,5,()=>bad(reason));assert.equal(v.state,'SYSTEM_BLOCKED');assert.equal(v.counts.FAILED,0);assert.equal(f.flow.launches.length,1);
});
