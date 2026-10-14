import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {ProductApi} from '../product-api.mjs';
import {setup} from './skip-independent-fixture.mjs';

async function fixture(t){
 const f=await setup(t);await f.pause();
 const first=f.round.item(f.r.id,f.scope().key);
 f.store.move(first.run_id,'QUEUED');f.store.move(first.run_id,'RUNNING');f.store.move(first.run_id,'PAUSED_CAPTCHA','PAUSED_CAPTCHA');
 f.round.update(f.r.id,first.key,{state:'WAITING_HUMAN',reason:'PAUSED_CAPTCHA',failure_stage:'existing-listing-query'});
 // Maintenance has preserved the parent CAPTCHA record while pausing its run.
 f.store.db.prepare("UPDATE runs SET state='PAUSED',reason='程序中断，恢复时重新核验页面' WHERE id=?").run(first.run_id);
 f.store.db.prepare('UPDATE rounds SET current_item=? WHERE id=?').run(f.scope(2).key,f.r.id);
 f.round.state(f.r.id,'SYSTEM_BLOCKED','第二条图片超时');
 f.action.skip(f.request(2));
 let browser={running:true,loggedIn:true,loginState:'LOGGED_IN',checkedAt:new Date().toISOString()};
 const api=new ProductApi({source:f.flow,batch:f.batch,shop:f.round.shop,runtime:f.flow.artifacts,owner:{sessions:new Map(),status:async()=>browser},integrity:async()=>({ok:true}),checkFiles:async()=>{}});
 api.round=f.round;await api.saveSettings({executionEnabled:true,confirmShop:f.round.shop.name});
 const input={id:f.r.id,windowId:f.w.id,manifestHash:f.r.manifestHash,requestId:randomUUID()};
 const call=async(extra={})=>{let result;await api.handle({method:'POST'},{},new URL('http://localhost/api/v1/rounds/resume'),{body:async()=>({...input,...extra}),json:(_res,_status,data)=>result=data});return result;};
 return {...f,first,api,call,input,setBrowser:b=>browser=b,browser};
}

test('skip then resume rechecks cleared historical CAPTCHA and continues original remaining links',async t=>{
 const f=await fixture(t),before=f.flow.launches.length;
 assert.deepEqual(f.round.summary(f.r.id).captchaRecheck,{eligible:true,count:1});
 await f.call();await f.round.pending;
 assert.equal(f.round.item(f.r.id,f.scope(2).key).state,'MANUAL_SKIPPED');
 assert.equal(f.round.item(f.r.id,f.scope().key).run_id,f.first.run_id);
 assert.equal(f.round.item(f.r.id,f.scope(3).key).state,'NEW_SUCCESS');
 assert.equal(f.flow.submits,2);assert.equal(f.flow.launches.length-before,2);
 const accepted=f.round.events(f.r.id).filter(e=>e.kind==='START_ACCEPTED').at(-1);
 assert.equal(accepted.payload.humanVerified,false);
 assert.equal(accepted.payload.captchaVerification.source,'fresh-browser-check');
 assert.deepEqual(accepted.payload.captchaVerification.keys,[f.first.key]);
 await f.call();assert.equal(f.flow.submits,2,'same accepted request replay never dispatches twice');
});

test('fresh browser proof is required; missing, stale and future timestamps cannot clear a CAPTCHA hold',async t=>{
 const f=await fixture(t),before=f.flow.launches.length;
 for(const patch of [{checkedAt:undefined},{checkedAt:'invalid'},{checkedAt:new Date(Date.now()-60000).toISOString()},{checkedAt:new Date(Date.now()+60000).toISOString()},{stale:true},{loginState:'LOGIN_UNVERIFIED'}]){
  f.setBrowser({...f.browser,...patch});await assert.rejects(f.call(),/人工/);
 }
 assert.equal(f.flow.launches.length,before);assert.equal(f.round.item(f.r.id,f.first.key).state,'WAITING_HUMAN');
});

test('a real challenge or wrong shop still blocks continuation after the skip was saved',async t=>{
 const f=await fixture(t),before=f.flow.launches.length;
 for(const loginState of ['PAUSED_CAPTCHA','WRONG_SHOP','LOGIN_REQUIRED']){
  f.setBrowser({...f.browser,loggedIn:false,loginState,reason:'验证码或登录身份未通过'});
  await assert.rejects(f.call({humanVerified:true}),/验证码|登录/);
 }
 assert.equal(f.flow.launches.length,before);assert.equal(f.round.item(f.r.id,f.scope(2).key).state,'MANUAL_SKIPPED');
});

test('client supplied CAPTCHA proof cannot replace the fresh server browser check',async t=>{
 const f=await fixture(t);f.setBrowser({...f.browser,checkedAt:undefined});
 await assert.rejects(f.call({captchaVerification:{source:'fresh-browser-check',checkedAt:new Date().toISOString(),keys:[f.first.key]}}),/人工/);
 assert.equal(f.flow.submits,0);
});

test('identity, mode and non-CAPTCHA human holds require their original confirmation',async t=>{
 const f=await fixture(t);
 for(const patch of [{reason:'店铺身份待确认',failure_stage:'shop-identity'},{reason:'HUMAN_MODE: 原任务仅填写',failure_stage:'preflight'},{reason:'请人工登录',failure_stage:'login'},{reason:'未知人工问题',failure_stage:'preflight'}]){
  f.round.update(f.r.id,f.first.key,patch);assert.equal(f.round.captchaRecheck(f.r.id).eligible,false);
  await assert.rejects(f.call(),/人工/);
 }
 assert.equal(f.flow.submits,0);
});

test('submission evidence prevents automatically clearing an old CAPTCHA hold',async t=>{
 for(const kind of ['SUBMITTING','SUBMIT_CLICKED','SUBMIT_EVIDENCE','RESULT_UNKNOWN','VERIFIED']){
  const f=await fixture(t);f.store.event(f.first.run_id,kind,{});
  assert.equal(f.round.captchaRecheck(f.r.id).eligible,false);await assert.rejects(f.call(),/人工/);assert.equal(f.flow.submits,0);
 }
});

test('submission flags, known original ID and non-LIVE run stay protected',async t=>{
 for(const kind of ['submitted','submission_uncertain','result','checkpoint','mode']){
  const f=await fixture(t);
  if(['submitted','submission_uncertain'].includes(kind))f.round.update(f.r.id,f.first.key,{[kind]:1});
  if(kind==='result')f.round.update(f.r.id,f.first.key,{result:{itemId:'100001'}});
  if(kind==='checkpoint')f.store.checkpoint(f.first.run_id,{itemId:'100001'});
  if(kind==='mode')f.store.db.prepare("UPDATE runs SET mode='DRY_RUN' WHERE id=?").run(f.first.run_id);
  assert.equal(f.round.captchaRecheck(f.r.id).eligible,false);await assert.rejects(f.call(),/人工/);assert.equal(f.flow.submits,0);
 }
});

test('browser proof cannot be reused after the original hold set changes',async t=>{
 const f=await fixture(t),proof=f.round.verifyClearedCaptcha(f.r.id,f.browser);
 f.round.update(f.r.id,f.scope(3).key,{state:'WAITING_HUMAN',failure_stage:'preflight',reason:'CAPTCHA'});
 await assert.throws(()=>f.round.resume(f.r.id,{windowId:f.w.id,captchaVerification:proof}),/人工/);
 assert.equal(f.flow.submits,0);
});
