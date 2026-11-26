(() => {
  'use strict';
  const metresPerUnit=40,gravity=9.81,timeScale=2.6,laneOffset=.13,turnoutLength=.65;
  const minHorizontalRadius=300;
  function horizontalRadiusIssue(radius){
    if(radius>=minHorizontalRadius-1e-6)return '';
    const measured=radius<1?'under 1 m':Math.floor(radius)+' m';
    return 'Tightest horizontal curve is '+measured+' (minimum '+minHorizontalRadius+' m). Spread out bends or realign the approach.';
  }
  function runningTrackRadius(radius,tracks){
    return tracks===2?Math.max(0,radius-laneOffset*metresPerUnit):radius;
  }
  function horizontalRadius(points){
    let radius=Infinity,left=0,right=1;
    for(let i=1;i<points.length-1;i++){
      const b=points[i];
      // Ignore short subdivisions introduced by crossings when estimating an existing alignment.
      while(left+1<i&&Math.hypot(b.x-points[left+1].x,b.y-points[left+1].y)>=.10)left++;
      right=Math.max(right,i+1);
      while(right+1<points.length&&Math.hypot(points[right].x-b.x,points[right].y-b.y)<.10)right++;
      const a=points[left],c=points[right],ux=b.x-a.x,uy=b.y-a.y,vx=c.x-b.x,vy=c.y-b.y;
      const cross=Math.abs(ux*vy-uy*vx),span=Math.hypot(ux,uy)*Math.hypot(vx,vy);
      if(span<1e-10)continue;
      if(cross>1e-10)radius=Math.min(radius,metresPerUnit*span*Math.hypot(c.x-a.x,c.y-a.y)/(2*cross));
      else if(ux*vx+uy*vy<0)return 0;
    }
    return radius;
  }
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
  const nodeId=(trackId,index)=>'junction:'+JSON.stringify([trackId,index]);
  function trackTangent(track,i){
    if(i===0&&track.startTangent)return track.startTangent;
    if(i===track.points.length-1&&track.endTangent)return track.endTangent;
    const a=track.points[Math.max(0,i-1)],b=track.points[Math.min(track.points.length-1,i+1)];
    const span=Math.hypot(b.x-a.x,b.y-a.y)||1;
    return {x:(b.x-a.x)/span,y:(b.y-a.y)/span};
  }
  function planSplits(tracks={},cuts=[]){
    if(!Array.isArray(cuts))throw new Error('Review the proposed track junctions.');
    const groups=new Map();
    for(const cut of cuts){
      const {trackId,index}=cut??{};
      const track=Object.hasOwn(tracks,trackId)&&tracks[trackId];
      if(!track||!Number.isInteger(index)||index<=0||index>=track.points.length-1){
        throw new Error('A proposed junction is no longer on its original track section.');
      }
      if(!groups.has(trackId))groups.set(trackId,new Set());
      groups.get(trackId).add(index);
    }
    const replacements=new Map(),next={...tracks};
    for(const [id,track] of Object.entries(tracks)){
      if(!groups.has(id))continue;
      const indices=[0,...[...groups.get(id)].sort((a,b)=>a-b),track.points.length-1];
      const nodes=[track.from,...indices.slice(1,-1).map(index=>nodeId(id,index)),track.to];
      const distances=[0];
      for(let i=1;i<track.points.length;i++){
        const a=track.points[i-1],b=track.points[i];
        distances.push(distances[i-1]+Math.hypot(b.x-a.x,b.y-a.y));
      }
      const pieces=indices.slice(1).map((last,i)=>{
        const first=indices[i],start=distances[first],end=distances[last];
        const pieceId='rail-split:'+JSON.stringify([id,first,last]);
        if(Object.hasOwn(next,pieceId)||end<=start)throw new Error('The proposed junction cannot divide this track section.');
        const piece={...track,id:pieceId,from:nodes[i],to:nodes[i+1],points:track.points.slice(first,last+1),
          crossingCorridor:track.crossingCorridor??id,
          startTangent:first?trackTangent(track,first):track.startTangent,
          endTangent:last<track.points.length-1?trackTangent(track,last):track.endTangent,
          startJunction:first===0?track.startJunction:undefined,
          endJunction:last===track.points.length-1?track.endJunction:undefined};
        if(track.crossings){
          piece.crossings=track.crossings.filter(({d})=>d>=start&&(d<end||i===indices.length-2&&d<=end))
            .map(entry=>{
              const record={...entry};
              for(const key of ['d','left','right'])if(Number.isFinite(record[key]))record[key]-=start;
              return record;
            });
        }
        return piece;
      });
      delete next[id];
      for(const piece of pieces)next[piece.id]=piece;
      replacements.set(id,pieces);
    }
    return {tracks:next,replacements};
  }
  function rewriteRoute(route,replacements){
    if(!route.trackIds?.some(id=>replacements.has(id)))return route;
    const trackIds=[],trackDirections=[],trackLanes=[];
    for(const [i,id] of route.trackIds.entries()){
      const direction=route.trackDirections?.[i]===-1?-1:1;
      const pieces=replacements.get(id);
      if(!pieces)trackIds.push(id);
      else trackIds.push(...(direction===1?pieces:[...pieces].reverse()).map(piece=>piece.id));
      trackDirections.push(...Array(pieces?.length??1).fill(direction));
      trackLanes.push(...Array(pieces?.length??1).fill(route.trackLanes?.[i]??route.runningTrack??'auto'));
    }
    return {...route,trackIds,trackDirections,trackLanes};
  }
  window.ContourTrackSplit={plan:planSplits,nodeId,rewriteRoute};

  function crossingResources(transport){
    const tracks=Object.values(transport?.railTracks??{});
    if(!transport||tracks.length<2)return new Map();
    const cached=crossingCache.get(transport);
    if(cached&&tracks.length===cached.tracks.length&&tracks.every((track,i)=>track===cached.tracks[i]))return cached.byTrack;
    const bins=new Map(),byTrack=new Map(),positions=new Map(),size=4;
    for(const track of tracks){
      const resources=new Set();
      byTrack.set(track.id,resources);
      let travelled=0;
      for(let i=1;i<track.points.length;i++){
        const a=track.points[i-1],b=track.points[i];
        const middle=travelled+Math.hypot(b.x-a.x,b.y-a.y)/2;
        travelled+=Math.hypot(b.x-a.x,b.y-a.y);
        for(let x=Math.floor(Math.min(a.x,b.x)/size);x<=Math.floor(Math.max(a.x,b.x)/size);x++){
          for(let y=Math.floor(Math.min(a.y,b.y)/size);y<=Math.floor(Math.max(a.y,b.y)/size);y++){
            const key=x+':'+y,nearby=bins.get(key)??[];
            for(const other of nearby){
              if(track===other.track||!levelCrossing(a,b,other.a,other.b,track,other.track))continue;
              const resource='crossing:'+JSON.stringify([track.id,other.track.id].sort());
              if(!positions.has(resource))positions.set(resource,new Map());
              const locations=positions.get(resource);
              for(const [id,d] of [[track.id,middle],[other.track.id,other.middle]]){
                const range=locations.get(id)??[d,d];
                locations.set(id,[Math.min(range[0],d),Math.max(range[1],d)]);
              }
              resources.add(resource);
              byTrack.get(other.track.id).add(resource);
            }
            nearby.push({track,a,b,middle});
            bins.set(key,nearby);
          }
        }
      }
    }
    crossingCache.set(transport,{tracks,byTrack,positions});
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
      const shared=[first.from,first.to].find(node=>node===second.from||node===second.to);
      const endpoint=shared===first.from?first.points[0]:first.points.at(-1);
      if(shared&&Math.hypot(a.x+ux*t-endpoint.x,a.y+uy*t-endpoint.y)<turnoutLength)return false;
      return Math.abs(a.z+(b.z-a.z)*t-c.z-(d.z-c.z)*f)<.18;
    }
    const t=(x*vy-y*vx)/cross,f=(x*uy-y*ux)/cross;
    if(t<0||t>1||f<0||f>1||Math.abs(a.z+(b.z-a.z)*t-c.z-(d.z-c.z)*f)>=.18)return false;
    const shared=[first.from,first.to].find(node=>node===second.from||node===second.to);
    if(!shared)return true;
    const endpoint=shared===first.from?first.points[0]:first.points.at(-1);
    return Math.hypot(a.x+ux*t-endpoint.x,a.y+uy*t-endpoint.y)>.13;
  }
  function doubleThrough(node,transport){
    const arms=Object.values(transport?.railTracks??{}).filter(track=>track.tracks===2&&(track.from===node||track.to===node));
    const outward=arms.map(track=>{
      const start=track.from===node;
      const t=trackTangent(track,start?0:track.points.length-1);
      return start?t:{x:-t.x,y:-t.y};
    });
    return arms.filter((_,i)=>outward.some((v,j)=>j!==i&&v.x*outward[i].x+v.y*outward[i].y<-.9));
  }
  function laneVector(track,node,lane){
    const t=trackTangent(track,node===track.from?0:track.points.length-1);
    return {x:-t.y*lane*laneOffset,y:t.x*lane*laneOffset};
  }
  function branchConnection(track,start,transport){
    if(track.tracks===2)return null;
    const node=start?track.from:track.to;
    const main=doubleThrough(node,transport)[0];
    if(!main)return null;
    const chosen=start?track.startJunction:track.endJunction;
    if(chosen)return chosen;
    // Older branches have no explicit turnout. Use the rail nearest the approach.
    const points=start?track.points:track.points.slice().reverse(),first=points[0];
    const approach=points.find(p=>Math.hypot(p.x-first.x,p.y-first.y)>.4)??points.at(-1);
    const offset=laneVector(main,node,1);
    const side=(approach.x-first.x)*offset.x+(approach.y-first.y)*offset.y>=0?1:-1;
    return laneVector(main,node,side);
  }
  function junctionTapers(track,transport){
    if(track?.tracks!==2)return {taperStart:false,taperEnd:false};
    const adjacent=Object.values(transport?.railTracks??{}).filter(other=>other.id!==track.id&&other.tracks!==2);
    const tapers=node=>!doubleThrough(node,transport).some(main=>main.id===track.id)&&
      node!=null&&adjacent.some(other=>other.from===node||other.to===node);
    return {taperStart:tapers(track.from),taperEnd:tapers(track.to)};
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
      return {side,layout,mixed,station,span:station.terminal?layout.end:(layout.end-layout.start)/2};
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
      station.shortApproach=turnout<turnoutLength;
    }
    const samples=[...points],sampleDistances=[...distances],tangents=points.map((_,i)=>trackTangent(track,i));
    const edges=[...(start?[start.span,start.span+start.turnout]:[]),
      ...(end?[length-end.span-end.turnout,length-end.span]:[])].sort((a,b)=>a-b);
    // Sample the edge itself so a segment spanning it cannot angle into the platform.
    for(const distance of edges){
      const i=sampleDistances.findIndex(d=>d>distance);
      if(i<1||distance-sampleDistances[i-1]<1e-6||sampleDistances[i]-distance<1e-6)continue;
      const a=samples[i-1],b=samples[i],t=(distance-sampleDistances[i-1])/(sampleDistances[i]-sampleDistances[i-1]);
      samples.splice(i,0,{...(t<.5?a:b),x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,z:a.z+(b.z-a.z)*t});
      sampleDistances.splice(i,0,distance);
      tangents.splice(i,0,{x:(b.x-a.x)/Math.hypot(b.x-a.x,b.y-a.y),y:(b.y-a.y)/Math.hypot(b.x-a.x,b.y-a.y)});
    }
    return {points:samples,distances:sampleDistances,length,tracks,start,end,taperStart:taperStart&&!start,taperEnd:taperEnd&&!end,tangents,
      startConnection:start?null:branchConnection(track,true,transport),endConnection:end?null:branchConnection(track,false,transport)};
  }
  function turnoutFlags(track,transport){
    const profile=trackProfile(track,transport);
    return {taperStart:profile?.taperStart,taperEnd:profile?.taperEnd,
      stationProfile:profile?.start||profile?.end||profile?.startConnection||profile?.endConnection?profile:null};
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
  function railPoint(profile,i,lane,startPlatform,endPlatform){
    const p=profile.points[i],d=profile.distances[i],t=profile.tangents[i];
    const offset=trackLateral(profile,d,lane,startPlatform,endPlatform);
    if(profile.start&&!profile.start.shortApproach&&d<=profile.start.span){
      const {station,side}=profile.start;
      return {...p,...stationPoint(station,-d*side,offset*side,p.z)};
    }
    const remaining=profile.length-d;
    if(profile.end&&!profile.end.shortApproach&&remaining<=profile.end.span){
      const {station,side}=profile.end;
      return {...p,...stationPoint(station,remaining*side,offset*side,p.z)};
    }
    const start=1-taperFactor(d,profile.length,true,false),end=1-taperFactor(d,profile.length,false,true);
    return {...p,x:p.x-t.y*offset+(profile.startConnection?.x??0)*start+(profile.endConnection?.x??0)*end,
      y:p.y+t.x*offset+(profile.startConnection?.y??0)*start+(profile.endConnection?.y??0)*end};
  }
  function laneForConnection(track,node,connection){
    const right=laneVector(track,node,1);
    return right.x*connection.x+right.y*connection.y>=0?1:-1;
  }
  function serviceRail(block,from){
    if(!block.profile)return [];
    block.serviceRails??=[];
    return block.serviceRails[from]??=block.profile.points.map((_,i)=>
      railPoint(block.profile,i,runningLane(block,from),block.startPlatform,block.endPlatform));
  }
  function trackLines(track,transport,profile=trackProfile(track,transport)){
    if(!profile||profile.points.length<2)return {lines:[],profile};
    const {points,distances,length}=profile;
    const lanes=profile.tracks===2?[-1,1]:[0];
    const line=(lane,start,end,from=0,to=length)=>({
      points:points.flatMap((_,i)=>distances[i]<from||distances[i]>to?[]:[railPoint(profile,i,lane,start,end)]),
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
          if(station.shortApproach&&profile.tracks===2&&Math.abs(Math.abs(to)-laneOffset)<1e-6)continue;
          const inner=station.span-.12;
          lines.push(line(lane,first?platform.index:null,first?null:platform.index,
            first?(built.has(to)?Math.max(0,inner):0):Math.max(0,length-limit),
            first?Math.min(length,limit):(built.has(to)?Math.min(length,length-inner):length)));
          lines.at(-1).railOnly=built.has(to);
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
      return {id,track,runningTrack:route.trackLanes?.[i]??route.runningTrack,tracks:track?.tracks===2?2:1,direction,length,from:track?.from,to:track?.to,profile,
        startPlatform:assigned(track?.from),endPlatform:assigned(track?.to)};
    });
    if(!blocks.length)blocks.push({id:'route:'+JSON.stringify(route.stations?.map(s=>s.id??[s.x,s.y])),tracks:1,direction:1,length:path.at(-1).length});
    blocks.forEach((block,index)=>{
      if(block.tracks!==2)return;
      for(const [adjacentIndex,node] of [[index-1,block.direction===1?block.from:block.to],
        [index+1,block.direction===1?block.to:block.from]]){
        const neighbor=blocks[adjacentIndex];
        if(neighbor?.tracks!==1||!neighbor.profile)continue;
        const connection=neighbor.from===node?neighbor.profile.startConnection:neighbor.profile.endConnection;
        if(connection){block.turnoutLane=laneForConnection(block.track,node,connection);break;}
      }
    });
    const laneConflict=resolveRunningLanes(blocks);
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
    const signalZones=[],junctionZones=[];
    const locations=crossingCache.get(transport)?.positions??new Map();
    for(const block of blocks){
      for(const key of crossings.get(block.id)??[]){
        const range=locations.get(key)?.get(block.id);
        if(!range)continue;
        const [a,b]=block.direction===1?range:[block.length-range[1],block.length-range[0]];
        signalZones.push({key,start:Math.max(0,(block.start+a-1)*metresPerUnit),
          end:Math.min(path.at(-1).length*metresPerUnit,(block.start+b+1)*metresPerUnit)});
      }
      for(const [node,d] of [[block.direction===1?block.from:block.to,block.start],
        [block.direction===1?block.to:block.from,block.end]]){
        if(!switches.includes(node))continue;
        const through=doubleThrough(node,transport),main=through[0];
        const atStart=block.from===node;
        const connection=atStart?block.profile?.startConnection:block.profile?.endConnection;
        const station=atStart?block.profile?.start:block.profile?.end;
        const separated=!station&&(connection||through.some(track=>track.id===block.id));
        junctionZones.push({block,node,main,connection,separated,
          start:Math.max(0,(d-1)*metresPerUnit),end:Math.min(path.at(-1).length*metresPerUnit,(d+1)*metresPerUnit)});
      }
    }
    const signalZonesByDirection=[0,1].map(from=>{
      const zones=[...signalZones];
      for(const {block,node,main,connection,separated,start,end} of junctionZones){
        const offset=connection??(separated&&laneVector(block.track,node,runningLane(block,from)));
        const suffixes=!main?['']:separated?['/'+laneForConnection(main,node,offset)]:['/-1','/1'];
        for(const suffix of suffixes){
          const key='junction:'+node+suffix;
          if(!zones.some(zone=>zone.key===key&&zone.start===start&&zone.end===end))zones.push({key,start,end});
        }
      }
      return zones;
    });
    const railRun={mode:'rail',path,length:path.at(-1).length,segments,blocks,laneConflict,switches,crossings:crossingsOnRoute,
      signalZones:signalZonesByDirection[0],signalZonesByDirection};
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
  function platformDeflection(block,lane){
    const {profile}=block;
    return [[profile?.start,block.startPlatform],[profile?.end,block.endPlatform]].reduce((total,[station,platform])=>
      total+(station&&platform?Math.abs(laneAt(station,0,platform)-lane*laneOffset):0),0);
  }
  function requestedLane(block,from){
    if(block.runningTrack==='left')return -block.direction;
    if(block.runningTrack==='right')return block.direction;
    if(block.runningTrack==='directional')return (from?1:-1)*block.direction;
    return 0;
  }
  function platformLane(block){
    for(const [station,platform] of [[block.profile?.start,block.startPlatform],[block.profile?.end,block.endPlatform]]){
      if(!station?.shortApproach||!platform)continue;
      const offset=laneAt(station,0,platform);
      if(Math.abs(Math.abs(offset)-laneOffset)<1e-6)return Math.sign(offset);
    }
    return 0;
  }
  function canChangeRails(before,after){
    const beforeTapers=before.direction===1?before.profile?.taperEnd:before.profile?.taperStart;
    const afterTapers=after.direction===1?after.profile?.taperStart:after.profile?.taperEnd;
    return beforeTapers&&afterTapers;
  }
  function resolveRunningLanes(blocks){
    // A section boundary on parallel track has no physical way to change rails.
    // Resolve its lane together with the rest of the continuous pair.
    let conflict=false;
    for(let first=0;first<blocks.length;first++){
      if(blocks[first].tracks!==2)continue;
      let end=first+1;
      while(blocks[end]?.tracks===2&&!canChangeRails(blocks[end-1],blocks[end]))end++;
      const stretch=blocks.slice(first,end);
      const required=new Set();
      const assigned=stretch.some(block=>block.startPlatform||block.endPlatform);
      let constraint;
      for(const block of stretch){
        block.laneGroup=first;
        const platform=platformLane(block);
        if(block.turnoutLane){
          constraint='turnout';
          required.add(block.turnoutLane*block.direction);
        }
        if(platform){
          constraint??='platform';
          required.add(platform*block.direction);
        }
      }
      if(required.size>1)conflict=true;
      for(const block of stretch)block.laneConstraint=constraint;
      for(const from of [0,1]){
        const score=side=>stretch.reduce((cost,block)=>{
          const lane=side*block.direction,requested=requestedLane(block,from);
          if(requested&&lane!==requested)cost+=1;
          return cost+platformDeflection(block,lane);
        },0);
        const left=score(-1),right=score(1);
        const side=required.size===1?[...required][0]:left===right?(assigned||!from?-1:1):left<right?-1:1;
        for(const block of stretch)(block.lanes??=[])[from]=side*block.direction;
      }
      first=end-1;
    }
    return conflict;
  }
  // Lane sign is relative to the stored section geometry. A/B describe the service endpoints.
  function runningLane(block,from){
    if(block.tracks!==2)return 0;
    return (block.lanes?.[from]??block.turnoutLane??requestedLane(block,from))||((from?1:-1)*block.direction);
  }
  function runningTrackChoice(block){
    const outbound=runningLane(block,0),returning=runningLane(block,1);
    if(outbound!==returning)return 'directional';
    return outbound*block.direction===1?'right':'left';
  }
  function preferredRunningTrack(block){
    if(!block||block.tracks!==2)return 'auto';
    if(block.turnoutLane)return block.turnoutLane*block.direction===1?'right':'left';
    return platformDeflection(block,block.direction)<platformDeflection(block,-block.direction)?'right':'left';
  }
  function blockKeys(run,from){
    return [...run.blocks.map(block=>'track:'+block.id+(block.tracks===2?'/'+(-runningLane(block,from)):'')),
      ...new Set(signalWindows(run,from).map(zone=>zone.key))];
  }
  function signalWindows(run,from){
    const total=run.length*metresPerUnit;
    const zones=run.signalZonesByDirection?.[from]??run.signalZones??[];
    return from?zones.map(zone=>({...zone,start:total-zone.end,end:total-zone.start})):zones;
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
    if(block.profile){
      const canonical=block.direction===1?distance-block.start:block.end-distance;
      const {distances}=block.profile,points=serviceRail(block,state.from);
      let low=0,high=distances.length-1;
      while(high-low>1){const mid=(low+high)>>1;if(distances[mid]<=canonical)low=mid;else high=mid;}
      const p=points[low],q=points[high],len=distances[high]-distances[low];
      const t=(canonical-distances[low])/(len||1),sign=direction*block.direction;
      const yaw=Math.atan2((q.y-p.y)*sign,(q.x-p.x)*sign);
      return {x:p.x+(q.x-p.x)*t,y:p.y+(q.y-p.y)*t,z:p.z+(q.z-p.z)*t,
        tunnel:Boolean((t<.5?p:q).tunnel),yaw,angle:yaw,pitch:Math.atan2((q.z-p.z)*sign,len),direction};
    }
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
  function connectionCost(section,regional=false){
    return Math.round((section.length*40*415+section.waterLength*1620)*(regional?.25:1)+
      (section.cut*13+section.fill*18)*(regional?.12:1)+(section.crossingCost??0));
  }
  function secondTrackCost(track,regional=false){
    let span=0,bridges=0;
    for(let i=1;i<track.points.length;i++){
      const a=track.points[i-1],b=track.points[i],distance=Math.hypot(b.x-a.x,b.y-a.y);
      span+=distance;if(b.bridge)bridges+=distance;
    }
    return Math.round((span*40*245+bridges*40*815)*(regional?.25:1));
  }
  window.ContourRail={minHorizontalRadius,horizontalRadius,horizontalRadiusIssue,runningTrackRadius,preferredRunningTrack,runningTrackChoice,doubleThrough,laneVector,branchConnection,serviceRail,connectionCost,signalWindows,secondTrackCost,locomotives,cars,defaultConsist,quote,estimate,run,pose,advance,conditions,runningLane,blockKeys,metresPerUnit,speedLimit,massFor,turnoutFlags,taperFactor,turnoutLength,stationLayout,stationPoint,stationFootprint,stationTrackCount,trackLines,trackTangent,trainSpan};
})();
