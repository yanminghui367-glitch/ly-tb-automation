import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

export const digest = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');
export const destinationKey = t => digest([t.shopId, t.listing.type, t.listing.country, t.listing.city || '']);
const transitions = {
  QUEUED: ['RUNNING', 'PAUSED'], RUNNING: ['PAUSED', 'PAUSED_CAPTCHA', 'DRY_RUN_COMPLETE', 'SUBMITTING'],
  PAUSED: ['QUEUED'], PAUSED_CAPTCHA: ['QUEUED'], DRY_RUN_COMPLETE: ['QUEUED'],
  SUBMITTING: ['RESULT_UNKNOWN', 'VERIFIED'], RESULT_UNKNOWN: ['RESULT_UNKNOWN', 'VERIFIED'], VERIFIED: []
};
export class SourceStore {
  constructor(file) {
    mkdirSync(dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=3000;
      CREATE TABLE IF NOT EXISTS imports(id TEXT PRIMARY KEY, at TEXT NOT NULL, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY, key TEXT UNIQUE NOT NULL, batch TEXT NOT NULL, task TEXT NOT NULL, mode TEXT NOT NULL, target TEXT NOT NULL, state TEXT NOT NULL, checkpoint TEXT NOT NULL DEFAULT '{}', result TEXT, reason TEXT NOT NULL DEFAULT '', at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events(seq INTEGER PRIMARY KEY, run TEXT NOT NULL, at TEXT NOT NULL, kind TEXT NOT NULL, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS history(key TEXT PRIMARY KEY, payload TEXT NOT NULL);`);
  }
  transaction(fn) { this.db.exec('BEGIN IMMEDIATE'); try { const r = fn(); this.db.exec('COMMIT'); return r; } catch (e) { this.db.exec('ROLLBACK'); throw e; } }
  imported(payload) { const id = digest([payload.sourceHash, payload.tasks]).slice(0, 24); this.db.prepare('INSERT OR IGNORE INTO imports VALUES(?,?,?)').run(id, new Date().toISOString(), JSON.stringify(payload)); return id; }
  batch(id) { const row = id ? this.db.prepare('SELECT * FROM imports WHERE id=?').get(id) : this.db.prepare('SELECT * FROM imports ORDER BY rowid DESC LIMIT 1').get(); return row ? { id: row.id, at: row.at, ...JSON.parse(row.payload) } : null; }
  history(task, result) { this.db.prepare('INSERT OR IGNORE INTO history VALUES(?,?)').run(destinationKey(task), JSON.stringify(result)); }
  completed(task) { const r = this.db.prepare('SELECT payload FROM history WHERE key=?').get(destinationKey(task)); return r ? JSON.parse(r.payload) : null; }
  run(id) { const r = this.db.prepare('SELECT * FROM runs WHERE id=?').get(id); if (!r) throw Error('任务不存在'); return { ...r, task: JSON.parse(r.task), checkpoint: JSON.parse(r.checkpoint), result: r.result ? JSON.parse(r.result) : null }; }
  list() { return this.db.prepare('SELECT id FROM runs ORDER BY rowid DESC').all().map(r => this.run(r.id)); }
  create(batch, task, mode, target, review) {
    if (!['DRY_RUN', 'LIVE'].includes(mode) || !['SOURCE', 'WAREHOUSE'].includes(target)) throw Error('执行模式无效');
    if (task.adapterIssues.length) throw Error(task.adapterIssues.join('；'));
    if (!review || review.taskHash !== digest(task) || review.reviewed !== true) throw Error('请先预览并确认本条标题与素材');
    const key = destinationKey(task);
    if (this.completed(task)) throw Error('该目的地已有本项目的成功记录，禁止重复发布');
    const old = this.db.prepare('SELECT id FROM runs WHERE key=?').get(key);
    if (old) throw Error('该商品已有任务，请从原任务恢复，不能重复创建');
    const id = randomUUID(), at = new Date().toISOString();
    this.transaction(() => { this.db.prepare('INSERT INTO runs(id,key,batch,task,mode,target,state,at) VALUES(?,?,?,?,?,?,?,?)').run(id,key,batch,JSON.stringify(task),mode,target,'QUEUED',at); this.event(id,'CREATED',{review, mode,target}); });
    return this.run(id);
  }
  event(id, kind, payload) { this.db.prepare('INSERT INTO events(run,at,kind,payload) VALUES(?,?,?,?)').run(id,new Date().toISOString(),kind,JSON.stringify(payload)); }
  events(id) { return this.db.prepare('SELECT * FROM events WHERE run=? ORDER BY seq').all(id).map(r => ({ ...r, payload: JSON.parse(r.payload) })); }
  checkpoint(id, patch) { const r = this.run(id); this.db.prepare('UPDATE runs SET checkpoint=? WHERE id=?').run(JSON.stringify({ ...r.checkpoint, ...patch }),id); }
  move(id, state, reason = '', result) {
    return this.transaction(() => {
      const r = this.run(id);
      if (!transitions[r.state]?.includes(state)) throw Error(`禁止状态跳转 ${r.state} → ${state}`);
      if (state === 'VERIFIED' && (!result?.itemId || !result?.screenshot || !result?.status || !result?.rowText)) throw Error('缺少平台核验结果');
      this.db.prepare('UPDATE runs SET state=?,reason=?,result=? WHERE id=?').run(state,reason,result ? JSON.stringify(result) : r.result ? JSON.stringify(r.result) : null,id);
      if (state === 'VERIFIED') this.history(r.task,result);
      this.event(id,state,{reason,...(result ? {result} : {})});
      return this.run(id);
    });
  }
  recover() { for (const r of this.list()) { if (r.state === 'RUNNING') this.move(r.id,'PAUSED','程序中断：恢复时重新核验页面'); if (r.state === 'SUBMITTING') this.move(r.id,'RESULT_UNKNOWN','提交可能已完成：只核验结果，禁止再次提交'); } }
  close() { this.db.close(); }
}
