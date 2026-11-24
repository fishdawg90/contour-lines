(() => {
'use strict';
const gap=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const span=points=>points.slice(1).reduce((n,p,i)=>n+gap(points[i],p),0);
window.createRailWorkspace=function({getValley,designSection,savePath,buildTrack,cutTrack,begin,finish}){
  const root=document.createElement('section');
  root.id='railWorkspace';root.hidden=true;
  root.setAttribute('role','dialog');root.setAttribute('aria-modal','true');root.setAttribute('aria-label','Railway');
  root.innerHTML=`<div class="rw-header"><strong>Railway</strong><button data-act="close">Done</button></div>
    <nav><button data-tool="path">Service paths</button><button data-tool="draw">Connect tracks</button><button data-tool="cut">Remove section</button><select aria-label="Rail service"></select></nav><div class="rw-lines" aria-label="Service colours"></div>
    <div class="rw-map"><canvas aria-label="Railway diagram"></canvas><div class="rw-zoom"><button data-act="out" aria-label="Zoom out">−</button><button data-act="in" aria-label="Zoom in">+</button></div></div>
    <p class="rw-key">Solid outbound · dashed return · amber dots automatic signals</p><div class="rw-sections"></div><footer><p role="status"></p><div><button data-act="reset">Reset</button><button data-act="undo">Undo point</button><button data-act="apply">Save path</button></div></footer>`;
  document.body.append(root);
  const q=s=>root.querySelector(s),canvas=q('canvas'),ctx=canvas.getContext('2d'),select=q('select');
  let gesture=null,suppressClick=false;
  let tool='path',routeIndex=0,path=[],lanes=[],picks=[],handles=[],section,view,message='',choosing=false;
  const valley=()=>getValley(),tracks=()=>valley().transport.railTracks??{},stations=()=>valley().transport.railStations??{};
  const route=()=>valley().transport.routes[routeIndex];
  const button=name=>q('[data-act="'+name+'"]');
  const screen=p=>({x:canvas.clientWidth/2+(p.x-view.x)*view.scale,y:canvas.clientHeight/2+(p.y-view.y)*view.scale});
  const world=p=>({x:view.x+(p.x-canvas.clientWidth/2)/view.scale,y:view.y+(p.y-canvas.clientHeight/2)/view.scale});
  const oriented=leg=>leg.direction===-1?[...tracks()[leg.id].points].reverse():tracks()[leg.id].points;
  const endpoint=()=>path.length?(path.at(-1).direction===1?tracks()[path.at(-1).id].to:tracks()[path.at(-1).id].from):route()?.stations[0].id;
  function reset(){
    message='';picks=[];handles=[];section=null;choosing=false;
    path=(route()?.trackIds??[]).map((id,i)=>({id,direction:route().trackDirections?.[i]??1}));
    lanes=path.map((_,i)=>route().trackLanes?.[i]??route().runningTrack??'auto');render();
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
    function line(points,color,width,offset=0){
      ctx.beginPath();points.forEach((p,i)=>{
        const a=points[Math.max(0,i-1)],b=points[Math.min(points.length-1,i+1)],n=gap(a,b)||1;
        const s=screen({x:p.x-(b.y-a.y)*offset/n,y:p.y+(b.x-a.x)*offset/n});
        if(i)ctx.lineTo(s.x,s.y);else ctx.moveTo(s.x,s.y);
      });ctx.strokeStyle=color;ctx.lineWidth=width;ctx.lineCap='round';ctx.lineJoin='round';ctx.stroke();
    }
    for(const track of Object.values(tracks())){
      line(track.points,'#64796d',track.tracks===2?7:4);
      if(track.tracks===2)line(track.points,'#202c27',2);
    }
    const users=new Map();
    valley().transport.routes.forEach((r,i)=>{
      if(r.mode==='rail')for(const id of r.trackIds??[]){
        if(!users.has(id))users.set(id,[]);
        users.get(id).push(i);
      }
    });
    valley().transport.routes.forEach((r,i)=>{
      if(r.mode!=='rail')return;
      const color=ContourRouteOverlay.color(i);
      (r.trackIds??[]).forEach((id,j)=>{
        const track=tracks()[id];if(!track)return;
        const direction=r.trackDirections?.[j]??1;
        const lane=r.trackLanes?.[j]??r.runningTrack??'auto';
        // Draw each service beside the physical lane it uses. All services stay visible.
        const group=users.get(id)??[i],ribbon=(group.indexOf(i)-(group.length-1)/2)*4;
        const offset=((track.tracks===2?(lane==='right'?1:-1)*direction*5:0)+ribbon)/view.scale;
        line(track.points,color,i===routeIndex?3:1.5,offset);
        if(track.tracks===2&&lane==='auto'){
          ctx.setLineDash([4,4]);line(track.points,color,1.3,-offset);ctx.setLineDash([]);
        }
      });
    });
    if(choosing)path.forEach((leg,i)=>{
      if(!tracks()[leg.id])return;
      const offset=tracks()[leg.id].tracks===2?(lanes[i]==='right'?1:-1)*leg.direction*3/view.scale:0;
      line(tracks()[leg.id].points,'#fff3bd',3,offset);
    });
    for(const [i,leg] of path.entries()){
      const t=tracks()[leg.id];if(!t)continue;
      const p=screen(t.points[Math.floor(t.points.length/2)]);
      ctx.fillStyle='#25372c';ctx.beginPath();ctx.arc(p.x,p.y,9,0,Math.PI*2);ctx.fill();
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
    select.hidden=tool!=='path';
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
      choose.onclick=()=>{choosing=true;path=[];lanes=[];message='Start at '+route().stations[0].name+'. Tap connected track sections toward '+route().stations[1].name+'.';render();};
      rows.append(choose);
      path.forEach((leg,i)=>{
        const b=document.createElement('button'),track=tracks()[leg.id];
        b.textContent=(i+1)+' · '+(track?.tracks===2?(lanes[i]==='auto'?'By direction':lanes[i]==='left'?'Left both ways':'Right both ways'):'Single');
        b.disabled=track?.tracks!==2;
        b.onclick=()=>{lanes[i]=lanes[i]==='auto'?'left':lanes[i]==='left'?'right':'auto';render();};
        rows.append(b);
      });
    }
    const ready=tool==='path'?path.length&&endpoint()===route()?.stations[1].id:tool==='draw'?section&&!section.issue:picks.length===2;
    button('apply').disabled=!ready;
    button('apply').textContent=tool==='path'?'Save path':tool==='draw'?'Build connection':'Remove section';
    q('[role=status]').textContent=message||(tool==='path'?'Select a service. Numbered circles match the sections below. Tap a double-track section button to set its running line.':
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
      if(!choosing){message='Choose a new path to start selecting connected sections.';render();return;}
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
      path.push({id:t.id,direction});lanes.push('auto');
    }else if(picks.length<2){
      if(!pick){message='Tap an existing track.';render();return;}
      if(tool==='cut'&&picks.length&&pick.trackId!==picks[0].trackId){message='Choose the exit on the same track.';render();return;}
      if(picks[0]?.trackId===pick.trackId&&picks[0]?.index===pick.index){message='Choose a different exit point.';render();return;}
      picks.push(pick);preview();
    }else if(tool==='draw'){handles.push(world(p));preview();}
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
      result=savePath(routeIndex,{...route(),trackIds:path.map(p=>p.id),trackDirections:path.map(p=>p.direction),trackLanes:lanes.slice(),points,capital:0});
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
    if(tool==='path'){path.pop();lanes.pop();choosing=true;}
    else if(handles.length)handles.pop();else picks.pop();
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
