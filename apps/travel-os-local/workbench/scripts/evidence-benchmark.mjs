// Offline mechanism comparison, not a Taobao publication/throughput benchmark.
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join,resolve,relative,isAbsolute} from 'node:path';
import {performance} from 'node:perf_hooks';
import {chromium} from 'playwright';
import {SourceStore,digest} from '../source-store.mjs';
import {ExecutionSteps} from '../execution-steps.mjs';
import {ExecutionTiming} from '../execution-timing.mjs';
import {captureTaskScreenshot} from '../task-screenshot.mjs';
const root=resolve(import.meta.dirname,'../..'),marker=JSON.parse(await readFile(join(root,'ISOLATED_DEV.json'),'utf8'));
assert.equal(resolve(marker.isolatedRoot),root);assert.equal(marker.testsUseSyntheticData,true);
const output=resolve(root,process.argv[2]||'output/evidence-benchmark'),rel=relative(join(root,'output'),output);
assert(rel&&!rel.startsWith('..')&&!isAbsolute(rel));await mkdir(output,{recursive:true});
const stages=['open-new-form',...Array.from({length:5},(_,i)=>`main-image-${i+1}`),'close-main-image-menu','title','guide-title','price','inventory','brand','custom-service','listing-state','shipping-time','logistics','freight-template','shipping-region','single-origin','ship-from','procurement','region-restriction','attribute-pattern','attribute-subject','attribute-style','attribute-people','attribute-size','open-details',...Array.from({length:9},(_,i)=>`select-detail-${i+1}`),'insert-details','pre-submit-review','submit-once','verify-platform-result'];
const browser=await chromium.launch({channel:'chrome',headless:true});const context=await browser.newContext({viewport:{width:1280,height:900}});
let blockedRequests=0;await context.route('**/*',r=>{blockedRequests++;return r.abort();});
const page=await context.newPage();await page.setContent('<html lang="zh"><body style="font:18px sans-serif;background:#f5f8fe;padding:30px"><h1>离线截图成本对照</h1><p>合成任务，无店铺、无登录、无平台提交</p><input id="value"><div style="display:grid;grid-template-columns:repeat(5,1fr);gap:15px">'+Array.from({length:40},(_,i)=>`<div style="padding:20px;background:hsl(${i*13} 55% 87%);border-radius:10px">合成素材 ${i+1}</div>`).join('')+'</div></body></html>');
await page.screenshot();const results=[];
try{
 for(const [index,mode] of ['full','key','key','full'].entries()){
  const dir=join(output,`${index+1}-${mode}`);await mkdir(dir);const store=new SourceStore(join(dir,'synthetic.sqlite'));
  try{
   const task={shopId:'offline',listing:{type:'country',country:'合成国',title:'离线截图对照'},adapterIssues:[]};
   const run=store.create('synthetic',task,'DRY_RUN','SOURCE',{reviewed:true,taskHash:digest(task)});store.move(run.id,'RUNNING');
   const timing=new ExecutionTiming();let steps,guards=0,actions=0,shots=0,bytes=0;
   const measuredPage={screenshot:async options=>{shots++;const data=await page.screenshot(options);bytes+=data.length;return data;}};
   steps=new ExecutionSteps({store,id:run.id,dir,timing,mode,getPage:()=>measuredPage,checkpoint:p=>store.checkpoint(run.id,p),errorText:e=>e.message,guard:()=>steps.measure('guard',async()=>{guards++;assert.equal(await page.locator('#value').count(),1);})});
   const start=performance.now();
   for(const name of stages){
    await steps.run(name,async()=>{actions++;await page.locator('#value').fill(name);
     if(name==='pre-submit-review')await steps.measure('review-evidence',()=>captureTaskScreenshot(measuredPage,dir,'pre-submit-full'));
     if(name==='verify-platform-result')await steps.measure('backend-evidence',()=>captureTaskScreenshot(measuredPage,dir,'backend-proof'));
    });
    if(name==='submit-once')await steps.measure('evidence',()=>captureTaskScreenshot(measuredPage,dir,'submit-success'));
   }
   const result={index:index+1,mode,elapsedMs:performance.now()-start,actions,guards,stepIntents:store.events(run.id).filter(e=>e.kind==='STEP_INTENT').length,stepVerified:store.events(run.id).filter(e=>e.kind==='STEP_VERIFIED').length,stepScreenshots:store.events(run.id).filter(e=>e.kind==='STEP_VERIFIED'&&e.payload.screenshot).length,totalScreenshots:shots,screenshotBytes:bytes,timing:timing.snapshot()};
   assert.equal(actions,41);assert.equal(guards,82);assert.equal(result.stepVerified,41);assert.equal(shots,mode==='key'?11:44);results.push(result);
   console.log(JSON.stringify({mode,elapsedMs:Math.round(result.elapsedMs),totalScreenshots:shots,guards}));
  }finally{store.close();}
 }
 const median=values=>{const sorted=values.toSorted((a,b)=>a-b);return (sorted[0]+sorted[1])/2;};
 const fullMs=median(results.filter(r=>r.mode==='full').map(r=>r.elapsedMs)),keyMs=median(results.filter(r=>r.mode==='key').map(r=>r.elapsedMs));
 const report={schemaVersion:1,at:new Date().toISOString(),scope:'isolated synthetic Chrome + actual ExecutionSteps/SQLite; no Taobao/network/login',platformThroughputVerified:false,blockedRequests,runs:results,comparison:{fullMedianMs:fullMs,keyMedianMs:keyMs,localReductionPercent:(1-keyMs/fullMs)*100,fullTotalScreenshots:44,keyTotalScreenshots:11},limits:['Only two runs per mode; not a stable production baseline.','Synthetic actions/guards and prepared local content do not model platform waits or uploads.','Three fixed proof captures model existing pre-submit, submit-success and backend captures; original publisher is unchanged.']};
 await writeFile(join(output,'benchmark.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report.comparison));
}finally{await context.close();await browser.close();}
