import { readFile, writeFile, mkdir, stat, lstat } from 'node:fs/promises';
import { join, resolve, relative, extname, basename, sep } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { SourceStore, digest, destinationKey } from './source-store.mjs';
import { PROJECT_ROOT, visibleChallenge } from './browser-environment.mjs';
import { assertTaskFiles, assertPublishIdentity, fillTask, newForm, openTaskPage, verifyForm, submitTask, verifyResult, MAPPING_VERSION } from './taobao-publisher.mjs';
import {captureTaskScreenshot} from './task-screenshot.mjs';
import {closeVerifiedOwnedPage} from './publishing-pages.mjs';
import {setPageScope} from './page-ownership.mjs';
import {readPageProtection} from './page-protection.mjs';
import {readMaterialBinding} from './round-material-binding.mjs';
import {ExecutionTiming} from './execution-timing.mjs';
import {ExecutionSteps} from './execution-steps.mjs';
import {evidenceMode as normalizeEvidenceMode,EVIDENCE_POLICY_VERSION} from './execution-evidence-policy.mjs';
import {readSubmittedListing,submissionLookupWindow,assertUnclaimedSubmissionId} from './result-reconciliation.mjs';
import {recoverPreSubmitNavigation,recoverableMaterialReadiness} from './pre-submit-page-recovery.mjs';

const exec = promisify(execFile);
const defaults = { workbook: 'D:/桌面文件迁移/五洲畅游店铺：境外旅游目的地链接池_700.xlsx', assetRoot: 'D:/桌面文件迁移/五洲畅游---图片' };
const safeExtensions = new Set(['.xlsx','.png','.jpg','.jpeg','.webp']);
const publicRun = r => ({id:r.id,order:r.task.priority,title:r.task.listing.title,state:r.state,mode:r.mode,target:r.target,reason:r.reason,result:r.result,checkpoint:r.checkpoint});
const errorText = e => /CAPTCHA|_____tmd_____|action=captcha/.test(e.message) ? 'PAUSED_CAPTCHA' : String(e.message||e).replace(/https?:\/\/[^\s]+/g,'[页面地址]').slice(0,800);

// A user-confirmed shop binding is separate from immutable imported tasks.
// Business overrides remain narrow; explicit image padding preserves source files.
export async function readExecutionProfile(runtime,task){
 let text;try{text=await readFile(join(runtime,'execution-profile.json'),'utf8');}catch(e){if(e.code==='ENOENT')return null;throw e;}
 const p=JSON.parse(text),allowed=['version','shopId','confirmedBy','confirmedAt','source','freightTemplate','detailImagePadding'];
 if(Object.keys(p).some(k=>!allowed.includes(k))||p.version!==1||p.shopId!==task.shopId||p.confirmedBy!=='用户'||!Number.isFinite(Date.parse(p.confirmedAt))||typeof p.source!=='string'||!p.source||!p.freightTemplate||Object.keys(p.freightTemplate).some(k=>!['from','to'].includes(k))||!['from','to'].every(k=>typeof p.freightTemplate[k]==='string'&&p.freightTemplate[k].trim()===p.freightTemplate[k]&&p.freightTemplate[k]))throw Error('FORM_EXECUTION_PROFILE_INVALID：店铺执行设置未获得有效确认');
 if(![p.freightTemplate.from,p.freightTemplate.to].includes(task.business.freight_template))throw Error('FORM_EXECUTION_PROFILE_SOURCE_CHANGED：原商品运费模板与确认记录不一致');
 let detailImagePadding;
 if(p.detailImagePadding!==undefined){
  if(!Array.isArray(p.detailImagePadding)||!p.detailImagePadding.length||p.detailImagePadding.length>10)throw Error('FORM_DETAIL_PADDING_INVALID');
  const seen=new Set();detailImagePadding=[];
  for(const entry of p.detailImagePadding){
   const keys=['sourcePath','sourceSha256','relativePath','sha256','dimensions','left','right'];
   if(!entry||Object.keys(entry).length!==keys.length||keys.some(k=>!Object.hasOwn(entry,k))||seen.has(entry.sourcePath)||typeof entry.sourcePath!=='string'||!entry.sourcePath||![entry.sourceSha256,entry.sha256].every(h=>/^[a-f0-9]{64}$/.test(h||''))||!/^detail-image-padding\/[A-Za-z0-9_-]+\.png$/.test(entry.relativePath||'')||![entry.left,entry.right].every(n=>Number.isInteger(n)&&n>=0&&n<=32)||entry.left+entry.right===0||!Array.isArray(entry.dimensions)||entry.dimensions.length!==2||!entry.dimensions.every(n=>Number.isInteger(n)&&n>0))throw Error('FORM_DETAIL_PADDING_INVALID');
   seen.add(entry.sourcePath);const path=join(runtime,entry.relativePath);
   if((await lstat(join(runtime,'detail-image-padding'))).isSymbolicLink()||(await lstat(path)).isSymbolicLink())throw Error('FORM_DETAIL_PADDING_INVALID');
   detailImagePadding.push({...entry,path});
  }
 }
 return {...p,...(detailImagePadding?{detailImagePadding}:{}),sha256:digest(p)};
}

export class SourceWorkflow {
  constructor(owner, {runtime=join(PROJECT_ROOT,'workbench/.runtime/source-workflow'), artifacts=join(PROJECT_ROOT,'workbench/output/tasks'), store, evidenceMode=process.env.TRAVEL_OS_EVIDENCE_MODE||'key'}={}) {
    this.owner=owner;this.runtime=runtime;this.artifacts=artifacts;
    this.evidenceMode=normalizeEvidenceMode(evidenceMode);
    this.store=store || new SourceStore(join(runtime,'state.sqlite'));
    this.store.recover();this.active=null;this.stop=false;
  }
  state() {
    const batch=this.store.batch(), runs=this.store.list();
    return {defaults,active:this.active, batch:batch ? {id:batch.id,at:batch.at,summary:batch.summary,sourceReadonly:batch.sourceReadonly,workbook:batch.workbook,assetRoot:batch.assetRoot,
      items:batch.tasks.map(t=>({order:t.priority,destination:t.listing.city||t.listing.country,title:t.listing.title,price:t.business.price_cny,inventory:t.business.inventory,issues:t.adapterIssues,completed:this.store.completed(t),run:runs.find(r=>r.key===destinationKey(t))?.id}))}:null,runs:runs.map(publicRun)};
  }
  async preflight(tasks,guard=()=>{}){
    const cache=new Map(); // Shared files hash once per batch preflight only.
    for(const task of tasks){guard();await assertTaskFiles(task,{cache,materialBinding:readMaterialBinding(this.store.db,task)});}guard();
    // fillTask always hashes again immediately before use; this is not a waiver.
  }
  async import({workbook,assetRoot}) {
    if(this.active)throw Error('任务执行期间不能重新识别');
    if(extname(workbook||'').toLowerCase()!=='.xlsx')throw Error('请选择 Excel .xlsx 文件');
    if(!(await stat(assetRoot)).isDirectory())throw Error('图片目录不存在');
    await mkdir(this.runtime,{recursive:true});
    const file=join(this.runtime,`recognized-${randomUUID()}.json`);
    await exec(process.env.PYTHON || 'python',[join(PROJECT_ROOT,'engine/v2/pool_adapter.py'),'--workbook',resolve(workbook),'--assets',resolve(assetRoot),'--output',file],{windowsHide:true,timeout:120000,maxBuffer:1024*1024,env:{...process.env,PYTHONIOENCODING:'utf-8'}});
    const batch=JSON.parse(await readFile(file,'utf8'));
    const history=JSON.parse(await readFile(join(PROJECT_ROOT,'output/live-first-five-20260918/batch-result.json'),'utf8').catch(()=>'null'));
    if(history?.sourceSha256===batch.sourceHash && history.shop==='五洲畅游') {
      for(const r of history.results||[]) {
        const t=batch.tasks.find(t=>t.priority===r.sourceOrder);
        if(t && r.state==='VERIFIED_NEW_ITEM' && /^\d+$/.test(r.itemId))this.store.history(t,{...r,historical:true,status:'出售中'});
      }
    }
    this.store.imported(batch);return this.state();
  }
  preview(batchId,order) {
    const batch=this.store.batch(batchId),task=batch?.tasks.find(t=>t.priority===Number(order));
    if(!task)throw Error('商品不存在');
    return {batchId:batch.id,task,taskHash:digest(task),assets:Object.entries(task.assets).flatMap(([group,files])=>files.map((a,index)=>({group,index,name:basename(a.path),url:`/api/source/asset?batch=${batch.id}&order=${order}&group=${group}&index=${index}${task.shopId!=='wuzhou-changyou'?'&executionShop='+encodeURIComponent(task.shopId):''}`})))};
  }
  async asset(url) {
    const {task}=this.preview(url.searchParams.get('batch'),url.searchParams.get('order'));
    const group=url.searchParams.get('group'),index=Number(url.searchParams.get('index'));
    if(!['main','secondary','details'].includes(group)||!Number.isInteger(index)||index<0)throw Error('无效素材');
    const a=task.assets[group][index];if(!a)throw Error('素材不存在');
    if((await lstat(a.path)).isSymbolicLink())throw Error('不读取链接素材');
    const data=await readFile(a.path);if(digest(data)!==a.sha256)throw Error('素材已变更，请重新识别');
    return {data,type:extname(a.path)==='.png'?'image/png':extname(a.path)==='.webp'?'image/webp':'image/jpeg'};
  }
  async stage(input) {
    if(input.begin) {const id=randomUUID();await mkdir(join(this.runtime,'uploads',id),{recursive:true});return {id};}
    if(!/^[a-f0-9-]{36}$/.test(input.id||''))throw Error('上传批次无效');
    const parts=String(input.name||'').replaceAll('\\','/').split('/');
    if(parts.some(p=>!p||p.startsWith('.')||/[<>:"|?*\u0000-\u001f]/.test(p)||/[. ]$/.test(p)) || !safeExtensions.has(extname(parts.at(-1)).toLowerCase()))throw Error('只接受 Excel 和图片，路径无效');
    const root=join(this.runtime,'uploads',input.id),file=resolve(root,...parts);
    if(relative(root,file).startsWith('..')||!relative(root,file))throw Error('上传路径越界');
    const bytes=Buffer.from(input.data||'','base64');if(!bytes.length||bytes.length>16*1024*1024)throw Error('单文件必须小于16MB');
    await mkdir(resolve(file,'..'),{recursive:true});await writeFile(file,bytes,{flag:'wx'});return {path:file,root};
  }
  async start(input,shop) {
    if(this.active)throw Error('已有执行任务，请等待或暂停后继续');
    const {task}=this.preview(input.batchId,input.order);
    if(task.shopId!==shop.id)throw Error('店铺不匹配');
    if(input.mode==='LIVE')await this.checkLiveContent(task);
    if(this.active)throw Error('已有执行任务，请等待结束后重新核对');
    const run=this.store.create(input.batchId,task,input.mode||'DRY_RUN',input.target||'SOURCE',input.review);
    this.launch(run.id,shop);return publicRun(run);
  }
  launch(id,shop) {this.active=id;this.stop=false;this.pending=this.execute(id,shop).catch(e=>{this.store.event(id,'UNEXPECTED_ERROR',{error:errorText(e)});}).finally(()=>{this.active=null;});}
  async resume(input,shop) {
    if(this.active)throw Error('已有执行任务');
    const r=this.store.run(input.id);if(r.task.shopId!==shop.id)throw Error('请切换到任务店铺');
    if(r.state==='RESULT_UNKNOWN') {this.launch(r.id,shop);return publicRun(r);}
    if(this.store.completed(r.task))throw Error('该目的地已有成功核验记录，禁止恢复填写或重复发布');
    if(!['PAUSED','PAUSED_CAPTCHA','DRY_RUN_COMPLETE'].includes(r.state))throw Error('当前任务不能恢复');
    if(r.mode==='LIVE'||r.state==='DRY_RUN_COMPLETE'&&input.publish===true)await this.checkLiveContent(r.task);
    if(this.active||digest(this.store.run(r.id))!==digest(r))throw Error('原执行状态已变化，请重新核对后恢复');
    if(r.state==='DRY_RUN_COMPLETE') {
      if(input.publish!==true || r.mode!=='DRY_RUN')throw Error('草稿已填好；确认正式执行后才提交');
      this.store.db.prepare("UPDATE runs SET mode='LIVE' WHERE id=?").run(r.id);
      this.store.event(r.id,'LIVE_AUTHORIZED',{at:new Date().toISOString(),source:'workbench-selected-task'});
    }
    this.store.move(r.id,'QUEUED','操作者请求恢复；重新校验页面');this.launch(r.id,shop);return publicRun(this.store.run(r.id));
  }
  pause() {this.stop=true;return {pauseRequested:true};}
  async shutdown() {this.stop=true;if(this.pending)await this.pending;}
  async execute(id,shop) {
    let r=this.store.run(id),page,pageLedger,createdThisExecution=false,submitClicked=false,submissionFormUrl,materialBinding=null,bindingResolved=false;
    // P4/DRY_RUN retains per-field screenshots required by RELEASE_GATES.
    const timing=new ExecutionTiming(),attemptId=randomUUID(),startedAt=new Date().toISOString(),mode=r.mode==='DRY_RUN'?'full':this.evidenceMode;
    let steps;
    const measure=(category,fn)=>steps?steps.measure(category,fn):timing.measure(category,fn);
    const dir=join(this.artifacts,id)+sep;await mkdir(dir,{recursive:true});
    const checkpoint=patch=>this.store.checkpoint(id,patch);
    // Once a click is recorded (or recovery is verification-only), drain the
    // existing result before honoring the operator pause at the task boundary.
    // SUBMITTING alone is only intent: it must never authorize a paused click.
    const checkPause=()=>{
      if(!submitClicked&&r.state!=='RESULT_UNKNOWN')pageLedger?.assertHealthy();
      if(this.stop&&!submitClicked&&r.state!=='RESULT_UNKNOWN')throw Error('操作者暂停');
    };
    const guard=async(p=page)=>measure('guard',async()=>{
      checkPause();
      if(bindingResolved&&readMaterialBinding(this.store.db,r.task)?.sha256!==materialBinding?.sha256)throw Error('SOURCE_OR_ASSET_CHANGED: 原任务执行期间的素材绑定版本发生变化');
      const s=await measure('browser-status',()=>this.owner.status(shop));
      if(!s.running)throw Error('专用浏览器未运行，请启动并登录');
      if(s.loginState==='PAUSED_CAPTCHA')throw Error('PAUSED_CAPTCHA');
      if(!s.loggedIn)throw Error(s.reason||'请人工登录目标店铺');
      if(p && await measure('challenge-check',()=>visibleChallenge(p)))throw Error('PAUSED_CAPTCHA');
      if(p&&(p===page&&submitClicked||newForm(p)))await measure('form-identity',()=>assertPublishIdentity(p,r.task,{submitted:p===page&&submitClicked,formUrl:submissionFormUrl,requireTitle:this.store.run(id).state==='SUBMITTING',shopName:shop.name}));
      // Pause may arrive while the identity/challenge reads above are pending.
      checkPause();
    });
    steps=new ExecutionSteps({store:this.store,id,dir,guard,getPage:()=>page,checkpoint,errorText,timing,mode,attemptId,recovery:!!r.checkpoint.formUrl});
    const step=(name,fn)=>steps.run(name,fn);
    try {
      if(r.state!=='RESULT_UNKNOWN'&&this.store.completed(r.task))throw Error('该目的地已有成功核验记录，禁止恢复填写或重复发布');
      if(r.state!=='RESULT_UNKNOWN'){
        materialBinding=readMaterialBinding(this.store.db,r.task);bindingResolved=true;
        if(r.checkpoint.materialBinding&&r.checkpoint.materialBinding.sha256!==materialBinding?.sha256)throw Error('SOURCE_OR_ASSET_CHANGED: 原断点的素材绑定版本已变化');
        if(materialBinding&&!r.checkpoint.materialBinding){checkpoint({materialBinding});this.store.event(id,'MATERIAL_VERSION_APPLIED',{roundId:materialBinding.roundId,importId:materialBinding.importId,sha256:materialBinding.sha256,changes:materialBinding.changes});}
      }
      if(r.state!=='RESULT_UNKNOWN')this.store.move(id,'RUNNING');
      await guard();if(r.state!=='RESULT_UNKNOWN')await measure('file-validation',()=>assertTaskFiles(r.task,{materialBinding}));
      if(r.mode==='LIVE'&&r.state!=='RESULT_UNKNOWN')await measure('content-review',()=>this.checkLiveContent(r.task));
      const context=this.owner.sessions.get(shop.id)?.context;if(!context)throw Error('专用浏览器归属未验证');
      pageLedger=setPageScope(context,{db:this.store.db,shopId:shop.id,runId:r.id,taskKey:r.key,taskHash:digest(r.task),roundId:null,executionWindowId:null,...this.pageScopeForRun?.(r)});
      if(r.state!=='RESULT_UNKNOWN')pageLedger.assertHealthy();
      if(r.state!=='RESULT_UNKNOWN'&&!r.checkpoint.formUrl)pageLedger.assertCanStartTask();
      const target=r.target==='WAREHOUSE'||r.task.business.listing_time==='放入仓库'?'WAREHOUSE':'SOURCE';
      const confirmMissingReceipt=async()=>{
        this.store.event(id,'SUBMISSION_BACKEND_LOOKUP_STARTED',{message:'已点击提交、回执未读到、正在后台确认',maxQueries:3,timeoutMs:30000});
        const result=await measure('result-verification',()=>readSubmittedListing({context,task:r.task,target,dir:join(dir,'receipt-recovery',randomUUID()),guard,
          window:submissionLookupWindow(this.store.events(id)),assertUnused:itemId=>assertUnclaimedSubmissionId(this.store,this.store.run(id),itemId)}));
        checkpoint({itemId:result.itemId,submissionRecovery:result.submissionRecovery});
        this.store.event(id,'SUBMISSION_BACKEND_LOOKUP_CONFIRMED',{itemId:result.itemId,submissionRecovery:result.submissionRecovery});return result;
      };
      if(r.state==='RESULT_UNKNOWN') {
        let itemId=r.checkpoint.itemId;
        if(!itemId) {const success=context.pages().find(p=>p.url()===r.checkpoint.successUrl);if(success)itemId=(await success.locator('body').innerText()).match(/商品ID[：:]\s*(\d+)/)?.[1];}
        if(!itemId){const result=await confirmMissingReceipt();await this.beforeVerified?.(this.store.run(id),result);this.store.move(id,'VERIFIED','',result);return;}
        const result=await measure('result-verification',()=>verifyResult(context,r.task,itemId,target,dir,guard));await this.beforeVerified?.(this.store.run(id),result);this.store.move(id,'VERIFIED','',result);return;
      }
      if(r.checkpoint.residualPageRefill&&(r.checkpoint.residualPageRefill.count!==1||r.checkpoint.residualPageRefill.status!=='BOUND'))throw Error('RESIDUAL_REFILL_INCOMPLETE：原残页重填已预留但新页绑定未完成，保留现场待核验');
      if(r.checkpoint.navigationPageRecovery&&(r.checkpoint.navigationPageRecovery.count!==1||r.checkpoint.navigationPageRecovery.status!=='BOUND'))throw Error('PRE_SUBMIT_RECOVERY_INCOMPLETE：原新页恢复已预留但未完成，保留现场');
      try{await step('open-new-form',async()=>{page=await openTaskPage(context,r.task,r.checkpoint,guard,checkpoint,(p,ownership={})=>{page=p;createdThisExecution=ownership.createdThisExecution===true;});});}
      catch(error){
        page=await recoverPreSubmitNavigation({error,store:this.store,id,task:r.task,taskHash:digest(r.task),hash:digest,page,getPage:()=>page,createdThisExecution,
          context,ledger:pageLedger,guard,readProtection:readPageProtection,checkpoint,attemptId,
          open:async onPage=>{await step('open-clean-navigation-form',async()=>{page=await openTaskPage(context,r.task,{},guard,checkpoint,async(p,ownership={})=>{
            page=p;createdThisExecution=ownership.createdThisExecution===true;await onPage(p,ownership);
          });});return page;}});
      }
      checkpoint({formUrl:page.url(),mappingVersion:MAPPING_VERSION});
      const formGuard=async()=>{await guard();if(!newForm(page))throw Error('只允许新增商品页，禁止编辑旧链接');if(await page.locator('#sell-field-title input').inputValue()!==r.task.listing.title)throw Error('当前发布页与原任务标题不一致，已停止填写');};
      const executionProfile=await measure('profile-read',()=>readExecutionProfile(this.runtime,r.task));
      if(executionProfile){checkpoint({executionProfile});this.store.event(id,'SHOP_EXECUTION_PROFILE_APPLIED',{sha256:executionProfile.sha256,shopId:shop.id,freightTemplate:executionProfile.freightTemplate,confirmedAt:executionProfile.confirmedAt});}
      // A missing receipt or allowlisted readiness timeout may recover once
      // inside this execute/claim. Keep the old page and receipt files intact;
      // never recurse through execute(), claim another attempt, or clear intent.
      let fillDir=r.checkpoint.residualPageRefill?join(dir,'residual-refill-1')+sep:dir;
      const fill=()=>fillTask({page,task:r.task,dir:fillDir,target,step,guard:formGuard,executionProfile,materialBinding});
      let review;
      try{review=await fill();}
      catch(error){
        if(error?.message!=='EXISTING_DETAIL_RECEIPT_MISSING'&&!recoverableMaterialReadiness(error))throw error;
        const oldPage=page,oldUrl=page.url(),taskHash=digest(r.task);
        const assertRefillSafe=()=>{
          const current=this.store.run(id),events=this.store.events(id);
          if(submitClicked||current.result||current.checkpoint.itemId||current.checkpoint.successUrl||current.checkpoint.reconciliation||this.store.completed(r.task)||
            events.some(e=>['SUBMITTING','SUBMIT_CLICKED','SUBMIT_EVIDENCE','RESULT_UNKNOWN','VERIFIED'].includes(e.kind)||e.kind==='STEP_INTENT'&&e.payload?.name==='submit-once'))throw Error('RESIDUAL_REFILL_SUBMISSION_EVIDENCE：原任务已有提交或结果证据，保留现场待核验');
          if(current.state!=='RUNNING'||digest(current.task)!==taskHash)throw Error('RESIDUAL_REFILL_TASK_CHANGED：原任务状态或快照已变化');
          if(page!==oldPage||oldPage.isClosed()||oldPage.url()!==oldUrl||!newForm(oldPage))throw Error('RESIDUAL_REFILL_PAGE_CHANGED：原页面已变化，保留现场待核验');
          if(current.checkpoint.residualPageRefill||current.checkpoint.navigationPageRecovery)throw error;
          if(recoverableMaterialReadiness(error)){
            const owned=pageLedger.describe(oldPage);
            if(!createdThisExecution||!owned?.owned||owned.state!=='created'||owned.purpose!=='publish-form'||owned.scope?.runId!==id||owned.scope?.taskHash!==taskHash)throw Error('RESIDUAL_REFILL_OWNERSHIP_UNVERIFIED：素材恢复不接管保留页或未知归属页');
          }
          pageLedger.assertHealthy();
        };
        const targetIdentity=async p=>{
          let session;
          try{session=await context.newCDPSession(p);const info=(await session.send('Target.getTargetInfo'))?.targetInfo;
            if(info?.type!=='page'||!(/^[\w-]{1,256}$/).test(info.targetId||'')||!(/^[\w-]{1,256}$/).test(info.browserContextId||''))throw Error('残页重填缺少精确页面归属');
            return {targetId:info.targetId,browserContextId:info.browserContextId};
          }catch(cause){throw Error('RESIDUAL_REFILL_IDENTITY_UNAVAILABLE：残页重填缺少精确页面归属，保留现场',{cause});}
          finally{try{await session?.detach();}catch(cause){throw Error('RESIDUAL_REFILL_IDENTITY_UNAVAILABLE：页面归属观察未正常结束，保留现场',{cause});}}
        };
        assertRefillSafe();await formGuard();assertRefillSafe();
        const oldIdentity=await targetIdentity(oldPage),firstProtection=await readPageProtection(oldPage);
        if(firstProtection.status!=='unpinned'||firstProtection.pageTargetId!==oldIdentity.targetId)throw Error('RESIDUAL_REFILL_PAGE_PROTECTED：原页被固定或保护状态未确认，保留现场');
        const evidence=await measure('evidence',()=>captureTaskScreenshot(oldPage,dir,recoverableMaterialReadiness(error)?'pre-submit-material-readiness':'residual-detail-receipt-missing'));
        await formGuard();assertRefillSafe();
        const lastProtection=await readPageProtection(oldPage),lastIdentity=await targetIdentity(oldPage);
        if(lastProtection.status!=='unpinned'||lastProtection.pageTargetId!==firstProtection.pageTargetId||lastProtection.tabTargetId!==firstProtection.tabTargetId||digest(lastIdentity)!==digest(oldIdentity))throw Error('RESIDUAL_REFILL_PROTECTION_CHANGED：原页保护或归属已变化，保留现场');
        assertRefillSafe();
        const reserved={count:1,status:'RESERVED',attemptId,at:new Date().toISOString(),reason:recoverableMaterialReadiness(error)?error.code:'EXISTING_DETAIL_RECEIPT_MISSING',oldTargetId:oldIdentity.targetId,oldFormUrl:oldUrl,newTargetId:null,attemptsPreserved:true,...evidence};
        this.store.transaction(()=>{assertRefillSafe();checkpoint({formUrl:null,refillPageTargetId:null,residualPageRefill:reserved});this.store.event(id,'RESIDUAL_PAGE_REFILL',reserved);});
        pageLedger.retain(oldPage,{reason:recoverableMaterialReadiness(error)?'PRE_SUBMIT_MATERIAL_READINESS':'RESIDUAL_DETAIL_RECEIPT_MISSING'});
        fillDir=join(dir,'residual-refill-1')+sep;await mkdir(fillDir,{recursive:true});
        try{await step('open-clean-refill-form',async()=>{
          page=await openTaskPage(context,r.task,{},guard,checkpoint,async(p,ownership={})=>{
            page=p;createdThisExecution=ownership.createdThisExecution===true;
            if(!createdThisExecution||p===oldPage)throw Error('RESIDUAL_REFILL_PAGE_NOT_NEW：残页重填必须使用新建发布页');
            const identity=await targetIdentity(p),owned=pageLedger.describe(p);
            if(identity.targetId===oldIdentity.targetId||identity.browserContextId!==oldIdentity.browserContextId||!owned?.owned||owned.purpose!=='publish-form'||owned.scope?.runId!==id||owned.scope?.taskHash!==taskHash||owned.targetId!==identity.targetId)throw Error('RESIDUAL_REFILL_OWNERSHIP_UNVERIFIED：残页重填新页面归属未通过核验');
            const bound={...reserved,status:'BOUND',newTargetId:identity.targetId,boundAt:new Date().toISOString()};
            this.store.transaction(()=>{checkpoint({formUrl:p.url(),refillPageTargetId:identity.targetId,residualPageRefill:bound});this.store.event(id,'RESIDUAL_PAGE_REFILL',bound);});
          });
        });}catch(cause){throw Error('RESIDUAL_REFILL_OPEN_INCOMPLETE：新页重填准备未完成；'+errorText(cause),{cause});}
        await formGuard();
        let emptyForm;
        try{emptyForm=await page.locator('#sell-field-mainImagesGroup img').count()===0&&await page.locator('#sell-field-descRepublicOfSell img.image-item').count()===0;}
        catch(cause){throw Error('RESIDUAL_REFILL_FORM_UNVERIFIED：新页面空白状态无法确认，保留现场',{cause});}
        if(!emptyForm)throw Error('RESIDUAL_REFILL_FORM_NOT_EMPTY：残页重填新页面不是空白商品表单');
        await formGuard();
        // Deliberately outside the catch above: a second missing receipt, or any
        // source/order/count mismatch, follows the original failure path.
        review=await fill();
      }
      await guard();await measure('form-review',()=>verifyForm(page,r.task,target,review,executionProfile,materialBinding));
      if(r.mode==='DRY_RUN') {this.store.move(id,'DRY_RUN_COMPLETE','填写已核验，尚未提交');return;}
      // Persist intent before the only final submit. Recovery never clicks it twice.
      if(this.store.completed(r.task))throw Error('该目的地已有成功核验记录，禁止重复发布');
      await measure('content-review',()=>this.checkLiveContent(r.task));await guard();
      submissionFormUrl=page.url();this.store.move(id,'SUBMITTING');
      let itemId,recoveredResult;
      await step('submit-once',async()=>{itemId=await submitTask(page,guard,async()=>{this.store.event(id,'SUBMIT_CLICKED',{at:new Date().toISOString()});submitClicked=true;},{readBackend:async()=>{recoveredResult=await confirmMissingReceipt();return recoveredResult.itemId;}});checkpoint({itemId,successUrl:page.url()});});
      const submittedEvidence=await measure('evidence',()=>captureTaskScreenshot(page,dir,'submit-success'));
      this.store.event(id,'SUBMIT_EVIDENCE',submittedEvidence);
      let result=recoveredResult;
      await step('verify-platform-result',async()=>{if(!result)result=await measure('result-verification',()=>verifyResult(context,r.task,itemId,target,dir,guard));});
      await this.beforeVerified?.(this.store.run(id),result);this.store.move(id,'VERIFIED','',result);await writeFile(dir+'result.json',JSON.stringify(result,null,2));
      try{
        const cleanup=await closeVerifiedOwnedPage(page,{createdThisExecution,verifiedPersisted:this.store.run(id).state==='VERIFIED'&&!!this.store.completed(r.task),itemId,successUrl:this.store.run(id).checkpoint.successUrl},guard);
        this.store.event(id,'VERIFIED_PAGE_CLEANUP',cleanup);
      }catch(error){this.store.event(id,'VERIFIED_PAGE_CLEANUP_FAILED',{error:errorText(error)});}
    } catch(e) {
      const current=this.store.run(id);if(current.state==='VERIFIED'){
        if(pageLedger&&page&&!page.isClosed()&&pageLedger.describe(page)?.owned){
          try{pageLedger.retain(page,{reason:'ARTIFACT_WRITE_FAILED'});}
          catch{this.store.event(id,'PAGE_LEDGER_PERSISTENCE_FAILED',{nextTaskBlocked:true});}
        }
        this.store.event(id,'ARTIFACT_WRITE_ERROR',{error:errorText(e)});return;
      }
      const reason=page && await visibleChallenge(page).catch(()=>false)?'PAUSED_CAPTCHA':errorText(e);
      const state=['SUBMITTING','RESULT_UNKNOWN'].includes(current.state)?'RESULT_UNKNOWN':reason==='PAUSED_CAPTCHA'?'PAUSED_CAPTCHA':'PAUSED';
      if(pageLedger&&page&&pageLedger.describe(page)?.owned){
        try{pageLedger.retain(page,{reason:state==='RESULT_UNKNOWN'?'RESULT_UNKNOWN':state==='PAUSED_CAPTCHA'?'HUMAN_VERIFICATION':'TASK_INTERRUPTED'});}
        catch{this.store.event(id,'PAGE_LEDGER_PERSISTENCE_FAILED',{nextTaskBlocked:true});}
      }
      const evidence=await measure('evidence',()=>captureTaskScreenshot(page,dir,'paused'));
      const refillExhausted=recoverableMaterialReadiness(e)&&!!(current.checkpoint.residualPageRefill||current.checkpoint.navigationPageRecovery);
      const errorCode=refillExhausted?'PRE_SUBMIT_REFILL_EXHAUSTED':/^(?:SAFE_RETRY|PRODUCT|TASK_DATA|ATTRIBUTE_VALUE_INVALID|MATERIAL|ATTRIBUTE|FORM|CONTENT)(?:_[A-Z0-9]+)*$/.test(e.code||'')?e.code:null;
      checkpoint({pausedAt:new Date().toISOString(),reason,errorCode,recoveryCauseCode:refillExhausted?e.code:null,...evidence});
      this.store.move(id,state,reason);await writeFile(dir+'checkpoint.json',JSON.stringify(this.store.run(id).checkpoint,null,2));
    } finally {
      const final=this.store.run(id);
      const executionTiming={schemaVersion:1,attemptId,startedAt,finishedAt:new Date().toISOString(),evidencePolicy:EVIDENCE_POLICY_VERSION,evidenceMode:mode,...timing.snapshot()};
      let timingWriteError;
      try{await writeFile(join(dir,`execution-timing-${attemptId}.json`),JSON.stringify(executionTiming,null,2),{flag:'wx'});}
      catch(e){timingWriteError=errorText(e);}
      await writeFile(dir+'checkpoint.json',JSON.stringify({runId:id,state:final.state,reason:final.reason,checkpoint:final.checkpoint,result:final.result,executionTiming,...(timingWriteError?{timingWriteError}:{})},null,2));
    }
  }
  async checkLiveContent(task){
    if(typeof this.assertContentForLive!=='function')throw Object.assign(Error('CONTENT_REVIEW_REQUIRED: 缺少主图内容审核，禁止正式提交'),{code:'CONTENT_REVIEW_REQUIRED'});
    return this.assertContentForLive(task);
  }
}
