import test from 'node:test';
import assert from 'node:assert/strict';
import {taskGroup,taskListView,materialReadiness,materialCount,retryPlan,failureSummary,requestId} from '../task-view-model.mjs';
test('display state governs grouping, including dry run and uncertain results',()=>{
 assert.equal(taskGroup({state:'SUCCEEDED',displayState:'DRY_RUN_COMPLETE'}),'done');
 assert.equal(taskGroup({state:'RUNNING',displayState:'RESULT_UNKNOWN'}),'attention');
 assert.equal(taskGroup({state:'PAUSED_CAPTCHA'}),'attention');
 assert.equal(taskGroup({state:'SUBMITTING'}),'running');
 assert.equal(taskGroup({state:'QUEUED'}),'waiting');
});
test('search and category intersect; paging clamps; category counts remain global',()=>{
 const items=Array.from({length:23},(_,i)=>({name:i<21?'东京':'巴黎',title:'旅行 '+i,state:i===22?'FAILED':'SUCCEEDED'}));
 const result=taskListView(items,{search:'东京',filter:'done',page:3});
 assert.equal(result.total,21);assert.equal(result.rows.length,1);assert.equal(result.counts.all,23);assert.equal(result.counts.attention,1);
 assert.equal(taskListView(items,{search:'无匹配',page:3}).page,1);
 assert.equal(taskListView(items,{search:'旅行 22',filter:'done'}).total,0);
});
test('material availability is not readiness; quantity and import validation both matter',()=>{
 const products=[{counts:{main:1,secondary:4,details:2},issues:[]},{counts:{main:2,secondary:3,details:0},issues:[]},{counts:{main:1,secondary:4,details:1},issues:['目的地不一致']}];
 for(const group of ['main','secondary','details'])assert.deepEqual(materialReadiness(products,group),{ready:1,total:3,percent:33});
 assert.deepEqual(materialReadiness([],'main'),{ready:0,total:0,percent:0});
});

test('material totals sum references, including products with issues and shared files',()=>{
 const products=[{counts:{main:1,secondary:4,details:8},issues:[]},{counts:{main:2,secondary:3,details:6},issues:['待核对']}];
 const before=JSON.stringify(products);
 assert.deepEqual(['main','secondary','details'].map(g=>materialCount(products,g)),[3,7,14]);
 assert.equal(materialCount(Array(700).fill(products[0]),'secondary'),2800);
 assert.equal(JSON.stringify(products),before);
});

test('empty libraries and missing counts stay zero without NaN or negative totals',()=>{
 assert.equal(materialCount([],'main'),0);
 assert.equal(materialCount([{}, {counts:{main:-1}}, {counts:{main:NaN}}, {counts:{main:1.5}}, {counts:{main:2}}],'main'),2);
});

test('retry scope excludes successful and exhausted items and blocks unsafe batches',()=>{
 const failed={id:'failed',state:'FAILED',displayState:'FAILED',attempts:1,maxAttempts:3};
 const items=[failed,{...failed,id:'exhausted',attempts:3},{...failed,id:'ok',state:'SUCCEEDED',displayState:'VERIFIED'}];
 assert.deepEqual(retryPlan({items},false).eligible.map(x=>x.id),['failed']);
 assert.equal(retryPlan({items},false).allowed,true);assert.equal(retryPlan({items},true).allowed,false);
 for(const state of ['RESULT_UNKNOWN','SUBMITTING','PAUSED_CAPTCHA','RUNNING','WAITING_HUMAN','PENDING','RETRY'])assert.equal(retryPlan({items:[failed,{id:'blocked',state}]},false).allowed,false,state);
 assert.equal(retryPlan({items:[{...failed,runState:'RESULT_UNKNOWN',displayState:undefined}]},false).allowed,false);
 assert.equal(retryPlan({items:[{...failed,attempts:3}]},false).allowed,false);
 assert.equal(retryPlan(null,false).allowed,false);
 assert.match(failureSummary({reason:'locator #sucai-tu-upload Timeout 30000ms'}),/上传按钮/);
 assert.match(failureSummary({reason:'unknown original error'}),/待人工确认/);
});

test('LAN request IDs work without randomUUID and retain UUID v4 format and uniqueness',()=>{
 const provider={getRandomValues:array=>globalThis.crypto.getRandomValues(array)};
 const ids=new Set(Array.from({length:100},()=>requestId(provider)));
 assert.equal(ids.size,100);for(const id of ids)assert.match(id,/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
});
