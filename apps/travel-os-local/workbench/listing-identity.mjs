// Pure, conservative identity lookup. This module never opens a browser, reads
// data files, changes a task, or writes a success record.
import assert from 'node:assert/strict';
import {destinationKey,digest} from './source-store.mjs';

export const LOCATION_MATCH_RULE_VERSION='20261008-sourced-chinese-spans-v1';

export const LOCATION_ALIAS_EVIDENCE=Object.freeze({
 source:'output/round700-20261008/platform-mapping.json#locationAliasReview',
 country:'阿拉伯联合酋长国',countryAliases:Object.freeze(['阿联酋']),
 city:'夏尔迦',cityAliases:Object.freeze(['沙迦']),
 verification:'CANDIDATE_ONLY'
});
const serviceStart=/^(?:定制|全境|包车|中文|导游|地陪|自由行|一日游|旅行|商务|接送|司导|地接|旅游|服务|会展|展会|翻译|考察|出行|陪同|租车)/;
const clean=value=>typeof value==='string'?value.trim():'';
const sourced=value=>typeof value==='string'?!!value.trim():Array.isArray(value)&&value.some(sourced);
const chinese=value=>typeof value==='string'&&/^[\u3400-\u9fff·]+$/.test(value);
const hasLocationSource=e=>/^[a-f\d]{64}$/i.test(e.locationSource.sourceSHA256||'');
const occurrences=(title,text)=>{const spans=[];for(let start=title.indexOf(text);start>=0;start=title.indexOf(text,start+1))spans.push({text,start,end:start+text.length});return spans;};
const countryNames=country=>country===LOCATION_ALIAS_EVIDENCE.country?[country,...LOCATION_ALIAS_EVIDENCE.countryAliases]:[country];
function cityNames(listing){
 const names=[{text:listing.city,evidence:'LITERAL'}];
 if(/市$/.test(listing.city)&&listing.city.length>2)names.push({text:listing.city.replace(/(?:广域)?市$/,''),evidence:'CITY_SUFFIX_ALIAS'});
 if(listing.country===LOCATION_ALIAS_EVIDENCE.country&&listing.city===LOCATION_ALIAS_EVIDENCE.city)for(const text of LOCATION_ALIAS_EVIDENCE.cityAliases)names.push({text,evidence:'REVIEWED_TRANSLITERATION_CANDIDATE',source:LOCATION_ALIAS_EVIDENCE.source});
 return names.filter(n=>n.text);
}
function indexTasks(tasks,titleAliases=[]){
 assert(Array.isArray(tasks)&&tasks.length,'FIXED_TASK_SCOPE_REQUIRED');
 const entries=tasks.map(task=>{
  const l=task.listing;
  assert(task.shopId&&['country','city'].includes(l?.type)&&clean(l.country)&&(l.type!=='city'||clean(l.city)),'INVALID_LOCATION_IDENTITY');
  const key=destinationKey(task);
  return {key,task,listing:l,countries:countryNames(l.country),cities:l.type==='city'?cityNames(l):[],
   locationSource:{key,taskHash:digest(task),sourceSHA256:task.source?.sha256||null,source:'FIXED_TASK_LOCATION'}};
 });
 assert(new Set(entries.map(e=>e.task.shopId)).size===1,'MIXED_SHOP_SCOPE');
 assert(new Set(entries.map(e=>e.key)).size===entries.length,'DUPLICATE_FIXED_IDENTITY');
 const byKey=new Map(entries.map(e=>[e.key,e])),titles=new Map();
 const add=(key,title,source)=>{
  title=clean(title);if(!title||!byKey.has(key)||!sourced(source))return;
  let matches=titles.get(title);if(!matches){matches=new Map();titles.set(title,matches);}
  let sources=matches.get(key);if(!sources){sources=[];matches.set(key,sources);}sources.push(source);
 };
 for(const e of entries){
  const t=e.task;add(e.key,t.listing.title,'CURRENT_FROZEN_TITLE');
  // An arbitrary unproven title string is not an identity alias. Imported
  // source provenance or the preserved alternate-title source is required.
  const source=t.listing.alternateTitleSource?.sha256||t.source?.sha256;
  if(source)for(const title of t.listing.titleVersions||[])add(e.key,title,'TASK_TITLE_VERSION:'+source);
 }
 for(const alias of titleAliases)add(alias.key,alias.title,alias.sources||alias.source);
 const countries=new Map();
 for(const e of entries)for(const text of e.countries){
  if(!chinese(text))continue;
  const key=e.listing.country+'\0'+text,prior=countries.get(key);
  if(!prior||!hasLocationSource(prior.entry)&&hasLocationSource(e))countries.set(key,{text,country:e.listing.country,entry:e});
 }
 return {entries,byKey,titles,locationCountries:[...countries.values()],locationCities:entries.filter(e=>e.listing.type==='city'&&chinese(e.listing.city)&&hasLocationSource(e))};
}
function rawMatches(row,index){
 const title=clean(row.title),exact=index.titles.get(title),associations=[];
 if(exact){
  for(const [key,sources] of exact)associations.push({key,evidence:'EXACT_SOURCED_TITLE',sources,ambiguous:exact.size!==1});
  return associations;
 }
 // Country/city names are merely review candidates. Keep longer-name and
 // same-city/cross-country ambiguity instead of silently picking one key.
 const cityHits=[];
 for(const e of index.entries){
  if(e.listing.type!=='city')continue;
  const city=e.cities.find(n=>title.includes(n.text));if(!city)continue;
  const country=e.countries.find(n=>title.includes(n));
  const direct=country&&(title.startsWith(country+city.text)||title.startsWith(city.text+country));
  cityHits.push({key:e.key,country:e.listing.country,city:e.listing.city,matchedCity:city.text,matchedCountry:country||null,
   evidence:city.evidence==='LITERAL'?(direct?'GEOGRAPHIC_PREFIX_BOTH':country?'GEOGRAPHIC_BOTH':'CITY_ONLY'):city.evidence,
   ...(city.source?{source:city.source}:{}),ambiguous:!country||!direct});
 }
 for(const hit of cityHits){
  const collides=cityHits.filter(other=>other.key!==hit.key&&(other.matchedCity===hit.matchedCity||other.matchedCity.includes(hit.matchedCity)||hit.matchedCity.includes(other.matchedCity)));
  if(collides.length){hit.ambiguous=true;hit.ambiguousWith=collides.map(x=>x.key);}
  associations.push(hit);
 }
 for(const e of index.entries){
  if(e.listing.type!=='country')continue;
  const country=e.countries.find(n=>title.includes(n));if(!country)continue;
  // A row visibly led by this country's city is not a country-level listing.
  const associatedCity=cityHits.some(c=>c.country===e.listing.country&&c.matchedCountry&&c.matchedCity!==country);
  if(associatedCity)continue;
  const prefix=title.startsWith(country),tail=prefix?title.slice(country.length).replace(/^[\s·・,，/\-]+/,''):'';
  associations.push({key:e.key,country:e.listing.country,city:null,matchedCountry:country,evidence:prefix&&serviceStart.test(tail)?'COUNTRY_PREFIX_SERVICE':'COUNTRY_SCOPE_UNCERTAIN',ambiguous:true});
 }
 return associations;
}

// Only source-backed Chinese names in an explicit single-country prefix are
// eligible. English/unknown names, same-country scope and multi-place wording
// retain the old candidate behavior. These exclusions remove edges, never rows.
function lexicalContext(title,index){
 if(/跨国|跨境|多国|多地|全球|联程|途经|环游|(?:以及|及|与|和|、|\/|／)/.test(title))return null;
 const countries=index.locationCountries.flatMap(c=>occurrences(title,c.text).map(span=>({...span,type:'country',country:c.country,entry:c.entry})));
 const cities=[];
 for(const e of index.locationCities)for(const countryText of e.countries){
  const text=e.listing.city,prefix=countryText+text;
  if(!chinese(countryText)||!title.startsWith(prefix)||!serviceStart.test(title.slice(prefix.length)))continue;
  cities.push({text,start:countryText.length,end:prefix.length,type:'city',country:e.listing.country,city:text,entry:e,
   countrySpan:{text:countryText,start:0,end:countryText.length}});
 }
 const covers=(long,short)=>long.start<=short.start&&long.end>=short.end;
 const independent=countries.filter(c=>!countries.some(other=>other.text.length>c.text.length&&covers(other,c))&&!cities.some(city=>city.country!==c.country&&covers(city,c)));
 const primary=independent.filter(c=>c.start===0&&hasLocationSource(c.entry));
 if(!primary.length||new Set(independent.map(c=>c.country)).size!==1)return null;
 return {country:primary[0].country,countries,cities};
}
function lexicalExclusion(row,association,index,context){
 const e=index.byKey.get(association.key),title=clean(row.title);
 if(!context||!hasLocationSource(e)||e.listing.country===context.country)return null;
 const names=e.listing.type==='city'?e.cities.map(n=>n.text):e.countries;
 if(!names.every(chinese))return null;
 const hits=[...new Map(names.flatMap(text=>occurrences(title,text)).map(span=>[`${span.start}:${span.end}`,span])).values()];
 if(!hits.length)return null;
 const matches=[];
 for(const hit of hits){
  let cover,rule;
  if(e.listing.type==='country'){
   cover=context.countries.find(c=>c.country===context.country&&hasLocationSource(c.entry)&&c.text.length>hit.text.length&&c.start<=hit.start&&c.end>=hit.end);
   if(cover)rule='COUNTRY_IN_LONGER_COUNTRY';
   else {cover=context.cities.find(c=>c.country===context.country&&c.start<=hit.start&&c.end>=hit.end);rule='COUNTRY_IN_FOREIGN_CITY';}
  }else{
   cover=context.cities.find(c=>c.country===context.country&&c.text.length>hit.text.length&&c.start<=hit.start&&c.end>=hit.end);rule='CITY_IN_FOREIGN_LONGER_CITY';
  }
  if(!cover)return null; // An independent second occurrence keeps the candidate.
  matches.push({cover,rule});
 }
 if(new Set(matches.map(m=>m.rule)).size!==1)return null;
 const proof=c=>({text:c.text,start:c.start,end:c.end,type:c.type,country:c.country,...(c.city?{city:c.city,countrySpan:c.countrySpan}:{}),...c.entry.locationSource});
 return {itemId:String(row.itemId||''),title,key:e.key,ruleVersion:LOCATION_MATCH_RULE_VERSION,rule:matches[0].rule,
  target:e.locationSource,occurrences:hits,covers:matches.map(m=>proof(m.cover)),verification:'LEXICAL_EXCLUSION_ONLY'};
}
function matchRow(row,index){
 const raw=rawMatches(row,index),matches=[],exclusions=[];
 if(raw.some(m=>m.evidence==='EXACT_SOURCED_TITLE'))return {matches:raw,exclusions};
 const context=lexicalContext(clean(row.title),index);
 for(const association of raw){const exclusion=lexicalExclusion(row,association,index,context);if(exclusion)exclusions.push(exclusion);else matches.push(association);}
 return {matches,exclusions};
}
const candidate=(row,association)=>({itemId:String(row.itemId||''),title:clean(row.title),...association,verification:'CANDIDATE_ONLY'});

export function classifyListingIdentity({task,tasks,rows,titleAliases=[]}){
 const index=indexTasks(tasks,titleAliases),key=destinationKey(task);
 assert(index.byKey.has(key),'TASK_OUTSIDE_FIXED_SCOPE');
 assert(Array.isArray(rows),'PLATFORM_ROWS_REQUIRED');
 const candidates=[],exclusions=[];
 for(const row of rows){const classified=matchRow(row,index);for(const association of classified.matches)if(association.key===key)candidates.push(candidate(row,association));exclusions.push(...classified.exclusions.filter(x=>x.key===key));}
 const ids=[...new Set(candidates.map(c=>c.itemId))],exact=candidates.filter(c=>c.evidence==='EXACT_SOURCED_TITLE'&&!c.ambiguous&&/^\d+$/.test(c.itemId));
 const rowIdentityConflict=rows.some((row,i)=>rows.some((other,j)=>j<i&&String(row.itemId)===String(other.itemId)));
 const reliable=ids.length===1&&exact.length>0&&!rowIdentityConflict;
 return {status:reliable?'matched':candidates.length?'candidates':'absent',key,
  match:reliable?{...exact[0],verification:'EXACT_LOCAL_IDENTITY_REQUIRES_FRESH_PLATFORM_CHECK'}:null,candidates,exclusions,ruleVersion:LOCATION_MATCH_RULE_VERSION,
  reasons:[...(ids.length>1?['MULTIPLE_PLATFORM_IDS_FOR_DESTINATION']:[]),...(candidates.some(c=>c.ambiguous)?['AMBIGUOUS_LOCATION_OR_SCOPE']:[]),...(rowIdentityConflict?['CONFLICTING_PLATFORM_ROWS']:[]),...(!candidates.length?['NO_MATCH_IN_SUPPLIED_ROWS_AND_LOCAL_ALIASES']:[])],
  absenceProven:false,requiresFreshPlatformCheck:true};
}

export function auditInventoryIdentity(tasks,rows,{titleAliases=[],outOfScopeRows=[]}={}){
 const index=indexTasks(tasks,titleAliases);assert(Array.isArray(rows),'PLATFORM_ROWS_REQUIRED');
 const duplicateIds=[...new Set(rows.map(r=>String(r.itemId)))].filter(id=>rows.filter(r=>String(r.itemId)===id).length>1);
 const classified=rows.map(row=>{
  const {matches,exclusions}=matchRow(row,index),outside=outOfScopeRows.find(o=>o.reviewed===true&&sourced(o.source)&&o.itemId===String(row.itemId)&&clean(o.title)===clean(row.title)&&o.type==='city'&&clean(o.city)&&clean(row.title).includes(o.city)&&!index.entries.some(e=>e.listing.type==='city'&&e.cities.some(c=>c.text===o.city)));
  return {itemId:String(row.itemId||''),title:clean(row.title),keys:matches.map(m=>m.key),matches,exclusions,
   status:matches.length?'ASSIGNED_CANDIDATES':outside?'REVIEWED_OUTSIDE_SCOPE':'UNASSIGNED',...(outside?{outsideScopeEvidence:outside}:{})};
 });
 const unassigned=classified.filter(r=>r.status==='UNASSIGNED'),invalidIds=classified.filter(r=>!/^\d+$/.test(r.itemId));
 return {total:rows.length,uniqueIds:new Set(rows.map(r=>String(r.itemId))).size,assigned:classified.filter(r=>r.status==='ASSIGNED_CANDIDATES').length,
  reviewedOutsideScope:classified.filter(r=>r.status==='REVIEWED_OUTSIDE_SCOPE').length,unassigned,duplicateIds,invalidIds,rows:classified,
  coverageComplete:rows.length>0&&!unassigned.length&&!duplicateIds.length&&!invalidIds.length,ruleVersion:LOCATION_MATCH_RULE_VERSION,
  limits:'Coverage assigns candidates; it does not verify publication, business fields, completeness of the supplied inventory, or authorize publishing an absent task.'};
}
