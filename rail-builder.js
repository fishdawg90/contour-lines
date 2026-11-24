(() => {
'use strict';

const distance = (a,b) => Math.hypot(a.x-b.x,a.y-b.y);
const clamp = (n,min,max) => Math.max(min,Math.min(max,n));
const lerp = (a,b,t) => a+(b-a)*t;
const point = (a,b,t) => ({x:lerp(a.x,b.x,t),y:lerp(a.y,b.y,t),z:lerp(a.z,b.z,t)});
const heading = (a,b) => {
  const n=distance(a,b)||1;
  return {x:(b.x-a.x)/n,y:(b.y-a.y)/n};
};
const dot = (a,b) => a.x*b.x+a.y*b.y;
const length = path => path.slice(1).reduce((sum,p,i)=>sum+distance(path[i],p),0);
const platforms = s=>clamp(Math.trunc(Number(s?.platformCount)||1),1,3);
const money = n => Math.round(n).toLocaleString('en-GB')+' cr';
const id = prefix => prefix+'-'+globalThis.crypto.randomUUID();

function nearest(p,path) {
  let best=Infinity;
  for(let i=1;i<path.length;i++){
    const a=path[i-1],b=path[i],dx=b.x-a.x,dy=b.y-a.y;
    const t=clamp(((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy||1),0,1);
    best=Math.min(best,distance(p,point(a,b,t)));
  }
  return best;
}

function directed(track,from) {
  const forward=track.from===from;
  return {track,from,to:forward?track.to:track.from,direction:forward?1:-1,
    points:forward?track.points:[...track.points].reverse()};
}

function ends(path) {
  return [heading(path[0],path[1]),heading(path.at(-1),path.at(-2))];
}

// Track connectivity is explicit. Lines crossing in plan do not introduce a node.
function findCorridor(tracks,stations,from,to,via) {
  const distances=new Map(),pending=new Map();
  const initial={node:from,steps:[],used:!via,cost:0};
  pending.set(from+'|'+initial.used,initial);
  while(pending.size){
    const [key,current]=[...pending].reduce((a,b)=>a[1].cost<=b[1].cost?a:b);
    pending.delete(key);
    if(current.node===to&&current.used)return current.steps;
    distances.set(key,current.cost);
    if(current.node!==from&&stations[current.node]?.terminal)continue;
    for(const track of Object.values(tracks)){
      if(![track.from,track.to].includes(current.node)||current.steps.some(p=>p.track.id===track.id))continue;
      const leg=directed(track,current.node),previous=current.steps.at(-1);
      if(previous&&dot(ends(previous.points)[1],ends(leg.points)[0])>-.54)continue;
      const next={node:leg.to,steps:[...current.steps,leg],used:current.used||track.id===via,cost:current.cost+length(leg.points)};
      const nextKey=next.node+'|'+next.used+'|'+track.id;
      if(next.cost>=(distances.get(nextKey)??Infinity)||next.cost>=(pending.get(nextKey)?.cost??Infinity))continue;
      pending.set(nextKey,next);
    }
  }
  return [];
}

window.createRailBuilder=function({getValley,bounds,heightScale,draftKey,begin,finish,commit,updateRailRoute,updateRailStation,designSection,stationFaces}){
  const shared=window.ContourRouteEditor;
  const root=document.createElement('section');
  root.id='railBuilder';
  root.hidden=true;
  root.setAttribute('role','dialog');
  root.setAttribute('aria-modal','true');
  root.setAttribute('aria-labelledby','rlTitle');
  root.className='routeBuilder';
  root.innerHTML=`
    <div class="rb-header rl-header"><span class="rl-step"></span><h2 id="rlTitle">Rail route</h2><button data-action="undo" aria-label="Undo" title="Undo">↶</button><button data-action="redo" aria-label="Redo" title="Redo">↷</button><button data-action="close" aria-label="Close editor" title="Close editor">×</button></div>
    <div class="rb-map-area rl-map"><div class="editorZoom"><button data-action="minus" aria-label="Zoom out">−</button><button data-action="plus" aria-label="Zoom in">+</button></div><canvas aria-label="Rail construction map"></canvas>
      <div class="rl-rotate" role="group" aria-label="Turn platform" hidden>
        <button data-action="turnLeft" aria-label="Rotate station counterclockwise" title="Rotate left">⟲</button>
        <button data-action="turnRight" aria-label="Rotate station clockwise" title="Rotate right">⟳</button>
      </div></div>
    <div class="rb-profile rl-profile" id="rlProfile" hidden><canvas aria-label="Track elevation profile. Tap to add a vertical intersection point, then drag it to adjust the grade."></canvas>
      <p class="rl-profile-note" hidden>Existing track elevation. Choose Redraw section to change an unshared alignment.</p>
      <div class="rb-profile-controls"><label>VIP radius <input type="range" aria-label="VIP radius" min="120" max="1200" step="10"><output></output></label><button data-action="removeLevel">Remove VIP</button><button data-action="resetProfile">Reset profile</button></div></div>
    <div class="rb-editor rl-editor"><p class="rl-stats"></p><div class="rl-impact"></div><div class="rb-options rl-controls"></div></div>
    <div class="editorFooter">
      <p class="editorGuide" role="status"></p>
      <div class="rb-actions rl-actions"><button data-action="discard">Discard draft</button><button data-action="back">Back</button><button data-action="next">Continue</button></div>
    </div>`;
  document.body.append(root);
  const q=s=>root.querySelector(s), action=name=>q('[data-action="'+name+'"]');
  const map=q('.rl-map canvas'),ctx=map.getContext('2d'), profile=q('.rl-profile canvas'),pc=profile.getContext('2d');
  const renderTerrain=shared.createTerrainPainter();
  let state,view,undo,redo,routeEdit,stationEdit,preview,issue='',pointer,profileDrag,activeLevel=-1,levelSnapshot,placement;
  const tracks=()=>getValley().transport.railTracks??{};
  const stations=()=>getValley().transport.railStations??Object.fromEntries(
    getValley().transport.routes.filter(r=>r.mode==='rail').flatMap(r=>r.stations.map(s=>[s.id,s])));
  const places=()=>{
    const valley=getValley();
    return [...valley.towns,...(valley.industries??[valley.industry]),...valley.market.depots()].filter(Boolean);
  };
  const key=()=> (draftKey?.(getValley())??'contour-route:'+getValley().seed)+':rail';
  const town=place=>places().find(s=>s.id===place);
  const serviceKey=s=>s.cargo+'|'+s.from.id;
  function services() {
    if(state.stations.some(s=>!s))return [];
    return getValley().market.trades(...state.stations.map(s=>town(s.place)));
  }
  const trade=()=>services().find(s=>serviceKey(s)===state.cargo)??services()[0];
  const width=()=>map.clientWidth;
  const height=()=>map.clientHeight;
  const scale=()=>view.zoom*Math.min(width()/(bounds.east-bounds.west+7),height()/(bounds.south-bounds.north+7));
  const screen=p=>({x:width()/2+(p.x-view.x)*scale(),y:height()/2+(p.y-view.y)*scale()});
  const world=p=>({x:view.x+(p.x-width()/2)/scale(),y:view.y+(p.y-height()/2)/scale()});
  const eventPoint=shared.pointerAt;
  const ground=(x,y)=>(getValley().designGround??getValley().ground)(x,y);
  const within=p=>p.x>bounds.west+.1&&p.x<bounds.east-.1&&p.y>bounds.north+.1&&p.y<bounds.south-.1;
  const dry=p=>within(p)&&!getValley().wet(p.x,p.y);
  const current=()=>state.legs[state.active];
  const activeStation=()=>stationEdit?state.station:state.stations[state.step];
  const activeSection=()=>preview?.legs[state.active]?.section;
  const activeLeg=()=>preview?.legs[state.active];
  const roadRows=()=>shared.cityRoadRows(getValley());
  const builtLots=()=>shared.builtLots(getValley());
  const stationTrackCount=(s,legs=[])=>legs.some(leg=>leg.track.tracks===2&&(leg.from===s.id||leg.to===s.id))
    ||incident(s).some(track=>track.tracks===2)?2:1;
  const platformHits=(station,lot,approachTracks)=>shared.hitsStation(lot,station,lot.radius??.33,approachTracks);
  const stationFootprint=(s,approachTracks=stationTrackCount(s))=>shared.stationFootprint(s,0,approachTracks);
  const committedStation=s=>s&&stations()[s.id];
  const originalStation=s=>stationEdit?.id===s?.id?stationEdit:committedStation(s);
  const hasStationWork=s=>s&&(!originalStation(s)||platforms(s)>platforms(originalStation(s))||
    s.platformLength!==originalStation(s).platformLength||s.terminal!==originalStation(s).terminal);
  const assignedPlatform=side=>clamp(state.platforms?.[side]??1,1,platforms(state.stations[side]));
  const rotateControls=q('.rl-rotate');
  const protectedRoad=key=>shared.protectedRoad(getValley(),key);
  const roadsMarked=()=>state.removedRoads??[];
  function stationConflicts(s,approachTracks){
    if(!hasStationWork(s))return [];
    const original=originalStation(s);
    const count=approachTracks??stationTrackCount(s),originalCount=original&&stationTrackCount(original);
    return roadRows().filter(({road})=>shared.stationRoadConflict(s,road.nodes,count)&&
      (!original||!shared.stationRoadConflict(original,road.nodes,originalCount)));
  }
  function stationImpact(s,approachTracks){
    if(!hasStationWork(s))return {lots:[],roads:[]};
    const original=originalStation(s);
    const count=approachTracks??stationTrackCount(s),originalCount=original&&stationTrackCount(original);
    return {lots:builtLots().filter(lot=>platformHits(s,lot,count)&&(!original||!platformHits(original,lot,originalCount))).map(lot=>lot.key),
      roads:stationConflicts(s,count)};
  }
  function survivingCatchment(s,impact){
    const city=town(s.place),valley=getValley();
    if(!city?.roads)return null;
    const removed=impact.roads.map(row=>row.key).filter(key=>roadsMarked().includes(key)&&!protectedRoad(key));
    const tie=stations()[s.id]&&!stationEdit?s.tie:roadTie(s,removed);
    if(!tie)return [];
    const endpoint={...s,tie};
    const anchor=ContourTown.stationAnchor(endpoint,city);
    if(!anchor)return [];
    const all=removed.length?ContourTown.makeGraph(ContourTown.openRoads(valley,city)
      .filter(road=>!removed.includes(city.id+':'+road.id))).catchment(anchor,valley.market.homes(city),valley.market.radius):
      valley.market.catchment(endpoint,city);
    return all.filter(lot=>!impact.lots.includes(city.id+':'+lot.id)).map(lot=>city.id+':'+lot.id);
  }
  function streetIssue(s,approachTracks){
    const blocking=stationConflicts(s,approachTracks).filter(row=>!roadsMarked().includes(row.key)||protectedRoad(row.key));
    if(blocking.some(row=>protectedRoad(row.key)))return 'A conflicting street serves a station or route. Move the platform.';
    return blocking.length?'Mark the highlighted streets for removal or move the platform.':'';
  }
  function allNodes() {
    const nodes=new Map(Object.values(stations()).map(s=>[s.id,s]));
    for(const track of Object.values(tracks())){
      if(!nodes.has(track.from))nodes.set(track.from,{...track.points[0],id:track.from});
      if(!nodes.has(track.to))nodes.set(track.to,{...track.points.at(-1),id:track.to});
    }
    for(const station of state.stations??[])if(station)nodes.set(station.id,station);
    return nodes;
  }
  function endpointHeading(from,to,ignored){
    if(from.kind){
      const tangent={x:-from.ny,y:from.nx};
      if(from.terminal&&from.facing)return from.facing;
      const approaches=incident(from).filter(track=>track.id!==ignored);
      if(approaches.length===1){
        const existing=ends(directed(approaches[0],from.id).points)[0];
        return dot(tangent,existing)>0?{x:-tangent.x,y:-tangent.y}:tangent;
      }
      const toward=heading(from,to);
      return dot(tangent,toward)>=0?tangent:{x:-tangent.x,y:-tangent.y};
    }
    return heading(from,to);
  }
  function align(from,to,edits){
    const near=edits.handles[0]??to, far=edits.handles.at(-1)??from;
    const leave=endpointHeading(from,near,edits.redraw),back=endpointHeading(to,far,edits.redraw);
    return designSection(from,to,leave,{x:-back.x,y:-back.y},edits);
  }
  function stationIssue(s,index,approachTracks){
    if(!s)return 'Choose a place and set a rail station on the map.';
    if(!town(s.place))return 'The station must serve a town or an industry.';
    const platform=s.platformLength??2.4;
    const site=town(s.place);
    if(distance(s,site)>13)return 'Keep the station within 520 m of '+site.name+'.';
    const other=state.stations?.[1-index];
    if(other&&(other.id===s.id||distance(other,s)<(platform+(other.platformLength??2.4))/2+.5))
      return 'Separate the station platforms.';
    return hasStationWork(s)?stationSiteIssue(s,approachTracks):'';
  }
  function stationSiteIssue(s,approachTracks=stationTrackCount(s)){
    const corners=stationFootprint(s,approachTracks);
    if(corners.some(p=>!dry(p)))return 'The platform needs a dry footprint inside the map.';
    if(corners.some(p=>Math.abs(ground(p.x,p.y)-s.z)>.33))return 'Choose more level ground for the platform.';
    const occupied=[...Object.values(stations()),...(getValley().builtStations??[]).filter(p=>p.mode!=='rail')];
    if(occupied.some(p=>p.id!==s.id&&(distance(s,p)<1.6||corners.some(q=>shared.hitsStation(q,p,.2)))))return 'The station overlaps an existing station.';
    if(places().filter(p=>p.halfWidth&&p.halfDepth).some(p=>[s,...corners].some(q=>
      Math.abs(q.x-p.x)<p.halfWidth+.25&&Math.abs(q.y-p.y)<p.halfDepth+.25)))return 'Move the platform away from the industry buildings.';
    if(Object.values(tracks()).some(track=>track.from!==s.id&&track.to!==s.id&&
      (nearest(s,track.points)<.8||track.points.some(p=>Math.abs(p.z-s.z)<.28&&shared.hitsStation(p,s,.15,approachTracks)))))
      return 'Select a built rail station or move away from existing track.';
    return streetIssue(s,approachTracks);
  }
  function createStation(p,place){
    const currentSite=town(place);
    const target=state.stations[1-state.step]??town(state.places[1-state.step])??currentSite;
    const t=heading(p,target);
    const facing=t.x||t.y?t:{x:1,y:0};
    return {mode:'rail',id:id('rail-station'),x:p.x,y:p.y,z:ground(p.x,p.y),nx:facing.y,ny:-facing.x,place,
      name:currentSite.name,kind:'terminal',terminal:true,facing,platformLength:2.4,platformCount:1};
  }
  function suggest(site) {
    const other=town(state.places[1-state.step])??site,angle=Math.atan2(other.y-site.y,other.x-site.x);
    let best=null;
    for(const radius of [3.5,4.5,5.5,6.5,2.5,8,9]){
      for(let i=0;i<16;i++){
        const a=angle+(i%2?-1:1)*Math.ceil(i/2)*Math.PI/8;
        const s=createStation({x:site.x+radius*Math.cos(a),y:site.y+radius*Math.sin(a)},site.id);
        if(!stationIssue(s,state.step))return s;
        best??=s;
      }
    }
    return best;
  }
  function newLeg(from,to,tracks=1){
    return {id:id('track'),from,to,tracks,handles:[],vips:[]};
  }
  function initializeLegs() {
    if(state.stations.some(s=>!s))return;
    const [from,to]=state.stations.map(s=>s.id);
    if(state.legs[0]?.from===from&&state.legs.at(-1)?.to===to)return;
    state.legs=[newLeg(from,to,state.legTracks)];state.active=0;state.tool='shape';
  }
  function incident(station){
    return Object.values(tracks()).filter(t=>t.from===station.id||t.to===station.id);
  }
  function terminalIssue(s){
    const approaches=incident(s).map(t=>ends(directed(t,s.id).points)[0]);
    if(approaches.some((a,i)=>approaches.slice(i+1).some(b=>dot(a,b)<-.35)))
      return 'Track leaves both ends of this station. Keep it as a through station.';
    if(getValley().transport.routes.some(r=>r.mode==='rail'&&!r.stations.some(p=>p.id===s.id)&&r.trackIds?.some(trackId=>incident(s).some(t=>t.id===trackId))))
      return 'A service runs through this station. Keep it as a through station.';
    return '';
  }
  function junctionIssue(node,leave,ignored){
    const approaches=incident(node).filter(t=>t.id!==ignored).map(track=>ends(directed(track,node.id).points)[0]);
    if(!approaches.length)return '';
    if(node.terminal)return 'Reuse the existing approach into this terminal or convert it to a through station.';
    if(node.kind&&approaches.some(dir=>dot(dir,leave)>.42))
      return 'Use the free end of this through station or reuse its built approach.';
    if(!approaches.some(dir=>dot(dir,leave)<-.54))return 'Join the track in a compatible direction.';
    return '';
  }
  function routePreview(){
    const nodes=allNodes(),known=tracks(),legs=[],included=new Set();
    let error='',cost=0,newLength=0,reusedLength=0,maxGrade=0;
    for(const draft of state.legs){
      const from=nodes.get(draft.from),to=nodes.get(draft.to);
      if(!from||!to){error='A selected track connection is unavailable.';break;}
      const existing=known[draft.trackId];
      if(draft.trackId&&(!existing||![existing.from,existing.to].includes(from.id)||![existing.from,existing.to].includes(to.id))){
        error='A selected piece of track is unavailable.';break;
      }
      const stationRun=s=>s.kind?(s.platformLength??2.4)*(s.terminal?1:.5):0;
      if(!existing&&distance(from,to)<stationRun(from)+stationRun(to)+.35){error='Leave room between track connections.';break;}
      const section=existing?null:align(from,to,draft);
      const prior=known[draft.redraw];
      const reversed=prior?.to===from.id;
      const track=existing?(draft.double?{...existing,tracks:2}:existing):{
        id:draft.id,from:reversed?to.id:from.id,to:reversed?from.id:to.id,tracks:draft.tracks,
        points:(reversed?[...section.path].reverse():section.path).map(({x,y,z,dx,dy,bridge,water})=>({
          x,y,z,dx:reversed?-dx:dx,dy:reversed?-dy:dy,bridge,water
        })),
      };
      if(track.points.length<2){error='The track needs two different endpoints.';break;}
      const leg={...directed(track,from.id),section};
      if(included.has(track.id))error||='Use each track section once in this point-to-point route.';
      included.add(track.id);
      const previous=legs.at(-1);
      if(previous&&(previous.to!==from.id||from.terminal||dot(ends(previous.points)[1],ends(leg.points)[0])>-.54))
        error ||= from.terminal?'This route cannot run through a terminal station.':'Smooth the connection between track sections.';
      legs.push(leg);
      if(existing){
        const span=length(existing.points);
        reusedLength+=span;
        if(draft.double&&existing.tracks===1){
          const wet=existing.points.slice(1).reduce((sum,p,i)=>sum+(p.bridge?distance(p,existing.points[i]):0),0);
          cost+=(span*40*245+wet*40*815)*(getValley().region==='mixed'?.25:1);
        }
        continue;
      }
      const [out,incoming]=ends(leg.points);
      error ||= junctionIssue(from,out,draft.redraw)||junctionIssue(to,incoming,draft.redraw)||section.issue;
      error ||= section.path.some(p=>!within(p))?'Keep the track within the map.':'';
      error ||= places().filter(p=>p.halfWidth&&p.halfDepth).some(p=>section.path.some(q=>
        Math.abs(q.x-p.x)<p.halfWidth+.12&&Math.abs(q.y-p.y)<p.halfDepth+.12))?'Curve the track around the industry buildings.':'';
      const regional=getValley().region==='mixed';
      cost+=(section.length*40*(draft.tracks===2?640:415)+section.waterLength*(draft.tracks===2?2370:1620))*(regional?.25:1);
      cost+=(section.cut*13+section.fill*18)*(regional?.12:1);
      maxGrade=Math.max(maxGrade,section.maxGrade);
      newLength+=section.length;
    }
    if(state.stations.every(Boolean)){
      const [first,last]=state.stations;
      if(legs[0]?.from!==first.id||legs.at(-1)?.to!==last.id)error||='Connect both station platforms.';
      error ||= stationIssue(first,0,stationTrackCount(first,legs))||stationIssue(last,1,stationTrackCount(last,legs));
    }
    const stationsToBuild=state.stations.filter(hasStationWork);
    const impacts=stationsToBuild.map(s=>stationImpact(s,stationTrackCount(s,legs)));
    cost+=stationsToBuild.reduce((sum,s)=>sum+stationConstruction(s),0);
    const lots=[...new Set([...impacts.flatMap(item=>item.lots),...builtLots().filter(lot=>
      legs.some(({section,track})=>section&&nearest(lot,section.path)<(lot.radius??.33)+(track.tracks===2?.40:.25))).map(lot=>lot.key)])];
    const roads=[...new Set(impacts.flatMap(item=>item.roads.map(row=>row.key)))]
      .filter(key=>roadsMarked().includes(key)&&!protectedRoad(key));
    cost+=lots.length*8500+roads.length*3000;
    return {legs,cost:Math.round(cost),lots,roads,newLength,reusedLength,maxGrade,error};
  }
  function setLegs(legs){
    state.legs=legs;
    state.active=Math.max(0,legs.findIndex(leg=>!leg.trackId));
    state.tool='shape';
    activeLevel=-1;
  }
  function useCorridor(via){
    const known=tracks(), built=stations();
    const [start,end]=state.stations;
    if(!start||!end)return;
    const direct=findCorridor(known,built,start.id,end.id,via);
    if(direct.length){
      change(()=>setLegs(direct.map(({track,from,to})=>({trackId:track.id,from,to}))));
      return;
    }
    const selected=known[via];
    if(!selected){showIssue('No continuous rail corridor connects these stations. Select a section on the map to plan new links.');return;}
    const nodes=allNodes();
    const options=[selected.from,selected.to].map(from=>{
      const middle=directed(selected,from);
      const before=findCorridor(known,built,start.id,middle.from);
      const after=findCorridor(known,built,middle.to,end.id);
      const startLink=start.id!==middle.from&&!before.length;
      const endLink=end.id!==middle.to&&!after.length;
      const rejected=(middle.from!==start.id&&built[middle.from]?.terminal)||(middle.to!==end.id&&built[middle.to]?.terminal);
      const penalty=(rejected?1e6:0)+
        (startLink?distance(start,nodes.get(middle.from)):0)+(endLink?distance(end,nodes.get(middle.to)):0);
      return {before,after,middle,startLink,endLink,penalty,rejected};
    }).sort((a,b)=>a.penalty-b.penalty);
    const {before,after,middle,startLink,endLink,rejected}=options[0];
    if(rejected){showIssue('A terminal on this section would prevent a through connection.');return;}
    const legs=[...before,middle,...after].map(({track,from,to})=>({trackId:track.id,from,to}));
    if(startLink)legs.unshift(newLeg(start.id,middle.from,state.legTracks));
    if(endLink)legs.push(newLeg(middle.to,end.id,state.legTracks));
    change(()=>setLegs(legs));
  }
  function roadTie(s,removed=stationConflicts(s).filter(row=>roadsMarked().includes(row.key)).map(row=>row.key)){
    const city=town(s.place);
    if(!city?.roads)return undefined;
    const valley=getValley();
    const center=s.terminal?s.platformLength/2:0;
    const entrance={x:s.x-s.ny*center+s.nx*.55,y:s.y+s.nx*center+s.ny*.55};
    let closest=Infinity,tie;
    for(const road of ContourTown.openRoads(valley,city)){
      if(removed.includes(city.id+':'+road.id))continue;
      for(let i=1;i<road.nodes.length;i++){
        const a=road.nodes[i-1],b=road.nodes[i],direction=heading(a,b);
        const t=clamp(dot({x:entrance.x-a.x,y:entrance.y-a.y},direction)/(distance(a,b)||1),0,1);
        const p=point(a,b,t),gap=distance(entrance,p);
        if(gap<closest){closest=gap;tie={...p,key:city.id+':'+road.id};}
      }
    }
    return tie;
  }
  function cleanPoint(p){return {x:p.x,y:p.y,z:p.z,bridge:p.bridge,water:p.water};}
  function save(){
    if(!state||routeEdit||stationEdit)return;
    try{localStorage.setItem(key(),JSON.stringify({state,view}));}catch{}
  }
  function close(discard=false){
    if(root.hidden)return;
    if(discard&&!routeEdit&&!stationEdit){
      try{localStorage.removeItem(key());}catch{}
    }else save();
    root.hidden=true;
    document.getElementById('app').inert=false;
    document.getElementById('newRoute')?.focus();
    if(history.state?.railEditor)history.back();
    state=null;profileDrag=null;resetProfileGesture();
    finish?.();
  }
  function change(fn){
    undo.push(structuredClone(state));
    if(undo.length>80)undo.shift();
    redo=[];
    fn();
    issue='';
    refresh();
  }
  function restore(from,to){
    if(!from.length)return;
    to.push(state);
    state=from.pop();
    activeLevel=-1;issue='';
    refocus();
    refresh();
  }
  function chooseEndpoint(site){
    if(!site)return;
    const [first,last]=state.places;
    if(first&&!last&&(site.id===first||!getValley().market.trade(town(first),site))){
      showIssue('Choose a destination that can exchange passengers or goods with '+town(first).name+'.');
      return;
    }
    change(()=>{
      if(!first||last)state.places=[site.id,null];
      else state.places[1]=site.id;
      state.stations=state.stations.map((station,i)=>station?.place===state.places[i]?station:null);
      state.legs=[];state.cargo='';state.removedRoads=[];state.platforms=[1,1];
    });
  }
  function suggestCurrentStation(){
    const site=town(state.places[state.step]);
    if(site&&!activeStation()){
      state.stations[state.step]=Object.values(stations()).find(station=>station.place===site.id)??suggest(site);
    }
  }
  function stationChange(changeStation,side=state.step){
    const old=stationEdit?state.station:state.stations[side];
    if(!old)return;
    change(()=>{
      const updated={...old};
      changeStation(updated);
      if(stationEdit)state.station=updated;
      else state.stations[side]=updated;
    });
  }
  function rotateStation(angle){
    const station=activeStation();
    if(!station||stationEdit||committedStation(station))return;
    stationChange(s=>{
      const a=Math.atan2(s.facing.y,s.facing.x)+angle;
      s.facing={x:Math.cos(a),y:Math.sin(a)};
      s.nx=s.facing.y;s.ny=-s.facing.x;s.rotated=true;
    });
  }
  function addPlatform(side){
    const before=stationEdit?state.station:state.stations[side];
    if(platforms(before)>=3)return;
    stationChange(s=>{
      s.platformCount=platforms(s)+1;
      if(!stationEdit){
        state.platforms??=[1,1];
        state.platforms[side]=s.platformCount;
      }
    },side);
  }
  function refocus(){
    if(stationEdit||state.step<2&&activeStation()){
      const s=activeStation();
      view={x:s.x,y:s.y,zoom:getValley().region?14:7};
      return;
    }
    if(state.step===2&&state.stations.every(Boolean)){
      const [a,b]=state.stations,span=Math.max(12,Math.abs(a.x-b.x)+10,Math.abs(a.y-b.y)+10);
      view={x:(a.x+b.x)/2,y:(a.y+b.y)/2,zoom:clamp(Math.min(bounds.east-bounds.west,bounds.south-bounds.north)/span,.8,16)};
      return;
    }
    view={x:(bounds.west+bounds.east)/2,y:(bounds.north+bounds.south)/2,zoom:1};
  }
  function showIssue(message){
    issue=message;
    q('[role=status]').textContent=message;
    q('[role=status]').classList.add('warning');
  }
  function saveStation(){
    const s=state.station;
    const error=stationEditIssue();
    if(error){showIssue(error);return;}
    const impact=stationImpact(s),roads=impact.roads.map(row=>row.key);
    const capital=stationCost(s,impact);
    const result=updateRailStation?.({...s,tie:roadTie(s,roads)??s.tie},{removedLots:impact.lots,removedRoads:roads,capital,assignments:Object.values(state.assignments??{})});
    if(result===false||typeof result==='string'){showIssue(result||'The rail station could not be saved.');return;}
    close(true);
  }
  function stationEditIssue(){
    const s=state.station;
    if(!s.name.trim())return 'Enter a station name.';
    if(s.terminal){const error=terminalIssue(s);if(error)return error;}
    const lengthMetres=s.platformLength*40;
    for(const route of getValley().transport.routes){
      if(route.mode!=='rail'||!route.stations.some(p=>p.id===s.id))continue;
      const cargo=route.cargo??'passengers', stock=window.ContourRail;
      if(getValley().market.fleet(route).vehicles.some(v=>stock?.quote(v.consist??stock.defaultConsist(cargo),cargo).length>lengthMetres))
        return 'An assigned train is longer than this platform.';
    }
    const fit=hasStationWork(s)&&stationSiteIssue(s);
    if(fit)return fit;
    const impact=stationImpact(s);
    return stationCost(s,impact)>getValley().market.state.cash?'Insufficient funds for this station upgrade.':'';
  }
  function stationConstruction(s){
    const original=originalStation(s),length=s.platformLength??2.4;
    const added=platforms(s)-(original?platforms(original):1);
    const existingWork=original?Math.max(0,length-(original.platformLength??2.4))*2200*platforms(original):16000+length*2200;
    return existingWork+Math.max(0,added)*(8500+length*1400);
  }
  function stationCost(s,impact){
    return Math.round(stationConstruction(s)+impact.lots.length*8500+
      impact.roads.filter(row=>roadsMarked().includes(row.key)).length*3000);
  }
  function build(){
    const service=trade();
    if(!service||preview.error)return;
    const cargo=service.cargo, train=window.ContourRail;
    const trainPrice=train?.quote(train.defaultConsist(cargo),cargo).price??26000;
    const capital=preview.cost+(routeEdit?0:trainPrice);
    if(capital>getValley().market.state.cash){showIssue('The available balance will not cover this work.');return;}
    const points=preview.legs.flatMap((leg,i)=>(i?leg.points.slice(1):leg.points).map(cleanPoint));
    const route={mode:'rail',capital,cargo,cargoFrom:service.from.id,points,removedLots:preview.lots,removedRoads:preview.roads,
      platforms:state.stations.map((_,side)=>assignedPlatform(side)),
      stations:state.stations.map(s=>({...s,platformCount:platforms(s),tie:committedStation(s)?.tie??roadTie(s,preview.roads)})),
      trackPaths:preview.legs.map(l=>l.track),trackIds:preview.legs.map(l=>l.track.id),trackDirections:preview.legs.map(l=>l.direction)};
    const result=routeEdit?updateRailRoute?.(routeEdit.index,route):commit?.(route,preview.roads,preview.lots);
    if(result===false||typeof result==='string'){showIssue(result||'The rail route could not be saved.');return;}
    close(true);
  }
  function next(){
    if(stationEdit){saveStation();return;}
    if(state.step===2){
      if(state.review)build();
      else change(()=>{state.review=true;state.profile=false;});
      return;
    }
    if(state.step===-1){
      if(!state.places.every(Boolean))return;
      change(()=>{state.step=0;suggestCurrentStation();});
      refocus();save();draw();return;
    }
    if(stationIssue(activeStation(),state.step))return;
    change(()=>{
      ++state.step;
      state.profile=false;
      if(state.step===1)suggestCurrentStation();
      if(state.step===2){
        initializeLegs();
        if(!routeEdit){
          const found=findCorridor(tracks(),stations(),...state.stations.map(s=>s.id));
          if(found.length)setLegs(found.map(({track,from,to})=>({trackId:track.id,from,to})));
        }
      }
    });
    refocus();
    save();
    draw();
  }
  function button(label,handler,pressed){
    const b=document.createElement('button');
    b.textContent=label;b.onclick=handler;
    if(pressed!==undefined)b.setAttribute('aria-pressed',String(pressed));
    return b;
  }
  function select(label,options,value,handler){
    const wrap=document.createElement('label');
    const input=document.createElement('select');
    input.setAttribute('aria-label',label);
    wrap.append(label,input);
    for(const [id,name] of options)input.add(new Option(name,id));
    input.value=String(value??''); input.onchange=()=>handler(input.value);
    return wrap;
  }
  function profileToggle(){
    const toggle=button('Elevation profile',()=>{state.profile=!state.profile;refresh();});
    toggle.setAttribute('aria-controls','rlProfile');
    toggle.setAttribute('aria-expanded',String(Boolean(state.profile)));
    return toggle;
  }
  const canRedraw=leg=>Boolean(routeEdit&&leg?.trackId&&!getValley().transport.routes.some((r,i)=>
    i!==routeEdit.index&&r.mode==='rail'&&r.trackIds?.includes(leg.trackId)));
  const platformOptions=s=>Array.from({length:platforms(s)},(_,i)=>[i+1,'Platform '+(i+1)]);
  function servicePlatformControls(s,side,label,includeAdd=true){
    const fields=[];
    if(platforms(s)>1)fields.push(select(label,platformOptions(s),assignedPlatform(side),value=>change(()=>{
      state.platforms??=[1,1];
      state.platforms[side]=+value;
    })));
    if(includeAdd&&platforms(s)<3)fields.push(button('Add platform',()=>addPlatform(side)));
    return fields;
  }
  function stationServices(s){
    return getValley().transport.routes.flatMap((route,index)=>route.mode!=='rail'?[]:
      route.stations.flatMap((stop,side)=>stop.id!==s.id?[]:[{
        index,side,key:index+':'+side,name:(index+1)+' · '+route.stations.map(end=>end.name).join(' ↔ '),
        platform:route.platforms?.[side]??1,
      }]));
  }
  function assignStationServices(s){
    const services=stationServices(s);
    if(platforms(s)<2||!services.length)return [];
    const chosen=services.find(row=>row.key===state.selectedService)??services[0];
    return [
      select('Service using station',services.map(row=>[row.key,row.name]),chosen.key,key=>{state.selectedService=key;refresh();}),
      select('Assigned platform',platformOptions(s),state.assignments?.[chosen.key]?.platform??chosen.platform,value=>change(()=>{
        const platform=+value;
        state.assignments??={};
        if(platform===chosen.platform)delete state.assignments[chosen.key];
        else state.assignments[chosen.key]={index:chosen.index,side:chosen.side,platform};
      })),
    ];
  }
  function stationControls(stats){
    const s=activeStation(),fields=[];
    if(!stationEdit){
      if(s)stats.push(town(s.place).name);
      if(s&&Object.values(stations()).some(p=>p.place===s.place)){
        fields.push(select('Rail station',[['new','Place a new station'],...Object.values(stations()).filter(p=>p.place===s.place).map(p=>[p.id,p.name+' · '+p.kind])],
          stations()[s.id]?s.id:'new',id=>{
            const picked=stations()[id];
            change(()=>{
              setStop(state.step,picked??suggest(town(s.place)));
            });
            refocus();
            draw();
          }));
      }
    }else{
      const label=document.createElement('label'),input=document.createElement('input');
      input.type='text';input.setAttribute('aria-label','Station name');input.maxLength=54;input.value=s.name;
      input.onchange=()=>stationChange(station=>{station.name=input.value.trim();});
      label.append('Station name',input);fields.push(label);
    }
    if(s&&(stationEdit||!stations()[s.id])){
      fields.push(select('Configuration',[['terminal','Terminal'],['through','Through station']],s.kind,kind=>stationChange(station=>{
        station.kind=kind;station.terminal=kind==='terminal';
        if(station.terminal&&stationEdit){
          const approach=incident(station)[0];
          if(approach){
            station.facing=ends(directed(approach,station.id).points)[0];
            station.nx=station.facing.y;station.ny=-station.facing.x;
          }
        }
      })));
      fields.push(select('Platform length',[1.2,2.4,3.6,5].map(n=>[n,Math.round(n*40)+' m']),s.platformLength,
        n=>stationChange(station=>{station.platformLength=+n;})));
    }
    if(s){
      stats.push(platforms(s)+(platforms(s)===1?' platform':' platforms'));
      if(stationEdit){
        if(platforms(s)<3)fields.push(button('Add platform',()=>addPlatform()));
        fields.push(...assignStationServices(s));
      }else fields.push(...servicePlatformControls(s,state.step,'Assigned platform'));

      const impact=placement.impact,pending=impact.roads.filter(row=>!roadsMarked().includes(row.key)&&!protectedRoad(row.key));
      if(pending.length)fields.push(button('Mark conflicting streets',()=>markRoads(pending)));
      if(hasStationWork(s))stats.push(money(stationCost(s,impact))+(originalStation(s)?' upgrade':' station work'));
    }
    return fields;
  }
  function markRoads(rows){
    change(()=>{state.removedRoads=[...new Set([...roadsMarked(),...rows.map(row=>row.key)])];});
  }
  function routeControls(stats){
    const fields=[],available=services();
    if(available.length)fields.push(select('Service',available.map(s=>[serviceKey(s),s.cargo==='passengers'?'Passengers':
      (window.ContourRegion?.goods[s.cargo]?.[0]??s.cargo)+' from '+s.from.name]),serviceKey(trade()),cargo=>change(()=>{state.cargo=cargo;})));
    if(state.legs.length>1)fields.push(select('Section',state.legs.map((leg,index)=>[index,(index+1)+' · '+(leg.trackId?'Existing track':'New track')]),
      state.active,index=>{state.active=+index;state.tool='shape';activeLevel=-1;refresh();}));
    const leg=current();
    if(leg&&activeLeg()?.points.length>1)fields.push(profileToggle());
    const platformDetails=document.createElement('details');
    platformDetails.className='editorMore rl-platform-options';
    const summary=document.createElement('summary');
    summary.textContent='Station platforms';
    platformDetails.append(summary);
    const platformControls=document.createElement('div');
    platformControls.className='rb-options';
    state.stations.forEach((s,side)=>{
      const suffix=side===0?'A':'B';
      platformControls.append(...servicePlatformControls(s,side,'Platform '+suffix,false));
      if(platforms(s)<3)platformControls.append(button('Add platform '+suffix,()=>addPlatform(side)));
    });
    if(platformControls.childElementCount){
      platformDetails.append(platformControls);
      platformDetails.open=Boolean(state.platformDetails);
      platformDetails.ontoggle=()=>{if(platformDetails.isConnected)state.platformDetails=platformDetails.open;};
      fields.push(platformDetails);
    }
    const pending=state.stations.flatMap(s=>stationConflicts(s,stationTrackCount(s,preview.legs))).filter(row=>!roadsMarked().includes(row.key)&&!protectedRoad(row.key));
    if(pending.length)fields.push(button('Mark conflicting streets',()=>markRoads(pending)));
    if(routeEdit&&leg?.trackId&&tracks()[leg.trackId]?.tracks===1){
      fields.push(button(leg.double?'Keep single track':'Add second track',()=>change(()=>{leg.double=!leg.double;}),Boolean(leg.double)));
    }
    if(canRedraw(leg)){
      fields.push(button('Redraw section',()=>change(()=>{
        state.legs[state.active]={...newLeg(leg.from,leg.to,tracks()[leg.trackId].tracks),id:leg.trackId,redraw:leg.trackId};
        state.tool='shape';
      })));
    }
    if(leg?.redraw)fields.push(button('Keep original alignment',()=>change(()=>{
      state.legs[state.active]={from:leg.from,to:leg.to,trackId:leg.redraw};
    })));
    if(leg&&!leg.trackId){
      fields.push(select('Tracks',[[1,'Single track'],[2,'Double track']],leg.tracks,tracks=>change(()=>{leg.tracks=+tracks;state.legTracks=+tracks;})));
      fields.push(button('Shape track',()=>{state.tool='shape';refresh();},state.tool==='shape'));
      if(leg.handles.length)fields.push(button('Remove bend',()=>change(()=>{leg.handles.pop();})));
    }
    if(Object.keys(tracks()).length){
      fields.push(button('Select built track',()=>{state.tool=state.tool==='reuse'?'shape':'reuse';refresh();},state.tool==='reuse'));
      fields.push(button('Find connected track',()=>useCorridor()));
      fields.push(button('Join at node',()=>{state.tool=state.tool==='join'?'shape':'join';refresh();},state.tool==='join'));
      if(state.legs.length>1||state.legs[0]?.trackId)fields.push(button('Clear track selection',()=>change(()=>setLegs([
        newLeg(state.stations[0].id,state.stations[1].id,state.legTracks)
      ]))));
    }
    const km=n=>(n*.04).toFixed(2)+' km';
    if(preview.newLength)stats.push(km(preview.newLength)+' new');
    if(preview.reusedLength)stats.push(km(preview.reusedLength)+' reused');
    const upgraded=state.legs.filter(leg=>leg.double).length;
    if(upgraded)stats.push(upgraded+(upgraded===1?' section to double':' sections to double'));
    if(preview.newLength)stats.push(preview.maxGrade.toFixed(1)+'% maximum grade');
    if(preview.lots.length)stats.push(preview.lots.length+' buildings affected');
    if(preview.roads.length)stats.push(preview.roads.length+' streets marked for removal');
    return fields;
  }
  function refresh(){
    if(!state)return;
    const choosing=state.step===-1,running=state.step===2&&!stationEdit;
    preview=running?routePreview():null;
    const active=activeStation(),impact=stationImpact(active);
    placement=active?{impact,served:survivingCatchment(active,impact)}:null;
    const stats=[];
    q('.rl-step').textContent=stationEdit?'':(state.review?5:state.step+2)+' / 5';
    q('#rlTitle').textContent=stationEdit?'Edit rail station':choosing?'Choose endpoints':state.review?'Review rail route':running?'Track alignment':
      state.step===0?'Choose departure station':'Choose arrival station';
    if(choosing){
      const [a,b]=state.places.map(town);
      stats.push([a?.name,b?.name].filter(Boolean).join(' → '));
      q('.rl-controls').replaceChildren(...shared.endpointControls(getValley(),places(),a,b,chooseEndpoint));
    }else{
      const fields=running?routeControls(stats):stationControls(stats);
      q('.rl-controls').replaceChildren(...(state.review?[]:fields));
    }
    const rail=window.ContourRail, service=running?trade():null;
    const capital=running?preview.cost+(routeEdit?0:service&&rail?rail.quote(rail.defaultConsist(service.cargo),service.cargo).price:26000):0;
    if(running)stats.push(money(capital)+(routeEdit?' additional construction':' including first train'));
    if(state.review)stats.push('Platform '+assignedPlatform(0)+' → Platform '+assignedPlatform(1));
    q('.rl-stats').textContent=stats.join(' · ');
    const badges=q('.rl-impact');
    badges.replaceChildren();
    const badge=(label,tone)=>{
      const span=document.createElement('span');
      span.className=tone;
      span.textContent=label;
      badges.append(span);
    };
    if(placement){
      const {served}=placement;
      if(served)badge(served.length+' homes by road','served');
      const buildings=impact.lots.length,streets=impact.roads.length;
      if(buildings)badge(buildings+(buildings===1?' building affected':' buildings affected'),'affected');
      if(streets)badge(streets+(streets===1?' street affected':' streets affected'),'affected');
    }
    const insufficient=capital>getValley().market.state.cash;
    const warning=choosing?'':stationEdit?stationEditIssue():running?preview.error||(!service?'These places have no compatible service.':'')||
      (insufficient?'Insufficient funds for this route.':''):stationIssue(activeStation(),state.step);
    const instruction=choosing?(state.places[1]?'Continue to place the two stations.':state.places[0]?'Choose a destination on the map or below.':'Choose a departure town or industry on the map or below.'):
      state.review?'Check the construction cost and marked removals before confirming.':stationEdit?'Review the platform configuration.':running?
      state.tool==='reuse'?'Tap a built track section to route through it.':
      state.tool==='join'?'Tap a marked track endpoint to join it. Crossing lines do not create a junction.':
      current()?.trackId?'This section uses built track.':state.profile?'Tap the profile to add a grade point, then drag to adjust it.':'Tap the map to bend the alignment. Open Elevation profile to set track elevations.':
      'Tap or drag to place the platform. Select a built station to reuse it.';
    const status=q('[role=status]');
    status.textContent=issue||warning||instruction;
    status.classList.toggle('warning',Boolean(issue||warning));
    action('next').textContent=stationEdit?'Save station':choosing?'Place stations':running?(state.review?(routeEdit?'Save route':'Build route'):'Review'):'Continue';
    action('next').disabled=Boolean(warning)||(choosing&&!state.places.every(Boolean));
    action('back').hidden=stationEdit||choosing;
    action('discard').textContent=routeEdit||stationEdit?'Cancel':'Discard draft';
    action('undo').disabled=!undo.length;action('redo').disabled=!redo.length;
    q('.rl-profile').hidden=!(running&&state.profile&&!state.review&&activeLeg()?.points.length>1);
    const note=q('.rl-profile-note');
    note.textContent=canRedraw(current())?'Existing track elevation. Use Redraw section to edit it.':'Existing track elevation.';
    note.hidden=Boolean(activeSection());
    q('.rb-profile-controls').hidden=!activeSection();
    if(!q('.rl-profile').hidden)drawProfile();
    save();
    draw();
  }
  function area(points,color){shared.tracePath(ctx,points,screen);ctx.closePath();ctx.fillStyle=color;ctx.fill();}
  const drawStationAsset=shared.createStationPainter(stationFaces,area);
  function draw(){
    if(root.hidden||!state||!width()||!height())return;
    const w=width(),h=height(),ratio=Math.min(window.devicePixelRatio||1,2);
    if(map.width!==Math.round(w*ratio)||map.height!==Math.round(h*ratio)){
      map.width=Math.round(w*ratio);map.height=Math.round(h*ratio);
    }
    ctx.setTransform(ratio,0,0,ratio,0,0);
    const valley=getValley(),scaleHint=scale();
    renderTerrain({ctx,width:w,height:h,valley,bounds,view,scaleHint,screen,world,detail:state.step<2&&Boolean(activeStation())});
    const path=(points,color,stroke)=>{
      if(!points.length)return;
      shared.tracePath(ctx,points,screen);
      ctx.strokeStyle=color;ctx.lineWidth=stroke;ctx.stroke();
    };
    const mark=(p,r,color)=>{
      const s=screen(p);ctx.beginPath();ctx.arc(s.x,s.y,r,0,Math.PI*2);
      ctx.fillStyle=color;ctx.fill();
    };
    const label=(p,value,color)=>{
      const s=screen(p);ctx.font='bold 13px system-ui';ctx.strokeStyle='#fff9e5';ctx.lineWidth=4;
      ctx.strokeText(value,s.x+8,s.y-8);ctx.fillStyle=color;ctx.fillText(value,s.x+8,s.y-8);
    };
    ctx.lineCap='round';ctx.lineJoin='round';
    const active=activeStation(),impact=placement?.impact??{lots:[],roads:[]};
    const affectedRoads=preview?state.stations.flatMap(s=>stationConflicts(s,stationTrackCount(s,preview.legs))):impact.roads;
    const conflictKeys=new Set(affectedRoads.map(row=>row.key));
    const marked=new Set(roadsMarked().filter(key=>conflictKeys.has(key)));
    const served=new Set(placement?.served??[]);
    shared.drawTownMap({ctx,screen,line:path,scaleHint,w,h,valley,lots:builtLots(),roads:roadRows(),
      lost:new Set(preview?.lots??impact.lots),served,roadConflicts:conflictKeys,deleted:marked});
    if(state.step===-1){
      const endpoints=state.places.map(town).filter(Boolean);
      if(endpoints.length===2){ctx.setLineDash([5,4]);path(endpoints,'#246c73',2);ctx.setLineDash([]);}
      for(const site of endpoints)mark(site,9,'#e4b568');
    }
    for(const site of places()){
      if(site.halfWidth&&site.halfDepth){
        const {x,y,halfWidth,halfDepth}=site;
        area([{x:x-halfWidth,y:y-halfDepth},{x:x+halfWidth,y:y-halfDepth},
          {x:x+halfWidth,y:y+halfDepth},{x:x-halfWidth,y:y+halfDepth}],'#b98e62');
      }
      mark(site,5,site.halfWidth?'#965d37':'#345c46');
      label(site,site.name,'#224a3c');
    }
    const selected=new Set(preview?.legs.filter(l=>!l.section).map(l=>l.track.id)??[]);
    for(const track of Object.values(tracks())){
      const color=selected.has(track.id)?'#6de4d2':'#222625';
      const double=track.tracks===2||preview?.legs.some(leg=>leg.track.id===track.id&&leg.track.tracks===2);
      path(track.points,'#e1e1c4bf',double?6:4);
      path(track.points,color,double?3:2);
    }
    if(state.tool==='join'&&state.step===2){
      for(const node of allNodes().values())mark(node,4,'#fff4b4');
    }
    for(const [i,leg] of (preview?.legs??[]).entries()){
      if(!leg.section)continue;
      const active=i===state.active, color=active?'#ffde7e':'#dbaa56';
      path(leg.points,'#412e15',leg.track.tracks===2?7:5);
      path(leg.points,color,leg.track.tracks===2?4:2.5);
      if(active)for(const bend of current().handles)mark(bend,4,'#fff6cd');
    }
    const platform=(s,highlight)=>{
      const trackCount=stationTrackCount(s,preview?.legs);
      const shape=stationFootprint(s,trackCount);
      if(scaleHint>5){drawStationAsset(s,false,trackCount);}
      else mark(s,5,highlight?'#286452':'#398676');
      if(highlight&&scaleHint>5){
        const warning=state.step<2&&(stationEdit?stationEditIssue():stationIssue(s,state.step));
        path([...shape,shape[0]],warning?'#b4483b':'#2a715c',2);
        const anchor=s.tie??roadTie(s);
        if(anchor){ctx.setLineDash([4,3]);path([s,anchor],'#3a826e',1.6);ctx.setLineDash([]);}
      }
      const position=state.stations?.findIndex(stop=>stop?.id===s.id);
      if(highlight&&scaleHint>8){
        const layout=window.ContourRail?.stationLayout?.(s,trackCount),pads=layout?.platforms??[];
        const selection=position>=0?assignedPlatform(position):undefined;
        const midpoint=layout?(layout.start+layout.end)/2:0;
        for(const pad of pads){
          const side=lerp((pad.near+pad.far)/2,pad.edge,.55);
          const split=pads.some(other=>other!==pad&&other.near===pad.near&&other.far===pad.far);
          const along=split?midpoint+(pad.index===2?-.21:.21)*Math.min(s.platformLength??2.4,3):midpoint;
          const center={x:s.x-s.ny*along+s.nx*side,y:s.y+s.nx*along+s.ny*side};
          if(scaleHint*Math.abs(pad.far-pad.near)<12&&pad.index!==selection)continue;
          mark(center,9,pad.index===selection?'#247965':'#48584c');
          const {x,y}=screen(center);
          ctx.font='bold 11px system-ui';ctx.textAlign='center';ctx.fillStyle='#fff9e5';
          ctx.fillText(pad.index,x,y+4);ctx.textAlign='start';
        }
      }
      if(highlight||state.step<2){
        const site=town(s.place),text=site?.name===s.name?(position>=0?(position===0?'A':'B'):'Rail'):s.name;
        const nearLabel=site&&distance(s,site)*scaleHint<30;
        const labelPoint={x:s.x,y:s.y+(nearLabel?23/scaleHint:0)};
        label(labelPoint,text,'#224a3c');
      }
    };
    const drawn=new Set([...(state.stations??[]),state.station].filter(Boolean).map(s=>s.id));
    for(const s of Object.values(stations()))if(!drawn.has(s.id))platform(s,false);
    for(const s of (state.stations??[]).filter(Boolean))platform(s,true);
    if(stationEdit)platform(state.station,true);
    const placing=!stationEdit&&state.step>=0&&state.step<2&&active;
    const turnable=placing&&!committedStation(active);
    if(placing){
      const opposite=state.stations[1-state.step]??town(state.places[1-state.step]);
      if(opposite){
        const face=heading(active,opposite),start=screen(active);
        const offset=turnable&&face.y<-.45?((start.x<w/2?1:-1)*(58+Math.abs(face.x)*24))/scaleHint:0;
        const from={...active,x:active.x+offset},to={...opposite,x:opposite.x+offset};
        shared.drawDirection?.(ctx,screen,w,h,from,to,state.step===0?'Toward B':'Toward A');
      }
    }
    if(turnable){
      const pixels=stationFootprint(active).map(screen);
      const x=pixels.reduce((sum,p)=>sum+p.x,0)/pixels.length,y=Math.min(...pixels.map(p=>p.y));
      rotateControls.hidden=x<0||x>w||y>h||pixels.every(p=>p.y<0);
      rotateControls.style.left=clamp(x,58,w-58)+'px';
      rotateControls.style.top=clamp(y-7,49,h-3)+'px';
    }else rotateControls.hidden=true;
  }
  function profileSection(){
    const leg=activeLeg();
    if(leg.section)return leg.section;
    let run=0;
    const path=leg.points.map((p,i)=>{
      if(i)run+=distance(leg.points[i-1],p);
      return {...p,d:run,ground:ground(p.x,p.y)};
    });
    return {path,length:run};
  }
  function profileBounds(section=profileSection()){
    const values=section.path.flatMap(p=>[p.ground,p.z]).concat(section.levels?.map(p=>p.z)??[]);
    const w=profile.clientWidth,h=profile.clientHeight;
    return {min:profileDrag?.scale.min??Math.min(...values)-.12,max:profileDrag?.scale.max??Math.max(...values)+.20,
      w,h,left:35,right:w-13,top:10,bottom:h-22};
  }
  function drawProfile(){
    if(!state||!activeLeg()?.points.length||!profile.clientWidth||!profile.clientHeight)return;
    const section=profileSection(),g=profileBounds(section),ratio=Math.min(window.devicePixelRatio||1,2);
    if(!section.length)return;
    const {x,y}=shared.drawProfileBase({canvas:profile,c:pc,g,ratio,path:section.path,length:section.length,heightScale});
    const design=section.design;
    if(design){
      pc.setLineDash([3,4]);pc.beginPath();pc.moveTo(x(0),y(section.levels[0].z));
      design.curves.forEach(p=>pc.lineTo(x(p.d/section.length),y(p.z)));
      pc.lineTo(x(1),y(section.levels.at(-1).z));pc.lineWidth=1;pc.strokeStyle='#607d8a';pc.stroke();pc.setLineDash([]);
      shared.drawProfileCurve(pc,d=>x(d/section.length),y,0,section.length,180,2.8,design,heightScale,4);
      design.curves.forEach((p,i)=>{
        const end=i===0||i===design.curves.length-1;
        const selected=i-1===activeLevel;
        pc.beginPath();pc.arc(x(p.d/section.length),y(p.z),end?3:selected?7:5,0,Math.PI*2);
        pc.fillStyle=end?'#706c60':selected?'#674e97':'#285e73';pc.fill();
      });
    }else{
      pc.beginPath();
      section.path.forEach((p,i)=>{if(i)pc.lineTo(x(p.d/section.length),y(p.z));else pc.moveTo(x(0),y(p.z));});
      pc.strokeStyle='#1f6c79';pc.lineWidth=2.8;pc.stroke();
    }
    pc.fillStyle='#44594e';pc.fillText('0',g.left,g.h-5);
    pc.textAlign='right';pc.fillText((section.length*.04).toFixed(2)+' km',g.right,g.h-5);pc.textAlign='left';
    const level=design&&current().vips[activeLevel],input=q('.rl-profile input');
    input.disabled=!level;
    action('removeLevel').disabled=!level;
    action('resetProfile').disabled=!design||!current().vips.length;
    if(level)input.value=level.radius;
    q('.rl-profile output').textContent=level?Math.round(level.radius)+' m':'Select a VIP';
  }
  function setStop(side,station){
    if(state.stations[side]?.id===station?.id)return;
    state.platforms??=[1,1];
    state.platforms[side]=1;
    state.stations[side]=station;
    state.legs=[];
  }
  function tap(p){
    const worldPoint=world(p);
    if(stationEdit)return;
    if(state.step===-1){
      const site=places().filter(site=>distance(p,screen(site))<24).sort((a,b)=>distance(p,screen(a))-distance(p,screen(b)))[0];
      if(site)chooseEndpoint(site);
      return;
    }
    if(state.review)return;
    if(state.step<2){
      const snapped=Object.values(stations()).filter(s=>distance(p,screen(s))<=16).sort((a,b)=>distance(p,screen(a))-distance(p,screen(b)))[0];
      if(snapped&&snapped.place===state.places[state.step]){
        change(()=>setStop(state.step,snapped));
        return;
      }
      if(!state.places[state.step]){showIssue('Choose the town or industry this station serves.');return;}
      change(()=>setStop(state.step,createStation(worldPoint,state.places[state.step])));
      return;
    }
    if(state.tool==='reuse'){
      const found=Object.values(tracks()).map(track=>({track,gap:nearest(worldPoint,track.points)})).sort((a,b)=>a.gap-b.gap)[0];
      if(!found||found.gap*scale()>15){showIssue('Tap closer to a built section.');return;}
      useCorridor(found.track.id);
      return;
    }
    if(state.tool==='join'){
      const leg=current();
      if(!leg||leg.trackId||leg.redraw){showIssue('Select a new section to join at a node.');return;}
      const node=[...allNodes().values()].filter(n=>n.id!==leg.from&&n.id!==leg.to&&distance(p,screen(n))<16)
        .sort((a,b)=>distance(p,screen(a))-distance(p,screen(b)))[0];
      if(!node){showIssue('Tap a marked track endpoint.');return;}
      if(node.terminal){showIssue('A terminal cannot be an intermediate connection.');return;}
      change(()=>{
        state.legs.splice(state.active,1,newLeg(leg.from,node.id,leg.tracks),newLeg(node.id,leg.to,leg.tracks));
        state.tool='shape';
      });
      return;
    }
    const leg=current(),section=activeSection();
    if(!leg||leg.trackId||!section?.path.length)return;
    change(()=>{
      if(leg.handles.length>=20)leg.handles.shift();
      const snap=section.path.reduce((a,b)=>distance(a,worldPoint)<distance(b,worldPoint)?a:b);
      const order=leg.handles.findIndex(p=>section.path.reduce((a,b)=>distance(a,p)<distance(b,p)?a:b).d>snap.d);
      leg.handles.splice(order<0?leg.handles.length:order,0,worldPoint);
    });
  }
  function zoom(factor,p={x:width()/2,y:height()/2}){
    const prior=world(p);
    view.zoom=clamp(view.zoom*factor,.65,45);
    const after=world(p);
    view.x+=prior.x-after.x;view.y+=prior.y-after.y;
    draw();save();
  }
  map.addEventListener('wheel',e=>{e.preventDefault();zoom(Math.exp(-e.deltaY*.002),eventPoint(e,map));},{passive:false});
  const pointers=new Map();
  map.addEventListener('pointerdown',e=>{
    if(!state||e.button!==0)return;
    map.setPointerCapture(e.pointerId);
    const p=eventPoint(e,map);
    pointers.set(e.pointerId,p);
    if(pointers.size===1){
      const bend=!state.review&&state.step===2&&state.tool==='shape'&&!current()?.trackId?
        current()?.handles.findIndex(handle=>distance(p,screen(handle))<12):-1;
      const active=activeStation(),onPlatform=!stationEdit&&state.step>=0&&state.step<2&&active&&!stations()[active.id]&&
        shared.hitsStation(world(p),active,Math.max(.12,9/scale()));
      pointer={start:p,dragged:false,bend:bend??-1,before:structuredClone(state),station:onPlatform?active:null};
    }else if(pointer){pointer.dragged=true;pointer.pinched=true;}
  });
  map.addEventListener('pointermove',e=>{
    const previous=pointers.get(e.pointerId);
    if(!previous||!pointer)return;
    const p=eventPoint(e,map);
    pointers.set(e.pointerId,p);
    if(pointers.size>1){
      const other=[...pointers.entries()].find(([id])=>id!==e.pointerId)[1];
      zoom(distance(p,other)/Math.max(1,distance(previous,other)),point({...p,z:0},{...other,z:0},.5));
      return;
    }
    if(!pointer.dragged&&distance(p,pointer.start)<=4)return;
    pointer.dragged=true;
    if(pointer.station&&!pointer.pinched){
      const original=pointer.station,x=original.x+(p.x-pointer.start.x)/scale(),y=original.y+(p.y-pointer.start.y)/scale();
      state.stations[state.step]={...original,x,y,z:ground(x,y)};
      state.legs=[];
      issue='';refresh();
    }else if(pointer.bend>=0&&!pointer.pinched){
      current().handles[pointer.bend]=world(p);
      issue='';refresh();
    }else{
      view.x-=(p.x-previous.x)/scale();view.y-=(p.y-previous.y)/scale();draw();
    }
  });
  for(const event of ['pointerup','pointercancel','lostpointercapture'])map.addEventListener(event,e=>{
    if(!pointers.delete(e.pointerId)||pointers.size||!pointer)return;
    if(event==='pointerup'&&!pointer.dragged)tap(eventPoint(e,map));
    else if((pointer.bend>=0||pointer.station)&&pointer.dragged){
      undo.push(pointer.before);redo=[];refresh();
    }else save();
    pointer=null;
  });
  const resetProfileGesture=shared.bindProfileEditor(profile,{
    editable:()=>!root.hidden&&!state.review&&!q('.rl-profile').hidden&&Boolean(activeSection()?.design),
    model:activeSection,
    bounds:profileBounds,
    values:()=>current().vips,
    before:()=>structuredClone(state),
    defaultRadius:180,
    drag:gesture=>{profileDrag=gesture;activeLevel=gesture.index;issue='';refresh();},
    finish:gesture=>{profileDrag=null;undo.push(gesture.before);redo=[];refresh();},
  });
  q('.rl-profile input').oninput=e=>{
    const level=current()?.vips[activeLevel];
    if(!level)return;
    levelSnapshot??=structuredClone(state);
    level.radius=+e.target.value;
    refresh();
  };
  q('.rl-profile input').onchange=()=>{
    if(!levelSnapshot)return;
    undo.push(levelSnapshot);redo=[];levelSnapshot=null;refresh();
  };
  action('resetProfile').onclick=()=>change(()=>{current().vips=[];activeLevel=-1;});
  action('removeLevel').onclick=()=>change(()=>{current().vips.splice(activeLevel,1);activeLevel=-1;});
  action('undo').onclick=()=>restore(undo,redo);
  action('redo').onclick=()=>restore(redo,undo);
  action('close').onclick=()=>close();
  action('discard').onclick=()=>close(true);
  action('back').onclick=()=>{
    change(()=>{
      if(state.review)state.review=false;
      else{--state.step;state.profile=false;}
    });
    refocus();save();draw();
  };
  action('next').onclick=next;
  action('turnLeft').onclick=()=>rotateStation(-Math.PI/12);
  action('turnRight').onclick=()=>rotateStation(Math.PI/12);
  action('minus').onclick=()=>zoom(.75);
  action('plus').onclick=()=>zoom(1.33);
  root.addEventListener('keydown',e=>{
    if(e.key==='Escape'){e.preventDefault();close();return;}
    if((e.ctrlKey||e.metaKey)&&!['INPUT','SELECT'].includes(e.target.tagName)&&e.key.toLowerCase()==='z'){
      e.preventDefault();if(e.shiftKey)restore(redo,undo);else restore(undo,redo);
    }
  });
  window.addEventListener('popstate',()=>{if(!root.hidden)close();});
  new ResizeObserver(()=>{draw();if(!q('.rl-profile').hidden)drawProfile();}).observe(map);
  function open(savedView){
    begin?.();undo=[];redo=[];preview=null;issue='';activeLevel=-1;pointer=null;profileDrag=null;levelSnapshot=null;
    drawStationAsset.clear();resetProfileGesture();
    pointers.clear();
    document.getElementById('app').inert=true;
    root.hidden=false;
    history.pushState({railEditor:true},'','');
    refocus();
    if(savedView)view=savedView;
    refresh();
    action('close').focus();
  }
  return {
    open(){
      routeEdit=null;stationEdit=null;
      state={step:-1,places:[null,null],stations:[null,null],legs:[],legTracks:1,active:0,tool:'shape',profile:false,cargo:''};
      let saved;
      try{saved=JSON.parse(localStorage.getItem(key()));}catch{}
      if(saved?.state?.stations?.length===2){
        state=saved.state;
        state.platforms??=[1,1];
        state.stations=state.stations.map(s=>{
          const built=committedStation(s);
          return built?{...built,platformCount:Math.max(platforms(s),platforms(built))}:s;
        });
        if(!state.places.every(Boolean))state.step=-1;
      }
      open(saved?.view);
    },
    openRoute(route,index){
      routeEdit={route,index};stationEdit=null;
      const endpoints=route.stations.map(s=>stations()[s.id]??s);
      const legs=(route.trackIds??[]).map((id,i)=>{
        const track=tracks()[id]??route.trackPaths?.find(p=>p.id===id);
        if(!track)return null;
        const {from,to}=directed(track,route.trackDirections?.[i]===-1?track.to:track.from);
        return {trackId:id,from,to};
      }).filter(Boolean);
      state={step:2,places:endpoints.map(s=>s.place),stations:endpoints,legs,legTracks:1,active:0,tool:'shape',profile:false,platforms:route.platforms?.slice()??[1,1],cargo:(route.cargo??'passengers')+'|'+route.cargoFrom};
      if(!legs.length)initializeLegs();
      open();
    },
    openStation(station){
      stationEdit=station;routeEdit=null;
      state={station:{platformLength:2.4,platformCount:1,...station},step:0,stations:[],legs:[],assignments:{}};
      open();
    },
  };
};
})();
