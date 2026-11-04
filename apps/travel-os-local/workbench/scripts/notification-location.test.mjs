import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runInNewContext} from 'node:vm';
import {notificationUrl,validatedNotificationUrl,createWindowsPopup,notificationPowerShell,ExecutionNotificationMonitor} from '../execution-notifications.mjs';
await import('../ui-copy.js');
const {blockedActionsHtml}=await import('../round-item-detail.js');
const app=await readFile(new URL('../travel-os.js',import.meta.url),'utf8').then(s=>s.replace(/\r/g,''));
const parse=runInNewContext('('+app.match(/export (function notificationLocation\([\s\S]*?\n})\nlet notificationLocationHandled/)[1]+')',{URL});

test('notification location carries exact shop, round, window and original item',()=>{
 const value=notificationUrl({shopId:'shop-b',roundId:'round-b',windowId:'window-b',key:'country:fixture'}),u=new URL(value);
 assert.equal(u.searchParams.get('shop'),'shop-b');assert.equal(u.searchParams.get('item'),'country:fixture');
 assert.equal(JSON.stringify(parse(value,'shop-b')),JSON.stringify({shopId:'shop-b',roundId:'round-b',windowId:'window-b',key:'country:fixture'}));
 assert.equal(validatedNotificationUrl(value),value);
});
test('missing item location safely degrades; foreign shop and partial/duplicate location are rejected',()=>{
 const base='http://127.0.0.1:4318/travel-os.html';
 assert.equal(notificationUrl(),base+'#tasks');
 assert.equal(notificationUrl({shopId:'shop-b',roundId:'r',windowId:'w'}),base+'?shop=shop-b&round=r#tasks');
 assert.equal(parse(base+'?shop=shop-b#tasks','shop-b'),null);
 for(const query of ['shop=other&round=r','shop=shop-b&round=r&window=w','shop=shop-b&round=r&round=foreign','shop=shop-b&round=r&window=w&item=%3Cscript%3E'])assert.throws(()=>parse(base+'?'+query+'#tasks','shop-b'));
 for(const bad of ['https://evil.example/travel-os.html#tasks',base+'?command=resume#tasks',base+'?shop=b&window=w&item=k#tasks',base+'?shop=b&shop=c#tasks',base+'?shop=b#settings'])assert.throws(()=>validatedNotificationUrl(bad));
});
test('Windows launcher uses the validated event URL and never launches an invalid destination',async()=>{
 let invoked;
 const popup=createWindowsPopup({spawnProcess:(command,args,options)=>{invoked={command,args,options};const child=new EventEmitter();child.stdout=new EventEmitter();child.unref=()=>{};queueMicrotask(()=>{child.emit('spawn');child.stdout.emit('data',Buffer.from('TRAVEL_OS_NOTIFICATION_READY'));});return child;}});
 const url=notificationUrl({shopId:'shop-b',roundId:'r',windowId:'w',key:'k'});
 await popup({title:'暂停',message:'需要人工处理',url});
 assert.equal(invoked.args[invoked.args.indexOf('-Url')+1],url);assert.equal(invoked.options.windowsHide,true);
 invoked=null;await assert.rejects(popup({url:'https://evil.example',title:'x',message:'x'}));assert.equal(invoked,null);
});
test('a started process without the ready receipt is never accepted as a delivered notification',async()=>{
 const popup=createWindowsPopup({spawnProcess:()=>{const child=new EventEmitter();child.stdout=new EventEmitter();child.unref=()=>{};queueMicrotask(()=>{child.emit('spawn');child.emit('exit',1);});return child;}});
 await assert.rejects(popup({url:notificationUrl({shopId:'b'}),title:'暂停',message:'需要处理'}),/初始化失败/);
});
test('notification host selection uses existing approved hosts and never changes execution policy',()=>{
 assert.equal(notificationPowerShell({env:{TRAVEL_OS_POWERSHELL:'C:/known/pwsh.exe'},exists:p=>p==='C:/known/pwsh.exe'}),'C:/known/pwsh.exe');
 assert.match(notificationPowerShell({env:{ProgramFiles:'C:/Program Files'},exists:p=>p.includes('codex-primary-runtime'),home:'C:/fixture'}),/codex-primary-runtime/);
 assert.equal(notificationPowerShell({env:{},exists:()=>false,home:'C:/fixture'}),'powershell.exe');
 assert.throws(()=>notificationPowerShell({env:{TRAVEL_OS_POWERSHELL:'relative.exe'},exists:()=>true}));
});
test('cross-shop monitor notifications stay scoped and mismatched ownership degrades to shop only',async t=>{
 const runtime=await mkdtemp(join(tmpdir(),'notify-location-'));t.after(()=>rm(runtime,{recursive:true,force:true}));
 const sent=[],products=['shop-a','shop-b'].map(id=>{const r={id:'r-'+id,shop:id,state:'RUNNING',current_item:'k-'+id};return {shop:{id,name:id},r,round:{active:r.id,round:()=>r,item:()=>({task:{listing:{country:'测试'}}}),windows:{latest:()=>({id:'w-'+id})}}};});
 const monitor=new ExecutionNotificationMonitor({runtime,products:()=>products,notify:async e=>sent.push(e)});await monitor.check();
 for(const p of products)p.r.state='WAITING_HUMAN';await monitor.check();assert.equal(sent.length,2);
 for(let i=0;i<2;i++){const u=new URL(sent[i].url);assert.equal(u.searchParams.get('shop'),products[i].shop.id);assert.equal(u.searchParams.get('round'),products[i].r.id);}
 products[0].r.state='RUNNING';await monitor.check();products[0].r.shop='foreign';products[0].r.state='WAITING_HUMAN';await monitor.check();assert.equal(new URL(sent.at(-1).url).searchParams.get('round'),null);
});
test('blocked submitted items explain missing verification without exposing actions or raw machine codes',()=>{
 const html=blockedActionsHtml({current:{state:'RESULT_UNKNOWN'},capabilities:{park:{allowed:false,code:'ITEM_PARK_VERIFICATION_REQUIRED'},skip:{allowed:false,code:'ITEM_SKIP_SUBMISSION_PROTECTED'},verify:{allowed:false,code:'ITEM_VERIFY_WINDOW_ADAPTER_REQUIRED'},retry:{allowed:false,code:'ITEM_RETRY_BUDGET_EXHAUSTED'}}});
 assert.match(html,/先核验原商品/);assert.match(html,/已停止窗口/);assert.match(html,/不能据此跳过或重新发布/);assert.match(html,/次数/);assert.doesNotMatch(html,/<button|ITEM_/);
 assert.equal(blockedActionsHtml({current:{state:'NEW_SUCCESS'},capabilities:{retry:{allowed:false}}}),'');
});
test('actual PowerShell URL guard accepts scoped locations and rejects foreign or malformed destinations without displaying notifications',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'notify-ps-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const source=await readFile(new URL('../../tools/notify-workbench.ps1',import.meta.url),'utf8');
 const script=join(dir,'validate-only.ps1');
 await writeFile(script,'\uFEFF'+source.split('Add-Type -AssemblyName System.Windows.Forms')[0]+"\nWrite-Output 'VALIDATED'\n",'utf8');
 const base='http://127.0.0.1:4318/travel-os.html';
 const cases=[[base+'#tasks',true],[notificationUrl({shopId:'shop-b',roundId:'r',windowId:'w',key:'k'}),true],[base+'?shop=b&round=r#tasks',true],['https://evil.example/travel-os.html#tasks',false],[base+'?shop=b&window=w&item=k#tasks',false],[base+'?shop=b&item=k#tasks',false],[base+'?shop=b&shop=c#tasks',false],[base+'?shop=b&round=%0A#tasks',false]];
 for(const [url,allowed] of cases){const result=spawnSync(notificationPowerShell(),['-NoLogo','-NoProfile','-NonInteractive','-File',script,'-Title','fixture','-Message','fixture','-Url',url],{windowsHide:true,encoding:'utf8',timeout:10000});assert.equal(result.status,allowed?0:2,url+' '+result.stderr);assert.equal(result.stdout.includes('VALIDATED'),allowed);}
});
