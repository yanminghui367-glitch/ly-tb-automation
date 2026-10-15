import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname,resolve} from 'node:path';
import {materialLibrary} from '../material-library.mjs';
test('shop inventory counts shared sets once and excludes nested candidate versions',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'travel-materials-'));
 t.after(async()=>{assert.equal(dirname(resolve(dir)),resolve(tmpdir()));await rm(dir,{recursive:true,force:true});});
 for(const [folder,n] of [['主图',2],['副图--第一套',4],['副图--第二套',4],['详情页',9],['详情页--首图',2],['候选V2/副图--第一套',4]]){
  await mkdir(join(dir,folder),{recursive:true});for(let i=0;i<n;i++)await writeFile(join(dir,folder,`${i}.png`),'synthetic image');
 }
 await writeFile(join(dir,'副图--第一套','说明.txt'),'not an image');
 const task=i=>({assets:{main:[{path:join(dir,'主图',`${i}.png`)}],secondary:[{path:join(dir,'副图--第二套','0.png')}],details:[{path:join(dir,'详情页','0.png')}]}});
 const result=await materialLibrary([task(0),task(0),task(1)]);
 assert.equal(result.main.count,2);assert.equal(result.secondary.count,8);assert.equal(result.secondary.sets.length,2);assert.equal(result.details.count,9);assert.equal(result.covers.count,2);assert.deepEqual(result.warnings,[]);
 assert(!JSON.stringify(result).includes(dir));
 const empty=await materialLibrary([]);assert.equal(empty.status,'unconfigured');assert.equal(empty.secondary.count,0);
 const missing=await materialLibrary([{assets:{main:[{path:join(dir,'missing.png')}]}}]);assert.equal(missing.status,'partial');assert.equal(missing.main.count,0);
});
test('standard nested template inventory includes both sets and covers without mixing archived legacy assets',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'travel-standard-materials-'));
 t.after(async()=>{assert.equal(dirname(resolve(dir)),resolve(tmpdir()));await rm(dir,{recursive:true,force:true});});
 for(const [folder,n] of [['主图',2],['副图/A',4],['副图/B',4],['详情正文',8],['详情首页',2],['副图--第一套',4],['_交接/副图/A',4],['副图/A/候选',2]]){
  await mkdir(join(dir,folder),{recursive:true});for(let i=0;i<n;i++)await writeFile(join(dir,folder,`${i}.png`),'synthetic image');
 }
 const task=i=>({assets:{main:[{path:join(dir,'主图',`${i}.png`)}],secondary:[{path:join(dir,'副图/A','0.png')}],details:[{path:join(dir,'详情首页','0.png')},{path:join(dir,'详情正文','0.png')}]}});
 const previews=[];
 const result=await materialLibrary([task(0),task(0),task(1)],{assetUrl:p=>{previews.push(p);return '/preview/'+previews.length;}});
 assert.equal(result.status,'ready');assert.deepEqual(result.warnings,[]);
 assert.equal(result.main.count,2);assert.equal(result.secondary.count,8);assert.equal(result.details.count,8);assert.equal(result.covers.count,2);
 assert.deepEqual(result.secondary.sets.map(s=>s.name),['副图/A','副图/B']);assert.equal(previews.length,18);
 assert(previews.every(p=>!p.includes('_交接')&&!p.includes('候选')&&!p.includes('副图--')));
});
