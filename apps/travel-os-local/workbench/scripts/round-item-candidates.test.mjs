import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile,symlink} from 'node:fs/promises';
import {join} from 'node:path';
import {fixture} from './verify-http-fixture.mjs';
import {readItemCandidates} from '../round-item-candidates.mjs';
import {RoundItemApi} from '../round-item-api.mjs';
import {candidateEvidenceHtml} from '../round-item-detail.js';
function evidence(f){const key=f.scope().key;return {at:'2026-10-09T01:00:00Z',shop:f.round.shop.id,key,fresh:[{at:'2026-10-09T00:59:59Z',ids:['700001']}],match:{status:'candidates',key,candidates:[{key,itemId:'700001',title:'保存的候选标题',ambiguous:false,verification:'CANDIDATE_ONLY'}]}};}
async function file(f,value,attemptId){const dir=join(f.round.artifacts,f.r.id,'verification',f.scope().key,...(attemptId?['attempts',attemptId]:[]));await mkdir(dir,{recursive:true});const path=join(dir,'duplicate-check.json');await writeFile(path,typeof value==='string'?value:JSON.stringify(value));return path;}
const read=f=>readItemCandidates(f.round,f.action.reader.read(f.scope()),f.action.attempts);
test('original snapshot is read-only, scoped and explicitly unverified',async t=>{
 const f=await fixture(t),v=evidence(f),path=await file(f,v),before=f.store.db.prepare('SELECT total_changes() n').get().n;
 const r=await read(f);assert.equal(r.status,'AVAILABLE');assert.equal(r.items[0].itemId,'700001');assert.equal(r.items[0].queryObservedAt,v.fresh[0].at);assert.equal(r.source,'ORIGINAL');assert.match(r.evidenceSha256,/^[a-f0-9]{64}$/);
 assert.equal(f.store.db.prepare('SELECT total_changes() n').get().n,before);assert.equal(await readFile(path,'utf8'),JSON.stringify(v));assert.equal(f.calls(),0);assert.equal(f.flow.submits,0);
});
for(const [name,change] of Object.entries({shop:v=>v.shop='other',key:v=>v.key='wrong',match:v=>v.match.key='wrong',status:v=>v.match.status='absent',id:v=>v.match.candidates[0].itemId='javascript:alert(1)',duplicate:v=>v.match.candidates.push(v.match.candidates[0]),time:v=>v.at='yesterday',title:v=>v.match.candidates[0].title=null,candidateKey:v=>v.match.candidates[0].key='wrong',verified:v=>v.match.candidates[0].verification='VERIFIED',conflict:v=>v.match.candidates[0].ambiguousWith=['unrelated-key']}))test('bad '+name+' is unavailable, never absence or approval',async t=>{
 const f=await fixture(t),v=evidence(f);change(v);await file(f,v);const r=await read(f);assert.equal(r.status,'UNAVAILABLE');assert.equal(r.items,undefined);assert.equal(f.round.item(f.r.id,f.scope().key).state,'RESULT_UNKNOWN');assert.equal(f.calls(),0);
});
test('missing, malformed and oversized files are bounded without raw path leakage',async t=>{
 const f=await fixture(t);assert.equal((await read(f)).status,'UNAVAILABLE');
 for(const bytes of ['{','x'.repeat(2*1024*1024+1)]){await file(f,bytes);const r=await read(f);assert.equal(r.status,'UNAVAILABLE');assert(!JSON.stringify(r).includes(f.round.artifacts));}
});
test('latest scoped verification evidence wins; missing new snapshot explicitly falls back to dated original',async t=>{
 const f=await fixture(t);await file(f,evidence(f));const req=f.request();
 f.round.verifyExisting=async()=>null;await assert.rejects(f.action.verify(req));
 const attempt=f.action.attempts.list(f.r.id,f.scope().key).at(-1);assert.equal((await read(f)).source,'ORIGINAL');
 const v=evidence(f);v.match.candidates[0].title='更新的查重快照';await file(f,v,attempt.id);
 const r=await read(f);assert.equal(r.source,'VERIFICATION_ATTEMPT');assert.equal(r.attemptId,attempt.id);assert.equal(r.items[0].title,'更新的查重快照');
 await file(f,'{',attempt.id);assert.equal((await read(f)).status,'UNAVAILABLE');
});
test('large candidate set reports true total and only bounded display records',async t=>{
 const f=await fixture(t),v=evidence(f);v.match.candidates=Array.from({length:60},(_,i)=>({...v.match.candidates[0],itemId:String(700001+i)}));await file(f,v);
 const r=await read(f);assert.equal(r.total,60);assert.equal(r.items.length,50);assert.equal(r.truncated,true);
});
test('symlink evidence cannot read another location',async t=>{
 const f=await fixture(t),outside=join(f.round.artifacts,'outside');await mkdir(outside);await writeFile(join(outside,'duplicate-check.json'),JSON.stringify(evidence(f)));
 const parent=join(f.round.artifacts,f.r.id,'verification');await mkdir(parent,{recursive:true});await symlink(outside,join(parent,f.scope().key),'junction');assert.equal((await read(f)).status,'UNAVAILABLE');
});
test('non-isolated tasks do not advertise old candidate records',async t=>{
 const f=await fixture(t);await file(f,evidence(f));f.round.update(f.r.id,f.scope().key,{state:'PENDING'});assert.equal(await read(f),null);
});
test('detail endpoint projects evidence without granting retry or changing verification capability',async t=>{
 const f=await fixture(t);await file(f,evidence(f));const api=new RoundItemApi(f.action.reader,{host:f.host,verifier:f.action});
 const before=f.store.db.prepare('SELECT total_changes() n').get().n,r=await api.detail(f.scope());assert.equal(r.candidates.total,1);assert.equal(r.capabilities.retry.allowed,false);assert.equal(r.capabilities.verify.mode,'VERIFY');assert.equal(f.store.db.prepare('SELECT total_changes() n').get().n,before);
});
test('renderer escapes titles, fixes outbound URL and offers no candidate approval',()=>{
 const p={status:'AVAILABLE',recordedAt:'2026-10-09T01:00:00Z',source:'ORIGINAL',total:1,items:[{itemId:'700001',title:'<img src=x onerror=alert(1)>',ambiguous:true,conflicts:[{country:'<svg>',city:'例城'}],queryObservedAt:null}]};
 const html=candidateEvidenceHtml(p);assert(!html.includes('<img'));assert(!html.includes('<svg>'));assert(html.includes('https://item.taobao.com/item.htm?id=700001'));assert(html.includes('noopener noreferrer'));assert(!html.includes('<button'));assert(html.includes('不代表当前在售或已核验'));
 p.items[0].itemId='javascript:alert(1)';assert(!candidateEvidenceHtml(p).includes('href='));
});
test('damaged candidate rendering degrades to unavailable, never a broken detail or invented origin',()=>{
 const original={status:'AVAILABLE',source:'ORIGINAL',recordedAt:'2026-10-09T01:00:00Z',total:1,items:[{itemId:'700001',title:'例城',ambiguous:true,conflicts:[],queryObservedAt:null}]};
 for(const mutate of [p=>p.source='UNKNOWN',p=>p.items=[null],p=>p.items[0].conflicts=[null],p=>p.items[0].conflicts=[{country:null,city:7}],p=>p.items[0].queryObservedAt='bad',p=>p.recordedAt=1]){
  const p=structuredClone(original);mutate(p);const html=candidateEvidenceHtml(p);assert(html.includes('证据暂不可用'));assert(!html.includes('href='));
 }
});
