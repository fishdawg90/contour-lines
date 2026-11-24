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

window.createRailBuilder=function({getValley,bounds,heightScale,draftKey,begin,finish,commit,updateRailRoute,updateRailStation,designSection}){
  const root=document.createElement('section');
  root.id='railBuilder';
  root.hidden=true;
  root.setAttribute('role','dialog');
  root.setAttribute('aria-modal','true');
  root.setAttribute('aria-labelledby','rlTitle');
  root.innerHTML=`
    <div class="rl-header"><h2 id="rlTitle">Rail route</h2><button data-action="undo" aria-label="Undo" title="Undo">↶</button><button data-action="redo" aria-label="Redo" title="Redo">↷</button><button data-action="close" aria-label="Close" title="Close">×</button></div>
    <div class="rl-map"><canvas aria-label="Rail construction map"></canvas><div class="rl-zoom"><button data-action="minus" aria-label="Zoom out">−</button><button data-action="plus" aria-label="Zoom in">+</button></div></div>
    <div class="rl-profile" hidden><canvas tabindex="0" aria-label="Track elevation profile. Click to set an elevation control point."></canvas>
      <label>Elevation <input type="range" aria-label="Control point elevation" step="0.01"><output></output></label><button data-action="removeLevel">Remove point</button></div>
    <footer>
      <div class="rl-controls"></div>
      <div class="rl-stats"></div>
      <p role="status"></p>
      <div class="rl-actions"><button data-action="discard">Discard draft</button><button data-action="back">Back</button><button data-action="next">Continue</button></div>
    </footer>`;
  document.body.append(root);
  const q=s=>root.querySelector(s), action=name=>q('[data-action="'+name+'"]');
  const map=q('.rl-map canvas'),ctx=map.getContext('2d'), profile=q('.rl-profile canvas'),pc=profile.getContext('2d');
  const terrain=document.createElement('canvas');
  let state,view,undo,redo,routeEdit,stationEdit,preview,issue='',pointer,terrainKey,plot,activeLevel=-1,levelSnapshot;
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
  const eventPoint=(event,canvas)=>{const b=canvas.getBoundingClientRect();return {x:event.clientX-b.left,y:event.clientY-b.top};};
  const ground=(x,y)=>(getValley().designGround??getValley().ground)(x,y);
  const within=p=>p.x>bounds.west+.1&&p.x<bounds.east-.1&&p.y>bounds.north+.1&&p.y<bounds.south-.1;
  const dry=p=>within(p)&&!getValley().wet(p.x,p.y);
  const current=()=>state.legs[state.active];
  const activeStation=()=>stationEdit?state.station:state.stations[state.step];
  const activeSection=()=>preview?.legs[state.active]?.section;
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
  function footprint(s){
    const t={x:-s.ny,y:s.nx};
    const offsets=s.terminal?[0,.25,.5,.75,1]:[-.5,-.25,0,.25,.5];
    return offsets.flatMap(f=>[-.52,.52].map(side=>({
      x:s.x+t.x*f*s.platformLength+s.nx*side,
      y:s.y+t.y*f*s.platformLength+s.ny*side,
    })));
  }
  function platformHits(station,lot){
    const dx=lot.x-station.x,dy=lot.y-station.y,span=station.platformLength??2.4;
    const along=-dx*station.ny+dy*station.nx,side=dx*station.nx+dy*station.ny;
    const offset=station.terminal?0:-span/2,margin=lot.radius??.33;
    return along>=offset-margin&&along<=offset+span+margin&&Math.abs(side)<.62+margin;
  }
  function stationIssue(s,index){
    if(!s)return 'Choose a place and set a rail station on the map.';
    if(!town(s.place))return 'The station must serve a town or an industry.';
    const platform=s.platformLength??2.4;
    const site=town(s.place);
    if(distance(s,site)>13)return 'Keep the station within 520 m of '+site.name+'.';
    const other=state.stations?.[1-index];
    if(other&&(other.id===s.id||distance(other,s)<(platform+(other.platformLength??2.4))/2+.5))
      return 'Separate the station platforms.';
    if(stations()[s.id])return '';
    const corners=footprint(s);
    if(corners.some(p=>!dry(p)))return 'The platform needs a dry footprint inside the map.';
    if(corners.some(p=>Math.abs(ground(p.x,p.y)-s.z)>.33))return 'Choose more level ground for the platform.';
    const occupied=[...Object.values(stations()),...(getValley().builtStations??[]).filter(p=>p.mode!=='rail')];
    if(occupied.some(p=>distance(s,p)<1.6))return 'The station overlaps an existing station.';
    if(places().filter(p=>p.halfWidth&&p.halfDepth).some(p=>[s,...corners].some(q=>
      Math.abs(q.x-p.x)<p.halfWidth+.25&&Math.abs(q.y-p.y)<p.halfDepth+.25)))return 'Move the platform away from the industry buildings.';
    if(Object.values(tracks()).some(track=>nearest(s,track.points)<.8))return 'Select a built rail station or move away from existing track.';
    return '';
  }
  function createStation(p,place){
    const currentSite=town(place);
    const target=state.stations[1-state.step]??town(state.places[1-state.step])??currentSite;
    const t=heading(p,target);
    const facing=t.x||t.y?t:{x:1,y:0};
    return {mode:'rail',id:id('rail-station'),x:p.x,y:p.y,z:ground(p.x,p.y),nx:facing.y,ny:-facing.x,place,
      name:currentSite.name,kind:'terminal',terminal:true,facing,platformLength:2.4};
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
      error ||= stationIssue(first,0)||stationIssue(last,1);
    }
    const stationsToBuild=state.stations.filter(s=>s&&!stations()[s.id]);
    cost+=stationsToBuild.reduce((sum,s)=>sum+16000+s.platformLength*2200,0);
    const lots=[];
    for(const city of getValley().towns){
      for(const lot of getValley().market.homes(city)){
        const clearance=lot.radius??.33;
        const obstructed=stationsToBuild.some(s=>platformHits(s,lot))||
          legs.some(({section,track})=>section&&nearest(lot,section.path)<clearance+(track.tracks===2?.40:.25));
        if(obstructed)lots.push(city.id+':'+lot.id);
      }
    }
    cost+=lots.length*8500;
    return {legs,cost:Math.round(cost),lots,newLength,reusedLength,maxGrade,error};
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
  function roadTie(s){
    const city=town(s.place);
    if(!city?.roads)return undefined;
    const valley=getValley();
    const center=s.terminal?s.platformLength/2:0;
    const entrance={x:s.x-s.ny*center+s.nx*.55,y:s.y+s.nx*center+s.ny*.55};
    let closest=Infinity,tie;
    for(const road of ContourTown.openRoads(valley,city)){
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
    state=null;
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
  function selectPlace(place){
    const site=town(place);
    change(()=>{
      state.places[state.step]=site?.id??null;
      state.stations[state.step]=site?(Object.values(stations()).find(s=>s.place===place)??suggest(site)):null;
      state.legs=[];
    });
    refocus();
    draw();
  }
  function stationChange(changeStation){
    const old=activeStation();
    if(!old)return;
    change(()=>{
      const updated={...old};
      changeStation(updated);
      if(stationEdit)state.station=updated;
      else state.stations[state.step]=updated;
    });
  }
  function resetEndpoints(){
    const [a,b]=state.stations;
    for(const [s,other] of [[a,b],[b,a]]){
      if(stations()[s.id]||s.rotated)continue;
      const face=heading(s,other);
      s.facing=face;s.nx=face.y;s.ny=-face.x;
    }
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
    const result=updateRailStation?.(s);
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
    if(footprint(s).some(p=>!dry(p)||Math.abs(ground(p.x,p.y)-s.z)>.33))return 'The platform needs dry, level ground.';
    if(getValley().towns.some(city=>getValley().market.homes(city).some(lot=>platformHits(s,lot)&&!platformHits(stationEdit,lot))))
      return 'The new platform footprint overlaps an occupied building.';
    return '';
  }
  function build(){
    const service=trade();
    if(!service||preview.error)return;
    const cargo=service.cargo, train=window.ContourRail;
    const trainPrice=train?.quote(train.defaultConsist(cargo),cargo).price??26000;
    const capital=preview.cost+(routeEdit?0:trainPrice);
    if(capital>getValley().market.state.cash){showIssue('The available balance will not cover this work.');return;}
    const points=preview.legs.flatMap((leg,i)=>(i?leg.points.slice(1):leg.points).map(cleanPoint));
    const route={mode:'rail',capital,cargo,cargoFrom:service.from.id,points,removedLots:preview.lots,
      stations:state.stations.map(s=>({...s,tie:stations()[s.id]?.tie??roadTie(s)})),
      trackPaths:preview.legs.map(l=>l.track),trackIds:preview.legs.map(l=>l.track.id),trackDirections:preview.legs.map(l=>l.direction)};
    const result=routeEdit?updateRailRoute?.(routeEdit.index,route):commit?.(route,[],preview.lots);
    if(result===false||typeof result==='string'){showIssue(result||'The rail route could not be saved.');return;}
    close(true);
  }
  function next(){
    if(stationEdit){saveStation();return;}
    if(state.step===2){build();return;}
    if(stationIssue(activeStation(),state.step))return;
    change(()=>{
      ++state.step;
      if(state.step===2){
        resetEndpoints();
        initializeLegs();
        if(!routeEdit){
          const found=findCorridor(tracks(),stations(),...state.stations.map(s=>s.id));
          if(found.length)setLegs(found.map(({track,from,to})=>({trackId:track.id,from,to})));
        }
      }
    });
    refocus();
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
  function stationControls(stats){
    const s=activeStation(),fields=[];
    if(!stationEdit){
      fields.push(select('Serves',[['','Choose a place'],...places().map(p=>[p.id,p.name])],state.places[state.step],selectPlace));
      if(s&&Object.values(stations()).some(p=>p.place===s.place)){
        fields.push(select('Platform',[['new','Place a new station'],...Object.values(stations()).filter(p=>p.place===s.place).map(p=>[p.id,p.name+' · '+p.kind])],
          stations()[s.id]?s.id:'new',id=>{
            const picked=stations()[id];
            change(()=>{
              state.stations[state.step]=picked??suggest(town(s.place));
              state.legs=[];
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
      if(!stationEdit)fields.push(button('Rotate 15°',()=>stationChange(station=>{
        const a=Math.atan2(station.facing.y,station.facing.x)+Math.PI/12;
        station.facing={x:Math.cos(a),y:Math.sin(a)};
        station.nx=station.facing.y;station.ny=-station.facing.x;station.rotated=true;
      })));
    }
    if(s)stats.push(s.terminal?'Trains reverse at this station.':'Track can connect at either end.');
    return fields;
  }
  function routeControls(stats){
    const fields=[],available=services();
    if(available.length)fields.push(select('Service',available.map(s=>[serviceKey(s),s.cargo==='passengers'?'Passengers':
      (window.ContourRegion?.goods[s.cargo]?.[0]??s.cargo)+' from '+s.from.name]),serviceKey(trade()),cargo=>change(()=>{state.cargo=cargo;})));
    if(state.legs.length>1)fields.push(select('Section',state.legs.map((leg,index)=>[index,(index+1)+' · '+(leg.trackId?'Existing track':'New track')]),
      state.active,index=>{state.active=+index;state.tool='shape';activeLevel=-1;refresh();}));
    const leg=current();
    if(routeEdit&&leg?.trackId&&tracks()[leg.trackId]?.tracks===1){
      fields.push(button(leg.double?'Keep single track':'Add second track',()=>change(()=>{leg.double=!leg.double;}),Boolean(leg.double)));
    }
    if(routeEdit&&leg?.trackId&&!getValley().transport.routes.some((r,i)=>
      i!==routeEdit.index&&r.mode==='rail'&&r.trackIds?.includes(leg.trackId))){
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
      fields.push(button('Profile',()=>{state.profile=!state.profile;refresh();},state.profile));
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
    return fields;
  }
  function refresh(){
    if(!state)return;
    const running=state.step===2&&!stationEdit;
    preview=running?routePreview():null;
    const stats=[];
    q('#rlTitle').textContent=stationEdit?'Edit rail station':running?(routeEdit?'Edit rail route':'Build rail route'):
      state.step===0?'Choose departure station':'Choose arrival station';
    q('.rl-controls').replaceChildren(...(running?routeControls(stats):stationControls(stats)));
    const rail=window.ContourRail, service=running?trade():null;
    const capital=running?preview.cost+(routeEdit?0:service&&rail?rail.quote(rail.defaultConsist(service.cargo),service.cargo).price:26000):0;
    if(running)stats.push(money(capital)+(routeEdit?' additional construction':' including first train'));
    q('.rl-stats').textContent=stats.join(' · ');
    const insufficient=capital>getValley().market.state.cash;
    const warning=stationEdit?stationEditIssue():running?preview.error||(!service?'These places have no compatible service.':'')||
      (insufficient?'Insufficient funds for this route.':''):stationIssue(activeStation(),state.step);
    const instruction=stationEdit?'Review the platform configuration.':running?
      state.tool==='reuse'?'Tap a built track section to route through it.':
      state.tool==='join'?'Tap a marked track endpoint to join it. Crossing lines do not create a junction.':
      current()?.trackId?'This section uses built track.':'Tap the map to bend the alignment. Open Profile to set track elevations.':
      'Tap the map to place the platform or select a built station.';
    const status=q('[role=status]');
    status.textContent=issue||warning||instruction;
    status.classList.toggle('warning',Boolean(issue||warning));
    action('next').textContent=stationEdit?'Save station':running?(routeEdit?'Save route':'Build route'):'Continue';
    action('next').disabled=Boolean(warning);
    action('back').hidden=stationEdit||state.step===0;
    action('discard').textContent=routeEdit||stationEdit?'Cancel':'Discard draft';
    action('undo').disabled=!undo.length;action('redo').disabled=!redo.length;
    q('.rl-profile').hidden=!(running&&state.profile&&activeSection()?.path.length>1);
    if(!q('.rl-profile').hidden)drawProfile();
    save();
    draw();
  }
  function draw(){
    if(root.hidden||!state||!width()||!height())return;
    const w=width(),h=height(),ratio=Math.min(window.devicePixelRatio||1,2);
    if(map.width!==Math.round(w*ratio)||map.height!==Math.round(h*ratio)){
      map.width=Math.round(w*ratio);map.height=Math.round(h*ratio);
    }
    ctx.setTransform(ratio,0,0,ratio,0,0);
    const cache=JSON.stringify([w,h,view,getValley().seed]);
    if(cache!==terrainKey){
      terrain.width=w;terrain.height=h;terrainKey=cache;
      const c=terrain.getContext('2d'),size=Math.max(.48,3.6/scale());
      c.fillStyle='#17221e';c.fillRect(0,0,w,h);
      const a=world({x:0,y:0}),b=world({x:w,y:h}),span=size*scale()+.75;
      for(let y=Math.max(bounds.north,Math.floor(a.y/size)*size);y<Math.min(bounds.south,b.y);y+=size){
        for(let x=Math.max(bounds.west,Math.floor(a.x/size)*size);x<Math.min(bounds.east,b.x);x+=size){
          const midX=x+size/2,midY=y+size/2,p=screen({x,y});
          const z=getValley().ground(midX,midY), biome=getValley().biome?.(midX,midY);
          c.fillStyle=getValley().wet(midX,midY)?'#3d6970':
            'hsl('+ (biome==='western'?40:biome==='swamp'?125:88)+' 15% '+clamp(47-z*4,15,60)+'%)';
          c.fillRect(p.x,p.y,span,span);
        }
      }
    }
    ctx.drawImage(terrain,0,0,w,h);
    const path=(points,color,stroke,dash=[])=>{
      ctx.strokeStyle=color;ctx.lineWidth=stroke;ctx.setLineDash(dash);ctx.beginPath();
      points.forEach((p,i)=>{const pos=screen(p);if(i)ctx.lineTo(pos.x,pos.y);else ctx.moveTo(pos.x,pos.y);});
      ctx.stroke();ctx.setLineDash([]);
    };
    const mark=(p,r,color)=>{
      const s=screen(p);ctx.beginPath();ctx.arc(s.x,s.y,r,0,Math.PI*2);
      ctx.fillStyle=color;ctx.fill();
    };
    const label=(p,value,color)=>{
      const s=screen(p);ctx.font='600 12px system-ui';ctx.strokeStyle='#101712';ctx.lineWidth=3;
      ctx.strokeText(value,s.x+8,s.y-8);ctx.fillStyle=color;ctx.fillText(value,s.x+8,s.y-8);
    };
    ctx.lineCap='round';ctx.lineJoin='round';
    const valley=getValley();
    for(const city of valley.towns){
      for(const street of ContourTown.openRoads(valley,city))path(street.nodes,'#d1c7a493',1.7);
      for(const lot of valley.market.homes(city))mark(lot,Math.max(1.5,.15*scale()),'#e8d6aaa8');
    }
    for(const [index,route] of ContourTown.roadEntries(valley.transport)){
      for(const road of ContourTown.roadSections(route,index))path(road,'#dfcfb09e',2,[3,3]);
    }
    for(const site of places()){
      mark(site,4,'#eee0b7');
      if(!(state.stations??[]).some(station=>station?.place===site.id)||scale()>7)label(site,site.name,'#fff3d5');
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
      const p=screen(s),n=scale(),a=Math.atan2(s.nx,-s.ny);
      ctx.save();ctx.translate(p.x,p.y);ctx.rotate(a);
      const half=Math.max(5,(s.platformLength??2.4)*n/2),depth=Math.max(4,n*.44);
      const start=s.terminal?0:-half;
      ctx.fillStyle=highlight?'#ffdf91':'#8ce0d5';ctx.strokeStyle='#223027';ctx.lineWidth=1.2;
      ctx.fillRect(start,-depth,half*2,depth*2);ctx.strokeRect(start,-depth,half*2,depth*2);
      if(s.terminal){
        ctx.fillStyle='#253027';ctx.fillRect(start,-depth,Math.max(2,n*.13),depth*2);
      }
      ctx.restore();
      if(highlight||state.step<2)label(s,s.name,highlight?'#fff0a7':'#bdf0e7');
    };
    const drawn=new Set([...(state.stations??[]),state.station].filter(Boolean).map(s=>s.id));
    for(const s of Object.values(stations()))if(!drawn.has(s.id))platform(s,false);
    for(const s of (state.stations??[]).filter(Boolean))platform(s,true);
    if(stationEdit)platform(state.station,true);
  }
  function drawProfile(){
    const section=activeSection(),w=profile.clientWidth,h=profile.clientHeight;
    if(!section||!w||!h)return;
    const ratio=Math.min(window.devicePixelRatio||1,2);
    if(profile.width!==Math.round(w*ratio)||profile.height!==Math.round(h*ratio)){
      profile.width=Math.round(w*ratio);profile.height=Math.round(h*ratio);
    }
    const values=section.path.flatMap(p=>[p.z,p.ground]);
    const min=Math.min(...values)-.13,max=Math.max(...values)+.13;
    const x=f=>32+f*(w-44),y=z=>h-16-(z-min)/(max-min)*(h-25);
    plot={min,max,x,y,w,h};
    pc.setTransform(ratio,0,0,ratio,0,0);pc.clearRect(0,0,w,h);
    pc.font='10px system-ui';pc.fillStyle='#bccbb9';
    for(let i=0;i<4;i++){
      const z=lerp(min,max,i/3),line=y(z);
      pc.beginPath();pc.moveTo(x(0),line);pc.lineTo(x(1),line);pc.strokeStyle='#647269';pc.lineWidth=.6;pc.stroke();
      pc.fillText(Math.round(z*heightScale)+' m',2,line+3);
    }
    for(const [key,color] of [['ground','#90ac97'],['z','#ffd26b']]){
      pc.beginPath();section.path.forEach((p,i)=>{
        if(i)pc.lineTo(x(p.d/section.length),y(p[key]));
        else pc.moveTo(x(0),y(p[key]));
      });
      pc.strokeStyle=color;pc.lineWidth=2;pc.stroke();
    }
    const [left,right]=section.design.approaches.map(units=>units/section.length);
    for(const [i,v] of current().vips.entries()){
      pc.beginPath();pc.arc(x(lerp(left,1-right,v.f)),y(v.z),i===activeLevel?5:3.5,0,Math.PI*2);
      pc.fillStyle='#f4f2ff';pc.fill();
    }
    pc.fillText((section.length*.04).toFixed(2)+' km',w-53,h-3);
    const level=current().vips[activeLevel],input=q('.rl-profile input');
    input.disabled=!level;
    action('removeLevel').disabled=!level;
    if(level){
      input.min=Math.min(min-1.5,level.z-.4);input.max=Math.max(max+1.5,level.z+.4);
      input.value=level.z;
    }
    q('.rl-profile output').textContent=level?Math.round(level.z*heightScale)+' m':'';
  }
  function tap(p){
    const worldPoint=world(p);
    if(stationEdit)return;
    if(state.step<2){
      const snapped=Object.values(stations()).filter(s=>distance(p,screen(s))<=16).sort((a,b)=>distance(p,screen(a))-distance(p,screen(b)))[0];
      const site=places().filter(s=>distance(p,screen(s))<=15).sort((a,b)=>distance(p,screen(a))-distance(p,screen(b)))[0];
      if(snapped){
        change(()=>{state.places[state.step]=snapped.place;state.stations[state.step]=snapped;state.legs=[];});
        return;
      }
      if(site){selectPlace(site.id);return;}
      if(!state.places[state.step]){showIssue('Choose the town or industry this station serves.');return;}
      change(()=>{
        state.stations[state.step]=createStation(worldPoint,state.places[state.step]);
        state.legs=[];
      });
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
    map.setPointerCapture(e.pointerId);
    const p=eventPoint(e,map);
    pointers.set(e.pointerId,p);
    if(pointers.size===1){
      const bend=state.step===2&&state.tool==='shape'&&!current()?.trackId?
        current()?.handles.findIndex(handle=>distance(p,screen(handle))<12):-1;
      pointer={start:p,dragged:false,bend:bend??-1,before:structuredClone(state)};
    }else if(pointer)pointer.dragged=true;
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
    if(pointer.bend>=0){
      current().handles[pointer.bend]=world(p);
      issue='';refresh();
    }else{
      view.x-=(p.x-previous.x)/scale();view.y-=(p.y-previous.y)/scale();draw();
    }
  });
  for(const event of ['pointerup','pointercancel','lostpointercapture'])map.addEventListener(event,e=>{
    if(!pointers.delete(e.pointerId)||pointers.size||!pointer)return;
    if(event==='pointerup'&&!pointer.dragged)tap(eventPoint(e,map));
    else if(pointer.bend>=0&&pointer.dragged){
      undo.push(pointer.before);redo=[];refresh();
    }else save();
    pointer=null;
  });
  profile.addEventListener('click',e=>{
    const p=eventPoint(e,profile);
    if(!plot)return;
    const section=activeSection();
    const [left,right]=section.design.approaches.map(units=>units/section.length);
    const f=clamp(((p.x-32)/(plot.w-44)-left)/(1-left-right),.035,.965);
    const z=lerp(plot.min,plot.max,clamp((plot.h-16-p.y)/(plot.h-25),0,1));
    const leg=current(),existing=leg.vips.findIndex(v=>Math.abs(p.x-plot.x(lerp(left,1-right,v.f)))<=9);
    if(existing>=0){activeLevel=existing;drawProfile();return;}
    if(leg.vips.length>=10)return;
    change(()=>{
      const level={f,z,radius:180};
      leg.vips.push(level);leg.vips.sort((a,b)=>a.f-b.f);activeLevel=leg.vips.indexOf(level);
    });
  });
  q('.rl-profile input').oninput=e=>{
    const level=current()?.vips[activeLevel];
    if(!level)return;
    levelSnapshot??=structuredClone(state);
    level.z=+e.target.value;
    refresh();
  };
  q('.rl-profile input').onchange=()=>{
    if(!levelSnapshot)return;
    undo.push(levelSnapshot);redo=[];levelSnapshot=null;refresh();
  };
  action('removeLevel').onclick=()=>change(()=>{current().vips.splice(activeLevel,1);activeLevel=-1;});
  action('undo').onclick=()=>restore(undo,redo);
  action('redo').onclick=()=>restore(redo,undo);
  action('close').onclick=()=>close();
  action('discard').onclick=()=>close(true);
  action('back').onclick=()=>{change(()=>--state.step);refocus();draw();};
  action('next').onclick=next;
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
    begin?.();undo=[];redo=[];preview=null;issue='';terrainKey='';activeLevel=-1;pointer=null;levelSnapshot=null;
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
      state={step:0,places:[null,null],stations:[null,null],legs:[],legTracks:1,active:0,tool:'shape',profile:false,cargo:''};
      let saved;
      try{saved=JSON.parse(localStorage.getItem(key()));}catch{}
      if(saved?.state?.stations?.length===2)state=saved.state;
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
      state={step:2,places:endpoints.map(s=>s.place),stations:endpoints,legs,legTracks:1,active:0,tool:'shape',profile:false,cargo:(route.cargo??'passengers')+'|'+route.cargoFrom};
      if(!legs.length)initializeLegs();
      open();
    },
    openStation(station){
      stationEdit=station;routeEdit=null;
      state={station:{platformLength:2.4,...station},step:0,stations:[]};
      open();
    },
  };
};
})();
