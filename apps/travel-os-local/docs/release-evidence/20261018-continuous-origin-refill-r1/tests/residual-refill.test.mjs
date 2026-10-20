import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {readFileSync} from 'node:fs';
import {mkdtemp,readFile,writeFile,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {SourceStore,digest} from '../source-store.mjs';
import {BatchStore} from '../batch-store.mjs';

// Actual SourceWorkflow, SourceStore, BatchStore and ExecutionSteps; platform
// actions are isolated adapters. No production DB/browser/network access.
const key='__residualRefillFixture',common=`const f=()=>globalThis.${key};`;
const hooks=registerHooks({load(url,ctx,next){
 if(url.endsWith('/source-workflow.mjs')&&process.env.REPAIR_BASELINE==='1')return {format:'module',shortCircuit:true,source:readFileSync(new URL('../../../../../workbench/source-workflow.mjs',import.meta.url),'utf8')};
 if(url.endsWith('/taobao-publisher.mjs'))return {format:'module',shortCircuit:true,source:common+`
 export const MAPPING_VERSION='isolated-residual';export const assertTaskFiles=async()=>{};
 export const newForm=p=>p?.kind==='form';
 export const assertPublishIdentity=async(p,t)=>{if(p.shop!==t.business.shop_name)throw Error('WRONG_SHOP');};
 export const openTaskPage=async(c,t,cp,g,record,on)=>{
  f().opens++;f().openInputs.push(structuredClone(cp));
  if(cp.residualPageRefill&&cp.residualPageRefill.status!=='BOUND')throw Error('RESERVED_REFILL_STOP');
  let p=cp.refillPageTargetId?c.pages().find(p=>p.id===cp.refillPageTargetId):cp.formUrl?f().old:null;
  if(cp.refillPageTargetId&&!p)throw Error('REFILL_TARGET_MISSING');
  if(!p){f().creates++;await f().beforeCreate();p=f().makePage('fresh-'+f().creates);f().fresh=p;}
  await on(p,{createdThisExecution:p!==f().old});await g(p);await record({formUrl:p.url()});return p;
 };
 export const fillTask=async options=>{f().fills++;f().fillDirs.push(options.dir);await options.guard();await f().duringFill(options);if(f().fills<=f().failFills)throw Error(f().failure);return {};};
 export const verifyForm=async()=>{};
 export const submitTask=async(p,g,clicked)=>{await g();f().clicks++;f().submitted.push(p.id);await clicked();return '123456789';};
 export const verifyResult=async(_c,t,itemId)=>({itemId,status:'出售中',rowText:t.listing.title,screenshot:'isolated.png'});`};
 if(url.endsWith('/browser-environment.mjs'))return {format:'module',shortCircuit:true,source:common+`export const PROJECT_ROOT=${JSON.stringify(process.cwd())};export const visibleChallenge=async p=>p?.captcha===true;`};
 if(url.endsWith('/task-screenshot.mjs'))return {format:'module',shortCircuit:true,source:common+`export const captureTaskScreenshot=async(p,_d,name)=>{f().screenshots.push({page:p?.id,name});await f().duringScreenshot(name);return {screenshot:'isolated-'+name+'.png'};};`};
 if(url.endsWith('/publishing-pages.mjs'))return {format:'module',shortCircuit:true,source:common+`export const closeVerifiedOwnedPage=async p=>{f().closed.push(p.id);return {closed:true};};`};
 if(url.endsWith('/page-protection.mjs'))return {format:'module',shortCircuit:true,source:common+`export const readPageProtection=async p=>{f().protectionReads++;return {status:f().protection,pageTargetId:p.id,tabTargetId:'tab-'+p.id};};`};
 if(url.endsWith('/page-ownership.mjs'))return {format:'module',shortCircuit:true,source:common+`export const setPageScope=(_c,scope)=>{f().scope=scope;return {assertHealthy(){},assertCanStartTask(){},describe(p){return {owned:true,purpose:'publish-form',targetId:p.id,scope:f().scope};},retain(p,data){f().retained.push({page:p.id,...data});}};};`};
 if(url.endsWith('/execution-evidence-policy.mjs'))return {format:'module',shortCircuit:true,source:`export const EVIDENCE_POLICY_VERSION='isolated';export const evidenceMode=m=>m;export const captureStepEvidence=async()=>({});`};
 return next(url,ctx);
}});
const {SourceWorkflow}=await import('../source-workflow.mjs');hooks.deregister();

async function fixture(t){
 const dir=await mkdtemp(join(tmpdir(),'ly-residual-refill-')),store=new SourceStore(join(dir,'state.sqlite')),batch=new BatchStore(store);
 const task={shopId:'refill-shop',priority:102,source:{},listing:{type:'country',country:'隔离国',title:'隔离国旅行'},business:{shop_name:'隔离店',listing_time:'立刻上架'},assets:{main:[],secondary:[],details:[]},adapterIssues:[]};
 const state={opens:0,creates:0,fills:0,clicks:0,protectionReads:0,protection:'unpinned',failFills:1,failure:'EXISTING_DETAIL_RECEIPT_MISSING',openInputs:[],fillDirs:[],submitted:[],closed:[],retained:[],screenshots:[],duringFill:async()=>{},duringScreenshot:async()=>{},beforeCreate:async()=>{}};
 globalThis[key]=state;const pages=[];
 state.makePage=id=>{const p={id,kind:'form',shop:task.business.shop_name,main:0,details:0,url:()=> 'https://item.upload.taobao.com/sell/v2/publish.htm?same-url',isClosed:()=>false,locator:s=>({inputValue:async()=>task.listing.title,count:async()=>s.includes('mainImagesGroup')?p.main:p.details})};pages.push(p);return p;};
 state.old=state.makePage('old-page');state.old.details=2;
 const context={pages:()=>pages,newCDPSession:async p=>({send:async()=>({targetInfo:{type:'page',targetId:p.id,browserContextId:'ctx-refill'}}),detach:async()=>{}})};
 const owner={status:async()=>({running:true,loggedIn:state.loggedIn!==false,loginState:state.loggedIn===false?'LOGIN_REQUIRED':'LOGGED_IN'}),sessions:new Map([[task.shopId,{context}]])};
 const flow=new SourceWorkflow(owner,{store,runtime:dir,artifacts:join(dir,'artifacts')});flow.assertContentForLive=async()=>{};
 const b=batch.create('isolated',[task],task.shopId,'LIVE',{reviewed:true,selectionHash:digest([task]),authorization:'isolated-only'}),item=batch.items(b.id)[0];
 batch.claim(item.id);const run=store.create('isolated',task,'LIVE','SOURCE',{reviewed:true,taskHash:digest(task)});batch.attach(item.id,run.id);
 store.checkpoint(run.id,{formUrl:state.old.url()});const artifacts=join(dir,'artifacts',run.id);await mkdir(artifacts,{recursive:true});await writeFile(join(artifacts,'detail-receipts.json'),'original-receipt-evidence');
 const execute=async()=>{flow.launch(run.id,{id:task.shopId,name:task.business.shop_name});await flow.pending;return store.run(run.id);};
 const attemptsBefore=batch.item(item.id).attempts;
 t.after(async()=>{assert.equal(batch.item(item.id).attempts,attemptsBefore,'same source execute must not claim another attempt');assert.equal(batch.item(item.id).max_attempts,3);assert.equal(store.list().length,1);store.close();delete globalThis[key];assert(resolve(dir).startsWith(resolve(tmpdir())+sep));await rm(dir,{recursive:true,force:true});});
 return {dir,store,batch,item,flow,run,state,execute,artifacts};
}
const noRefill=x=>{assert.equal(x.state.creates,0);assert.equal(x.state.clicks,0);assert.equal(x.store.events(x.run.id).filter(e=>e.kind==='RESIDUAL_PAGE_REFILL').length,0);};

test('exact missing receipt refills once in same claim; only new page submits and old evidence remains',async t=>{
 const x=await fixture(t),r=await x.execute();assert.equal(r.state,'VERIFIED');assert.equal(x.state.creates,1);assert.equal(x.state.fills,2);assert.equal(x.state.clicks,1);assert.deepEqual(x.state.submitted,['fresh-1']);assert(!x.state.closed.includes('old-page'));
 assert.equal(x.store.events(r.id).filter(e=>e.kind==='SUBMITTING').length,1);assert.equal(x.store.events(r.id).filter(e=>e.kind==='SUBMIT_CLICKED').length,1);
 assert.equal(r.checkpoint.residualPageRefill.count,1);assert.equal(r.checkpoint.refillPageTargetId,'fresh-1');assert.equal(x.state.fillDirs[1],join(x.artifacts,'residual-refill-1')+sep);assert.deepEqual(x.state.openInputs[1],{});
 assert.equal(await readFile(join(x.artifacts,'detail-receipts.json'),'utf8'),'original-receipt-evidence');
 assert.deepEqual(x.store.events(r.id).filter(e=>e.kind==='RESIDUAL_PAGE_REFILL').map(e=>e.payload.status),['RESERVED','BOUND']);assert(x.state.screenshots.some(s=>s.page==='old-page'&&s.name==='residual-detail-receipt-missing'));
});
test('second missing receipt pauses with no second refill, including a later execute',async t=>{
 const x=await fixture(t);x.state.failFills=10;const first=await x.execute();assert.equal(first.state,'PAUSED');assert.equal(first.reason,'EXISTING_DETAIL_RECEIPT_MISSING');assert.equal(x.state.creates,1);assert.equal(x.state.fills,2);assert.equal(x.state.clicks,0);
 x.store.move(x.run.id,'QUEUED');assert.equal((await x.execute()).state,'PAUSED');assert.equal(x.state.creates,1);assert.equal(x.state.fills,3);assert.equal(x.state.openInputs.at(-1).refillPageTargetId,'fresh-1');
});
test('reserved refill surviving interruption never creates another page',async t=>{
 const x=await fixture(t);x.state.beforeCreate=async()=>{throw Error('isolated create interrupted');};const first=await x.execute();assert.equal(first.state,'PAUSED');assert.match(first.reason,/^RESIDUAL_REFILL_OPEN_INCOMPLETE/);assert.equal(x.store.run(x.run.id).checkpoint.residualPageRefill.status,'RESERVED');const opens=x.state.opens;
 x.store.move(x.run.id,'QUEUED');const next=await x.execute();assert.equal(next.state,'PAUSED');assert.match(next.reason,/^RESIDUAL_REFILL_INCOMPLETE/);assert.equal(x.state.opens,opens);assert.equal(x.state.creates,1);assert.equal(x.state.clicks,0);
});
for(const kind of ['SUBMITTING','SUBMIT_CLICKED','SUBMIT_EVIDENCE','RESULT_UNKNOWN','VERIFIED','STEP_INTENT'])test('historical '+kind+' prevents residual refill',async t=>{
 const x=await fixture(t);x.store.event(x.run.id,kind,kind==='STEP_INTENT'?{name:'submit-once'}:{});const r=await x.execute();assert.equal(r.state,'PAUSED');assert.match(r.reason,/^RESIDUAL_REFILL_SUBMISSION_EVIDENCE/);noRefill(x);
});
for(const field of ['itemId','successUrl'])test('checkpoint '+field+' prevents residual refill',async t=>{
 const x=await fixture(t);x.store.checkpoint(x.run.id,{[field]:'already-submitted'});const r=await x.execute();assert.equal(r.state,'PAUSED');assert.match(r.reason,/^RESIDUAL_REFILL_SUBMISSION_EVIDENCE/);noRefill(x);
});
for(const failure of ['TOO_MANY_DETAIL_IMAGES','DETAIL_SOURCE_MISMATCH','EXISTING_DETAIL_MISMATCH','DETAIL_ORDER','OTHER_ERROR'])test(failure+' remains hard failure without refill',async t=>{
 const x=await fixture(t);x.state.failure=failure;assert.equal((await x.execute()).state,'PAUSED');noRefill(x);
});
for(const protection of ['pinned','unknown'])test(protection+' original page is preserved without refill',async t=>{
 const x=await fixture(t);x.state.protection=protection;const r=await x.execute();assert.equal(r.state,'PAUSED');assert.match(r.reason,/^RESIDUAL_REFILL_PAGE_PROTECTED/);noRefill(x);
});
for(const condition of ['captcha','login','identity','pause'])test(condition+' on original page prevents refill',async t=>{
 const x=await fixture(t);x.state.duringFill=async()=>{if(condition==='captcha')x.state.old.captcha=true;if(condition==='login')x.state.loggedIn=false;if(condition==='identity')x.state.old.shop='另一店';if(condition==='pause')x.flow.stop=true;};
 assert(['PAUSED','PAUSED_CAPTCHA'].includes((await x.execute()).state));noRefill(x);
});
test('submission intent appearing during screenshot blocks refill before reservation',async t=>{
 const x=await fixture(t);x.state.duringScreenshot=async name=>{if(name==='residual-detail-receipt-missing')x.store.event(x.run.id,'SUBMITTING',{});};const r=await x.execute();assert.equal(r.state,'PAUSED');assert.match(r.reason,/^RESIDUAL_REFILL_SUBMISSION_EVIDENCE/);noRefill(x);
});
for(const field of ['main','details'])test('nonempty fresh '+field+' stops before second fill or submit',async t=>{
 const x=await fixture(t);const make=x.state.makePage;x.state.makePage=id=>{const p=make(id);p[field]=1;return p;};const r=await x.execute();assert.equal(r.state,'PAUSED');assert.match(r.reason,/^RESIDUAL_REFILL_FORM_NOT_EMPTY/);assert.equal(x.state.creates,1);assert.equal(x.state.fills,1);assert.equal(x.state.clicks,0);
});
