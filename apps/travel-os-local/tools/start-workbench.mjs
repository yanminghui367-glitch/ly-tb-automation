import {spawn,execFileSync} from 'node:child_process';
import {mkdirSync,openSync,closeSync,writeFileSync,readFileSync,existsSync} from 'node:fs';
import {networkInterfaces} from 'node:os';
import {createServer} from 'node:net';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';

const root=fileURLToPath(new URL('../',import.meta.url)),base='http://127.0.0.1:4318',noOpen=process.argv.includes('--no-open');
const logs=join(root,'.runtime','launcher');mkdirSync(logs,{recursive:true});
const configFile=join(logs,'service.json');
const service=existsSync(configFile)?JSON.parse(readFileSync(configFile,'utf8')):{};
if(process.argv.includes('--managed')&&!service.enabled)process.exit(0);
const lanAddress=service.lanInterface?(networkInterfaces()[service.lanInterface]||[]).find(x=>x.family==='IPv4'&&!x.internal)?.address:'';
const open=()=>{if(!noOpen)spawn('explorer.exe',[base+'/'],{windowsHide:true,stdio:'ignore'}).unref();};
async function health(){try{const r=await fetch(base+'/api/v1/health',{signal:AbortSignal.timeout(1500)});if(!r.ok)return null;const x=await r.json();return x.app==='ly-tb-workbench'?x:null;}catch{return null;}}
async function waitReady(child){const deadline=Date.now()+45000;while(Date.now()<deadline){const h=await health();if(h)return h;if(child&&child.exitCode!==null)throw Error('本地服务启动失败，请查看 .runtime/launcher 中的日志。');await delay(250);}throw Error('等待本地服务启动超时，请查看 .runtime/launcher 中的日志。');}
const lock=createServer();
try{
  let h=await health();
  if(!h){
    const owned=await new Promise((resolve,reject)=>{lock.once('error',e=>e.code==='EADDRINUSE'?resolve(false):reject(e));lock.listen(4319,'127.0.0.1',()=>resolve(true));});
    if(!owned)h=await waitReady();
    else{
      h=await health();
      if(!h){
        const occupied=await fetch(base+'/api/status',{signal:AbortSignal.timeout(1500)}).then(()=>true,()=>false);
        if(occupied)throw Error('4318 端口已有旧版本或其他服务。请先在原工作台退出程序，再重新打开。');
        if(Number(process.versions.node.split('.')[0])<24)throw Error('需要安装 Node.js 24 或更新版本。');
        const require=createRequire(new URL('../workbench/package.json',import.meta.url));
        const local=require.resolve('playwright');if(!local.startsWith(join(root,'workbench','node_modules')))throw Error('缺少项目独立依赖，请先完成本机安装。');
        const python=execFileSync('python',['-c','import sys; assert sys.version_info >= (3,10); print(sys.executable)'],{encoding:'utf8',windowsHide:true}).trim();
        const stamp=new Date().toISOString().replaceAll(/[:.]/g,'-'),out=openSync(join(logs,stamp+'.log'),'a'),error=openSync(join(logs,stamp+'.error.log'),'a');
        const child=spawn(process.execPath,[join(root,'workbench','server.mjs')],{cwd:join(root,'workbench'),env:{...process.env,PYTHON:python,WORKBENCH_LAN_ADDRESS:lanAddress||''},detached:true,windowsHide:true,stdio:['ignore',out,error]});
        closeSync(out);closeSync(error);child.unref();h=await waitReady(child);
      }
    }
  }
  open();console.log(JSON.stringify({url:base,pid:h.pid,kernel:h.kernel.ok}));
}catch(e){
  const file=join(logs,'startup-error.txt');writeFileSync(file,'工作台启动未完成\r\n'+e.message+'\r\n');
  if(!noOpen)spawn('notepad.exe',[file],{windowsHide:false,stdio:'ignore'}).unref();console.error(e.message);process.exitCode=1;
}finally{if(lock.listening)lock.close();}
