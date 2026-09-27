import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {globeCatalog} from '../globe-catalog.mjs';
import {cartesian,clusterPoints} from '../globe-layout.js';

test('display gazetteer has 699 unique valid coordinates and retains Kansas City uncertainty',()=>{
 const g=JSON.parse(readFileSync(new URL('../data/globe-coordinates.json',import.meta.url)));
 assert.equal(g.entries.length,699);assert.equal(new Set(g.entries.map(x=>x.id)).size,699);
 assert(!g.entries.some(x=>x.id==='city|美国|堪萨斯城'));
 for(const x of g.entries){assert(Number.isFinite(x.lat)&&Math.abs(x.lat)<=90);assert(Number.isFinite(x.lng)&&Math.abs(x.lng)<=180);assert.match(x.source,/^https:\/\/(www.geonames.org|github.com)/);}
 assert(g.entries.filter(x=>x.inferred).every(x=>/源表第 \d+ 行/.test(x.matchNote)));
});
test('map projection exposes only current catalog destinations and never guesses missing positions',()=>{
 const items=[{key:'tokyo',type:'city',country:'日本',city:'东京',destination:'东京',title:'private'}, {key:'kansas',type:'city',country:'美国',city:'堪萨斯城',destination:'堪萨斯城'}];
 const before=JSON.stringify(items),g=globeCatalog({at:'test',items});
 assert.equal(g.total,2);assert.equal(g.mapped,1);assert.equal(g.unlocated,1);assert.equal(g.items[1].position,null);assert.equal(g.items[0].title,undefined);assert.equal(g.items[0].position.precision,'city');assert.equal(JSON.stringify(items),before);
 assert.deepEqual(globeCatalog({items:[]}).items,[]);
});
test('sphere coordinates map Greenwich, Asia, Americas and poles without mirroring',()=>{
 assert.deepEqual(cartesian(0,0),[1,0,-0]);assert(Math.abs(cartesian(90,0)[1]-1)<1e-10);
 assert(cartesian(35.69,139.69)[2]<0);assert(cartesian(40.71,-74)[2]>0);
 for(const lat of [-90,-60,0,60,90])for(const lng of [-180,-90,0,90,180])assert(Math.abs(Math.hypot(...cartesian(lat,lng))-1)<1e-10);
});
test('zoom clustering conserves every visible item and separates a selected destination',()=>{
 const p=[{key:'a',x:0,y:0},{key:'b',x:15,y:3},{key:'c',x:40,y:2}];
 assert.equal(clusterPoints(p,60).length,1);assert.equal(clusterPoints(p,10).length,3);
 const groups=clusterPoints(p,60,'b');assert.equal(groups.length,2);assert.equal(groups.find(x=>x.item.key==='b').items.length,1);assert.equal(groups.reduce((n,x)=>n+x.items.length,0),3);
});
