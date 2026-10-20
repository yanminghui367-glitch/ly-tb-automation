import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ExecutionNotificationMonitor,notificationDecision} from '../execution-notifications.mjs';

test('人工主动暂停和停止不触发弹窗，验证码或未知结果需要提醒',()=>{
 assert.equal(notificationDecision('PAUSED','操作者暂停本轮'),null);
 assert.equal(notificationDecision('STOPPED','本轮已停止'),null);
 assert.equal(notificationDecision('PAUSED','系统问题，验证码阻塞').kind,'attention');
 assert.equal(notificationDecision('RESULT_UNKNOWN','提交结果尚未确认').kind,'attention');
 assert.equal(notificationDecision('COMPLETED').kind,'complete');
});

test('异常停机、恢复后再次停机、完成各提醒一次并持久去重',async t=>{
 const runtime=await mkdtemp(join(tmpdir(),'travel-notifications-'));t.after(()=>rm(runtime,{recursive:true,force:true}));
 let now=new Date('2026-10-17T10:00:00Z'),sent=[];
 const round={id:'round-1',state:'RUNNING',reason:'',current_item:'item-1'};
 const product={shop:{name:'测试店铺'},round:{active:'round-1',round:()=>({...round}),item:()=>({task:{listing:{city:'东京'}}}),windows:{latest:()=>({id:'window-1'})}}};
 const monitor=new ExecutionNotificationMonitor({runtime,products:()=>[product],notify:async e=>sent.push(e),now:()=>new Date(now)});
 await monitor.check();
 round.state='PAUSED';round.reason='系统遇到验证码';now=new Date(+now+5000);await monitor.check();await monitor.check();
 assert.equal(sent.length,1);assert.match(sent[0].message,/测试店铺.*东京/);
 round.state='RUNNING';round.reason='';now=new Date(+now+5000);await monitor.check();
 round.state='SYSTEM_BLOCKED';round.reason='页面识别异常';now=new Date(+now+5000);await monitor.check();assert.equal(sent.length,2);
 round.state='COMPLETED';round.reason='';now=new Date(+now+5000);await monitor.check();await monitor.check();assert.equal(sent.length,3);
 const persisted=JSON.parse(await readFile(join(runtime,'execution-notifications.json'),'utf8'));
 assert.equal(persisted.events.filter(x=>x.delivery==='sent').length,3);
});

test('执行器意外丢失但轮次仍运行时转成异常提醒',async t=>{
 const runtime=await mkdtemp(join(tmpdir(),'travel-notifications-'));t.after(()=>rm(runtime,{recursive:true,force:true}));let sent=[];
 const round={id:'round-2',state:'RUNNING',reason:'',current_item:null};
 const product={shop:{name:'测试店铺'},round:{active:null,round:()=>({...round}),item:()=>null,windows:{latest:()=>null}}};
 const monitor=new ExecutionNotificationMonitor({runtime,products:()=>[product],notify:async e=>sent.push(e)});
 await monitor.check();assert.equal(sent.length,0);
 // A persisted RUNNING state followed by a stopped executor is a system stop.
 product.round.active='round-2';await monitor.check();product.round.active=null;await monitor.check();
 assert.equal(sent.length,1);assert.equal(sent[0].kind,'attention');
});
