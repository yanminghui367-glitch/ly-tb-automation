import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {fixture as core} from './success-goal-fixture.mjs';
import {ProductApi} from '../product-api.mjs';

async function fixture(t){
 const x=await core(t,6);x.store.db.exec('CREATE TABLE product_actions(id TEXT PRIMARY KEY,action TEXT NOT NULL,target TEXT NOT NULL,at TEXT NOT NULL,result TEXT NOT NULL)');
 const api={round:x.round,source:x.flow,batch:x.batch,shop:x.round.shop,capturing:false,roundVerifier:{reset(){}},assertExecution:async()=>{},integrity:async()=>({ok:true,revision:'fixture'}),owner:{status:async()=>({running:true,loggedIn:true,loginState:'LOGGED_IN'})}};
 api.assertRulesIdle=()=>ProductApi.prototype.assertRulesIdle.call(api);
 const request=async(action,input)=>{let result;await ProductApi.prototype.handleRound.call(api,{method:'POST'},{},new URL('/api/v1/rounds/'+action,'http://localhost'),{body:async()=>input,json:(_r,status,body)=>result={status,body}});return result;};
 const input=()=>({id:x.r.id,shopId:x.round.shop.id,manifestHash:x.r.manifestHash,requestId:randomUUID(),startPosition:1,endPosition:6,targetSuccess:3,windowLimit:2,retryFailedOnce:true,confirmedBy:'测试确认人'});
 return {...x,api,request,input};
}
test('preview is read only; confirmed create starts once and request replay does not restart',async t=>{
 const x=await fixture(t),input=x.input(),p=await x.request('success-goal-preview',input);assert.equal(p.status,200);assert.equal(p.body.canCreate,true);
 assert.equal(x.round.successGoals.latest(x.r.id),null);assert.equal(x.flow.submits,0);
 const req={...input,requestId:randomUUID(),goalHash:p.body.goalHash,confirmed:true},created=await x.request('success-goal-create',req);
 assert.equal(created.status,200);assert.equal(created.body.executionStarted,true);await x.round.pending;assert.equal(x.flow.submits,3);
 const replay=await x.request('success-goal-create',req);assert.equal(replay.body.replayed,true);assert.equal(x.flow.submits,3);assert.equal(x.round.successGoals.summary(x.r.id).newSuccess,3);
 await assert.rejects(x.request('success-goal-create',{...req,targetSuccess:4}),/范围内容已改变/);
});
test('missing login or failed integrity cannot create goal or start executor',async t=>{
 for(const mode of ['login','kernel']){
  const x=await fixture(t),input=x.input(),p=await x.request('success-goal-preview',input),req={...input,goalHash:p.body.goalHash,confirmed:true};
  if(mode==='login')x.api.owner.status=async()=>({running:false,loggedIn:false});else x.api.integrity=async()=>({ok:false});
  await assert.rejects(x.request('success-goal-create',req),mode==='login'?/登录/:/内核/);assert.equal(x.round.successGoals.latest(x.r.id),null);assert.equal(x.flow.submits,0);
 }
});
test('wrong shop and unconfirmed target reject without production action',async t=>{
 const x=await fixture(t),input=x.input();await assert.rejects(x.request('success-goal-preview',{...input,shopId:'other-shop'}),/店铺/);
 const p=await x.request('success-goal-preview',input);await assert.rejects(x.request('success-goal-create',{...input,goalHash:p.body.goalHash}),{code:'SUCCESS_GOAL_CONFIRMATION_REQUIRED'});
 assert.equal(x.flow.submits,0);assert.equal(x.round.successGoals.latest(x.r.id),null);
});
test('durable create followed by startup error is replayed read only, never silently reissued',async t=>{
 const x=await fixture(t),input=x.input(),p=await x.request('success-goal-preview',input),req={...input,goalHash:p.body.goalHash,confirmed:true};
 x.round.start=()=>{throw Error('fixture startup interrupted');};await assert.rejects(x.request('success-goal-create',req),/interrupted/);
 assert.equal(x.round.successGoals.summary(x.r.id).state,'READY');const replay=await x.request('success-goal-create',req);
 assert.equal(replay.body.replayed,true);assert.equal(replay.body.executionStarted,false);assert.equal(x.flow.submits,0);
});
