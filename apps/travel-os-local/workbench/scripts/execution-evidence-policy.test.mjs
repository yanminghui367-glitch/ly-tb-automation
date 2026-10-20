import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {evidenceDecision,evidenceMode,captureStepEvidence} from '../execution-evidence-policy.mjs';
const png=Buffer.from([137,80,78,71,13,10,26,10,0]);
async function fixture(t){const dir=await realpath(await mkdtemp(join(tmpdir(),'travel-evidence-policy-')));t.after(async()=>{assert.equal(dirname(dir),await realpath(tmpdir()));await rm(dir,{recursive:true,force:true});});return dir;}

test('normal source workflow keeps eight key node screenshots and preserves structured-only decisions',()=>{
 const stages=['open-new-form',...Array.from({length:5},(_,i)=>'main-image-'+(i+1)),'close-main-image-menu','title','guide-title','price','inventory','brand','custom-service','listing-state','shipping-time','logistics','freight-template','shipping-region','single-origin','ship-from','procurement','region-restriction',...['pattern','subject','style','people','size'].map(k=>'attribute-'+k),'open-details',...Array.from({length:9},(_,i)=>'select-detail-'+(i+1)),'insert-details','pre-submit-review','submit-once','verify-platform-result'];
 assert.equal(stages.length,41);const requested=stages.filter(s=>evidenceDecision(s).screenshotRequested);assert.deepEqual(requested,['open-new-form','close-main-image-menu','freight-template','attribute-size','insert-details','pre-submit-review','submit-once','verify-platform-result']);
 for(const s of stages.filter(s=>!requested.includes(s))){const d=evidenceDecision(s);assert.equal(d.evidenceReason,'STRUCTURED_LOG');assert.equal(d.evidenceMode,'key');}
});
test('errors, recovery, full diagnostic and unknown future steps always request fresh evidence',()=>{
 for(const name of ['title','inventory','select-detail-50','main-image-1']){assert(evidenceDecision(name,{failed:true}).screenshotRequested);assert(evidenceDecision(name,{recovery:true}).screenshotRequested);assert(evidenceDecision(name,{mode:'full'}).screenshotRequested);}
 for(const name of ['future-new-field','main-image-6','select-detail-51','',null])assert(evidenceDecision(name).screenshotRequested);
 for(const mode of ['off','none',false,'KEY',null]){assert.equal(evidenceMode(mode),'full');assert(evidenceDecision('title',{mode}).screenshotRequested);}
});
test('routine successful stages do not invoke the screenshot API or advertise an earlier image',async t=>{
 const dir=await fixture(t);let calls=0;const result=await captureStepEvidence({screenshot:async()=>calls++},dir,'title');assert.equal(calls,0);assert.equal(result.screenshotRequested,false);assert.equal(result.screenshot,null);assert.equal(result.screenshotAt,null);assert.equal(result.screenshotError,null);
});
test('critical and failed stages create unique complete evidence files and never replace original files',async t=>{
 const dir=await fixture(t),page={screenshot:({path})=>writeFile(path,png)},first=await captureStepEvidence(page,dir,'title',{failed:true}),second=await captureStepEvidence(page,dir,'title',{recovery:true});
 assert(first.screenshotRequested);assert.equal(first.evidenceReason,'STEP_FAILED');assert.equal(second.evidenceReason,'RECOVERY_BOUNDARY');assert.notEqual(first.screenshot,second.screenshot);assert.deepEqual(await readFile(first.screenshot),png);assert.deepEqual(await readFile(second.screenshot),png);
});
test('failed capture is an explicit evidence error and never advertises a stale path',async t=>{
 const dir=await fixture(t);for(const page of [null,{screenshot:async()=>{throw Error('CAPTURE_UNAVAILABLE');}},{screenshot:({path})=>writeFile(path,'truncated')}]){const result=await captureStepEvidence(page,dir,'submit-once');assert(result.screenshotRequested);assert.equal(result.screenshot,null);assert(result.screenshotError);assert(result.screenshotAt);}
});
