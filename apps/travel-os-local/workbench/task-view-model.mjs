// Presentation-only classification. Never changes execution state or permissions.
export function taskGroup(item){
 const state=item.displayState||item.runState||item.state;
 if(['RUNNING','SUBMITTING'].includes(state))return 'running';
 if(['SUCCEEDED','VERIFIED','SKIPPED','CANCELLED','DRY_RUN_COMPLETE'].includes(state))return 'done';
 if(['PENDING','QUEUED','RETRY','PREPARING','READY','AVAILABLE'].includes(state))return 'waiting';
 return 'attention';
}
export function taskListView(items,{filter='all',search='',page=1,pageSize=10}={}){
 const counts={all:items.length,running:0,waiting:0,done:0,attention:0};
 for(const item of items)counts[taskGroup(item)]++;
 const q=search.trim().toLocaleLowerCase();
 const matches=items.filter(item=>(filter==='all'||taskGroup(item)===filter)&&(!q||[item.name,item.title,item.destination].some(v=>String(v||'').toLocaleLowerCase().includes(q))));
 const pages=Math.max(1,Math.ceil(matches.length/pageSize)),current=Math.max(1,Math.min(page,pages));
 return {counts,total:matches.length,pages,page:current,rows:matches.slice((current-1)*pageSize,current*pageSize)};
}
export function materialReadiness(products,group){
 const total=products.length;
 const ready=products.filter(p=>!(p.issues||[]).length&&(group==='main'?p.counts.main===1:group==='secondary'?p.counts.secondary===4:p.counts.details>0)).length;
 return {ready,total,percent:total?Math.round(ready/total*100):0};
}
// Imported image references across the full product scope, not ready products.
// Shared files count once per product reference; this is not unique disk-file count.
export function materialCount(products,group){
 return products.reduce((total,p)=>{
  const count=p.counts?.[group];
  return total+(Number.isSafeInteger(count)&&count>=0?count:0);
 },0);
}

export function retryPlan(batch,active){
 const items=batch?.items||[],state=x=>x.displayState||x.runState||x.state;
 const eligible=items.filter(x=>x.state==='FAILED'&&['FAILED','PAUSED'].includes(state(x))&&Number.isInteger(x.attempts)&&Number.isInteger(x.maxAttempts)&&x.attempts<x.maxAttempts);
 const unsafe=items.some(x=>['RESULT_UNKNOWN','SUBMITTING','PAUSED_CAPTCHA','RUNNING','WAITING_HUMAN'].includes(state(x))||x.issue?.category==='验证码');
 const waiting=items.some(x=>['PENDING','RETRY','QUEUED'].includes(x.state));
 const reason=active?'正在执行或保存断点，请等待停止。':unsafe?'批次含等待人工、提交中或结果待核验商品，先处理原任务。':waiting?'批次还有待执行商品；先处理原队列，再单独重试异常项。':!eligible.length?'没有可重试异常项，或已达到每条的尝试上限。':'';
 return {eligible,reason,allowed:!reason};
}
export function failureSummary(task){
 const text=task.reason||'';
 if(/sucai-tu-upload/.test(text))return '素材库上传按钮未出现（等待 30 秒超时）';
 if(/mainImagesGroup/.test(text)&&/搜索图片名称/.test(text))return '图片选择框未加载完成（等待 5 秒超时）';
 return task.issue?.category==='页面校验'?'页面状态校验未通过，查看日志与截图':task.issue?.category||'原因待人工确认，查看原始日志';
}

// getRandomValues is available on local HTTP LAN pages; randomUUID may not be.
export function requestId(provider=globalThis.crypto){
 if(typeof provider?.randomUUID==='function')return provider.randomUUID();
 const b=new Uint8Array(16);provider.getRandomValues(b);b[6]=(b[6]&15)|64;b[8]=(b[8]&63)|128;
 const h=Array.from(b,x=>x.toString(16).padStart(2,'0')).join('');
 return [h.slice(0,8),h.slice(8,12),h.slice(12,16),h.slice(16,20),h.slice(20)].join('-');
}
