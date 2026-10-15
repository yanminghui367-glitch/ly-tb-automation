import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {EventEmitter} from 'node:events';
import {ShopExecutions,DEFAULT_EXECUTION_SHOP as W} from '../shop-execution.mjs';
import {TravelOsApi} from '../travel-os-api.mjs';
import {destinationKey,digest} from '../source-store.mjs';
import {shopUrl} from '../shop-scope.js';

const H='shop-7949a469';
const shops=[{id:W,name:'五洲畅游',port:19222},{id:H,name:'环球领航',port:19228}];
const task=id=>({shopId:id,priority:1,source:{workbook:'synthetic.xlsx',sheet:'商品清单',row:2,sha256:'fixture'},listing:{type:'country',country:'隔离测试国',city:null,title:'隔离测试国导游',titleVersions:['隔离测试国导游','隔离测试国地陪'],selectedTitleIndex:0,guideTitle:'隔离测试国导游'},business:{price_cny:'20',inventory:'10'},assets:{main:[],secondary:[],details:[]},adapterIssues:[]});
async function fixture(t){
 const dir=await mkdtemp(join(tmpdir(),'toni-hqlh-independent-'));
 const owner={sessions:new Map(),status:async s=>({running:true,loggedIn:true,loginState:'LOGGED_IN',checkedAt:new Date().toISOString(),shopId:s.id})};
 const opts={runtime:dir,artifacts:join(dir,'artifacts'),owner,shops:async()=>shops,launch:async()=>{throw Error('NO_BROWSER_IN_QA');},integrity:async()=>({ok:true}),checkFiles:async()=>{},isShopRemoved:id=>os?.store.removed(id)||false};
 let os;const manager=new ShopExecutions(opts),managers=[manager];const w=await manager.product(W),h=await manager.product(H);
 os=new TravelOsApi({product:id=>manager.product(id),shops:async()=>shops,browser:owner,launch:opts.launch,runtime:dir});
 const products=[];for(const p of [w,h]){const a=task(p.shop.id),id=p.source.store.imported({sourceHash:'SYNTHETIC-'+p.shop.id,format:'travel-os-template-v2',tasks:[a],summary:{total:1}});products.push({key:destinationKey(a),shopId:p.shop.id,destination:a.listing.country,source:{importId:id}});}
 os.catalog=async()=>({products,shops});
 t.after(async()=>{for(const m of managers){await m.shutdown();for(const e of m.entries.values())e.source.store.close();}os.store.db.close();assert.equal(dirname(resolve(dir)),resolve(tmpdir()));await rm(dir,{recursive:true,force:true});});
 const call=(scope,action,input)=>manager.run(scope,async()=>{let data;await os.handle({method:'POST'},{},new URL('http://fixture/api/os/'+action),{body:async()=>input,json:(_r,_s,d)=>data=d});return data;});
 return {dir,manager,w,h,os,products,call,opts,managers};
}
test('default DB location remains original; HQLH settings, imports and history remain isolated',async t=>{
 const x=await fixture(t);assert.equal(x.w.runtime,x.dir);assert.equal(x.h.runtime,join(x.dir,'shop-execution',H));
 await x.w.saveSettings({heat:'old-w',pool:'old-p',assets:'old-a',limit:9});
 const before=await readFile(x.w.settingsFile,'utf8');x.w.source.store.history(task(W),{itemId:'123',source:'synthetic'});
 await x.h.saveSettings({heat:'h-heat',pool:'h-pool',assets:'h-assets',limit:3});
 assert.equal(await readFile(x.w.settingsFile,'utf8'),before);assert.equal((await x.h.settings()).executionEnabled,false);
 assert.equal(x.h.source.store.completed(task(W)),null);assert.equal(x.w.source.store.batch().tasks[0].shopId,W);assert.equal(x.h.source.store.batch().tasks[0].shopId,H);
});
test('overlapping AsyncLocalStorage requests retain independent scope across awaits',async t=>{
 const x=await fixture(t);let release;const barrier=new Promise(r=>release=r);
 const a=x.manager.run(W,async()=>{await barrier;assert.equal((await x.manager.product()).shop.id,W);await Promise.resolve();assert.equal(x.manager.current().product,x.w);});
 const b=x.manager.run(H,async()=>{release();await Promise.resolve();assert.equal((await x.manager.product()).shop.id,H);assert.equal(x.manager.current().product,x.h);});
 await Promise.all([a,b]);assert.equal(x.manager.id(),W);
 const list=await Promise.all(Array.from({length:8},()=>x.manager.product(H)));assert.ok(list.every(p=>p===x.h));
});
test('unknown or removed execution shop cannot silently fall back to Wuzhou',async t=>{
 const x=await fixture(t);await assert.rejects(x.manager.product('unknown'),/适配|不存在/);x.os.store.removeShop(H);await assert.rejects(x.manager.product(H),/移除/);assert.equal((await x.manager.product(W)).shop.id,W);
});
test('HQLH source start rejects wrong shop before constructing a run',async t=>{
 const x=await fixture(t);const imported=x.h.source.store.batch();
 await assert.rejects(x.h.source.start({batchId:imported.id,order:1},shops[0]),/店铺不匹配/);assert.equal(x.h.source.store.list().length,0);assert.equal(x.w.source.store.list().length,0);
});
test('selected-create with current scope W and body H must never write H queue into W DB',async t=>{
 const x=await fixture(t),d=x.products.find(p=>p.shopId===H),a=task(H);
 try{await x.call(W,'selected-create',{shopId:H,productKey:d.key,mode:'DRY_RUN',review:{reviewed:true,authorization:'isolated fixture only',selectionHash:digest([a])}});}catch(e){assert.match(e.message,/店铺|范围|匹配|执行环境/);}
 assert.equal(x.w.source.store.db.prepare('SELECT COUNT(*) n FROM batches').get().n,0,'cross-shop queue was written into Wuzhou DB');
 assert.equal(x.w.source.store.db.prepare('SELECT COUNT(*) n FROM batch_items').get().n,0);
});
test('shop removal checks target shop pending queue rather than current scope queue',async t=>{
 const x=await fixture(t),a=task(H);x.h.batch.store.create(x.h.source.store.batch().id,[a],H,'DRY_RUN',{reviewed:true,authorization:'isolated fixture',selectionHash:digest([a])});
 await assert.rejects(x.call(W,'shops/remove',{shopId:H,confirmName:'环球领航'}),/任务|核验|移除|范围|店铺/);assert.equal(x.os.store.removed(H),false);
});
test('same-shop HQLH selected-create succeeds without touching an existing paused Wuzhou batch',async t=>{
 const x=await fixture(t),wa=task(W),ha=task(H);
 const old=x.w.batch.store.create(x.w.source.store.batch().id,[wa],W,'DRY_RUN',{reviewed:true,authorization:'isolated fixture',selectionHash:digest([wa])});x.w.batch.store.setBatch(old.id,'PAUSED','fixture preserved');
 const baseline=JSON.stringify({batch:x.w.batch.store.batch(old.id),items:x.w.batch.store.items(old.id),events:x.w.batch.store.events(old.id)});
 const result=await x.call(H,'selected-create',{shopId:H,productKey:destinationKey(ha),mode:'DRY_RUN',review:{reviewed:true,authorization:'isolated fixture',selectionHash:digest([ha])}});
 assert.equal(result.shop,H);assert.equal(x.h.batch.store.items(result.id)[0].task.shopId,H);
 assert.equal(JSON.stringify({batch:x.w.batch.store.batch(old.id),items:x.w.batch.store.items(old.id),events:x.w.batch.store.events(old.id)}),baseline);
});
test('reopening both scoped environments retains paused queues and never autostarts',async t=>{
 const x=await fixture(t);const saved=[];
 for(const p of [x.w,x.h]){const a=task(p.shop.id),b=p.batch.store.create(p.source.store.batch().id,[a],p.shop.id,'DRY_RUN',{reviewed:true,authorization:'isolated fixture',selectionHash:digest([a])});p.batch.store.setBatch(b.id,'PAUSED','keep original pause');saved.push({shop:p.shop.id,batch:p.batch.store.batch(b.id),items:p.batch.store.items(b.id)});}
 await x.manager.shutdown();for(const e of x.manager.entries.values())e.source.store.close();x.manager.entries.clear();
 const reopened=new ShopExecutions(x.opts);x.managers.push(reopened);
 for(const original of saved){const p=await reopened.product(original.shop);assert.deepEqual(p.batch.store.batch(original.batch.id),original.batch);assert.deepEqual(p.batch.store.items(original.batch.id),original.items);assert.equal(p.source.active,null);assert.equal(p.batch.active,null);}
});
test('independent SSE streams remain bound to original product during another shop request',async t=>{
 const x=await fixture(t);class Response extends EventEmitter{frames=[];writeHead(){}write(s){this.frames.push(s);return true;}end(){this.emit('finish');}destroy(){this.emit('close');}}
 const a=new Response(),b=new Response();x.w.snapshot=async()=>{await Promise.resolve();return {shop:{id:W}};};x.h.snapshot=async()=>({shop:{id:H}});
 await Promise.all([x.manager.run(W,()=>x.w.handle({method:'GET'},a,new URL('http://fixture/api/v1/events'),{json(){},body(){}})),x.manager.run(H,()=>x.h.handle({method:'GET'},b,new URL('http://fixture/api/v1/events'),{json(){},body(){}}))]);
 assert.match(a.frames.join(''),/wuzhou-changyou/);assert.doesNotMatch(a.frames.join(''),/shop-7949a469/);assert.match(b.frames.join(''),/shop-7949a469/);assert.doesNotMatch(b.frames.join(''),/wuzhou-changyou/);x.w.closeStreams();assert.equal(x.h.streams.size,1);x.h.closeStreams();
});
test('asset/export URL scope helper preserves explicit shop and existing query',()=>{
 assert.equal(shopUrl('/api/v1/task?id=abc',H),'/api/v1/task?id=abc&executionShop='+H);
 assert.equal(shopUrl('/api/v1/task?id=abc&executionShop='+W,H),'/api/v1/task?id=abc&executionShop='+W);
 assert.equal(shopUrl('https://example.test/',H),'https://example.test/');
});
