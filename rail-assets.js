(() => {
  const iron='#404647',wheel='#333837',wood='#846344';
  const sleeperPitch=.086, laneOffset=.13, halfGauge=.034;
  const meshes=new Map();
  function builder(){
    const model=[];
    const face=(points,color)=>model.push({points,color});
    function box(x,y,z,length,width,height,color,cap=color){
      const ring=[[-1,-1],[1,-1],[1,1],[-1,1]];
      const bottom=ring.map(([u,v])=>[x+u*length/2,y+v*width/2,z]);
      const top=bottom.map(([a,b])=>[a,b,z+height]);
      for(let i=0;i<4;i++)face([bottom[i],bottom[(i+1)%4],top[(i+1)%4],top[i]],color);
      face(top,cap);
    }
    function cylinder(x,y,z,width,radius,colors,segments=8){
      const ring=direction=>Array.from({length:segments},(_,i)=>{
        const a=i*Math.PI*2/segments;
        return [x+radius*Math.cos(a),y+direction*width/2,z+radius*Math.sin(a)];
      });
      const a=ring(-1),b=ring(1);
      for(let i=0;i<segments;i++){
        const j=(i+1)%segments;
        face([a[i],a[j],b[j],b[i]],colors[i%colors.length]);
      }
      face([...a].reverse(),colors[0]);face(b,colors[0]);
    }
    return {model,face,box,cylinder};
  }
  function railVehicle(id,length,type){
    const key=id+'|'+length+'|'+type;
    if(meshes.has(key))return meshes.get(key);
    const {model,face,box,cylinder}=builder();
    const diesel=type==='locomotive',passenger=type==='passenger';
    const express=/express/i.test(id);
    const shunter=/shunter/i.test(id);
    const half=length*.5,bodyWidth=.077;
    const shell=diesel?(express?'#315868':shunter?'#946443':'#456e61'):passenger?(express?'#52637a':'#44635a'):'#77604d';
    const accent=diesel?'#dfc475':passenger?'#c8ab78':'#9b7857';
    box(0,0,.022,length*.93,.079,.024,iron);
    box(0,0,.043,length*.94,.084,.009,accent);
    for(const x of [-half*.58,half*.58])for(const y of [-halfGauge,halfGauge]){
      cylinder(x,y,.019,.019,.021,[wheel,'#575b55']);
    }
    for(const x of [-half*.92,half*.92])box(x,0,.025,length*.13,.023,.011,iron);
    if(shunter){
      const cab=-length*.19;
      box(length*.08,0,.052,length*.79,.070,.041,shell);
      box(length*.10,0,.093,length*.73,.073,.007,'#775941');
      box(cab,0,.052,length*.32,.080,.071,shell);
      box(cab,0,.123,length*.36,.089,.012,'#36433d');
      for(const y of [-.042,.042]){
        box(cab,y,.092,length*.205,.005,.023,accent);
        box(cab,y*1.055,.095,length*.174,.004,.017,'#324a4d');
        for(const f of [.09,.15,.21,.27])box(length*f,y*.88,.068,length*.017,.004,.018,'#5a5140');
      }
      for(const x of [-length*.461,length*.461])box(x,0,.072,.006,.021,.011,'#e4c577');
    }else if(diesel||passenger){
      box(0,0,.051,length*.91,bodyWidth,diesel?.067:.061,shell);
      box(0,0,.051,length*.912,bodyWidth+.003,.012,accent);
      const roof=diesel?(express?'#39494f':'#36433d'):'#645b50';
      const roofBase=diesel?.118:.112;
      const frame=x=>[[-.041,roofBase],[-.027,roofBase+.013],[.027,roofBase+.013],[.041,roofBase]].map(([y,z])=>[x,y,z]);
      const a=frame(-length*.47),b=frame(length*.47);
      for(let i=1;i<a.length;i++)face([a[i-1],b[i-1],b[i],a[i]],roof);
      face(a,roof);face([...b].reverse(),roof);
      const windows=diesel?[-.36,.36]:[-.335,-.22,-.11,0,.11,.22,.335];
      for(const u of windows)for(const y of [-.04,.04]){
        box(length*u,y,.082,length*(diesel?.12:.081),.004,.026,accent);
        box(length*u,y*1.045,.085,length*(diesel?.103:.067),.004,.020,'#324a4d');
      }
      if(diesel){
        for(const y of [-.0395,.0395]){
          if(express)box(0,y,.078,length*.57,.003,.007,'#798d8f');
          const count=express?5:7;
          for(let i=0;i<count;i++)box(length*(i-(count-1)/2)*.038,y,.090,length*.018,.003,.017,
            express?'#527079':'#344d46');
        }
        for(const x of [-length*.457,length*.457]){
          box(x,0,.083,.004,.058,.023,'#344c4c');
          box(x*1.015,0,.065,.004,.018,.010,'#e4c577');
        }
      }
    }else{
      box(0,0,.049,length*.89,.080,.012,shell);
      const covered=/box|van|goods|heavy/i.test(id);
      if(covered){
        box(0,0,.060,length*.86,.079,.061,shell);
        box(0,0,.121,length*.90,.086,.009,iron);
        for(const y of [-.041,.041]){
          box(0,y,.061,length*.27,.006,.056,accent);
          for(const x of [-length*.36,length*.36])box(x,y,.064,.012,.006,.055,accent);
        }
      }else{
        for(const y of [-.036,.036])box(0,y,.060,length*.89,.010,.038,accent);
        for(const x of [-length*.44,length*.44])box(x,0,.060,.010,.068,.038,shell);
        for(const x of [-length*.35,-length*.14,length*.14,length*.35])
          for(const y of [-.041,.041])box(x,y,.057,.012,.007,.043,wood);
      }
    }
    meshes.set(key,model);
    return model;
  }
  function frames(path){
    return path.points.map((p,i)=>{
      const {x:dx,y:dy}=ContourRail.trackTangent(path,i);
      return (offset,z)=>[p.x-dy*offset,p.y+dx*offset,p.z+z];
    });
  }
  function trackMesh(path,wet,flags={}){
    if(flags.stationProfile){
      const {lines}=ContourRail.trackLines(path,null,flags.stationProfile);
      return lines.flatMap(line=>trackMesh({...line,tracks:1},wet));
    }
    const {points,tracks}=path,section=frames(path);
    const tapered=flags.taperStart||flags.taperEnd;
    const total=tapered?points.slice(1).reduce((sum,point,i)=>sum+Math.hypot(point.x-points[i].x,point.y-points[i].y),0):0;
    const taper=distance=>tapered?ContourRail.taperFactor(distance,total,flags.taperStart,flags.taperEnd):1;
    const {model,face,box}=builder();
    if(points.length<2)return model;
    const lanes=tracks===2?[-laneOffset,laneOffset]:[0];
    const ballast=tracks===2?.242:.112;
    let accumulated=0,until=sleeperPitch*.5;
    for(let i=1;i<points.length;i++){
      const a=points[i-1],b=points[i],p=section[i-1],q=section[i];
      const length=Math.hypot(b.x-a.x,b.y-a.y);
      if(length<1e-6)continue;
      const bridge=a.bridge||b.bridge||wet((a.x+b.x)/2,(a.y+b.y)/2);
      const startTaper=taper(accumulated),endTaper=taper(accumulated+length);
      const ribbon=(left,right,lift,color,lane=0)=>face([
        p(left+lane*startTaper,lift),q(left+lane*endTaper,lift),
        q(right+lane*endTaper,lift),p(right+lane*startTaper,lift)
      ],color);
      if(!path.railOnly)ribbon(-ballast,ballast,.023,bridge?'#8c8171':'#a29785');
      if(!path.railOnly)for(const side of [-1,1]){
        const lip=side*ballast;
        face([p(lip,bridge?-.087:-.012),q(lip,bridge?-.087:-.012),q(lip,.023),p(lip,.023)],bridge?'#766b5f':'#807563');
      }
      if(!path.railOnly&&bridge&&!a.gradeSeparation&&!b.gradeSeparation&&Math.floor(accumulated/1.9)!==Math.floor((accumulated+length)/1.9)){
        const z=(a.z+b.z)/2;
        box((a.x+b.x)/2,(a.y+b.y)/2,.012,.21,ballast*1.1,Math.max(.01,z-.095),'#887d6b');
      }
      while(until<=accumulated+length){
        const t=(until-accumulated)/length;
        const point=(d,h,s)=>{
          const u=p(d,h),v=q(d,h);
          return u.map((value,j)=>value+(v[j]-value)*t+(j<2?(j===0?b.x-a.x:b.y-a.y)*s/length:0));
        };
        for(const lane of lanes){
          const d=lane*taper(until),left=d-.085,right=d+.085;
          if(!path.railOnly)face([point(left,.035,-.016),point(right,.035,-.016),point(right,.035,.016),point(left,.035,.016)],'#615047');
        }
        until+=sleeperPitch;
      }
      for(const lane of lanes)for(const gauge of [-halfGauge,halfGauge]){
        const left=gauge-.006,start=left+lane*startTaper,end=left+lane*endTaper;
        ribbon(left,gauge+.006,.048,'#666761',lane);
        face([p(start,.034),q(end,.034),q(end,.048),p(start,.048)],'#373b38');
      }
      accumulated+=length;
    }
    return model;
  }
  function buffers(tracks){
    const {model,box,face}=builder();
    const lanes=tracks===2?[-laneOffset,laneOffset]:[0];
    for(const offset of lanes){
      box(0,offset,.034,.043,.172,.026,iron);
      box(-.018,offset,.067,.029,.147,.036,'#a65843','#bc7353');
      for(const side of [-1,1]){
        const y=offset+side*.049;
        face([[-.008,y,.094],[.095,y,.040],[.095,y,.054],[-.008,y,.115]],iron);
        box(-.037,y,.077,.013,.026,.025,'#dcc894');
      }
    }
    return model;
  }
  const views=new WeakMap();
  const previews=new WeakMap();
  function modelView(model){
    let view=views.get(model);
    if(!view){
      view=model.map(({points,color})=>{
        const sum=points.reduce((depth,[x,y,z])=>depth-y+z*.32,0);
        return {points:points.map(([x,y,z])=>[x-y*.34,-z-y*.32]),color,depth:sum/points.length};
      }).sort((a,b)=>a.depth-b.depth);
      views.set(model,view);
    }
    return view;
  }
  function drawPreview(canvas,units){
    if(!canvas)return;
    if(!units.length){
      canvas.getContext('2d')?.clearRect(0,0,canvas.width,canvas.height);
      previews.delete(canvas);
      return;
    }
    const previous=previews.get(canvas);
    const width=canvas.clientWidth||previous?.width||canvas.width;
    const height=canvas.clientHeight||previous?.height||canvas.height;
    const ratio=canvas.clientWidth?Math.min(2,window.devicePixelRatio||1):1;
    const key=units.map(unit=>unit.id).join('|')+':'+width+':'+height+':'+ratio;
    if(previous?.key===key)return;
    canvas.width=Math.round(width*ratio);
    canvas.height=Math.round(height*ratio);
    const ctx=canvas.getContext('2d');
    if(!ctx)return;
    ctx.setTransform(ratio,0,0,ratio,0,0);
    const length=units.reduce((sum,unit)=>sum+unit.length,0);
    const horizontal=length+.040,vertical=.190;
    const padding=Math.max(2,Math.min(7,height*.11));
    const scale=Math.max(1,Math.min((width-padding*2)/horizontal,(height-padding*2)/vertical));
    const left=(width-length*scale)/2,base=height/2+.065*scale;
    const shadowHeight=Math.max(1,.019*scale);
    ctx.fillStyle='rgba(37,43,36,.13)';
    ctx.beginPath();
    ctx.ellipse(width/2,base+shadowHeight*.32,length*scale*.52,shadowHeight,0,0,Math.PI*2);
    ctx.fill();
    let offset=0;
    const bounds=[];
    for(const {id,length,kind} of units){
      bounds.push({left:(left+offset*scale)/width,right:(left+(offset+length)*scale)/width});
      const center=left+(offset+length/2)*scale;
      for(const {points,color} of modelView(railVehicle(id,length,kind))){
        ctx.beginPath();
        for(let i=0;i<points.length;i++){
          const [x,y]=points[i];
          if(i===0)ctx.moveTo(center+x*scale,base+y*scale);
          else ctx.lineTo(center+x*scale,base+y*scale);
        }
        ctx.closePath();
        ctx.fillStyle=color;
        ctx.fill();
      }
      offset+=length;
    }
    previews.set(canvas,{key,width,height,bounds});
  }
  function formationBounds(canvas){
    return previews.get(canvas)?.bounds??[];
  }
  function previewUnit(kind,id){
    const catalog=kind==='locomotive'?ContourRail.locomotives:ContourRail.cars;
    if(!Object.hasOwn(catalog,id))return null;
    const part=catalog[id];
    const type=kind==='locomotive'?kind:part.type==='passengers'?'passenger':'freight';
    return {id,kind:type,length:part.length/ContourRail.metresPerUnit};
  }
  function renderRailStock(canvas,kind,id){
    drawPreview(canvas,[previewUnit(kind,id)].filter(Boolean));
  }
  function renderRailConsist(canvas,consist){
    const units=[
      ...(consist?.locomotives??[]).map(id=>previewUnit('locomotive',id)),
      ...(consist?.cars??[]).map(id=>previewUnit('car',id)),
    ].filter(Boolean);
    drawPreview(canvas,units);
  }
  window.ContourRailAssets={vehicle:railVehicle,trackMesh,buffers,laneOffset,renderRailStock,renderRailConsist,formationBounds};
})();
