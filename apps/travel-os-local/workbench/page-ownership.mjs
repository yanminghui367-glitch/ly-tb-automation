import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

const registries=new WeakMap();
const purposes=new Set(['publish-form','material-helper','verification-helper','seller-home']);
const stamp=()=>new Date().toISOString();
const live=page=>!page.isClosed();
const scopeKeys=['shopId','runId','taskKey','taskHash','roundId','executionWindowId'];
const scopeCopy=input=>Object.freeze(Object.fromEntries(scopeKeys.map(key=>{
 if(key==='runId')assert(input[key]!==undefined,'页面归属 runId 须为实际 ID 或明确 null');
 const value=input[key]??null;
 assert(value===null||typeof value==='string'&&value.length>0&&value.length<=256,`页面归属 ${key} 无效`);
 if(['shopId','taskKey','taskHash'].includes(key))assert(value,`页面归属缺少 ${key}`);
 return [key,value];
})));

// Only this context's newly reserved and exactly bound pages acquire ownership.
// Database history is audit evidence; it never restores page-closing authority.
export function setPageScope(context,input){
 let ledger=registries.get(context);
 if(!ledger){ledger=new PageOwnership(context,input.db);registries.set(context,ledger);}
 assert(ledger.db===input.db,'页面台账不能切换数据库');
 ledger.setScope(input);return ledger;
}
export const getPageLedger=context=>registries.get(context)||null;

export class PageOwnership {
 constructor(context,db){
  assert(context&&typeof context.pages==='function'&&db,'页面台账缺少 context 或数据库');
  this.context=context;this.db=db;this.sessionId=randomUUID();this.scope=null;this.fault=null;
  this.entries=new Map();this.pages=new WeakMap();this.reservations=new WeakMap();this.closeTickets=new WeakMap();
  this.baseline=new WeakSet(context.pages());this.peak=0;
  db.exec(`CREATE TABLE IF NOT EXISTS page_owner_sessions (
   id TEXT PRIMARY KEY,at TEXT NOT NULL,baseline_count INTEGER NOT NULL,peak_owned INTEGER NOT NULL DEFAULT 0);
   CREATE TABLE IF NOT EXISTS page_owner_pages (
   id TEXT PRIMARY KEY,session_id TEXT NOT NULL,origin TEXT NOT NULL,purpose TEXT NOT NULL,
   scope TEXT,target_id TEXT,browser_context_id TEXT,browser_window_id INTEGER,state TEXT NOT NULL,
   reason TEXT NOT NULL DEFAULT '',verified_item_id TEXT,at TEXT NOT NULL,updated TEXT NOT NULL,
   UNIQUE(session_id,target_id));
   CREATE TABLE IF NOT EXISTS page_owner_events (
   id INTEGER PRIMARY KEY,session_id TEXT NOT NULL,page_id TEXT NOT NULL,kind TEXT NOT NULL,
   scope TEXT,reason TEXT NOT NULL DEFAULT '',at TEXT NOT NULL);`);
  this.write(()=>db.prepare('INSERT INTO page_owner_sessions(id,at,baseline_count) VALUES(?,?,?)').run(this.sessionId,stamp(),context.pages().length));
  for(const page of context.pages())this.observe(page,'preexisting');
  this.onPage=page=>{try{this.observe(page,'manual-or-unknown');}catch{/* write() latched; never throw from browser event delivery */}};
  context.on?.('page',this.onPage);
 }
 write(fn){
  const savepoint='page_owner_'+randomUUID().replaceAll('-','');
  try{this.db.exec(`SAVEPOINT ${savepoint}`);const result=fn();this.db.exec(`RELEASE ${savepoint}`);return result;}
  catch(error){try{this.db.exec(`ROLLBACK TO ${savepoint}; RELEASE ${savepoint}`);}catch{}
   this.fault='PAGE_LEDGER_PERSISTENCE_FAILED';throw Object.assign(new Error('页面台账落盘失败；保留现场并停止下一商品',{cause:error}),{code:this.fault});}
 }
 assertHealthy(){assert(!this.fault,'页面台账落盘失败；保留现场并停止下一商品');}
 setScope(input){this.scope=scopeCopy(input);return this;}
 event(entry,kind,reason='',scope=entry.scope){
  this.db.prepare('INSERT INTO page_owner_events(session_id,page_id,kind,scope,reason,at) VALUES(?,?,?,?,?,?)').run(this.sessionId,entry.id,kind,scope?JSON.stringify(scope):null,reason,stamp());
 }
 insert(entry){
  this.db.prepare('INSERT INTO page_owner_pages(id,session_id,origin,purpose,scope,state,at,updated) VALUES(?,?,?,?,?,?,?,?)').run(entry.id,this.sessionId,entry.origin,entry.purpose,entry.scope?JSON.stringify(entry.scope):null,entry.state,stamp(),stamp());
  this.event(entry,entry.state);
 }
 observe(page,origin='manual-or-unknown'){
  if(this.pages.has(page))return this.pages.get(page);
  const entry={id:randomUUID(),origin,purpose:'unknown',scope:null,state:'observed',page,owned:false};
  this.write(()=>this.insert(entry));this.pages.set(page,entry);this.entries.set(entry.id,entry);return entry;
 }
 counts(){
  const active=this.context.pages().filter(live),own=[...this.entries.values()].filter(e=>e.owned&&e.state!=='closed'&&(!e.page||live(e.page)));
  return {sessionId:this.sessionId,total:active.length,baseline:active.filter(p=>this.baseline.has(p)).length,
   owned:own.length,reserved:own.filter(e=>!e.page).length,
   unknown:active.filter(p=>!this.baseline.has(p)&&!this.pages.get(p)?.owned).length,
   borrowed:active.filter(p=>this.pages.get(p)?.borrowed).length,
   retained:own.filter(e=>e.hold||['retained','orphaned'].includes(e.state)).length,peak:this.peak,fault:this.fault};
 }
 describe(page){
  const e=this.pages.get(page);return e?Object.freeze({id:e.id,sessionId:this.sessionId,origin:e.origin,purpose:e.purpose,owned:e.owned===true,
   targetId:e.targetId??null,state:e.state,reason:e.reason??'',scope:e.scope?scopeCopy(e.scope):null}):null;
 }
 snapshot(){return {counts:this.counts(),pages:[...this.entries.values()].filter(e=>e.owned&&e.state!=='closed').map(e=>({id:e.id,purpose:e.purpose,state:e.state,reason:e.reason??'',targetId:e.targetId??null,scope:scopeCopy(e.scope)}))};}
 assertCanStartTask(){this.assertHealthy();return this.counts();}
 reserveCreation({purpose}={}){
  this.assertHealthy();assert(this.scope,'尚未绑定任务页面归属');assert(purposes.has(purpose),'页面用途无效');
  const count=this.counts().owned;
  const entry={id:randomUUID(),origin:'executor-created',purpose,scope:scopeCopy(this.scope),state:'creation-intent',owned:true,page:null,before:new Set(this.context.pages())};
  const peak=Math.max(this.peak,count+1),ticket=Object.freeze({id:entry.id,sessionId:this.sessionId});
  this.write(()=>{this.insert(entry);this.db.prepare('UPDATE page_owner_sessions SET peak_owned=? WHERE id=?').run(peak,this.sessionId);});
  this.entries.set(entry.id,entry);this.reservations.set(ticket,entry);this.peak=peak;return ticket;
 }
 reservation(ticket){const e=this.reservations.get(ticket);assert(e&&e.state==='creation-intent','页面预留已使用或不属于当前会话');return e;}
 bindCreated(ticket,page,{targetId,browserContextId=null,browserWindowId=null}={}){
  const entry=this.reservation(ticket);
  assert(page&&live(page)&&this.context.pages().includes(page)&&!entry.before.has(page)&&!this.baseline.has(page),'禁止认领原有或其他 context 页面');
  assert(typeof targetId==='string'&&/^[\w-]{1,256}$/.test(targetId),'缺少精确页面 targetId');
  assert(browserContextId===null||typeof browserContextId==='string'&&/^[\w-]{1,256}$/.test(browserContextId),'browserContextId 无效');
  assert(browserWindowId===null||Number.isSafeInteger(browserWindowId),'browserWindowId 无效');
  const observed=this.pages.get(page);assert(!observed?.owned,'页面已有其他创建归属');
  this.write(()=>{
   // Observation is retained as an event; exact creation binds the reserved row.
   if(observed){this.event(observed,'exact-created-binding');this.db.prepare('UPDATE page_owner_pages SET state=?,updated=? WHERE id=?').run('bound-observation',stamp(),observed.id);}
   this.db.prepare('UPDATE page_owner_pages SET target_id=?,browser_context_id=?,browser_window_id=?,state=?,updated=? WHERE id=?').run(targetId,browserContextId,browserWindowId,'created',stamp(),entry.id);this.event(entry,'created');
  });
  entry.targetId=targetId;entry.state='created';entry.page=page;this.pages.set(page,entry);return Object.freeze({id:entry.id,targetId,sessionId:this.sessionId,scope:entry.scope});
 }
 creationFailed(ticket,{reason='CREATE_OR_BIND_UNCERTAIN'}={}){
  const entry=this.reservation(ticket);this.transition(entry,'orphaned',this.reason(reason));
 }
 reason(value){assert(typeof value==='string'&&/^[A-Z0-9_:-]{1,120}$/.test(value),'台账仅接受原因代码，不保存页面文本或 URL');return value;}
 transition(entry,state,reason=''){
  this.write(()=>{this.db.prepare('UPDATE page_owner_pages SET state=?,reason=?,updated=? WHERE id=?').run(state,reason,stamp(),entry.id);this.event(entry,state,reason);});entry.state=state;entry.reason=reason;
 }
 lease(page,{purpose}={}){
  assert(this.scope&&purposes.has(purpose)&&this.context.pages().includes(page)&&live(page),'页面借用归属或用途无效');
  const entry=this.pages.get(page)||this.observe(page);
  this.write(()=>this.event(entry,'borrowed:'+purpose,'',scopeCopy(this.scope)));entry.borrowed=true;
  // Borrowing NEVER changes origin, initial scope, purpose or close authority.
  return Object.freeze({pageId:entry.id,sessionId:this.sessionId,scope:scopeCopy(this.scope),purpose});
 }
 retain(page,{reason='PROTECTION_UNKNOWN'}={}){
  const entry=this.pages.get(page)||this.observe(page);assert(entry.state!=='closed','关闭页面不能再次标记保留');this.transition(entry,'retained',this.reason(reason));entry.hold=true;return {closed:false,reason};
 }
 ownedPublish(page){const e=this.pages.get(page);assert(e?.owned&&e.page===page&&e.purpose==='publish-form'&&this.context.pages().includes(page),'页面不是当前会话自有发布页');assert(scopeKeys.every(key=>e.scope[key]===this.scope?.[key]),'当前任务与页面创建归属不匹配');return e;}
 markVerified(page,{verifiedPersisted=false,itemId}={}){
  const entry=this.ownedPublish(page);assert(verifiedPersisted===true&&typeof itemId==='string'&&/^\d+$/.test(itemId),'成功记录及证据必须先落盘');
  assert(['created','retained'].includes(entry.state)&&live(page),'页面状态不允许记录核验');
  this.write(()=>{this.db.prepare('UPDATE page_owner_pages SET state=?,verified_item_id=?,updated=? WHERE id=?').run('verified-persisted',itemId,stamp(),entry.id);this.event(entry,'verified-persisted');});entry.state='verified-persisted';entry.itemId=itemId;
 }
 beginClose(page,{unpinnedConfirmed=false,guardPassed=false,manualPreserve=false,itemId}={}){
  this.assertHealthy();const entry=this.ownedPublish(page);
  assert(entry.state==='verified-persisted'&&entry.itemId===itemId&&live(page),'关闭前必须保存匹配商品核验结果');
  assert(unpinnedConfirmed===true&&guardPassed===true&&manualPreserve===false,'固定状态、人工保留或原成功页核验未确认；保留页面');
  assert(!entry.borrowed&&!entry.hold,'借用、常驻或明确保留页面不能自动关闭');
  this.transition(entry,'close-intent');const ticket=Object.freeze({id:entry.id,sessionId:this.sessionId});this.closeTickets.set(ticket,entry);return ticket;
 }
 finishClose(ticket,{closed=false}={}){
  const entry=this.closeTickets.get(ticket);assert(entry,'关闭回执不属于当前会话或已处理');
  // Consume before persistence or further validation: neither a failed write nor
  // a later lifecycle transition can reactivate this close attempt's receipt.
  this.closeTickets.delete(ticket);assert(entry.state==='close-intent','关闭回执不属于当前会话或已处理');
  if(closed===true&&entry.page.isClosed()){this.transition(entry,'closed');return {closed:true};}
  entry.hold=true;this.transition(entry,'retained','CLOSE_FAILED');return {closed:false,reason:'CLOSE_FAILED'};
 }
 dispose(){this.context.off?.('page',this.onPage);}
}
