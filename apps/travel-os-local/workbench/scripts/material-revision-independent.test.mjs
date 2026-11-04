import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {digest} from '../source-store.mjs';
import {MaterialPreparationApi} from '../material-preparation-api.mjs';

const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const turn=()=>new Promise(r=>setImmediate(r));
async function fixture(t,{adapter,factory}={}){
 const runtime=await mkdtemp(join(tmpdir(),'material-api-'));t.after(()=>rm(runtime,{recursive:true,force:true}));const db=new DatabaseSync(':memory:');t.after(()=>db.close());
 const bytes=Buffer.from('synthetic image bytes'),path=join(runtime,'原图片.png');await writeFile(path,bytes);const asset={path,sha256:digest(bytes)};
 const task={shopId:'shop-fixture',listing:{type:'country',country:'测试国家',title:'测试原商品'},business:{shop_name:'测试店'},assets:{main:[asset],secondary:[],details:[asset]}};
 const rows=[{key:'item-a',position:1,task,task_hash:digest(task),state:'PENDING',submitted:false,submission_uncertain:false},{key:'item-b',position:2,task:structuredClone(task),task_hash:digest(task),state:'RESULT_UNKNOWN',submitted:true}];
 const round={id:randomUUID(),shop:'shop-fixture',manifest_hash:'manifest-original'};let uploads=0,checks=0;const trace=[];
 const owner={runtime,shop:{id:'shop-fixture',name:'测试店'},batch:{active:null},source:{runtime,active:null,store:{db,run:()=>null,events:()=>[]}},integrity:async()=>{trace.push('kernel');return {ok:true};},checkFiles:async()=>{checks++;trace.push('files');},owner:{status:async()=>{trace.push('identity');return {running:true,loggedIn:true,loginState:'LOGGED_IN'};}},round:{assertIdle(){},assertManifest:id=>{assert.equal(id,round.id);return round;},items:()=>rows,creating:false,hasUnsettledExecution:()=>false,selections:{revision:()=>digest(rows)},windows:{get:()=>null,entries:()=>[]}}};
 const upload=adapter||{uploadBatch:async({files,guard,onDispatch,onReceipt})=>{await guard();uploads++;await onDispatch();const receipts=[];for(const f of files){const result={name:f.name,status:'SUCCEEDED',url:'https://img.alicdn.com/fixture/'+f.sha256+'.png'};await onReceipt(result);receipts.push(result);}return receipts;},lookupBatch:async()=>[]};
 const api=new MaterialPreparationApi(owner,{adapterFactory:()=>upload,...(factory?{factory}:{})});owner.materialPreparation=api;
 const input={shopId:owner.shop.id,roundId:round.id,startPosition:1,endPosition:2};
 return {api,owner,rows,task,asset,round,input,runtime,trace,uploads:()=>uploads,checks:()=>checks};
}

for(const found of [true,false])test('independent: revision drift permits only original upload recheck, found='+found,async t=>{
 let lookups=0,uploads=0;const f=await fixture(t,{adapter:{uploadBatch:async({onDispatch})=>{await onDispatch();uploads++;throw Error('synthetic upload acknowledgement lost');},lookupBatch:async({files})=>{lookups++;return found?files.map(file=>({name:file.name,status:'SUCCEEDED',url:'https://img.alicdn.com/original/'+file.sha256+'.png'})):[];}}});
 const p=await f.api.preview(f.input),job=await f.api.start({...f.input,planHash:p.view.planHash,confirmed:true,requestId:randomUUID()});await f.api.engine.waitIdle();
 f.rows[0].reason='later product action advanced round revision';const before=JSON.stringify(f.rows),requestId=randomUUID();
 await assert.rejects(f.api.control('resume',{shopId:f.owner.shop.id,jobId:job.id,planHash:p.view.planHash,requestId:randomUUID()}),/原商品或图片已变化/);
 const input={shopId:f.owner.shop.id,jobId:job.id,planHash:p.view.planHash,requestId};const result=await f.api.control('recheck',input);await f.api.engine.waitIdle();const after=await f.api.latest();
 assert.equal(uploads,1,'only the original upload was dispatched');assert.equal(lookups,1);assert.equal(JSON.stringify(f.rows),before,'original product/task state is untouched');assert.equal(result.executionStarted,false);assert.equal(after.counts.UPLOAD_UNKNOWN,found?0:1);assert.equal(after.counts.SUCCEEDED,found?1:0);
 if(!found)assert.equal(after.state,'ATTENTION_REQUIRED');
 await f.api.control('recheck',input);assert.equal(lookups,1,'same recheck request is idempotent');assert.equal(uploads,1);
});
test('independent: drifted UNKNOWN plus pending files can be checked, cancelled and freshly previewed without uploading again',async t=>{
 const {createMaterialUploadPreparation}=await import('../material-upload-preparation.mjs');let uploads=0;
 const f=await fixture(t,{factory:options=>createMaterialUploadPreparation({...options,batchSize:1}),adapter:{uploadBatch:async({onDispatch})=>{await onDispatch();uploads++;throw Error('synthetic first-batch acknowledgement lost');},lookupBatch:async({files})=>files.map(file=>({name:file.name,status:'SUCCEEDED',url:'https://img.alicdn.com/original/'+file.sha256+'.png'}))}});
 const secondPath=join(f.runtime,'second-source.png'),secondBytes=Buffer.from('different second image');await writeFile(secondPath,secondBytes);f.task.assets.details=[{path:secondPath,sha256:digest(secondBytes)}];f.rows[0].task_hash=digest(f.task);
 const plan=await f.api.preview(f.input),job=await f.api.start({...f.input,planHash:plan.view.planHash,confirmed:true,requestId:randomUUID()});await f.api.engine.waitIdle();assert.equal((await f.api.latest()).counts.UPLOAD_UNKNOWN,1);assert.equal((await f.api.latest()).counts.PENDING,1);
 f.rows[0].reason='later product handling changed the round revision';const original=JSON.stringify(f.rows);
 const checked=await f.api.control('recheck',{shopId:f.owner.shop.id,jobId:job.id,planHash:plan.view.planHash,requestId:randomUUID()});assert.equal(checked.counts.UPLOAD_UNKNOWN,0);assert.equal(checked.counts.PENDING,1);assert.equal(checked.scopeCurrent,false);
 const cancelled=await f.api.control('cancel',{shopId:f.owner.shop.id,jobId:job.id,planHash:plan.view.planHash,requestId:randomUUID()});assert.equal(cancelled.state,'CANCELLED');assert.equal(cancelled.counts.PENDING,1);
 const fresh=await f.api.preview(f.input);assert.equal(fresh.view.selectedCount,1);assert.notEqual(fresh.view.planHash,plan.view.planHash);assert.equal(uploads,1);assert.equal(JSON.stringify(f.rows),original);
});
