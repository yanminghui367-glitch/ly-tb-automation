// Pure display math, shared by the browser and isolated tests.
export function cartesian(lat,lng,r=1){const a=lat*Math.PI/180,b=lng*Math.PI/180;return [r*Math.cos(a)*Math.cos(b),r*Math.sin(a),-r*Math.cos(a)*Math.sin(b)];}
export function clusterPoints(points,radius,selected){
 const sorted=[...points].sort((a,b)=>Number(b.key===selected)-Number(a.key===selected)||(a.rank??9999)-(b.rank??9999));
 const clusters=[];
 for(const point of sorted){const cluster=clusters.find(c=>c.item.key!==selected&&point.key!==selected&&Math.hypot(c.x-point.x,c.y-point.y)<radius);
  if(cluster)cluster.items.push(point);else clusters.push({x:point.x,y:point.y,item:point,items:[point]});}
 return clusters;
}
