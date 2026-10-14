import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {SourceStore,digest} from '../source-store.mjs';
import {TravelOsApi} from '../travel-os-api.mjs';
import {BatchWorkflow} from '../batch-workflow.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
const shop={id:'isolated-shop',name:'隔离测试'};
async function fixture(t,n=2){
 const dir=await mkdtemp(join(tmpdir(),'ly-legacy-owner-')),source=new SourceStore(join(dir,'source.sqlite'));
 t.after(async()=>{source.close();assert(resolve(dir).startsWith(resolve(tmpdir())+sep));await rm(dir,{recursive:true,force:true});});
 const tasks=Array.from({length:n},(_,i)=>({taskId:'task-'+i,shopId:shop.id,priority:i+1,source:{},listing:{type:'city',country:'测试',city:'城市'+i,title:'标题'+i},assets:{main:[],secondary:[],details:[]},business:{},adapterIssues:[]}));
 const importId=source.imported({sheet:'境外城市热度',sourceHash:'fixture',tasks});let outcome='VERIFIED';
 const flow={store:source,runtime:dir,artifacts:dir,active:null,submits:0,
  launch(id){this.active=id;this.pending=Promise.resolve().then(()=>{source.move(id,'RUNNING');if(outcome==='VERIFIED'){source.move(id,'SUBMITTING');this.submits++;source.move(id,'VERIFIED','',{itemId:'1001'+this.submits,status:'出售中',rowText:'isolated verification',screenshot:'fixture.png'});}else source.move(id,'PAUSED','ordinary failure');}).finally(()=>this.active=null);},
  async resume({id}){source.move(id,'QUEUED');this.launch(id);},pause(){throw Error('Unused isolated pause');}};
 const batch=new BatchWorkflow(flow),b=batch.create({importId,limit:n,mode:'LIVE',review:{reviewed:true,selectionHash:batch.preview(importId,n).selectionHash,authorization:'isolated fixture'}},shop);
 const items=batch.store.items(b.id);
 const tables=()=>source.db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(x=>x.name);
 const snapshot=()=>JSON.stringify(tables().map(name=>[name,source.db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all()]));
 const adopt=({state='PAUSED',match='key',item=items[0],roundId='fixed-round'}={})=>{
  source.db.exec('CREATE TABLE IF NOT EXISTS rounds(id TEXT PRIMARY KEY,state TEXT); CREATE TABLE IF NOT EXISTS round_items(round_id TEXT,key TEXT,queue_id TEXT,run_id TEXT,state TEXT);');
  source.db.prepare('INSERT OR REPLACE INTO rounds VALUES(?,?)').run(roundId,state);
  source.db.prepare('INSERT INTO round_items VALUES(?,?,?,?,?)').run(roundId,match==='key'?item.key:'unrelated-key',match==='queue'?item.id:null,match==='run'?item.run_id:null,'PENDING');
 };
 return {source,flow,batch,b,items,tasks,importId,snapshot,adopt,setOutcome:value=>outcome=value};
}
const blocked=fn=>assert.throws(fn,e=>e.code==='FIXED_ROUND_OWNED');
for(const state of ['PAUSED','COMPLETED'])for(const action of ['start','retry','skip'])test(`${action} rejects ${state} fixed ownership before any persistent mutation`,async t=>{
 const x=await fixture(t);if(action==='retry'){x.batch.store.claim(x.items[0].id);x.batch.store.move(x.items[0].id,'FAILED','fixture old failure');}
 x.adopt({state});const before=x.snapshot();blocked(()=>action==='skip'?x.batch.skip(x.b.id,x.items[0].id,'operator reason'):x.batch[action](x.b.id,shop));
 assert.equal(x.snapshot(),before);assert.equal(x.flow.submits,0);assert.equal(x.batch.active,null);
});
test('queue identity protects ownership even when stored key disagrees',async t=>{const x=await fixture(t);x.adopt({match:'queue'});const before=x.snapshot();blocked(()=>x.batch.skip(x.b.id,x.items[0].id,'reason'));assert.equal(x.snapshot(),before);});
test('original run identity protects ownership independently of queue/key',async t=>{
 const x=await fixture(t),item=x.items[0],run=x.source.create(x.importId,item.task,'LIVE','SOURCE',{reviewed:true,taskHash:digest(item.task)});x.batch.store.attach(item.id,run.id);
 x.adopt({match:'run',item:x.batch.store.item(item.id)});const before=x.snapshot();blocked(()=>x.batch.start(x.b.id,shop));blocked(()=>x.batch.skip(x.b.id,item.id,'reason'));assert.equal(x.snapshot(),before);
});
test('older completed round protects item despite newer unrelated round',async t=>{
 const x=await fixture(t);x.adopt({state:'COMPLETED',roundId:'old-owned'});x.source.db.prepare('INSERT INTO rounds VALUES(?,?)').run('new-unrelated','COMPLETED');
 const reopened=new BatchWorkflow(x.flow),before=x.snapshot();blocked(()=>reopened.skip(x.b.id,x.items[0].id,'reason'));assert.equal(x.snapshot(),before);
});
test('unrelated round does not globally block an ordinary legacy batch',async t=>{
 const x=await fixture(t);x.adopt({item:{key:'other-key',id:'other-queue',run_id:null},state:'PAUSED'});
 x.batch.start(x.b.id,shop);await x.batch.pending;assert.equal(x.flow.submits,2);assert.equal(x.batch.store.view(x.b.id).counts.SUCCEEDED,2);
});
test('no fixed schema retains legacy start, ordinary failure retry and skip semantics',async t=>{
 const x=await fixture(t,3);x.setOutcome('PAUSED');x.batch.start(x.b.id,shop);await x.batch.pending;const first=x.batch.store.items(x.b.id)[0],runId=first.run_id;
 x.setOutcome('VERIFIED');x.batch.retry(x.b.id,shop);await x.batch.pending;assert.equal(x.flow.submits,1);assert.equal(x.batch.store.item(first.id).run_id,runId);assert.equal(x.batch.store.item(first.id).attempts,2);
 x.batch.skip(x.b.id,x.items[1].id,'reviewer skip');x.batch.start(x.b.id,shop);await x.batch.pending;assert.equal(x.flow.submits,2);assert.equal(x.batch.store.view(x.b.id).counts.SKIPPED,1);
});
test('lookup corruption fails closed without translating SQL errors to no ownership',async t=>{
 const x=await fixture(t);x.source.db.exec('CREATE TABLE round_items(unexpected TEXT)');const before=x.snapshot();assert.throws(()=>x.batch.skip(x.b.id,x.items[0].id,'reason'),/no such column/);assert.equal(x.snapshot(),before);
});

test('existing fixed parent with missing item table fails closed before old skip mutates any record',async t=>{
 const x=await fixture(t);x.adopt({state:'COMPLETED'});x.source.db.exec('DROP TABLE round_items');const before=x.snapshot();
 assert.throws(()=>x.batch.skip(x.b.id,x.items[0].id,'reason'),e=>e.code==='FIXED_ROUND_SCHEMA_INVALID');
 assert.equal(x.snapshot(),before);assert.equal(x.flow.submits,0);assert.equal(x.batch.active,null);
});

test('a view replacing the fixed ownership table is rejected before old skip can alter its preserved item',async t=>{
 const x=await fixture(t);x.adopt({state:'COMPLETED'});
 x.source.db.exec('ALTER TABLE round_items RENAME TO round_items_preserved; CREATE VIEW round_items AS SELECT * FROM round_items_preserved');const before=x.snapshot();
 assert.throws(()=>x.batch.skip(x.b.id,x.items[0].id,'reason'),e=>e.code==='FIXED_ROUND_SCHEMA_INVALID');
 assert.equal(x.snapshot(),before);assert.equal(x.flow.submits,0);assert.equal(x.batch.active,null);
});
test('retry scope cannot hide a fixed-owned completed item elsewhere in same batch',async t=>{
 const x=await fixture(t);x.adopt({item:x.items[1],state:'COMPLETED'});x.batch.store.claim(x.items[0].id);x.batch.store.move(x.items[0].id,'FAILED','ordinary failure');
 x.batch.store.event(x.b.id,null,'RETRY_SCOPE_SET',{ids:[x.items[0].id]});const before=x.snapshot();blocked(()=>x.batch.retry(x.b.id,shop));assert.equal(x.snapshot(),before);
});
test('actual OS adapter skip dispatch rejects fixed item and leaves every table unchanged',async t=>{
 const x=await fixture(t);x.adopt({state:'COMPLETED'});const before=x.snapshot();
 const product={shop,source:x.flow,batch:x.batch},api={product:async()=>product,catalog:async()=>({products:[],shops:[shop]}),store:{removed:()=>false}};
 await assert.rejects(()=>TravelOsApi.prototype.handle.call(api,{method:'POST'},{},new URL('http://isolated/api/os/batch/skip'),{body:async()=>({id:x.b.id,taskId:x.items[0].id,reason:'review'}),json:()=>{throw Error('Should reject before response');}}),e=>e.code==='FIXED_ROUND_OWNED');
 assert.equal(x.snapshot(),before);
});
test('raw route exact dispatch contract hits same guard (not a running HTTP integration)',async t=>{
 const x=await fixture(t);x.adopt({state:'COMPLETED'});const code=await readFile(resolve(root,'workbench/server.mjs'),'utf8');
 const line=code.split(/\r?\n/).find(line=>line.includes("url.pathname==='/api/batch/skip'"));assert(line);assert(line.includes('flow.skip(input.id,input.taskId,input.reason)'));
 const dispatch=new Function('url','json','res','flow','input',line),before=x.snapshot();
 blocked(()=>dispatch(new URL('http://isolated/api/batch/skip'),()=>{},null,x.batch,{id:x.b.id,taskId:x.items[0].id,reason:'review'}));assert.equal(x.snapshot(),before);
});
