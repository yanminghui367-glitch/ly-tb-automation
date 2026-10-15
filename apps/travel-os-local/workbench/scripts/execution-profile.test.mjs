import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {readExecutionProfile} from '../source-workflow.mjs';
import {digest} from '../source-store.mjs';
import {executionDetailImages} from '../taobao-publisher.mjs';
async function fixture(t){
 const dir=await mkdtemp(join(tmpdir(),'ly-execution-profile-'));t.after(async()=>{assert(resolve(dir).startsWith(resolve(tmpdir())+sep));await rm(dir,{recursive:true,force:true});});
 const task={shopId:'confirmed-shop',business:{freight_template:'旅游',price_cny:20}};
 const profile={version:1,shopId:task.shopId,confirmedBy:'用户',confirmedAt:new Date().toISOString(),source:'isolated user confirmation',freightTemplate:{from:'旅游',to:'旅游产品'}};
 return {dir,task,profile,save:p=>writeFile(join(dir,'execution-profile.json'),JSON.stringify(p))};
}
test('confirmed shop profile resolves real template without modifying imported task',async t=>{
 const f=await fixture(t),before=JSON.stringify(f.task);assert.equal(await readExecutionProfile(f.dir,f.task),null);
 await f.save(f.profile);const p=await readExecutionProfile(f.dir,f.task);assert.equal(p.freightTemplate.to,'旅游产品');assert.equal(p.sha256,digest(f.profile));assert.equal(JSON.stringify(f.task),before);
});
for(const change of ['wrong-shop','price-override','unconfirmed','different-source'])test('profile rejects '+change,async t=>{
 const f=await fixture(t);
 if(change==='wrong-shop')f.profile.shopId='other-shop';
 if(change==='price-override')f.profile.price_cny=999;
 if(change==='unconfirmed')f.profile.confirmedBy='agent';
 if(change==='different-source')f.profile.freightTemplate.from='other-template';
 await f.save(f.profile);await assert.rejects(readExecutionProfile(f.dir,f.task),/FORM_EXECUTION_PROFILE/);
});

function pngHeader(w,h){const b=Buffer.alloc(24);Buffer.from([137,80,78,71,13,10,26,10]).copy(b);b.writeUInt32BE(w,16);b.writeUInt32BE(h,20);return b;}
async function padded(t){
 const f=await fixture(t),original=pngHeader(623,1254),replacement=pngHeader(627,1254),sourcePath=join(f.dir,'original.png');
 await writeFile(sourcePath,original);await mkdir(join(f.dir,'detail-image-padding'));await writeFile(join(f.dir,'detail-image-padding/padded.png'),replacement);
 f.task.assets={details:[{path:sourcePath,sha256:digest(original)}]};
 f.profile.detailImagePadding=[{sourcePath,sourceSha256:digest(original),relativePath:'detail-image-padding/padded.png',sha256:digest(replacement),dimensions:[623,1254],left:2,right:2}];
 await f.save(f.profile);return f;
}
test('explicit padding keeps original task immutable and receipts point to bound derived file',async t=>{
 const f=await padded(t),before=JSON.stringify(f.task),profile=await readExecutionProfile(f.dir,f.task),images=await executionDetailImages(f.task,profile);
 assert.equal(images[0].sourceAsset,f.task.assets.details[0]);assert.deepEqual(images[0].dimensions,[627,1254]);assert.equal(images[0].padding.profileSha256,profile.sha256);assert.equal(JSON.stringify(f.task),before);
 const other={...f.task,assets:{details:[{path:join(f.dir,'other-cover.png'),sha256:'1'.repeat(64)}]}};
 assert.deepEqual(await executionDetailImages(other,profile),other.assets.details);
});
for(const change of ['source-hash','derived-hash','wrong-dimensions','wrong-shop'])test('bound padding rejects '+change,async t=>{
 const f=await padded(t),profile=await readExecutionProfile(f.dir,f.task);
 if(change==='source-hash')await writeFile(f.task.assets.details[0].path,pngHeader(624,1254));
 if(change==='derived-hash')await writeFile(profile.detailImagePadding[0].path,pngHeader(628,1254));
 if(change==='wrong-dimensions')profile.detailImagePadding[0].dimensions=[624,1254];
 if(change==='wrong-shop')profile.shopId='other-shop';
 await assert.rejects(executionDetailImages(f.task,profile),/FORM_DETAIL_PADDING/);
});
for(const change of ['traversal','duplicate','unknown-key','invalid-padding'])test('padding profile rejects '+change,async t=>{
 const f=await padded(t),entry=f.profile.detailImagePadding[0];
 if(change==='traversal')entry.relativePath='../padded.png';
 if(change==='duplicate')f.profile.detailImagePadding.push({...entry});
 if(change==='unknown-key')entry.price=99;
 if(change==='invalid-padding')entry.left=-1;
 await f.save(f.profile);await assert.rejects(readExecutionProfile(f.dir,f.task),/FORM_DETAIL_PADDING/);
});
