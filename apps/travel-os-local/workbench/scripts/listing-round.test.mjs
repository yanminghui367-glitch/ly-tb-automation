import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SourceStore,digest,destinationKey} from '../source-store.mjs';
import {BatchWorkflow} from '../batch-workflow.mjs';
import {ListingRound,classifyRoundFailure} from '../listing-round.mjs';
import {RoundVerification} from '../round-verification.mjs';

const shop={id:'wuzhou-changyou',name:'五洲畅游'};
const task=n=>({schemaVersion:2,taskId:'task-'+n,shopId:shop.id,priority:n,source:{},listing:{type:'city',country:'国家',city:'城市'+n,title:'标题'+n},assets:{main:[],secondary:[],details:[]},business:{shop_name:shop.name,price_cny:20,inventory:999999},adapterIssues:[]});
const result=n=>({itemId:String(100000+n),status:'仓库中',rowText:'真实后台记录',screenshot:'evidence.png',verifiedAt:new Date().toISOString(),url:'https://item.taobao.com/item.htm?id='+String(100000+n)});
async function fixture(t,n=7,{tasks=Array.from({length:n},(_,i)=>task(i+1)),rules,classifyFailure,onGate}={}){
 const dir=await mkdtemp(join(tmpdir(),'ly-round-')),store=new SourceStore(join(dir,'state.sqlite')),importId=store.imported({sourceHash:'pool-hash',tasks,summary:{total:n}});
 t.after(async()=>{store.close();await rm(dir,{recursive:true,force:true});});
 let release,held=false,behavior=()=>({state:'VERIFIED'}),check=async()=>{},inspect=async({history})=>history||null,executionCheck=async()=>{};
 const flow={store,artifacts:dir,runtime:dir,active:null,submits:0,launches:[],stop:false,maxActive:0,
  launch(id){assert.equal(this.active,null,'single source owner');this.active=id;this.stop=false;this.launches.push(id);this.pending=(async()=>{const r=store.run(id);if(r.state!=='RESULT_UNKNOWN')store.move(id,'RUNNING');if(held)await new Promise(resolve=>release=resolve);if(this.stop){store.move(id,'PAUSED','操作者暂停');return;}const outcome=behavior(r);if(outcome.state==='VERIFIED'){if(r.state!=='RESULT_UNKNOWN'){store.move(id,'SUBMITTING');this.submits++;store.event(id,'SUBMIT_CLICKED',{});}store.move(id,'VERIFIED','',result(r.task.priority));}else if(outcome.state==='RESULT_UNKNOWN'){store.move(id,'SUBMITTING');this.submits++;store.event(id,'SUBMIT_CLICKED',{});store.checkpoint(id,{itemId:String(100000+r.task.priority),step:'submit-once'});store.move(id,'RESULT_UNKNOWN','submitted then disconnected');}else{store.checkpoint(id,{step:outcome.step||'main-image-1',errorCode:outcome.code});store.move(id,outcome.state||'PAUSED',outcome.reason||'MATERIAL_UPLOAD_UNCONFIRMED');}})().finally(()=>this.active=null);},
  async resume({id}){if(store.run(id).state!=='RESULT_UNKNOWN')store.move(id,'QUEUED');this.launch(id);},pause(){this.stop=true;release?.();},preflight:async()=>{}
 };
 const batch=new BatchWorkflow(flow),make=()=>new ListingRound({batch,source:flow,shop,contentReviews:{assertApproved:()=>({decision:"PASS"})},rules,checkFiles:t=>check(t),assertExecution:v=>executionCheck(v),verifyExisting:v=>inspect(v),artifacts:join(dir,'rounds'),classifyFailure,onGate});
 const round=make();
 const authorization={source:'user-goal-20261008',objectiveSha256:'a'.repeat(64),allowLive:true,maxSafeRecoveries:2,confirmedShop:shop.name,expectedCount:n};
 const create=options=>round.create({importId,authorization,repairVersion:'tested-v1',expectedCount:n,...options});
 const finish=async id=>{round.start(id);await round.pending;if(round.view(id).state==='PAUSED'&&round.view(id).gate===1){round.resume(id);await round.pending;}return round.view(id);};
 return {dir,store,tasks,flow,batch,round,make,authorization,create,finish,importId,setBehavior:f=>behavior=f,setInspect:f=>inspect=f,setCheck:f=>check=f,setExecutionCheck:f=>executionCheck=f,hold:()=>held=true,release:()=>{held=false;release?.();}};
}

test('one true publish pauses persistently, explicit resume passes five gate then finishes',async t=>{
 const x=await fixture(t),r=await x.create();x.round.start(r.id);await x.round.pending;let view=x.round.view(r.id);
 assert.equal(view.state,'PAUSED');assert.equal(view.gate,1);assert.equal(view.counts.NEW_SUCCESS,1);assert.equal(x.flow.submits,1);assert.equal(x.batch.active,null);
 x.round.resume(r.id);await x.round.pending;view=x.round.view(r.id);assert.equal(view.state,'COMPLETED');assert.equal(view.gate,5);assert.equal(view.counts.NEW_SUCCESS,7);assert.equal(x.flow.submits,7);assert(x.round.events(r.id).some(e=>e.kind==='GATE_ONE_RESUMED'));assert.throws(()=>x.round.start(r.id),/已结束/);
});

test('700 exact entries continue across <=100 internal batches and preserve counts',async t=>{
 const x=await fixture(t,700),r=await x.create(),v=await x.finish(r.id);
 assert.equal(v.state,'COMPLETED');assert.equal(v.total,700);assert.equal(v.counts.NEW_SUCCESS,700);assert.equal(Object.values(v.counts).reduce((a,b)=>a+b),700);assert.equal(x.flow.submits,700);
 const internal=x.round.events(r.id).filter(e=>e.kind==='INTERNAL_BATCH_CREATED');assert(internal.length>7);assert(internal.every(e=>e.payload.count<=100));assert.equal(internal.reduce((n,e)=>n+e.payload.count,0),700);assert.equal(new Set(x.flow.launches).size,700);
 const csv=x.round.csv(r.id);assert.equal(csv.split('\r\n').length,701);assert(v.items.every(i=>!('task'in i)&&i.result.status==='仓库中'));
});

test('duplicate starts own synchronous single lease before async permission resolves',async t=>{
 const x=await fixture(t,2),r=await x.create();let ready;x.setExecutionCheck(()=>new Promise(resolve=>ready=resolve));x.round.start(r.id);
 assert.equal(x.batch.active,'round:'+r.id);assert.equal(x.flow.queueLease,'round:'+r.id);assert.throws(()=>x.round.start(r.id),/已有/);assert.throws(()=>x.batch.start('unrelated',shop),/已有/);ready();await x.round.pending;assert.equal(x.flow.submits,1);
});

test('pause and stop reach the original source and never dispatch next task',async t=>{
 const x=await fixture(t,3),r=await x.create();x.hold();x.round.start(r.id);while(!x.flow.active)await new Promise(resolve=>setTimeout(resolve,1));x.round.stop();x.release();await x.round.pending;
 assert.equal(x.round.view(r.id).state,'STOPPED');assert.equal(x.flow.submits,0);assert.equal(x.flow.launches.length,1);assert.equal(x.round.view(r.id).counts.PENDING,3);
 x.round.resume(r.id);await x.round.pending;assert.equal(x.flow.submits,1);x.round.resume(r.id);await x.round.pending;assert.equal(x.flow.submits,3);
});

test('one task missing assets is preflight skipped, no submit, subsequent products continue',async t=>{
 const x=await fixture(t,3);x.setCheck(async task=>{if(task.priority===1)throw Error('ENOENT: main.jpg');});const r=await x.create(),v=await x.finish(r.id);
 assert.equal(v.counts.PREFLIGHT_SKIPPED,1);assert.equal(v.counts.NEW_SUCCESS,2);assert.equal(v.items[0].enteredPublish,false);assert.equal(v.items[0].submitted,false);assert.equal(x.flow.submits,2);
});

test('explicit product failure is terminal and does not block next product',async t=>{
 const x=await fixture(t,3);x.setBehavior(run=>run.task.priority===1?{state:'PAUSED',reason:'TASK_DATA: 本商品属性值不合法',code:'TASK_DATA'}:{state:'VERIFIED'});const r=await x.create(),v=await x.finish(r.id);
 assert.equal(v.counts.FAILED,1);assert.equal(v.counts.NEW_SUCCESS,2);assert.equal(v.items[0].enteredPublish,true);assert.equal(v.items[0].submitted,false);assert.equal(x.flow.launches.length,3);
});

test('unrecognized recurring system fault pauses first item without failing rest',async t=>{
 const x=await fixture(t,7);x.setBehavior(()=>({state:'PAUSED',reason:'selector disappeared'}));const r=await x.create();x.round.start(r.id);await x.round.pending;
 const v=x.round.view(r.id);assert.equal(v.state,'SYSTEM_BLOCKED');assert.equal(v.counts.PENDING,7);assert.equal(v.counts.FAILED,0);assert.equal(x.flow.launches.length,1);
});

test('declared safe transient step receives at most two retries; third same error pauses',async t=>{
 const x=await fixture(t,3);x.setBehavior(()=>({state:'PAUSED',reason:'transient upload network',code:'SAFE_RETRY_UPLOAD'}));const r=await x.create();x.round.start(r.id);await x.round.pending;
 const v=x.round.view(r.id);assert.equal(v.state,'SYSTEM_BLOCKED');assert.equal(v.counts.PENDING,3);assert.equal(x.flow.launches.length,3);assert.equal(x.flow.submits,0);assert.equal(x.round.item(r.id,v.items[0].key).retry_counts['main-image-1'],2);assert.equal(x.round.round(r.id).system_count,3);
});

test('CAPTCHA cannot continue without manual acknowledgement and preserves original run',async t=>{
 const x=await fixture(t,2);x.setBehavior(()=>({state:'PAUSED_CAPTCHA',reason:'PAUSED_CAPTCHA'}));const r=await x.create();x.round.start(r.id);await x.round.pending;const original=x.round.view(r.id).items[0].runId;
 assert.equal(x.round.view(r.id).state,'WAITING_HUMAN');assert.throws(()=>x.round.resume(r.id),/人工/);x.setBehavior(()=>({state:'VERIFIED'}));x.round.resume(r.id,{humanVerified:true});await x.round.pending;assert.equal(x.round.view(r.id).items[0].runId,original);assert.equal(x.flow.submits,1);
});

test('unknown submission is isolated and only existing lookup can resolve it',async t=>{
 const x=await fixture(t,2);x.setBehavior(()=>({state:'RESULT_UNKNOWN'}));const r=await x.create();x.round.start(r.id);await x.round.pending;let v=x.round.view(r.id);
 assert.equal(v.state,'RESULT_UNKNOWN');assert.equal(v.counts.RESULT_UNKNOWN,1);assert.equal(v.counts.PENDING,1);assert.equal(x.flow.submits,1);
 x.setInspect(async({run,history})=>run?.state==='RESULT_UNKNOWN'?result(run.task.priority):history||null);x.setBehavior(()=>({state:'VERIFIED'}));x.round.resume(r.id);await x.round.pending;assert.equal(x.flow.submits,1);assert.equal(x.round.view(r.id).counts.NEW_SUCCESS,1);x.round.resume(r.id);await x.round.pending;assert.equal(x.flow.submits,2);
});
test('missing-ID original submit bypasses ignore-destination policy only for strict read-only recovery, then seals NEW_SUCCESS',async t=>{
 const x=await fixture(t,2);x.setBehavior(()=>({state:'RESULT_UNKNOWN'}));const r=await x.create();x.round.start(r.id);await x.round.pending;
 const entry=x.round.view(r.id).items[0],run=x.store.run(entry.runId),taskBefore=digest(run.task),manifest=x.round.round(r.id).manifest_hash;
 x.store.checkpoint(run.id,{itemId:null});
 x.store.db.prepare("UPDATE events SET at=? WHERE run=? AND kind='SUBMITTING'").run('2026-10-18T14:00:00Z',run.id);
 x.store.db.prepare("UPDATE events SET at=? WHERE run=? AND kind='SUBMIT_CLICKED'").run('2026-10-18T14:00:10Z',run.id);
 x.store.db.prepare("UPDATE events SET at=? WHERE run=? AND kind='RESULT_UNKNOWN'").run('2026-10-18T14:01:00Z',run.id);
 let queries=0;const evidence={...result(1),status:'出售中',createdAt:'2026-10-18 22:00:30'};
 const verifier=new RoundVerification({context:()=>({}),guard:async()=>{},round:()=>({round:{...x.round.round(r.id),policies:{'ignore-destination-duplicates':{enabled:true,scope:'THIS_ROUND_ONLY',manifestHash:manifest,shop:run.task.shopId}}},items:x.round.items(r.id)}),artifacts:x.dir,
  tableFactory:async()=>({page:{},search:async query=>{queries++;assert.deepEqual(query,{title:run.task.listing.title});return {records:[{itemId:evidence.itemId,title:run.task.listing.title,status:'出售中',text:'原商品证据',cells:[{label:'价格',text:'20'},{label:'库存',text:'999999'},{label:'创建时间',text:evidence.createdAt}]}]};}}),evidence:async()=>evidence});
 x.setInspect(args=>verifier.verify(args));
 // This test exercises the original lease and reconciliation without dispatching
 // another source execution or automatically proceeding to the second item.
 x.round.active=r.id;x.flow.queueLease='round:'+r.id;x.batch.active='round:'+r.id;
 try{await x.round.verify(r.id,x.round.item(r.id,entry.key));}finally{x.round.active=null;x.flow.queueLease=null;x.batch.active=null;}
 const after=x.round.item(r.id,entry.key);assert.equal(after.state,'NEW_SUCCESS');assert.equal(x.store.run(run.id).state,'VERIFIED');assert.equal(x.batch.store.item(after.queue_id).state,'SUCCEEDED');
 assert.equal(queries,1);assert.equal(x.flow.submits,1);assert.equal(x.flow.launches.length,1);assert.equal(x.batch.store.item(after.queue_id).attempts,1);assert.equal(x.round.items(r.id)[1].state,'PENDING');
 assert.equal(x.round.round(r.id).manifest_hash,manifest);assert.equal(digest(x.store.run(run.id).task),taskBefore);
});

test('crash after original VERIFIED repairs round without resubmission or new run',async t=>{
 const x=await fixture(t,1),r=await x.create();x.round.start(r.id);await x.round.pending;const v=x.round.view(r.id),key=v.items[0].key;
 x.store.db.prepare("UPDATE round_items SET state='PENDING',result=NULL WHERE round_id=? AND key=?").run(r.id,key);x.store.db.prepare("UPDATE rounds SET state='RUNNING' WHERE id=?").run(r.id);
 const recovered=x.make();assert.equal(recovered.view(r.id).state,'PAUSED');assert.equal(recovered.view(r.id).counts.NEW_SUCCESS,1);assert.equal(x.flow.submits,1);recovered.resume(r.id);await recovered.pending;assert.equal(recovered.view(r.id).state,'COMPLETED');assert.equal(x.flow.submits,1);
});

test('history success is freshly verified without consuming new publish gates',async t=>{
 const x=await fixture(t,3);for(const task of x.tasks)x.store.history(task,result(task.priority));let looked=0;x.setInspect(async({history,itemId})=>{looked++;assert(itemId);return history;});const r=await x.create(),v=await x.finish(r.id);
 assert.equal(v.counts.EXISTING_VERIFIED,3);assert.equal(v.gate,0);assert.equal(x.flow.submits,0);assert.equal(looked,3);assert.equal(x.store.list().length,0);
});

test('existing history ID not found never becomes a new publication',async t=>{
 const x=await fixture(t,2);x.store.history(x.tasks[0],result(1));x.setInspect(async()=>null);const r=await x.create();x.round.start(r.id);await x.round.pending;
 assert.equal(x.round.view(r.id).state,'RESULT_UNKNOWN');assert.equal(x.flow.submits,0);assert.equal(x.store.list().length,0);
});

test('backend manual listing found before new-task entry is existing rather than re-published',async t=>{
 const x=await fixture(t,2);x.setInspect(async({task,history})=>history||result(task.priority));const r=await x.create(),v=await x.finish(r.id);
 assert.equal(v.counts.EXISTING_VERIFIED,2);assert.equal(x.flow.submits,0);assert.equal(x.store.completed(x.tasks[0]).itemId,result(1).itemId);
});

test('duplicate candidates block before upload without marking the manifest task failed',async t=>{
 const x=await fixture(t,2);x.setInspect(async()=>{throw Object.assign(Error('本店候选不唯一'),{code:'DUPLICATE_AMBIGUOUS'});});const r=await x.create();x.round.start(r.id);await x.round.pending;
 assert.equal(x.round.view(r.id).counts.RESULT_UNKNOWN,1);assert.equal(x.flow.submits,0);assert.equal(x.round.view(r.id).counts.FAILED,0);
});

test('user-confirmed active-round rules release only proven pre-submit duplicate holds and the exact transliteration item',async t=>{
 const tasks=[task(1),{...task(2),listing:{type:'city',country:'美国',city:'戴德姆',title:'戴德姆美国定制服务'},assets:{main:[{sha256:'a'.repeat(64)}],secondary:[],details:[]}},task(3)];
 const x=await fixture(t,3,{tasks});let saved=[];x.round.contentReviews.save=items=>saved.push(...items);
 const r=await x.create();x.round.state(r.id,'WAITING_HUMAN','验证码暂停');
 const [candidate,alias,submitted]=x.round.items(r.id);x.round.update(r.id,candidate.key,{state:'RESULT_UNKNOWN',failure_stage:'existing-listing-check',reason:'店内同目的地候选'});
 x.round.update(r.id,alias.key,{state:'WAITING_HUMAN',failure_stage:'content-preflight',reason:'戴德姆/德德姆译名待核'});
 x.round.update(r.id,submitted.key,{state:'RESULT_UNKNOWN',failure_stage:'existing-listing-check',entered_publish:1,reason:'提交阶段已进入'});
 const manifest=x.round.round(r.id).manifest_hash,out=x.round.applyUserRules(r.id,{manifestHash:manifest,ignoreDestinationDuplicates:true,acceptDedhamTransliteration:true,confirmedBy:'用户确认'});
 assert.equal(out.applied.find(p=>p.policy==='ignore-destination-duplicates').releasedCount,1);assert.equal(x.round.round(r.id).manifest_hash,manifest);
 assert.equal(x.round.item(r.id,candidate.key).state,'PENDING');assert.equal(x.round.item(r.id,alias.key).state,'PENDING');assert.equal(x.round.item(r.id,submitted.key).state,'RESULT_UNKNOWN');
 assert.equal(saved.length,1);assert.equal(saved[0].method,'user-confirmed-transliteration');assert.equal(saved[0].observedText,'德德姆');assert.equal(x.round.events(r.id).filter(e=>e.kind==='DESTINATION_DUPLICATE_HOLD_RELEASED').length,1);assert.equal(x.flow.submits,0);
});

test('exact count, same shop and destination uniqueness gate fixed manifest',async t=>{
 const x=await fixture(t,2);await assert.rejects(x.create({expectedCount:700}),/数量|授权/);
 const other=x.store.imported({sourceHash:'other',tasks:[task(1),{...task(2),shopId:'other'}]});await assert.rejects(x.create({importId:other}),/其他店铺/);
 const duplicate=x.store.imported({sourceHash:'dupe',tasks:[task(1),task(1)]});await assert.rejects(x.create({importId:duplicate}),/重复/);assert.equal(x.round.round(),null);
});

test('old frozen variants and stable identity survive a newer heat mapping and random rules',async t=>{
 let prepared=[];const rules={async prepare(preview){prepared.push(preview.tasks.map(t=>t.priority));return {...preview,tasks:preview.tasks.map(t=>({...t,publishVariant:{chosen:'new-fixed'}}))};}};
 const x=await fixture(t,3,{rules}),oldTask={...x.tasks[0],publishVariant:{chosen:'old-fixed'}},run=x.store.create(x.importId,oldTask,'LIVE','SOURCE',{reviewed:true,taskHash:digest(oldTask)});
 const heat=x.store.imported({sourceHash:'heat',poolHash:'pool-hash',tasks:x.tasks.map(t=>({...t,listing:{...t.listing,title:'热度标题'+t.priority}}))});
 const r=await x.create({heatImportId:heat}),entries=x.round.items(r.id);assert.equal(entries[0].run_id,run.id);assert.equal(entries[0].task.publishVariant.chosen,'old-fixed');assert.equal(entries[0].task.listing.title,'标题1');assert.equal(entries[1].task.listing.title,'热度标题2');assert.deepEqual(prepared,[[2,3]]);assert.equal(entries[1].task.publishVariant.chosen,'new-fixed');
 x.round.assertManifest(r.id);x.store.db.prepare('UPDATE round_items SET task_hash=? WHERE round_id=? AND key=?').run('changed',r.id,entries[1].key);assert.throws(()=>x.round.start(r.id),/变化/);
});

test('preexisting failed queue and its spent attempts are not reset by round creation',async t=>{
 const x=await fixture(t,1),b=x.batch.store.create(x.importId,x.tasks,shop.id,'LIVE',{reviewed:true,selectionHash:digest(x.tasks),authorization:'old'}),q=x.batch.store.items(b.id)[0];
 const run=x.store.create(x.importId,x.tasks[0],'LIVE','SOURCE',{reviewed:true,taskHash:digest(x.tasks[0])});x.batch.store.attach(q.id,run.id);x.store.move(run.id,'RUNNING');x.store.move(run.id,'PAUSED','MATERIAL_UPLOAD_UNCONFIRMED');
 for(let i=0;i<3;i++){if(i)x.batch.store.move(q.id,'RETRY');x.batch.store.claim(q.id);x.batch.store.move(q.id,'FAILED','MATERIAL_UPLOAD_UNCONFIRMED');}x.batch.store.setBatch(b.id,'PAUSED');
 const r=await x.create();assert.equal(x.batch.store.item(q.id).attempts,3);x.round.start(r.id);await x.round.pending;
 assert.equal(x.batch.store.item(q.id).attempts,4);assert.equal(x.batch.store.item(q.id).max_attempts,3);assert.equal(x.round.view(r.id).items[0].extraAttempts,1);assert.equal(x.round.view(r.id).items[0].runId,run.id);assert.equal(x.flow.submits,1);
});

test('classifiers keep unknown bugs blocked and explicit task data separate from CAPTCHA',()=>{
 assert.equal(classifyRoundFailure(Error('属性控件找不到')).kind,'SYSTEM');assert.equal(classifyRoundFailure(Error('TASK_DATA: bad input')).kind,'PRODUCT');assert.equal(classifyRoundFailure(Error('CAPTCHA')).kind,'HUMAN');assert.equal(classifyRoundFailure(Error('network'),{run:{state:'SUBMITTING'}}).kind,'UNKNOWN');
});

test('constructor does not accept historical VERIFIED without a current-round backend check',async t=>{
 const x=await fixture(t,1),r0=x.store.create(x.importId,x.tasks[0],'LIVE','SOURCE',{reviewed:true,taskHash:digest(x.tasks[0])});x.store.move(r0.id,'RUNNING');x.store.move(r0.id,'SUBMITTING');x.store.move(r0.id,'VERIFIED','',result(1));
 const round=await x.create(),reopened=x.make();assert.equal(reopened.view(round.id).counts.PENDING,1);assert.equal(reopened.view(round.id).counts.EXISTING_VERIFIED,0);let checks=0;x.setInspect(async({history})=>{checks++;return history;});reopened.start(round.id);await reopened.pending;assert.equal(checks,1);assert.equal(reopened.view(round.id).counts.EXISTING_VERIFIED,1);assert.equal(reopened.view(round.id).items[0].submitted,false);assert.equal(reopened.view(round.id).items[0].submissionUncertain,false);assert.equal(x.flow.submits,0);
});

test('submit intent alone is not reported as a confirmed click, and remains protected',async t=>{
 const x=await fixture(t,1),r=await x.create();x.round.start(r.id);await x.round.pending;const runId=x.round.view(r.id).items[0].runId;
 x.store.db.prepare("UPDATE runs SET state='RESULT_UNKNOWN',result=NULL WHERE id=?").run(runId);x.store.db.prepare("DELETE FROM events WHERE run=? AND kind IN ('SUBMIT_CLICKED','VERIFIED')").run(runId);x.store.db.prepare("UPDATE round_items SET state='PENDING' WHERE round_id=?").run(r.id);
 const reopened=x.make(),v=reopened.view(r.id);assert.equal(v.items[0].submitted,false);assert.equal(v.items[0].submissionUncertain,true);assert(reopened.csv(r.id).includes('可能已提交'));assert.equal(reopened.wasSubmitted(x.store.run(runId)),true);
});

test('new repair version is audited and does not reset exhausted safe retries',async t=>{
 const x=await fixture(t,1);x.setBehavior(()=>({state:'PAUSED',reason:'MATERIAL_UPLOAD_TRANSIENT',code:'SAFE_RETRY_UPLOAD'}));const r=await x.create();x.round.start(r.id);await x.round.pending;const key=x.round.view(r.id).items[0].key;
 assert.equal(x.round.item(r.id,key).retry_counts['main-image-1'],2);x.setBehavior(()=>({state:'VERIFIED'}));x.round.resume(r.id,{repairVersion:'tested-v2'});await x.round.pending;
 assert.equal(x.round.item(r.id,key).retry_counts['main-image-1'],2);assert.equal(x.round.view(r.id).repairVersion,'tested-v2');assert(x.round.events(r.id).some(e=>e.kind==='REPAIR_VERSION_UPDATED'));assert.equal(x.batch.store.item(x.round.item(r.id,key).queue_id).attempts,3);assert.equal(x.round.view(r.id).state,'SYSTEM_BLOCKED');assert.equal(x.flow.submits,0);
});

test('shared missing source is a system blocker, not 700 preflight skips',async t=>{
 const tasks=[task(1),task(2),task(3)].map(t=>({...t,source:{workbook:'D:/shared.xlsx'}})),x=await fixture(t,3,{tasks});x.setCheck(async()=>{throw Object.assign(Error('ENOENT shared workbook'),{code:'ENOENT',path:'D:\\shared.xlsx'});});
 const r=await x.create();x.round.start(r.id);await x.round.pending;const v=x.round.view(r.id);assert.equal(v.state,'SYSTEM_BLOCKED');assert.equal(v.counts.PREFLIGHT_SKIPPED,0);assert.equal(v.counts.PENDING,3);assert.equal(x.flow.submits,0);
});

test('unattributed source hash change pauses for diagnosis instead of mass skipping',async t=>{
 const x=await fixture(t,3);x.setCheck(async()=>{throw Error('SOURCE_OR_ASSET_CHANGED');});const r=await x.create();x.round.start(r.id);await x.round.pending;
 assert.equal(x.round.view(r.id).state,'SYSTEM_BLOCKED');assert.equal(x.round.view(r.id).counts.PENDING,3);assert.equal(x.round.view(r.id).counts.PREFLIGHT_SKIPPED,0);
});

test('proven pre-submit existence ambiguity is isolated and safe other tasks continue',async t=>{
 const x=await fixture(t,4);let ambiguousChecks=0;x.setInspect(async({task,history})=>{if(task.priority===1){ambiguousChecks++;throw Object.assign(Error('完整本店清单有候选100001/100099，无法唯一对应'),{code:'EXISTENCE_AMBIGUOUS',isolated:true,candidateIds:['100001','100099']});}return history||null;});
 const r=await x.create(),v=await x.finish(r.id);assert.equal(v.state,'NEEDS_REVIEW');assert.equal(v.counts.RESULT_UNKNOWN,1);assert.equal(v.counts.NEW_SUCCESS,3);assert.equal(x.flow.submits,3);assert.equal(v.items[0].stage,'existing-listing-check');assert.equal(v.items[0].enteredPublish,false);assert.equal(v.items[0].submitted,false);
 x.round.resume(r.id);await x.round.pending;assert.equal(ambiguousChecks,1);assert.equal(x.flow.submits,3);assert.equal(x.round.view(r.id).state,'NEEDS_REVIEW');
});

test('an ambiguity without explicit isolation evidence cannot silently skip',async t=>{
 const x=await fixture(t,2);x.setInspect(async()=>{throw Object.assign(Error('结果未加载'),{code:'EXISTENCE_AMBIGUOUS'});});const r=await x.create();x.round.start(r.id);await x.round.pending;assert.equal(x.round.view(r.id).state,'SYSTEM_BLOCKED');assert.equal(x.round.view(r.id).counts.PENDING,2);assert.equal(x.flow.submits,0);
});

test('concurrent exports serialize atomic file replacement and preserve parseable records',async t=>{
 const x=await fixture(t,2),r=await x.create();const reports=await Promise.all(Array.from({length:8},()=>x.round.report(r.id)));assert(reports.every(v=>v.total===2));const saved=JSON.parse(await readFile(join(reports[0].directory,'report.json'),'utf8'));assert.equal(saved.id,r.id);assert.equal(saved.total,2);assert.equal((await readFile(join(reports[0].directory,'results.csv'),'utf8')).split('\r\n').length,3);
});

test('crash between first success and gate write cannot silently run a second product',async t=>{
 const x=await fixture(t,2),r=await x.create();x.round.start(r.id);await x.round.pending;assert.equal(x.flow.submits,1);
 x.store.db.prepare('UPDATE rounds SET gate=0,state=? WHERE id=?').run('RUNNING',r.id);x.store.db.prepare("DELETE FROM round_events WHERE round_id=? AND kind='GATE_ONE_VERIFIED'").run(r.id);
 const recovered=x.make();recovered.resume(r.id);await recovered.pending;assert.equal(recovered.view(r.id).state,'PAUSED');assert.equal(recovered.view(r.id).gate,1);assert.equal(x.flow.submits,1);assert.equal(x.flow.launches.length,1);
});

test('lightweight summary aggregates SQL and loads only current task, without full view or N+1',async t=>{
 const x=await fixture(t,3),r=await x.create();x.hold();x.round.start(r.id);while(!x.flow.active)await new Promise(resolve=>setTimeout(resolve,1));x.store.checkpoint(x.flow.active,{step:'inventory'});
 const methods={items:x.round.items,item:x.round.item,view:x.round.view};for(const name of Object.keys(methods))x.round[name]=()=>{throw Error('full manifest must not load in summary');};
 const summary=x.round.summary(r.id);assert.equal(summary.total,3);assert.equal(summary.counts.PENDING,3);assert.equal(summary.active,true);assert.equal(summary.current.runId,x.flow.active);assert.equal(summary.current.stage,'inventory');assert.equal(summary.current.destination,'城市1');assert.equal('items'in summary,false);assert.equal('task'in summary.current,false);
 Object.assign(x.round,methods);x.round.pause();x.release();await x.round.pending;assert.equal(x.round.summary(r.id).active,false);assert.deepEqual(x.round.summary(r.id).counts,x.round.view(r.id).counts);
});

test('restart recovers committed internal batch with absent and partial round mappings',async t=>{
 const x=await fixture(t,2),r=await x.create();x.round.state(r.id,'RUNNING');
 const b=x.batch.store.create(x.importId,x.tasks,shop.id,'LIVE',{reviewed:true,selectionHash:digest(x.tasks),authorization:x.authorization,roundId:r.id,manifestHash:r.manifestHash},{roundId:r.id});
 const first=x.batch.store.items(b.id)[0];x.round.update(r.id,first.key,{queue_id:first.id,batch_id:b.id});
 const recovered=x.make();assert.equal(recovered.view(r.id).state,'PAUSED');assert(recovered.items(r.id).every(i=>i.batch_id===b.id&&i.queue_id));assert.equal(x.store.db.prepare('SELECT COUNT(*) n FROM batches').get().n,1);
 recovered.start(r.id);await recovered.pending;recovered.resume(r.id);await recovered.pending;assert.equal(x.flow.submits,2);assert.equal(x.store.db.prepare('SELECT COUNT(*) n FROM batches').get().n,1);assert.equal(new Set(x.flow.launches).size,2);
});

test('committed queue for preexisting single run is linked back without replacing that run',async t=>{
 const x=await fixture(t,1),old=x.store.create(x.importId,x.tasks[0],'LIVE','SOURCE',{reviewed:true,taskHash:digest(x.tasks[0])}),r=await x.create();x.round.state(r.id,'RUNNING');
 const b=x.batch.store.create(x.importId,x.tasks,shop.id,'LIVE',{reviewed:true,selectionHash:digest(x.tasks),authorization:x.authorization,roundId:r.id,manifestHash:r.manifestHash},{roundId:r.id});
 const recovered=x.make(),item=recovered.items(r.id)[0];assert.equal(item.run_id,old.id);assert.equal(x.batch.store.item(item.queue_id).run_id,old.id);assert.equal(item.batch_id,b.id);recovered.start(r.id);await recovered.pending;assert.equal(x.flow.submits,1);assert.equal(x.flow.launches[0],old.id);assert.equal(x.store.list().length,1);
});

test('committed new source run is recovered only with this rounds creation authorization',async t=>{
 const x=await fixture(t,1),r=await x.create();x.round.state(r.id,'RUNNING');x.batch.store.create(x.importId,x.tasks,shop.id,'LIVE',{reviewed:true,selectionHash:digest(x.tasks),authorization:x.authorization,roundId:r.id,manifestHash:r.manifestHash},{roundId:r.id});
 const run=x.store.create(x.importId,x.tasks[0],'LIVE','SOURCE',{reviewed:true,taskHash:digest(x.tasks[0]),roundId:r.id});const recovered=x.make(),item=recovered.items(r.id)[0];assert.equal(item.run_id,run.id);assert.equal(x.batch.store.item(item.queue_id).run_id,run.id);recovered.start(r.id);await recovered.pending;assert.equal(x.flow.submits,1);assert.equal(x.store.list().length,1);
});

test('orphan queue with different round ownership is never silently adopted',async t=>{
 const x=await fixture(t,1),r=await x.create();x.round.state(r.id,'RUNNING');const b=x.batch.store.create(x.importId,x.tasks,shop.id,'LIVE',{reviewed:true,selectionHash:digest(x.tasks),authorization:x.authorization,roundId:r.id,manifestHash:r.manifestHash},{roundId:r.id});
 x.store.db.prepare('UPDATE batches SET review=? WHERE id=?').run(JSON.stringify({roundId:'other-round',manifestHash:r.manifestHash}),b.id);const recovered=x.make();assert.equal(recovered.view(r.id).state,'SYSTEM_BLOCKED');assert.equal(recovered.items(r.id)[0].queue_id,null);assert.throws(()=>recovered.start(r.id),/并非本轮/);assert.equal(x.flow.submits,0);
});

test('SUBMITTING live evidence resolves source, queue and round together without another submit',async t=>{
 const x=await fixture(t,1),r=await x.create();x.round.state(r.id,'RUNNING');const b=x.batch.store.create(x.importId,x.tasks,shop.id,'LIVE',{reviewed:true,selectionHash:digest(x.tasks),authorization:x.authorization,roundId:r.id,manifestHash:r.manifestHash},{roundId:r.id}),q=x.batch.store.items(b.id)[0];x.round.update(r.id,q.key,{queue_id:q.id,batch_id:b.id});x.batch.store.claim(q.id,{roundId:r.id});
 const run=x.store.create(x.importId,x.tasks[0],'LIVE','SOURCE',{reviewed:true,taskHash:digest(x.tasks[0]),roundId:r.id});x.batch.store.attach(q.id,run.id);x.round.update(r.id,q.key,{run_id:run.id,entered_publish:1});x.store.move(run.id,'RUNNING');x.store.move(run.id,'SUBMITTING');x.store.checkpoint(run.id,{itemId:result(1).itemId});
 x.setInspect(async()=>result(1));x.round.start(r.id);await x.round.pending;assert.equal(x.store.run(run.id).state,'VERIFIED');assert.equal(x.batch.store.item(q.id).state,'SUCCEEDED');assert.equal(x.round.view(r.id).counts.NEW_SUCCESS,1);assert.equal(x.flow.submits,0);assert.equal(x.flow.launches.length,0);
});

test('failed manifest validation prevents success recovery side effects',async t=>{
 const x=await fixture(t,1),r=await x.create();x.round.start(r.id);await x.round.pending;const item=x.round.items(r.id)[0];
 x.store.db.prepare("UPDATE round_items SET state='PENDING',result=NULL,task_hash='wrong' WHERE round_id=?").run(r.id);const before=x.store.db.prepare('SELECT state,result FROM round_items WHERE round_id=?').get(r.id),queue=x.batch.store.item(item.queue_id);
 const recovered=x.make();assert.equal(recovered.view(r.id).state,'SYSTEM_BLOCKED');assert.deepEqual(x.store.db.prepare('SELECT state,result FROM round_items WHERE round_id=?').get(r.id),before);assert.deepEqual(x.batch.store.item(item.queue_id),queue);assert.throws(()=>recovered.start(r.id),/变化/);
});

for(const action of ['pause','stop'])test(action+' during initial asynchronous execution check preserves operator state',async t=>{
 const x=await fixture(t,2),r=await x.create();let ready;x.setExecutionCheck(()=>new Promise(resolve=>ready=resolve));x.round.start(r.id);x.round[action]();ready();await x.round.pending;
 assert.equal(x.round.view(r.id).state,action==='pause'?'PAUSED':'STOPPED');assert.equal(x.flow.submits,0);assert.equal(x.flow.launches.length,0);assert.equal(x.round.view(r.id).counts.PENDING,2);assert.equal(x.batch.active,null);assert.equal(x.flow.queueLease,null);assert.equal(x.round.events(r.id).some(e=>e.kind==='COORDINATOR_ERROR'),false);
});

test('same platform ID cannot be accepted for two distinct destinations',async t=>{
 const x=await fixture(t,2);x.store.history(x.tasks[0],result(1));x.setInspect(async()=>result(1));const r=await x.create();x.round.start(r.id);await x.round.pending;const v=x.round.view(r.id);
 assert.equal(v.state,'RESULT_UNKNOWN');assert.equal(v.counts.EXISTING_VERIFIED,1);assert.equal(v.counts.RESULT_UNKNOWN,1);assert.equal(x.store.completed(x.tasks[1]),null);assert.equal(x.flow.submits,0);assert.match(v.items[1].reason,/其他目的地/);
});

test('ID retained by another original run blocks new success before history mutation',async t=>{
 const x=await fixture(t,2),other=x.store.create(x.importId,x.tasks[1],'LIVE','SOURCE',{reviewed:true,taskHash:digest(x.tasks[1])});x.store.move(other.id,'RUNNING');x.store.move(other.id,'SUBMITTING');x.store.checkpoint(other.id,{itemId:result(1).itemId});x.store.move(other.id,'RESULT_UNKNOWN');
 x.setInspect(async()=>result(1));const r=await x.create();x.round.start(r.id);await x.round.pending;assert.equal(x.round.view(r.id).state,'RESULT_UNKNOWN');assert.equal(x.store.completed(x.tasks[0]),null);assert.equal(x.store.run(other.id).state,'RESULT_UNKNOWN');assert.equal(x.flow.submits,0);
});

test('old unknown submission rechecked now does not count as a new click in this round',async t=>{
 const x=await fixture(t,1),old=x.store.create(x.importId,x.tasks[0],'LIVE','SOURCE',{reviewed:true,taskHash:digest(x.tasks[0])});x.store.move(old.id,'RUNNING');x.store.move(old.id,'SUBMITTING');x.store.event(old.id,'SUBMIT_CLICKED',{});x.store.checkpoint(old.id,{itemId:result(1).itemId});x.store.move(old.id,'RESULT_UNKNOWN');x.store.db.prepare('UPDATE events SET at=? WHERE run=?').run('2026-01-01T00:00:00.000Z',old.id);
 x.setInspect(async()=>result(1));const r=await x.create();x.round.start(r.id);await x.round.pending;const row=x.round.view(r.id).items[0];assert.equal(row.state,'EXISTING_VERIFIED');assert.equal(row.enteredPublish,false);assert.equal(row.submitted,false);assert.equal(row.submissionUncertain,false);assert.equal(x.flow.submits,0);assert.match(x.round.csv(r.id),/本轮点击提交/);
});
