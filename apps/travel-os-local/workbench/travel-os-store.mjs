import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
export const problem=(message,statusCode=409)=>Object.assign(new Error(message),{statusCode});
const text=(v,max=200)=>String(v??'').trim().slice(0,max);
export const geoKey=d=>JSON.stringify([d.type,d.country,d.city||'']);
export class TravelOsStore {
 constructor(file){if(file!==':memory:')mkdirSync(dirname(file),{recursive:true});this.db=new DatabaseSync(file);this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
 CREATE TABLE IF NOT EXISTS quotes(id TEXT PRIMARY KEY, destination TEXT NOT NULL, kind TEXT NOT NULL, payload TEXT NOT NULL, at TEXT NOT NULL, archived INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE IF NOT EXISTS preparations(id TEXT PRIMARY KEY, product TEXT NOT NULL, shop TEXT NOT NULL, state TEXT NOT NULL, payload TEXT NOT NULL, at TEXT NOT NULL);
 CREATE UNIQUE INDEX IF NOT EXISTS preparation_open ON preparations(product,shop) WHERE state='PREPARING';
 CREATE TABLE IF NOT EXISTS removed_shops(id TEXT PRIMARY KEY, at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS os_requests(id TEXT PRIMARY KEY, operation TEXT NOT NULL, fingerprint TEXT NOT NULL, result TEXT NOT NULL);
 `);}
 once(input,operation,fn){if(!/^[a-f0-9-]{36}$/i.test(input.requestId||''))throw problem('请求编号缺失，请刷新重试',400);const fingerprint=JSON.stringify({...input,requestId:undefined});const old=this.db.prepare('SELECT * FROM os_requests WHERE id=?').get(input.requestId);if(old){if(old.operation!==operation||old.fingerprint!==fingerprint)throw problem('操作编号已用于其他内容');return JSON.parse(old.result);}this.db.exec('BEGIN IMMEDIATE');try{const result=fn();this.db.prepare('INSERT INTO os_requests VALUES(?,?,?,?)').run(input.requestId,operation,fingerprint,JSON.stringify(result));this.db.exec('COMMIT');return result;}catch(e){this.db.exec('ROLLBACK');throw e;}}
 quotes(destination){const rows=destination?this.db.prepare('SELECT * FROM quotes WHERE destination=? ORDER BY at DESC,rowid DESC').all(destination):this.db.prepare('SELECT * FROM quotes ORDER BY at DESC,rowid DESC').all();return rows.map(r=>({...JSON.parse(r.payload),id:r.id,at:r.at,archived:!!r.archived}));}
 addQuote(input,d){if(!d)throw problem('请选择资料库中已存在的目的地',400);if(!['COST','SALE'].includes(input.kind))throw problem('请选择成本价或销售价',400);
 const amount=Number(input.amount);if(input.amount===''||!Number.isFinite(amount)||amount<=0||amount>1e9||Math.abs(amount*100-Math.round(amount*100))>1e-6)throw problem('金额须大于零，最多两位小数',400);
 const currency=text(input.currency,3).toUpperCase();if(!['CNY','USD','EUR','JPY','GBP','HKD','SGD','THB','AUD','CAD','KRW'].includes(currency))throw problem('币种不受支持',400);
 const service=text(input.service),supplier=text(input.supplier),unit=text(input.unit,50),validUntil=text(input.validUntil,10);
 if(!service||!unit||(input.kind==='COST'&&!supplier))throw problem('请填写服务项目、计价单位；成本价还需供应商',400);
 if(validUntil&&(!/^\d{4}-\d{2}-\d{2}$/.test(validUntil)||!Number.isFinite(Date.parse(validUntil))||new Date(validUntil).toISOString().slice(0,10)!==validUntil))throw problem('有效期日期无效',400);
 const q={destinationKey:geoKey(d),destination:d.destination,country:d.country,city:d.city,type:d.type,kind:input.kind,amount,currency,service,supplier,unit,validUntil,notes:text(input.notes,2000)};
 return this.once(input,'quote.add',()=>{const id=randomUUID(),at=new Date().toISOString();this.db.prepare('INSERT INTO quotes(id,destination,kind,payload,at) VALUES(?,?,?,?,?)').run(id,q.destinationKey,q.kind,JSON.stringify(q),at);return {...q,id,at,archived:false};});}
 archiveQuote(id){if(!this.db.prepare('UPDATE quotes SET archived=1 WHERE id=?').run(id).changes)throw problem('报价不存在',404);return {id,archived:true};}
 preparations(){return this.db.prepare('SELECT * FROM preparations ORDER BY rowid DESC').all().map(r=>({...JSON.parse(r.payload),id:r.id,shopId:r.shop,state:r.state,at:r.at}));}
 prepare(input,d,shop){if(!d||!shop)throw problem('目的地或店铺不存在',404);if(d.state==='VERIFIED'&&d.shopId===shop.id)throw problem('该店铺商品已成功，禁止重复创建');if(d.duplicateBlocked&&d.shopId===shop.id)throw problem('商品已有任务，请从原任务继续');
 return this.once(input,'preparation.add',()=>{const old=this.db.prepare("SELECT id FROM preparations WHERE product=? AND shop=? AND state='PREPARING'").get(d.key,shop.id);if(old)throw problem('已有同商品准备单，请从任务队列继续');const id=randomUUID(),at=new Date().toISOString(),payload={productKey:d.key,destinationKey:geoKey(d),destination:d.destination,country:d.country,city:d.city,title:d.title,source:d.source,notes:text(input.notes,1000)};this.db.prepare('INSERT INTO preparations VALUES(?,?,?,?,?,?)').run(id,d.key,shop.id,'PREPARING',JSON.stringify(payload),at);return {...payload,id,shopId:shop.id,state:'PREPARING',at};});}
 cancelPreparation(id){if(!this.db.prepare("UPDATE preparations SET state='CANCELLED' WHERE id=? AND state='PREPARING'").run(id).changes)throw problem('准备单已处理或不存在');return {id,state:'CANCELLED'};}
 removed(id){return !!this.db.prepare('SELECT 1 FROM removed_shops WHERE id=?').get(id);}
 removeShop(id){this.db.prepare('INSERT OR IGNORE INTO removed_shops VALUES(?,?)').run(id,new Date().toISOString());this.db.prepare("UPDATE preparations SET state='CANCELLED' WHERE shop=? AND state='PREPARING'").run(id);return {id,removed:true};}
 close(){this.db.close();}
}
