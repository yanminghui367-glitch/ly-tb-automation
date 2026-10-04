import {readFile,writeFile,mkdir,rename,stat} from 'node:fs/promises';
import {join,relative,isAbsolute,sep,basename} from 'node:path';
import {batchDefaults} from './batch-workflow.mjs';
import {destinationKey} from './source-store.mjs';
import {verifyKernel} from './kernel-integrity.mjs';
import {redact,classify,browserView,pauseView} from './product-state.mjs';
import {assertTaskFiles} from './taobao-publisher.mjs';
import {destinationCatalog,searchDestinations} from './destination-catalog.mjs';
import {globeCatalog} from './globe-catalog.mjs';
import {retryPlan} from './task-view-model.mjs';
import {PublishingRules} from './publishing-rules.mjs';
import {captureAttributes,ATTRIBUTE_FIELDS} from './publishing-attributes.mjs';
import {visibleChallenge} from './browser-environment.mjs';
import {newForm} from './taobao-publisher.mjs';

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
  constructor({batch,source,owner,shop,launch,runtime,integrity=verifyKernel,checkFiles=assertTaskFiles}) {
    Object.assign(this,{batch,source,owner,shop,launch,runtime,integrity,checkFiles});
    this.settingsFile=join(runtime,'product-v1','settings.json');this.frozen=integrity();this.catalog=new Map();this.catalogCount=-1;this.streams=new Set();this.startedAt=new Date().toISOString();this.checkResult=null;
    source.store.db.exec('CREATE TABLE IF NOT EXISTS product_actions(id TEXT PRIMARY KEY, action TEXT NOT NULL, target TEXT NOT NULL, at TEXT NOT NULL, result TEXT NOT NULL)');
    this.rules=new PublishingRules(source.store);this.capturing=false;
  }
  assertRulesIdle(){if(this.batch.active||this.source.active||this.capturing)throw err('任务执行或属性读取中，请等待结束');}
  async preparePreview(id,limit=20){this.assertRulesIdle();return this.rules.prepare(this.preview(id,limit),this.shop.id);}
  async createBatch(input){
    this.assertRulesIdle();
    if(input.draftId)return this.rules.create(input,this.shop.id,this.batch,()=>this.preview(input.importId,input.limit||20));
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
    return {executionEnabled:false,limit:20,...batchDefaults,...saved};
  }
  async saveSettings(input) {
    const allowed=['executionEnabled','limit','heat','pool','assets','sheet','confirmShop'];
    if(Object.keys(input).some(k=>!allowed.includes(k)))throw err('无效设置字段',400);
    const old=await this.settings(),next={...old};
    for(const key of ['heat','pool','assets','sheet'])if(key in input){if(typeof input[key]!=='string'||!input[key].trim()||input[key].length>2000)throw err('资料路径或工作表无效',400);next[key]=input[key].trim();}
    if('limit' in input){if(!Number.isInteger(input.limit)||input.limit<1||input.limit>20)throw err('每批数量为 1—20',400);next.limit=input.limit;}
    if('executionEnabled' in input){
      if(typeof input.executionEnabled!=='boolean')throw err('执行开关无效',400);
      if(input.executionEnabled&&!old.executionEnabled&&input.confirmShop!==this.shop.name)throw err('开启执行前请确认目标店铺');
      if(input.executionEnabled){const check=await this.integrity();if(!check.ok)throw err('上架内核发生变化，执行已阻止');}
      if(!input.executionEnabled){if(this.batch.active)this.batch.pause();else if(this.source.active)this.source.pause();}
      next.executionEnabled=input.executionEnabled;
    }
    await mkdir(join(this.runtime,'product-v1'),{recursive:true});
    await writeFile(this.settingsFile+'.tmp',JSON.stringify(next,null,2));await rename(this.settingsFile+'.tmp',this.settingsFile);
    this.checkResult=null;return next;
  }
  async assertExecution() {
    if(this.capturing)throw err('正在读取属性，请等待完成后再启动或恢复任务');
    if(!this.batch.active&&!this.source.active&&this.source.store.list().some(r=>['RUNNING','SUBMITTING'].includes(r.state)))throw err('任务状态待检查：请重启程序恢复持久状态，不能开始新执行');
    if(!(await this.settings()).executionEnabled)throw err('当前暂停新任务执行。需要开始时，请在系统设置中明确开启。');
    if(!(await this.integrity()).ok)throw err('上架内核发生变化，执行已阻止');
    if(this.capturing)throw err('正在读取属性，请等待完成后再启动或恢复任务');
  }
  validationIssues(){
    const imported=this.source.store.batch();if(!imported||imported.sheet!=='境外城市热度')return [];
    return this.batch.preview(imported.id,20).excluded.filter(x=>!/已有成功|重复国家城市|已有队列|已有单条/.test(x.reason));
  }
  preview(id,limit=20){
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
    if(input.operation==='retry'){
      const actual={...view,items:view.items.map(x=>({...x,runState:x.runId?this.source.store.run(x.runId).state:x.state}))};
      const plan=retryPlan(actual,this.batch.active||this.source.active);
      checks.push({name:'异常重试范围',ok:plan.allowed,detail:plan.reason||`本批 ${plan.eligible.length} 条失败商品，成功项不重复执行`});
    }
    const runs=single?[this.source.store.run(input.id)]:view.items.filter(x=>x.runId&&(input.operation==='retry'?x.state==='FAILED'&&x.attempts<x.maxAttempts:['WAITING_HUMAN','RETRY'].includes(x.state)||!input.operation&&x.state==='FAILED')).map(x=>this.source.store.run(x.runId));
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
  records(runs) {
    const rows=this.source.store.db.prepare('SELECT key,payload FROM history').all(),known=new Map(runs.map(r=>[r.key,r]));
    const count=this.source.store.db.prepare('SELECT COUNT(*) n FROM imports').get().n;
    if(count!==this.catalogCount){this.catalog.clear();for(const row of this.source.store.db.prepare('SELECT payload FROM imports ORDER BY rowid').all()){for(const t of JSON.parse(row.payload).tasks)this.catalog.set(destinationKey(t),t);}this.catalogCount=count;}
    const complete=rows.map(row=>{
      const result=JSON.parse(row.payload),run=known.get(row.key),task=run?.task||this.catalog.get(row.key);
      const batchId=run?this.source.store.db.prepare('SELECT batch FROM batch_items WHERE run_id=?').get(run.id)?.batch:null;
      const verified=run?this.source.store.db.prepare("SELECT at FROM events WHERE run=? AND kind='VERIFIED' ORDER BY seq DESC LIMIT 1").get(run.id)?.at:null;
      return {verified:true,key:row.key,runId:run?.id||null,batchId:batchId||null,importId:run?.batch||null,source:run?.task.source||null,
        destination:task?.listing.city||task?.listing.country||'历史商品',title:run?.task.listing.title||'历史成功记录（原标题未留存）',itemId:result.itemId,status:result.status,
        at:result.verifiedAt||verified||result.at||'',timeBasis:result.verifiedAt||verified?'平台核验事件':result.at?'历史记录时间':'未记录',
        url:/^https:\/\/item\.taobao\.com\/item\.htm\?id=\d+$/.test(result.url||'')?result.url:null,screenshot:this.screenshot(result.screenshot),duplicateBlocked:true};
    });
    const unknown=runs.filter(r=>r.state==='RESULT_UNKNOWN').map(r=>({verified:false,key:r.key,runId:r.id,batchId:this.source.store.db.prepare('SELECT batch FROM batch_items WHERE run_id=?').get(r.id)?.batch||null,importId:r.batch,source:r.task.source,destination:r.task.listing.city||r.task.listing.country,title:r.task.listing.title,itemId:r.checkpoint.itemId||null,status:'待核验',at:r.checkpoint.pausedAt||'',timeBasis:'待核验状态记录',url:null,screenshot:this.screenshot(r.checkpoint.screenshot),duplicateBlocked:true}));
    return [...complete,...unknown].sort((a,b)=>b.at.localeCompare(a.at));
  }

  event(e) {
    const names={CREATED:'创建任务',RUNNING:'开始执行',QUEUED:'等待执行',VERIFIED:'后台核验成功',PAUSED:'任务暂停',PAUSED_CAPTCHA:'等待人工验证',SUBMITTING:'准备提交',RESULT_UNKNOWN:'结果待核验',DRY_RUN_COMPLETE:'填写完成，未提交',STEP_INTENT:'开始步骤',STEP_VERIFIED:'步骤通过',STEP_PAUSED:'步骤暂停'};
    return {seq:e.seq,at:e.at,label:e.payload.name?stepName(e.payload.name):names[e.kind]||'任务记录',kind:e.kind,raw:redact(e.payload.error||e.payload.reason||''),technical:{kind:e.kind,step:e.payload.name||null},reason:reasonText(e.payload.error||e.payload.reason||''),durationMs:e.payload.durationMs,screenshot:this.screenshot(e.payload.screenshot||e.payload.result?.screenshot)};
  }
  async snapshot(id) {
    const flow=this.batch,store=this.source.store,runs=store.list(),records=this.records(runs);
    const selected=flow.store.view(id),batches=store.db.prepare('SELECT id,state,mode,at,finished FROM batches ORDER BY rowid DESC').all();
    if(id&&!selected)throw err('批次不存在',404);
    const batch=selected?{...selected,reason:redact(selected.reason),confirmation:{at:selected.at,mode:selected.mode,count:selected.total,scope:'本批全部商品，按冻结顺序串行执行',reviewed:flow.store.batch(selected.id).review.reviewed===true},items:selected.items.map(x=>({...x,checkpoint:undefined,runState:x.runId?store.run(x.runId).state:null,step:stepName(x.checkpoint?.step),screenshot:this.screenshot(x.checkpoint?.screenshot),reason:reasonText(x.reason),issue:classify(x.reason,x.state),completeness:'已通过生成时校验',displayState:x.runId&&store.run(x.runId).state==='RESULT_UNKNOWN'?'RESULT_UNKNOWN':x.state}))}:null;
    const ownership=this.owner.sessions.get(this.shop.id);
    const browser=browserView(ownership?.last||await this.owner.status(this.shop),Date.now(),!ownership?.last);
    const exceptions=[];
    for(const r of runs.filter(r=>['PAUSED','PAUSED_CAPTCHA','RESULT_UNKNOWN','DRY_RUN_COMPLETE'].includes(r.state))){
      const row=store.db.prepare('SELECT id,batch,state,attempts,max_attempts FROM batch_items WHERE run_id=?').get(r.id);
      if(row&&['SUCCEEDED','SKIPPED'].includes(row.state))continue;
      exceptions.push({...classify(r.reason,r.state),id:r.id,batchId:row?.batch||null,destination:r.task.listing.city||r.task.listing.country,state:r.state,reason:reasonText(r.reason|| (r.state==='DRY_RUN_COMPLETE'?'仅填写已完成，尚未提交':'')),captcha:r.state==='PAUSED_CAPTCHA',unknown:r.state==='RESULT_UNKNOWN',retryable:row?.state==='FAILED'&&row.attempts<row.max_attempts,exhausted:row?.state==='FAILED'&&row.attempts>=row.max_attempts,screenshot:this.screenshot(r.checkpoint.screenshot)});
    }
    const validation=this.validationIssues();
    exceptions.push(...validation.map(x=>({...x,id:'data-'+x.rank,state:'DATA_INVALID',dataOnly:true,category:'资料问题',next:'补齐资料后重新导入校验',condition:'原文件保持只读；核对新导入内容后重新预览',raw:x.reason})));
    const runId=batch?.items.find(x=>x.id===batch.current)?.runId||batch?.items.findLast(x=>x.runId)?.runId;
    const events=runId?store.events(runId).slice(-35).map(e=>this.event(e)):[];
    const settings=await this.settings(),frozen=await this.integrity();
    return {version:'1.0.0',at:new Date().toISOString(),shop:{id:this.shop.id,name:this.shop.name},service:{state:'RUNNING',startedAt:this.startedAt},browser,execution:pauseView(flow,this.source,runs),currentTask:runs.find(r=>r.id===this.source.active)?.task.listing||null,configuration:this.checkResult,publishingRules:{...this.rules.summary(this.shop.id),checkpoint:JSON.parse(store.db.prepare('SELECT payload FROM publishing_captures WHERE id=?').get('checkpoint-'+this.shop.id)?.payload||'null')},settings,kernel:frozen,active:flow.active||this.source.active,batch,batches,records,exceptions,events,overview:{published:records.filter(x=>x.verified).length,totalBatches:batches.length,waiting:exceptions.filter(x=>!x.retryable).length,failed:exceptions.filter(x=>x.retryable).length},latestImport:store.batch()?.id||null};
  }
  async handle(req,res,url,{body,json}) {
    const path=url.pathname;
    if(!path.startsWith('/api/v1/'))return false;
    const action=path.slice('/api/v1/'.length);
    if(req.method==='GET') {
      if(action==='globe'){json(res,200,globeCatalog(destinationCatalog(this.source.store,this.shop.id)));return true;}
      if(action==='destinations'){
        const catalog=destinationCatalog(this.source.store,this.shop.id),key=url.searchParams.get('key');
        if(key){const item=catalog.items.find(x=>x.key===key);if(!item)throw err('目的地不在当前导入资料中',404);json(res,200,{item});}
        else json(res,200,searchDestinations(catalog,url.searchParams.get('q')||'',url.searchParams.get('limit')||60,url.searchParams.get('filter')||''));
        return true;
      }
      if(action==='health'){json(res,200,{app:'ly-tb-workbench',version:'1.0.0',pid:process.pid,kernel:await this.frozen});return true;}
      if(action==='state'){json(res,200,await this.snapshot(url.searchParams.get('batch')));return true;}
      if(action==='preview'){json(res,200,this.preview(url.searchParams.get('import'),Number(url.searchParams.get('limit')||20)));return true;}
      if(action==='publishing-rules'){
        const preset=this.rules.preset(this.shop.id),checkpoint=this.source.store.db.prepare('SELECT payload FROM publishing_captures WHERE id=?').get('checkpoint-'+this.shop.id);
        const capture=preset.captureId?this.source.store.db.prepare('SELECT payload FROM publishing_captures WHERE id=?').get(preset.captureId):null;json(res,200,{shop:{id:this.shop.id,name:this.shop.name},preset,fields:capture?JSON.parse(capture.payload).fields:[],checkpoint:checkpoint?JSON.parse(checkpoint.payload):null});return true;
      }
      if(action==='publishing-materials'){json(res,200,{items:(await this.rules.materials((await this.settings()).assets,this.shop.id)).map(({path,...a})=>a)});return true;}
      if(action==='publishing-image'){const a=await this.rules.imageAsset(Object.fromEntries(url.searchParams),this.shop.id,(await this.settings()).assets);res.writeHead(200,{'content-type':a.type,'cache-control':'no-store','x-content-type-options':'nosniff'});res.end(a.bytes);return true;}
      if(action==='queue-task'){
        const item=this.batch.store.item(url.searchParams.get('id'));
        json(res,200,{id:item.id,state:item.state,task:item.task,batchId:item.batch,importId:this.batch.store.batch(item.batch).imported,checkpoint:{},reason:item.reason,events:[],issue:classify(item.reason,item.state),result:item.result});return true;
      }
      if(action==='task'){
        const r=this.source.store.run(url.searchParams.get('id'));
        json(res,200,{id:r.id,state:r.state,task:r.task,importId:r.batch,batchId:this.source.store.db.prepare('SELECT batch FROM batch_items WHERE run_id=?').get(r.id)?.batch||null,checkpoint:{step:stepName(r.checkpoint.step),pausedAt:r.checkpoint.pausedAt,itemId:r.checkpoint.itemId},issue:classify(r.reason,r.state),reason:reasonText(r.reason),events:this.source.store.events(r.id).map(e=>this.event(e)),screenshot:this.screenshot(r.checkpoint.screenshot),result:r.result?{...r.result,screenshot:this.screenshot(r.result.screenshot)}:null});return true;
      }
      if(action==='records.csv'){
        const rows=this.records(this.source.store.list()),quote=v=>'"'+String(v??'').replace(/^[=+@-]/,"'$&").replaceAll('"','""')+'"';
        const csv='\ufeff'+[['目的地','标题','商品ID','状态','核验时间','来源批次','执行任务'],...rows.map(x=>[x.destination,x.title,x.itemId,x.status,x.at,x.batchId,x.runId])].map(row=>row.map(quote).join(',')).join('\r\n');
        res.writeHead(200,{'content-type':'text/csv; charset=utf-8','content-disposition':'attachment; filename="listing-records.csv"','cache-control':'no-store'});res.end(csv);return true;
      }
      if(action==='events'){
        res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-store','connection':'keep-alive'});
        let closed=false,pending=false;
        const push=async()=>{if(closed||pending)return;pending=true;try{const state=await this.snapshot(url.searchParams.get('batch'));if(!closed)res.write('event: state\ndata: '+JSON.stringify(state)+'\n\n');}catch{if(!closed)res.write('event: problem\ndata: {"error":"状态读取失败，请刷新工作台"}\n\n');}finally{pending=false;}};
        this.streams.add(res);const timer=setInterval(push,2000);timer.unref();res.on('close',()=>{closed=true;clearInterval(timer);this.streams.delete(res);});await push();return true;
      }
    }
    if(req.method==='POST'){
      const input=await body(req);
      if(this.capturing&&action!=='pause')throw err('正在读取属性，请等待完成');
      const controlled=['start','continue','retry','resume-single'].includes(action);
      if(controlled&&input.requestId){const previous=this.source.store.db.prepare('SELECT * FROM product_actions WHERE id=?').get(input.requestId);if(previous){if(previous.action!==action||previous.target!==input.id)throw err('请求编号不能用于其他操作');json(res,200,{...JSON.parse(previous.result),replayed:true});return true;}}

      if(['start','continue','retry','resume-single'].includes(action)){
        await this.assertExecution();
        const browser=browserView(await this.owner.status(this.shop),Date.now(),true);
        if(!browser.loggedIn)throw err(redact(browser.reason)||'请先登录店铺');
        if(['start','continue','retry'].includes(action)){const b=this.batch.store.view(input.id);if(b?.items.some(x=>x.runId&&this.source.store.run(x.runId).state==='PAUSED_CAPTCHA')&&input.humanVerified!==true)throw err('请确认已人工完成验证');}
      }
      if(controlled){
        if(this.batch.active||this.source.active)throw err('已有任务运行，V1 串行执行');
        if(!/^[a-f0-9-]{36}$/i.test(input.requestId||''))throw err('缺少有效操作编号，请刷新后重试',400);
        if(action!=='resume-single'){
          const current=this.batch.store.view(input.id);if(!current)throw err('批次不存在',404);
          if(action==='start'&&current.state!=='READY')throw err('本批已开始或已结束；请从原任务继续，不能重复开始');
        }
        if(action!=='start'){
          const checked=await this.recovery({...input,operation:action},action==='resume-single');
          if(!checked.ready)throw err(checked.checks.filter(x=>x.ok!==true).map(x=>x.detail).join('；'));
        }
      }
      if(controlled)this.source.store.db.prepare('INSERT INTO product_actions VALUES(?,?,?,?,?)').run(input.requestId,action,input.id,new Date().toISOString(),JSON.stringify({accepted:true,id:input.id,awaitStatus:true}));
      let data;
      switch(action){
        case 'publishing-preview':data=await this.preparePreview(input.importId,input.limit||20);break;
        case 'publishing-capture':data=await this.capturePublishingFields();break;
        case 'publishing-save':this.assertRulesIdle();data=await this.rules.save(this.shop.id,input,(await this.settings()).assets);break;
        case 'settings':data=await this.saveSettings(input);break;
        case 'import':{const imported=await this.batch.import({...await this.settings(),...input});data=this.preview(imported.importId,20);break;}
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
        case 'browser':data=await this.launch(this.shop);await this.owner.focus(this.shop);break;
        default:throw err('未找到操作',404);
      }
      if(controlled)this.source.store.db.prepare('UPDATE product_actions SET result=? WHERE id=?').run(JSON.stringify({accepted:true,id:input.id}),input.requestId);
      json(res,200,data);return true;
    }
    json(res,404,{error:'未找到页面或操作'});return true;
  }
}
