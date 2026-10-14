import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {setup} from './skip-independent-fixture.mjs';
import {createHostedRoundItemApi} from '../round-item-host-api.mjs';
const snapshot=f=>Object.fromEntries(['runs','batch_items','round_items','round_item_attempts','events','batch_events','round_events','round_windows','round_window_items','history'].map(n=>[n,f.store.db.prepare('SELECT * FROM '+n+' ORDER BY rowid').all()]));
async function fixture(t){
 const f=await setup(t);let removed=false;
 const product={round:f.round,source:f.flow,batch:f.batch,shop:f.round.shop,capturing:false,reconciling:false,integrity:async()=>({ok:true})};
 const api=createHostedRoundItemApi(product,{isShopRemoved:()=>removed});
 const server=createServer(async(req,res)=>{
  const helpers={body:async r=>{let s='';for await(const b of r)s+=b;return JSON.parse(s);},json:(r,status,value)=>{r.writeHead(status,{'content-type':'application/json'});r.end(JSON.stringify(value));}};
  try{if(!await api.handle(req,res,new URL(req.url,'http://localhost'),helpers))helpers.json(res,404,{});}catch(e){helpers.json(res,500,{error:e.message});}
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const base='http://127.0.0.1:'+server.address().port;
 return {...f,product,api,setRemoved:v=>removed=v,get:()=>fetch(base+'/api/v1/rounds/item?'+new URLSearchParams(f.scope())),skip:req=>fetch(base+'/api/v1/rounds/item-skip',{method:'POST',body:JSON.stringify(req)})};
}
function latch(f,count=1){
 const releases=[];let reached;const started=new Promise(r=>reached=r);
 f.product.integrity=()=>new Promise(r=>{releases.push(r);if(releases.length===count)reached();});
 return {started,releases};
}

for(const changed of ['removed','integrity'])test('concurrent identical request remains a read-only replay if '+changed+' changes after the first commit',async t=>{
 const f=await fixture(t),req=f.request(),gate=latch(f,2),a=f.skip(req),b=f.skip(req);
 await gate.started;gate.releases[0]({ok:true});
 const first=await Promise.race([a,b]),receipt=await first.json();assert.equal(first.status,200);
 const before=snapshot(f);if(changed==='removed')f.setRemoved(true);
 gate.releases[1]({ok:changed!=='integrity'});
 const responses=await Promise.all([a,b]),second=responses.find(r=>r!==first),replayed=await second.json();
 assert.equal(second.status,200,'already sealed identical receipt must stay readable: '+JSON.stringify(replayed));
 assert.equal(replayed.replayed,true);assert.equal(replayed.attemptId,receipt.attemptId);assert.deepEqual(snapshot(f),before);assert.equal(f.flow.submits,0);
});

for(const field of ['source','batch'])test('coordinated '+field+' replacement cannot silently rebind the established host',async t=>{
 const f=await fixture(t),req=f.request(),before=snapshot(f),original=f.product[field];
 original.active='original-owner-still-running';
 const replacement={...original,active:null};f.product[field]=replacement;f.round[field]=replacement;
 const d=await (await f.get()).json(),response=await f.skip(req),receipt=await response.json();
 assert.equal(response.status,409,JSON.stringify({getAllowed:d.capabilities.skip.allowed,post:receipt}));
 assert.equal(receipt.code,'ITEM_HOST_SCOPE_MISMATCH');assert.equal(d.capabilities.skip.allowed,false);assert.deepEqual(snapshot(f),before);assert.equal(original.active,'original-owner-still-running');
});

test('host round replacement during kernel await rejects mutation without changing the old round',async t=>{
 const f=await fixture(t),req=f.request(),before=snapshot(f),gate=latch(f),pending=f.skip(req);
 await gate.started;f.product.round={...f.round};gate.releases[0]({ok:true});
 const response=await pending;assert.equal(response.status,409);assert.equal((await response.json()).code,'ITEM_HOST_SCOPE_MISMATCH');assert.deepEqual(snapshot(f),before);
});

test('revision change while kernel awaits is checked against the new event boundary',async t=>{
 const f=await fixture(t),req=f.request(),gate=latch(f),pending=f.skip(req);
 await gate.started;f.round.event(f.r.id,f.scope().key,'ISOLATED_REVISION_CHANGE',{});const before=snapshot(f);gate.releases[0]({ok:true});
 const response=await pending;assert.equal(response.status,409);assert.equal((await response.json()).code,'ITEM_SKIP_STALE_REVISION');assert.deepEqual(snapshot(f),before);
});

test('different concurrent decisions for one item cannot create a second attempt after the first commit',async t=>{
 const f=await fixture(t),req=f.request(),gate=latch(f,2),a=f.skip(req),b=f.skip({...req,requestId:'other-intent',reason:'different operator decision'});
 await gate.started;gate.releases[0]({ok:true});gate.releases[1]({ok:true});
 const responses=await Promise.all([a,b]),receipts=await Promise.all(responses.map(r=>r.json()));
 assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);assert.equal(f.api.action.attempts.list(f.r.id,f.scope().key).length,1);assert.equal(f.flow.submits,0);
 assert(receipts.some(x=>x.code==='ITEM_SKIP_STATE_PROTECTED'||x.code==='ITEM_SKIP_STALE_REVISION'));
});

test('a changed intent cannot turn a concurrent host denial into a replay',async t=>{
 const f=await fixture(t),req=f.request(),gate=latch(f),pending=f.skip(req);await gate.started;
 f.api.action.skip({...req,reason:'another intent with same ID'});f.setRemoved(true);const before=snapshot(f);gate.releases[0]({ok:true});
 const response=await pending;assert.equal(response.status,409);assert.equal((await response.json()).code,'ITEM_SKIP_REQUEST_CONFLICT');assert.deepEqual(snapshot(f),before);
});

for(const field of ['sourceStore','batchStore','coordinatedDb','shopId','batchFlow','batchStoreSource','batchStoreDb'])test('pinned host rejects '+field+' rebinding even if current collaborators agree',async t=>{
 const f=await fixture(t),before=snapshot(f),original={sourceStore:f.flow.store,batchStore:f.batch.store,db:f.store.db,roundDb:f.round.db,windowDb:f.round.windows.db,shop:f.round.shop,productShop:f.product.shop,batchFlow:f.batch.flow,batchSource:f.batch.store.source,batchDb:f.batch.store.db};
 const otherDb=['coordinatedDb','batchStoreDb'].includes(field)?new DatabaseSync(':memory:'):null;
 try{
  if(field==='sourceStore')f.flow.store=Object.assign(Object.create(Object.getPrototypeOf(f.store)),f.store);
  if(field==='batchStore')f.batch.store=Object.assign(Object.create(Object.getPrototypeOf(original.batchStore)),original.batchStore);
  if(field==='coordinatedDb'){f.store.db=otherDb;f.round.db=otherDb;f.round.windows.db=otherDb;f.batch.store.db=otherDb;}
  if(field==='shopId'){const replacement={...f.round.shop,id:'other-shop'};f.product.shop=replacement;f.round.shop=replacement;}
  if(field==='batchFlow')f.batch.flow={...f.flow};
  if(field==='batchStoreSource')f.batch.store.source=Object.assign(Object.create(Object.getPrototypeOf(f.store)),f.store);
  if(field==='batchStoreDb')f.batch.store.db=otherDb;
  const issue=await f.api.host.inspect();assert.equal(issue?.code,'ITEM_HOST_SCOPE_MISMATCH');
  await assert.rejects(()=>f.api.host.assert(),/ITEM_HOST_SCOPE_MISMATCH/);
 }finally{
  f.flow.store=original.sourceStore;f.batch.store=original.batchStore;f.store.db=original.db;f.round.db=original.roundDb;f.round.windows.db=original.windowDb;f.round.shop=original.shop;f.product.shop=original.productShop;f.batch.flow=original.batchFlow;f.batch.store.source=original.batchSource;f.batch.store.db=original.batchDb;otherDb?.close();
 }
 assert.deepEqual(snapshot(f),before);assert.equal(f.flow.submits,0);assert.equal(f.flow.launches.length,0);
});
