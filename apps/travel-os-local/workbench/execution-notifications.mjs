import {readFile,writeFile,rename,mkdir} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const alertStates=new Set(['SYSTEM_BLOCKED','WAITING_HUMAN','RESULT_UNKNOWN','NEEDS_REVIEW','PAUSED_CAPTCHA']);
const manualPause=reason=>/操作者暂停|本轮已停止|已安全暂停，恢复将沿用原任务/.test(String(reason||''));
const alertDetail=(state,reason)=>{
 if(state==='RESULT_UNKNOWN')return '有商品结果待核验，请打开工作台检查原商品。';
 if(state==='SYSTEM_BLOCKED')return '系统检查阻止了后续执行，请打开工作台查看原因。';
 if(/验证码|CAPTCHA|滑块/.test(String(reason||'')))return '执行遇到验证码，需要人工处理。';
 if(/登录|身份|风控|风险/.test(String(reason||'')))return '执行需要人工检查店铺登录或验证。';
 return '请打开工作台查看暂停原因与当前商品。';
};

export function notificationDecision(state,reason=''){
 if(state==='COMPLETED')return {kind:'complete',title:'上架轮次已完成',message:'固定清单本轮处理结束。请打开星途查看结果。'};
 if(alertStates.has(state))return {kind:'attention',title:'上架任务已暂停',message:alertDetail(state,reason)};
 if(state==='PAUSED'&&!manualPause(reason))return {kind:'attention',title:'上架任务已暂停',message:alertDetail(state,reason)};
 return null;
}

async function readState(file){try{return JSON.parse(await readFile(file,'utf8'));}catch(e){if(e.code==='ENOENT')return {version:1,rounds:{},events:[]};throw e;}}
async function writeState(file,value){await mkdir(dirname(file),{recursive:true});const temp=file+'.tmp';await writeFile(temp,JSON.stringify(value,null,2),'utf8');await rename(temp,file);}

export function createWindowsPopup({script=fileURLToPath(new URL('../tools/notify-workbench.ps1',import.meta.url)),powershell='powershell.exe'}={}){
 return event=>new Promise((resolve,reject)=>{
  const child=spawn(powershell,['-NoLogo','-NoProfile','-NonInteractive','-STA','-WindowStyle','Hidden','-File',script,'-Title',String(event.title).slice(0,60),'-Message',String(event.message).replace(/[\r\n]+/g,' ').slice(0,220),'-Url','http://127.0.0.1:4318/travel-os.html#tasks'],{windowsHide:true,detached:true,stdio:'ignore'});
  child.once('error',reject);child.once('spawn',()=>{child.unref();resolve({accepted:true});});
 });
}

export class ExecutionNotificationMonitor{
 constructor({runtime,products,notify,now=()=>new Date(),intervalMs=5000,log=()=>{}}={}){
  if(!runtime||typeof products!=='function'||typeof notify!=='function')throw Error('执行提醒监测缺少必要依赖');
  Object.assign(this,{file:join(runtime,'execution-notifications.json'),products,notify,now,intervalMs,log});this.timer=null;this.busy=false;
 }
 start(){if(this.timer)return;this.timer=setInterval(()=>void this.check().catch(e=>this.log('执行提醒状态检查失败：'+e.message)),this.intervalMs);this.timer.unref?.();void this.check().catch(e=>this.log('执行提醒状态初始化失败：'+e.message));}
 stop(){if(this.timer)clearInterval(this.timer);this.timer=null;}
 async check(){
  if(this.busy)return;this.busy=true;
  try{
   const state=await readState(this.file),products=this.products();let changed=false;
   for(const product of products){
    const round=product?.round?.round?.();if(!round)continue;
    const current=round.current_item?product.round.item(round.id,round.current_item):null;
    const latest=product.round.windows?.latest?.(round.id);
    let status=round.state,reason=round.reason||'';
    if(status==='RUNNING'&&product.round.active!==round.id){status='SYSTEM_BLOCKED';reason='执行器已停止，但轮次仍标记为运行中；请核对原任务。';}
    const previous=state.rounds[round.id];
    if(!previous){state.rounds[round.id]={status,reason,alerting:!!notificationDecision(status,reason),windowId:latest?.id||null,currentKey:round.current_item||null};changed=true;continue;}
    const decision=notificationDecision(status,reason),wasAlerting=previous.alerting===true;
    const shouldNotify=!!decision&&(!wasAlerting||decision.kind==='complete'&&previous.status!=='COMPLETED');
    const currentData={status,reason,alerting:!!decision,windowId:latest?.id||null,currentKey:round.current_item||null};
    const signature=JSON.stringify(currentData);
    if(signature===JSON.stringify(previous))continue;
    state.rounds[round.id]=currentData;changed=true;
    if(shouldNotify){
     const id=`${round.id}:${latest?.id||'round'}:${status}:${this.now().getTime()}`;
     const destination=current?.task?.listing?.city||current?.task?.listing?.country||'';
     const shop=product.shop?.name||'当前店铺';
     const event={id,kind:decision.kind,title:decision.title,message:`${shop}${destination?' · '+destination:''}。${decision.message}`,url:'http://127.0.0.1:4318/travel-os.html#tasks',at:this.now().toISOString()};
     state.events.push({...event,delivery:'queued'});state.events=state.events.slice(-300);changed=true;
     // Persist the dedupe key before spawning the Windows notifier: a process
     // restart must never duplicate a popup for the same state transition.
     await writeState(this.file,state);
     try{await this.notify(event);const saved=await readState(this.file);const row=saved.events.find(x=>x.id===id);if(row)row.delivery='sent';await writeState(this.file,saved);Object.assign(state,saved);}
     catch(e){this.log('Windows 提醒发送失败：'+e.message);}
    }
   }
   if(changed)await writeState(this.file,state);
  }finally{this.busy=false;}
 }
}
