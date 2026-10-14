import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {SourceStore,digest} from '../source-store.mjs';

// Exercise the actual workflow and durable SQLite transitions. Only platform
// I/O is replaced; no production browser, source data, or network is accessed.
const fixtureKey='__ly_submission_pause_fixture';
const hooks=registerHooks({load(url,ctx,next){
 const common=`const f=()=>globalThis.${fixtureKey};`;
 if(url.endsWith('/taobao-publisher.mjs'))return {format:'module',shortCircuit:true,source:common+`
 export const MAPPING_VERSION='isolated-pause-boundary';
 export const newForm=page=>page?.kind==='form';
 export const assertTaskFiles=async()=>{f().fileChecks++;};
 export const assertPublishIdentity=async(page,task,options)=>{
  f().identityChecks.push({...options});
  if(page.shop!==task.business.shop_name)throw Error('WRONG_SHOP');
  if(!options.submitted&&page.title!==task.listing.title)throw Error('ANOTHER_TASK_FORM');
  await f().duringIdentity(options);
 };
 export const openTaskPage=async(_context,_task,_checkpoint,guard,_record,onPage)=>{
  f().opens++;onPage(f().page,{createdThisExecution:true});await guard(f().page);return f().page;
 };
 export const fillTask=async({guard})=>{f().fills++;await guard();return {};};
 export const verifyForm=async()=>{await f().afterFormCheck();};
 export const submitTask=async(_page,guard,onClicked)=>{
  f().submitCalls++;await f().beforeSubmitGuard();await guard();
  f().clicks++;await f().afterDispatch();await onClicked();await f().afterRecord();
  await guard();f().receipts++;return f().itemId;
 };
 export const verifyResult=async(_context,task,itemId,_target,_dir,guard)=>{
  f().verifications++;await f().duringVerification();await guard(f().verificationPage);
  if(f().verificationPage.shop!==task.business.shop_name)throw Error('WRONG_SHOP');
  if(f().verificationError)throw Error(f().verificationError);
  if(itemId!==f().itemId)throw Error('WRONG_ITEM_ID');
  await f().beforeVerificationReturns();await guard(f().verificationPage);
  return {itemId,status:'出售中',screenshot:'isolated-platform.png',rowText:task.listing.title,verifiedAt:new Date().toISOString()};
 };`};
 if(url.endsWith('/browser-environment.mjs'))return {format:'module',shortCircuit:true,source:common+`
 export const PROJECT_ROOT=${JSON.stringify(process.cwd())};
 export const visibleChallenge=async page=>{f().challengeChecks++;return page?.challenge===true;};`};
 if(url.endsWith('/publishing-pages.mjs'))return {format:'module',shortCircuit:true,source:common+`
 export const closeVerifiedOwnedPage=async(_page,options,guard)=>{
  await guard();if(!options.verifiedPersisted)throw Error('CLEANUP_BEFORE_PERSIST');
  f().cleanups++;return {closed:true};
 };`};
 if(url.endsWith('/task-screenshot.mjs'))return {format:'module',shortCircuit:true,source:common+`
 export const captureTaskScreenshot=async(_page,_dir,name)=>{f().screenshots.push(name);return {screenshot:'isolated-'+name+'.png'};};`};
 return next(url,ctx);
}});
const {SourceWorkflow}=await import('../source-workflow.mjs');
hooks.deregister();

async function fixture(t){
 const dir=await mkdtemp(join(tmpdir(),'ly-submit-pause-'));
 assert(resolve(dir).startsWith(resolve(tmpdir())+sep));
 const store=new SourceStore(join(dir,'state.sqlite'));
 t.after(async()=>{delete globalThis[fixtureKey];store.close();await rm(dir,{recursive:true,force:true});});
 const task={shopId:'isolated-pause-shop',priority:1,source:{},listing:{type:'country',country:'隔离国家',title:'隔离国家服务'},business:{shop_name:'隔离店',listing_time:'立刻上架'},assets:{main:[],secondary:[],details:[]},adapterIssues:[]};
 const noop=async()=>{};
 const state={itemId:'123456789',opens:0,fills:0,submitCalls:0,clicks:0,receipts:0,verifications:0,cleanups:0,fileChecks:0,contentChecks:0,finalChecks:0,challengeChecks:0,identityChecks:[],screenshots:[],
  beforeSubmitGuard:noop,afterDispatch:noop,afterRecord:noop,duringVerification:noop,beforeVerificationReturns:noop,afterFormCheck:noop,duringStatus:noop,duringIdentity:noop,
  login:{running:true,loggedIn:true,loginState:'LOGGED_IN'},
  page:{kind:'form',shop:task.business.shop_name,title:task.listing.title,isClosed:()=>false,url:()=> 'https://item.upload.taobao.com/sell/v2/publish.htm',locator:()=>({inputValue:async()=>task.listing.title})},
  verificationPage:{kind:'list',shop:task.business.shop_name,url:()=> 'https://myseller.taobao.com/home.htm'}
 };
 globalThis[fixtureKey]=state;
 const owner={status:async()=>{await state.duringStatus();return state.login;},sessions:new Map([[task.shopId,{context:{pages:()=>[state.page]}}]])};
 const flow=new SourceWorkflow(owner,{store,runtime:dir,artifacts:join(dir,'artifacts')});
 flow.assertContentForLive=async()=>{state.contentChecks++;if(state.contentError)throw Object.assign(Error(state.contentError),{code:state.contentError});};
 flow.beforeVerified=async()=>{state.finalChecks++;if(state.finalError)throw Object.assign(Error(state.finalError),{code:state.finalError});};
 const run=store.create('isolated-import',task,'LIVE','SOURCE',{reviewed:true,taskHash:digest(task)}),shop={id:task.shopId,name:task.business.shop_name};
 const execute=async()=>{flow.launch(run.id,shop);await flow.pending;return store.run(run.id);};
 const resume=async()=>{await flow.resume({id:run.id},shop);await flow.pending;return store.run(run.id);};
 const count=kind=>store.events(run.id).filter(e=>e.kind===kind).length;
 const saved=async()=>JSON.parse(await readFile(join(dir,'artifacts',run.id,'checkpoint.json'),'utf8'));
 return {dir,store,task,state,flow,run,shop,execute,resume,count,saved};
}

async function assertVerified(x,{clicks=1,contentChecks=2}={}){
 const r=x.store.run(x.run.id),saved=await x.saved();
 assert.equal(r.state,'VERIFIED');assert.equal(saved.state,'VERIFIED');assert.equal(saved.result.itemId,x.state.itemId);
 assert.equal(x.store.completed(x.task).itemId,x.state.itemId);assert.equal(x.state.clicks,clicks);
 assert.equal(x.count('SUBMIT_CLICKED'),clicks);assert.equal(x.count('VERIFIED'),1);
 assert.equal(x.state.contentChecks,contentChecks);assert.equal(x.state.finalChecks,1);assert.equal(x.flow.active,null);
 assert.equal(x.store.list().length,1);assert.equal(x.store.run(x.run.id).id,x.run.id);
}

test('pause before submit intent stops without clicking or platform verification',async t=>{
 const x=await fixture(t);x.state.afterFormCheck=async()=>x.flow.pause();const r=await x.execute();
 assert.equal(r.state,'PAUSED');assert.match(r.reason,/操作者暂停/);assert.equal(x.state.clicks,0);assert.equal(x.count('SUBMITTING'),0);assert.equal(x.state.verifications,0);assert.equal(x.store.completed(x.task),null);
});

for(const stage of ['beforeSubmitGuard','duringStatus','duringIdentity'])test('pause before click at '+stage+' never dispatches submission',async t=>{
 const x=await fixture(t);
 x.state[stage]=async()=>{if(x.state.submitCalls===1&&x.state.clicks===0)x.flow.pause();};
 const r=await x.execute();assert.equal(r.state,'RESULT_UNKNOWN');assert.match(r.reason,/操作者暂停/);
 assert.equal(x.count('SUBMITTING'),1);assert.equal(x.state.clicks,0);assert.equal(x.count('SUBMIT_CLICKED'),0);assert.equal(x.state.verifications,0);
 // Durable intent is conservative: a restart/resume cannot turn it into a retry.
 await x.resume();assert.equal(x.state.submitCalls,1);assert.equal(x.state.clicks,0);assert.equal(x.store.run(r.id).state,'RESULT_UNKNOWN');
});

for(const stage of ['afterDispatch','afterRecord','duringVerification','beforeVerificationReturns'])test('pause at '+stage+' finishes verification and durable result once',async t=>{
 const x=await fixture(t);x.state[stage]=async()=>x.flow.pause();await x.execute();await assertVerified(x);
 assert.equal(x.flow.stop,true);assert.equal(x.state.verifications,1);assert.equal(x.state.cleanups,1);
 assert(x.state.identityChecks.some(o=>o.submitted===true));assert(x.state.challengeChecks>0);
 assert.equal(JSON.parse(await readFile(join(x.dir,'artifacts',x.run.id,'result.json'),'utf8')).itemId,x.state.itemId);
 await assert.rejects(x.resume(),/已有成功核验记录/);assert.equal(x.state.clicks,1);
});

test('shutdown waits until a dispatched submission is verified and persisted',async t=>{
 const x=await fixture(t);let shutdown;
 x.state.afterRecord=async()=>{shutdown=x.flow.shutdown();};
 await x.execute();await shutdown;await assertVerified(x);assert.equal(x.flow.stop,true);
});

test('pause during the final result hook still saves the verified result',async t=>{
 const x=await fixture(t),original=x.flow.beforeVerified;
 x.flow.beforeVerified=async(...args)=>{x.flow.pause();await original(...args);};
 await x.execute();await assertVerified(x);assert.equal(x.state.cleanups,1);
});

for(const problem of ['captcha-page','captcha-owner','wrong-owner','wrong-form-shop','wrong-verification-shop'])test('pause never bypasses '+problem+' after a click',async t=>{
 const x=await fixture(t);
 x.state.afterRecord=async()=>{x.flow.pause();
  if(problem==='captcha-page')x.state.page.challenge=true;
  if(problem==='captcha-owner')x.state.login={running:true,loggedIn:false,loginState:'PAUSED_CAPTCHA'};
  if(problem==='wrong-owner')x.state.login={running:true,loggedIn:false,loginState:'WRONG_SHOP',reason:'WRONG_SHOP'};
  if(problem==='wrong-form-shop')x.state.page.shop='另一店铺';
  if(problem==='wrong-verification-shop')x.state.verificationPage.shop='另一店铺';
 };
 const r=await x.execute();assert.equal(r.state,'RESULT_UNKNOWN');assert.match(r.reason,/PAUSED_CAPTCHA|WRONG_SHOP/);
 assert.equal(x.state.clicks,1);assert.equal(x.count('VERIFIED'),0);assert.equal(x.state.cleanups,0);assert.equal(x.store.completed(x.task),null);
 assert.equal((await x.saved()).state,'RESULT_UNKNOWN');
});

for(const stage of ['verification','final-content-hook'])test('pause with '+stage+' failure keeps evidence and prevents another click',async t=>{
 const x=await fixture(t);x.state.duringVerification=async()=>x.flow.pause();
 if(stage==='verification')x.state.verificationError='PLATFORM_FIELDS_MISMATCH';else x.state.finalError='CONTENT_REVIEW_INVALID';
 const r=await x.execute();assert.equal(r.state,'RESULT_UNKNOWN');assert.match(r.reason,/PLATFORM_FIELDS_MISMATCH|CONTENT_REVIEW_INVALID/);
 assert.equal(x.state.clicks,1);assert.equal(x.state.cleanups,0);assert.equal(x.store.completed(x.task),null);assert.equal(r.checkpoint.itemId,x.state.itemId);
 await x.resume();assert.equal(x.state.clicks,1);assert.equal(x.state.submitCalls,1);assert.equal(x.store.run(r.id).state,'RESULT_UNKNOWN');
});

for(const problem of ['dispatch-timeout','receipt-unavailable','click-event-write'])test('uncertain '+problem+' is never converted to success or resubmitted',async t=>{
 const x=await fixture(t);
 if(problem==='dispatch-timeout')x.state.afterDispatch=async()=>{x.flow.pause();throw Error('click transport timeout after dispatch');};
 if(problem==='receipt-unavailable')x.state.afterRecord=async()=>{x.flow.pause();throw Error('success receipt unavailable');};
 if(problem==='click-event-write'){
  const event=x.store.event.bind(x.store);x.store.event=(id,kind,data)=>{if(kind==='SUBMIT_CLICKED'){x.flow.pause();throw Error('click event write failed');}return event(id,kind,data);};
 }
 const r=await x.execute();assert.equal(r.state,'RESULT_UNKNOWN');assert.equal(x.state.clicks,1);assert.equal(x.state.verifications,0);assert.equal(x.state.cleanups,0);assert.equal(x.store.completed(x.task),null);
 await x.resume();assert.equal(x.store.run(r.id).state,'RESULT_UNKNOWN');assert.equal(x.state.submitCalls,1);assert.equal(x.state.clicks,1);
});

test('result-unknown recovery is verification only and drains safely when paused',async t=>{
 const x=await fixture(t);x.store.move(x.run.id,'RUNNING');x.store.move(x.run.id,'SUBMITTING');
 x.store.checkpoint(x.run.id,{itemId:x.state.itemId});x.store.move(x.run.id,'RESULT_UNKNOWN','isolated restart');
 x.state.duringVerification=async()=>x.flow.pause();await x.resume();await assertVerified(x,{clicks:0,contentChecks:0});
 assert.equal(x.state.submitCalls,0);assert.equal(x.state.opens,0);assert.equal(x.state.fills,0);assert.equal(x.state.verifications,1);assert.equal(x.state.cleanups,0);
});

test('verification-only recovery still stops for a captcha and never opens a form',async t=>{
 const x=await fixture(t);x.store.move(x.run.id,'RUNNING');x.store.move(x.run.id,'SUBMITTING');
 x.store.checkpoint(x.run.id,{itemId:x.state.itemId});x.store.move(x.run.id,'RESULT_UNKNOWN','isolated restart');
 x.state.duringVerification=async()=>{x.flow.pause();x.state.verificationPage.challenge=true;};
 const r=await x.resume();assert.equal(r.state,'RESULT_UNKNOWN');assert.equal(r.reason,'PAUSED_CAPTCHA');
 assert.equal(x.state.clicks,0);assert.equal(x.state.opens,0);assert.equal(x.count('VERIFIED'),0);assert.equal(x.store.completed(x.task),null);
});

test('revoked content still blocks intent even with the new pause boundary',async t=>{
 const x=await fixture(t);x.state.afterFormCheck=async()=>{x.state.contentError='CONTENT_REVIEW_INVALID';};
 const r=await x.execute();assert.equal(r.state,'PAUSED');assert.equal(r.checkpoint.errorCode,'CONTENT_REVIEW_INVALID');
 assert.equal(x.state.contentChecks,2);assert.equal(x.count('SUBMITTING'),0);assert.equal(x.state.clicks,0);
});
