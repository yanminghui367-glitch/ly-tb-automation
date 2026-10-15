import test from 'node:test';
import assert from 'node:assert/strict';
import {createCurrentItemSkip} from '../round-item-detail.js';
import {setup} from './skip-independent-fixture.mjs';

function uiFixture({responseLost=false,resumeBlocked=false}={}){
 const storageValues=new Map(),storage={getItem:k=>storageValues.get(k)||null,setItem:(k,v)=>storageValues.set(k,v),removeItem:k=>storageValues.delete(k)};
 let id=0,decisions=0,resumes=0,lost=responseLost;
 const calls=[],round={id:'round',manifestHash:'manifest',state:'WAITING_HUMAN',active:false,window:{id:'window',state:'WAITING_HUMAN'},current:{key:'key',state:'WAITING_HUMAN',destination:'隔离城市',reason:'PAUSED_CAPTCHA',submitted:false,submissionUncertain:false}};
 const detail={roundId:'round',windowId:'window',key:'key',revision:'revision',current:{...round.current},submissionEvidence:false,capabilities:{skip:{allowed:true}}};
 const reply=(body,status=200)=>({ok:status===200,json:async()=>body});
 const request=async(path,init)=>{
  const input=init.body?JSON.parse(init.body):null;calls.push({path,input});
  if(path.includes('/item?'))return reply(detail);
  if(path.endsWith('/item-skip')){
   if(!decisions){decisions++;round.current.state='MANUAL_SKIPPED';}
   if(lost){lost=false;throw Error('模拟断网');}
   return reply({outcome:{state:'MANUAL_SKIPPED',submitted:false,item:{key:'key'}}});
  }
  if(path.endsWith('/resume')){resumes++;return resumeBlocked?reply({error:'当前仍有验证码，请人工完成验证'},409):reply({accepted:true});}
  throw Error('undeclared route');
 };
 const create=()=>createCurrentItemSkip({request,storage,currentRound:()=>round,makeId:()=>String(++id)});
 return {round,detail,calls,storage,create,counts:()=>({decisions,resumes})};
}
const scope={roundId:'round',windowId:'window',key:'key'};

test('one click saves the current skip before resuming the exact original window',async()=>{
 const f=uiFixture(),ui=f.create();assert.equal(ui.view(f.round).allowed,true);await ui.run(scope);
 assert.deepEqual(f.calls.map(x=>x.path.split('?')[0]),['/api/v1/rounds/item','/api/v1/rounds/item-skip','/api/v1/rounds/resume']);
 assert.match(f.calls[1].input.reason,/PAUSED_CAPTCHA/);assert.equal(f.calls[2].input.windowId,'window');assert.equal(f.calls[2].input.humanVerified,undefined);
 assert.deepEqual(f.counts(),{decisions:1,resumes:1});assert.match(ui.view(f.round).notice,/已跳过隔离城市/);assert.equal(ui.view(f.round).shown,true);assert.equal(ui.view(f.round).allowed,false);assert.equal(ui.view(f.round).label,'已跳过此条');
});
test('lost skip receipt survives reload and reuses both exact request IDs',async()=>{
 const f=uiFixture({responseLost:true});let ui=f.create();await ui.run(scope);assert.equal(f.counts().resumes,0);
 ui=f.create();assert.equal(ui.view(f.round).label,'核对此次跳过');await ui.run(scope);
 const skips=f.calls.filter(x=>x.path.endsWith('/item-skip'));assert.deepEqual(skips[0].input,skips[1].input);assert.deepEqual(f.counts(),{decisions:1,resumes:1});
});
test('CAPTCHA still blocks resume while the manual skip remains recorded',async()=>{
 const f=uiFixture({resumeBlocked:true}),ui=f.create();await ui.run(scope);
 assert.equal(f.round.current.state,'MANUAL_SKIPPED');assert.match(ui.view(f.round).notice,/已跳过.*继续本轮未通过检查.*验证码/);assert.equal(ui.view(f.round).label,'已跳过此条');
});
test('confirmed skip feedback clears from the current-action area after the next product becomes current',async()=>{
 const f=uiFixture({resumeBlocked:true}),ui=f.create();await ui.run(scope);
 assert.match(ui.view(f.round).notice,/继续本轮未通过检查.*验证码/);
 f.round.current={key:'spain-key',state:'NEW_SUCCESS',destination:'西班牙',submitted:true,submissionUncertain:false};
 const current=ui.view(f.round);
 assert.equal(current.notice,'');assert.equal(current.error,false);assert.equal(current.key,'spain-key');
 assert.equal(f.counts().decisions,1,'历史跳过决定仍只记录一次');
});
test('a completed or changed window can reconcile its saved receipt without starting a new window',async()=>{
 for(const changed of [false,true]){
  const f=uiFixture({responseLost:true});await f.create().run(scope);
  f.round.window={id:changed?'next-window':'window',state:'COMPLETED'};f.round.state='COMPLETED';
  const ui=f.create();assert.equal(ui.view(f.round).allowed,true);assert.equal(ui.view(f.round).windowId,'window');await ui.run(scope);
  assert.equal(f.counts().decisions,1);assert.equal(f.counts().resumes,changed?0:1);
 }
});
test('submitted, uncertain, active and unrelated current items cannot be skipped',async()=>{
 for(const patch of [{submitted:true},{submissionUncertain:true},{state:'RESULT_UNKNOWN'},{state:'NEW_SUCCESS'}]){
  const f=uiFixture();Object.assign(f.round.current,patch);await assert.rejects(f.create().run(scope),/已变化/);assert.equal(f.calls.length,0);
 }
 const f=uiFixture();f.round.active=true;await assert.rejects(f.create().run(scope));assert.equal(f.calls.length,0);
});
test('server submission evidence overrides the UI banner and prevents the POST',async()=>{
 const f=uiFixture();f.detail.submissionEvidence=true;await f.create().run(scope);assert.deepEqual(f.counts(),{decisions:0,resumes:0});
});
test('double clicks use a single decision, and stale scope cannot target another item',async()=>{
 const f=uiFixture(),ui=f.create();await Promise.all([ui.run(scope),ui.run(scope)]);assert.deepEqual(f.counts(),{decisions:1,resumes:1});
 const g=uiFixture();g.round.current.key='next';await assert.rejects(g.create().run(scope));assert.equal(g.calls.length,0);
});
test('lost resume receipt replays the original skip and original resume after reload',async()=>{
 const f=uiFixture();
 let first=true;
 const store=new Map(),storage={getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)};
 const calls=[],round=f.round;let id=0;
 const request=async(path,init)=>{const input=init.body?JSON.parse(init.body):null;calls.push({path,input});if(path.includes('/item?'))return {ok:true,json:async()=>f.detail};if(path.endsWith('/item-skip'))return {ok:true,json:async()=>({outcome:{state:'MANUAL_SKIPPED',submitted:false,item:{key:'key'}}})};if(first){first=false;throw Error('resume response lost');}return {ok:true,json:async()=>({accepted:true})};};
 const create=()=>createCurrentItemSkip({request,storage,currentRound:()=>round,makeId:()=>String(++id)});
 await create().run(scope);await create().run(scope);
 assert.deepEqual(calls.filter(x=>x.path.endsWith('/resume'))[0].input,calls.filter(x=>x.path.endsWith('/resume'))[1].input);
});

async function captchaFixture(t){
 const f=await setup(t);await f.pause();const x=f.round.item(f.r.id,f.scope().key);
 f.store.move(x.run_id,'QUEUED');f.store.move(x.run_id,'RUNNING');f.store.move(x.run_id,'PAUSED_CAPTCHA','PAUSED_CAPTCHA');
 f.round.update(f.r.id,x.key,{state:'WAITING_HUMAN',reason:'PAUSED_CAPTCHA',failure_stage:'existing-listing-query'});
 f.round.state(f.r.id,'WAITING_HUMAN','PAUSED_CAPTCHA');f.round.windows.state(f.w.id,'WAITING_HUMAN','PAUSED_CAPTCHA');
 return f;
}
test('pre-submit CAPTCHA current item can be skipped without changing original run or counters',async t=>{
 const f=await captchaFixture(t),x=f.round.item(f.r.id,f.scope().key),run=f.store.run(x.run_id),q=f.batch.store.item(x.queue_id);
 assert.equal(f.action.inspect(f.scope()).allowed,true);const receipt=f.action.skip(f.request());assert.equal(receipt.outcome.state,'MANUAL_SKIPPED');
 assert.deepEqual(f.store.run(x.run_id),run);assert.equal(f.batch.store.item(x.queue_id).attempts,q.attempts);assert.equal(f.round.item(f.r.id,x.key).state,'MANUAL_SKIPPED');
 f.round.start(f.r.id,{windowId:f.w.id});await f.round.pending;assert.equal(f.flow.submits,2);assert.equal(f.round.windows.view(f.w.id).ended,3);
});
test('CAPTCHA skip cannot hide submission evidence or uncertain outcome',async t=>{
 for(const kind of ['SUBMITTING','SUBMIT_CLICKED','SUBMIT_EVIDENCE','RESULT_UNKNOWN','VERIFIED']){
  const f=await captchaFixture(t);f.store.event(f.round.item(f.r.id,f.scope().key).run_id,kind,{});
  assert.equal(f.action.inspect(f.scope()).allowed,false);assert.throws(()=>f.action.skip(f.request()),/SUBMISSION_PROTECTED/);
 }
});
test('restart recovery preserves permission to skip the current pre-submit CAPTCHA item',async t=>{
 const f=await captchaFixture(t),x=f.round.item(f.r.id,f.scope().key);
 f.store.move(x.run_id,'QUEUED');f.store.move(x.run_id,'RUNNING');f.store.move(x.run_id,'PAUSED','程序中断，恢复时重新核验页面');
 assert.equal(f.store.run(x.run_id).state,'PAUSED');assert.equal(f.round.item(f.r.id,x.key).reason,'PAUSED_CAPTCHA');
 assert.equal(f.action.inspect(f.scope()).allowed,true);assert.equal(f.action.skip(f.request()).outcome.state,'MANUAL_SKIPPED');assert.equal(f.flow.submits,0);
});
test('CAPTCHA decision remains restricted to current item; content and identity holds stay protected',async t=>{
 const f=await captchaFixture(t);f.round.db.prepare('UPDATE rounds SET current_item=? WHERE id=?').run(f.scope(2).key,f.r.id);assert.equal(f.action.inspect(f.scope()).allowed,false);
 f.round.db.prepare('UPDATE rounds SET current_item=? WHERE id=?').run(f.scope().key,f.r.id);
 f.round.update(f.r.id,f.scope().key,{failure_stage:'content-preflight'});assert.equal(f.action.inspect(f.scope()).allowed,false);
 f.round.update(f.r.id,f.scope().key,{failure_stage:'shop-identity',reason:'店铺身份待确认'});
 f.store.db.prepare("UPDATE runs SET state='PAUSED',reason='店铺身份待确认' WHERE id=?").run(f.round.item(f.r.id,f.scope().key).run_id);
 assert.equal(f.action.inspect(f.scope()).allowed,false);
});
