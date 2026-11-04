import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {createMaterialUploadPreparation,readPreparedMaterialReceipt} from '../material-upload-preparation.mjs';
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const turn=()=>new Promise(r=>setImmediate(r));
async function fixture(t,adapter,guard=async()=>{},options={}){
 const runtime=await mkdtemp(join(tmpdir(),'material-independent-')),file=join(runtime,'source.png'),bytes=Buffer.from('synthetic-upload-file');await writeFile(file,bytes);
 t.after(()=>rm(runtime,{recursive:true,force:true}));
 const item={path:file,sha256:createHash('sha256').update(bytes).digest('hex')};
 const engine=await createMaterialUploadPreparation({runtime,shopId:'shop-independent',shopName:'独立测试店',adapter,guard,...options});return {engine,item,runtime};
}
const finish=async ({files,onDispatch,onReceipt})=>{await onDispatch();const rows=files.map(f=>({name:f.name,status:'SUCCEEDED',url:'https://img.alicdn.com/'+f.sha256+'.png'}));for(const row of rows)await onReceipt(row);return rows;};
test('independent: two concurrent prepare requests cannot create two running jobs',async t=>{
 const release=deferred(),entered=deferred();let visits=0;
 const {engine,item}=await fixture(t,{uploadBatch:finish},async()=>{if(++visits===1)entered.resolve();await release.promise;});
 const first=engine.prepare({requestId:'concurrent-first',items:[item]});await entered.promise;
 const second=engine.prepare({requestId:'concurrent-second',items:[item]}),both=Promise.allSettled([first,second]);for(let i=0;i<5;i++)await turn();release.resolve();
 const outcomes=await both;await engine.waitIdle();
 assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1,'only one request may own a new job');
 assert.match(outcomes.find(x=>x.status==='rejected').reason.code,/BUSY/);
});
test('independent: cancellation before dispatch cannot begin upload or produce success',async t=>{
 const arrived=deferred(),release=deferred();let uploads=0;
 const {engine,item}=await fixture(t,{uploadBatch:async options=>{arrived.resolve();await release.promise;await options.onDispatch();uploads++;const rows=options.files.map(f=>({name:f.name,status:'SUCCEEDED',url:'https://img.alicdn.com/'+f.sha256+'.png'}));for(const row of rows)await options.onReceipt(row);return rows;}});
 const job=await engine.prepare({requestId:'cancel-before-dispatch',items:[item]});await arrived.promise;
 await engine.cancel(job.id);release.resolve();await engine.waitIdle();const after=await engine.view(job.id);
 assert.equal(uploads,0);assert.equal(after.state,'CANCELLED');assert(after.files.every(f=>f.state==='PENDING'),'unsubmitted files remain pending rather than failed/unknown');
});
test('independent: unknown dispatched upload survives restart and never automatically retransmits',async t=>{
 let uploads=0;const {engine,item}=await fixture(t,{uploadBatch:async options=>{await options.onDispatch();uploads++;throw Error('synthetic receipt lost');}});
 const first=await engine.prepare({requestId:'unknown-first',items:[item]});await engine.waitIdle();assert.equal((await engine.view(first.id)).state,'ATTENTION_REQUIRED');
 await engine.resume({jobId:first.id,requestId:'unknown-resume'});await engine.waitIdle();const after=await engine.view(first.id);
 assert.equal(uploads,1);assert.equal(after.files[0].state,'UPLOAD_UNKNOWN');assert.equal(after.state,'ATTENTION_REQUIRED');
});
test('independent: mapping registration failure prevents dispatch and leaves a paused durable job',async t=>{
 let uploads=0;const {engine,item}=await fixture(t,{uploadBatch:async options=>{uploads++;return finish(options);}},async()=>{},{onJobCreated:async()=>{throw Error('synthetic mapping disk failure');}});
 await assert.rejects(engine.prepare({requestId:'mapping-failure',items:[item]}),/mapping disk failure/);await engine.waitIdle();
 assert.equal(uploads,0);const job=await engine.latest();assert.equal(job.state,'PAUSED');assert.equal(job.files[0].state,'PENDING');
});
test('independent: concurrent resumes reserve one uploader before asynchronous work',{timeout:5000},async t=>{
 let uploads=0;const gate=deferred();let hold=false;const entered=deferred();
 const {engine,item}=await fixture(t,{lookupBatch:async()=>[],uploadBatch:async options=>{await options.onDispatch();uploads++;throw Error('synthetic retryable receipt lost');}},async()=>{if(hold){entered.resolve();await gate.promise;}});
 const first=await engine.prepare({requestId:'resume-base',items:[item]});await engine.waitIdle();hold=true;
 const a=engine.resume({jobId:first.id,requestId:'resume-a'});await entered.promise;const b=engine.resume({jobId:first.id,requestId:'resume-b'}),both=Promise.allSettled([a,b]);gate.resolve();
 const results=await both;await engine.waitIdle();assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal(uploads,1);
});
test('independent: restart plus new request cannot retransmit a prior unknown content hash',async t=>{
 let uploads=0;const adapter={lookupBatch:async()=>[],uploadBatch:async options=>{await options.onDispatch();uploads++;throw Error('synthetic lost acknowledgement');}};
 const {engine,item,runtime}=await fixture(t,adapter);await engine.prepare({requestId:'unknown-job-one',items:[item]});await engine.waitIdle();
 const restarted=await createMaterialUploadPreparation({runtime,shopId:'shop-independent',shopName:'独立测试店',adapter});
 let next;try{next=await restarted.prepare({requestId:'new-request-same-unknown-hash',items:[item]});}catch(error){assert.match(error.code||error.message,/UNKNOWN|UNCONFIRMED|UNRESOLVED|BLOCKED|未确认|核对/);}
 await restarted.waitIdle();assert.equal(uploads,1,'new request must not cause another file dispatch');if(next)assert.notEqual((await restarted.view(next.id)).state,'COMPLETED');
 const otherShop=await createMaterialUploadPreparation({runtime,shopId:'other-shop',shopName:'其他店',adapter:{uploadBatch:finish}});const other=await otherShop.prepare({requestId:'independent-other-shop',items:[item]});await otherShop.waitIdle();assert.equal((await otherShop.view(other.id)).state,'COMPLETED');
});
test('independent: prepared receipt binds full content hash and original aliases, never another shop or changed bytes',async t=>{
 const {engine,item,runtime}=await fixture(t,{uploadBatch:finish});const before=JSON.stringify(item);
 await engine.prepare({requestId:'hash-bound-receipt',items:[item]});await engine.waitIdle();assert.equal(JSON.stringify(item),before);
 const receipt=await readPreparedMaterialReceipt({runtime,shopId:'shop-independent',asset:item});assert.equal(receipt.sha256,item.sha256);assert(receipt.uploadName.includes(item.sha256));assert(receipt.aliases.some(a=>a.path===item.path));
 assert.equal(await readPreparedMaterialReceipt({runtime,shopId:'other-shop',asset:item}),null);
 await writeFile(item.path,'same-name-different-bytes');await assert.rejects(readPreparedMaterialReceipt({runtime,shopId:'shop-independent',asset:item}),error=>error.code==='SOURCE_OR_ASSET_CHANGED');
});
test('independent: unresolved prepared upload cannot silently fall back to legacy single-image upload',async t=>{
 const {preparedMaterialAsset}=await import('../taobao-publisher.mjs');
 const {engine,item,runtime}=await fixture(t,{uploadBatch:async options=>{await options.onDispatch();throw Error('synthetic missing acknowledgement');}});
 await engine.prepare({requestId:'publisher-unknown-protection',items:[item]});await engine.waitIdle();
 const blocked=error=>/UNRESOLVED|UNKNOWN|UNCONFIRMED/.test(error.code||error.message);
 await assert.rejects(readPreparedMaterialReceipt({runtime,shopId:'shop-independent',asset:item}),blocked);
 await assert.rejects(preparedMaterialAsset(item,'shop-independent',runtime),blocked);
 assert.equal(await readPreparedMaterialReceipt({runtime,shopId:'never-prepared-shop',asset:item}),null,'unprepared shops retain the original supported path');
});
