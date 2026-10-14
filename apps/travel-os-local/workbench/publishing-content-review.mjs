import {readFile} from 'node:fs/promises';
import {isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';
import {destinationKey,digest} from './source-store.mjs';

const invalid=message=>Object.assign(Error('CONTENT_REVIEW_INVALID: '+message),{code:'CONTENT_REVIEW_INVALID'});
const sha=value=>createHash('sha256').update(value).digest('hex');
const mainHashes=task=>(task.assets?.main||[]).map(a=>a.sha256);
const binding=(task,round)=>({shop:task.shopId,roundId:round.id,manifestHash:round.manifest_hash,key:destinationKey(task),taskHash:digest(task),mainHashes:mainHashes(task)});
const userConfirmedAlias=(task,round,review)=>{
 const policy=round.policies?.['dedham-transliteration'];
 return !!(policy?.enabled===true&&policy.scope==='EXACT_ITEM_ONLY'&&policy.key===destinationKey(task)&&policy.taskHash===digest(task)&&policy.country==='美国'&&policy.canonicalCity==='戴德姆'&&policy.observedAlias==='德德姆'&&task.listing?.country==='美国'&&task.listing?.city==='戴德姆'&&review.observedText==='德德姆'&&review.method==='user-confirmed-transliteration'&&review.reviewer===policy.confirmedBy&&Array.isArray(review.evidence)&&review.evidence.length===0);
};

// A review is an explicit observation of the immutable source image, not OCR,
// a filename match, a file-integrity check, or a seller listing receipt.
export class PublishingContentReviews {
 constructor(store){
  this.store=store;this.db=store.db;
  this.db.exec('CREATE TABLE IF NOT EXISTS publishing_content_reviews(round_id TEXT NOT NULL,key TEXT NOT NULL,payload TEXT NOT NULL,at TEXT NOT NULL,PRIMARY KEY(round_id,key))');
 }
 get(roundId,key){const row=this.db.prepare('SELECT payload FROM publishing_content_reviews WHERE round_id=? AND key=?').get(roundId,key);if(!row)return null;try{const value=JSON.parse(row.payload);if(!value||typeof value!=='object'||Array.isArray(value))throw Error('shape');return value;}catch{throw invalid('审核记录损坏');}}
 async prepare(round,items,input){
  if(input.manifestHash!==round.manifest_hash||input.id!==round.id)throw invalid('轮次或清单不一致');
  if(input.method!=='direct-visual'||typeof input.reviewer!=='string'||!input.reviewer.trim()||input.reviewer.length>160)throw invalid('须记录逐图目视核对及审核者');
  if(!Array.isArray(input.entries)||!input.entries.length||input.entries.length>items.length)throw invalid('审核范围为空或越界');
  const byKey=new Map(items.map(x=>[x.key,x])),seen=new Set(),prepared=[];
  for(const entry of input.entries){
   if(seen.has(entry.key))throw invalid('同一请求含重复商品');seen.add(entry.key);
   const item=byKey.get(entry.key);if(!item)throw invalid('商品不在固定清单');
   const expected=binding(item.task,round);
   if(item.key!==expected.key||item.task_hash!==expected.taskHash||item.task.shopId!==round.shop)throw invalid('商品或店铺身份与冻结清单不一致');
   if(entry.taskHash!==expected.taskHash||!Array.isArray(entry.mainHashes)||digest(entry.mainHashes)!==digest(expected.mainHashes)||!expected.mainHashes.length||expected.mainHashes.some(h=>!/^[a-f0-9]{64}$/.test(h||'')))throw invalid('任务或主图哈希不匹配');
   if(!['PASS','MISMATCH','UNREVIEWED'].includes(entry.decision)||typeof entry.observedText!=='string'||!entry.observedText.trim()||entry.observedText.length>1000)throw invalid('缺少明确结论和实际观察');
   if(!Array.isArray(entry.evidence)||!entry.evidence.length||entry.evidence.length>12)throw invalid('缺少目视证据');
   const evidence=[];
   for(const file of entry.evidence){if(!isAbsolute(file.path||'')||!/^[a-f0-9]{64}$/.test(file.sha256||''))throw invalid('证据路径或哈希无效');if(sha(await readFile(file.path))!==file.sha256)throw invalid('目视证据已变化');evidence.push({path:file.path,sha256:file.sha256});}
   for(const a of item.task.assets.main)if(sha(await readFile(a.path))!==a.sha256)throw invalid('审核时主图已改变');
   prepared.push({...expected,decision:entry.decision,observedText:entry.observedText.trim(),evidence,reviewer:input.reviewer.trim(),method:input.method,reviewedAt:new Date().toISOString()});
  }
  return prepared;
 }
 save(prepared){const put=this.db.prepare('INSERT INTO publishing_content_reviews(round_id,key,payload,at) VALUES(?,?,?,?) ON CONFLICT(round_id,key) DO UPDATE SET payload=excluded.payload,at=excluded.at');for(const entry of prepared)put.run(entry.roundId,entry.key,JSON.stringify(entry),entry.reviewedAt);}
 inspect(task,round){
  const expected=binding(task,round),review=this.get(round.id,expected.key);
  if(!review)return {decision:'UNREVIEWED',reason:'主图尚未逐图核对目的地，文件名和哈希一致不能代替内容审核'};
  const validDirect=review.method==='direct-visual'&&Array.isArray(review.evidence)&&review.evidence.length>0&&review.evidence.every(e=>isAbsolute(e?.path||'')&&/^[a-f0-9]{64}$/.test(e?.sha256||''));
  const validUserAlias=userConfirmedAlias(task,round,review);
  if(typeof review.reviewer!=='string'||!review.reviewer.trim()||!(validDirect||validUserAlias)||!Number.isFinite(Date.parse(review.reviewedAt))||!['PASS','MISMATCH','UNREVIEWED'].includes(review.decision)||typeof review.observedText!=='string'||!review.observedText.trim()||Object.keys(expected).some(k=>!Object.hasOwn(review,k)||digest(review[k])!==digest(expected[k])))throw invalid('审核与当前冻结素材或清单不一致');
  return {...review,reason:review.decision==='PASS'?'主图目的地已逐图目视核对':review.decision==='MISMATCH'?'主图目的地错配：'+review.observedText:'主图内容仍待核对：'+review.observedText};
 }
 assertApproved(task,round){const review=this.inspect(task,round);if(review.decision!=='PASS')throw Object.assign(Error((review.decision==='MISMATCH'?'CONTENT_MISMATCH: ':'CONTENT_REVIEW_REQUIRED: ')+review.reason),{code:review.decision==='MISMATCH'?'CONTENT_MISMATCH':'CONTENT_REVIEW_REQUIRED'});return review;}
 async verifyEvidence(review,task){
  try{for(const file of [...task.assets.main,...review.evidence])if(sha(await readFile(file.path))!==file.sha256)throw Error('changed');}
  catch{throw invalid('审核后主图或目视证据不可用或已变化，停止提交');}
 }
}
