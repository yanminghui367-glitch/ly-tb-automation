import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createServer} from 'node:http';
import {chromium} from 'playwright';
import {readPageProtection} from '../page-protection.mjs';

function fixture(options={}){
 const calls=[],detached=[],closed={value:false};
 const original={type:'page',targetId:'page-A',browserContextId:'context',...(Object.hasOwn(options,'originalParent')?{parentId:options.originalParent}:{})};
 const base={type:'tab',targetId:'tab-A',browserContextId:'context',embedderData:{tabPinned:false,tabActive:true}};
 const tabs=options.tabs||[base],sessions=new Map();let sequence=0,pageReads=0;
 const pageSession={async send(method){calls.push({scope:'page',method});pageReads++;return {targetInfo:pageReads>1&&options.changedPage?{...original,targetId:'changed'}:pageReads>1&&Object.hasOwn(options,'currentParent')?{...original,parentId:options.currentParent}:original};},async detach(){detached.push('page');if(options.detachFailure)throw Error('synthetic detach failure');}};
 const browserSession=Object.assign(new EventEmitter(),{
  async send(method,params){
   calls.push({scope:'browser',method,params});
   if(method==='Target.getTargets')return {targetInfos:tabs};
   if(method==='Target.getTargetInfo'){
    if(options.detachOnFinal){const own=[...sessions.keys()][0];this.emit('Target.receivedMessageFromTarget',{sessionId:own,message:JSON.stringify({method:'Target.detachedFromTarget',params:{sessionId:'child-'+own+'-'+original.targetId,targetId:original.targetId}})});}
    return {targetInfo:options.last||tabs.find(t=>t.targetId===params.targetId)};
   }
   if(method==='Target.attachToTarget'){const id='own-'+(++sequence);sessions.set(id,params.targetId);return {sessionId:id};}
   if(method==='Target.detachFromTarget'){detached.push(params.sessionId);return {};}
   if(method==='Target.sendMessageToTarget'){
    const message=JSON.parse(params.message);assert.equal(message.params.waitForDebuggerOnStart,false);assert.equal(message.method,'Target.setAutoAttach');
    if(options.noReply)return {};
    const tab=sessions.get(params.sessionId),children=options.children?.[tab]||[original.targetId];
    const emit=message=>this.emit('Target.receivedMessageFromTarget',{sessionId:params.sessionId,message:JSON.stringify(message)});
    for(const id of children)emit({method:'Target.attachedToTarget',params:{...(options.missingChildSession?{}:{sessionId:'child-'+params.sessionId+'-'+id}),waitingForDebugger:false,targetInfo:{type:'page',targetId:id,...(Object.hasOwn(options,'childParent')?{parentId:options.childParent}:{})}}});
    const detached={method:'Target.detachedFromTarget',params:{sessionId:'child-'+params.sessionId+'-'+original.targetId,targetId:original.targetId}};
    if(options.detachBeforeAck)emit(detached);
    emit(options.rejectReply?{id:1,error:{message:'synthetic'}}:{id:1,result:{}});
    if(options.detachAfterAck)emit(detached);
    return {};
   }
   throw Error('Unexpected command');
  },async detach(){detached.push('browser');}
 });
 const browser={isConnected:()=>true,newBrowserCDPSession:async()=>browserSession};
 const context={browser:()=>browser,newCDPSession:async()=>pageSession};
 const page={context:()=>context,isClosed:()=>closed.value,url(){throw Error('URL access forbidden');},title(){throw Error('title access forbidden');},close(){throw Error('close forbidden');}};
 return {page,context,browserSession,pageSession,base,calls,detached,closed};
}

test('read-only exact child mapping reports unpinned and detaches only its sessions',async()=>{
 const f=fixture(),result=await readPageProtection(f.page);
 assert.deepEqual(result,{status:'unpinned',pageTargetId:'page-A',tabTargetId:'tab-A',active:true,reason:'OBSERVED_UNPINNED'});
 assert.deepEqual(f.detached,['own-1','page','browser']);assert.equal(f.browserSession.listenerCount('Target.receivedMessageFromTarget'),0);
 assert(f.calls.every(c=>c.method.startsWith('Target.')));
});

test('pinned and pin changes in either sampling direction remain protected',async()=>{
 for(const [first,last] of [[true,true],[false,true],[true,false]]){
  const f=fixture();const tab={...f.base,embedderData:{tabPinned:first,tabActive:true}},end={...tab,embedderData:{tabPinned:last,tabActive:false}};
  const result=await readPageProtection(fixture({tabs:[tab],last:end}).page);
  assert.equal(result.status,'pinned');assert.equal(result.active,false);
  assert.equal(result.reason,first===last?'PINNED':'PIN_STATE_CHANGED_KEEP');
 }
});

test('missing or incorrectly typed native flags always report unknown',async()=>{
 const {base}=fixture();
 for(const embedderData of [{},{tabPinned:'false',tabActive:true},{tabPinned:false},{tabPinned:false,tabActive:'true'}]){
  const f=fixture({tabs:[{...base,embedderData}]});assert.equal((await readPageProtection(f.page)).status,'unknown');assert.equal(f.detached.at(-1),'browser');
 }
});

test('different tab child IDs disambiguate pages without title, URL or position',async()=>{
 const {base}=fixture();const f=fixture({tabs:[{...base,targetId:'tab-B'},base],children:{'tab-B':['page-B'],'tab-A':['page-A']}});
 assert.equal((await readPageProtection(f.page)).tabTargetId,'tab-A');assert.deepEqual(f.detached,['own-1','own-2','page','browser']);
});

test('multiple matching parents, multiple child pages, missing binding and duplicate target IDs are unknown',async()=>{
 const {base}=fixture();
 for(const options of [
  {tabs:[base,{...base,targetId:'tab-B'}]},
  {children:{'tab-A':['page-A','prerender']}},
  {children:{'tab-A':['page-B']}},
  {tabs:[base,base]},
  {tabs:[{...base,browserContextId:'unrelated'}]}
 ])assert.equal((await readPageProtection(fixture(options).page)).status,'unknown');
});

test('page identity changes and native protocol errors retain the page',async()=>{
 for(const options of [{changedPage:true},{rejectReply:true},{detachFailure:true}])assert.equal((await readPageProtection(fixture(options).page)).status,'unknown');
});

test('detached child before acknowledgement, after acknowledgement or during final sampling invalidates the mapping',async()=>{
 for(const options of [{detachBeforeAck:true},{detachAfterAck:true},{detachOnFinal:true}]){
  const f=fixture(options),result=await readPageProtection(f.page);
  assert.equal(result.status,'unknown');assert.equal(result.reason,'PROTECTION_CHILD_DETACHED');
  assert.deepEqual(f.detached,['own-1','page','browser']);
  assert.equal(f.browserSession.listenerCount('Target.receivedMessageFromTarget'),0);
  assert.equal(f.browserSession.listenerCount('Target.detachedFromTarget'),0);
 }
});

test('optional parent IDs must agree when present, while absent or matching parent IDs retain exact mapping support',async()=>{
 for(const options of [{originalParent:'other'},{currentParent:'other'},{childParent:'other'},{originalParent:'tab-A',currentParent:'other'},{originalParent:null}]){
  const f=fixture(options),result=await readPageProtection(f.page);assert.equal(result.status,'unknown');assert.equal(result.reason,'PROTECTION_PARENT_ID_MISMATCH');
 }
 for(const options of [{},{originalParent:'tab-A',currentParent:'tab-A',childParent:'tab-A'}])assert.equal((await readPageProtection(fixture(options).page)).status,'unpinned');
 assert.equal((await readPageProtection(fixture({missingChildSession:true}).page)).status,'unknown');
});

test('bounded timeout detaches its nested session and leaves no event listener',async()=>{
 const f=fixture({noReply:true}),start=Date.now();const result=await readPageProtection(f.page,{timeoutMs:25});
 assert.equal(result.status,'unknown');assert.equal(result.reason,'PROTECTION_TIMEOUT');assert(Date.now()-start<1500);
 assert.deepEqual(f.detached,['own-1','page','browser']);assert.equal(f.browserSession.listenerCount('Target.receivedMessageFromTarget'),0);
});

test('late-created page session is detached after timeout without touching browser owner',async()=>{
 const f=fixture();let resolveSession;
 f.context.newCDPSession=()=>new Promise(resolve=>{resolveSession=resolve;});
 assert.equal((await readPageProtection(f.page,{timeoutMs:10})).status,'unknown');
 resolveSession(f.pageSession);await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(f.detached,['page']);
});

test('closed page, invalid options and oversized target scope are unknown without tab actions',async()=>{
 const f=fixture();f.closed.value=true;assert.equal((await readPageProtection(f.page)).reason,'PAGE_CLOSED');assert.equal(f.calls.length,0);
 assert.equal((await readPageProtection(f.page,{timeoutMs:0})).reason,'PROTECTION_OPTIONS_INVALID');
 const {base}=fixture();const many=fixture({tabs:[base,{...base,targetId:'tab-B'}]});assert.equal((await readPageProtection(many.page,{maxCandidates:1})).status,'unknown');
 assert(!many.calls.some(c=>c.method==='Target.attachToTarget'));
});

test('isolated Chrome: same URL/title mapping and native navigation, guard, field and dialog survive attachment/detach',async()=>{
 const server=createServer((_req,res)=>{res.setHeader('content-type','text/html');res.end('<title>Identical local tabs</title><h1>Fixture shop</h1><input id="field">');});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({channel:'chrome',headless:true,args:['--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1']});
 try{
  const context=await browser.newContext({serviceWorkers:'block'});await context.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
  const pages=[await context.newPage(),await context.newPage()];const url='http://127.0.0.1:'+server.address().port;
  for(const page of pages)await page.goto(url);
  const records=await Promise.all(pages.map(page=>readPageProtection(page)));
  assert(records.every(r=>r.status==='unpinned'));assert.notEqual(records[0].tabTargetId,records[1].tabTargetId);assert.notEqual(records[0].pageTargetId,records[1].pageTargetId);
  for(let i=0;i<3;i++){
   const [state]=await Promise.all([readPageProtection(pages[0]),pages[0].goto(url+'/?step='+i)]);
   assert.equal(state.status,'unpinned');assert.equal(await pages[0].locator('h1').innerText(),'Fixture shop');
   await pages[0].locator('#field').fill('retained-'+i);assert.equal(await pages[0].locator('#field').inputValue(),'retained-'+i);
  }
  let dialogs=0;pages[0].once('dialog',async d=>{dialogs++;await d.accept();});
  const [state]=await Promise.all([readPageProtection(pages[0]),pages[0].evaluate(()=>alert('local only'))]);
  assert.equal(dialogs,1);assert.equal(state.status,'unpinned');assert.equal(context.pages().length,2);
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
});
