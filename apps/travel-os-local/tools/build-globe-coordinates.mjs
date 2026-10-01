// Offline display-only gazetteer builder. Never writes spreadsheets, tasks or listing state.
// Inputs are public GeoNames cities15000 and mledoze/countries snapshots.
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(new URL('../workbench/package.json',import.meta.url));
const simplify=require('opencc-js').Converter({from:'tw',to:'cn'});
const dir='output/globe-20260923/';
const locations=JSON.parse(readFileSync(dir+'locations.json'));
const countries=JSON.parse(readFileSync(dir+'countries-mledoze.json'));
const names=new Intl.DisplayNames(['zh-CN'],{type:'region'});
const overrides={'刚果（金）':'CD','刚果（布）':'CG','阿拉伯联合酋长国':'AE','马恩岛':'IM','福克兰群岛':'FK','斯威士兰':'SZ','荷属圣马丁':'SX','圣皮埃尔和密克隆群岛':'PM'};
const countryByName=new Map();
for(const c of countries)for(const name of [names.of(c.cca2),c.translations?.zho?.common,c.translations?.zho?.official])if(name)countryByName.set(name,c);
for(const [name,code]of Object.entries(overrides))countryByName.set(name,countries.find(c=>c.cca2===code));
const normalize=s=>simplify(s.normalize('NFKC')).normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().replace(/[市\s·・-]/gu,'');
const cities=readFileSync(dir+'geonames/cities15000.txt','utf8').trim().split('\n').map(line=>{const p=line.split('\t');return {id:p[0],name:p[1],names:[p[1],p[2],...p[3].split(',')].map(normalize),lat:+p[4],lng:+p[5],code:p[8],population:+p[14]};});
const aliases=existsSync('workbench/data/globe-aliases.json')?JSON.parse(readFileSync('workbench/data/globe-aliases.json')):{};
const heat=new Map(JSON.parse(readFileSync(dir+'heat-rows.json')).map(row=>{const i=Object.keys(row)[0]?.slice(1);return [+i,{english:row['H'+i],airport:row['J'+i],row:+i}];}));
const airports=JSON.parse(readFileSync(dir+'airports.json'));
const airportAliases={'Portland International Jetport':'PWM','Mineta San Jose International Airport':'SJC','Sioux Gateway Airport / Brigadier General Bud Day Field':'SUX','Portsmouth International Airport at Pease':'PSM','Huntsville International Airport':'HSV'};
const km=(a,b)=>{const r=Math.PI/180,dl=(b.lat-a.lat)*r,dn=(b.lng-a.lng)*r;return 12742*Math.asin(Math.sqrt(Math.sin(dl/2)**2+Math.cos(a.lat*r)*Math.cos(b.lat*r)*Math.sin(dn/2)**2));};
const entries=[],missing=[];
for(const x of locations){
 const c=countryByName.get(x.country),id=[x.type,x.country,x.city||''].join('|');
 if(!c){missing.push({id,reason:'country'});continue;}
 if(x.type==='country'){entries.push({id,lat:c.latlng[0],lng:c.latlng[1],precision:'country',source:'https://github.com/mledoze/countries',sourceId:c.cca2});continue;}
 const alias=aliases[id],source=heat.get(x.heatRow);let matches=cities.filter(g=>g.code===c.cca2&&(alias?.geonameId?g.id===String(alias.geonameId):g.names.includes(normalize(x.city))));
 if(matches.length>1&&source?.english){const exact=matches.filter(g=>normalize(g.name)===normalize(source.english));if(exact.length)matches=exact;}
 let inference;
 if(matches.length>1&&source?.airport){
  const airport=airports.find(a=>airportAliases[source.airport]?a.iata===airportAliases[source.airport]:normalize(a.name)===normalize(source.airport));
  if(airport){const near=matches.map(g=>({...g,distance:km(g,airport)})).sort((a,b)=>a.distance-b.distance);if(near[0].distance<200&&near[1].distance-near[0].distance>50){matches=[near[0]];inference=`同名地点按源表第 ${source.row} 行英文名及服务机场 ${source.airport} 消歧，距机场 ${Math.round(near[0].distance)} km；仅导航推断`;}}
 }
 if(matches.length!==1){missing.push({id,reason:matches.length?'ambiguous':'unmatched',source,candidates:matches.map(g=>({id:g.id,name:g.name,lat:g.lat,lng:g.lng,population:g.population}))});continue;}
 const g=matches[0];entries.push({id,lat:g.lat,lng:g.lng,precision:'city',source:'https://www.geonames.org/'+g.id,sourceId:g.id,...(alias?{matchNote:alias.note}:inference?{matchNote:inference,inferred:true}:{})});
}
mkdirSync('workbench/data',{recursive:true});
writeFileSync('workbench/data/globe-coordinates.json',JSON.stringify({version:1,at:new Date().toISOString(),crs:'WGS84',scope:'城市中心点和国家示意位置，仅用于资料导航，不代表服务地址或供给范围',entries},null,2));
writeFileSync(dir+'coordinate-gaps.json',JSON.stringify(missing,null,2));
console.log(JSON.stringify({total:locations.length,mapped:entries.length,missing},null,2));
