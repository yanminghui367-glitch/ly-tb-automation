import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {readFile} from 'node:fs/promises';
import {waitMaterialReadiness,openMaterialUpload,DETAIL_MATERIAL_BUDGETS,MATERIAL_GUARD_ALLOWANCE_MS} from '../publishing-materials.mjs';
import {waitPreparedMaterialCard,waitMainMaterialFrame,waitDetailMaterialFrame} from '../taobao-publisher.mjs';

function clock(t){let ms=0;t.mock.method(performance,'now',()=>ms);return value=>{ms+=value;};}
const options={timeout:4000,selector:'synthetic',expected:'unique visible prepared card'};
const card={count:async()=>1,isVisible:async()=>true};

for(const reason of ['OVERALL_GUARD_TIMEOUT','OBSERVATION_TIMEOUT'])test('pre-file panel reopen is reserved for observation timeout: '+reason,async t=>{
 const advance=clock(t);let clicks=0,afterClick=false;const original=Error('second click reached; no file assigned'),diagnostics=[];
 const button={count:async()=>1,isVisible:async()=>true,isEnabled:async()=>true,evaluateAll:async()=>[],click:async()=>{clicks++;afterClick=true;}};
 const dialog={isVisible:async()=>false,count:async()=>{if(reason==='OBSERVATION_TIMEOUT')advance(8001);return 0;},evaluateAll:async()=>[]};
 const page={getByRole:role=>role==='dialog'?{filter:()=>dialog}:button,locator:()=>({count:async()=>0})};
 const guard=async()=>{if(clicks===2)throw original;if(afterClick){afterClick=false;if(reason==='OVERALL_GUARD_TIMEOUT')advance(29000);}};
 await assert.rejects(openMaterialUpload(page,guard,{readiness:{onDiagnostic:d=>diagnostics.push(d)}}),error=>reason==='OBSERVATION_TIMEOUT'?error===original:error.code==='MATERIAL_GUARD_BUDGET_EXHAUSTED'&&error.materialReadiness.timeoutReason===reason);
 assert.equal(clicks,reason==='OBSERVATION_TIMEOUT'?2:1);
 assert.equal(diagnostics.filter(d=>d.stage==='upload-panel'&&d.timeoutReason===reason).length,1);
});

test('observation budgets remain unchanged and guard allowance is separate and bounded',()=>{
 assert.deepEqual(DETAIL_MATERIAL_BUDGETS,{entry:20000,panel:8000,receipt:60000,thumbnail:30000,poll:150});
 assert.equal(MATERIAL_GUARD_ALLOWANCE_MS,20000);
});
test('prepared ready gets a real observation after both guards individually exceed old four seconds',async t=>{
 const advance=clock(t);let calls=0,inspections=0,diagnostic;
 const actual=await waitPreparedMaterialCard({count:async()=>{inspections++;return 1;},isVisible:async()=>true},async()=>{calls++;advance(4500);},{onDiagnostic:d=>{diagnostic=d;}});
 assert.deepEqual(actual,{matches:1,visible:true});assert.equal(inspections,1);assert.equal(calls,2);
 assert.equal(diagnostic.status,'ready');assert.equal(diagnostic.guardMs,9000);assert.equal(diagnostic.observeMs,0);
 assert.equal(diagnostic.observationTimeoutMs,4000);assert.equal(diagnostic.overallTimeoutMs,24000);assert.equal(diagnostic.elapsedMs,9000);assert.equal(diagnostic.exceededByMs,0);
});
test('a real slow starting guard over four seconds does not imply a missing prepared card',async()=>{
 let calls=0,diagnostic;
 await waitPreparedMaterialCard(card,async()=>{if(++calls===1)await delay(4100);},{onDiagnostic:d=>{diagnostic=d;}});
 assert.equal(calls,2);assert(diagnostic.guardMs>=4000);assert.equal(diagnostic.status,'ready');assert.equal(diagnostic.visible,true);assert(diagnostic.observeMs<4000);
});
test('a slow final guard within overall allowance can still confirm readiness',async t=>{
 const advance=clock(t);let calls=0,diagnostic;
 await waitPreparedMaterialCard(card,async()=>{if(++calls===2)advance(6000);},{onDiagnostic:d=>{diagnostic=d;}});
 assert.equal(diagnostic.status,'ready');assert.equal(diagnostic.guardMs,6000);assert.equal(diagnostic.timeoutReason,null);
});
test('real not-ready state exhausts observation budget and records explicit visibility without SAFE_RETRY code',async t=>{
 const advance=clock(t);let guards=0;
 await assert.rejects(waitMaterialReadiness('prepared-material-card',async()=>{advance(4001);return {ready:false,actual:{matches:1,visible:false}};},async()=>{guards++;},options),error=>{
  assert.equal(error.code,'MATERIAL_PREPARED_CARD_TIMEOUT');assert.match(error.message,/已准备图片等待超时/);assert.doesNotMatch(error.message,/详情/);
  const d=error.materialReadiness;assert.equal(d.timeoutReason,'OBSERVATION_TIMEOUT');assert.equal(d.actual.visible,false);assert.equal(d.count,1);assert.equal(d.guardMs,0);assert.equal(d.observeMs,4001);assert.equal(d.exceededByMs,1);return true;
 });assert.equal(guards,2);
});
test('ready cannot escape a final guard that exceeds the combined wall-clock ceiling',async t=>{
 const advance=clock(t);let guards=0;
 await assert.rejects(waitPreparedMaterialCard(card,async()=>{advance(++guards===1?10000:15000);}),error=>{
  const d=error.materialReadiness;assert.equal(error.code,'MATERIAL_GUARD_BUDGET_EXHAUSTED');assert.equal(d.timeoutReason,'OVERALL_GUARD_TIMEOUT');assert.equal(d.guardMs,25000);assert.equal(d.observeMs,0);assert.equal(d.exceededByMs,1000);assert.equal(d.actual.visible,true);return true;
 });assert.equal(guards,2);
});
test('observation and guard costs together enforce overall budget even while observation alone is below four seconds',async t=>{
 const advance=clock(t);let guards=0;
 await assert.rejects(waitMaterialReadiness('prepared-material-card',async()=>{advance(3500);return {ready:true,actual:{matches:1,visible:true}};},async()=>{guards++;advance(12000);},options),error=>{
  const d=error.materialReadiness;assert.equal(d.timeoutReason,'OVERALL_GUARD_TIMEOUT');assert.equal(d.guardMs,24000);assert.equal(d.observeMs,3500);assert.equal(d.elapsedMs,27500);assert.equal(d.exceededByMs,3500);return true;
 });assert.equal(guards,2);
});
test('an already exhausted initial guard does not start more inspection or another guard',async t=>{
 const advance=clock(t);let guards=0,inspections=0;
 await assert.rejects(waitMaterialReadiness('prepared-material-card',async()=>{inspections++;return {ready:true,actual:{matches:1,visible:true}};},async()=>{guards++;advance(25000);},options),e=>e.materialReadiness.timeoutReason==='OVERALL_GUARD_TIMEOUT');
 assert.equal(guards,1);assert.equal(inspections,0);
});
test('detail overall guard timeout does not acquire the existing SAFE_RETRY observation code',async t=>{
 const advance=clock(t);
 await assert.rejects(waitMaterialReadiness('thumbnail',async()=>({ready:true,actual:{cards:1,visible:true,decoded:true}}),async()=>{advance(25000);},options),e=>e.code==='MATERIAL_GUARD_BUDGET_EXHAUSTED'&&!e.code.startsWith('SAFE_RETRY_')&&e.materialReadiness.timeoutReason==='OVERALL_GUARD_TIMEOUT');
});
for(const final of [false,true])test('original safety error wins over expired budget in '+(final?'final':'starting')+' guard',async t=>{
 const advance=clock(t),original=Object.assign(Error('synthetic identity challenge'),{code:final?'SHOP_IDENTITY_CHANGED':'PAUSED_CAPTCHA'});let guards=0;
 await assert.rejects(waitPreparedMaterialCard(card,async()=>{guards++;if(!final||guards===2){advance(30000);throw original;}}),error=>error===original&&error.code===original.code&&error.materialReadiness.guardMs===30000);
 assert.equal(guards,final?2:1);
});
test('late inspect ready is not accepted after observation budget and detail retry code stays unchanged',async t=>{
 const advance=clock(t);let guards=0;
 await assert.rejects(waitMaterialReadiness('thumbnail',async()=>{advance(4001);return {ready:true,actual:{cards:1,visible:true,decoded:true}};},async()=>{guards++;},options),e=>e.code==='SAFE_RETRY_DETAIL_MATERIAL'&&e.materialReadiness.timeoutReason==='OBSERVATION_TIMEOUT'&&e.materialReadiness.decoded===true);
 assert.equal(guards,2);
});

// Execute the actual production branch text, rather than a copy of its rule.
const source=await readFile(new URL('../taobao-publisher.mjs',import.meta.url),'utf8');
const marker="const matchingCards=f.locator('.PicList_pic_background__pGTdV').filter({hasText:name}),card=a.preparedMaterial?matchingCards:matchingCards.first();";
const from=source.indexOf(marker),to=source.indexOf('  await ensureMaterial(f,a,card);',from);assert(from>=0&&to>from);
const branch=new (Object.getPrototypeOf(async function(){}).constructor)('card','f','name',source.slice(from+marker.length,to));
function fixture({count=1,visible=false,afterCount=1,afterVisible=true}={}){
 const calls={searches:0},state={count,visible},name='synthetic--'+'a'.repeat(30)+'.png';
 const item={count:async()=>state.count,isVisible:async()=>{assert.equal(state.count,1);return state.visible;}};
 const frame={getByPlaceholder:placeholder=>{assert.equal(placeholder,'搜索图片名称');return {fill:async actual=>{assert.equal(actual,name);calls.searches++;},press:async key=>{assert.equal(key,'Enter');state.count=afterCount;state.visible=afterVisible;}};}};
 return {calls,state,name,item,frame};
}
for(const [label,count,visible,searches]of [['unique hidden',1,false,1],['unique visible',1,true,0],['absent',0,false,1]])test('main search '+label+' performs only the necessary search',async()=>{
 const f=fixture({count,visible});await branch(f.item,f.frame,f.name);await waitPreparedMaterialCard(f.item,async()=>{});assert.equal(f.calls.searches,searches);
});
test('main ambiguity never searches or chooses first',async()=>{
 const f=fixture({count:2});await branch(f.item,f.frame,f.name);await assert.rejects(waitPreparedMaterialCard(f.item,async()=>{}),e=>/MATERIAL_PREPARATION_CARD_AMBIGUOUS/.test(e.message)&&e.materialReadiness.count===2&&e.materialReadiness.visible===null);assert.equal(f.calls.searches,0);
});
test('search result ambiguity retains refusal after exactly one search',async()=>{
 const f=fixture({count:0,afterCount:2});await branch(f.item,f.frame,f.name);await assert.rejects(waitPreparedMaterialCard(f.item,async()=>{}),/MATERIAL_PREPARATION_CARD_AMBIGUOUS/);assert.equal(f.calls.searches,1);
});
test('hidden search result remains unready and bounded without another search or upload',async t=>{
 const advance=clock(t),f=fixture({afterVisible:false});await branch(f.item,f.frame,f.name);
 await assert.rejects(waitPreparedMaterialCard(f.item,async()=>{advance(13000);}),e=>e.materialReadiness.timeoutReason==='OVERALL_GUARD_TIMEOUT');assert.equal(f.calls.searches,1);
 assert.doesNotMatch(source.slice(from+marker.length,to),/uploadMaterial|setInputFiles|submitTask/);
});

function disposableFrame(kind,cleanup,inspectError=null){
 const url='https://market.m.taobao.com/app/crs-qn/sucai-selector-ng/index';
 const control={count:async()=>1,isVisible:async()=>true,isEditable:async()=>true},frame={url:()=>url,isDetached:()=>false,getByPlaceholder:()=>control,getByRole:()=>control};
 const host={evaluate:async()=>true,isVisible:async()=>true,getAttribute:async()=>{if(inspectError)throw inspectError;return url;},contentFrame:async()=>frame,dispose:async()=>{throw cleanup;}};
 const hosts={count:async()=>1,elementHandle:async()=>host,evaluate:async()=>true,evaluateAll:async()=>[]},empty={count:async()=>0};
 return {frames:()=>[],locator:selector=>selector===(kind==='main'?'.media-img-plug iframe#mainImagesGroup:visible':'.media-img-plug iframe:not(#mainImagesGroup):visible')?hosts:empty};
}
for(const [kind,wait]of [['main',waitMainMaterialFrame],['detail',waitDetailMaterialFrame]]){
 test(kind+' frame disposal cannot replace original final safety guard failure',async()=>{
  const original=Object.assign(Error('synthetic captcha'),{code:'PAUSED_CAPTCHA'}),cleanup=Object.assign(Error('sensitive fixture URL must not enter diagnostic'),{code:'HANDLE_RELEASE_FAILED'});let guards=0;
  await assert.rejects(wait(disposableFrame(kind,cleanup),async()=>{if(++guards===2)throw original;},{timeout:100}),error=>error===original&&error.materialReadiness.cleanupFailure.code==='HANDLE_RELEASE_FAILED'&&!JSON.stringify(error.materialReadiness).includes(cleanup.message));
  assert.equal(guards,2);
 });
 test(kind+' frame preserves an inspection failure when cleanup also fails',async()=>{
  const original=Error('synthetic inspection failure'),cleanup=Error('synthetic cleanup failure');
  await assert.rejects(wait(disposableFrame(kind,cleanup,original),async()=>{},{timeout:100}),error=>error===original&&error.materialReadiness.cleanupFailure.code==='MATERIAL_FRAME_DISPOSE_FAILED');
 });
 test(kind+' frame successful readiness does not silently swallow disposal failure',async()=>{
  const cleanup=Error('synthetic cleanup failure');let guards=0;const diagnostics=[];
  await assert.rejects(wait(disposableFrame(kind,cleanup),async()=>{guards++;},{timeout:100,onDiagnostic:async d=>diagnostics.push(d)}),error=>error===cleanup&&error.materialReadiness.status==='failed'&&error.materialReadiness.cleanupFailure.code==='MATERIAL_FRAME_DISPOSE_FAILED');
  assert.equal(guards,2);
  assert.equal(diagnostics.length,1);assert.equal(diagnostics[0].status,'failed');
 });
}
