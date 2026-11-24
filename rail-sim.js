(() => {
  'use strict';
  const metresPerUnit=40,gravity=9.81,timeScale=2.6,laneOffset=.13,turnoutLength=.65;
  const locomotives={
    shunter:{name:'Yard diesel',price:12800,mass:44,length:10,speed:64,power:430,tractiveEffort:112,resistance:1.7,brake:43},
    diesel:{name:'Road diesel',price:21400,mass:72,length:15,speed:105,power:1150,tractiveEffort:184,resistance:2.1,brake:66},
    express:{name:'Express diesel',price:29900,mass:80,length:17,speed:140,power:1720,tractiveEffort:193,resistance:2.3,brake:76}
  };
  const cars={
    coach:{name:'Passenger coach',type:'passengers',price:5200,mass:19,length:14,speed:110,capacity:18,resistance:.90,brake:24},
    expressCoach:{name:'Express coach',type:'passengers',price:6900,mass:24,length:16,speed:140,capacity:24,resistance:.85,brake:31},
    wagon:{name:'Freight wagon',type:'freight',price:3550,mass:11,length:11,speed:85,capacity:8,resistance:.68,brake:18},
    heavyWagon:{name:'High-capacity wagon',type:'freight',price:5350,mass:16,length:13,speed:75,capacity:13,resistance:1.25,brake:23}
  };
  const cargoMass={
    passengers:.085,timber:1.7,stone:2.8,fish:.8,peat:1.1,flour:1.2,bricks:2.7,
    furniture:.8,steel:3.1,copper:3.3,grain:1.4,clay:2.3,iron:3,copperOre:3,coal:2.4,
    reeds:.6,fabric:.7,logs:1.9,boards:1.4,produce:.9,fuel:1.5,pine:1.6,
    joinery:1.1,kaolin:2.4,ceramics:1.8,insulation:.5,transit:2.1,power:2.9
  };
  const typeOf=cargo=>cargo==='passengers'?'passengers':'freight';
  const defaultConsist=cargo=>({locomotives:['diesel'],cars:[typeOf(cargo)==='passengers'?'coach':'wagon']});
  const sum=(items,key)=>items.reduce((total,item)=>total+item[key],0);
  function quote(consist,cargo){
    const locos=consist?.locomotives,carIds=consist?.cars;
    const failure=reason=>({valid:false,reason,price:0,capacity:0,emptyMass:0,loadedMass:0,maxSpeed:0,power:0,tractiveEffort:0,length:0});
    if(!Array.isArray(locos)||!locos.length||locos.length>4)return failure('Choose one to four locomotives.');
    if(!Array.isArray(carIds)||!carIds.length||carIds.length>12)return failure('Choose one to twelve cars.');
    const engines=locos.map(id=>Object.hasOwn(locomotives,id)?locomotives[id]:null);
    const wagons=carIds.map(id=>Object.hasOwn(cars,id)?cars[id]:null);
    if(engines.includes(null)||wagons.includes(null))return failure('That vehicle type is unavailable.');
    if(wagons.some(car=>car.type!==typeOf(cargo)))return failure('Choose cars that carry this service’s cargo.');
    const stock=[...engines,...wagons],capacity=sum(wagons,'capacity'),emptyMass=sum(stock,'mass');
    return {valid:true,price:sum(stock,'price'),capacity,emptyMass,loadedMass:emptyMass+capacity*(cargoMass[cargo]??1.8),
      maxSpeed:Math.min(...stock.map(item=>item.speed)),power:sum(engines,'power'),tractiveEffort:sum(engines,'tractiveEffort'),
      length:sum(stock,'length'),resistance:sum(stock,'resistance'),brake:sum(stock,'brake'),carCount:stock.length};
  }
  const crossingCache=new WeakMap();
  function crossingResources(transport){
    const tracks=Object.values(transport?.railTracks??{});
    if(!transport||tracks.length<2)return new Map();
    const cached=crossingCache.get(transport);
    if(cached&&tracks.length===cached.tracks.length&&tracks.every((track,i)=>track===cached.tracks[i]))return cached.byTrack;
    const bins=new Map(),byTrack=new Map(),size=4;
    for(const track of tracks){
      const resources=new Set();
      byTrack.set(track.id,resources);
      for(let i=1;i<track.points.length;i++){
        const a=track.points[i-1],b=track.points[i];
        for(let x=Math.floor(Math.min(a.x,b.x)/size);x<=Math.floor(Math.max(a.x,b.x)/size);x++){
          for(let y=Math.floor(Math.min(a.y,b.y)/size);y<=Math.floor(Math.max(a.y,b.y)/size);y++){
            const key=x+':'+y,nearby=bins.get(key)??[];
            for(const other of nearby){
              if(track===other.track||!levelCrossing(a,b,other.a,other.b,track,other.track))continue;
              const resource='crossing:'+JSON.stringify([track.id,other.track.id].sort());
              resources.add(resource);
              byTrack.get(other.track.id).add(resource);
            }
            nearby.push({track,a,b});
            bins.set(key,nearby);
          }
        }
      }
    }
    crossingCache.set(transport,{tracks,byTrack});
    return byTrack;
  }
  function levelCrossing(a,b,c,d,first,second){
    const ux=b.x-a.x,uy=b.y-a.y,vx=d.x-c.x,vy=d.y-c.y;
    const x=c.x-a.x,y=c.y-a.y,cross=ux*vy-uy*vx;
    if(Math.abs(cross)<1e-9){
      const span=ux*ux+uy*uy;
      if(!span||Math.abs(x*uy-y*ux)>1e-7)return false;
      const start=(x*ux+y*uy)/span,end=start+(vx*ux+vy*uy)/span;
      const low=Math.max(0,Math.min(start,end)),high=Math.min(1,Math.max(start,end));
      if(high-low<1e-5)return false;
      const t=(low+high)/2,f=(t-start)/(end-start);
      return Math.abs(a.z+(b.z-a.z)*t-c.z-(d.z-c.z)*f)<.18;
    }
    const t=(x*vy-y*vx)/cross,f=(x*uy-y*ux)/cross;
    if(t<0||t>1||f<0||f>1||Math.abs(a.z+(b.z-a.z)*t-c.z-(d.z-c.z)*f)>=.18)return false;
    const shared=[first.from,first.to].find(node=>node===second.from||node===second.to);
    if(!shared)return true;
    const endpoint=shared===first.from?first.points[0]:first.points.at(-1);
    return Math.hypot(a.x+ux*t-endpoint.x,a.y+uy*t-endpoint.y)>.13;
  }
  function turnoutFlags(track,transport){
    if(track?.tracks!==2)return {taperStart:false,taperEnd:false};
    let taperStart=false,taperEnd=false;
    for(const other of Object.values(transport?.railTracks??{})){
      if(other.id===track.id||other.tracks===2)continue;
      taperStart||=track.from!=null&&(other.from===track.from||other.to===track.from);
      taperEnd||=track.to!=null&&(other.from===track.to||other.to===track.to);
      if(taperStart&&taperEnd)break;
    }
    return {taperStart,taperEnd};
  }
  function taperFactor(distance,length,taperStart,taperEnd){
    const clearance=Math.min(1,taperStart?distance/turnoutLength:1,taperEnd?(length-distance)/turnoutLength:1);
    const fraction=Math.max(0,clearance);
    return fraction*fraction*(3-2*fraction);
  }
  function run(route,transport,heightScale=5/.23){
    const tracks=(route.trackIds??[]).map(id=>transport?.railTracks?.[id]??route.trackPaths?.find(item=>item.id===id));
    const points=tracks.length&&tracks.every(track=>track?.points?.length>1)?
      tracks.flatMap((track,i)=>{
        const direction=route.trackDirections?.[i];
        const ordered=direction===-1?[...track.points].reverse():track.points;
        return i?ordered.slice(1):ordered;
      }):route.points??[];
    const path=[];
    for(const point of points){
      const previous=path.at(-1);
      const span=previous?Math.hypot(point.x-previous.x,point.y-previous.y):0;
      if(!previous||span>1e-5)path.push({...point,length:(previous?.length??0)+span});
    }
    if(path.length<2)return {mode:'rail',path,length:0,travel:Infinity,blocks:[],segments:[]};
    const bends=path.map((point,i)=>{
      if(i===0||i===path.length-1)return Infinity;
      const a=path[i-1],b=path[i+1];
      const dot=(point.x-a.x)*(b.x-point.x)+(point.y-a.y)*(b.y-point.y);
      const cross=(point.x-a.x)*(b.y-point.y)-(point.y-a.y)*(b.x-point.x);
      const angle=Math.atan2(Math.abs(cross),dot);
      return angle>1e-4?(b.length-a.length)*metresPerUnit/(2*angle):Infinity;
    });
    const segments=path.slice(1).map((point,i)=>{
      const a=path[i],length=(point.length-a.length)*metresPerUnit;
      return {length,grade:(point.z-a.z)*heightScale/length,radius:Math.min(bends[i],bends[i+1])};
    });
    const blocks=(route.trackIds??[]).map((id,i)=>{
      const track=tracks[i],points=track?.points??[];
      const length=points.reduce((total,p,j)=>j?total+Math.hypot(p.x-points[j-1].x,p.y-points[j-1].y):0,0);
      const direction=route.trackDirections?.[i]===-1?-1:1;
      const {taperStart,taperEnd}=turnoutFlags(track,transport);
      return {id,tracks:track?.tracks===2?2:1,direction,length,from:track?.from,to:track?.to,
        taperStart:direction===1?taperStart:taperEnd,taperEnd:direction===1?taperEnd:taperStart};
    });
    if(!blocks.length)blocks.push({id:'route:'+JSON.stringify(route.stations?.map(s=>s.id??[s.x,s.y])),tracks:1,direction:1,length:path.at(-1).length});
    let blockEnd=0;
    for(const block of blocks){
      block.start=blockEnd;
      block.end=blockEnd+=block.length;
    }
    const junctions=new Map();
    for(const track of Object.values(transport?.railTracks??{})){
      for(const end of [track.from,track.to]){
        junctions.set(end,(junctions.get(end)??0)+1);
      }
    }
    const singleEnds=new Set(),doubleEnds=new Set();
    for(const track of Object.values(transport?.railTracks??{})){
      const ends=track.tracks===2?doubleEnds:singleEnds;
      for(const end of [track.from,track.to])if(end!=null)ends.add(end);
    }
    const switches=[...new Set(blocks.flatMap(block=>[block.from,block.to]))]
      .filter(end=>end!=null&&(junctions.get(end)>2||(singleEnds.has(end)&&doubleEnds.has(end))));
    const crossings=crossingResources(transport);
    const crossingsOnRoute=[...new Set(blocks.flatMap(block=>[...(crossings.get(block.id)??[])]))];
    const railRun={mode:'rail',path,length:path.at(-1).length,segments,blocks,switches,crossings:crossingsOnRoute};
    const sample=estimate(defaultConsist(route.cargo??'passengers'),route.cargo??'passengers',railRun);
    railRun.travel=Number.isFinite(sample.travel)&&Number.isFinite(sample.returnTravel)?
      (sample.travel+sample.returnTravel)/2:railRun.length*1.6;
    return railRun;
  }
  function segmentIndex(run,metres){
    let lo=0,hi=run.path.length-1;
    while(hi-lo>1){
      const mid=(lo+hi)>>1;
      if(run.path[mid].length*metresPerUnit<=metres)lo=mid;else hi=mid;
    }
    return lo;
  }
  function blockKeys(run,from){
    return [...run.blocks.map(block=>'track:'+block.id+(block.tracks===2?'/'+(from?-block.direction:block.direction):'')),
      ...run.switches.map(end=>'junction:'+end),...run.crossings];
  }
  const speedForCurve=radius=>Math.sqrt(Math.max(3,radius)*.85);
  const profiles=new WeakMap(),estimates=new WeakMap();
  const massFor=(q,cargo,load)=>q.emptyMass+load*(cargoMass[cargo]??1.8);
  function resistanceAt(q,mass,grade,radius,speed){
    const rolling=q.resistance+mass*.012+q.carCount*.0014*speed*speed;
    const curve=Number.isFinite(radius)?mass*Math.min(.19,3.2/radius):0;
    return rolling+curve+mass*gravity*grade;
  }
  function speedLimit(q,gradePercent,radius=Infinity){
    let min=0,max=Math.min(q.maxSpeed/3.6,speedForCurve(radius));
    for(let i=0;i<18;i++){
      const midpoint=(min+max)/2;
      const effort=Math.min(q.tractiveEffort,q.power/Math.max(midpoint,1));
      if(effort>resistanceAt(q,q.loadedMass,gradePercent/100,radius,midpoint))min=midpoint;
      else max=midpoint;
    }
    return min*3.6;
  }
  function speedProfile(run,q,from,mass){
    let byRun=profiles.get(run);
    if(!byRun){byRun=new Map();profiles.set(run,byRun);}
    const key=[q.brake,q.maxSpeed,mass,from].join('/');
    if(byRun.has(key))return byRun.get(key);
    const profile=[],segments=from?[...run.segments].reverse():run.segments;
    let next=0;
    for(let i=segments.length-1;i>=0;i--){
      const {grade,radius,length}=segments[i];
      const limit=Math.min(q.maxSpeed/3.6,speedForCurve(radius));
      const braking=Math.max(.07,Math.min(1.1,q.brake/mass)+(from?-grade:grade)*gravity);
      const outgoing=Math.min(next,limit);
      profile[i]={limit,braking,outgoing};
      next=Math.min(limit,Math.sqrt(outgoing*outgoing+2*braking*length));
    }
    if(byRun.size>=96)byRun.clear();
    byRun.set(key,profile);
    return profile;
  }
  function conditions(run,state){
    const total=run.length*metresPerUnit;
    const position=state.from?total-state.distance:state.distance;
    const i=segmentIndex(run,position+(state.from?-1e-6:1e-6));
    const segment=run.segments[i];
    return {grade:segment.grade*(state.from?-1:1),curveRadius:segment.radius,
      i:state.from?run.segments.length-i-1:i,
      remaining:Math.max(0,state.from?position-run.path[i].length*metresPerUnit:run.path[i+1].length*metresPerUnit-position)};
  }
  function advance(run,state,q,cargo,load,dt){
    const total=run.length*metresPerUnit,mass=massFor(q,cargo,load);
    const {grade,curveRadius,i,remaining}=conditions(run,state);
    const {limit,braking,outgoing}=speedProfile(run,q,state.from,mass)[i];
    const duration=dt*timeScale;
    const resistance=resistanceAt(q,mass,grade,curveRadius,state.speed);
    const effort=Math.min(q.tractiveEffort,q.power/Math.max(state.speed,1));
    const target=Math.min(limit,Math.sqrt(outgoing*outgoing+2*braking*Math.max(0,remaining-.5*state.speed*duration)));
    const motoring=(effort-resistance)/mass;
    const brakeForce=Math.min(q.brake,mass*1.1);
    const desired=(target-state.speed)/duration;
    const mustBrake=desired<-resistance/mass;
    const acceleration=mustBrake?Math.max(desired,(-brakeForce-resistance)/mass):Math.min(desired,motoring);
    const speed=Math.max(0,state.speed+acceleration*duration);
    const distance=Math.min(total,state.distance+(state.speed+speed)*duration*.5);
    state.tracting=(!mustBrake&&desired>-resistance/mass)?Math.max(0,mass*acceleration+resistance):0;
    state.braking=mustBrake?Math.max(0,-mass*acceleration-resistance):0;
    const travelled=distance-state.distance;
    state.distance=distance;
    state.speed=speed;
    state.stallTime=travelled<1e-4?(state.stallTime??0)+dt:0;
    if(total-distance<=.03&&speed<.60){state.distance=total;state.speed=0;return true;}
    return false;
  }
  function estimate(consist,cargo,run){
    const q=quote(consist,cargo);
    if(!q.valid||!run?.segments?.length)return {...q,travel:Infinity,returnTravel:Infinity,maxGrade:0,minRadius:Infinity,stalled:false};
    let byRun=estimates.get(run);
    if(!byRun){byRun=new Map();estimates.set(run,byRun);}
    const key=JSON.stringify([cargo,consist.locomotives,consist.cars]);
    if(byRun.has(key))return byRun.get(key);
    function timed(from,load){
      const state={from,distance:0,speed:0};
      const dt=.16;
      const limit=Math.max(180,run.length*12);
      for(let time=dt;time<=limit;time+=dt){
        if(advance(run,state,q,cargo,load,dt))return time;
        if(state.stallTime>2)return Infinity;
      }
      return Infinity;
    }
    const travel=timed(0,q.capacity),returnTravel=timed(1,q.capacity);
    const estimate={...q,travel,returnTravel,maxGrade:Math.max(...run.segments.map(s=>Math.abs(s.grade)))*100,
      minRadius:Math.min(...run.segments.map(s=>s.radius)),
      stalled:!Number.isFinite(travel)||!Number.isFinite(returnTravel)};
    if(byRun.size>=96)byRun.clear();
    byRun.set(key,estimate);
    return estimate;
  }
  function pose(run,vehicle,offsetMapUnits=0){
    if(run.path.length<2)return null;
    const state=vehicle.rail??{from:0,distance:0};
    const direction=state.from?-1:1;
    const distance=(state.from?run.length:0)+(state.distance/metresPerUnit-offsetMapUnits)*direction;
    const i=segmentIndex(run,distance*metresPerUnit);
    const a=run.path[i],b=run.path[i+1],span=b.length-a.length,f=(distance-a.length)/span;
    const dx=(b.x-a.x)/span,dy=(b.y-a.y)/span;
    const block=run.blocks.find(block=>distance<=block.end)??run.blocks.at(-1);
    const offset=local=>block.tracks===2?direction*laneOffset*taperFactor(local,block.length,block.taperStart,block.taperEnd):0;
    const local=distance-block.start,lateral=offset(local);
    const lateralSlope=(offset(local+.01)-offset(local-.01))/.02;
    const yaw=Math.atan2((dy-dx*lateralSlope)*direction,(dx+dy*lateralSlope)*direction);
    return {x:a.x+(b.x-a.x)*f+dy*lateral,y:a.y+(b.y-a.y)*f-dx*lateral,z:a.z+(b.z-a.z)*f,
      yaw,angle:yaw,pitch:Math.atan2((b.z-a.z)*direction,span),direction};
  }
  window.ContourRail={locomotives,cars,defaultConsist,quote,estimate,run,pose,advance,conditions,blockKeys,metresPerUnit,speedLimit,massFor,turnoutFlags,taperFactor,turnoutLength};
})();
