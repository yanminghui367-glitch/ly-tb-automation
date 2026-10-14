// Observe Chrome tab protection through the existing native browser owner.
// No URL/title/profile reads, page actions, browser connection, or close permit.
// Chrome's tab embedderData is experimental and pull-only: missing means unknown.
const unknown=reason=>({status:'unknown',pageTargetId:null,tabTargetId:null,active:null,reason});

function deadlineWait(promise,deadline,onLate){
 let timer,expired=false;
 const source=Promise.resolve(promise);
 const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{expired=true;reject(Error('PROTECTION_TIMEOUT'));},Math.max(0,deadline-Date.now()));});
 source.then(value=>{if(expired&&onLate)Promise.resolve(onLate(value)).catch(()=>{});},()=>{});
 return Promise.race([source,timeout]).finally(()=>clearTimeout(timer));
}

async function findChildren(session,tabTargetId,deadline){
 let ownSessionId,resolveReply,rejectReply,invalidReason=null,handedOff=false,disposed=false;
 const children=new Map();
 const reply=new Promise((resolve,reject)=>{resolveReply=resolve;rejectReply=reject;});
 reply.catch(()=>{});
 const invalidate=reason=>{invalidReason ||= reason;rejectReply(Error(reason));};
 const assertValid=()=>{if(invalidReason)throw Error(invalidReason);};
 const onDetached=event=>{if(event.sessionId===ownSessionId)invalidate('PROTECTION_OBSERVER_DETACHED');};
 const onMessage=event=>{
  if(event.sessionId!==ownSessionId)return;
  let message;try{message=JSON.parse(event.message);}catch{invalidate('PROTECTION_PROTOCOL_INVALID');return;}
  if(message.method==='Target.attachedToTarget'){
   const p=message.params;
   if(p?.waitingForDebugger!==false||typeof p?.sessionId!=='string'||!p.sessionId||p?.targetInfo?.type!=='page'||typeof p.targetInfo.targetId!=='string'||!p.targetInfo.targetId||children.has(p.sessionId))invalidate('PROTECTION_CHILD_INVALID');
   else if(Object.hasOwn(p.targetInfo,'parentId')&&p.targetInfo.parentId!==tabTargetId)invalidate('PROTECTION_PARENT_ID_MISMATCH');
   else children.set(p.sessionId,p.targetInfo.targetId);
  }
  if(message.method==='Target.detachedFromTarget')invalidate('PROTECTION_CHILD_DETACHED');
  if(message.method==='Target.targetDestroyed'&&[...children.values()].includes(message.params?.targetId))invalidate('PROTECTION_CHILD_DETACHED');
  if(message.id===1){if(message.error)invalidate('PROTECTION_ATTACH_REJECTED');else resolveReply();}
 };
 session.on('Target.receivedMessageFromTarget',onMessage);
 session.on('Target.detachedFromTarget',onDetached);
 const dispose=async()=>{
  if(disposed)return;disposed=true;
  session.off('Target.receivedMessageFromTarget',onMessage);session.off('Target.detachedFromTarget',onDetached);
  if(ownSessionId)await deadlineWait(session.send('Target.detachFromTarget',{sessionId:ownSessionId}),Date.now()+500);
 };
 try{
  const attachment=await deadlineWait(session.send('Target.attachToTarget',{targetId:tabTargetId,flatten:false}),deadline,
   value=>value?.sessionId&&session.send('Target.detachFromTarget',{sessionId:value.sessionId}));
  ownSessionId=attachment?.sessionId;
  if(typeof ownSessionId!=='string'||!ownSessionId)throw Error('PROTECTION_ATTACH_INVALID');
  await deadlineWait(session.send('Target.sendMessageToTarget',{sessionId:ownSessionId,message:JSON.stringify({id:1,method:'Target.setAutoAttach',params:{autoAttach:true,waitForDebuggerOnStart:false,flatten:false,filter:[{type:'page',exclude:false}]}})}),deadline);
  await deadlineWait(reply,deadline);
  assertValid();handedOff=true;
  return {children:()=>[...children.values()],assertValid,dispose};
 }finally{
  if(!handedOff)await dispose();
 }
}

/**
 * Reads the current page's browser-native pinned state. A caller may only act
 * on status === 'unpinned', after its independent ownership/evidence guards.
 * This is an observation, not atomic with a later close. Read again at the
 * final boundary; never infer unpinned from absent/stale/ambiguous metadata.
 */
export async function readPageProtection(page,{timeoutMs=2000,maxCandidates=64}={}){
 let ownPageSession,ownBrowserSession,result=unknown('PROTECTION_UNAVAILABLE');
 const retainedObservers=[];
 const deadline=Date.now()+timeoutMs;
 try{
  if(!Number.isFinite(timeoutMs)||timeoutMs<=0||!Number.isInteger(maxCandidates)||maxCandidates<1||maxCandidates>256)return unknown('PROTECTION_OPTIONS_INVALID');
  if(!page||page.isClosed())return unknown('PAGE_CLOSED');
  const context=page.context(),browser=context.browser();
  if(!browser?.isConnected())return unknown('BROWSER_UNAVAILABLE');
  ownPageSession=await deadlineWait(context.newCDPSession(page),deadline,s=>s.detach());
  const original=(await deadlineWait(ownPageSession.send('Target.getTargetInfo'),deadline))?.targetInfo;
  if(original?.type!=='page'||typeof original.targetId!=='string'||typeof original.browserContextId!=='string')throw Error('PROTECTION_PAGE_IDENTITY_UNAVAILABLE');
  result={...result,pageTargetId:original.targetId};
  ownBrowserSession=await deadlineWait(browser.newBrowserCDPSession(),deadline,s=>s.detach());
  const all=(await deadlineWait(ownBrowserSession.send('Target.getTargets',{filter:[{type:'tab',exclude:false}]}),deadline))?.targetInfos;
  if(!Array.isArray(all))throw Error('PROTECTION_TABS_UNAVAILABLE');
  const tabs=all.filter(t=>t.type==='tab'&&t.browserContextId===original.browserContextId);
  if(!tabs.length||tabs.length>maxCandidates||new Set(tabs.map(t=>t.targetId)).size!==tabs.length)throw Error('PROTECTION_TAB_SCOPE_INVALID');
  const matches=[];
  for(const tab of tabs){
   if(typeof tab.targetId!=='string'||!tab.targetId)throw Error('PROTECTION_TAB_ID_INVALID');
   const observer=await findChildren(ownBrowserSession,tab.targetId,deadline);
   if(observer.children().includes(original.targetId)){retainedObservers.push(observer);matches.push({tab,observer});}
   else await observer.dispose();
  }
  if(matches.length!==1||matches[0].observer.children().length!==1)throw Error('PROTECTION_BINDING_AMBIGUOUS');
  const first=matches[0].tab;
  matches[0].observer.assertValid();
  if(Object.hasOwn(original,'parentId')&&original.parentId!==first.targetId)throw Error('PROTECTION_PARENT_ID_MISMATCH');
  result={...result,tabTargetId:first.targetId};
  const last=(await deadlineWait(ownBrowserSession.send('Target.getTargetInfo',{targetId:first.targetId}),deadline))?.targetInfo;
  const current=(await deadlineWait(ownPageSession.send('Target.getTargetInfo'),deadline))?.targetInfo;
  if(page.isClosed()||current?.targetId!==original.targetId||current?.browserContextId!==original.browserContextId||last?.targetId!==first.targetId||last?.type!=='tab'||last?.browserContextId!==original.browserContextId)throw Error('PROTECTION_IDENTITY_CHANGED');
  if(Object.hasOwn(current,'parentId')&&current.parentId!==first.targetId)throw Error('PROTECTION_PARENT_ID_MISMATCH');
  matches[0].observer.assertValid();
  if(matches[0].observer.children().length!==1)throw Error('PROTECTION_BINDING_AMBIGUOUS');
  const a=first.embedderData?.tabPinned,b=last.embedderData?.tabPinned,active=last.embedderData?.tabActive;
  if(typeof a!=='boolean'||typeof b!=='boolean'||typeof active!=='boolean')throw Error('PROTECTION_SIGNAL_UNAVAILABLE');
  result={...result,status:a||b?'pinned':'unpinned',active,reason:a!==b?'PIN_STATE_CHANGED_KEEP':b?'PINNED':'OBSERVED_UNPINNED'};
 }catch(error){
  const reason=/^PROTECTION_[A-Z_]+$/.test(error?.message||'')?error.message:'PROTECTION_READ_FAILED';
  result={...result,status:'unknown',active:null,reason};
 }finally{
  for(const observer of retainedObservers){
   try{observer.assertValid();}catch(error){result={...result,status:'unknown',active:null,reason:error.message};}
   try{await observer.dispose();}catch{result={...result,status:'unknown',active:null,reason:'PROTECTION_DETACH_FAILED'};}
  }
  for(const session of [ownPageSession,ownBrowserSession])if(session){
   try{await deadlineWait(session.detach(),Date.now()+500);}catch{result={...result,status:'unknown',active:null,reason:'PROTECTION_DETACH_FAILED'};}
  }
 }
 return result;
}
