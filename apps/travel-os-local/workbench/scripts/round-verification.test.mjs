import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {RoundVerification} from '../round-verification.mjs';
import {destinationKey} from '../source-store.mjs';
const make=(country,city)=>({shopId:'fixture',listing:{type:city?'city':'country',country,city:city||null,title:(city||country)+'定制服务'},business:{shop_name:'fixture',price_cny:20,inventory:999999}});
async function fixture(t){
 const dir=await mkdtemp(join(tmpdir(),'ly-round-verify-'));t.after(()=>rm(dir,{recursive:true,force:true}));const tasks=[make('日本','东京'),make('法国','巴黎'),make('英国','伦敦')];
 let rows=[{itemId:'100001',title:tasks[1].listing.title,status:'出售中'}],freshRows=[],options;const calls=[];
 const table={search:async(q={})=>{calls.push(q);const records=q.itemId?rows.filter(r=>r.itemId===q.itemId):q.title?freshRows:rows;return {records,total:records.length,at:new Date().toISOString()};}};
 const round={id:'fixed',authorization:{}};
 const makeVerifier=()=>new RoundVerification({context:()=>({}),guard:async()=>{},round:()=>({round,items:tasks.map(task=>({task}))}),artifacts:dir,tableFactory:async()=>table,evidence:async(table,row,task,path,o)=>{options=o;return {itemId:row.itemId,status:row.status};}});
 const verifier=makeVerifier();
 return {tasks,round,calls,dir,makeVerifier,verifier,args:task=>({task,roundId:'fixed',key:destinationKey(task)}),setRows:x=>rows=x,setFresh:x=>freshRows=x,options:()=>options};
}
test('absence needs complete inventory identity coverage and fresh destination query',async t=>{
 const f=await fixture(t);assert.equal(await f.verifier.verify(f.args(f.tasks[0])),null);assert.deepEqual(f.calls,[{}, {title:'东京'}]);
 f.verifier.reset();f.setRows([{itemId:'199999',title:'无法对应的旧商品',status:'出售中'}]);await assert.rejects(f.verifier.verify(f.args(f.tasks[0])),e=>e.code==='INVENTORY_IDENTITY_UNRESOLVED');
});
test('user-approved round duplicate override bypasses only destination inventory lookup; known item IDs still reconcile',async t=>{
 const f=await fixture(t),task=f.tasks[0],key=destinationKey(task);f.round.manifest_hash='manifest';f.round.policies={'ignore-destination-duplicates':{enabled:true,scope:'THIS_ROUND_ONLY',manifestHash:'manifest',shop:task.shopId}};
 assert.equal(await f.verifier.verify({...f.args(task),roundId:'fixed',key}),null);assert.deepEqual(f.calls,[]);f.setRows([{itemId:'100001',title:task.listing.title,status:'出售中'}]);
 const known={...f.args(task),itemId:'100001',run:{state:'RESULT_UNKNOWN'}};assert.deepEqual(await f.verifier.verify(known),{itemId:'100001',status:'出售中'});assert.deepEqual(f.calls,[{itemId:'100001'}]);
});
test('freshly discovered geographic candidate is isolated without publication approval',async t=>{
 const f=await fixture(t);f.setFresh([{itemId:'100999',title:'日本东京包车导游旅行服务',status:'出售中'}]);
 await assert.rejects(f.verifier.verify(f.args(f.tasks[0])),e=>e.code==='EXISTENCE_AMBIGUOUS'&&e.isolated===true);
});
test('exact sourced title gets fresh ID check; stale disappearance blocks',async t=>{
 const f=await fixture(t),args=f.args(f.tasks[1]);assert.equal((await f.verifier.verify(args)).itemId,'100001');assert.deepEqual(f.calls.at(-1),{itemId:'100001'});
 f.setRows([]);await assert.rejects(f.verifier.verify(args),e=>e.code==='RESULT_UNKNOWN');
});
test('historical ID lookup is strict on title and unknown-submit recovery checks new business values',async t=>{
 const f=await fixture(t),args={...f.args(f.tasks[1]),itemId:'100001'};
 await f.verifier.verify({...args,run:{state:'VERIFIED'}});assert.equal(f.options().newSubmission,false);
 await f.verifier.verify({...args,run:{state:'RESULT_UNKNOWN'}});assert.equal(f.options().newSubmission,true);
 await f.verifier.verify({...args,run:{state:'SUBMITTING'}});assert.equal(f.options().newSubmission,true);
 f.setRows([{itemId:'100001',title:'不同商品',status:'出售中'}]);await assert.rejects(f.verifier.verify(args),e=>e.code==='RESULT_UNKNOWN');
});

test('unknown submission without captured ID still requires strict new-publication verification',async t=>{
 const f=await fixture(t);const args={...f.args(f.tasks[1]),run:{state:'RESULT_UNKNOWN'}};
 await f.verifier.verify(args);assert.equal(f.options().newSubmission,true);
 f.verifier.evidence=async(table,row,task,dir,options)=>{assert.equal(options.newSubmission,true);throw Error('后台商品价格与提交快照不符');};
 await assert.rejects(f.verifier.verify(args),/价格与提交快照不符/);
});

test('new verifier and explicit reset fetch fresh complete inventory before accepting absence',async t=>{
 const f=await fixture(t);assert.equal(await f.verifier.verify(f.args(f.tasks[0])),null);
 const before=f.calls.length;f.setRows([{itemId:'900001',title:'无法解释的新商品',status:'出售中'}]);
 const restarted=f.makeVerifier();assert.equal(restarted.inventory,null);assert.equal(restarted.verified,0);
 await assert.rejects(restarted.verify(f.args(f.tasks[0])),e=>e.code==='INVENTORY_IDENTITY_UNRESOLVED');assert.deepEqual(f.calls.slice(before),[{}]);
 const again=f.calls.length;f.verifier.reset();await assert.rejects(f.verifier.verify(f.args(f.tasks[0])),e=>e.code==='INVENTORY_IDENTITY_UNRESOLVED');assert.deepEqual(f.calls.slice(again),[{}]);
});

test('sourced lexical-only false candidate proceeds only after full inventory and fresh query, retaining evidence rows',async t=>{
 const f=await fixture(t),india={...make('印度'),source:{sha256:'a'.repeat(64)}},indonesia={...make('印度尼西亚'),source:{sha256:'b'.repeat(64)}};
 f.tasks.splice(0,f.tasks.length,india,indonesia);
 const foreign={itemId:'800001',title:'印度尼西亚包车中文导游服务',status:'出售中'};f.setRows([foreign]);f.setFresh([foreign]);
 assert.equal(await f.verifier.verify(f.args(india)),null);assert.deepEqual(f.calls,[{},{title:'印度'}]);
 const proof=JSON.parse(await readFile(join(f.dir,'fixed','verification',destinationKey(india),'duplicate-check.json'),'utf8'));
 assert.equal(proof.match.status,'absent');assert.equal(proof.match.exclusions.length,1);assert.equal(proof.match.exclusions[0].title,foreign.title);assert.equal(proof.fullInventoryCount,1);assert.equal(proof.fresh[0].total,1);
 const inventory=JSON.parse(await readFile(join(f.dir,'fixed','inventory-check.json'),'utf8'));assert.deepEqual(inventory.rows,[foreign]);assert.equal(inventory.audit.coverageComplete,true);assert.equal(inventory.audit.rows[0].exclusions.length,1);
});

test('fresh same-destination old title after lexical exclusion remains isolated, unexplained rows and known IDs still block',async t=>{
 const f=await fixture(t),india={...make('印度'),source:{sha256:'a'.repeat(64)}},indonesia={...make('印度尼西亚'),source:{sha256:'b'.repeat(64)}};f.tasks.splice(0,f.tasks.length,india,indonesia);
 const foreign={itemId:'800001',title:'印度尼西亚包车服务',status:'出售中'},actual={itemId:'800002',title:'印度全境之前的旧标题包车服务',status:'出售中'};
 f.setRows([foreign]);f.setFresh([foreign,actual]);await assert.rejects(f.verifier.verify(f.args(india)),e=>e.code==='EXISTENCE_AMBIGUOUS'&&e.isolated===true);
 const proof=JSON.parse(await readFile(join(f.dir,'fixed','verification',destinationKey(india),'duplicate-check.json'),'utf8'));assert.equal(proof.match.exclusions.length,1);assert.deepEqual(proof.match.candidates.map(x=>x.itemId),['800002']);
 f.verifier.reset();f.setRows([foreign,{itemId:'800003',title:'无法解释的旧商品',status:'出售中'}]);f.setFresh([foreign]);await assert.rejects(f.verifier.verify(f.args(india)),e=>e.code==='INVENTORY_IDENTITY_UNRESOLVED');
 f.setRows([foreign]);await assert.rejects(f.verifier.verify({...f.args(india),itemId:foreign.itemId}),e=>e.code==='RESULT_UNKNOWN');
});
