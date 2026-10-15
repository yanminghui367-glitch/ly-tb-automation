import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {ShopExecutions} from '../shop-execution.mjs';
import {TravelOsApi} from '../travel-os-api.mjs';
import {digest} from '../source-store.mjs';
const shops=[{id:'wuzhou-changyou',name:'五洲畅游',port:9222},{id:'shop-7949a469',name:'环球领航',port:9230}];
async function fixture(t){
 await mkdir(resolve('../output/hqlh-adaptation-20261015/tests'),{recursive:true});const runtime=await mkdtemp(resolve('../output/hqlh-adaptation-20261015/tests/shop-isolation-'));
 const closers=[];const seen=[];const owner={sessions:new Map(),status:async shop=>{seen.push(shop.id);return {running:true,loggedIn:true,loginState:'LOGGED_IN',checkedAt:new Date().toISOString()};}};
 const registry=new ShopExecutions({runtime,artifacts:join(runtime,'artifacts'),owner,shops:async()=>shops,launch:async s=>seen.push(s.id),integrity:async()=>({ok:true}),checkFiles:async()=>{},isShopRemoved:()=>false});
 t.after(async()=>{for(const close of closers)close();for(const e of registry.entries.values())e.source.store.close();await rm(runtime,{recursive:true,force:true});});
 return {runtime,registry,seen,owner,closers};
}
test('request scopes stay independent across concurrent awaits and unknown shops fail closed',async t=>{
 const x=await fixture(t);
 const values=await Promise.all(shops.map((s,i)=>x.registry.run(s.id,async()=>{await new Promise(r=>setTimeout(r,i?1:10));const p=await x.registry.product();await new Promise(r=>setTimeout(r,i?10:1));assert.equal(x.registry.current().product,p);return p.shop.id;})));
 assert.deepEqual(values,shops.map(s=>s.id));assert.equal(x.registry.id(),'wuzhou-changyou');
 await assert.rejects(x.registry.product('../other'),/适配/);await assert.rejects(x.registry.product('shop-unrelated'),/适配/);
});
test('shop settings, imports, queues and browser identity are isolated; shared website policy is inherited',async t=>{
 const x=await fixture(t),a=await x.registry.product(shops[0].id),b=await x.registry.product(shops[1].id);
 assert.notEqual(a.settingsFile,b.settingsFile);assert.equal((await b.settings()).pool,'');
 await a.saveSettings({executionEnabled:true,confirmShop:shops[0].name,pool:'old-pool',assets:'old-assets'});
 await a.saveSettings({ignoreExternalDestinationProducts:true,listingDefaultsScope:'WEBSITE_DEFAULT',confirmAllShops:true});
 assert.equal((await b.settings()).executionEnabled,false);assert.equal((await b.settings()).listingDefaults.scope,'WEBSITE_DEFAULT');
 await b.saveSettings({pool:'hqlh-pool',assets:'hqlh-assets'});assert.equal((await a.settings()).pool,'old-pool');
 const task=shop=>({shopId:shop.id,priority:1,source:{row:2},listing:{country:'测试国',city:null,type:'country',title:'测试'},business:{shop_name:shop.name,price_cny:20,inventory:1},adapterIssues:[],assets:{main:[],secondary:[],details:[]}});
 const ta=task(shops[0]),tb=task(shops[1]),ia=a.source.store.imported({sourceHash:'A',tasks:[ta]}),ib=b.source.store.imported({sourceHash:'B',tasks:[tb]});
 assert.equal(a.source.store.batch(ib),null);assert.equal(b.source.store.batch(ia),null);
 const old=a.source.store.create(ia,ta,'DRY_RUN','SOURCE',{taskHash:digest(ta),reviewed:true});
 await assert.rejects(b.source.resume({id:old.id},shops[1]),/不存在/);
 b.source.launch=(_id,shop)=>x.seen.push(shop.id);
 await assert.rejects(b.source.start({batchId:ib,order:1},shops[0]),/不匹配/);
 await b.source.start({batchId:ib,order:1,review:{taskHash:digest(tb),reviewed:true}},shops[1]);
 assert.equal(x.seen.at(-1),shops[1].id);assert.equal(a.source.store.run(old.id).state,'QUEUED');
 assert.equal(a.source.store.list().length,1);assert.equal(b.source.store.list().length,1);
});
test('standard template binds to 环球, rejects wrong workbook shop, and preserves original store byte contents',async t=>{
 const x=await fixture(t),a=await x.registry.product(shops[0].id),b=await x.registry.product(shops[1].id),root=join(x.runtime,'fixture');
 execFileSync('python',[resolve('scripts/setup-fixture.py'),root,'--count','2'],{windowsHide:true});
 await assert.rejects(b.setup.importSource({format:'standard',root}),/店铺名称/);
 execFileSync('python',['-c',"from zipfile import ZipFile;from pathlib import Path;import sys;p=Path(sys.argv[1]);z=ZipFile(p);d={n:z.read(n) for n in z.namelist()};z.close();d={n:v.replace('五洲畅游'.encode(),'环球领航'.encode()) for n,v in d.items()};z=ZipFile(p,'w');[z.writestr(n,v) for n,v in d.items()];z.close()",join(root,'商品资料.xlsx')],{windowsHide:true});
 const before=JSON.stringify(a.source.store.db.prepare('SELECT * FROM imports').all());
 const result=await b.setup.importSource({format:'standard',root});assert.equal(result.summary.total,2);assert.equal(result.issues.length,0);
 assert.ok(b.source.store.batch().tasks.every(task=>task.shopId===shops[1].id));assert.equal((await b.settings()).assets,root);
 assert.equal(JSON.stringify(a.source.store.db.prepare('SELECT * FROM imports').all()),before);assert.equal(a.source.store.batch(),null);
 await assert.rejects(b.setup.importSource({format:'legacy'}),/标准模板/);
 const catalog=new TravelOsApi({runtime:x.runtime,product:id=>x.registry.product(id),shops:async()=>shops,browser:x.owner,launch:async()=>{},addShop:async()=>{}});
 x.closers.push(()=>catalog.store.db.close());
 const state=await x.registry.run(shops[1].id,()=>catalog.snapshot());
 assert.equal(state.engine.shop.id,shops[1].id);assert.equal(state.products.length,2);assert.equal(state.shops.find(s=>s.id===shops[1].id).products,2);
 assert.ok(state.products.every(p=>p.shopId===shops[1].id));
 assert.ok(state.products.every(p=>p.materials.every(m=>m.url.includes('executionShop=shop-7949a469'))));
});
