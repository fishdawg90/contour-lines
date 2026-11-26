(() => {
'use strict';
const gap=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const span=points=>points.slice(1).reduce((n,p,i)=>n+gap(points[i],p),0);
window.createRailWorkspace=function({getValley,designSection,savePath,buildTrack,cutTrack,begin,finish}){
  const root=document.createElement('section');
  root.id='railWorkspace';root.hidden=true;
  root.setAttribute('role','dialog');root.setAttribute('aria-modal','true');root.setAttribute('aria-label','Railway');
  root.innerHTML=`<div class="rw-header"><strong class="rw-title">Railway</strong><button data-act="close">Done</button></div>
    <nav><button data-tool="path">Service paths</button><button data-tool="draw">Connect tracks</button><button data-tool="cut">Remove section</button><select aria-label="Rail service"></select></nav><div class="rw-lines" aria-label="Service colours"></div>
    <div class="rw-map"><canvas aria-label="Railway diagram"></canvas><div class="rw-zoom"><button data-act="out" aria-label="Zoom out">−</button><button data-act="in" aria-label="Zoom in">+</button></div></div>
    <p class="rw-key">Solid outbound · dashed return · amber dots automatic signals</p><div class="rw-sections"></div><footer><p role="status"></p><div><button data-act="reset">Reset</button><button data-act="undo">Undo</button><button data-act="apply">Save path</button></div></footer>`;
  document.body.append(root);
  const q=s=>root.querySelector(s),canvas=q('canvas'),ctx=canvas.getContext('2d'),select=q('select');
  let gesture=null,suppressClick=false,platforms=[],platformHits=[],sectionHits=[],undo=[],activeSection=0,draftRun=null,physicalRails=[];
  let tool='path',routeIndex=0,path=[],lanes=[],picks=[],handles=[],section,view,message='',choosing=false;
  const valley=()=>getValley(),tracks=()=>valley().transport.railTracks??{},stations=()=>valley().transport.railStations??{};
  const route=()=>valley().transport.routes[routeIndex];
  const button=name=>q('[data-act="'+name+'"]');
  const screen=p=>({x:canvas.clientWidth/2+(p.x-view.x)*view.scale,y:canvas.clientHeight/2+(p.y-view.y)*view.scale});
  const world=p=>({x:view.x+(p.x-canvas.clientWidth/2)/view.scale,y:view.y+(p.y-canvas.clientHeight/2)/view.scale});
  const oriented=leg=>leg.direction===-1?[...tracks()[leg.id].points].reverse():tracks()[leg.id].points;
  const endpoint=()=>path.length?(path.at(-1).direction===1?tracks()[path.at(-1).id].to:tracks()[path.at(-1).id].from):route()?.stations[0].id;
  function checkpoint(){
    undo.push(structuredClone({path,lanes,picks,handles,platforms,choosing,activeSection}));
  }
  function setPlatform(side,platform){
    if(platforms[side]===platform)return;
    checkpoint();platforms[side]=platform;message='';render();
  }
  function setLane(index,lane){
    const block=draftRun?.blocks[index];
    if(!block||block.laneConstraint)return;
    const group=draftRun.blocks.flatMap((part,i)=>part.laneGroup===block.laneGroup?[i]:[]);
    if(group.every(i=>lanes[i]===lane))return;
    checkpoint();
    for(const i of group)lanes[i]=lane;
    activeSection=index;message='';render();
  }
  function reset(){
    message='';picks=[];handles=[];section=null;choosing=false;
    path=(route()?.trackIds??[]).map((id,i)=>({id,direction:route().trackDirections?.[i]??1}));
    lanes=path.map((_,i)=>route().trackLanes?.[i]??route().runningTrack??'auto');
    platforms=route()?.platforms?.slice()??[1,1];undo=[];activeSection=0;render();
  }
  function fit(){
    const points=Object.values(tracks()).flatMap(t=>t.points);
    if(!points.length){view={x:0,y:0,scale:8};return;}
    const xs=points.map(p=>p.x),ys=points.map(p=>p.y);
    view={x:(Math.min(...xs)+Math.max(...xs))/2,y:(Math.min(...ys)+Math.max(...ys))/2,
      scale:Math.min((canvas.clientWidth-70)/(Math.max(...xs)-Math.min(...xs)+2),(canvas.clientHeight-70)/(Math.max(...ys)-Math.min(...ys)+2))};
  }
  function hit(point){
    let best=15,result;
    for(const track of Object.values(tracks()))for(let i=1;i<track.points.length;i++){
      const a=screen(track.points[i-1]),b=screen(track.points[i]),dx=b.x-a.x,dy=b.y-a.y;
      const f=Math.max(0,Math.min(1,((point.x-a.x)*dx+(point.y-a.y)*dy)/(dx*dx+dy*dy||1)));
      const distance=Math.hypot(point.x-a.x-dx*f,point.y-a.y-dy*f);
      if(distance<best){best=distance;result={trackId:track.id,index:f<.5?i-1:i};}
    }
    return result;
  }
  function resolve(pick){
    const t=tracks()[pick.trackId],p=t.points[pick.index];
    return {...p,id:pick.index===0?t.from:pick.index===t.points.length-1?t.to:ContourTrackSplit.nodeId(t.id,pick.index)};
  }
  const cuts=()=>picks.filter(p=>p.index>0&&p.index<tracks()[p.trackId].points.length-1);
  function preview(){
    section=null;
    if(tool!=='draw'||picks.length!==2)return;
    const [a,b]=picks.map(resolve);
    const tangent=(pick,toward)=>{
      const t=tracks()[pick.trackId];
      const d=ContourRail.trackTangent(t,pick.index);
      const sign=d.x*(toward.x-resolve(pick).x)+d.y*(toward.y-resolve(pick).y)>=0?1:-1;
      return {x:d.x*sign,y:d.y*sign};
    };
    const leave=tangent(picks[0],handles[0]??b),back=tangent(picks[1],handles.at(-1)??a);
    section=designSection(a,b,leave,{x:-back.x,y:-back.y},{handles,vips:[],tracks:1},new Set());
  }
  function draw(){
    if(root.hidden||!view)return;
    const ratio=devicePixelRatio||1,w=canvas.clientWidth,h=canvas.clientHeight;
    canvas.width=w*ratio;canvas.height=h*ratio;ctx.scale(ratio,ratio);
    ctx.fillStyle='#202c27';ctx.fillRect(0,0,w,h);
    function line(points,color,width){
      ctx.beginPath();points.forEach((p,i)=>{
        const s=screen(p);
        if(i)ctx.lineTo(s.x,s.y);else ctx.moveTo(s.x,s.y);
      });ctx.strokeStyle=color;ctx.lineWidth=width;ctx.lineCap='round';ctx.lineJoin='round';ctx.stroke();
    }
    const transport=valley().transport;
    for(const rail of physicalRails)line(rail.points,'#74867b',2);
    function drawService(run,index,selected){
      if(!run?.blocks)return;
      const color=ContourRouteOverlay.color(index);
      ctx.globalAlpha=selected?1:.47;
      run.blocks.forEach((block,section)=>{
        const outbound=ContourRail.serviceRail(block,0),returning=ContourRail.serviceRail(block,1);
        line(outbound,color,selected?(section===activeSection?3:2):1.25);
        if(ContourRail.runningLane(block,0)!==ContourRail.runningLane(block,1)){
          ctx.setLineDash([4,4]);line(returning,color,selected?2:1.25);ctx.setLineDash([]);
        }
      });
      ctx.globalAlpha=1;
    }
    transport.routes.forEach((r,i)=>{
      if(r.mode==='rail'&&(tool!=='path'||i!==routeIndex))drawService(valley().truckRuns?.[i],i,false);
    });
    if(tool==='path')drawService(draftRun,routeIndex,true);
    sectionHits=[];
    if(tool==='path')for(const [i,leg] of path.entries()){
      const t=tracks()[leg.id];if(!t)continue;
      const middle=Math.floor(t.points.length/2);
      const p=screen(t.points[middle]);
      const double=t.tracks===2;
      if(double&&i===activeSection&&!draftRun?.blocks[i]?.laneConstraint){
        const tangent=ContourRail.trackTangent(t,middle),color=ContourRouteOverlay.color(routeIndex);
        for(const [lane,side] of [['left',-1],['right',1]]){
          const offset=side*leg.direction;
          const x=p.x-tangent.y*offset*25,y=p.y+tangent.x*offset*25;
          const rail=screen({...t.points[middle],x:t.points[middle].x-tangent.y*offset*.13,y:t.points[middle].y+tangent.x*offset*.13});
          ctx.beginPath();ctx.moveTo(rail.x,rail.y);ctx.lineTo(x,y);ctx.strokeStyle=color;ctx.lineWidth=1;ctx.stroke();
          ctx.beginPath();ctx.arc(x,y,12,0,Math.PI*2);const selected=ContourRail.runningTrackChoice(draftRun.blocks[i])===lane;ctx.fillStyle=selected?color:'#25372c';ctx.fill();
          ctx.stroke();ctx.textAlign='center';ctx.font='bold 12px system-ui';
          ctx.fillStyle=selected?'#25372c':'#fff3bd';ctx.fillText(lane==='left'?'L':'R',x,y+4);
          sectionHits.push({x,y,index:i,lane});
        }
      }
      if(double)sectionHits.push({...p,index:i});
      ctx.fillStyle=double&&i===activeSection?'#47624e':'#25372c';ctx.beginPath();ctx.arc(p.x,p.y,9,0,Math.PI*2);ctx.fill();
      ctx.fillStyle='#fff3bd';ctx.font='11px system-ui';ctx.textAlign='center';ctx.fillText(i+1,p.x,p.y+4);ctx.textAlign='start';
    }
    if(tool==='cut'&&picks.length===2&&picks[0].trackId===picks[1].trackId){
      const [first,last]=picks.map(p=>p.index).sort((a,b)=>a-b);
      line(tracks()[picks[0].trackId].points.slice(first,last+1),'#ef9b82',5);
    }
    if(section)line(section.path,section.issue?'#f39b83':'#9ce6cf',4);
    ctx.font='12px system-ui';
    const labels=[];
    for(const station of Object.values(stations())){
      const p=screen(station);ctx.fillStyle='#e6edd8';ctx.beginPath();ctx.arc(p.x,p.y,5,0,Math.PI*2);ctx.fill();
      let y=p.y-7;
      const width=ctx.measureText(station.name).width;
      for(let attempt=0;attempt<5&&labels.some(label=>Math.abs(y-label.y)<14&&p.x+8<label.x+label.width&&p.x+8+width>label.x);attempt++)y+=15;
      ctx.fillText(station.name,p.x+8,y);labels.push({x:p.x+8,y,width});
    }
    platformHits=[];
    if(tool==='path')route()?.stations.forEach((station,side)=>{
      const layout=ContourRail.stationLayout(station,ContourRail.stationTrackCount(station,valley().transport));
      const middle=(layout.start+layout.end)/2;
      const radius=13,spacing=26/view.scale;
      const center=screen(station);
      layout.platforms.forEach((pad,index)=>{
        const offset=(pad.near+pad.far)/2;
        const neighbor=layout.platforms.find(other=>other.index!==pad.index&&other.near===pad.near);
        const along=middle+(neighbor?(pad.index<neighbor.index?-1:1)*spacing*.6:0);
        const p=screen(ContourRail.stationPoint(station,along,offset+Math.sign(offset||1)*spacing));
        const color=ContourRouteOverlay.color(routeIndex),selected=platforms[side]===pad.index;
        ctx.beginPath();ctx.moveTo(center.x,center.y);ctx.lineTo(p.x,p.y);ctx.strokeStyle='#9ab7a3';ctx.lineWidth=1;ctx.stroke();
        ctx.beginPath();ctx.arc(p.x,p.y,radius,0,Math.PI*2);
        ctx.fillStyle=selected?color:'#233a2e';ctx.fill();
        ctx.strokeStyle=color;ctx.lineWidth=2;ctx.stroke();
        ctx.fillStyle=selected?'#1a241e':'#edf4e6';ctx.font='700 15px system-ui';ctx.textAlign='center';
        ctx.fillText(pad.index,p.x,p.y+5);ctx.textAlign='start';
        platformHits.push({...p,side,platform:pad.index});
      });
    });
    for(const [i,pick] of picks.entries()){
      const p=screen(resolve(pick));ctx.fillStyle='#ffdc87';ctx.beginPath();ctx.arc(p.x,p.y,7,0,Math.PI*2);ctx.fill();
      ctx.fillText(i?'Exit':'Entry',p.x+10,p.y+15);
    }
    for(const handle of handles){const p=screen(handle);ctx.fillStyle='#9ce6cf';ctx.fillRect(p.x-3,p.y-3,6,6);}
    // Small white dots identify automatically protected crossing/junction areas.
    const seen=new Set();
    for(const run of valley().truckRuns??[])for(const zone of run?.signalZones??[]){
      if(seen.has(zone.key))continue;seen.add(zone.key);
      const d=(zone.start+zone.end)/80;
      const p=run.path.reduce((a,b)=>Math.abs(a.length-d)<Math.abs(b.length-d)?a:b);
      const s=screen(p);ctx.fillStyle='#eac17c';ctx.fillRect(s.x-2,s.y-2,4,4);
    }
  }
  function render(){
    physicalRails=Object.values(tracks()).flatMap(track=>ContourRail.trackLines(track,valley().transport).lines);
    draftRun=tool==='path'&&route()&&path.length?ContourRail.run({...route(),platforms,
      trackIds:path.map(leg=>leg.id),trackDirections:path.map(leg=>leg.direction),trackLanes:lanes},valley().transport):null;
    select.hidden=tool!=='path';
    const title=q('.rw-title');
    title.textContent=tool==='path'&&route()?'Editing line '+(routeIndex+1):'Railway';
    title.style.color=tool==='path'&&route()?ContourRouteOverlay.color(routeIndex):'';
    button('undo').disabled=!undo.length;
    const legend=q('.rw-lines');legend.replaceChildren();
    valley().transport.routes.forEach((r,index)=>{
      if(r.mode!=='rail')return;
      const b=document.createElement('button');b.textContent='Line '+(index+1);
      b.style.borderColor=ContourRouteOverlay.color(index);b.style.color=ContourRouteOverlay.color(index);
      b.setAttribute('aria-label','Line '+(index+1)+' · '+r.stations.map(s=>s.name).join(' to '));
      b.setAttribute('aria-pressed',String(index===routeIndex));b.title=b.getAttribute('aria-label');
      b.onclick=()=>{routeIndex=index;select.value=index;tool='path';reset();};
      legend.append(b);
    });
    for(const b of root.querySelectorAll('[data-tool]'))b.setAttribute('aria-pressed',String(b.dataset.tool===tool));
    const rows=q('.rw-sections');rows.replaceChildren();
    if(tool==='path'&&route()){
      const choose=document.createElement('button');choose.textContent='Choose a new path';
      choose.onclick=()=>{checkpoint();choosing=true;path=[];lanes=[];message='Start at '+route().stations[0].name+'. Tap connected track sections toward '+route().stations[1].name+'.';render();};
      rows.append(choose);
      const picker=(label,options,value,apply)=>{
        const wrap=document.createElement('label'),input=document.createElement('select');
        input.setAttribute('aria-label',label);
        input.add(new Option(label,value,true,true));input.options[0].disabled=true;
        for(const [key,name] of options)input.add(new Option(name,key));
        input.selectedIndex=0;input.onchange=()=>apply(input.value);wrap.append(input);return wrap;
      };
      route().stations.forEach((station,side)=>{
        const pads=Array.from({length:station.platformCount??1},(_,i)=>[i+1,'Platform '+(i+1)]);
        if(pads.length>1)rows.append(picker((side?'B':'A')+' · Platform '+platforms[side],pads,platforms[side],
          value=>setPlatform(side,+value)));
      });
      const doubles=path.flatMap((leg,i)=>tracks()[leg.id]?.tracks===2?[i]:[]);
      if(doubles.length>1){
        rows.append(picker('All double sections',[['left','Left both ways'],['right','Right both ways'],['auto','Follow platforms'],['directional','By direction']],'',lane=>{
          checkpoint();
          for(const i of doubles)if(!draftRun?.blocks[i]?.laneConstraint)lanes[i]=lane;
          render();
        }));
      }
      if(doubles.length&&!doubles.includes(activeSection))activeSection=doubles[0];
      if(doubles.length){
        const i=activeSection;
        const constraint=draftRun?.blocks[i]?.laneConstraint;
        if(constraint){
          const fixed=document.createElement('button');fixed.disabled=true;
          fixed.textContent=(i+1)+(constraint==='platform'?' · Platform rail':' · Junction rail');
          rows.append(fixed);
        }else{
          const choices=[['auto','Follow platforms'],['directional','By direction'],['left','Left both ways'],['right','Right both ways']];
          const control=picker((i+1)+' · '+(choices.find(([lane])=>lane===lanes[i])?.[1]??'Follow platforms'),choices,lanes[i],lane=>setLane(i,lane));
          control.firstChild.dataset.section=i;
          control.firstChild.setAttribute('aria-label','Running track for section '+(i+1));
          rows.append(control);
        }
      }
    }
    const ready=tool==='path'?path.length&&endpoint()===route()?.stations[1].id&&!draftRun?.laneConflict:tool==='draw'?section&&!section.issue:picks.length===2;
    button('apply').disabled=!ready;
    button('apply').textContent=tool==='path'?'Save path':tool==='draw'?'Build connection':'Remove section';
    q('[role=status]').textContent=message||(tool==='path'?(draftRun?.laneConflict?'The selected connections use opposite rails. Choose a different path or platform.':'Tap a platform or a numbered double-track section. L or R selects the same rail across connected sections.'):
      tool==='draw'?(picks.length<2?'Tap entry and exit on existing track.':'Tap to add bends to the green connection.'):
      'Tap two points on the same track to mark a short section. Reroute services using it before removal.');
    if(tool==='draw'&&section)q('[role=status]').textContent=message||section.issue||Math.round(section.length*40)+' m · '+ContourRail.connectionCost(section,valley().region==='mixed').toLocaleString()+' cr';
    draw();
  }
  canvas.onclick=e=>{
    const rect=canvas.getBoundingClientRect(),p={x:e.clientX-rect.left,y:e.clientY-rect.top},pick=hit(p);
    if(suppressClick){suppressClick=false;return;}
    message='';
    if(tool==='path'){
      const pad=platformHits.find(hit=>gap(p,hit)<17);
      if(pad){setPlatform(pad.side,pad.platform);return;}
      if(!choosing){
        const control=sectionHits.find(hit=>gap(p,hit)<13);
        if(control?.lane){setLane(control.index,control.lane);return;}
        const index=control?.index??path.findIndex(part=>part.id===pick?.trackId);
        if(index>=0&&tracks()[path[index].id].tracks===2){
          activeSection=index;render();
        }else{message='Tap a numbered platform or use Choose a new path to change the sections.';render();}
        return;
      }
      if(!pick){message='Tap closer to a built track.';render();return;}
      const t=tracks()[pick.trackId],node=endpoint();
      if(path.some(leg=>leg.id===t.id)||node!==t.from&&node!==t.to){message='Choose a connected section at the end of the highlighted path.';render();return;}
      const direction=node===t.from?1:-1;
      const points=direction===1?t.points:[...t.points].reverse(),previous=path.length?oriented(path.at(-1)):null;
      const target=direction===1?t.to:t.from;
      if(stations()[node]?.terminal&&path.length||stations()[target]?.terminal&&target!==route().stations[1].id){
        message='A terminal station must be a service endpoint.';render();return;
      }
      if(previous){
        const a=previous.at(-2),b=previous.at(-1),c=points[1];
        if(((b.x-a.x)*(c.x-b.x)+(b.y-a.y)*(c.y-b.y))/(gap(a,b)*gap(b,c)||1)<.54){
          message='This connection reverses direction. Choose the through track.';render();return;
        }
      }
      checkpoint();path.push({id:t.id,direction});lanes.push('auto');activeSection=path.length-1;
    }else if(picks.length<2){
      if(!pick){message='Tap an existing track.';render();return;}
      if(tool==='cut'&&picks.length&&pick.trackId!==picks[0].trackId){message='Choose the exit on the same track.';render();return;}
      if(picks[0]?.trackId===pick.trackId&&picks[0]?.index===pick.index){message='Choose a different exit point.';render();return;}
      checkpoint();picks.push(pick);preview();
    }else if(tool==='draw'){checkpoint();handles.push(world(p));preview();}
    render();
  };
  canvas.onpointerdown=e=>{
    canvas.setPointerCapture(e.pointerId);
    gesture={x:e.clientX,y:e.clientY,view:{...view}};
  };
  canvas.onpointermove=e=>{
    if(!gesture)return;
    const dx=e.clientX-gesture.x,dy=e.clientY-gesture.y;
    if(Math.hypot(dx,dy)<6&&!suppressClick)return;
    suppressClick=true;
    view.x=gesture.view.x-dx/view.scale;view.y=gesture.view.y-dy/view.scale;draw();
  };
  canvas.onpointerup=()=>{gesture=null;};
  canvas.onpointercancel=()=>{gesture=null;suppressClick=true;};
  canvas.addEventListener('wheel',e=>{
    e.preventDefault();
    const rect=canvas.getBoundingClientRect(),p={x:e.clientX-rect.left,y:e.clientY-rect.top},before=world(p);
    view.scale=Math.max(.5,Math.min(200,view.scale*Math.exp(-e.deltaY*.002)));
    const after=world(p);view.x+=before.x-after.x;view.y+=before.y-after.y;draw();
  },{passive:false});
  button('apply').onclick=()=>{
    let result;
    if(tool==='path'){
      const points=path.flatMap((leg,i)=>i?oriented(leg).slice(1):oriented(leg));
      result=savePath(routeIndex,{...route(),trackIds:path.map(p=>p.id),trackDirections:path.map(p=>p.direction),trackLanes:lanes.slice(),platforms:platforms.slice(),points,capital:0});
    }else if(tool==='draw'){
      result=buildTrack({cuts:cuts(),from:resolve(picks[0]),to:resolve(picks[1]),section});
    }else result=cutTrack(picks);
    if(result!==true){message=result||'The change could not be saved.';render();return;}
    reset();message=tool==='path'?'Service path saved.':tool==='draw'?'Connection built.':'Section removed.';render();
  };
  for(const b of root.querySelectorAll('[data-tool]'))b.onclick=()=>{tool=b.dataset.tool;reset();};
  select.onchange=()=>{routeIndex=Number(select.value);reset();};
  button('reset').onclick=reset;
  button('undo').onclick=()=>{
    const previous=undo.pop();
    if(!previous)return;
    ({path,lanes,picks,handles,platforms,choosing,activeSection}=previous);
    message='';preview();render();
  };
  button('in').onclick=()=>{view.scale*=1.4;draw();};
  button('out').onclick=()=>{view.scale/=1.4;draw();};
  function close(){
    if(root.hidden)return;
    root.hidden=true;document.getElementById('app').inert=false;finish?.();
    if(history.state?.railWorkspace)history.back();
  }
  button('close').onclick=close;
  window.addEventListener('popstate',()=>{if(!root.hidden)close();});
  root.onkeydown=e=>{if(e.key==='Escape')button('close').click();};
  new ResizeObserver(()=>{if(!root.hidden)draw();}).observe(canvas);
  return {open(index){
    begin?.();history.pushState({railWorkspace:true},'','');root.hidden=false;document.getElementById('app').inert=true;
    select.replaceChildren();
    valley().transport.routes.forEach((r,i)=>{
      if(r.mode!=='rail')return;
      const o=document.createElement('option');o.value=i;o.textContent=(i+1)+' · '+r.stations.map((s,side)=>s.name+' P'+(r.platforms?.[side]??1)).join(' → ');select.append(o);
    });
    routeIndex=index??Number(select.options[0]?.value??0);select.value=routeIndex;
    tool=select.options.length?'path':'draw';fit();reset();fit();draw();button('close').focus();
  }};
};
})();
