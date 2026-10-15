import test from 'node:test';
import assert from 'node:assert/strict';
import {SourceStore,destinationKey,digest} from '../source-store.mjs';
import {BatchStore} from '../batch-store.mjs';
import {buildOperationsCatalog,OPERATIONS_STATUSES} from '../operations-catalog.mjs';

// In-memory fixtures only: no production DB, source assets, browser or network.
const shopId='catalog-fixture-shop';
const task=(n,patch={})=>({shopId,taskId:'t'+n,priority:n,listing:{type:'city',country:'测试国家',city:'城市'+n,title:'原始标题'+n},source:{sheet:'商品池',row:n+1},adapterIssues:[],assets:{main:[{path:'DO-NOT-READ.png'}]},...patch});
const evidence=n=>({itemId:String(900000+n),url:'https://item.taobao.com/item.htm?id='+(900000+n),status:'出售中',rowText:'官方商品行',screenshot:'DO-NOT-READ-evidence.png',verifiedAt:'2026-10-11T10:00:00.000Z'});
function fixture(t,n=1){
 const store=new SourceStore(':memory:'),queueStore=new BatchStore(store),db=store.db;
 t.after(()=>store.close());
 db.exec(`CREATE TABLE rounds(id TEXT PRIMARY KEY,shop TEXT,import_id TEXT,manifest_hash TEXT,state TEXT,current_item TEXT,at TEXT,updated TEXT);
 CREATE TABLE round_items(round_id TEXT,key TEXT,position INTEGER,task TEXT,task_hash TEXT,queue_id TEXT,batch_id TEXT,run_id TEXT,state TEXT,reason TEXT DEFAULT '',failure_stage TEXT DEFAULT '',submitted INTEGER DEFAULT 0,submission_uncertain INTEGER DEFAULT 0,entered_publish INTEGER DEFAULT 0,extra_attempts INTEGER DEFAULT 0,result TEXT,updated TEXT);
 CREATE TABLE round_windows(id TEXT PRIMARY KEY,round_id TEXT,sequence INTEGER,shop TEXT,state TEXT,at TEXT,finished TEXT);
 CREATE TABLE round_window_items(window_id TEXT,key TEXT);`);
 const tasks=Array.from({length:n},(_,i)=>task(i+1));
 const imported=(id,rows=tasks)=>{db.prepare('INSERT INTO imports VALUES(?,?,?)').run(id,'2026-10-11T09:00:00Z',JSON.stringify({workbook:id+'.xlsx',tasks:rows}));return id;};
 imported('pool');
 const owner={active:null,currentOperation:null};
 const addRound=(id='r1',importId='pool',rows=tasks)=>{
  db.prepare('INSERT INTO rounds VALUES(?,?,?,?,?,?,?,?)').run(id,shopId,importId,'hash-'+id,'PAUSED',null,'2026-10-11T09:01:00Z','2026-10-11T09:02:00Z');
  rows.forEach((x,i)=>db.prepare('INSERT INTO round_items(round_id,key,position,task,task_hash,state,updated) VALUES(?,?,?,?,?,?,?)').run(id,destinationKey(x),i+1,JSON.stringify(x),digest(x),'PENDING','2026-10-11T09:03:00Z'));
  return id;
 };
 const item=(n,patch,roundId='r1')=>{for(const [key,value] of Object.entries(patch))db.prepare('UPDATE round_items SET '+key+'=? WHERE round_id=? AND key=?').run(typeof value==='object'&&value!==null?JSON.stringify(value):value,roundId,destinationKey(tasks[n-1]));};
 const run=(n,state='PAUSED',extra={})=>{
  const x=tasks[n-1],id='run'+n;
  db.prepare('INSERT INTO runs(id,key,batch,task,mode,target,state,checkpoint,result,reason,at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(id,destinationKey(x),'pool',JSON.stringify(x),'LIVE','SOURCE',state,JSON.stringify(extra.checkpoint||{}),extra.result?JSON.stringify(extra.result):null,extra.reason||'','2026-10-11T09:05:00Z');
  return id;
 };
 const queue=(n,state='PENDING',extra={})=>{
  const x=tasks[n-1],id='q'+n;
  db.prepare('INSERT INTO batch_items(id,batch,key,position,task,state,run_id,attempts,max_attempts,reason,result) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(id,'batch',destinationKey(x),n,JSON.stringify(x),state,extra.runId||null,extra.attempts??0,extra.maxAttempts??3,extra.reason||'',extra.result?JSON.stringify(extra.result):null);
  return id;
 };
 const window=(id,roundId='r1',rows=tasks)=>{db.prepare('INSERT INTO round_windows VALUES(?,?,?,?,?,?,?)').run(id,roundId,1,shopId,'STOPPED','2026-10-11T09:00:00Z','2026-10-11T10:00:00Z');for(const x of rows)db.prepare('INSERT INTO round_window_items VALUES(?,?)').run(id,destinationKey(x));};
 const get=options=>buildOperationsCatalog(store,{shopId,round:owner,...options});
 const one=options=>get(options).items[0];
 return {store,queueStore,db,tasks,owner,imported,addRound,item,run,queue,window,get,one};
}

test('all same-shop packages remain selectable, default prefers current round import',t=>{
 const x=fixture(t,2);x.addRound();x.imported('newer',[task(3)]);x.imported('other-shop',[task(4,{shopId:'another'})]);
 const view=x.get();assert.deepEqual(view.packages.map(p=>p.id),['newer','pool']);assert.equal(view.selectedPackage.id,'pool');assert.equal(view.selectedPackage.executionSupported,true);assert.equal(view.items.length,2);
 const newer=x.get({importId:'newer'});assert.equal(newer.items.length,1);assert.equal(newer.items[0].status,'AVAILABLE');assert.equal(newer.selectedPackage.executionSupported,false);assert.match(newer.selectedPackage.reason,/尚未建立/);
 assert.throws(()=>x.get({importId:'other-shop'}),{code:'OPERATIONS_PACKAGE_NOT_FOUND'});
 assert.throws(()=>x.get({importId:'nonexistent'}),{code:'OPERATIONS_PACKAGE_NOT_FOUND'});
});

test('stable destination keys deduplicate imports without collapsing same city across countries or types',t=>{
 const x=fixture(t);const a=task(1),b=structuredClone(a),c=structuredClone(a),d=structuredClone(a);
 b.listing.title='第二次相同身份';c.listing.country='另一个国家';d.listing.type='country';d.listing.city='';
 x.imported('duplicates',[a,b,c,d]);const view=x.get({importId:'duplicates'});
 assert.equal(view.items.length,3);assert.equal(view.selectedPackage.total,3);assert.equal(view.selectedPackage.sourceRows,4);assert.deepEqual(view.items[0].source.positions,[1,2]);assert.equal(view.items[0].status,'NEEDS_DATA');assert.equal(new Set(view.items.map(i=>i.key)).size,3);
});

test('round terminal states are not summed as success; preflight skip differs from manual skip',t=>{
 const x=fixture(t,6);x.addRound();
 x.item(1,{state:'NEW_SUCCESS',result:evidence(1)});x.item(2,{state:'EXISTING_VERIFIED',result:evidence(2)});x.item(3,{state:'FAILED',reason:'执行错误'});x.item(4,{state:'PREFLIGHT_SKIPPED',reason:'主图目的地错配'});x.item(5,{state:'MANUAL_SKIPPED',reason:'操作者明确跳过'});
 const view=x.get();assert.deepEqual(view.items.map(i=>i.status),['VERIFIED','VERIFIED','RETRYABLE','NEEDS_DATA','SKIPPED','WAITING']);assert.equal(view.counts.VERIFIED,2);assert.equal(view.needsData,1);assert.equal(Object.values(view.counts).reduce((a,b)=>a+b,0),6);assert.deepEqual(Object.keys(view.counts),OPERATIONS_STATUSES);
});

test('success requires item id, screenshot, platform row, status and verification timestamp',async t=>{
 for(const missing of ['itemId','screenshot','rowText','status','verifiedAt'])await t.test(missing,t=>{
  const x=fixture(t);x.addRound();const bad=evidence(1);delete bad[missing];x.item(1,{state:'NEW_SUCCESS',result:bad});assert.equal(x.one().status,'VERIFY');assert.equal(x.get().counts.VERIFIED,0);
 });
});

test('invalid and historical success flags do not substitute complete platform evidence',t=>{
 const x=fixture(t);x.store.history(x.tasks[0],{itemId:'900001',historical:true,status:'出售中'});
 assert.equal(x.one().status,'VERIFY');assert.equal(x.one().history[0].status,'VERIFY');
 x.db.prepare('UPDATE history SET payload=?').run('{broken');assert.equal(x.one().status,'VERIFY');
});

test('legacy complete success is preserved once without recounting its run, queue and history',t=>{
 const x=fixture(t);const result=evidence(1);x.run(1,'VERIFIED',{result});x.queue(1,'SUCCEEDED',{runId:'run1',result});x.store.history(x.tasks[0],result);
 const view=x.get();assert.equal(view.counts.VERIFIED,1);assert.equal(view.total,1);assert.equal(view.items[0].history.length,2);assert.equal(view.items[0].runId,'run1');assert.equal(view.items[0].result.evidenceComplete,true);
});

test('verified platform result with a content issue is not reported as an unknown publish result',t=>{
 const x=fixture(t);const result=evidence(1);x.run(1,'VERIFIED',{result});x.store.history(x.tasks[0],result);x.addRound('old');x.item(1,{state:'RESULT_UNKNOWN',failure_stage:'content-review',reason:'原主图内容待核验',result,run_id:'run1',submitted:1,entered_publish:1},'old');x.window('old-window','old');
 x.imported('newer');x.addRound('new','newer');x.item(1,{state:'NEW_SUCCESS',result},'new');
 const row=x.one({importId:'newer'});assert.equal(row.status,'PUBLISHED_CONTENT_REVIEW');assert.equal(row.statusLabel,'已上架·内容待整改');assert.equal(row.contentHold,true);assert.equal(row.submitted,true);assert.equal(row.retryEligible,false);assert.equal(row.roundId,'old');assert.equal(row.result.itemId,'900001');assert.deepEqual(row.detail,{roundId:'old',windowId:'old-window',key:destinationKey(x.tasks[0])});
});

test('unsubmitted duplicate candidate with exhausted old budget is not mislabeled as unknown submission',t=>{
 const x=fixture(t);const runId=x.run(1,'PAUSED',{reason:'旧执行断点'}),queueId=x.queue(1,'FAILED',{runId,attempts:3,maxAttempts:3});x.addRound();x.item(1,{state:'RESULT_UNKNOWN',failure_stage:'existing-listing-check',reason:'后台存在同目的地候选；未提交',run_id:runId,queue_id:queueId});
 const row=x.one();assert.equal(row.status,'UNSUBMITTED_BLOCKED');assert.equal(row.statusLabel,'未提交·处理受限');assert.equal(row.submitted,false);assert.equal(row.retryEligible,false);assert.match(row.reason,/未提交/);assert.match(row.reason,/记录次数已达常规上限/);assert.doesNotMatch(row.reason,/额度已耗尽|不再作为拦截/);
});

test('candidate with a partial result retains verification protection',async t=>{
 for(const source of ['run','queue'])await t.test(source,t=>{
  const x=fixture(t),runId=x.run(1,'PAUSED',source==='run'?{result:{itemId:'900001'}}:{});
  const queueId=x.queue(1,'FAILED',{runId,attempts:3,...(source==='queue'?{result:{itemId:'900001'}}:{})});
  x.addRound();x.item(1,{state:'RESULT_UNKNOWN',failure_stage:'existing-listing-check',run_id:runId,queue_id:queueId});
  const row=x.one();assert.equal(row.status,'VERIFY');assert.equal(row.retryEligible,false);assert.doesNotMatch(row.reason,/确认未提交/);
 });
});

test('historical completion keeps an unsubmitted-label claim in verification',t=>{
 const x=fixture(t),runId=x.run(1,'PAUSED',{reason:'旧执行断点'}),queueId=x.queue(1,'FAILED',{runId,attempts:3,maxAttempts:3});x.store.history(x.tasks[0],{itemId:'900001'});x.addRound();x.item(1,{state:'RESULT_UNKNOWN',failure_stage:'existing-listing-check',run_id:runId,queue_id:queueId});
 const row=x.one();assert.equal(row.status,'VERIFY');assert.equal(row.retryEligible,false);assert.doesNotMatch(row.reason,/确认未提交/);
});

test('candidate isolation overrides an unrelated stale run failure and its reason',t=>{
 const x=fixture(t);x.run(1,'PAUSED',{reason:'旧上传失败'});x.addRound();x.item(1,{state:'RESULT_UNKNOWN',failure_stage:'existing-listing-check',reason:'候选商品待核验',run_id:'run1'});
 const row=x.one();assert.equal(row.status,'UNSUBMITTED_BLOCKED');assert.match(row.reason,/本轮确认未提交/);assert.equal(row.stage,'existing-listing-check');assert.equal(row.retryEligible,false);assert.equal(row.history.find(h=>h.kind==='run').reason,'旧上传失败');
});

test('unknown submission and submission evidence protect against preflight, manual skip and retries',async t=>{
 for(const kind of ['run','event','uncertain','checkpoint'])await t.test(kind,t=>{
  const x=fixture(t);x.run(1,kind==='run'?'SUBMITTING':'PAUSED',{checkpoint:kind==='checkpoint'?{itemId:'900001'}:{}});x.addRound();x.item(1,{state:'PREFLIGHT_SKIPPED',run_id:'run1',submission_uncertain:kind==='uncertain'?1:0});
  if(kind==='event')x.store.event('run1','SUBMIT_CLICKED',{});
  assert.equal(x.one().status,'VERIFY');assert.equal(x.one().retryEligible,false);
  x.item(1,{state:'MANUAL_SKIPPED'});assert.equal(x.one().status,'VERIFY');
 });
});

test('pending round remains authoritative over historical success and must first reconcile',t=>{
 const x=fixture(t);x.run(1,'VERIFIED',{result:evidence(1)});x.store.history(x.tasks[0],evidence(1));x.addRound();x.item(1,{run_id:'run1'});
 const row=x.one();assert.equal(row.sourceStatus,'PENDING');assert.equal(row.status,'VERIFY');assert.equal(row.history.find(h=>h.kind==='platform-result').status,'VERIFIED');
});

test('PENDING with paused original run remains an exception even with exhausted budget',t=>{
 const x=fixture(t);x.run(1,'PAUSED',{reason:'ATTRIBUTE_STYLE_TIMEOUT',checkpoint:{step:'style'}});x.queue(1,'FAILED',{runId:'run1',attempts:3});x.addRound();x.item(1,{run_id:'run1',queue_id:'q1',reason:'ITEM_RETRY_BUDGET_EXHAUSTED',failure_stage:'existing-listing-check'});
 const row=x.one();assert.equal(row.status,'RETRYABLE');assert.equal(row.sourceStatus,'PENDING');assert.equal(row.attempts,3);assert.equal(row.maxAttempts,3);assert.equal(row.retryEligible,false);assert.match(row.retryReason,/达到原队列尝试上限/);assert.equal(row.stage,'existing-listing-check');
});

test('budget display is conservative and never extends the existing maximum',t=>{
 const x=fixture(t);x.run(1,'PAUSED',{reason:'页面超时'});x.queue(1,'FAILED',{runId:'run1',attempts:1,maxAttempts:3});x.addRound();x.item(1,{run_id:'run1',queue_id:'q1',extra_attempts:2});
 assert.equal(x.one().retryEligible,true);assert.equal(x.one().maxAttempts,3);x.db.prepare('UPDATE batch_items SET attempts=5').run();assert.equal(x.one().retryEligible,false);assert.equal(x.one().attempts,5);assert.equal(x.one().maxAttempts,3);
});

test('human verification and DRY_RUN remain separate from verified platform results',t=>{
 const x=fixture(t,3);x.run(1,'PAUSED_CAPTCHA',{reason:'验证码'});x.run(2,'DRY_RUN_COMPLETE');x.addRound();x.item(1,{run_id:'run1'});x.item(2,{run_id:'run2'});x.item(3,{state:'WAITING_HUMAN',failure_stage:'content-preflight'});
 assert.deepEqual(x.get().items.map(i=>i.status),['HUMAN','HUMAN','HUMAN']);
});

test('material issues occupy their own column without hiding actual verified results',t=>{
 const x=fixture(t);x.tasks[0].adapterIssues=['旧导入缺副图'];x.imported('issues');x.addRound('r1','issues');x.item(1,{state:'EXISTING_VERIFIED',result:evidence(1)});
 const row=x.one();assert.equal(row.status,'VERIFIED');assert.equal(row.dataStatus,'NEEDS_DATA');assert.deepEqual(row.issues,['旧导入缺副图']);assert.equal(x.get().needsData,1);
});

test('read result routes to original round/window/run and keeps frozen task title',t=>{
 const x=fixture(t);x.addRound('old');x.window('original-window','old');x.run(1,'PAUSED',{reason:'页面失败'});x.item(1,{run_id:'run1'},'old');
 const changed=task(1);changed.listing.title='新导入标题';x.imported('newer',[changed]);
 const row=x.one({importId:'newer'});assert.equal(row.importId,'newer');assert.equal(row.title,'原始标题1');assert.equal(row.roundId,'old');assert.equal(row.runId,'run1');assert.equal(row.detail.windowId,'original-window');assert.equal(x.get({importId:'newer'}).selectedPackage.executionSupported,false);
 assert.equal(row.frozenImportId,'pool');assert.equal(row.usesPriorSnapshot,true);
 const original=x.one({importId:'pool'});assert.equal(original.frozenImportId,'pool');assert.equal(original.usesPriorSnapshot,false);
});

test('current execution phase does not overwrite the preserved original failure checkpoint',t=>{
 const x=fixture(t);x.run(1,'PAUSED',{checkpoint:{step:'main-image-1'}});x.addRound();x.item(1,{run_id:'run1',failure_stage:'main-image-1'});x.owner.active='r1';x.owner.currentOperation={roundId:'r1',key:destinationKey(x.tasks[0]),stage:'existing-listing-query'};x.db.prepare('UPDATE rounds SET current_item=?').run(destinationKey(x.tasks[0]));
 assert.equal(x.one().status,'RUNNING');assert.equal(x.one().stage,'existing-listing-query');assert.equal(x.one().history.find(h=>h.kind==='run').stage,'main-image-1');
 x.owner.currentOperation.key='other';assert.equal(x.one().stage,'main-image-1');
});

test('mismatched or missing linked run cannot be projected as safely available',t=>{
 const x=fixture(t,2);x.run(2,'VERIFIED',{result:evidence(2)});x.addRound();x.item(1,{run_id:'run2'});
 assert.equal(x.one().status,'VERIFY');assert.match(x.one().reason,/身份映射不一致/);assert.equal(x.one().retryEligible,false);
 x.item(1,{run_id:'missing'});assert.equal(x.one().status,'VERIFY');
});

test('all nine statuses are bounded and nothing reads evidence files or mutates DB tables',t=>{
 const x=fixture(t,3);x.addRound();x.item(1,{state:'NEW_SUCCESS',result:evidence(1)});x.item(2,{state:'RESULT_UNKNOWN',reason:'authorization=secret cookie=secret'});
 const before=x.db.prepare('SELECT total_changes() n').get().n;
 const snapshot=()=>JSON.stringify(x.db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(({name})=>[name,x.db.prepare('SELECT * FROM '+name).all()]));
 const original=snapshot();x.db.exec('PRAGMA query_only=ON');const view=x.get();x.get({importId:'pool'});
 assert.equal(x.db.prepare('SELECT total_changes() n').get().n,before);assert.equal(snapshot(),original);assert(view.items.every(i=>OPERATIONS_STATUSES.includes(i.status)));assert(!JSON.stringify(view).includes('secret'));assert(!JSON.stringify(view).includes('DO-NOT-READ'));
});

test('result links strip credentials and arbitrary query data; unknown links are not exposed',t=>{
 const x=fixture(t);const good=evidence(1);good.url+='&access_token=secret';x.store.history(x.tasks[0],good);assert.equal(x.one().url,'https://item.taobao.com/item.htm?id=900001');
 for(const url of ['javascript:alert(1)','https://evil.example/item.htm?id=900001','https://item.taobao.com/item.htm?id=900002','https://user:password@item.taobao.com/item.htm?id=900001']){x.db.prepare('UPDATE history SET payload=?').run(JSON.stringify({...good,url}));assert.equal(x.one().url,null);}
});

test('empty and malformed imports fail closed without losing valid same-shop packages',t=>{
 const x=fixture(t);x.db.prepare('INSERT INTO imports VALUES(?,?,?)').run('bad','now','{broken');x.imported('missing-identity',[{shopId,adapterIssues:[]}]);
 const row=x.one({importId:'missing-identity'});assert.equal(row.status,'NEEDS_DATA');assert.match(row.key,/^invalid:/);assert.equal(row.detail,null);
 assert.equal(buildOperationsCatalog(x.store,{shopId:'no-data'}).total,0);assert.throws(()=>buildOperationsCatalog(x.store,{}),{code:'OPERATIONS_SHOP_REQUIRED'});
});

test('an owner belonging to a different shop cannot advertise package execution support',t=>{
 const x=fixture(t);x.addRound();x.owner.shop={id:'another-shop'};
 const view=x.get();assert.equal(view.selectedPackage.executionSupported,false);assert.equal(view.items.length,1);
});

test('malformed retry counters cannot be treated as an available budget',t=>{
 const x=fixture(t);x.run(1,'PAUSED',{reason:'页面失败'});x.queue(1,'FAILED',{runId:'run1',attempts:-1});
 assert.equal(x.one().status,'RETRYABLE');assert.equal(x.one().attempts,null);assert.equal(x.one().retryEligible,false);
});

test('paused login and captcha reasons stay human protected even with remaining budget',t=>{
 const x=fixture(t);x.run(1,'PAUSED',{reason:'请人工登录并核对店铺身份'});x.queue(1,'FAILED',{runId:'run1',attempts:1});x.addRound();x.item(1,{run_id:'run1',queue_id:'q1'});
 assert.equal(x.one().status,'HUMAN');assert.equal(x.one().retryEligible,false);
});

test('last handled time uses the stored round update and retains original run time in history',t=>{
 const x=fixture(t);x.run(1,'PAUSED',{reason:'页面失败'});x.addRound();x.item(1,{run_id:'run1',updated:'2026-10-11T09:20:00.000Z'});
 const before=x.db.prepare('SELECT total_changes() n').get().n,row=x.one();
 assert.equal(row.updated,'2026-10-11T09:20:00.000Z');assert.equal(row.history.find(h=>h.kind==='run').at,'2026-10-11T09:05:00Z');assert.equal(row.status,'RETRYABLE');
 assert.equal(x.db.prepare('SELECT total_changes() n').get().n,before);
});

test('missing or invalid round update falls back to the actual original run timestamp',t=>{
 const x=fixture(t);x.run(1,'PAUSED',{reason:'页面失败'});x.addRound();x.item(1,{run_id:'run1',updated:'invalid-date'});
 assert.equal(x.one().updated,'2026-10-11T09:05:00Z');
 x.item(1,{updated:null});assert.equal(x.one().updated,'2026-10-11T09:05:00Z');
 x.db.prepare('UPDATE runs SET at=?').run('invalid-date');assert.equal(x.one().updated,null);
});

test('import-only products do not invent processing time or claim a previous frozen snapshot',t=>{
 const x=fixture(t),row=x.one();assert.equal(row.updated,null);assert.equal(row.frozenImportId,null);assert.equal(row.usesPriorSnapshot,false);assert.equal(row.status,'AVAILABLE');
 x.run(1,'PAUSED',{reason:'页面失败'});const legacy=x.one();assert.equal(legacy.updated,'2026-10-11T09:05:00Z');assert.equal(legacy.frozenImportId,null);assert.equal(legacy.usesPriorSnapshot,false);
});
