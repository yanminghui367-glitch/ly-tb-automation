import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {EventEmitter} from 'node:events';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {randomUUID} from 'node:crypto';
import {PageOwnership,setPageScope,getPageLedger} from '../page-ownership.mjs';

class Context extends EventEmitter{
 constructor(pages=[]){super();this.list=pages;}
 pages(){return this.list.filter(p=>!p.isClosed());}
 add(){const page={closed:false,isClosed(){return this.closed;},close(){this.closed=true;}};this.list.push(page);this.emit('page',page);return page;}
}
const scope=(runId='r1')=>({shopId:'shop',runId,taskKey:'key-'+runId,taskHash:'hash-'+runId,roundId:'round',executionWindowId:'window'});
function fixture(t){
 const dir=mkdtempSync(join(tmpdir(),'ly-page-ledger-')),db=new DatabaseSync(join(dir,'test.sqlite')),context=new Context();context.add();
 const ledger=setPageScope(context,{db,...scope()});
 t.after(()=>{ledger.dispose();db.close();assert(resolve(dir).startsWith(resolve(tmpdir())+sep));rmSync(dir,{recursive:true,force:true});});
 const create=(purpose='publish-form')=>{const ticket=ledger.reserveCreation({purpose}),page=context.add();ledger.bindCreated(ticket,page,{targetId:randomUUID(),browserContextId:'context',browserWindowId:7});return page;};
 const verify=page=>ledger.markVerified(page,{verifiedPersisted:true,itemId:'123'});
 const close=page=>{verify(page);const ticket=ledger.beginClose(page,{unpinnedConfirmed:true,guardPassed:true,itemId:'123'});page.close();return ledger.finishClose(ticket,{closed:true});};
 return {db,context,ledger,create,verify,close};
}

test('100 isolated success cycles stay bounded and store distinct run/window identities',t=>{
 const x=fixture(t),helper=x.create('verification-helper');
 for(let i=0;i<100;i++){setPageScope(x.context,{db:x.db,...scope('run-'+i)});x.ledger.assertCanStartTask();x.ledger.lease(helper,{purpose:'verification-helper'});const page=x.create();assert.equal(x.close(page).closed,true);}
 assert.deepEqual({...x.ledger.counts(),sessionId:null},{sessionId:null,total:2,baseline:1,owned:1,reserved:0,unknown:0,borrowed:1,retained:0,peak:2,fault:null});
 const rows=x.db.prepare("SELECT * FROM page_owner_pages WHERE state='closed'").all();assert.equal(rows.length,100);assert.equal(new Set(rows.map(r=>JSON.parse(r.scope).runId)).size,100);
 assert(rows.every(r=>r.browser_window_id===7&&JSON.parse(r.scope).executionWindowId==='window'));
});
test('failed durable reservation never gives permission to create or continue',t=>{
 const x=fixture(t);x.db.exec("CREATE TRIGGER reject_intent BEFORE INSERT ON page_owner_pages WHEN NEW.state='creation-intent' BEGIN SELECT RAISE(FAIL,'disk fixture'); END");
 assert.throws(()=>x.ledger.reserveCreation({purpose:'publish-form'}),/落盘失败/);assert.equal(x.ledger.counts().owned,0);assert.equal(x.context.pages().length,1);assert.throws(()=>x.ledger.assertCanStartTask(),/落盘失败/);
});
test('scope is copied, previous run cannot be verified by next run, helper leases do not overwrite owner',t=>{
 const x=fixture(t),input={db:x.db,...scope('original')};setPageScope(x.context,input);const page=x.create(),helper=x.create('material-helper');input.runId='mutated';
 assert.equal(JSON.parse(x.db.prepare("SELECT scope FROM page_owner_pages WHERE purpose='publish-form'").get().scope).runId,'original');
 setPageScope(x.context,{db:x.db,...scope('next')});assert.throws(()=>x.verify(page),/归属不匹配/);const lease=x.ledger.lease(helper,{purpose:'material-helper'});assert.equal(lease.scope.runId,'next');assert.equal(JSON.parse(x.db.prepare("SELECT scope FROM page_owner_pages WHERE purpose='material-helper'").get().scope).runId,'original');
});
test('pre-run helper preserves explicit null run and later leases record actual run without rewriting creation',t=>{
 const x=fixture(t),preRun={...scope(),runId:null};setPageScope(x.context,{db:x.db,...preRun});
 const helper=x.create('verification-helper'),helperId=x.ledger.describe(helper).id;
 assert.equal(x.ledger.describe(helper).scope.runId,null);
 assert.equal(JSON.parse(x.db.prepare('SELECT scope FROM page_owner_pages WHERE id=?').get(helperId).scope).runId,null);
 setPageScope(x.context,{db:x.db,...preRun,runId:'actual-run'});
 assert.equal(x.ledger.lease(helper,{purpose:'verification-helper'}).scope.runId,'actual-run');
 assert.equal(x.ledger.describe(helper).scope.runId,null);
 assert.equal(JSON.parse(x.db.prepare('SELECT scope FROM page_owner_pages WHERE id=?').get(helperId).scope).runId,null);
 const leases=x.db.prepare("SELECT scope FROM page_owner_events WHERE page_id=? AND kind='borrowed:verification-helper'").all(helperId);
 assert.deepEqual(leases.map(row=>JSON.parse(row.scope).runId),['actual-run']);
 const publish=x.create();assert.equal(x.ledger.describe(publish).scope.runId,'actual-run');
 const missing={...preRun};delete missing.runId;assert.throws(()=>setPageScope(x.context,{db:x.db,...missing}),/明确 null/);
 for(const key of ['shopId','taskKey','taskHash'])assert.throws(()=>setPageScope(x.context,{db:x.db,...preRun,[key]:null}),/缺少/);
});
test('restarted context never inherits ownership, even with same page object and database',t=>{
 const x=fixture(t),page=x.create();x.ledger.dispose();const nextContext=new Context(x.context.pages()),next=setPageScope(nextContext,{db:x.db,...scope()});t.after(()=>next.dispose());
 assert.notEqual(next.sessionId,x.ledger.sessionId);assert.equal(next.counts().owned,0);assert.equal(next.counts().baseline,2);assert.throws(()=>next.markVerified(page,{verifiedPersisted:true,itemId:'123'}),/不是当前会话/);
 assert.equal(getPageLedger(nextContext),next);
});
test('baseline, manual and borrowed pages cannot gain closing authority',t=>{
 const x=fixture(t),baseline=x.context.pages()[0],manual=x.context.add();
 for(const page of [baseline,manual]){x.ledger.lease(page,{purpose:'verification-helper'});assert.throws(()=>x.verify(page),/不是当前会话/);}
 const ticket=x.ledger.reserveCreation({purpose:'publish-form'});assert.throws(()=>x.ledger.bindCreated(ticket,manual,{targetId:'manual'}),/禁止认领/);x.ledger.creationFailed(ticket);
 assert.equal(x.ledger.counts().unknown,1);assert.equal(x.ledger.counts().borrowed,2);
});
test('unknown/pinned protection and explicit manual hold never close a verified page',t=>{
 const x=fixture(t),page=x.create();x.verify(page);
 for(const input of [{},{unpinnedConfirmed:false,guardPassed:true},{unpinnedConfirmed:true,guardPassed:false},{unpinnedConfirmed:true,guardPassed:true,manualPreserve:true}])assert.throws(()=>x.ledger.beginClose(page,{...input,itemId:'123'}),/未确认/);
 x.ledger.retain(page,{reason:'MANUAL_PRESERVE'});x.verify(page);assert.throws(()=>x.ledger.beginClose(page,{unpinnedConfirmed:true,guardPassed:true,itemId:'123'}),/明确保留/);assert(!page.isClosed());
});
test('uncertain creations remain recorded beyond six without a page-count stop',t=>{
 const x=fixture(t);for(let i=0;i<8;i++){const ticket=x.ledger.reserveCreation({purpose:'publish-form'});x.ledger.creationFailed(ticket,{reason:'CREATE_OR_BIND_UNCERTAIN'});assert.doesNotThrow(()=>x.ledger.assertCanStartTask());}
 assert.equal(x.ledger.counts().owned,8);assert.equal(x.ledger.counts().retained,8);assert.equal(x.ledger.counts().peak,8);
 assert.equal(x.db.prepare("SELECT count(*) n FROM page_owner_pages WHERE state='orphaned'").get().n,8);
});
test('retained pages preserve evidence and closing protection beyond six owned pages',t=>{
 const x=fixture(t),helper=x.create('verification-helper');for(let i=0;i<2;i++)x.ledger.retain(x.create(),{reason:'RESULT_UNKNOWN'});
 assert.equal(x.ledger.assertCanStartTask().retained,2);
 assert.equal(x.db.prepare("SELECT count(*) n FROM page_owner_pages WHERE state='retained'").get().n,2);
 for(let i=0;i<2;i++){x.ledger.retain(x.create(),{reason:'MANUAL_PRESERVE'});assert.doesNotThrow(()=>x.ledger.assertCanStartTask());}
 assert.equal(x.ledger.counts().retained,4);assert.equal(x.ledger.counts().owned,5);
 for(let i=0;i<3;i++){const page=x.create();x.ledger.retain(page,{reason:'MANUAL_PRESERVE'});assert.doesNotThrow(()=>x.ledger.assertCanStartTask());x.verify(page);assert.throws(()=>x.ledger.beginClose(page,{unpinnedConfirmed:true,guardPassed:true,itemId:'123'}),/明确保留/);assert(!page.isClosed());}
 assert.equal(x.ledger.counts().owned,8);assert.equal(x.ledger.counts().retained,7);
 assert.doesNotThrow(()=>x.ledger.lease(helper,{purpose:'verification-helper'}));
});
test('created binding failure leaves reserved uncertainty and latches next task without closing page',t=>{
 const x=fixture(t),ticket=x.ledger.reserveCreation({purpose:'publish-form'}),page=x.context.add();
 x.db.exec("CREATE TRIGGER reject_bind BEFORE UPDATE ON page_owner_pages WHEN NEW.state='created' BEGIN SELECT RAISE(FAIL,'disk fixture'); END");
 assert.throws(()=>x.ledger.bindCreated(ticket,page,{targetId:'new-target'}),/落盘失败/);assert(!page.isClosed());assert.equal(x.ledger.counts().reserved,1);assert.throws(()=>x.ledger.assertCanStartTask(),/落盘失败/);
});
test('close intent persistence failure stops before browser close; close failure is retained',t=>{
 const x=fixture(t),page=x.create();x.verify(page);
 const ticket=x.ledger.beginClose(page,{unpinnedConfirmed:true,guardPassed:true,itemId:'123'});assert.equal(x.ledger.finishClose(ticket,{closed:true}).closed,false);assert.equal(x.ledger.counts().retained,1);
 const second=x.create();x.verify(second);x.db.exec("CREATE TRIGGER reject_close BEFORE UPDATE ON page_owner_pages WHEN NEW.state='close-intent' BEGIN SELECT RAISE(FAIL,'disk fixture'); END");
 assert.throws(()=>x.ledger.beginClose(second,{unpinnedConfirmed:true,guardPassed:true,itemId:'123'}),/落盘失败/);assert(!second.isClosed());assert.throws(()=>x.ledger.assertCanStartTask(),/落盘失败/);
});
test('close receipt persistence failure cannot silently permit next task',t=>{
 const x=fixture(t),page=x.create();x.verify(page);const ticket=x.ledger.beginClose(page,{unpinnedConfirmed:true,guardPassed:true,itemId:'123'});page.close();
 x.db.exec("CREATE TRIGGER reject_closed BEFORE UPDATE ON page_owner_pages WHEN NEW.state='closed' BEGIN SELECT RAISE(FAIL,'disk fixture'); END");
 assert.throws(()=>x.ledger.finishClose(ticket,{closed:true}),/落盘失败/);assert.throws(()=>x.ledger.finishClose(ticket,{closed:true}),/已处理/);assert.throws(()=>x.ledger.assertCanStartTask(),/落盘失败/);assert.equal(x.db.prepare("SELECT count(*) n FROM page_owner_pages WHERE state='closed'").get().n,0);
});
test('failed close stays retained after verification and consumed receipt cannot be reused',t=>{
 const x=fixture(t),page=x.create();x.verify(page);
 const ticket=x.ledger.beginClose(page,{unpinnedConfirmed:true,guardPassed:true,itemId:'123'});
 assert.equal(x.ledger.finishClose(ticket,{closed:false}).closed,false);
 assert.throws(()=>x.ledger.finishClose(ticket,{closed:false}),/已处理/);
 x.verify(page);assert.equal(x.ledger.counts().retained,1);
 assert.throws(()=>x.ledger.beginClose(page,{unpinnedConfirmed:true,guardPassed:true,itemId:'123'}),/明确保留/);
 assert.throws(()=>x.ledger.finishClose(ticket,{closed:true}),/已处理/);
 page.close();assert.equal(x.ledger.counts().retained,0);
 assert.throws(()=>x.ledger.finishClose(ticket,{closed:true}),/已处理/);
});
test('successful close consumes receipt permanently',t=>{
 const x=fixture(t),page=x.create();x.verify(page);
 const ticket=x.ledger.beginClose(page,{unpinnedConfirmed:true,guardPassed:true,itemId:'123'});page.close();
 assert.equal(x.ledger.finishClose(ticket,{closed:true}).closed,true);
 assert.throws(()=>x.ledger.finishClose(ticket,{closed:true}),/已处理/);
});
test('tickets cannot be forged/reused, metadata rejects URL text, helper cannot close',t=>{
 const x=fixture(t);assert.throws(()=>x.ledger.bindCreated({id:'fake'},x.context.pages()[0],{targetId:'x'}),/不属于当前会话/);
 const helper=x.create('material-helper');assert.throws(()=>x.verify(helper),/不是当前会话/);assert.throws(()=>x.ledger.retain(helper,{reason:'https://site/?secret=x'}),/原因代码/);
 const ticket=x.ledger.reserveCreation({purpose:'publish-form'}),page=x.context.add();x.ledger.bindCreated(ticket,page,{targetId:'real'});assert.throws(()=>x.ledger.bindCreated(ticket,page,{targetId:'real'}),/已使用/);
});
