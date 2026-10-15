import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {fork,execFileSync} from 'node:child_process';
import {templateUploadFiles,templateRelativeFile} from '../setup-files.js';
import {shopUrl} from '../shop-scope.js';

test('standard folder upload excludes archived, nested candidate and unrelated workbook files',()=>{
 const paths=['商品资料.xlsx','主图/图.png','副图/A/a.jpg','副图/B/b.webp','详情首页/首页.png','详情正文/正文.jpeg','_交接/主图/旧.png','主图/候选/图.png','参考.xlsx','说明.txt'];
 const selected=templateUploadFiles(paths.map(path=>({webkitRelativePath:'店铺套图/'+path,name:path.split('/').at(-1)})));
 assert.deepEqual(selected.map(templateRelativeFile),paths.slice(0,6));
 assert.match(shopUrl('/api/v1/settings'),/executionShop=wuzhou-changyou/);
});

test('real HTTP new-store onboarding binds standard source, rejects wrong scope and retains data after reload',async t=>{
 const parent=resolve('../output/shop-onboarding-20261015/http');await mkdir(parent,{recursive:true});
 const dir=await mkdtemp(join(parent,'fixture-'));
 await writeFile(join(dir,'shops.json'),JSON.stringify([{id:'wuzhou-changyou',name:'五洲畅游',port:9222}]));
 let child,base;
 const start=async()=>{child=fork(new URL('./shop-http-fixture.mjs',import.meta.url),[],{env:{...process.env,WORKBENCH_NO_LISTEN:'1',WORKBENCH_TEST_RUNTIME:dir},stdio:['ignore','ignore','pipe','ipc']});let error='';child.stderr.on('data',x=>error+=x);const port=await new Promise((r,j)=>{child.once('message',x=>r(x.port));child.once('exit',()=>j(Error(error)));});base='http://127.0.0.1:'+port;};
 const stop=async()=>{if(child?.exitCode!==null)return;const exited=new Promise(r=>child.once('exit',r));child.kill();await exited;};
 t.after(async()=>{await stop();assert.equal(resolve(dir,'..'),parent);await rm(dir,{recursive:true,force:true});});
 const req=async(path,input)=>{const r=await fetch(base+path,{method:input===undefined?'GET':'POST',headers:{Origin:'http://127.0.0.1:4318','Content-Type':'application/json'},body:input===undefined?undefined:JSON.stringify(input)});return {status:r.status,data:await r.json()};};
 await start();
 const shop=(await req('/api/os/shops/add?executionShop=wuzhou-changyou',{name:'隔离新店'})).data;assert.match(shop.id,/^shop-/);
 const scope='?executionShop='+shop.id;
 let state=(await req('/api/v1/state'+scope)).data;assert.equal(state.shop.id,shop.id);assert.equal(state.settings.executionEnabled,false);assert.equal(state.settings.assets,'');
 const os=(await req('/api/os/state'+scope)).data;assert.equal(os.shops.find(s=>s.id===shop.id).executionSupported,true);
 for(const bad of ['?executionShop=','?executionShop=missing','?executionShop='+shop.id+'&executionShop=wuzhou-changyou'])assert.equal((await req('/api/v1/state'+bad)).status,409);
 assert.equal((await req('/api/v1/settings'+scope,{shopId:'wuzhou-changyou',assets:'wrong'})).status,409);
 assert.equal((await req('/api/v1/setup/upload'+scope,{begin:true,shopId:'wuzhou-changyou'})).status,409);
 const root=join(dir,'source');execFileSync('python',[resolve('scripts/setup-fixture.py'),root,'--count','2','--version','2'],{windowsHide:true});
 assert.equal((await req('/api/v1/setup/import'+scope,{format:'standard',root})).status,409);
 execFileSync('python',['-c',"from zipfile import ZipFile;from pathlib import Path;import sys;p=Path(sys.argv[1]);z=ZipFile(p);d={n:z.read(n) for n in z.namelist()};z.close();z=ZipFile(p,'w');[z.writestr(n,v.replace('五洲畅游'.encode(),'隔离新店'.encode())) for n,v in d.items()];z.close()",join(root,'商品资料.xlsx')],{windowsHide:true});
 const imported=await req('/api/v1/setup/import'+scope,{format:'standard',root,shopId:shop.id});assert.equal(imported.status,200);assert.equal(imported.data.summary.total,2);
 state=(await req('/api/v1/setup/state'+scope)).data;assert.equal(state.source.binding.shopId,shop.id);assert.equal(state.source.binding.shopCode,'WZC');
 assert.equal((await req('/api/v1/state')).data.latestImport,null);
 const counts=(await req('/api/os/state'+scope)).data.materials[shop.id];assert.equal(counts.secondary.count,8);assert.equal(counts.details.count,7);assert.equal(counts.covers.count,2);
 await stop();await start();const restored=(await req('/api/v1/state'+scope)).data;assert.equal(restored.latestImport,imported.data.importId);assert.equal(restored.settings.executionEnabled,false);assert.equal(restored.batch,null);
 assert.equal((await req('/api/v1/state')).data.latestImport,null);
 const settings=JSON.parse(await readFile(join(dir,'shop-execution',shop.id,'product-v1/settings.json'),'utf8'));assert.equal(settings.assets,root);
});
