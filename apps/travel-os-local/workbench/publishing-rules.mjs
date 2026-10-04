import {randomInt,randomUUID} from 'node:crypto';
import {readFile,readdir,realpath} from 'node:fs/promises';
import {resolve,relative,isAbsolute,sep,basename,extname} from 'node:path';
import {digest} from './source-store.mjs';
import {ATTRIBUTE_FIELDS,NO_BRAND} from './publishing-attributes.mjs';

const fail=message=>{throw Object.assign(new Error(message),{statusCode:409});};
const inside=(root,file)=>{const p=relative(root,file);return p===''||(!isAbsolute(p)&&p!=='..'&&!p.startsWith('..'+sep));};
const image=path=>/\.(png|jpe?g|webp)$/i.test(path);
export const imageMime=path=>({'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp'}[extname(path).toLowerCase()]);
const parsed=row=>row?JSON.parse(row.payload):null;
function uniqueNames(assets){
  const names=new Map();
  for(const a of assets){const name=basename(a.path).toLocaleLowerCase(),hash=names.get(name);if(hash&&hash!==a.sha256)fail('同名图片内容不同：'+basename(a.path)+'；图库按文件名选择，请使用可区分的文件名后重新配置');names.set(name,a.sha256);}
}
export class PublishingRules {
  constructor(source){
    this.source=source;this.db=source.db;this.inflight=new Map();this.materialIndex=new Map();
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS publishing_presets(shop TEXT PRIMARY KEY,payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS publishing_captures(id TEXT PRIMARY KEY,shop TEXT NOT NULL,payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS publishing_drafts(id TEXT PRIMARY KEY,cache_key TEXT UNIQUE NOT NULL,shop TEXT NOT NULL,payload TEXT NOT NULL);
    `);
  }
  preset(shop){return parsed(this.db.prepare('SELECT payload FROM publishing_presets WHERE shop=?').get(shop))||{shopId:shop,enabled:false,revision:0,secondary:{A:[],B:[]},covers:[],fields:[]};}
  summary(shop){const p=this.preset(shop);return {enabled:p.enabled,revision:p.revision,configured:!!p.captureId};}
  capture(shop,fields){
    if(fields.length!==5||new Set(fields.map(f=>f.key)).size!==5)fail('属性读取不完整，请重新检查发布页');
    const result={id:randomUUID(),shopId:shop,at:new Date().toISOString(),fields};
    this.db.prepare('INSERT INTO publishing_captures VALUES(?,?,?)').run(result.id,shop,JSON.stringify(result));return result;
  }
  async materials(root,shop){
    let base;try{base=await realpath(root);}catch{fail('本地图片目录不可用，请先保存正确目录');}
    const key=digest([base,shop]),cached=this.materialIndex.get(key);
    if(cached&&Date.now()-cached.at<30000)return cached.promise;
    const promise=this.scanMaterials(base,shop);
    if(this.materialIndex.size>8)this.materialIndex.clear();
    this.materialIndex.set(key,{at:Date.now(),promise});
    try{return await promise;}catch(e){this.materialIndex.delete(key);throw e;}
  }
  async scanMaterials(base,shop){
    const result=[];
    const walk=async(dir,depth)=>{
      if(depth>5)return;
      for(const item of await readdir(dir,{withFileTypes:true})){
        const path=resolve(dir,item.name);
        // No junction/symlink traversal or credential directories.
        if(item.isSymbolicLink()||item.name.startsWith('.'))continue;
        const physical=await realpath(path);if(!inside(base,physical))continue;
        if(item.isDirectory())await walk(path,depth+1);
        else if(item.isFile()&&image(path)){
          result.push({id:digest([shop,physical]),name:item.name,relative:relative(base,path),path:physical,url:'/api/v1/publishing-image?assetId='+digest([shop,physical])});
          if(result.length>5000)fail('图片超过 5000 张，请配置具体店铺素材目录');
        }
      }
    };
    await walk(base,0);return result.sort((a,b)=>a.relative.localeCompare(b.relative,'zh-CN',{numeric:true}));
  }
  async save(shop,input,root){
    const old=this.preset(shop);
    if(input.revision!==old.revision)fail('规则已在其他页面修改，请重新打开后核对');
    if(input.disable===true){const next={...old,enabled:false,revision:old.revision+1};this.db.prepare('INSERT OR REPLACE INTO publishing_presets VALUES(?,?)').run(shop,JSON.stringify(next));return next;}
    if(input.confirmed!==true)fail('请确认所选图片及属性候选适用于本店商品');
    const capture=parsed(this.db.prepare('SELECT payload FROM publishing_captures WHERE id=? AND shop=?').get(input.captureId,shop));
    if(!capture)fail('请先读取本店发布页属性选项');
    const library=await this.materials(root,shop),byId=new Map(library.map(a=>[a.id,a]));
    const files=async(ids,count,label)=>{
      if(!Array.isArray(ids)||ids.length!==count||new Set(ids).size!==count)fail(label+'数量或顺序未确认');
      return Promise.all(ids.map(async id=>{const a=byId.get(id);if(!a)fail('所选图片已不在当前图片目录中');if(await realpath(a.path)!==a.path)fail('图片位置已变化，请重新配置');const bytes=await readFile(a.path);return {...a,sha256:digest(bytes)};}));
    };
    const secondary={A:await files(input.secondary?.A,4,'副图 A'),B:await files(input.secondary?.B,4,'副图 B')},covers=await files(input.covers,2,'详情首页');
    const selected=[...secondary.A,...secondary.B,...covers],names=new Set(selected.map(a=>basename(a.path).toLocaleLowerCase()));
    const duplicates=await Promise.all(library.filter(a=>names.has(basename(a.path).toLocaleLowerCase())).map(async a=>({...a,sha256:digest(await readFile(a.path))})));
    uniqueNames([...selected,...duplicates]);
    const fields=Object.entries(ATTRIBUTE_FIELDS).map(([key,label])=>{
      const f=capture.fields.find(a=>a.key===key),selected=input.allowed?.[key];
      if(!f||!Array.isArray(selected)||!selected.length||new Set(selected).size!==selected.length)fail('请选择允许随机的属性：'+label);
      const options=selected.map(value=>f.options.find(o=>o.value===value));
      if(options.some(o=>!o))fail('候选值不在读取结果中：'+label);
      return {...f,options};
    });
    // Recheck revision after asynchronous I/O so concurrent edits cannot overwrite.
    if(this.preset(shop).revision!==old.revision)fail('规则已更新，请重新核对');
    const next={shopId:shop,enabled:true,revision:old.revision+1,at:new Date().toISOString(),brand:NO_BRAND,captureId:capture.id,secondary,covers,fields};
    this.db.prepare('INSERT OR REPLACE INTO publishing_presets VALUES(?,?)').run(shop,JSON.stringify(next));return next;
  }
  async checkPreset(p){
    for(const a of [...p.secondary.A,...p.secondary.B,...p.covers]){
      let hash;try{hash=digest(await readFile(a.path));}catch{fail('随机素材缺失：'+a.name+'；请重新配置');}
      if(hash!==a.sha256)fail('随机素材内容已改变：'+a.name+'；请重新配置并确认');
    }
  }
  async prepare(preview,shop,scope='batch'){
    const p=this.preset(shop);if(!p.enabled)return preview;
    if(!preview.tasks.length)return {...preview,randomRules:{enabled:true,revision:p.revision}};
    if(preview.tasks.some(t=>t.shopId!==shop))fail('素材规则与任务店铺不一致');
    const baseHash=digest(preview.tasks),key=digest([shop,scope,preview.importId,baseHash,p.revision]);
    const old=parsed(this.db.prepare('SELECT payload FROM publishing_drafts WHERE cache_key=?').get(key));
    await this.checkPreset(p);
    for(const task of preview.tasks)uniqueNames([...p.secondary.A,...p.secondary.B,...p.covers,...Object.values(task.assets).flat()]);
    if(old)return {...preview,tasks:old.tasks,selectionHash:old.selectionHash,draftId:old.id,randomRules:{enabled:true,revision:p.revision}};
    const tasks=preview.tasks.map(original=>{
      const task=structuredClone(original);if(!task.assets.details.length)fail('详情为空，不能替换首页');
      const group=randomInt(2)?'B':'A',cover=randomInt(2),attributes=p.fields.map(f=>{const o=f.options[randomInt(f.options.length)];return {key:f.key,label:f.label,containerId:f.containerId,kind:f.kind,value:o.value,text:o.text};});
      task.assets.secondary=structuredClone(p.secondary[group]);task.assets.details[0]=structuredClone(p.covers[cover]);task.business.brand=NO_BRAND;
      task.publishVariant={version:1,revision:p.revision,secondaryGroup:group,coverIndex:cover,attributes,captureId:p.captureId,originalTaskHash:digest(original)};
      return task;
    });
    const draft={id:randomUUID(),shopId:shop,scope,revision:p.revision,importId:preview.importId,limit:preview.limit,baseHash,selectionHash:digest(tasks),tasks,at:new Date().toISOString()};
    if(this.preset(shop).revision!==p.revision)fail('规则在生成预览期间变化，请重新预览');
    // Unique cache key decides the winner even for repeated concurrent preview requests.
    this.db.prepare('INSERT OR IGNORE INTO publishing_drafts VALUES(?,?,?,?)').run(draft.id,key,shop,JSON.stringify(draft));
    const saved=parsed(this.db.prepare('SELECT payload FROM publishing_drafts WHERE cache_key=?').get(key));
    return {...preview,tasks:saved.tasks,selectionHash:saved.selectionHash,draftId:saved.id,randomRules:{enabled:true,revision:p.revision}};
  }
  draft(id,shop){const d=parsed(this.db.prepare('SELECT payload FROM publishing_drafts WHERE id=? AND shop=?').get(id,shop));if(!d)fail('随机预览不存在，请重新预览');return d;}
  async create(input,shop,batch,basePreview,scope='batch'){
    const d=this.draft(input.draftId,shop),review=input.review;
    if(d.scope!==scope||d.importId!==input.importId||review?.reviewed!==true||review.selectionHash!==d.selectionHash||!review.authorization)fail('请确认完整随机预览');
    if(!['DRY_RUN','LIVE'].includes(input.mode))fail('执行模式无效');
    // Reconcile a response lost after batch creation; never create another batch.
    const previous=this.db.prepare("SELECT id,mode FROM batches WHERE json_extract(review,'$.publishingDraftId')=?").get(d.id);
    if(previous){if(previous.mode!==input.mode)fail('此预览已用于另一执行模式');return batch.store.batch(previous.id);}
    if(this.inflight.has(d.id)){const running=this.inflight.get(d.id);if(running.mode!==input.mode)fail('此预览正在用于另一执行模式');return running.promise;}
    const operation=(async()=>{
      if(batch.active||batch.flow.active)fail('已有任务执行中');
      const p=this.preset(shop);if(!p.enabled||p.revision!==d.revision)fail('规则已改变，请重新预览');
      if(digest((await basePreview()).tasks)!==d.baseHash)fail('商品清单已变化，请重新预览');
      await this.checkPreset(p);
      if(this.preset(shop).revision!==d.revision||!this.preset(shop).enabled)fail('规则已改变，请重新预览');
      if(digest((await basePreview()).tasks)!==d.baseHash)fail('商品清单已变化，请重新预览');
      return batch.store.create(d.importId,d.tasks,shop,input.mode,{...review,publishingDraftId:d.id,publishingRevision:d.revision});
    })();
    this.inflight.set(d.id,{mode:input.mode,promise:operation});try{return await operation;}finally{this.inflight.delete(d.id);}
  }
  async imageAsset(input,shop,root){
    let asset;
    if(input.draftId){const d=this.draft(input.draftId,shop),t=d.tasks.find(t=>t.priority===Number(input.order));if(!['main','secondary','details'].includes(input.group))fail('图片分组无效');asset=t?.assets[input.group]?.[Number(input.index)];}
    else asset=(await this.materials(root,shop)).find(a=>a.id===input.assetId);
    if(!asset||!image(asset.path))fail('图片不存在');
    if(await realpath(asset.path)!==asset.path)fail('图片位置已变化，请重新核对');
    const bytes=await readFile(asset.path);if(asset.sha256&&digest(bytes)!==asset.sha256)fail('图片内容已改变，请重新核对');
    return {bytes,type:imageMime(asset.path)};
  }
}
