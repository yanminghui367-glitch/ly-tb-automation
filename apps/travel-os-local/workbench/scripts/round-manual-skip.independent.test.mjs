import test from 'node:test';
import assert from 'node:assert/strict';
import {setup,shop} from './skip-independent-fixture.mjs';
const state=f=>Object.fromEntries(['round_items','round_events','round_windows','round_window_items','runs','events','history','batch_items','batch_events','round_item_attempts'].map(table=>[table,f.store.db.prepare('SELECT * FROM '+table+' ORDER BY rowid').all()]));
test('a paused checkpoint with a platform item ID must not be hidden by manual skip',async t=>{
 const f=await setup(t);await f.pause();const x=f.round.item(f.r.id,f.scope().key);f.store.checkpoint(x.run_id,{itemId:'1234567890123',successUrl:'https://item.upload.taobao.com/sell/v2/success.htm?primaryId=1234567890123'});const req=f.request(),before=state(f);
 assert.throws(()=>f.action.skip(req),/SUBMISSION_PROTECTED|RUN_STATE|EVIDENCE/);assert.deepEqual(state(f),before);
});
test('foreign batch shop is rejected without changing any ledger or projection',async t=>{
 const f=await setup(t);await f.pause();const req=f.request(),x=f.round.item(f.r.id,f.scope().key);f.store.db.prepare('UPDATE batches SET shop=? WHERE id=?').run('foreign-shop',x.batch_id);const before=state(f);
 assert.throws(()=>f.action.skip(req),/QUEUE_MISMATCH/);assert.deepEqual(state(f),before);
});
test('new attempt after inspection invalidates an older revision before it can be sealed',async t=>{
 const f=await setup(t);await f.pause();const req=f.request(),x=f.round.item(f.r.id,f.scope().key),history=f.action.attempts.list(f.r.id,x.key),parent=history.at(-1);assert.equal(parent.kind,'INITIAL');assert(parent.finished_at);
 const a=f.store.transaction(()=>f.action.attempts.begin({scope:{...f.scope(),shopId:shop.id,taskHash:x.task_hash,repairVersion:f.r.repairVersion},kind:'RESUME',parentAttemptId:parent.id,requestId:'new-attempt',before:{state:'PENDING'}}));const before=state(f);assert.deepEqual(f.action.attempts.list(f.r.id,x.key),[...history,a]);
 assert.throws(()=>f.action.skip(req),/STALE_REVISION/);assert.deepEqual(state(f),before);assert.equal(f.action.attempts.get(a.id).finished_at,null);
});
test('failure during final skip seal restores the old open attempt and all projections',async t=>{
 const f=await setup(t);await f.pause();const x=f.round.item(f.r.id,f.scope().key),history=f.action.attempts.list(f.r.id,x.key),parent=history.at(-1);assert.equal(parent.kind,'INITIAL');assert(parent.finished_at);
 const a=f.store.transaction(()=>f.action.attempts.begin({scope:{...f.scope(),shopId:shop.id,taskHash:x.task_hash,repairVersion:f.r.repairVersion},kind:'RESUME',parentAttemptId:parent.id,requestId:'old-open',before:{state:'PENDING'}}));assert.deepEqual(f.action.attempts.list(f.r.id,x.key),[...history,a]);
 f.store.db.exec("CREATE TRIGGER reject_final_seal BEFORE UPDATE ON round_item_attempts WHEN NEW.kind='MANUAL_SKIP' AND NEW.finished_at IS NOT NULL BEGIN SELECT RAISE(ABORT,'qa-final-seal'); END");const req=f.request(),before=state(f);
 assert.throws(()=>f.action.skip(req),/qa-final-seal/);assert.deepEqual(state(f),before);assert.equal(f.action.attempts.get(a.id).finished_at,null);
});
test('replay while another owner is active returns only the sealed original receipt',async t=>{
 const f=await setup(t),req=f.request(),a=f.action.skip(req),before=state(f);f.flow.active='other-owner';f.flow.queueLease='other-lease';f.round.active='other-round';
 assert.deepEqual(f.action.skip(req),{replayed:true,attemptId:a.attemptId,outcome:a.outcome});assert.deepEqual(state(f),before);assert.equal(f.flow.submits,0);
});
test('all manually skipped window seals exact decision history without any publish launch',async t=>{
 const f=await setup(t);for(let n=1;n<=3;n++)f.action.skip(f.request(n));const attempts=f.action.attempts.list(f.r.id,f.scope().key),beforeRuns=f.store.list();f.round.start(f.r.id,{windowId:f.w.id});await f.round.pending;
 assert.equal(f.flow.submits,0);assert.equal(f.flow.launches.length,0);assert.deepEqual(f.store.list(),beforeRuns);assert.equal(f.round.windows.view(f.w.id).counts.MANUAL_SKIPPED,3);assert.equal(f.round.windows.view(f.w.id).state,'COMPLETED');assert.equal(f.round.view(f.r.id).processed,3);
 assert(f.round.windows.entries(f.w.id).every(x=>x.outcome.state==='MANUAL_SKIPPED'&&x.baseline.state==='PENDING'&&!x.outcome.submitted));assert.deepEqual(f.action.attempts.list(f.r.id,f.scope().key),attempts);
});
test('original successful history prevents skip even without run association',async t=>{
 const f=await setup(t);f.store.history(f.tasks[0],{itemId:'1234567890123',status:'出售中'});const req=f.request(),before=state(f);assert.throws(()=>f.action.skip(req),/SUBMISSION_PROTECTED/);assert.deepEqual(state(f),before);
});
test('same request with altered revision does not produce another manual decision',async t=>{
 const f=await setup(t),req=f.request(),a=f.action.skip(req),before=state(f);assert.throws(()=>f.action.skip({...req,expectedRevision:'altered'}),/REQUEST_CONFLICT/);assert.deepEqual(state(f),before);assert.equal(f.action.attempts.list(f.r.id,f.scope().key)[0].id,a.attemptId);
});
