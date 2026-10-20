import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './continuous-round-fixture.mjs';
import {classifyRoundFailure} from '../listing-round.mjs';
const cases=[['SAFE_RETRY_DETAIL_FRAME_ORIGIN','open-details'],['SAFE_RETRY_DETAIL_FRAME_ORIGIN','open-new-form'],['SAFE_RETRY_DETAIL_PANEL','open-new-form'],['SAFE_RETRY_MAIN_FRAME_ORIGIN','main-image-1'],['SAFE_RETRY_MAIN_PANEL','main-image-3']];
for(const [code,step] of cases){
 test(`${code} at ${step}: bounded recovery ends only bad item`,async t=>{
  const f=await fixture(t,5);f.setBehavior(r=>r.task.priority===1?{state:'PAUSED',code,reason:code,step}:{state:'VERIFIED'});
  const r=await f.create(),v=await f.finish(r.id);
  assert.equal(v.state,'COMPLETED');assert.equal(v.counts.FAILED,1);assert.equal(v.counts.NEW_SUCCESS,4);assert.equal(f.flow.submits,4);
  assert.equal(v.items[0].attempts,3);assert.equal(f.flow.launches.filter(id=>id===v.items[0].runId).length,3);
  assert(f.round.events(r.id).some(e=>e.kind==='SAFE_STEP_RECOVERY_EXHAUSTED'));
 });
 test(`${code}: gates override retry`,()=>{
  const error={code,message:code};
  for(const state of ['SUBMITTING','RESULT_UNKNOWN'])assert.equal(classifyRoundFailure(error,{run:{state,checkpoint:{step}}}).kind,'UNKNOWN');
  assert.equal(classifyRoundFailure(error,{run:{state:'PAUSED_CAPTCHA',checkpoint:{step}}}).kind,'HUMAN');
  for(const checkpoint of [{step:'submit-once'},{step,itemId:'123456789'},{step,reconciliation:{}}])assert.equal(classifyRoundFailure(error,{run:{state:'PAUSED',checkpoint}}).kind,'SYSTEM');
  assert.equal(classifyRoundFailure({...error,message:'PINNED_PAGE'},{run:{state:'PAUSED',checkpoint:{step}}}).kind,'SYSTEM');
 });
}
test('changed and ambiguous remain raw SYSTEM',()=>{
 for(const type of ['MAIN','DETAIL'])for(const tail of ['CHANGED','AMBIGUOUS'])assert.equal(classifyRoundFailure(Error(`${type}_MATERIAL_FRAME_${tail}`),{run:{state:'PAUSED',checkpoint:{step:'open-details'}}}).kind,'SYSTEM');
});
test('lost bound refill page is protected and never loops to another page',async t=>{
 const f=await fixture(t,5);f.setBehavior(()=>({state:'PAUSED',reason:'RESIDUAL_REFILL_PAGE_UNAVAILABLE',step:'open-new-form'}));
 const r=await f.create();f.round.start(r.id);await f.round.pending;const v=f.round.view(r.id);
 assert.equal(v.state,'SYSTEM_BLOCKED');assert.equal(f.flow.launches.length,1);assert.equal(f.flow.submits,0);assert.equal(v.counts.PENDING,5);
});
