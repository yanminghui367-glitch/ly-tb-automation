import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
const root=process.env.WORKBENCH_URL||'http://127.0.0.1:4318';
const state=await (await fetch(root+'/api/batch/state')).json();
if(!state.batch)throw Error('No batch');
const b=await (await fetch(root+'/api/batch/report?id='+state.batch.id)).json();
const out=resolve(process.argv[2]||'output/batch20-20260921');await mkdir(out,{recursive:true});
const tasks=[];
for(const item of b.items){
 const events=item.runId?(await (await fetch(root+'/api/source/events?id='+item.runId)).json()).events:[];
 tasks.push({...item,events});
}
const p=JSON.parse(await readFile(join(out,'preview.json'),'utf8'));
const inputs=[{path:p.source.workbook,sha256:p.source.hash},{path:p.source.pool,sha256:p.source.poolHash},...p.tasks.flatMap(t=>Object.values(t.assets).flat())];
const hashes=[];
for(const x of new Map(inputs.map(x=>[x.path,x])).values())hashes.push({path:x.path,unchanged:createHash('sha256').update(await readFile(x.path)).digest('hex')===x.sha256});
const incidents=b.events.filter(e=>(e.task&&['FAILED','WAITING_HUMAN'].includes(e.kind))||e.kind==='SCHEDULER_ERROR');
const submissions=tasks.map(t=>({taskId:t.id,itemId:t.result?.itemId||null,intents:t.events.filter(e=>e.kind==='STEP_INTENT'&&e.payload.name==='submit-once').length}));
const ids=submissions.map(x=>x.itemId).filter(Boolean);
const report={...b,tasks,incidents,submissions,uniqueItemIds:new Set(ids).size===ids.length,noRepeatedSubmit:submissions.every(x=>x.intents<=1),captchaPauses:incidents.filter(e=>/CAPTCHA/.test(e.payload.reason||'')).length,sourceChecks:hashes,scope:'Only the frozen 20 tasks; no automatic expansion',complete:b.state==='COMPLETED',successRate:b.counts.SUCCEEDED/b.total};
await writeFile(join(out,'batch-result.json'),JSON.stringify(report,null,2));
const lines=[`# 20 条批次实际测试记录`, ``, `更新：${b.generatedAt}`, `批次：${b.id}`, `状态：${b.state}；成功 ${b.counts.SUCCEEDED}/${b.total}，失败 ${b.counts.FAILED}，等待人工 ${b.counts.WAITING_HUMAN}，未完成 ${b.counts.PENDING+b.counts.RETRY+b.counts.RUNNING}。`, `已核验成功占批次 ${(report.successRate*100).toFixed(0)}%；未结束时此值不是最终成功率。累计执行 ${(b.elapsedMs/60000).toFixed(1)} 分钟（不含暂停），最大连续成功 ${b.max_consecutive}。`, `输入文件哈希：${hashes.every(x=>x.unchanged)?'全部不变':'存在变化，需暂停检查'}。`, ``, `|顺序|目的地|状态|次数|商品ID|原因|`, `|---|---|---|---|---|---|`, ...tasks.map(x=>`|${x.position}|${x.destination}|${x.state}|${x.attempts}|${x.result?.itemId||''}|${x.reason.replaceAll('\n',' ').replaceAll('|','/')}|`), ``, `逐步耗时、截图、暂停及恢复记录见同目录 batch-result.json。提交结果不明仅查验原商品，不重新提交。`];
const concise=reason=>/getByText\('五洲畅游'/.test(reason)?'素材库店铺名称定位失败；已改用店铺容器可见文本校验':/struct-p-20000/.test(reason)?'品牌选项未正确保存；已改为点击下拉选项并双重回读':/sucai-tu-upload/.test(reason)?'素材上传窗口超时；原任务有限重试':/程序或浏览器中断/.test(reason)?'程序异常退出；重启恢复原任务，状态检查已统一复用原浏览器':reason.split('\n')[0];
lines.push('',`商品ID无重复：${report.uniqueItemIds}；每条提交意图不超过一次：${report.noRepeatedSubmit}。`, `暂停与失败记录 ${incidents.length} 次，其中验证码暂停 ${report.captchaPauses} 次；不是无人干预压测。`,...incidents.map(e=>`- ${e.at} ${tasks.find(t=>t.id===e.task)?.destination||'批次'}：${concise(e.payload.reason||e.kind)}`));
await writeFile(join(out,'REPORT.md'),lines.join('\n')+'\n');
console.log(JSON.stringify({state:b.state,counts:b.counts,sourceUnchanged:hashes.every(x=>x.unchanged),report:join(out,'REPORT.md')}));
