import test from 'node:test';
import assert from 'node:assert/strict';
import {waitDetailMaterialFrame,waitMainMaterialFrame} from '../taobao-publisher.mjs';
const official='https://market.m.taobao.com/app/crs-qn/sucai-selector-ng/index';
function fixture(kind,initial={}){
 const s={src:null,frameUrl:'about:blank',hosts:1,other:0,same:true,connected:true,guardCalls:0,controlReads:0,disposed:0,captcha:false,...initial},diagnostics=[];
 const control={count:async()=>1,isVisible:async()=>true,isEditable:async()=>true};
 const frame={url:()=>s.frameUrl,isDetached:()=>false,getByPlaceholder:()=>{s.controlReads++;return control;},getByRole:()=>{s.controlReads++;return control;},locator:()=>({first:()=>({isVisible:async()=>false}),innerText:async()=>s.captcha?'请拖动滑块验证':''})};
 const h={evaluate:async()=>s.connected,isVisible:async()=>true,getAttribute:async()=>s.src,contentFrame:async()=>frame,dispose:async()=>{s.disposed++;}};
 const hosts={count:async()=>s.hosts,elementHandle:async()=>h,evaluate:async()=>s.same,evaluateAll:async()=>'<iframe></iframe>'};
 const selector=kind==='detail'?'.media-img-plug iframe:not(#mainImagesGroup):visible':'.media-img-plug iframe#mainImagesGroup:visible';
 const page={frames:()=>[frame],locator:q=>q===selector?hosts:{count:async()=>s.other}};
 const wait=kind==='detail'?waitDetailMaterialFrame:waitMainMaterialFrame;
 return {s,frame,diagnostics,run:async(update=()=>{},timeout=240)=>wait(page,async()=>{s.guardCalls++;await update(s);},{timeout,onDiagnostic:async d=>diagnostics.push(d)})};
}
for(const kind of ['detail','main']){
 for(const blank of [null,'','about:blank'])test(`${kind}: pending src ${JSON.stringify(blank)} becomes the same official ready frame`,async()=>{
  const f=fixture(kind,{src:blank});
  assert.equal(await f.run(s=>{if(s.guardCalls===2){s.src=official+'?token=secret';s.frameUrl=s.src;}},800),f.frame);
  assert(f.s.guardCalls>=3);assert.equal(f.s.disposed,1);
  assert.equal(f.diagnostics[0].actual.src,official);assert.equal(f.diagnostics[0].actual.frameUrl,official);
 });
 test(`${kind}: permanently absent src expires as readiness, with exact null and blank evidence`,async()=>{
  const f=fixture(kind),start=performance.now();
  await assert.rejects(f.run(),e=>e.code===(kind==='detail'?'SAFE_RETRY_DETAIL_PANEL':'SAFE_RETRY_MAIN_PANEL'));
  assert(performance.now()-start>=200);assert(performance.now()-start<1800);assert.equal(f.s.controlReads,0);
  assert.equal(f.diagnostics[0].actual.src,null);assert.equal(f.diagnostics[0].actual.frameUrl,'about:blank');
 });
 test(`${kind}: malicious src is never used and diagnostics contain no credentials, query or fragment`,async()=>{
  const f=fixture(kind,{src:'https://user:password@evil.example/picker?token=secret#secret',frameUrl:'https://evil.example/picker?token=secret'});
  await assert.rejects(f.run(),e=>e.code===`SAFE_RETRY_${kind.toUpperCase()}_FRAME_ORIGIN`);
  assert.equal(f.s.controlReads,0);assert.equal(f.diagnostics[0].actual.src,'https://evil.example/picker');
  assert.equal(f.diagnostics[0].actual.frameUrl,'https://evil.example/picker');
  assert(!JSON.stringify(f.diagnostics).match(/secret|password|user:/));
 });
 test(`${kind}: official src with unexpected frame URL is never returned`,async()=>{
  const f=fixture(kind,{src:official,frameUrl:'https://evil.example/picker'});
  await assert.rejects(f.run(),e=>e.code===`SAFE_RETRY_${kind.toUpperCase()}_FRAME_ORIGIN`);assert.equal(f.s.controlReads,0);
 });
 test(`${kind}: pending source does not hide a replaced host`,async()=>{
  const f=fixture(kind);
  await assert.rejects(f.run(s=>{if(s.guardCalls===2)s.same=false;}),e=>e.message.includes(`${kind.toUpperCase()}_MATERIAL_FRAME_CHANGED`)&&!String(e.code).startsWith('SAFE_RETRY_'));
 });
 test(`${kind}: pending source does not hide multiple pickers`,async()=>{
  const f=fixture(kind,{other:1});
  await assert.rejects(f.run(),e=>e.message.includes(`${kind.toUpperCase()}_MATERIAL_FRAME_AMBIGUOUS`)&&!String(e.code).startsWith('SAFE_RETRY_'));
 });
 test(`${kind}: CAPTCHA while source is pending remains human protection`,async()=>{
  const f=fixture(kind,{captcha:true});await assert.rejects(f.run(),/PAUSED_CAPTCHA/);assert.equal(f.s.controlReads,0);
 });
}
