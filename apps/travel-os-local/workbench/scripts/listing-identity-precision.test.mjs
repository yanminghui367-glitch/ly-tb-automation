import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyListingIdentity,auditInventoryIdentity} from '../listing-identity.mjs';
import {destinationKey,digest} from '../source-store.mjs';
const task=(country,city=null,title)=>({shopId:'fixture',source:{sha256:'a'.repeat(64)},listing:{type:city?'city':'country',country,city,title:title||`${city||country}冻结标题`,titleVersions:[]}});
const row=(itemId,title)=>({itemId,title,status:'出售中'});
const check=(target,tasks,rows)=>classifyListingIdentity({task:target,tasks,rows});

test('sourced longer country removes only nested Chinese name and binds exact spans and task evidence',()=>{
 const india=task('印度'),indonesia=task('印度尼西亚'),rows=[row('100001','印度尼西亚巴厘岛包车服务')],before=JSON.stringify({india,indonesia,rows});
 const result=check(india,[india,indonesia],rows);
 assert.equal(result.status,'absent');assert.equal(result.absenceProven,false);assert.equal(result.exclusions.length,1);
 const ex=result.exclusions[0];assert.equal(ex.itemId,'100001');assert.equal(ex.title,rows[0].title);assert.equal(ex.rule,'COUNTRY_IN_LONGER_COUNTRY');
 assert.equal(ex.target.key,destinationKey(india));assert.equal(ex.target.taskHash,digest(india));assert.equal(ex.target.sourceSHA256,india.source.sha256);
 assert.deepEqual(ex.occurrences,[{text:'印度',start:0,end:2}]);assert.equal(ex.covers[0].text,'印度尼西亚');assert.equal(ex.covers[0].start,0);assert.equal(ex.covers[0].end,5);
 assert.equal(ex.covers[0].taskHash,digest(indonesia));assert.equal(ex.covers[0].sourceSHA256,indonesia.source.sha256);assert(result.ruleVersion);
 const audit=auditInventoryIdentity([india,indonesia],rows);assert.equal(audit.coverageComplete,true);assert.equal(audit.total,1);assert.equal(audit.rows[0].title,rows[0].title);assert.equal(audit.rows[0].exclusions.length,1);assert.deepEqual(audit.rows[0].keys,[destinationKey(indonesia)]);
 assert.equal(JSON.stringify({india,indonesia,rows}),before);
 const russia=task('俄罗斯'),belarus=task('白俄罗斯');assert.equal(check(russia,[russia,belarus],[row('100002','白俄罗斯包车服务')]).status,'absent');
});

test('foreign longer city excludes Madrid from Delhi but keeps New Delhi same-country scope',()=>{
 const delhi=task('印度','德里'),madrid=task('西班牙','马德里'),newDelhi=task('印度','新德里');
 const rows=[row('100001','西班牙马德里包车中文司导服务'),row('100002','印度新德里地接包车服务')];
 const result=check(delhi,[delhi,madrid,newDelhi],rows);assert.equal(result.status,'candidates');assert.deepEqual(result.candidates.map(x=>x.itemId),['100002']);assert.equal(result.exclusions.length,1);assert.equal(result.exclusions[0].rule,'CITY_IN_FOREIGN_LONGER_CITY');
 assert.equal(result.exclusions[0].covers[0].country,'西班牙');assert.equal(result.exclusions[0].covers[0].countrySpan.text,'西班牙');assert.equal(result.match,null);
 assert.equal(check(madrid,[delhi,madrid,newDelhi],rows.slice(0,1)).status,'candidates');
});

test('country versus sourced foreign same-name city is excluded, dictionary-external Paramaribo is retained',()=>{
 const salvador=task('萨尔瓦多'),brazil=task('巴西','萨尔瓦多'),rows=[row('100001','巴西萨尔瓦多中文导游定制包车')];
 const result=check(salvador,[salvador,brazil],rows);assert.equal(result.status,'absent');assert.equal(result.exclusions[0].rule,'COUNTRY_IN_FOREIGN_CITY');
 assert.deepEqual(auditInventoryIdentity([salvador,brazil],rows).rows[0].keys,[destinationKey(brazil)]);
 const mali=task('马里'),suriname=task('苏里南');const unknown=check(mali,[mali,suriname],[row('100002','苏里南帕拉马里博全境包车')]);assert.equal(unknown.status,'candidates');assert.deepEqual(unknown.exclusions,[]);
});

test('all occurrences and independent target words are checked, not merely first find',()=>{
 const india=task('印度'),indonesia=task('印度尼西亚');
 for(const title of ['印度尼西亚包车及印度服务','印度尼西亚印度包车','印度包车与印度尼西亚服务']){
  const r=check(india,[india,indonesia],[row('100001',title)]);assert.equal(r.status,'candidates',title);assert.deepEqual(r.exclusions,[]);
 }
 const delhi=task('印度','德里'),madrid=task('西班牙','马德里');
 for(const title of ['西班牙马德里包车及德里服务','西班牙马德里德里包车']){
  const r=check(delhi,[delhi,madrid],[row('100002',title)]);assert.equal(r.status,'candidates',title);assert.deepEqual(r.exclusions,[]);
 }
 const repeated=check(india,[india,indonesia],[row('100003','印度尼西亚包车印度尼西亚服务')]);assert.equal(repeated.status,'absent');assert.equal(repeated.exclusions[0].occurrences.length,2);assert.equal(repeated.exclusions[0].covers.length,2);
 for(const occurrence of repeated.exclusions[0].occurrences)assert.equal(repeated.exclusions[0].title.slice(occurrence.start,occurrence.end),'印度');
 const salvador=task('萨尔瓦多'),brazil=task('巴西','萨尔瓦多');assert.equal(check(salvador,[salvador,brazil],[row('100004','巴西萨尔瓦多中文导游萨尔瓦多全境')]).status,'candidates');
});

test('multi-country scope, unknown wording, English, same-country long names and homonyms remain conservative',()=>{
 const delhi=task('印度','德里'),madrid=task('西班牙','马德里'),france=task('法国');
 for(const title of ['西班牙马德里跨国包车','西班牙马德里包车法国联程','西班牙马德里未知地名包车','马德里包车服务']){
  const r=check(delhi,[delhi,madrid,france],[row('100001',title)]);assert.equal(r.status,'candidates',title);assert.deepEqual(r.exclusions,[]);
 }
 const vienna=task('奥地利','维也纳'),long=task('奥地利','维也纳新城');assert.equal(check(vienna,[vienna,long],[row('100002','奥地利维也纳新城包车')]).status,'candidates');
 const york=task('英国','York'),newYork=task('美国','New York');assert.equal(check(york,[york,newYork],[row('100003','美国New York包车')]).status,'candidates');
 const us=task('美国','伯明翰'),uk=task('英国','伯明翰');assert.equal(check(us,[us,uk],[row('100004','英国伯明翰包车')]).status,'candidates');
});

test('same-city changed title remains a candidate and exact sourced identity always wins',()=>{
 const tokyo=task('日本','东京');const result=check(tokyo,[tokyo],[row('100001','日本东京此前旧标题服务')]);assert.equal(result.status,'candidates');assert.deepEqual(result.exclusions,[]);
 const india=task('印度',null,'印度尼西亚包车既有冻结标题'),indonesia=task('印度尼西亚');const exact=check(india,[india,indonesia],[row('100002',india.listing.title)]);assert.equal(exact.status,'matched');assert.deepEqual(exact.exclusions,[]);
});

test('missing location source hash cannot enable an exclusion and unresolved inventory rows still block coverage',()=>{
 const india=task('印度'),indonesia=task('印度尼西亚');
 for(const sha256 of ['', 'unverified']){const unsupported={...indonesia,source:{sha256}};const r=check(india,[india,unsupported],[row('100001','印度尼西亚包车服务')]);assert.equal(r.status,'candidates');assert.deepEqual(r.exclusions,[]);}
 const audit=auditInventoryIdentity([india,indonesia],[row('100001','印度尼西亚包车服务'),row('100002','无法解释的旧标题')]);assert.equal(audit.total,2);assert.equal(audit.rows.length,2);assert.equal(audit.coverageComplete,false);assert.equal(audit.unassigned[0].itemId,'100002');
 const duplicate=[row('100001','印度尼西亚包车服务'),row('100001','印度尼西亚包车服务')];assert.equal(auditInventoryIdentity([india,indonesia],duplicate).coverageComplete,false);
 assert.equal(auditInventoryIdentity([india,indonesia],[row('invalid-id','印度尼西亚包车服务')]).coverageComplete,false);
 const sourceLessTarget={...india,source:{}};assert.equal(check(sourceLessTarget,[sourceLessTarget,indonesia],[row('100001','印度尼西亚包车服务')]).status,'candidates');
});
