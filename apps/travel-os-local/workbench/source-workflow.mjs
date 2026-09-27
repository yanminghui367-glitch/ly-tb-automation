import { readFile, writeFile, mkdir, stat, lstat } from 'node:fs/promises';
import { join, resolve, relative, extname, basename, sep } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import {expect} from 'playwright/test';
import { SourceStore, digest, destinationKey } from './source-store.mjs';
import { PROJECT_ROOT, visibleChallenge } from './browser-environment.mjs';
import { assertTaskFiles, fillTask, newForm, openTaskPage, verifyForm, submitTask, verifyResult, MAPPING_VERSION } from './taobao-publisher.mjs';

const exec = promisify(execFile);
const defaults = { workbook: 'D:/桌面文件迁移/五洲畅游店铺：境外旅游目的地链接池_700.xlsx', assetRoot: 'D:/桌面文件迁移/五洲畅游---图片' };
const safeExtensions = new Set(['.xlsx','.png','.jpg','.jpeg','.webp']);
const publicRun = r => ({id:r.id,order:r.task.priority,title:r.task.listing.title,state:r.state,mode:r.mode,target:r.target,reason:r.reason,result:r.result,checkpoint:r.checkpoint});
const errorText = e => /CAPTCHA|_____tmd_____|action=captcha/.test(e.message) ? 'PAUSED_CAPTCHA' : String(e.message||e).replace(/https?:\/\/[^\s]+/g,'[页面地址]').slice(0,800);

export class SourceWorkflow {
  constructor(owner, {runtime=join(PROJECT_ROOT,'workbench/.runtime/source-workflow'), artifacts=join(PROJECT_ROOT,'workbench/output/tasks'), store}={}) {
    this.owner=owner;this.runtime=runtime;this.artifacts=artifacts;
    this.store=store || new SourceStore(join(runtime,'state.sqlite'));
    this.store.recover();this.active=null;this.stop=false;
  }
  state() {
    const batch=this.store.batch(), runs=this.store.list();
    return {defaults,active:this.active, batch:batch ? {id:batch.id,at:batch.at,summary:batch.summary,sourceReadonly:batch.sourceReadonly,workbook:batch.workbook,assetRoot:batch.assetRoot,
      items:batch.tasks.map(t=>({order:t.priority,destination:t.listing.city||t.listing.country,title:t.listing.title,price:t.business.price_cny,inventory:t.business.inventory,issues:t.adapterIssues,completed:this.store.completed(t),run:runs.find(r=>r.key===destinationKey(t))?.id}))}:null,runs:runs.map(publicRun)};
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
    return {batchId:batch.id,task,taskHash:digest(task),assets:Object.entries(task.assets).flatMap(([group,files])=>files.map((a,index)=>({group,index,name:basename(a.path),url:`/api/source/asset?batch=${batch.id}&order=${order}&group=${group}&index=${index}`})))};
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
    if(shop.id!=='wuzhou-changyou')throw Error('当前商品包仅适用于五洲畅游');
    const {task}=this.preview(input.batchId,input.order);
    if(task.shopId!==shop.id)throw Error('店铺不匹配');
    const run=this.store.create(input.batchId,task,input.mode||'DRY_RUN',input.target||'SOURCE',input.review);
    this.launch(run.id,shop);return publicRun(run);
  }
  launch(id,shop) {this.active=id;this.stop=false;this.pending=this.execute(id,shop).catch(e=>{this.store.event(id,'UNEXPECTED_ERROR',{error:errorText(e)});}).finally(()=>{this.active=null;});}
  async resume(input,shop) {
    if(this.active)throw Error('已有执行任务');
    const r=this.store.run(input.id);if(r.task.shopId!==shop.id)throw Error('请切换到任务店铺');
    if(r.state==='RESULT_UNKNOWN') {this.launch(r.id,shop);return publicRun(r);}
    if(!['PAUSED','PAUSED_CAPTCHA','DRY_RUN_COMPLETE'].includes(r.state))throw Error('当前任务不能恢复');
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
    let r=this.store.run(id),page;
    const dir=join(this.artifacts,id)+sep;await mkdir(dir,{recursive:true});
    const checkpoint=patch=>this.store.checkpoint(id,patch);
    const guard=async(p=page)=>{
      if(this.stop)throw Error('操作者暂停');
      const s=await this.owner.status(shop);
      if(!s.running)throw Error('专用浏览器未运行，请启动并登录');
      if(s.loginState==='PAUSED_CAPTCHA')throw Error('PAUSED_CAPTCHA');
      if(!s.loggedIn)throw Error(s.reason||'请人工登录目标店铺');
      if(p && await visibleChallenge(p))throw Error('PAUSED_CAPTCHA');
      if(p && newForm(p)) {
        const identity=p.locator('div.UserArea_shopName__3xGhm');
        try {await expect(identity).toBeVisible({timeout:8000});await expect(identity).toHaveText(shop.name,{timeout:8000,useInnerText:true});}catch{throw Error('当前发布页店铺身份不匹配或未加载完成');}
      }
    };
    const step=async(name,fn)=>{
      const start=Date.now();this.store.event(id,'STEP_INTENT',{name});
      let error;
      try {await guard();await fn();await guard();}
      catch(e){error=errorText(e);throw e;}
      finally {
        const screenshot=join(dir,`${this.store.events(id).length}-${name}.png`);
        await page?.screenshot({path:screenshot,timeout:5000}).catch(()=>{});
        const data={name,durationMs:Date.now()-start,screenshot,error};this.store.event(id,error?'STEP_PAUSED':'STEP_VERIFIED',data);
        checkpoint({step:name,...data});await writeFile(join(dir,'checkpoint.json'),JSON.stringify(this.store.run(id).checkpoint,null,2));
      }
    };
    try {
      if(r.state!=='RESULT_UNKNOWN')this.store.move(id,'RUNNING');
      await guard();await assertTaskFiles(r.task);
      const context=this.owner.sessions.get(shop.id)?.context;if(!context)throw Error('专用浏览器归属未验证');
      const target=r.target==='WAREHOUSE'||r.task.business.listing_time==='放入仓库'?'WAREHOUSE':'SOURCE';
      if(r.state==='RESULT_UNKNOWN') {
        let itemId=r.checkpoint.itemId;
        if(!itemId) {const success=context.pages().find(p=>p.url()===r.checkpoint.successUrl);if(success)itemId=(await success.locator('body').innerText()).match(/商品ID[：:]\s*(\d+)/)?.[1];}
        if(!itemId)throw Error('提交结果未知且无商品 ID，需先在淘宝核对；不会重新提交');
        const result=await verifyResult(context,r.task,itemId,target,dir,guard);this.store.move(id,'VERIFIED','',result);return;
      }
      await step('open-new-form',async()=>{page=await openTaskPage(context,r.task,r.checkpoint,guard,checkpoint,p=>{page=p;});});
      checkpoint({formUrl:page.url(),mappingVersion:MAPPING_VERSION});
      const formGuard=async()=>{await guard();if(!newForm(page))throw Error('只允许新增商品页，禁止编辑旧链接');};
      const review=await fillTask({page,task:r.task,dir,target,step,guard:formGuard});
      await guard();await verifyForm(page,r.task,target,review);
      if(r.mode==='DRY_RUN') {this.store.move(id,'DRY_RUN_COMPLETE','填写已核验，尚未提交');return;}
      // Persist intent before the only final submit. Recovery never clicks it twice.
      this.store.move(id,'SUBMITTING');
      let itemId;
      await step('submit-once',async()=>{itemId=await submitTask(page,guard);checkpoint({itemId,successUrl:page.url()});});
      await page.screenshot({path:dir+'submit-success.png',fullPage:true});
      let result;
      await step('verify-platform-result',async()=>{result=await verifyResult(context,r.task,itemId,target,dir,guard);});
      this.store.move(id,'VERIFIED','',result);await writeFile(dir+'result.json',JSON.stringify(result,null,2));
    } catch(e) {
      const current=this.store.run(id);if(current.state==='VERIFIED'){this.store.event(id,'ARTIFACT_WRITE_ERROR',{error:errorText(e)});return;}
      const reason=page && await visibleChallenge(page).catch(()=>false)?'PAUSED_CAPTCHA':errorText(e);
      const state=['SUBMITTING','RESULT_UNKNOWN'].includes(current.state)?'RESULT_UNKNOWN':reason==='PAUSED_CAPTCHA'?'PAUSED_CAPTCHA':'PAUSED';
      const shot=dir+'paused.png';await page?.screenshot({path:shot,timeout:5000}).catch(()=>{});
      checkpoint({pausedAt:new Date().toISOString(),reason,screenshot:page?shot:null});
      this.store.move(id,state,reason);await writeFile(dir+'checkpoint.json',JSON.stringify(this.store.run(id).checkpoint,null,2));
    } finally {
      const final=this.store.run(id);
      await writeFile(dir+'checkpoint.json',JSON.stringify({runId:id,state:final.state,reason:final.reason,checkpoint:final.checkpoint,result:final.result},null,2));
    }
  }
}
