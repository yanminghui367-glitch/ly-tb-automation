import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {randomUUID} from 'node:crypto';
import {SourceStore,digest} from '../source-store.mjs';
import {BatchWorkflow} from '../batch-workflow.mjs';
import {ListingRound} from '../listing-round.mjs';

test('batched read preserves exact task revisions and rereads appended or edited event evidence',async t=>{
 const f=await fixture(t,2),runs=[];
 for(const key of f.keys){const item=f.round.item(f.r.id,key),run=f.store.create(f.store.batch().id,item.task,'LIVE','SOURCE',{reviewed:true,taskHash:item.task_hash});f.store.move(run.id,'RUNNING');f.store.move(run.id,'PAUSED','FORM: stopped');f.round.update(f.r.id,key,{run_id:run.id});f.store.event(run.id,'READ_PASS_CHECK',{text:'original'});runs.push(run);}
 const s=f.round.selections,pass=s.readPass(f.r.id);
 for(const item of f.round.items(f.r.id))assert.deepEqual(s.snapshot(f.r.id,item,pass),s.snapshot(f.r.id,item));
 const before=s.revision(f.r.id);
 f.store.event(runs[1].id,'STEP',{text:'late observation'});
 const appended=s.revision(f.r.id);assert.notEqual(appended,before);
 const ev=f.store.events(runs[0].id).find(e=>e.kind==='READ_PASS_CHECK');
 f.store.db.prepare('UPDATE events SET payload=? WHERE seq=?').run(JSON.stringify({text:'changed without new row'}),ev.seq);
 assert.notEqual(s.revision(f.r.id),appended);
 f.store.event(runs[1].id,'SUBMIT_CLICKED',{});
 const item=f.round.item(f.r.id,f.keys[1]);assert.equal(s.snapshot(f.r.id,item,s.readPass(f.r.id)).hasSubmit,true);
});

test('fresh batch ownership changes still reject both batched and individual reads',async t=>{
 const f=await fixture(t,1);f.fail({position:1,reason:'TASK_DATA: single item issue',code:'TASK_DATA'});await f.run(await f.create([1]));
 const s=f.round.selections,item=f.round.item(f.r.id,f.keys[0]);s.revision(f.r.id);
 f.store.db.prepare('UPDATE batches SET shop=? WHERE id=?').run('another-shop',item.batch_id);
 assert.throws(()=>s.revision(f.r.id),{code:'SELECTION_MAPPING_CHANGED'});
 assert.throws(()=>s.snapshot(f.r.id,item),{code:'SELECTION_MAPPING_CHANGED'});
});

async function fixture(t,n=7){
 const dir=await mkdtemp(join(tmpdir(),'ly-selection-')),store=new SourceStore(join(dir,'source.sqlite'));
 t.after(async()=>{store.close();assert(resolve(dir).startsWith(resolve(tmpdir())+sep));await rm(dir,{recursive:true,force:true});});
 const shop={id:'selection-fixture',name:'隔离测试'},tasks=Array.from({length:n},(_,i)=>({shopId:shop.id,priority:i+1,source:{},listing:{type:'city',country:'测试',city:'城市'+(i+1),title:'标题'+(i+1)},assets:{main:[],secondary:[],details:[]},business:{shop_name:shop.name,price_cny:20,inventory:999999},adapterIssues:[]}));
 const importId=store.imported({sourceHash:'selection-fixture',tasks});let error=null,hold=false,release;
 const flow={store,artifacts:dir,active:null,launches:[],submits:0,stop:false,
  launch(id){assert(!this.active);this.active=id;this.stop=false;this.launches.push(store.run(id).task.priority);this.pending=(async()=>{
   store.move(id,'RUNNING');if(hold)await new Promise(r=>release=r);
   if(this.stop){store.move(id,'PAUSED','操作者暂停');return;}
   if(error&&store.run(id).task.priority===error.position){store.checkpoint(id,{step:error.step||'main-image-1',errorCode:error.code});store.move(id,error.state||'PAUSED',error.reason);return;}
   store.move(id,'SUBMITTING');this.submits++;store.event(id,'SUBMIT_CLICKED',{});store.move(id,'VERIFIED','',{itemId:String(888000+store.run(id).task.priority),status:'出售中',rowText:'隔离测试',screenshot:'fixture.png',verifiedAt:new Date().toISOString()});
  })().finally(()=>this.active=null);},async resume({id}){store.move(id,'QUEUED');this.launch(id);},pause(){this.stop=true;release?.();}
 };
 const batch=new BatchWorkflow(flow),make=()=>new ListingRound({source:flow,batch,shop,contentReviews:{assertApproved:()=>({decision:'PASS'})},checkFiles:async()=>{},assertExecution:async()=>{},verifyExisting:async({history})=>history||null,artifacts:join(dir,'rounds')});
 const round=make(),r=await round.create({importId,repairVersion:'fixture',expectedCount:n,authorization:{allowLive:true,maxSafeRecoveries:2,confirmedShop:shop.name,expectedCount:n}});
 store.db.prepare('UPDATE rounds SET gate=5 WHERE id=?').run(r.id);
 const keys=round.items(r.id).map(x=>x.key),preview=(positions,options={})=>round.selections.preview(r.id,{keys:positions.map(i=>keys[i-1]),...options});
 const request=p=>({roundId:r.id,keys:p.keys,mode:p.mode,limit:p.limit,autoContinue:p.autoContinue,selectionHash:p.selectionHash,expectedRevision:p.expectedRevision,requestId:randomUUID()});
 const create=async(positions,options={})=>round.selections.create(request(await preview(positions,options)));
 const run=async receipt=>{round.start(r.id,{windowId:receipt.window.id});await round.pending;};
 return {dir,store,flow,batch,round,r,keys,make,preview,request,create,run,fail:e=>error=e,hold:()=>hold=true,release:()=>{hold=false;release?.();}};
}

test('create freezes sparse selected keys without executing or allocating any queue; duplicate is read-only',async t=>{
 const f=await fixture(t),p=await f.preview([1,4,7]),req=f.request(p),before=f.round.items(f.r.id),receipt=await f.round.selections.create(req);
 assert.equal(receipt.window.total,3);assert.equal(f.flow.launches.length,0);assert.deepEqual(f.round.items(f.r.id),before);assert.deepEqual(receipt.selection.keys,[f.keys[0],f.keys[3],f.keys[6]]);
 const events=f.round.events(f.r.id);assert.equal((await f.round.selections.create(req)).replayed,true);assert.deepEqual(f.round.events(f.r.id),events);
 await assert.rejects(f.round.selections.create({...req,keys:[f.keys[1]]}),{code:'SELECTION_REQUEST_CONFLICT'});
});
test('sparse automatic continuation executes only selected keys through the existing serial coordinator',async t=>{
 const f=await fixture(t),before=f.round.items(f.r.id).filter(x=>[2,3,5,6].includes(x.position));
 const receipt=await f.create([1,4,7],{limit:1,autoContinue:true});await f.run(receipt);
 assert.deepEqual(f.flow.launches,[1,4,7]);assert.equal(f.flow.submits,3);assert.deepEqual(f.round.items(f.r.id).filter(x=>[2,3,5,6].includes(x.position)),before);
 assert.deepEqual(f.round.windows.history(f.r.id).map(w=>w.total),[1,1,1]);assert.equal(f.round.selections.view(f.r.id).remaining,0);assert.equal(f.round.round(f.r.id).state,'PAUSED');
});
test('101 selected products use two bounded windows without a per-product client retry loop',async t=>{
 const f=await fixture(t,103),selected=Array.from({length:101},(_,i)=>i+2),receipt=await f.create(selected,{autoContinue:true});await f.run(receipt);
 assert.equal(f.flow.submits,101);assert.equal(f.flow.launches.length,101);assert.deepEqual(f.round.windows.history(f.r.id).map(w=>w.total),[1,100]);assert.equal(f.round.items(f.r.id)[0].queue_id,null);assert.equal(f.round.items(f.r.id).at(-1).queue_id,null);
});
test('completed and foreign items are excluded; an open original window blocks create without stopping it',async t=>{
 const f=await fixture(t),original=f.round.windows.create(await f.round.windows.preview(f.r.id,{limit:1}));
 const p=await f.preview([2,4]);assert.equal(p.eligible.length,2);assert.equal(p.canCreate,false);assert(p.blockers.some(x=>x.code==='SELECTION_OLD_WINDOW_OPEN'));
 await assert.rejects(f.round.selections.create(f.request(p)),{code:'SELECTION_OLD_WINDOW_OPEN'});assert.equal(f.round.windows.get(original.id).state,'READY');assert.equal(f.flow.launches.length,0);
 f.round.stop();f.round.update(f.r.id,f.keys[0],{state:'NEW_SUCCESS',result:{itemId:'123456'}});
 const next=await f.round.selections.preview(f.r.id,{keys:[f.keys[0],f.keys[1],'foreign-key']});assert.equal(next.count,1);assert.equal(next.excluded.length,2);
});
test('preview distinguishes start and retry and unchanged fresh imports require a fixed round',async t=>{
 const f=await fixture(t);f.round.update(f.r.id,f.keys[0],{state:'PENDING',reason:'原查询错误'});
 const start=await f.preview([1,2]);assert.deepEqual(start.eligible.map(x=>x.position),[2]);
 const retry=await f.preview([1,2],{mode:'retry'});assert.deepEqual(retry.eligible.map(x=>x.position),[1]);assert.equal(retry.excluded[0].code,'SELECTION_NOT_ATTEMPTED');
 const noRound=await f.round.selections.preview(null,{keys:[f.keys[0]]});assert.equal(noRound.canCreate,false);assert.equal(noRound.blockers[0].code,'SELECTION_ROUND_REQUIRED');
});
test('late submit evidence in paused original run invalidates preview before any creation',async t=>{
 const f=await fixture(t),w=await f.create([1]);f.fail({position:1,reason:'页面错误',code:'FORM_ERROR'});await f.run(w);f.round.stop();
 const p=await f.preview([1],{mode:'retry'}),x=f.round.item(f.r.id,f.keys[0]);assert.equal(p.count,1);
 f.store.event(x.run_id,'SUBMITTING',{});
 await assert.rejects(f.round.selections.create(f.request(p)),{code:'SELECTION_STALE_REVISION'});
 const after=await f.preview([1],{mode:'retry'});assert.equal(after.count,0);assert(after.blockers.some(x=>x.code==='SELECTION_RESULT_UNRESOLVED'));assert.equal(f.flow.submits,0);
});
test('3/3 is excluded even with old repair permit or WAITING_HUMAN exemption; counts never increase',async t=>{
 const f=await fixture(t),w=await f.create([1]);f.fail({position:1,reason:'FORM: 页面错误',code:'FORM_ERROR'});await f.run(w);f.round.stop();const x=f.round.item(f.r.id,f.keys[0]);
 f.store.db.prepare('UPDATE batch_items SET attempts=3,state=? WHERE id=?').run('WAITING_HUMAN',x.queue_id);
 f.store.db.prepare('UPDATE round_items SET baseline_attempts=3 WHERE round_id=? AND key=?').run(f.r.id,x.key);
 const p=await f.preview([1],{mode:'retry'});assert.equal(p.count,0);assert.equal(p.excluded[0].code,'SELECTION_BUDGET_EXHAUSTED');assert.equal(f.batch.store.item(x.queue_id).attempts,3);assert.equal(f.round.item(f.r.id,x.key).extra_attempts,0);
});
test('failed selected tasks reuse original snapshot, queue, run, attempts and sealed historical window',async t=>{
 const f=await fixture(t),w=await f.create([1]);f.fail({position:1,reason:'TASK_DATA: 单项资料错误',code:'TASK_DATA'});await f.run(w);
 const before=f.round.item(f.r.id,f.keys[0]),sealed=f.round.windows.view(w.window.id,{items:true}),events=f.store.events(before.run_id),count=f.batch.store.item(before.queue_id).attempts;
 assert.equal(before.state,'FAILED');f.fail(null);const retry=await f.create([1],{mode:'retry'});assert.equal(retry.window.state,'READY');await f.run(retry);
 const after=f.round.item(f.r.id,f.keys[0]);for(const k of ['key','task_hash','run_id','queue_id','batch_id'])assert.equal(after[k],before[k]);
 assert.equal(f.batch.store.item(after.queue_id).attempts,count+1);assert.equal(after.extra_attempts,0);assert.deepEqual(f.round.windows.view(w.window.id,{items:true}),sealed);assert.deepEqual(f.store.events(after.run_id).slice(0,events.length),events);assert.equal(after.state,'NEW_SUCCESS');
});
test('known pre-submit product failure continues remaining selected tasks; shared and human faults pause',async t=>{
 for(const [code,reason,state,expected] of [['TASK_DATA','TASK_DATA: 单商品资料错误','PAUSED',2],['FORM_FAILURE','页面控件异常','PAUSED',1],['CAPTCHA','请处理验证码','PAUSED_CAPTCHA',1]]){
  const f=await fixture(t,3);f.fail({position:1,code,reason,state});const w=await f.create([1,3]);await f.run(w);assert.equal(f.flow.launches.length,expected);assert.equal(f.round.item(f.r.id,f.keys[1]).queue_id,null);
 }
});
test('restart and a replayed create never launch a task; explicit resume keeps exact original sparse scope',async t=>{
 const f=await fixture(t),p=await f.preview([1,5]),req=f.request(p),w=await f.round.selections.create(req);f.hold();f.round.start(f.r.id,{windowId:w.window.id});
 while(!f.flow.active)await new Promise(r=>setTimeout(r,1));f.round.pause();f.release();await f.round.pending;
 const launches=f.flow.launches.length,original=f.round.item(f.r.id,f.keys[0]).run_id,restarted=f.make();assert.equal(f.flow.launches.length,launches);assert.equal((await restarted.selections.create(req)).replayed,true);assert.equal(f.flow.launches.length,launches);
 restarted.resume(f.r.id,{windowId:w.window.id});await restarted.pending;assert.equal(restarted.item(f.r.id,f.keys[0]).run_id,original);assert.deepEqual(f.flow.launches,[1,1,5]);
});
test('async preflight races and overlapping create calls cannot freeze a stale or second assignment',async t=>{
 const f=await fixture(t),p=await f.preview([1,3]),req=f.request(p);let mutate=true;
 f.round.checkFiles=async()=>{if(mutate){mutate=false;f.round.update(f.r.id,f.keys[0],{reason:'changed during awaited check'});}};
 await assert.rejects(f.round.selections.create(req),{code:'SELECTION_STALE_REVISION'});assert.equal(f.round.windows.history(f.r.id).length,0);
 f.round.checkFiles=async()=>{};const fresh=await f.preview([2,4]),next=f.request(fresh),results=await Promise.all([f.round.selections.create(next),f.round.selections.create(next)]);
 assert.equal(results.filter(x=>x.replayed).length,1);assert.equal(f.round.windows.history(f.r.id).length,1);assert.equal(f.flow.launches.length,0);
});
test('assignment tampering and future selected status drift cannot expand or silently alter automatic continuation',async t=>{
 const f=await fixture(t),w=await f.create([1,7],{limit:1,autoContinue:true});
 f.round.update(f.r.id,f.keys[6],{reason:'original state changed after confirmation'});await f.run(w);
 assert.deepEqual(f.flow.launches,[1]);assert.equal(f.round.round(f.r.id).state,'SYSTEM_BLOCKED');assert.equal(f.round.item(f.r.id,f.keys[1]).queue_id,null);
 f.store.db.prepare('UPDATE round_selection_items SET key=? WHERE selection_id=? AND ordinal=2').run(f.keys[1],w.selection.id);
 assert.throws(()=>f.round.windows.assert(w.window.id,f.r.id),{code:'SELECTION_INTEGRITY_CHANGED'});
});
test('budget is checked again before the original claim, including changes after creation',async t=>{
 const f=await fixture(t),first=await f.create([1]);f.fail({position:1,reason:'FORM: 页面错误',code:'FORM_ERROR'});await f.run(first);f.round.stop();
 const x=f.round.item(f.r.id,f.keys[0]),receipt=await f.create([1],{mode:'retry'});f.fail(null);
 f.store.db.prepare('UPDATE batch_items SET attempts=3 WHERE id=?').run(x.queue_id);
 await f.run(receipt);assert.equal(f.flow.launches.length,1);assert.equal(f.flow.submits,0);assert.equal(f.batch.store.item(x.queue_id).attempts,3);assert.equal(f.round.item(f.r.id,x.key).extra_attempts,0);assert.equal(f.round.round(f.r.id).state,'SYSTEM_BLOCKED');
});
test('an original standalone run is reused when it has no queue yet',async t=>{
 const f=await fixture(t),x=f.round.item(f.r.id,f.keys[0]),run=f.store.create(f.r.importId,x.task,'LIVE','SOURCE',{reviewed:true,taskHash:digest(x.task)});
 f.round.update(f.r.id,x.key,{run_id:run.id,reason:'原单条待恢复'});
 const receipt=await f.create([1],{mode:'retry'});await f.run(receipt);
 assert.equal(f.round.item(f.r.id,x.key).run_id,run.id);assert.equal(f.flow.submits,1);assert.equal(f.store.list().length,1);
});
