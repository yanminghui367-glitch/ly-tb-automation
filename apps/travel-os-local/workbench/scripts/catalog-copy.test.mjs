import test from 'node:test';import assert from 'node:assert/strict';import {resolve,join} from 'node:path';import {pathToFileURL,fileURLToPath} from 'node:url';import {readFile} from 'node:fs/promises';
const runtime=resolve(process.env.QA_RUNTIME_ROOT||fileURLToPath(new URL('../',import.meta.url)));
await import(pathToFileURL(join(runtime,'ui-copy.js')));const {mountOperationsCatalog}=await import(pathToFileURL(join(runtime,'operations-catalog-ui.js')));
function fixture(t,{reason='人工跳过：PAUSED_CAPTCHA',retryReason='ITEM_RETRY_SUBMISSION_PROTECTED',error=null}={}){
 const old=globalThis.document;globalThis.document={activeElement:null,hidden:true};
 const row={key:'original-key',status:'HUMAN',destination:'日本',country:'日本',title:'Original tour title',position:3,reason,retryReason,submitted:false},original=JSON.stringify(row);
 const root={innerHTML:'',addEventListener:()=>{},removeEventListener:()=>{},contains:()=>false,querySelector:()=>null};
 const api=mountOperationsCatalog(root,{shops:[{id:'shop',name:'测试店铺'}],initialShop:'shop',request:async()=>{if(error)throw Error(error);return {ok:true,json:async()=>({items:[row],counts:{HUMAN:1},packages:[{id:'pkg',name:'资料包',total:1}],selectedPackage:{id:'pkg',total:1}})};}});
 t.after(()=>{api.dispose();globalThis.document=old;});return {api,root,row,original};
}
test('catalog historical challenge and retry diagnostics render Chinese without changing original rows',async t=>{
 const f=fixture(t);await f.api.ready;assert.doesNotMatch(f.root.innerHTML,/PAUSED_CAPTCHA|ITEM_RETRY_SUBMISSION_PROTECTED/);assert.match(f.root.innerHTML,/验证码/);assert.equal(JSON.stringify(f.row),f.original);
});
test('catalog request failure uses the existing Chinese diagnostic renderer',async t=>{
 const f=fixture(t,{error:'ECONNREFUSED'});await f.api.ready;assert.doesNotMatch(f.root.innerHTML,/ECONNREFUSED/);assert.match(f.root.innerHTML,/连接被拒绝/);
});
test('catalog escaped data stays escaped and business titles remain original',async t=>{
 const f=fixture(t,{reason:'<script>PAUSED_CAPTCHA</script>'});await f.api.ready;assert.doesNotMatch(f.root.innerHTML,/<script>|PAUSED_CAPTCHA/);assert.match(f.root.innerHTML,/Original tour title/);assert.equal(JSON.stringify(f.row),f.original);
});
test('fallback product detail renders Chinese while original round details keep their own route',async()=>{
 const source=await readFile(join(runtime,'travel-os.js'),'utf8'),marker='onDetail:(row,shopId)=>{',start=source.indexOf(marker),end=source.indexOf('  }});',start);assert(start>=0&&end>start);
 const callback=new Function('row','shopId','dialog','$','uiCopy','esc','openCatalogItem',source.slice(start+marker.length,end)),escape=v=>String(v??'').replace(/[<>&"]/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]));
 const row={destination:'日本',title:'Original tour title',status:'待人工处理',reason:'PAUSED_CAPTCHA'},before=JSON.stringify(row);let html='',routed=0;
 const args=[(title,body)=>{html=body;},()=>({querySelector:()=>null}),globalThis.LyUiCopy,escape,()=>routed++];
 callback(row,'shop',...args);assert.match(html,/验证码/);assert.doesNotMatch(html,/PAUSED_CAPTCHA/);assert.match(html,/Original tour title/);assert.equal(JSON.stringify(row),before);
 html='';callback({...row,roundId:'original-round',windowId:'original-window'},'shop',...args);assert.equal(routed,1);assert.equal(html,'');
});
