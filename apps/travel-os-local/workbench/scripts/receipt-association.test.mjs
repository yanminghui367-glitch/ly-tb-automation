import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {setup} from './skip-independent-fixture.mjs';
import {ResultReconciliation,inspectExistingListing} from '../result-reconciliation.mjs';

async function fixture(t){
 const f=await setup(t);f.store.db.exec('CREATE TABLE product_actions(id TEXT PRIMARY KEY,action TEXT,target TEXT,at TEXT,result TEXT)');await f.pause();const o=f.round,x=o.item(f.r.id,f.scope().key),run=f.store.run(x.run_id);
 f.store.move(run.id,'QUEUED');f.store.move(run.id,'RUNNING');f.store.move(run.id,'SUBMITTING');f.store.move(run.id,'RESULT_UNKNOWN','click action done; navigation timeout');
 o.update(f.r.id,x.key,{state:'RESULT_UNKNOWN',submitted:0,submission_uncertain:1,failure_stage:'submit-once'});o.state(f.r.id,'RESULT_UNKNOWN','缺少原任务实际提交点击时间，保持待核验');

 const api={round:o,source:f.flow,batch:f.batch,shop:o.shop,owner:{sessions:new Map([[o.shop.id,{context:{}}]]),status:async()=>({running:true,loggedIn:true,loginState:'LOGGED_IN'})},integrity:async()=>({ok:true})};
 let calls=0;
 const action=new ResultReconciliation(api,async({dir,itemId,guard})=>{calls++;await guard();await mkdir(dir,{recursive:true});const screenshot=join(dir,'proof.png');await writeFile(screenshot,Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1sAAAAASUVORK5CYII=','base64'));return {itemId,screenshot,rowText:'synthetic verified title',status:'出售中',createdAt:'2026-10-22 21:36:50',verifiedAt:new Date().toISOString(),observed:{price:20,inventory:999999},differences:[]};});
 const req={...f.scope(),expectedRevision:f.action.read(f.scope()).revision,id:run.id,itemId:'1095269536185',confirmed:true,confirmedBy:'隔离核验员',reason:'核对原提交成功截图',requestId:randomUUID()};
 return {...f,api,action,req,run,x,calls:()=>calls};
}

test('missing-click association verifies original round/run/queue atomically, preserves budget and denominator',async t=>{
 const f=await fixture(t),o=f.round,before=o.view(f.r.id),queue=f.batch.store.item(f.x.queue_id),other=o.item(f.r.id,f.scope(2).key),launches=f.flow.launches.length;
 const result=await f.action.associate(f.req);assert.equal(result.accepted,true);assert.equal(result.batchContinued,false);
 assert.equal(f.store.run(f.run.id).state,'VERIFIED');assert.equal(f.batch.store.item(f.x.queue_id).state,'SUCCEEDED');assert.equal(o.item(f.r.id,f.x.key).state,'NEW_SUCCESS');
 const after=o.view(f.r.id);assert.equal(after.window.total,before.window.total);assert.equal(after.window.counts.NEW_SUCCESS,1);assert.equal(after.window.ended,1);assert.equal(after.window.submitted,1);assert.equal(o.item(f.r.id,f.x.key).submitted,1);assert.equal(o.item(f.r.id,f.x.key).submission_uncertain,0);assert.equal(after.state,'PAUSED');assert.deepEqual(o.item(f.r.id,f.scope(2).key),other);
 const q=f.batch.store.item(f.x.queue_id);for(const key of ['attempts','max_attempts','extra_attempts'])assert.equal(q[key],queue[key]);
 assert.equal(f.flow.submits,0);assert.equal(f.flow.launches.length,launches);assert.equal(f.store.events(f.run.id).filter(e=>e.kind==='SUBMIT_CLICKED').length,0);
 const audit=f.store.events(f.run.id).find(e=>e.kind==='RESULT_RECONCILED');assert.equal(audit.payload.actor.name,'隔离核验员');assert.equal(audit.payload.originalRunId,f.run.id);assert.equal(audit.payload.windowId,f.w.id);
 assert.equal((await f.action.associate(f.req)).replayed,true);assert.equal(f.calls(),1);
 await assert.rejects(f.action.associate({...f.req,reason:'changed'}),/请求编号/);
});

for(const kind of ['queue','round','window','kernel','run','pause'])test('association rejects concurrent '+kind+' change without partial success',async t=>{
 const f=await fixture(t),inspect=f.action.inspect;
 f.action.inspect=async input=>{const r=await inspect(input);
 if(kind==='queue')f.store.db.prepare('UPDATE batch_items SET max_attempts=max_attempts+1 WHERE id=?').run(f.x.queue_id);
 if(kind==='round')f.round.event(f.r.id,null,'CHANGED',{});
 if(kind==='window')f.store.db.prepare('UPDATE round_windows SET updated=? WHERE id=?').run(new Date(Date.now()+1000).toISOString(),f.w.id);
 if(kind==='run')f.store.checkpoint(f.run.id,{changed:true});
 if(kind==='kernel')f.api.integrity=async()=>({ok:false});
 if(kind==='pause')f.flow.stop=true;
 return r;};
 await assert.rejects(f.action.associate(f.req));assert.equal(f.store.run(f.run.id).state,'RESULT_UNKNOWN');assert.equal(f.round.item(f.r.id,f.x.key).state,'RESULT_UNKNOWN');assert.equal(f.store.completed(f.x.task),null);assert.equal(f.flow.submits,0);
});

test('round projection failure rolls back run/history/queue and replay log',async t=>{
 const f=await fixture(t),queue=f.batch.store.item(f.x.queue_id);f.round.update=()=>{throw Error('projection write failed');};
 await assert.rejects(f.action.associate(f.req),/projection/);assert.equal(f.store.run(f.run.id).state,'RESULT_UNKNOWN');assert.deepEqual(f.batch.store.item(f.x.queue_id),queue);assert.equal(f.store.completed(f.x.task),null);assert.equal(f.store.db.prepare('SELECT count(*) n FROM product_actions').get().n,0);
});

test('closed window and stale scope reject before backend lookup',async t=>{
 const f=await fixture(t);await assert.rejects(f.action.associate({...f.req,expectedRevision:'stale'}),/已变化/);assert.equal(f.calls(),0);
 f.store.db.prepare("UPDATE round_windows SET state='STOPPED',finished=? WHERE id=?").run(new Date().toISOString(),f.w.id);
 await assert.rejects(f.action.associate(f.req),/窗口已结束/);assert.equal(f.calls(),0);
});

const task={shopId:'fixture',listing:{title:'休斯敦美国定制行程'},business:{shop_name:'隔离店',price_cny:20,inventory:999999}};
const itemId='1095269536185',window={from:Date.parse('2026-10-22T13:32:00Z'),to:Date.parse('2026-10-22T13:37:00Z')};
const row=()=>({itemId,title:task.listing.title,status:'出售中',cells:[{label:'价格',text:'20.00'},{label:'库存',text:'999999'},{label:'创建时间',text:'2026-10-22 21:36:50'}]});
for(const kind of ['success','title','price','inventory','time','status','id','duplicate'])test('official ID adapter '+kind,async()=>{
 const r=row();let rows=[r];if(kind==='title')r.title+='other';if(kind==='price')r.cells[0].text='21';if(kind==='inventory')r.cells[1].text='999998';if(kind==='time')r.cells[2].text='2026-10-21 21:36:50';if(kind==='status')r.status='仓库中';if(kind==='id')r.itemId='999999999';if(kind==='duplicate')rows.push({...r});
 let queries=0,evidence=0;const input={context:{},task,itemId,target:'SOURCE',dir:'unused',window,guard:async()=>{},tableFactory:async()=>({page:{},search:async query=>{assert.deepEqual(query,{itemId});queries++;return {records:rows};}}),evidence:async()=>{evidence++;return {itemId,status:r.status};}};
 if(kind==='success'){const v=await inspectExistingListing(input);assert.equal(v.itemId,itemId);assert.equal(v.createdAt,'2026-10-22 21:36:50');assert.equal(evidence,1);}else{await assert.rejects(inspectExistingListing(input));assert.equal(evidence,0);}assert.equal(queries,1);
});
