// Read-only product projection. Never creates tasks, changes publishing rules or reads source files.
import {basename} from 'node:path';
import {destinationKey} from './source-store.mjs';
import {redact} from './product-state.mjs';

const labels={VERIFIED:'已上架',RESULT_UNKNOWN:'待核验',SUBMITTING:'提交结果待确认',RUNNING:'运行中',PAUSED_CAPTCHA:'等待人工验证',PAUSED:'已暂停',DRY_RUN_COMPLETE:'已填好，未提交',QUEUED:'待执行',PENDING:'待上架',WAITING_HUMAN:'等待人工',FAILED:'执行失败',RETRY:'待重试',SKIPPED:'已跳过',SUCCEEDED:'已上架',NEEDS_DATA:'需补充资料',AVAILABLE:'尚未生成任务'};
const workbench=(route,params={})=>'/index.html?'+new URLSearchParams(params)+'#'+route;

export function destinationCatalog(store,shopId){
  const imports=store.db.prepare('SELECT id,at,payload FROM imports ORDER BY rowid DESC').all();
  // Latest pool and latest heat import are the explicit catalogue sources; do not resurrect every historical import.
  let pool,heat;
  for(const row of imports){const data=JSON.parse(row.payload);if(!data.tasks?.some(t=>t.shopId===shopId))continue;
    const source={...data,id:row.id,at:row.at};if(data.sheet==='境外城市热度'){heat||=source;}else{pool||=source;}if(pool&&heat)break;
  }
  const byKey=new Map();
  for(const source of [pool,heat].filter(Boolean))for(const task of source.tasks){if(task.shopId!==shopId)continue;byKey.set(destinationKey(task),{task,source});}
  const runs=new Map(store.list().map(r=>[r.key,r]));
  const history=new Map(store.db.prepare('SELECT key,payload FROM history').all().map(r=>[r.key,JSON.parse(r.payload)]));
  const queue=new Map(store.db.prepare('SELECT id,batch,key,state,reason,run_id FROM batch_items').all().map(r=>[r.key,r]));
  const items=[...byKey].map(([key,{task:t,source}])=>{
    const run=runs.get(key),completed=history.get(key),queued=queue.get(key),issues=(t.adapterIssues||[]).map(redact);
    const state=completed?'VERIFIED':run?.state||queued?.state||(issues.length?'NEEDS_DATA':'AVAILABLE');
    const destination=t.listing.city||t.listing.country,counts=Object.fromEntries(['main','secondary','details'].map(k=>[k,t.assets?.[k]?.length||0]));
    const materials=Object.entries(t.assets||{}).filter(([g])=>['main','secondary','details'].includes(g)).flatMap(([group,files])=>files.map((a,index)=>({group,index,name:basename(a.path),url:'/api/source/asset?'+new URLSearchParams({batch:source.id,order:t.priority,group,index})})));
    const batchId=queued?.batch||null;
    const next=completed?{label:'查看上架记录',href:workbench('records',{destination})}:
      run||queued?{label:['RESULT_UNKNOWN','SUBMITTING','PAUSED_CAPTCHA','PAUSED','WAITING_HUMAN','FAILED'].includes(state)?'查看处理条件':'查看任务',href:workbench(['RESULT_UNKNOWN','SUBMITTING','PAUSED_CAPTCHA','PAUSED','WAITING_HUMAN','FAILED'].includes(state)?'exceptions':'tasks',{destination,...(batchId?{batch:batchId}:{})})}:
      {label:issues.length?'查看资料问题':'导入并核对批次',href:workbench('tasks',{portal:'import',destination})};
    return {key,destination,country:t.listing.country,city:t.listing.city||'',type:t.listing.type,title:t.listing.title,
      rank:source.sheet==='境外城市热度'?t.priority:null,source:{name:basename(source.workbook||''),sheet:t.source?.sheet||source.sheet||'',row:t.source?.row||null,importId:source.id,importedAt:source.at},
      issues,materials,counts,completeness:issues.length?'需补充资料':'上次导入校验通过',price:t.business?.price_cny??null,inventory:t.business?.inventory??null,
      state,stateLabel:labels[state]||'待检查',reason:redact(run?.reason||queued?.reason||''),batchId,runId:run?.id||null,itemId:completed?.itemId||null,
      duplicateBlocked:!!(completed||run||queued),next};
  }).sort((a,b)=>(a.rank??Infinity)-(b.rank??Infinity)||a.destination.localeCompare(b.destination,'zh-CN'));
  return {at:new Date().toISOString(),scope:'最新商品池与最新热度导入，按店铺和原商品标识合并；资料状态为导入快照',sources:[pool,heat].filter(Boolean).map(x=>({id:x.id,name:basename(x.workbook||''),sheet:x.sheet||'商品资料',at:x.at})),
    total:items.length,counts:{published:items.filter(x=>x.state==='VERIFIED').length,needsData:items.filter(x=>x.issues.length).length,withTasks:items.filter(x=>x.runId||x.batchId).length},items};
}

export function searchDestinations(catalog,query='',limit=60,filter=''){
  const q=String(query).normalize('NFKC').trim().toLocaleLowerCase().slice(0,120);
  const all=catalog.items.filter(x=>(filter!=='needs-data'||x.issues.length>0)&&(!q||[x.destination,x.country,x.title,x.itemId].some(v=>String(v||'').normalize('NFKC').toLocaleLowerCase().includes(q))));
  const sorted=q?[...all].sort((a,b)=>Number(b.destination===q)-Number(a.destination===q)):all;
  const n=Math.max(1,Math.min(100,Number.isFinite(Number(limit))?Math.floor(Number(limit)):60));
  return {...catalog,items:sorted.slice(0,n),matched:all.length,query:q,limit:n,filter};
}
