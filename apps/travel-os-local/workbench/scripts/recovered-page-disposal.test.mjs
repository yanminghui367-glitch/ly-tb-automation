import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,mkdirSync,writeFileSync,unlinkSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {EventEmitter} from 'node:events';
import {SourceStore,digest} from '../source-store.mjs';
import {setPageScope} from '../page-ownership.mjs';
import {disposeRecoveredPreSubmitPage} from '../pre-submit-page-recovery.mjs';

function fixture(t){
 const dir=mkdtempSync(join(tmpdir(),'ly-disposal-')),store=new SourceStore(join(dir,'state.sqlite'));
 const task={shopId:'isolated-shop',listing:{type:'country',country:'隔离国',title:'隔离国旅行'},business:{shop_name:'隔离店'},adapterIssues:[]};
 const run=store.create('test',task,'LIVE','SOURCE',{reviewed:true,taskHash:digest(task)});store.move(run.id,'RUNNING');
 const evidenceRoot=join(dir,run.id);mkdirSync(evidenceRoot);const evidence=join(evidenceRoot,'isolated-evidence.png');writeFileSync(evidence,Buffer.from([137,80,78,71,13,10,26,10]));
 const context=new EventEmitter();context.list=[];context.pages=()=>context.list.filter(p=>!p.isClosed());
 context.newCDPSession=async p=>({send:async()=>({targetInfo:{type:'page',targetId:p.targetId,browserContextId:'context'}}),detach:async()=>{}});
 const ledger=setPageScope(context,{db:store.db,shopId:task.shopId,runId:run.id,taskKey:run.key,taskHash:digest(task),roundId:'round',executionWindowId:'window'});
 const create=id=>{const ticket=ledger.reserveCreation({purpose:'publish-form'}),p=new EventEmitter();Object.assign(p,{targetId:id,closed:false,pinned:false,captcha:false,shop:true,closeCalls:0,url:()=>p.changedUrl||'https://item.upload.taobao.com/sell/v2/publish.htm',isClosed:()=>p.closed,close:async()=>{p.closeCalls++;if(p.closeFails)throw Error('isolated close failure');p.closed=true;}});context.list.push(p);context.emit('page',p);ledger.bindCreated(ticket,p,{targetId:id,browserContextId:'context'});return p;};
 const oldPage=create('old'),newPage=create('new');ledger.retain(oldPage,{reason:'PRE_SUBMIT_MATERIAL_READINESS'});
 const recovery={count:1,status:'BOUND',attemptId:'attempt',oldTargetId:'old',newTargetId:'new',screenshot:evidence};
 store.checkpoint(run.id,{residualPageRefill:recovery});let guards=0;
 const x={dir,evidenceRoot,store,ledger,run,oldPage,newPage,recovery,task,context,guards:()=>guards,onGuard:async()=>{},onProtection:async()=>{}};
 const execute=()=>disposeRecoveredPreSubmitPage({store,id:run.id,task,hash:digest,oldPage,newPage,oldUrl:oldPage.url(),context,ledger,recoveryField:'residualPageRefill',evidenceRoot,
  guard:async p=>{guards++;await x.onGuard(p);if(p.captcha)throw Error('PAUSED_CAPTCHA');if(!p.shop)throw Error('WRONG_SHOP');},visibleChallenge:async p=>p.captcha,
  readProtection:async p=>{await x.onProtection(p);return {status:p.pinned?'pinned':'unpinned',pageTargetId:p.targetId,tabTargetId:'tab-old'};}});
 t.after(()=>{ledger.dispose();store.close();rmSync(dir,{recursive:true,force:true});});return Object.assign(x,{execute});
}
test('exact owned replaced page closes only after durable binding; state and attempts unaffected',async t=>{
 const x=fixture(t),before=x.store.run(x.run.id);assert.equal((await x.execute()).closed,true);assert.equal(x.oldPage.closeCalls,1);assert.equal(x.newPage.closeCalls,0);assert.equal(x.guards(),2);
 assert.deepEqual(x.store.run(x.run.id),before);assert.equal(x.ledger.counts().retained,0);assert.equal(x.ledger.counts().owned,1);
 assert.equal(x.store.events(x.run.id).at(-1).payload.disposition,'CLOSED');
});
for(const kind of ['SUBMITTING','SUBMIT_CLICKED','SUBMIT_EVIDENCE','RESULT_UNKNOWN','VERIFIED'])test(kind+' prevents close',async t=>{
 const x=fixture(t);x.store.event(x.run.id,kind,{});await assert.rejects(x.execute(),/SUBMISSION_PROTECTED/);assert.equal(x.oldPage.closeCalls,0);
});
test('submit intention prevents close',async t=>{const x=fixture(t);x.store.event(x.run.id,'STEP_INTENT',{name:'submit-once'});await assert.rejects(x.execute(),/SUBMISSION_PROTECTED/);assert.equal(x.oldPage.closeCalls,0);});
for(const condition of ['captcha','login','submission','navigation','pinned'])test('after BOUND, '+condition+' at second guard preserves original page',async t=>{
 const x=fixture(t);let n=0;x.onGuard=async p=>{if(++n!==2)return;if(condition==='captcha')p.captcha=true;if(condition==='login')p.shop=false;if(condition==='submission')x.store.event(x.run.id,'SUBMIT_CLICKED',{});if(condition==='navigation')p.changedUrl='https://login.taobao.com/';if(condition==='pinned')p.pinned=true;};
 if(condition==='pinned')assert.equal((await x.execute()).closed,false);else await assert.rejects(x.execute());assert.equal(x.oldPage.closeCalls,0);assert.equal(x.ledger.counts().retained,1);
});
for(const reason of ['RESULT_UNKNOWN','MANUAL_PRESERVE','PROTECTION_UNKNOWN'])test(reason+' hold is never converted to disposal grant',async t=>{
 const x=fixture(t);x.ledger.retain(x.oldPage,{reason});await assert.rejects(x.execute(),/只允许回收/);assert.equal(x.oldPage.closeCalls,0);
});
test('borrowed old page cannot close',async t=>{const x=fixture(t);x.ledger.lease(x.oldPage,{purpose:'publish-form'});await assert.rejects(x.execute(),/借用/);assert.equal(x.oldPage.closeCalls,0);});
test('unowned old page cannot close',async t=>{const x=fixture(t),describe=x.ledger.describe.bind(x.ledger);x.ledger.describe=p=>p===x.oldPage?{...describe(p),owned:false}:describe(p);await assert.rejects(x.execute(),/OWNERSHIP_UNVERIFIED/);assert.equal(x.oldPage.closeCalls,0);});
test('missing evidence retains page and explicitly records reason',async t=>{const x=fixture(t);delete x.recovery.screenshot;x.store.checkpoint(x.run.id,{residualPageRefill:x.recovery});assert.equal((await x.execute()).reason,'RECOVERY_EVIDENCE_UNAVAILABLE');assert.equal(x.oldPage.closeCalls,0);});
test('close-intent write failure blocks before browser close',async t=>{const x=fixture(t);x.store.db.exec("CREATE TRIGGER reject_close BEFORE UPDATE ON page_owner_pages WHEN NEW.state='close-intent' BEGIN SELECT RAISE(FAIL,'isolated disk failure'); END");await assert.rejects(x.execute(),/落盘失败/);assert.equal(x.oldPage.closeCalls,0);assert.equal(x.ledger.counts().retained,1);});
test('failed browser close stays retained, no false closed receipt',async t=>{const x=fixture(t);x.oldPage.closeFails=true;assert.equal((await x.execute()).reason,'RECOVERY_CLOSE_FAILED');assert.equal(x.ledger.counts().retained,1);assert.equal(x.store.events(x.run.id).at(-1).payload.disposition,'RETAINED');});
test('closed-receipt write failure blocks subsequent work without inventing receipt',async t=>{const x=fixture(t);x.store.db.exec("CREATE TRIGGER reject_closed BEFORE UPDATE ON page_owner_pages WHEN NEW.state='closed' BEGIN SELECT RAISE(FAIL,'isolated disk failure'); END");await assert.rejects(x.execute(),/落盘失败/);assert.equal(x.oldPage.closeCalls,1);assert.equal(x.store.events(x.run.id).some(e=>e.kind==='PRE_SUBMIT_RECOVERY_DISPOSITION'&&e.payload.disposition==='CLOSED'),false);assert.throws(()=>x.ledger.assertHealthy(),/落盘失败/);});
test('late protection change is checked before closure',async t=>{const x=fixture(t);let n=0;x.onProtection=async p=>{if(++n===2)p.pinned=true;};assert.equal((await x.execute()).closed,false);assert.equal(x.oldPage.closeCalls,0);});
test('new page navigating after BOUND also prevents old-page close',async t=>{const x=fixture(t);let n=0;x.onGuard=async()=>{if(++n===2)x.newPage.changedUrl='https://login.taobao.com/';};await assert.rejects(x.execute(),/PAGE_CHANGED/);assert.equal(x.oldPage.closeCalls,0);});
test('navigation recovery disposes only with same-attempt failed-step evidence',async t=>{const x=fixture(t);const recovery={...x.recovery};delete recovery.screenshot;x.store.checkpoint(x.run.id,{navigationPageRecovery:recovery});x.store.event(x.run.id,'STEP_PAUSED',{name:'open-new-form',attemptId:'different-attempt',screenshot:'unrelated.png'});
 const args={store:x.store,id:x.run.id,task:x.task,hash:digest,oldPage:x.oldPage,newPage:x.newPage,oldUrl:x.oldPage.url(),context:x.context,ledger:x.ledger,guard:async()=>{},readProtection:async p=>({status:'unpinned',pageTargetId:p.targetId,tabTargetId:'tab-old'}),visibleChallenge:async()=>false,evidenceRoot:x.evidenceRoot,recoveryField:'navigationPageRecovery'};
 assert.equal((await disposeRecoveredPreSubmitPage(args)).reason,'RECOVERY_EVIDENCE_UNAVAILABLE');x.store.event(x.run.id,'STEP_PAUSED',{name:'open-new-form',attemptId:'attempt',screenshot:x.recovery.screenshot});assert.equal((await disposeRecoveredPreSubmitPage(args)).closed,true);
});
for(const kind of ['missing','empty','directory','outside-run','junction','file-link'])test(kind+' evidence never authorizes page close',async t=>{
 const x=fixture(t),path=x.recovery.screenshot;
 if(kind==='missing')unlinkSync(path);
 if(kind==='empty')writeFileSync(path,'');
 if(kind==='directory'){unlinkSync(path);mkdirSync(path);}
 if(kind==='outside-run'){const other=join(x.dir,'other.png');writeFileSync(other,'evidence');x.recovery.screenshot=other;}
 if(kind==='junction'){const target=join(x.dir,'linked-target');mkdirSync(target);writeFileSync(join(target,'image.png'),'evidence');const link=join(x.evidenceRoot,'linked');symlinkSync(target,link,'junction');x.recovery.screenshot=join(link,'image.png');}
 if(kind==='file-link'){const target=join(x.evidenceRoot,'real.png');writeFileSync(target,'evidence');unlinkSync(path);symlinkSync(target,path,'file');}
 x.store.checkpoint(x.run.id,{residualPageRefill:x.recovery});assert.equal((await x.execute()).reason,'RECOVERY_EVIDENCE_FILE_UNVERIFIED');assert.equal(x.oldPage.closeCalls,0);assert.equal(x.store.events(x.run.id).at(-1).payload.disposition,'RETAINED');
});
test('evidence removed during final boundary preserves old page',async t=>{const x=fixture(t);let n=0;x.onGuard=async()=>{if(++n===2)unlinkSync(x.recovery.screenshot);};assert.equal((await x.execute()).reason,'RECOVERY_EVIDENCE_FILE_CHANGED');assert.equal(x.oldPage.closeCalls,0);});
test('evidence replaced during final boundary preserves old page',async t=>{const x=fixture(t);let n=0;x.onGuard=async()=>{if(++n===2)writeFileSync(x.recovery.screenshot,'changed evidence');};assert.equal((await x.execute()).reason,'RECOVERY_EVIDENCE_FILE_CHANGED');assert.equal(x.oldPage.closeCalls,0);});
