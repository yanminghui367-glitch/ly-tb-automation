import {redact} from './product-state.mjs';

const prefix='/api/v1/rounds/selection';
const issue=(message,code='SELECTION_INVALID')=>Object.assign(Error(message),{code});
// Hosted behind the original HTTP network, origin and write serialization gates.
// Saving a selection does not grant execution permission or start a browser.
export async function handleOperationsSelection(product,req,res,url,{body,json}) {
 const action=url.pathname;
 if(![prefix,prefix+'-preview',prefix+'-create',prefix+'-capabilities',prefix+'-budget'].includes(action))return false;
 let committed=false;
 try {
  const owner=product.round;
  if(req.method==='GET'&&action===prefix+'-capabilities'){json(res,200,{batchRecheck:true,manualRetryBudget:true});return true;}
  if(req.method==='GET'&&action===prefix){const id=url.searchParams.get('roundId');owner.assertManifest(id);json(res,200,owner.selections.view(id));return true;}
  if(action===prefix+'-budget'){
   if(req.method!=='POST'){json(res,405,{error:'此操作不支持当前请求方法',retainRequest:false});return true;}
   const input=await body(req),allowed=new Set(['id','manifestHash','windowId','keys','addAttempts','reason','requestId','expectedRevision']);
   if(!input||Array.isArray(input)||Object.keys(input).some(k=>!allowed.has(k))||typeof input.id!=='string'||typeof input.manifestHash!=='string')throw issue('额度调整范围或固定版本不正确');
   const row=owner.assertManifest(input.id);if(row.manifest_hash!==input.manifestHash)throw issue('固定清单版本已变化，请重新检查','SELECTION_STALE');
   if(!product.roundItems?.host)throw issue('当前店铺尚未接入额度调整安全检查','SELECTION_HOST_REQUIRED');
   await product.roundItems.host.assert();if(product.round!==owner)throw issue('执行器归属已变化，请刷新','SELECTION_OWNER_CHANGED');
   product.capturing=true;try{const result=await owner.selections.grantRetryBudget({roundId:input.id,windowId:input.windowId,keys:input.keys,addAttempts:input.addAttempts,reason:input.reason,requestId:input.requestId,expectedRevision:input.expectedRevision});committed=true;json(res,200,result);}finally{product.capturing=false;}
   return true;
  }
  if(req.method!=='POST'||action===prefix||action===prefix+'-capabilities'){json(res,405,{error:'此操作不支持当前请求方法',retainRequest:false});return true;}
  const input=await body(req),creating=action===prefix+'-create';
  const allowed=new Set(['id','manifestHash','keys','mode','limit','autoContinue','requestId','windowId',...(creating?['selectionHash','expectedRevision']:[])]);
  if(!input||Array.isArray(input)||Object.keys(input).some(k=>!allowed.has(k))||typeof input.id!=='string'||!input.id||!Array.isArray(input.keys)||!input.keys.length||input.keys.length>10000||!['start','retry','recheck'].includes(input.mode)||!Number.isInteger(input.limit)||input.limit<1||input.limit>100||typeof input.autoContinue!=='boolean'||!/^[a-f0-9-]{36}$/i.test(input.requestId||''))throw issue('执行范围格式不正确，请重新勾选并检查。');
  const row=owner.assertManifest(input.id);
  if(row.manifest_hash!==input.manifestHash)throw issue('资料包版本已变化，请刷新并重新检查。','SELECTION_STALE');
  // Replaying a committed create only reads its original durable receipt. It
  // must not be turned into a second create after execution has begun.
  if(creating&&owner.selections.receipt){const prior=owner.selections.receipt({...input,roundId:input.id});if(prior){committed=true;json(res,200,{accepted:true,roundId:row.id,selectionId:prior.selection.id,windowId:prior.window.id,replayed:true,selection:prior.selection,window:prior.window});return true;}}
  if(!product.roundItems?.host)throw issue('当前店铺尚未接入执行范围检查，请先完成店铺设置。','SELECTION_HOST_REQUIRED');
  await product.roundItems.host.assert();
  if(product.round!==owner)throw issue('执行器归属已变化，请刷新。','SELECTION_OWNER_CHANGED');
  const config={keys:input.keys,mode:input.mode,limit:input.limit,autoContinue:input.autoContinue,...(input.mode==='recheck'?{windowId:input.windowId}:{})};
  product.capturing=true;
  try {
   if(!creating){const result=await owner.selections.preview(row.id,config);json(res,200,{...result,mode:input.mode});}
   else {
    const result=await owner.selections.create({roundId:row.id,...config,expectedRevision:input.expectedRevision,selectionHash:input.selectionHash,requestId:input.requestId});
    committed=true;
    json(res,200,{accepted:true,roundId:row.id,selectionId:result.selection.id,windowId:result.window.id,replayed:!!result.replayed,selection:result.selection,window:result.window});
   }
  }finally{product.capturing=false;}
 }catch(error){
  const code=error.code||'OPERATIONS_UNKNOWN_FAILURE';
  const known=String(error.message||'');
  const errorText=/^ITEM_HOST_/.test(code)?'店铺或执行服务正在处理其他操作，请等待停止后刷新检查。':redact(known).slice(0,1000)||'执行范围检查未完成，请重新读取状态。';
  const definitive=!committed&&/^(SELECTION_|ITEM_HOST_|ITEM_OWNER_|ITEM_SKIP_)/.test(code);
  json(res,definitive?409:500,{code,error:errorText,retainRequest:!definitive});
 }
 return true;
}
