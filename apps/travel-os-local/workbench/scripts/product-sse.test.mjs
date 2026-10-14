import test from 'node:test';
import assert from 'node:assert/strict';
import {Writable} from 'node:stream';
import {ProductApi} from '../product-api.mjs';

// Real Node write buffering, fake clock and synthetic snapshots only. No DB,
// HTTP listener, execution owner, Chrome, profile or platform is instantiated.
const turn=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
class Response extends Writable {
 constructor({slow=false,throwWrite=false,asyncDrain=false,asyncError=false,highWaterMark=16}={}){super({highWaterMark});this.slow=slow;this.throwWrite=throwWrite;this.asyncDrain=asyncDrain;this.asyncError=asyncError;this.frames=[];this.accepted=[];this.waiting=null;}
 writeHead(status,headers){this.status=status;this.headers=headers;}
 _write(chunk,encoding,callback){if(this.slow)this.waiting=callback;else if(this.asyncError)setImmediate(()=>callback(Error('synthetic async write failure')));else if(this.asyncDrain)setImmediate(callback);else callback();}
 write(chunk,...args){if(this.throwWrite)throw Error('synthetic write failure');this.frames.push(String(chunk));const accepted=super.write(chunk,...args);this.accepted.push(accepted);return accepted;}
 drainOne(){assert.ok(this.waiting,'expected pending native write');const callback=this.waiting;this.waiting=null;callback();}
}
function harness(t,snapshot){
 t.mock.timers.enable({apis:['setInterval']});
 const api={streams:new Set(),snapshot},responses=[];
 t.after(async()=>{for(const response of responses)response.destroy();await turn();t.mock.timers.reset();});
 return {api,
  async tick(count=1){for(let i=0;i<count;i++){t.mock.timers.tick(15000);await turn();}},
  open(options={},batch='fixture-batch'){
   const response=new Response(options);responses.push(response);
   const ready=ProductApi.prototype.handle.call(api,{method:'GET'},response,new URL('http://fixture.invalid/api/v1/events?batch='+encodeURIComponent(batch)),{});
   return {response,ready};
  },
  closeAll(){ProductApi.prototype.closeStreams.call(api);}
 };
}
function cleaned(h,response){
 assert.equal(h.api.streams.size,0,'stream registration must be removed');
 for(const event of ['close','finish','error','drain'])assert.equal(response.listenerCount(event),0,event+' listener must be removed');
}
const stateFrame=response=>JSON.parse(response.frames.at(-1).split('data: ')[1].trim());

test('slow writable: 24 poll opportunities retain only one frame and one snapshot',async t=>{
 let calls=0;const rows=Array.from({length:700},(_,i)=>({id:i,title:'合成状态'.repeat(25)}));
 const h=harness(t,async()=>({revision:++calls,rows})),{response,ready}=h.open({slow:true});await ready;
 const bytes=response.writableLength;assert.ok(bytes>16384);assert.deepEqual(response.accepted,[false]);
 await h.tick(23);
 assert.equal(calls,1);assert.equal(response.frames.length,1);assert.equal(response.writableLength,bytes);
 response.destroy();await turn();cleaned(h,response);await h.tick(3);assert.equal(calls,1);
});

test('drain sends the latest state without replaying intermediate blocked revisions',async t=>{
 let revision=1,calls=0;const h=harness(t,async()=>({revision,calls:++calls})),{response,ready}=h.open({slow:true});await ready;
 for(revision=2;revision<=6;revision++)await h.tick();
 assert.equal(calls,1);revision=42;response.drainOne();await turn();
 assert.equal(calls,2);assert.equal(response.frames.length,2);assert.equal(stateFrame(response).revision,42);
 await h.tick(4);assert.equal(calls,2);assert.equal(response.writableLength,Buffer.byteLength(response.frames[1]));
 response.destroy();await turn();cleaned(h,response);
});

test('fast writable preserves the SSE event format, batch selection and reduced snapshot cadence',async t=>{
 const batches=[];const h=harness(t,async batch=>{batches.push(batch);return {revision:batches.length};});
 const {response,ready}=h.open({},'batch / 1');assert.equal(await ready,true);await h.tick(3);
 assert.equal(response.status,200);assert.equal(response.headers['content-type'],'text/event-stream');
 assert.deepEqual(batches,Array(4).fill('batch / 1'));assert.equal(response.writableLength,0);
 assert.equal(response.frames.length,4);assert.equal(response.frames[0],'event: state\ndata: {"revision":1}\n\n');
 response.end();await turn();cleaned(h,response);await h.tick(2);assert.equal(batches.length,4);
});

test('large but fast async writes do not turn drain into an unthrottled snapshot loop',async t=>{
 let calls=0;const h=harness(t,async()=>({revision:++calls,padding:'x'.repeat(1024)}));
 const {response,ready}=h.open({asyncDrain:true});await ready;
 for(let i=0;i<5;i++)await turn();assert.equal(calls,1);assert.equal(response.writableLength,0);
 assert.equal(response.accepted[0],false);await h.tick();for(let i=0;i<5;i++)await turn();
 assert.equal(calls,2);assert.equal(response.frames.length,2);assert.equal(response.writableLength,0);
});

test('snapshot computation is never overlapped by polling or repeated drain signals',async t=>{
 const gate=deferred();let calls=0,inflight=0,max=0;
 const h=harness(t,async()=>{calls++;max=Math.max(max,++inflight);try{await gate.promise;return {calls};}finally{inflight--;}});
 const {response,ready}=h.open();await h.tick(8);response.emit('drain');response.emit('drain');await turn();
 assert.equal(calls,1);assert.equal(max,1);gate.resolve();await ready;await h.tick();assert.equal(calls,2);assert.equal(max,1);
});

for(const outcome of ['resolve','reject'])test('closing during pending snapshot discards later '+outcome,async t=>{
 const gate=deferred();let calls=0;const h=harness(t,async()=>{calls++;return gate.promise;});
 const {response,ready}=h.open();response.destroy();await turn();cleaned(h,response);
 if(outcome==='resolve')gate.resolve({revision:1});else gate.reject(Error('fixture snapshot failure after close'));
 await assert.doesNotReject(ready);assert.equal(response.frames.length,0);await h.tick(3);assert.equal(calls,1);
});

test('snapshot errors produce one backpressured problem frame; drain can recover',async t=>{
 let broken=true,calls=0;const h=harness(t,async()=>{calls++;if(broken)throw Error('fixture snapshot failure');return {revision:77};});
 const {response,ready}=h.open({slow:true});await ready;assert.match(response.frames[0],/^event: problem\n/);
 const bytes=response.writableLength;await h.tick(8);assert.equal(calls,1);assert.equal(response.writableLength,bytes);
 broken=false;response.drainOne();await turn();assert.equal(calls,2);assert.equal(stateFrame(response).revision,77);
 await h.tick(3);assert.equal(calls,2);
});

test('serialization failure follows the same bounded problem-frame path',async t=>{
 let calls=0;const circular={};circular.self=circular;
 const h=harness(t,async()=>{calls++;return circular;}),{response,ready}=h.open({slow:true});await ready;
 assert.match(response.frames[0],/^event: problem\n/);await h.tick(5);assert.equal(calls,1);assert.equal(response.frames.length,1);
});

test('synchronous write failure closes cleanly without rejecting the request',async t=>{
 let calls=0;const h=harness(t,async()=>({revision:++calls})),{response,ready}=h.open({throwWrite:true});
 await assert.doesNotReject(ready);await turn();assert.ok(response.destroyed);cleaned(h,response);
 await h.tick(3);assert.equal(calls,1);
});

test('write failure after a snapshot error also cannot leak an async rejection',async t=>{
 let calls=0;const h=harness(t,async()=>{calls++;throw Error('fixture snapshot failure');}),{response,ready}=h.open({throwWrite:true});
 await assert.doesNotReject(ready);await turn();cleaned(h,response);await h.tick(2);assert.equal(calls,1);
});

test('response error detaches handlers and stops the timer',async t=>{
 let calls=0;const h=harness(t,async()=>({revision:++calls})),{response,ready}=h.open();await ready;
 assert.doesNotThrow(()=>response.emit('error',Error('synthetic transport error')));await turn();cleaned(h,response);
 await h.tick(2);assert.equal(calls,1);response.destroy();await turn();
});

test('native async write error stops production without writing a problem frame',async t=>{
 let calls=0;const h=harness(t,async()=>({revision:++calls})),{response,ready}=h.open({asyncError:true});await ready;
 await turn();await turn();cleaned(h,response);assert.ok(response.destroyed);await h.tick(4);
 assert.equal(calls,1);assert.equal(response.frames.length,1);assert.match(response.frames[0],/^event: state\n/);
});

test('closeStreams does not force-destroy a normal drained response',async t=>{
 const h=harness(t,async()=>({revision:1})),{response,ready}=h.open();await ready;
 h.closeAll();cleaned(h,response);assert.equal(response.destroyed,false);await turn();assert.equal(response.writableFinished,true);
});

test('closeStreams immediately stops a blocked response and is idempotent',async t=>{
 let calls=0;const h=harness(t,async()=>({revision:++calls})),{response,ready}=h.open({slow:true});await ready;
 h.closeAll();h.closeAll();cleaned(h,response);await turn();assert.ok(response.destroyed||response.writableFinished);
 response.emit('close');response.emit('finish');response.emit('drain');await h.tick(3);assert.equal(calls,1);
});

test('closeStreams finishes a stalled small write even when write returned true',async t=>{
 let calls=0;const h=harness(t,async()=>({revision:++calls}));
 const {response,ready}=h.open({slow:true,highWaterMark:1024*1024});await ready;
 assert.deepEqual(response.accepted,[true]);assert.ok(response.writableLength>0);assert.equal(response.writableNeedDrain,false);
 h.closeAll();cleaned(h,response);await turn();assert.ok(response.destroyed||response.writableFinished,'shutdown must not wait forever on a sub-threshold write');
 h.closeAll();await h.tick(3);assert.equal(calls,1);
});

test('closeStreams while snapshot is pending prevents a later write',async t=>{
 const gate=deferred();let calls=0;const h=harness(t,async()=>{calls++;return gate.promise;}),{response,ready}=h.open();
 h.closeAll();cleaned(h,response);gate.resolve({revision:99});await ready;await turn();await h.tick(2);
 assert.equal(response.frames.length,0);assert.equal(calls,1);
});

test('slow and fast clients remain independent; closing one leaves the other running',async t=>{
 const calls={slow:0,fast:0};const h=harness(t,async batch=>({batch,revision:++calls[batch]}));
 const slow=h.open({slow:true},'slow'),fast=h.open({},'fast');await Promise.all([slow.ready,fast.ready]);
 await h.tick(5);assert.deepEqual(calls,{slow:1,fast:6});assert.equal(h.api.streams.size,2);
 slow.response.destroy();await turn();assert.equal(h.api.streams.size,1);await h.tick(2);assert.deepEqual(calls,{slow:1,fast:8});
 h.closeAll();await turn();assert.equal(h.api.streams.size,0);assert.equal(fast.response.listenerCount('drain'),0);
});
