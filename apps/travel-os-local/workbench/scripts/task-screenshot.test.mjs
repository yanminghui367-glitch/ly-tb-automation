import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,mkdir,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname,resolve} from 'node:path';
import {SourceStore,digest} from '../source-store.mjs';
import {SourceWorkflow} from '../source-workflow.mjs';
import {captureTaskScreenshot} from '../task-screenshot.mjs';
const png=Buffer.from([137,80,78,71,13,10,26,10,0]);
async function directory(t){const dir=await mkdtemp(join(tmpdir(),'travel-shot-'));t.after(async()=>{assert.equal(dirname(resolve(dir)),resolve(tmpdir()));await rm(dir,{recursive:true,force:true});});return dir;}
test('repeated screenshots have different filenames and keep previous evidence bytes',async t=>{
 const dir=await directory(t),page={screenshot:({path})=>writeFile(path,png)};
 const first=await captureTaskScreenshot(page,dir,'paused'),second=await captureTaskScreenshot(page,dir,'paused');
 assert.notEqual(first.screenshot,second.screenshot);assert.deepEqual(await readFile(first.screenshot),png);assert.equal(second.screenshotError,null);
});
test('missing page, write failure, partial file and screenshot throw never advertise a path',async t=>{
 const dir=await directory(t);
 for(const page of [undefined,{screenshot:async()=>{throw Error('PAGE_CLOSED');}},{screenshot:async()=>{}},{screenshot:async({path})=>writeFile(path,'partial')}]){
  const result=await captureTaskScreenshot(page,dir,'paused');assert.equal(result.screenshot,null);assert(result.screenshotError);assert(result.screenshotAt);
 }
});
test('real workflow records screenshot failure and saves pause without retaining old paused.png',async t=>{
 let store;t.after(()=>store?.close());const dir=await directory(t);store=new SourceStore(join(dir,'state.sqlite'));
 const file=join(dir,'中文 # 素材.png');await writeFile(file,'fixture');const asset={path:file,sha256:digest(await readFile(file))};
 const task={shopId:'wuzhou-changyou',priority:1,source:{workbook:file,sha256:asset.sha256},listing:{type:'city',country:'测试国',city:'测试城市',title:'测试商品'},assets:{main:[asset],secondary:[asset,asset,asset,asset],details:[asset]},business:{category_path:'个性定制/设计服务/DIY>>其它定制>>其它商品定制',custom_service:true,procurement:'中国内地（大陆）',ship_from:'北京/北京',shipping_time:'24小时内发货',ship_from_region:'大陆及港澳台',region_restriction:'不设置商品维度区域限售模板',listing_time:'立刻上架'},adapterIssues:[]};
 const run=store.create('isolated',task,'DRY_RUN','SOURCE',{reviewed:true,taskHash:digest(task)}),artifacts=join(dir,'artifacts'),old=join(artifacts,run.id,'paused.png');
 await mkdir(dirname(old),{recursive:true});await writeFile(old,'OLD EVIDENCE');store.checkpoint(run.id,{screenshot:old});
 const page={frames:()=>[],url:()=> 'about:blank',setViewportSize:async()=>{throw Error('ISOLATED_PAGE_CLOSED');},screenshot:async()=>{throw Error('ISOLATED_SCREENSHOT_FAILED');}};
 const owner={status:async()=>({running:true,loggedIn:true}),sessions:new Map([['wuzhou-changyou',{context:{pages:()=>[],newPage:async()=>page}}]])};
 const flow=new SourceWorkflow(owner,{runtime:dir,artifacts,store});flow.launch(run.id,{id:'wuzhou-changyou'});await flow.pending;
 const saved=store.run(run.id),step=store.events(run.id).find(e=>e.kind==='STEP_PAUSED');
 assert.equal(saved.state,'PAUSED');assert.equal(saved.checkpoint.screenshot,null);assert.match(saved.checkpoint.screenshotError,/SCREENSHOT_FAILED/);
 assert.equal(step.payload.screenshot,null);assert.match(step.payload.screenshotError,/SCREENSHOT_FAILED/);
 assert.equal(await readFile(old,'utf8'),'OLD EVIDENCE');assert(!store.events(run.id).some(e=>['SUBMITTING','VERIFIED'].includes(e.kind)));
 assert.equal(JSON.parse(await readFile(join(artifacts,run.id,'checkpoint.json'),'utf8')).state,'PAUSED');
});
