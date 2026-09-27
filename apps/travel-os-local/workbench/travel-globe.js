import * as THREE from './assets/travel-os/vendor/three.module.js';
import {OrbitControls} from './assets/travel-os/vendor/orbit-controls.js';
import {cartesian,clusterPoints} from './globe-layout.js';

// Presentation only. No publisher, task controls, or account state is accessed here.
export async function mountGlobe({host,labels,onSelect,presentation='workspace',visualTest=false}) {
 const $=id=>document.getElementById(id),status=$('globeStatus'),panel=$('mapPanel'),rotate=$('rotateGlobe');
 const homePresentation=presentation==='home';
 const stage=host.parentElement,homeSlot=document.createComment('globe home position');stage.before(homeSlot);host.dataset.presentation=presentation;
 const compositionFrame=homePresentation?document.createElement('div'):null;
 if(compositionFrame){compositionFrame.className='globe-composition-frame';compositionFrame.setAttribute('aria-hidden','true');homeSlot.before(compositionFrame);}
 const cleanup=[],resources=[],buttons=new Map(),motionPreference=matchMedia('(prefers-reduced-motion: reduce)');
 let data,renderer,controls,disposed=false,selected='',frame=0,last=0,dirty=true,moving=null,visible=true,fail=false;
 let immersive=false,returnFocus=null,scrollY=0,inertState=[],width=1,height=1,lastCluster=-Infinity,forceLabels=true;
 let visibleLeft=22,visibleRight=1,foregroundBoxes=[];
 const homeRadius=homePresentation?3.42:3.15;
 let targetRadius=homeRadius,zoomIntent=false,resize=()=>{},clusters=[],drawCount=0,clusterCount=0,denseMarkers=false;
 const reduced=()=>motionPreference.matches;
 const listen=(el,event,fn,opts)=>{el.addEventListener(event,fn,opts);cleanup.push(()=>el.removeEventListener(event,fn,opts));};
 const own=x=>(resources.push(x),x);
 const idleMessage=homePresentation?'拖动旋转 · 滚轮缩放 · 全屏按钮独立探索':'拖动旋转 · 滚轮放大可进入全屏';
 const autoRotate=value=>{if(controls)controls.autoRotate=value;rotate.setAttribute('aria-pressed',String(value));rotate.title=value?'暂停自动旋转':'开启自动旋转';};
 function stopMotion(){moving=null;zoomIntent=false;autoRotate(false);if(controls){const position=camera.position.clone();controls.enableDamping=false;controls.update();controls.enableDamping=true;camera.position.copy(position);}targetRadius=camera.position.length();dirty=true;}
 function closeList(){panel.hidden=true;}
 function showList(items,title){
  panel.replaceChildren();const heading=document.createElement('strong');heading.textContent=title;panel.append(heading);
  const close=document.createElement('button');close.textContent='关闭';close.className='map-close';close.onclick=()=>{closeList();renderer?.domElement.focus({preventScroll:true});};panel.append(close);
  for(const item of items){const b=document.createElement('button');b.className='map-list-item';b.textContent=item.destination+' · '+item.country+(item.position?'':' · 位置待确认');b.onclick=()=>{onSelect(item.key);closeList();renderer?.domElement.focus({preventScroll:true});};panel.append(b);}
  panel.hidden=false;close.focus({preventScroll:true});
 }
 const report=()=>{if(!data)return;if($('mapCoverage'))$('mapCoverage').textContent=data.mapped+' / '+data.total+' 已定位';const pending=$('unlocatedPlaces');if(pending){pending.hidden=!data.unlocated;pending.textContent=data.unlocated+' 条位置待确认';pending.onclick=()=>showList(data.items.filter(x=>!x.position),'位置待确认 · 不使用猜测坐标');}};
 function setImmersive(value,animate=true){
  if(value===immersive||value&&fail)return;
  const previous=stage.getBoundingClientRect();immersive=value;closeList();
  if(value){
   returnFocus=document.activeElement;scrollY=window.scrollY;
   document.body.append(stage);stage.classList.add('is-immersive');stage.setAttribute('role','dialog');stage.setAttribute('aria-modal','true');stage.setAttribute('aria-label','全屏地球探索');
   inertState=[...document.body.children].filter(x=>x!==stage).map(x=>[x,x.inert]);for(const [el]of inertState)el.inert=true;
   document.body.classList.add('globe-immersive');$('exitGlobe').hidden=false;$('expandGlobe').hidden=true;renderer?.domElement.focus({preventScroll:true});
  }else{
   for(const [el,wasInert]of inertState)el.inert=wasInert;inertState=[];
   document.body.classList.remove('globe-immersive');stage.classList.remove('is-immersive');stage.removeAttribute('role');stage.removeAttribute('aria-modal');stage.removeAttribute('aria-label');
   homeSlot.after(stage);$('exitGlobe').hidden=true;$('expandGlobe').hidden=false;
   stopMotion();camera.position.setLength(Math.max(2.7,camera.position.length()));targetRadius=camera.position.length();
   window.scrollTo({top:scrollY,behavior:'instant'});
   const restore=returnFocus?.isConnected&&!returnFocus.closest('[hidden]')?returnFocus:$('expandGlobe');restore?.focus({preventScroll:true});
  }
  host.dataset.immersive=String(value);resize();visible=true;dirty=true;forceLabels=true;
  if(value&&animate&&!reduced())stage.animate([{transform:'translate('+previous.left+'px,'+previous.top+'px) scale('+previous.width/innerWidth+','+previous.height/innerHeight+')'},{transform:'none'}],{duration:420,easing:'cubic-bezier(.16,1,.3,1)'});
 }
 const unavailable=message=>{if(immersive)setImmersive(false,false);fail=true;status.textContent=message;host.dataset.state='unavailable';labels.replaceChildren();if(!data&&$('allMapPlaces'))$('allMapPlaces').disabled=true;for(const id of ['rotateGlobe','zoomInGlobe','zoomOutGlobe','resetGlobe','expandGlobe','toggleMapDensity'])if($(id))$(id).disabled=true;};
 const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(38,1,.01,100);
 const home=new THREE.Vector3(...cartesian(homePresentation?24:18,homePresentation?100:118,homeRadius));camera.position.copy(home);
 function fly(target,duration=800){
  stopMotion();
  // A quaternion follows the shortest great circle even across opposite hemispheres.
  moving={from:camera.position.clone().normalize(),rotation:new THREE.Quaternion().setFromUnitVectors(camera.position.clone().normalize(),target.clone().normalize()),radius:camera.position.length(),toRadius:target.length(),at:performance.now(),duration:reduced()?0:duration};
  targetRadius=target.length();dirty=true;host.dataset.motion='true';
 }
 function focus(key,animate=true){
  selected=key;host.dataset.selected=key;forceLabels=true;dirty=true;stopMotion();
  const item=data?.items.find(x=>x.key===key);
  if(!item?.position){if(item)status.textContent=item.destination+'位置待确认；未在地图上标出。';return;}
  if(!controls)return;
  fly(new THREE.Vector3(...cartesian(item.position.lat,item.position.lng,Math.min(camera.position.length(),2.7))),animate?850:0);
  status.textContent=item.destination+' · '+(item.position.precision==='country'?'国家示意位置':'城市中心点')+(item.position.inferred?' · 同名地点按源机场匹配':'');
 }
 try{const r=await fetch('/api/v1/globe',{signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('位置资料读取失败');data=await r.json();report();}
 catch{unavailable('地图资料未载入，仍可使用右侧搜索。');return {focus(){},dispose(){homeSlot.remove();compositionFrame?.remove();}};}
 if($('allMapPlaces'))$('allMapPlaces').onclick=()=>showList(data.items,'全部 '+data.total+' 个目的地 · 可滚动选择');
 try{
  renderer=new THREE.WebGLRenderer({alpha:true,antialias:true,powerPreference:'high-performance'});renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.setClearColor(0,0);
  host.prepend(renderer.domElement);renderer.domElement.setAttribute('aria-label','3D 地球：拖动旋转，滚轮或双指缩放；方向键旋转，加减键缩放，Esc 退出全屏');renderer.domElement.tabIndex=0;
  controls=new OrbitControls(camera,renderer.domElement);controls.enablePan=false;controls.enableZoom=false;controls.enableDamping=true;controls.dampingFactor=.075;controls.rotateSpeed=.48;controls.minDistance=1.14;controls.maxDistance=5;controls.autoRotateSpeed=.2;autoRotate(!reduced()&&!visualTest);
  controls.addEventListener('change',()=>dirty=true);controls.addEventListener('start',stopMotion);
  const loader=new THREE.TextureLoader();
  const [day,night,bump,cloud]=await Promise.all(['earth-day.jpg',homePresentation?'earth-lights-2016.jpg':'earth-night.jpg','earth-bump.jpg','earth-clouds.png'].map(async name=>own(await loader.loadAsync('/assets/travel-os/'+name))));
  if(disposed){resources.forEach(x=>x.dispose());return {focus(){},dispose(){}};}
  for(const texture of [day,night])texture.colorSpace=THREE.SRGBColorSpace;
  for(const texture of [day,night,bump,cloud])texture.anisotropy=Math.min(homePresentation?16:8,renderer.capabilities.getMaxAnisotropy());
  const geometry=own(new THREE.SphereGeometry(1,128,80));
  const vertexShader='varying vec2 vUv;varying vec3 vNormal;varying vec3 vPos;void main(){vUv=uv;vNormal=normalize(normalMatrix*normal);vec4 p=modelViewMatrix*vec4(position,1.);vPos=p.xyz;gl_Position=projectionMatrix*p;}';
  // One studio sun shared by all shells. This is a satellite-style illustration,
  // not a live astronomical clock or weather feed. Color textures decode to linear RGB.
  const sun={value:new THREE.Vector3(.8,.55,.65).normalize()};
  const nightStyle={value:homePresentation?1:0};
  const material=own(new THREE.ShaderMaterial({uniforms:{day:{value:day},night:{value:night},bump:{value:bump},cloud:{value:cloud},sun,nightStyle},vertexShader,fragmentShader:`
   uniform sampler2D day,night,bump,cloud;
   uniform vec3 sun;
   uniform float nightStyle;
   varying vec2 vUv;
   varying vec3 vNormal,vPos;
   void main(){
    vec3 base=texture2D(day,vUv).rgb,lights=texture2D(night,vUv).rgb;
    float elevation=texture2D(bump,vUv).r;
    vec3 normal=normalize(vNormal),eye=normalize(-vPos);
    vec3 dx=dFdx(vPos),dy=dFdy(vPos),r1=cross(dy,normal),r2=cross(normal,dx);
    float det=dot(dx,r1);
    vec3 relief=normalize(abs(det)*normal-sign(det)*(dFdx(elevation)*r1+dFdy(elevation)*r2)*.0025);
    float daylight=max(dot(relief,sun),0.);
    float facing=max(dot(normal,eye),0.);
    // Sea level in the elevation image is not black: identify ocean from its blue spectrum.
    // Preserve the actual satellite RGB on vegetation, deserts and snow instead of tinting land blue.
    float blueRatio=(base.b-max(base.r,base.g))/max(max(base.r,max(base.g,base.b)),.001);
    float land=1.-smoothstep(.16,.40,blueRatio);
    vec3 ocean=vec3(.0018,.012,.034)+base*vec3(.015,.035,.065);
    vec3 surface=mix(ocean,base,land);
    vec4 cloudShadow=texture2D(cloud,vUv+vec2(.0015,.001));
    float shadow=1.-cloudShadow.r*cloudShadow.a*.20;
    vec3 color=surface*(.075+daylight*1.18)*shadow;
    // Broad, restrained sunlight on water; terrain retains a matte photographic finish.
    float glint=pow(max(dot(reflect(-sun,normal),eye),0.),52.)*(1.-land);
    color+=vec3(.24,.34,.42)*glint*.24;
    // Reject the night photograph's blue base map. Cities become more visible toward dusk.
    float cityLight=pow(max(lights.r-lights.b*.8,0.),.68);
    float dusk=1.-smoothstep(.02,.65,daylight);
    color+=cityLight*vec3(3.,1.8,.7)*(.35+1.6*dusk)*shadow;
    float air=pow(1.-facing,3.5)*(.12+.88*daylight);
    color=mix(color,vec3(.025,.16,.40),air*.48);
    color+=vec3(.025,.19,.46)*pow(1.-facing,9.)*(.16+.65*daylight);
    if(nightStyle>.5){
     float terrainDetail=pow(dot(base,vec3(.2126,.7152,.0722)),.58);
     vec3 coolLand=vec3(.002,.006,.016)+terrainDetail*vec3(.036,.074,.125);
     vec3 nightSea=vec3(.0008,.0035,.012)+base*vec3(.004,.012,.024);
     float moonlight=max(dot(relief,normalize(vec3(-.3,.8,1.))),0.);
     color=mix(nightSea,coolLand,land)*(.30+moonlight*.95);
     // NASA Black Marble 2016 grayscale: real geographic emission, not scattered particles.
     float city=pow(lights.r,.78);
     color+=city*vec3(2.3,1.45,.60);
     color+=vec3(.012,.10,.30)*pow(1.-facing,3.5);
     color+=vec3(.10,.48,1.)*pow(1.-facing,13.);
     // The zero-latitude parallel is geographic, antialiased and occluded with the surface.
     float equator=1.-smoothstep(.00055,.00055+fwidth(vUv.y)*1.4,abs(vUv.y-.5));
     color=mix(color,vec3(.16,.43,.54),equator*.44);
    }
    gl_FragColor=vec4(color,1.);
    #include <colorspace_fragment>
   }`}));
  scene.add(new THREE.Mesh(geometry,material));
  const cloudMaterial=own(new THREE.ShaderMaterial({uniforms:{cloud:{value:cloud},sun,nightStyle},transparent:true,depthWrite:false,vertexShader,fragmentShader:`
   uniform sampler2D cloud;
   uniform vec3 sun;
   uniform float nightStyle;
   varying vec2 vUv;
   varying vec3 vNormal,vPos;
   void main(){
    vec4 tex=texture2D(cloud,vUv);
    float light=max(dot(normalize(vNormal),sun),0.);
    float rim=pow(1.-max(dot(normalize(vNormal),normalize(-vPos)),0.),4.);
    vec3 color=vec3(.92,.96,1.)*(.10+light*.90)+rim*vec3(.02,.07,.13);
    color=mix(color,vec3(.10,.20,.37)*(.20+light*.65)+rim*vec3(.04,.12,.25),nightStyle);
    gl_FragColor=vec4(color,tex.r*tex.a*mix(.88,.26,nightStyle));
    #include <colorspace_fragment>
   }`}));
  const clouds=new THREE.Mesh(geometry,cloudMaterial);clouds.scale.setScalar(1.003);scene.add(clouds);
  const glowMaterial=own(new THREE.ShaderMaterial({uniforms:{sun,nightStyle},side:THREE.BackSide,transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,vertexShader,fragmentShader:`
   uniform vec3 sun;
   uniform float nightStyle;
   varying vec3 vNormal,vPos;
   void main(){
    float limb=pow(max(0.,1.+dot(normalize(vNormal),normalize(-vPos))),5.);
    float light=.3+.7*max(dot(normalize(vNormal),sun),0.);
    gl_FragColor=vec4(.16,.52,1.,limb*light*.75);
    // Fade the outer shell to zero at its silhouette; the brightest band is next to the planet.
    if(nightStyle>.5){float density=pow(smoothstep(0.,.34,abs(dot(normalize(vNormal),normalize(-vPos)))),2.);gl_FragColor=vec4(.08,.43,1.,density*.39);}
   }`}));
  const glow=new THREE.Mesh(geometry,glowMaterial);glow.scale.setScalar(homePresentation?1.06:1.018);scene.add(glow);
  const points=data.items.filter(x=>x.position).map(x=>({...x,vector:new THREE.Vector3(...cartesian(x.position.lat,x.position.lng,1.008))}));
  const byKey=new Map(points.map(x=>[x.key,x])),featured=new Set(['东京','巴黎','伦敦','迪拜','曼谷','新加坡',...(homePresentation?['悉尼','开普敦','纽约','里约热内卢']:[])]);
  const geography=[];
  if(homePresentation){
   // Representative positions label continents, never administrative borders or product locations.
   const layer=document.createElement('div');layer.className='geography-labels';layer.setAttribute('aria-label','洲与半球');stage.append(layer);cleanup.push(()=>layer.remove());
   for(const [name,en,lat,lng,kind]of [['亚洲','ASIA',47,91,'continent'],['欧洲','EUROPE',54,24,'continent'],['非洲','AFRICA',7,21,'continent'],['北美洲','NORTH AMERICA',45,-105,'continent'],['南美洲','SOUTH AMERICA',-17,-60,'continent'],['大洋洲','OCEANIA',-24,133,'continent'],['南极洲','ANTARCTICA',-78,0,'continent'],['北半球','',65,0,'hemisphere'],['南半球','',-30,0,'hemisphere'],['赤道 · 0°','',0,0,'equator']]){
    const el=document.createElement('div');el.className='geo-label '+kind;el.dataset.name=name;el.dataset.lat=String(lat);el.innerHTML='<span>'+name+'</span>'+(en?'<small>'+en+'</small>':'');layer.append(el);geography.push({el,kind,lat,lng,vector:new THREE.Vector3()});
   }
  }
  const aircraft=[];
  if(homePresentation){
   // Phosphor airplane-fill, MIT (assets/travel-os/icons/LICENSE). Icon geometry only.
   const stamp=document.createElement('canvas');stamp.width=stamp.height=256;
   const ink=stamp.getContext('2d');ink.translate(32,32);ink.scale(.75,.75);ink.fillStyle='#effaff';ink.shadowColor='#41bfff';ink.shadowBlur=21;
   ink.fill(new Path2D('M240,136v32a8,8,0,0,1-8,8,7.61,7.61,0,0,1-1.57-.16L156,161v23.73l17.66,17.65A8,8,0,0,1,176,208v24a8,8,0,0,1-11,7.43l-37-14.81L91,239.43A8,8,0,0,1,80,232V208a8,8,0,0,1,2.34-5.66L100,184.69V161L25.57,175.84A7.61,7.61,0,0,1,24,176a8,8,0,0,1-8-8V136a8,8,0,0,1,4.42-7.16L100,89.06V44a28,28,0,0,1,56,0V89.06l79.58,39.78A8,8,0,0,1,240,136Z'));
   const planeMap=own(new THREE.CanvasTexture(stamp));planeMap.colorSpace=THREE.SRGBColorSpace;
   // Decorative great-circle connections between actual catalogue coordinates, never live flights.
   for(const [from,to,phase]of [['东京','伦敦',.48],['东京','新加坡',.53],['巴黎','曼谷',.60]]){
    const origin=points.find(p=>p.type==='city'&&p.destination===from),destination=points.find(p=>p.type==='city'&&p.destination===to);if(!origin||!destination)continue;
    const a=origin.vector.clone().normalize(),b=destination.vector.clone().normalize(),angle=a.angleTo(b);
    if(angle<.001||Math.abs(Math.sin(angle))<.001)continue;
    const path=[];for(let i=0;i<=96;i++){const t=i/96;path.push(a.clone().multiplyScalar(Math.sin((1-t)*angle)).addScaledVector(b,Math.sin(t*angle)).divideScalar(Math.sin(angle)).multiplyScalar(1.014+.07*Math.sin(Math.PI*t)));}
    const curve=new THREE.CatmullRomCurve3(path);
    for(const [radius,opacity,color]of [[.0011,.85,0x91e4ff],[.004,.12,0x279cff]])scene.add(new THREE.Mesh(own(new THREE.TubeGeometry(curve,100,radius,5,false)),own(new THREE.MeshBasicMaterial({color,transparent:true,opacity,depthWrite:false}))));
    const plane=new THREE.Sprite(own(new THREE.SpriteMaterial({map:planeMap,transparent:true,depthWrite:false,depthTest:true})));
    plane.position.copy(curve.getPoint(phase));plane.scale.set(.075,.075,1);scene.add(plane);aircraft.push({plane,a:curve.getPoint(phase),b:curve.getPoint(phase+.015)});
   }
  }
  host.dataset.routes=String(aircraft.length);
  const pg=own(new THREE.BufferGeometry());pg.setAttribute('position',new THREE.Float32BufferAttribute(points.flatMap(x=>x.vector.toArray()),3));
  const pm=own(new THREE.PointsMaterial({color:0x96dbff,size:.0045,transparent:true,opacity:.65})),pointLayer=new THREE.Points(pg,pm);pointLayer.visible=!homePresentation;scene.add(pointLayer);
  if($('toggleMapDensity'))listen($('toggleMapDensity'),'click',()=>{
   denseMarkers=!denseMarkers;const button=$('toggleMapDensity');
   button.setAttribute('aria-pressed',String(denseMarkers));
   if(button.closest('.globe-tools')){
    button.title=denseMarkers?'已显示所有地址 · 随缩放调整，点击关闭':'显示所有地址 · 随地球缩放聚合或展开';
    button.querySelector('.tool-tooltip').textContent=denseMarkers?'已开启所有地址 · 点击关闭':'显示所有地址 · 随缩放调整';
    status.textContent=denseMarkers?'所有已定位地址 · 缩小时聚合，放大后展开；位置待确认项仍可搜索':idleMessage;
   }else button.textContent=denseMarkers?'只看代表城市':'显示全部标记';
   forceLabels=true;dirty=true;
  });
  resize=()=>{
   width=host.clientWidth;height=host.clientHeight;if(!width||!height)return;
   const bounds=host.getBoundingClientRect();visibleLeft=homePresentation?Math.max(22,22-bounds.left):22;visibleRight=homePresentation?Math.min(width-22,innerWidth-bounds.left-22):width-22;
   for(const geo of geography){const style=getComputedStyle(geo.el);geo.width=parseFloat(style.width);geo.height=parseFloat(style.height);}
   const background=!immersive&&!!compositionFrame?.getClientRects().length;
   camera.clearViewOffset();camera.aspect=width/height;camera.zoom=1;
   if(background){
    // Render across the entire viewport, keeping the reference composition's left-hand optical centre.
    // A shifted camera frustum, not CSS stretching, keeps textures, hit testing and labels in one space.
    const area=compositionFrame.getBoundingClientRect(),cx=area.left+area.width/2,cy=area.top+area.height/2;
    camera.zoom=area.height/height;camera.setViewOffset(width,height,width/2-cx,height/2-cy,width,height);
    stage.style.setProperty('--globe-tools-x',cx+'px');stage.style.setProperty('--globe-tools-y',(area.bottom+5)+'px');
    stage.style.setProperty('--globe-status-y',(area.bottom+53)+'px');stage.style.setProperty('--globe-panel-x',Math.max(24,cx-165)+'px');
   }
   camera.updateProjectionMatrix();renderer.setSize(width,height);
   foregroundBoxes=background?[...document.querySelectorAll('.header,.hero-content,footer,.home-attention:not([hidden]),.connection:not([hidden]),.test-banner:not([hidden]),.globe-tools,.globe-status')].map(el=>{const r=el.getBoundingClientRect();return {x:r.left,y:r.top,w:r.width,h:r.height};}):[];
   host.dataset.background=String(background);host.dataset.projection=JSON.stringify(camera.projectionMatrix.elements);
   dirty=true;forceLabels=true;
  };
  const observer=new ResizeObserver(resize);observer.observe(host);if(compositionFrame){observer.observe(compositionFrame);observer.observe(document.querySelector('.hero-content'));observer.observe(status);}cleanup.push(()=>observer.disconnect());resize();
  const io=new IntersectionObserver(e=>{visible=e[0].isIntersecting;if(visible){dirty=true;last=0;}},{threshold:0});io.observe(host);cleanup.push(()=>io.disconnect());
  const projection=new THREE.Vector3();
  function project(p,bottomMargin=36){if(p.vector.dot(camera.position)-p.vector.lengthSq()<.035)return null;projection.copy(p.vector).project(camera);const x=(projection.x+1)*width/2,y=(1-projection.y)*height/2;return x<visibleLeft||x>visibleRight||y<32||y>height-bottomMargin?null:{x,y};}
  function rebuildLabels(now){
   const distance=camera.position.length(),projected=[];
   for(const p of points){const xy=project(p);if(xy)projected.push({...p,...xy,rank:featured.has(p.destination)?-100+(p.rank||0)/100:p.rank});}
   const sparse=homePresentation&&!denseMarkers&&distance>=2.4;
   pointLayer.visible=!sparse;
   clusters=sparse?projected.filter(p=>p.key===selected||p.type==='city'&&featured.has(p.destination)).sort((a,b)=>Number(b.key===selected)-Number(a.key===selected)).map(p=>({x:p.x,y:p.y,item:p,items:[p]})):clusterPoints(projected,distance>3.5?120:distance>2.5?100:distance>1.65?65:36,selected);
   host.dataset.markerMode=sparse?'featured':'all';
   const used=new Set(),labelBoxes=[];
   for(const c of clusters){
    const p=c.item,id=p.key;used.add(id);let entry=buttons.get(id);
    if(!entry){
     const el=document.createElement('button');el.className='globe-point';el.dataset.key=id;el.innerHTML='<span class="point-dot"></span><img src="/assets/travel-os/icons/map-pin.svg" alt=""><span class="point-count"></span><span class="point-label"></span>';entry={el,label:el.querySelector('.point-label'),count:el.querySelector('.point-count'),point:byKey.get(id),cluster:c};
     el.onclick=()=>{const group=entry.cluster;if(group.items.length>1){showList(group.items,p.destination+'附近 · '+group.items.length+' 个目的地');focus(id);}else onSelect(id);};labels.append(el);buttons.set(id,entry);
    }
    entry.cluster=c;const {el,label,count}=entry,n=c.items.length;
    el.classList.toggle('selected',id===selected);el.classList.toggle('cluster',n>1);el.classList.toggle('featured',featured.has(p.destination));
    el.dataset.count=String(n);count.textContent=n>1?String(n):'';el.setAttribute('aria-label',n>1?p.destination+'附近 '+n+' 个目的地，点击展开':'选择'+p.destination+'（'+p.country+'）');
    el.title=c.items.slice(0,8).map(x=>x.destination).join('、')+(n===1?' · '+p.country+' · '+Math.abs(p.position.lat).toFixed(2)+'°'+(p.position.lat<0?'S':'N')+' / '+Math.abs(p.position.lng).toFixed(2)+'°'+(p.position.lng<0?'W':'E'):'');label.textContent=p.destination;
    const box={x:c.x,y:c.y,w:Math.min(170,p.destination.length*14+20)},favored=id===selected||featured.has(p.destination)||distance<2.4;
    entry.showLabel=favored&&(id===selected||labelBoxes.length<10)&&!labelBoxes.some(b=>Math.abs(b.x-box.x)<(b.w+box.w)/2&&Math.abs(b.y-box.y)<30);
    // In the sparse view use two label lanes for close neighbours (e.g. London/Paris).
    el.classList.toggle('label-below',sparse&&!entry.showLabel);if(sparse)entry.showLabel=true;
    label.hidden=!entry.showLabel;if(entry.showLabel)labelBoxes.push(box);
    entry.labelWidth=label.offsetWidth||box.w;entry.labelHeight=label.offsetHeight||28;
   }
   for(const [id,{el}]of buttons)if(!used.has(id)){el.remove();buttons.delete(id);}
   host.dataset.visible=String(projected.length);host.dataset.clusters=String(clusters.length);lastCluster=now;forceLabels=false;clusterCount++;
  }
  function positionLabels(){
   const occupied=[];
   const overlaps=(a,b)=>a.x<b.x+b.w+2&&a.x+a.w+2>b.x&&a.y<b.y+b.h+2&&a.y+a.h+2>b.y;
   for(const {el,label,point,labelWidth,labelHeight}of buttons.values()){
    const xy=project(point);el.hidden=!xy;if(!xy)continue;
    el.style.transform='translate3d('+xy.x.toFixed(1)+'px,'+xy.y.toFixed(1)+'px,0)';
    const leftward=xy.x+labelWidth+30>visibleRight;
    label.classList.toggle('leftward',leftward);
    const labelBox={x:xy.x+(leftward?-labelWidth-12:point.key===selected?18:12),y:xy.y-14+(el.classList.contains('label-below')?24:point.key===selected?-7:3),w:labelWidth,h:labelHeight};
    // The Earth extends behind content, but text/interactive city pins must not compete with the foreground UI.
    if(foregroundBoxes.some(box=>overlaps(box,{x:xy.x-16,y:xy.y-32,w:32,h:48})||!label.hidden&&overlaps(box,labelBox))){el.hidden=true;continue;}
    occupied.push({x:xy.x-16,y:xy.y-32,w:32,h:48});
    if(!label.hidden)occupied.push(labelBox);
   }
   // Screen placement derives from geographic anchors; front-face visibility is identical to cities.
   const centerLongitude=Math.atan2(-camera.position.z,camera.position.x)*180/Math.PI;
   for(const geo of geography){
    const lng=geo.kind==='continent'?geo.lng:centerLongitude+(geo.kind==='equator'?38:0);
    geo.vector.set(...cartesian(geo.lat,lng,1.006));geo.el.dataset.lng=String(((lng+540)%360)-180);
    const w=geo.width,h=geo.height,xy=project(geo,h/2+2),box=xy?{x:xy.x-w/2,y:xy.y-h/2,w,h}:null;
    const visible=!!box&&box.x>=visibleLeft&&box.x+w<=visibleRight&&![...occupied,...foregroundBoxes].some(b=>overlaps(box,b));
    geo.el.hidden=!visible;if(visible){geo.el.style.transform='translate3d('+box.x.toFixed(1)+'px,'+box.y.toFixed(1)+'px,0)';occupied.push(box);}
   }
   for(const {plane,a,b}of aircraft){
    plane.visible=a.dot(camera.position)-a.lengthSq()>.02;
    if(plane.visible){const start=a.clone().project(camera),end=b.clone().project(camera);plane.material.rotation=Math.atan2((end.y-start.y)*height,(end.x-start.x)*width)-Math.PI/2;}
   }
  }
  function zoom(factor){
   moving=null;autoRotate(false);targetRadius=THREE.MathUtils.clamp(targetRadius*factor,controls.minDistance,controls.maxDistance);zoomIntent=true;dirty=true;host.dataset.motion='true';
   // Desktop homepage expands behind the page, without a column edge or an automatic mode switch.
   if(!immersive&&targetRadius<2.2&&host.dataset.background!=='true')setImmersive(true);
  }
  listen($('zoomInGlobe'),'click',()=>zoom(.82));listen($('zoomOutGlobe'),'click',()=>zoom(1/.82));
  listen($('expandGlobe'),'click',()=>setImmersive(true));listen($('exitGlobe'),'click',()=>setImmersive(false));
  listen($('resetGlobe'),'click',()=>{fly(home,650);status.textContent=idleMessage;});
  listen(rotate,'click',()=>{moving=null;targetRadius=camera.position.length();autoRotate(!controls.autoRotate);dirty=true;});
  listen(renderer.domElement,'wheel',e=>{e.preventDefault();const pixels=e.deltaY*(e.deltaMode===1?16:e.deltaMode===2?height:1);zoom(Math.exp(THREE.MathUtils.clamp(pixels,-250,250)*.0015));},{passive:false});
  const touches=new Map();let pinchDistance=0;
  const touchSpan=()=>{const [a,b]=[...touches.values()];return a&&b?Math.hypot(a[0]-b[0],a[1]-b[1]):0;};
  listen(renderer.domElement,'pointerdown',e=>{if(e.pointerType!=='touch')return;touches.set(e.pointerId,[e.clientX,e.clientY]);pinchDistance=touchSpan();});
  listen(renderer.domElement,'pointermove',e=>{if(!touches.has(e.pointerId))return;touches.set(e.pointerId,[e.clientX,e.clientY]);if(touches.size!==2)return;const distance=touchSpan();if(pinchDistance>0&&distance>0)zoom(pinchDistance/distance);pinchDistance=distance;});
  const release=e=>{touches.delete(e.pointerId);pinchDistance=0;};listen(renderer.domElement,'pointerup',release);listen(renderer.domElement,'pointercancel',release);
  listen(renderer.domElement,'keydown',e=>{
   if(['+','=','-'].includes(e.key)){e.preventDefault();zoom(e.key==='-'?1.15:.87);}
   else if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();stopMotion();const s=new THREE.Spherical().setFromVector3(camera.position);s.theta+=e.key==='ArrowLeft'?.12:e.key==='ArrowRight'?-.12:0;s.phi=THREE.MathUtils.clamp(s.phi+(e.key==='ArrowUp'?-.1:e.key==='ArrowDown'?.1:0),.03,Math.PI-.03);fly(new THREE.Vector3().setFromSpherical(s),200);}
  });
  listen(document,'keydown',e=>{
   if(!immersive)return;
   if(e.key==='Escape'){e.preventDefault();e.stopPropagation();setImmersive(false);}
   if(e.key==='Tab'){const items=[...stage.querySelectorAll('button:not(:disabled),canvas[tabindex]')].filter(x=>x.getClientRects().length&&getComputedStyle(x).visibility!=='hidden');const first=items[0],end=items.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();end?.focus();}else if(!e.shiftKey&&document.activeElement===end){e.preventDefault();first?.focus();}}
  },true);
  listen(motionPreference,'change',()=>{if(reduced()){autoRotate(false);if(moving)moving.duration=0;}dirty=true;});
  listen(renderer.domElement,'webglcontextlost',e=>{e.preventDefault();unavailable('3D 显示已中断，请刷新页面；商品搜索仍可用。');});
  // Render at the display cadence; cluster membership/text update at most seven times/sec.
  const rotation=new THREE.Quaternion();
  const animate=now=>{
   if(disposed)return;frame=requestAnimationFrame(animate);if(document.hidden||(!visible&&!immersive)||fail){last=now;return;}
   const dt=last?Math.min((now-last)/1000,.08):1/60;last=now;
   if(moving){const t=moving.duration?Math.min(1,(now-moving.at)/moving.duration):1,ease=1-Math.pow(1-t,3);rotation.identity().slerp(moving.rotation,ease);camera.position.copy(moving.from).applyQuaternion(rotation).multiplyScalar(THREE.MathUtils.lerp(moving.radius,moving.toRadius,ease));dirty=true;if(t===1){moving=null;forceLabels=true;}}
   else if(Math.abs(camera.position.length()-targetRadius)>.0005){camera.position.setLength(reduced()?targetRadius:THREE.MathUtils.lerp(camera.position.length(),targetRadius,1-Math.exp(-dt*12)));dirty=true;}
   else if(zoomIntent){camera.position.setLength(targetRadius);zoomIntent=false;forceLabels=true;dirty=true;}
   controls.update(dt);
   if(dirty||controls.autoRotate){if(forceLabels||now-lastCluster>150)rebuildLabels(now);positionLabels();renderer.render(scene,camera);dirty=false;drawCount++;host.dataset.distance=camera.position.length().toFixed(3);host.dataset.camera=camera.position.toArray().map(x=>x.toFixed(4)).join(',');host.dataset.motion=String(!!moving||zoomIntent);}
  };
  for(const id of ['rotateGlobe','zoomInGlobe','zoomOutGlobe','resetGlobe','expandGlobe','toggleMapDensity'])if($(id))$(id).disabled=false;
  host.dataset.state='ready';host.dataset.immersive='false';status.textContent=idleMessage;frame=requestAnimationFrame(animate);
 }catch(e){renderer?.dispose();unavailable('当前浏览器无法载入完整 3D 地球，请刷新重试；仍可用全部目的地和搜索。');}
 return {focus,cancelFocus:stopMotion,highlight(key){selected=key;host.dataset.selected=key||'';forceLabels=true;dirty=true;},refresh:report,stats(){return {drawCount,clusterCount};},dispose(){if(immersive)setImmersive(false,false);disposed=true;cancelAnimationFrame(frame);cleanup.forEach(f=>f());controls?.dispose();resources.forEach(x=>x.dispose());renderer?.dispose();renderer?.domElement.remove();labels.replaceChildren();homeSlot.remove();compositionFrame?.remove();}};
}
