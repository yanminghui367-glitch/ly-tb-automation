// Display-only coordinates. No task creation, geocoding requests, or source file mutations.
import {readFileSync} from 'node:fs';
const gazetteer=JSON.parse(readFileSync(new URL('./data/globe-coordinates.json',import.meta.url)));
const points=new Map(gazetteer.entries.map(x=>[x.id,x]));
export function globeCatalog(catalog){
 const items=catalog.items.map(x=>{
  const point=points.get([x.type,x.country,x.city||''].join('|'));
  return {key:x.key,destination:x.destination,country:x.country,type:x.type,rank:x.rank,state:x.state,
   position:point?{lat:point.lat,lng:point.lng,precision:point.precision,source:point.source,note:point.matchNote||'',inferred:!!point.inferred}:null};
 });
 return {at:catalog.at,total:items.length,mapped:items.filter(x=>x.position).length,unlocated:items.filter(x=>!x.position).length,crs:'WGS84',scope:gazetteer.scope,items};
}
