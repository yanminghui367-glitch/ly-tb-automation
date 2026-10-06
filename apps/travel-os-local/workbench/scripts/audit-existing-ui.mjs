// Run existing isolated suites without overwriting their historical evidence.
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
const root=resolve(import.meta.dirname,'..');
const output=resolve(process.env.QA_OUTPUT_DIR||join(root,'../output/qa-audit-20261004/existing-ui'));
await mkdir(output,{recursive:true});
const results=[];
const allowed=['quotes-ui-qa','travel-os-ui-qa','publishing-rules-ui-qa','attribute-navigation-qa'];
const names=process.argv.slice(2).length?process.argv.slice(2):allowed.slice(0,2);
if(names.some(n=>!allowed.includes(n)))throw Error('Only reviewed isolated suites are allowed');
for(const name of names){
 const out=join(output,name);await mkdir(out,{recursive:true});
 let source=await readFile(join(import.meta.dirname,name+'.mjs'),'utf8');
 source=source.replace(/from '([^']+)'/g,(match,spec)=>{
  if(spec==='playwright')return `from '${pathToFileURL(join(root,'node_modules/playwright/index.mjs')).href}'`;
  if(spec==='playwright/test')return `from '${pathToFileURL(join(root,'node_modules/playwright/test.mjs')).href}'`;
  return spec.startsWith('../')?`from '${pathToFileURL(resolve(import.meta.dirname,spec)).href}'`:match;
 });
 source=source.replace("resolve(import.meta.dirname,'..')",JSON.stringify(root));
 source=source.replace(/out=resolve\(root,'[^']+'\)/,'out='+JSON.stringify(out));
 source=source.replace(/out=resolve\(import.meta.dirname,'[^']+'\)/,'out='+JSON.stringify(out));
 const marker='const browser=await chromium.launch';
 if(!source.includes(marker))throw Error('Unknown isolated suite layout');
 source=source.replace(marker,`async function auditPage(browser,options={}){
 const context=await browser.newContext({...options,serviceWorkers:'block'});
 await context.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
 const page=await context.newPage();page.setDefaultTimeout(10000);return page;
 }
 ${marker}`);
 source=source.replace(/browser\.newPage\(/g,'auditPage(browser,');
 source=source.replace(/auditPage\(browser,\)/g,'auditPage(browser)');
 const generated=join(out,'isolated-suite.mjs');await writeFile(generated,source);
 const run=spawnSync(process.execPath,[generated],{encoding:'utf8',windowsHide:true,timeout:150000});
 await writeFile(join(out,'run.log'),(run.stdout||'')+(run.stderr||'')+(run.error?.message||''));
 results.push({suite:name,exitCode:run.status,error:run.error?.message||null,out});
 console.log(JSON.stringify(results.at(-1)));
}
await writeFile(join(output,'results.json'),JSON.stringify(results,null,2));
process.exitCode=results.some(r=>r.exitCode!==0)?1:0;
