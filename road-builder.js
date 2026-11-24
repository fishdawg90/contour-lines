(() => {
'use strict';

const WORLD_METRES = 40;
const MAX_GRADE = 8;
const STATION_HALF_WIDTH = .70;
const STATION_HALF_DEPTH = .48;
const ROAD_HALF_WIDTH = .23;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const roadKey = (city, road) => city.id + ':' + road.id;
const lotKey = (city, lot) => city.id + ':' + lot.id;
const along = (p, x, y, n) => ({x:p.x + x * n, y:p.y + y * n});
const snap = n => Math.round(n * 4) / 4;

function nearest(p, points) {
  let best = {distance:Infinity};
  for (let i = 1; i < points.length; i++) {
    const a = points[i-1], b = points[i], dx = b.x-a.x, dy = b.y-a.y;
    const den = dx*dx + dy*dy;
    if (!den) continue;
    const t = clamp(((p.x-a.x)*dx+(p.y-a.y)*dy)/den, 0, 1);
    const x = a.x+dx*t, y = a.y+dy*t, gap = Math.hypot(x-p.x,y-p.y);
    if (gap < best.distance) best = {x,y,z:lerp(a.z??0,b.z??0,t),distance:gap,dx:dx/Math.sqrt(den),dy:dy/Math.sqrt(den)};
  }
  return best;
}

function curve(points,startHeading,endHeading) {
  const out = [];
  const tangents=points.map((p,i)=>{
    if(i===0||i===points.length-1){
      const neighbor=points[i===0?1:i-1],direction=i===0?startHeading:endHeading;
      const reach=Math.min(8,distance(p,neighbor)*.82);
      return {x:direction.x*reach,y:direction.y*reach};
    }
    const a=points[i-1],b=points[i+1];
    const n=distance(a,b)||1,reach=Math.min(distance(a,p),distance(p,b));
    return p.direction?{x:p.direction.x*reach,y:p.direction.y*reach}:
      {x:(b.x-a.x)*reach/n,y:(b.y-a.y)*reach/n};
  });
  for (let i=0; i<points.length-1; i++) {
    const a=points[i],b=points[i+1],u=tangents[i],v=tangents[i+1];
    const count=Math.max(4,Math.ceil(distance(a,b)/.16));
    for(let j=0;j<count;j++){
      const t=j/count,t2=t*t,t3=t2*t;
      const value=k=>(2*t3-3*t2+1)*a[k]+(t3-2*t2+t)*u[k]+(-2*t3+3*t2)*b[k]+(t3-t2)*v[k];
      out.push({x:value('x'), y:value('y')});
    }
  }
  return [...out, {...points.at(-1)}];
}

function footprintExtents(s,tracks){
  if(s.mode==='rail')return ContourRail.stationLayout(s,tracks);
  return {start:-STATION_HALF_WIDTH,end:STATION_HALF_WIDTH,normalMin:-STATION_HALF_DEPTH,normalMax:STATION_HALF_DEPTH};
}
function stationFootprint(s,margin=0,tracks){
  const {start,end,normalMin,normalMax}=footprintExtents(s,tracks);
  const w=start-margin,e=end+margin,near=normalMin-margin,far=normalMax+margin;
  return [[w,near],[e,near],[e,far],[w,far]].map(([u,v])=>({x:s.x-s.ny*u+s.nx*v,y:s.y+s.nx*u+s.ny*v}));
}
function hitsStation(p,s,clearance=0,tracks){
  const {start,end,normalMin,normalMax}=footprintExtents(s,tracks);
  const x=p.x-s.x,y=p.y-s.y,along=-x*s.ny+y*s.nx,normal=x*s.nx+y*s.ny;
  return normal>normalMin-clearance&&normal<normalMax+clearance&&along>start-clearance&&along<end+clearance;
}

// The terrain display exaggerates elevations. Convert a physical 2H:1V
// side slope into the same world units used by the road and terrain.
const FORMATION = .36;
const DAYLIGHT_SAMPLE = .10;
function designTerrain(ground, grade, offset, slope, width=FORMATION){
  const allowance=Math.max(0,Math.abs(offset)-width)*slope;
  const formation=grade-.046;
  return Math.max(0,clamp(ground,formation-allowance,formation+allowance));
}
function sectionEarthwork(ground,p,heightScale,width=FORMATION){
  const slope=WORLD_METRES/(2*heightScale);
  const result={left:width,right:width,cut:0,fill:0};
  const sample=offset=>{
    const x=p.x-p.dy*offset,y=p.y+p.dx*offset;
    const original=ground(x,y);
    return original-designTerrain(original,p.z,offset,slope,width);
  };
  for(const [side,sign] of [['left',-1],['right',1]]){
    let previous=sample(0),empty=0,last=width;
    for(let offset=DAYLIGHT_SAMPLE;offset<8;offset+=DAYLIGHT_SAMPLE){
      const diff=sample(offset*sign),a=Math.max(0,previous),b=Math.max(0,diff);
      result.cut+=(a+b)*DAYLIGHT_SAMPLE/2;
      result.fill+=(Math.max(0,-previous)+Math.max(0,-diff))*DAYLIGHT_SAMPLE/2;
      previous=diff;
      if(Math.abs(diff)>.002){last=offset;empty=0;}
      else if(offset>width&&++empty>=4)break;
    }
    result[side]=Math.max(width,last+DAYLIGHT_SAMPLE);
  }
  return result;
}
const MIN_RADIUS=120, MAX_RADIUS=1200;
function verticalDesign(levels,length,heightScale,startGrade=0,endGrade=0,railApproaches){
  const approach=Math.min(.65,length*.11);
  const [start,end]=railApproaches?railApproaches.map(span=>Math.min(length*.43,Math.max(approach,span+.18))):[approach,approach];
  const points=[{d:0,z:levels[0].z},{d:start,z:levels[0].z+startGrade*start,radius:MIN_RADIUS},
    ...levels.slice(1,-1).map(p=>({d:lerp(start,length-end,p.f),z:p.z,radius:p.radius})),
    {d:length-end,z:levels.at(-1).z-endGrade*end,radius:MIN_RADIUS},{d:length,z:levels.at(-1).z}];
  const grades=points.slice(1).map((p,i)=>(p.z-points[i].z)/(p.d-points[i].d));
  const curveAt=(p,i)=>{
    const delta=grades[i]-grades[i-1];
    const half=p.radius*Math.abs(delta)*heightScale/(2*WORLD_METRES**2);
    return {...p,half,delta,g:grades[i-1]};
  };
  const desired=points.slice(1,-1).map((p,i)=>curveAt(p,i+1));
  const spacing=points.slice(1).map((p,i)=>p.d-points[i].d);
  // Preserve a short flat section inside each station approach.
  const available=spacing.map((n,i)=>i===0||i===spacing.length-1?n*.80:n);
  const factors=available.map((gap,i)=>{
    const required=(desired[i-1]?.half??0)+(desired[i]?.half??0);
    return required>gap?gap/required:1;
  });
  const fits=factors.every(f=>f>=1);
  // Keep the sketch continuous while an invalid radius is being adjusted.
  const curves=desired.map((p,i)=>({...p,half:p.half*Math.min(factors[i],factors[i+1])}));
  function elevation(d){
    const arc=curves.find(p=>Math.abs(d-p.d)<p.half);
    if(arc){
      const t=d-arc.d+arc.half;
      return arc.z+arc.g*(t-arc.half)+arc.delta*t*t/(4*arc.half);
    }
    const index=points.findIndex(p=>p.d>d);
    if(index<0)return points.at(-1).z;
    const start=points[Math.max(0,index-1)];
    return start.z+(d-start.d)*grades[Math.max(0,index-1)];
  }
  return {elevation,grades,curves,fits,approach,approaches:[start,end]};
}
window.roadEarthworks={section:sectionEarthwork,design:designTerrain,formation:FORMATION};

function stationRoadConflict(s,nodes,tracks){
  const {start,end,normalMin,normalMax}=footprintExtents(s,tracks);
  function local(p){
    const x=p.x-s.x,y=p.y-s.y;
    return {x:x*s.nx+y*s.ny,y:-x*s.ny+y*s.nx};
  }
  for(let i=1;i<nodes.length;i++){
    const a=local(nodes[i-1]),b=local(nodes[i]);
    let t0=0,t1=1;
    for(const [k,min,max] of [['x',normalMin-.20,normalMax+.20],['y',start-.20,end+.20]]){
      const d=b[k]-a[k];
      if(Math.abs(d)<1e-8){if(a[k]<min||a[k]>max){t0=2;break;}continue;}
      const v=(min-a[k])/d,w=(max-a[k])/d;
      t0=Math.max(t0,Math.min(v,w));t1=Math.min(t1,Math.max(v,w));
    }
    if(t0<=t1){
      const z=lerp(nodes[i-1].z??s.z,nodes[i].z??s.z,(t0+t1)/2);
      if(s.mode!=='rail'||Math.abs(z-s.z)<.28)return true;
    }
  }
  return false;
}

function tracePath(context,points,screen){
  context.beginPath();
  points.forEach((p,i)=>{const q=screen(p);if(i)context.lineTo(q.x,q.y);else context.moveTo(q.x,q.y);});
}
function createTerrainPainter(){
  const terrainCanvas=document.createElement('canvas'),terrainCtx=terrainCanvas.getContext('2d');
  let cacheKey;
  return function drawTerrain({ctx,width,height,valley,bounds,view,scaleHint,screen,world,detail}){
    const key=[view.x,view.y,view.zoom,width,height,valley.region,valley.seed,detail].join('/');
    if(key!==cacheKey){
      cacheKey=key;terrainCanvas.width=width;terrainCanvas.height=height;
      terrainCtx.fillStyle='#f0ead9';terrainCtx.fillRect(0,0,width,height);
      const stepSize=detail?.5:Math.max(.95,2.8/scaleHint);
      const min=world({x:0,y:0}),max=world({x:width,y:height});
      const startX=Math.max(bounds.west,Math.floor(min.x/stepSize)*stepSize);
      const startY=Math.max(bounds.north,Math.floor(min.y/stepSize)*stepSize);
      for(let y=startY;y<Math.min(max.y,bounds.south);y+=stepSize)for(let x=startX;x<Math.min(max.x,bounds.east);x+=stepSize){
        const midX=x+stepSize*.5,midY=y+stepSize*.5;
        const a=screen({x,y}),z=valley.ground(midX,midY);
        const zone=valley.biome?.(midX,midY);
        const hue=zone==='western'?34:zone==='swamp'?96:76;
        terrainCtx.fillStyle='hsl('+Math.round(hue-z*3)+' '+(zone==='western'?39:25)+'% '+Math.round(73-z*7)+'%)';
        terrainCtx.fillRect(a.x,a.y,stepSize*scaleHint+.5,stepSize*scaleHint+.5);
        terrainCtx.strokeStyle='#41594247';terrainCtx.lineWidth=1;terrainCtx.beginPath();
        if(valley.ground(midX+stepSize,midY)<z){terrainCtx.moveTo(a.x+stepSize*scaleHint,a.y);terrainCtx.lineTo(a.x+stepSize*scaleHint,a.y+stepSize*scaleHint);}
        if(valley.ground(midX,midY+stepSize)<z){terrainCtx.moveTo(a.x,a.y+stepSize*scaleHint);terrainCtx.lineTo(a.x+stepSize*scaleHint,a.y+stepSize*scaleHint);}
        terrainCtx.stroke();
      }
      const segments=Math.ceil((bounds.south-bounds.north)/.55);
      const waterways=[];
      for(let i=0;i<=segments;i++){
        const y=lerp(bounds.north,bounds.south,i/segments);
        const channels=valley.channels?.(y)??[[valley.riverX(y),valley.riverWidth(y),'valley']];
        channels.forEach(([x,w,zone],index)=>{
          const channel=waterways[index]??={left:[],right:[],zone};
          channel.left.push({x:x-w,y});channel.right.push({x:x+w,y});
        });
      }
      for(const {left,right,zone} of waterways){
        tracePath(terrainCtx,[...left,...right.reverse()],screen);terrainCtx.closePath();
        terrainCtx.fillStyle=zone==='swamp'?'#78958a':'#78aaa9';terrainCtx.fill();
      }
      if(detail){
        terrainCtx.strokeStyle='#f6f2dd80';terrainCtx.lineWidth=1;terrainCtx.beginPath();
        const grid=scaleHint>46?.25:1;
        for(let x=Math.ceil(min.x/grid)*grid;x<max.x;x+=grid){
          const q=screen({x,y:min.y});terrainCtx.moveTo(q.x,0);terrainCtx.lineTo(q.x,height);
        }
        for(let y=Math.ceil(min.y/grid)*grid;y<max.y;y+=grid){
          const q=screen({x:min.x,y});terrainCtx.moveTo(0,q.y);terrainCtx.lineTo(width,q.y);
        }
        terrainCtx.stroke();
      }
    }
    ctx.drawImage(terrainCanvas,0,0);
  }

}

function drawDirection(ctx,screen,width,height,from,to,label){
    const a=screen(from), target=screen(to), dx=target.x-a.x,dy=target.y-a.y,d=Math.hypot(dx,dy);
    if(d<1)return;
    const length=clamp(d,44,114),ux=dx/d,uy=dy/d;
    const origin={x:a.x+ux*17,y:a.y+uy*17},end={x:a.x+ux*(length+17),y:a.y+uy*(length+17)};
    ctx.strokeStyle='#62458f';ctx.fillStyle='#62458f';ctx.lineWidth=3.5;ctx.setLineDash([4,4]);
    ctx.beginPath();ctx.moveTo(origin.x,origin.y);ctx.lineTo(end.x,end.y);ctx.stroke();ctx.setLineDash([]);
    ctx.beginPath();ctx.moveTo(end.x,end.y);ctx.lineTo(end.x-ux*11+uy*5,end.y-uy*11-ux*5);
    ctx.lineTo(end.x-ux*11-uy*5,end.y-uy*11+ux*5);ctx.closePath();ctx.fill();
    const tx=clamp(end.x,52,width-52),ty=clamp(end.y-12,15,height-20);
    ctx.font='bold 13px system-ui';ctx.textAlign='center';ctx.lineWidth=4;
    ctx.strokeStyle='#fff9e5';ctx.strokeText(label,tx,ty);ctx.fillText(label,tx,ty);
  }

function drawTownMap({ctx,screen,line,scaleHint,w,h,valley,lots,roads,lost,served,roadConflicts,deleted}){
    for(const lot of lots){
      const q=screen(lot), hit=lost.has(lot.key);
      const size=Math.max(2,(lot.w??.50)*scaleHint);
      if(q.x<-20||q.y<-20||q.x>w+20||q.y>h+20)continue;
      ctx.save();ctx.translate(q.x,q.y);ctx.rotate(lot.angle??0);
      ctx.fillStyle=hit?'#b9503c':served.has(lot.key)?'#3e885f':'#a97254';ctx.fillRect(-size/2,-size/2,size,size*.9);ctx.restore();
    }
    for(const row of roads){
      const removed=deleted.has(row.key);
      const conflict=roadConflicts.has(row.key);
      if(removed)ctx.setLineDash([5,4]);
      line(row.road.nodes,removed?'#a6493e':conflict?'#ffe2a9':'#f2dfad',Math.max(conflict?7:2,.43*scaleHint));
      if(!removed)line(row.road.nodes,conflict?'#b4483b':'#56615e',Math.max(conflict?4:1.25,.315*scaleHint));
      ctx.setLineDash([]);
    }
    for(const [,route] of ContourTown.roadEntries(valley.transport))for(const path of ContourTown.roadSections(route)){
      line(path,'#fff0be',Math.max(2,.48*scaleHint));
      line(path,'#234c5b',Math.max(1.5,.34*scaleHint));
    }
}

function drawProfileBase({canvas,c,g,ratio,path,length,heightScale}){
    if(canvas.width!==Math.round(g.w*ratio)||canvas.height!==Math.round(g.h*ratio)){canvas.width=Math.round(g.w*ratio);canvas.height=Math.round(g.h*ratio);}
    c.setTransform(ratio,0,0,ratio,0,0);c.clearRect(0,0,g.w,g.h);
    const y=z=>g.bottom-(z-g.min)/(g.max-g.min)*(g.bottom-g.top);
    const x=f=>lerp(g.left,g.right,f);
    c.font='11px system-ui';c.fillStyle='#44594e';c.strokeStyle='#cbd5c7';c.lineWidth=1;
    for(let i=0;i<4;i++){
      const z=lerp(g.min,g.max,i/3),p=y(z);
      c.beginPath();c.moveTo(g.left,p);c.lineTo(g.right,p);c.stroke();
      c.fillText(Math.round(z*heightScale)+' m',3,p+3);
    }
    const points=path;
    c.beginPath();points.forEach((p,i)=>{const f=p.d/length;if(i)c.lineTo(x(f),y(p.ground));else c.moveTo(x(f),y(p.ground));});
    c.strokeStyle='#8c7f55';c.lineWidth=1.6;c.stroke();
    return {x,y};
}

function drawProfileCurve(context,x,y,start,end,samples,width,design,heightScale,gradeLimit){
    const distances=Array.from({length:samples+1},(_,i)=>lerp(start,end,i/samples));
    for(const curve of design.curves)for(const d of [curve.d-curve.half,curve.d,curve.d+curve.half]){
      if(d>start&&d<end)distances.push(d);
    }
    distances.sort((a,b)=>a-b);
    context.lineWidth=width;
    context.lineCap='round';
    for(let i=1;i<distances.length;i++){
      const a=distances[i-1],b=distances[i],middle=(a+b)/2;
      if(b-a<1e-8)continue;
      const low=design.elevation(a),high=design.elevation(b);
      const rounded=design.curves.some(curve=>Math.abs(middle-curve.d)<curve.half);
      const grade=Math.abs(high-low)*heightScale/((b-a)*WORLD_METRES)*100;
      context.strokeStyle=grade>gradeLimit+.001?'#aa4733':rounded?'#674e97':'#1f6c79';
      context.beginPath();
      context.moveTo(x(a),y(low));context.lineTo(x(b),y(high));context.stroke();
    }
  }

function protectedRoad(valley,key){
    return (valley.transport.stationAccesses??[]).some(access=>access.tie.key===key)||
      valley.builtStations.some(s=>s.tie?.key===key)||(valley.transport.localRoutes??[]).some(route=>route.roadKeys?.includes(key)??key.startsWith(route.city+':'))||
      valley.transport.routes.some(route=>route.roadKeys?.includes(key));
}

function cityRoadRows(valley){
  return valley.towns.flatMap(city=>ContourTown.openRoads(valley,city).map(road=>({key:roadKey(city,road),road,city})));
}
function builtLots(valley){
  return valley.towns.flatMap(city=>valley.market.homes(city).map(lot=>({...lot,key:lotKey(city,lot)})));
}
function createStationPainter(stationFaces,area){
  const stationFaceCache=new Map();
  function paint(station,apron=false,tracks=1){
    if(!stationFaces){area(stationFootprint(station),'#68766d');return;}
    const key=JSON.stringify([station.x,station.y,station.z,station.nx,station.ny,station.place,station.millBay,station.bayUse,station.mode,station.platformLength,station.terminal,station.platformCount,tracks,apron]);
    if(!stationFaceCache.has(key)){
      if(stationFaceCache.size>=96)stationFaceCache.delete(stationFaceCache.keys().next().value);
      const faces=stationFaces(station,apron,tracks),depth=face=>face.points.reduce((sum,p)=>sum+p[2]+(p[1]-station.y)*.10,0)/face.points.length;
      stationFaceCache.set(key,faces.sort((a,b)=>depth(a)-depth(b)));
    }
    for(const {points,color} of stationFaceCache.get(key)){
      area(points.map(([x,y,z])=>({x:x+(z-station.z)*.28,y:y-(z-station.z)*.46})),color);
    }
  }
  paint.clear=()=>stationFaceCache.clear();
  return paint;
}

function pointerAt(event,canvas){
  const rect=canvas.getBoundingClientRect();
  return {x:event.clientX-rect.left,y:event.clientY-rect.top};
}
function bindProfileEditor(canvas,{editable,model,bounds,values,before,defaultRadius,drag,finish}){
  let gesture=null;
  canvas.addEventListener('pointerdown',event=>{
    if(!editable()||event.button!==0||gesture)return;
    const p=pointerAt(event,canvas),g=bounds(),section=model();
    const [start,end]=section.design.approaches;
    const run=section.length-start-end;
    const f=x=>((x-g.left)/(g.right-g.left)*section.length-start)/run;
    const z=y=>lerp(g.min,g.max,clamp((g.bottom-y)/(g.bottom-g.top),-.2,1.2));
    const vips=values(),snapshot=before();
    let index=vips.findIndex(v=>Math.hypot(
      g.left+(start+v.f*run)/section.length*(g.right-g.left)-p.x,
      g.bottom-(v.z-g.min)/(g.max-g.min)*(g.bottom-g.top)-p.y)<17);
    if(index<0){
      const fraction=f(p.x);
      if(fraction<.025||fraction>.975||vips.some(v=>Math.abs(v.f-fraction)<.025))return;
      const newPoint={f:fraction,z:z(p.y),radius:defaultRadius};
      vips.push(newPoint);
      vips.sort((a,b)=>a.f-b.f);
      index=vips.indexOf(newPoint);
    }
    const vip=vips[index];
    gesture={id:event.pointerId,index,before:snapshot,scale:g,pointer:p,f,z,
      offsetF:vip.f-f(p.x),offsetZ:vip.z-z(p.y)};
    canvas.setPointerCapture(event.pointerId);
    drag(gesture);
  });
  canvas.addEventListener('pointermove',event=>{
    if(gesture?.id!==event.pointerId||!editable())return;
    const p=pointerAt(event,canvas),i=gesture.index,vips=values(),vip=vips[i];
    if(!vip)return;
    gesture.pointer=p;
    vip.f=clamp(gesture.f(p.x)+gesture.offsetF,(vips[i-1]?.f??0)+.025,(vips[i+1]?.f??1)-.025);
    vip.z=gesture.z(p.y)+gesture.offsetZ;
    drag(gesture);
  });
  for(const event of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(event,e=>{
    if(gesture?.id!==e.pointerId)return;
    const completed=gesture;
    gesture=null;
    finish(completed);
  });
  return ()=>{gesture=null;};
}

function endpointControls(valley,places,origin,destination,onSelect){
  if(!valley.region)return places.map(place=>{
    const button=document.createElement('button');
    button.type='button';button.textContent=place.name;button.dataset.city=place.id;
    button.onclick=()=>onSelect(place);
    return button;
  });
  const choosingEnd=origin&&!destination;
  const label=choosingEnd?'Choose destination':'Choose origin';
  const select=document.createElement('select');
  select.setAttribute('aria-label',label);
  const placeholder=new Option(label+'…','');
  placeholder.disabled=true;select.add(placeholder);
  for(const [zone,name] of Object.entries(ContourRegion.names)){
    const group=document.createElement('optgroup');group.label=name;
    for(const place of places.filter(place=>place.biome===zone)){
      if(choosingEnd&&!valley.market.trade(origin,place))continue;
      const cargo=place.output?' · '+ContourRegion.goods[place.output][0]:place.depot?' · Trading depot':'';
      group.append(new Option(place.name+cargo,place.id));
    }
    if(group.children.length)select.append(group);
  }
  select.selectedIndex=0;
  select.onchange=()=>onSelect(places.find(place=>place.id===select.value));
  return [select];
}
window.ContourRouteEditor={drawDirection,endpointControls,createTerrainPainter,createStationPainter,drawTownMap,drawProfileBase,drawProfileCurve,stationFootprint,
  hitsStation,stationRoadConflict,protectedRoad,cityRoadRows,builtLots,tracePath,pointerAt,bindProfileEditor};

window.createRoadBuilder = function createRoadBuilder({getValley,bounds,heightScale,draftKey,stationFaces,begin,commit,upgradeStation,finish}) {
  const $=id=>document.getElementById(id);
  const root=$('roadBuilder'), map=$('rbMap'), ctx=map.getContext('2d'), section=$('rbProfile');
  const lens=$('rbProfileLens'),lensCanvas=$('rbProfileLensCanvas');
  const renderTerrain=createTerrainPainter();
  let stationEdit=null, draft=null, step=0, selected=-1, deleteMode=false, dragging=null, pressed=null, preview=null;
  let frame=0, scaleHint=1, removalNote='', undo=[], redo=[], gestureEdit=null;
  const cursor=new Map();
  const camera={x:0,y:0,zoom:1};
  const roadName=city=>city?.name??'Map point';

  const industries=()=>getValley().industries??[getValley().industry];
  const places=()=>[...getValley().towns,...industries(),...getValley().market.depots()];
  const isIndustry=id=>places().some(site=>site.id===id&&(site.output||site.depot||site===getValley().industry));
  const useKey=plan=>plan.cargo+'|'+plan.from.id;
  const choicesForPair=()=>getValley().market.trades(...draft.picks.map(cityFor));
  const trade=()=>choicesForPair().find(plan=>useKey(plan)===draft.freightChoice)??choicesForPair()[0];
  const saveKey=()=>draftKey?.(getValley())??'contour-route-draft:'+getValley().seed;
  function cityFor(p){
    return places().find(t=>t.id===p?.city);
  }

  function cityRoads(includeDraft=true){
    return cityRoadRows(getValley()).filter(row=>!includeDraft||!draft.deleted.includes(row.key));
  }
  function houses(){return builtLots(getValley());}

  function roadNear(p, limit=Infinity, cityId){
    let best={distance:limit};
    for(const row of cityRoads()){
      if(cityId&&row.city.id!==cityId)continue;
      const hit=nearest(p,row.road.nodes);
      if(hit.distance<best.distance)best={...hit,...row};
    }
    return best.key?best:null;
  }

  function onLand(p, margin=0) {
    const valley=getValley();
    return p.x>bounds.west+margin&&p.x<bounds.east-margin&&p.y>bounds.north+margin&&p.y<bounds.south-margin&&
      !valley.wet(p.x,p.y,margin);
  }

  function existingStations(index){
    const place=cityFor(draft.picks[index]);
    if(!place)return [];
    const found=new Map(),plan=trade();
    const use=plan?.cargo==='passengers'?'both':plan?.from===place?'load':'unload';
    const belongs=station=>place.hubKey?ContourTown.stationKey(station)===place.hubKey:
      station.place===place.id||station.name===place.name;
    const eligible=station=>!station.bayUse||station.bayUse==='both'||station.bayUse===use;
    const fit=station=>place.hubKey?{...station,hubKey:place.hubKey,place:place.id,name:place.name}:station;
    for(const [,route] of ContourTown.roadEntries(getValley().transport))for(const [side,station] of route.stations.entries()){
      if(!belongs(station)||!eligible(station)||route.routePorts?.[side])continue;
      const key=choiceKey(station);
      if(found.has(key))continue;
      const points=routePrefix(route,side),length=routeLength(points);
      if(length>=.6)found.set(key,{...fit(station),shared:{key,points,length}});
    }
    for(const station of getValley().builtStations){
      if(station.mode==='rail')continue;
      const key=choiceKey(station);
      if(belongs(station)&&eligible(station)&&!found.has(key))found.set(key,{...fit(station),existingBay:true});
    }
    return [...found.values()];
  }
  const choiceKey=s=>window.contourStationKey(s);
  function routePrefix(route,side){
    const points=[],direction=side?-1:1;
    let length=0;
    for(let i=side?route.points.length-1:0;i>=0&&i<route.points.length;i+=direction){
      const p=route.points[i];
      if(points.length)length+=distance(points.at(-1),p);
      points.push(p);
      if(length>=1.5)break;
    }
    return points;
  }
  function spareBay(s){
    for(const sign of [-1,1]){
      const point=along(s,-s.ny,s.nx,sign*1.55);
      const bay={...point,z:meshGround(point.x,point.y),nx:s.nx,ny:s.ny,place:s.place,name:s.name,
        millBay:s.millBay,id:'2',bayUse:'both',parallel:true,detached:true};
      if(!baySiteIssue(bay,s))return bay;
    }
    return null;
  }
  function layoutBays(station){
    if(station.sideBay)return [{...station,sideBay:undefined,id:'1',bayUse:'both'},station.sideBay];
    return getValley().transport.stationLayouts?.[choiceKey(station)]?.bays??[];
  }
  function draftBay(station){
    const id=station.selectedBay??'1';
    return layoutBays(station).find(bay=>bay.id===id)??station;
  }
  function routeApproaches(station){
    const transport=getValley().transport,{stationAccesses=[]}=transport,key=choiceKey(station);
    const bay=draftBay(station),id=station.selectedBay??'1',side=station.routeSide;
    const approaches=stationAccesses.filter(access=>access.baseKey===key&&access.bayId===id&&
      !draft.deleted.includes(access.tie?.key)).map(access=>({edge:access.side,points:access.points}));
    for(const [,route] of ContourTown.roadEntries(transport))route.stations.forEach((base,index)=>{
      const port=route.routePorts?.[index];
      if(port&&choiceKey(base)===key&&(route.stationBays?.[index]??'1')===id){
        approaches.push({edge:port.edge,points:routePrefix(route,index)});
      }
    });
    if(!bay.detached&&station.shared)approaches.push({edge:null,points:station.shared.points});
    if((station.shared||station.existingBay)&&!bay.detached&&station.tie?.key&&!draft.deleted.includes(station.tie.key)){
      const edge=station.accessSide??0;
      const points=station.driveway??[stationEdge(station,edge),station.tie];
      // A relocated or parallel bay uses its internal lane from the base station.
      approaches.push({edge:id==='1'&&bay.x===station.x&&bay.y===station.y?edge:null,points});
    }
    return approaches.filter(approach=>approach.points.length>1&&(side===undefined||side===approach.edge));
  }
  function preferredApproach(station){return routeApproaches(station)[0];}
  function routeEdge(station){return preferredApproach(station)?.edge??station.routeSide??(draftBay(station).detached?2:null);}
  function directPort(station){return routeEdge(station)!==null;}
  function portSide(station){return routeEdge(station)??2;}
  function routeStub(station){return preferredApproach(station)?.points??[];}
  function approach(s){
    const port=routeStub(s).at(-1);
    if(port)return port;
    if(!directPort(s))return {...endpoint(s),z:s.z};
    const bay=draftBay(s),edge=stationEdge(bay,portSide(s));
    return {...along(edge,-edge.dx,-edge.dy,.01),z:bay.z};
  }
  function heading(s){
    const points=routeStub(s);
    if(points.length>1)return tangent(points.at(-2),points.at(-1));
    if(!directPort(s))return {x:-s.nx,y:-s.ny};
    const edge=stationEdge(draftBay(s),portSide(s));
    return {x:edge.dx,y:edge.dy};
  }

  function stationAt(p,index){
    const site=cityFor(draft.picks[index]);
    if(isIndustry(site?.id)){
      if(site.hubKey)return existingStations(index).sort((a,b)=>distance(a,p)-distance(b,p))[0]??null;
      const bays=loadingBays(site).sort((a,b)=>distance(a,p)-distance(b,p));
      return bays.find(s=>!stationIssue(s,index))??bays[0];
    }
    const other=draft.picks[1-index],near=roadNear(p,3,site?.id);
    const guide=near??{x:p.x+(p.x-other.x),y:p.y+(p.y-other.y)};
    const dx=guide.x-p.x,dy=guide.y-p.y,len=Math.hypot(dx,dy)||1;
    const nx=len===1&&dx===0&&dy===0?0:dx/len,ny=len===1&&dx===0&&dy===0?1:dy/len;
    const z=meshGround(p.x,p.y);
    return {x:p.x,y:p.y,z,nx,ny,tie:near?{x:near.x,y:near.y,z:near.z,key:near.key}:null, place:draft.picks[index].city,name:roadName(cityFor(draft.picks[index]))};
  }

  const edgeNames=['Front','Right','Back','Left'];
  function stationEdge(station,side){
    const {nx,ny}=station;
    const [x,y]=[[nx,ny],[-ny,nx],[-nx,-ny],[ny,-nx]][side];
    return {...along(station,x,y,side%2?STATION_HALF_WIDTH:STATION_HALF_DEPTH),z:station.z,dx:x,dy:y};
  }
  function accessRoads(station,local){
    const rows=cityRoads().filter(row=>!local||row.city.id===station.place).map(({key,road})=>({key,nodes:road.nodes}));
    if(!local)for(const [index,route] of ContourTown.roadEntries(getValley().transport)){
      ContourTown.roadSections(route).forEach((nodes,part)=>rows.push({key:'built/'+index+'/'+part,nodes}));
    }
    return rows;
  }
  function roadAccess(station,side,tie){
    const gate=stationEdge(station,side),distanceToRoad=distance(gate,tie);
    const toward=tangent(gate,tie);
    if(distanceToRoad<.12)return {issue:'Leave at least 5 m between the entrance and the road.'};
    if(distanceToRoad>5)return {issue:Math.round(distanceToRoad*WORLD_METRES)+' m from this edge. The limit is 200 m.'};
    if(toward.x*gate.dx+toward.y*gate.dy<.12)return {issue:'That road is behind this edge. Select a different edge.'};
    const points=curve([gate,tie],{x:gate.dx,y:gate.dy},toward);
    const length=routeLength(points);
    const grade=Math.abs(gate.z-tie.z)*heightScale/(length*WORLD_METRES)*100;
    let d=0;
    for(let i=0;i<points.length;i++){
      if(i)d+=distance(points[i],points[i-1]);
      points[i].z=lerp(gate.z,tie.z,d/length);
    }
    const issue=grade>12?grade.toFixed(1)+'% driveway grade. The limit is 12%.':
      points.some(point=>!onLand(point,.06))?'The driveway crosses water or the map boundary.':'';
    return {tie,points,length,grade,issue};
  }
  let gatesCache;
  function availableGates(station,local){
    const key=JSON.stringify([station.x,station.y,station.z,station.nx,station.ny,station.place,local,draft.deleted]);
    if(gatesCache?.key===key)return gatesCache.gates;
    const roads=accessRoads(station,local);
    const gates=edgeNames.map((_,side)=>{
      const gate=stationEdge(station,side),probe=along(gate,gate.dx,gate.dy,1.25);
      let best=null,bestLength=Infinity;
      if(local&&station.millBay){
        const yardGate=station.yardGate??station.tie;
        const access=yardGate?roadAccess(station,side,yardGate):null;
        return {gate,side,suggested:access&&!access.issue?access:null};
      }
      for(const road of roads){
        if(!road.nodes.some(p=>distance(p,gate)<8)&&nearest(gate,road.nodes).distance>5)continue;
        const hit=nearest(probe,road.nodes),tie={x:hit.x,y:hit.y,z:hit.z,key:road.key};
        const value=roadAccess(station,side,tie);
        if(!value.issue&&value.length<bestLength){
          best=value;bestLength=value.length;
        }
      }
      return {gate,side,suggested:best};
    });
    gatesCache={key,gates};
    return gates;
  }
  function nearestAccessRoad(station,p,local,key){
    const limit=Math.max(.23,24/scaleHint);
    let best=null;
    for(const road of accessRoads(station,local)){
      if(key&&road.key!==key)continue;
      const hit=nearest(p,road.nodes);
      if(hit.distance<(best?.distance??limit))best={x:hit.x,y:hit.y,z:hit.z,key:road.key,distance:hit.distance};
    }
    if(!best)return null;
    const {distance:_,...tie}=best;
    return tie;
  }
  function setStationAccess(station,side,access){
    station.accessSide=side;
    station.tie=access?.tie??null;
    station.driveway=access?.points;
  }
  const protectedRoadKey=key=>protectedRoad(getValley(),key);
  const conflicts=s=>s&&!s.shared?cityRoads().filter(row=>stationRoadConflict(s,row.road.nodes)):[];
  const impactedByStation=(lot,s)=>hitsStation(lot,s,lot.radius??.33)||
      s.tie&&nearest(lot,s.driveway??[along(s,s.nx,s.ny,STATION_HALF_DEPTH),s.tie]).distance<(lot.radius??.33)+ROAD_HALF_WIDTH;
  const meshGround=(x,y)=>{
    const valley=getValley(), grid=valley.grid??.9;
    return valley.ground((Math.floor(x/grid)+.5)*grid,(Math.floor(y/grid)+.5)*grid);
  };
  function loadingBays(mill){
    return [[1,0],[0,1],[-1,0],[0,-1]].map(([dx,dy])=>{
      const edge=dx?mill.halfWidth:mill.halfDepth;
      const gate={x:mill.x+dx*edge,y:mill.y+dy*edge,z:mill.z+.04};
      const x=gate.x+dx*mill.apron,y=gate.y+dy*mill.apron;
      return {x,y,z:meshGround(x,y),nx:-dx,ny:-dy,tie:gate,yardGate:gate,millBay:true,place:mill.id,name:mill.name};
    });
  }
  function stationIssue(s,index,blocking=conflicts(s)){
    if(!s)return 'Tap the map to place the station.';
    const other=draft.stations[1-index];
    if(other&&distance(other,s)<3)return 'Separate the two stations by at least 120 m.';
    if(s.shared||s.existingBay)return existingStations(index).some(p=>choiceKey(p)===choiceKey(s))?'':'This station is no longer available.';
    if(s.tie?.key&&!s.tie.key.startsWith(s.place+':'))return 'Connect to a street in the selected town.';
    if(!stationFootprint(s).every(p=>onLand(p,.06)))return 'The station needs a dry footprint inside the map.';
    const level=stationFootprint(s).map(p=>meshGround(p.x,p.y));
    if(Math.max(...level,s.z)-Math.min(...level,s.z)>.24)return 'The station footprint crosses too many terrace steps.';
    if(isIndustry(draft.picks[index].city)&&!s.millBay)return 'Select an available industry loading bay.';
    if(s.millBay&&!s.tie)return 'Choose an edge that can reach the industry gate.';
    if(draft.picks[index].city&&!isIndustry(draft.picks[index].city)&&!s.tie)return 'Place the station within 120 m of an open town street.';
    if(s.tie&&s.driveway?.length){
      const issue=roadAccess(s,s.accessSide??0,s.tie).issue;
      if(issue)return issue;
    }
    if(s.tie&&!s.driveway?.length&&distance(s,s.tie)<.77)return 'Leave room between the station and the street.';
    if(s.tie&&!s.driveway?.length&&(!onLand({x:lerp(s.x,s.tie.x,.5),y:lerp(s.y,s.tie.y,.5)})||
      (distance(s,s.tie)-STATION_HALF_DEPTH)>0&&Math.abs(s.z-s.tie.z)*heightScale/((distance(s,s.tie)-STATION_HALF_DEPTH)*WORLD_METRES)*100>12))return 'Find a less steep entrance to the town street.';
    if(blocking.length)return blocking.some(row=>protectedRoadKey(row.key))
      ?'A conflicting street serves a built station. Move this station.'
      :'Mark the highlighted streets for removal or move the station.';
    if(getValley().builtStations.some(other=>distance(other,s)<1.65)||
      ContourTown.roadEntries(getValley().transport).some(([,route])=>ContourTown.roadSections(route).some(path=>path.some(p=>hitsStation(p,s,.19)))))return 'The station overlaps a built route.';
    return '';
  }

  function suggest(index){
    const pick=draft.picks[index],other=draft.picks[1-index],city=cityFor(pick);
    const dx=other.x-pick.x,dy=other.y-pick.y,angle=Math.atan2(dy,dx);
    if(isIndustry(city?.id)){
      if(city.hubKey)return existingStations(index)[0]??null;
      return loadingBays(city).filter(s=>!stationIssue(s,index)).sort((a,b)=>angleScore(a,dx,dy)-angleScore(b,dx,dy))[0]??null;
    }
    const candidates=[];
    for(const radius of (city?[5.8,4.8,6.8,3.5,2.5,1.5]:[0,.8,1.5])){
      for(let i=0;i<16;i++){
        const a=angle+(i%2?-1:1)*Math.ceil(i/2)*Math.PI/8;
        const p={x:snap(pick.x+radius*Math.cos(a)),y:snap(pick.y+radius*Math.sin(a))};
        const s=stationAt(p,index);
        if(stationIssue(s,index))continue;
        const score=angleScore(s,dx,dy)+Math.abs((s.tie?.z??s.z)-s.z)*7+i*.075+
          (city?Math.abs(radius-5.8)*.32:radius*.1);
        candidates.push({s,score});
      }
    }
    candidates.sort((a,b)=>a.score-b.score);
    return candidates[0]?.s??null;
  }

  function angleScore(s,dx,dy){
    return (s.nx*dx+s.ny*dy)/(Math.hypot(dx,dy)||1);
  }

  function endpoint(s){
    return along(s,-s.nx,-s.ny,STATION_HALF_DEPTH-.01);
  }

  const reuseStretch=()=>Boolean(draft.stretches?.length);
  const alignment=()=>reuseStretch()?draft.links[draft.link??0]:draft;
  function linkName(index){
    if(index===0)return 'Origin link';
    if(index===draft.stretches.length)return 'Destination link';
    return 'Link '+(index+1)+' · stretches '+index+'–'+(index+1);
  }
  function blankLink(){return {handles:[],vips:[],vip:-1};}
  const pickableRoad=id=>!id.startsWith('bay/');
  const routeStubId=(station,approach)=>'bay/route-'+station+'/'+approach;

  function initializeAlignment(reset=false){
    if(draft.handles.length&&!reset)return;
    const [a,b]=draft.stations;
    const h=heading(a),j=heading(b),p=along(approach(a),h.x,h.y,1.2),q=along(approach(b),j.x,j.y,1.2);
    draft.handles=[{x:lerp(p.x,q.x,.34),y:lerp(p.y,q.y,.34)},{x:lerp(p.x,q.x,.66),y:lerp(p.y,q.y,.66)}];
    selected=-1;
  }

  let roadGraphCache;
  function roadGraph(){
    const valley=getValley();
    const key=JSON.stringify([valley.seed,valley.transport.routes.length,draft.deleted,draft.stations,draft.roadMode??'']);
    if(roadGraphCache?.key===key)return roadGraphCache.graph;
    const roads=cityRoads().map(row=>({id:row.key,nodes:row.road.nodes}));
    for(const [index,route] of ContourTown.roadEntries(valley.transport)){
      ContourTown.roadSections(route).forEach((nodes,part)=>roads.push({id:'built/'+index+'/'+part,nodes}));
    }
    const stations=draft.roadMode?[...valley.builtStations.filter(station=>station.mode!=='rail'),...draft.stations]:[];
    const seen=new Set();
    for(const station of stations){
      const id='bay/'+choiceKey(station);
      if(seen.has(id))continue;
      seen.add(id);
      const front={...along(station,station.nx,station.ny,.45),z:station.z};
      const nodes=[{...endpoint(station),z:station.z},station,front];
      if(station.driveway?.length)nodes.push(...station.driveway);
      else if(station.tie)nodes.push(station.tie);
      roads.push({id,nodes});
    }
    for(const [index,access] of (valley.transport.stationAccesses??[]).entries()){
      roads.push({id:'access/'+index,nodes:access.points});
    }
    const approaches=draft.stations.map(station=>station?routeApproaches(station):[]);
    approaches.forEach((ports,index)=>ports.forEach(({points},port)=>roads.push({id:routeStubId(index,port),nodes:points})));
    const graph=ContourTown.makeGraph(roads,.045);
    const ports=approaches.map((items,index)=>items.map(({edge,points},port)=>({edge,
      tie:graph.entrance({...points[0],road:routeStubId(index,port)},.05)})).filter(({tie})=>tie));
    roadGraphCache={key,graph,ports};
    return graph;
  }

  function shortestConnection(graph,starts,ends){
    let best={path:[]},length=Infinity;
    for(const from of starts)for(const to of ends){
      const path=graph.pathBetween(from.tie,to.tie);
      if(!path.length)continue;
      const distance=routeLength(path);
      if(distance<length){best={path,from,to};length=distance;}
    }
    return best;
  }

  function existingAlignment(){
    const graph=roadGraph();
    if(roadGraphCache.existing)return roadGraphCache.existing;
    const {path,from,to}=shortestConnection(graph,...roadGraphCache.ports);
    const result={first:[],last:[],through:path,portEdges:path.length?[from.edge,to.edge]:[],
      keys:graph.segmentRoads(path).filter(key=>!key.includes('/')),issue:''};
    roadGraphCache.existing=result;
    return result;
  }

  let stretchCache;
  function stretchPiece(graph,points){
    if(stretchCache?.graph!==graph)stretchCache={graph,pieces:new Map(),runs:new Map()};
    const key=JSON.stringify(points),cache=stretchCache.pieces;
    if(cache.has(key))return cache.get(key);
    const ties=points.map(point=>graph.entrance(point,.10,pickableRoad));
    const path=ties.every(Boolean)?graph.pathBetween(...ties):[];
    const keys=path.length?[...new Set([...graph.segmentRoads(path),...ties.flatMap(tie=>[...tie.roads])])]
      .filter(id=>!id.includes('/')):[];
    const piece={ties,path,keys};
    if(cache.size>=48)cache.delete(cache.keys().next().value);
    cache.set(key,piece);
    return piece;
  }
  function stretchAlignment(graph){
    const pieces=draft.stretches.map(points=>stretchPiece(graph,points));
    const invalid=pieces.findIndex(piece=>routeLength(piece.path)<.25);
    if(invalid>=0)return {first:[],last:[],through:[],pieces,keys:[],
      issue:'Stretch '+(invalid+1)+' needs two connected road points at least 10 m apart.'};
    const stubs=draft.stations.map(routeStub);
    const ports=draft.stations.map((station,index)=>{
      if(roadGraphCache.ports[index].length)return roadGraphCache.ports[index];
      const tie=graph.entrance(approach(station),.025,pickableRoad);
      return tie?[{tie,edge:routeEdge(station)}]:[];
    });
    const connections=draft.links.map((edits,i)=>{
      const from=i?[{tie:pieces[i-1].ties[1]}]:ports[0],to=pieces[i]?[{tie:pieces[i].ties[0]}]:ports[1];
      return edits.buildNew||edits.handles.length||edits.vips.length?{path:[]}:shortestConnection(graph,from,to);
    });
    const links=connections.map(({path})=>path);
    const portEdges=[connections[0].from,connections.at(-1).to].map((port,i)=>port?port.edge:routeEdge(draft.stations[i]));
    return {graph,first:links[0].length?[]:stubs[0],last:links.at(-1).length?[]:[...stubs[1]].reverse(),
      through:[],pieces,links,portEdges,keys:[...new Set(pieces.flatMap(piece=>piece.keys))],issue:''};
  }

  function shortestReusedRun(paths){
    if(paths.length===1)return paths[0];
    const key=JSON.stringify(paths),cache=stretchCache.runs;
    if(cache.has(key))return cache.get(key);
    // Resolve overlapping stretches as one walkable network, including ties inside an edge.
    const graph=ContourTown.makeGraph(paths.map((nodes,id)=>({id,nodes})),.045);
    const start=paths[0][0],end=paths.at(-1).at(-1);
    const path=graph.path(graph.nearest(start,.06),graph.nearest(end,.06));
    const result=path.length?[start,...path.slice(1,-1),...(path.length>1?[end]:[])]:paths.flat();
    if(cache.size>=24)cache.delete(cache.keys().next().value);
    cache.set(key,result);
    return result;
  }

  function plannedStretches(network,sections){
    const legs=[],existing=[];
    const reuse=path=>{if(path.length>1)existing.push(path);};
    function flush(){
      if(existing.length)legs.push({path:shortestReusedRun(existing),built:false});
      existing.length=0;
    }
    reuse(network.first);
    sections.forEach(({path},i)=>{
      if(network.links[i].length)reuse(network.links[i]);
      else if(path.length>1){flush();legs.push({path,built:true});}
      if(network.pieces[i])reuse(network.pieces[i].path);
    });
    reuse(network.last);
    flush();
    return legs;
  }
  function networkAlignment(){
    const graph=roadGraph();
    if(reuseStretch())return stretchAlignment(graph);
    const ends=draft.stations.map(s=>graph.nearest(s,.09));
    const mode=draft.roadMode??'new';
    const result={first:[],last:[],through:[],keys:[],issue:''};
    if(mode==='existing'){
      result.through=graph.path(...ends);
      if(result.through.length<2)result.issue='The stations are not connected. Try a different bay or add a new section.';
    }else{
      const joins=(draft.joins??[]).map(point=>point&&graph.nodes.find(n=>distance(n,point)<.001&&Math.abs(n.z-point.z)<.001));
      const [exit,entry]=joins;
      if(!exit||!entry){result.issue='Tap two existing road points, first where the new section leaves and then where it rejoins.';return result;}
      result.first=graph.path(ends[0],exit);result.last=graph.path(entry,ends[1]);
      if(!result.first.length||!result.last.length)result.issue='Each tie must connect by road to its corresponding station. Pick the ties again.';
      else if(distance(exit,entry)<1.2)result.issue='Separate the two ties by at least 48 m.';
    }
    result.keys=[...new Set([result.first,result.last,result.through].flatMap(path=>graph.segmentRoads(path)))].filter(key=>!key.includes('/'));
    return result;
  }
  function routeLength(path){return path.slice(1).reduce((sum,p,i)=>sum+distance(path[i],p),0);}
  function tangent(from,to){
    const length=distance(from,to)||1;
    return {x:(to.x-from.x)/length,y:(to.y-from.y)/length};
  }
  function profile() {
    const [a,b]=draft.stations;
    if(!a||!b)return null;
    const mode=draft.roadMode;
    const existing=!mode&&!reuseStretch()&&draft.stations.every(s=>s.shared||s.existingBay)?existingAlignment():null;
    const canReuse=Boolean(existing?.through.length>1);
    const automatic=canReuse&&!draft.buildNewRoad;
    const network=automatic?existing:mode||reuseStretch()?networkAlignment():null;
    const valley=getValley();
    if(network?.issue)return {issue:network.issue,network,path:[],lots:[]};
    const newBays=draft.stations.filter(s=>!s.shared&&!s.existingBay).concat(draft.stations.flatMap(s=>s.sideBay?[s.sideBay]:[]));
    if(automatic||mode==='existing'){
      const lots=houses().filter(l=>newBays.some(s=>impactedByStation(l,s)));
      const earth=newBays.map(stationEarthwork);
      const cut=earth.reduce((sum,section)=>sum+section.cut,0),fill=earth.reduce((sum,section)=>sum+section.fill,0);
      const cost=valley.market.vehiclePrice+estimateCost({cut,fill,stations:newBays.length,buildings:lots.length,streets:draft.deleted.length});
      return {network,canReuse,automatic,path:[],lots,length:routeLength(network.through),cut,fill,cost,issue:''};
    }
    const start=network?.first.at(-1)??approach(a),end=network?.last[0]??approach(b),inward=heading(b);
    const startHeading=network?.first.length>1?(draft.handles.length?tangent(start,draft.handles[0]):tangent(start,end)):heading(a);
    const endHeading=network?.last.length>1?(draft.handles.length?tangent(draft.handles.at(-1),end):tangent(start,end)):{x:-inward.x,y:-inward.y};
    const sections=reuseStretch()?draft.links.map((edits,i)=>{
      const before=network.pieces[i-1]?.ties[1],after=network.pieces[i]?.ties[0];
      const from=before?.point??approach(a),to=after?.point??approach(b);
      if(network.links[i].length)return {path:[],length:0,maxGrade:0,cut:0,fill:0,waterLength:0,maxEarthwork:0,issue:''};
      const leave=before?tangent(from,edits.handles[0]??to):heading(a);
      const enter=after?tangent(edits.handles.at(-1)??from,to):{x:-inward.x,y:-inward.y};
      const startGrade=before?tieGrade(before,leave):sharedGrade(a);
      const endGrade=after?tieGrade(after,enter):-sharedGrade(b);
      return cachedSection(from,to,leave,enter,edits,startGrade,endGrade);
    }):[cachedSection(start,end,startHeading,endHeading,draft)];
    if(reuseStretch()){
      network.legs=plannedStretches(network,sections);
      network.keys=[...new Set([...network.keys,...network.links.flatMap(path=>network.graph.segmentRoads(path))])].filter(p=>!p.includes('/'));
    }
    const active=sections[reuseStretch()?draft.link??0:0];
    let cut=sections.reduce((sum,item)=>sum+item.cut,0),fill=sections.reduce((sum,item)=>sum+item.fill,0);
    const totalNew=sections.reduce((sum,item)=>sum+item.length,0);
    const waterLength=sections.reduce((sum,item)=>sum+item.waterLength,0);
    const maxGrade=Math.max(...sections.map(item=>item.maxGrade)),maxEarthwork=Math.max(...sections.map(item=>item.maxEarthwork));
    const roadPoints=sections.flatMap(item=>item.path);
    for(const s of newBays){
      const station=stationEarthwork(s);cut+=station.cut;fill+=station.fill;
    }
    const lots=houses().filter(l=>newBays.some(s=>impactedByStation(l,s))||
      sections.some(({path})=>nearest(l,path).distance<(l.radius??.33)+ROAD_HALF_WIDTH));
    const cost=valley.market.vehiclePrice+estimateCost({length:totalNew,cut,fill,waterLength,stations:newBays.length,buildings:lots.length,streets:draft.deleted.length});
    const out=roadPoints.some(p=>p.x<=bounds.west||p.x>=bounds.east||p.y<=bounds.north||p.y>=bounds.south);
    const otherStations=valley.builtStations.filter(s=>!draft.stations.some(p=>(p.existingBay||p.shared)&&choiceKey(p)===choiceKey(s)))
      .concat(draft.stations.flatMap(s=>layoutBays(s).filter(bay=>bay.id!==(s.selectedBay??'1'))));
    const hitsYard=[...industries(),...(valley.publicDepots??[])].find(site=>roadPoints.some(p=>Math.abs(p.x-site.x)<site.halfWidth+ROAD_HALF_WIDTH&&
      Math.abs(p.y-site.y)<site.halfDepth+ROAD_HALF_WIDTH));
    const hitsBuilt=otherStations.some(s=>roadPoints.some(p=>hitsStation(p,s,ROAD_HALF_WIDTH)));
    const returnsToBay=reuseStretch()&&draft.stations.some((station,i)=>{
      const bay=draftBay(station),section=i?sections.at(-1):sections[0];
      return section.path.some(p=>(i?section.length-p.d:p.d)>.18&&Math.abs(p.z-bay.z)<.045&&hitsStation(p,bay,-.035));
    });
    const stationWarning=draft.stations.some((s,i)=>(s.shared||s.existingBay)?stationIssue(s,i):s.sideBay&&baySiteIssue(s.sideBay,s));
    const invalidSection=sections.findIndex(item=>item.issue);
    const issue=stationWarning?'Choose an available town station.':out?'Keep the alignment inside the map.':hitsYard?'Curve the road away from '+hitsYard.name+'.':hitsBuilt?'The road overlaps an existing station.':
      returnsToBay?'A new link doubles back through its bay. Move the tie or choose a different exit.':
      invalidSection<0?'':(reuseStretch()?linkName(invalidSection)+' · ':'')+sections[invalidSection].issue;
    return {...active,sections,totalNew,maxGrade,cut,fill,waterLength,lots,maxEarthwork,cost,issue,network,canReuse};
  }

  function tieGrade(tie,direction){
    const edge=tangent(tie.a,tie.b);
    return (tie.b.z-tie.a.z)/tie.length*(edge.x*direction.x+edge.y*direction.y);
  }
  function sharedGrade(station){
    const points=routeStub(station);
    if(!points||points.length<2)return 0;
    const [a,b]=points.slice(-2);
    return (b.z-a.z)/(distance(a,b)||1);
  }
  let sectionCache=new Map();
  function cachedSection(from,to,leave,enter,edits,startGrade=0,endGrade=0){
    const key=JSON.stringify([from,to,leave,enter,edits.handles,edits.vips,startGrade,endGrade]);
    if(sectionCache.has(key))return sectionCache.get(key);
    const section=designSection(from,to,leave,enter,edits,startGrade,endGrade);
    if(sectionCache.size>=32)sectionCache.delete(sectionCache.keys().next().value);
    sectionCache.set(key,section);
    return section;
  }
  function designSection(start,end,startHeading,endHeading,edits,startGrade=0,endGrade=0,railApproaches){
    const valley=getValley();
    if(distance(start,end)<1e-5)return {path:[start],length:0,maxGrade:0,cut:0,fill:0,waterLength:0,maxEarthwork:0,
      issue:Math.abs(start.z-end.z)>.001?'Leave room to connect roads at different heights.':''};
    const back=railApproaches?.[1],forward=railApproaches?.[0];
    const guide=forward?[{...along(start,startHeading.x,startHeading.y,forward),direction:startHeading}]:[];
    const arrival=back?[{...along(end,-endHeading.x,-endHeading.y,back),direction:endHeading}]:[];
    const path=curve([start,...guide,...edits.handles,...arrival,end],startHeading,endHeading);
    const gradeLimit=railApproaches?4:MAX_GRADE;
    let length=0;
    for(let i=0;i<path.length;i++){
      const p=path[i];
      if(i)length+=distance(path[i-1],p);
      p.d=length;
      p.ground=(valley.designGround??meshGround)(p.x,p.y);
      p.water=valley.wet(p.x,p.y);
    }
    const bridgeClearance=.20;
    const levels=[{z:start.z},...edits.vips,{z:end.z}];
    const design=verticalDesign(levels,length,heightScale,startGrade,endGrade,railApproaches);
    const maxGrade=Math.max(...design.grades.map(g=>Math.abs(g)))*heightScale/WORLD_METRES*100;
    let cut=0,fill=0,waterLength=0,maxEarthwork=0,previous=null;
    for(let i=0;i<path.length;i++){
      const p=path[i];
      p.z=design.elevation(p.d);
      p.bridge=p.water||(valley.biome?.(p.x,p.y)==='western'&&p.z-p.ground>=.48);
      const next=path[Math.min(i+1,path.length-1)],prev=path[Math.max(i-1,0)];
      const n=distance(prev,next)||1;p.dx=(next.x-prev.x)/n;p.dy=(next.y-prev.y)/n;
      const ds=(i?p.d-path[i-1].d:0)*WORLD_METRES;
      p.works=p.bridge?{left:FORMATION,right:FORMATION,cut:0,fill:0}:sectionEarthwork(valley.designGround??meshGround,p,heightScale);
      maxEarthwork=Math.max(maxEarthwork,(p.works.left+p.works.right)*WORLD_METRES);
      if(previous){
        if(p.bridge||path[i-1].bridge)waterLength+=ds*(p.bridge&&path[i-1].bridge?1:.5);
        cut+=(p.works.cut+previous.cut)*.5*ds*WORLD_METRES*heightScale;
        fill+=(p.works.fill+previous.fill)*.5*ds*WORLD_METRES*heightScale;
      }
      previous=p.works;
    }
    const issue=maxGrade>gradeLimit+.001?'Reduce the steepest grade to '+gradeLimit+'% or less.':
      !design.fits?'Shorten a radius, space out the VIPs, or reduce the grade change.':
      path.some(p=>p.water&&p.z<bridgeClearance-.001)?'Raise the profile so the bridge clears the water.':'';
    return {path,levels,design,length,maxGrade,cut,fill,waterLength,maxEarthwork,issue};
  }

  function stationEarthwork(s){
    let cut=0,fill=0;
    for(let u=-2;u<=2;u+=.16)for(let v=-2;v<=2;v+=.16){
      const x=s.x-u*s.ny+v*s.nx,y=s.y+u*s.nx+v*s.ny;
      const outside=Math.hypot(Math.max(0,Math.abs(u)-.70),Math.max(0,Math.abs(v)-.48));
      if(!onLand({x,y}))continue;
      const g=meshGround(x,y),diff=g-designTerrain(g,s.z,outside,WORLD_METRES/(2*heightScale),0);
      const volume=diff*heightScale*(.16*WORLD_METRES)**2;
      if(volume>0)cut+=volume;else fill-=volume;
    }
    if(s.tie){
      const d=distance(s,s.tie),dx=(s.tie.x-s.x)/d,dy=(s.tie.y-s.y)/d;
      for(let t=.54;t<d;t+=.18){
        const area=sectionEarthwork(meshGround,{x:s.x+dx*t,y:s.y+dy*t,z:lerp(s.z,s.tie.z,t/d),dx,dy},heightScale);
        cut+=area.cut*.18*WORLD_METRES**2*heightScale;
        fill+=area.fill*.18*WORLD_METRES**2*heightScale;
      }
    }
    return {cut,fill};
  }

  function estimateCost({length=0,cut=0,fill=0,waterLength=0,stations=0,buildings=0,streets=0}){
    const regional=getValley().region==='mixed';
    const roadsAndBridges=(length*WORLD_METRES*310+waterLength*1450)*(regional?.27:1);
    const earthworks=(cut*12+fill*17)*(regional?.12:1);
    return Math.round(roadsAndBridges+earthworks+
      stations*18000+buildings*8500+streets*3000);
  }

  const quantity=n=>Math.round(n).toLocaleString('en-GB');

  const fitScale=()=>Math.min(map.clientWidth/(bounds.east-bounds.west+7),map.clientHeight/(bounds.south-bounds.north+7));
  const screen=p=>({x:map.clientWidth/2+(p.x-camera.x)*scaleHint,y:map.clientHeight/2+(p.y-camera.y)*scaleHint});
  const world=p=>({x:camera.x+(p.x-map.clientWidth/2)/scaleHint,y:camera.y+(p.y-map.clientHeight/2)/scaleHint});
  const position=(e,canvas=map)=>pointerAt(e,canvas);
  function focus(x,y,zoom){camera.x=x;camera.y=y;camera.zoom=zoom;request();}
  function pathTo(context,points){tracePath(context,points,screen);}
  function line(points,tint,width){
    if(!points.length)return;
    pathTo(ctx,points);ctx.strokeStyle=tint;ctx.lineWidth=width;ctx.stroke();
  }
  function area(points,tint){
    pathTo(ctx,points);ctx.closePath();ctx.fillStyle=tint;ctx.fill();
  }
  function dot(p,r,tint,index){
    const q=screen(p);ctx.beginPath();ctx.arc(q.x,q.y,r,0,Math.PI*2);ctx.fillStyle=tint;ctx.fill();
    if(index!==undefined){ctx.fillStyle='white';ctx.textAlign='center';ctx.font='bold 11px system-ui';ctx.fillText(index,q.x,q.y+4);}
  }
  function mapText(p,text,tint='#224a3c'){
    const q=screen(p);ctx.font='bold 13px system-ui';ctx.textAlign='center';ctx.lineWidth=4;
    ctx.strokeStyle='#fff9e5';ctx.strokeText(text,q.x,q.y);ctx.fillStyle=tint;ctx.fillText(text,q.x,q.y);
  }
  function drawTerrain(){
    renderTerrain({ctx,width:map.clientWidth,height:map.clientHeight,valley:getValley(),bounds,view:camera,scaleHint,screen,world,detail:step===1||step===2});
  }

  function arrow(from,to,label){
    drawDirection(ctx,screen,map.clientWidth,map.clientHeight,from,to,label);
  }

  const drawStationAsset=createStationPainter(stationFaces,area);
  function drawGates(station,side,local,tie,invalid=false){
    for(const item of availableGates(station,local)){
      const {gate}=item,point=along(gate,gate.dx,gate.dy,.18);
      dot(point,item.side===side?14:10,item.side===side?'#287967':item.suggested?'#467780':'#756d56',
        edgeNames[item.side][0]);
    }
    if(tie){dot(tie,17,invalid?'#ab5544':'#287967','↔');}
  }
  function activeStation(){
    return !stationEdit&&(step===1||step===2)?draft.stations[step-1]:null;
  }
  function routeEdges(station){
    const bay=draftBay(station);
    const front=bay.detached?null:station.tie?(station.accessSide??0):null;
    return edgeNames.map((name,side)=>{
      const gate=stationEdge(bay,side);
      return {side,name,point:along(gate,gate.dx,gate.dy,.17),reserved:side===front};
    });
  }
  function drawRouteEdges(station){
    for(const item of routeEdges(station)){
      const active=item.side===portSide(station);
      dot(item.point,active?15:11,item.reserved?'#706e59':active?'#275d9a':'#4a737d',item.name[0]);
    }
  }
  function gateHit(station,point,local){
    return availableGates(station,local).find(({gate})=>distance(point,screen(along(gate,gate.dx,gate.dy,.18)))<19);
  }
  function drawStation(s,index,active=false){
    const issue=active&&stationIssue(s,index);
    if(active){
      drawStationAsset(s);
      for(const bay of layoutBays(s)){
        if(bay.x!==s.x||bay.y!==s.y)drawStationAsset(bay);
        dot(bay,11,bay.id===(s.selectedBay??'1')?'#295b8d':'#234f40',bay.id);
      }
    }else area(stationFootprint(s),'#d3aa63');
    const border=stationFootprint(s);line([...border,border[0]],issue?'#8e3529':'#314e42',2);
    if(s.tie){
      const start=along(s,s.nx,s.ny,STATION_HALF_DEPTH);
      const access=s.driveway??[start,s.tie];
      line(access,'#f8e7b2',Math.max(3,.42*scaleHint));
      line(access,'#247756',Math.max(2,.24*scaleHint));
      dot(s.tie,active?4:2.5,'#205440');
      if(active)mapText(s.tie,s.millBay?'Industry access':'Town access');
    }
    const exit=approach(s);
    dot(exit,active?5:3,'#305875');
    if(active){
      const direction=heading(s);
      mapText(along(exit,direction.x,direction.y,.57),'Route road');
      const other=draft.stations[1-index]??draft.picks[1-index];
      if(other)arrow(s,other,'To '+roadName(cityFor(draft.picks[1-index])));
    }
    else dot(s,9,'#234f40',index+1);
    if(active)drawRouteEdges(s);
  }

  let railMapRuns=null,railMapPaths=[];
  function drawBuiltTracks(valley){
    // Runs are rebuilt whenever the track layout or platforms change.
    if(railMapRuns!==valley.truckRuns){
      railMapRuns=valley.truckRuns;
      railMapPaths=Object.values(valley.transport.railTracks??{}).flatMap(track=>
        ContourRail.trackLines(track,valley.transport).lines.map(lane=>lane.points));
    }
    ctx.save();
    ctx.lineCap='butt';
    for(const points of railMapPaths){
      line(points,'#f2e9cb',Math.max(4,.22*scaleHint));
      line(points,'#50473e',Math.max(2,.13*scaleHint));
      ctx.setLineDash([1.5,Math.max(3,.13*scaleHint)]);
      line(points,'#5f554a',Math.max(5,.26*scaleHint));
      ctx.setLineDash([]);
    }
    ctx.restore();
  }

  function drawBuiltBays(valley,width,height){
    for(const base of valley.builtStations){
      if(stationEdit&&choiceKey(base)===choiceKey(stationEdit.base))continue;
      if(base.mode==='rail'){
        const tracks=ContourRail.stationTrackCount(base,valley.transport);
        if(scaleHint>=8)drawStationAsset(base,false,tracks);
        else area(stationFootprint(base,0,tracks),'#5f554a');
        continue;
      }
      const bays=layoutBays(base);
      for(const bay of bays.length?bays:[base]){
        const q=screen(bay);
        if(q.x< -30||q.y< -30||q.x>width+30||q.y>height+30)continue;
        line(ContourTown.stationDrive(base,bay),'#687c70',Math.max(2,.32*scaleHint));
        if(scaleHint>=8)drawStationAsset(bay);
        else area(stationFootprint(bay),'#274e53');
        if(scaleHint>=14&&bays.length>1)dot(bay,8,'#284f56',bay.id);
      }
    }
  }

  function drawMap(){
    frame=0;
    if(!draft||root.hidden)return;
    const w=map.clientWidth,h=map.clientHeight;
    if(!w||!h)return;
    const ratio=Math.min(window.devicePixelRatio||1,2);
    if(map.width!==Math.round(w*ratio)||map.height!==Math.round(h*ratio)){map.width=Math.round(w*ratio);map.height=Math.round(h*ratio);}
    ctx.setTransform(ratio,0,0,ratio,0,0);
    ctx.lineCap='round';ctx.lineJoin='round';
    scaleHint=fitScale()*camera.zoom;drawTerrain();
    const valley=getValley();
    const current=step===1||step===2?draft.stations[step-1]:null;
    const lost=new Set(preview?.lots.map(l=>l.key)??[]);
    const served=new Set(current?valley.market.catchment(current).map(l=>current.place+':'+l.id):[]);
    const roadConflicts=new Set(conflicts(current).map(r=>r.key));
    const lots=houses();
    for(const lot of lots)if(current&&!current.shared&&impactedByStation(lot,current))lost.add(lot.key);
    drawTownMap({ctx,screen,line,scaleHint,w,h,valley,lots,roads:cityRoads(false),lost,served,
      roadConflicts,deleted:new Set(draft.deleted)});
    for(const site of [...industries(),...(valley.publicDepots??[])]){
      const yard=(x,y)=>({x:site.x+x,y:site.y+y});
      area([yard(-site.halfWidth,-site.halfDepth),yard(site.halfWidth,-site.halfDepth),
        yard(site.halfWidth,site.halfDepth),yard(-site.halfWidth,site.halfDepth)],'#b98e62');
      if((step===1||step===2)&&draft.picks[step-1].city===site.id){
        for(const bay of loadingBays(site)){
          const available=!stationIssue(bay,step-1);
          line([bay,bay.tie],available?'#f8d68a':'#a36d5a',Math.max(2,.25*scaleHint));
          dot(bay,5,available?'#256f5a':'#a4493e');
        }
        mapText(yard(0,-1.8),site.name);
      }
    }
    if(step===1||step===2){
      existingStations(step-1).forEach((s,i)=>{
        if(s.shared)line(s.shared.points,'#398676',Math.max(2,.32*scaleHint));
        dot(s,10,'#246f63',i+1);
        if(!current||choiceKey(current)!==choiceKey(s))for(const bay of layoutBays(s)){
          if(bay.x===s.x&&bay.y===s.y)continue;
          drawStationAsset(bay);dot(bay,10,'#28567b',bay.id);
        }
      });
    }
    if(step===0){
      const origin=draft.picks.length===1?cityFor(draft.picks[0]):null;
      for(const city of places()){
        const eligible=origin&&valley.market.trade(origin,city);
        if(origin&&city!==origin&&!eligible){dot(city,3,'#787d70');continue;}
        if(eligible)dot(city,9,'#e8f6cf');
        dot(city,eligible?6:isIndustry(city.id)?4:5,isIndustry(city.id)?'#965d37':'#345c46');
        if(!isIndustry(city.id)||camera.zoom>1.8||draft.picks.some(p=>p.city===city.id)){
          mapText({x:city.x,y:city.y-2.7},city.name);
        }
      }
      draft.picks.forEach((p,i)=>dot(p,11,'#215b48',i+1));
    }
    if(preview?.network){
      const reused=preview.network.legs?.filter(leg=>!leg.built).map(leg=>leg.path)??
        [preview.network.through,preview.network.first,preview.network.last,...(preview.network.pieces??[]).map(piece=>piece.path)];
      for(const points of reused)line(points,'#398676',Math.max(5,.37*scaleHint));
      if(draft.roadMode==='mixed')for(const [i,p] of (draft.joins??[]).entries())dot(p,9,'#30664b',i===0?'A':'B');
    }
    drawBuiltTracks(valley);
    drawBuiltBays(valley,w,h);
    for(const [index,section] of (preview?.sections??[]).entries()){
      const {path}=section;if(path.length<2)continue;
      const active=!reuseStretch()||index===(draft.link??0);
      for(let i=1;i<path.length;i++){
        const a=path[i-1],b=path[i];if(a.bridge||b.bridge)continue;
        for(const [side,sign] of [['left',-1],['right',1]]){
          const aw=a.works[side],bw=b.works[side],offset=(p,n)=>along(p,-p.dy,p.dx,sign*n);
          const middle=offset(b,(FORMATION+bw)/2),g=(valley.designGround??meshGround)(middle.x,middle.y);
          area([offset(a,FORMATION),offset(a,aw),offset(b,bw),offset(b,FORMATION)],g>b.z?'#a7593264':'#6d785c67');
        }
      }
      line(path,'#f9e2a7',Math.max(6,.49*scaleHint));
      line(path,section.issue?'#a8493c':active?'#1f6c79':'#526d86',Math.max(3,.34*scaleHint));
      for(let i=1;i<path.length;i++)if(path[i].bridge)line(path.slice(i-1,i+1),'#704bac',4);
    }
    for(const access of valley.transport.stationAccesses??[]){
      if(!stationEdit||access.baseKey!==choiceKey(stationEdit.base))line(access.points,'#6e9c79',Math.max(2,.30*scaleHint));
    }
    if(stationEdit)drawStationLayout();
    draft.stations.forEach((s,i)=>{
      if(!s)return;
      if(step<3){drawStation(s,i,step===i+1);return;}
      if(s.sideBay)drawStationAsset(s.sideBay);
      const bay=draftBay(s);
      if(!s.shared&&!s.existingBay)drawStationAsset(s);
      const border=stationFootprint(bay);
      line([...border,border[0]],'#fff0be',2);
    });
    const legs=preview?.network?.legs,through=preview?.network?.through;
    if(step>=3&&(legs?.length||through?.length)){
      const start=through?.[0]??legs[0].path[0],end=through?.at(-1)??legs.at(-1).path.at(-1);
      for(const [port,label] of [[start,'Origin bay'],[end,'Destination bay']]){
        dot(port,5,'#152e35');mapText({x:port.x,y:port.y-19/scaleHint},label);
      }
    }
    if(step===3){
      if(!draft.pick&&preview?.design)alignment().handles.forEach((p,i)=>dot(p,selected===i?10:8,selected===i?'#a06427':'#245675',i+1));
      for(const {stretch,end,point} of tieHandles()){
        if(stretch===draft.selectedStretch)dot(point,20,'#f1e9ba');
        const unused=preview?.network?.legs&&!preview.network.legs.some(({path})=>nearest(point,path).distance<.06);
        dot(point,16,unused?'#576158':'#246552',(stretch+1)+(end?'B':'A'));
      }
      if(draft.pick?.start)dot(draft.pick.start,16,'#246552','A');
    }
    if(step===3&&!$('rbProfileWrap').hidden&&preview?.design)drawProfile();
    drawProfileLens();
  }

  function profileScale(){
    const values=preview.path.flatMap(p=>[p.ground,p.z]).concat(preview.levels.map(p=>p.z));
    const min=profileDrag?.scale.min??Math.min(...values)-.12;
    const max=profileDrag?.scale.max??Math.max(...values)+.20;
    const w=section.clientWidth,h=section.clientHeight;
    return {min,max,w,h,left:35,right:w-13,top:10,bottom:h-22};
  }

  function drawProfile(){
    const c=section.getContext('2d'),g=profileScale(),ratio=Math.min(window.devicePixelRatio||1,2);
    const {x,y}=drawProfileBase({canvas:section,c,g,ratio,path:preview.path,length:preview.length,heightScale});
    c.setLineDash([3,4]);c.beginPath();
    c.moveTo(x(0),y(preview.levels[0].z));
    preview.design.curves.forEach(p=>c.lineTo(x(p.d/preview.length),y(p.z)));
    c.lineTo(x(1),y(preview.levels.at(-1).z));
    c.lineWidth=1;c.strokeStyle='#607d8a';c.stroke();c.setLineDash([]);
    const design=preview.design;
    drawVerticalLine(c,d=>x(d/preview.length),y,0,preview.length,180,2.8);
    design.curves.forEach((p,i)=>{
      const station=i===0||i===design.curves.length-1;
      c.beginPath();c.arc(x(p.d/preview.length),y(p.z),station?3:alignment().vip===i-1?7:5,0,Math.PI*2);
      c.fillStyle=station?'#706c60':alignment().vip===i-1?'#674e97':'#285e73';c.fill();
    });
    c.fillText('0',g.left,g.h-5);
    c.textAlign='right';c.fillText((preview.length*WORLD_METRES/1000).toFixed(2)+' km',g.right,g.h-5);c.textAlign='left';
  }
  function drawVerticalLine(context,x,y,start,end,samples,width){
    drawProfileCurve(context,x,y,start,end,samples,width,preview.design,heightScale,MAX_GRADE);
  }

  function drawProfileLens(){
    if(!profileDrag||step!==3||!preview?.design){lens.hidden=true;return;}
    const g=profileScale();
    const point=preview.design.curves[profileDrag.index+1];
    if(!point){lens.hidden=true;return;}
    lens.hidden=false;
    const w=lensCanvas.clientWidth,h=lensCanvas.clientHeight,ratio=Math.min(window.devicePixelRatio||1,2);
    const rect=section.getBoundingClientRect(),bounds=root.getBoundingClientRect();
    const finger=profileDrag.pointer;
    lens.style.left=clamp(rect.left+finger.x-w/2,bounds.left+6,bounds.right-w-8)+'px';
    lens.style.top=Math.max(bounds.top+6,rect.top+finger.y-lens.offsetHeight-28)+'px';
    if(lensCanvas.width!==Math.round(w*ratio)||lensCanvas.height!==Math.round(h*ratio)){
      lensCanvas.width=Math.round(w*ratio);lensCanvas.height=Math.round(h*ratio);
    }
    const context=lensCanvas.getContext('2d');
    context.setTransform(ratio,0,0,ratio,0,0);
    context.clearRect(0,0,w,h);
    const horizontal=3*(g.right-g.left)/preview.length,vertical=3*(g.bottom-g.top)/(g.max-g.min);
    const x=d=>w/2+(d-point.d)*horizontal,y=z=>h/2-(z-point.z)*vertical;
    context.strokeStyle='#d6ddcc';context.lineWidth=1;context.beginPath();
    context.moveTo(w/2,0);context.lineTo(w/2,h);
    context.moveTo(0,h/2);context.lineTo(w,h/2);context.stroke();
    const start=Math.max(0,point.d-w/2/horizontal),end=Math.min(preview.length,point.d+w/2/horizontal);
    const path=preview.path;
    context.strokeStyle='#8c7f55';context.lineWidth=2;context.beginPath();
    path.forEach((p,i)=>i?context.lineTo(x(p.d),y(p.ground)):context.moveTo(x(p.d),y(p.ground)));
    context.stroke();
    drawVerticalLine(context,x,y,start,end,100,3);
    context.fillStyle='#674e97';
    for(const curve of preview.design.curves){
      if(!curve.half)continue;
      for(const d of [curve.d-curve.half,curve.d+curve.half]){
        if(d<start||d>end)continue;
        context.beginPath();context.arc(x(d),y(preview.design.elevation(d)),2.3,0,Math.PI*2);context.fill();
      }
    }
    const upper=path.findIndex(p=>p.d>=point.d),a=path[Math.max(0,upper-1)],b=path[upper]??path.at(-1);
    const ground=lerp(a.ground,b.ground,(point.d-a.d)/(b.d-a.d||1));
    const delta=(preview.design.elevation(point.d)-ground)*heightScale;
    context.beginPath();context.arc(w/2,h/2,4,0,Math.PI*2);
    context.fillStyle='#fffbed';context.fill();context.strokeStyle='#674e97';context.lineWidth=1.5;context.stroke();
    $('rbProfileLensReadout').textContent='3× · Grade vs ground '+(delta>=.05?'+':'')+(Math.abs(delta)<.05?'0.0':delta.toFixed(1))+' m';
  }

  function request(){if(!frame)frame=requestAnimationFrame(drawMap);}

  function saveDraft(){
    if(!draft||stationEdit)return;
    try{localStorage.setItem(saveKey(),JSON.stringify({draft,step,selected,camera}));}catch{}
  }
  window.addEventListener('pagehide',saveDraft);
  document.addEventListener('visibilitychange',()=>{if(document.hidden)saveDraft();});
  let profileOpen=false;
  $('rbToggleProfile').onclick=()=>{profileOpen=!profileOpen;refresh();};
  function refresh(){
    saveDraft();
    $('rbUpgradeTools').hidden=!stationEdit;
    $('rbCargo').hidden=true;
    if(stationEdit){refreshUpgrade();return;}
    $('rbUndo').hidden=$('rbRedo').hidden=false;
    preview=step>=3?profile():null;
    const [a,b]=draft.picks;
    const station=step===1||step===2?draft.stations[step-1]:null;
    $('rbStep').textContent=(step+1)+'/5';
    $('rbTitle').textContent=['Choose endpoints','Place origin station','Place destination station',
      'Align and grade the road','Review route'][step];
    $('rbCity').hidden=step!==0;
    $('rbStationTools').hidden=step!==1&&step!==2;
    const choices=step===1||step===2?existingStations(step-1):[];
    const picker=$('rbExistingStation');
    picker.hidden=!choices.length;
    if(picker.options.length!==choices.length+1||choices.some((s,i)=>picker.options[i+1]?.value!==choiceKey(s))){
      picker.replaceChildren(new Option('Build a new station',''),...choices.map((s,i)=>
        new Option((s.bayUse==='load'?'Loading bay':s.bayUse==='unload'?'Unloading bay':'Existing bay')+' '+(i+1),choiceKey(s))));
    }
    picker.value=station?.shared||station?.existingBay?choiceKey(station):'';
    const planned=$('rbPlannedBay'),bays=station?layoutBays(station):[];
    planned.hidden=!bays.length;
    if(bays.length){
      const plan=trade(),place=cityFor(draft.picks[step-1]),need=plan?.cargo==='passengers'?'both':plan?.from===place?'load':'unload';
      planned.replaceChildren(...bays.filter(bay=>eligibleBay(bay,{need}))
        .map(bay=>new Option('Bay '+bay.id+' · '+bayRole[bay.bayUse],bay.id)));
      planned.value=station.selectedBay??'1';
    }
    const bayButton=$('rbBayMode');
    bayButton.hidden=!station||station.shared||station.existingBay||isIndustry(station.place);
    bayButton.textContent=station?.sideBay?'Remove second bay':station?.shared||station?.existingBay?'Add new bay to station':'Add second bay';
    $('rbDelete').hidden=(step===1||step===2)&&isIndustry(draft.picks[step-1].city);
    $('rbStationGates').hidden=!station;
    $('rbPreviewAccess').hidden=true;
    if(station){
      const existing=station.shared||station.existingBay;
      setEdgeOptions(routeEdges(station),existing?station.routeSide:portSide(station),'Route road edge',
        existing?'Auto · find existing access':'Choose an edge',Boolean(existing));
    }
    $('rbRoadOptions').hidden=step!==3;
    $('rbRoadMode').hidden=Boolean(draft.pick)||!preview?.canReuse;
    $('rbRoadMode').textContent=preview?.automatic?'Design new road':'Use existing roads';
    $('rbAddStretch').textContent=draft.pick?'Cancel picking':'+ Reuse road';
    $('rbRemoveStretch').hidden=!reuseStretch()||Boolean(draft.pick);
    $('rbLinkTools').hidden=step!==3||!reuseStretch()||Boolean(draft.pick);
    const linkPicker=$('rbLinkSelect'),stretchPicker=$('rbStretchSelect');
    if(reuseStretch()&&linkPicker.options.length!==draft.links.length){
      linkPicker.replaceChildren(...draft.links.map((_,i)=>new Option(linkName(i),i)));
      stretchPicker.replaceChildren(...draft.stretches.map((_,i)=>new Option('Stretch '+(i+1),i)));
    }
    linkPicker.value=String(draft.link??0);
    stretchPicker.value=String(draft.selectedStretch??0);
    const reusedLink=Boolean(preview?.network?.links?.[draft.link??0]?.length);
    $('rbBuildLink').hidden=!reusedLink&&!alignment().buildNew;
    $('rbBuildLink').textContent=reusedLink?'Build new link':'Use auto link';
    $('rbCurveTools').hidden=step!==3||!preview?.design||Boolean(draft.pick);
    const canProfile=step===3&&Boolean(preview?.design)&&!draft.pick;
    $('rbToggleProfile').hidden=!canProfile;
    $('rbToggleProfile').setAttribute('aria-expanded',String(profileOpen&&canProfile));
    $('rbProfileWrap').hidden=!canProfile||!profileOpen;
    const vip=alignment().vips[alignment().vip];
    $('rbRadius').disabled=!vip;
    $('rbRemoveVip').disabled=!vip;
    $('rbRadius').value=String(vip?.radius??MIN_RADIUS);
    $('rbRadiusValue').textContent=vip?quantity(vip.radius)+' m':'Select a VIP';
    $('rbBack').hidden=step===0;
    $('rbNext').textContent=['Place stations','Confirm origin','Confirm destination','Review','Build route'][step];
    $('rbUndo').disabled=!undo.length;
    $('rbRedo').disabled=!redo.length;
    const blocking=conflicts(station);
    $('rbMarkConflicts').hidden=!blocking.length;
    if(blocking.length)$('rbSiteOptions').open=true;
    $('rbMarkConflicts').disabled=blocking.every(row=>protectedRoadKey(row.key));
    $('rbDelete').setAttribute('aria-pressed',String(deleteMode));
    $('rbRemoveBend').disabled=selected<0;
    let help='',issue='';
    if(step===0){
      help=a?'Tap a highlighted destination, or choose one from the list.':'Tap the starting town or industry, or use the list.';
      const service=trade();
      $('rbSummary').textContent=[a&&roadName(cityFor(a)),b&&roadName(cityFor(b))].filter(Boolean).join(' ↔ ');
      if(a&&b){
        if(!service)issue='These places cannot trade. Choose a customer that uses the supplier’s output.';
        else if(service.cargo==='passengers')help='Both towns selected. Continue to place the first station.';
        else{
          const [cargo,,level]=ContourRegion.goods[service.cargo];
          help=cargo+' · '+service.from.name+' → '+service.to.name+
            (!isIndustry(service.to.id)&&level>getValley().market.townProgress(service.to).level?' · Town demand opens at level '+level:'');
        }
        if(distance(a,b)<4&&!cityFor(a)?.depot&&!cityFor(b)?.depot)issue='Pick two locations at least 160 m apart.';
      }
      if(getValley().region){updateEndpointPicker();$('rbCity').hidden=Boolean(a&&b&&service);}
      const cargo=$('rbCargo'),options=choicesForPair();
      cargo.hidden=options.length<2;
      cargo.replaceChildren(...options.map(plan=>new Option((ContourRegion.goods[plan.cargo]?.[0]??'Passengers')+' · '+plan.from.name+' → '+plan.to.name,useKey(plan))));
      if(service)cargo.value=useKey(service);
    }else if(station||step===1||step===2){
      help=isIndustry(draft.picks[step-1].city)?'Tap a green bay to connect to an industry yard gate.':deleteMode?'Tap a town street to mark it for removal.':'Tap or drag the station. Choose a blue edge for the route road.';
      issue=stationIssue(station,step-1,blocking);
      if(station?.shared||station?.existingBay){
        $('rbSummary').textContent='Existing '+(isIndustry(station.place)?'loading bay':'station · '+getValley().market.catchment(station).length+' homes by road')+' · no bay construction cost';
        help='Tap a numbered bay, then confirm this station.';
      }else if(station){
        const lots=houses().filter(l=>impactedByStation(l,station)).length;
        const earth=stationEarthwork(station),entrance=station.driveway?routeLength(station.driveway):station.tie?distance(station,station.tie)-STATION_HALF_DEPTH:0;
        const cost=estimateCost({...earth,length:entrance,stations:1,buildings:lots,streets:blocking.length+draft.deleted.length});
        const pending=blocking.length?' · '+blocking.length+' street conflicts':'';
        $('rbSummary').textContent=(isIndustry(station.place)?'Industry loading bay':getValley().market.catchment(station).filter(l=>!impactedByStation(l,station)).length+' homes by road')+' · '+quantity(cost)+' cr station estimate · '+lots+' affected buildings'+pending+
          (draft.deleted.length?' · '+draft.deleted.length+' streets marked':'');
      }else $('rbSummary').textContent='';
    }else if(preview){
      help=step===3?profileOpen?'Tap the profile to add a grade change. Drag it to adjust its height.':'Drag a bend to shape the road. Open Elevation profile to adjust grades.':
        'Includes new construction and the first vehicle. Service starts on opening.';
      issue=preview.issue;
      if(step>=3&&preview.cost>getValley().market.state.cash)issue='Insufficient funds for this road.';
      if(step===4&&!issue){for(const station of draft.stations){
        if(!isIndustry(station.place)&&!getValley().market.catchment(station).some(l=>!preview.lots.some(x=>x.key===station.place+':'+l.id)))issue='A station has no surviving homes in range. Move it closer to town.';
      }}
      const km=n=>(n*WORLD_METRES/1000).toFixed(2)+' km';
      if(preview.network){
        const reusedPaths=preview.network.legs?.filter(leg=>!leg.built).map(leg=>leg.path)??
          [preview.network.through,preview.network.first,preview.network.last,...(preview.network.pieces??[]).map(piece=>piece.path)];
        const reused=reusedPaths.reduce((sum,path)=>sum+routeLength(path),0);
        $('rbSummary').textContent=preview.cost===undefined?(reuseStretch()?'Pick an existing road stretch':'Select connected road ties'):
          [quantity(preview.cost)+' cr',km(reused)+' reused',preview.totalNew?km(preview.totalNew)+' new':'',
            preview.totalNew?preview.maxGrade.toFixed(1)+'% max grade':'',
            preview.waterLength?quantity(preview.waterLength)+' m bridge':'',
            preview.lots.length?preview.lots.length+' buildings affected':''].filter(Boolean).join(' · ');
        if(reuseStretch())help=step===4?'Green shows the roads vehicles will use. Blue shows new construction.':
          reusedLink?'This link uses existing roads. Grey ties mark sections the route skips.':
          'Green is reused, blue is new. Drag a tie or select a new link to edit its bends and profile.';
        else help=preview.automatic?'Existing roads connect these bays. Choose Design new road for a different alignment.':
          draft.roadMode==='existing'?'Green shows the existing roads this service will use.':
          'Green is reused. Drag or add bends to shape the new section.';
      }else $('rbSummary').textContent=[quantity(preview.cost)+' cr',km(preview.length),preview.maxGrade.toFixed(1)+'% max grade',
        quantity(preview.cut)+' m³ cut',quantity(preview.fill)+' m³ fill',quantity(preview.maxEarthwork)+' m max earthwork width',
        preview.waterLength>0?quantity(preview.waterLength)+' m bridge':'',
        step===4?preview.lots.length+(preview.lots.length===1?' building and ':' buildings and ')+draft.deleted.length+' streets removed':''].filter(Boolean).join(' · ');
    }
    if(step===3&&draft.pick){
      issue='';
      help=draft.pick.start?'Tap the end of the stretch in the direction of travel.':'Tap the start of the stretch you want to reuse.';
    }
    $('rbHelp').textContent=removalNote||issue||help;
    $('rbHelp').classList.toggle('warning',Boolean(issue));
    $('rbNext').disabled=(step===0&&draft.picks.length<2)||Boolean(issue)||Boolean(step===3&&draft.pick);
    request();
  }

  function snapshot(){return {draft:structuredClone(draft),step,selected};}
  function record(before){
    if(!before||JSON.stringify(before.draft)===JSON.stringify(draft))return;
    undo.push(before);if(undo.length>64)undo.shift();redo=[];
    refresh();
  }
  function edit(change){
    const before=snapshot();change();record(before);
  }
  function restore(from,to){
    if(!from.length)return;
    to.push(snapshot());
    const state=from.pop(),changed=step!==state.step;
    draft=state.draft;selected=state.selected;
    if(changed){
      const current=selected;
      setStep(state.step);selected=current;refresh();
    }else refresh();
  }

  function selectEndpoint(p, city){
    const before=snapshot();
    if(draft.picks.length===2){draft.picks=[];draft.stations=[null,null];draft.handles=[];draft.vips=[];draft.deleted=[];delete draft.roadMode;delete draft.buildNewRoad;draft.stretches=[];draft.links=[];draft.link=0;draft.selectedStretch=0;draft.pick=null;}
    const nearestCity=city??places().reduce((best,t)=>distance(t,p)<distance(best??{x:Infinity,y:0},p)?t:best,null);
    if(!city&&nearestCity&&distance(nearestCity,p)>Math.max(3.7,13/scaleHint))return;
    if(!nearestCity)return;
    const chosen=nearestCity;
    if(chosen.x<bounds.west||chosen.x>bounds.east||chosen.y<bounds.north||chosen.y>bounds.south)return;
    if(draft.picks[0]?.city&&draft.picks[0].city===nearestCity?.id)return;
    draft.picks.push({x:chosen.x,y:chosen.y,city:nearestCity?.id??null});
    draft.freightChoice=null;
    record(before);
  }

  function setStep(next){
    if(next!==step){profileOpen=false;$('rbSiteOptions').open=false;}
    step=next;deleteMode=false;removalNote='';selected=-1;draft.choosingAccess=false;
    if(step===0)focus(0,0,1);
    else if(step===1||step===2){
      const s=draft.picks[step-1];
      draft.stations[step-1]??=suggest(step-1);
      const target=isIndustry(s.city)?s:draft.stations[step-1]??s;
      focus(target.x,target.y,getValley().region?22:9);
    }else{
      if(!draft.roadMode&&!reuseStretch())initializeAlignment();
      const [a,b]=draft.stations;
      const spanX=Math.max(10,Math.abs(a.x-b.x)+7),spanY=Math.max(10,Math.abs(a.y-b.y)+7);
      const zoom=clamp(Math.min(map.clientWidth/spanX,map.clientHeight/spanY)/fitScale(),1,7);
      focus((a.x+b.x)/2,(a.y+b.y)/2,zoom);
    }
    refresh();
  }

  function copyRoute(){
    const [origin,destination]=draft.stations;
    const network=preview.network;
    const first=network?.first??routeStub(origin),last=network?.last??[...routeStub(destination)].reverse();
    const routePoints=[],roadSections=[];
    function append(section,built=false){
      if(!section.length)return;
      const continuation=routePoints.at(-1);
      const sharesEnd=continuation&&distance(continuation,section[0])<1e-5&&Math.abs(continuation.z-section[0].z)<1e-5;
      const start=routePoints.length-(sharesEnd?1:0);
      routePoints.push(...(sharesEnd?section.slice(1):section));
      if(built&&routePoints.length-start>=2)roadSections.push([start,routePoints.length]);
    }
    if(reuseStretch()){
      for(const {path,built} of network.legs)append(path,built);
    }else if(network?.through.length)append(network.through);
    else{
      append(first);append(preview.path,true);append(last);
    }
    const points=routePoints.map(({x,y,z,dx,dy,bridge,water})=>
      ({x,y,z,dx,dy,bridge,water:water??getValley().wet(x,y)}));
    const approachLengths=draft.stations.map((station,i)=>{
      if(!network)return Math.min(1.5,routeLength(routeStub(station)));
      if(reuseStretch())return Math.min(1.5,routeLength(routeStub(station)));
      const path=(network.through.length&&!reuseStretch())?network.through:i?last:first;
      return Math.min(1.5,routeLength(path));
    });
    const service=trade();
    const routePorts=draft.stations.map((station,i)=>{
      const edge=network?.portEdges?network.portEdges[i]:routeEdge(station);
      return edge==null?null:{edge};
    });
    return {capital:preview.cost,cargo:service?.cargo,cargoFrom:service?.from.id,stations:draft.stations.map(({shared,sideBay,existingBay,selectedBay,routeSide,...s})=>s),routePorts,stationBays:draft.stations.map(s=>s.selectedBay??'1'),
      stationLayouts:Object.fromEntries(draft.stations.filter(s=>s.sideBay).map(s=>{
        const {x,y,z,nx,ny,place,name,millBay}=s;
        return [choiceKey(s),{bays:[{x,y,z,nx,ny,place,name,millBay,id:'1',bayUse:'both'},s.sideBay],nextId:3}];
      })),
      points,approachLengths,roadKeys:network?.keys,roadSections};
  }

  function chooseStation(station){
    draft.stations[step-1]=station;draft.choosingAccess=false;
    draft.handles=[];draft.vips=[];draft.vip=-1;if(reuseStretch())draft.links[step===1?0:draft.links.length-1]=blankLink();refresh();
  }

  function place(p){
    const i=step-1, old=draft.stations[i];
    const s=stationAt({x:snap(p.x),y:snap(p.y)},i);
    if(!s||old&&old.x===s.x&&old.y===s.y&&old.tie?.key===s.tie?.key)return;
    draft.stations[i]=s;
    draft.handles=[];draft.vips=[];if(reuseStretch())draft.links[step===1?0:draft.links.length-1]=blankLink();refresh();
  }

  function reviseTies(){
    for(let i=0;i<2;i++)if(draft.stations[i]){
      const p=draft.stations[i];
      if(!p.shared&&!p.existingBay){
        const next=stationAt(p,i);
        if(next)draft.stations[i]={...next,sideBay:p.sideBay,routeSide:p.routeSide,selectedBay:p.selectedBay};
      }
    }
    draft.handles=[];draft.vips=[];
    if(reuseStretch())draft.links=draft.links.map(()=>blankLink());
    refresh();
  }

  function setEdgeOptions(edges,side,label,placeholder='Choose an edge',allowAuto=false){
    const picker=$('rbStationEdge');
    picker.setAttribute('aria-label',label);
    for(const edge of edges){
      const option=picker.options[edge.side];
      option.disabled=Boolean(edge.reserved);
      option.textContent=edge.name+' edge'+(edge.reserved?' · town / industry access':'');
    }
    picker.options[4].textContent=placeholder;
    picker.options[4].disabled=!allowAuto;
    picker.value=String(side??'');
  }
  function chooseRouteEdge(side){
    const station=activeStation();
    if(!station||routeEdges(station)[side]?.reserved)return;
    edit(()=>{
      station.routeSide=side;
      const index=step-1;
      draft.handles=[];draft.vips=[];draft.vip=-1;
      if(reuseStretch())draft.links[index===0?0:draft.links.length-1]=blankLink();
    });
  }
  function chooseAccessEdge(side){
    const tool=stationEdit?.tool;
    if(!tool?.access)return;
    const bay=selectedStationBay(),candidate=availableGates(bay,false)[side].suggested;
    tool.side=side;
    tool.candidate=candidate&&!accessInUse(candidate.tie)?candidate:null;
    stationEdit.issue='';
    refresh();
  }
  function retieAccess(p,fixedRoad){
    const tool=stationEdit?.tool;
    if(!tool?.access||tool.side==null)return;
    const bay=selectedStationBay(),tie=nearestAccessRoad(bay,p,false,fixedRoad);
    if(!tie){
      if(!fixedRoad){stationEdit.issue='Tap an existing road close to this bay.';refresh();}
      return;
    }
    const access=roadAccess(bay,tool.side,tie);
    tool.candidate={tie,...access};
    stationEdit.issue=access.issue;
    refresh();
  }
  $('rbStationEdge').onchange=e=>{
    if(e.target.value===''){
      if(!stationEdit)chooseRouteEdge(undefined);
      return;
    }
    const side=Number(e.target.value);
    if(stationEdit)chooseAccessEdge(side);
    else chooseRouteEdge(side);
  };
  function tap(e){
    const p=world(position(e));
    if(stationEdit){selectUpgrade(p);return;}
    if(step===0){selectEndpoint(p);return;}
    if(step===1||step===2){
      const station=activeStation();
      const gate=station&&routeEdges(station).find(item=>distance(position(e),screen(item.point))<18);
      if(!deleteMode&&gate){chooseRouteEdge(gate.side);return;}
      if(!deleteMode){
        const candidates=station?[station,...existingStations(step-1)]:existingStations(step-1);
        const picked=candidates.flatMap(base=>layoutBays(base).map(bay=>({base,bay})))
          .find(({bay})=>hitsStation(p,bay,.10));
        if(picked){
          const routeSide=station?.selectedBay===picked.bay.id&&choiceKey(station)===choiceKey(picked.base)?station.routeSide:undefined;
          edit(()=>chooseStation({...picked.base,selectedBay:picked.bay.id,routeSide}));return;
        }
      }
      if(deleteMode){
        const hit=roadNear(p,Math.max(.24,15/scaleHint));
        if(hit&&protectedRoadKey(hit.key)){
          removalNote='This street serves a station on a built route.';refresh();
        }else if(hit)edit(()=>{removalNote='';draft.deleted.push(hit.key);reviseTies();});

      }else{
        const shared=existingStations(step-1).sort((a,b)=>distance(a,p)-distance(b,p))[0];
        edit(()=>shared&&distance(shared,p)<Math.max(.55,11/scaleHint)?chooseStation(shared):place(p));
      }
      return;
    }
    if(step===3&&draft.pick){pickRoadPoint(p);return;}
    if(step===3&&reuseStretch()&&preview?.sections){
      const nearestLink=preview.sections.map(({path})=>nearest(p,path).distance);
      const index=nearestLink.indexOf(Math.min(...nearestLink));
      if(index!==(draft.link??0)&&nearestLink[index]<20/scaleHint){selectLink(index);return;}
    }
    if(step===3&&preview?.design&&alignment().handles.length<9&&p.x>bounds.west&&p.x<bounds.east&&p.y>bounds.north&&p.y<bounds.south){
      const path=preview.path;
      let nearestPoint=0,best=Infinity;
      for(let i=0;i<path.length;i++)if(distance(p,path[i])<best){best=distance(p,path[i]);nearestPoint=i;}
      if(nearestPoint===0||nearestPoint===path.length-1||reuseStretch()&&best>20/scaleHint)return;
      const fractions=alignment().handles.map(handle=>{
        let closest=path[0];
        for(const point of path)if(distance(handle,point)<distance(handle,closest))closest=point;
        return closest.d;
      });
      const i=fractions.findIndex(d=>d>path[nearestPoint].d);
      selected=i<0?fractions.length:i;
      edit(()=>alignment().handles.splice(selected,0,p));
    }
  }

  function close(keep=false){
    if(keep)saveDraft();
    else if(!stationEdit)try{localStorage.removeItem(saveKey());}catch{}
    if(!stationEdit)$('newRoute').textContent=keep?'Resume route':'New route';
    if(history.state?.roadEditor)history.back();
    draft=null;stationEdit=null;preview=null;cursor.clear();undo=[];redo=[];gestureEdit=null;profileDrag=null;resetProfileGesture();lens.hidden=true;
    root.hidden=true;
    $('app').inert=false;$('newRoute').focus();
    finish?.();
  }

  function zoom(factor,p){
    const before=world(p),next=clamp(camera.zoom*factor,.85,36);
    camera.x=before.x-(p.x-map.clientWidth/2)/(fitScale()*next);
    camera.y=before.y-(p.y-map.clientHeight/2)/(fitScale()*next);camera.zoom=next;
    request();
  }

  map.addEventListener('pointerdown',e=>{
    if(!draft||e.button!==0)return;
    const p=position(e);
    cursor.set(e.pointerId,p);map.setPointerCapture(e.pointerId);
    if(cursor.size>1){record(gestureEdit);gestureEdit=null;pressed=null;dragging=null;return;}
    pressed={id:e.pointerId,p,moved:false};
    const tie=stationEdit?.tool?.candidate?.tie;
    if(tie?.key&&distance(p,screen(tie))<=22){
      dragging={accessRoad:tie.key};gestureEdit=stationEdit?null:snapshot();return;
    }
    if(stationEdit)return;
    if(step===3&&!draft.pick){
      const tie=tieHandles().map(item=>({...item,gap:distance(p,screen(item.point))}))
        .filter(item=>item.gap<=22).sort((a,b)=>a.gap-b.gap)[0];
      if(tie){
        gestureEdit=snapshot();dragging=tie;draft.selectedStretch=tie.stretch;
        draft.link=tie.stretch+tie.end;selected=-1;refresh();return;
      }
      const hit=preview?.design?alignment().handles.findIndex(s=>distance(p,screen(s))<18):-1;
      if(hit>=0){selected=hit;dragging='bend';gestureEdit=snapshot();refresh();}
    }else if((step===1||step===2)&&!deleteMode){
      const s=draft.stations[step-1];
      if(s&&!s.shared&&!s.existingBay&&distance(p,screen(s))<Math.max(18,.56*scaleHint)){dragging='station';gestureEdit=snapshot();}
    }
  });
  map.addEventListener('pointermove',e=>{
    const before=cursor.get(e.pointerId);if(!draft||!before)return;
    const p=position(e),dx=p.x-before.x,dy=p.y-before.y;
    const other=[...cursor].find(([id])=>id!==e.pointerId)?.[1];
    cursor.set(e.pointerId,p);
    if(other){
      if(cursor.size===2&&distance(before,other)>8)zoom(distance(p,other)/distance(before,other),{x:(before.x+other.x)/2,y:(before.y+other.y)/2});
      return;
    }
    if(!pressed||pressed.id!==e.pointerId)return;
    if(!pressed.moved&&distance(pressed.p,p)<5)return;
    pressed.moved=true;
    if(dragging==='bend'){
      const point=world(p);
      point.x=clamp(point.x,bounds.west+.1,bounds.east-.1);point.y=clamp(point.y,bounds.north+.1,bounds.south-.1);
      alignment().handles[selected]=point;refresh();
    }else if(dragging==='station')place(world(p));
    else if(dragging?.accessRoad)retieAccess(world(p),dragging.accessRoad);
    else if(dragging&&typeof dragging==='object')slideTie(dragging,world(p));
    else{camera.x-=dx/scaleHint;camera.y-=dy/scaleHint;request();}
  });
  for(const kind of ['pointerup','pointercancel','lostpointercapture'])map.addEventListener(kind,e=>{
    if(kind==='pointerup'&&draft&&pressed?.id===e.pointerId&&!pressed.moved&&!dragging)tap(e);
    cursor.delete(e.pointerId);
    if(pressed?.id===e.pointerId){record(gestureEdit);gestureEdit=null;pressed=null;dragging=null;}
  });
  map.addEventListener('wheel',e=>{if(!draft)return;e.preventDefault();zoom(Math.exp(clamp(-e.deltaY*.0025,-.35,.35)),position(e));},{passive:false});

  let profileDrag=null;
  const resetProfileGesture=bindProfileEditor(section,{
    editable:()=>step===3&&Boolean(preview?.design),
    model:()=>preview,
    bounds:profileScale,
    values:()=>alignment().vips,
    before:snapshot,
    defaultRadius:MIN_RADIUS,
    drag:gesture=>{profileDrag=gesture;alignment().vip=gesture.index;refresh();},
    finish:gesture=>{profileDrag=null;lens.hidden=true;record(gesture.before);request();},
  });

  $('rbNext').onclick=()=>{
    if(!draft||$('rbNext').disabled)return;
    if(stationEdit){
      const upgrade=stationUpgrade();
      const changed=upgrade.cost||upgrade.assignments.length||upgrade.removedBays.length;
      if(!changed||upgradeStation(upgrade))close();
      return;
    }
    if(step<4){setStep(step+1);return;}
    commit(copyRoute(),[...draft.deleted],preview.lots.map(l=>l.key));close();
  };
  $('rbCargo').onchange=e=>{draft.freightChoice=e.target.value;draft.stations=[null,null];refresh();};
  $('rbBack').onclick=()=>setStep(step-1);
  $('rbClose').onclick=()=>close(false);
  $('rbSuggest').onclick=()=>edit(()=>{
    draft.stations[step-1]=suggest(step-1);draft.handles=[];draft.vips=[];if(reuseStretch())draft.links[step===1?0:draft.links.length-1]=blankLink();refresh();
  });
  $('rbExistingStation').onchange=e=>edit(()=>{
    const s=existingStations(step-1).find(station=>choiceKey(station)===e.target.value);
    chooseStation(s??suggest(step-1));
    if(s)focus(s.x,s.y,9);
  });
  $('rbPlannedBay').onchange=e=>edit(()=>{
    const station=draft.stations[step-1];
    chooseStation({...station,selectedBay:e.target.value,routeSide:undefined});
    const bay=draftBay(draft.stations[step-1]);focus(bay.x,bay.y,camera.zoom);
  });
  $('rbBayMode').onclick=()=>edit(()=>{
    const s=draft.stations[step-1];
    if(s.sideBay){chooseStation({...s,sideBay:undefined,selectedBay:'1',routeSide:undefined});return;}
    const bay=spareBay(s);
    if(!bay){removalNote='No clear side for another bay here.';refresh();return;}
    removalNote='';
    chooseStation({...s,sideBay:bay});
  });
  $('rbDelete').onclick=()=>{deleteMode=!deleteMode;removalNote='';refresh();};
  $('rbMarkConflicts').onclick=()=>edit(()=>{
    for(const row of conflicts(draft.stations[step-1]))if(!protectedRoadKey(row.key))draft.deleted.push(row.key);
    reviseTies();
  });
  $('rbUndo').onclick=()=>restore(undo,redo);
  $('rbRedo').onclick=()=>restore(redo,undo);
  $('rbRemoveBend').onclick=()=>{if(selected>=0)edit(()=>{alignment().handles.splice(selected,1);selected=-1;});};
  $('rbStraight').onclick=()=>edit(()=>{
    if(draft.roadMode==='mixed'||reuseStretch()){alignment().handles=[];selected=-1;}
    else initializeAlignment(true);
  });
  function tieHandles(){
    return (draft.stretches??[]).flatMap((points,stretch)=>points.map((point,end)=>({point,stretch,end})));
  }
  function roadPoint(graph,p,max){
    const hit=graph.entrance(p,max,pickableRoad);
    if(!hit)return null;
    return {...hit.point,road:p.road??[...hit.roads].find(pickableRoad)};
  }
  function slideTie({stretch,end},point){
    const graph=roadGraph(),points=draft.stretches[stretch],old=points[end];
    const road=old.road??roadPoint(graph,old,.10)?.road;
    const next=roadPoint(graph,{...point,road},Math.max(.2,38/scaleHint));
    if(!next||distance(next,old)<.005)return;
    const updated=points.map((p,i)=>i===end?next:p);
    if(routeLength(stretchPiece(graph,updated).path)<.25)return;
    draft.stretches[stretch]=updated;refresh();
  }
  function splitEdits(edits,section,start,end){
    if(!section?.design)return [blankLink(),blankLink()];
    const distanceAlong=point=>section.path.reduce((best,p)=>distance(point,p)<distance(point,best)?p:best).d;
    const first=distanceAlong(start),last=Math.max(first,distanceAlong(end)),length=section.length;
    const {approach}=section.design,run=length-approach*2;
    return [[0,first],[last,length]].map(([low,high])=>{
      const handles=edits.handles.filter(handle=>{
        const position=distanceAlong(handle);
        return position>low&&position<high;
      });
      const vips=edits.vips.flatMap(vip=>{
        const position=approach+vip.f*run,f=(position-low)/(high-low);
        return f>.025&&f<.975?[{...vip,f}]:[];
      });
      return {handles,vips,vip:-1};
    });
  }
  function pickRoadPoint(p){
    const graph=roadGraph(),point=roadPoint(graph,p,Math.max(.2,20/scaleHint));
    if(!point){removalNote='Tap an existing road. Use + to zoom in if needed.';refresh();return;}
    if(!draft.pick.start){edit(()=>{draft.pick.start=point;removalNote='';});return;}
    const start=draft.pick.start,points=[start,point],piece=stretchPiece(graph,points);
    if(routeLength(piece.path)<.25){
      removalNote=piece.path.length?'Pick points at least 10 m apart.':'Pick an end point connected by road to the start.';
      refresh();return;
    }
    edit(()=>{
      const index=draft.pick.index,split=splitEdits(alignment(),preview,start,point);
      if(reuseStretch())draft.links.splice(index,1,...split);
      else{draft.stretches=[];draft.links=split;}
      draft.stretches.splice(index,0,points);
      delete draft.roadMode;
      draft.pick=null;draft.selectedStretch=index;draft.link=index+1;selected=-1;removalNote='';
    });
  }
  $('rbAddStretch').onclick=()=>edit(()=>{
    draft.pick=draft.pick?null:{index:draft.link??0,start:null};
    selected=-1;removalNote='';
  });
  $('rbRoadMode').onclick=()=>edit(()=>{
    draft.buildNewRoad=!draft.buildNewRoad;
    if(draft.buildNewRoad)initializeAlignment();
    selected=-1;removalNote='';
  });
  $('rbRemoveStretch').onclick=()=>edit(()=>{
    const index=draft.selectedStretch??0;
    draft.stretches.splice(index,1);draft.links.splice(index,2,blankLink());
    draft.selectedStretch=Math.min(index,draft.stretches.length-1);
    draft.link=Math.min(index,draft.links.length-1);selected=-1;removalNote='';
    if(!reuseStretch())initializeAlignment(true);
  });
  function selectLink(index){
    draft.link=index;selected=-1;removalNote='';refresh();
  }
  $('rbLinkSelect').onchange=e=>selectLink(Number(e.target.value));
  $('rbStretchSelect').onchange=e=>{draft.selectedStretch=Number(e.target.value);refresh();};
  $('rbBuildLink').onclick=()=>edit(()=>{
    const link=alignment();
    if(link.buildNew)Object.assign(link,blankLink(),{buildNew:false});
    else link.buildNew=true;
    selected=-1;
  });
  const centre=()=>({x:map.clientWidth/2,y:map.clientHeight/2});
  $('rbMapZoomOut').onclick=()=>zoom(1/1.4,centre());
  $('rbMapZoomIn').onclick=()=>zoom(1.4,centre());
  $('rbRemoveVip').onclick=()=>edit(()=>{const link=alignment();if(link.vips[link.vip])link.vips.splice(link.vip,1);link.vip=-1;});
  $('rbAuto').onclick=()=>edit(()=>{const link=alignment();link.vips=[];link.vip=-1;});
  let sliderBefore=null;
  $('rbRadius').oninput=e=>{
    const link=alignment(),vip=link.vips[link.vip];
    if(!vip)return;
    sliderBefore??=snapshot();
    vip.radius=clamp(Number(e.target.value),MIN_RADIUS,MAX_RADIUS);refresh();
  };
  $('rbRadius').onchange=()=>{record(sliderBefore);sliderBefore=null;};
  const bayRole={load:'Pickup',unload:'Drop-off',both:'Pickup & drop-off'};
  const bayKey=base=>window.contourStationKey(base);
  const routeSlot=({index,side})=>index+':'+side;
  function stationServices(base){
    const v=getValley(),key=bayKey(base);
    return v.transport.routes.flatMap((route,index)=>route.stations.flatMap((station,side)=>{
      if(bayKey(station)!==key)return [];
      const plan=v.market.routeTrade(route);
      const need=!v.market.isFreight(route)?'both':plan?.from===v.market.source(station)?'load':'unload';
      return [{route,index,side,need,assigned:route.stationBays?.[side]??'1'}];
    }));
  }
  function selectedStationBay(){
    const {layout,selected,base}=stationEdit;
    return layout.bays.find(bay=>bay.id===selected)??base;
  }
  function bayHasRoad(bay){
    const {base,services,accesses}=stationEdit,key=choiceKey(base);
    return services.some(service=>service.assigned===bay.id&&service.route.routePorts?.[service.side])||
      [...(getValley().transport.stationAccesses??[]),...accesses].some(access=>access.baseKey===key&&access.bayId===bay.id);
  }
  function canAssignBay(bay,service){
    if(!eligibleBay(bay,service))return false;
    if(service.route.routePorts?.[service.side])return bay.id===service.assigned;
    return !bay.detached;
  }
  const eligibleBay=(bay,service)=>bay.bayUse==='both'||bay.bayUse===service.need;
  const assignment=(edit,service)=>edit.assignments[routeSlot(service)]??service.assigned;
  function bayRemovalIssue(bay){
    const edit=stationEdit,{base,layout,services}=edit;
    const primary=layout.bays.find(other=>other.id==='1');
    const assigned=services.filter(service=>assignment(edit,service)===bay.id);
    if(assigned.some(service=>!primary||!canAssignBay(primary,service)))return 'A route uses this bay’s dedicated access. Remove that route first.';
    const {routes,stationAccesses=[]}=getValley().transport;
    const accesses=stationAccesses.filter(access=>access.baseKey===choiceKey(base)&&access.bayId===bay.id);
    for(const route of routes){
      if(route.points.some(point=>Math.abs(point.z-bay.z)<.045&&hitsStation(point,bay,-.05)))return 'A route runs through this bay. Remove that route first.';
      for(const {points} of accesses){
        // Exclude the street tie itself, which can be used independently of the bay.
        if(points.slice(0,-1).some(point=>{
          const match=nearest(point,route.points);
          return match.distance<.03&&Math.abs(match.z-point.z)<.045;
        }))return 'A route uses this bay’s access road. Remove that route first.';
      }
    }
    return '';
  }
  function stationUpgrade(){
    const {base,layout,original,services,assignments,accesses}=stationEdit,changed=layout.bays.filter(bay=>{
      const before=original.bays.find(item=>item.id===bay.id);
      return !before||distance(before,bay)>1e-5;
    });
    const lanes=[...changed.map(bay=>ContourTown.stationDrive(base,bay)),...accesses.map(access=>access.points)];
    const lots=houses().filter(lot=>changed.some(bay=>impactedByStation(lot,bay))||
      lanes.some(lane=>nearest(lot,lane).distance<(lot.radius??.33)+ROAD_HALF_WIDTH)).map(lot=>lot.key);
    const earth=changed.map(stationEarthwork);
    const cost=changed.length||accesses.length?estimateCost({stations:changed.length,buildings:lots.length,
      length:lanes.reduce((sum,lane)=>sum+routeLength(lane),0),cut:earth.reduce((sum,work)=>sum+work.cut,0),
      fill:earth.reduce((sum,work)=>sum+work.fill,0)}):0;
    const removedBays=original.bays.filter(bay=>!layout.bays.some(current=>current.id===bay.id)).map(bay=>bay.id);
    return {key:bayKey(base),layout,accesses,removedBays,assignments:services.flatMap(service=>{
      const bay=assignments[routeSlot(service)];
      return bay===undefined||bay===service.assigned?[]:[{index:service.index,side:service.side,bay}];
    }),lots,cost};
  }

  function stationOccupied(edit){
    const v=getValley(),busy=new Set();
    for(const service of edit.services){
      const travel=v.truckRuns[service.index].travel,half=travel+(2.8+1.4);
      if(v.market.fleet(service.route).vehicles.some(vehicle=>{
        const from=vehicle.phase>=half?1:0;
        return vehicle.ready?from===service.side&&vehicle.industryLoading:
          1-from===service.side&&vehicle.phase-from*half>=travel;
      }))busy.add(service.assigned);
    }
    return busy;
  }
  function drawStationLayout(){
    const edit=stationEdit,{base,layout,services,showRoutes}=edit;
    const busy=showRoutes?stationOccupied(edit):null;
    for(const bay of layout.bays){
      const drive=ContourTown.stationDrive(base,bay);
      line(drive,'#ede1b9',Math.max(4,.49*scaleHint));
      line(drive,'#49605e',Math.max(3,.33*scaleHint));
    }
    for(const access of edit.accesses){
      line(access.points,'#78b79c',Math.max(4,.28*scaleHint));
      dot(access.tie,4,'#2e7861');mapText(access.tie,'New road access');
    }
    for(const access of (getValley().transport.stationAccesses??[]).filter(access=>access.baseKey===choiceKey(base)&&layout.bays.some(bay=>bay.id===access.bayId))){
      line(access.points,'#78b79c',Math.max(4,.24*scaleHint));
    }
    if(base.tie){
      const access=base.driveway??[along(base,base.nx,base.ny,STATION_HALF_DEPTH),base.tie];
      line(access,'#78b79c',Math.max(4,.28*scaleHint));
      dot(base.tie,4,'#2e7861');mapText(base.tie,'Town / industry access');
    }
    for(const service of services){
      const {index,side}=service,path=getValley().truckRuns[index].path;
      const ordered=side?[...path].reverse():path;
      const end=ordered.findIndex(point=>distance(point,ordered[0])>2.2);
      const near=ordered.slice(0,Math.max(2,end+1));
      const color=showRoutes?ContourRouteOverlay.color(index):'#aa9c67';
      line(near,color,Math.max(3,.12*scaleHint));
      if((service.assigned===edit.selected||services.length===1)&&near.length>1){
        const first=near.at(-1),direction=tangent(near[0],first),gate=along(near[0],direction.x,direction.y,.64);
        arrow(along(first,-direction.y,direction.x,.22),along(gate,-direction.y,direction.x,.22),'Entry');
        arrow(along(gate,direction.y,-direction.x,.22),along(first,direction.y,-direction.x,.22),'Exit');
      }
    }
    for(const bay of layout.bays){
      const footprint=stationFootprint(bay),selected=edit.selected===bay.id;
      drawStationAsset(bay.id==='1'&&bay.x===base.x&&bay.y===base.y?base:bay);
      if(selected)line([...footprint,footprint[0]],'#6cd6ba',3);
      dot(bay,10,busy?.has(bay.id)?'#a5503b':'#254c42',bay.id);
      const routes=showRoutes?services.filter(service=>assignment(edit,service)===bay.id).map(service=>service.index+1):[];
      mapText(along(bay,-bay.nx,-bay.ny,.63),showRoutes&&routes.length?'Lines '+routes.join(', '):bay.detached&&!bayHasRoad(bay)?'No route road':showRoutes?'Unassigned':bayRole[bay.bayUse]);
    }
    if(edit.tool?.access){
      const {side,candidate}=edit.tool,bay=selectedStationBay();
      const path=candidate?.points??(candidate?.tie?[stationEdge(bay,side),candidate.tie]:[]);
      line(path,candidate?.issue?'#be7154':'#96f6ce',Math.max(4,.26*scaleHint));
      drawGates(bay,side,false,candidate?.tie,Boolean(candidate?.issue));
    }else if(edit.tool)for(const option of parallelBays()){
      const hull=stationFootprint(option.bay);
      area(hull,option.issue?'#9a594881':'#62cca57d');
      line([...hull,hull[0]],option.issue?'#956352':'#2f8871',2);
      dot(option.bay,14,option.issue?'#8c6656':'#287967',option.sign<0?'L':'R');
    }

  }

  function refreshUpgrade(){
    const edit=stationEdit,{base,layout,services,showRoutes}=edit;
    const {cost,assignments,removedBays}=stationUpgrade();
    for(const id of ['rbCity','rbStationTools','rbRoadOptions','rbLinkTools','rbCurveTools','rbProfileWrap','rbBack'])$(id).hidden=true;
    const changed=cost>0||assignments.length>0||removedBays.length>0;
    $('rbUndo').hidden=$('rbRedo').hidden=true;
    for(const id of ['rbAddSharedBay','rbStationRoutes','rbEditBay','rbBayOptions','rbAddStationAccess'])$(id).hidden=Boolean(edit.tool);
    $('rbUndo').disabled=$('rbRedo').disabled=true;
    $('rbStep').textContent='';
    $('rbTitle').textContent=base.name+' station layout';
    $('rbSummary').textContent=layout.bays.length+' '+(layout.bays.length===1?'bay':'bays')+' · '+services.length+' '+(services.length===1?'route':'routes')+
      (removedBays.length?' · '+removedBays.length+' to remove':'')+(cost?' · '+quantity(cost)+' cr':'');
    $('rbHelp').textContent=edit.issue||(edit.tool?.access?(edit.tool.side==null?'Choose an edge of Bay '+edit.selected+' for the route access.':edit.tool.candidate&&!edit.tool.candidate.issue?'Drag the green tie to adjust it, then tap Keep access.':'Tap the road you want this entrance to join.'):
      edit.tool?.move?'Choose a clear side for Bay '+edit.selected:
      edit.tool?'Choose a side to add a parallel bay.':
      showRoutes?'Choose a route to see or change its assigned bay.':
      changed?'Check the highlighted bay and apply your changes.':'Tap a numbered bay to edit it, or choose Add bay.');
    $('rbHelp').classList.toggle('warning',Boolean(edit.issue));
    $('rbStationRoutes').setAttribute('aria-pressed',String(showRoutes));
    $('rbStationAssignments').hidden=!showRoutes||!services.length;
    $('rbCancelBayMove').hidden=!edit.tool;
    $('rbStationGates').hidden=!edit.tool?.access;
    $('rbPreviewAccess').hidden=!edit.tool?.access;
    $('rbPreviewAccess').disabled=!edit.tool?.candidate||Boolean(edit.tool.candidate.issue);
    if(edit.tool?.access){
      setEdgeOptions(edgeNames.map((name,side)=>({name,side})),edit.tool.side,'Bay road access edge');
    }
    $('rbBaySides').hidden=!edit.tool||Boolean(edit.tool.access);
    if(edit.tool&&!edit.tool.access){
      const [left,right]=parallelBays();
      for(const [id,option] of [['rbBayLeft',left],['rbBayRight',right]]){
        const button=$(id);button.disabled=Boolean(option.issue);
        button.title=option.issue;
        button.textContent=(option.sign<0?'Left side':'Right side')+(option.issue?' · blocked':'');
      }
    }
    const fixed=bayHasRoad(selectedStationBay());
    $('rbMoveBay').disabled=!edit.selected||fixed;
    $('rbMoveBay').title=fixed?'This bay is fixed by its route road.':'';
    $('rbRemoveBay').hidden=edit.selected==='1'||Boolean(edit.tool);

    const bayPicker=$('rbEditBay'),busy=showRoutes?stationOccupied(edit):null;
    bayPicker.replaceChildren(...layout.bays.map(bay=>{
      const state=showRoutes?(busy.has(bay.id)?' · vehicle at bay':services.some(s=>assignment(edit,s)===bay.id)?' · assigned':' · unassigned'):'';
      return new Option('Bay '+bay.id+' · '+bayRole[bay.bayUse]+(bay.detached&&!bayHasRoad(bay)?' · no route road':state),bay.id);
    }));
    bayPicker.value=edit.selected;
    const routePicker=$('rbBayRoute'),bayOptions=$('rbAssignBay');
    routePicker.replaceChildren(...services.map(service=>new Option('Line '+(service.index+1)+' · '+service.route.stations.map(s=>s.name).join(' ↔ '),routeSlot(service))));
    const service=services.find(s=>routeSlot(s)===edit.selectedRoute)??services[0];
    if(service){
      routePicker.value=routeSlot(service);
      bayOptions.replaceChildren(...layout.bays.filter(bay=>canAssignBay(bay,service))
        .map(bay=>new Option('Bay '+bay.id+' · '+bayRole[bay.bayUse],bay.id)));
      bayOptions.value=assignment(edit,service);
      bayOptions.disabled=bayOptions.options.length<2;
    }
    $('rbNext').textContent=changed?'Apply station changes':'Done';
    $('rbNext').disabled=cost>getValley().market.state.cash||Boolean(edit.tool);
    request();
  }

  function startBayPlacement(tool){
    stationEdit.tool=tool;stationEdit.issue='';refresh();
  }
  $('rbAddSharedBay').onclick=()=>startBayPlacement({use:'both'});
  $('rbMoveBay').onclick=()=>startBayPlacement({move:true});
  function removeSelectedBay(){
    const edit=stationEdit,bay=selectedStationBay();
    if(bay.id==='1')return;
    const issue=bayRemovalIssue(bay);
    if(issue){edit.issue=issue;return;}
    for(const service of edit.services){
      if(assignment(edit,service)===bay.id)edit.assignments[routeSlot(service)]='1';
    }
    edit.layout.bays=edit.layout.bays.filter(other=>other.id!==bay.id);
    edit.accesses=edit.accesses.filter(access=>access.bayId!==bay.id);
    edit.selected='1';
    edit.issue='';
  }
  $('rbRemoveBay').onclick=()=>{removeSelectedBay();refresh();};
  $('rbAddStationAccess').onclick=()=>startBayPlacement({access:true,side:null,candidate:null});
  $('rbPreviewAccess').onclick=()=>{
    const {base,tool,accesses}=stationEdit,candidate=tool?.candidate;
    if(!tool?.access||!candidate||candidate.issue)return;
    if([...(getValley().transport.stationAccesses??[]),...accesses].some(access=>
      access.baseKey===choiceKey(base)&&access.bayId===(selectedStationBay().id??'1')&&access.side===tool.side)){
      stationEdit.issue='This edge already has a route access. Choose another edge.';refresh();return;
    }
    if(accessInUse(candidate.tie)){stationEdit.issue='This road point already has an access.';refresh();return;}
    accesses.push({hubKey:ContourTown.stationKey(base),baseKey:choiceKey(base),bayId:selectedStationBay().id??'1',tie:candidate.tie,points:candidate.points,side:tool.side});
    startBayPlacement(null);
  };
  $('rbBayLeft').onclick=()=>placeParallelBay(-1);
  $('rbBayRight').onclick=()=>placeParallelBay(1);
  $('rbCancelBayMove').onclick=()=>startBayPlacement(null);
  $('rbStationRoutes').onclick=()=>{stationEdit.showRoutes=!stationEdit.showRoutes;refresh();};
  $('rbEditBay').onchange=e=>{stationEdit.selected=e.target.value;stationEdit.tool=null;stationEdit.issue='';refresh();};
  $('rbBayRoute').onchange=e=>{stationEdit.selectedRoute=e.target.value;refresh();};
  $('rbAssignBay').onchange=e=>{
    stationEdit.assignments[$('rbBayRoute').value]=e.target.value;stationEdit.selected=e.target.value;refresh();
  };
  function accessInUse(tie){
    const {base,accesses}=stationEdit,hub=ContourTown.stationKey(base);
    const existing=(getValley().transport.stationAccesses??[]).filter(access=>access.hubKey===hub);
    return [base.tie,...existing.map(access=>access.tie),...accesses.map(access=>access.tie)]
      .some(other=>other&&distance(tie,other)<.38);
  }
  function baySiteIssue(bay,base){
    const v=getValley(),drive=ContourTown.stationDrive(base,bay);
    if(!stationFootprint(bay).every(point=>onLand(point,.12))||drive.some(point=>!onLand(point,.08)))return 'Water or edge of map';
    if(drive.length&&Math.abs(base.z-bay.z)*heightScale/(routeLength(drive)*WORLD_METRES)>.12)return 'Driveway grade above 12%';
    if(v.builtStations.some(station=>bayKey(station)!==bayKey(base)&&distance(station,bay)<1.45)||
      Object.entries(v.transport.stationLayouts??{}).some(([key,layout])=>key!==bayKey(base)&&layout.bays.some(item=>distance(item,bay)<1.45)))
      return 'An existing bay blocks this side';
    if(cityRoads().some(({road})=>stationRoadConflict(bay,road.nodes))||
      ContourTown.roadEntries(v.transport).some(([,route])=>ContourTown.roadSections(route).some(path=>stationRoadConflict(bay,path))))
      return 'An existing road blocks this side';
    if([...industries(),...(v.publicDepots??[])].some(site=>
      Math.abs(bay.x-site.x)<site.halfWidth+.64&&Math.abs(bay.y-site.y)<site.halfDepth+.64))return 'An industry yard blocks this side';
    return '';
  }
  function parallelBays(){
    const {base,layout,tool,selected}=stationEdit;
    const moving=tool?.move?layout.bays.find(bay=>bay.id===selected):null;
    const tx=-base.ny,ty=base.nx;
    const others=layout.bays.filter(bay=>bay!==moving);
    const offsets=others.map(bay=>(bay.x-base.x)*tx+(bay.y-base.y)*ty);
    return [-1,1].map(sign=>{
      const offset=sign*(Math.max(0,...offsets.map(value=>sign*value))+1.55);
      const x=base.x+tx*offset,y=base.y+ty*offset;
      const assigned=moving&&stationEdit.services.some(service=>assignment(stationEdit,service)===moving.id);
      const bay={id:moving?.id??String(layout.nextId),bayUse:moving?.bayUse??'both',parallel:true,
        detached:!assigned,
        x,y,z:meshGround(x,y),nx:base.nx,ny:base.ny,place:base.place,name:base.name,millBay:base.millBay};
      const issue=baySiteIssue(bay,base);
      return {bay,sign,issue,moving};
    });
  }
  function placeParallelBay(sign){
    const edit=stationEdit,{layout}=edit;
    const {bay,issue,moving}=parallelBays().find(item=>item.sign===sign);
    if(issue){edit.issue=issue;refresh();return;}
    if(moving)layout.bays[layout.bays.indexOf(moving)]=bay;
    else{layout.bays.push(bay);layout.nextId++;}
    edit.selected=bay.id;edit.tool=null;
    edit.issue=stationUpgrade().cost>getValley().market.state.cash?'Insufficient funds for these changes.':'';
    refresh();
  }
  function selectUpgrade(p){
    const edit=stationEdit,{base,tool,layout}=edit;
    if(!tool){
      const bay=layout.bays.find(bay=>hitsStation(p,bay,.17));
      if(bay){edit.selected=bay.id;refresh();}
    }else if(tool.access){
      const gate=gateHit(selectedStationBay(),screen(p),false);
      if(gate)chooseAccessEdge(gate.side);
      else retieAccess(p);
    }else{
      const option=parallelBays().find(({bay})=>hitsStation(p,bay,.25));
      if(option)placeParallelBay(option.sign);
    }
  }

  function updateEndpointPicker(){
    const [first,second]=draft.picks;
    $('rbCity').replaceChildren(...endpointControls(getValley(),places(),first&&cityFor(first),second&&cityFor(second),site=>selectEndpoint(site,site)));
  }
  window.addEventListener('popstate',()=>{if(!root.hidden)close(true);});
  root.addEventListener('keydown',e=>{if(e.key==='Escape')close(true);});
  new ResizeObserver(request).observe(map);

  return {
    designRailSection(from,to,leave,enter,edits){
      const stationApproach=s=>s.kind?(s.platformLength??2.4)*(s.terminal?1:.5):0;
      return designSection(from,to,leave,enter,edits,0,0,[stationApproach(from),stationApproach(to)]);
    },
    openStation(base,bayId){
      $('rbBayOptions').open=false;
      begin();roadGraphCache=null;gatesCache=null;drawStationAsset.clear();preview=null;step=1;deleteMode=false;
      const saved=getValley().transport.stationLayouts?.[bayKey(base)];
      const original=saved??{bays:[{...base,id:'1',bayUse:'both'}],nextId:2};
      stationEdit={base,original,layout:structuredClone(original),services:stationServices(base),assignments:{},accesses:[],
        selected:original.bays.some(bay=>bay.id===bayId)?bayId:'1',selectedRoute:'',showRoutes:false,tool:null,issue:''};
      draft={picks:[{city:base.place,x:base.x,y:base.y},{city:base.place,x:base.x+1,y:base.y}],stations:[null,null],deleted:[],handles:[],vips:[]};
      history.pushState({roadEditor:true},'','');
      $('app').inert=true;root.hidden=false;
      const bay=selectedStationBay();focus(bay.x,bay.y,getValley().region?26:10);refresh();$('rbClose').focus();
    },
    open(){
      begin();
      roadGraphCache=null;gatesCache=null;sectionCache.clear();drawStationAsset.clear();
      draft={picks:[],stations:[null,null],handles:[],vips:[],deleted:[],vip:-1};
      undo=[];redo=[];sliderBefore=null;
      let saved=null;try{saved=JSON.parse(localStorage.getItem(saveKey()));}catch{}
      if(saved?.draft?.stations?.length===2){
        draft=saved.draft;
        if(draft.roadMode==='stretch'){
          if(draft.joins?.length===2){
            draft.stretches=[draft.joins];
            draft.links??=[blankLink(),blankLink()];
          }else if(draft.pickingTies)draft.pick={index:0,start:draft.joins?.[0]??null};
          delete draft.roadMode;
        }else if(draft.roadMode==='new'||draft.roadMode==='mixed'&&draft.joins?.length<2)delete draft.roadMode;
      }
      history.pushState({roadEditor:true},'','');
      if(!getValley().region)updateEndpointPicker();
      $('app').inert=true;root.hidden=false;setStep(saved?.step||0);if(saved?.camera){Object.assign(camera,saved.camera);selected=saved.selected;refresh();}$('rbClose').focus();
    }
  };
};
})();
