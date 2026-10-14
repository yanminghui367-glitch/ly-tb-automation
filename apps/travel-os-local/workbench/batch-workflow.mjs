import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
import {BatchStore} from './batch-store.mjs';
import {digest,destinationKey} from './source-store.mjs';
import {PROJECT_ROOT} from './browser-environment.mjs';
import {MAX_BATCH_SIZE,DEFAULT_BATCH_SIZE} from './batch-policy.mjs';
const exec=promisify(execFile);
export const batchDefaults={heat:'D:/桌面文件迁移/旅游上架自动化/LY_解压审查/LY/全球城市服务需求热度_中国客群筛选版.xlsx',sheet:'境外城市热度',pool:'D:/桌面文件迁移/五洲畅游店铺：境外旅游目的地链接池_700.xlsx',assets:'D:/桌面文件迁移/五洲畅游---图片'};
export class BatchWorkflow {
 constructor(flow){this.flow=flow;this.store=new BatchStore(flow.store);this.store.recover();this.active=null;this.stopping=false;}
 async import(input){if(this.active||this.flow.active)throw Error('执行期间不能重新识别');const paths={...batchDefaults,...input};await mkdir(this.flow.runtime,{recursive:true});const out=join(this.flow.runtime,`heat-${randomUUID()}.json`);
  await exec(process.env.PYTHON||'python',[join(PROJECT_ROOT,'engine/v2/heat_queue_adapter.py'),'--heat',resolve(paths.heat),'--sheet',paths.sheet,'--pool',resolve(paths.pool),'--assets',resolve(paths.assets),'--output',out],{windowsHide:true,timeout:120000,maxBuffer:1024*1024,env:{...process.env,PYTHONIOENCODING:'utf-8'}});
  const data=JSON.parse(await readFile(out,'utf8')),id=this.flow.store.imported(data);return this.preview(id,DEFAULT_BATCH_SIZE);
 }
 preview(imported,limit=DEFAULT_BATCH_SIZE){
  if(!Number.isInteger(limit)||limit<1||limit>MAX_BATCH_SIZE)throw Error(`本轮最多 ${MAX_BATCH_SIZE} 条`);
  const data=this.flow.store.batch(imported);if(!data||data.sheet!=='境外城市热度')throw Error('请先识别境外城市热度表');
  const seen=new Set(),selected=[],excluded=[];
  for(const task of data.tasks){const key=destinationKey(task),old=this.flow.store.db.prepare('SELECT id,state FROM runs WHERE key=?').get(key);let reason;
   if(seen.has(key))reason='重复国家城市';else if(this.flow.store.completed(task))reason='已有成功记录';else if(this.store.reserved(task))reason='已有队列任务';else if(old)reason='已有单条任务，需从原任务恢复';else if(task.adapterIssues.length)reason=task.adapterIssues.join('；');seen.add(key);
   if(reason)excluded.push({rank:task.priority,destination:task.listing.city,reason});else if(selected.length<limit)selected.push(task);
  }
  return {importId:data.id,source:{workbook:data.workbook,sheet:data.sheet,hash:data.sourceHash,pool:data.poolWorkbook,poolHash:data.poolHash},summary:data.summary,limit,selectionHash:digest(selected),tasks:selected,excluded};
 }
 create(input,shop){if(this.active||this.flow.active)throw Error('已有执行任务');const p=this.preview(input.importId,input.limit??DEFAULT_BATCH_SIZE);if(input.review?.selectionHash!==p.selectionHash)throw Error('待执行清单已改变，请重新查看');return this.store.create(p.importId,p.tasks,shop.id,input.mode||'DRY_RUN',input.review);}
 state(id){return {defaults:batchDefaults,active:this.active,batch:this.store.view(id)};}
 assertLegacyItems(items){
  // Historical ownership survives terminal rounds and service reconstruction.
  // No schema creation or fallback on malformed data: lookup failures fail closed.
  const db=this.flow.store.db;
  const schema=db.prepare("SELECT name,type FROM sqlite_master WHERE name IN ('rounds','round_items','round_events','round_windows','round_window_items')").all();
  if(!schema.length)return;
  if(!schema.some(x=>x.name==='round_items'&&x.type==='table'))throw Object.assign(Error('固定清单结构不完整，请检查数据；禁止通过旧批次修改任务'),{code:'FIXED_ROUND_SCHEMA_INVALID'});
  const find=db.prepare('SELECT round_id,key FROM round_items WHERE key=? OR queue_id=? OR (? IS NOT NULL AND run_id=?) LIMIT 1');
  for(const item of items){
   const owned=find.get(item.key,item.id,item.run_id??null,item.run_id??null);
   if(owned)throw Object.assign(Error('该商品属于固定清单，请使用固定清单的专用操作；旧批次入口不能修改'),{code:'FIXED_ROUND_OWNED',roundId:owned.round_id,taskKey:owned.key});
  }
 }
 start(id,shop){
  if(this.active||this.flow.active)throw Error('已有执行任务');const b=this.store.batch(id);if(!b||b.shop!==shop.id)throw Error('批次店铺不匹配');
  this.assertLegacyItems(this.store.items(id));
  const scope=this.store.retryScope(id);
  if(this.store.items(id).some(x=>x.state==='FAILED'&&(!scope||scope.includes(x.id))))throw Error('批次含未处理异常，请先重试异常链接或明确跳过；不能直接继续下一条');
  if(!this.store.items(id).some(x=>['PENDING','RETRY','WAITING_HUMAN'].includes(x.state)))throw Error('本批已结束，没有待执行任务');
  this.active=id;this.stopping=false;this.flow.queueLease=id;this.store.setBatch(id,'RUNNING');
  this.pending=this.pump(id,shop).catch(e=>{this.store.event(id,null,'SCHEDULER_ERROR',{reason:e.message});this.store.setBatch(id,'PAUSED',e.message);}).finally(async()=>{this.active=null;this.flow.queueLease=null;await this.report(id).catch(()=>{});});return this.state(id);
 }
 pause(){if(this.round?.active)return this.round.pause();if(!this.active)throw Error('当前没有运行批次');this.stopping=true;this.flow.pause();this.store.event(this.active,null,'PAUSE_REQUESTED');return {pauseRequested:true};}
 async shutdown(){if(this.round?.active){await this.round.shutdown();return;}if(this.active){this.stopping=true;this.flow.pause();await this.pending;}}
 async pump(id,shop){
  const b=this.store.batch(id);
  const scope=this.store.retryScope(id),inScope=x=>!scope||scope.includes(x.id);
  try{
   if(this.flow.preflight)await this.flow.preflight(this.store.items(id).filter(x=>inScope(x)&&['PENDING','RETRY','WAITING_HUMAN'].includes(x.state)).map(x=>x.task),()=>{if(this.stopping)throw Error('操作者暂停');});
  }catch(e){this.store.event(id,null,'BATCH_PREFLIGHT_FAILED',{reason:e.message});this.store.setBatch(id,'PAUSED','执行前资料检查未通过：'+e.message);return;}
  while(!this.stopping){
   const all=this.store.items(id).filter(inScope),item=all.find(x=>x.state==='WAITING_HUMAN')||all.find(x=>x.state==='RETRY')||(!scope&&all.find(x=>x.state==='PENDING'));
   if(!item){
    if(scope)this.store.event(id,null,'RETRY_SCOPE_COMPLETE',{ids:scope});
    const pending=this.store.items(id).some(x=>['PENDING','RETRY','WAITING_HUMAN'].includes(x.state));
    this.store.setBatch(id,pending?'PAUSED':'COMPLETED',pending?'异常重试范围已结束；余下待上架商品需另行确认继续':'本批执行结束；不会自动扩展数量');return;
   }
   if(this.flow.store.completed(item.task)){this.store.move(item.id,'SKIPPED','已存在成功记录，禁止再次提交');continue;}
   this.store.claim(item.id);
   try{
    let run=item.run_id?this.flow.store.run(item.run_id):null;
    if(!run){const old=this.flow.store.db.prepare('SELECT id FROM runs WHERE key=?').get(item.key);if(old){run=this.flow.store.run(old.id);if(digest(run.task)!==digest(item.task))throw Error('旧任务快照不同，需人工核对');}else run=this.flow.store.create(b.imported,item.task,b.mode,'SOURCE',{reviewed:true,taskHash:digest(item.task),batchAuthorization:b.review});this.store.attach(item.id,run.id);}
    if(run.state==='VERIFIED'){this.store.move(item.id,'SUCCEEDED','恢复已核验结果',run.result);continue;}
    if(run.state==='QUEUED')this.flow.launch(run.id,shop);
    else if(run.state==='DRY_RUN_COMPLETE'){this.store.move(item.id,'WAITING_HUMAN','仅填写批次已完成本条；未获本批正式提交模式');this.store.setBatch(id,'WAITING_HUMAN','仅填写模式，未提交');return;}
    else await this.flow.resume({id:run.id},shop);
    await this.flow.pending;run=this.flow.store.run(run.id);
    if(run.state==='VERIFIED'){this.store.move(item.id,'SUCCEEDED','',run.result);}
    else if(run.state==='DRY_RUN_COMPLETE'){this.store.move(item.id,'WAITING_HUMAN','仅填写完成，未提交');this.store.setBatch(id,'WAITING_HUMAN','仅填写模式，未提交');return;}
    else if(run.state==='RESULT_UNKNOWN'||run.state==='PAUSED_CAPTCHA'||this.stopping||/浏览器|登录|中断|店铺身份|browser|closed|disconnected|操作者暂停/i.test(run.reason)){
     this.store.move(item.id,'WAITING_HUMAN',run.state==='RESULT_UNKNOWN'?'提交结果待核验，禁止再次提交':run.reason);this.store.setBatch(id,this.stopping?'PAUSED':'WAITING_HUMAN',run.reason);return;
    }else {this.haltFailure(id,item,run.reason||'执行失败');return;}
   }catch(e){
    const current=this.store.item(item.id),run=current.run_id?this.flow.store.run(current.run_id):null;
    if(this.stopping||['RESULT_UNKNOWN','SUBMITTING','PAUSED_CAPTCHA'].includes(run?.state)||/CAPTCHA|浏览器|登录|店铺身份|browser|closed|disconnected/i.test(e.message)){
     if(current.state==='RUNNING')this.store.move(item.id,'WAITING_HUMAN',e.message);this.store.setBatch(id,this.stopping?'PAUSED':'WAITING_HUMAN',e.message);
    }else this.haltFailure(id,item,e.message);
    return;
   }
   await this.report(id);
  }
  this.store.setBatch(id,'PAUSED','操作者暂停，继续时复用原任务');
 }
 haltFailure(id,item,reason){
  if(this.store.item(item.id).state==='RUNNING')this.store.move(item.id,'FAILED',reason);
  this.store.event(id,item.id,'BATCH_FAULT_STOP',{reason,policy:'stop-on-first-execution-failure'});
  this.store.setBatch(id,'PAUSED','执行异常，整批已暂停，后续商品未开始；请检查后重试原商品。'+reason);
 }
 retry(id,shop){
  if(this.active||this.flow.active)throw Error('执行期间不能重试');const b=this.store.batch(id);if(b?.shop!==shop.id)throw Error('店铺不匹配');
  this.assertLegacyItems(this.store.items(id));
  if(this.store.items(id).some(x=>['RUNNING','WAITING_HUMAN'].includes(x.state)||x.run_id&&['RESULT_UNKNOWN','SUBMITTING','PAUSED_CAPTCHA','RUNNING'].includes(this.flow.store.run(x.run_id).state)))throw Error('先处理验证码、人工等待或待核验原商品，禁止混入异常重试');
  this.store.retryFailed(id);return this.start(id,shop);
 }
 skip(id,taskId,reason){if(this.active||this.flow.active)throw Error('请先暂停批次');const x=this.store.item(taskId);if(x.batch!==id)throw Error('商品不属于本批');this.assertLegacyItems([x]);if(x.run_id&&['SUBMITTING','RESULT_UNKNOWN'].includes(this.flow.store.run(x.run_id).state))throw Error('提交结果不明时禁止跳过，须先核验');this.store.move(taskId,'SKIPPED',reason||'操作者跳过');if(this.store.items(id).every(x=>['SUCCEEDED','FAILED','SKIPPED'].includes(x.state)))this.store.setBatch(id,'COMPLETED','本批所有任务已结束');return this.state(id);}
 async report(id){const report={generatedAt:new Date().toISOString(),...this.store.view(id),events:this.store.events(id)};const dir=join(this.flow.artifacts,'batches',id);await mkdir(dir,{recursive:true});await writeFile(join(dir,'report.json'),JSON.stringify(report,null,2));return report;}
}
