import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {SourceStore,digest,destinationKey} from '../source-store.mjs';
import {SourceWorkflow} from '../source-workflow.mjs';
import {BatchWorkflow} from '../batch-workflow.mjs';
import {ProductApi} from '../product-api.mjs';
import {PublishingContentReviews} from '../publishing-content-review.mjs';
import {TravelOsApi} from '../travel-os-api.mjs';

const shop={id:'wuzhou-changyou',name:'五洲畅游'};
const evidence=n=>({itemId:String(990000+n),status:'出售中',rowText:'城市'+n+'\n20\n999999\n出售中',screenshot:'isolated-proof.png',verifiedAt:new Date().toISOString(),url:'https://item.taobao.com/item.htm?id='+String(990000+n)});
async function fixture(t,n=3){
 const dir=await mkdtemp(join(tmpdir(),'ly-content-integration-')),store=new SourceStore(join(dir,'state.sqlite')),resources=[];
 t.after(async()=>{for(const close of resources)close();store.close();await rm(dir,{recursive:true,force:true});});
 const tasks=[];
 for(let i=1;i<=n;i++){const path=join(dir,'main-'+i+'.png'),bytes=Buffer.from('isolated main destination '+i);await writeFile(path,bytes);tasks.push({schemaVersion:2,taskId:'task-'+i,shopId:shop.id,priority:i,source:{},listing:{type:'city',country:'测试国家',city:'城市'+i,title:'城市'+i+'定制服务'},assets:{main:[{path,sha256:digest(bytes)}],secondary:[],details:[]},business:{shop_name:shop.name,price_cny:20,inventory:999999},adapterIssues:[]});}
 const importId=store.imported({sourceHash:'isolated-content',tasks,summary:{total:n}});
 let outcome='VERIFIED',lookups=0;
 const source={store,runtime:dir,artifacts:join(dir,'tasks'),active:null,submits:0,launches:0,stop:false,
  async preflight(){},pause(){this.stop=true;},
  launch(id){this.active=id;this.launches++;this.pending=(async()=>{const r=store.run(id);store.move(id,'RUNNING');await SourceWorkflow.prototype.checkLiveContent.call(this,r.task);if(['PAUSED','PAUSED_CAPTCHA'].includes(outcome)){store.checkpoint(id,{step:'open-new-form',errorCode:'MATERIAL_UNCONFIRMED'});store.move(id,outcome,outcome==='PAUSED_CAPTCHA'?'PAUSED_CAPTCHA':'isolated pre-submit issue');return;}await SourceWorkflow.prototype.checkLiveContent.call(this,r.task);store.move(id,'SUBMITTING');store.event(id,'SUBMIT_CLICKED',{});this.submits++;if(outcome==='RESULT_UNKNOWN'){store.checkpoint(id,{step:'submit-once'});store.move(id,'RESULT_UNKNOWN','submitted without receipt');}else store.move(id,'VERIFIED','',evidence(r.task.priority));})().finally(()=>this.active=null);},
  async resume({id}){store.move(id,'QUEUED');this.launch(id);}
 };
 const batch=new BatchWorkflow(source),owner={sessions:new Map(),status:async()=>({running:true,loggedIn:true,loginState:'LOGGED_IN',checkedAt:new Date().toISOString()})};
 const params={batch,source,owner,shop,runtime:dir,launch:async()=>{},checkFiles:async()=>{},integrity:async()=>({ok:true,revision:'content-test'})};
 let api=new ProductApi(params);
 const wire=()=>{api.round.verifyExisting=async({history})=>{lookups++;return history||null;};};wire();
 const create=()=>api.round.create({importId,expectedCount:n,repairVersion:'content-test',authorization:{allowLive:true,maxSafeRecoveries:2,confirmedShop:shop.name,expectedCount:n}});
 const call=async(input)=>{let result;await api.handleRound({method:'POST'},{},new URL('http://localhost/api/v1/rounds/content-review'),{body:async()=>input,json:(res,status,data)=>result={status,data}});return result;};
 const reviewInput=(roundId,decisions=tasks.map(()=> 'PASS'))=>{const r=api.round.round(roundId);return {id:roundId,manifestHash:r.manifest_hash,requestId:randomUUID(),reviewer:'Independent isolated QA fixture',method:'direct-visual',entries:decisions.flatMap((decision,i)=>decision?[{key:destinationKey(tasks[i]),taskHash:digest(tasks[i]),mainHashes:tasks[i].assets.main.map(a=>a.sha256),decision,observedText:decision==='MISMATCH'?'wrong destination observed':'城市'+(i+1),evidence:tasks[i].assets.main.map(a=>({path:a.path,sha256:a.sha256}))}]:[])};};
 return {dir,store,tasks,source,batch,owner,params,importId,create,call,reviewInput,closeWithFixture:f=>resources.push(f),get api(){return api;},get lookups(){return lookups;},setOutcome:v=>outcome=v,restart(){api=new ProductApi(params);wire();return api;}};
}
async function startAndWait(x,id){await x.api.saveSettings({executionEnabled:true,confirmShop:shop.name});x.api.round.start(id);await x.api.round.pending;return x.api.round.view(id);}

test('missing content review blocks before lookup, queue creation and publishing; seven counts remain intact',async t=>{
 const x=await fixture(t),r=await x.create(),v=await startAndWait(x,r.id);
 assert.equal(v.state,'SYSTEM_BLOCKED');assert.match(v.reason,/CONTENT_REVIEW_REQUIRED/);assert.equal(v.counts.PENDING,3);assert.equal(v.counts.PREFLIGHT_SKIPPED,0);assert.equal(Object.values(v.counts).reduce((a,b)=>a+b),3);
 assert.equal(x.lookups,0);assert.equal(x.store.list().length,0);assert.equal(x.source.submits,0);assert.equal(x.source.launches,0);
});

test('published content hold survives restart, successful lookup, new local PASS and original history',async t=>{
 const x=await fixture(t),r=await x.create();assert(x.api.contentReviews instanceof PublishingContentReviews);await x.call(x.reviewInput(r.id));let v=await startAndWait(x,r.id);assert.equal(v.gate,1);
 const first=v.items[0],runBefore=x.store.run(first.runId),queueBefore=x.batch.store.item(first.queueId),historyBefore=x.store.completed(x.tasks[0]),manifest=v.manifestHash;
 const input=x.reviewInput(r.id,['MISMATCH',null,null]);await x.call(input);v=x.api.round.view(r.id);assert.equal(v.counts.NEW_SUCCESS,0);assert.equal(v.counts.RESULT_UNKNOWN,1);assert.equal(v.items[0].stage,'content-review');assert.equal(v.items[0].result.itemId,historyBefore.itemId);assert.equal(v.items[0].submitted,true);
 const writes=x.api.round.events(r.id).length;const replay=await x.call(input);assert.equal(replay.data.replayed,true);assert.equal(x.api.round.events(r.id).length,writes);await assert.rejects(x.call({...input,entries:[{...input.entries[0],decision:'PASS'}]}),/审核内容已改变/);
 x.restart();assert.equal(x.api.round.view(r.id).items[0].stage,'content-review');assert.equal(x.api.round.view(r.id).counts.NEW_SUCCESS,0);
 await x.call(x.reviewInput(r.id,['PASS',null,null]));assert.equal(x.api.round.view(r.id).items[0].stage,'content-review');
 const lookupBefore=x.lookups;await assert.rejects(x.api.round.verify(r.id,x.api.round.item(r.id,first.key)),/CONTENT_REVIEW_HELD/);assert.equal(x.lookups,lookupBefore);
 await assert.rejects(x.api.reconciliation.associate({id:first.runId,itemId:historyBefore.itemId,confirmed:true,requestId:randomUUID()}),/只允许核验/);
 assert.deepEqual(x.store.run(first.runId),runBefore);assert.deepEqual(x.store.completed(x.tasks[0]),historyBefore);assert.equal(x.batch.store.item(first.queueId).attempts,queueBefore.attempts);assert.equal(x.source.submits,1);assert.equal(x.api.round.view(r.id).manifestHash,manifest);
 const csv=x.api.round.csv(r.id);assert(csv.includes('content-review'));assert(csv.includes(historyBefore.itemId));assert(csv.includes('RESULT_UNKNOWN'));
 const snapshot=await x.api.snapshot(first.batchId);assert.equal(snapshot.records[0].verified,false);assert.equal(snapshot.records[0].contentHold,true);assert.equal(snapshot.records[0].duplicateBlocked,true);assert.equal(snapshot.overview.published,0);assert.equal(snapshot.batch.items[0].displayState,'RESULT_UNKNOWN');assert.equal(snapshot.exceptions[0].retryable,false);
 v=await startAndWait(x,r.id);assert.equal(v.state,'NEEDS_REVIEW');assert.equal(v.counts.NEW_SUCCESS,2);assert.equal(v.counts.RESULT_UNKNOWN,1);assert.equal(v.counts.PENDING,0);assert.equal(x.source.submits,3);assert.equal(x.store.events(first.runId).filter(e=>e.kind==='SUBMIT_CLICKED').length,1);assert.deepEqual(x.store.run(first.runId),runBefore);
 assert.equal(x.api.round.events(r.id).filter(e=>e.kind==='GATE_ONE_VERIFIED').length,1);assert.equal(Object.values(v.counts).reduce((a,b)=>a+b),3);
});

test('confirmed mismatch on paused pre-submit task skips without resetting original run or attempts',async t=>{
 const x=await fixture(t,2),r=await x.create();await x.call(x.reviewInput(r.id));x.setOutcome('PAUSED');let v=await startAndWait(x,r.id);assert.equal(v.state,'SYSTEM_BLOCKED');const item=v.items[0],runBefore=x.store.run(item.runId),q=x.batch.store.item(item.queueId);assert.equal(q.attempts,1);assert.equal(item.submitted,false);
 await x.call(x.reviewInput(r.id,['MISMATCH',null]));v=x.api.round.view(r.id);assert.equal(v.items[0].state,'PREFLIGHT_SKIPPED');assert.equal(v.items[0].stage,'content-preflight');assert.deepEqual(x.store.run(item.runId),runBefore);assert.equal(x.batch.store.item(item.queueId).attempts,1);assert.equal(x.source.submits,0);
 x.setOutcome('VERIFIED');v=await startAndWait(x,r.id);assert.equal(v.counts.PREFLIGHT_SKIPPED,1);assert.equal(v.counts.NEW_SUCCESS,1);assert.equal(x.source.submits,1);assert.equal(x.store.events(item.runId).some(e=>e.kind==='SUBMITTING'),false);
});

test('actual post-submit unknown cannot become skippable content hold after MISMATCH review',async t=>{
 const x=await fixture(t,2),r=await x.create();await x.call(x.reviewInput(r.id));x.setOutcome('RESULT_UNKNOWN');let v=await startAndWait(x,r.id);assert.equal(v.state,'RESULT_UNKNOWN');assert.equal(x.source.submits,1);const first=v.items[0],runBefore=x.store.run(first.runId);assert.equal(runBefore.state,'RESULT_UNKNOWN');assert.equal(runBefore.checkpoint.itemId,undefined);
 await x.call(x.reviewInput(r.id,['MISMATCH',null]));v=x.api.round.view(r.id);
 assert.notEqual(v.items[0].stage,'content-review','an unresolved platform submission must not become a safely skippable content hold');assert.equal(v.items[0].state,'RESULT_UNKNOWN');assert.deepEqual(x.store.run(first.runId),runBefore);
 x.setOutcome('VERIFIED');v=await startAndWait(x,r.id);assert.notEqual(v.state,'NEEDS_REVIEW');assert.equal(v.items[1].state,'PENDING');assert.equal(x.source.submits,1);
});

test('content approval endpoint rejects active execution without partial review records or events',async t=>{
 const x=await fixture(t),r=await x.create(),input=x.reviewInput(r.id);x.source.active='isolated-active';const before=x.api.round.events(r.id);
 await assert.rejects(x.call(input),/已有|运行|任务/);x.source.active=null;assert.equal(x.store.db.prepare('SELECT COUNT(*) n FROM publishing_content_reviews').get().n,0);assert.deepEqual(x.api.round.events(r.id),before);assert.equal(x.source.submits,0);
});

test('explicit UNREVIEWED isolates only its item; a later PASS restores a visible manual resume without dispatch',async t=>{
 const x=await fixture(t),r=await x.create();await x.call(x.reviewInput(r.id,['UNREVIEWED','PASS','PASS']));let v=x.api.round.view(r.id);assert.equal(v.items[0].state,'WAITING_HUMAN');assert.equal(v.items[0].stage,'content-preflight');
 v=await startAndWait(x,r.id);assert.equal(v.gate,1);v=await startAndWait(x,r.id);assert.equal(v.state,'NEEDS_REVIEW');assert.equal(v.counts.NEW_SUCCESS,2);assert.equal(v.counts.WAITING_HUMAN,1);assert.equal(v.counts.PREFLIGHT_SKIPPED,0);assert.equal(v.items[0].runId,null);assert.equal(x.source.submits,2);
 x.restart();assert.equal(x.api.round.view(r.id).items[0].stage,'content-preflight');await x.call(x.reviewInput(r.id,['PASS',null,null]));v=x.api.round.view(r.id);
 assert.equal(v.items[0].state,'PENDING');assert.equal(v.items[0].runId,null);assert.equal(v.active,false);assert.equal(x.source.submits,2);assert.notEqual(v.state,'NEEDS_REVIEW','a now-executable item must expose the existing resume button, which NEEDS_REVIEW hides');
 v=await startAndWait(x,r.id);assert.equal(v.counts.NEW_SUCCESS,3);assert.equal(v.state,'COMPLETED');assert.equal(x.source.submits,3);
});

test('explicit UNREVIEWED on an old pre-submit run preserves identity and increments attempts only on later resumed PASS',async t=>{
 const x=await fixture(t,2),r=await x.create();await x.call(x.reviewInput(r.id));x.setOutcome('PAUSED');let v=await startAndWait(x,r.id);const first=v.items[0],before=x.store.run(first.runId);assert.equal(x.batch.store.item(first.queueId).attempts,1);
 await x.call(x.reviewInput(r.id,['UNREVIEWED',null]));assert.equal(x.api.round.view(r.id).items[0].stage,'content-preflight');assert.deepEqual(x.store.run(first.runId),before);x.setOutcome('VERIFIED');v=await startAndWait(x,r.id);assert.equal(v.counts.NEW_SUCCESS,1);assert.equal(x.source.submits,1);
 await x.call(x.reviewInput(r.id,['PASS',null]));assert.deepEqual(x.store.run(first.runId),before);assert.equal(x.batch.store.item(first.queueId).attempts,1);v=await startAndWait(x,r.id);assert.equal(v.counts.NEW_SUCCESS,2);assert.equal(v.items[0].runId,first.runId);assert.equal(x.batch.store.item(first.queueId).attempts,2);assert.equal(x.store.events(first.runId).filter(e=>e.kind==='SUBMIT_CLICKED').length,1);
});

test('content UNREVIEWED and PASS cannot hide CAPTCHA or acknowledge it',async t=>{
 const x=await fixture(t,2),r=await x.create();await x.call(x.reviewInput(r.id));x.setOutcome('PAUSED_CAPTCHA');let v=await startAndWait(x,r.id);assert.equal(v.state,'WAITING_HUMAN');const first=v.items[0],before=x.store.run(first.runId);
 for(const decision of ['UNREVIEWED','PASS']){await x.call(x.reviewInput(r.id,[decision,null]));v=x.api.round.view(r.id);assert.notEqual(v.items[0].stage,'content-preflight');assert.deepEqual(x.store.run(first.runId),before);assert.throws(()=>x.api.round.start(r.id),/人工/);}
 assert.equal(x.source.submits,0);assert.equal(x.batch.store.item(first.queueId).attempts,1);
});

test('degraded historical five gate rebuilds one then four accepted content results before any large batch',async t=>{
 const x=await fixture(t,12),r=await x.create();await x.call(x.reviewInput(r.id));x.api.round.onGate=async({gate})=>{if(gate===5)x.api.round.pause();};await startAndWait(x,r.id);let v=await startAndWait(x,r.id);assert.equal(v.gate,5);assert.equal(v.counts.NEW_SUCCESS,5);assert.equal(x.source.submits,5);
 await x.call(x.reviewInput(r.id,x.tasks.map((_,i)=>i<5?'MISMATCH':null)));v=x.api.round.view(r.id);assert.equal(v.counts.NEW_SUCCESS,0);assert.equal(v.counts.RESULT_UNKNOWN,5);assert.equal(v.gate,5);const before=x.api.round.events(r.id).filter(e=>e.kind==='INTERNAL_BATCH_CREATED').length;x.api.round.onGate=null;
 v=await startAndWait(x,r.id);const newBatches=x.api.round.events(r.id).filter(e=>e.kind==='INTERNAL_BATCH_CREATED').slice(before);assert.deepEqual(newBatches.map(e=>e.payload.count),[1,4,2]);assert.equal(v.counts.NEW_SUCCESS,7);assert.equal(v.counts.RESULT_UNKNOWN,5);assert.equal(v.state,'NEEDS_REVIEW');assert.equal(x.source.submits,12);assert.equal(x.api.round.events(r.id).filter(e=>e.kind==='GATE_FIVE_VERIFIED').length,1);assert.equal(new Set(x.store.list().map(run=>run.key)).size,12);
});

test('Travel OS catalogue projects content hold into products while retaining original ID and dedupe',async t=>{
 const x=await fixture(t,2),r=await x.create();await x.call(x.reviewInput(r.id));await startAndWait(x,r.id);await x.call(x.reviewInput(r.id,['MISMATCH',null]));
 const os=new TravelOsApi({product:async()=>x.api,shops:async()=>[shop],browser:x.owner,runtime:join(x.dir,'os')});x.closeWithFixture(()=>os.store.close());
 const {products}=await os.catalog(),held=products.find(p=>p.key===destinationKey(x.tasks[0]));
 assert.equal(held.state,'RESULT_UNKNOWN');assert.equal(held.contentHold,true);assert.match(held.stateLabel,/内容/);assert.equal(held.itemId,evidence(1).itemId);assert.equal(held.duplicateBlocked,true);
});

test('real overview projection retains content attention and excludes held SUCCEEDED queue from success progress',async t=>{
 const x=await fixture(t,2),r=await x.create();await x.call(x.reviewInput(r.id));await startAndWait(x,r.id);await x.call(x.reviewInput(r.id,['MISMATCH',null]));
 const os=new TravelOsApi({product:async()=>x.api,shops:async()=>[shop],browser:x.owner,runtime:join(x.dir,'os')});x.closeWithFixture(()=>os.store.close());os.materials=async()=>({});const snapshot=await os.snapshot();
 const code=await readFile(new URL('../travel-os.js',import.meta.url),'utf8'),start=code.indexOf('function overviewSummary(snapshot){'),end=code.indexOf('function overviewSnapshot()',start);assert(start>=0&&end>start);
 const evaluate=new Function('snapshot','const overviewGroups={failed:"failed",captcha:"captcha",unknown:"unknown",paused:"paused",data:"data"};'+code.slice(start,end)+';return overviewSummary(snapshot);');
 const summary=evaluate(snapshot);assert.equal(summary.verified,0);assert.equal(summary.attention.length,1);assert.equal(summary.attention[0].contentHold,true);assert.equal(summary.progress.success,0);assert.equal(summary.progress.processed,0);
});

// Execute the unchanged SourceWorkflow control flow with injected local adapters.
// Only platform/browser/screenshot adapters are replaced; no production session is used.
async function isolatedSourceModule(t,x,afterFill=()=>{}){
 const driverKey='__lyContentFixture_'+randomUUID().replaceAll('-',''),page={url:()=> 'https://item.upload.taobao.com/sell/v2/publish.htm'};
 const driver={page,fillCalls:0,submitCalls:0,afterFill};globalThis[driverKey]=driver;t.after(()=>delete globalThis[driverKey]);
 const publisher=pathToFileURL(join(x.dir,'isolated-publisher.mjs')).href;
 await writeFile(new URL(publisher),`const d=globalThis[${JSON.stringify(driverKey)}];export const MAPPING_VERSION='isolated';export const assertTaskFiles=async()=>{};export const assertPublishIdentity=async()=>{};export const newForm=()=>true;export const openTaskPage=async(context,task,checkpoint,guard,save,owned)=>{owned(d.page,{createdThisExecution:true});return d.page;};export const fillTask=async()=>{d.fillCalls++;await d.afterFill();return {};};export const verifyForm=async()=>{};export const submitTask=async(page,guard,clicked)=>{await guard();await clicked();d.submitCalls++;return '990099';};export const verifyResult=async()=>({itemId:'990099',status:'出售中',rowText:'isolated',screenshot:'isolated.png',verifiedAt:new Date().toISOString()});`);
 const dataModule=source=>'data:text/javascript,'+encodeURIComponent(source),sourceUrl=new URL('../source-workflow.mjs',import.meta.url);
 const replacements={'taobao-publisher.mjs':publisher,'browser-environment.mjs':dataModule(`export const PROJECT_ROOT=${JSON.stringify(x.dir)};export const visibleChallenge=async()=>false;`),'task-screenshot.mjs':dataModule(`export const captureTaskScreenshot=async()=>({screenshot:'isolated.png'});`),'publishing-pages.mjs':dataModule('export const closeVerifiedOwnedPage=async()=>({closed:false});')};
 const code=(await readFile(sourceUrl,'utf8')).replace(/from\s+(['"])(\.\/[^'"]+)\1/g,(all,quote,path)=>'from '+JSON.stringify(replacements[path.slice(2)]||new URL(path,sourceUrl).href));
 const {SourceWorkflow:ActualSource}=await import(dataModule(code+'\n// '+driverKey));
 const owner={sessions:new Map([[shop.id,{context:{pages:()=>[]}}]]),status:async()=>({running:true,loggedIn:true,loginState:'LOGGED_IN'})};
 return {flow:new ActualSource(owner,{store:x.store,runtime:x.dir,artifacts:join(x.dir,'actual-source')}),driver};
}

test('real SourceWorkflow rejects LIVE without installed content hook and persists typed reason',async t=>{
 const x=await fixture(t,1),{flow,driver}=await isolatedSourceModule(t,x),task=x.tasks[0],run=x.store.create(x.importId,task,'LIVE','SOURCE',{reviewed:true,taskHash:digest(task)});flow.launch(run.id,shop);await flow.pending;
 assert.equal(x.store.run(run.id).state,'PAUSED');assert.equal(x.store.run(run.id).checkpoint.errorCode,'CONTENT_REVIEW_REQUIRED');assert.equal(driver.fillCalls,0);assert.equal(driver.submitCalls,0);assert.equal(x.store.events(run.id).some(e=>e.kind==='SUBMITTING'),false);
});

test('real SourceWorkflow repeats content gate after filling and rejects a revoked approval before submit intent',async t=>{
 const x=await fixture(t,1),r=await x.create();await x.call(x.reviewInput(r.id));const item=x.api.round.items(r.id)[0];
 const {flow,driver}=await isolatedSourceModule(t,x,()=>{const review=x.api.contentReviews.get(r.id,item.key);x.api.contentReviews.save([{...review,decision:'MISMATCH',observedText:'revoked during isolated fill'}]);});
 let checks=0;flow.assertContentForLive=async task=>{checks++;const review=x.api.round.assertContentForTask(task,r.id);await x.api.contentReviews.verifyEvidence(review,task);return review;};
 const run=x.store.create(x.importId,x.tasks[0],'LIVE','SOURCE',{reviewed:true,taskHash:digest(x.tasks[0])});flow.launch(run.id,shop);await flow.pending;
 assert.equal(checks,2);assert.equal(driver.fillCalls,1);assert.equal(driver.submitCalls,0);assert.equal(x.store.run(run.id).state,'PAUSED');assert.equal(x.store.run(run.id).checkpoint.errorCode,'CONTENT_MISMATCH');assert.equal(x.store.events(run.id).some(e=>e.kind==='SUBMITTING'),false);
});

test('real SourceWorkflow valid content is checked twice and preserves exactly one submit intent and click',async t=>{
 const x=await fixture(t,1),r=await x.create();await x.call(x.reviewInput(r.id));const {flow,driver}=await isolatedSourceModule(t,x);let checks=0;flow.assertContentForLive=async task=>{checks++;const review=x.api.round.assertContentForTask(task,r.id);await x.api.contentReviews.verifyEvidence(review,task);return review;};
 const run=x.store.create(x.importId,x.tasks[0],'LIVE','SOURCE',{reviewed:true,taskHash:digest(x.tasks[0])});flow.launch(run.id,shop);await flow.pending;assert.equal(x.store.run(run.id).state,'VERIFIED');assert.equal(checks,2);assert.equal(driver.submitCalls,1);assert.equal(x.store.events(run.id).filter(e=>e.kind==='SUBMITTING').length,1);assert.equal(x.store.events(run.id).filter(e=>e.kind==='SUBMIT_CLICKED').length,1);
});
