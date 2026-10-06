import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {SourceStore,digest} from '../source-store.mjs';
import {BatchWorkflow} from '../batch-workflow.mjs';
import {ProductApi} from '../product-api.mjs';
import {submissionWindow,validateListing} from '../result-reconciliation.mjs';

async function fixture(t){
 const dir=await mkdtemp(join(tmpdir(),'travel-associate-')),store=new SourceStore(join(dir,'state.sqlite'));
 t.after(async()=>{store.close();assert.equal(dirname(resolve(dir)),resolve(tmpdir()));await rm(dir,{recursive:true,force:true});});
 const shop={id:'isolation-only',name:'隔离店铺'},tasks=[1,2].map(n=>({shopId:shop.id,priority:n,source:{sheet:'境外城市热度'},listing:{type:'city',country:'测试国',city:'城市'+n,title:'原始商品'+n},business:{shop_name:shop.name,price_cny:20,inventory:100},assets:{main:[],secondary:[],details:[]},adapterIssues:[]}));
 const imported=store.imported({sheet:'境外城市热度',sourceHash:'FIXTURE',tasks});
 const flow={store,active:null,runtime:dir,artifacts:join(dir,'artifacts'),pause(){this.stop=true;},launch(){throw Error('MUST_NOT_LAUNCH');}};
 const batch=new BatchWorkflow(flow),context={pages:()=>[],newPage:()=>{throw Error('NO_BROWSER');}},owner={sessions:new Map([[shop.id,{context}]]),status:async()=>({running:true,loggedIn:true,loginState:'LOGGED_IN'})};
 const api=new ProductApi({source:flow,batch,owner,shop,runtime:dir,integrity:async()=>({ok:true}),launch:async()=>{throw Error('NO_BROWSER');}});
 const b=batch.create({importId:imported,limit:2,mode:'LIVE',review:{reviewed:true,selectionHash:batch.preview(imported,2).selectionHash,authorization:'isolated'}},shop);
 const item=batch.store.items(b.id)[0];batch.store.claim(item.id);
 const run=store.create(imported,tasks[0],'LIVE','SOURCE',{reviewed:true,taskHash:digest(tasks[0])});batch.store.attach(item.id,run.id);
 store.move(run.id,'RUNNING');store.move(run.id,'SUBMITTING');store.move(run.id,'RESULT_UNKNOWN','isolated unknown');batch.store.move(item.id,'WAITING_HUMAN');batch.store.setBatch(b.id,'WAITING_HUMAN');
 let queries=0;api.reconciliation.inspect=async({itemId,dir,guard})=>{queries++;await guard();await mkdir(dir,{recursive:true});const screenshot=join(dir,'fixture.png');await writeFile(screenshot,Buffer.from([137,80,78,71,13,10,26,10,0]));return {itemId,screenshot,status:'出售中',rowText:'isolated evidence',verifiedAt:new Date().toISOString(),createdAt:'2026-10-04 12:31'};};
 const input={id:run.id,itemId:'1088061246413',requestId:randomUUID(),confirmed:true};
 return {dir,api,store,batch,flow,owner,context,shop,b,run,item,tasks,input,queries:()=>queries};
}
test('successful association commits original run, history and queue atomically without starting remaining tasks',async t=>{
 const x=await fixture(t),taskBefore=digest(x.run.task),r=await x.api.reconciliation.associate(x.input);
 assert.equal(r.batchContinued,false);assert.equal(x.store.run(x.run.id).state,'VERIFIED');assert.equal(digest(x.store.run(x.run.id).task),taskBefore);
 assert.equal(x.batch.store.item(x.item.id).state,'SUCCEEDED');assert.equal(x.batch.store.items(x.b.id)[1].state,'PENDING');assert.equal(x.batch.store.batch(x.b.id).state,'PAUSED');
 assert.equal(x.flow.active,null);assert.equal(x.store.completed(x.tasks[0]).itemId,x.input.itemId);
 assert.equal(x.store.events(x.run.id).filter(e=>e.kind==='SUBMITTING').length,1);
 assert.equal((await x.api.reconciliation.associate(x.input)).replayed,true);assert.equal(x.queries(),1);
});
test('wrong shop, changed identity, captcha and missing kernel integrity never write success',async t=>{
 for(const kind of ['shop','login','captcha','kernel','context']){
  const x=await fixture(t);
  if(kind==='shop')x.api.shop={id:'wrong',name:'wrong'};
  if(kind==='login')x.owner.status=async()=>({running:true,loggedIn:false});
  if(kind==='captcha')x.owner.status=async()=>({running:true,loggedIn:true,loginState:'PAUSED_CAPTCHA'});
  if(kind==='kernel')x.api.integrity=async()=>({ok:false});
  if(kind==='context')x.owner.status=async()=>{x.owner.sessions.set(x.shop.id,{context:{}});return {running:true,loggedIn:true};};
  await assert.rejects(x.api.reconciliation.associate(x.input));assert.equal(x.store.run(x.run.id).state,'RESULT_UNKNOWN');assert.equal(x.store.completed(x.tasks[0]),null);
 }
});
test('another task or history cannot lend its item ID to a missing-ID task',async t=>{
 for(const kind of ['history','run']){
  const x=await fixture(t);
  if(kind==='history')x.store.history(x.tasks[1],{itemId:x.input.itemId,status:'出售中'});
  else {const r=x.store.create('fixture',x.tasks[1],'LIVE','SOURCE',{reviewed:true,taskHash:digest(x.tasks[1])});x.store.checkpoint(r.id,{itemId:x.input.itemId});}
  await assert.rejects(x.api.reconciliation.associate(x.input),/其他任务|已有成功/);assert.equal(x.queries(),0);assert.equal(x.store.run(x.run.id).state,'RESULT_UNKNOWN');
 }
});
test('query failure, screenshot failure and task mutation remain unknown without partial local success',async t=>{
 for(const kind of ['query','screenshot','mutated']){
  const x=await fixture(t),inspect=x.api.reconciliation.inspect;
  x.api.reconciliation.inspect=async options=>{if(kind==='query')throw Error('no unique match');const result=await inspect(options);if(kind==='screenshot')result.screenshot='not-found';if(kind==='mutated')x.store.checkpoint(x.run.id,{changed:true});return result;};
  await assert.rejects(x.api.reconciliation.associate(x.input));assert.equal(x.store.run(x.run.id).state,'RESULT_UNKNOWN');assert.equal(x.store.completed(x.tasks[0]),null);assert.equal(x.batch.store.item(x.item.id).state,'WAITING_HUMAN');assert.equal(x.flow.active,null);
 }
});
test('queue write failure rolls back checkpoint, history and run success together',async t=>{
 const x=await fixture(t);x.batch.store.move=()=>{throw Error('simulated database failure');};
 await assert.rejects(x.api.reconciliation.associate(x.input),/database failure/);
 assert.equal(x.store.run(x.run.id).state,'RESULT_UNKNOWN');assert.equal(x.store.run(x.run.id).checkpoint.itemId,undefined);assert.equal(x.store.completed(x.tasks[0]),null);
 assert(!x.store.events(x.run.id).some(e=>e.kind==='VERIFIED'));
});
test('concurrent association is refused while the original lookup is pending',async t=>{
 const x=await fixture(t),inspect=x.api.reconciliation.inspect;let release,entered;
 const ready=new Promise(r=>entered=r),gate=new Promise(r=>release=r);
 x.api.reconciliation.inspect=async options=>{entered();await gate;return inspect(options);};
 const first=x.api.reconciliation.associate(x.input);await ready;
 await assert.rejects(x.api.reconciliation.associate({...x.input,requestId:randomUUID()}),/核验中/);release();await first;assert.equal(x.queries(),1);
});
test('last unresolved item completes only its batch and does not create a new batch',async t=>{
 const x=await fixture(t);x.batch.skip(x.b.id,x.batch.store.items(x.b.id)[1].id,'isolated skip');
 await x.api.reconciliation.associate(x.input);assert.equal(x.batch.store.batch(x.b.id).state,'COMPLETED');assert.equal(x.store.db.prepare('SELECT COUNT(*) n FROM batches').get().n,1);
});
test('read-only reconciliation works with execution disabled and does not enable it',async t=>{
 const x=await fixture(t);assert.equal((await x.api.settings()).executionEnabled,false);await x.api.reconciliation.associate(x.input);assert.equal((await x.api.settings()).executionEnabled,false);
});
test('changed item ID cannot reuse an accepted reconciliation request',async t=>{
 const x=await fixture(t);await x.api.reconciliation.associate(x.input);await assert.rejects(x.api.reconciliation.associate({...x.input,itemId:'999999999999'}),/请求编号/);assert.equal(x.queries(),1);
});
test('reopening the database replays a completed association without another seller query',async t=>{
 const x=await fixture(t);await x.api.reconciliation.associate(x.input);
 const store=new SourceStore(join(x.dir,'state.sqlite'));
 try{
  const flow={store,active:null,runtime:x.dir,artifacts:x.flow.artifacts},batch=new BatchWorkflow(flow);
  const api=new ProductApi({source:flow,batch,owner:x.owner,shop:x.shop,runtime:x.dir,integrity:async()=>({ok:true})});
  api.reconciliation.inspect=async()=>{throw Error('MUST_NOT_QUERY_AGAIN');};
  assert.equal((await api.reconciliation.associate(x.input)).replayed,true);
  assert.equal(store.db.prepare('SELECT COUNT(*) n FROM history').get().n,1);assert.equal(batch.store.batch(x.b.id).state,'PAUSED');
 }finally{store.close();}
});
test('listing validation requires exact title, price, stock and original submission time',()=>{
 const task={listing:{title:'盐湖城服务'},business:{price_cny:20,inventory:100}},itemId='1088061246413';
 const events=[{seq:1,kind:'SUBMITTING',at:'2026-10-04T04:31:12.000Z'},{seq:2,kind:'RESULT_UNKNOWN',at:'2026-10-04T04:32:15.000Z'}],window=submissionWindow(events);
 const row={name:'盐湖城服务\nID:'+itemId,price:'¥ 20.00',inventory:'100',created:'2026-10-04 12:31\n出售中'};
 assert.equal(validateListing(row,task,itemId,window).createdAt,'2026-10-04 12:31');
 for(const patch of [{name:'另一个盐湖城服务\nID:'+itemId},{name:'盐湖城服务\nID:'+itemId+'0'},{price:'120.00'},{inventory:'1000'},{created:'2026-09-30 12:31'},{created:'无法读取'},{created:'2026-10-04 12:31 2026-10-04 12:32'}])assert.throws(()=>validateListing({...row,...patch},task,itemId,window));
 assert.throws(()=>submissionWindow([]),/缺少/);
});
