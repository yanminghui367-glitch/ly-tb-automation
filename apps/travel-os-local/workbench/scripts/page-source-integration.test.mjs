import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {EventEmitter} from 'node:events';
import {mkdir,mkdtemp,rm} from 'node:fs/promises';
import {resolve,join,sep} from 'node:path';
import {SourceStore,digest} from '../source-store.mjs';
import {getPageLedger} from '../page-ownership.mjs';

// Actual SourceWorkflow, PublishingPages, PageOwnership and SQLite. Only platform
// I/O and content validation are fake. No live store, browser, profile or network.
const globalKey='__qaPageSourceIntegration',base=resolve(import.meta.dirname,'../../output/page-management-qa/source-integration-fixtures');await mkdir(base,{recursive:true});
const hooks=registerHooks({load(url,ctx,next){const f=`const f=()=>globalThis.${globalKey};`;
 if(url.endsWith('/taobao-publisher.mjs'))return {format:'module',shortCircuit:true,source:f+`
  import {createBackgroundPage} from './publishing-pages.mjs';
  export const MAPPING_VERSION='page-integration-fixture';export const assertTaskFiles=async()=>{};
  export const newForm=p=>p?.url().includes('/publish.htm');export const assertPublishIdentity=async()=>{};
  export const openTaskPage=async(c,t,_cp,g,save,onPage)=>{f().opens++;const p=await createBackgroundPage(c);f().publish=p;p.title=t.listing.title;onPage(p,{createdThisExecution:true});p.address='https://item.upload.taobao.com/sell/v2/publish.htm';await g(p);return p;};
  export const fillTask=async({guard})=>{f().fills++;await guard();return {};};
  export const verifyForm=async()=>{await f().afterForm();};
  export const submitTask=async(p,g,clicked)=>{await g();f().clicks++;await clicked();p.address='https://item.upload.taobao.com/sell/v2/success.htm?primaryId=123';p.text='商品提交成功 商品ID：123';await f().afterClick();await g(p);return '123';};
  export const verifyResult=async(_c,t,itemId,_target,_dir,g)=>{f().checks++;await f().duringVerify();await g(f().listing);return {itemId,status:'出售中',rowText:t.listing.title,screenshot:'isolated-proof.png',verifiedAt:new Date().toISOString()};};`};
 if(url.endsWith('/browser-environment.mjs'))return {format:'module',shortCircuit:true,source:f+`export const PROJECT_ROOT=${JSON.stringify(resolve(import.meta.dirname,'../..'))};export const visibleChallenge=async p=>p?.captcha===true;`};
 if(url.endsWith('/task-screenshot.mjs'))return {format:'module',shortCircuit:true,source:`export const captureTaskScreenshot=async()=>({screenshot:'isolated-proof.png'});`};
 return next(url,ctx);
}});
const {SourceWorkflow}=await import('../source-workflow.mjs');hooks.deregister();

function contextFixture(state){
 const context=new EventEmitter(),pages=[];let seq=0;
 const add=(id,url='about:blank')=>{
  const page=Object.assign(new EventEmitter(),{id,address:url,title:'',text:'',closed:false,closeCalls:0,context:()=>context,url(){return this.address;},isClosed(){return this.closed;},locator(selector){return {inputValue:async()=>this.title,innerText:async()=>{await state.bodyRead(this);return this.text;}};},async close(){this.closeCalls++;await state.closePage(this);this.closed=true;}});
  pages.push(page);context.emit('page',page);return page;
 };
 context.pages=()=>pages.filter(p=>!p.closed);context.add=()=>add('manual-'+(++seq));
 const tab=p=>({type:'tab',targetId:'tab-'+p.id,browserContextId:'ctx',embedderData:{tabPinned:p.pinned??false,tabActive:p.active??false}});
 const browser={isConnected:()=>true,newBrowserCDPSession:async()=>{
  const s=new EventEmitter(),targets=new Map();let sessions=0;
  s.detach=async()=>{};s.send=async(method,args)=>{
   if(method==='Target.getTargets')return {targetInfos:context.pages().map(tab)};
   if(method==='Target.getTargetInfo')return {targetInfo:tab(pages.find(p=>'tab-'+p.id===args.targetId))};
   if(method==='Target.attachToTarget'){const sessionId='observe-'+(++sessions);targets.set(sessionId,args.targetId);return {sessionId};}
   if(method==='Target.detachFromTarget')return {};
   if(method==='Target.sendMessageToTarget'){
    s.emit('Target.receivedMessageFromTarget',{sessionId:args.sessionId,message:JSON.stringify({method:'Target.attachedToTarget',params:{sessionId:'child-'+args.sessionId,waitingForDebugger:false,targetInfo:{type:'page',targetId:targets.get(args.sessionId).slice(4)}}})});
    s.emit('Target.receivedMessageFromTarget',{sessionId:args.sessionId,message:JSON.stringify({id:1,result:{}})});return {};
   }
   throw Error('unexpected fake CDP '+method);
  };return s;
 }};
 context.browser=()=>browser;context.newCDPSession=async page=>({detach:async()=>{},send:async(method)=>{
  if(method==='Target.getTargetInfo')return {targetInfo:{type:'page',targetId:page.id,browserContextId:'ctx'}};
  if(method==='Target.createTarget'){state.creates++;state.beforeCreate();const p=add('owned-'+(++seq));return {targetId:p.id};}
  throw Error('unexpected page CDP '+method);
 }});
 state.listing=add('baseline','https://myseller.taobao.com/home.htm/SellManage/all');return context;
}
async function fixture(t){
 const dir=await mkdtemp(join(base,'case-')),store=new SourceStore(join(dir,'qa.sqlite'));
 const state={opens:0,fills:0,clicks:0,checks:0,creates:0,afterForm:async()=>{},afterClick:async()=>{},duringVerify:async()=>{},bodyRead:async()=>{},closePage:async()=>{},beforeCreate:()=>{}};
 globalThis[globalKey]=state;const context=contextFixture(state),shop={id:'qa-shop',name:'隔离店'};
 const owner={status:async()=>({running:true,loggedIn:true,loginState:'LOGGED_IN'}),sessions:new Map([[shop.id,{context}]])};
 const flow=new SourceWorkflow(owner,{store,runtime:dir,artifacts:join(dir,'artifacts')});flow.assertContentForLive=async()=>{};
 flow.pageScopeForRun=()=>({roundId:'round-isolated',executionWindowId:'window-isolated'});
 const create=(n=1)=>{const task={shopId:shop.id,priority:n,source:{},listing:{type:'city',country:'隔离国',city:'城'+n,title:'隔离商品'+n},business:{shop_name:shop.name},assets:{main:[],secondary:[],details:[]},adapterIssues:[]};return store.create('import-isolated',task,'LIVE','SOURCE',{reviewed:true,taskHash:digest(task)});};
 const execute=async run=>{flow.launch(run.id,shop);await flow.pending;return store.run(run.id);};
 const run=create();t.after(async()=>{getPageLedger(context)?.dispose();store.close();delete globalThis[globalKey];assert(resolve(dir).startsWith(base+sep));await rm(dir,{recursive:true,force:true});});
 return {dir,store,state,context,flow,run,create,execute,ledger:()=>getPageLedger(context)};
}
function ledgerFault(x){
 x.store.db.exec("CREATE TRIGGER reject_owned_event BEFORE INSERT ON page_owner_events WHEN NEW.kind='borrowed:seller-home' BEGIN SELECT RAISE(FAIL,'fixture failure'); END");
 assert.throws(()=>x.ledger().lease(x.state.listing,{purpose:'seller-home'}),/落盘失败/);
 x.store.db.exec('DROP TRIGGER reject_owned_event');
}

test('actual source creates only after durable exact-scope reservation and closes after durable success',async t=>{
 const x=await fixture(t);x.state.beforeCreate=()=>{const row=x.store.db.prepare("SELECT scope FROM page_owner_pages WHERE state='creation-intent'").get();assert(row);const s=JSON.parse(row.scope);assert.equal(s.runId,x.run.id);assert.equal(s.executionWindowId,'window-isolated');};
 const r=await x.execute(x.run);assert.equal(r.state,'VERIFIED');assert.equal(x.state.publish.closeCalls,1);assert.equal(x.ledger().counts().owned,0);
 const e=x.store.db.prepare('SELECT kind FROM page_owner_events ORDER BY id').all().map(e=>e.kind);assert(e.indexOf('verified-persisted')<e.indexOf('close-intent'));assert(e.includes('closed'));assert(x.store.completed(r.task));
});
test('pre-click ledger failure pauses before submission and keeps the owned form',async t=>{
 const x=await fixture(t);x.state.afterForm=async()=>ledgerFault(x);const r=await x.execute(x.run);
 assert.equal(r.state,'PAUSED');assert.equal(x.state.clicks,0);assert.equal(x.state.publish.closeCalls,0);assert.equal(x.ledger().counts().retained,1);assert.throws(()=>x.ledger().assertCanStartTask(),/落盘失败/);
});
test('a post-click ledger failure drains verification, preserves success and blocks the next source task',async t=>{
 const x=await fixture(t);x.state.afterClick=async()=>ledgerFault(x);const r=await x.execute(x.run);
 assert.equal(r.state,'VERIFIED');assert.equal(x.state.checks,1);assert.equal(x.state.publish.closeCalls,0);assert(x.store.completed(r.task));
 x.state.afterClick=async()=>{};const next=await x.execute(x.create(2));assert.equal(next.state,'PAUSED');assert.match(next.reason,/台账落盘失败/);assert.equal(x.state.clicks,1);assert.equal(x.state.creates,1);
});
test('close receipt persistence failure preserves verified result but cannot be swallowed into another task',async t=>{
 const x=await fixture(t);x.state.closePage=async()=>x.store.db.exec("CREATE TRIGGER reject_close_receipt BEFORE UPDATE ON page_owner_pages WHEN NEW.state='closed' BEGIN SELECT RAISE(FAIL,'fixture'); END");
 const r=await x.execute(x.run);assert.equal(r.state,'VERIFIED');assert(x.store.completed(r.task));assert.equal(x.state.publish.closeCalls,1);assert.throws(()=>x.ledger().assertCanStartTask(),/落盘失败/);
 const next=await x.execute(x.create(2));assert.equal(next.state,'PAUSED');assert.equal(x.state.clicks,1);assert.equal(x.state.creates,1);
});
test('cleanup DOM failure is retained in the exception budget without changing the verified product',async t=>{
 const x=await fixture(t);x.state.bodyRead=async()=>{throw Error('cleanup DOM timeout fixture');};const r=await x.execute(x.run);
 assert.equal(r.state,'VERIFIED');assert(x.store.completed(r.task));assert.equal(x.state.publish.closeCalls,0);
 assert.equal(x.ledger().counts().retained,1,'logging cleanup failure must still record the preserved abnormal page');
});
test('two cleanup read failures stop the following source before creating a third page',async t=>{
 const x=await fixture(t);x.state.bodyRead=async()=>{throw Error('cleanup DOM timeout fixture');};assert.equal((await x.execute(x.run)).state,'VERIFIED');assert.equal((await x.execute(x.create(2))).state,'VERIFIED');
 const third=await x.execute(x.create(3));assert.equal(third.state,'PAUSED');assert.match(third.reason,/两张异常/);assert.equal(x.state.creates,2);assert.equal(x.state.clicks,2);
});
test('post-VERIFIED result artifact failure also retains its page in the exception budget',async t=>{
 const x=await fixture(t);x.state.duringVerify=async()=>mkdir(join(x.dir,'artifacts',x.run.id,'result.json'));
 const r=await x.execute(x.run);assert.equal(r.state,'VERIFIED');assert(x.store.completed(r.task));assert.equal(x.state.publish.closeCalls,0);
 assert(x.store.events(x.run.id).some(e=>e.kind==='ARTIFACT_WRITE_ERROR'));
 assert.equal(x.ledger().counts().retained,1,'a page preserved after artifact write failure must count as an abnormal hold');
});
test('RESULT_UNKNOWN recovery continues read-only verification despite an already latched ledger fault',async t=>{
 const x=await fixture(t);x.state.afterClick=async()=>{ledgerFault(x);x.state.publish.captcha=true;};
 assert.equal((await x.execute(x.run)).state,'RESULT_UNKNOWN');assert.equal(x.state.clicks,1);assert.equal(x.state.checks,0);
 // The fake platform dispatched 123 before CAPTCHA; supply that known receipt to
 // the original unknown run. Recovery must not use a fresh run or click again.
 x.store.checkpoint(x.run.id,{itemId:'123'});x.state.publish.captcha=false;
 await x.flow.resume({id:x.run.id},{id:x.run.task.shopId,name:'隔离店'});await x.flow.pending;
 assert.equal(x.store.run(x.run.id).state,'VERIFIED');assert.equal(x.state.clicks,1);assert.equal(x.state.checks,1);assert.equal(x.state.creates,1);assert.equal(x.state.publish.closeCalls,0);assert.throws(()=>x.ledger().assertCanStartTask(),/落盘失败/);
});
test('two result artifact failures stop the following task while preserving both successes',async t=>{
 const x=await fixture(t);x.state.duringVerify=async()=>mkdir(join(x.dir,'artifacts',x.flow.active,'result.json'));
 assert.equal((await x.execute(x.run)).state,'VERIFIED');const second=x.create(2);assert.equal((await x.execute(second)).state,'VERIFIED');
 const third=await x.execute(x.create(3));assert.equal(third.state,'PAUSED');assert.match(third.reason,/两张异常/);assert.equal(x.state.creates,2);assert.equal(x.state.clicks,2);assert(x.store.completed(x.run.task));assert(x.store.completed(second.task));
});
test('artifact failure followed by failed retention persistence keeps the next-task fault latch',async t=>{
 const x=await fixture(t);x.state.duringVerify=async()=>{
  await mkdir(join(x.dir,'artifacts',x.run.id,'result.json'));
  x.store.db.exec("CREATE TRIGGER reject_artifact_hold BEFORE UPDATE ON page_owner_pages WHEN NEW.reason='ARTIFACT_WRITE_FAILED' BEGIN SELECT RAISE(FAIL,'fixture'); END");
 };
 const r=await x.execute(x.run);assert.equal(r.state,'VERIFIED');assert(x.store.completed(r.task));assert.equal(x.state.publish.closeCalls,0);
 assert.throws(()=>x.ledger().assertCanStartTask(),/落盘失败/);assert(x.store.events(x.run.id).some(e=>e.kind==='PAGE_LEDGER_PERSISTENCE_FAILED'));
 const second=await x.execute(x.create(2));assert.equal(second.state,'PAUSED');assert.equal(x.state.creates,1);assert.equal(x.state.clicks,1);
});
