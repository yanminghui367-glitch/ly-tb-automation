import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {RoundItemApi} from '../round-item-api.mjs';
import {setup,shop} from './skip-independent-fixture.mjs';
const snapshot=f=>Object.fromEntries(['runs','batch_items','round_items','round_item_attempts','events','batch_events','round_events','round_windows','round_window_items','history'].map(n=>[n,f.store.db.prepare('SELECT * FROM '+n+' ORDER BY rowid').all()]));
async function fixture(t){
 const f=await setup(t),api=new RoundItemApi(f.action);
 const server=createServer(async(req,res)=>{
  const helpers={body:async r=>{let text='';for await(const c of r)text+=c;return JSON.parse(text);},json:(r,status,value)=>{r.writeHead(status,{'content-type':'application/json'});r.end(JSON.stringify(value));}};
  try{if(!await api.handle(req,res,new URL(req.url,'http://localhost'),helpers))helpers.json(res,404,{error:'isolated route not found'});}catch(e){helpers.json(res,500,{error:e.message});}
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const base='http://127.0.0.1:'+server.address().port;
 const get=(scope=f.scope())=>fetch(base+'/api/v1/rounds/item?'+new URLSearchParams(scope));
 const skip=req=>fetch(base+'/api/v1/rounds/item-skip',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(req)});
 return {...f,api,base,get,skip};
}
function seed(f,{outcome,before={state:'PENDING'},parent=null,requestId='independent-prior'}={}){
 const x=f.round.item(f.r.id,f.scope().key);
 return f.store.transaction(()=>{
  const a=f.action.attempts.begin({scope:{...f.scope(),shopId:shop.id,taskHash:x.task_hash,repairVersion:f.r.repairVersion},kind:parent?'VERIFY_ONLY':'INITIAL',requestId,parentAttemptId:parent?.id||null,before});
  return outcome?f.action.attempts.seal(a.id,outcome):a;
 });
}

test('capability and POST both reject an open attempt belonging to the previous window',async t=>{
 const f=await fixture(t);seed(f);
 f.round.windows.close(f.w.id,'STOPPED','isolated archived window');
 const next=f.round.windows.create(await f.round.windows.preview(f.r.id,{limit:3}));
 const scope={...f.scope(),windowId:next.id},before=snapshot(f),response=await f.get(scope),d=await response.json();
 assert.equal(response.status,200);
 const r=await f.skip({...scope,expectedRevision:d.revision,requestId:'new-window-skip',reason:'isolated operator decision'}),receipt=await r.json();
 assert.equal(r.status,409);assert.equal(receipt.code,'ITEM_SKIP_ATTEMPT_SCOPE');assert.deepEqual(snapshot(f),before);
 assert.equal(d.capabilities.skip.allowed,false,'GET must not advertise an action rejected by the unchanged POST scope guard');
 assert.equal(d.capabilities.skip.code,'ITEM_SKIP_ATTEMPT_SCOPE');
});

test('older success remains protected in HTTP while newest FAILED is displayed without claiming success',async t=>{
 const f=await fixture(t),original=seed(f,{outcome:{state:'NEW_SUCCESS',itemId:'1234567890123'}});
 seed(f,{parent:original,requestId:'later-failed',outcome:{state:'FAILED',reason:'isolated verification failure'}});
 const before=snapshot(f),d=await (await f.get()).json();
 assert.equal(d.current.state,'PENDING');assert.deepEqual(d.attempts.map(x=>x.state),['NEW_SUCCESS','FAILED']);
 assert.equal(d.capabilities.skip.allowed,false);assert.equal(d.capabilities.skip.code,'ITEM_SKIP_SUBMISSION_PROTECTED');
 const r=await f.skip({...f.request(),expectedRevision:d.revision});assert.equal(r.status,409);assert.deepEqual(snapshot(f),before);
});

test('unknown attempt and historical window outcome stay separate from the current projection',async t=>{
 const f=await fixture(t);seed(f,{outcome:{state:'RESULT_UNKNOWN',reason:'isolated awaiting reconciliation'}});
 f.round.windows.close(f.w.id,'STOPPED','isolated snapshot');f.round.update(f.r.id,f.scope().key,{state:'FAILED',reason:'later local projection'});
 const before=snapshot(f),d=await (await f.get()).json();
 assert.equal(d.current.state,'FAILED');assert.equal(d.windowOutcome.state,'PENDING');
 assert.equal(d.attempts[0].state,'RESULT_UNKNOWN');assert.equal(d.attempts[0].reason,'isolated awaiting reconciliation');
 assert.equal(d.attempts[0].windowId,f.w.id);assert.equal(d.capabilities.skip.allowed,false);assert.deepEqual(snapshot(f),before);
});

test('two simultaneous identical POSTs produce one sealed decision and one replay',async t=>{
 const f=await fixture(t),req=f.request(),responses=await Promise.all([f.skip(req),f.skip(req)]),values=await Promise.all(responses.map(r=>r.json()));
 assert(responses.every(r=>r.status===200));assert.equal(values[0].attemptId,values[1].attemptId);assert.deepEqual(values.map(x=>x.replayed).sort(),[false,true]);
 assert.equal(f.action.attempts.list(f.r.id,f.scope().key).length,1);assert.equal(f.flow.submits,0);assert.equal(f.flow.launches.length,0);
});

test('scope changes cannot reuse another item decision request ID',async t=>{
 const f=await fixture(t),req=f.request();assert.equal((await f.skip(req)).status,200);
 const before=snapshot(f),r=await f.skip({...f.request(2),requestId:req.requestId});
 assert.equal(r.status,409);assert.equal((await r.json()).code,'ITEM_SKIP_REQUEST_CONFLICT');assert.deepEqual(snapshot(f),before);
});

test('owner acquired after GET blocks POST without acting on stale displayed permission',async t=>{
 const f=await fixture(t),d=await (await f.get()).json();assert.equal(d.capabilities.skip.allowed,true);
 f.flow.queueLease='different-owner';const before=snapshot(f),r=await f.skip({...f.request(),expectedRevision:d.revision});
 assert.equal(r.status,409);assert.equal((await r.json()).code,'ITEM_OWNER_BUSY');assert.deepEqual(snapshot(f),before);assert.equal(f.flow.queueLease,'different-owner');
});

test('cross-round and unknown-window POSTs reject without any write',async t=>{
 const f=await fixture(t),req=f.request(),before=snapshot(f);
 for(const changed of [{roundId:'another-round'},{windowId:'another-window'},{key:f.scope().key+'-not-assigned'}]){
  const r=await f.skip({...req,...changed});assert.equal(r.status,409);assert.deepEqual(snapshot(f),before);
 }
});

test('methods and semantic input types reject without mutation or caller-controlled execution flags',async t=>{
 const f=await fixture(t),before=snapshot(f);
 for(const [field,value] of [['roundId',42],['windowId',{}],['key',[]],['expectedRevision',null],['requestId','x'.repeat(97)],['reason',false],['reason',' '.repeat(5)]])assert.equal((await f.skip({...f.request(),[field]:value})).status,400);
 for(const extra of [{force:true},{humanVerified:true},{action:'retry'},{shopId:'other'}])assert.equal((await f.skip({...f.request(),...extra})).status,400);
 for(const [route,methods,allow] of [['item',['POST','PUT','DELETE','HEAD'],'GET'],['item-skip',['GET','PUT','DELETE','HEAD'],'POST']]){
  for(const method of methods){const r=await fetch(f.base+'/api/v1/rounds/'+route,{method});assert.equal(r.status,405);assert.equal(r.headers.get('allow'),allow);}
 }
 const r=await fetch(f.base+'/api/v1/rounds/item-skip?key=x',{method:'POST',body:JSON.stringify(f.request())});assert.equal(r.status,400);
 assert.deepEqual(snapshot(f),before);
});

test('unrecognized state-check exceptions fail closed and do not expose raw internal error text',async t=>{
 const f=await fixture(t),req=f.request(),before=snapshot(f),original=f.action.read;
 f.action.read=()=>{throw Error('INTERNAL_FIXTURE_ERROR_NOT_FOR_CLIENT');};
 for(const response of [await f.get(),await f.skip(req)]){assert.equal(response.status,409);const text=await response.text();assert(!text.includes('INTERNAL_FIXTURE_ERROR_NOT_FOR_CLIENT'));assert.equal(JSON.parse(text).code,'ITEM_STATE_CHECK_FAILED');}
 f.action.read=original;assert.deepEqual(snapshot(f),before);
});
