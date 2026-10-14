// Read-only deployed UI check. Never click an execution or skip control.
import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
const base=process.env.QA_HTTP_BASE||'http://127.0.0.1:4318',out=resolve(process.env.QA_OUTPUT_DIR||resolve(import.meta.dirname,'../../output/current-skip-20261013/live'));
await mkdir(out,{recursive:true});
const writes=[],pageErrors=[],failedResources=[];
const browser=await chromium.launch({channel:'chrome',headless:true});
let page;
try{
 const context=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block'});
 await context.route('**/*',route=>{
  const req=route.request();
  if(!['GET','HEAD'].includes(req.method())){writes.push({method:req.method(),url:req.url()});return route.abort();}
  if(new URL(req.url()).origin!==base)return route.abort();
  return route.continue();
 });
 page=await context.newPage();page.on('pageerror',e=>pageErrors.push(e.message));page.on('response',r=>{if(r.status()>=400)failedResources.push({url:r.url(),status:r.status()});});
 await page.goto(base+'/travel-os.html#tasks',{waitUntil:'domcontentloaded',timeout:45000});await page.locator('.listing-round').waitFor({timeout:30000});
 const state=await(await context.request.get(base+'/api/v1/state')).json(),health=await(await context.request.get(base+'/api/v1/health')).json();
 const r=state.round;
 let capability=null;if(r?.current&&r.window){capability=await(await context.request.get(base+'/api/v1/rounds/item?'+new URLSearchParams({roundId:r.id,windowId:r.window.id,key:r.current.key}))).json();}
 const button=page.locator('[data-action="round-current-skip"]');
 const browserCrypto=await page.evaluate(()=>({secureContext:isSecureContext,randomUUID:typeof crypto.randomUUID,getRandomValues:typeof crypto.getRandomValues}));
 const result={at:new Date().toISOString(),base,browserCrypto,pid:health.pid,kernel:health.kernel,round:r&&{id:r.id,state:r.state,active:r.active,currentKey:r.current?.key,windowId:r.window?.id,counts:r.counts},buttonCount:await button.count(),label:await button.count()?await button.innerText():null,backendSkip:capability?.capabilities?.skip||null,submissionEvidence:capability?.submissionEvidence,postRequests:writes,pageErrors,failedResources};
 await page.locator('.listing-round').screenshot({path:join(out,'desktop.png')});
 await writeFile(join(out,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}catch(e){
 await page?.screenshot({path:join(out,'failure.png'),fullPage:true}).catch(()=>{});
 await writeFile(join(out,'failure.json'),JSON.stringify({error:e.message,pageErrors,failedResources,writes,body:await page?.locator('body').innerText().catch(()=>null)},null,2));
 throw e;
}finally{await browser.close();}
