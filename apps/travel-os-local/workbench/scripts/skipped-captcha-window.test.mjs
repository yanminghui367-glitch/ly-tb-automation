import test from 'node:test';
import assert from 'node:assert/strict';
import {setup} from './skip-independent-fixture.mjs';
async function fixture(t){
 const f=await setup(t);await f.pause();const x=f.round.item(f.r.id,f.scope().key);
 f.store.move(x.run_id,'QUEUED');f.store.move(x.run_id,'RUNNING');f.store.move(x.run_id,'PAUSED_CAPTCHA','PAUSED_CAPTCHA');
 f.round.update(f.r.id,x.key,{state:'WAITING_HUMAN',reason:'PAUSED_CAPTCHA',failure_stage:'existing-listing-query'});
 f.action.skip(f.request());return {...f,key:x.key,runId:x.run_id};
}
test('audited pre-submit CAPTCHA skip permits closing the old window and one bounded successor',async t=>{
 const f=await fixture(t),original=f.store.run(f.runId),events=f.store.events(f.runId),item=f.round.item(f.r.id,f.key),last=f.round.items(f.r.id).at(-1);
 assert.equal(f.round.windows.resolutionRequired(f.w.id),null);f.round.stop();assert.equal(f.round.windows.get(f.w.id).state,'STOPPED');
 assert.equal(f.round.windows.view(f.w.id).counts.MANUAL_SKIPPED,1);
 const next=f.round.windows.create(await f.round.windows.preview(f.r.id,{startPosition:2,limit:1,autoContinue:false}));f.round.start(f.r.id,{windowId:next.id});await f.round.pending;
 assert.equal(f.flow.submits,1);assert.equal(f.round.windows.get(next.id).state,'COMPLETED');assert.equal(f.round.windows.view(next.id).total,1);
 assert.deepEqual(f.store.run(f.runId),original);assert.deepEqual(f.store.events(f.runId),events);assert.deepEqual(f.round.item(f.r.id,f.key),item);assert.deepEqual(f.round.items(f.r.id).at(-1),last);
});
for(const kind of ['SUBMITTING','SUBMIT_CLICKED','SUBMIT_EVIDENCE','RESULT_UNKNOWN','VERIFIED'])test('manual skip never hides original event '+kind,async t=>{
 const f=await fixture(t);f.store.event(f.runId,kind,{});assert(f.round.windows.resolutionRequired(f.w.id));f.round.stop();assert(f.round.windows.open(f.r.id));assert.equal(f.flow.submits,0);
});
for(const [name,patch]of [['id',{itemId:'123'}],['receipt',{successUrl:'https://example.invalid/receipt'}],['reconciliation',{reconciliation:{itemId:'123'}}],['submit stage',{step:'submit-once'}]])test('manual skip never hides checkpoint '+name,async t=>{
 const f=await fixture(t);f.store.checkpoint(f.runId,patch);assert(f.round.windows.resolutionRequired(f.w.id));assert.equal(f.flow.submits,0);
});
for(const patch of [{submitted:1},{submission_uncertain:1},{result:{itemId:'123'}}])test('manual skip never hides item evidence '+JSON.stringify(patch),async t=>{
 const f=await fixture(t);f.round.update(f.r.id,f.key,patch);assert(f.round.windows.resolutionRequired(f.w.id));assert.equal(f.flow.submits,0);
});
test('an unskipped or unaudited CAPTCHA still requires human handling',async t=>{
 const f=await fixture(t);f.round.update(f.r.id,f.key,{state:'WAITING_HUMAN'});assert.equal(f.round.windows.resolutionRequired(f.w.id),'WAITING_HUMAN');
 f.round.update(f.r.id,f.key,{state:'MANUAL_SKIPPED',failure_stage:'content-preflight'});assert.equal(f.round.windows.resolutionRequired(f.w.id),'WAITING_HUMAN');assert.equal(f.flow.submits,0);
});
