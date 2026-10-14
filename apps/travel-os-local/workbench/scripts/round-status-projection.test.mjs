import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {SourceStore,digest,destinationKey} from '../source-store.mjs';
import {BatchWorkflow} from '../batch-workflow.mjs';
import {ProductApi} from '../product-api.mjs';
import {TravelOsApi} from '../travel-os-api.mjs';
import {retryPlan} from '../task-view-model.mjs';

const shop={id:'wuzhou-changyou',name:'五洲畅游'};
const candidateReason='后台有地名或商品范围待核验候选，已隔离且未提交：1048879687576 日本福冈包车服务';
const task=n=>({taskId:'fixture-'+n,shopId:shop.id,priority:n,source:{sheet:'境外城市热度',row:n},listing:{type:'city',country:'测试国家',city:['福冈市','洛杉矶','盐湖城','无原任务候选','内容核验','提交未知'][n-1]||'普通失败',title:'已冻结标题'+n},business:{shop_name:shop.name,price_cny:20,inventory:999999},assets:{main:[],secondary:[],details:[]},adapterIssues:[]});
const evidence=n=>({itemId:String(990000+n),status:'出售中',rowText:'isolated',screenshot:'isolated.png',verifiedAt:new Date().toISOString()});
async function fixture(t){
 const dir=await mkdtemp(join(tmpdir(),'ly-r8-projection-'));assert(resolve(dir).startsWith(resolve(tmpdir())+sep));
 const store=new SourceStore(join(dir,'state.sqlite')),tasks=Array.from({length:6},(_,i)=>task(i+1)),importId=store.imported({sourceHash:'isolated-r8',tasks,summary:{total:6}}),flow={store,runtime:dir,artifacts:join(dir,'tasks'),active:null,submits:0,preflight:async()=>{},pause(){},launch(){throw Error('Projection must never launch');},resume(){throw Error('Projection must never resume');}};
 const batch=new BatchWorkflow(flow),owner={sessions:new Map(),status:async()=>({running:true,loggedIn:true,loginState:'LOGGED_IN',checkedAt:new Date().toISOString()})};
 const api=new ProductApi({batch,source:flow,owner,shop,runtime:dir,launch:async()=>{throw Error('No browser launch');},integrity:async()=>({ok:true}),checkFiles:async()=>{}}),selected=[tasks[0],tasks[1],tasks[2],tasks[4],tasks[5]];
 const b=batch.store.create(importId,selected,shop.id,'LIVE',{reviewed:true,selectionHash:digest(selected),authorization:'isolated fixture'}),runs=[];
 for(const q of batch.store.items(b.id)){
  const r=store.create(importId,q.task,'LIVE','SOURCE',{reviewed:true,taskHash:digest(q.task)});runs.push(r.id);batch.store.attach(q.id,r.id);batch.store.claim(q.id);store.move(r.id,'RUNNING');
  if([3,5].includes(q.task.priority)){store.move(r.id,'SUBMITTING');store.move(r.id,'VERIFIED','',evidence(q.task.priority));batch.store.move(q.id,'SUCCEEDED','',evidence(q.task.priority));store.checkpoint(r.id,{step:'submit-once',pausedAt:'2026-10-01T00:00:00.000Z'});}
  else if(q.task.priority===6){store.move(r.id,'SUBMITTING');store.move(r.id,'RESULT_UNKNOWN','提交结果未知');batch.store.move(q.id,'WAITING_HUMAN','提交结果未知');store.checkpoint(r.id,{step:'submit-once'});}
  else{const reason='MATERIAL_UPLOAD_PREFERENCES：旧上传控件不可用';store.checkpoint(r.id,{step:'main-image-1',pausedAt:'2026-09-26T10:57:43.315Z',screenshot:join(flow.artifacts,r.id,'paused.png')});store.move(r.id,'PAUSED',reason);batch.store.move(q.id,'FAILED',reason);}
 }
 const r=await api.round.create({importId,repairVersion:'isolated-r8',expectedCount:6,authorization:{allowLive:true,maxSafeRecoveries:2,confirmedShop:shop.name,expectedCount:6}});
 const get=n=>api.round.item(r.id,destinationKey(tasks[n-1]));
 for(const n of [1,4])api.round.update(r.id,get(n).key,{state:'RESULT_UNKNOWN',failure_stage:'existing-listing-check',reason:candidateReason});
 api.round.update(r.id,get(5).key,{state:'RESULT_UNKNOWN',failure_stage:'content-review',reason:'本地主图错配，原商品内容待核验'});
 api.round.update(r.id,get(6).key,{state:'RESULT_UNKNOWN',failure_stage:'submit-once',reason:'提交结果未知'});
 api.round.state(r.id,'NEEDS_REVIEW','隔离待核验');
 const call=async path=>{let result;await api.handle({method:'GET'},{},new URL('http://localhost/api/v1/'+path),{json:(res,status,data)=>result=data});return result;};
 const raw=()=>JSON.stringify(['runs','batch_items','events','history','rounds','round_items','round_events'].map(name=>store.db.prepare('SELECT * FROM '+name).all()));
 const closers=[];t.after(async()=>{for(const close of closers)close();store.close();assert(resolve(dir).startsWith(resolve(tmpdir())+sep));await rm(dir,{recursive:true,force:true});});
 return {dir,store,flow,batch,owner,api,tasks,importId,roundId:r.id,batchId:b.id,get,call,raw,close:fn=>closers.push(fn)};
}

test('real old upload failure is projected as unsubmitted candidate hold in list, exceptions and details without changing history',async t=>{
 const x=await fixture(t),item=x.get(1),before=x.raw(),s=await x.api.snapshot(x.batchId),row=s.batch.items.find(i=>i.id===item.queue_id),exception=s.exceptions.find(i=>i.id===item.run_id),detail=await x.call('task?id='+item.run_id),queueDetail=await x.call('queue-task?id='+item.queue_id);
 for(const view of [row,exception,detail,queueDetail]){assert.equal(view.candidateHold,true);assert.equal(view.retryBlocked,true);assert.equal(view.displayState,'RESULT_UNKNOWN');assert.equal(view.reason,candidateReason);assert.equal(view.issue?.category||view.category,'商品范围待核验');assert(!/checkpoint|无 ID|必须.*商品 ID/.test(view.issue?.condition||view.condition));assert.match(view.history.reason,/MATERIAL_UPLOAD/);}
 assert.equal(row.state,'FAILED','the original queue state remains historical, not rewritten');assert.equal(row.attempts,1);assert.equal(exception.retryable,false);assert.equal(exception.exhausted,false);assert.equal(exception.submitted,false);
 assert.equal(detail.checkpoint.step,'主图 1','old checkpoint remains accessible');assert.equal(detail.history.step,'主图 1');assert.equal(detail.state,'RESULT_UNKNOWN');assert.equal(x.raw(),before);assert.equal(x.flow.submits,0);
 const p=retryPlan(s.batch,null);assert(!p.eligible.some(i=>i.id===item.queue_id));assert.equal(p.allowed,false);
});

test('candidate with no original run is visible once and has safe read-only detail identity',async t=>{
 const x=await fixture(t),s=await x.api.snapshot(x.batchId),item=x.get(4),rows=s.exceptions.filter(e=>e.key===item.key);
 assert.equal(rows.length,1);assert.equal(rows[0].runId,null);assert.equal(rows[0].candidateHold,true);assert.equal(rows[0].retryBlocked,true);assert.equal(rows[0].roundId,x.roundId);assert.equal(rows[0].reason,candidateReason);assert.equal(rows[0].state,'RESULT_UNKNOWN');
});

test('content hold and actual submitted unknown remain distinct from a candidate; ordinary failure keeps historical classification',async t=>{
 const x=await fixture(t),s=await x.api.snapshot(x.batchId),by=n=>s.batch.items.find(i=>i.id===x.get(n).queue_id);
 assert.equal(by(5).contentHold,true);assert.equal(by(5).roundHold.type,'content');assert.equal(by(6).roundHold.type,'submission');assert.equal(by(6).candidateHold,false);assert.equal(by(6).issue.category,'待核验');assert.match(by(6).issue.condition,/checkpoint/);
 assert.equal(by(2).displayState,'FAILED');assert.equal(by(2).issue.category,'上传页面异常');assert(!by(2).candidateHold);assert(retryPlan({items:[by(2)]},null).allowed);
 assert.equal(x.store.run(x.get(5).run_id).state,'VERIFIED');assert.equal(x.store.run(x.get(6).run_id).state,'RESULT_UNKNOWN');
});

test('OS attempts uses the same candidate projection and retains original execution evidence',async t=>{
 const x=await fixture(t),os=new TravelOsApi({product:async()=>x.api,shops:async()=>[shop],browser:x.owner,runtime:join(x.dir,'os')});x.close(()=>os.store.close());os.materials=async()=>({});const before=x.raw(),s=await os.snapshot(),a=s.attempts.find(a=>a.id===x.get(1).run_id);
 assert.equal(a.state,'RESULT_UNKNOWN');assert.equal(a.candidateHold,true);assert.equal(a.retryBlocked,true);assert.equal(a.reason,candidateReason);assert.equal(a.history.state,'PAUSED');assert.equal(a.history.step,'main-image-1');assert.equal(x.raw(),before);
});

test('projection will not attach a hold to a different shop, task hash, run or queue identity',async t=>{
 const x=await fixture(t),item=x.get(1),view={state:'FAILED',reason:'old',step:'old'},valid={key:item.key,runId:item.run_id,queueId:item.queue_id,task:item.task};
 assert.equal(x.api.projectRoundHold(view,valid).candidateHold,true);
 for(const input of [{...valid,key:x.get(2).key},{...valid,runId:'wrong-run'},{...valid,queueId:'wrong-queue'},{...valid,task:{...item.task,shopId:'other-shop'}},{...valid,task:{...item.task,listing:{...item.task.listing,title:'changed'}}}])assert.deepEqual(x.api.projectRoundHold(view,input),view);
});

test('old main-image and submit-once checkpoints never masquerade as this round check; actual source step remains visible',async t=>{
 const x=await fixture(t),r=x.api.round;
 for(const [n,expected] of [[2,'existing-listing-check'],[3,'known-listing-check']]){
  const item=x.get(n);r.active=x.roundId;x.batch.active='round:'+x.roundId;r.db.prepare("UPDATE rounds SET state='RUNNING',current_item=? WHERE id=?").run(item.key,x.roundId);
  const before=x.raw();assert.equal(r.summary(x.roundId).current.stage,expected);assert.equal(r.view(x.roundId).items.find(i=>i.key===item.key).stage,expected);assert.equal(x.raw(),before);
 }
 const item=x.get(2);r.db.prepare('UPDATE rounds SET current_item=? WHERE id=?').run(item.key,x.roundId);r.update(x.roundId,item.key,{entered_publish:1});x.flow.active=item.run_id;
 assert.equal(r.summary(x.roundId).current.stage,'main-image-1');assert.equal(r.view(x.roundId).items.find(i=>i.key===item.key).stage,'main-image-1');
 x.flow.active=null;r.active=null;x.batch.active=null;r.state(x.roundId,'NEEDS_REVIEW','原隔离');assert.notEqual(r.summary(x.roundId).current.stage,'main-image-1');assert.equal(x.store.run(item.run_id).checkpoint.step,'main-image-1');
});

test('hold survives API re-instantiation and original legacy HTTP dispatch remains blocked',async t=>{
 const x=await fixture(t);await x.api.saveSettings({executionEnabled:true,confirmShop:shop.name});const before=x.raw();
 const reloaded=new ProductApi({batch:x.batch,source:x.flow,owner:x.owner,shop,runtime:x.dir,launch:async()=>{throw Error('No browser');},integrity:async()=>({ok:true}),checkFiles:async()=>{}});assert.deepEqual(JSON.parse(x.raw()).slice(0,4),JSON.parse(before).slice(0,4),'startup recovery preserves original execution rows');assert.deepEqual(JSON.parse(x.raw())[5].filter(i=>i.failure_stage==='existing-listing-check'),JSON.parse(before)[5].filter(i=>i.failure_stage==='existing-listing-check'));assert.equal((await reloaded.snapshot(x.batchId)).exceptions.find(i=>i.id===x.get(1).run_id).candidateHold,true);
 for(const state of ['PAUSED','NEEDS_REVIEW']){x.api.round.state(x.roundId,state,'原隔离');await assert.rejects(x.api.assertExecution({legacy:true}),/固定清单轮次/);const s=await x.api.snapshot(x.batchId);assert.equal(s.batch.items.find(i=>i.id===x.get(1).queue_id).candidateHold,true);}
 assert.equal(x.flow.submits,0);assert(x.raw().includes('MATERIAL_UPLOAD_PREFERENCES'));assert(before.includes('MATERIAL_UPLOAD_PREFERENCES'));
});


test('old candidate wording is clarified for display without rewriting persisted evidence',async t=>{
 const x=await fixture(t),item=x.get(1),old='后台有同目的地候选，已隔离且未提交：1048879687576 福冈候选';x.api.round.update(x.roundId,item.key,{reason:old});const before=x.raw();
 const s=await x.api.snapshot(x.batchId),e=s.exceptions.find(i=>i.id===item.run_id);assert.match(e.reason,/地名或商品范围待核验候选/);assert.match(e.reason,/1048879687576/);assert.equal(x.api.round.item(x.roundId,item.key).reason,old);assert.equal(x.raw(),before);
});

test('active read-only verification phase overrides a historical unknown submit checkpoint',async t=>{
 const x=await fixture(t),item=x.get(6),r=x.api.round;r.active=x.roundId;r.db.prepare('UPDATE rounds SET current_item=? WHERE id=?').run(item.key,x.roundId);const before=x.raw();
 r.displayPhase(x.roundId,item.key,'known-listing-check');assert.equal(r.summary(x.roundId).current.stage,'known-listing-check');assert.equal(r.view(x.roundId).items.find(i=>i.key===item.key).stage,'known-listing-check');assert.equal(x.raw(),before);assert.equal(x.store.run(item.run_id).checkpoint.step,'submit-once');r.active=null;r.currentOperation=null;
});

test('failed resume verification persists its actual phase after the coordinator becomes idle and restarts',async t=>{
 const x=await fixture(t),r=x.api.round,item=x.get(2);
 r.active=x.roundId;x.batch.active='round:'+x.roundId;x.flow.queueLease='round:'+x.roundId;
 r.db.prepare('UPDATE rounds SET current_item=? WHERE id=?').run(item.key,x.roundId);
 const original=JSON.stringify(['runs','events','history'].map(name=>x.store.db.prepare('SELECT * FROM '+name).all()));
 // This fixture has no real assets; model an already-approved content gate.
 r.assertContentForTask=()=>{};
 r.verifyExisting=async()=>{throw Error('后台列表响应未成功');};
 let failure;try{await r.executeItem(x.roundId,item);}catch(e){failure=e;}
 assert.equal(failure?.message,'后台列表响应未成功');assert.equal(await r.failure(x.roundId,item,failure),false);
 r.active=null;r.currentOperation=null;x.batch.active=null;x.flow.queueLease=null;
 assert.equal(r.item(x.roundId,item.key).failure_stage,'existing-listing-query');
 assert.equal(r.summary(x.roundId).current.stage,'existing-listing-query');
 assert.equal(r.item(x.roundId,item.key).state,'PENDING');assert.equal(r.round(x.roundId).state,'SYSTEM_BLOCKED');
 assert.equal(JSON.stringify(['runs','events','history'].map(name=>x.store.db.prepare('SELECT * FROM '+name).all())),original);
 assert.equal(x.store.run(item.run_id).checkpoint.step,'main-image-1');
 const reloaded=new ProductApi({batch:x.batch,source:x.flow,owner:x.owner,shop,runtime:x.dir,launch:async()=>{throw Error('No browser');},integrity:async()=>({ok:true}),checkFiles:async()=>{}});
 assert.equal(reloaded.round.summary(x.roundId).current.stage,'existing-listing-query');assert.equal(x.flow.submits,0);
});

test('failure stage ignores stale round or item phases and uses the original checkpoint during source execution',async t=>{
 const x=await fixture(t),r=x.api.round,item=x.get(2);
 r.active=x.roundId;r.db.prepare('UPDATE rounds SET current_item=? WHERE id=?').run(item.key,x.roundId);
 for(const op of [{roundId:'other',key:item.key,stage:'existing-listing-check'},{roundId:x.roundId,key:x.get(1).key,stage:'existing-listing-check'},{roundId:x.roundId,key:item.key,stage:'source-execution'}]){
  r.currentOperation=op;await r.failure(x.roundId,item,Error('test failure'));
  assert.equal(r.item(x.roundId,item.key).failure_stage,'main-image-1');
 }
 r.active=null;r.currentOperation={roundId:x.roundId,key:item.key,stage:'existing-listing-check'};
 await r.failure(x.roundId,item,Error('test failure'));assert.equal(r.item(x.roundId,item.key).failure_stage,'main-image-1');
});

test('pause retains its original checkpoint and submitted-unknown evidence',async t=>{
 const x=await fixture(t),r=x.api.round,item=x.get(6),before=JSON.stringify(x.store.run(item.run_id));
 r.active=x.roundId;r.db.prepare('UPDATE rounds SET current_item=? WHERE id=?').run(item.key,x.roundId);
 r.displayPhase(x.roundId,item.key,'known-listing-check');r.pauseRequested=true;
 assert.equal(await r.failure(x.roundId,item,Object.assign(Error('pause'),{code:'ROUND_PAUSE'})),false);
 r.active=null;r.currentOperation=null;
 assert.equal(r.item(x.roundId,item.key).failure_stage,'submit-once');assert.equal(r.item(x.roundId,item.key).state,'RESULT_UNKNOWN');
 assert.equal(JSON.stringify(x.store.run(item.run_id)),before);assert.equal(x.flow.submits,0);
});
