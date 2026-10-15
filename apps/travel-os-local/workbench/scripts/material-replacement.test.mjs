import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,readdir,rm,realpath} from 'node:fs/promises';
import {join,dirname,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID,createHash} from 'node:crypto';
import {deflateSync} from 'node:zlib';
import {SourceStore,digest} from '../source-store.mjs';
import {BatchWorkflow} from '../batch-workflow.mjs';
import {ProductApi} from '../product-api.mjs';
import {TravelOsApi} from '../travel-os-api.mjs';
import {replaceMaterial,materialEditInfo,materialReplacements} from '../material-replacement.mjs';

import {png,fixture} from './material-replacement-fixture.mjs';
import sharp from 'sharp';

test('server rejects corrupt pixel streams and valid animated PNG before staging or changing imports',async t=>{
 const x=await fixture(t),input=await x.request(),old=x.store.batch();
 const jpeg=Buffer.alloc(32);jpeg.set([255,216,255]);jpeg.set([255,217],30);
 const webp=Buffer.alloc(24);webp.write('RIFF');webp.writeUInt32LE(16,4);webp.write('WEBP',8);
 const corrupt=Buffer.from(png(65));corrupt[corrupt.indexOf('IDAT')+5]^=255;
 const badCrc=Buffer.from(png(80));badCrc[badCrc.indexOf('IDAT')+4+badCrc.readUInt32BE(badCrc.indexOf('IDAT')-4)]^=1;
 const apng=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAACGFjVEwAAAACAAAAAPONk3AAAAAaZmNUTAAAAAAAAAACAAAAAgAAAAAAAAAAAAEACgAA6FTcAAAAABVJREFUeJxj/M/A8J+BgYGBCUSAMAAfFwICAkezFAAAABpmY1RMAAAAAQAAAAIAAAACAAAAAAAAAAAAAQAKAABzJzbUAAAAGWZkQVQAAAACeJxjZGD4/5+BgYGBCUSAMAAdGQICRW6eVwAAAABJRU5ErkJggg==','base64');
 for(const [name,bytes]of [['bad.jpg',jpeg],['bad.webp',webp],['corrupt.png',corrupt],['crc.png',badCrc],['animated.png',apng]]){
  await assert.rejects(replaceMaterial(x.p,x.asset,{...input,name,data:bytes.toString('base64'),requestId:randomUUID()}),/损坏|解码/);
  assert.equal(x.p.capturing,false);
 }
 assert.equal(x.store.db.prepare('SELECT COUNT(*) n FROM material_replacement_events').get().n,0);assert.deepEqual(x.store.batch(),old);assert.deepEqual(await readFile(x.asset.file),x.bytes);
 assert(!(await readdir(x.root)).includes('.travel-os-image-versions'));
});

test('server fully decodes valid PNG JPEG and WebP files and keeps uploaded bytes',async t=>{
 const x=await fixture(t);
 for(const format of ['png','jpeg','webp']){
  const bytes=await sharp({create:{width:4,height:6,channels:3,background:{r:30,g:80,b:120}}}).toFormat(format).toBuffer(),input=await x.request();
  await replaceMaterial(x.p,x.asset,{...input,name:'valid.'+(format==='jpeg'?'jpg':format),data:bytes.toString('base64')});
  assert.deepEqual(await readFile(materialReplacements(x.store.db,x.shop.id).get(x.asset.file).asset.path),bytes);
 }
 assert.equal(x.store.db.prepare('SELECT COUNT(*) n FROM material_replacement_events').get().n,3);
});

test('single replacement updates future imports and preserves original file, run, queue and fixed manifest',async t=>{
 const x=await fixture(t),r=await x.p.round.create({importId:x.importId,authorization:{allowLive:true,maxSafeRecoveries:2,confirmedShop:x.shop.name,expectedCount:2},expectedCount:2,repairVersion:'ISOLATED'});
 const run=x.store.create(x.importId,x.input.tasks[0],'LIVE','SOURCE',{reviewed:true,taskHash:digest(x.input.tasks[0])});x.store.move(run.id,'RUNNING');x.store.move(run.id,'SUBMITTING');x.store.move(run.id,'RESULT_UNKNOWN','原商品待核验');
 const original={run:x.store.run(run.id),round:x.p.round.round(r.id),items:x.p.round.items(r.id),import:x.store.batch(x.importId)},request=await x.request(),result=await replaceMaterial(x.p,x.asset,request),latest=x.store.batch();
 assert.equal(result.revision,1);assert.equal(result.scope,'FUTURE_TASKS_ONLY');assert.notEqual(latest.id,x.importId);
 assert.equal(latest.tasks[0].assets.details[0].sha256,digest(png(220)));assert(latest.tasks[0].assets.details[0].path.includes('.travel-os-image-versions'));
 assert.deepEqual(await readFile(x.asset.file),x.bytes);assert.deepEqual(x.store.run(run.id),original.run);assert.deepEqual(x.p.round.round(r.id),original.round);assert.deepEqual(x.p.round.items(r.id),original.items);assert.deepEqual(x.store.batch(x.importId),original.import);
 assert.equal(x.p.round.assertManifest(r.id).manifest_hash,r.manifestHash);assert.equal(x.flow.active,null);assert.equal((await x.p.settings()).executionEnabled,false);
});
test('unused second cover is versioned and publishing presets use the new file without changing drafts',async t=>{
 const x=await fixture(t),preset={...x.p.rules.preset(x.shop.id),covers:x.input.templateMaterials.covers,secondary:x.input.templateMaterials.secondary,revision:1};
 x.store.db.prepare('INSERT INTO publishing_presets VALUES(?,?)').run(x.shop.id,JSON.stringify(preset));
 const draft={original:true};x.store.db.prepare('INSERT INTO publishing_drafts VALUES(?,?,?,?)').run('old-draft','old-key',x.shop.id,JSON.stringify(draft));
 const asset=x.assetFor(x.covers[1].path);await replaceMaterial(x.p,asset,await x.request(asset));
 assert.notEqual(x.store.batch().id,x.importId);assert.equal(x.store.batch().templateMaterials.covers[1].sha256,digest(png(220)));
 assert.equal(x.p.rules.preset(x.shop.id).revision,2);assert.equal(x.p.rules.preset(x.shop.id).covers[1].sha256,digest(png(220)));
 assert.deepEqual(JSON.parse(x.store.db.prepare('SELECT payload FROM publishing_drafts WHERE id=?').get('old-draft').payload),draft);
 const library=await x.p.rules.materials(x.root,x.shop.id);assert.equal(library.filter(a=>a.originalPath===asset.file).length,1);assert.equal(library.find(a=>a.originalPath===asset.file).path,x.p.rules.preset(x.shop.id).covers[1].path);
});
test('later re-imports inherit stored replacement and a second replacement retains both versions',async t=>{
 const x=await fixture(t);await replaceMaterial(x.p,x.asset,await x.request());
 const first=materialReplacements(x.store.db,x.shop.id).get(x.asset.file),second=await replaceMaterial(x.p,x.asset,await x.request(x.asset,90));
 const id=x.store.imported(x.input),current=x.store.batch(id);assert.equal(second.revision,2);assert.equal(current.tasks[0].assets.details[0].sha256,digest(png(90)));
 assert.deepEqual(await readFile(first.asset.path),png(220));assert.deepEqual(await readFile(x.asset.file),x.bytes);assert.equal(x.input.tasks[0].assets.details[0].path,x.asset.file);
});
test('lost-response replay is idempotent and stale or conflicting edits cannot overwrite current version',async t=>{
 const x=await fixture(t),input=await x.request(),a=await replaceMaterial(x.p,x.asset,input),b=await replaceMaterial(x.p,x.asset,input);
 assert.equal(b.replayed,true);assert.equal(a.revision,b.revision);assert.equal(x.store.db.prepare('SELECT COUNT(*) n FROM material_replacement_events').get().n,1);
 await assert.rejects(replaceMaterial(x.p,x.asset,{...input,requestId:randomUUID()}),/其他页面修改/);
 await assert.rejects(replaceMaterial(x.p,x.asset,{...input,data:png(30).toString('base64')}),/编号/);
});
test('wrong-shop, busy executor, current creation and invalid file requests leave materials unchanged',async t=>{
 const x=await fixture(t),input=await x.request();
 await assert.rejects(replaceMaterial(x.p,x.asset,{...input,shopId:'other-shop'}),/店铺|范围/);
 x.flow.active='running';await assert.rejects(replaceMaterial(x.p,x.asset,input),/执行/);x.flow.active=null;
 x.p.round.creating=true;await assert.rejects(replaceMaterial(x.p,x.asset,input),/创建/);x.p.round.creating=false;
 for(const bad of [{name:'evil.svg',data:Buffer.from('<svg/>').toString('base64')},{name:'new.png',data:Buffer.from('<html>not an image</html>').toString('base64')},{name:'../new.png'},{data:'invalid!'},{name:'new.jpg'}])await assert.rejects(replaceMaterial(x.p,x.asset,{...input,...bad}));
 assert.equal(x.store.db.prepare('SELECT COUNT(*) n FROM material_replacements').get().n,0);assert.deepEqual(await readFile(x.asset.file),x.bytes);assert.equal(x.p.capturing,false);
});
test('failed transaction rolls back imports and presets and removes only its own staged file',async t=>{
 const x=await fixture(t),old=x.store.batch(),input=await x.request();
 x.store.db.exec("CREATE TRIGGER reject_material BEFORE INSERT ON material_replacement_events BEGIN SELECT RAISE(ABORT,'QA_ROLLBACK'); END;");
 await assert.rejects(replaceMaterial(x.p,x.asset,input),/QA_ROLLBACK/);assert.equal(x.store.db.prepare('SELECT COUNT(*) n FROM material_replacements').get().n,0);assert.deepEqual(x.store.batch(),old);assert.equal(x.p.capturing,false);
 const names=await readdir(join(x.root,'.travel-os-image-versions'),{recursive:true});assert(!names.some(n=>n.endsWith('.png')));
});
test('API provides edit metadata, saves one image, serves new bytes and rejects other-shop assets',async t=>{
 const x=await fixture(t);let reply;
 const call=async(action,input)=>{let value;await x.api.handle({method:input?'POST':'GET'},{},new URL('http://localhost/api/os/'+action),{body:async()=>input,json:(_r,status,data)=>value={status,data}});return value;};
 const state=await call('state'),inventory=state.data.materials[x.shop.id],asset=inventory.covers.sets[0].previews[0];assert(asset.id);
 const meta=await call('material-edit?'+new URLSearchParams({shopId:x.shop.id,assetId:asset.id}));assert.equal(meta.data.revision,0);
 const result=await call('material-replace',{...await x.request(),assetId:asset.id});assert.equal(result.status,200);
 const updated=(await call('state')).data.materials[x.shop.id];assert.equal(updated.covers.count,2);assert.equal(updated.details.count,1);assert(updated.covers.sets[0].previews[0].modified);
 const res={writeHead:(status,headers)=>reply={status,headers},end:bytes=>reply.bytes=bytes};await x.api.handle({method:'GET'},res,new URL('http://localhost'+asset.url),{body:async()=>({}),json(){}});
 assert.equal(reply.status,200);assert.deepEqual(reply.bytes,png(220));
 await assert.rejects(call('material-replace',{...await x.request(),shopId:'other-shop'}),/店铺/);
});
