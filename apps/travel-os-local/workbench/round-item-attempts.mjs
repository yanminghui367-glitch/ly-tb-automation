// Candidate only: persistence primitive, not an execution or authorization API.
// Caller must hold the existing round lease, validate action capabilities, and
// use one SourceStore transaction for this ledger and all state projections.
import {createHash,randomUUID} from 'node:crypto';
const hash=s=>createHash('sha256').update(s).digest('hex');
const fail=code=>{throw Object.assign(Error(code),{code});};
const text=(x,n=200)=>typeof x==='string'&&x.length>0&&x.length<=n;
const encode=x=>{const s=JSON.stringify(x);if(!s||s.length>200000)fail('ATTEMPT_SNAPSHOT_INVALID');return s;};
export class RoundItemAttempts {
 constructor(db){
  this.db=db;
  db.exec(`CREATE TABLE IF NOT EXISTS round_item_attempts (
   id TEXT PRIMARY KEY,round_id TEXT NOT NULL,window_id TEXT NOT NULL,key TEXT NOT NULL,
   shop_id TEXT NOT NULL,task_hash TEXT NOT NULL,repair_version TEXT NOT NULL,
   ordinal INTEGER NOT NULL,parent_attempt_id TEXT,kind TEXT NOT NULL,
   request_id TEXT NOT NULL UNIQUE,intent_hash TEXT NOT NULL,run_id TEXT,
   before_snapshot TEXT NOT NULL,outcome_snapshot TEXT,
   source_event_after INTEGER NOT NULL,source_event_through INTEGER,
   started_at TEXT NOT NULL,finished_at TEXT,
   UNIQUE(round_id,key,ordinal),
   CHECK ((outcome_snapshot IS NULL AND finished_at IS NULL AND source_event_through IS NULL)
       OR (outcome_snapshot IS NOT NULL AND finished_at IS NOT NULL AND source_event_through IS NOT NULL)));
   CREATE UNIQUE INDEX IF NOT EXISTS round_item_attempts_one_open ON round_item_attempts(key) WHERE finished_at IS NULL;
   CREATE TRIGGER IF NOT EXISTS round_item_attempts_no_replace BEFORE INSERT ON round_item_attempts
   WHEN EXISTS (SELECT 1 FROM round_item_attempts a WHERE a.id=NEW.id OR a.request_id=NEW.request_id
    OR (a.round_id=NEW.round_id AND a.key=NEW.key AND a.ordinal=NEW.ordinal)
    OR (a.key=NEW.key AND a.finished_at IS NULL AND NEW.finished_at IS NULL))
   BEGIN SELECT RAISE(ABORT,'ATTEMPT_HISTORY_IMMUTABLE'); END;
   CREATE TRIGGER IF NOT EXISTS round_item_attempts_no_delete BEFORE DELETE ON round_item_attempts BEGIN SELECT RAISE(ABORT,'ATTEMPT_HISTORY_IMMUTABLE'); END;
   CREATE TRIGGER IF NOT EXISTS round_item_attempts_sealed BEFORE UPDATE ON round_item_attempts WHEN OLD.finished_at IS NOT NULL BEGIN SELECT RAISE(ABORT,'ATTEMPT_HISTORY_IMMUTABLE'); END;
   CREATE TRIGGER IF NOT EXISTS round_item_attempts_identity BEFORE UPDATE ON round_item_attempts
   WHEN NEW.id IS NOT OLD.id OR NEW.round_id IS NOT OLD.round_id OR NEW.window_id IS NOT OLD.window_id
    OR NEW.key IS NOT OLD.key OR NEW.shop_id IS NOT OLD.shop_id OR NEW.task_hash IS NOT OLD.task_hash
    OR NEW.repair_version IS NOT OLD.repair_version OR NEW.ordinal IS NOT OLD.ordinal
    OR NEW.parent_attempt_id IS NOT OLD.parent_attempt_id OR NEW.kind IS NOT OLD.kind
    OR NEW.request_id IS NOT OLD.request_id OR NEW.intent_hash IS NOT OLD.intent_hash
    OR NEW.before_snapshot IS NOT OLD.before_snapshot OR NEW.source_event_after IS NOT OLD.source_event_after
    OR NEW.started_at IS NOT OLD.started_at OR (OLD.run_id IS NOT NULL AND NEW.run_id IS NOT OLD.run_id)
   BEGIN SELECT RAISE(ABORT,'ATTEMPT_IDENTITY_IMMUTABLE'); END;`);
 }
 transactionRequired(){if(!this.db.isTransaction)fail('ATTEMPT_TRANSACTION_REQUIRED');}
 get(id){const r=this.db.prepare('SELECT * FROM round_item_attempts WHERE id=?').get(id);return r?{...r,before:JSON.parse(r.before_snapshot),outcome:r.outcome_snapshot?JSON.parse(r.outcome_snapshot):null}:null;}
 list(roundId,key){return this.db.prepare('SELECT id FROM round_item_attempts WHERE round_id=? AND key=? ORDER BY ordinal').all(roundId,key).map(r=>this.get(r.id));}
 openFor(key){const r=this.db.prepare('SELECT id FROM round_item_attempts WHERE key=? AND finished_at IS NULL').get(key);return r?this.get(r.id):null;}
 validateScope(s){
  for(const name of ['roundId','windowId','key','shopId','taskHash','repairVersion'])if(!text(s[name]))fail('ATTEMPT_SCOPE_INVALID');
  const r=this.db.prepare(`SELECT r.shop,r.manifest_hash,w.manifest_hash window_manifest,w.shop window_shop,
   i.task_hash,wi.task_hash assigned_hash FROM rounds r JOIN round_windows w ON w.round_id=r.id
   JOIN round_items i ON i.round_id=r.id JOIN round_window_items wi ON wi.window_id=w.id AND wi.key=i.key
   WHERE r.id=? AND w.id=? AND i.key=?`).get(s.roundId,s.windowId,s.key);
  if(!r||r.shop!==s.shopId||r.window_shop!==s.shopId||r.manifest_hash!==r.window_manifest||r.task_hash!==s.taskHash||r.assigned_hash!==s.taskHash)fail('ATTEMPT_SCOPE_MISMATCH');
 }
 eventBoundary(){return this.db.prepare('SELECT COALESCE(MAX(seq),0) n FROM events').get().n;}
 begin({scope,kind,requestId,parentAttemptId=null,before}){
  this.transactionRequired();this.validateScope(scope);
  if(!['INITIAL','AUTO_RETRY','RESUME','MANUAL_RETRY','VERIFY_ONLY','MANUAL_SKIP'].includes(kind)||!text(requestId,120))fail('ATTEMPT_INTENT_INVALID');
  const baseline=encode(before),intent=hash(encode({scope,kind,requestId,parentAttemptId,before}));
  const old=this.db.prepare('SELECT id,intent_hash FROM round_item_attempts WHERE request_id=?').get(requestId);
  if(old){if(old.intent_hash!==intent)fail('ATTEMPT_REQUEST_CONFLICT');return this.get(old.id);}
  const previous=this.list(scope.roundId,scope.key).at(-1);
  if(previous){if(previous.id!==parentAttemptId||!previous.finished_at||previous.task_hash!==scope.taskHash||kind==='INITIAL')fail('ATTEMPT_PARENT_INVALID');}
  else if(parentAttemptId!==null||kind==='MANUAL_RETRY'&&before?.historyCoverage!=='PRIOR_HISTORY_NOT_SEGMENTED')fail('ATTEMPT_PARENT_INVALID');
  if(this.openFor(scope.key))fail('ATTEMPT_ALREADY_OPEN');
  const id=randomUUID(),at=new Date().toISOString();
  this.db.prepare(`INSERT INTO round_item_attempts(id,round_id,window_id,key,shop_id,task_hash,repair_version,ordinal,parent_attempt_id,kind,request_id,intent_hash,before_snapshot,source_event_after,started_at)
   VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id,scope.roundId,scope.windowId,scope.key,scope.shopId,scope.taskHash,scope.repairVersion,(previous?.ordinal||0)+1,parentAttemptId,kind,requestId,intent,baseline,this.eventBoundary(),at);
  return this.get(id);
 }
 bindRun(id,runId){
  this.transactionRequired();const a=this.get(id);if(!a||a.finished_at||!text(runId))fail('ATTEMPT_NOT_OPEN');
  if(a.run_id&&a.run_id!==runId)fail('ATTEMPT_RUN_CONFLICT');
  const r=this.db.prepare('SELECT key,task FROM runs WHERE id=?').get(runId);
  if(!r||r.key!==a.key||hash(r.task)!==a.task_hash)fail('ATTEMPT_RUN_MISMATCH');
  const x=this.db.prepare('SELECT run_id FROM round_items WHERE round_id=? AND key=?').get(a.round_id,a.key);
  if(x?.run_id!==runId)fail('ATTEMPT_RUN_MISMATCH');
  if(!a.run_id)this.db.prepare('UPDATE round_item_attempts SET run_id=? WHERE id=?').run(runId,id);
  return this.get(id);
 }
 seal(id,outcome){
  this.transactionRequired();const a=this.get(id);if(!a)fail('ATTEMPT_NOT_FOUND');
  const snapshot=encode(outcome);
  if(a.finished_at){if(a.outcome_snapshot!==snapshot)fail('ATTEMPT_OUTCOME_CONFLICT');return a;}
  const through=this.eventBoundary();if(through<a.source_event_after)fail('ATTEMPT_EVENT_HISTORY_CHANGED');
  this.db.prepare('UPDATE round_item_attempts SET outcome_snapshot=?,source_event_through=?,finished_at=? WHERE id=? AND finished_at IS NULL').run(snapshot,through,new Date().toISOString(),id);
  return this.get(id);
 }
}
