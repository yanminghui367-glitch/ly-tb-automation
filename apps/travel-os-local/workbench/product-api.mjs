import {readFile,writeFile,mkdir,rename,stat} from 'node:fs/promises';
import {handleOperationsSelection} from './operations-api.mjs';
import {join,relative,isAbsolute,sep,basename} from 'node:path';
import {batchDefaults} from './batch-workflow.mjs';
import {destinationKey,digest} from './source-store.mjs';
import {verifyKernel} from './kernel-integrity.mjs';
import {redact,classify,roundHoldIssue,browserView,pauseView} from './product-state.mjs';
import {assertTaskFiles} from './taobao-publisher.mjs';
import {readMaterialBinding} from './round-material-binding.mjs';
import {destinationCatalog,searchDestinations} from './destination-catalog.mjs';
import {globeCatalog} from './globe-catalog.mjs';
import {retryPlan} from './task-view-model.mjs';
import {PublishingRules} from './publishing-rules.mjs';
import {captureAttributes,ATTRIBUTE_FIELDS} from './publishing-attributes.mjs';
import {visibleChallenge} from './browser-environment.mjs';
import {newForm} from './taobao-publisher.mjs';
import {ResultReconciliation} from './result-reconciliation.mjs';
import {SetupFlow} from './setup-flow.mjs';
import {assertShopInput} from './shop-identity.mjs';
import {MAX_BATCH_SIZE,DEFAULT_BATCH_SIZE} from './batch-policy.mjs';
import {createHostedRoundItemApi} from './round-item-host-api.mjs';
import {ListingRound} from './listing-round.mjs';
import {RoundVerification} from './round-verification.mjs';
import {PublishingContentReviews} from './publishing-content-review.mjs';
import {ContentPreparation} from './content-preparation.mjs';
import {setPageScope,getPageLedger} from './page-ownership.mjs';

export const executionRoute=path=>/^\/api\/batch\/(start|continue|retry)$/.test(path)||/^\/api\/source\/(start|resume)$/.test(path)||/^\/api\/tasks\/[^/]+\/(start|resume|acknowledge-manual|complete-dry-run)$/.test(path);
const err=(message,statusCode=409)=>Object.assign(new Error(message),{statusCode});
export function stepName(value='') {
  if(value.startsWith('attribute-'))return '填写属性：'+(ATTRIBUTE_FIELDS[value.slice(10)]||'待确认');
  const names={'open-new-form':'打开新增商品页','title':'填写标题','guide-title':'填写导购标题','price':'填写价格','inventory':'填写库存','brand':'选择品牌','custom-service':'核验定制服务','listing-state':'设置上架方式','shipping-time':'设置发货时效','shipping-region':'设置发货范围','single-origin':'设置发货地','logistics':'设置物流','freight-template':'选择运费模板','ship-from':'核验发货地','procurement':'设置采购地','region-restriction':'设置区域限制','insert-details':'插入详情图','pre-submit-review':'提交前核验','submit-once':'提交商品','verify-platform-result':'后台核验结果'};
  if(/^main-image-\d+$/.test(value))return '主图 '+value.split('-').at(-1);
  if(/^select-detail-\d+$/.test(value))return '选择详情图 '+value.split('-').at(-1);
  return names[value]||(value?'未识别步骤，查看日志':'尚未开始');
}
export const reasonText=value=>redact(value).slice(0,600);
export class ProductApi {
  constructor({batch,source,owner,shop,launch,runtime,integrity=verifyKernel,checkFiles=assertTaskFiles,isShopRemoved=null,imageReviewPolicy}) {
    if(checkFiles===assertTaskFiles)checkFiles=task=>assertTaskFiles(task,{materialBinding:readMaterialBinding(source.store.db,task)});
    Object.assign(this,{batch,source,owner,shop,launch,runtime,integrity,checkFiles});
    this.settingsFile=join(runtime,'product-v1','settings.json');this.catalog=new Map();this.catalogCount=-1;this.validationCache=null;this.streams=new Set();this.startedAt=new Date().toISOString();this.checkResult=null;
    source.store.db.exec('CREATE TABLE IF NOT EXISTS product_actions(id TEXT PRIMARY KEY, action TEXT NOT NULL, target TEXT NOT NULL, at TEXT NOT NULL, result TEXT NOT NULL)');
    this.rules=new PublishingRules(source.store);this.capturing=false;this.reconciling=false;this.reconciliation=new ResultReconciliation(this);this.setup=new SetupFlow(this);
    this.contentReviews=new PublishingContentReviews(source.store,{policy:imageReviewPolicy});
    this.round=new ListingRound({batch,source,shop,rules:this.rules,checkFiles,contentReviews:this.contentReviews,getListingDefaults:async()=>(await this.settings()).listingDefaults,
      assertExecution:async()=>{await this.assertExecution();const state=await this.owner.status(this.shop);if(!state.running||!state.loggedIn)throw Error(state.loginState==='PAUSED_CAPTCHA'?'PAUSED_CAPTCHA':state.reason||'请人工登录目标店铺');},
      verifyExisting:input=>{
        const context=this.owner.sessions.get(this.shop.id)?.context;
        if(context){
          let window=this.round.windows.open(input.roundId);
          if(input.executionWindowId!==undefined||input.verificationAttemptId!==undefined||input.executionAttemptId!==undefined){
            if(input.verificationAttemptId!==undefined&&input.executionAttemptId!==undefined)throw err('处理记录类型冲突');
            const manual=input.executionAttemptId!==undefined;
            const attempt=this.round.executionAttempts.attempts.get(manual?input.executionAttemptId:input.verificationAttemptId);
            if(!attempt||attempt.finished_at||attempt.kind!==(manual?'MANUAL_RETRY':'VERIFY_ONLY')||attempt.round_id!==input.roundId||attempt.window_id!==input.executionWindowId||attempt.key!==input.key||attempt.task_hash!==digest(input.task)||attempt.shop_id!==input.task.shopId)throw err('单条核验页面范围与原处理记录不符');
            if(manual&&(this.round.singleItemExecution?.attemptId!==attempt.id||this.round.singleItemExecution.key!==input.key||this.round.singleItemExecution.roundId!==input.roundId||this.round.singleItemExecution.windowId!==input.executionWindowId))throw err('单条重试执行范围与原处理记录不符');
            const original=this.round.item(input.roundId,input.key),run=original.run_id?source.store.run(original.run_id):null;
            if((attempt.run_id??null)!==(input.run?.id??null)||(original.run_id??null)!==(attempt.run_id??null)||digest(run)!==digest(input.run??null))throw err('单条核验执行记录与原任务快照不符');
            this.round.assertLease(input.roundId);
            const assigned=this.round.windows.assert(input.executionWindowId,input.roundId);
            if(window&&window.id!==assigned.id)throw err('其他轮次尚未结束，不能借用核验页面范围');
            if(!this.round.windows.entries(assigned.id).some(x=>x.key===input.key&&x.task_hash===attempt.task_hash))throw err('核验商品不属于原轮次');
            window=assigned;
          }
          const ledger=setPageScope(context,{db:source.store.db,shopId:input.task.shopId,runId:input.run?.id??null,taskKey:input.key,taskHash:digest(input.task),roundId:input.roundId,executionWindowId:window?.id??null});
          if(!input.itemId)ledger.assertHealthy();
          if(!input.itemId&&!input.run)ledger.assertCanStartTask();
        }
        return this.roundVerifier.verify(input);
      }});
    source.pageScopeForRun=run=>{
      const round=this.round.round();if(!round)return {roundId:null,executionWindowId:null};
      const item=this.round.items(round.id).find(x=>x.key===run.key&&x.run_id===run.id);
      if(!item)return {roundId:null,executionWindowId:null};
      const window=this.round.windows.open(round.id);
      if(window&&!this.round.windows.entries(window.id).some(x=>x.key===item.key))throw err('任务不属于当前执行轮次的页面范围');
      return {roundId:round.id,executionWindowId:window?.id??null};
    };
    batch.round=this.round;
    this.roundItems=typeof isShopRemoved==='function'?createHostedRoundItemApi(this,{isShopRemoved}):null;
    this.round.verificationControl=id=>this.roundItems?.verification?.verifier?.controlView(id)||null;
    this.contentPreparation=new ContentPreparation(this);
    source.assertContentForLive=async task=>{const round=this.round.round();if(!round)throw err('CONTENT_REVIEW_REQUIRED: 缺少固定清单与主图内容审核');const review=this.round.assertContentForTask(task,round.id);await this.contentReviews.verifyEvidence(review,task);return review;};
    source.beforeVerified=(run,result)=>this.round.active?this.round.assertResultIdentity(this.round.active,run.key,result):undefined;
    this.roundVerifier=new RoundVerification({context:()=>{const context=this.owner.sessions.get(this.shop.id)?.context;if(!context)throw Error('专用浏览器未运行');return context;},
      guard:async(page)=>{this.round.assertLease(this.round.active);await this.assertExecution();const state=await this.owner.status(this.shop);if(state.loginState==='PAUSED_CAPTCHA'||page&&await visibleChallenge(page))throw Error('PAUSED_CAPTCHA');if(!state.running||!state.loggedIn)throw Error(state.reason||'请人工登录目标店铺');},
      round:()=>({round:this.round.round(this.round.active),items:this.round.items(this.round.active)}),artifacts:this.round.artifacts});
    if(!source.active&&!batch.active){
      try{this.round.applyDefaultImageApproval();}
      catch(e){const r=this.round.round();this.imageReviewPolicyError=reasonText(e.message);if(r&&r.state!=='SYSTEM_BLOCKED')this.round.state(r.id,'SYSTEM_BLOCKED','图片批量确认检查未通过：'+this.imageReviewPolicyError);}
    }
  }
  async handleRound(req,res,url,{body,json}){
    if(await handleOperationsSelection(this,req,res,url,{body,json}))return true;
    if(['/api/v1/rounds/item','/api/v1/rounds/item-skip','/api/v1/rounds/item-verify','/api/v1/rounds/item-retry','/api/v1/rounds/item-park'].includes(url.pathname)){
      if(!this.roundItems){json(res,503,{code:'ITEM_HOST_NOT_CONFIGURED',error:'单条操作尚未完成服务接入。'});return true;}
      const scoped=new URL(url),shops=scoped.searchParams.getAll('executionShop');
      if(shops.length>1||shops.length===1&&shops[0]!==this.shop.id)throw err('单条操作与当前执行店铺不一致');
      // The outer host owns shop routing; the item adapter accepts only its
      // original round/window/key scope (and no query string on mutations).
      scoped.searchParams.delete('executionShop');
      return this.roundItems.handle(req,res,scoped,{body,json});
    }
    const action=url.pathname.slice('/api/v1/rounds/'.length),id=url.searchParams.get('id');
    if(req.method==='GET'){
      if(action==='state'){json(res,200,this.round.view(id));return true;}
      if(action==='window'){const window=this.round.windows.view(id,{items:true});if(!window)throw err('执行轮次不存在',404);json(res,200,window);return true;}
      if(action==='window.csv'){const value=this.round.windows.csv(id);res.writeHead(200,{'content-type':'text/csv; charset=utf-8','content-disposition':'attachment; filename="execution-window-results.csv"','cache-control':'no-store'});res.end(value);return true;}
      if(action==='results.csv'){const round=this.round.round(id);if(!round)throw err('轮次不存在',404);res.writeHead(200,{'content-type':'text/csv; charset=utf-8','content-disposition':'attachment; filename="listing-round-results.csv"','cache-control':'no-store'});res.end(this.round.csv(round.id));return true;}
      if(action==='parked-items.csv'){const round=this.round.round(id);if(!round)throw err('轮次不存在',404);res.writeHead(200,{'content-type':'text/csv; charset=utf-8','content-disposition':'attachment; filename="parked-items.csv"','cache-control':'no-store'});res.end(this.round.parkedCsv(round.id));return true;}
    }
    if(req.method!=='POST')throw err('轮次操作不存在',404);
    if(['pause','stop'].includes(action)){
      const input=await body(req),r=this.round.round(),latest=r&&this.round.windows.latest(r.id),w=r&&(this.round.windows.open(r.id)||(latest?.continuation_pending?latest:null));
      assertShopInput(input,this.shop.id);
      const verifier=this.roundItems?.verification?.verifier;
      if(verifier?.activeRequest||input?.verificationRequestId!==undefined){
        if(verifier?.controlScope(input)!==true)throw err('核验操作范围已变化，请刷新后操作原核验任务');
        const result=this.round[action]();json(res,200,{...result,verificationControl:{id:input.id,windowId:input.windowId,key:input.key,verificationRequestId:input.verificationRequestId},requestedAction:action});return true;
      }
      if(w&&(input.id!==r.id||input.windowId!==w.id))throw err('执行轮次已变化，请刷新后操作当前轮次');
      if(input.id&&input.id!==r?.id||input.windowId&&input.windowId!==w?.id)throw err('原执行轮次已结束，不能操作其他轮次');
      json(res,200,this.round[action]());return true;
    }
    if(!['create','start','resume','content-review','rules-apply','window-preview','window-create','success-goal-preview','success-goal-create'].includes(action))throw err('轮次操作不存在',404);
    const input=await body(req),target=action==='create'?input.importId:input.id;
    assertShopInput(input,this.shop.id);
    if(!/^[a-f0-9-]{36}$/i.test(input.requestId||''))throw err('缺少有效操作编号');
    const previous=this.source.store.db.prepare('SELECT * FROM product_actions WHERE id=?').get(input.requestId);
    if(previous){if(previous.action!=='rounds/'+action||previous.target!==target)throw err('请求编号不能用于其他操作');const result=JSON.parse(previous.result);if((['content-review','rules-apply','window-create','success-goal-create'].includes(action)||result.attemptId)&&result.inputHash!==digest(input))throw err(action==='content-review'?'请求编号对应的审核内容已改变':'请求编号对应的范围内容已改变');json(res,200,{...result,replayed:true});return true;}
    if(action==='rules-apply'){
      this.assertRulesIdle();this.round.assertIdle();const round=this.round.assertManifest(input.id);if(input.manifestHash!==round.manifest_hash)throw err('固定轮次范围已变化');
      const kernel=await this.integrity();if(!kernel.ok)throw err('内核校验失败，不能追加本轮规则');
      const result=this.round.applyUserRules(round.id,{manifestHash:input.manifestHash,ignoreDestinationDuplicates:input.ignoreDestinationDuplicates===true,acceptDedhamTransliteration:input.acceptDedhamTransliteration===true,confirmedBy:input.confirmedBy||'用户'});
      result.inputHash=digest(input);this.source.store.db.prepare('INSERT INTO product_actions VALUES(?,?,?,?,?)').run(input.requestId,'rounds/'+action,target,new Date().toISOString(),JSON.stringify(result));
      await this.round.report(round.id);json(res,200,{...result,round:this.round.summary(round.id)});return true;
    }
    if(action==='success-goal-preview'){
      this.assertRulesIdle();this.round.assertIdle();const r=this.round.assertManifest(input.id);if(input.manifestHash!==r.manifest_hash)throw err('固定清单范围已变化');
      this.capturing=true;try{json(res,200,await this.round.successGoals.preview(r.id,input));}finally{this.capturing=false;}return true;
    }
    if(action==='window-preview'){
      this.assertRulesIdle();this.round.assertIdle();const r=this.round.assertManifest(input.id);if(input.manifestHash!==r.manifest_hash)throw err('固定清单范围已变化');
      this.capturing=true;
      try{json(res,200,await this.round.windows.preview(r.id,input));}finally{this.capturing=false;}
      return true;
    }
    if(action==='content-review'){
      this.assertRulesIdle();this.round.assertIdle();const round=this.round.assertManifest(input.id),kernel=await this.integrity();if(!kernel.ok)throw err('内核校验失败，不能保存内容审核');
      const prepared=await this.contentReviews.prepare(round,this.round.items(round.id),input);
      this.assertRulesIdle();this.round.assertIdle();this.round.assertManifest(round.id);
      let result;
      this.source.store.transaction(()=>{this.contentReviews.save(prepared);this.round.applyContentReviews(round.id,prepared);result={accepted:true,id:round.id,reviewed:prepared.length,inputHash:digest(input)};this.source.store.db.prepare('INSERT INTO product_actions VALUES(?,?,?,?,?)').run(input.requestId,'rounds/'+action,target,new Date().toISOString(),JSON.stringify(result));});
      await this.round.report(round.id);json(res,200,{...result,round:this.round.summary(round.id)});return true;
    }
    const executionRecovery=this.round.executionAttempts.recoveryView(input.id);
    if(action==='resume'&&executionRecovery){
      if(input.attemptId!==executionRecovery.attemptId||input.windowId!==executionRecovery.windowId||input.manifestHash!==this.round.assertManifest(input.id).manifest_hash)throw err('处理记录范围已变化，请刷新后恢复原记录');
      if(this.capturing||this.reconciling||this.source.active||this.round.hasUnsettledExecution())throw err('当前执行尚未停止，请等待安全边界');
      await this.round.pending;
      await this.assertExecution();const recoveryKernel=await this.integrity();if(!recoveryKernel.ok)throw err('内核校验失败，不能恢复处理记录');
      const recoveryBrowser=await this.owner.status(this.shop);if(!recoveryBrowser.running||!recoveryBrowser.loggedIn)throw err('请先登录原店铺，再恢复处理记录');
      let result;
      this.round.executionAttempts.recover(input,{commit:recovered=>{
        result={accepted:true,id:input.id,recordRecovered:true,executionStarted:false,stopped:recovered.stopped,attemptId:recovered.attemptId,inputHash:digest(input)};
        this.source.store.db.prepare('INSERT INTO product_actions VALUES(?,?,?,?,?)').run(input.requestId,'rounds/'+action,target,new Date().toISOString(),JSON.stringify(result));
      }});
      json(res,200,{...result,round:this.round.summary(input.id)});return true;
    }else if(input.attemptId!==undefined)throw err('原处理记录已恢复，请刷新状态后继续');
    this.assertRulesIdle();this.round.assertIdle();await this.assertExecution();
    const kernel=await this.integrity();if(!kernel.ok)throw err('内核校验失败，禁止开始轮次');
    const browser=await this.owner.status(this.shop);if(!browser.running||!browser.loggedIn)throw err(browser.reason||'请先登录目标店铺');
    this.assertRulesIdle();this.round.assertIdle();
    let result;
    if(action==='success-goal-create'){
      const r=this.round.assertManifest(input.id);if(input.manifestHash!==r.manifest_hash)throw err('固定清单范围已变化');
      this.capturing=true;let created;
      try{created=await this.round.successGoals.create(r.id,input,{commit:result=>this.source.store.db.prepare('INSERT INTO product_actions VALUES(?,?,?,?,?)').run(input.requestId,'rounds/'+action,target,new Date().toISOString(),JSON.stringify({accepted:true,id:r.id,windowId:result.window.id,goal:result.goal,inputHash:digest(input),executionStarted:false}))});}finally{this.capturing=false;}
      // Durable creation precedes execution. Replayed requests never start a
      // second publisher, including after a crash between commit and start.
      this.roundVerifier.reset();this.round.start(r.id,{windowId:created.window.id,repairVersion:kernel.revision});
      json(res,200,{accepted:true,id:r.id,windowId:created.window.id,goal:this.round.successGoals.summary(r.id),round:this.round.summary(r.id),executionStarted:true});return true;
    }
    if(action==='window-create'){
      const r=this.round.assertManifest(input.id);if(input.manifestHash!==r.manifest_hash)throw err('固定清单范围已变化');
      this.capturing=true;
      try{
        const preview=await this.round.windows.preview(r.id,input);
        if(preview.selectionHash!==input.selectionHash)throw err('预检范围已变化，请重新检查');
        result=this.round.windows.create(preview,{commit:window=>this.source.store.db.prepare('INSERT INTO product_actions VALUES(?,?,?,?,?)').run(input.requestId,'rounds/'+action,target,new Date().toISOString(),JSON.stringify({accepted:true,...window,inputHash:digest(input)}))});
      }finally{this.capturing=false;}
      json(res,200,{accepted:true,...result});return true;
    }
    if(action==='create'){
      if(kernel.revision&&input.repairVersion!==kernel.revision)throw err('轮次修复版本与当前内核不符');
      result=await this.round.create(input);
    }else{
      const round=this.round.assertManifest(input.id);
      if(input.manifestHash!==round.manifest_hash)throw err('固定轮次范围已变化，请重新核对');
      if(action==='start'&&round.state!=='READY')throw err('轮次已开始，请从原轮次继续');
      // Only the server's fresh target-shop inspection can clear an old,
      // unsubmitted CAPTCHA hold. Client input cannot supply this proof.
      const captchaVerification=action==='resume'?this.round.verifyClearedCaptcha(input.id,browser):null;
      this.roundVerifier.reset();result=this.round[action](input.id,{humanVerified:input.humanVerified===true,captchaVerification,repairVersion:kernel.revision||input.repairVersion,windowId:input.windowId});
    }
    this.source.store.db.prepare('INSERT INTO product_actions VALUES(?,?,?,?,?)').run(input.requestId,'rounds/'+action,target,new Date().toISOString(),JSON.stringify({accepted:true,id:result.id,...(input.attemptId?{attemptId:input.attemptId,inputHash:digest(input)}:{})}));
    json(res,200,result);return true;
  }
  assertRulesIdle(){if(this.batch.active||this.source.active||this.capturing)throw err('任务执行或属性读取中，请等待结束');}
  assertImportRules(id){
    const imported=this.source.store.batch(id),preset=this.rules.preset(this.shop.id);
    if(imported&&(imported.tasks.some(t=>t.shopId!==this.shop.id)||(imported.sourceBinding&&imported.sourceBinding.shopId!==this.shop.id)))throw err('商品资料与当前执行店铺不一致，请在对应店铺重新导入');
    if(!/^travel-os-template-v[12]$/.test(imported?.format||'')||!preset.enabled)return;
    const root=imported.assetRoot;
    for(const a of [...preset.secondary.A,...preset.secondary.B,...preset.covers]){const r=relative(root,a.path);if(isAbsolute(r)||r==='..'||r.startsWith('..'+sep))throw err('新资料与发布随机规则不一致：规则仍引用旧资料，请在资料设置重新选择图片并确认。已有任务不变。');}
  }
  async preparePreview(id,limit=DEFAULT_BATCH_SIZE){this.assertRulesIdle();this.assertImportRules(id);const p=this.preview(id,limit);return {...await this.rules.prepare(p,this.shop.id),importTotal:this.source.store.batch(p.importId)?.tasks.length||0};}
  async createBatch(input){
    this.assertRulesIdle();
    const round=this.round?.round();if(round&&round.state!=='COMPLETED')throw err('已有固定清单轮次，请从原轮次继续；不能另起批次创建任务');
    if(input.mode==='LIVE')throw err('正式发布请使用自动化任务中的“创建执行批次”建立本店清单；图片按用户要求默认批量确认，本次没有消耗次数');
    this.assertImportRules(input.importId);
    if(input.draftId)return this.rules.create(input,this.shop.id,this.batch,()=>this.preview(input.importId,input.limit??DEFAULT_BATCH_SIZE));
    if(this.rules.preset(this.shop.id).enabled)throw err('随机规则已启用，请重新生成并确认随机预览');
    return this.batch.create(input,this.shop);
  }
  async capturePublishingFields(){
    this.assertRulesIdle();this.capturing=true;let page;
    const dir=join(this.source.artifacts,'attribute-capture');
    const guard=async()=>{
      const s=await this.owner.status(this.shop);
      if(s.loginState==='PAUSED_CAPTCHA'||page&&await visibleChallenge(page))throw Error('PAUSED_CAPTCHA：请在执行 Chrome 手动处理验证码，再重新读取');
      if(!s.running||!s.loggedIn)throw Error('请先在执行 Chrome 登录目标店铺');
      if(page){if(!newForm(page))throw Error('请保留新增商品发布页');const identity=page.locator('div.UserArea_shopName__3xGhm');if(await identity.count()!==1||(await identity.innerText()).trim()!==this.shop.name)throw Error('发布页店铺身份不匹配');}
    };
    try{
      await guard();const context=this.owner.sessions.get(this.shop.id)?.context;
      const pages=context?.pages().filter(newForm)||[];
      if(pages.length!==1)throw Error('请在执行 Chrome 手动打开一个新增商品发布页，展开类目属性；保留唯一发布页后重试读取');
      page=pages[0];await guard();const fields=await captureAttributes(page,guard);
      const result=this.rules.capture(this.shop.id,fields);this.source.store.db.prepare('DELETE FROM publishing_captures WHERE id=?').run('checkpoint-'+this.shop.id);return result;
    }catch(e){
      await mkdir(dir,{recursive:true});const checkpoint={state:/CAPTCHA/.test(e.message)?'WAITING_HUMAN':'PAUSED',reason:redact(e.message),at:new Date().toISOString(),step:'读取属性候选',shopId:this.shop.id};
      const screenshot=join(dir,'paused.png');if(page)await page.screenshot({path:screenshot,timeout:5000}).then(()=>checkpoint.screenshot=screenshot).catch(()=>{});
      await writeFile(join(dir,'checkpoint.json'),JSON.stringify(checkpoint,null,2));
      this.source.store.db.prepare('INSERT OR REPLACE INTO publishing_captures VALUES(?,?,?)').run('checkpoint-'+this.shop.id,this.shop.id,JSON.stringify(checkpoint));throw e;
    }finally{this.capturing=false;}
  }
  async settings() {
    let saved={};try{saved=JSON.parse(await readFile(this.settingsFile,'utf8'));}catch(e){if(e.code!=='ENOENT')throw err('系统设置无法读取，保持暂停，请检查本机文件。');}
    if(this.websiteSettingsFile){const shared=JSON.parse(await readFile(this.websiteSettingsFile,'utf8').catch(e=>{if(e.code==='ENOENT')return '{}';throw e;}));delete saved.websiteListingDefaults;if(shared.websiteListingDefaults)saved.websiteListingDefaults=shared.websiteListingDefaults;}
    const map=saved.shopListingDefaults;
    if(map!==undefined&&(!map||typeof map!=='object'||Array.isArray(map)))throw err('店铺默认发布规则无效，请核对本机设置。');
    const defaults=map?.[this.shop.id];
    if(Object.hasOwn(map||{},this.shop.id)&&(!defaults||typeof defaults!=='object'||Array.isArray(defaults)||defaults.shopId!==this.shop.id||typeof defaults.ignoreExternalDestinationProducts!=='boolean'||!Number.isInteger(defaults.revision)||defaults.revision<1||typeof defaults.confirmedAt!=='string'||!Number.isFinite(Date.parse(defaults.confirmedAt))))throw err('店铺默认发布规则无效，请核对本机设置。');
    const website=saved.websiteListingDefaults;
    if(Object.hasOwn(saved,'websiteListingDefaults')&&(!website||typeof website!=='object'||Array.isArray(website)||website.scope!=='ALL_SHOPS'||typeof website.ignoreExternalDestinationProducts!=='boolean'||!Number.isInteger(website.revision)||website.revision<1||typeof website.confirmedAt!=='string'||!Number.isFinite(Date.parse(website.confirmedAt))))throw err('网站默认发布规则无效，请核对本机设置。');
    // The website rule applies to every current and future shop. Retain old
    // shop preferences as history, but do not let them override this rule.
    const effective=website?{...website,shopId:this.shop.id,scope:'WEBSITE_DEFAULT'}:defaults||{shopId:this.shop.id,ignoreExternalDestinationProducts:false,revision:0,confirmedAt:null};
    return {executionEnabled:false,limit:DEFAULT_BATCH_SIZE,...(this.shop.id==='wuzhou-changyou'?batchDefaults:{heat:'',pool:'',assets:'',sheet:'境外城市热度'}),...saved,listingDefaults:effective};
  }
  async saveSettings(input) {
    const allowed=['executionEnabled','limit','heat','pool','assets','sheet','confirmShop','ignoreExternalDestinationProducts','listingDefaultsScope','confirmAllShops'];
    if(Object.keys(input).some(k=>!allowed.includes(k)))throw err('无效设置字段',400);
    if(('listingDefaultsScope' in input||'confirmAllShops' in input)&&!('ignoreExternalDestinationProducts' in input))throw err('缺少默认发布规则设置',400);
    if(this.websiteSettingsFile&&input.listingDefaultsScope==='WEBSITE_DEFAULT')throw err('网站统一规则请在五洲畅游设置页修改；本店自动继承');
    const old=await this.settings(),next={...old};
    for(const key of ['heat','pool','assets','sheet'])if(key in input){if(typeof input[key]!=='string'||!input[key].trim()||input[key].length>2000)throw err('资料路径或工作表无效',400);next[key]=input[key].trim();}
    if('limit' in input){if(!Number.isInteger(input.limit)||input.limit<1||input.limit>MAX_BATCH_SIZE)throw err(`每批数量为 1—${MAX_BATCH_SIZE}`,400);next.limit=input.limit;}
    if('ignoreExternalDestinationProducts' in input){
      const scope='listingDefaultsScope' in input?input.listingDefaultsScope:'SHOP_DEFAULT';
      if(!['SHOP_DEFAULT','WEBSITE_DEFAULT'].includes(scope)||typeof input.ignoreExternalDestinationProducts!=='boolean')throw err('默认发布规则无效',400);
      if(scope==='WEBSITE_DEFAULT'){if(input.confirmAllShops!==true)throw err('请确认默认规则适用于网站所有店铺');}
      else{
        if('confirmAllShops' in input)throw err('店铺默认规则不能使用网站范围确认',400);
        if(old.websiteListingDefaults)throw err('网站已统一设置所有店铺的默认规则，请按网站范围修改');
        if(input.confirmShop!==this.shop.name)throw err('请确认要保存默认规则的店铺');
      }
      this.assertRulesIdle();this.round.assertIdle();if(this.round.creating)throw err('清单正在创建，请等待默认规则写入完成');
      // Saving a future preference is not an execution approval. Creation,
      // start and resume still enforce the original kernel and LIVE gates.
      if(scope==='WEBSITE_DEFAULT')next.websiteListingDefaults={scope:'ALL_SHOPS',ignoreExternalDestinationProducts:input.ignoreExternalDestinationProducts,revision:(old.websiteListingDefaults?.revision||0)+1,confirmedAt:new Date().toISOString(),source:'user-confirmed-website-default'};
      else next.shopListingDefaults={...old.shopListingDefaults,[this.shop.id]:{shopId:this.shop.id,ignoreExternalDestinationProducts:input.ignoreExternalDestinationProducts,revision:(old.shopListingDefaults?.[this.shop.id]?.revision||0)+1,confirmedAt:new Date().toISOString(),source:'user-confirmed-shop-default'}};
    }
    if('executionEnabled' in input){
      if(typeof input.executionEnabled!=='boolean')throw err('执行开关无效',400);
      if(input.executionEnabled&&!old.executionEnabled&&input.confirmShop!==this.shop.name)throw err('开启执行前请确认目标店铺');
      if(input.executionEnabled){const check=await this.integrity();if(!check.ok)throw err('上架内核发生变化，执行已阻止');}
      if(!input.executionEnabled){if(this.batch.active)this.batch.pause();else if(this.source.active)this.source.pause();}
      next.executionEnabled=input.executionEnabled;
    }
    await mkdir(join(this.runtime,'product-v1'),{recursive:true});
    delete next.listingDefaults; // Effective read projection, never a second stored default.
    await writeFile(this.settingsFile+'.tmp',JSON.stringify(next,null,2));await rename(this.settingsFile+'.tmp',this.settingsFile);
    this.checkResult=null;return this.settings();
  }
  async assertExecution({legacy=false}={}) {
    if(legacy){const round=this.round?.round();if(round&&round.state!=='COMPLETED')throw err('已有固定清单轮次，请从原轮次继续；不能另起批次执行');}
    if(this.capturing)throw err('正在读取属性，请等待完成后再启动或恢复任务');
    if(!this.batch.active&&!this.source.active&&this.source.store.list().some(r=>['RUNNING','SUBMITTING'].includes(r.state)))throw err('任务状态待检查：请重启程序恢复持久状态，不能开始新执行');
    if(!(await this.settings()).executionEnabled)throw err('当前暂停新任务执行。需要开始时，请在系统设置中明确开启。');
    if(!(await this.integrity()).ok)throw err('上架内核发生变化，执行已阻止');
    if(this.capturing)throw err('正在读取属性，请等待完成后再启动或恢复任务');
  }
  executionScope(id){
    const b=this.batch.store.batch(id);if(!b)return null;
    const db=this.source.store.db;
    // Persisted events invalidate confirmations even when a state changes back.
    const revision=db.prepare('SELECT MAX(seq) n FROM batch_events WHERE batch=?').get(b.id).n;
    // Read the frozen queue, run checkpoint and per-run event revision in one
    // query. The former implementation issued several synchronous SQLite
    // queries per row (and reparsed the same run repeatedly) on every SSE
    // snapshot, blocking the HTTP event loop long enough for health checks and
    // the UI's connection watchdog to time out during 100-item batches.
    const rows=db.prepare(`SELECT i.id,i.position,i.task,i.state,i.attempts,i.max_attempts,i.run_id,
      r.id run_id_value,r.key run_key,r.batch run_batch,r.task run_task,r.mode run_mode,r.target run_target,
      r.state run_state,r.checkpoint run_checkpoint,r.result run_result,r.reason run_reason,r.at run_at,
      COALESCE(e.revision,0) run_revision
      FROM batch_items i LEFT JOIN runs r ON r.id=i.run_id
      LEFT JOIN (SELECT run,MAX(seq) revision FROM events GROUP BY run) e ON e.run=r.id
      WHERE i.batch=? ORDER BY i.position`).all(b.id);
    const items=rows.map(x=>{
      const run=x.run_id?{id:x.run_id_value,key:x.run_key,batch:x.run_batch,task:JSON.parse(x.run_task),mode:x.run_mode,target:x.run_target,
        state:x.run_state,checkpoint:JSON.parse(x.run_checkpoint),result:x.run_result?JSON.parse(x.run_result):null,reason:x.run_reason,at:x.run_at}:null;
      return {id:x.id,position:x.position,task:digest(JSON.parse(x.task)),state:x.state,attempts:x.attempts,maxAttempts:x.max_attempts,
        runId:x.run_id,run,revision:x.run_id?x.run_revision:null};
    });
    return digest({version:1,id:b.id,shop:b.shop,mode:b.mode,state:b.state,review:b.review,revision,items});
  }
  assertScope(input){
    if(typeof input.scope!=='string'||!/^[a-f0-9]{64}$/.test(input.scope))throw err('缺少本次执行范围确认，请刷新工作台并重新核对');
    if(input.scope!==this.executionScope(input.id))throw err('批次范围或状态已变化，请重新核对后确认');
  }
  validationIssues(){
    const imported=this.source.store.batch();if(!imported||imported.sheet!=='境外城市热度')return [];
    const db=this.source.store.db,revision=db.prepare('SELECT (SELECT COALESCE(MAX(seq),0) FROM events) runs,(SELECT COALESCE(MAX(seq),0) FROM batch_events) queues').get();
    const signature=`${imported.id}:${revision.runs}:${revision.queues}`;
    if(this.validationCache?.signature===signature)return this.validationCache.value;
    const value=this.batch.preview(imported.id,20).excluded.filter(x=>!/已有成功|重复国家城市|已有队列|已有单条/.test(x.reason));
    this.validationCache={signature,value};return value;
  }
  preview(id,limit=DEFAULT_BATCH_SIZE){
    this.assertImportRules(id);
    const result=this.batch.preview(id,limit),classes={};
    for(const x of result.excluded){x.category=/已有成功/.test(x.reason)?'已成功':/重复/.test(x.reason)?'重复':/已有队列|已有单条/.test(x.reason)?'已有任务':'需补充';classes[x.category]=(classes[x.category]||0)+1;}
    return {...result,classification:{可执行:result.tasks.length,...classes},scope:'按热度顺序选取前 '+result.tasks.length+' 条合格商品；不包含已成功、已占用或资料不完整的商品'};
  }
  async checkConfiguration(){
    const settings=await this.settings(),checks=[];
    for(const [key,name,directory] of [['heat','热度 Excel',false],['pool','商品 Excel',false],['assets','图片目录',true]]){
      try{const entry=await stat(settings[key]),ok=directory?entry.isDirectory():entry.isFile()&&/\.xlsx$/i.test(settings[key]);checks.push({name,ok,detail:ok?'路径可用；内容需导入校验':'路径类型不正确'});}
      catch{checks.push({name,ok:false,detail:'路径不存在或当前无法访问'});}
    }
    const kernel=await this.integrity();checks.push({name:'冻结内核',ok:kernel.ok,detail:kernel.ok?kernel.files+' 个冻结文件校验通过':'内核文件变化，禁止执行'});
    let raw;try{raw=await this.owner.status(this.shop);}catch{raw={loginState:'LOGIN_UNVERIFIED',reason:'执行浏览器检查失败，待人工确认'};}
    const browser=browserView(raw,Date.now(),true);checks.push({name:'执行浏览器与店铺',ok:browser.loggedIn,detail:browser.label+' · '+browser.reason});
    return this.checkResult={at:new Date().toISOString(),checks,browser,connection:{address:'127.0.0.1',port:this.shop.port||9222,ownership:'仅项目专用 Chrome；不接管访问工作台的浏览器'}};
  }
  async recovery(input,single=false){
    const checks=[],settings=await this.settings(),kernel=await this.integrity();
    checks.push({name:'任务执行许可',ok:settings.executionEnabled,detail:settings.executionEnabled?'已开启':'执行开关关闭；检查可以进行，但不能恢复'});
    checks.push({name:'内核冻结',ok:kernel.ok,detail:kernel.ok?'冻结校验通过':'内核已改变'});
    checks.push({name:'串行执行',ok:!this.batch.active&&!this.source.active,detail:this.batch.active||this.source.active?'任务尚在运行或正在暂停':'当前没有其他执行任务'});
    let browser;try{browser=browserView(await this.owner.status(this.shop),Date.now(),true);}catch{browser=browserView();}
    checks.push({name:'执行浏览器 / 登录',ok:browser.loggedIn,detail:browser.reason});
    const view=single?null:this.batch.store.view(input.id);if(!single&&!view)throw err('批次不存在',404);
    if(!single&&input.operation!=='retry'){
      const scope=this.batch.store.retryScope(input.id);
      const failed=view.items.some(x=>x.state==='FAILED'&&(!scope||scope.includes(x.id)));
      checks.push({name:'异常隔离',ok:!failed,detail:failed?'本批含未处理异常，请重试异常链接或明确跳过，不能直接继续后续商品':'没有被绕过的异常任务'});
    }
    if(input.operation==='retry'){
      const actual={...view,items:view.items.map(x=>({...x,runState:x.runId?this.source.store.run(x.runId).state:x.state}))};
      const plan=retryPlan(actual,this.batch.active||this.source.active);
      checks.push({name:'异常重试范围',ok:plan.allowed,detail:plan.reason||`本批 ${plan.eligible.length} 条失败商品，成功项不重复执行`});
    }
    const runs=single?[this.source.store.run(input.id)]:view.items.filter(x=>x.runId&&(input.operation==='retry'?['FAILED','RETRY'].includes(x.state)&&x.attempts<x.maxAttempts:['WAITING_HUMAN','RETRY'].includes(x.state)||!input.operation&&x.state==='FAILED')).map(x=>this.source.store.run(x.runId));
    for(const r of runs){
      checks.push({name:r.task.listing.city||r.task.listing.country,ok:!['RUNNING','SUBMITTING','VERIFIED','DRY_RUN_COMPLETE'].includes(r.state),detail:r.state==='DRY_RUN_COMPLETE'?'仅填写批次不自动转正式模式':r.state==='VERIFIED'?'已成功，禁止重复':'原任务状态：'+({PAUSED:'已暂停',PAUSED_CAPTCHA:'等待人工验证',RESULT_UNKNOWN:'待核验',RUNNING:'运行中',SUBMITTING:'提交结果待确认',VERIFIED:'成功',QUEUED:'待执行'}[r.state]||'待检查')});
      if(r.state==='RESULT_UNKNOWN')checks.push({name:'提交结果核验',ok:!!r.checkpoint.itemId,detail:r.checkpoint.itemId?'已有商品 ID，只核验原商品':'提交结果待核验且无商品 ID；请先人工在后台核对，禁止重新发布'});
      try{await this.checkFiles(r.task);checks.push({name:'原任务资料',ok:true,detail:'源文件、素材及业务字段与冻结快照一致'});}catch(e){checks.push({name:'原任务资料',ok:false,detail:'资料检查未通过：'+redact(e.message)});}
    }
    return {at:new Date().toISOString(),ready:checks.every(x=>x.ok===true),checks};
  }
  closeStreams(){for(const res of this.streams)res.end();this.streams.clear();}
  pause(){return this.batch.active?this.batch.pause():this.source.active?this.source.pause():{pauseRequested:false,reason:'当前无执行任务'};}
  screenshot(path) {
    if(!path||!isAbsolute(path))return null;
    const rel=relative(this.source.artifacts,path),parts=rel.split(sep);
    if(parts.length!==2||parts.some(x=>!x||x.startsWith('.'))||!path.endsWith('.png'))return null;
    return '/output/tasks/'+parts.map(encodeURIComponent).join('/');
  }
  contentHold(key){return this.source.store.db.prepare("SELECT key,run_id,queue_id,batch_id,reason,result FROM round_items WHERE key=? AND state='RESULT_UNKNOWN' AND failure_stage='content-review' ORDER BY rowid DESC LIMIT 1").get(key)||null;}
  roundHolds(){
    const round=this.round.round();if(!round||round.shop!==this.shop.id)return new Map();
    const rows=this.source.store.db.prepare("SELECT round_id,key,task_hash,run_id,queue_id,batch_id,failure_stage,reason,entered_publish,submitted,submission_uncertain,json_extract(task,'$.shopId') shop,json_extract(task,'$.listing.city') city,json_extract(task,'$.listing.country') country,json_extract(task,'$.listing.title') title FROM round_items WHERE round_id=? AND state='RESULT_UNKNOWN'").all(round.id);
    return new Map(rows.filter(x=>x.shop===round.shop).map(x=>[x.key,{...x,type:x.failure_stage==='content-review'?'content':x.failure_stage==='existing-listing-check'&&!x.entered_publish&&!x.submitted&&!x.submission_uncertain?'candidate':'submission'}]));
  }
  projectRoundHold(view,{key,task,runId,queueId}={},holds=this.roundHolds()){
    const hold=holds.get(key);if(!hold||task&&(task.shopId!==this.shop.id||destinationKey(task)!==key||digest(task)!==hold.task_hash)||runId&&runId!==hold.run_id||queueId&&queueId!==hold.queue_id)return view;
    const issue=roundHoldIssue(hold),candidateHold=hold.type==='candidate',contentHold=hold.type==='content',displayReason=candidateHold?reasonText(hold.reason).replace(/^后台有同目的地候选/,'后台有地名或商品范围待核验候选'):reasonText(hold.reason);
    return {...view,key,roundId:hold.round_id,runId:hold.run_id||null,queueId:hold.queue_id||null,roundHold:{type:hold.type,roundId:hold.round_id,key,stage:hold.failure_stage},candidateHold,contentHold,retryBlocked:true,displayState:'RESULT_UNKNOWN',reason:displayReason,issue,
      enteredPublish:!!hold.entered_publish,submitted:!!hold.submitted,submissionUncertain:!!hold.submission_uncertain,
      history:view.history||{state:view.state,reason:reasonText(view.reason),step:view.step||view.checkpoint?.step||null,screenshot:view.screenshot||null,attempts:view.attempts,maxAttempts:view.maxAttempts},
      completeness:candidateHold?'商品范围待核验；本轮未提交':contentHold?'主图内容待核验':'提交结果待核验'};
  }
  records(runs,queues=null) {
    const db=this.source.store.db,rows=db.prepare('SELECT key,payload FROM history').all(),known=new Map(runs.map(r=>[r.key,r]));
    const queueByRun=queues?.byRun||new Map(db.prepare('SELECT id,batch,run_id,state,attempts,max_attempts FROM batch_items WHERE run_id IS NOT NULL').all().map(x=>[x.run_id,x]));
    const verifiedAt=new Map();for(const row of db.prepare("SELECT run,at FROM events WHERE kind='VERIFIED' ORDER BY seq").all())verifiedAt.set(row.run,row.at);
    const contentHolds=new Map();for(const row of db.prepare("SELECT key,run_id,queue_id,batch_id,reason,result FROM round_items WHERE state='RESULT_UNKNOWN' AND failure_stage='content-review' ORDER BY rowid").all())contentHolds.set(row.key,row);
    const count=this.source.store.db.prepare('SELECT COUNT(*) n FROM imports').get().n;
    if(count!==this.catalogCount){this.catalog.clear();for(const row of this.source.store.db.prepare('SELECT payload FROM imports ORDER BY rowid').all()){for(const t of JSON.parse(row.payload).tasks)this.catalog.set(destinationKey(t),t);}this.catalogCount=count;}
    const complete=rows.map(row=>{
      const result=JSON.parse(row.payload),run=known.get(row.key),task=run?.task||this.catalog.get(row.key);
      const batchId=run?queueByRun.get(run.id)?.batch:null;
      const verified=run?verifiedAt.get(run.id):null;
      return {verified:true,key:row.key,runId:run?.id||null,batchId:batchId||null,importId:run?.batch||null,source:run?.task.source||null,
        destination:task?.listing.city||task?.listing.country||'历史商品',title:run?.task.listing.title||'历史成功记录（原标题未留存）',itemId:result.itemId,status:result.status,
        at:result.verifiedAt||verified||result.at||'',timeBasis:result.verifiedAt||verified?'平台核验事件':result.at?'历史记录时间':'未记录',
        url:/^https:\/\/item\.taobao\.com\/item\.htm\?id=\d+$/.test(result.url||'')?result.url:null,screenshot:this.screenshot(result.screenshot),duplicateBlocked:true};
    });
    const unknown=runs.filter(r=>r.state==='RESULT_UNKNOWN').map(r=>({verified:false,key:r.key,runId:r.id,batchId:queueByRun.get(r.id)?.batch||null,importId:r.batch,source:r.task.source,destination:r.task.listing.city||r.task.listing.country,title:r.task.listing.title,itemId:r.checkpoint.itemId||null,status:'待核验',at:r.checkpoint.pausedAt||'',timeBasis:'待核验状态记录',url:null,screenshot:this.screenshot(r.checkpoint.screenshot),duplicateBlocked:true}));
    return [...complete,...unknown].map(r=>{const held=contentHolds.get(r.key);return held?{...r,verified:false,contentHold:true,status:'内容待核验',platformStatus:r.status,reason:reasonText(held.reason)}:r;}).sort((a,b)=>b.at.localeCompare(a.at));
  }

  event(e) {
    const names={CREATED:'创建任务',RUNNING:'开始执行',QUEUED:'等待执行',VERIFIED:'后台核验成功',PAUSED:'任务暂停',PAUSED_CAPTCHA:'等待人工验证',SUBMITTING:'准备提交',RESULT_UNKNOWN:'结果待核验',DRY_RUN_COMPLETE:'填写完成，未提交',STEP_INTENT:'开始步骤',STEP_VERIFIED:'步骤通过',STEP_PAUSED:'步骤暂停'};
    return {seq:e.seq,at:e.at,label:e.payload.name?stepName(e.payload.name):names[e.kind]||'任务记录',kind:e.kind,raw:redact(e.payload.error||e.payload.reason||''),technical:{kind:e.kind,step:e.payload.name||null},reason:reasonText(e.payload.error||e.payload.reason||''),durationMs:e.payload.durationMs,screenshot:this.screenshot(e.payload.screenshot||e.payload.result?.screenshot),screenshotError:reasonText(e.payload.screenshotError||'')};
  }
  async snapshot(id) {
    const flow=this.batch,store=this.source.store,runs=store.list(),queueRows=store.db.prepare('SELECT id,batch,key,task,state,attempts,max_attempts,run_id FROM batch_items').all(),queues={byId:new Map(queueRows.map(x=>[x.id,x])),byRun:new Map(queueRows.filter(x=>x.run_id).map(x=>[x.run_id,x]))},records=this.records(runs,queues),holds=this.roundHolds();
    const selected=flow.store.view(id),batches=store.db.prepare('SELECT id,state,mode,at,finished FROM batches ORDER BY rowid DESC').all();
    if(id&&!selected)throw err('批次不存在',404);
    const batch=selected?{...selected,executionScope:this.executionScope(selected.id),reason:redact(selected.reason),confirmation:{at:selected.at,mode:selected.mode,count:selected.total,scope:'本批全部商品，按冻结顺序串行执行',reviewed:flow.store.batch(selected.id).review.reviewed===true},items:selected.items.map(x=>({...x,checkpoint:undefined,step:stepName(x.checkpoint?.step),screenshot:this.screenshot(x.checkpoint?.screenshot),screenshotError:reasonText(x.checkpoint?.screenshotError||''),reason:reasonText(x.reason),issue:classify(x.reason,x.state),completeness:'已通过生成时校验',displayState:x.runState==='RESULT_UNKNOWN'?'RESULT_UNKNOWN':x.state}))}:null;
    for(const item of batch?.items||[]){const raw=queues.byId.get(item.id);if(!raw)throw err('队列商品关联记录缺失，停止状态核验');Object.assign(item,this.projectRoundHold(item,{key:raw.key,task:JSON.parse(raw.task),runId:raw.run_id,queueId:raw.id},holds));}
    const ownership=this.owner.sessions.get(this.shop.id);
    const browser=browserView(ownership?.last||await this.owner.status(this.shop),Date.now(),!ownership?.last);
    const exceptions=[];
    for(const r of runs.filter(r=>['PAUSED','PAUSED_CAPTCHA','RESULT_UNKNOWN','DRY_RUN_COMPLETE'].includes(r.state))){
      const row=queues.byRun.get(r.id);
      if(row&&['SUCCEEDED','SKIPPED'].includes(row.state))continue;
      const old={...classify(r.reason,r.state),id:r.id,batchId:row?.batch||null,attempts:row?.attempts,maxAttempts:row?.max_attempts,destination:r.task.listing.city||r.task.listing.country,state:r.state,reason:reasonText(r.reason|| (r.state==='DRY_RUN_COMPLETE'?'仅填写已完成，尚未提交':'')),captcha:r.state==='PAUSED_CAPTCHA',unknown:r.state==='RESULT_UNKNOWN',retryable:row?.state==='FAILED'&&row.attempts<row.max_attempts,exhausted:row?.state==='FAILED'&&row.attempts>=row.max_attempts,screenshot:this.screenshot(r.checkpoint.screenshot),step:stepName(r.checkpoint.step)};
      const current=this.projectRoundHold(old,{key:r.key,task:r.task,runId:r.id,queueId:row?.id},holds);
      exceptions.push(current.roundHold?{...current,...current.issue,state:current.displayState,unknown:true,captcha:false,retryable:false,exhausted:false}:current);
    }
    const validation=this.validationIssues();
    for(const hold of holds.values())if(!exceptions.some(x=>x.key===hold.key)){
      const run=hold.run_id?runs.find(r=>r.id===hold.run_id):null,record=records.find(r=>r.key===hold.key),queue=hold.queue_id?queues.byId.get(hold.queue_id):null;
      const old={id:run?.id||hold.key,batchId:hold.batch_id,title:hold.title,attempts:queue?.attempts,maxAttempts:queue?.max_attempts,destination:hold.city||hold.country,state:run?.state||'PENDING',reason:reasonText(run?.reason||''),step:run?stepName(run.checkpoint?.step):null,screenshot:record?.screenshot||this.screenshot(run?.checkpoint?.screenshot)};
      const current=this.projectRoundHold(old,{key:hold.key,task:run?.task,runId:run?.id},holds);
      if(current.roundHold)exceptions.push({...current,...current.issue,state:current.displayState,unknown:true,captcha:false,retryable:false,exhausted:false});
    }
    exceptions.push(...validation.map(x=>({...x,id:'data-'+x.rank,state:'DATA_INVALID',dataOnly:true,category:'资料问题',next:'补齐资料后重新导入校验',condition:'原文件保持只读；核对新导入内容后重新预览',raw:x.reason})));
    const runId=batch?.items.find(x=>x.id===batch.current)?.runId||batch?.items.findLast(x=>x.runId)?.runId;
    const events=runId?store.events(runId).slice(-35).map(e=>this.event(e)):[];
    const settings=await this.settings(),frozen=await this.integrity();
    const pageManagement=getPageLedger(this.owner.sessions.get(this.shop.id)?.context)?.snapshot()||null;
    return {version:'1.0.0',at:new Date().toISOString(),shop:{id:this.shop.id,name:this.shop.name},service:{state:'RUNNING',startedAt:this.startedAt},browser,pageManagement,execution:pauseView(flow,this.source,runs),currentTask:runs.find(r=>r.id===this.source.active)?.task.listing||null,round:this.round.summary(),configuration:this.checkResult,publishingRules:{...this.rules.summary(this.shop.id),checkpoint:JSON.parse(store.db.prepare('SELECT payload FROM publishing_captures WHERE id=?').get('checkpoint-'+this.shop.id)?.payload||'null')},settings,kernel:frozen,active:flow.active||this.source.active,batch,batches,records,exceptions,events,overview:{published:records.filter(x=>x.verified).length,totalBatches:batches.length,waiting:exceptions.filter(x=>!x.retryable).length,failed:exceptions.filter(x=>x.retryable).length},latestImport:store.batch()?.id||null};
  }
  async handle(req,res,url,{body,json}) {
    const path=url.pathname;
    if(!path.startsWith('/api/v1/'))return false;
    if(path==='/api/v1/content-preparation'||path.startsWith('/api/v1/content-preparation/'))return this.contentPreparation.handle(req,res,url,{body,json});
    if(path.startsWith('/api/v1/rounds/'))return this.handleRound(req,res,url,{body,json});
    const action=path.slice('/api/v1/'.length);
    if(action.startsWith('setup/'))return this.setup.handle(req,res,url,{body,json});
    if(req.method==='GET') {
      if(action==='globe'){json(res,200,globeCatalog(destinationCatalog(this.source.store,this.shop.id)));return true;}
      if(action==='destinations'){
        const catalog=destinationCatalog(this.source.store,this.shop.id),key=url.searchParams.get('key');
        if(key){const item=catalog.items.find(x=>x.key===key);if(!item)throw err('目的地不在当前导入资料中',404);json(res,200,{item});}
        else json(res,200,searchDestinations(catalog,url.searchParams.get('q')||'',url.searchParams.get('limit')||60,url.searchParams.get('filter')||''));
        return true;
      }
      if(action==='health'){json(res,200,{app:'ly-tb-workbench',version:'1.0.0',pid:process.pid,kernel:await this.integrity()});return true;}
      if(action==='state'){json(res,200,await this.snapshot(url.searchParams.get('batch')));return true;}
      if(action==='preview'){json(res,200,this.preview(url.searchParams.get('import'),Number(url.searchParams.get('limit')||DEFAULT_BATCH_SIZE)));return true;}
      if(action==='publishing-rules'){
        const preset=this.rules.preset(this.shop.id),checkpoint=this.source.store.db.prepare('SELECT payload FROM publishing_captures WHERE id=?').get('checkpoint-'+this.shop.id);
        const capture=preset.captureId?this.source.store.db.prepare('SELECT payload FROM publishing_captures WHERE id=?').get(preset.captureId):null;json(res,200,{shop:{id:this.shop.id,name:this.shop.name},preset,fields:capture?JSON.parse(capture.payload).fields:[],checkpoint:checkpoint?JSON.parse(checkpoint.payload):null});return true;
      }
      if(action==='publishing-materials'){json(res,200,{items:(await this.rules.materials((await this.settings()).assets,this.shop.id)).map(({path,...a})=>a)});return true;}
      if(action==='publishing-image'){const a=await this.rules.imageAsset(Object.fromEntries(url.searchParams),this.shop.id,(await this.settings()).assets);res.writeHead(200,{'content-type':a.type,'cache-control':'no-store','x-content-type-options':'nosniff'});res.end(a.bytes);return true;}
      if(action==='queue-task'){
        const item=this.batch.store.item(url.searchParams.get('id'));
        const view=this.projectRoundHold({id:item.id,state:item.state,task:item.task,attempts:item.attempts,maxAttempts:item.max_attempts,batchId:item.batch,importId:this.batch.store.batch(item.batch).imported,checkpoint:{},reason:item.reason,events:[],issue:classify(item.reason,item.state),result:item.result},{key:item.key,task:item.task,runId:item.run_id,queueId:item.id});
        json(res,200,{...view,state:view.displayState||view.state});return true;
      }
      if(action==='task'){
        const r=this.source.store.run(url.searchParams.get('id')),queue=this.source.store.db.prepare('SELECT id,batch,attempts,max_attempts FROM batch_items WHERE run_id=?').get(r.id);
        const view=this.projectRoundHold({id:r.id,state:r.state,task:r.task,importId:r.batch,batchId:queue?.batch||null,attempts:queue?.attempts,maxAttempts:queue?.max_attempts,checkpoint:{step:stepName(r.checkpoint.step),pausedAt:r.checkpoint.pausedAt,itemId:r.checkpoint.itemId},issue:classify(r.reason,r.state),reason:reasonText(r.reason),events:this.source.store.events(r.id).map(e=>this.event(e)),screenshot:this.screenshot(r.result?.screenshot||r.checkpoint.screenshot),screenshotError:r.result?.screenshot?'':reasonText(r.checkpoint.screenshotError||''),result:r.result?{...r.result,screenshot:this.screenshot(r.result.screenshot)}:null},{key:r.key,task:r.task,runId:r.id,queueId:queue?.id});
        json(res,200,{...view,state:view.displayState||view.state});return true;
      }
      if(action==='records.csv'){
        const rows=this.records(this.source.store.list()),quote=v=>'"'+String(v??'').replace(/^[=+@-]/,"'$&").replaceAll('"','""')+'"';
        const csv='\ufeff'+[['目的地','标题','商品ID','状态','核验时间','来源批次','执行任务'],...rows.map(x=>[x.destination,x.title,x.itemId,x.status,x.at,x.batchId,x.runId])].map(row=>row.map(quote).join(',')).join('\r\n');
        res.writeHead(200,{'content-type':'text/csv; charset=utf-8','content-disposition':'attachment; filename="listing-records.csv"','cache-control':'no-store'});res.end(csv);return true;
      }
      if(action==='events'){
        res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-store','connection':'keep-alive'});
        let closed=false,pending=false,blocked=false,refreshDue=false,timer;
        const cleanup=()=>{
          if(closed)return;closed=true;clearInterval(timer);this.streams.delete(stream);
          res.off('close',cleanup);res.off('finish',cleanup);res.off('error',disconnect);res.off('drain',drained);
        };
        const destroy=()=>{try{res.destroy();}catch{}};
        const disconnect=()=>{cleanup();destroy();};
        // closeStreams calls end(). Clean up immediately even when a slow
        // response cannot finish; preserve normal end() for already drained output.
        const stream={end:()=>{const unfinished=blocked||res.writableLength>0;cleanup();try{res.end();if(unfinished&&!res.writableFinished)destroy();}catch{destroy();}}};
        const ended=()=>closed||res.destroyed||res.writableEnded||res.writableFinished;
        const write=frame=>{
          if(ended()){cleanup();return;}
          try{blocked=res.write(frame)===false;}catch{disconnect();}
        };
        const push=async()=>{
          if(ended()){cleanup();return;}
          if(pending||blocked)return;
          pending=true;
          try{
            let frame;
            try{frame='event: state\ndata: '+JSON.stringify(await this.snapshot(url.searchParams.get('batch')))+'\n\n';}
            catch{frame='event: problem\ndata: {"error":"状态读取失败，请刷新工作台"}\n\n';}
            write(frame);
          }finally{pending=false;}
        };
        const poll=()=>{if(closed)return;if(blocked){refreshDue=true;return;}void push().catch(disconnect);};
        // Coalesce missed polls only; immediate drain must not bypass the cadence.
        const drained=()=>{if(!blocked||closed)return;blocked=false;if(refreshDue){refreshDue=false;poll();}};
        this.streams.add(stream);res.on('close',cleanup);res.on('finish',cleanup);res.on('error',disconnect);res.on('drain',drained);
        // The state projection includes the complete frozen queue and record
        // ledger. Rebuilding/serializing it every two seconds starves health
        // checks and can slow the publishing owner on the same Node event loop.
        // Task execution remains independent; the workbench refreshes this
        // monitor snapshot at a 15-second cadence and can still pause directly.
        timer=setInterval(poll,15000);timer.unref();await push().catch(disconnect);return true;
      }
    }
    if(req.method==='POST'){
      const input=await body(req);
      assertShopInput(input,this.shop.id);
      if(this.capturing&&action!=='pause')throw err('正在读取属性，请等待完成');
      const controlled=['start','continue','retry','resume-single'].includes(action);
      if(controlled&&input.requestId){const previous=this.source.store.db.prepare('SELECT * FROM product_actions WHERE id=?').get(input.requestId);if(previous){if(previous.action!==action||previous.target!==input.id)throw err('请求编号不能用于其他操作');json(res,200,{...JSON.parse(previous.result),replayed:true});return true;}}

      if(['start','continue','retry','resume-single'].includes(action)){
        await this.assertExecution({legacy:true});
        if(action!=='resume-single'){
          const pendingBatch=this.batch.store.batch(input.id);
          if(pendingBatch?.mode==='LIVE'&&typeof this.source.checkLiveContent==='function'){
            for(const item of this.batch.store.items(input.id).filter(x=>['PENDING','RETRY','WAITING_HUMAN','FAILED'].includes(x.state)))await this.source.checkLiveContent(item.task);
          }
        }else{
          const pendingRun=this.source.store.run(input.id);
          if((pendingRun.mode==='LIVE'||pendingRun.state==='DRY_RUN_COMPLETE'&&input.publish===true)&&typeof this.source.checkLiveContent==='function'&&!['SUBMITTING','RESULT_UNKNOWN','VERIFIED'].includes(pendingRun.state))await this.source.checkLiveContent(pendingRun.task);
        }
        const browser=browserView(await this.owner.status(this.shop),Date.now(),true);
        if(!browser.loggedIn)throw err(redact(browser.reason)||'请先登录店铺');
        if(['start','continue','retry'].includes(action)){const b=this.batch.store.view(input.id);if(b?.items.some(x=>x.runId&&this.source.store.run(x.runId).state==='PAUSED_CAPTCHA')&&input.humanVerified!==true)throw err('请确认已人工完成验证');}
      }
      if(controlled){
        if(this.batch.active||this.source.active)throw err('已有任务运行，V1 串行执行');
        if(!/^[a-f0-9-]{36}$/i.test(input.requestId||''))throw err('缺少有效操作编号，请刷新后重试',400);
        if(action!=='resume-single'){
          const current=this.batch.store.view(input.id);if(!current)throw err('批次不存在',404);
          if(current.shop!==this.shop.id)throw err('批次不属于当前执行店铺');
          if(action==='start'&&current.state!=='READY')throw err('本批已开始或已结束；请从原任务继续，不能重复开始');
        }
        if(action!=='start'){
          const checked=await this.recovery({...input,operation:action},action==='resume-single');
          if(!checked.ready)throw err(checked.checks.filter(x=>x.ok!==true).map(x=>x.detail).join('；'));
        }
      }
      // All awaited login/recovery checks finish before this final synchronous
      // scope check and dispatch. A second client cannot switch the target here.
      if(controlled){
        if(this.batch.active||this.source.active||this.capturing)throw err('已有任务运行或属性读取，请等待完成');
        if(action!=='resume-single')this.assertScope(input);
        this.source.store.db.prepare('INSERT INTO product_actions VALUES(?,?,?,?,?)').run(input.requestId,action,input.id,new Date().toISOString(),JSON.stringify({accepted:true,id:input.id,awaitStatus:true}));
      }
      let data;
      switch(action){
        case 'publishing-preview':data=await this.preparePreview(input.importId,input.limit??DEFAULT_BATCH_SIZE);break;
        case 'publishing-capture':data=await this.capturePublishingFields();break;
        case 'publishing-save':this.assertRulesIdle();data=await this.rules.save(this.shop.id,input,(await this.settings()).assets);break;
        case 'settings':data=await this.saveSettings(input);break;
        case 'import':{const settings=await this.settings(),setup=await this.setup.config();if(setup.format==='standard'&&(!input.pool||input.pool===settings.pool)){const imported=await this.setup.importSource({format:'standard',root:settings.assets});data=imported.preview;}else{if(this.shop.id!=='wuzhou-changyou')throw err('本店请通过资料设置导入标准模板');const imported=await this.batch.import({...settings,...input});data=this.preview(imported.importId,20);}break;}
        case 'upload':data=await this.source.stage(input);break;
        case 'create':data=await this.createBatch(input);break;
        case 'start':case 'continue':data=this.batch.start(input.id,this.shop);break;
        case 'retry':data=this.batch.retry(input.id,this.shop);break;
        case 'pause':data=this.pause();break;
        case 'resume-single':{
          const r=this.source.store.run(input.id);if(this.source.store.db.prepare('SELECT id FROM batch_items WHERE run_id=?').get(r.id))throw err('请从原批次恢复');
          if(r.state==='PAUSED_CAPTCHA'&&input.humanVerified!==true)throw err('请确认已人工完成验证');
          data=await this.source.resume(input,this.shop);break;
        }
        case 'check':data=await this.checkConfiguration();break;
        case 'recovery-check':data=await this.recovery(input,input.single===true);break;
        case 'reconcile':data=await this.reconciliation.associate(input);break;
        case 'browser':data=await this.launch(this.shop);await this.owner.focus(this.shop);break;
        default:throw err('未找到操作',404);
      }
      if(controlled)this.source.store.db.prepare('UPDATE product_actions SET result=? WHERE id=?').run(JSON.stringify({accepted:true,id:input.id}),input.requestId);
      json(res,200,data);return true;
    }
    json(res,404,{error:'未找到页面或操作'});return true;
  }
}
