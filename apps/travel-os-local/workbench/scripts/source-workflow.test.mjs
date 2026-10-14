import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SourceStore, digest } from '../source-store.mjs';
import { SourceWorkflow } from '../source-workflow.mjs';
import { assertTaskFiles, newForm } from '../taobao-publisher.mjs';

const task=()=>({shopId:'wuzhou-changyou',priority:4,source:{},listing:{type:'country',country:'西班牙',city:null,title:'西班牙服务'},assets:{main:[],secondary:[],details:[]},business:{},adapterIssues:[]});
async function fixture(t){const dir=await mkdtemp(join(tmpdir(),'ly-source-test-'));const store=new SourceStore(join(dir,'state.sqlite'));t.after(async()=>{store.close();await rm(dir,{recursive:true,force:true});});return {dir,store};}
function create(store,overrides={}){const item={...task(),...overrides};return store.create('batch',item,'DRY_RUN','SOURCE',{reviewed:true,taskHash:digest(item)});}
test('same destination remains reserved across imports and changed workbook/title',async t=>{const {store}=await fixture(t);create(store);assert.throws(()=>create(store,{listing:{...task().listing,title:'新标题'},source:{sha256:'different'}}),/已有任务/);});
test('wrong image and stale preview never create an executable task',async t=>{const {store}=await fixture(t);assert.throws(()=>create(store,{adapterIssues:['错图']}),/错图/);assert.throws(()=>store.create('b',task(),'LIVE','SOURCE',{reviewed:true,taskHash:'old'}),/预览/);assert.equal(store.list().length,0);});
test('historical success prevents repeat publication with a fresh database',async t=>{const {store}=await fixture(t);store.history(task(),{itemId:'123',historical:true});assert.throws(()=>create(store),/禁止重复/);});

test('existing verified history blocks legacy resume of an old paused task without mutating or launching',async t=>{
 const {store,dir}=await fixture(t);const flow=new SourceWorkflow({}, {store,runtime:dir,artifacts:join(dir,'artifacts')}),r=create(store);
 store.move(r.id,'RUNNING');store.move(r.id,'PAUSED','old pre-submit failure');
 store.history(r.task,{itemId:'123',status:'出售中',screenshot:'proof.png',rowText:'backend verified'});
 let launches=0;flow.launch=()=>launches++;const before=store.events(r.id);
 await assert.rejects(flow.resume({id:r.id},{id:r.task.shopId}),/已有成功核验记录/);
 assert.equal(launches,0);assert.equal(store.run(r.id).state,'PAUSED');assert.deepEqual(store.events(r.id),before);
});

test('verified history appearing after queuing blocks direct execution before browser access',async t=>{
 const {store,dir}=await fixture(t);let browserReads=0;const flow=new SourceWorkflow({status:async()=>{browserReads++;throw Error('must not access browser');}}, {store,runtime:dir,artifacts:join(dir,'artifacts')}),r=create(store);
 store.history(r.task,{itemId:'123',status:'出售中',screenshot:'proof.png',rowText:'backend verified'});
 flow.launch(r.id,{id:r.task.shopId});await flow.pending;
 assert.equal(browserReads,0);assert.equal(store.run(r.id).state,'PAUSED');assert.match(store.run(r.id).reason,/已有成功核验记录/);
 assert(store.events(r.id).every(e=>!['RUNNING','SUBMITTING','SUBMIT_CLICKED'].includes(e.kind)));
});
test('crash after submit intent becomes result unknown and cannot resume as filling',async t=>{const {store}=await fixture(t);const r=create(store);store.move(r.id,'RUNNING');store.move(r.id,'SUBMITTING');store.recover();assert.equal(store.run(r.id).state,'RESULT_UNKNOWN');assert.throws(()=>store.move(r.id,'QUEUED'),/禁止状态/);assert.throws(()=>store.move(r.id,'VERIFIED','',{itemId:'1'}),/缺少平台/);});
test('restart pauses pre-submit work and preserves checkpoint and events',async t=>{const {store,dir}=await fixture(t);const r=create(store);store.move(r.id,'RUNNING');store.checkpoint(r.id,{step:'title',formUrl:'https://example.test'});store.recover();assert.equal(store.run(r.id).state,'PAUSED');assert.equal(store.run(r.id).checkpoint.step,'title');const second=new SourceStore(join(dir,'state.sqlite'));assert.equal(second.run(r.id).checkpoint.step,'title');second.close();});
test('captcha pause persists without navigating or submitting and resume rechecks it',async t=>{const {store,dir}=await fixture(t);const owner={status:async()=>({running:true,loggedIn:false,loginState:'PAUSED_CAPTCHA'}),sessions:new Map()};const flow=new SourceWorkflow(owner,{store,runtime:dir,artifacts:join(dir,'artifacts')});const r=create(store);flow.launch(r.id,{id:'wuzhou-changyou'});await flow.pending;assert.equal(store.run(r.id).state,'PAUSED_CAPTCHA');assert.equal(store.run(r.id).checkpoint.reason,'PAUSED_CAPTCHA');await flow.resume({id:r.id},{id:'wuzhou-changyou'});await flow.pending;assert.equal(store.run(r.id).state,'PAUSED_CAPTCHA');assert(store.events(r.id).every(e=>e.kind!=='SUBMITTING'));});
test('uploads isolate paths, reject traversal and duplicate overwrite',async t=>{const {store,dir}=await fixture(t);const flow=new SourceWorkflow({}, {store,runtime:dir});const {id}=await flow.stage({begin:true});await assert.rejects(flow.stage({id,name:'../secret.png',data:'YQ=='}),/路径/);await assert.rejects(flow.stage({id,name:'Cookies',data:'YQ=='}),/路径/);const staged=await flow.stage({id,name:'images/test.png',data:'YQ=='});assert.equal(await readFile(staged.path,'utf8'),'a');await assert.rejects(flow.stage({id,name:'images/test.png',data:'Yg=='}),/EEXIST/);});
test('source tampering halts before any page operation',async t=>{const {dir}=await fixture(t);const p=join(dir,'source.xlsx');await writeFile(p,'changed');await assert.rejects(assertTaskFiles({...task(),source:{workbook:p,sha256:digest('original')}}),/SOURCE_OR_ASSET_CHANGED/);});
test('new page guard refuses existing and copied item URLs',()=>{const p=url=>({url:()=>url});assert(newForm(p('https://item.upload.taobao.com/sell/v2/publish.htm')));for(const key of ['itemId','item_num_id','copyItem'])assert(!newForm(p('https://item.upload.taobao.com/sell/v2/publish.htm?'+key+'=123')));assert(!newForm(p('https://attacker.test/sell/v2/publish.htm')));});

test('real source workflow persists typed errors for bounded coordinator recovery and clears stale codes',async t=>{
 const {store,dir}=await fixture(t);let code='SAFE_RETRY_PAGE_LOAD';
 const owner={status:async()=>{throw Object.assign(Error('isolated browser transport failure'),{code});},sessions:new Map()};
 const flow=new SourceWorkflow(owner,{store,runtime:dir,artifacts:join(dir,'artifacts')}),r=create(store);
 flow.launch(r.id,{id:'wuzhou-changyou'});await flow.pending;
 assert.equal(store.run(r.id).state,'PAUSED');assert.equal(store.run(r.id).checkpoint.errorCode,code);
 code='untrusted arbitrary content';store.move(r.id,'QUEUED');flow.launch(r.id,{id:'wuzhou-changyou'});await flow.pending;
 assert.equal(store.run(r.id).checkpoint.errorCode,null);assert(store.events(r.id).every(e=>e.kind!=='SUBMITTING'));
});
