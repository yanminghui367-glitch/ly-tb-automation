import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SourceStore,digest,destinationKey} from '../source-store.mjs';
import {PublishingContentReviews} from '../publishing-content-review.mjs';
import {DEFAULT_IMAGE_REVIEW_POLICY} from '../image-review-policy.mjs';

async function fixture(t){
 const dir=await mkdtemp(join(tmpdir(),'ly-user-batch-images-')),store=new SourceStore(':memory:'),reviews=new PublishingContentReviews(store);
 t.after(async()=>{store.close();await rm(dir,{recursive:true,force:true});});
 const tasks=[];
 for(let n=1;n<=3;n++){
  const path=join(dir,n+'.png'),bytes='isolated fixture image '+n,secondPath=join(dir,n+'-second.png'),secondBytes='isolated second image '+n;await writeFile(path,bytes);await writeFile(secondPath,secondBytes);
  tasks.push({shopId:'shop-user-batch',listing:{type:'country',country:'目的地'+n,title:'目的地'+n+'导游'},assets:{main:[{path,sha256:digest(bytes)},{path:secondPath,sha256:digest(secondBytes)}]},adapterIssues:[]});
 }
 const items=tasks.map(task=>({key:destinationKey(task),task_hash:digest(task),task})),round={id:'user-batch-round',shop:tasks[0].shopId,manifest_hash:digest(items.map(x=>x.task_hash))};
 const rows=()=>store.db.prepare('SELECT * FROM publishing_content_reviews ORDER BY key').all(),core=()=>JSON.stringify({runs:store.db.prepare('SELECT * FROM runs').all(),history:store.db.prepare('SELECT * FROM history').all(),events:store.db.prepare('SELECT * FROM events').all()});
 return {dir,store,reviews,tasks,items,round,rows,core};
}

test('default policy records explicit user authorization and never pretends to be visual review',async t=>{
 const f=await fixture(t),before=f.core(),entries=f.reviews.prepareUserBatch(f.round,f.items);
 assert.equal(entries.length,3);assert.equal(f.rows().length,0);assert(Object.isFrozen(DEFAULT_IMAGE_REVIEW_POLICY));
 for(const entry of entries){assert.equal(entry.method,'user-batch-confirmation');assert.equal(entry.reviewer,'用户');assert.equal(entry.decision,'PASS');assert.equal(entry.observedText,'用户批量确认，未逐图目视审核');assert.deepEqual(entry.evidence,[]);assert.deepEqual(entry.policy,DEFAULT_IMAGE_REVIEW_POLICY);assert.equal(entry.policyVersion,DEFAULT_IMAGE_REVIEW_POLICY.version);assert.equal(entry.authorizationSource,DEFAULT_IMAGE_REVIEW_POLICY.source);}
 f.store.transaction(()=>f.reviews.save(entries));
 for(const task of f.tasks){const review=f.reviews.assertApproved(task,f.round);assert.equal(review.reason,'用户批量确认，未逐图目视审核');await f.reviews.verifyEvidence(review,task);}
 const saved=f.rows();assert.deepEqual(f.reviews.prepareUserBatch(f.round,f.items),[]);f.reviews.save(entries);assert.deepEqual(f.rows(),saved);assert.equal(f.core(),before);
});

test('bulk filling preserves PASS MISMATCH and UNREVIEWED decisions including prepare/save races',async t=>{
 const f=await fixture(t),pending=f.reviews.prepareUserBatch(f.round,f.items);
 const existing=pending.map((e,n)=>({...e,method:'direct-visual',reviewer:'human',observedText:'existing explicit decision',decision:['PASS','MISMATCH','UNREVIEWED'][n],evidence:[{path:f.tasks[n].assets.main[0].path,sha256:f.tasks[n].assets.main[0].sha256}]}));
 f.reviews.save(existing);const before=f.rows();assert.deepEqual(f.reviews.prepareUserBatch(f.round,f.items),[]);f.reviews.save(pending);assert.deepEqual(f.rows(),before);
 assert.equal(f.reviews.inspect(f.tasks[0],f.round).decision,'PASS');assert.throws(()=>f.reviews.assertApproved(f.tasks[1],f.round),e=>e.code==='CONTENT_MISMATCH');assert.throws(()=>f.reviews.assertApproved(f.tasks[2],f.round),e=>e.code==='CONTENT_REVIEW_REQUIRED');
});

test('client-facing prepare still rejects user-batch-confirmation method',async t=>{
 const f=await fixture(t),input={id:f.round.id,manifestHash:f.round.manifest_hash,method:'user-batch-confirmation',reviewer:'用户',entries:[]};
 await assert.rejects(f.reviews.prepare(f.round,f.items,input),e=>e.code==='CONTENT_REVIEW_INVALID');assert.equal(f.rows().length,0);
});

test('disabled, unknown or modified policy cannot create or accept batch approval',async t=>{
 const f=await fixture(t);f.reviews.save(f.reviews.prepareUserBatch(f.round,f.items));
 for(const policy of [null,{...DEFAULT_IMAGE_REVIEW_POLICY,enabled:false},{...DEFAULT_IMAGE_REVIEW_POLICY,version:'other'},{...DEFAULT_IMAGE_REVIEW_POLICY,scope:'ANY'},{...DEFAULT_IMAGE_REVIEW_POLICY,confirmedBy:'agent'}]){
  const reviews=new PublishingContentReviews(f.store,{policy});assert.deepEqual(reviews.prepareUserBatch(f.round,f.items),[]);assert.throws(()=>reviews.assertApproved(f.tasks[0],f.round),e=>e.code==='CONTENT_REVIEW_INVALID');
 }
});

test('empty or malformed main hashes receive no default review',async t=>{
 const f=await fixture(t);
 for(const main of [[],[{path:'unused',sha256:'bad'}],[{path:'unused',sha256:'a'.repeat(64)},{path:'unused',sha256:null}]]){
  const task=structuredClone(f.tasks[0]);task.assets.main=main;const item={key:destinationKey(task),task_hash:digest(task),task};assert.deepEqual(f.reviews.prepareUserBatch(f.round,[item]),[]);
 }
 assert.equal(f.rows().length,0);
});

test('wrong frozen identities and duplicate input keys are rejected without writes',async t=>{
 const f=await fixture(t);
 for(const change of [x=>x[0].key='forged',x=>x[0].task_hash='bad',x=>x[0].task.listing.title='changed',x=>x[0].task.shopId='other-shop',x=>x.push(x[0])]){
  const items=structuredClone(f.items);change(items);assert.throws(()=>f.reviews.prepareUserBatch(f.round,items),e=>e.code==='CONTENT_REVIEW_INVALID');assert.equal(f.rows().length,0);
 }
});

for(const field of ['shop','roundId','manifestHash','key','taskHash','mainHashes','method','reviewer','policyVersion','authorizationSource','observedText','policy','evidence','decision'])test('batch approval rejects tampered '+field,async t=>{
 const f=await fixture(t),entry=f.reviews.prepareUserBatch(f.round,f.items)[0];
 entry[field]=field==='evidence'?[{path:'fake'}]:field==='mainHashes'?['b'.repeat(64)]:field==='policy'?{...DEFAULT_IMAGE_REVIEW_POLICY,enabled:false}:'forged';
 f.store.db.prepare('INSERT INTO publishing_content_reviews VALUES(?,?,?,?)').run(f.round.id,f.items[0].key,JSON.stringify(entry),entry.reviewedAt);
 assert.throws(()=>f.reviews.assertApproved(f.tasks[0],f.round),e=>e.code==='CONTENT_REVIEW_INVALID');
});

test('missing policy metadata fails with structured content error',async t=>{
 const f=await fixture(t),entry=f.reviews.prepareUserBatch(f.round,f.items)[0];delete entry.policy;f.reviews.save([entry]);assert.throws(()=>f.reviews.assertApproved(f.tasks[0],f.round),e=>e.code==='CONTENT_REVIEW_INVALID');
});

test('all frozen main files remain checked at execution despite no visual evidence',async t=>{
 const f=await fixture(t);f.reviews.save(f.reviews.prepareUserBatch(f.round,f.items));const review=f.reviews.assertApproved(f.tasks[0],f.round);
 await writeFile(f.tasks[0].assets.main[0].path,'changed after batch confirmation');await assert.rejects(f.reviews.verifyEvidence(review,f.tasks[0]),e=>e.code==='CONTENT_REVIEW_INVALID');
 await rm(f.tasks[1].assets.main[0].path);await assert.rejects(f.reviews.verifyEvidence(f.reviews.assertApproved(f.tasks[1],f.round),f.tasks[1]),e=>e.code==='CONTENT_REVIEW_INVALID');
 await writeFile(f.tasks[2].assets.main[1].path,'changed secondary main image');await assert.rejects(f.reviews.verifyEvidence(f.reviews.assertApproved(f.tasks[2],f.round),f.tasks[2]),e=>e.code==='CONTENT_REVIEW_INVALID');
});

test('changed title, image order or manifest cannot reuse batch confirmation',async t=>{
 const f=await fixture(t);f.reviews.save(f.reviews.prepareUserBatch(f.round,f.items));
 const changed=structuredClone(f.tasks[0]);changed.listing.title='changed';assert.throws(()=>f.reviews.assertApproved(changed,f.round),e=>e.code==='CONTENT_REVIEW_INVALID');
 const reordered=structuredClone(f.tasks[0]);reordered.assets.main.reverse();assert.throws(()=>f.reviews.assertApproved(reordered,f.round),e=>e.code==='CONTENT_REVIEW_INVALID');
 assert.throws(()=>f.reviews.assertApproved(f.tasks[0],{...f.round,manifest_hash:'f'.repeat(64)}),e=>e.code==='CONTENT_REVIEW_INVALID');
 assert.equal(f.reviews.inspect(f.tasks[0],{...f.round,id:'other-round'}).decision,'UNREVIEWED');
});
