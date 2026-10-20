// Independent Step 1 QA: synthetic locator/guard contracts only, no browser or business database.
import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {waitMaterialReadiness,waitDetailThumbnail} from '../dev/workbench/publishing-materials.mjs';
import {classifyRoundFailure} from '../dev/workbench/listing-round.mjs';

test('readiness cannot accept an observation that completed after its declared deadline',async()=>{
  const diagnostics=[];
  await assert.rejects(waitMaterialReadiness('thumbnail',async()=>{await delay(70);return {ready:true,actual:{decoded:true}};},async()=>{},
    {timeout:20,selector:'synthetic',expected:'ready before deadline',onDiagnostic:async d=>diagnostics.push(d)}),
    e=>!e.code&&e.materialReadiness?.stage==='thumbnail'&&classifyRoundFailure(e).kind==='SYSTEM');
  assert.equal(diagnostics.at(-1).status,'failed');
});

test('guard sentinel is propagated by identity and observation is not called',async()=>{
  const guardError=Error('PAUSED_CAPTCHA');let observed=0,diagnostic;
  await assert.rejects(waitMaterialReadiness('upload-entry',async()=>{observed++;return {ready:true};},async()=>{throw guardError;},
    {timeout:50,selector:'synthetic',expected:'entry',onDiagnostic:async d=>{diagnostic=d;}}),e=>e===guardError);
  assert.equal(observed,0);assert.equal(diagnostic.status,'failed');assert.equal(classifyRoundFailure(guardError).kind,'HUMAN');
});

test('diagnostic persistence error never overwrites the original SYSTEM timeout',async()=>{
  await assert.rejects(waitMaterialReadiness('upload-receipt',async()=>({ready:false,actual:{singleSuccess:false}}),async()=>{},
    {timeout:20,selector:'synthetic',expected:'single receipt',onDiagnostic:async()=>{throw Error('synthetic disk error');}}),
    e=>!e.code&&e.materialReadiness?.stage==='upload-receipt'&&e.materialReadiness.actual.singleSuccess===false&&classifyRoundFailure(e).kind==='SYSTEM');
});

const thumbnail=(state)=>{
  const element={complete:true,naturalWidth:80,naturalHeight:50,currentSrc:'https://fixture.invalid/image.png',getAttribute:()=>null,...state};
  const image={count:async()=>1,isVisible:async()=>true,evaluateAll:async fn=>fn([element])};
  return {count:async()=>1,isVisible:async()=>true,locator:()=>image,evaluateAll:async()=>null};
};

test('visible complete img with zero decoded width or height is rejected',async()=>{
  for(const state of [{naturalWidth:0},{naturalHeight:0},{complete:false},{currentSrc:'',getAttribute:()=>null}]){
    await assert.rejects(waitDetailThumbnail(thumbnail(state),async()=>{},{timeout:20}),
      e=>!e.code&&e.materialReadiness?.stage==='thumbnail'&&classifyRoundFailure(e).kind==='SYSTEM');
  }
});

test('visible decoded thumbnail passes without clicking or upload methods',async()=>{
  let diagnostic;const state=await waitDetailThumbnail(thumbnail({}),async()=>{}, {timeout:100,onDiagnostic:async d=>{diagnostic=d;}});
  assert.equal(state.naturalWidth,80);assert.equal(state.complete,true);assert.equal(diagnostic.status,'ready');
});
