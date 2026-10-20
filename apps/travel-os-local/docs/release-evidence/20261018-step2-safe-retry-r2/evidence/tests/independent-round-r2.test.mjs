// Independent Step 2 r2 verification; r1 test 12 budget-blocking expectation is corrected: actual coordinator/stores, synthetic executor,
// in-memory database, no browser and no production HTTP or filesystem mutation.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
const runtime = process.env.QA_USE_R1 === '1' ? '../../step2-safe-retry-20261018/dev/workbench/' : '../dev/workbench/';
const {SourceStore,digest} = await import(new URL(runtime+'source-store.mjs',import.meta.url));
const {BatchWorkflow} = await import(new URL(runtime+'batch-workflow.mjs',import.meta.url));
const {ListingRound,classifyRoundFailure} = await import(new URL(runtime+'listing-round.mjs',import.meta.url));

const DETAIL_CODE='SAFE_RETRY_DETAIL_MATERIAL';
const shop={id:'qa-step2-only',name:'隔离测试店铺'};
const task=n=>({schemaVersion:2,taskId:'qa-task-'+n,shopId:shop.id,priority:n,source:{},listing:{type:'city',country:'测试国家',city:'测试城市'+n,title:'测试标题'+n},assets:{main:[],secondary:[],details:[]},business:{shop_name:shop.name,price_cny:20,inventory:9},adapterIssues:[]});
const result=n=>({itemId:String(800000+n),status:'出售中',rowText:'synthetic fixture',screenshot:'synthetic.png',verifiedAt:new Date().toISOString()});
async function fixture(t,n=5){
  const store=new SourceStore(':memory:'),tasks=Array.from({length:n},(_,i)=>task(i+1));
  t.after(()=>store.close());
  const dir=join(import.meta.dirname,'mock-runs',randomUUID());
  const importId=store.imported({sourceHash:'qa-synthetic-only',tasks,summary:{total:n}});
  let behavior=()=>({state:'VERIFIED'});
  const flow={store,artifacts:dir,runtime:dir,active:null,launches:[],submits:0,preflight:async()=>{},
    launch(id){assert.equal(this.active,null);this.active=id;this.launches.push(id);this.pending=(async()=>{
      const run=store.run(id);store.move(id,'RUNNING');const outcome=behavior(run);
      if(outcome.state==='VERIFIED'){
        store.move(id,'SUBMITTING');this.submits++;store.event(id,'SUBMIT_CLICKED',{});store.move(id,'VERIFIED','',result(run.task.priority));
      }else{
        store.checkpoint(id,{step:outcome.step||'select-detail-1',errorCode:outcome.code,...outcome.checkpoint});
        for(const event of outcome.events||[])store.event(id,event.kind,event.payload||{});
        store.move(id,outcome.state||'PAUSED',outcome.reason||'详情素材等待超时');
        if(outcome.result)store.db.prepare('UPDATE runs SET result=? WHERE id=?').run(JSON.stringify(outcome.result),id);
      }
    })().finally(()=>this.active=null);},
    async resume({id}){store.move(id,'QUEUED');this.launch(id);},pause(){}
  };
  const batch=new BatchWorkflow(flow);
  const round=new ListingRound({batch,source:flow,shop,artifacts:join(dir,'rounds'),contentReviews:{assertApproved:()=>({decision:'PASS'})},checkFiles:async()=>{},assertExecution:async()=>{},verifyExisting:async({history})=>history||null});
  const authorization={source:'independent-step2-qa',objectiveSha256:'b'.repeat(64),allowLive:true,maxSafeRecoveries:2,confirmedShop:shop.name,expectedCount:n};
  const created=await round.create({importId,authorization,repairVersion:'qa-step2-candidate',expectedCount:n});
  const finish=async()=>{round.start(created.id);await round.pending;if(round.view(created.id).state==='PAUSED'&&round.view(created.id).gate===1){round.resume(created.id);await round.pending;}return round.view(created.id);};
  return {store,round,batch,flow,id:created.id,setBehavior:f=>{behavior=f;},finish};
}

test('second item exhausts only original two safe recoveries; other four complete without resetting claim counts',async t=>{
  const f=await fixture(t);f.setBehavior(r=>r.task.priority===2?{code:DETAIL_CODE}:{state:'VERIFIED'});
  const v=await f.finish();assert.equal(v.state,'COMPLETED');assert.equal(v.counts.NEW_SUCCESS,4);assert.equal(v.counts.FAILED,1);assert.equal(f.flow.submits,4);
  const second=f.round.items(f.id)[1],queue=f.batch.store.item(second.queue_id);
  assert.equal(queue.attempts,3);assert.equal(queue.max_attempts,3);assert.equal(second.extra_attempts,0);assert.equal(second.retry_counts['select-detail-1'],2);
  assert.equal(f.flow.launches.filter(id=>id===second.run_id).length,3);assert.equal(f.store.list().length,5);
});

test('two separate items with same detail error each retain their own bounded recovery counters',async t=>{
  const f=await fixture(t);f.setBehavior(r=>r.task.priority<=2?{code:DETAIL_CODE}:{state:'VERIFIED'});
  const v=await f.finish();assert.equal(v.state,'COMPLETED');assert.equal(v.counts.NEW_SUCCESS,3);assert.equal(v.counts.FAILED,2);
  for(const item of f.round.items(f.id).slice(0,2)){assert.equal(item.retry_counts['select-detail-1'],2);assert.equal(f.batch.store.item(item.queue_id).attempts,3);}
  assert.equal(f.flow.submits,3);
});

test('new detail code on unrelated original step does not obtain detail recovery permission',async t=>{
  const f=await fixture(t);f.setBehavior(()=>({code:DETAIL_CODE,step:'main-image-1'}));const v=await f.finish();
  assert.equal(v.state,'SYSTEM_BLOCKED');assert.equal(f.flow.launches.length,1);assert.equal(f.flow.submits,0);assert.equal(v.counts.FAILED,0);
});

test('unknown detail-looking code and untyped exception stay SYSTEM blockers',async t=>{
  for(const code of ['SAFE_RETRY_DETAIL_UNREVIEWED',undefined]){
    const f=await fixture(t);f.setBehavior(()=>({code,reason:'synthetic unknown assertion'}));const v=await f.finish();
    assert.equal(v.state,'SYSTEM_BLOCKED');assert.equal(f.flow.launches.length,1);assert.equal(v.counts.FAILED,0);
  }
});

test('legacy SAFE_RETRY_UPLOAD retains previous two recoveries and SYSTEM pause',async t=>{
  const f=await fixture(t);f.setBehavior(()=>({code:'SAFE_RETRY_UPLOAD',step:'main-image-1'}));const v=await f.finish();
  assert.equal(v.state,'SYSTEM_BLOCKED');assert.equal(f.flow.launches.length,3);assert.equal(v.counts.FAILED,0);assert.equal(f.flow.submits,0);
});

test('submission evidence cannot be reclassified as a disposable detail failure',async t=>{
  for(const event of ['SUBMITTING','SUBMIT_CLICKED','SUBMIT_EVIDENCE','RESULT_UNKNOWN','VERIFIED']){
    const f=await fixture(t);f.setBehavior(()=>({code:DETAIL_CODE,events:[{kind:event}]}));const v=await f.finish();
    assert.notEqual(v.state,'COMPLETED',event);assert.equal(f.flow.launches.length,1,event);assert.equal(v.counts.FAILED,0,event);assert.equal(f.flow.submits,0,event);
  }
});

test('item ID checkpoint or prior result blocks detail continuation even without a submit event',async t=>{
  for(const extra of [{checkpoint:{itemId:'900001'}},{checkpoint:{reconciliation:{itemId:'900002'}}},{result:{itemId:'900003'}}]){
    const f=await fixture(t);f.setBehavior(()=>({code:DETAIL_CODE,...extra}));const v=await f.finish();
    assert.notEqual(v.state,'COMPLETED');assert.equal(f.flow.launches.length,1);assert.equal(v.counts.FAILED,0);assert.equal(f.flow.submits,0);
  }
});

test('CAPTCHA and protected-page persistence fault never become ordinary detail retries',async t=>{
  for(const extra of [{state:'PAUSED_CAPTCHA',reason:'PAUSED_CAPTCHA'},{events:[{kind:'PAGE_LEDGER_PERSISTENCE_FAILED',payload:{nextTaskBlocked:true}}]}]){
    const f=await fixture(t);f.setBehavior(()=>({code:DETAIL_CODE,...extra}));const v=await f.finish();
    assert.notEqual(v.state,'COMPLETED');assert.equal(f.flow.launches.length,1);assert.equal(v.counts.FAILED,0);
  }
});

test('public classifier retains protected run-state precedence',()=>{
  const error=Object.assign(Error('detail timeout'),{code:DETAIL_CODE});
  assert.equal(classifyRoundFailure(error,{run:{state:'RESULT_UNKNOWN'}}).kind,'UNKNOWN');
  assert.equal(classifyRoundFailure(error,{run:{state:'SUBMITTING'}}).kind,'UNKNOWN');
  assert.equal(classifyRoundFailure(error,{run:{state:'PAUSED_CAPTCHA'}}).kind,'HUMAN');
});

test('persisted submission flags survive protection even when backing run events are missing',async t=>{
  for(const flag of ['submitted','submission_uncertain']){
    const f=await fixture(t,1);f.setBehavior(()=>({reason:'untyped initial failure'}));await f.finish();
    const item=f.round.items(f.id)[0];f.round.update(f.id,item.key,{[flag]:1});
    const error=Object.assign(Error('详情素材等待超时'),{code:DETAIL_CODE});
    const continued=await f.round.failure(f.id,f.round.item(f.id,item.key),error);
    assert.equal(continued,false);assert.equal(f.round.item(f.id,item.key)[flag],1,flag+' evidence must not be erased');
    assert.equal(f.flow.launches.length,1);assert.equal(f.round.item(f.id,item.key).retry_counts['select-detail-1'],undefined);
  }
});

test('operator recovery denial preserves original SYSTEM pause without scheduling detail retry',async t=>{
  const f=await fixture(t,1);f.setBehavior(()=>({reason:'untyped initial failure'}));await f.finish();
  const item=f.round.items(f.id)[0],attempts=f.batch.store.item(item.queue_id).attempts;
  const continued=await f.round.failure(f.id,item,Object.assign(Error('detail timeout'),{code:DETAIL_CODE}),{allowRecovery:false});
  assert.equal(continued,false);assert.equal(f.round.view(f.id).state,'SYSTEM_BLOCKED');assert.equal(f.batch.store.item(item.queue_id).attempts,attempts);
  assert.equal(f.round.item(f.id,item.key).retry_counts['select-detail-1'],undefined);assert.equal(f.flow.launches.length,1);
});


const budgetSnapshot=(f,item)=>{
  const q=f.batch.store.item(item.queue_id),x=f.round.item(f.id,item.key);
  return {attempts:q.attempts,max_attempts:q.max_attempts,baseline_attempts:x.baseline_attempts,extra_attempts:x.extra_attempts,retry_counts:x.retry_counts};
};
async function pausedBudget(t,{retry=0,attempts=3,max=3,baseline=0,extra=0}={}){
  const f=await fixture(t,5);f.setBehavior(()=>({reason:'untyped initial failure'}));await f.finish();
  const item=f.round.items(f.id)[0];
  f.store.db.prepare('UPDATE batch_items SET attempts=?,max_attempts=? WHERE id=?').run(attempts,max,item.queue_id);
  f.store.db.prepare('UPDATE round_items SET baseline_attempts=?,extra_attempts=? WHERE round_id=? AND key=?').run(baseline,extra,f.id,item.key);
  f.round.update(f.id,item.key,{retry_counts:{'select-detail-1':retry}});
  return {...f,item:f.round.item(f.id,item.key)};
}
for(const retry of [0,1])test(`historical 3/3 with retry_counts=${retry}: failure ends current item without mutating any budget field`,async t=>{
  const f=await pausedBudget(t,{retry}),before=budgetSnapshot(f,f.item);
  const continued=await f.round.failure(f.id,f.item,Object.assign(Error('详情素材等待超时'),{code:DETAIL_CODE}));
  assert.equal(continued,true);assert.equal(f.round.item(f.id,f.item.key).state,'FAILED');
  assert.equal(f.batch.store.item(f.item.queue_id).state,'FAILED');assert.deepEqual(budgetSnapshot(f,f.item),before);
  assert.equal(f.round.item(f.id,f.item.key).reason,'详情素材等待超时','original failure reason remains; the separate event must explain budget exhaustion');
  assert(f.round.events(f.id).some(e=>JSON.stringify(e.payload).includes('ITEM_RETRY_BUDGET_EXTRA_UNSAFE')),'explicit rejection cause must survive in an event');
  assert(!f.round.events(f.id).some(e=>e.kind==='SAFE_STEP_RECOVERY'),'must not schedule a retry');
  f.setBehavior(()=>({state:'VERIFIED'}));f.round.resume(f.id);await f.round.pending;
  if(f.round.view(f.id).state==='PAUSED'&&f.round.view(f.id).gate===1){f.round.resume(f.id);await f.round.pending;}
  assert.equal(f.round.view(f.id).state,'COMPLETED');assert.equal(f.round.view(f.id).counts.NEW_SUCCESS,4);
  assert.equal(f.flow.launches.filter(id=>id===f.item.run_id).length,1);assert.deepEqual(budgetSnapshot(f,f.item),before);
});
for(const config of [{attempts:4,max:4,baseline:0,extra:0},{attempts:5,max:3,baseline:3,extra:2}])test(`already extended exhausted budget ${JSON.stringify(config)} stays exhausted but no longer blocks next items`,async t=>{
  const f=await pausedBudget(t,config),before=budgetSnapshot(f,f.item);
  assert.equal(await f.round.failure(f.id,f.item,Object.assign(Error('详情素材等待超时'),{code:DETAIL_CODE})),true);
  assert.equal(f.round.item(f.id,f.item.key).state,'FAILED');assert.deepEqual(budgetSnapshot(f,f.item),before);
  assert.equal(f.flow.launches.length,1);assert.equal(f.flow.submits,0);
});
test('all three exact budget rejection codes finish safe detail failure with explicit cause',async t=>{
  for(const code of ['ITEM_RETRY_BUDGET_EXHAUSTED','ITEM_RETRY_BUDGET_EXTRA_UNSAFE','ITEM_RETRY_BUDGET_SYSTEM_UNCONFIRMED']){
    const f=await pausedBudget(t),before=budgetSnapshot(f,f.item);let checks=0;
    f.batch.store.assertClaimBudget=()=>{checks++;throw Object.assign(Error('预算拒绝 '+code),{code});};
    assert.equal(await f.round.failure(f.id,f.item,Object.assign(Error('详情素材等待超时'),{code:DETAIL_CODE})),true,code);
    assert.equal(checks,1);assert.equal(f.round.item(f.id,f.item.key).state,'FAILED');assert.deepEqual(budgetSnapshot(f,f.item),before);
    assert(f.round.events(f.id).some(e=>JSON.stringify(e.payload).includes(code)),code);
    assert(!f.round.events(f.id).some(e=>e.kind==='SAFE_STEP_RECOVERY'),code);
  }
});
test('actual SYSTEM_UNCONFIRMED rejection is recorded as a completed failure without allocation',async t=>{
  const f=await pausedBudget(t,{baseline:3}),before=budgetSnapshot(f,f.item);
  assert.throws(()=>f.batch.store.assertClaimBudget(f.batch.store.item(f.item.queue_id),{round:f.round.round(f.id),entry:f.item}),e=>e.code==='ITEM_RETRY_BUDGET_SYSTEM_UNCONFIRMED');
  assert.equal(await f.round.failure(f.id,f.item,Object.assign(Error('详情素材等待超时'),{code:DETAIL_CODE})),true);
  assert.equal(f.round.item(f.id,f.item.key).state,'FAILED');assert.deepEqual(budgetSnapshot(f,f.item),before);
  assert(f.round.events(f.id).some(e=>JSON.stringify(e.payload).includes('ITEM_RETRY_BUDGET_SYSTEM_UNCONFIRMED')));
});
for(const retry of [0,1])test(`website window ledger: attempt 3/3 retry ${retry} becomes FAILED, subsequent windows finish, and no retry is rescheduled`,async t=>{
  const f=await fixture(t,5);f.store.db.prepare('UPDATE rounds SET gate=5 WHERE id=?').run(f.id);
  const w=f.round.windows.create(await f.round.windows.preview(f.id,{limit:2,autoContinue:true}));
  f.setBehavior(()=>({reason:'untyped initial failure'}));f.round.start(f.id,{windowId:w.id});await f.round.pending;
  assert.equal(f.round.view(f.id).state,'SYSTEM_BLOCKED');const item=f.round.items(f.id)[0];
  f.store.db.prepare('UPDATE batch_items SET attempts=2,max_attempts=3 WHERE id=?').run(item.queue_id);
  f.round.update(f.id,item.key,{retry_counts:{'select-detail-1':retry}});
  let afterClaim;
  f.setBehavior(run=>{
    if(run.id===item.run_id){afterClaim=budgetSnapshot(f,item);return {code:DETAIL_CODE};}
    return {state:'VERIFIED'};
  });
  f.round.resume(f.id,{windowId:w.id});await f.round.pending;
  const v=f.round.view(f.id),first=f.round.items(f.id)[0];
  assert.equal(v.state,'COMPLETED');assert.equal(v.counts.FAILED,1);assert.equal(v.counts.NEW_SUCCESS,4);assert.equal(f.flow.submits,4);
  assert.equal(afterClaim.attempts,3);assert.deepEqual(budgetSnapshot(f,item),afterClaim,'failure must not modify claim counters');
  assert.equal(first.state,'FAILED');assert.equal(f.flow.launches.filter(id=>id===item.run_id).length,2,'one setup launch plus one final claim only');
  const history=f.round.windows.history(f.id);assert.equal(history.length,3);assert(history.every(x=>x.state==='COMPLETED'));
  const entry=f.round.windows.entries(w.id).find(e=>e.key===item.key);assert.equal(entry.outcome.state,'FAILED');assert.equal(entry.outcome.attempts,3);
  assert.equal(f.round.windows.view(w.id).counts.FAILED,1);assert.equal(f.round.windows.get(w.id).continuation_pending,0);
  assert.equal(f.round.events(f.id).filter(e=>e.key===item.key&&e.kind==='SAFE_STEP_RECOVERY').length,0);
  assert.throws(()=>f.round.resume(f.id),/结束|完成/);assert.equal(f.flow.launches.filter(id=>id===item.run_id).length,2);
  console.log('BUDGET_WINDOW_OBSERVATION '+JSON.stringify({retry,state:v.state,counts:v.counts,afterClaim,windowStates:history.map(x=>x.state),outcome:entry.outcome.state,scheduledRecovery:0}));
});
test('unknown budget-looking and database errors remain blockers rather than being swallowed',async t=>{
  for(const code of ['ITEM_RETRY_BUDGET_UNREVIEWED','SQLITE_BUSY',undefined]){
    const f=await fixture(t,5);f.store.db.prepare('UPDATE rounds SET gate=5 WHERE id=?').run(f.id);
    const w=f.round.windows.create(await f.round.windows.preview(f.id,{limit:5}));
    const original=f.batch.store.assertClaimBudget.bind(f.batch.store);
    f.batch.store.assertClaimBudget=(q,p)=>{if(q.state==='FAILED')throw Object.assign(Error('synthetic budget backend failure'),{code});return original(q,p);};
    f.setBehavior(()=>({code:DETAIL_CODE}));f.round.start(f.id,{windowId:w.id});await f.round.pending;
    assert.equal(f.round.view(f.id).state,'SYSTEM_BLOCKED');assert.equal(f.flow.launches.length,1);assert.equal(f.flow.submits,0);assert.equal(f.round.view(f.id).counts.FAILED,0);
    assert.equal(f.round.windows.get(w.id).state,'SYSTEM_BLOCKED');assert(f.round.events(f.id).some(e=>e.kind==='COORDINATOR_ERROR'));
  }
});
test('budget rejection handling is never reached for protected submissions, human states, or ledger faults',async t=>{
  for(const outcome of [
    {state:'PAUSED_CAPTCHA'},
    {state:'RESULT_UNKNOWN'},
    {state:'SUBMITTING'},
    {checkpoint:{itemId:'900001'}},
    {events:[{kind:'SUBMIT_CLICKED'}]},
    {events:[{kind:'PAGE_LEDGER_PERSISTENCE_FAILED'}]},
    {reason:'登录失效'},
    {reason:'店铺身份不符'}
  ]){
    const f=await fixture(t,5);let budgetFailureCalls=0;
    const original=f.batch.store.assertClaimBudget.bind(f.batch.store);
    f.batch.store.assertClaimBudget=(q,p)=>{if(q.state==='FAILED'){budgetFailureCalls++;throw Object.assign(Error('budget rejected'),{code:'ITEM_RETRY_BUDGET_EXTRA_UNSAFE'});}return original(q,p);};
    f.setBehavior(()=>({code:DETAIL_CODE,...outcome}));const v=await f.finish();
    assert.equal(budgetFailureCalls,0,JSON.stringify(outcome));assert.notEqual(v.state,'COMPLETED');assert.equal(f.flow.launches.length,1);assert.equal(v.counts.FAILED,0);
  }
});
