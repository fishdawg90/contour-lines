'use strict';
function createDemolition({getValley,projectPoint,blockedByTransport,open,redraw,changed}){
  const el=id=>document.getElementById(id),toggle=el('bulldoze'),panel=el('demolitionPanel');
  const choices=el('demolitionChoices'),hint=el('demolitionHint'),apply=el('demolitionApply');
  const main=toggle.closest('main');
  let nearby=[],selected=null,plan=null;
  const stationKey=s=>window.contourStationKey(s);
  const xyGap=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
  function objects(v){
    const rows=[],t=v.transport;
    for(const city of v.towns){
      for(const road of ContourTown.openRoads(v,city))rows.push({kind:'street',label:city.name+' street',city,road,path:road.nodes});
      for(const lot of v.market.homes(city))if(!blockedByTransport(v,lot)){
        rows.push({kind:'building',label:city.name+' building',city,lot,path:[{...lot,z:lot.z+(lot.height??.4)*.5}]});
      }
    }
    for(const [id,route] of ContourTown.roadEntries(t)){
      for(const {part,start,end} of ContourTown.roadSectionEntries(route)){
        let first=start,length=0;
        for(let i=start+1;i<end;i++){
          length+=xyGap(route.points[i-1],route.points[i]);
          if(length<4&&i<end-1)continue;
          rows.push({kind:'road',label:'Route road · '+Math.round(length*40)+' m',id,part,first,last:i,path:route.points.slice(first,i+1)});
          first=i;length=0;
        }
      }
    }
    for(const track of Object.values(t.railTracks??{})){
      const paths=ContourRail.trackLines(track,t).lines.map(line=>line.points);
      rows.push({kind:'track',label:'Rail track · '+(track.tracks===2?'double':'single'),track,path:track.points,paths});
    }
    for(const base of v.builtStations){
      if(base.mode==='rail'){rows.push({kind:'railStation',label:base.name+' rail station',base,path:[base]});continue;}
      const layout=t.stationLayouts?.[stationKey(base)];
      for(const bay of layout?.bays??[{...base,id:'1'}])rows.push({kind:'bay',label:base.name+' · Bay '+bay.id,base,bay,path:[bay]});
    }
    return rows;
  }
  function segmentGap(p,a,b){
    const dx=b[0]-a[0],dy=b[1]-a[1],f=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/(dx*dx+dy*dy||1)));
    return Math.hypot(p[0]-a[0]-f*dx,p[1]-a[1]-f*dy);
  }
  // Older services store the driven path, including reused roads, without road IDs.
  function usesPath(route,path){
    const points=route.points??route.path??[];
    return path.slice(1).some((b,i)=>{
      const a=path[i],dx=b.x-a.x,dy=b.y-a.y,len=Math.hypot(dx,dy);
      if(len<.001)return false;
      return points.slice(1).some((d,j)=>{
        const c=points[j],ux=d.x-c.x,uy=d.y-c.y,span=Math.hypot(ux,uy);
        if(span<.001||Math.abs(dx*ux+dy*uy)<.98*len*span)return false;
        const fraction=((c.x-a.x)*dx+(c.y-a.y)*dy)/(len*len);
        const other=((d.x-a.x)*dx+(d.y-a.y)*dy)/(len*len);
        const left=Math.max(0,Math.min(fraction,other)),right=Math.min(1,Math.max(fraction,other));
        if((right-left)*len<.01)return false;
        const t=(left+right)/2,u=(t-fraction)/(other-fraction);
        return Math.hypot(a.x+dx*t-c.x-ux*u,a.y+dy*t-c.y-uy*u)<.08&&Math.abs(a.z+(b.z-a.z)*t-c.z-(d.z-c.z)*u)<.10;
      });
    });
  }
  function inspect(v,obj){
    const t=v.transport,loops=v.market.localRoutes;
    let services=[],local=[],reason='';
    const key=obj.base&&stationKey(obj.base);
    const rail=obj.kind==='track'||obj.kind==='railStation';
    if(obj.kind==='track')services=t.routes.filter(r=>r.mode==='rail'&&r.trackIds?.includes(obj.track.id));
    if(obj.kind==='railStation'&&Object.values(t.railTracks??{}).some(track=>track.from===obj.base.id||track.to===obj.base.id))reason='Remove the connected track sections first.';
    if(obj.kind==='bay'){
      const layout=t.stationLayouts?.[key],primary=obj.bay.id==='1';
      services=t.routes.filter(r=>r.mode!=='rail'&&r.stations.some((s,i)=>stationKey(s)===key&&(r.stationBays?.[i]??'1')===obj.bay.id));
      if(primary&&layout?.bays.length>1)reason='Remove the additional bays before removing the base station.';
      if(primary&&t.depots?.some(d=>d.hubKey===key))reason='This station hosts a trade depot.';
      if(primary)local=loops.filter(r=>r.hub===key);
    }
    if(obj.kind==='street'||obj.kind==='road'){
      const cityRoad=obj.kind==='street',key=cityRoad?obj.city.id+':'+obj.road.id:'built/'+obj.id+'/'+obj.part;
      if(v.builtStations.some(s=>s.tie?.key===key)||(t.stationAccesses??[]).some(a=>a.tie?.key===key))reason='This road provides station access. Remove the connected bay or access first.';
      services=t.routes.filter((r,index)=>r.mode!=='rail'&&(!cityRoad&&(r.roadId??index)===obj.id||r.roadKeys?.includes(key)||usesPath(r,obj.path)));
      local=loops.filter(r=>r.roadKeys?.includes(key)||usesPath(r,obj.path));
    }
    if(rail&&obj.kind==='railStation'&&t.depots?.some(d=>d.hubKey===key))reason='This station hosts a trade depot.';
    return {services,local,reason};
  }
  function clear(message='Tap a road, track, bay, station or building.'){
    nearby=[];selected=null;plan=null;choices.replaceChildren();choices.hidden=true;apply.hidden=true;
    el('demolitionTitle').textContent='Bulldoze';hint.textContent=message;redraw();
  }
  function select(i){
    selected=nearby[i];plan=inspect(getValley(),selected);
    const total=plan.services.length+plan.local.length;
    el('demolitionTitle').textContent=selected.label;
    hint.textContent=plan.reason||(total?'Also removes '+total+' active service'+(total===1?'':'s')+' and the assigned vehicles.':'Remove the highlighted '+({street:'street',bay:'bay',road:'road segment',track:'track section',railStation:'station',building:'building'}[selected.kind])+'?');
    if(total&&!plan.reason){
      const names=[...plan.services.map(r=>r.stations.map(s=>s.name).join(' ↔ ')),...plan.local.map(r=>r.name??(r.local==='bus'?'Local bus':'Local delivery'))];
      hint.textContent+=' '+names.slice(0,2).join(' · ')+(names.length>2?' · +'+(names.length-2):'');
    }
    apply.hidden=Boolean(plan.reason);redraw();
  }
  function pick(point){
    const hits=[];
    for(const obj of objects(getValley())){
      let d=Infinity;
      for(const path of obj.paths??[obj.path]){
        const p=path.map(projectPoint);
        if(p.length===1)d=Math.min(d,Math.hypot(point[0]-p[0][0],point[1]-p[0][1]));
        for(let i=1;i<p.length;i++)d=Math.min(d,segmentGap(point,p[i-1],p[i]));
      }
      const marker=obj.path.length===1;
      if(d<=(marker?22:13))hits.push({obj,d:d+(marker?0:2)});
    }
    if(!hits.length){clear('Nothing selected. Zoom in or tap closer.');return;}
    nearby=hits.sort((a,b)=>a.d-b.d).map(h=>h.obj);
    choices.replaceChildren(...nearby.map((obj,i)=>new Option(obj.label,i)));
    choices.hidden=nearby.length<2;select(0);
  }
  function remove(){
    if(!selected)return;
    const v=getValley(),t=v.transport,obj=selected;
    const current=inspect(v,obj);
    if(current.reason||current.services.length!==plan.services.length||current.local.length!==plan.local.length){select(nearby.indexOf(obj));return;}
    for(const r of current.local){v.market.resetLocalFleet(r);v.market.localRoutes.splice(v.market.localRoutes.indexOf(r),1);}
    // Remove in descending route order so fleet indices still match the existing runs.
    for(const r of [...current.services].reverse()){
      const index=t.routes.indexOf(r);v.market.releaseRouteLoads(r,index);ContourTown.archiveRoute(t,index);
    }
    if(obj.kind==='building')t.removedLots.push(obj.city.id+':'+obj.lot.id);
    if(obj.kind==='street')t.removedRoads.push(obj.city.id+':'+obj.road.id);
    if(obj.kind==='track')delete t.railTracks[obj.track.id];
    if(obj.kind==='railStation')delete t.railStations[obj.base.id];
    if(obj.kind==='road'){
      const road=t.roadArchive[obj.id],spans=road.roadSections??=[[road.roadStart??0,road.roadEnd??road.points.length]];
      const [start,end]=spans[obj.part];
      spans[obj.part]=[start,obj.first+1];
      if(end-obj.last>1)spans.push([obj.last,end]);
      road.cutRoad=true;
    }
    if(obj.kind==='bay'){
      const key=stationKey(obj.base),layout=t.stationLayouts?.[key];
      if(obj.bay.id==='1'){
        for(const [,r] of ContourTown.roadEntries(t))r.stations.forEach((s,i)=>{
          if(stationKey(s)===key)(r.removedStationSides??=[]).push(i);
        });
        if(t.stationLayouts)delete t.stationLayouts[key];
        if(t.extraBays)t.extraBays=t.extraBays.filter(s=>stationKey(s)!==key);
      }else layout.bays=layout.bays.filter(b=>b.id!==obj.bay.id);
      if(t.stationAccesses)t.stationAccesses=t.stationAccesses.filter(a=>a.baseKey!==key||a.bayId!==obj.bay.id);
    }
    changed();clear(obj.label+' removed. Tap another object.');
  }
  function setMode(active){
    panel.hidden=!active;toggle.setAttribute('aria-pressed',String(active));main.classList.toggle('demolishing',active);
    if(active)open();clear();
  }
  toggle.onclick=()=>setMode(panel.hidden);
  el('demolitionClose').onclick=()=>setMode(false);
  document.addEventListener('keydown',e=>{if(!panel.hidden&&e.key==='Escape')setMode(false);});
  main.addEventListener('click',e=>{
    if(!panel.hidden&&!panel.contains(e.target)&&!toggle.contains(e.target)&&e.target.closest('button'))setMode(false);
  },true);
  choices.onchange=()=>select(Number(choices.value));apply.onclick=remove;
  function draw(ctx){
    if(!selected)return;
    const marker=selected.path.length===1;
    ctx.save();ctx.beginPath();ctx.lineCap='round';ctx.lineJoin='round';
    for(const path of selected.paths??[selected.path]){
      const p=path.map(projectPoint);
      if(marker)ctx.arc(p[0][0],p[0][1],13,0,2*Math.PI);
      else{ctx.moveTo(p[0][0],p[0][1]);for(const q of p.slice(1))ctx.lineTo(q[0],q[1]);}
    }
    ctx.strokeStyle='#442e24';ctx.lineWidth=marker?5:9;ctx.stroke();
    ctx.strokeStyle='#ffae87';ctx.lineWidth=marker?3:5;ctx.stroke();ctx.restore();
  }
  return {get active(){return !panel.hidden;},pick,draw};
}
