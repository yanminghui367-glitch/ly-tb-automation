import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFile,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fixture as base,png} from './material-replacement-fixture.mjs';
import {digest,destinationKey} from '../source-store.mjs';
import {prepareMaterialBindings,applyMaterialBindings,readMaterialBinding,materialTask} from '../round-material-binding.mjs';
import {assertTaskFiles,executionDetailImages,verifyMaterialUploadReceipt} from '../taobao-publisher.mjs';
import {SourceWorkflow} from '../source-workflow.mjs';
import {ProductApi} from '../product-api.mjs';

async function fixture(t){
 const x=await base(t),input=structuredClone(x.input),workbook=join(x.root,'source.xlsx');await writeFile(workbook,'unchanged workbook');
 for(const task of input.tasks){task.source={workbook,sha256:digest(Buffer.from('unchanged workbook'))};task.business={...task.business,category_path:'个性定制/设计服务/DIY/其它定制/其它商品定制',custom_service:true,procurement:'中国内地（大陆）',ship_from:'北京/北京',shipping_time:'24小时内发货',ship_from_region:'大陆及港澳台',region_restriction:'不设置商品维度区域限售模板',listing_time:'立刻上架'};}
 for(let n=3;n<=4;n++){const task=structuredClone(input.tasks[0]);task.priority=n;task.listing.city='城市'+n;input.tasks.push(task);}
 const imported=x.store.imported(input),r=await x.p.round.create({importId:imported,expectedCount:4,authorization:{allowLive:true,maxSafeRecoveries:2,confirmedShop:x.shop.name,expectedCount:4},repairVersion:'ISOLATED'});
 for(const row of x.p.round.items(r.id).slice(2))x.p.round.update(r.id,row.key,{state:'MANUAL_SKIPPED',reason:'原用户跳过',finished:'2026-10-15T00:00:00Z'});
 x.p.round.state(r.id,'SYSTEM_BLOCKED','SOURCE_OR_ASSET_CHANGED');
 const queueTasks=x.p.round.items(r.id).slice(0,2).map(v=>v.task);
 const b=x.batch.store.create(imported,queueTasks,x.shop.id,'LIVE',{reviewed:true,selectionHash:digest(queueTasks),authorization:'isolated user',roundId:r.id,manifestHash:r.manifestHash});
 for(const q of x.batch.store.items(b.id))x.p.round.update(r.id,q.key,{queue_id:q.id,batch_id:b.id});
 const latest=structuredClone(input);latest.templateMaterials.covers[0].sha256=digest(png(220));
 for(const task of latest.tasks){task.assets.secondary=structuredClone(latest.templateMaterials.secondary.B);task.assets.details[0]=structuredClone(latest.templateMaterials.covers[1]);}
 await writeFile(x.covers[0].path,png(220));const importId=x.store.imported(latest);
 const options={roundId:r.id,importId,shopId:x.shop.id,manifestHash:r.manifestHash,confirmedBy:'用户',reason:'用户确认使用已裁剪并重新保存的资料'};
 return {...x,options,latest,original:input,roundId:r.id,prepare:()=>prepareMaterialBindings(x.store.db,options)};
}
function protectedSnapshot(x){const db=x.store.db;return JSON.stringify(['rounds','round_items','batch_items','batches','runs','events','history','imports','round_windows','round_window_items'].map(name=>[name,db.prepare('SELECT * FROM '+name).all().map(row=>{if(['rounds','round_windows'].includes(name)){const {state,reason,updated,...immutable}=row;return immutable;}return row;})]));}

test('binding keeps original tasks, slots, queues, manifest, skipped records and existing imports unchanged',async t=>{
 const x=await fixture(t),before=protectedSnapshot(x),plan=await x.prepare();assert.equal(plan.entries.length,2);assert.equal(plan.excluded.length,2);
 const result=await applyMaterialBindings(x.store,plan);assert.equal(result.bound,2);assert.equal(result.changedItems,2);assert.equal(protectedSnapshot(x),before);x.p.round.assertManifest(x.roundId);
 assert.equal(x.p.round.round(x.roundId).state,'PAUSED');assert.match(x.p.round.events(x.roundId).at(-1).payload.previousError,/SOURCE_OR_ASSET_CHANGED/);
 const task=x.p.round.items(x.roundId)[0].task,binding=readMaterialBinding(x.store.db,task),effective=materialTask(task,binding);
 assert.equal(effective.assets.secondary[0].path,task.assets.secondary[0].path);assert.notEqual(effective.assets.secondary[0].path,x.latest.tasks[0].assets.secondary[0].path);
 assert.equal(binding.changes[0].path,task.assets.details[0].path);assert.equal(effective.assets.details[0].sha256,x.latest.templateMaterials.covers[0].sha256);assert.notEqual(effective.assets.details[0].path,x.latest.tasks[0].assets.details[0].path);assert.notEqual(effective.assets.details[0].path,task.assets.details[0].path);
 assert.deepEqual(await readFile(effective.assets.details[0].path),await readFile(task.assets.details[0].path));
 await assert.rejects(assertTaskFiles(task),/SOURCE_OR_ASSET_CHANGED/);await assertTaskFiles(task,{materialBinding:binding});
 const flow=new SourceWorkflow({}, {store:x.store,runtime:x.dir});await flow.preflight([task]);
 const p=new ProductApi({...x.params,checkFiles:undefined});await p.checkFiles(task);
 assert.equal(readMaterialBinding(x.store.db,x.p.round.items(x.roundId)[2].task),null);assert.equal(x.store.list().length,0);
});

for(const change of ['title','price','source','main','wrong-shop','wrong-import'])test('rejects non-material or cross-scope change: '+change,async t=>{
 const x=await fixture(t),latest=structuredClone(x.latest);
 if(change==='title')latest.tasks[0].listing.title='不同商品';
 if(change==='price')latest.tasks[0].business.price_cny=123;
 if(change==='source')latest.tasks[0].source.sha256='1'.repeat(64);
 if(change==='main')latest.tasks[0].assets.main[0].sha256='1'.repeat(64);
 if(change==='wrong-shop')x.options.shopId='other-shop';
 if(change==='wrong-import')x.options.importId='old-import';
 if(!['wrong-shop','wrong-import'].includes(change))x.options.importId=x.store.imported(latest);
 await assert.rejects(x.prepare(),/资料版本绑定/);assert.equal(x.store.db.prepare("SELECT COUNT(*) n FROM round_events WHERE kind='MATERIAL_VERSION_BOUND'").get().n,0);
});

for(const change of ['claim','skip','run','history','new-import','changed-file'])test('stale preview cannot write after '+change,async t=>{
 const x=await fixture(t),plan=await x.prepare(),row=x.p.round.items(x.roundId)[0];
 if(change==='claim')x.store.db.prepare('UPDATE batch_items SET attempts=1 WHERE id=?').run(row.queue_id);
 if(change==='skip')x.p.round.update(x.roundId,row.key,{state:'MANUAL_SKIPPED'});
 if(change==='run')x.store.create('original',row.task,'LIVE','SOURCE',{reviewed:true,taskHash:row.task_hash});
 if(change==='history')x.store.history(row.task,{itemId:'900001'});
 if(change==='new-import')x.store.imported({...x.latest,tasks:x.latest.tasks.map(v=>({...v,priority:v.priority+10}))});
 if(change==='changed-file')await writeFile(x.covers[0].path,png(221));
 await assert.rejects(applyMaterialBindings(x.store,plan),/资料版本绑定/);
 assert(!x.store.db.prepare("SELECT 1 FROM sqlite_master WHERE name='round_material_bindings'").get());
});

test('binding is pinned, rejects tampering, wrong task and a subsequent file change',async t=>{
 const x=await fixture(t);await applyMaterialBindings(x.store,await x.prepare());const task=x.p.round.items(x.roundId)[0].task,binding=readMaterialBinding(x.store.db,task);
 await assertTaskFiles(task,{materialBinding:binding});
 await assert.rejects(assertTaskFiles({...task,listing:{...task.listing,title:'another'}},{materialBinding:binding}),/资料版本绑定/);
 const changed=structuredClone(binding);changed.changes[0].toSha256='1'.repeat(64);assert.throws(()=>materialTask(task,changed),/资料版本绑定/);
 await writeFile(x.covers[0].path,png(221));await assert.rejects(assertTaskFiles(task,{materialBinding:binding}),/SOURCE_OR_ASSET_CHANGED/);
 x.store.db.prepare("UPDATE round_material_bindings SET payload=json_set(payload,'$.importId','tampered') WHERE key=?").run(destinationKey(task));assert.throws(()=>readMaterialBinding(x.store.db,task),/资料版本绑定/);
});

test('old detail padding receipt cannot be applied to the new bound source hash',async t=>{
 const x=await fixture(t);await applyMaterialBindings(x.store,await x.prepare());const task=x.p.round.items(x.roundId)[0].task,binding=readMaterialBinding(x.store.db,task),a=task.assets.details[0];
 const profile={shopId:task.shopId,confirmedBy:'用户',sha256:'old-padding-profile',detailImagePadding:[{sourcePath:a.path,sourceSha256:a.sha256,path:a.path}]};
 await assert.rejects(executionDetailImages(task,profile,binding),/FORM_DETAIL_PADDING_SOURCE_CHANGED/);
 assert.equal((await readFile(a.path)).equals(png(220)),true);
});

test('a real run pins the binding and refuses a different version before browser access on resume',async t=>{
 const x=await fixture(t);await applyMaterialBindings(x.store,await x.prepare());const row=x.p.round.items(x.roundId)[0],binding=readMaterialBinding(x.store.db,row.task);
 const run=x.store.create('original',row.task,'DRY_RUN','SOURCE',{reviewed:true,taskHash:row.task_hash});
 let reads=0;const flow=new SourceWorkflow({sessions:new Map(),status:async()=>{reads++;throw Error('isolated stop before browser');}},{store:x.store,runtime:x.dir,artifacts:join(x.dir,'run-evidence')});
 flow.launch(run.id,x.shop);await flow.pending;assert.equal(x.store.run(run.id).checkpoint.materialBinding.sha256,binding.sha256);assert.equal(reads,1);
 const {sha256,...payload}=binding;payload.reason='changed after checkpoint';x.store.db.prepare('UPDATE round_material_bindings SET payload=?,sha256=? WHERE key=?').run(JSON.stringify(payload),digest(payload),row.key);
 await flow.resume({id:run.id},x.shop);await flow.pending;assert.equal(reads,1);assert.equal(x.store.run(run.id).state,'PAUSED');assert.match(x.store.run(run.id).reason,/原断点的素材绑定版本已变化/);
 assert(x.store.events(run.id).every(e=>!['SUBMITTING','SUBMIT_CLICKED'].includes(e.kind)));
});

test('a same-name cloud card is not trusted without the version-specific upload receipt',async t=>{
 const x=await fixture(t);await applyMaterialBindings(x.store,await x.prepare());const task=x.p.round.items(x.roundId)[0].task,binding=readMaterialBinding(x.store.db,task),asset=materialTask(task,binding).assets.details[0];
 const oldCard={locator:()=>({getAttribute:async()=> 'https://img.alicdn.com/old.png'})};
 assert.equal(await verifyMaterialUploadReceipt(asset,oldCard),false);
 const receipt={path:asset.path,sha256:asset.sha256,materialVersion:asset.materialVersion,url:'https://img.alicdn.com/new.png'};await writeFile(asset.path+'.upload.json',JSON.stringify(receipt));
 assert.equal(await verifyMaterialUploadReceipt(asset,oldCard),false);
 assert.equal(await verifyMaterialUploadReceipt(asset,{locator:()=>({getAttribute:async()=>receipt.url})}),true);
});
