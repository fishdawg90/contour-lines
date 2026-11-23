window.createTownEditor=function({getValley,commitRoad,commitLoop,complete,ground}){
  const el=id=>document.getElementById(id);
  const dialog=el('townEditor'),canvas=el('teMap'),ctx=canvas.getContext('2d');
  const modes={roads:'Build town road',bus:'New local bus loop',delivery:'New delivery loop'};
  let mode,city,graph,points,bend,preview,pan,scale,press,hubs,services,editing;
  let width=1,height=1;
  const screen=p=>[width/2+(p.x-pan.x)*scale,height/2+(p.y-pan.y)*scale];
  const world=(x,y)=>({x:pan.x+(x-width/2)/scale,y:pan.y+(y-height/2)/scale});
  const geometry=p=>p&&({x:p.x,y:p.y,z:p.z});
  const rates={roads:4600,bus:8200,delivery:8200};
  function coords(event){
    const r=canvas.getBoundingClientRect();return [event.clientX-r.left,event.clientY-r.top];
  }
  function selectedHub(){return hubs.get(el('teHub').value);}
  function connected(station){
    const anchor=ContourTown.stationAnchor(station,city);
    return anchor&&graph.nearest(anchor,.65,anchor.road);
  }
  function eligible(key){
    const available=mode==='delivery'?cargoOptions(key).length:services.get(key)?.has('bus');
    return available&&connected(hubs.get(key));
  }
  const cargoOptions=key=>getValley().market.localCargoOptions(city,key);
  function updateCargo(preferred=el('teCargo').value){
    if(mode!=='delivery')return;
    const values=cargoOptions(el('teHub').value);
    const select=el('teCargo');
    select.replaceChildren(...values.map(cargo=>new Option(ContourRegion.goods[cargo][0],cargo)));
    if(values.includes(preferred))select.value=preferred;
    select.disabled=!values.length;
  }
  function hubName(key){
    const kinds=services.get(key);
    const freight=cargoOptions(key).length>0;
    return kinds?.has('bus')&&freight?'Passenger + freight':
      kinds?.has('bus')?'Passenger':freight?'Freight':'Station';
  }
  function chooseHub(key){
    if(!eligible(key)){
      el('teHelp').textContent=hubName(key)+' station. Choose a connected '+(mode==='bus'?'passenger':'freight')+' station.';
      return;
    }
    el('teHub').value=key;
    updateCargo();update();
  }
  function line(path,color,width=2){
    if(!path.length)return;
    ctx.beginPath();path.forEach((p,i)=>ctx[i?'lineTo':'moveTo'](...screen(p)));
    ctx.strokeStyle=color;ctx.lineWidth=width;ctx.stroke();
  }
  function dot(p,color,label,r=8){
    const [x,y]=screen(p);
    ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fillStyle=color;ctx.fill();
    if(label!==undefined){ctx.fillStyle='#fff';ctx.font='bold 11px system-ui';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(label,x,y);}
  }
  function addLeg(path,leg){
    const start=path.length?1:0;
    let length=path.at(-1)?.distance??0;
    for(const p of leg.slice(start)){
      if(path.length)length+=ContourTown.gap(path.at(-1),p);
      path.push({...p,distance:length});
    }
    return length;
  }
  function planLoop(){
    const station=selectedHub(),valley=getValley();
    if(!station){
      const available=[...hubs.keys()].some(eligible);
      const service=mode==='bus'?'passenger':'freight';
      return {issue:available?'Tap a '+service+' station on the map to begin.':(mode==='delivery'?'Connect a town station to an incoming freight line or enable cargo at its depot.':'This town needs a passenger station connected to its streets.')};
    }
    const start=connected(station);
    if(!points.length)return {issue:'Tap an existing street to add your first stop.'};
    const path=[],events=[{distance:0}],ends=[start,...points,start];
    for(let i=1;i<ends.length;i++){
      const leg=graph.path(ends[i-1],ends[i]);
      if(leg.length<2)return {issue:'Choose distinct stops connected to the station by streets.'};
      const distance=addLeg(path,leg);
      events.push(i===ends.length-1?{distance}:{distance,stop:i-1});
    }
    const length=path.at(-1).distance;
    const stops=points.map(geometry);
    const lots=valley.market.homes(city);
    const reached=new Set(stops.flatMap(stop=>graph.catchment(stop,lots,4.5)).map(l=>l.id));
    const cargo=el('teCargo').value;
    return {city:city.id,local:mode,...(mode==='delivery'?{cargo}:{}),hub:ContourTown.stationKey(station),stations:[station],
      path,events,stops,length,roadKeys:graph.roadsUsed(path).map(id=>city.id+':'+id),
      cost:(editing?0:rates[mode])+stops.filter(stop=>!editing?.stops.some(old=>ContourTown.gap(old,stop)<.08&&Math.abs(old.z-stop.z)<.08)).length*750,reached};
  }
  function planRoad(){
    if(points.length<2)return {issue:points.length?'Tap to place the other end of the road.':'Tap a street to attach the new road.'};
    const [a,b]=points,k=bend??{x:(a.x+b.x)/2,y:(a.y+b.y)/2};
    const valley=getValley(),sample=[];
    const count=Math.max(8,Math.ceil((ContourTown.gap(a,k)+ContourTown.gap(k,b))/.13));
    for(let i=0;i<=count;i++){
      const t=i/count,j=1-t;
      const x=j*j*a.x+2*j*t*k.x+t*t*b.x,y=j*j*a.y+2*j*t*k.y+t*t*b.y;
      if(Math.hypot(x-city.x,y-city.y)>13||valley.wet(x,y,.25))return {issue:'Keep the road on dry ground within the town area.'};
      sample.push({x,y,z:a.z+(b.z-a.z)*t});
    }
    const path=[],length=addLeg(path,sample);
    const lots=valley.market.homes(city);
    if(length<.65)return {issue:'Leave at least 26 m between the endpoints.'};
    if(path.some(p=>lots.some(l=>ContourTown.gap(l,p)<l.radius+.21)))return {issue:'Curve the road away from occupied buildings.'};
    if(path.some(p=>Math.abs(p.z-ground(p.x,p.y))>.18))return {issue:'This terrain needs a gentler alignment.'};
    if(Math.abs(a.z-b.z)*25>length*40*.12)return {issue:'Keep the road grade under 12%.'};
    return {city:city.id,path,length,cost:Math.round(rates.roads+length*7200)};
  }
  function update(){
    const valley=getValley();
    preview=mode==='roads'?planRoad():planLoop();
    const overBudget=preview.cost>valley.market.state.cash;
    el('teHelp').textContent=preview.issue||(overBudget?'Insufficient funds for this plan.':mode==='roads'?'Drag the middle handle to curve the road, then build.':'Tap streets to add stops. Tap a placed stop to remove it.');
    el('teStatus').textContent=preview.issue?'':Math.round(preview.length*40)+' m · '+preview.cost.toLocaleString('en-GB')+' cr'+(preview.reached?' · '+preview.reached.size+' homes':'');
    el('teConfirm').disabled=!!preview.issue||overBudget;
    draw();
  }
  function draw(){
    if(!dialog.open)return;
    const valley=getValley(),lots=valley.market.homes(city);
    const dpr=Math.min(devicePixelRatio||1,2);
    width=canvas.clientWidth;height=canvas.clientHeight;
    if(canvas.width!==Math.round(width*dpr))canvas.width=Math.round(width*dpr);
    if(canvas.height!==Math.round(height*dpr))canvas.height=Math.round(height*dpr);
    ctx.setTransform(dpr,0,0,dpr,0,0);
    ctx.fillStyle='#b9c696';ctx.fillRect(0,0,width,height);
    for(let y=Math.floor(pan.y-height/(2*scale));y<pan.y+height/(2*scale)+1;y+=.32){
      const x=valley.riverX(y),r=valley.riverWidth(y);
      const [a,b]=screen({x:x-r,y});
      ctx.fillStyle='#77a9ad';ctx.fillRect(a,b,2*r*scale,.35*scale);
    }
    ctx.lineCap='round';ctx.lineJoin='round';
    for(const road of ContourTown.openRoads(valley,city)){
      line(road.nodes,'#f2e6bf',Math.max(4,.46*scale));
      line(road.nodes,'#53615a',Math.max(2,.31*scale));
    }
    const hub=mode!=='roads'&&selectedHub();
    const served=new Set(hub?valley.market.catchment(hub,city,mode,el('teCargo').value).map(l=>l.id):[]);
    for(const lot of lots){
      const [x,y]=screen(lot),side=Math.max(4,lot.w*scale);
      ctx.fillStyle=preview.reached?.has(lot.id)?'#13786a':served.has(lot.id)?'#70a66e':'#b07958';
      ctx.fillRect(x-side/2,y-side/2,side,side);
    }
    if(preview.path)line(preview.path,mode==='roads'?'#fdf5da':'#fbca6d',Math.max(3,.19*scale));
    points.forEach((p,i)=>dot(p,'#31576d',i+1));
    if(mode!=='roads')for(const [key,station] of hubs){
      const kinds=services.get(key),freight=cargoOptions(key).length>0,r=station===hub?15:11;
      if(station===hub)dot(station,'#fff2bb',undefined,18);
      dot(station,kinds?.has('bus')?'#235e78':freight?'#8a572f':'#626963',
        kinds?.has('bus')?(freight?'P+':'P'):freight?'F':'•',r);
    }
    if(mode==='roads'&&points.length===2)dot(bend??{x:(points[0].x+points[1].x)/2,y:(points[0].y+points[1].y)/2},'#9b653d','↔',11);
  }
  function chooseCity(){
    const valley=getValley();
    city=valley.towns.find(c=>c.id===el('teCity').value);
    graph=ContourTown.getGraph(valley,city);
    points=[];bend=null;pan={x:city.x,y:city.y};
    scale=Math.min(52,Math.max(19,canvas.clientWidth/17));
    hubs=ContourTown.hubStations(valley,city);
    services=mode==='roads'?new Map():ContourTown.hubServices(valley,valley.market.kind);
    const placeholder=new Option('Select on map or here','');
    placeholder.disabled=true;
    el('teHub').replaceChildren(placeholder,...[...hubs].map(([key],index)=>{
      const option=new Option(hubName(key)+' '+(index+1),key);
      option.disabled=!eligible(key);return option;
    }));
    el('teHub').value=editing&&eligible(editing.hub)?editing.hub:'';
    updateCargo(editing?.cargo??'timber');
    if(editing)points=editing.stops.map(p=>graph.nearest(p,.20)).filter(Boolean);
    const hub=selectedHub();
    if(mode!=='roads'&&hub)pan={x:(city.x+hub.x)/2,y:(city.y+hub.y)/2};
    update();
  }
  function open(next,id,loop){
    mode=next;editing=loop;
    el('teTitle').textContent=editing?(mode==='bus'?'Edit bus loop':'Edit delivery loop'):modes[mode];
    el('teConfirm').textContent=editing?'Save changes':'Build';
    el('teHubLabel').hidden=mode==='roads';
    const valley=getValley();
    el('teCargoLabel').hidden=mode!=='delivery';
    const towns=valley.towns;
    el('teCity').replaceChildren(...towns.map(c=>new Option(c.name,c.id)));
    el('teCity').disabled=!!editing;
    if(id)el('teCity').value=id;
    dialog.showModal();chooseCity();
  }
  canvas.onpointerdown=event=>{
    const xy=coords(event),at=world(...xy);
    const handle=bend??(points.length===2&&{x:(points[0].x+points[1].x)/2,y:(points[0].y+points[1].y)/2});
    press={xy,panned:false,handle:mode==='roads'&&handle&&ContourTown.gap(at,handle)*scale<19};
    canvas.setPointerCapture(event.pointerId);
  };
  canvas.onpointermove=event=>{
    if(!press)return;
    const xy=coords(event),[x,y]=xy,dx=x-press.xy[0],dy=y-press.xy[1];
    if(!press.panned&&Math.hypot(dx,dy)<4)return;
    press.panned=true;press.xy=xy;
    if(press.handle){bend=world(x,y);update();}
    else{pan.x-=dx/scale;pan.y-=dy/scale;draw();}
  };
  canvas.onpointerup=event=>{
    if(!press?.panned){
      const at=world(...coords(event)),snapped=graph.nearest(at,17/scale);
      if(mode==='roads'){
        if(points.length===2){points=[];bend=null;}
        if(snapped)points.push(geometry(snapped));
        else if(points.length){at.z=ground(at.x,at.y);points.push(at);}
      }else{
        const marker=[...hubs].sort(([,a],[,b])=>ContourTown.gap(a,at)-ContourTown.gap(b,at))[0];
        if(marker&&ContourTown.gap(marker[1],at)*scale<18){
          chooseHub(marker[0]);press=null;return;
        }
        if(!selectedHub()){press=null;return;}
        const index=points.findIndex(p=>ContourTown.gap(p,at)*scale<12);
        if(index>=0)points.splice(index,1);
        else if(snapped&&!points.includes(snapped)&&points.length<12)points.push(snapped);
      }
      update();
    }
    press=null;
  };
  canvas.onpointercancel=()=>{press=null;};
  canvas.onwheel=event=>{event.preventDefault();scale=Math.max(10,Math.min(90,scale*Math.exp(-event.deltaY*.0017)));draw();};
  el('teZoomIn').onclick=()=>{scale=Math.min(90,scale*1.25);draw();};
  el('teZoomOut').onclick=()=>{scale=Math.max(10,scale*.8);draw();};
  el('teUndo').onclick=()=>{points.pop();bend=null;update();};
  el('teCity').onchange=chooseCity;
  el('teHub').onchange=()=>{updateCargo();update();};
  el('teCargo').onchange=update;
  el('teClose').onclick=()=>dialog.close();
  el('teConfirm').onclick=()=>{
    update();
    if(el('teConfirm').disabled)return;
    if(mode==='roads')commitRoad(preview);else commitLoop(preview,editing);
    dialog.close();complete();
  };
  new ResizeObserver(draw).observe(canvas);
  return {open,isOpen:()=>dialog.open};
};
