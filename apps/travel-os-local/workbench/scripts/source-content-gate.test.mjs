import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {mkdtemp,rm,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {SourceStore,digest,destinationKey} from '../source-store.mjs';
import {PublishingContentReviews} from '../publishing-content-review.mjs';

// Run the real SourceWorkflow with only platform I/O replaced. There is no
// browser or network connection; the submit substitute counts side effects.
const fixtureKey='__ly_source_content_fixture';
const hooks=registerHooks({load(url,ctx,next){
 const common=`const f=()=>globalThis.${fixtureKey};`;
 if(url.endsWith('/taobao-publisher.mjs'))return {format:'module',shortCircuit:true,source:common+`
 export const MAPPING_VERSION='isolated';
 export const newForm=()=>true;
 export const assertPublishIdentity=async()=>{};
 export const assertTaskFiles=async()=>{};
 export const openTaskPage=async(_c,_t,_p,_g,_s,on)=>{f().opens++;on(f().page);return f().page;};
 export const fillTask=async()=>{f().fills++;return {};};
 export const verifyForm=async()=>{await f().afterFill();};
 export const submitTask=async(_p,guard,record)=>{await guard();f().submits++;await record();return '123456789';};
 export const verifyResult=async()=>({itemId:'123456789',status:'出售中',screenshot:'isolated.png',rowText:'test fixture',verifiedAt:new Date().toISOString()});`};
 if(url.endsWith('/browser-environment.mjs'))return {format:'module',shortCircuit:true,source:`export const PROJECT_ROOT=${JSON.stringify(process.cwd())}; export const visibleChallenge=async()=>false;`};
 if(url.endsWith('/publishing-pages.mjs'))return {format:'module',shortCircuit:true,source:'export const closeVerifiedOwnedPage=async()=>({closed:false});'};
 if(url.endsWith('/task-screenshot.mjs'))return {format:'module',shortCircuit:true,source:'export const captureTaskScreenshot=async()=>({screenshot:null,screenshotError:"isolated no browser"});'};
 return next(url,ctx);
}});
const {SourceWorkflow}=await import('../source-workflow.mjs');
hooks.deregister();

async function fixture(t,{mode='LIVE',approved=true,hook=true}={}){
 const dir=await mkdtemp(join(tmpdir(),'ly-source-content-'));assert(resolve(dir).startsWith(resolve(tmpdir())+sep));
 const store=new SourceStore(join(dir,'state.sqlite')),reviews=new PublishingContentReviews(store);
 t.after(async()=>{delete globalThis[fixtureKey];store.close();await rm(dir,{recursive:true,force:true});});
 const path=join(dir,'main.png');await writeFile(path,'original destination image');
 const task={shopId:'content-fixture',priority:1,source:{},listing:{type:'country',country:'隔离国家',title:'隔离标题'},assets:{main:[{path,sha256:digest(await readFile(path))}],secondary:[],details:[]},business:{shop_name:'隔离店',listing_time:'立刻上架'},adapterIssues:[]};
 const round={id:'round-fixture',manifest_hash:'m'.repeat(64),shop:task.shopId};
 const row={key:destinationKey(task),task_hash:digest(task),task},entry={key:row.key,taskHash:row.task_hash,mainHashes:task.assets.main.map(a=>a.sha256),decision:'PASS',observedText:'隔离国家',evidence:[{path,sha256:task.assets.main[0].sha256}]};
 const save=async decision=>{const prepared=await reviews.prepare(round,[row],{id:round.id,manifestHash:round.manifest_hash,reviewer:'isolated test',method:'direct-visual',entries:[{...entry,decision}]});reviews.save(prepared);};
 if(approved)await save('PASS');
 let checks=0;
 const state={opens:0,fills:0,submits:0,afterFill:async()=>{},page:{url:()=> 'https://item.upload.taobao.com/sell/v2/publish.htm',locator:()=>({inputValue:async()=>task.listing.title})}};
 globalThis[fixtureKey]=state;
 const owner={status:async()=>({running:true,loggedIn:true,loginState:'LOGGED_IN'}),sessions:new Map([[task.shopId,{context:{pages:()=>[]}}]])};
 const flow=new SourceWorkflow(owner,{store,runtime:dir,artifacts:join(dir,'artifacts')});
 if(hook)flow.assertContentForLive=async()=>{checks++;const review=reviews.assertApproved(task,round);await reviews.verifyEvidence(review,task);return review;};
 const run=store.create('fixture-import',task,mode,'SOURCE',{reviewed:true,taskHash:digest(task)});
 const execute=async()=>{flow.launch(run.id,{id:task.shopId,name:task.business.shop_name});await flow.pending;return store.run(run.id);};
 return {store,flow,run,task,state,save,execute,checks:()=>checks};
}
function noSubmit(x){assert.equal(x.state.submits,0);assert.equal(x.store.events(x.run.id).filter(e=>['SUBMITTING','SUBMIT_CLICKED'].includes(e.kind)).length,0);assert.equal(x.store.list().length,1);}

for(const missing of ['review','hook'])test('LIVE with missing '+missing+' stops before opening any form and persists code',async t=>{
 const x=await fixture(t,{approved:missing!=='review',hook:missing!=='hook'}),r=await x.execute();
 assert.equal(r.state,'PAUSED');assert.equal(r.checkpoint.errorCode,'CONTENT_REVIEW_REQUIRED');assert.equal(x.state.opens,0);assert.equal(x.state.fills,0);noSubmit(x);
});
for(const decision of ['MISMATCH','UNREVIEWED'])test('revoking content to '+decision+' during filling stops before submit intent',async t=>{
 const x=await fixture(t);x.state.afterFill=()=>x.save(decision);const r=await x.execute();
 assert.equal(x.checks(),2);assert.equal(x.state.fills,1);assert.equal(r.state,'PAUSED');assert.equal(r.checkpoint.errorCode,decision==='MISMATCH'?'CONTENT_MISMATCH':'CONTENT_REVIEW_REQUIRED');noSubmit(x);
});
test('changing source bytes after filling is blocked by real evidence reread',async t=>{
 const x=await fixture(t);x.state.afterFill=()=>writeFile(x.task.assets.main[0].path,'wrong image');const r=await x.execute();
 assert.equal(r.state,'PAUSED');assert.equal(r.checkpoint.errorCode,'CONTENT_REVIEW_INVALID');assert.equal(x.checks(),2);noSubmit(x);
});
test('unchanged approved source follows one intent and one click through original run',async t=>{
 const x=await fixture(t),r=await x.execute();assert.equal(r.state,'VERIFIED');assert.equal(x.checks(),2);assert.equal(x.state.submits,1);
 assert.equal(x.store.events(r.id).filter(e=>e.kind==='SUBMITTING').length,1);assert.equal(x.store.events(r.id).filter(e=>e.kind==='SUBMIT_CLICKED').length,1);assert.equal(x.store.completed(x.task).itemId,'123456789');
});
test('DRY_RUN remains inspectable, but conversion to LIVE rechecks missing content',async t=>{
 const x=await fixture(t,{mode:'DRY_RUN',approved:false}),dry=await x.execute();assert.equal(dry.state,'DRY_RUN_COMPLETE');assert.equal(x.checks(),0);noSubmit(x);
 const before=x.store.run(x.run.id),events=x.store.events(x.run.id);
 await assert.rejects(x.flow.resume({id:x.run.id,publish:true},{id:x.task.shopId,name:x.task.business.shop_name}),/CONTENT_REVIEW_REQUIRED/);
 assert.deepEqual(x.store.run(x.run.id),before);assert.deepEqual(x.store.events(x.run.id),events);assert.equal(x.store.run(x.run.id).mode,'DRY_RUN');assert.equal(x.state.opens,1);assert.equal(x.store.list()[0].id,x.run.id);noSubmit(x);
});
