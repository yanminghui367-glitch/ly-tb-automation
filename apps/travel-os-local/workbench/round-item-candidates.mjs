// Read saved duplicate-check evidence only. This never connects to the seller,
// approves a candidate, changes a task or infers absence from missing evidence.
import {lstat,realpath,open} from 'node:fs/promises';
import {join,relative,isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';
const MAX_BYTES=2*1024*1024,MAX_ITEMS=50;
const fail=()=>{throw Error('CANDIDATE_EVIDENCE_INVALID');};
const string=(v,max)=>typeof v==='string'&&v.length>0&&v.length<=max;
const time=v=>typeof v==='string'&&Number.isFinite(Date.parse(v));
const id=v=>typeof v==='string'&&/^\d{6,30}$/.test(v);
async function saved(root,parts){
 const base=await realpath(root);let path=base;
 for(const part of parts){
  if(!string(part,200)||part==='.'||part==='..'||/[\\/]/.test(part))fail();
  path=join(path,part);const stat=await lstat(path);if(stat.isSymbolicLink())fail();
 }
 const resolved=await realpath(path),rel=relative(base,resolved);
 if(!rel||rel==='..'||rel.startsWith('..\\')||rel.startsWith('../')||isAbsolute(rel))fail();
 const file=await open(resolved,'r');
 try{
  const stat=await file.stat();if(!stat.isFile()||stat.size>MAX_BYTES)fail();
  const buffer=Buffer.alloc(MAX_BYTES+1);let size=0;
  while(size<buffer.length){const r=await file.read(buffer,size,buffer.length-size,null);if(!r.bytesRead)break;size+=r.bytesRead;}
  if(size>MAX_BYTES)fail();const bytes=buffer.subarray(0,size);
  return {value:JSON.parse(bytes.toString('utf8')),sha256:createHash('sha256').update(bytes).digest('hex')};
 }finally{await file.close();}
}
export async function readItemCandidates(owner,s,attempts){
 if(s.x.state!=='RESULT_UNKNOWN'||s.x.failure_stage!=='existing-listing-check')return null;
 const unavailable={status:'UNAVAILABLE',reason:'未能读取完整的原查重证据。此条仍待核验，不能据此判断商品不存在或重新发布。'};
 try{
  const prefix=[s.r.id,'verification',s.x.key];let proof,source='ORIGINAL',attemptId=null;
  const latest=attempts.list(s.r.id,s.x.key).filter(a=>a.kind==='VERIFY_ONLY'&&a.window_id===s.w.id).at(-1);
  if(latest){
   try{proof=await saved(owner.artifacts,[...prefix,'attempts',latest.id,'duplicate-check.json']);source='VERIFICATION_ATTEMPT';attemptId=latest.id;}
   catch(e){if(e.code!=='ENOENT')throw e;}
  }
  proof??=await saved(owner.artifacts,[...prefix,'duplicate-check.json']);
  const v=proof.value;
  if(v.key!==s.x.key||v.shop!==s.r.shop||!time(v.at)||v.match?.key!==s.x.key||v.match.status!=='candidates'||!Array.isArray(v.match.candidates)||v.match.candidates.length<1||v.match.candidates.length>1000||!Array.isArray(v.fresh))fail();
  const seen=new Set(),tasks=new Map(owner.items(s.r.id).map(x=>[x.key,x.task.listing]));
  const items=v.match.candidates.map(c=>{
   if(!id(c.itemId)||seen.has(c.itemId)||!string(c.title,1000)||c.key!==s.x.key||c.verification!=='CANDIDATE_ONLY'||typeof c.ambiguous!=='boolean')fail();
   seen.add(c.itemId);
   if(c.ambiguousWith!==undefined&&(!Array.isArray(c.ambiguousWith)||c.ambiguousWith.some(k=>typeof k!=='string'||!tasks.has(k))))fail();
   const queries=v.fresh.filter(q=>Array.isArray(q.ids)&&q.ids.includes(c.itemId));
   if(queries.some(q=>!time(q.at)))fail();
   return {itemId:c.itemId,title:c.title,ambiguous:c.ambiguous,
    conflicts:(c.ambiguousWith||[]).filter(k=>k!==s.x.key).map(k=>{const t=tasks.get(k);return {country:t.country,city:t.city||null};}),
    queryObservedAt:queries.length?queries.map(q=>q.at).sort((a,b)=>Date.parse(b)-Date.parse(a))[0]:null};
  });
  return {status:'AVAILABLE',source,attemptId,recordedAt:v.at,total:items.length,items:items.slice(0,MAX_ITEMS),truncated:items.length>MAX_ITEMS,evidenceSha256:proof.sha256};
 }catch{return unavailable;}
}
