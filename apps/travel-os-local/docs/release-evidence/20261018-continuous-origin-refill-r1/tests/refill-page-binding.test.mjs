import test from 'node:test';
import assert from 'node:assert/strict';
import {openTaskPage} from '../taobao-publisher.mjs';
const url='https://item.upload.taobao.com/sell/v2/publish.htm?catId=50014945',task={listing:{title:'原任务标题'},business:{shop_name:'原店铺'}};
const page=(id,title=task.listing.title)=>({id,url:()=>url,isClosed:()=>false,locator:()=>({inputValue:async()=>title})});
const checkpoint={formUrl:url,refillPageTargetId:'new',residualPageRefill:{status:'BOUND',newTargetId:'new',oldTargetId:'old',count:1}};
function fixture(pages){let sessions=0,detaches=0,creates=0,owned=null;const guards=[];
 const context={pages:()=>pages,browser:()=>{creates++;throw Error('unexpected create');},newPage:()=>{creates++;throw Error('unexpected create');},newCDPSession:async p=>{sessions++;return {send:async()=>({targetInfo:{targetId:p.id,type:'page'}}),detach:async()=>{detaches++;}};}};
 return {context,guards,get creates(){return creates;},get sessions(){return sessions;},get detaches(){return detaches;},get owned(){return owned;},run:cp=>openTaskPage(context,task,cp,async p=>guards.push(p),async()=>{throw Error('unexpected write');},async p=>{await Promise.resolve();owned=p;})};
}
test('bound replacement is selected by exact target despite identical old URL and title',async()=>{
 const old=page('old'),fresh=page('new'),f=fixture([old,fresh]);assert.equal(await f.run(checkpoint),fresh);assert.equal(f.owned,fresh);assert(f.guards.every(p=>p===fresh));assert.equal(f.creates,0);assert.equal(f.sessions,f.detaches);
});
test('reserved replacement never creates another page',async()=>{
 const f=fixture([]);await assert.rejects(f.run({...checkpoint,residualPageRefill:{...checkpoint.residualPageRefill,status:'RESERVED'}}),/RESIDUAL_REFILL_PAGE_UNAVAILABLE/);assert.equal(f.creates,0);
});
test('lost bound target never falls back to original page or creates another',async()=>{
 const f=fixture([page('old')]);await assert.rejects(f.run(checkpoint),/RESIDUAL_REFILL_PAGE_UNAVAILABLE/);assert.equal(f.creates,0);
});
test('duplicate target cannot be silently chosen',async()=>{
 const f=fixture([page('new'),page('new')]);await assert.rejects(f.run(checkpoint),/RESIDUAL_REFILL_PAGE_UNAVAILABLE/);assert.equal(f.creates,0);
});
test('wrong title on bound target is not repaired or overwritten',async()=>{
 const f=fixture([page('new','不同任务')]);await assert.rejects(f.run(checkpoint),/ANOTHER_TASK_FORM/);assert.equal(f.creates,0);
});
test('ordinary existing task without refill markers follows the original selection path',async()=>{
 const original=page('old'),f=fixture([original]);assert.equal(await f.run({formUrl:url}),original);assert.equal(f.owned,original);assert.equal(f.sessions,0);assert.equal(f.creates,0);
});
