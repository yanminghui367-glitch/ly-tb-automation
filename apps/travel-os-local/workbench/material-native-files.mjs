import assert from 'node:assert/strict';
import {readFile,lstat,readlink} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {toNamespacedPath} from 'node:path';
import {chromium} from 'playwright';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export const nativeUploadPath=(path,platform=process.platform)=>platform==='win32'?toNamespacedPath(path):path;
const probeUrl='http://127.0.0.1/__travel_native_material_probe';
// This is the exact public SDK already loaded by the official material page.
const sdkUrl='https://g.alicdn.com/taefed/pic-upload-sdk/0.0.11/picuploadsdk.js';
export const LEGACY_MATERIAL_SDK_SHA256='59b6d21fe7c5e646b1bad7bd3502854ef87060cd9c5bd72811faeda77844a6a7';
export function verifyLegacyMaterialSdk(source){
 assert(sha(source)===LEGACY_MATERIAL_SDK_SHA256&&Buffer.byteLength(source)<2000000&&/return 0===\w+\.size\?!0:void \w+\.files\.push/.test(source),'原批次官方空文件过滤组件版本无法确认');
 return {url:sdkUrl,sha256:LEGACY_MATERIAL_SDK_SHA256,skipsZero:true};
}

async function executableIdentity(browser){
 const session=await browser.newBrowserCDPSession();let pid;
 try{pid=(await session.send('SystemInfo.getProcessInfo')).processInfo.find(x=>x.type==='browser')?.id;}finally{await session.detach();}
 assert(Number.isSafeInteger(pid)&&pid>0,'无法确认原执行浏览器进程');
 const path=process.platform==='win32'?execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',`(Get-Process -Id ${pid} -ErrorAction Stop).Path`],{encoding:'utf8',windowsHide:true}).trim():await readlink(`/proc/${pid}/exe`);
 assert(path,'无法确认原执行浏览器程序');
 return {pid,path,sha256:sha(await readFile(path)),version:browser.version()};
}

// A separate anonymous context receives only an intercepted local HTML page.
// No seller session, cookies, platform uploader or upload request is involved.
export async function inspectNativeMaterialFiles(materialPage,files,{guard=async()=>{},legacy=false}={}){
 await guard();const browser=materialPage.context().browser();assert(browser,'原执行浏览器不可用');
 const disk=[];for(const file of files){const info=await lstat(file.path);assert(info.isFile()&&!info.isSymbolicLink(),'原图片副本不是普通文件');const bytes=await readFile(file.path);assert(bytes.length>0&&sha(bytes)===file.sha256,'原图片副本已变化');disk.push({name:file.name,path:file.path,sha256:file.sha256,size:bytes.length});}
 let sdk=null;const identity=await executableIdentity(browser);
 if(legacy){
  assert(process.platform==='win32','仅对已证实的Windows长路径空文件做恢复检查');
  // The uploader is lazy-loaded; restoring the material list need not insert
  // its script tag. Replay only the original, independently audited SDK bytes,
  // pinned by URL AND SHA, rather than requiring a new empty upload dialog.
  const response=await fetch(sdkUrl,{redirect:'error',signal:AbortSignal.timeout(15000)});assert(response.ok,'无法读取官方图片上传组件');sdk=await response.text();verifyLegacyMaterialSdk(sdk);
 }
 // Launch locally using the SAME executable. A CDP-attached Playwright client
 // may transfer files through short paths, hiding the original local-path bug.
 const offlineBrowser=await chromium.launch({executablePath:identity.path,headless:true,args:['--enable-automation']}),context=await offlineBrowser.newContext({serviceWorkers:'block',acceptDownloads:false}),blocked=[];
 try{
  await context.route('**/*',route=>route.request().url()===probeUrl?route.fulfill({contentType:'text/html',body:'<input id="native" type="file" multiple><button id="sdkButton">Select</button>'}):(blocked.push(new URL(route.request().url()).origin),route.abort()));
  const page=await context.newPage();page.setDefaultTimeout(10000);await page.goto(probeUrl,{timeout:10000});const input=page.locator('#native');
  if(legacy){await page.addScriptTag({content:sdk});await page.evaluate(()=>{window.__nativeProbeSDK=new mOxie.FileInput({browse_button:'sdkButton',multiple:true});window.__nativeProbeSDKFiles=[];window.__nativeProbeSDK.bind('change',()=>{window.__nativeProbeSDKFiles=window.__nativeProbeSDK.files.map(f=>({name:f.name,size:f.size}));});window.__nativeProbeSDK.init();});}
  const trials=[];
  for(const mode of legacy?['original','extended']:['extended']){
   await guard();const paths=files.map(f=>mode==='original'?f.path:nativeUploadPath(f.path));await input.setInputFiles(paths);
   const native=await input.evaluate(async node=>Promise.all([...node.files].map(async file=>{try{const bytes=await file.arrayBuffer(),digest=await crypto.subtle.digest('SHA-256',bytes);return {name:file.name,size:file.size,readBytes:bytes.byteLength,sha256:[...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('')};}catch(error){return {name:file.name,size:file.size,readError:error.name};}})));
   let sdkFiles=null;if(legacy){await page.locator('input[type=file]').nth(1).setInputFiles(paths);sdkFiles=await page.evaluate(()=>window.__nativeProbeSDKFiles);}
   trials.push({mode,files:native,sdkFiles});
  }
  const extended=trials.at(-1);assert(extended.files.length===disk.length&&disk.every(f=>extended.files.some(n=>n.name===f.name&&n.size===f.size&&n.readBytes===f.size&&n.sha256===f.sha256)),'浏览器未能完整读取待上传图片，尚未发送图片');
  if(legacy)assert(extended.sdkFiles.length===disk.length&&disk.every(f=>extended.sdkFiles.some(n=>n.name===f.name&&n.size===f.size)),'官方控件无法读取原图片副本');
  await guard();return {at:new Date().toISOString(),offline:true,networkBlocked:true,uploadRequests:0,blocked,chrome:identity,sdk:legacy?{url:sdkUrl,sha256:sha(sdk),skipsZero:true}:null,disk,trials};
 }finally{await context.close();await offlineBrowser.close();}
}
