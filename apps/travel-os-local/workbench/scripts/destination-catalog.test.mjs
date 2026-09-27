import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SourceStore,digest} from '../source-store.mjs';
import {BatchStore} from '../batch-store.mjs';
import {destinationCatalog,searchDestinations} from '../destination-catalog.mjs';
const shop='isolated-shop';
const task=(city,extra={})=>({shopId:shop,priority:1,source:{sheet:'资料',row:2},listing:{type:'city',country:'测试国家',city,title:city+'商品标题'},business:{price_cny:20,inventory:100},assets:{main:[{path:'D:/fixture/main.png',sha256:'fixture'}],secondary:[],details:[]},adapterIssues:[],...extra});
async function fixture(t){const dir=await mkdtemp(join(tmpdir(),'ly-destination-')),store=new SourceStore(join(dir,'test.sqlite'));new BatchStore(store);t.after(async()=>{store.close();await rm(dir,{force:true,recursive:true});});return store;}
test('catalogue merges latest pool and latest heat; new import issues supersede historical errors',async t=>{
 const store=await fixture(t),a=task('东京'),b=task('巴黎',{priority:2});
 store.imported({sourceHash:'old',workbook:'old.xlsx',tasks:[task('已移除'),a]});
 store.imported({sourceHash:'pool',workbook:'pool.xlsx',tasks:[{...a,adapterIssues:['旧错图']},b]});
 store.imported({sourceHash:'heat',workbook:'heat.xlsx',sheet:'境外城市热度',tasks:[a]});
 const c=destinationCatalog(store,shop);assert.equal(c.total,2);assert.equal(c.items[0].destination,'东京');assert.deepEqual(c.items[0].issues,[]);assert.equal(c.items[0].rank,1);assert.equal(c.items[1].rank,null);assert.equal(c.sources.length,2);
});
test('repeated import never duplicates rows and catalogue GET does not mutate the database',async t=>{
 const store=await fixture(t),payload={sourceHash:'same',workbook:'pool.xlsx',tasks:[task('东京'),task('东京')]};store.imported(payload);store.imported(payload);
 const before=store.db.prepare('SELECT total_changes() n').get().n;
 for(let i=0;i<3;i++)assert.equal(destinationCatalog(store,shop).total,1);
 assert.equal(store.db.prepare('SELECT total_changes() n').get().n,before);assert.equal(store.list().length,0);
});
test('verified destinations route to records and cannot be offered as a new publish action',async t=>{
 const store=await fixture(t),a=task('东京');store.imported({sourceHash:'x',workbook:'pool.xlsx',tasks:[a]});store.history(a,{itemId:'987654321',status:'仓库中'});
 const row=destinationCatalog(store,shop).items[0];assert.equal(row.state,'VERIFIED');assert.equal(row.duplicateBlocked,true);assert.equal(row.next.label,'查看上架记录');assert.match(row.next.href,/#records$/);assert.equal(row.itemId,'987654321');
});
test('unknown results and captcha route to handling conditions without starting or retrying',async t=>{
 const store=await fixture(t),tasks=[task('未知'),task('验证码',{priority:2})],id=store.imported({sourceHash:'x',tasks});
 for(const [i,ta] of tasks.entries()){const r=store.create(id,ta,'LIVE','SOURCE',{reviewed:true,taskHash:digest(ta)});store.move(r.id,'RUNNING');if(i===0){store.move(r.id,'SUBMITTING');store.move(r.id,'RESULT_UNKNOWN','需要核验');}else store.move(r.id,'PAUSED_CAPTCHA','CAPTCHA');}
 const c=destinationCatalog(store,shop);assert.equal(c.counts.published,0);assert(c.items.every(x=>x.duplicateBlocked&&x.next.href.endsWith('#exceptions')));assert.equal(store.list().length,2);
});
test('only matching shop is projected; search supports country title item ID and empty results',async t=>{
 const store=await fixture(t),a=task('Tokyo');store.imported({sourceHash:'x',tasks:[a,task('私有店铺',{shopId:'other'})]});store.history(a,{itemId:'123456789'});
 const c=destinationCatalog(store,shop);assert.equal(c.total,1);
 for(const q of ['Ｔｏｋｙｏ','测试国家','商品标题','123456789'])assert.equal(searchDestinations(c,q).matched,1);
  assert.equal(searchDestinations(c,'nothing').matched,0);assert.equal(searchDestinations(c,'',Infinity).limit,60);
 assert(!JSON.stringify(c).includes('sha256'));assert(!JSON.stringify(c).includes('D:/fixture'));
});
test('needs-data filter includes issues beyond the first hundred ranked destinations',async t=>{
 const store=await fixture(t),tasks=Array.from({length:130},(_,i)=>task('城市'+i,{priority:i+1,adapterIssues:i===125?['缺失主图']:[]}));
 store.imported({sourceHash:'many',sheet:'境外城市热度',tasks});const c=destinationCatalog(store,shop),filtered=searchDestinations(c,'',60,'needs-data');
 assert.equal(searchDestinations(c,'',100).items.length,100);assert.equal(filtered.matched,1);assert.equal(filtered.items[0].destination,'城市125');
});
test('empty catalogue stays empty rather than fabricating featured cities',async t=>{
 const store=await fixture(t),c=destinationCatalog(store,shop);assert.equal(c.total,0);assert.deepEqual(c.items,[]);assert.deepEqual(c.sources,[]);
});
