import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createHash,randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {RoundItemAttempts} from '../round-item-attempts.mjs';
const rawTask=JSON.stringify({shopId:'shop-a',listing:{city:'isolated-fixture'}}),taskHash=createHash('sha256').update(rawTask).digest('hex');
const scope={roundId:'round-a',windowId:'window-a',key:'key-a',shopId:'shop-a',taskHash,repairVersion:'CANDIDATE_ONLY'};
function setup(file=':memory:'){
 const db=new DatabaseSync(file);db.exec(`CREATE TABLE rounds(id TEXT PRIMARY KEY,shop TEXT,manifest_hash TEXT);
 CREATE TABLE round_windows(id TEXT PRIMARY KEY,round_id TEXT,shop TEXT,manifest_hash TEXT);
 CREATE TABLE round_items(round_id TEXT,key TEXT,task_hash TEXT,run_id TEXT,state TEXT);
 CREATE TABLE round_window_items(window_id TEXT,key TEXT,task_hash TEXT);
 CREATE TABLE runs(id TEXT PRIMARY KEY,key TEXT UNIQUE,task TEXT);
 CREATE TABLE events(seq INTEGER PRIMARY KEY,run TEXT,kind TEXT);`);
 db.prepare('INSERT INTO rounds VALUES(?,?,?)').run('round-a','shop-a','manifest');
 for(const w of ['window-a','window-b']){
  db.prepare('INSERT INTO round_windows VALUES(?,?,?,?)').run(w,'round-a','shop-a','manifest');
  db.prepare('INSERT INTO round_window_items VALUES(?,?,?)').run(w,'key-a',taskHash);
 }
 db.prepare('INSERT INTO round_items VALUES(?,?,?,?,?)').run('round-a','key-a',taskHash,null,'PENDING');
 const ledger=new RoundItemAttempts(db);
 const tx=fn=>{db.exec('BEGIN IMMEDIATE');try{const result=fn();db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}};
 const begin=(overrides={})=>ledger.begin({scope,kind:'INITIAL',requestId:'request-a',before:{state:'PENDING',submitted:false},...overrides});
 return {db,ledger,tx,begin};
}
test('all mutations require the caller transaction',()=>{
 const f=setup();try{assert.throws(()=>f.begin(),/TRANSACTION_REQUIRED/);assert.equal(f.ledger.list('round-a','key-a').length,0);}finally{f.db.close();}
});
test('duplicate request reuses exact intent; changes to scope or snapshot are rejected',()=>{
 const f=setup();try{const a=f.tx(()=>f.begin());assert.equal(f.tx(()=>f.begin()).id,a.id);
  assert.throws(()=>f.tx(()=>f.begin({before:{state:'FAILED'}})),/REQUEST_CONFLICT/);
  assert.throws(()=>f.tx(()=>f.begin({scope:{...scope,windowId:'window-b'}})),/REQUEST_CONFLICT/);
  assert.equal(f.ledger.list('round-a','key-a').length,1);
 }finally{f.db.close();}
});
test('wrong shop, manifest, window assignment and task version fail closed',()=>{
 const f=setup();try{
  for(const change of [{shopId:'other'},{windowId:'missing'},{key:'other'},{taskHash:'other'}])assert.throws(()=>f.tx(()=>f.begin({scope:{...scope,...change}})),/SCOPE_MISMATCH/);
  f.db.exec("UPDATE round_windows SET manifest_hash='changed'");assert.throws(()=>f.tx(()=>f.begin()),/SCOPE_MISMATCH/);
 }finally{f.db.close();}
});
test('pause and resume retrieve the same open attempt; second attempt cannot supersede it',()=>{
 const f=setup();try{const a=f.tx(()=>f.begin());assert.equal(f.ledger.openFor('key-a').id,a.id);
  assert.throws(()=>f.tx(()=>f.begin({kind:'MANUAL_RETRY',parentAttemptId:a.id,requestId:'retry'})),/PARENT_INVALID/);
  assert.equal(f.ledger.openFor('key-a').id,a.id);
 }finally{f.db.close();}
});
test('sealed failure remains byte-for-byte when a linked new window attempt succeeds',()=>{
 const f=setup();try{const a=f.tx(()=>f.begin());f.tx(()=>f.ledger.seal(a.id,{state:'FAILED',submitted:false,reason:'fixture'}));
  const old=f.db.prepare('SELECT * FROM round_item_attempts WHERE id=?').get(a.id);
  const b=f.tx(()=>f.begin({scope:{...scope,windowId:'window-b'},kind:'MANUAL_RETRY',requestId:'retry',parentAttemptId:a.id,before:{state:'FAILED',submitted:false}}));
  f.tx(()=>f.ledger.seal(b.id,{state:'NEW_SUCCESS',itemId:'mock-only',submitted:true}));
  assert.deepEqual(f.db.prepare('SELECT * FROM round_item_attempts WHERE id=?').get(a.id),old);
  assert.equal(b.parent_attempt_id,a.id);assert.equal(b.ordinal,2);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM round_items').get().n,1);
 }finally{f.db.close();}
});
test('identity, baseline, closed history and deletes are immutable at the SQL layer',()=>{
 const f=setup();try{const a=f.tx(()=>f.begin());
  assert.throws(()=>f.db.prepare('UPDATE round_item_attempts SET before_snapshot=? WHERE id=?').run('{}',a.id),/IDENTITY_IMMUTABLE/);
  f.tx(()=>f.ledger.seal(a.id,{state:'FAILED'}));
  assert.throws(()=>f.db.prepare('UPDATE round_item_attempts SET outcome_snapshot=? WHERE id=?').run('{}',a.id),/HISTORY_IMMUTABLE/);
  assert.throws(()=>f.db.prepare('DELETE FROM round_item_attempts WHERE id=?').run(a.id),/HISTORY_IMMUTABLE/);
  assert.throws(()=>f.tx(()=>f.ledger.seal(a.id,{state:'NEW_SUCCESS'})),/OUTCOME_CONFLICT/);
  assert.equal(f.tx(()=>f.ledger.seal(a.id,{state:'FAILED'})).id,a.id);
 }finally{f.db.close();}
});
test('attempt and caller projection roll back together when any later write fails',()=>{
 const f=setup();try{assert.throws(()=>f.tx(()=>{f.begin();f.db.exec("UPDATE round_items SET state='FAILED'");throw Error('injected');}),/injected/);
  assert.equal(f.ledger.list('round-a','key-a').length,0);assert.equal(f.db.prepare('SELECT state FROM round_items').get().state,'PENDING');
  const a=f.tx(()=>f.begin());assert.throws(()=>f.tx(()=>{f.ledger.seal(a.id,{state:'FAILED'});throw Error('late failure');}),/late failure/);
  assert.equal(f.ledger.get(a.id).finished_at,null);
 }finally{f.db.close();}
});
test('run binding preserves the original unique run and requires exact frozen task bytes',()=>{
 const f=setup();try{const a=f.tx(()=>f.begin());f.db.prepare('INSERT INTO runs VALUES(?,?,?)').run('run-a','key-a',rawTask);
  assert.throws(()=>f.tx(()=>f.ledger.bindRun(a.id,'run-a')),/RUN_MISMATCH/);
  f.db.exec("UPDATE round_items SET run_id='run-a'");assert.equal(f.tx(()=>f.ledger.bindRun(a.id,'run-a')).run_id,'run-a');
  assert.throws(()=>f.tx(()=>f.ledger.bindRun(a.id,'other')),/RUN_CONFLICT/);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM runs').get().n,1);
 }finally{f.db.close();}
});
test('source event boundaries are captured without modifying source logs',()=>{
 const f=setup();try{f.db.exec("INSERT INTO events VALUES(7,'old-run','VERIFIED')");const a=f.tx(()=>f.begin());
  f.db.exec("INSERT INTO events VALUES(8,'run-a','STEP_INTENT');INSERT INTO events VALUES(9,'run-a','STEP_PAUSED')");
  const b=f.tx(()=>f.ledger.seal(a.id,{state:'FAILED'}));assert.equal(b.source_event_after,7);assert.equal(b.source_event_through,9);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM events').get().n,3);
 }finally{f.db.close();}
});
test('sealed and open attempts persist across database reopen without inventing history',()=>{
 const file=join(import.meta.dirname,'fixture-'+randomUUID()+'.sqlite'),f=setup(file);const a=f.tx(()=>f.begin());f.db.close();
 const db=new DatabaseSync(file);try{const ledger=new RoundItemAttempts(db);assert.equal(ledger.openFor('key-a').id,a.id);assert.equal(ledger.list('round-a','key-a').length,1);}finally{db.close();}
});
