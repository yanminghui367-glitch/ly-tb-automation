import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {setup} from './skip-independent-fixture.mjs';
import {createHostedRoundItemApi} from '../round-item-host-api.mjs';
const tables=['runs','batch_items','round_items','round_item_attempts','events','batch_events','round_events','round_windows','round_window_items','history'];
const snapshot=f=>Object.fromEntries(tables.map(n=>[n,f.store.db.prepare('SELECT * FROM '+n+' ORDER BY rowid').all()]));
async function fixture(t){
 const f=await setup(t);let removed=false;
 const product={round:f.round,source:f.flow,batch:f.batch,shop:f.round.shop,capturing:false,reconciling:false,integrity:async()=>({ok:true}),
  settings:async()=>{throw Error('skip must not require publishing enabled');},owner:{status:async()=>{throw Error('skip must not access browser');}}};
 const api=createHostedRoundItemApi(product,{isShopRemoved:id=>{assert.equal(id,product.shop.id);return removed;}});
 const server=createServer(async(req,res)=>{
  const helpers={body:async r=>{let s='';for await(const b of r)s+=b;return JSON.parse(s);},json:(r,status,value)=>{r.writeHead(status,{'content-type':'application/json'});r.end(JSON.stringify(value));}};
  if(!await api.handle(req,res,new URL(req.url,'http://localhost'),helpers))helpers.json(res,404,{});
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const base='http://127.0.0.1:'+server.address().port;
 const get=()=>fetch(base+'/api/v1/rounds/item?'+new URLSearchParams(f.scope()));
 const skip=req=>fetch(base+'/api/v1/rounds/item-skip',{method:'POST',body:JSON.stringify(req)});
 return {...f,product,api,get,skip,setRemoved:v=>removed=v};
}
for(const mode of ['removed','capturing','reconciling','integrity','kernel-throws'])test('host '+mode+' disables capability and rejects mutation while history remains readable',async t=>{
 const f=await fixture(t),req=f.request(),before=snapshot(f);
 const code={removed:'ITEM_HOST_SHOP_REMOVED',capturing:'ITEM_HOST_CONFIG_BUSY',reconciling:'ITEM_HOST_CONFIG_BUSY',integrity:'ITEM_HOST_INTEGRITY_FAILED','kernel-throws':'ITEM_HOST_CHECK_FAILED'}[mode];
 if(mode==='removed')f.setRemoved(true);else if(mode==='integrity')f.product.integrity=async()=>({ok:false});else if(mode==='kernel-throws')f.product.integrity=async()=>{throw Error('secret internal details');};else f.product[mode]=true;
 const g=await f.get(),d=await g.json();assert.equal(g.status,200);assert.equal(d.current.state,'PENDING');assert.equal(d.capabilities.skip.allowed,false);assert.equal(d.capabilities.skip.code,code);assert.equal(JSON.stringify(d).includes('secret internal'),false);
 const r=await f.skip(req);assert.equal(r.status,409);assert.equal((await r.json()).code,code);assert.deepEqual(snapshot(f),before);assert.equal(f.flow.launches.length,0);
});
test('normal hosted skip does not require publishing enabled or access an execution browser',async t=>{
 const f=await fixture(t),d=await (await f.get()).json();assert.equal(d.capabilities.skip.allowed,true);
 const r=await f.skip({...f.request(),expectedRevision:d.revision});assert.equal(r.status,200);assert.equal(f.round.item(f.r.id,f.scope().key).state,'MANUAL_SKIPPED');assert.equal(f.flow.submits,0);
});
test('shop removed while kernel check awaits is rechecked before mutation',async t=>{
 const f=await fixture(t),req=f.request(),before=snapshot(f);let entered,release;
 const started=new Promise(r=>entered=r);f.product.integrity=()=>{entered();return new Promise(r=>release=r);};
 const pending=f.skip(req);await started;f.setRemoved(true);release({ok:true});const r=await pending;assert.equal(r.status,409);assert.equal((await r.json()).code,'ITEM_HOST_SHOP_REMOVED');assert.deepEqual(snapshot(f),before);
});
test('owner acquired while kernel check awaits is rechecked without pausing it',async t=>{
 const f=await fixture(t),req=f.request(),before=snapshot(f);let entered,release;
 const started=new Promise(r=>entered=r);f.product.integrity=()=>{entered();return new Promise(r=>release=r);};
 const pending=f.skip(req);await started;f.flow.queueLease='other-owner';release({ok:true});const r=await pending;
 assert.equal(r.status,409);assert.equal((await r.json()).code,'ITEM_OWNER_BUSY');assert.equal(f.flow.queueLease,'other-owner');assert.deepEqual(snapshot(f),before);
});
test('changing configuration ownership after GET invalidates POST',async t=>{
 const f=await fixture(t),d=await (await f.get()).json(),req={...f.request(),expectedRevision:d.revision},before=snapshot(f);f.product.capturing=true;
 const r=await f.skip(req);assert.equal(r.status,409);assert.equal((await r.json()).code,'ITEM_HOST_CONFIG_BUSY');assert.deepEqual(snapshot(f),before);
});
test('the host must be the same round, source, database, batch and shop',async t=>{
 for(const field of ['round','source','batch','shop']){
  const f=await fixture(t),req=f.request(),before=snapshot(f);f.product[field]={id:'wrong'};
  const d=await (await f.get()).json();assert.equal(d.capabilities.skip.code,'ITEM_HOST_SCOPE_MISMATCH');assert.equal((await f.skip(req)).status,409);assert.deepEqual(snapshot(f),before);
 }
});
test('sealed identical replay remains a read when shop is removed and integrity is unavailable',async t=>{
 const f=await fixture(t),req=f.request(),first=await (await f.skip(req)).json(),before=snapshot(f);f.setRemoved(true);f.product.integrity=async()=>{throw Error('must not need kernel for receipt');};
 const r=await f.skip(req),data=await r.json();assert.equal(r.status,200);assert.equal(data.replayed,true);assert.equal(data.attemptId,first.attemptId);assert.deepEqual(snapshot(f),before);
 assert.equal((await f.skip({...req,reason:'different'})).status,409);assert.deepEqual(snapshot(f),before);
});
test('host factory rejects missing or ambiguous shop registry instead of permitting mutation',async t=>{
 const f=await fixture(t);assert.throws(()=>createHostedRoundItemApi(f.product),/NOT_CONFIGURED/);
 const api=createHostedRoundItemApi(f.product,{isShopRemoved:()=>Promise.resolve(false)}),d=await api.detail(f.scope());assert.equal(d.capabilities.skip.code,'ITEM_HOST_NOT_CONFIGURED');
});
