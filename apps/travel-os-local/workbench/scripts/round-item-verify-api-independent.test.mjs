import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {fixture as core} from './verify-http-fixture.mjs';
import {RoundItemApi} from '../round-item-api.mjs';
import {RoundItemVerify} from '../round-item-verify.mjs';
async function fixture(t,options){
 const f=await core(t,options);let api=new RoundItemApi(f.action.reader,{host:f.host,verifier:f.action});
 const server=createServer(async(req,res)=>{const h={body:async r=>{let s='';for await(const c of r)s+=c;return JSON.parse(s);},json:(r,status,b)=>{r.writeHead(status,{'content-type':'application/json'});r.end(JSON.stringify(b));}};try{if(!await api.handle(req,res,new URL(req.url,'http://localhost'),h))h.json(res,404,{});}catch{h.json(res,500,{error:'fixture failure'});}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));const base='http://127.0.0.1:'+server.address().port;
 const send=async(path,options)=>{const r=await fetch(base+path,options);return {status:r.status,body:await r.json()};};
 return {...f,get:async(scope=f.scope())=>send('/api/v1/rounds/item?'+new URLSearchParams(scope)),post:async req=>send('/api/v1/rounds/item-verify',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(req)}),replaceAction:a=>{api=new RoundItemApi(a.reader,{host:f.host,verifier:a});},changes:()=>f.store.db.prepare('SELECT total_changes() n').get().n};
}
test('HTTP sealed unresolved receipt must not expose arbitrary code-shaped exception secrets',async t=>{
 const f=await fixture(t),secret='TOKEN_SECRET_ABCDEF123456';f.round.verifyExisting=async()=>{throw Object.assign(Error('private text'),{code:secret});};const req=f.request(),r=await f.post(req);assert.equal(r.status,200);assert.equal(r.body.outcome.disposition,'UNRESOLVED');assert(!JSON.stringify(r.body).includes(secret),'Arbitrary exception code leaked in HTTP outcome');assert(!JSON.stringify((await f.post(req)).body).includes(secret));
});
test('exact sealed replay is bound to request intent and scope; altered revision conflicts without remote read',async t=>{
 const f=await fixture(t),req=f.request(),done=await f.post(req);assert.equal(done.status,200);const n=f.calls(),writes=f.changes();for(const change of [{expectedRevision:'changed'},{key:f.scope(2).key},{windowId:'foreign-window'}]){const r=await f.post({...req,...change});assert.equal(r.status,409);assert.equal(r.body.outcome,undefined);}assert.equal(f.calls(),n);assert.equal(f.changes(),writes);
});
test('same concurrent request returns same HTTP envelope after delayed host check',async t=>{
 const f=await fixture(t);let inRemote,finishRemote,finishHost,hostEntered;const remoteReady=new Promise(r=>inRemote=r),hostReady=new Promise(r=>hostEntered=r);f.round.verifyExisting=async()=>{inRemote();return new Promise(r=>finishRemote=()=>r(f.result));};const real=f.host.assert.bind(f.host);let checks=0;f.host.assert=async()=>{if(++checks===2){hostEntered();await new Promise(r=>finishHost=r);}return real();};
 const req=f.request(),first=f.post(req);await remoteReady;const second=f.post(req);await hostReady;finishRemote();const a=await first;finishHost();const b=await second;assert.equal(a.status,200);assert.equal(b.status,200);assert.equal(a.body.attemptId,b.body.attemptId);assert.equal(b.body.replayed,true);for(const k of ['roundId','windowId','key','requestId'])assert.equal(b.body[k],req[k]);assert.equal(f.action.attempts.list(req.roundId,req.key).length,1);
});
test('GET of unfinished attempt is repeatably read-only and exposes original scope only',async t=>{
 const f=await fixture(t),req=f.request(),s=f.action.reader.read(req);f.store.transaction(()=>f.action.attempts.begin({scope:{roundId:req.roundId,windowId:req.windowId,key:req.key,shopId:s.r.shop,taskHash:s.x.task_hash,repairVersion:s.r.repair_version},kind:'VERIFY_ONLY',requestId:'verify-only:'+req.requestId,before:{requestIntent:createHash('sha256').update(JSON.stringify(req)).digest('hex'),request:req,snapshot:s.snapshot}}));const writes=f.changes();for(let i=0;i<3;i++){const r=await f.get();assert.equal(r.status,200);assert.deepEqual(r.body.capabilities.verify.request,req);}assert.equal(f.changes(),writes);assert.equal(f.calls(),0);const other=await f.get(f.scope(2));assert.equal(other.body.capabilities.verify.request,undefined);
});
test('owner replacement during GET integrity wait denies capability and subsequent POST',async t=>{
 const f=await fixture(t),req=f.request();let entered,done;const ready=new Promise(r=>entered=r);f.p.integrity=async()=>{entered();await new Promise(r=>done=r);return {ok:true};};const pending=f.get();await ready;const replacement={...f.flow};f.p.source=replacement;f.round.source=replacement;done();const d=await pending;assert.equal(d.body.capabilities.verify.allowed,false);assert.equal(d.body.capabilities.verify.request,undefined);assert.equal((await f.post(req)).status,409);assert.equal(f.calls(),0);
});
test('held persistence GET is read-only, another request cannot inherit recoverable intent',async t=>{
 const f=await fixture(t,{submitted:true}),req=f.request();f.action.attempts.seal=()=>{throw Object.assign(Error('private storage'),{code:'SQLITE_FULL'});};assert.equal((await f.post(req)).status,409);const writes=f.changes();const d=await f.get();assert.deepEqual(d.body.capabilities.verify.request,req);assert.equal(f.changes(),writes);const other=await f.post({...req,requestId:'foreign-request'});assert.equal(other.status,409);assert.equal(other.body.retainRequest,false,'Unrelated request must not claim it owns the retained recovery operation');
});
test('sealed stop failure after process-local latch loss is offered by GET without writes and closed by original replay only',async t=>{
 const f=await fixture(t);let started,release;const ready=new Promise(r=>started=r);f.round.verifyExisting=async()=>{started();return new Promise(r=>release=()=>r(f.result));};const req=f.request(),close=f.round.windows.close.bind(f.round.windows),first=f.post(req);await ready;f.round.windows.close=()=>{throw Error('private disk failure');};f.round.stop();release();assert.equal((await first).status,409);
 f.round.windows.close=close;f.round.active=null;f.round.batch.active=null;f.round.source.queueLease=null;f.round.currentOperation=null;f.round.pending=null;const recovered=new RoundItemVerify(f.host);f.replaceAction(recovered);const writes=f.changes(),d=await f.get();assert.equal(d.body.capabilities.verify.allowed,true);assert.equal(d.body.capabilities.verify.mode,'RECOVER');assert.equal(d.body.capabilities.verify.code,'ITEM_VERIFY_RECOVER_STOP');assert.deepEqual(d.body.capabilities.verify.request,req);assert.equal(f.changes(),writes);const r=await f.post(req);assert.equal(r.status,200);assert.equal(f.round.view(req.roundId).state,'STOPPED');assert.equal(recovered.attempts.list(req.roundId,req.key).length,1);assert.equal(f.flow.submits,0);
});
test('sealed request can replay after shop removal but no fresh request is admitted',async t=>{
 const f=await fixture(t),req=f.request();f.round.verifyExisting=async()=>null;const first=await f.post(req);assert.equal(first.status,200);f.remove();const writes=f.changes(),replay=await f.post(req);assert.equal(replay.status,200);assert.equal(replay.body.attemptId,first.body.attemptId);assert.equal(f.changes(),writes);assert.equal((await f.get()).body.capabilities.verify.allowed,false);assert.equal((await f.post({...req,requestId:'fresh'})).status,409);
});
test('H5 fixed protocol code is used in new immutable outcome and round event, never arbitrary exception text',async t=>{
 const f=await fixture(t),secret='TOKEN_SECRET_NEW_EXCEPTION_918273';f.round.verifyExisting=async()=>{throw Object.assign(Error(secret),{code:secret});};
 const req=f.request(),r=await f.post(req);assert.equal(r.status,200);assert.equal(r.body.outcome.code,'ITEM_VERIFY_FAILED');
 const a=f.action.attempts.list(req.roundId,req.key);assert.equal(a.length,1);assert.equal(a[0].outcome.code,'ITEM_VERIFY_FAILED');
 const ev=f.store.db.prepare('SELECT payload FROM round_events WHERE round_id=? AND key=?').all(req.roundId,req.key);assert(!JSON.stringify({a,ev}).includes(secret),'New exception leaked into persistent ledger or event');assert(!JSON.stringify((await f.get()).body).includes(secret));
});
test('H5 old sealed arbitrary code is projected safely in HTTP without changing original immutable history',async t=>{
 const f=await fixture(t),req=f.request(),s=f.action.reader.read(req),secret='TOKEN_SECRET_LEGACY_564738';
 let id;f.store.transaction(()=>{const a=f.action.attempts.begin({scope:{roundId:req.roundId,windowId:req.windowId,key:req.key,shopId:s.r.shop,taskHash:s.x.task_hash,repairVersion:s.r.repair_version},kind:'VERIFY_ONLY',requestId:'verify-only:'+req.requestId,before:{requestIntent:createHash('sha256').update(JSON.stringify(req)).digest('hex'),request:req,snapshot:s.snapshot}});id=a.id;f.action.attempts.seal(id,{state:'RESULT_UNKNOWN',disposition:'UNRESOLVED',code:secret,reason:'核验未决',submittedByThisAction:false});});
 const before=f.store.db.prepare('SELECT * FROM round_item_attempts WHERE id=?').get(id),writes=f.changes();
 for(let i=0;i<2;i++){const r=await f.post(req);assert.equal(r.status,200);assert.equal(r.body.replayed,true);assert.equal(r.body.outcome.code,'ITEM_VERIFY_FAILED');assert(!JSON.stringify(r.body).includes(secret));}
 assert(!JSON.stringify((await f.get()).body).includes(secret));assert.deepEqual(f.store.db.prepare('SELECT * FROM round_item_attempts WHERE id=?').get(id),before);assert.equal(f.changes(),writes);assert.equal(f.calls(),0);
});
test('H6 stop latch retains only complete original request, rejecting all altered canonical fields',async t=>{
 const f=await fixture(t);let started,release;const ready=new Promise(r=>started=r);f.round.verifyExisting=async()=>{started();return new Promise(r=>release=()=>r(f.result));};const req=f.request(),close=f.round.windows.close.bind(f.round.windows),pending=f.post(req);await ready;
 f.round.windows.close=()=>{throw Error('storage failed');};f.round.stop();release();const original=await pending;assert.equal(original.status,409);assert.equal(original.body.retainRequest,true);assert(f.action.stopFinalizationBlocked);
 for(const field of ['roundId','windowId','key','expectedRevision','requestId']){const wrong={...req,[field]:'foreign-value'},r=await f.post(wrong);assert.equal(r.status,409);assert.equal(r.body.retainRequest,false,field);assert(f.action.stopFinalizationBlocked);}
 f.round.windows.close=close;assert.equal((await f.post(req)).status,200);assert.equal(f.action.stopFinalizationBlocked,null);assert.equal(f.flow.submits,0);
});
