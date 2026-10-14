import test from 'node:test';
import assert from 'node:assert/strict';
import {destinationKey} from '../source-store.mjs';
import {classifyListingIdentity,auditInventoryIdentity,LOCATION_ALIAS_EVIDENCE} from '../listing-identity.mjs';

const task=(country,city=null,title)=>({shopId:'test-shop',source:{sha256:'fixture-source-hash'},listing:{type:city?'city':'country',country,city,title:title||`${city||country}当前已冻结标题`,titleVersions:[]}});
const row=(itemId,title)=>({itemId,title});
const check=(target,tasks,rows,extra={})=>classifyListingIdentity({task:target,tasks,rows,...extra});

test('unique exact frozen identity is a match but still requires fresh platform verification',()=>{
 const tokyo=task('日本','东京');const result=check(tokyo,[tokyo],[row('123',tokyo.listing.title)]);
 assert.equal(result.status,'matched');assert.equal(result.match.itemId,'123');assert.equal(result.requiresFreshPlatformCheck,true);assert.equal(result.absenceProven,false);
});
test('known imported title versions and explicit sourced aliases are exact identity evidence',()=>{
 const uk=task('英国');uk.listing.titleVersions=['英国已有备用标题'];
 assert.equal(check(uk,[uk],[row('1','英国已有备用标题')]).status,'matched');
 const alias={key:destinationKey(uk),title:'英国可追溯历史标题',source:'fixture-original-package.json'};
 assert.equal(check(uk,[uk],[row('2',alias.title)],{titleAliases:[alias]}).status,'matched');
 const noSource=structuredClone(uk);delete noSource.source;
 assert.notEqual(check(noSource,[noSource],[row('1','英国已有备用标题')]).status,'matched');
 assert.notEqual(check(uk,[uk],[row('2',alias.title)],{titleAliases:[{...alias,source:''}]}).status,'matched');
});
test('country and city geographic prefixes in either order remain candidates, never automatic success',()=>{
 const tokyo=task('日本','东京');
 for(const title of ['日本东京包车地陪服务','东京日本定制行程服务']){
  const r=check(tokyo,[tokyo],[row('1',title)]);assert.equal(r.status,'candidates');assert.equal(r.candidates[0].evidence,'GEOGRAPHIC_PREFIX_BOTH');assert.equal(r.match,null);
 }
});
test('country tasks cannot claim that country city listing as the country product',()=>{
 const jp=task('日本'),tokyo=task('日本','东京');
 const rows=[row('1','日本东京包车地陪服务')];
 assert.equal(check(jp,[jp,tokyo],rows).status,'absent');assert.equal(check(tokyo,[jp,tokyo],rows).status,'candidates');
 assert.equal(check(jp,[jp,tokyo],[row('2','日本全境包车服务')]).status,'candidates');
});
test('same spelling country and city stays ambiguous when title does not establish scope',()=>{
 const country=task('新加坡'),city=task('新加坡','新加坡');
 for(const t of [country,city])assert.equal(check(t,[country,city],[row('1','新加坡包车服务')]).status,'candidates');
});
test('same city name in two countries and omitted country are not silently assigned',()=>{
 const guyana=task('圭亚那','乔治城'),malaysia=task('马来西亚','乔治城'),rows=[row('1','乔治城中文导游服务')];
 for(const t of [guyana,malaysia]){
  const r=check(t,[guyana,malaysia],rows);assert.equal(r.status,'candidates');assert.equal(r.candidates[0].ambiguous,true);assert.equal(r.candidates[0].ambiguousWith.length,1);
 }
});
test('shorter place substrings do not become reliable matches to longer places',()=>{
 const vienna=task('奥地利','维也纳'),neustadt=task('奥地利','维也纳新城');
 for(const t of [vienna,neustadt]){const r=check(t,[vienna,neustadt],[row('1','奥地利维也纳新城包车服务')]);assert.equal(r.status,'candidates');assert.equal(r.candidates[0].ambiguous,true);}
 const york=task('英国','York'),newYork=task('美国','New York');
 for(const t of [york,newYork])assert.equal(check(t,[york,newYork],[row('2','美国New York包车服务')]).status,'candidates');
});
test('one exact title for two destination keys or one destination with two IDs must be isolated',()=>{
 const a=task('圭亚那','乔治城','乔治城相同冻结标题'),b=task('马来西亚','乔治城','乔治城相同冻结标题');
 assert.equal(check(a,[a,b],[row('1',a.listing.title)]).status,'candidates');
 const solo=task('法国');const r=check(solo,[solo],[row('1',solo.listing.title),row('2',solo.listing.title)]);
 assert.equal(r.status,'candidates');assert(r.reasons.includes('MULTIPLE_PLATFORM_IDS_FOR_DESTINATION'));
});
test('known transliteration and derived city suffix aliases are candidates with their evidence retained',()=>{
 const sharjah=task('阿拉伯联合酋长国','夏尔迦'),r=check(sharjah,[sharjah],[row('1','阿联酋沙迦包车服务')]);
 assert.equal(r.status,'candidates');assert.equal(r.candidates[0].source,LOCATION_ALIAS_EVIDENCE.source);
 const fukuoka=task('日本','福冈市');assert.equal(check(fukuoka,[fukuoka],[row('2','日本福冈包车服务')]).candidates[0].evidence,'CITY_SUFFIX_ALIAS');
});
test('unseen wording yields absent evidence, not a permission to publish',()=>{
 const t=task('日本','东京'),r=check(t,[t],[row('1','无法识别的其他商品')]);
 assert.equal(r.status,'absent');assert.equal(r.absenceProven,false);assert.equal(r.requiresFreshPlatformCheck,true);
 assert.equal(auditInventoryIdentity([t],[row('1','无法识别的其他商品')]).coverageComplete,false);
});
test('inventory audit requires valid IDs and accounts for every provided row',()=>{
 const t=task('日本','东京');
 assert.equal(auditInventoryIdentity([t],[row('1',t.listing.title)]).coverageComplete,true);
 assert.equal(auditInventoryIdentity([t],[]).coverageComplete,false);
 assert.equal(auditInventoryIdentity([t],[row('',t.listing.title)]).coverageComplete,false);
 const duplicates=[row('1',t.listing.title),row('1',t.listing.title)];
 assert.equal(auditInventoryIdentity([t],duplicates).coverageComplete,false);assert.equal(check(t,[t],duplicates).status,'candidates');
});
test('outside-scope review is pinned to exact ID/title/source and a city absent from the fixed scope',()=>{
 const t=task('澳大利亚','悉尼'),r=row('8','澳大利黄金海岸自由行服务');
 const evidence={itemId:'8',title:r.title,type:'city',city:'黄金海岸',reviewed:true,source:'fixture-heat-row-8577-and-scope-review'};
 const result=auditInventoryIdentity([t],[r],{outOfScopeRows:[evidence]});assert.equal(result.coverageComplete,true);assert.equal(result.reviewedOutsideScope,1);
 for(const patch of [{itemId:'9'},{title:'changed'},{source:''},{reviewed:false},{city:'悉尼'},{city:'班吉'}])assert.equal(auditInventoryIdentity([t],[r],{outOfScopeRows:[{...evidence,...patch}]}).coverageComplete,false);
});
test('mixed-shop, duplicate-key and out-of-scope task inputs are rejected without mutations',()=>{
 const a=task('日本','东京'),b=task('日本','大阪'),before=JSON.stringify(a);
 assert.throws(()=>check(a,[a,{...b,shopId:'other-shop'}],[]),/MIXED_SHOP_SCOPE/);
 assert.throws(()=>check(a,[a,a],[]),/DUPLICATE_FIXED_IDENTITY/);
 assert.throws(()=>check(b,[a],[]),/TASK_OUTSIDE_FIXED_SCOPE/);
 check(a,[a],[row('1','日本东京包车服务')]);assert.equal(JSON.stringify(a),before);
});
