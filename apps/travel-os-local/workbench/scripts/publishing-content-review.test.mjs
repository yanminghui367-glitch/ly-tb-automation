import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {createHash} from 'node:crypto';
import {SourceStore,digest,destinationKey} from '../source-store.mjs';
import {PublishingContentReviews} from '../publishing-content-review.mjs';

// Storage/binding tests only. These temporary byte fixtures are not real visual
// review evidence. No production database, browser, seller or network is used.
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const clone=value=>structuredClone(value);
async function fixture(t){
 const dir=await mkdtemp(join(tmpdir(),'ly-content-review-'));assert(resolve(dir).startsWith(resolve(tmpdir())+sep));
 const store=new SourceStore(join(dir,'test.sqlite')),reviews=new PublishingContentReviews(store);
 t.after(async()=>{store.close();await rm(dir,{recursive:true,force:true});});
 const artifact=async(name,bytes)=>{const path=join(dir,name);await writeFile(path,bytes);return {path,sha256:sha(bytes)};};
 const tasks=[];
 for(let n=1;n<=2;n++)tasks.push({taskId:'content-test-'+n,shopId:'content-test-shop',listing:{type:'city',country:'测试国家',city:'测试城市'+n,title:'测试标题'+n},assets:{main:[await artifact('main-'+n+'-1.bin','main bytes '+n+' first'),await artifact('main-'+n+'-2.bin','main bytes '+n+' second')]},business:{shop_name:'隔离测试店铺'},adapterIssues:[]});
 const evidence=await artifact('visual-evidence.bin','temporary evidence bytes');
 const items=tasks.map((task,i)=>({key:destinationKey(task),task_hash:digest(task),position:i+1,task}));
 const round={id:'content-test-round',shop:tasks[0].shopId,import_id:'test-import',manifest_hash:digest({shop:tasks[0].shopId,importId:'test-import',entries:items.map(x=>({key:x.key,position:x.position,taskHash:x.task_hash}))})};
 const entry=(i=0,decision='PASS')=>({key:items[i].key,taskHash:items[i].task_hash,mainHashes:tasks[i].assets.main.map(a=>a.sha256),decision,observedText:'测试替身观察，不代表真实素材审核',evidence:[clone(evidence)]});
 const input=entries=>({id:round.id,manifestHash:round.manifest_hash,method:'direct-visual',reviewer:' isolated-test-reviewer ',entries:entries||[entry()]});
 const baseline=()=>({runs:store.db.prepare('SELECT * FROM runs').all(),history:store.db.prepare('SELECT * FROM history').all(),events:store.db.prepare('SELECT * FROM events').all()});
 const rows=()=>store.db.prepare('SELECT * FROM publishing_content_reviews ORDER BY round_id,key').all();
 const prepare=custom=>reviews.prepare(round,items,custom||input());
 const save=prepared=>store.transaction(()=>reviews.save(prepared));
 const rejectPrepare=async(custom,code='CONTENT_REVIEW_INVALID',roundArg=round,itemsArg=items)=>{const original=baseline(),originalRows=rows();await assert.rejects(reviews.prepare(roundArg,itemsArg,custom),e=>{assert.equal(e.code,code);return true;});assert.deepEqual(baseline(),original);assert.deepEqual(rows(),originalRows);};
 let publishCalls=0;const attemptPublish=(task=tasks[0],r=round)=>{reviews.assertApproved(task,r);publishCalls++;};
 const attemptFreshPublish=async(task=tasks[0],r=round)=>{const review=reviews.assertApproved(task,r);await reviews.verifyEvidence(review,task);publishCalls++;};
 return {dir,store,reviews,tasks,items,round,evidence,artifact,entry,input,prepare,save,rows,baseline,rejectPrepare,attemptPublish,attemptFreshPublish,get publishCalls(){return publishCalls;}};
}

test('prepare validates actual files without writes; transactional save preserves exact review bindings',async t=>{
 const x=await fixture(t),before=x.baseline(),prepared=await x.prepare();assert.equal(x.rows().length,0);assert.equal(prepared.length,1);
 const p=prepared[0];assert.equal(p.shop,x.round.shop);assert.equal(p.roundId,x.round.id);assert.equal(p.manifestHash,x.round.manifest_hash);assert.equal(p.key,x.items[0].key);assert.equal(p.taskHash,digest(x.tasks[0]));assert.deepEqual(p.mainHashes,x.tasks[0].assets.main.map(a=>a.sha256));assert.deepEqual(p.evidence,[x.evidence]);assert.equal(p.reviewer,'isolated-test-reviewer');assert.equal(p.method,'direct-visual');assert(Number.isFinite(Date.parse(p.reviewedAt)));
 x.save(prepared);const read=x.reviews.inspect(x.tasks[0],x.round);assert.equal(read.decision,'PASS');assert.equal(read.reviewedAt,p.reviewedAt);assert.deepEqual(read.evidence,p.evidence);x.attemptPublish();assert.equal(x.publishCalls,1);assert.deepEqual(x.baseline(),before);
});

test('user-confirmed Dedham transliteration is exact-item scoped, keeps canonical frozen identity, and still checks file hashes',async t=>{
 const x=await fixture(t),task=x.tasks[0],item=x.items[0];task.listing={type:'city',country:'美国',city:'戴德姆',title:'戴德姆美国定制服务'};item.key=destinationKey(task);item.task_hash=digest(task);
 x.round.manifest_hash=digest({shop:x.round.shop,importId:x.round.import_id,entries:x.items.map(v=>({key:v.key,position:v.position,taskHash:v.task_hash}))});
 x.round.policies={'dedham-transliteration':{enabled:true,scope:'EXACT_ITEM_ONLY',key:item.key,taskHash:item.task_hash,country:'美国',canonicalCity:'戴德姆',observedAlias:'德德姆',confirmedBy:'用户确认'}};
 const review={shop:x.round.shop,roundId:x.round.id,manifestHash:x.round.manifest_hash,key:item.key,taskHash:item.task_hash,decision:'PASS',observedText:'德德姆',reviewer:'用户确认',method:'user-confirmed-transliteration',evidence:[],reviewedAt:new Date().toISOString(),mainHashes:task.assets.main.map(a=>a.sha256)};
 x.save([review]);const approved=x.reviews.assertApproved(task,x.round);assert.equal(approved.observedText,'德德姆');assert.equal(task.listing.city,'戴德姆');await x.reviews.verifyEvidence(approved,task);
 const altered=clone(task);altered.listing.city='戴德姆市';assert.throws(()=>x.reviews.assertApproved(altered,x.round),/审核记录损坏|审核与当前冻结素材|主图尚未逐图核对/);
});

test('missing review and explicit UNREVIEWED are fail closed, never MISMATCH',async t=>{
 const x=await fixture(t),before=x.baseline();assert.equal(x.reviews.inspect(x.tasks[0],x.round).decision,'UNREVIEWED');assert.throws(()=>x.attemptPublish(),e=>e.code==='CONTENT_REVIEW_REQUIRED');
 x.save(await x.prepare(x.input([x.entry(0,'UNREVIEWED')])));assert.equal(x.reviews.inspect(x.tasks[0],x.round).decision,'UNREVIEWED');assert.throws(()=>x.attemptPublish(),e=>e.code==='CONTENT_REVIEW_REQUIRED');assert.equal(x.publishCalls,0);assert.deepEqual(x.baseline(),before);
});

test('only explicit bound MISMATCH emits CONTENT_MISMATCH',async t=>{
 const x=await fixture(t);x.save(await x.prepare(x.input([x.entry(0,'MISMATCH')])));const before=x.baseline();assert.throws(()=>x.attemptPublish(),e=>e.code==='CONTENT_MISMATCH');assert.equal(x.publishCalls,0);assert.deepEqual(x.baseline(),before);assert.equal(x.reviews.inspect(x.tasks[0],x.round).decision,'MISMATCH');
});

test('filename-only, OCR, guessed decision and absent reviewer cannot approve',async t=>{
 const x=await fixture(t);
 for(const method of ['filename','ocr','hash-check',''])await x.rejectPrepare({...x.input(),method});
 for(const reviewer of ['',null,' '.repeat(5),'a'.repeat(161)])await x.rejectPrepare({...x.input(),reviewer});
 for(const decision of ['UNKNOWN','LIKELY_PASS','pass',null]){const e=x.entry();e.decision=decision;await x.rejectPrepare(x.input([e]));}
 assert.throws(()=>x.attemptPublish(),e=>e.code==='CONTENT_REVIEW_REQUIRED');assert.equal(x.publishCalls,0);
});

test('wrong round, manifest, out-of-scope key and requested task hash reject without writes',async t=>{
 const x=await fixture(t);await x.rejectPrepare({...x.input(),id:'other-round'});await x.rejectPrepare({...x.input(),manifestHash:'c'.repeat(64)});
 for(const patch of [{key:'outside-key'},{taskHash:'d'.repeat(64)}])await x.rejectPrepare(x.input([{...x.entry(),...patch}]));
 assert.equal(x.rows().length,0);assert.equal(x.publishCalls,0);
});

test('complete main hash collection is required in order and quantity',async t=>{
 const x=await fixture(t),hashes=x.entry().mainHashes;
 for(const mainHashes of [[],hashes.slice(0,1),[...hashes].reverse(),[...hashes,hashes[0]],[hashes[0],'0'.repeat(64)],['bad',hashes[1]]])await x.rejectPrepare(x.input([{...x.entry(),mainHashes}]));
 assert.equal(x.rows().length,0);
});

test('duplicate reviews, including identical duplicates, are rejected before persistence',async t=>{
 const x=await fixture(t),entry=x.entry();await x.rejectPrepare(x.input([entry,clone(entry)]));await x.rejectPrepare(x.input([entry,{...clone(entry),decision:'MISMATCH'}]));assert.equal(x.rows().length,0);
});

test('observed text and hashed absolute evidence are mandatory',async t=>{
 const x=await fixture(t);
 for(const observedText of ['',null,'   ','a'.repeat(1001)])await x.rejectPrepare(x.input([{...x.entry(),observedText}]));
 for(const evidence of [[],null,Array.from({length:13},()=>x.evidence),[{path:'relative-proof.bin',sha256:x.evidence.sha256}],[{path:x.evidence.path,sha256:'bad'}]])await x.rejectPrepare(x.input([{...x.entry(),evidence}]));
 assert.equal(x.rows().length,0);
});

test('changed evidence bytes invalidate preparation, not source-content classification',async t=>{
 const x=await fixture(t);await writeFile(x.evidence.path,'changed proof bytes');await x.rejectPrepare(x.input());assert.throws(()=>x.attemptPublish(),e=>e.code==='CONTENT_REVIEW_REQUIRED');assert.equal(x.publishCalls,0);
});

test('missing evidence and main files surface infrastructure errors without saving partial review',async t=>{
 for(const kind of ['evidence','main'])await t.test(kind,async t=>{const x=await fixture(t);await rm(kind==='evidence'?x.evidence.path:x.tasks[0].assets.main[0].path);await x.rejectPrepare(x.input(),'ENOENT');assert.throws(()=>x.attemptPublish(),e=>e.code==='CONTENT_REVIEW_REQUIRED');assert.equal(x.publishCalls,0);});
});

test('same source path with changed bytes fails actual hash check when preparing review',async t=>{
 const x=await fixture(t),path=x.tasks[0].assets.main[1].path;await writeFile(path,'changed main second image');await x.rejectPrepare(x.input());assert.equal(x.rows().length,0);assert.equal(x.publishCalls,0);
});

test('a later invalid entry prevents prepare from persisting earlier valid entry',async t=>{
 const x=await fixture(t),entries=[x.entry(0),x.entry(1)];entries[1].evidence[0].sha256='f'.repeat(64);await x.rejectPrepare(x.input(entries));assert.equal(x.rows().length,0);
});

test('caller transaction rolls back save and associated mutations together',async t=>{
 const x=await fixture(t),prepared=await x.prepare(x.input([x.entry(0),x.entry(1)]));
 assert.throws(()=>x.store.transaction(()=>{x.reviews.save(prepared);throw Error('simulated API validation failure');}),/simulated/);assert.equal(x.rows().length,0);
 x.save(prepared);assert.equal(x.rows().length,2);const before=x.rows();x.save(prepared);assert.deepEqual(x.rows(),before);
});

test('another key, shop or round cannot inherit a saved PASS',async t=>{
 const x=await fixture(t);x.save(await x.prepare());const otherShop={...clone(x.tasks[0]),shopId:'other-shop'};
 for(const [task,r] of [[x.tasks[1],x.round],[otherShop,x.round],[x.tasks[0],{...x.round,id:'different-round'}]]){assert.equal(x.reviews.inspect(task,r).decision,'UNREVIEWED');assert.throws(()=>x.attemptPublish(task,r),e=>e.code==='CONTENT_REVIEW_REQUIRED');}
 assert.equal(x.publishCalls,0);
});

test('changed frozen title, image order or path alias cannot reuse old PASS',async t=>{
 const x=await fixture(t);x.save(await x.prepare());const variants=[clone(x.tasks[0]),clone(x.tasks[0]),clone(x.tasks[0])];variants[0].listing.title='another title';variants[1].assets.main.reverse();const alias=await x.artifact('renamed-same-main.bin',await readFile(x.tasks[0].assets.main[0].path));variants[2].assets.main[0]=alias;
 for(const task of variants)assert.throws(()=>x.attemptPublish(task),e=>e.code==='CONTENT_REVIEW_INVALID');assert.equal(x.publishCalls,0);
 assert.throws(()=>x.attemptPublish(x.tasks[0],{...x.round,manifest_hash:'a'.repeat(64)}),e=>e.code==='CONTENT_REVIEW_INVALID');assert.equal(x.publishCalls,0);
});

test('stored binding tampering is invalid, not an automatic content mismatch',async t=>{
 const x=await fixture(t),prepared=await x.prepare();
 for(const field of ['shop','roundId','manifestHash','key','taskHash','mainHashes']){
  const altered=clone(prepared[0]);altered[field]=field==='mainHashes'?['b'.repeat(64)]:'different';x.store.db.prepare('INSERT OR REPLACE INTO publishing_content_reviews VALUES(?,?,?,?)').run(x.round.id,x.items[0].key,JSON.stringify(altered),altered.reviewedAt);
  assert.throws(()=>x.attemptPublish(),e=>e.code==='CONTENT_REVIEW_INVALID');
 }
 assert.equal(x.publishCalls,0);
});

test('corrupt JSON, invalid decision and missing metadata fail closed with explicit invalid code',async t=>{
 const x=await fixture(t),prepared=await x.prepare(),payloads=['{broken','[]',JSON.stringify({...prepared[0],decision:'UNKNOWN'}),JSON.stringify({...prepared[0],evidence:[]}),JSON.stringify({...prepared[0],reviewedAt:'not-a-time'})];
 for(const payload of payloads){x.store.db.prepare('INSERT OR REPLACE INTO publishing_content_reviews VALUES(?,?,?,?)').run(x.round.id,x.items[0].key,payload,'test');assert.throws(()=>x.attemptPublish(),e=>e.code==='CONTENT_REVIEW_INVALID');}assert.equal(x.publishCalls,0);
});

test('prepare rejects another-shop task even if request hashes match that task',async t=>{
 const x=await fixture(t),items=clone(x.items),other={...clone(x.tasks[0]),shopId:'other-shop'};items[0]={...items[0],key:destinationKey(other),task:other,task_hash:digest(other)};
 const entry={...x.entry(),key:items[0].key,taskHash:items[0].task_hash};await x.rejectPrepare(x.input([entry]),'CONTENT_REVIEW_INVALID',x.round,items);
});

test('prepare rejects item-key alias instead of saving review under another destination key',async t=>{
 const x=await fixture(t),items=clone(x.items);items[0].key='forged-item-key';await x.rejectPrepare(x.input([{...x.entry(),key:items[0].key}]),'CONTENT_REVIEW_INVALID',x.round,items);
});

test('prepare rejects changed task whose persisted task_hash no longer matches',async t=>{
 const x=await fixture(t),items=clone(x.items);items[0].task.listing.title='changed during review';const entry={...x.entry(),taskHash:digest(items[0].task)};await x.rejectPrepare(x.input([entry]),'CONTENT_REVIEW_INVALID',x.round,items);
});

test('structurally null review and omitted binding are explicit review errors',async t=>{
 for(const kind of ['null','missing-binding'])await t.test(kind,async t=>{const x=await fixture(t),prepared=await x.prepare(),withoutShop=clone(prepared[0]);delete withoutShop.shop;
  const payload=kind==='null'?'null':JSON.stringify(withoutShop);x.store.db.prepare('INSERT OR REPLACE INTO publishing_content_reviews VALUES(?,?,?,?)').run(x.round.id,x.items[0].key,payload,'test');assert.throws(()=>x.attemptPublish(),e=>e.code==='CONTENT_REVIEW_INVALID');assert.equal(x.publishCalls,0);
 });
});

test('unchanged files pass fresh evidence verification with matching stored review',async t=>{
 const x=await fixture(t);x.save(await x.prepare());const before=x.baseline();await x.attemptFreshPublish();assert.equal(x.publishCalls,1);assert.deepEqual(x.baseline(),before);
});

test('post-review change in any main or evidence file blocks final action',async t=>{
 for(const kind of ['main-first','main-second','evidence'])await t.test(kind,async t=>{
  const x=await fixture(t);x.save(await x.prepare());const before=x.baseline(),saved=x.rows();const path=kind==='evidence'?x.evidence.path:x.tasks[0].assets.main[kind==='main-first'?0:1].path;await writeFile(path,'changed after stored PASS');
  await assert.rejects(x.attemptFreshPublish(),e=>e.code==='CONTENT_REVIEW_INVALID');assert.equal(x.publishCalls,0);assert.deepEqual(x.baseline(),before);assert.deepEqual(x.rows(),saved);
 });
});

test('post-review missing evidence is infrastructure failure, not MISMATCH or approval',async t=>{
 for(const kind of ['main','evidence'])await t.test(kind,async t=>{
  const x=await fixture(t);x.save(await x.prepare());const before=x.baseline();await rm(kind==='main'?x.tasks[0].assets.main[0].path:x.evidence.path);
  await assert.rejects(x.attemptFreshPublish(),e=>e.code==='CONTENT_REVIEW_INVALID');assert.equal(x.publishCalls,0);assert.deepEqual(x.baseline(),before);
 });
});
