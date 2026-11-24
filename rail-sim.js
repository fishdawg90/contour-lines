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
  function junctionTapers(track,transport){
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
  const platformEdge=.083,platformDepth=.43,stationTurnoutLength=2.6;
  function stationLayout(station,trackCount=1){
    const length=station.platformLength??2.4, count=Math.max(1,Math.min(3,Math.round(station.platformCount)||1));
    const start=station.terminal?0:-length/2,end=start+length;
    const first=trackCount===2?laneOffset:0,second=trackCount===2?-laneOffset:-.36;
    const lanes=[{index:1,offset:first}];
    if(count>1||trackCount===2)lanes.push({index:count>1?2:0,offset:second});
    const islandDepth=count===3?.55:.30;
    if(count===3)lanes.push({index:3,offset:second-islandDepth-2*platformEdge});
    const primary={near:first+platformEdge,far:first+platformEdge+platformDepth,edges:[first+platformEdge]};
    const pads=[primary];
    const platforms=[{index:1,near:primary.near,far:primary.far,edge:primary.near}];
    if(count>1){
      const near=second-platformEdge-islandDepth,far=second-platformEdge;
      pads.push({near,far,edges:count===3?[far,near]:[far]});
      platforms.push({index:2,near,far,edge:far});
      if(count===3)platforms.push({index:3,near,far,edge:near});
    }
    return {start,end,lanes,pads,platforms,
      normalMin:Math.min(...pads.map(p=>p.near),...lanes.map(l=>l.offset-.112)),
      normalMax:Math.max(...pads.map(p=>p.far),...lanes.map(l=>l.offset+.112))};
  }
  function stationPoint(station,along,normal,z=station.z){
    return {x:station.x-station.ny*along+station.nx*normal,y:station.y+station.nx*along+station.ny*normal,z};
  }
  function stationFootprint(station,trackCount=1){
    const {start,end,normalMin,normalMax}=stationLayout(station,trackCount);
    return [start,(start+end)/2,end].flatMap(along=>[normalMin,normalMax].map(side=>stationPoint(station,along,side)));
  }
  function stationTrackCount(station,transport){
    return Object.values(transport?.railTracks??{}).some(track=>track.tracks===2&&
      (track.from===station.id||track.to===station.id))?2:1;
  }
  function trackProfile(track,transport){
    if(!track?.points?.length)return null;
    const points=track.points,distances=[0];
    for(let i=1;i<points.length;i++)distances.push(distances[i-1]+Math.hypot(points[i].x-points[i-1].x,points[i].y-points[i-1].y));
    const length=distances.at(-1),tracks=track.tracks===2?2:1;
    const stationAt=(id,first)=>{
      const station=transport?.railStations?.[id];
      if(!station)return null;
      const a=first?points[0]:points.at(-2),b=first?points[1]:points.at(-1);
      const side=station.ny*(b.x-a.x)-station.nx*(b.y-a.y)>=0?1:-1;
      const trackCount=stationTrackCount(station,transport);
      const layout=stationLayout(station,trackCount);
      const mixed=trackCount===2&&Object.values(transport?.railTracks??{}).some(other=>
        other.tracks!==2&&(other.from===id||other.to===id));
      return {side,layout,mixed,span:station.terminal?layout.end:(layout.end-layout.start)/2};
    };
    const start=stationAt(track.from,true),end=stationAt(track.to,false);
    const {taperStart,taperEnd}=junctionTapers(track,transport);
    const clearance=(start?.span??0)+(end?.span??0);
    const stations=Number(!!start)+Number(!!end);
    const reserved=Math.min(clearance,length*.985);
    const scale=clearance?reserved/clearance:1;
    const turnout=Math.min(stationTurnoutLength,(length-reserved)/Math.max(1,stations));
    for(const station of [start,end])if(station){
      station.span*=scale;
      station.turnout=turnout;
    }
    return {points,distances,length,tracks,start,end,taperStart:taperStart&&!start,taperEnd:taperEnd&&!end};
  }
  function turnoutFlags(track,transport){
    const flags=junctionTapers(track,transport);
    if(!transport?.railStations?.[track?.from]&&!transport?.railStations?.[track?.to])return flags;
    return {...flags,stationProfile:trackProfile(track,transport)};
  }
  function laneAt(station,main,platform){
    const lanes=station.layout.lanes;
    const assigned=platform&&lanes.find(lane=>lane.index===platform);
    return (assigned??lanes.reduce((a,b)=>Math.abs(a.offset*station.side-main)<=Math.abs(b.offset*station.side-main)?a:b)).offset*station.side;
  }
  function turnoutBlend(distance,station){
    const t=Math.max(0,Math.min(1,(distance-station.span)/Math.max(.00001,station.turnout)));
    return t*t*(3-2*t);
  }
  function trackLateral(profile,distance,lane,startPlatform,endPlatform){
    const main=profile.tracks===2?lane*laneOffset:0;
    const baseline=main*taperFactor(distance,profile.length,profile.taperStart,profile.taperEnd);
    if(profile.start&&distance<profile.start.span+profile.start.turnout){
      const start=laneAt(profile.start,main,startPlatform);
      return start+(baseline-start)*turnoutBlend(distance,profile.start);
    }
    const remaining=profile.length-distance;
    if(profile.end&&remaining<profile.end.span+profile.end.turnout){
      const end=laneAt(profile.end,main,endPlatform);
      return end+(baseline-end)*turnoutBlend(remaining,profile.end);
    }
    return baseline;
  }
  function trackLines(track,transport,profile=trackProfile(track,transport)){
    if(!profile||profile.points.length<2)return {lines:[],profile};
    const {points,distances,length}=profile;
    const lanes=profile.tracks===2?[-1,1]:[0];
    const tangent=points.map((p,i)=>{
      const a=points[Math.max(0,i-1)],b=points[Math.min(i+1,points.length-1)];
      const span=Math.hypot(b.x-a.x,b.y-a.y)||1;
      return {x:(a.y-b.y)/span,y:(b.x-a.x)/span};
    });
    const line=(lane,start,end,from=0,to=length)=>({
      points:points.flatMap((p,i)=>{
        const d=distances[i];
        if(d<from||d>to)return [];
        const offset=trackLateral(profile,d,lane,start,end);
        return [{...p,x:p.x+tangent[i].x*offset,y:p.y+tangent[i].y*offset}];
      }),
    });
    const lines=lanes.map(lane=>line(lane));
    for(const [station,first] of [[profile.start,true],[profile.end,false]]){
      if(!station)continue;
      const built=new Set(lanes.map(lane=>laneAt(station,lane*laneOffset)));
      const limit=station.span+station.turnout+.23;
      for(const platform of station.layout.platforms){
        const to=laneAt(station,0,platform.index);
        for(const lane of lanes){
          if(Math.abs(laneAt(station,lane*laneOffset)-to)<1e-6)continue;
          const inner=station.span-.12;
          lines.push(line(lane,first?platform.index:null,first?null:platform.index,
            first?(built.has(to)?Math.max(0,inner):0):Math.max(0,length-limit),
            first?Math.min(length,limit):(built.has(to)?Math.min(length,length-inner):length)));
          built.add(to);
        }
      }
    }
    return {lines:lines.filter(line=>line.points.length>1),profile};
  }
  function trainSpan(run,vehicle,lengthMapUnits){
    const distance=(vehicle.rail?.distance??0)/metresPerUnit;
    const margin=Math.min(.045,run.length*.1),latest=run.length-margin;
    const front=Math.max(Math.min(lengthMapUnits+margin,latest),Math.min(distance,latest));
    return {front,tail:Math.max(0,front-lengthMapUnits)};
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
      const profile=trackProfile(track,transport);
      function assigned(node){
        const index=route.stations?.findIndex(station=>station.id===node)??-1;
        if(index>=0)return route.platforms?.[index]??1;
        const station=node===track?.from?profile?.start:profile?.end;
        return station?.mixed?1:undefined;
      }
      return {id,runningTrack:route.runningTrack,tracks:track?.tracks===2?2:1,direction,length,from:track?.from,to:track?.to,profile,
        startPlatform:assigned(track?.from),endPlatform:assigned(track?.to)};
    });
    if(!blocks.length)blocks.push({id:'route:'+JSON.stringify(route.stations?.map(s=>s.id??[s.x,s.y])),tracks:1,direction:1,length:path.at(-1).length});
    let blockEnd=0;
    for(const block of blocks){
      block.start=blockEnd;
      block.end=blockEnd+=block.length;
    }
    for(const block of blocks){
      const profile=block.profile;
      if(!profile)continue;
      for(const [station,atStart,platform] of [[profile.start,true,block.startPlatform],[profile.end,false,block.endPlatform]]){
        if(!station||!platform)continue;
        const mains=profile.tracks===2?[...new Set([runningLane(block,0),runningLane(block,1)])].map(lane=>lane*laneOffset):[0];
        const deflection=Math.max(...mains.map(main=>Math.abs(laneAt(station,main,platform)-main)));
        if(deflection<.001)continue;
        const radius=station.turnout**2*metresPerUnit/(6*deflection);
        const towardStart=atStart===(block.direction===1);
        const edge=towardStart?block.start+station.span:block.end-station.span;
        const end=edge+(towardStart?1:-1)*station.turnout;
        for(let i=0;i<segments.length;i++){
          if(path[i+1].length>Math.min(edge,end)&&path[i].length<Math.max(edge,end)){
            segments[i].radius=Math.min(radius,segments[i].radius);
          }
        }
      }
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
  // Lane sign is relative to the stored section geometry. A/B describe the service endpoints.
  function runningLane(block,from){
    if(block.tracks!==2)return 0;
    const right=block.runningTrack==='right'||(block.runningTrack!=='left'&&from===1);
    return (right?1:-1)*block.direction;
  }
  function blockKeys(run,from){
    return [...run.blocks.map(block=>'track:'+block.id+(block.tracks===2?'/'+(-runningLane(block,from)):'')),
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
  function advance(run,state,q,cargo,load,dt,stopDistance=Infinity){
    const total=run.length*metresPerUnit,mass=massFor(q,cargo,load);
    const {grade,curveRadius,i,remaining}=conditions(run,state);
    const {limit,braking,outgoing}=speedProfile(run,q,state.from,mass)[i];
    const duration=dt*timeScale;
    const resistance=resistanceAt(q,mass,grade,curveRadius,state.speed);
    const effort=Math.min(q.tractiveEffort,q.power/Math.max(state.speed,1));
    const clearance=Math.max(0,stopDistance-state.distance-.5*state.speed*duration);
    const target=Math.min(limit,Math.sqrt(2*braking*clearance),
      Math.sqrt(outgoing*outgoing+2*braking*Math.max(0,remaining-.5*state.speed*duration)));
    const motoring=(effort-resistance)/mass;
    const brakeForce=Math.min(q.brake,mass*1.1);
    const desired=(target-state.speed)/duration;
    const mustBrake=desired<-resistance/mass;
    const acceleration=mustBrake?Math.max(desired,(-brakeForce-resistance)/mass):Math.min(desired,motoring);
    const speed=Math.max(0,state.speed+acceleration*duration);
    const distance=Math.min(total,Math.max(state.distance,stopDistance),state.distance+(state.speed+speed)*duration*.5);
    state.tracting=(!mustBrake&&desired>-resistance/mass)?Math.max(0,mass*acceleration+resistance):0;
    state.braking=mustBrake?Math.max(0,-mass*acceleration-resistance):0;
    const travelled=distance-state.distance;
    state.distance=distance;
    state.speed=distance>=stopDistance?0:speed;
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
    const offset=local=>{
      const lane=runningLane(block,state.from);
      if(!block.profile)return block.direction*lane*laneOffset;
      const canonical=block.direction===1?local:block.length-local;
      return block.direction*trackLateral(block.profile,canonical,lane,block.startPlatform,block.endPlatform);
    };
    const local=distance-block.start,lateral=offset(local);
    const lateralSlope=(offset(local+.01)-offset(local-.01))/.02;
    const yaw=Math.atan2((dy+dx*lateralSlope)*direction,(dx-dy*lateralSlope)*direction);
    return {x:a.x+(b.x-a.x)*f-dy*lateral,y:a.y+(b.y-a.y)*f+dx*lateral,z:a.z+(b.z-a.z)*f,
      tunnel:Boolean((f<.5?a:b).tunnel),yaw,angle:yaw,pitch:Math.atan2((b.z-a.z)*direction,span),direction};
  }
  window.ContourRail={locomotives,cars,defaultConsist,quote,estimate,run,pose,advance,conditions,runningLane,blockKeys,metresPerUnit,speedLimit,massFor,turnoutFlags,taperFactor,turnoutLength,stationLayout,stationPoint,stationFootprint,stationTrackCount,trackLines,trainSpan};
})();
