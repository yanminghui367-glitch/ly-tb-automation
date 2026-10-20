// Isolated DOM/request doubles only: no server, browser, production DB or item.
import test from 'node:test';
import assert from 'node:assert/strict';
import {setup} from './skip-independent-fixture.mjs';
import {RoundItemVerify} from '../round-item-verify.mjs';
import {RoundItemHostGuard} from '../round-item-host.mjs';
import {RoundItemApi} from '../round-item-api.mjs';
await import('../ui-copy.js');
const {mountRoundItemDetail}=await import('../round-item-detail.js');

const scope={roundId:'round',windowId:'window',key:'country:fixture'};
const decode=s=>s.replace(/&(amp|lt|gt|quot|#39);/g,(_,k)=>({amp:'&',lt:'<',gt:'>',quot:'"','#39':"'"}[k]));
class Element {
  constructor(attributes='',value=''){this.attributes=attributes;this.value=decode(value);this.disabled=/\bdisabled\b/.test(attributes);this.listeners=new Map();this.elements={};}
  addEventListener(kind,fn){this.listeners.set(kind,fn);}
  emit(kind,extra={}){return this.listeners.get(kind)?.({preventDefault(){},target:this,...extra});}
  querySelector(selector){return selector==='textarea'?Object.values(this.elements)[0]:null;}
  focus(){}
}
class Root {
  set innerHTML(html){
    this.html=html;this.nodes=new Map();
    for(const m of html.matchAll(/<form\s+([^>]+)>([\s\S]*?)<\/form>/g)){
      const name=m[1].match(/\b(data-item-[\w-]+)/)?.[1];if(!name)continue;
      const form=new Element(m[1]);
      for(const field of m[2].matchAll(/<textarea\s+([^>]+)>([\s\S]*?)<\/textarea>/g))form.elements[field[1].match(/name="([^"]+)"/)[1]]=new Element(field[1],field[2]);
      form.submit=new Element(m[2].match(/<button\s+([^>]+)>/)?.[1]||'');this.nodes.set('['+name+']',form);
    }
    for(const m of html.matchAll(/<button\s+([^>]+)>[\s\S]*?<\/button>/g)){
      const action=m[1].match(/data-item-action="([^"]+)"/)?.[1];if(action)this.nodes.set('[data-item-action="'+action+'"]',new Element(m[1]));
    }
  }
  get innerHTML(){return this.html;}
  querySelector(selector){return this.nodes?.get(selector)||null;}
  replaceChildren(){this.innerHTML='';}
}
const memoryStorage=()=>{const values=new Map();return {values,getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};};
const response=(value,status=200)=>({ok:status>=200&&status<300,status,json:async()=>structuredClone(value)});
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const settle=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(options={}){
  const detail={...scope,revision:'revision-before',shopId:'fixture-shop',manifestHash:'manifest-original',taskHash:'task-original',
    current:{key:scope.key,state:'RESULT_UNKNOWN',submitted:true,submissionUncertain:true,title:'隔离测试商品',destination:'测试国家',reason:'提交结果待核验'},
    submissionEvidence:true,retryBlocked:true,parking:null,attempts:[],capabilities:{park:{allowed:true,reason:'可以挂起',code:null},skip:{allowed:false,reason:'已提交，禁止跳过'},retry:{allowed:false},verify:{allowed:true,mode:'VERIFY',reason:'可核验原商品'}}};
  const calls=[],storage=options.storage||memoryStorage(),receipts=new Map(),resumeIds=new Set();
  let ids=0,decisions=0,lostPark=!!options.losePark,lostResume=!!options.loseResume;
  const request=async(path,init={})=>{
    const input=init.body?JSON.parse(init.body):null;calls.push({path,input,method:init.method||'GET'});
    if(path.startsWith('/api/v1/rounds/item?'))return response(detail);
    if(path==='/api/v1/rounds/item-park'){
      if(options.parkWait)await options.parkWait.promise;
      if(options.parkStatus)return response({code:options.parkCode||'ITEM_PARK_STALE_REVISION',error:options.parkCode||'ITEM_PARK_STALE_REVISION'},options.parkStatus);
      let receipt=receipts.get(input.requestId),replayed=!!receipt;
      if(!receipt){
        decisions++;
        const parking={eventSeq:41,actor:{name:input.confirmedBy,identitySource:'LOCAL_OPERATOR_DECLARATION'},at:'2026-10-19T08:00:00Z',reason:input.reason,evidence:{originalSubmitEvent:17},notice:'提交结果未定，需人工后台确认'};
        receipt={replayed:false,eventSeq:41,...scope,requestId:input.requestId,state:'RESULT_UNKNOWN',submitted:true,retryBlocked:true,parking,
          continueRequest:{id:scope.roundId,shopId:detail.shopId,windowId:scope.windowId,manifestHash:detail.manifestHash,requestId:'resume-original',humanVerified:false}};
        receipts.set(input.requestId,receipt);detail.parking=structuredClone(parking);detail.revision='revision-parked';detail.capabilities.park.allowed=false;
      }
      if(lostPark){lostPark=false;throw Error('simulated lost park response');}
      const output=structuredClone({...receipt,replayed});options.changeReceipt?.(output);return response(output);
    }
    if(path==='/api/v1/rounds/resume'){
      if(options.resumeWait)await options.resumeWait.promise;
      if(options.resumeStatus)return response({code:'CAPTCHA_REQUIRED',error:'CAPTCHA_REQUIRED'},options.resumeStatus);
      resumeIds.add(input.requestId);
      if(lostResume){lostResume=false;throw Error('simulated lost resume response');}
      return response(Object.hasOwn(options,'resumeReceipt')?options.resumeReceipt:{id:scope.roundId,shop:detail.shopId,manifestHash:detail.manifestHash,window:{id:scope.windowId},active:true,state:'RUNNING'});
    }
    if(path==='/api/v1/rounds/item-verify'&&options.verifyWait){await options.verifyWait.promise;return response({code:'ITEM_VERIFY_RUN_PROTECTED',error:'核验已停止'},409);}
    throw Error('Unexpected request in isolated test: '+path);
  };
  function mount(){const root=new Root(),owner=mountRoundItemDetail(root,scope,{request,storage,makeId:()=>`park-${++ids}`});return {root,owner};}
  return {detail,calls,storage,mount,counts:()=>({decisions,resumes:resumeIds.size,ids})};
}
async function open(f){const ui=f.mount();await ui.owner.ready;return ui;}
function submit(ui,actor='测试操作者',reason='保留原提交结果，继续后续商品'){
  const form=ui.root.querySelector('[data-item-park]');assert(form,'park form must be available');
  form.elements.confirmedBy.value=actor;form.elements.reason.value=reason;return form.emit('submit');
}
const byPath=(f,path)=>f.calls.filter(c=>c.path===path);

test('park has an independent form and explains unresolved result, counts and revoked stop intent',async()=>{
  const f=fixture(),ui=await open(f),form=ui.root.querySelector('[data-item-park]');
  assert(form);assert.equal(ui.root.querySelector('[data-item-skip]'),null);
  assert.match(form.elements.confirmedBy.attributes,/maxlength="80" required/);assert.match(form.elements.reason.attributes,/maxlength="1000" required/);
  for(const text of ['挂起并继续本轮','结果仍待核验','禁止重发','成功数和统计分母不变','撤销原停止意图'])assert(ui.root.innerHTML.includes(text));
  assert(!/ITEM_PARK_|RESULT_UNKNOWN/.test(ui.root.innerHTML));
});

test('only eligible submitted unresolved items expose park; a false capability never exposes it',async()=>{
  for(const change of [d=>d.capabilities.park.allowed=false,d=>delete d.capabilities.park,d=>d.current.submitted=false,d=>d.current.state='FAILED',d=>d.retryBlocked=false]){
    const f=fixture();change(f.detail);const ui=await open(f);assert.equal(ui.root.querySelector('[data-item-park]'),null);assert.equal(f.calls.length,1);
  }
});

test('actor and reason are required and bounded before any POST',async()=>{
  for(const [actor,reason] of [['','理由'],['   ','理由'],['a'.repeat(81),'理由'],['姓名',''],['姓名',' '.repeat(4)],['姓名','a'.repeat(1001)]]){
    const f=fixture(),ui=await open(f);await submit(ui,actor,reason);assert.equal(f.calls.length,1);assert.match(ui.root.innerHTML,/1–80字.*1–1000字/);
  }
});

test('trimmed confirmation posts the strict park body then only the bound original resume body',async()=>{
  const f=fixture(),ui=await open(f);await submit(ui,' 操作者 ',' 原提交仍待确认 ');
  assert.deepEqual(byPath(f,'/api/v1/rounds/item-park')[0].input,{...scope,expectedRevision:'revision-before',requestId:'park-1',confirmedBy:'操作者',reason:'原提交仍待确认'});
  assert.deepEqual(byPath(f,'/api/v1/rounds/resume')[0].input,{id:'round',shopId:'fixture-shop',windowId:'window',manifestHash:'manifest-original',requestId:'resume-original',humanVerified:false});
  assert.equal(byPath(f,'/api/v1/rounds/item-skip').length,0);assert.equal(f.detail.current.state,'RESULT_UNKNOWN');assert.equal(f.detail.current.submitted,true);
  assert.match(ui.root.innerHTML,/已挂起 · 仍待核验/);assert.match(ui.root.innerHTML,/确认人<\/dt><dd>操作者/);assert.equal(ui.root.querySelector('[data-item-park]'),null);
  assert(ui.root.querySelector('[data-item-action="verify"]'));assert.equal(f.storage.values.size,0);assert.deepEqual(f.counts(),{decisions:1,resumes:1,ids:1});
});

test('lost park response survives panel recreation and explicit reconciliation uses the exact original intention',async()=>{
  const f=fixture({losePark:true});let ui=await open(f);await submit(ui);assert.equal(byPath(f,'/api/v1/rounds/resume').length,0);
  assert(ui.root.querySelector('[data-item-action="park-reconcile"]'));assert.equal(ui.root.querySelector('[data-item-action="verify"]'),null);
  ui.owner.dispose();ui=await open(f);assert.equal(byPath(f,'/api/v1/rounds/item-park').length,1,'opening never auto-replays');
  await ui.root.querySelector('[data-item-action="park-reconcile"]').emit('click');
  const posts=byPath(f,'/api/v1/rounds/item-park');assert.deepEqual(posts[0].input,posts[1].input);assert.deepEqual(f.counts(),{decisions:1,resumes:1,ids:1});
});

test('a park conflict keeps the same request ID, gives explicit reconciliation and never resumes',async()=>{
  const f=fixture({parkStatus:409}),ui=await open(f);await submit(ui);await ui.root.querySelector('[data-item-action="park-reconcile"]').emit('click');
  const posts=byPath(f,'/api/v1/rounds/item-park');assert.equal(posts.length,2);assert.deepEqual(posts[0].input,posts[1].input);
  assert.equal(byPath(f,'/api/v1/rounds/resume').length,0);assert.equal(f.counts().ids,1);assert(!ui.root.innerHTML.includes('ITEM_PARK_'));
});

test('explicitly finishing a confirmed stale request only refreshes; a new intent requires another submission',async()=>{
  const options={parkStatus:409},f=fixture(options),ui=await open(f);await submit(ui);
  const finish=ui.root.querySelector('[data-item-action="park-rejected-refresh"]');assert(finish);f.detail.revision='revision-new';options.parkStatus=0;
  await finish.emit('click');assert.equal(f.counts().ids,1);assert.equal(byPath(f,'/api/v1/rounds/item-park').length,1);assert.equal(f.storage.values.size,0);
  await submit(ui);const posts=byPath(f,'/api/v1/rounds/item-park');assert.equal(posts[1].input.requestId,'park-2');assert.equal(posts[1].input.expectedRevision,'revision-new');
});

test('unknown responses, generic conflicts and saved parking cannot be dismissed as unaccepted',async()=>{
  for(const options of [{losePark:true},{parkStatus:409,parkCode:'ITEM_PARK_PROTECTED'},{parkStatus:409,parkCode:'ITEM_PARK_REQUEST_CONFLICT'},{loseResume:true},{resumeStatus:409}]){
    const f=fixture(options),ui=await open(f);await submit(ui);assert.equal(ui.root.querySelector('[data-item-action="park-rejected-refresh"]'),null);assert.equal(f.storage.values.size,1);
  }
});

test('lost resume response preserves saved park and retries only the same continuation after recreation',async()=>{
  const f=fixture({loseResume:true});let ui=await open(f);await submit(ui);assert.match(ui.root.innerHTML,/挂起决定已保存，商品仍待核验；继续本轮尚未确认/);
  ui.owner.dispose();ui=await open(f);assert.equal(byPath(f,'/api/v1/rounds/resume').length,1);
  await ui.root.querySelector('[data-item-action="park-reconcile"]').emit('click');
  const resumes=byPath(f,'/api/v1/rounds/resume');assert.deepEqual(resumes[0].input,resumes[1].input);assert.equal(byPath(f,'/api/v1/rounds/item-park').length,1);
  assert.deepEqual(f.counts(),{decisions:1,resumes:1,ids:1});
});

test('resume conflict reports saved parking and does not turn the product into failure or generate a new request',async()=>{
  const f=fixture({resumeStatus:409}),ui=await open(f);await submit(ui);await ui.root.querySelector('[data-item-action="park-reconcile"]').emit('click');
  const resumes=byPath(f,'/api/v1/rounds/resume');assert.equal(resumes.length,2);assert.deepEqual(resumes[0].input,resumes[1].input);
  assert.match(ui.root.innerHTML,/挂起决定已保存，商品仍待核验；继续本轮尚未确认/);assert(!ui.root.innerHTML.includes('CAPTCHA_REQUIRED'));assert.equal(f.detail.current.state,'RESULT_UNKNOWN');
});

const runningView={id:scope.roundId,shop:'fixture-shop',manifestHash:'manifest-original',window:{id:scope.windowId},active:true,state:'RUNNING'};
for(const [name,resumeReceipt] of Object.entries({
  'id only':{id:scope.roundId},'explicit rejection':{id:scope.roundId,accepted:false},'acceptance without replay':{id:scope.roundId,accepted:true},
  'replay without acceptance':{id:scope.roundId,replayed:true},'replay rejection':{id:scope.roundId,replayed:true,accepted:false},
  'foreign round':{...runningView,id:'other'},'missing manifest':{...runningView,manifestHash:undefined},'foreign manifest':{...runningView,manifestHash:'other'},
  'missing window':{...runningView,window:null},'foreign window':{...runningView,window:{id:'other'}},'foreign shop':{...runningView,shop:'other'},
  'missing shop':{...runningView,shop:undefined},'inactive':{...runningView,active:false},'paused':{...runningView,state:'PAUSED'},
  'running rejection':{...runningView,accepted:false},'replay foreign scope':{id:scope.roundId,accepted:true,replayed:true,manifestHash:'other'},'empty receipt':null
}))test('unconfirmed continuation '+name+' retains the exact saved request across explicit reconciliation',async()=>{
  const f=fixture({resumeReceipt});let ui=await open(f);await submit(ui);
  assert.match(ui.root.innerHTML,/挂起决定已保存，商品仍待核验；继续本轮尚未确认/);assert.equal(f.storage.values.size,1);assert(ui.root.querySelector('[data-item-action="park-reconcile"]'));
  ui.owner.dispose();ui=await open(f);assert.equal(byPath(f,'/api/v1/rounds/resume').length,1,'opening cannot resend automatically');
  await ui.root.querySelector('[data-item-action="park-reconcile"]').emit('click');
  const requests=byPath(f,'/api/v1/rounds/resume');assert.equal(requests.length,2);assert.deepEqual(requests[0].input,requests[1].input);assert.equal(f.storage.values.size,1);assert.equal(f.counts().ids,1);assert.equal(byPath(f,'/api/v1/rounds/item-park').length,1);
});

test('explicit accepted replay acknowledges the original continuation and clears only that pending request',async()=>{
  const options={loseResume:true},f=fixture(options);let ui=await open(f);await submit(ui);assert.equal(f.storage.values.size,1);
  options.resumeReceipt={id:scope.roundId,accepted:true,replayed:true};ui.owner.dispose();ui=await open(f);await ui.root.querySelector('[data-item-action="park-reconcile"]').emit('click');
  const requests=byPath(f,'/api/v1/rounds/resume');assert.deepEqual(requests[0].input,requests[1].input);assert.equal(f.storage.values.size,0);assert.equal(ui.root.querySelector('[data-item-action="park-reconcile"]'),null);assert.match(ui.root.innerHTML,/已请求继续本轮剩余商品/);
});

for(const [name,changeReceipt] of Object.entries({round:r=>r.roundId='other',window:r=>r.windowId='other',key:r=>r.key='other',request:r=>r.requestId='other',state:r=>r.state='FAILED',submitted:r=>r.submitted=false,retry:r=>r.retryBlocked=false,actor:r=>r.parking.actor='其他人',reason:r=>r.parking.reason='其他原因',event:r=>r.eventSeq=99,shop:r=>r.continueRequest.shopId='other',manifest:r=>r.continueRequest.manifestHash='other',resumeRound:r=>r.continueRequest.id='other',resumeWindow:r=>r.continueRequest.windowId='other',humanVerified:r=>r.continueRequest.humanVerified=true,extraField:r=>r.continueRequest.force=true})){
  test('mismatched '+name+' receipt never triggers resume and preserves original park request',async()=>{
    const f=fixture({changeReceipt}),ui=await open(f);await submit(ui);assert.equal(byPath(f,'/api/v1/rounds/resume').length,0);assert(ui.root.querySelector('[data-item-action="park-reconcile"]'));assert.equal(f.storage.values.size,1);
  });
}

test('missing initial shop or manifest scope prevents POST',async()=>{
  for(const key of ['shopId','manifestHash']){const f=fixture();delete f.detail[key];const ui=await open(f);await submit(ui);assert.equal(f.calls.length,1);assert.match(ui.root.innerHTML,/店铺或资料范围尚未确认/);}
});

test('changed shop or manifest on reload disables reconciliation without making a request',async()=>{
  for(const key of ['shopId','manifestHash']){
    const f=fixture({loseResume:true});let ui=await open(f);await submit(ui);ui.owner.dispose();f.detail[key]='changed';ui=await open(f);
    assert.match(ui.root.innerHTML,/原挂起请求的店铺或资料范围已变化/);assert.equal(byPath(f,'/api/v1/rounds/resume').length,1);
  }
});

test('double submit and stale buttons cannot run another action while parking is writing',async()=>{
  const parkWait=deferred(),f=fixture({parkWait}),ui=await open(f),form=ui.root.querySelector('[data-item-park]'),verify=ui.root.querySelector('[data-item-action="verify"]');
  const first=submit(ui);await form.emit('submit');await verify.emit('click');await ui.owner.startRetry();
  assert.equal(byPath(f,'/api/v1/rounds/item-park').length,1);assert.equal(byPath(f,'/api/v1/rounds/item-verify').length,0);assert.equal(byPath(f,'/api/v1/rounds/item-retry').length,0);
  assert(ui.root.querySelector('[data-item-action="park-reconcile"]').disabled);parkWait.resolve();await first;
});

test('verification write disables the separate park form and refuses an old submit handler',async()=>{
  const verifyWait=deferred(),f=fixture({verifyWait}),ui=await open(f),oldForm=ui.root.querySelector('[data-item-park]');
  oldForm.elements.confirmedBy.value='确认人';oldForm.elements.reason.value='原因';ui.root.querySelector('[data-item-action="verify"]').emit('click');
  assert(ui.root.querySelector('[data-item-park]').submit.disabled);await oldForm.emit('submit');assert.equal(byPath(f,'/api/v1/rounds/item-park').length,0);
  verifyWait.resolve();await settle();
});

test('closing the panel during park preserves its receipt but does not start continuation',async()=>{
  const parkWait=deferred(),f=fixture({parkWait});let ui=await open(f);const pending=submit(ui);ui.owner.dispose();parkWait.resolve();await pending;
  assert.equal(byPath(f,'/api/v1/rounds/resume').length,0);ui=await open(f);assert.equal(byPath(f,'/api/v1/rounds/resume').length,0);
  await ui.root.querySelector('[data-item-action="park-reconcile"]').emit('click');assert.equal(byPath(f,'/api/v1/rounds/item-park').length,1);assert.equal(byPath(f,'/api/v1/rounds/resume').length,1);
});

test('unavailable session storage prevents a new decision from being sent',async()=>{
  const storage={getItem:()=>null,setItem(){throw Error('blocked');},removeItem(){}};
  const f=fixture({storage}),ui=await open(f);await submit(ui);assert.equal(f.calls.length,1);assert.match(ui.root.innerHTML,/无法保存本次操作记录/);
});

test('parked actor and reason render as escaped text, with the original verify action retained',async()=>{
  const f=fixture(),ui=await open(f);await submit(ui,'<script>姓名</script>','<img src=x onerror=alert(1)>');
  assert(!ui.root.innerHTML.includes('<script>姓名</script>'));assert(!ui.root.innerHTML.includes('<img src=x'));assert.match(ui.root.innerHTML,/&lt;script&gt;姓名/);assert(ui.root.querySelector('[data-item-action="verify"]'));
});

test('actual isolated backend receipt passes the UI actor, evidence and continuation contract',async t=>{
  const f=await setup(t),o=f.round;await f.pause();const selected=f.scope(),x=o.item(f.r.id,selected.key),run=f.store.run(x.run_id);
  f.store.move(run.id,'QUEUED');f.store.move(run.id,'RUNNING');f.store.move(run.id,'SUBMITTING');f.store.event(run.id,'SUBMIT_CLICKED',{});f.store.move(run.id,'RESULT_UNKNOWN');
  o.update(f.r.id,x.key,{state:'RESULT_UNKNOWN',submitted:1,submission_uncertain:1,failure_stage:'verify-platform-result'});o.state(f.r.id,'RESULT_UNKNOWN','隔离测试提交结果未知');
  const product={round:o,source:f.flow,batch:f.batch,shop:o.shop,owner:{sessions:new Map([[o.shop.id,{context:{}}]])},capturing:false,reconciling:false,integrity:async()=>({ok:true})};
  const host=new RoundItemHostGuard(product,{isShopRemoved:()=>false}),verifier=new RoundItemVerify(host);
  o.verifyExisting=async()=>{throw Object.assign(Error('已点击提交、回执未读到；后台创建时间与本次提交时间不匹配，保持待核验，保持 RESULT_UNKNOWN，禁止再次提交'),{code:'RESULT_UNKNOWN'});};
  await assert.rejects(verifier.verify({...selected,expectedRevision:verifier.reader.read(selected).revision,requestId:'ui-contract-verification'}));
  const api=new RoundItemApi(f.action,{host,verifier}),calls=[];let actualReceipt;
  const request=async(path,init={})=>{
    const input=init.body?JSON.parse(init.body):null;calls.push({path,input});
    if(path.startsWith('/api/v1/rounds/item?'))return response(await api.detail(selected));
    if(path==='/api/v1/rounds/item-park'){
      let result;await api.handle({method:'POST'},{setHeader(){}},new URL(path,'http://isolated.test'),{body:async()=>input,json:(_res,status,payload)=>{actualReceipt=payload;result=response(payload,status);}});return result;
    }
    if(path==='/api/v1/rounds/resume')return response({...o.view(selected.roundId),active:true,state:'RUNNING'});
    throw Error('unexpected isolated contract request');
  };
  const root=new Root(),owner=mountRoundItemDetail(root,selected,{request,storage:memoryStorage(),makeId:()=> 'ui-contract-park'});await owner.ready;await submit({root,owner});
  assert.equal(actualReceipt.parking.actor.identitySource,'LOCAL_OPERATOR_DECLARATION');assert.equal(actualReceipt.parking.actor.name,'测试操作者');assert.equal(actualReceipt.parking.evidence.category,'TIME_MISMATCH');
  assert.deepEqual(calls.find(c=>c.path==='/api/v1/rounds/resume').input,actualReceipt.continueRequest);
  assert.match(root.innerHTML,/已挂起 · 仍待核验/);assert.match(root.innerHTML,/确认人为操作者自行填写/);assert.equal(f.flow.submits,0,'continuation is a request double, no executor launched');
});
