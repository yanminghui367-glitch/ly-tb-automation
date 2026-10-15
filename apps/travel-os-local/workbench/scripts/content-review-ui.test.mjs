import test from 'node:test';
import assert from 'node:assert/strict';
import {mountContentReview} from '../content-review-ui.js';

const item=(extra={})=>({key:'uk',position:1,destination:'英国',title:'英国导游地陪',taskHash:'task-hash',mainHashes:['image-hash'],images:[{url:'/api/assets/main.png',name:'英国主图'}],review:null,...extra});
const state=(extra={})=>({shop:'shop-hqlh',importId:'import-hqlh',total:1,reviewed:0,unreviewed:1,mismatched:0,round:{id:'round-hqlh',manifestHash:'manifest-hash'},items:[item()],...extra});
function harness(t,{initial=state(),get,post}={}){
 let snapshot=initial;const listeners=new Map(),reads=[],writes=[],saved=[];
 const root={innerHTML:'',addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name)};
 const ui=mountContentReview(root,{shopName:'环球领航',get:async url=>{reads.push(url);return get?get(url):snapshot;},post:async(url,body)=>{writes.push({url,body});return post?post(url,body):{ok:true};},requestId:()=>`request-${writes.length+1}`,onSaved:result=>saved.push(result)});
 t.after(()=>ui.dispose());
 const card={dataset:{contentKey:'uk'}};
 return {root,ui,reads,writes,saved,listeners,setSnapshot(value){snapshot=value;},click(action,key='uk') {const target={disabled:false,dataset:{contentAction:action},closest:selector=>selector==='[data-content-action]'?target:{dataset:{contentKey:key}}};return listeners.get('click')({target});},field(name,value,{checked=false,key='uk'}={}){listeners.get('input')({target:{dataset:{contentField:name},value,checked,closest:()=>({...card,dataset:{contentKey:key}})}});}};
}

test('default is unreviewed with visible images; no bulk approval or execution controls',async t=>{
 const h=harness(t);await h.ui.ready;
 assert.match(h.root.innerHTML,/<option value="UNREVIEWED" selected>/);
 assert.match(h.root.innerHTML,/<img src="\/api\/assets\/main.png"/);
 assert.match(h.root.innerHTML,/target="_blank" rel="noopener noreferrer"/);
 assert.doesNotMatch(h.root.innerHTML,/data-content-action="(?:start|publish|all-pass)"/);
 assert.equal(h.writes.length,0);
});

test('list creation requires explicit confirmation and binds the current import count',async t=>{
 const h=harness(t,{initial:state({round:null,total:700,items:[]})});await h.ui.ready;
 assert.match(h.root.innerHTML,/data-content-action="create"[^>]*disabled/);
 await h.click('create');assert.equal(h.writes.length,0);
 h.field('confirmed','',{checked:true});await h.click('create');
 assert.deepEqual(h.writes[0],{url:'/api/v1/content-preparation/create',body:{importId:'import-hqlh',expectedCount:700,confirmed:true,requestId:'request-1'}});
 assert.match(h.root.innerHTML,/执行清单已建立/);
});

test('one-item review requires real observations and sends immutable manifest binding, not paths',async t=>{
 const h=harness(t);await h.ui.ready;
 h.field('decision','PASS');await h.click('review');assert.equal(h.writes.length,0);
 assert.match(h.root.innerHTML,/请填写审核者和实际观察内容/);
 h.field('reviewer',' toni ');h.field('observedText',' 主图写英国，服务为导游地陪 ');await h.click('review');
 assert.deepEqual(h.writes[0],{url:'/api/v1/content-preparation/review',body:{id:'round-hqlh',manifestHash:'manifest-hash',key:'uk',taskHash:'task-hash',mainHashes:['image-hash'],decision:'PASS',observedText:'主图写英国，服务为导游地陪',reviewer:'toni',requestId:'request-1'}});
 assert.doesNotMatch(JSON.stringify(h.writes[0]),/evidence|path|main\.png/);
 assert.equal(h.saved.length,1);
});

test('saved PASS fields display the refreshed server review instead of an empty draft',async t=>{
 let h;h=harness(t,{post:async(_url,body)=>{h.setSnapshot(state({reviewed:1,unreviewed:0,items:[item({review:{decision:body.decision,reviewer:body.reviewer,observedText:body.observedText}})]}));return {accepted:true};}});await h.ui.ready;
 h.field('decision','PASS');h.field('reviewer',' toni ');h.field('observedText',' 英国主图与商品目的地一致 ');await h.click('review');
 assert.match(h.root.innerHTML,/已保存：审核通过/);
 assert.match(h.root.innerHTML,/<option value="PASS" selected>/);
 assert.match(h.root.innerHTML,/data-content-field="reviewer" value="toni"/);
 assert.match(h.root.innerHTML,/>英国主图与商品目的地一致<\/textarea>/);
 assert.equal(h.writes.length,1);
});

test('unreviewed records still require an observer and observation within server limits',async t=>{
 const h=harness(t);await h.ui.ready;
 await h.click('review');assert.equal(h.writes.length,0);
 h.field('reviewer','a'.repeat(161));h.field('observedText','尚待核实地名');await h.click('review');assert.equal(h.writes.length,0);
 h.field('reviewer','toni');h.field('observedText','a'.repeat(1001));await h.click('review');assert.equal(h.writes.length,0);
 h.field('observedText','尚待核实地名');await h.click('review');assert.equal(h.writes[0].body.decision,'UNREVIEWED');
 assert.match(h.root.innerHTML,/maxlength="160"/);assert.match(h.root.innerHTML,/maxlength="1000"/);
});

test('mismatch is retained as mismatch; failures preserve input and the request id for recovery',async t=>{
 let fail=true;const h=harness(t,{post:async()=>{if(fail)throw Error('审核未保存');return {};}});await h.ui.ready;
 h.field('decision','MISMATCH');h.field('reviewer','toni');h.field('observedText','主图为意大利');await h.click('review');
 assert.match(h.root.innerHTML,/审核未保存/);assert.match(h.root.innerHTML,/主图为意大利/);
 assert.match(h.root.innerHTML,/<option value="MISMATCH" selected>/);
 fail=false;await h.click('review');assert.equal(h.writes[0].body.requestId,h.writes[1].body.requestId);
 assert.equal(h.writes[1].body.decision,'MISMATCH');
});

test('recovery is absent unless eligible, and requires a separate per-item confirmation',async t=>{
 const h=harness(t);await h.ui.ready;assert.doesNotMatch(h.root.innerHTML,/恢复未启动记录/);
 await h.click('repair');assert.equal(h.writes.length,0);
 h.setSnapshot(state({items:[item({repairEligible:true})]}));await h.ui.refresh();
 assert.match(h.root.innerHTML,/data-content-action="repair" disabled/);
 await h.click('repair');assert.equal(h.writes.length,0);
 h.field('repairConfirmed','',{checked:true});await h.click('repair');
 assert.deepEqual(h.writes[0],{url:'/api/v1/content-preparation/repair',body:{id:'round-hqlh',manifestHash:'manifest-hash',key:'uk',confirmed:true,requestId:'request-1'}});
 assert.match(h.root.innerHTML,/未启动记录已恢复，尚未开始执行/);
});

test('credited preflight history shows effective attempts without claiming a retry or publication',async t=>{
 const h=harness(t,{initial:state({items:[item({preflightCredit:3,effectiveAttempts:1})]})});await h.ui.ready;
 assert.match(h.root.innerHTML,/历史预检抵扣 3 次；有效尝试 1 次。原历史保留/);
 assert.equal(h.writes.length,0);
 h.setSnapshot(state({items:[item({preflightCredit:0,effectiveAttempts:3})]}));await h.ui.refresh();assert.doesNotMatch(h.root.innerHTML,/历史预检抵扣/);
});

test('pagination reads bounded pages and preserves drafts without saving them automatically',async t=>{
 const h=harness(t,{initial:state({total:41})});await h.ui.ready;
 h.field('observedText','尚在核对英国');await h.click('next');await h.click('previous');
 assert.deepEqual(h.reads,['/api/v1/content-preparation?offset=0&limit=20','/api/v1/content-preparation?offset=20&limit=20','/api/v1/content-preparation?offset=0&limit=20']);
 assert.match(h.root.innerHTML,/尚在核对英国/);assert.equal(h.writes.length,0);
});

test('untrusted copy is escaped and executable or protocol-relative image URLs are rejected',async t=>{
 const h=harness(t,{initial:state({items:[item({destination:'<img onerror="x">',title:'<script>x</script>',images:[{url:'javascript:alert(1)',name:'x'},{url:'//evil.test/x',name:'x'},{url:'/ok?x=" onerror="x',name:'x'}],review:{decision:'PASS',reviewer:'"><script>x</script>',observedText:'</textarea><script>x</script>'}})]})});await h.ui.ready;
 assert.doesNotMatch(h.root.innerHTML,/<script>|src="javascript:|src="\/\/evil/);
 assert.match(h.root.innerHTML,/&lt;script&gt;/);
 assert.match(h.root.innerHTML,/主图地址不可用/);
});

test('a changed image hash invalidates unsaved approval drafts',async t=>{
 const h=harness(t);await h.ui.ready;h.field('decision','PASS');h.field('reviewer','toni');h.field('observedText','旧图为英国');
 h.setSnapshot(state({items:[item({mainHashes:['new-hash']})]}));await h.ui.refresh();
 assert.match(h.root.innerHTML,/<option value="UNREVIEWED" selected>/);
 assert.doesNotMatch(h.root.innerHTML,/旧图为英国/);
});

test('pending writes prevent duplicate clicks and unmount discards late reads',async t=>{
 let finish;const h=harness(t,{post:()=>new Promise(resolve=>{finish=resolve;})});await h.ui.ready;
 h.field('decision','PASS');h.field('reviewer','toni');h.field('observedText','英国');
 const waiting=h.click('review');await h.click('review');assert.equal(h.writes.length,1);assert.match(h.root.innerHTML,/aria-busy="true"/);
 finish({});await waiting;
 let complete;const h2=harness(t,{get:()=>new Promise(resolve=>{complete=resolve;})});h2.ui.dispose();const html=h2.root.innerHTML;complete(state());await h2.ui.ready;assert.equal(h2.root.innerHTML,html);
});
