import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {RoundItemApi} from '../round-item-api.mjs';
import {setup} from './skip-independent-fixture.mjs';
const tables=['runs','batch_items','round_items','round_item_attempts','events','batch_events','round_events','round_windows','round_window_items','history'];
const snapshot=f=>Object.fromEntries(tables.map(n=>[n,f.store.db.prepare('SELECT * FROM '+n+' ORDER BY rowid').all()]));
async function fixture(t,options){
 const f=await setup(t,options),api=new RoundItemApi(f.action);
 const server=createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');
  const helpers={body:async r=>{let text='';for await(const chunk of r)text+=chunk;return JSON.parse(text);},json:(r,status,value)=>{r.writeHead(status,{'content-type':'application/json'});r.end(JSON.stringify(value));}};
  try{if(!await api.handle(req,res,url,helpers))helpers.json(res,404,{error:'fixture route not found'});}catch(e){helpers.json(res,500,{error:e.message});}
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const base='http://127.0.0.1:'+server.address().port;
 const get=(scope=f.scope())=>fetch(base+'/api/v1/rounds/item?'+new URLSearchParams(scope));
 const skip=req=>fetch(base+'/api/v1/rounds/item-skip',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(req)});
 return {...f,api,base,get,skip};
}
test('HTTP detail is read only and does not fabricate legacy attempts or supported actions',async t=>{
 const f=await fixture(t),before=snapshot(f),response=await f.get(),d=await response.json();
 assert.equal(response.status,200);assert.equal(d.key,f.scope().key);assert.equal(d.shopId,'wuzhou-changyou');
 assert.equal(d.current.state,'PENDING');assert.equal(d.historyCoverage,'PRIOR_HISTORY_NOT_SEGMENTED');assert.deepEqual(d.attempts,[]);
 assert.equal(d.capabilities.skip.allowed,true);assert.equal(d.capabilities.retry.allowed,false);assert.equal(d.capabilities.verify.allowed,false);
 assert.deepEqual(snapshot(f),before);assert.equal(f.flow.submits,0);
});
test('HTTP skip changes one task; repeat request returns the same receipt without writes',async t=>{
 const f=await fixture(t),d=await (await f.get()).json(),req={...f.scope(),expectedRevision:d.revision,requestId:'http-1',reason:'用户明确不处理此条'};
 const r=await f.skip(req),a=await r.json();assert.equal(r.status,200);assert.equal(a.outcome.state,'MANUAL_SKIPPED');
 assert.equal(f.round.view(f.r.id).counts.MANUAL_SKIPPED,1);assert.equal(f.round.windows.view(f.w.id).ended,1);
 const before=snapshot(f),r2=await f.skip(req),b=await r2.json();assert.equal(r2.status,200);assert.equal(b.replayed,true);assert.equal(b.attemptId,a.attemptId);assert.deepEqual(snapshot(f),before);
 const after=await (await f.get()).json();assert.equal(after.attempts.length,1);assert.equal(after.attempts[0].reason,req.reason);assert.equal(after.capabilities.skip.allowed,false);assert.equal(f.flow.submits,0);
});
test('HTTP stale version and request collision give actionable 409 and do not modify records',async t=>{
 const f=await fixture(t),req=f.request();f.round.event(f.r.id,null,'NEW_STATE',{});let before=snapshot(f);
 let r=await f.skip(req);assert.equal(r.status,409);let b=await r.json();assert.equal(b.code,'ITEM_SKIP_STALE_REVISION');assert.match(b.error,/刷新/);assert.deepEqual(snapshot(f),before);
 const fresh=f.request();assert.equal((await f.skip(fresh)).status,200);before=snapshot(f);
 r=await f.skip({...fresh,reason:'other reason'});assert.equal(r.status,409);b=await r.json();assert.equal(b.code,'ITEM_SKIP_REQUEST_CONFLICT');assert.deepEqual(snapshot(f),before);
});
test('running owner disables skip in GET and blocks POST without stopping or launching anything',async t=>{
 const f=await fixture(t),req=f.request();f.round.active=f.r.id;f.batch.active='round:'+f.r.id;f.flow.queueLease='round:'+f.r.id;
 const before=snapshot(f),d=await (await f.get()).json();assert.equal(d.capabilities.skip.allowed,false);assert.equal(d.capabilities.skip.code,'ITEM_OWNER_BUSY');assert.match(d.capabilities.skip.reason,/安全暂停/);
 const r=await f.skip(req);assert.equal(r.status,409);assert.deepEqual(snapshot(f),before);assert.equal(f.round.active,f.r.id);assert.equal(f.flow.submits,0);assert.equal(f.flow.launches.length,0);
});
test('returned item evidence is protected at HTTP boundary even when task says PENDING',async t=>{
 const f=await fixture(t);await f.pause();const x=f.round.item(f.r.id,f.scope().key);f.store.checkpoint(x.run_id,{itemId:'123456789'});
 const before=snapshot(f),d=await (await f.get()).json();assert.equal(d.capabilities.skip.code,'ITEM_SKIP_SUBMISSION_PROTECTED');
 const r=await f.skip({...f.request(),expectedRevision:d.revision});assert.equal(r.status,409);assert.match((await r.json()).error,/先核验/);assert.deepEqual(snapshot(f),before);
});
test('historical window snapshot remains visible independently of current projection',async t=>{
 const f=await fixture(t);f.action.skip(f.request());f.round.start(f.r.id,{windowId:f.w.id});await f.round.pending;
 const before=snapshot(f),d=await (await f.get()).json();assert.equal(d.windowOutcome.state,'MANUAL_SKIPPED');assert.equal(d.attempts[0].windowId,f.w.id);assert.equal(d.capabilities.skip.allowed,false);assert.deepEqual(snapshot(f),before);
});
test('malformed input, duplicate query, unexpected fields and methods are rejected before mutation',async t=>{
 const f=await fixture(t),before=snapshot(f);
 for(const value of [null,[],{}, {...f.request(),runId:'injected'}, {...f.request(),reason:''}])assert.equal((await f.skip(value)).status,400);
 assert.equal((await fetch(f.base+'/api/v1/rounds/item-skip',{method:'POST',body:'{broken'})).status,400);
 assert.equal((await fetch(f.base+'/api/v1/rounds/item?'+new URLSearchParams(f.scope())+'&key=extra')).status,400);
 const wrong=await fetch(f.base+'/api/v1/rounds/item-skip');assert.equal(wrong.status,405);assert.equal(wrong.headers.get('allow'),'POST');
 assert.equal((await fetch(f.base+'/api/v1/rounds/not-supported')).status,404);assert.deepEqual(snapshot(f),before);
});
test('cross-window and shop mismatches never expose a valid action',async t=>{
 const f=await fixture(t,{limit:2}),before=snapshot(f);
 assert.equal((await f.get(f.scope(3))).status,409);assert.deepEqual(snapshot(f),before);
 const shop=f.round.shop;f.round.shop={id:'different-shop'};const r=await f.get();assert.equal(r.status,409);assert.equal((await r.json()).code,'ITEM_STATE_CHECK_FAILED');f.round.shop=shop;
 assert.deepEqual(snapshot(f),before);
});
