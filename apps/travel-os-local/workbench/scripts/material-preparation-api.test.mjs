import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {digest} from '../source-store.mjs';
import {MaterialPreparationApi} from '../material-preparation-api.mjs';
import {createMaterialUploadPreparation} from '../material-upload-preparation.mjs';

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
test('preview expands original assets, deduplicates content, excludes submitted items and does not inspect browser or write tasks',async t=>{
 const f=await fixture(t),before=JSON.stringify(f.rows),p=await f.api.preview(f.input);
 assert.equal(p.view.selectedCount,1);assert.equal(p.view.excludedCount,1);assert.equal(p.view.totalImages,1);assert.equal(p.view.uniqueImages,1);assert.equal(JSON.stringify(f.rows),before);assert.equal(f.uploads(),0);assert(!f.trace.includes('identity'));assert(!JSON.stringify(p.view).includes(f.runtime));
 await assert.rejects(f.api.preview({...f.input,shopId:'other'}));await assert.rejects(f.api.preview({...f.input,endPosition:101}));
});
test('start verifies original plan before identity, persists mappings before dispatch, replays the same request, never claims or publishes',async t=>{
 const f=await fixture(t),before=JSON.stringify(f.rows),p=await f.api.preview(f.input),requestId=randomUUID();let mapped=false;
 const adapter=await f.api.adapter(); // Synthetic only: this test adapter never uses a browser.
 const original=adapter.uploadBatch;adapter.uploadBatch=async options=>{const latest=JSON.parse(await readFile(join(f.api.runtime,'latest.json'),'utf8'));const mapping=JSON.parse(await readFile(join(f.api.runtime,'jobs',latest.id+'.json'),'utf8'));assert.equal(mapping.input.requestId,requestId);mapped=true;return original(options);};
 const input={...f.input,planHash:p.view.planHash,confirmed:true,requestId};const job=await f.api.start(input);await f.api.engine.waitIdle();assert(mapped);assert.equal(f.uploads(),1);assert.equal((await f.api.latest()).state,'COMPLETED');assert.equal(JSON.stringify(f.rows),before);assert.equal(job.executionStarted,false);assert(f.trace.indexOf('files')<f.trace.indexOf('identity'));
 const replay=await f.api.start(input);assert.equal(replay.id,job.id);assert.equal(f.uploads(),1);assert(!JSON.stringify(replay).includes(f.runtime));
 await assert.rejects(f.api.start({...input,planHash:'a'.repeat(64)}),/操作编号/);
});
test('concurrent start locks synchronously and shutdown during deferred source validation settles without dispatch',async t=>{
 const f=await fixture(t),p=await f.api.preview(f.input),hold=deferred(),entered=deferred();f.owner.checkFiles=async()=>{entered.resolve();await hold.promise;};
 const first=f.api.start({...f.input,planHash:p.view.planHash,confirmed:true,requestId:randomUUID()});await entered.promise;
 await assert.rejects(f.api.start({...f.input,planHash:p.view.planHash,confirmed:true,requestId:randomUUID()}),/正在受理/);
 let stopped=false;const shutdown=f.api.shutdown().then(()=>stopped=true);await turn();assert.equal(stopped,false);hold.resolve();await assert.rejects(first,/关闭/);await shutdown;assert.equal(stopped,true);assert.equal(f.api.closing,true);assert.equal(f.uploads(),0);
});
test('delayed concurrent engine initialization returns one shared instance',async t=>{
 const hold=deferred();let factories=0;const marker={active:false};const f=await fixture(t,{factory:async()=>{factories++;await hold.promise;return marker;}});
 const a=f.api.getEngine(),b=f.api.getEngine();await turn();assert.equal(factories,1);hold.resolve();assert.equal(await a,marker);assert.equal(await b,marker);
});
test('paused upload retains the global busy lock until its dispatched batch is sealed, then cancels without starting products',async t=>{
 const hold=deferred(),entered=deferred();const f=await fixture(t,{adapter:{uploadBatch:async({files,onDispatch,onReceipt})=>{await onDispatch();entered.resolve();await hold.promise;const result=files.map(f=>({name:f.name,status:'SUCCEEDED',url:'https://img.alicdn.com/fixture/'+f.sha256+'.png'}));for(const r of result)await onReceipt(r);return result;},lookupBatch:async()=>[]}});
 const p=await f.api.preview(f.input),job=await f.api.start({...f.input,planHash:p.view.planHash,confirmed:true,requestId:randomUUID()});await entered.promise;
 const paused=await f.api.control('pause',{shopId:f.owner.shop.id,jobId:job.id,planHash:p.view.planHash,requestId:randomUUID()});assert.equal(paused.active,true);assert.equal(f.api.active,true);
 await assert.rejects(f.api.preview(f.input));hold.resolve();await f.api.engine.waitIdle();assert.equal(f.api.active,false);
 await assert.rejects(f.api.control('resume',{shopId:'foreign',jobId:job.id,planHash:p.view.planHash,requestId:randomUUID()}));
});
test('read-only restart projection marks old uploading as unknown and does not resume or mutate the durable job',async t=>{
 const f=await fixture(t);const job={id:'b'.repeat(32),shopId:f.owner.shop.id,state:'RUNNING',files:[{name:'待确认.png',path:'C:/private/file.png',sha256:'a'.repeat(64),aliases:[{path:'C:/private/file.png'}],state:'UPLOADING'}]};
 const before=JSON.stringify(job),view=f.api.public(job);assert.equal(view.state,'ATTENTION_REQUIRED');assert.equal(view.counts.UPLOAD_UNKNOWN,1);assert.equal(view.active,false);assert.equal(JSON.stringify(job),before);assert(!JSON.stringify(view).includes('private'));assert.equal(f.uploads(),0);
});
test('cross-shop preparation blocks preview before any source or browser action',async t=>{
 const f=await fixture(t);f.owner.materialPreparationOtherBusy=()=>true;await assert.rejects(f.api.preview(f.input),/尚未结束/);assert.equal(f.checks(),0);assert.deepEqual(f.trace,[]);
});
test('failed controller mapping prevents dispatch and replay repairs only metadata without running the surviving job',async t=>{
 const f=await fixture(t),p=await f.api.preview(f.input),input={...f.input,planHash:p.view.planHash,confirmed:true,requestId:randomUUID()};
 await mkdir(f.api.runtime,{recursive:true});const blocker=join(f.api.runtime,'jobs');await writeFile(blocker,'fixture prevents job directory');
 await assert.rejects(f.api.start(input));assert.equal(f.uploads(),0);assert.equal(f.api.active,false);
 await rm(blocker);const repaired=await f.api.start(input);assert.equal(repaired.state,'PAUSED');assert.equal(f.uploads(),0);assert.equal((await f.api.latest()).id,repaired.id);
});
test('unresolved original job stays discoverable even if a newer pointer exists and blocks creating another preparation',async t=>{
 const unknown={id:'c'.repeat(32),shopId:'shop-fixture',state:'ATTENTION_REQUIRED',files:[{name:'主图.png',sha256:'a'.repeat(64),state:'UPLOAD_UNKNOWN'}]},newer={id:'d'.repeat(32),shopId:'shop-fixture',state:'COMPLETED',files:[]};let attention=null;
 const f=await fixture(t,{factory:async()=>({active:false,attention:async()=>attention,view:async id=>id===unknown.id?unknown:newer})}),p=await f.api.preview(f.input);
 await mkdir(join(f.api.runtime,'jobs'),{recursive:true});await writeFile(join(f.api.runtime,'latest.json'),JSON.stringify({id:newer.id}));
 for(const job of [unknown,newer])await writeFile(join(f.api.runtime,'jobs',job.id+'.json'),JSON.stringify({input:{...f.input,planHash:p.view.planHash,requestId:randomUUID()}}));
 attention=unknown;assert.equal((await f.api.latest()).id,unknown.id);assert.equal((await f.api.latest()).counts.UPLOAD_UNKNOWN,1);
 await assert.rejects(f.api.preview(f.input),/未确认/);await assert.rejects(f.api.start({...f.input,planHash:p.view.planHash,confirmed:true,requestId:randomUUID()}),/未确认/);assert.equal(f.uploads(),0);
});
test('revision drift with UNKNOWN plus PENDING has a lookup-only exit, preserves remaining files and supports cancel then fresh preview',async t=>{
 let uploads=0,lookups=0;const adapter={uploadBatch:async({onDispatch})=>{uploads++;await onDispatch();throw Error('模拟上传后回执中断');},lookupBatch:async({files,guard})=>{lookups++;await guard();return files.map(f=>({name:f.name,status:'SUCCEEDED',url:'https://img.alicdn.com/fixture/'+f.sha256+'.png'}));}};
 const f=await fixture(t,{adapter,factory:options=>createMaterialUploadPreparation({...options,batchSize:1})});
 const path=join(f.runtime,'第二图片.png'),bytes=Buffer.from('second synthetic image');await writeFile(path,bytes);f.rows[0].task.assets.secondary=[{path,sha256:digest(bytes)}];f.rows[0].task_hash=digest(f.rows[0].task);
 const plan=await f.api.preview(f.input),job=await f.api.start({...f.input,planHash:plan.view.planHash,confirmed:true,requestId:randomUUID()});await f.api.engine.waitIdle();let current=await f.api.latest();assert.equal(current.counts.UPLOAD_UNKNOWN,1);assert.equal(current.counts.PENDING,1);
 f.rows[0].reason='只改变原暂停说明';const before=JSON.stringify(f.rows),resumeId=randomUUID();
 await assert.rejects(f.api.control('resume',{shopId:f.owner.shop.id,jobId:job.id,planHash:plan.view.planHash,requestId:resumeId}),/变化/);
 const recheckId=randomUUID(),input={shopId:f.owner.shop.id,jobId:job.id,planHash:plan.view.planHash,requestId:recheckId};current=await f.api.control('recheck',input);
 assert.equal(current.counts.UPLOAD_UNKNOWN,0);assert.equal(current.counts.SUCCEEDED,1);assert.equal(current.counts.PENDING,1);assert.equal(current.scopeCurrent,false);assert.equal(uploads,1);assert.equal(lookups,1);assert.equal(JSON.stringify(f.rows),before);
 await f.api.control('recheck',input);assert.equal(lookups,1,'same recheck ID never repeats lookup');
 await assert.rejects(f.api.control('resume',{...input,requestId:randomUUID()}),/变化/);assert.equal(uploads,1);
 current=await f.api.control('cancel',{...input,requestId:randomUUID()});assert.equal(current.state,'CANCELLED');assert.equal(current.counts.PENDING,1);assert.equal((await f.api.preview(f.input)).view.selectedCount,1);assert.equal(uploads,1);assert.equal(JSON.stringify(f.rows),before);
});
test('preview excludes one missing image and continues the other original eligible product without mutating tasks',async t=>{
 const f=await fixture(t);f.rows[1].state='PENDING';f.rows[1].submitted=false;
 const missing={path:join(f.runtime,'缺失主图.png'),sha256:f.asset.sha256};f.rows[0].task.assets.main=[missing];f.rows[0].task.assets.details=[missing];f.rows[0].task_hash=digest(f.rows[0].task);
 const before=JSON.stringify(f.rows),result=await f.api.preview(f.input);
 assert.equal(result.view.selectedCount,1);assert.equal(result.view.excludedCount,1);assert.equal(result.view.items[0].position,2);assert.equal(result.view.excluded[0].position,1);assert.equal(result.view.excluded[0].destination,'测试国家');assert.match(result.view.excluded[0].reason,/文件或其所在文件夹不存在：缺失主图\.png/);assert.equal(result.view.images.length,1);assert.equal(JSON.stringify(f.rows),before);assert.equal(f.uploads(),0);assert(!JSON.stringify(result.view).includes(f.runtime));
});
test('all missing original files return per-product Chinese details and cannot create an upload job',async t=>{
 const f=await fixture(t);f.rows[1].state='PENDING';f.rows[1].submitted=false;await rm(f.asset.path);const before=JSON.stringify(f.rows),result=await f.api.preview(f.input);
 assert.equal(result.view.selectedCount,0);assert.equal(result.view.totalImages,0);assert.deepEqual(result.view.excluded.map(x=>x.position),[1,2]);assert(result.view.excluded.every(x=>/原图片\.png/.test(x.reason)&&/不存在/.test(x.reason)));assert.equal(result.scope.items.length,0);assert.equal(await f.api.engine.latest(),null);
 await assert.rejects(f.api.start({...f.input,planHash:result.view.planHash,confirmed:true,requestId:randomUUID()}),/没有可准备/);assert.equal(await f.api.engine.latest(),null);assert.equal(f.uploads(),0);assert.equal(JSON.stringify(f.rows),before);
});
test('missing original workbook is identified by basename as an excluded local resource',async t=>{
 const f=await fixture(t);f.rows[0].task.source={workbook:join(f.runtime,'缺失商品清单.xlsx'),sha256:'a'.repeat(64)};f.rows[0].task_hash=digest(f.rows[0].task);
 const result=await f.api.preview(f.input);assert.equal(result.view.selectedCount,0);assert.match(result.view.excluded.find(x=>x.position===1).reason,/不存在：缺失商品清单\.xlsx/);assert.equal(f.uploads(),0);
});
test('bare database and category assertions are still thrown rather than treated as local missing assets',async t=>{
 const f=await fixture(t),databaseError=Object.assign(Error('database read failed'),{code:'SQLITE_ERROR'});f.owner.checkFiles=async()=>{throw databaseError;};await assert.rejects(f.api.preview(f.input),error=>error===databaseError);
 const assertion=Object.assign(Error('UNVERIFIED_CATEGORY'),{code:'ERR_ASSERTION'});f.owner.checkFiles=async()=>{throw assertion;};await assert.rejects(f.api.preview(f.input),error=>error===assertion);assert.equal(f.uploads(),0);
});
test('profile configuration errors remain blocking while explicit asset SHA differences are locally excluded',async t=>{
 const f=await fixture(t);await writeFile(join(f.runtime,'execution-profile.json'),JSON.stringify({version:1,shopId:'wrong-shop'}));await assert.rejects(f.api.preview(f.input),/FORM_EXECUTION_PROFILE_INVALID/);
 await rm(join(f.runtime,'execution-profile.json'));await writeFile(f.asset.path,'changed synthetic image');const result=await f.api.preview(f.input);assert.equal(result.view.selectedCount,0);assert.match(result.view.excluded.find(x=>x.position===1).reason,/内容与原快照.*原图片\.png/);assert.equal(f.uploads(),0);
});
test('missing generated image named in a valid profile is excluded precisely, without treating arbitrary profile paths as local assets',async t=>{
 const f=await fixture(t);f.rows[0].task.business.freight_template='模板甲';f.rows[0].task_hash=digest(f.rows[0].task);await mkdir(join(f.runtime,'detail-image-padding'));
 const profile={version:1,shopId:f.owner.shop.id,confirmedBy:'用户',confirmedAt:new Date().toISOString(),source:'synthetic fixture',freightTemplate:{from:'模板甲',to:'模板乙'},detailImagePadding:[{sourcePath:f.asset.path,sourceSha256:f.asset.sha256,relativePath:'detail-image-padding/missing.png',sha256:'a'.repeat(64),dimensions:[10,30],left:1,right:1}]};
 await writeFile(join(f.runtime,'execution-profile.json'),JSON.stringify(profile));const result=await f.api.preview(f.input);assert.equal(result.view.selectedCount,0);assert.match(result.view.excluded.find(x=>x.position===1).reason,/不存在：missing\.png/);
 profile.detailImagePadding[0].relativePath='../outside.png';await writeFile(join(f.runtime,'execution-profile.json'),JSON.stringify(profile));await assert.rejects(f.api.preview(f.input),/FORM_DETAIL_PADDING_INVALID/);assert.equal(f.uploads(),0);
});
