import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import {ProductApi} from '../product-api.mjs';
import {setup} from './skip-independent-fixture.mjs';
async function fixture(t){
 const f=await setup(t),api=Object.create(ProductApi.prototype),ledger=f.round.executionAttempts.attempts,seal=ledger.seal.bind(ledger);
 Object.assign(api,{source:f.flow,batch:f.batch,round:f.round,shop:f.round.shop,assertExecution:async()=>{},integrity:async()=>({ok:true}),owner:{status:async()=>({running:true,loggedIn:true})},roundVerifier:{reset:()=>{}}});
 f.store.db.exec('CREATE TABLE product_actions(id TEXT PRIMARY KEY,action TEXT,target TEXT,at TEXT,result TEXT)');
 ledger.seal=()=>{throw Error('isolated ledger persistence failure');};f.round.start(f.r.id,{windowId:f.w.id});await f.round.pending;ledger.seal=seal;
 const req=()=>({id:f.r.id,windowId:f.w.id,manifestHash:f.r.manifestHash||f.round.round(f.r.id).manifest_hash,attemptId:f.round.executionAttempts.recoveryView(f.r.id)?.attemptId,requestId:randomUUID()});
 const server=createServer(async(r,res)=>{const helpers={body:async()=>{let bytes='';for await(const b of r)bytes+=b;return JSON.parse(bytes);},json:(res,status,value)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value));}};try{await api.handleRound(r,res,new URL(r.url,'http://localhost'),helpers);}catch(e){helpers.json(res,e.status||409,{error:e.message});}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const post=body=>fetch('http://127.0.0.1:'+server.address().port+'/api/v1/rounds/resume',{method:'POST',body:JSON.stringify(body)});
 return {...f,api,req,post};
}
test('HTTP records recovery before explicit original queue resume; replay cannot execute',async t=>{
 const f=await fixture(t),req=f.req(),original=f.flow.launches[0];assert.equal(f.flow.submits,1);
 let r=await f.post(req);assert.equal(r.status,200,await r.text());assert.equal(f.flow.submits,1);
 const next={...req,requestId:randomUUID()};delete next.attemptId;assert.equal((await f.post(next)).status,200);await f.round.pending;assert.equal(f.flow.submits,3);assert.equal(f.flow.launches.filter(id=>id===original).length,1);
 r=await f.post(req);assert.equal(r.status,200);assert.equal((await r.json()).replayed,true);assert.equal(f.flow.submits,3);
 r=await f.post({...req,windowId:'wrong'});assert.equal(r.status,409);assert.equal(f.flow.submits,3);
});
test('HTTP stopped recovery only seals records and preserves remaining items',async t=>{
 const f=await fixture(t);f.round.stop();const req=f.req(),r=await f.post(req);assert.equal(r.status,200);const result=await r.json();assert.equal(result.stopped,true);assert.equal(result.executionStarted,false);assert.equal(f.flow.submits,1);assert.equal(f.round.view(f.r.id).counts.PENDING,2);assert.equal(f.round.active,null);
 assert.equal((await f.post(req)).status,200);assert.equal(f.flow.submits,1);
});
test('HTTP stale scope, missing login, failed kernel and unsettled source keep original owner',async t=>{
 const f=await fixture(t),req=f.req();
 for(const patch of [{attemptId:'wrong'},{windowId:'wrong'},{manifestHash:'wrong'}])assert.equal((await f.post({...req,...patch})).status,409);
 f.api.owner.status=async()=>({running:true,loggedIn:false});assert.equal((await f.post(req)).status,409);
 f.api.owner.status=async()=>({running:true,loggedIn:true});f.api.integrity=async()=>({ok:false});assert.equal((await f.post(req)).status,409);
 f.api.integrity=async()=>({ok:true});f.flow.active='not-settled';assert.equal((await f.post(req)).status,409);f.flow.active=null;
 assert.equal(f.flow.submits,1);assert.equal(f.round.active,f.r.id);assert(f.round.executionAttempts.blocked);
});
test('HTTP waits original coordinator completion before releasing ownership',async t=>{
 const f=await fixture(t),req=f.req();let release,responded=false;f.round.executionAttempts.coordinatorSettled=false;f.round.pending=new Promise(r=>release=r);
 const operation=f.post(req).then(r=>{responded=true;return r;});await new Promise(r=>setTimeout(r,35));assert.equal(responded,false);assert.equal(f.flow.submits,1);assert.equal(f.round.active,f.r.id);
 f.round.executionAttempts.coordinatorSettled=true;release();const r=await operation;assert.equal(r.status,200);assert.equal(f.flow.submits,1);assert.equal(f.round.active,null);
});
test('concurrent recovery requests cannot acquire two publishing owners',async t=>{
 const f=await fixture(t),req=f.req(),responses=await Promise.all([f.post(req),f.post({...req,requestId:randomUUID()})]);assert.equal(responses.filter(r=>r.status===200).length,1);assert.equal(responses.filter(r=>r.status===409).length,1);await f.round.pending;assert.equal(f.flow.submits,1);assert.equal(new Set(f.flow.launches).size,1);
});

test('recovery acceptance write failure preserves lease; exact retry seals receipt without execution',async t=>{
 const f=await fixture(t),req=f.req();f.store.db.exec("CREATE TRIGGER reject_action BEFORE INSERT ON product_actions BEGIN SELECT RAISE(ABORT,'synthetic action persistence failure'); END");
 assert.equal((await f.post(req)).status,409);assert.equal(f.flow.submits,1);assert.equal(f.round.active,f.r.id);assert(f.round.executionAttempts.blocked);assert.equal(f.store.db.prepare('SELECT COUNT(*) n FROM product_actions').get().n,0);
 f.store.db.exec('DROP TRIGGER reject_action');const result=await f.post(req);assert.equal(result.status,200);assert.equal((await result.json()).executionStarted,false);assert.equal(f.flow.submits,1);assert.equal(f.round.active,null);assert.equal((await f.post(req)).status,200);
});
