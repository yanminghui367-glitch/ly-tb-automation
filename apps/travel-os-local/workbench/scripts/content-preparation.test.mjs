import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {SourceStore,digest} from '../source-store.mjs';
import {SourceWorkflow} from '../source-workflow.mjs';
import {BatchWorkflow} from '../batch-workflow.mjs';
import {ProductApi} from '../product-api.mjs';

async function fixture(t){
 const dir=await mkdtemp(join(tmpdir(),'ly-preparation-')),store=new SourceStore(join(dir,'state.sqlite'));
 t.after(async()=>{store.close();await rm(dir,{recursive:true,force:true});});
 const shop={id:'shop-test-preparation',name:'隔离审核店'},tasks=[];
 for(let n=1;n<=3;n++){const path=join(dir,n+'.png');await writeFile(path,Buffer.from('isolated visual fixture '+n));tasks.push({schemaVersion:2,shopId:shop.id,taskId:'test-'+n,priority:n,listing:{type:'country',country:'目的地'+n,title:'目的地'+n+'导游'},source:{},assets:{main:[{path,sha256:digest(await readFile(path))}],secondary:[],details:[]},business:{shop_name:shop.name,price_cny:20,inventory:999999},adapterIssues:[]});}
 const importId=store.imported({sourceHash:'test-input',sheet:'境外城市热度',tasks});
 const source={store,runtime:dir,artifacts:join(dir,'tasks'),active:null,checkLiveContent:SourceWorkflow.prototype.checkLiveContent,preflight:async()=>{},launch(){throw Error('TEST_MUST_NOT_LAUNCH');}},batch=new BatchWorkflow(source);
 const owner={sessions:new Map(),status:async()=>({running:true,loggedIn:true,loginState:'LOGGED_IN'})};
 const api=new ProductApi({imageReviewPolicy:{enabled:false},source,batch,owner,shop,runtime:dir,launch:async()=>{},integrity:async()=>({ok:true,revision:'isolated-preparation-v1'}),checkFiles:async()=>{}});
 const call=async(action,input,method=input?'POST':'GET')=>{let value,status;const res={writeHead:s=>status=s,end:x=>value=x};await api.handle({method},res,new URL('http://localhost/api/v1/content-preparation'+action),{body:async()=>input,json:(r,s,v)=>{status=s;value=v;}});return {value,status};};
 const create=()=>call('/create',{importId,expectedCount:3,confirmed:true,requestId:randomUUID()});
 const queued=()=>{const p=batch.preview(importId,2);return batch.create({importId,limit:2,mode:'LIVE',review:{reviewed:true,selectionHash:p.selectionHash,authorization:'isolated'}},shop);};
 return {dir,store,shop,tasks,source,batch,api,importId,call,create,queued};
}
const reviewInput=v=>{const i=v.items[0];return {id:v.round.id,manifestHash:v.round.manifestHash,key:i.key,taskHash:i.taskHash,mainHashes:i.mainHashes,decision:'PASS',observedText:'逐图看到目的地1，原图目的地与商品一致',reviewer:'隔离验证者',requestId:randomUUID()};};

test('ordinary LIVE creation rejects before queues or attempts exist',async t=>{
 const x=await fixture(t),p=x.batch.preview(x.importId,2);
 await assert.rejects(x.api.createBatch({importId:x.importId,limit:2,mode:'LIVE',review:{reviewed:true,selectionHash:p.selectionHash,authorization:'test'}}),/创建执行批次/);
 assert.equal(x.store.db.prepare('SELECT COUNT(*) n FROM batch_items').get().n,0);assert.equal(x.api.round.round(),null);
});
test('preparation lists original images, creates full list and reuses original queue without starting',async t=>{
 const x=await fixture(t),b=x.queued(),original=x.batch.store.items(b.id),before=(await x.call('')).value;
 assert.equal(before.total,3);assert.equal(before.round,null);assert.equal(before.unreviewed,3);assert.equal(before.items[0].review,null);
 const request={importId:x.importId,expectedCount:3,confirmed:true,requestId:randomUUID()},r=await x.call('/create',request);
 assert.equal(r.value.executionStarted,false);const v=(await x.call('')).value;
 assert(v.round.id);assert.equal(v.total,3);assert.equal(v.items[0].mainHashes[0],original[0].task.assets.main[0].sha256);
 assert.equal(new URL(v.items[0].images[0].url,'http://localhost').searchParams.get('executionShop'),x.shop.id);
 assert.deepEqual(x.batch.store.items(b.id),original);assert.equal(x.api.round.items(v.round.id)[0].queue_id,original[0].id);assert.equal(x.store.list().length,0);
 assert.equal((await x.call('/create',request)).value.replayed,true);
 await assert.rejects(x.call('/create',{...request,expectedCount:2}),/内容已变化/);
});
test('invalid scope, stale import, wrong shop and active execution cannot create a list',async t=>{
 const x=await fixture(t);
 for(const change of [{expectedCount:2},{confirmed:false},{shopId:'other-shop'},{importId:'other'}])await assert.rejects(x.call('/create',{importId:x.importId,expectedCount:3,confirmed:true,requestId:randomUUID(),...change}));
 x.source.active='busy';await assert.rejects(x.create(),/执行|停止|结束/);x.source.active=null;
 x.store.imported({sourceHash:'newer',tasks:x.tasks});await assert.rejects(x.create(),/版本已更新/);assert.equal(x.api.round.round(),null);
});
test('review is explicit, hash bound, idempotent and never starts publishing',async t=>{
 const x=await fixture(t);await x.create();const v=(await x.call('')).value,input=reviewInput(v);
 for(const patch of [{manifestHash:'wrong'},{taskHash:'wrong'},{mainHashes:['wrong']},{reviewer:''},{observedText:''}])await assert.rejects(x.call('/review',{...input,...patch,requestId:randomUUID()}));
 assert.equal((await x.call('')).value.reviewed,0);
 await x.call('/review',input);assert.equal((await x.call('/review',input)).value.replayed,true);
 const after=(await x.call('')).value;assert.equal(after.reviewed,1);assert.equal(after.unreviewed,2);assert.equal(x.store.list().length,0);
 assert.equal(after.items[0].review.evidence[0].path,x.tasks[0].assets.main[0].path);
 await assert.rejects(x.call('/review',{...input,decision:'MISMATCH'}),/内容已变化/);
});
test('review and image requests reject changed files and arbitrary image scopes',async t=>{
 const x=await fixture(t);await x.create();const v=(await x.call('')).value,i=v.items[0];
 assert.equal((await x.call(i.images[0].url.replace('/api/v1/content-preparation',''))).status,200);
 await assert.rejects(x.call(i.images[0].url.replace('/api/v1/content-preparation','').replace('key='+i.key,'key=foreign')),/范围/);
 await writeFile(x.tasks[0].assets.main[0].path,'changed');await assert.rejects(x.call('/review',reviewInput(v)),/变化|改变/);
 await assert.rejects(x.call(i.images[0].url.replace('/api/v1/content-preparation','')),/变化/);
});
test('old LIVE batch stops for missing review before claim, run creation or any attempt',async t=>{
 const x=await fixture(t),b=x.queued();x.batch.start(b.id,x.shop);await x.batch.pending;
 assert.match(x.batch.store.batch(b.id).reason,/CONTENT_REVIEW_REQUIRED/);
 assert.equal(x.batch.store.items(b.id)[0].attempts,0);assert.equal(x.store.list().length,0);
});
test('page boundaries are bounded and mismatch is persisted without fabricating approval',async t=>{
 const x=await fixture(t);await x.create();const v=(await x.call('')).value;
 await x.call('/review',{...reviewInput(v),decision:'MISMATCH',observedText:'图片写目的地2，与当前商品不一致'});
 const after=(await x.call('?offset=1&limit=1')).value;assert.equal(after.items.length,1);assert.equal(after.mismatched,1);assert.equal(after.reviewed,0);assert.equal(after.unreviewed,2);
 for(const q of ['?offset=-1','?limit=51','?offset=1.5'])await assert.rejects(x.call(q));
 assert.equal(x.api.round.items(v.round.id)[0].state,'PREFLIGHT_SKIPPED');
});

test('a completed prior list does not trap a later import in the previous review scope',async t=>{
 const x=await fixture(t);await x.create();const old=x.api.round.round();x.api.round.state(old.id,'COMPLETED','isolated completed');
 const tasks=x.tasks.map(t=>({...t,listing:{...t.listing,country:'新'+t.listing.country}})),importId=x.store.imported({sourceHash:'new-round',tasks});
 const v=(await x.call('')).value;assert.equal(v.round,null);assert.equal(v.importId,importId);
 await x.call('/create',{importId,expectedCount:3,confirmed:true,requestId:randomUUID()});
 assert.notEqual(x.api.round.round().id,old.id);assert.equal(x.api.round.round().import_id,importId);assert.equal(x.store.list().length,0);
});

test('single LIVE start rejects missing review before creating a run',async t=>{
 const x=await fixture(t);x.source.preview=()=>({task:x.tasks[0]});
 await assert.rejects(SourceWorkflow.prototype.start.call(x.source,{batchId:x.importId,order:1,mode:'LIVE',review:{reviewed:true,taskHash:digest(x.tasks[0])}},x.shop),/CONTENT_REVIEW_REQUIRED/);
 assert.equal(x.store.list().length,0);
});

test('DRY_RUN promotion rejects missing review before changing mode or adding events',async t=>{
 const x=await fixture(t),run=x.store.create(x.importId,x.tasks[0],'DRY_RUN','SOURCE',{reviewed:true,taskHash:digest(x.tasks[0])});
 x.store.move(run.id,'RUNNING');x.store.move(run.id,'DRY_RUN_COMPLETE');const before=x.store.run(run.id),events=x.store.events(run.id);
 await assert.rejects(SourceWorkflow.prototype.resume.call(x.source,{id:run.id,publish:true},x.shop),/CONTENT_REVIEW_REQUIRED/);
 assert.deepEqual(x.store.run(run.id),before);assert.deepEqual(x.store.events(run.id),events);
});

test('explicit user policy fills missing reviews on existing list without replacing original tasks or starting',async t=>{
 const x=await fixture(t),b=x.queued();await x.create();const r=x.api.round.round(),before=x.batch.store.items(b.id),input=reviewInput((await x.call('')).value);
 await x.call('/review',{...input,decision:'MISMATCH'});
 const original=x.api.contentReviews.get(r.id,input.key),queue=x.batch.store.items(b.id);
 const next=()=>new ProductApi({source:x.source,batch:x.batch,owner:x.api.owner,shop:x.shop,runtime:x.dir,launch:async()=>{},integrity:async()=>({ok:true,revision:'user-batch-test'}),checkFiles:async()=>{}});
 const api=next(),rows=api.round.items(r.id);assert.deepEqual(api.contentReviews.get(r.id,input.key),original);
 for(const row of rows.slice(1)){const review=api.contentReviews.inspect(row.task,api.round.round(r.id));assert.equal(review.decision,'PASS');assert.equal(review.method,'user-batch-confirmation');assert.equal(review.observedText,'用户批量确认，未逐图目视审核');}
 assert.equal(x.store.list().length,0);assert.deepEqual(x.batch.store.items(b.id),queue);assert.equal(before[0].id,queue[0].id);
 const events=api.round.events(r.id);next();assert.deepEqual(api.round.events(r.id),events);
});

test('new list automatically records user batch confirmation without opening an image review page',async t=>{
 const x=await fixture(t),api=new ProductApi({source:x.source,batch:x.batch,owner:x.api.owner,shop:x.shop,runtime:x.dir,launch:async()=>{},integrity:async()=>({ok:true,revision:'user-batch-test'}),checkFiles:async()=>{}});
 const r=await api.round.create({importId:x.importId,expectedCount:3,repairVersion:'user-batch-test',authorization:{allowLive:true,maxSafeRecoveries:2,confirmedShop:x.shop.name,expectedCount:3}});
 assert.equal(api.round.items(r.id).filter(row=>api.contentReviews.assertApproved(row.task,api.round.round(r.id))).length,3);
 assert.equal(x.store.list().length,0);assert.equal(x.batch.store.db.prepare('SELECT COUNT(*) n FROM batch_items').get().n,0);
});

test('a damaged historical manifest stays inspectable and blocked instead of breaking shop initialization',async t=>{
 const x=await fixture(t);await x.create();const r=x.api.round.round();x.store.db.prepare("UPDATE rounds SET manifest_hash='damaged' WHERE id=?").run(r.id);
 const api=new ProductApi({source:x.source,batch:x.batch,owner:x.api.owner,shop:x.shop,runtime:x.dir,launch:async()=>{},integrity:async()=>({ok:true}),checkFiles:async()=>{}});
 assert.equal(api.round.round().state,'SYSTEM_BLOCKED');assert.equal(x.store.db.prepare('SELECT COUNT(*) n FROM publishing_content_reviews').get().n,0);assert.equal(x.store.list().length,0);
});
