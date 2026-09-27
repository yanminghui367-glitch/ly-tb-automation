import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';
import { taskHash, listingKey, taskIssues, requireThat } from './contract.mjs';

const allowed = {
  READY: ['RUNNING', 'PAUSED_CAPTCHA', 'PAUSED_REVIEW'], RUNNING: ['RUNNING', 'PAUSED_CAPTCHA', 'PAUSED_REVIEW', 'FAILED_RETRYABLE', 'SUBMITTING', 'DRY_RUN_COMPLETE'],
  PAUSED_CAPTCHA: ['READY', 'PAUSED_CAPTCHA'], PAUSED_REVIEW: ['READY'], FAILED_RETRYABLE: ['READY'],
  SUBMITTING: ['PUBLISHED', 'RESULT_UNKNOWN'], RESULT_UNKNOWN: ['PUBLISHED', 'RESULT_UNKNOWN'], DRY_RUN_COMPLETE: [], PUBLISHED: [], BLOCKED: []
};
export class Store {
  constructor(file) {
    mkdirSync(dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=3000;
      CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY, listing_key TEXT UNIQUE NOT NULL, hash TEXT NOT NULL, payload TEXT NOT NULL, state TEXT NOT NULL, mode TEXT NOT NULL, checkpoint TEXT NOT NULL DEFAULT '{}', result TEXT, attempts INTEGER NOT NULL DEFAULT 0, reason TEXT, created TEXT NOT NULL, updated TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events(seq INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT NOT NULL, at TEXT NOT NULL, type TEXT NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS engine_lock(id INTEGER PRIMARY KEY CHECK(id=1), owner TEXT NOT NULL, pid INTEGER NOT NULL, host TEXT NOT NULL);
      PRAGMA user_version=2;`);
  }
  transaction(fn) { this.db.exec('BEGIN IMMEDIATE'); try { const out = fn(); this.db.exec('COMMIT'); return out; } catch (e) { this.db.exec('ROLLBACK'); throw e; } }
  event(id, type, data = {}) { this.db.prepare('INSERT INTO events(task_id,at,type,data) VALUES(?,?,?,?)').run(id, new Date().toISOString(), type, JSON.stringify(data)); }
  import(task, mode = 'DRY_RUN', { replaceBlocked = false } = {}) {
    requireThat(['DRY_RUN', 'LIVE'].includes(mode), 'INVALID_MODE');
    const digest = taskHash(task), key = listingKey(task), id = digest.slice(0, 24);
    return this.transaction(() => {
      const old = this.db.prepare('SELECT * FROM tasks WHERE listing_key=?').get(key);
      if (old) {
        if (old.hash === digest && old.mode === mode) return this.get(old.id);
        requireThat(replaceBlocked && old.state === 'BLOCKED', 'DESTINATION_ALREADY_RESERVED');
        requireThat(!this.db.prepare('SELECT owner FROM engine_lock WHERE id=1').get(), 'STOP_ENGINE_BEFORE_REVISION');
        this.db.prepare("UPDATE tasks SET listing_key=?,state='SUPERSEDED',updated=? WHERE id=?").run(`${key}#superseded#${old.id}`, new Date().toISOString(), old.id);
        this.event(old.id, 'SUPERSEDED', { newHash: digest, reason: 'EXPLICIT_BLOCKED_TASK_REVISION' });
      }
      const issues = taskIssues(task), now = new Date().toISOString();
      this.db.prepare('INSERT INTO tasks(id,listing_key,hash,payload,state,mode,reason,created,updated) VALUES(?,?,?,?,?,?,?,?,?)').run(id, key, digest, JSON.stringify(task), issues.length ? 'BLOCKED' : 'READY', mode, issues.join(','), now, now);
      this.event(id, 'IMPORTED', { issues, hash: digest, mode }); return this.get(id);
    });
  }
  get(id) { const r = this.db.prepare('SELECT * FROM tasks WHERE id=?').get(id); requireThat(r, 'TASK_NOT_FOUND'); return { ...r, task: JSON.parse(r.payload), checkpoint: JSON.parse(r.checkpoint), result: r.result ? JSON.parse(r.result) : null }; }
  list() { return this.db.prepare('SELECT id FROM tasks ORDER BY rowid').all().map(r => this.get(r.id)); }
  acquire() {
    requireThat(!this.owner, 'ENGINE_ALREADY_RUNNING');
    const owner = randomUUID();
    this.transaction(() => {
      const lock = this.db.prepare('SELECT * FROM engine_lock WHERE id=1').get();
      if (lock) {
        requireThat(lock.host === hostname(), 'ENGINE_LOCK_OTHER_HOST');
        let alive = true; try { process.kill(lock.pid, 0); } catch (e) { alive = e.code !== 'ESRCH'; }
        requireThat(!alive, 'ENGINE_ALREADY_RUNNING');
        this.db.prepare('DELETE FROM engine_lock WHERE id=1').run();
      }
      this.db.prepare('INSERT INTO engine_lock VALUES(1,?,?,?)').run(owner, process.pid, hostname());
    });
    this.owner = owner;
  }
  release() { if (this.owner) this.db.prepare('DELETE FROM engine_lock WHERE owner=?').run(this.owner); this.owner = null; }
  assertLock() { requireThat(this.owner && this.db.prepare('SELECT owner FROM engine_lock WHERE id=1').get()?.owner === this.owner, 'ENGINE_LOCK_REQUIRED'); }
  move(id, state, { checkpoint, reason = '', result } = {}) {
    this.assertLock();
    return this.transaction(() => {
      const old = this.get(id); requireThat(allowed[old.state]?.includes(state), `ILLEGAL_TRANSITION_${old.state}_${state}`);
      requireThat(state !== 'PUBLISHED' || (result?.itemId && result?.url && result?.evidence), 'VERIFIED_RESULT_REQUIRED');
      if (state === 'PUBLISHED') {
        const duplicate = this.db.prepare("SELECT id FROM tasks WHERE state='PUBLISHED' AND json_extract(payload,'$.shopId')=? AND json_extract(result,'$.itemId')=?").get(old.task.shopId, result.itemId);
        requireThat(!duplicate, 'PLATFORM_ITEM_ID_ALREADY_RECORDED');
      }
      this.db.prepare('UPDATE tasks SET state=?,checkpoint=?,reason=?,result=?,attempts=attempts+?,updated=? WHERE id=?').run(state, JSON.stringify(checkpoint ?? old.checkpoint), reason, result ? JSON.stringify(result) : (old.result ? JSON.stringify(old.result) : null), old.state === 'READY' && state === 'RUNNING' ? 1 : 0, new Date().toISOString(), id);
      this.event(id, state, { reason, checkpoint: checkpoint ?? old.checkpoint, ...(result ? { result } : {}) });
      return this.get(id);
    });
  }
  recover() {
    this.assertLock();
    for (const t of this.list()) {
      if (t.state === 'RUNNING') this.move(t.id, 'PAUSED_REVIEW', { reason: 'PROCESS_INTERRUPTED_REVALIDATE_PAGE' });
      if (t.state === 'SUBMITTING') this.move(t.id, 'RESULT_UNKNOWN', { reason: 'PROCESS_INTERRUPTED_AFTER_SUBMIT_INTENT_DO_NOT_RESUBMIT' });
    }
  }
  resume(id, note) {
    requireThat(typeof note === 'string' && note.trim().length >= 4, 'HUMAN_RESUME_NOTE_REQUIRED');
    const t = this.get(id); requireThat(['PAUSED_CAPTCHA', 'PAUSED_REVIEW', 'FAILED_RETRYABLE'].includes(t.state), 'TASK_NOT_RESUMABLE');
    return this.move(id, 'READY', { reason: note });
  }
  promoteToLive(id, evidence) {
    this.assertLock();
    return this.transaction(() => {
      const t = this.get(id);
      requireThat(t.state === 'DRY_RUN_COMPLETE' && t.mode === 'DRY_RUN' && typeof evidence === 'string' && evidence.trim(), 'REVIEWED_DRY_RUN_REQUIRED');
      // Retain the verified form checkpoint and immutable task; only change execution mode.
      this.db.prepare("UPDATE tasks SET mode='LIVE',state='READY',attempts=0,reason=?,updated=? WHERE id=?").run('P5_RELEASE_AFTER_P4', new Date().toISOString(), id);
      this.event(id, 'LIVE_AUTHORIZED', { evidence });
      return this.get(id);
    });
  }
  close() { this.release(); this.db.close(); }
}
