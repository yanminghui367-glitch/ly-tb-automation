import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {fixture as core} from './verify-http-fixture.mjs';
import {RoundItemApi} from '../round-item-api.mjs';

async function fixture(t,options){
 const f=await core(t,options),api=new RoundItemApi(f.action.reader,{host:f.host,verifier:f.action});
 const server=createServer(async(req,res)=>{
  const helpers={body:async r=>{let s='';for await(const c of r)s+=c;return JSON.parse(s);},json:(r,status,b)=>{r.writeHead(status,{'content-type':'application/json'});r.end(JSON.stringify(b));}};
  try{if(!await api.handle(req,res,new URL(req.url,'http://localhost'),helpers))helpers.json(res,404,{});}catch{helpers.json(res,500,{error:'fixture server error'});}
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const base='http://127.0.0.1:'+server.address().port;
 const get=async(scope=f.scope())=>{const r=await fetch(base+'/api/v1/rounds/item?'+new URLSearchParams(scope));return {status:r.status,body:await r.json()};};
 const post=async req=>{const r=await fetch(base+'/api/v1/rounds/item-verify',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(req)});return {status:r.status,body:await r.json()};};
 return {...f,api,base,get,post};
}

test('HTTP verify binds immutable receipt to exact scope, advances no other item, replay is read-only',async t=>{
 for(const submitted of [false,true]){
  const f=await fixture(t,{submitted}),d=await f.get(),req=f.request(),other=f.round.item(f.r.id,f.scope(2).key);
  assert.equal(d.body.capabilities.verify.allowed,true);assert.equal(d.body.capabilities.verify.mode,'VERIFY');
  const r=await f.post(req);assert.equal(r.status,200);assert.equal(r.body.outcome.disposition,'VERIFIED');assert.equal(r.body.key,req.key);assert.equal(r.body.requestId,req.requestId);assert.equal(r.body.windowId,req.windowId);assert.equal(r.body.roundId,req.roundId);assert.equal(r.body.outcome.submittedByThisAction,false);
  assert.deepEqual(f.round.item(f.r.id,f.scope(2).key),other);const calls=f.calls();
  const replay=await f.post(req);assert.equal(replay.body.attemptId,r.body.attemptId);assert.equal(replay.body.replayed,true);assert.equal(f.calls(),calls);assert.equal(f.flow.submits,0);assert.equal((await f.get()).body.capabilities.verify.allowed,false);
 }
});

test('ambiguous, absent and CAPTCHA outcomes return sealed unresolved receipts without claiming success',async t=>{
 for(const code of ['EXISTENCE_AMBIGUOUS','PAUSED_CAPTCHA','absent']){
  const f=await fixture(t);f.round.verifyExisting=async()=>{if(code==='absent')return null;throw Object.assign(Error(code),{code});};
  const req=f.request(),r=await f.post(req);assert.equal(r.status,200);assert.equal(r.body.outcome.disposition,'UNRESOLVED');assert.equal(r.body.outcome.state,'RESULT_UNKNOWN');assert.equal(r.body.outcome.submittedByThisAction,false);assert.equal(f.store.completed(f.tasks[0]),null);
  assert.equal((await f.post(req)).body.attemptId,r.body.attemptId);assert.equal(f.flow.submits,0);
  if(code==='PAUSED_CAPTCHA')assert.equal(f.round.view(f.r.id).state,'WAITING_HUMAN');
 }
});

test('HTTP boundary rejects ID override, unknown fields, noncanonical bodies, duplicate scope query and methods',async t=>{
 const f=await fixture(t),req=f.request();
 for(const body of [null,[],{}, {...req,itemId:'999999'}, {...req,reason:'not supported'}, {...req,requestId:''}, {...req,key:3}])assert.equal((await f.post(body)).status,400);
 const wrong=await fetch(f.base+'/api/v1/rounds/item-verify');assert.equal(wrong.status,405);assert.equal(wrong.headers.get('allow'),'POST');
 const duplicate=await fetch(f.base+'/api/v1/rounds/item-verify?key=x',{method:'POST',body:JSON.stringify(req)});assert.equal(duplicate.status,400);
 const malformed=await fetch(f.base+'/api/v1/rounds/item-verify',{method:'POST',body:'{'});assert.equal(malformed.status,400);assert.equal(f.calls(),0);assert.equal(f.action.attempts.list(f.r.id,req.key).length,0);
});

test('removed shop, stale intent and wrong window reject without verification; no arbitrary error leaks',async t=>{
 for(const mode of ['removed','stale','window','fault']){
  const f=await fixture(t),req=f.request();
  if(mode==='removed')f.remove();if(mode==='stale')f.round.event(f.r.id,null,'changed',{});if(mode==='window')req.windowId='another-window';
  if(mode==='fault')f.p.integrity=async()=>{throw Error('sensitive sentinel never expose');};
  const r=await f.post(req);assert.equal(r.status,409);assert(!JSON.stringify(r.body).includes('sensitive sentinel'));assert.equal(f.calls(),0);assert.equal(f.action.attempts.list(f.r.id,f.scope().key).length,0);
 }
});

test('in-flight request disables another verification and does not disclose a recoverable request for another item',async t=>{
 const f=await fixture(t);let release,started;const ready=new Promise(r=>started=r);f.round.verifyExisting=async()=>{started();return new Promise(r=>release=()=>r(f.result));};
 const req=f.request(),pending=f.post(req);await ready;
 const d=await f.get();assert.equal(d.body.capabilities.verify.allowed,false);assert.equal(d.body.capabilities.verify.request,undefined);
 assert.equal((await f.post({...req,requestId:'other'})).status,409);
 release();assert.equal((await pending).status,200);assert.equal(f.action.attempts.list(f.r.id,req.key).length,1);
});

test('failed persistence exposes only exact original recovery request across detail refresh',async t=>{
 const f=await fixture(t,{submitted:true}),req=f.request(),seal=f.action.attempts.seal.bind(f.action.attempts);
 f.action.attempts.seal=()=>{throw Object.assign(Error('private storage detail'),{code:'SQLITE_FULL'});};
 const failed=await f.post(req);assert.equal(failed.status,409);assert.equal(failed.body.retainRequest,true);assert(!JSON.stringify(failed.body).includes('private storage'));
 const d=(await f.get()).body.capabilities.verify;assert.equal(d.allowed,true);assert.equal(d.mode,'RECOVER');assert.deepEqual(d.request,req);assert.equal(d.code,'ITEM_VERIFY_PERSISTENCE_BLOCKED');
 const other=(await f.get(f.scope(2))).body.capabilities.verify;assert.equal(other.allowed,false);assert.equal(other.request,undefined);
 assert.equal((await f.post({...req,requestId:'replacement'})).status,409);assert(f.round.active);
 f.action.attempts.seal=seal;
 const recovered=await f.post(d.request);assert.equal(recovered.status,200);assert.equal(recovered.body.outcome.code,'ITEM_VERIFY_PERSISTENCE_RECOVERED');assert.equal(f.calls(),1);assert.equal(f.round.active,null);
 assert.equal((await f.get()).body.capabilities.verify.mode,'VERIFY');assert.equal(f.flow.submits,0);
});

test('interrupted durable attempt is exposed after refresh and sealed before any new query',async t=>{
 const f=await fixture(t),req=f.request(),s=f.action.reader.read(req);
 f.store.transaction(()=>f.action.attempts.begin({scope:{roundId:req.roundId,windowId:req.windowId,key:req.key,shopId:s.r.shop,taskHash:s.x.task_hash,repairVersion:s.r.repair_version},kind:'VERIFY_ONLY',requestId:'verify-only:'+req.requestId,before:{requestIntent:createHash('sha256').update(JSON.stringify(req)).digest('hex'),request:req,snapshot:s.snapshot}}));
 const cap=(await f.get()).body.capabilities.verify;assert.equal(cap.allowed,true);assert.equal(cap.mode,'RECOVER');assert.deepEqual(cap.request,req);
 const r=await f.post(cap.request);assert.equal(r.status,200);assert.equal(r.body.outcome.disposition,'INTERRUPTED');assert.equal(f.calls(),0);assert.equal((await f.get()).body.capabilities.verify.mode,'VERIFY');
});

test('stop finalization failure remains recoverable with exact request and never re-verifies',async t=>{
 const f=await fixture(t);let release,started;const ready=new Promise(r=>started=r);f.round.verifyExisting=async()=>{started();return new Promise(r=>release=()=>r(f.result));};
 const req=f.request(),close=f.round.windows.close.bind(f.round.windows),pending=f.post(req);await ready;
 f.round.windows.close=()=>{throw Error('private close persistence error');};f.round.stop();release();const failed=await pending;
 assert.equal(failed.status,409);assert.equal(failed.body.retainRequest,true);assert(f.action.stopFinalizationBlocked);
 const cap=(await f.get()).body.capabilities.verify;assert.equal(cap.allowed,true);assert.equal(cap.mode,'RECOVER');assert.deepEqual(cap.request,req);
 f.round.windows.close=close;const r=await f.post(cap.request);assert.equal(r.status,200);assert.equal(f.round.view(f.r.id).state,'STOPPED');assert.equal(f.round.active,null);assert.equal(f.flow.submits,0);
});
