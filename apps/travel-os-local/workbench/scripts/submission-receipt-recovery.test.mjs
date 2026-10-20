import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {submitTask} from '../taobao-publisher.mjs';
import {readSubmittedListing,submissionLookupWindow,assertUnclaimedSubmissionId} from '../result-reconciliation.mjs';
import {SourceStore,digest} from '../source-store.mjs';

const form='https://item.upload.taobao.com/sell/v2/publish.htm?catId=50014945',id='1088040871383';
const success='https://item.upload.taobao.com/sell/v2/success.htm?primaryId='+id+'&isEdit=false';
const task={shopId:'receipt-fixture',adapterIssues:[],listing:{type:'country',country:'洪都拉斯',title:'洪都拉斯接送机旅行定制行程'},business:{shop_name:'隔离店铺',price_cny:20,inventory:999999,listing_time:'立即上架'}};
const window={from:Date.parse('2026-10-18T14:00:00Z'),to:Date.parse('2026-10-18T14:02:00Z'),clickedAt:Date.parse('2026-10-18T14:00:20Z'),observedThrough:Date.parse('2026-10-18T14:01:21Z')};
const row=()=>({itemId:id,title:task.listing.title,status:'出售中',text:task.listing.title+'\nID: '+id+'\n出售中',cells:[{label:'价格',text:'￥20.00'},{label:'库存',text:'999,999'},{label:'创建时间',text:'2026-10-18 22:01:00'}]});
function pageFixture(receiptAfter=Infinity){let clicks=0,clickedAt=Infinity;return {url:()=>Date.now()-clickedAt>=receiptAfter?success:form,
 getByRole:()=>({click:async()=>{clicks++;clickedAt=Date.now();}}),locator:()=>({innerText:async()=>`商品提交成功\n商品ID：${id}`}),clicks:()=>clicks};}
async function fixture(t,rows=[row()]){
 const dir=await mkdtemp(join(tmpdir(),'ly-receipt-recovery-'));t.after(async()=>{assert.equal(join(dir,'..'),tmpdir());await rm(dir,{recursive:true,force:true});});
 let queries=0,evidenceCalls=0;const claimed=[];
 const table={page:{screenshot:async({path})=>writeFile(path,Buffer.from([137,80,78,71,13,10,26,10,0]))},guard:async()=>{},search:async query=>{
  assert.deepEqual(query,{title:task.listing.title});queries++;return {records:typeof rows==='function'?rows(queries):rows};}};
 const options={context:{},task,target:'SOURCE',dir,guard:async()=>{},window,interval:0,tableFactory:async(_c,_t,_guard,limits)=>{
  assert.equal(_t,task);assert(limits.deadline>Date.now());table.guard=()=>_guard(table.page);return table;},assertUnused:async value=>claimed.push(value)};
 return {options,table,queries:()=>queries,evidenceCalls:()=>evidenceCalls,claimed};
}
test('acceptance 1: ID arrives after 40 real seconds; default 60-second receipt wait succeeds with exactly one click',{timeout:65000},async()=>{
 const p=pageFixture(40000);let backend=0,recorded=0;const started=Date.now();
 assert.equal(await submitTask(p,async()=>{},async()=>recorded++,{readBackend:async()=>{backend++;throw Error('must not need backend');}}),id);
 assert(Date.now()-started>=40000);assert(Date.now()-started<60000);assert.equal(p.clicks(),1);assert.equal(recorded,1);assert.equal(backend,0);
});
test('same-minute product created after the original unknown cutoff is never claimed',async t=>{
 const r=row();r.cells[2].text='2026-10-18 22:01:40';const f=await fixture(t,[r]);await assert.rejects(readSubmittedListing(f.options),/观察区间/);assert.equal(f.claimed.length,0);
});
test('acceptance 2: no receipt, one exact recent backend record becomes the original submission, one click',async t=>{
 const f=await fixture(t),p=pageFixture();let backend=0;
 const found=await submitTask(p,async()=>{},async()=>{},{timeout:20,readBackend:async()=>{backend++;return (await readSubmittedListing(f.options)).itemId;}});
 assert.equal(found,id);assert.equal(p.clicks(),1);assert.equal(backend,1);assert.equal(f.queries(),1);assert.deepEqual(f.claimed,[id,id]);
});
test('acceptance 3: backend absent after three searches remains RESULT_UNKNOWN, one click',async t=>{
 const f=await fixture(t,[]),p=pageFixture();
 await assert.rejects(submitTask(p,async()=>{},async()=>{},{timeout:20,readBackend:async()=>(await readSubmittedListing(f.options)).itemId}),e=>e.code==='RESULT_UNKNOWN');
 assert.equal(f.queries(),3);assert.equal(p.clicks(),1);assert.deepEqual(f.claimed,[]);
});
for(const [label,value] of [['价格','21.00'],['库存','999998']])test('acceptance 4/5: same title with different '+label+' cannot be claimed; one click',async t=>{
 const r=row();r.cells.find(c=>c.label===label).text=value;const f=await fixture(t,[r]),p=pageFixture();
 await assert.rejects(submitTask(p,async()=>{},async()=>{},{timeout:20,readBackend:async()=>(await readSubmittedListing(f.options)).itemId}),e=>e.code==='RESULT_UNKNOWN'&&e.message.includes(label));
 assert.equal(p.clicks(),1);assert.equal(f.claimed.length,0);
});
test('bounded delayed indexing: two empty title searches then one exact match',async t=>{
 const f=await fixture(t,n=>n<3?[]:[row()]);assert.equal((await readSubmittedListing(f.options)).itemId,id);assert.equal(f.queries(),3);
});
for(const kind of ['old-time','no-time','duplicate-time','duplicate-title','invalid-id','wrong-status','missing-price','malformed-price'])test('rejects unsafe backend record: '+kind,async t=>{
 const r=row();let rows=[r];
 if(kind==='old-time')r.cells[2].text='2026-10-17 22:01:00';
 if(kind==='no-time')r.cells.pop();
 if(kind==='duplicate-time')r.cells.push({...r.cells[2]});
 if(kind==='duplicate-title')rows.push({...r,itemId:'9999999999999'});
 if(kind==='invalid-id')r.itemId='12';
 if(kind==='wrong-status')r.status='已删除';
 if(kind==='missing-price')r.cells=r.cells.filter(c=>c.label!=='价格');
 if(kind==='malformed-price')r.cells[0].text='20元';
 const f=await fixture(t,rows);await assert.rejects(readSubmittedListing(f.options),e=>e.code==='RESULT_UNKNOWN');assert.deepEqual(f.claimed,[]);
});
test('fuzzy title never becomes a match',async t=>{const r=row();r.title+='其他商品';const f=await fixture(t,[r]);await assert.rejects(readSubmittedListing(f.options),e=>e.code==='RESULT_UNKNOWN');assert.equal(f.queries(),3);});
test('original warehouse target cannot claim a product on sale',async t=>{const f=await fixture(t);await assert.rejects(readSubmittedListing({...f.options,target:'WAREHOUSE'}),e=>e.code==='RESULT_UNKNOWN');});
test('captcha or shop guard failure after click never invokes fallback or clicks again',async()=>{
 for(const reason of ['PAUSED_CAPTCHA','WRONG_SHOP','SOURCE_OR_ASSET_CHANGED']){
  const p=pageFixture();let recorded=false,backend=0;
  await assert.rejects(submitTask(p,async()=>{if(recorded)throw Error(reason);},async()=>{recorded=true;},{timeout:20,readBackend:async()=>{backend++;return id;}}),new RegExp(reason));
  assert.equal(p.clicks(),1);assert.equal(backend,0);
 }
});
test('receipt timeout includes the operational message',async()=>{const p=pageFixture();await assert.rejects(submitTask(p,async()=>{},async()=>{},{timeout:20}),/已点击提交、回执未读到、正在后台确认/);assert.equal(p.clicks(),1);});
test('invalid receipt cannot trigger backend fallback',async()=>{
 const p=pageFixture(0);p.locator=()=>({innerText:async()=>`商品提交成功 商品ID：9999999999999`});let backend=0;
 await assert.rejects(submitTask(p,async()=>{},async()=>{},{timeout:100,readBackend:async()=>{backend++;return id;}}),/MATCHING_UNIQUE/);
 assert.equal(backend,0);assert.equal(p.clicks(),1);
});
test('original submit time is preserved across recovery attempts',()=>{
 const events=[{seq:1,kind:'SUBMITTING',at:'2026-10-18T14:00:19Z'},{seq:2,kind:'SUBMIT_CLICKED',at:'2026-10-18T14:00:20Z'},{seq:3,kind:'RESULT_UNKNOWN',at:'2026-10-18T14:01:21Z'},{seq:4,kind:'RESULT_UNKNOWN',at:'2026-10-18T20:00:20Z'}];
 assert.deepEqual(submissionLookupWindow(events),window);assert.throws(()=>submissionLookupWindow([]),/提交时间/);
});
test('deadline and ownership failures never write a claimed result',async t=>{
 const f=await fixture(t);await assert.rejects(readSubmittedListing({...f.options,assertUnused:()=>{throw Error('already claimed by another task');}}),/already claimed/);
 await assert.rejects(readSubmittedListing({...f.options,guard:async()=>{throw Error('WRONG_SHOP');}}),/WRONG_SHOP/);
});
test('a backend item ID already associated with another run or history is rejected',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'ly-receipt-ownership-')),store=new SourceStore(join(dir,'state.sqlite'));t.after(async()=>{store.close();await rm(dir,{recursive:true,force:true});});
 const own=store.create('fixture',task,'LIVE','SOURCE',{reviewed:true,taskHash:digest(task)}),otherTask={...task,listing:{type:'country',country:'其他国家',title:'另一原任务'}},other=store.create('fixture',otherTask,'LIVE','SOURCE',{reviewed:true,taskHash:digest(otherTask)});
 assert.doesNotThrow(()=>assertUnclaimedSubmissionId(store,own,id));store.checkpoint(other.id,{itemId:id});assert.throws(()=>assertUnclaimedSubmissionId(store,own,id),/其他任务/);
});
for(const created of ['2026-10-18 22:00','2026-10-18 22:00:10','2026-10-18 22:00:20'])test('old/minute/same-second record cannot be automatically claimed: '+created,async t=>{
 const r=row();r.cells[2].text=created;const f=await fixture(t,[r]);await assert.rejects(readSubmittedListing(f.options),/时间精度不足/);assert.equal(f.claimed.length,0);
});
test('hung read terminates by the overall deadline and cannot return a late success',async t=>{
 const f=await fixture(t);let release;f.table.search=()=>new Promise(resolve=>release=resolve);
 const started=Date.now();await assert.rejects(readSubmittedListing({...f.options,timeout:40}),/时间已用尽/);assert(Date.now()-started<500);
 release({records:[row()]});await new Promise(r=>setTimeout(r,30));assert.deepEqual(f.claimed,[]);
});
