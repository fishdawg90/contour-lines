(() => {
'use strict';
const gap=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const interpolate=(a,b,t)=>({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,z:a.z+(b.z-a.z)*t});
const clamp=(v,min,max)=>Math.min(max,Math.max(min,v));
const stationKey=s=>s.hubKey||window.contourStationKey(s);
function project(p,a,b){
  const dx=b.x-a.x,dy=b.y-a.y;
  const t=clamp(((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy||1),0,1);
  return {t,point:interpolate(a,b,t)};
}
function openRoads(valley,city){
  return city.roads.filter(r=>{
    const key=city.id+':'+r.id;
    return !valley.transport.removedRoads.includes(key)&&(city.open.has(r.id)||
      valley.builtStations?.some(s=>s.tie?.key===key));
  })
    .concat((valley.transport.townRoads?.[city.id]??[]).filter(r=>!valley.transport.removedRoads.includes(city.id+':'+r.id)));
}
function makeGraph(roads,elevationTolerance=.12){
  const cuts=roads.flatMap(road=>road.nodes.slice(1).map((b,i)=>({a:road.nodes[i],b,road:road.id,breaks:[0,1]})))
    .filter(e=>gap(e.a,e.b)>1e-5);
  for(let i=0;i<cuts.length;i++)for(let j=i+1;j<cuts.length;j++){
    const u=cuts[i],v=cuts[j];
    if(u.road===v.road)continue;
    if(Math.max(u.a.x,u.b.x)+.08<Math.min(v.a.x,v.b.x)||Math.max(v.a.x,v.b.x)+.08<Math.min(u.a.x,u.b.x)||
      Math.max(u.a.y,u.b.y)+.08<Math.min(v.a.y,v.b.y)||Math.max(v.a.y,v.b.y)+.08<Math.min(u.a.y,u.b.y))continue;
    const dx=u.b.x-u.a.x,dy=u.b.y-u.a.y,ex=v.b.x-v.a.x,ey=v.b.y-v.a.y,den=dx*ey-dy*ex;
    if(Math.abs(den)>1e-8){
      const ox=v.a.x-u.a.x,oy=v.a.y-u.a.y,t=(ox*ey-oy*ex)/den,k=(ox*dy-oy*dx)/den;
      if(t>=0&&t<=1&&k>=0&&k<=1&&Math.abs(interpolate(u.a,u.b,t).z-interpolate(v.a,v.b,k).z)<elevationTolerance){
        u.breaks.push(t);v.breaks.push(k);
      }
    }
    for(const [from,to] of [[u,v],[v,u]])for(const p of [from.a,from.b]){
      const hit=project(p,to.a,to.b);
      if(gap(hit.point,p)<.045&&Math.abs(hit.point.z-p.z)<elevationTolerance)to.breaks.push(hit.t);
    }
  }
  const nodes=[],spatial=new Map(),byRoad=new Map(),edgeRoads=new Map();
  function node(p){
    const x=Math.floor(p.x/.05),y=Math.floor(p.y/.05);
    for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++){
      for(const n of spatial.get((x+dx)+':'+(y+dy))??[]){
        if(gap(n,p)<.046&&Math.abs(n.z-p.z)<elevationTolerance)return n;
      }
    }
    const n={...p,index:nodes.length,edges:new Map()};
    nodes.push(n);
    const key=x+':'+y;
    if(!spatial.has(key))spatial.set(key,[]);
    spatial.get(key).push(n);
    return n;
  }
  for(const {a,b,breaks,road} of cuts){
    if(!byRoad.has(road))byRoad.set(road,new Set());
    const points=breaks.sort((a,b)=>a-b).map(t=>node(interpolate(a,b,t)));
    for(const [i,n] of points.entries()){
      byRoad.get(road).add(n);
      const old=points[i-1];
      if(old&&old!==n){
        const dist=gap(n,old);n.edges.set(old,dist);old.edges.set(n,dist);
        const key=edgeKey(old,n);
        if(!edgeRoads.has(key))edgeRoads.set(key,new Set());
        edgeRoads.get(key).add(road);
      }
    }
  }
  function edgeKey(a,b){return Math.min(a.index,b.index)+':'+Math.max(a.index,b.index);}
  function nearest(p,max=Infinity,road){
    let best=null;
    const pool=road===undefined?nodes:byRoad.get(road)??[];
    for(const n of pool){
      const d=p.z===undefined?gap(n,p):Math.hypot(gap(n,p),n.z-p.z);
      if(d<max){best=n;max=d;}
    }
    return best;
  }
  const floodCache=new Map();
  function flood(start){
    if(floodCache.has(start))return floodCache.get(start);
    const costs=new Map(),previous=new Map(),heap=[];
    const earlier=(a,b)=>a.cost<b.cost||a.cost===b.cost&&a.node.index<b.node.index;
    function push(item){
      let i=heap.length;
      heap.push(item);
      while(i){
        const parent=(i-1)>>1;
        if(!earlier(item,heap[parent]))break;
        heap[i]=heap[parent];i=parent;
      }
      heap[i]=item;
    }
    function pop(){
      const first=heap[0],last=heap.pop();
      if(!heap.length)return first;
      let i=0;
      while(i*2+1<heap.length){
        let child=i*2+1;
        if(child+1<heap.length&&earlier(heap[child+1],heap[child]))child++;
        if(!earlier(heap[child],last))break;
        heap[i]=heap[child];i=child;
      }
      heap[i]=last;
      return first;
    }
    if(start){costs.set(start,0);push({node:start,cost:0});}
    while(heap.length){
      const {node,cost}=pop();
      if(cost!==costs.get(node))continue;
      for(const [next,length] of node.edges){
        const d=cost+length;
        if(d<(costs.get(next)??Infinity)){
          costs.set(next,d);previous.set(next,node);push({node:next,cost:d});
        }
      }
    }
    const result={costs,previous};
    if(floodCache.size>=48)floodCache.delete(floodCache.keys().next().value);
    floodCache.set(start,result);
    return result;
  }
  function path(start,end){
    if(!start||!end)return [];
    const {costs,previous}=flood(start);
    if(!costs.has(end))return [];
    const result=[end];
    while(result.at(-1)!==start)result.push(previous.get(result.at(-1)));
    return result.reverse().map(({x,y,z})=>({x,y,z}));
  }
  function entrance(point,limit,eligible){
    const pool=point.road===undefined?nodes:byRoad.get(point.road)??[];
    let best=null;
    for(const a of pool)for(const [b,length] of a.edges){
      if(a.index>b.index)continue;
      const roads=edgeRoads.get(edgeKey(a,b));
      if(point.road!==undefined&&!roads.has(point.road)||eligible&&![...roads].some(eligible))continue;
      const hit=project(point,a,b);
      const distance=Math.hypot(gap(point,hit.point),(point.z??hit.point.z)-hit.point.z);
      if(distance<limit){limit=distance;best={...hit,a,b,length,roads};}
    }
    return best;
  }
  function pathBetween(start,end){
    if(!start||!end)return [];
    const {a,b}=start;
    if(a===end.a&&b===end.b)return [start.point,end.point];
    const ends=edge=>[[edge.a,edge.t*edge.length],[edge.b,(1-edge.t)*edge.length]];
    let best=Infinity,points=[];
    for(const [last,lastGap] of ends(end)){
      const {costs}=flood(last);
      for(const [first,firstGap] of ends(start)){
        const length=firstGap+lastGap+(costs.get(first)??Infinity);
        if(length>=best)continue;
        best=length;
        points=[start.point,...path(last,first).reverse(),end.point];
      }
    }
    return points.filter((p,i)=>i===0||gap(p,points[i-1])>1e-6);
  }
  function sidewalkRoute(home,anchor){
    return pathBetween(entrance(home,1.15),entrance(anchor,.65));
  }
  function catchment(anchor,lots,range=7){
    const start=nearest(anchor,.65,anchor.road);
    if(!start)return [];
    const {costs}=flood(start);
    return lots.filter(lot=>{
      const entrance=nearest(lot,1.15,lot.road);
      return entrance&&(costs.get(entrance)??Infinity)+gap(lot,entrance)+gap(anchor,start)<=range;
    });
  }
  function roadsUsed(path){
    const points=new Set(path.map(p=>nearest(p,.001)).filter(Boolean));
    return [...byRoad].filter(([,members])=>[...members].some(n=>points.has(n))).map(([id])=>id);
  }
  function matchingVertex(p){
    const x=Math.floor(p.x/.05),y=Math.floor(p.y/.05);
    for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++){
      const hit=spatial.get((x+dx)+':'+(y+dy))?.find(n=>gap(n,p)<.001&&Math.abs(n.z-p.z)<.001);
      if(hit)return hit;
    }
    return null;
  }
  function segmentRoads(points){
    const ids=new Set();
    for(let i=1;i<points.length;i++){
      const a=matchingVertex(points[i-1]),b=matchingVertex(points[i]);
      if(a&&b)for(const id of edgeRoads.get(edgeKey(a,b))??[])ids.add(id);
    }
    return [...ids];
  }
  return {nodes,nearest,path,entrance,pathBetween,sidewalkRoute,catchment,roadsUsed,segmentRoads};
}
function stationAnchor(station,city){
  if(!station.tie)return null;
  const key=station.tie.key;
  if(key&&!key.startsWith(city.id+':'))return null;
  const id=key?.slice(city.id.length+1);
  return {...station.tie,road:id===undefined?undefined:Number.isNaN(+id)?id:+id};
}
function hubStations(valley,city){
  const hubs=new Map();
  for(const station of valley.builtStations??[]){
    if(station.place!==city.id&&station.name!==city.name)continue;
    const key=stationKey(station);
    if(!hubs.has(key)||!hubs.get(key).tie)hubs.set(key,station);
  }
  return hubs;
}
function hubServices(valley,kind){
  if(valley.hubServiceCache?.count===valley.transport.routes.length)return valley.hubServiceCache.services;
  const services=new Map();
  for(const route of valley.transport.routes){
    const cargo=kind(route);
    if(cargo!=='Timber'&&cargo!=='Passengers')continue;
    const type=cargo==='Timber'?'delivery':'bus';
    for(const station of route.stations){
      const key=stationKey(station);
      if(!services.has(key))services.set(key,new Set());
      services.get(key).add(type);
    }
  }
  valley.hubServiceCache={count:valley.transport.routes.length,services};
  return services;
}
function getGraph(valley,city){
  valley.townGraphs??=new Map();
  if(!valley.townGraphs.has(city.id))valley.townGraphs.set(city.id,makeGraph(openRoads(valley,city)));
  return valley.townGraphs.get(city.id);
}
function hubStock(valley,hub){
  const stocks=valley.transport.hubStock??={};
  return stocks[hub]??={timber:0,riders:{}};
}
function roadSections(route){
  const spans=route.roadSections??[[route.roadStart??0,route.roadEnd??route.points.length]];
  return spans.map(([start,end])=>route.points.slice(start,end)).filter(points=>points.length>1);
}
function roadEntries(transport){
  return [...transport.routes.flatMap((route,index)=>route.mode==='rail'?[]:[[route.roadId??index,route]]),
    ...Object.entries(transport.roadArchive??{}).map(([id,road])=>[Number(id),road])].sort(([a],[b])=>a-b);
}
function archiveRoute(transport,index){
  transport.routes.forEach((route,i)=>{if(route.mode!=='rail')route.roadId??=i;});
  const archived=transport.roadArchive??={};
  if(transport.routes[index].mode!=='rail'){
    const {service,...road}=transport.routes[index];
    archived[road.roadId]=road;
  }
  transport.routes.splice(index,1);
}
function stationBay(transport,route,side){
  const base=route.stations[side];
  const layout=transport.stationLayouts?.[window.contourStationKey(base)];
  const id=route.stationBays?.[side]??'1';
  return layout?.bays.find(bay=>bay.id===id);
}
const primaryBay=s=>({x:s.x-s.nx*.09,y:s.y-s.ny*.09,z:s.z});
function detachedBays(transport){
  const assigned=new Set(roadEntries(transport).flatMap(([,route])=>route.stations.map((station,side)=>
    window.contourStationKey(station)+'/'+(route.stationBays?.[side]??'1'))));
  for(const [key,layout] of Object.entries(transport.stationLayouts??{}))for(const bay of layout.bays){
    if(bay.parallel&&bay.id!=='1'&&bay.detached===undefined&&!assigned.has(key+'/'+bay.id))bay.detached=true;
  }
}
function routePad(transport,route,side){
  return stationBay(transport,route,side)??route.stations[side];
}
function stationDrive(base,bay){
  if(!bay||bay.detached||bay.x===base.x&&bay.y===base.y)return [];
  const primary=primaryBay(base),end=primaryBay(bay);
  const start=bay.parallel?{x:primary.x-base.nx*.38,y:primary.y-base.ny*.38,z:primary.z}:primary;
  const points=bay.parallel?[start,{x:end.x-bay.nx*.38,y:end.y-bay.ny*.38},end]:[start,end];
  const length=points.slice(1).reduce((sum,p,i)=>sum+gap(points[i],p),0);
  let travelled=0;
  const lane=[start];
  for(let i=1;i<points.length;i++){
    const a=points[i-1],b=points[i],span=gap(a,b),count=Math.max(1,Math.ceil(span/.15));
    for(let j=1;j<=count;j++){
      const f=j/count;
      lane.push({x:a.x+(b.x-a.x)*f,y:a.y+(b.y-a.y)*f,z:start.z+(end.z-start.z)*(travelled+span*f)/length});
    }
    travelled+=span;
  }
  return lane;
}
window.ContourTown={gap,stationKey,stationAnchor,openRoads,makeGraph,hubStations,hubServices,getGraph,hubStock,roadSections,roadEntries,archiveRoute,stationBay,primaryBay,stationDrive,detachedBays,routePad};
})();
