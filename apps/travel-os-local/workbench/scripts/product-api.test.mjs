import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {EventEmitter} from 'node:events';
import {ProductApi,executionRoute} from '../product-api.mjs';
import {verifyKernel} from '../kernel-integrity.mjs';
import {SourceStore,digest} from '../source-store.mjs';
import {BatchWorkflow} from '../batch-workflow.mjs';
const shop={id:'wuzhou-changyou',name:'五洲畅游'};
const task=n=>({shopId:shop.id,priority:n,source:{sheet:'境外城市热度',row:n+1},listing:{type:'city',country:'测试国家',city:'测试城市'+n,title:'测试标题'+n},business:{price_cny:20,inventory:100},assets:{main:[],secondary:[],details:[]},adapterIssues:[]});
async function fixture(t){
 const dir=await mkdtemp(join(tmpdir(),'ly-product-')),store=new SourceStore(join(dir,'source.sqlite'));
 t.after(async()=>{store.close();await rm(dir,{recursive:true,force:true});});
 let outcome='PAUSED_CAPTCHA',loggedIn=true;const flow={store,runtime:dir,artifacts:join(dir,'tasks'),active:null,submits:0,pause(){},
 launch(id){this.active=id;this.pending=Promise.resolve().then(()=>{store.move(id,'RUNNING');store.checkpoint(id,{step:'title',screenshot:join(this.artifacts,id,'paused.png')});if(outcome==='VERIFIED'){store.move(id,'SUBMITTING');this.submits++;store.move(id,'VERIFIED','',{itemId:'123456789',status:'仓库中',rowText:'测试城市',screenshot:join(this.artifacts,id,'result.png')});}else store.move(id,outcome,'CAPTCHA');}).finally(()=>this.active=null);},
 async resume({id}){store.move(id,'QUEUED');this.launch(id);}};
 const batch=new BatchWorkflow(flow),owner={sessions:new Map(),status:async()=>({running:true,loggedIn,loginState:loggedIn?'LOGGED_IN':'LOGIN_UNVERIFIED',checkedAt:new Date().toISOString(),reason:'需要人工登录'})},params={batch,source:flow,owner,shop,runtime:dir,launch:async()=>({}),checkFiles:async()=>{},integrity:async()=>({ok:true,baseline:'test',files:10})},api=new ProductApi(params);
 const tasks=[task(1),task(2)],importId=store.imported({sourceHash:'fixture',sheet:'境外城市热度',tasks});
 const call=async(action,input,method=input===undefined?'GET':'POST')=>{if(input&&['start','continue','retry','resume-single'].includes(action)&&!input.requestId)input={...input,requestId:randomUUID()};let result;const res=new EventEmitter();res.writeHead=()=>{};res.end=v=>result=v;res.write=v=>result=v;await api.handle({method},res,new URL('/api/v1/'+action,'http://localhost'),{body:async()=>input,json:(res,status,data)=>result={status,data}});return {result,res};};
 return {dir,store,flow,batch,params,api,call,importId,tasks,setOutcome:v=>outcome=v,setLogin:v=>loggedIn=v};
}
test('execution is off by default and persists without dispatching tasks',async t=>{const x=await fixture(t);await assert.rejects(x.api.assertExecution(),/暂停/);await assert.rejects(x.call('start',{id:'x'}),/暂停/);await assert.rejects(x.api.saveSettings({executionEnabled:true,confirmShop:'wrong'}),/确认/);await x.api.saveSettings({executionEnabled:true,confirmShop:shop.name});await new ProductApi(x.params).assertExecution();assert.equal(x.flow.submits,0);await x.api.saveSettings({executionEnabled:false});await assert.rejects(new ProductApi(x.params).assertExecution(),/暂停/);await assert.rejects(x.api.saveSettings({limit:21}),/1—20/);await assert.rejects(x.api.saveSettings({cookie:'x'}),/无效/);});

test('retry recovery rejects unknown, mixed pending and exhausted batches before dispatch',async t=>{
 const x=await fixture(t);await x.api.saveSettings({executionEnabled:true,confirmShop:shop.name});
 const failed={id:'f',state:'FAILED',attempts:1,maxAttempts:3,runId:'run'};
 let state='PAUSED',items=[failed];
 x.batch.store.view=()=>({id:'batch',items});x.store.run=()=>({state,task:x.tasks[0],checkpoint:{}});
 assert.equal((await x.api.recovery({id:'batch',operation:'retry'})).ready,true);
 for(const invalid of ['RESULT_UNKNOWN','SUBMITTING','PAUSED_CAPTCHA','VERIFIED']){state=invalid;const r=await x.api.recovery({id:'batch',operation:'retry'});assert.equal(r.ready,false,invalid);}
 state='PAUSED';items=[failed,{id:'pending',state:'PENDING'}];assert.equal((await x.api.recovery({id:'batch',operation:'retry'})).ready,false);
 items=[{...failed,attempts:3}];assert.equal((await x.api.recovery({id:'batch',operation:'retry'})).ready,false);
 assert.equal(x.flow.submits,0);
});
test('create only queues reviewed tasks and excludes successful destinations',async t=>{const x=await fixture(t);x.store.history(x.tasks[0],{itemId:'100',status:'仓库中',at:'2026-09-21'});const {result:{data:p}}=await x.call('preview?import='+x.importId);assert.equal(p.tasks.length,1);assert.match(p.excluded[0].reason,/成功/);await x.call('create',{importId:x.importId,limit:20,mode:'LIVE',review:{reviewed:true,selectionHash:p.selectionHash,authorization:"synthetic QA"}});assert.equal(x.flow.submits,0);assert.equal(x.batch.store.view().counts.PENDING,1);assert.equal((await x.api.snapshot()).records[0].duplicateBlocked,true);});
test('CAPTCHA requires manual confirmation and fresh login; resumes the same run once',async t=>{const x=await fixture(t);await x.api.saveSettings({executionEnabled:true,confirmShop:shop.name});const p=x.batch.preview(x.importId,1),b=x.batch.create({importId:x.importId,limit:1,mode:'LIVE',review:{reviewed:true,selectionHash:p.selectionHash,authorization:"synthetic QA"}},shop);await x.call('start',{id:b.id});await x.batch.pending;const id=x.batch.store.view().items[0].runId;assert.equal((await x.api.snapshot()).exceptions[0].captcha,true);for(const op of ['start','continue','retry'])await assert.rejects(x.call(op,{id:b.id}),/人工/);x.setLogin(false);await assert.rejects(x.call('continue',{id:b.id,humanVerified:true}),/登录/);x.setLogin(true);x.setOutcome('VERIFIED');await x.call('continue',{id:b.id,humanVerified:true});await x.batch.pending;assert.equal(x.batch.store.view().items[0].runId,id);assert.equal(x.flow.submits,1);assert.equal((await x.api.snapshot()).exceptions.length,0);await assert.rejects(x.call('start',{id:b.id}),/结束/);assert.equal(x.flow.submits,1);});
test('kernel mismatch prevents execution even with saved enablement',async t=>{const x=await fixture(t);await x.api.saveSettings({executionEnabled:true,confirmShop:shop.name});x.api.integrity=async()=>({ok:false});await assert.rejects(x.api.assertExecution(),/内核/);assert.equal((await x.api.snapshot()).kernel.ok,false);});
test('attribute capture beginning during awaited execution checks blocks dispatch',async t=>{
 const x=await fixture(t);let release;const gate=new Promise(r=>release=r);x.api.settings=async()=>{await gate;return {executionEnabled:true};};
 const checking=x.api.assertExecution();x.api.capturing=true;release();await assert.rejects(checking,/读取属性/);assert.equal(x.flow.submits,0);
});
test('records export, task logs and screenshots remain bounded to task artifacts',async t=>{const x=await fixture(t);x.tasks[0].listing.title='=formula';x.store.create(x.importId,x.tasks[0],'DRY_RUN','SOURCE',{reviewed:true,taskHash:digest(x.tasks[0])});x.store.imported({sourceHash:'new',tasks:x.tasks});x.store.history(x.tasks[0],{itemId:'1',status:'仓库中',url:'https://attacker.test',at:'2026-09-21'});const {result}=await x.call('records.csv');assert(result.includes("'=formula"));assert.equal((await x.api.snapshot()).records[0].url,null);assert.equal(x.api.screenshot(join(x.dir,'secret.png')),null);assert.equal(x.api.screenshot(join(x.flow.artifacts,'r','ok.png')),'/output/tasks/r/ok.png');const r=x.store.create(x.importId,x.tasks[1],'DRY_RUN','SOURCE',{reviewed:true,taskHash:digest(x.tasks[1])});const detail=await x.call('task?id='+r.id);assert.equal(detail.result.data.events.length,1);});
test('SSE supplies current snapshot and cleans up on close',async t=>{const x=await fixture(t);const {result,res}=await x.call('events');assert(result.startsWith('event: state\n'));assert.equal(JSON.parse(result.split('data: ')[1]).settings.executionEnabled,false);res.emit('close');assert.equal(res.listenerCount('close'),1);});
test('all legacy execution routes are covered by the product stop switch',()=>{for(const p of ['batch/start','batch/continue','batch/retry','source/start','source/resume','tasks/abc/start','tasks/abc/resume','tasks/abc/acknowledge-manual','tasks/abc/complete-dry-run'])assert(executionRoute('/api/'+p));assert(!executionRoute('/api/batch/pause'));assert(!executionRoute('/api/source/import'));});
test('frozen production kernel matches the recorded baseline',async()=>assert.equal((await verifyKernel()).ok,true));
test('kernel verification detects edits and missing files',async t=>{const dir=await mkdtemp(join(tmpdir(),'ly-kernel-'));t.after(()=>rm(dir,{recursive:true,force:true}));await mkdir(join(dir,'engine'));await writeFile(join(dir,'engine','core'),'original');const manifest=join(dir,'lock.json');await writeFile(manifest,JSON.stringify({baselineCommit:'test',files:{'engine/core':digest('original')}}));assert.equal((await verifyKernel(dir,manifest)).ok,true);await writeFile(join(dir,'engine','core'),'changed');assert.deepEqual((await verifyKernel(dir,manifest)).changed,['engine/core']);});

test('duplicate clicks and persisted request replay never dispatch a task twice',async t=>{
 const x=await fixture(t);await x.api.saveSettings({executionEnabled:true,confirmShop:shop.name});
 const p=x.batch.preview(x.importId,1),b=x.batch.create({importId:x.importId,limit:1,mode:'LIVE',review:{reviewed:true,selectionHash:p.selectionHash,authorization:'isolated test'}},shop),requestId=randomUUID();
 const responses=await Promise.allSettled([x.call('start',{id:b.id,requestId}),x.call('start',{id:b.id,requestId})]);
 assert(responses.some(x=>x.status==='fulfilled'));await x.batch.pending;assert.equal(x.store.list().length,1);
 const before=x.store.events(x.store.list()[0].id).length,restarted=new ProductApi(x.params);let reply;
 await restarted.handle({method:'POST'},{},new URL('http://localhost/api/v1/start'),{body:async()=>({id:b.id,requestId}),json:(res,code,data)=>reply=data});
 assert.equal(reply.replayed,true);assert.equal(x.store.events(x.store.list()[0].id).length,before);assert.equal(x.flow.submits,0);
});
test('unknown submission appears as pending verification, never as a success or retry',async t=>{
 const x=await fixture(t),r=x.store.create(x.importId,x.tasks[0],'LIVE','SOURCE',{reviewed:true,taskHash:digest(x.tasks[0])});
 x.store.move(r.id,'RUNNING');x.store.move(r.id,'SUBMITTING');x.store.move(r.id,'RESULT_UNKNOWN','提交结果未知');
 const s=await x.api.snapshot();assert.equal(s.records[0].status,'待核验');assert.equal(s.overview.published,0);assert.equal(s.records[0].duplicateBlocked,true);
 await x.api.saveSettings({executionEnabled:true,confirmShop:shop.name});const check=await x.api.recovery({id:r.id},true);assert.equal(check.ready,false);assert(check.checks.some(c=>/无商品 ID/.test(c.detail)));
 await assert.rejects(x.call('resume-single',{id:r.id}),/核验/);assert.equal(x.flow.submits,0);assert.equal(x.store.run(r.id).state,'RESULT_UNKNOWN');
});
test('recovery refuses changed source files and does not advance the checkpoint',async t=>{
 const x=await fixture(t),r=x.store.create(x.importId,x.tasks[0],'LIVE','SOURCE',{reviewed:true,taskHash:digest(x.tasks[0])});x.store.move(r.id,'RUNNING');x.store.move(r.id,'PAUSED','程序中断');x.store.checkpoint(r.id,{step:'title'});
 await x.api.saveSettings({executionEnabled:true,confirmShop:shop.name});x.api.checkFiles=async()=>{throw Error('SOURCE_OR_ASSET_CHANGED');};
 const check=await x.api.recovery({id:r.id},true);assert.equal(check.ready,false);await assert.rejects(x.call('resume-single',{id:r.id}),/SOURCE_OR_ASSET/);assert.equal(x.store.run(r.id).checkpoint.step,'title');assert.equal(x.flow.submits,0);
});
test('same import is idempotent and preview labels failed material checks separately',async t=>{
 const x=await fixture(t),payload={sourceHash:'fixture',sheet:'境外城市热度',tasks:x.tasks};assert.equal(x.store.imported(payload),x.importId);
 const bad={...task(3),adapterIssues:['缺失主图']};const id=x.store.imported({...payload,sourceHash:'with-issue',tasks:[...x.tasks,bad]});
 const p=x.api.preview(id,2);assert.equal(p.classification['需补充'],1);assert.equal(p.classification['可执行'],2);assert.equal((await x.api.snapshot()).exceptions.find(e=>e.dataOnly).category,'资料问题');
});
test('published record links to its source batch and actual verification timestamp',async t=>{
 const x=await fixture(t);await x.api.saveSettings({executionEnabled:true,confirmShop:shop.name});const p=x.batch.preview(x.importId,1),b=x.batch.create({importId:x.importId,limit:1,mode:'LIVE',review:{reviewed:true,selectionHash:p.selectionHash,authorization:'isolated'}},shop);
 x.setOutcome('VERIFIED');await x.call('start',{id:b.id});await x.batch.pending;const r=(await x.api.snapshot()).records[0];assert.equal(r.batchId,b.id);assert.equal(r.importId,x.importId);assert.equal(r.timeBasis,'平台核验事件');assert.equal(r.at,x.store.events(r.runId).find(e=>e.kind==='VERIFIED').at);
});

test('configuration checks report missing paths without enabling execution',async t=>{
 const x=await fixture(t),heat=join(x.dir,'heat.xlsx'),pool=join(x.dir,'pool.xlsx');await writeFile(heat,'fixture');await writeFile(pool,'fixture');
 await x.api.saveSettings({heat,pool,assets:x.dir});let checks=await x.api.checkConfiguration();assert(checks.checks.every(x=>x.ok));
 await x.api.saveSettings({pool:join(x.dir,'missing.xlsx')});assert.equal(x.api.checkResult,null);checks=await x.api.checkConfiguration();assert.equal(checks.checks.find(c=>c.name==='商品 Excel').ok,false);assert.equal((await x.api.settings()).executionEnabled,false);assert.equal(x.flow.submits,0);
});
test('an in-flight step remains pausing until the persisted pause is available',async t=>{
 const x=await fixture(t);let release;
 x.flow.launch=function(id){this.active=id;this.stop=false;this.pending=(async()=>{x.store.move(id,'RUNNING');await new Promise(resolve=>release=resolve);x.store.checkpoint(id,{step:'title',pausedAt:new Date().toISOString()});x.store.move(id,'PAUSED','操作者暂停');})().finally(()=>this.active=null);};
 x.flow.pause=function(){this.stop=true;};
 await x.api.saveSettings({executionEnabled:true,confirmShop:shop.name});const p=x.batch.preview(x.importId,1),b=x.batch.create({importId:x.importId,limit:1,mode:'LIVE',review:{reviewed:true,selectionHash:p.selectionHash,authorization:'isolated'}},shop);
 await x.call('start',{id:b.id});await x.call('pause',{});let snapshot=await x.api.snapshot();assert.equal(snapshot.execution.state,'PAUSING');assert.equal(snapshot.execution.saved,false);assert.equal(x.store.list()[0].state,'RUNNING');
 release();await x.batch.pending;snapshot=await x.api.snapshot();assert.equal(snapshot.execution.state,'PAUSED');assert.equal(snapshot.execution.saved,true);assert.equal(x.store.list()[0].checkpoint.step,'title');assert.equal(x.flow.submits,0);
});
