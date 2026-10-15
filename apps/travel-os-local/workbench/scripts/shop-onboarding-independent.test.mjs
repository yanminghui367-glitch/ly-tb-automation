import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile,readdir,mkdir} from 'node:fs/promises';
import {join,dirname,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {ShopExecutions,DEFAULT_EXECUTION_SHOP as W} from '../shop-execution.mjs';
import {TravelOsApi} from '../travel-os-api.mjs';
import {destinationKey} from '../source-store.mjs';

const A='shop-a1b2c3d4',B='shop-e5f6a7b8';
const syntheticTask=id=>({shopId:id,priority:1,source:{workbook:'synthetic.xlsx',sheet:'商品清单',row:2,sha256:'fixture'},listing:{type:'country',country:'隔离测试国家',city:null,title:'隔离测试国家导游'},business:{price_cny:'20',inventory:'10'},assets:{main:[],secondary:[],details:[]},adapterIssues:[]});
async function fixture(t){
 const testRoot=resolve('../output/shop-onboarding-20261015/independent-fixtures');
 await mkdir(testRoot,{recursive:true});const dir=await mkdtemp(join(testRoot,'toni-onboarding-'));
 const shops=[{id:W,name:'五洲畅游',port:19222},{id:A,name:'独立测试甲',port:19301},{id:B,name:'独立测试乙',port:19302}];
 const removed=new Set(),owner={sessions:new Map(),status:async s=>({running:false,loggedIn:false,shopId:s.id})};
 const opts={runtime:dir,artifacts:join(dir,'artifacts'),owner,shops:async()=>shops,isShopRemoved:id=>removed.has(id),launch:async()=>{throw Error('NO_REAL_BROWSER_IN_QA');},integrity:async()=>({ok:true}),checkFiles:async()=>{}};
 const manager=new ShopExecutions(opts),managers=[manager];
 const os=new TravelOsApi({product:id=>manager.product(id),shops:opts.shops,browser:owner,launch:opts.launch,runtime:dir});
 const cleanup={run:async()=>{}};
 t.after(async()=>{await cleanup.run();for(const m of managers){await m.shutdown();for(const e of m.entries.values())e.source.store.close();}os.store.close();assert.equal(dirname(resolve(dir)),testRoot);await rm(dir,{recursive:true,force:true});});
 const call=(scope,action,input)=>manager.run(scope,async()=>{let result;await os.handle({method:'POST'},{},new URL('http://fixture/api/os/'+action),{body:async()=>input,json:(_r,_s,v)=>result=v});return result;});
 return {dir,shops,removed,opts,manager,managers,os,call,cleanup};
}

test('arbitrary registered stores get isolated blank execution environments without shop-specific code',async t=>{
 const x=await fixture(t),w=await x.manager.product(W),a=await x.manager.product(A),b=await x.manager.product(B);
 assert.equal(w.runtime,x.dir);assert.equal(a.runtime,join(x.dir,'shop-execution',A));assert.notEqual(a.runtime,b.runtime);
 for(const p of [a,b]){const s=await p.settings();assert.equal(s.executionEnabled,false);assert.equal(s.pool,'');assert.equal(s.assets,'');assert.equal(p.source.store.list().length,0);}
 await a.saveSettings({pool:'only-a.xlsx'});assert.equal((await b.settings()).pool,'');assert.notEqual((await w.settings()).pool,'only-a.xlsx');
});

test('unknown and removed shops fail even if a cached environment previously existed',async t=>{
 const x=await fixture(t);await assert.rejects(x.manager.product('shop-ffffffff'));
 await x.manager.product(A);x.removed.add(A);await assert.rejects(x.manager.product(A));
 for(const bad of ['../escape','shop/escape','',null]){if(bad!==null&&bad!=='')await assert.rejects(x.manager.product(bad));}
 x.shops.splice(x.shops.findIndex(s=>s.id===B),1);await assert.rejects(x.manager.product(B));
});

test('overlapping async requests retain their own shop scope and singleton',async t=>{
 const x=await fixture(t);let release;const gate=new Promise(r=>release=r);
 const first=x.manager.run(A,async()=>{const p=await x.manager.product();await gate;assert.equal(x.manager.id(),A);assert.equal(await x.manager.product(),p);return p;});
 const second=await x.manager.run(B,async()=>{const p=await x.manager.product();release();await Promise.resolve();assert.equal(x.manager.id(),B);return p;});
 assert.notEqual(await first,second);assert.equal(x.manager.id(),W);
});

test('upload session is bound to shop and remains bound when storage is shared',async t=>{
 const x=await fixture(t),a=await x.manager.product(A),b=await x.manager.product(B),root=join(x.dir,'shared-storage');
 await a.setup.storage({path:root});await b.setup.storage({path:root});
 const s=await a.setup.upload({begin:true});const disk=JSON.parse(await readFile(join(a.setup.sessions,s.id+'.json'),'utf8'));
 assert.equal(disk.shopId,A);
 await assert.rejects(b.setup.upload({id:s.id,name:'foreign.png',data:'YQ=='}));
 assert.deepEqual(await readdir(s.root),[]);
 disk.shopId=B;await writeFile(join(a.setup.sessions,s.id+'.json'),JSON.stringify(disk));
 await assert.rejects(a.setup.upload({id:s.id,name:'tampered.png',data:'YQ=='}));
 assert.deepEqual(await readdir(s.root),[]);
});

test('conflicting body shop cannot begin upload in request scoped shop',async t=>{
 const x=await fixture(t),a=await x.manager.product(A);await a.setup.storage({path:join(x.dir,'uploads')});
 const before=await readdir(a.setup.sessions).catch(()=>[]);
 await assert.rejects(a.setup.handle({method:'POST'},{},new URL('http://fixture/api/v1/setup/upload?executionShop='+A),{body:async()=>({shopId:B,begin:true}),json:()=>{}}));
 assert.deepEqual(await readdir(a.setup.sessions).catch(()=>[]),before);
});

test('new manager restores only selected shop settings and unfinished upload without enabling execution',async t=>{
 const x=await fixture(t),a=await x.manager.product(A);await a.setup.storage({path:join(x.dir,'upload-a')});
 const s=await a.setup.upload({begin:true});await a.saveSettings({pool:'a-only.xlsx'});
 const next=new ShopExecutions(x.opts);x.managers.push(next);const reopened=await next.product(A),b=await next.product(B);
 assert.equal((await reopened.settings()).pool,'a-only.xlsx');assert.equal((await reopened.settings()).executionEnabled,false);assert.equal((await b.settings()).pool,'');
 await reopened.setup.upload({id:s.id,name:'kept.png',data:'YQ=='});assert.equal(await readFile(join(s.root,'kept.png'),'utf8'),'a');
});

test('preparation cannot attach store A product to store B',async t=>{
 const x=await fixture(t),a=await x.manager.product(A);await x.manager.product(B);
 const task=syntheticTask(A),id=a.source.store.imported({sourceHash:'fixture-A',tasks:[task],summary:{total:1}}),product={key:destinationKey(task),shopId:A,destination:'隔离测试国家',source:{importId:id}};
 x.os.catalog=async()=>({products:[product],shops:x.shops});
 await assert.rejects(x.call(B,'preparations/create',{shopId:B,productKey:product.key,requestId:randomUUID()}));assert.equal(x.os.store.preparations().length,0);
});

test('selected creation rejects conflicting request scope before mutating either shop queue',async t=>{
 const x=await fixture(t),a=await x.manager.product(A),b=await x.manager.product(B),task=syntheticTask(B);
 const id=b.source.store.imported({sourceHash:'fixture-B',tasks:[task],summary:{total:1}}),product={key:destinationKey(task),shopId:B,destination:'隔离测试国家',source:{importId:id}};
 x.os.catalog=async()=>({products:[product],shops:x.shops});
 await assert.rejects(x.call(A,'selected-create',{shopId:B,productKey:product.key,mode:'DRY_RUN',review:{reviewed:true}}));
 for(const p of [a,b])assert.equal(p.source.store.db.prepare('SELECT COUNT(*) n FROM batches').get().n,0);
});

test('product catalog details, historical log and settings follow selected shop rather than URL shop',async t=>{
 const {fork}=await import('node:child_process'),{createServer}=await import('node:net'),{chromium}=await import('playwright');
 const x=await fixture(t);await writeFile(join(x.dir,'shops.json'),JSON.stringify(x.shops));
 const probe=createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
 const child=fork(new URL('./shop-http-fixture.mjs',import.meta.url),[],{env:{...process.env,WORKBENCH_NO_LISTEN:'1',WORKBENCH_TEST_RUNTIME:x.dir,WORKBENCH_PORT:String(port),SHOP_FIXTURE_PORT:String(port)},stdio:['ignore','ignore','pipe','ipc']});
 await new Promise((r,j)=>{child.once('message',r);child.once('exit',()=>j(Error('isolated fixture failed')));});
 const browser=await chromium.launch({channel:'chrome',headless:true});
 x.cleanup.run=async()=>{await browser.close();if(child.exitCode===null){const done=new Promise(r=>child.once('exit',r));child.kill();await done;}};
 const page=await browser.newPage(),base='http://127.0.0.1:'+port,seen=[],errors=[];
 page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));
 const rows=[{key:'round-key',destination:'有轮次商品',country:'测试国',title:'测试国导游',roundId:'round-b',windowId:'window-b',runId:'run-b',status:'AVAILABLE'},{key:'old-key',destination:'旧日志商品',country:'测试国',title:'测试国地陪',runId:'old-run-b',status:'AVAILABLE'}];
 await page.route('**/*',async route=>{
  const u=new URL(route.request().url());if(u.origin!==base)return route.abort();
  if(u.pathname==='/api/os/operations')return route.fulfill({json:{packages:[{id:'fixture-import',name:'独立合成资料',total:2}],selectedPackage:{id:'fixture-import'},counts:{AVAILABLE:2},items:u.searchParams.get('shopId')===B?rows:[]}});
  if(u.pathname==='/api/v1/rounds/item'||u.pathname==='/api/v1/task'){seen.push({path:u.pathname,scope:u.searchParams.get('executionShop'),id:u.searchParams.get('id')});return route.fulfill({status:409,json:{error:'独立QA合成记录：仅验证UI请求归属，不执行操作'}});}
  return route.continue();
 });
 await page.goto(base+'/travel-os.html?shop='+A+'#products');await page.locator('#opsShop').selectOption(B);
 await Promise.all([page.waitForResponse(r=>new URL(r.url()).pathname==='/api/v1/rounds/item'),page.locator('[data-ops-row="round-key"] [data-ops="detail"]').click()]);
 assert.deepEqual(seen[0],{path:'/api/v1/rounds/item',scope:B,id:null});
 await page.getByRole('button',{name:'关闭对话框',exact:true}).click();
 await page.locator('[data-ops-row="old-key"] [data-ops="detail"]').click();
 await Promise.all([page.waitForResponse(r=>new URL(r.url()).pathname==='/api/v1/task'),page.locator('[data-action="ops-run-evidence"]').click()]);
 assert(seen.some(r=>r.path==='/api/v1/task'&&r.scope===B&&r.id==='old-run-b'));
 await page.locator('[data-ops-settings]').click();await page.waitForURL(new RegExp('shop='+B+'#settings'));
 assert.equal(await page.locator('#setupExecutionShop').inputValue(),B);assert.deepEqual(errors,[]);
 await writeFile(resolve('../output/shop-onboarding-20261015/toni-detail-scope-ui.json'),JSON.stringify({checks:['round detail follows selected shop','old run log follows selected shop','settings follows selected shop'],seen,errors,productionRequests:0},null,2));
});
