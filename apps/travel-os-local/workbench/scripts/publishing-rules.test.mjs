import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm,readFile,realpath,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SourceStore,digest,destinationKey} from '../source-store.mjs';
import {BatchWorkflow} from '../batch-workflow.mjs';
import {PublishingRules} from '../publishing-rules.mjs';
import {ATTRIBUTE_FIELDS,NO_BRAND} from '../publishing-attributes.mjs';
import {assertTaskFiles} from '../taobao-publisher.mjs';

async function fixture(t){
 const dir=await realpath(await mkdtemp(join(tmpdir(),'travel-publishing-rules-'))),file=join(dir,'state.sqlite');
 let store=new SourceStore(file),rules=new PublishingRules(store),flow={store,active:null},batch=new BatchWorkflow(flow);
 t.after(async()=>{store.close();await rm(dir,{recursive:true,force:true});});
 const assets=[];for(let i=0;i<14;i++){const path=join(dir,`image-${i}.png`);await writeFile(path,'fixture-'+i);assets.push({path,sha256:digest('fixture-'+i)});}
 const book=join(dir,'source.xlsx');await writeFile(book,'source fixture');
 const tasks=[1,2].map(priority=>({shopId:'fixture-shop',priority,source:{workbook:book,sha256:digest('source fixture')},listing:{type:'city',country:'测试国家',city:'测试城'+priority,title:'测试商品'},business:{brand:'source-brand',price_cny:'20',inventory:'10',category_path:'个性定制/设计服务/DIY/其它定制/其它商品定制',custom_service:true,procurement:'中国内地（大陆）',ship_from:'北京/北京',shipping_time:'24小时内发货',ship_from_region:'大陆及港澳台',region_restriction:'不设置商品维度区域限售模板',listing_time:'放入仓库'},assets:{main:[assets[0]],secondary:assets.slice(1,5),details:assets.slice(5,13)},adapterIssues:[]}));
 const id=store.imported({sourceHash:'fixture',sheet:'境外城市热度',tasks});
 const fields=Object.entries(ATTRIBUTE_FIELDS).map(([key,label],i)=>({key,label,containerId:'struct-p-'+(101+i),kind:'native',options:[{value:'a',text:key+' A'},{value:'b',text:key+' B'}]}));
 const setup=async()=>{const captured=rules.capture('fixture-shop',fields),images=await rules.materials(dir,'fixture-shop');
  const ids=assets.map(a=>images.find(i=>i.path===a.path).id);
  const input={revision:rules.preset('fixture-shop').revision,captureId:captured.id,confirmed:true,secondary:{A:ids.slice(1,5),B:ids.slice(5,9)},covers:ids.slice(9,11),allowed:Object.fromEntries(fields.map(f=>[f.key,['a','b']]))};
  await rules.save('fixture-shop',input,dir);return input;
 };
 const base=()=>batch.preview(id,2);
 const prepared=()=>rules.prepare(base(),'fixture-shop');
 const createInput=p=>({importId:id,draftId:p.draftId,mode:'DRY_RUN',review:{reviewed:true,selectionHash:p.selectionHash,authorization:'ISOLATED_TEST'}});
 return {dir,file,tasks,fields,id,base,prepared,setup,createInput,get store(){return store;},get rules(){return rules;},get batch(){return batch;},async reopen(){store.close();store=new SourceStore(file);rules=new PublishingRules(store);flow={store,active:null};batch=new BatchWorkflow(flow);}};
}

test('disabled rules preserve the original preview and create no randomized snapshot',async t=>{const x=await fixture(t);assert.deepEqual(await x.prepared(),x.base());assert.equal(x.store.db.prepare('SELECT count(*) n FROM publishing_drafts').get().n,0);});
test('preset validates counts, distinct files, explicit confirmation and captured choices',async t=>{
 const x=await fixture(t),input=await x.setup();input.revision=1;
 await assert.rejects(x.rules.save('fixture-shop',{...input,confirmed:false},x.dir),/确认/);
 await assert.rejects(x.rules.save('fixture-shop',{...input,secondary:{...input.secondary,A:input.secondary.A.slice(1)}},x.dir),/数量/);
 await assert.rejects(x.rules.save('fixture-shop',{...input,allowed:{...input.allowed,pattern:['invented']}},x.dir),/不在读取/);
 await assert.rejects(x.rules.save('another-shop',input,x.dir),/重新打开|本店/);
});
test('new previews choose whole sets and replace only first detail; source remains unchanged',async t=>{
 const x=await fixture(t);await x.setup();const original=JSON.stringify(x.tasks),p=await x.prepared();
 for(const task of p.tasks){const r=x.rules.preset('fixture-shop');assert.deepEqual(task.assets.secondary,r.secondary[task.publishVariant.secondaryGroup]);assert.deepEqual(task.assets.details.slice(1),x.tasks[task.priority-1].assets.details.slice(1));assert.equal(task.assets.details.length,8);assert.equal(task.business.brand,NO_BRAND);assert.equal(task.publishVariant.attributes.length,5);assert.equal(destinationKey(task),destinationKey(x.tasks[task.priority-1]));await assertTaskFiles(task);}
 assert.equal(JSON.stringify(x.tasks),original);assert.deepEqual(x.store.batch(x.id).tasks,x.tasks);
});
test('concurrent previews, refresh and process restart preserve the exact selections',async t=>{
 const x=await fixture(t);await x.setup();const views=await Promise.all(Array.from({length:6},()=>x.prepared()));assert(views.every(p=>p.draftId===views[0].draftId));const snapshot=JSON.stringify(views[0].tasks);await x.reopen();const p=await x.prepared();assert.equal(p.draftId,views[0].draftId);assert.equal(JSON.stringify(p.tasks),snapshot);
});
test('duplicate create, including lost response after restart, produces one batch',async t=>{
 const x=await fixture(t);await x.setup();const p=await x.prepared(),input=x.createInput(p);
 const both=await Promise.all([x.rules.create(input,'fixture-shop',x.batch,x.base),x.rules.create(input,'fixture-shop',x.batch,x.base)]);assert.equal(both[0].id,both[1].id);assert.equal(x.store.db.prepare('SELECT count(*) n FROM batches').get().n,1);assert.equal(x.store.db.prepare('SELECT count(*) n FROM batch_items').get().n,2);
 await x.reopen();const replay=await x.rules.create(input,'fixture-shop',x.batch,x.base);assert.equal(replay.id,both[0].id);await assert.rejects(x.rules.create({...input,mode:'LIVE'},'fixture-shop',x.batch,x.base),/另一执行模式/);
});
test('wrong scope, shop, hash and stale rule revisions cannot create tasks',async t=>{
 const x=await fixture(t);await x.setup();const p=await x.prepared(),input=x.createInput(p);
 await assert.rejects(x.rules.create(input,'other',x.batch,x.base),/不存在/);
 await assert.rejects(x.rules.create(input,'fixture-shop',x.batch,x.base,'selected:other'),/完整随机预览/);
 await assert.rejects(x.rules.create({...input,review:{...input.review,selectionHash:'bad'}},'fixture-shop',x.batch,x.base),/完整随机预览/);
 await x.rules.save('fixture-shop',{revision:1,disable:true},x.dir);
 await assert.rejects(x.rules.create(input,'fixture-shop',x.batch,x.base),/规则已改变/);assert.equal(x.store.list().length,0);
});
test('changed or missing preset assets block cached previews without rerolling',async t=>{
 const x=await fixture(t);await x.setup();const p=await x.prepared();await writeFile(x.rules.preset('fixture-shop').covers[0].path,'changed');await assert.rejects(x.prepared(),/内容已改变/);assert.deepEqual(x.rules.draft(p.draftId,'fixture-shop').tasks,p.tasks);
});
test('success recorded between preview and create is still blocked by original dedupe key',async t=>{
 const x=await fixture(t);await x.setup();const p=await x.prepared();x.store.history(x.tasks[0],{itemId:'FIXTURE-ONLY'});await assert.rejects(x.rules.create(x.createInput(p),'fixture-shop',x.batch,x.base),/清单已变化/);assert.equal(x.store.db.prepare('SELECT count(*) n FROM batches').get().n,0);
});
test('old queued tasks and checkpoints remain byte-identical after configuring random rules',async t=>{
 const x=await fixture(t),r=x.store.create(x.id,x.tasks[0],'DRY_RUN','SOURCE',{reviewed:true,taskHash:digest(x.tasks[0])});x.store.move(r.id,'RUNNING');x.store.checkpoint(r.id,{step:'title',marker:'OLD'});x.store.move(r.id,'PAUSED','人工暂停');
 const before=x.store.db.prepare('SELECT task,checkpoint FROM runs WHERE id=?').get(r.id);await x.setup();await x.prepared();await x.reopen();assert.deepEqual(x.store.db.prepare('SELECT task,checkpoint FROM runs WHERE id=?').get(r.id),before);
});
test('dynamic detail counts are checked against the actual immutable list',async t=>{
 const x=await fixture(t);await x.setup();const p=await x.prepared(),task=p.tasks[0];task.assets.details=task.assets.details.slice(0,7);await assertTaskFiles(task);task.assets.details=[];await assert.rejects(assertTaskFiles(task),/DETAIL_COUNT/);
});
test('same-name different-content candidates and task originals are blocked',async t=>{
 const x=await fixture(t);await x.setup();await mkdir(join(x.dir,'another'));await writeFile(join(x.dir,'another','image-1.png'),'different');x.rules.materialIndex.clear();
 await assert.rejects(x.setup(),/同名图片内容不同/);
 const original=x.base();original.tasks[0].assets.main=[{path:join(x.dir,'elsewhere','image-2.png'),sha256:'different'}];
 await assert.rejects(x.rules.prepare(original,'fixture-shop'),/同名图片内容不同/);
});
test('material thumbnails share one directory scan and frozen image bytes are verified',async t=>{
 const x=await fixture(t);let scans=0;const scan=x.rules.scanMaterials.bind(x.rules);x.rules.scanMaterials=async(...args)=>{scans++;return scan(...args);};
 const lists=await Promise.all(Array.from({length:10},()=>x.rules.materials(x.dir,'fixture-shop')));assert.equal(scans,1);
 await Promise.all(lists[0].map(a=>x.rules.imageAsset({assetId:a.id},'fixture-shop',x.dir)));assert.equal(scans,1);
 await x.setup();const p=await x.prepared();const request={draftId:p.draftId,order:1,group:'secondary',index:0};assert((await x.rules.imageAsset(request,'fixture-shop',x.dir)).bytes.length);
 await writeFile(p.tasks[0].assets.secondary[0].path,'changed');await assert.rejects(x.rules.imageAsset(request,'fixture-shop',x.dir),/内容已改变/);
});
