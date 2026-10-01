import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,writeFile,readFile,copyFile,rm} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {resolve,join,dirname} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {SourceStore,digest,destinationKey} from '../workbench/source-store.mjs';
import {BatchStore} from '../workbench/batch-store.mjs';
import {TravelOsStore} from '../workbench/travel-os-store.mjs';
import {exportData,restoreData} from './migration-data.mjs';
const project=resolve(import.meta.dirname,'..');
async function write(p,v){await mkdir(dirname(p),{recursive:true});await writeFile(p,v);}
async function kernel(root){const lock=JSON.parse(await readFile(join(project,'workbench/kernel-lock.json'),'utf8'));for(const p of ['workbench/kernel-lock.json',...Object.keys(lock.files)]){await mkdir(dirname(join(root,p)),{recursive:true});await copyFile(join(project,p),join(root,p));}}
test('migration preserves business keys, history, quotes and bytes while rebasing paths and requiring new login',async t=>{
 const base=join(project,'output/migration-tests');await mkdir(base,{recursive:true});const dir=await mkdtemp(join(base,'roundtrip-'));t.after(async()=>{assert.equal(dirname(resolve(dir)),resolve(base));await rm(dir,{recursive:true,force:true});});
 const old=join(dir,'原机 空格'),target=join(dir,'新机 空格'),assets=join(dir,'外部图片'),pool=join(dir,'旧名称.xlsx'),renamed=join(dir,'新名称.xlsx'),heat=join(dir,'热度.xlsx');
 await kernel(old);await kernel(target);await write(renamed,'unchanged worksheet bytes');await write(heat,'heat bytes');await write(join(assets,'副图-B套/图.png'),'image bytes');
 const source=new SourceStore(join(old,'workbench/.runtime/source-workflow/state.sqlite'));new BatchStore(source);
 const task={shopId:'fixture-shop',priority:1,source:{workbook:pool,sha256:digest('unchanged worksheet bytes')},listing:{type:'city',country:'测试国',city:'测试城',title:'测试商品'},assets:{main:[{path:join(assets,'副图-B套/图.png'),sha256:digest('image bytes')}],secondary:[],details:[]},business:{},adapterIssues:[]};
 const imported=source.imported({sourceHash:task.source.sha256,workbook:pool,assetRoot:assets,tasks:[task]});
 const run=source.create(imported,task,'DRY_RUN','SOURCE',{taskHash:digest(task),reviewed:true});source.move(run.id,'RUNNING');
 await write(join(old,'workbench/.runtime/product-v1/settings.json'),JSON.stringify({executionEnabled:true,pool,heat,assets}));await write(join(old,'workbench/.runtime/jobs.json'),JSON.stringify({jobs:[],tasks:[]}));await write(join(old,'workbench/.runtime/shops.json'),JSON.stringify([{id:'fixture-shop',name:'测试店铺',port:9222,profileDir:'DO_NOT_COPY'}]));
 const os=new TravelOsStore(join(old,'workbench/.runtime/travel-os/product.sqlite'));os.addQuote({requestId:randomUUID(),kind:'COST',amount:100,currency:'CNY',service:'测试服务',unit:'人',supplier:'测试供给'}, {type:'city',country:'测试国',city:'测试城',destination:'测试城'});
 const archive=join(dir,'data.zip');await assert.rejects(exportData(old,archive,{aliases:{[pool]:renamed}}),/运行中/);source.move(run.id,'PAUSED');source.history(task,{itemId:'FIXTURE-ID',status:'测试成功记录'});source.close();os.close();
 await mkdir(join(old,'browser-profile/fixture-shop'),{recursive:true});await write(join(old,'browser-profile/fixture-shop/FORBIDDEN'),'must never be read or copied');
 const before=await readFile(join(old,'workbench/.runtime/product-v1/settings.json'),'utf8');const result=await exportData(old,archive,{aliases:{[pool]:renamed}});assert.equal(result.warnings,0);assert.equal(result.counts.source.history,1);assert.equal(await readFile(join(old,'workbench/.runtime/product-v1/settings.json'),'utf8'),before);
 const report=await restoreData(target,archive);assert.equal(report.counts.source.history,1);assert.equal(report.counts.product.quotes,1);assert.equal(existsSync(join(target,'browser-profile')),false);
 const cfg=JSON.parse(await readFile(join(target,'workbench/.runtime/product-v1/settings.json'),'utf8'));assert.equal(cfg.executionEnabled,false);assert.equal(await readFile(cfg.pool,'utf8'),'unchanged worksheet bytes');assert.equal(await readFile(join(cfg.assets,'副图-B套/图.png'),'utf8'),'image bytes');
 const restored=new SourceStore(join(target,'workbench/.runtime/source-workflow/state.sqlite'));const r=restored.run(run.id);assert.equal(r.id,run.id);assert.equal(r.state,'PAUSED');assert.equal(destinationKey(r.task),destinationKey(task));assert.equal(r.task.source.sha256,task.source.sha256);assert.equal(r.task.source.workbook,cfg.pool);assert.equal(restored.completed(r.task).itemId,'FIXTURE-ID');assert.equal(restored.events(run.id)[0].payload.review.taskHash,digest(task));restored.close();
 const original=new DatabaseSync(join(target,'workbench/.runtime/migration-original/source.sqlite'),{readOnly:true});assert.equal(JSON.parse(original.prepare('SELECT task FROM runs WHERE id=?').get(run.id).task).source.workbook,pool);original.close();
 await assert.rejects(restoreData(target,archive),/全新目录/);await assert.rejects(exportData(old,archive),/拒绝覆盖/);
 const corrupted=join(dir,'corrupted.zip'),untouched=join(dir,'拒绝损坏包');await kernel(untouched);
 await write(join(result.staging,'data/assets/副图-B套/图.png'),'tampered image');
 execFileSync('python',[join(import.meta.dirname,'migration-archive.py'),'pack',corrupted,result.staging],{windowsHide:true});
 await assert.rejects(restoreData(untouched,corrupted),/完整性失败/);assert.equal(existsSync(join(untouched,'workbench/.runtime')),false,'checksum rejection happens before business files are installed');
});
