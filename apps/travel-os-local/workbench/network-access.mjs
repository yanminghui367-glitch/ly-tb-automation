import {networkInterfaces} from 'node:os';
import {isIPv4} from 'node:net';

const number = ip => ip.split('.').reduce((n,v)=>(n*256+Number(v))>>>0,0);
const local = ip => ip === '::1' || ip?.replace(/^::ffff:/,'').startsWith('127.');
export function networkAccess({port, address='', interfaces=networkInterfaces()}) {
  const adapter=Object.values(interfaces).flat().find(x=>x?.address===address&&x.family==='IPv4'&&!x.internal);
  if(address&&(!isIPv4(address)||!adapter||!(/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(address))))throw Error('局域网地址必须是本机私有 IPv4 地址');
  const hosts=new Set([`127.0.0.1:${port}`,`localhost:${port}`,...(address?[`${address}:${port}`]:[])]);
  const origins=new Set([...hosts].map(x=>'http://'+x));
  return {
    bind:address?'0.0.0.0':'127.0.0.1',
    allowed(req){
      if(!address)return true;
      const ip=req.socket.remoteAddress?.replace(/^::ffff:/,'');
      if(!local(ip)&&!(isIPv4(ip||'')&&((number(ip)&number(adapter.netmask))===(number(address)&number(adapter.netmask)))))return false;
      return hosts.has(req.headers.host);
    },
    originAllowed(origin){return !origin||origins.has(origin);}
  };
}
