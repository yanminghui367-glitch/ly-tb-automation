import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createServer,request as httpRequest} from 'node:http';
import {ProductApi,executionRoute} from '../product-api.mjs';
import {createHostedRoundItemApi} from '../round-item-host-api.mjs';
import {networkAccess} from '../network-access.mjs';
import {redact} from '../product-state.mjs';
import {assertShopInput} from '../shop-identity.mjs';
import {setup} from './skip-independent-fixture.mjs';
// Exercise the actual server dispatch, network/Origin and mutation guards on an
// isolated random port; imported modules never initialize production resources.
const source=await readFile(new URL('../server.mjs',import.meta.url),'utf8');
const start=source.indexOf('export const workbenchServer = createServer('),last=source.indexOf('\n}));',start);
assert(start>0&&last>start);
const callback=source.slice(start+'export const workbenchServer = createServer('.length,last+3);
const helper=source.slice(source.indexOf('class ClientInputError'),source.indexOf('function chromePath'));
const byteLimit=source.match(/const MAX_REQUEST_BYTES\s*=\s*([^;]+);/)[1];
const helpers=(PORT,executions)=>new Function('Buffer','PORT','executions','assertShopInput',`const MAX_REQUEST_BYTES=${byteLimit};${helper};return {json,body};`)(Buffer,PORT,executions,assertShopInput);
async function fixture(t){
 const f=await setup(t),api=Object.create(ProductApi.prototype);f.batch.round=f.round;
 let removed=false,handler;
 Object.assign(api,{source:f.flow,batch:f.batch,round:f.round,shop:f.round.shop,capturing:false,reconciling:false,assertExecution:async()=>{},integrity:async()=>({ok:true}),owner:{status:async()=>({running:true,loggedIn:true})},roundVerifier:{reset:()=>{}}});
 api.roundItems=createHostedRoundItemApi(api,{isShopRemoved:()=>removed});
 f.round.update(f.r.id,f.scope().key,{reason:'上次查询失败，尚未提交'});
 const request=()=>({...f.scope(),expectedRevision:api.roundItems.retry.retry.reader.read(f.scope()).revision,requestId:'http-retry'});
 const server=createServer((req,res)=>handler(req,res));await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const port=server.address().port,base='http://127.0.0.1:'+port;assert.notEqual(port,4318);
 const {json,body}=helpers(port,{id:()=>f.round.shop.id});
 const network=networkAccess({port,address:'192.168.77.2',interfaces:{fixture:[{address:'192.168.77.2',family:'IPv4',internal:false,netmask:'255.255.255.0'}]}});
 handler=new Function('deps',`const {PORT,network,json,body,serveFile,product,travelOs,sourceWorkflow,batchWorkflow,executionRoute,redact,executions}=deps;let mutationBusy=false;return ${callback};`)({PORT:port,network,json,body,serveFile:()=>{throw Error('not a static test');},product:async()=>api,travelOs:()=>({store:{removed:()=>removed}}),sourceWorkflow:f.flow,batchWorkflow:f.batch,executionRoute,redact,executions:{run:(_id,fn)=>fn(),id:()=>f.round.shop.id,active:()=>f.flow.active||f.batch.active}});
 const send=(value,{method='POST',headers={},path='/api/v1/rounds/item-retry'}={})=>new Promise((resolve,reject)=>{const req=httpRequest(base+path,{method,headers:{'content-type':'application/json',Origin:base,...headers}},res=>{let text='';res.on('data',b=>text+=b);res.on('end',()=>resolve({status:res.statusCode,data:JSON.parse(text)}));});req.on('error',reject);req.end(method==='POST'?JSON.stringify(value):undefined);});
 return {...f,api,request,send,remove:()=>removed=true};
}
test('actual server route rejects foreign Host/Origin, malformed scope and removed shop without side effects',async t=>{
 const f=await fixture(t),req=f.request();
 for(const headers of [{Origin:'https://foreign.invalid'},{Host:'foreign.invalid'}])assert.equal((await f.send(req,{headers})).status,403);
 assert.equal((await f.send(req,{method:'GET'})).status,405);
 assert.equal((await f.send(req,{path:'/api/v1/rounds/item-retry?extra=1'})).status,400);
 assert.equal((await f.send({...req,key:'wrong'})).status,409);
 f.remove();const response=await f.send(req);assert.equal(response.status,409);assert.equal(response.data.retainRequest,false);
 assert.equal(f.flow.submits,0);assert.equal(f.flow.launches.length,0);assert.equal(f.store.db.prepare('SELECT COUNT(*) n FROM round_item_attempts').get().n,0);
});
test('actual server route executes only selected item and replays exact request without a new run',async t=>{
 const f=await fixture(t),req=f.request(),others=JSON.stringify(f.round.items(f.r.id).slice(1));
 const first=await f.send(req);assert.equal(first.status,200,JSON.stringify(first.data));assert.equal(first.data.outcome.state,'NEW_SUCCESS');
 const replay=await f.send(req);assert.equal(replay.status,200);assert.equal(replay.data.replayed,true);assert.equal(replay.data.attemptId,first.data.attemptId);
 assert.equal(f.flow.submits,1);assert.equal(f.flow.launches.length,1);assert.equal(JSON.stringify(f.round.items(f.r.id).slice(1)),others);
});
for(const action of ['pause','stop'])test('server serialization does not block priority '+action+' during single-item retry',async t=>{
 const f=await fixture(t);await f.pause();const req=f.request();let entered,release;
 const started=new Promise(r=>entered=r),original=f.flow.resume.bind(f.flow);
 f.flow.resume=async input=>{entered();await new Promise(r=>release=r);if(!f.round.pauseRequested)await original(input);};
 const running=f.send(req);await started;
 assert.equal((await f.send(req)).status,409);
 assert.equal((await f.send({id:f.r.id,windowId:f.w.id},{path:'/api/v1/rounds/'+action})).status,200);
 release();const result=await running;assert.equal(result.status,200,JSON.stringify(result.data));
 assert.equal(f.flow.submits,0);assert.equal(f.round.round(f.r.id).state,action==='stop'?'STOPPED':'PAUSED');assert.equal(f.round.active,null);
});
