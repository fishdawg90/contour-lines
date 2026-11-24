(() => {
  'use strict';

  const treatments=['level','bridge','tunnel'];
  const metresPerUnit=40,cellSize=4,bridgeClearance=.29,tunnelClearance=.32;
  const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
  const lerp=(a,b,f)=>a+(b-a)*f;
  const distances=points=>{
    const values=[0];
    for(let i=1;i<points.length;i++){
      values.push(values[i-1]+Math.hypot(points[i].x-points[i-1].x,points[i].y-points[i-1].y));
    }
    return values;
  };

  function intersects(a,b,c,d){
    const ux=b.x-a.x,uy=b.y-a.y,vx=d.x-c.x,vy=d.y-c.y;
    const det=ux*vy-uy*vx,span=Math.hypot(ux,uy)*Math.hypot(vx,vy);
    if(!span||Math.abs(det)<span*1e-6)return null;
    const x=c.x-a.x,y=c.y-a.y,t=(x*vy-y*vx)/det,f=(x*uy-y*ux)/det;
    if(t< -1e-7||t>1+1e-7||f< -1e-7||f>1+1e-7)return null;
    return {t:clamp(t,0,1),f:clamp(f,0,1),sine:Math.min(1,Math.abs(det)/span)};
  }
  function cells(a,b,visit){
    for(let x=Math.floor(Math.min(a.x,b.x)/cellSize);x<=Math.floor(Math.max(a.x,b.x)/cellSize);x++){
      for(let y=Math.floor(Math.min(a.y,b.y)/cellSize);y<=Math.floor(Math.max(a.y,b.y)/cellSize);y++)visit(x+':'+y);
    }
  }
  function opposingPaths(mode,valley,excluded){
    const {transport}=valley, paths=[];
    const skip=id=>excluded?.has?.(id)||excluded?.includes?.(id);
    if(mode==='road'){
      for(const track of Object.values(transport.railTracks??{})){
        if(skip(track.id))continue;
        const lines=window.ContourRail?.trackLines?.(track,transport).lines??[track];
        for(const line of lines)paths.push({id:'rail:'+track.id,points:line.points,name:'Rail crossing',width:.18});
      }
      return paths;
    }
    for(const town of valley.towns??[]){
      for(const road of ContourTown.openRoads(valley,town)){
        const key=town.id+':'+road.id;
        if(skip(key))continue;
        paths.push({id:'street:'+key,name:town.name+' street',width:.23,points:road.nodes});
      }
    }
    const stations=new Map();
    for(const [id,road] of ContourTown.roadEntries(transport)){
      if(skip(id)||skip('route:'+id))continue;
      for(const {part,nodes} of ContourTown.roadSectionEntries(road)){
        paths.push({id:'road:'+id+':'+part,name:'Intercity road',width:.23,points:nodes});
      }
      for(const [side,station] of (road.stations??[]).entries()){
        if(!road.removedStationSides?.includes(side))stations.set(window.contourStationKey(station),station);
      }
    }
    for(const station of transport.extraBays??[])stations.set(window.contourStationKey(station),station);
    for(const [id,station] of stations){
      const driveway=station.driveway??(station.tie?[
        {x:station.x+station.nx*.45,y:station.y+station.ny*.45,z:station.z},station.tie
      ]:[]);
      if(driveway.length>1&&!skip(station.tie?.key)){
        paths.push({id:'driveway:'+id,name:station.name+' access road',width:.215,points:driveway});
      }
      for(const bay of transport.stationLayouts?.[id]?.bays??[]){
        const points=ContourTown.stationDrive(station,bay);
        if(points.length>1)paths.push({id:'stationDrive:'+id+':'+bay.id,name:station.name+' loading bay',width:.215,points});
      }
    }
    for(const [i,access] of (transport.stationAccesses??[]).entries()){
      if(!skip(access.tie?.key))paths.push({id:'access:'+i,name:'Station access road',width:.215,points:access.points});
    }
    return paths;
  }

  function findCrossings(points,along,paths){
    const bins=new Map();
    for(const path of paths){
      const stations=distances(path.points);
      for(let j=1;j<path.points.length;j++){
        const a=path.points[j-1],b=path.points[j],segment={a,b,path,j,stations};
        cells(a,b,key=>{
          if(!bins.has(key))bins.set(key,[]);
          bins.get(key).push(segment);
        });
      }
    }
    const found=new Map();
    for(let i=1;i<points.length;i++){
      const a=points[i-1],b=points[i],seen=new Set();
      cells(a,b,key=>{
        for(const segment of bins.get(key)??[]){
          if(seen.has(segment))continue;
          seen.add(segment);
          const hit=intersects(a,b,segment.a,segment.b);
          if(!hit)continue;
          const {t,f,sine}=hit,{path}=segment,d=lerp(along[i-1],along[i],t);
          const candidate={
            x:lerp(a.x,b.x,t),y:lerp(a.y,b.y,t),z:lerp(a.z,b.z,t),d,sine,
            otherZ:lerp(segment.a.z,segment.b.z,f),
            otherBridge:segment.a.bridge&&segment.b.bridge,
            otherTunnel:segment.a.tunnel&&segment.b.tunnel,segment,
            otherD:lerp(segment.stations[segment.j-1],segment.stations[segment.j],f),
          };
          if(!found.has(path.id))found.set(path.id,{path,hits:[]});
          const {hits}=found.get(path.id);
          if(!hits.some(prior=>Math.abs(prior.d-d)<.022&&Math.abs(prior.otherZ-candidate.otherZ)<.025))hits.push(candidate);
        }
      });
    }
    const crossings=[];
    for(const {path,hits} of found.values()){
      const groups=[];
      hits.sort((a,b)=>a.d-b.d);
      for(const hit of hits){
        const previous=groups.at(-1);
        // Parallel tracks and turnout branches form a single crossing through the same corridor.
        const skew=Math.max(.045,hit.sine);
        if(previous&&path.id.startsWith('rail:')&&hit.d-previous[0].d<1.4/skew&&
          hit.d-previous.at(-1).d<.88/skew){
          previous.push(hit);
        }else groups.push([hit]);
      }
      for(const [i,group] of groups.entries()){
        const d=(group[0].d+group.at(-1).d)/2;
        const {x,y,z}=sample(points,along,d),sine=Math.min(...group.map(p=>p.sine));
        const opening=(path.width+.16)/Math.max(.045,sine);
        const otherZ=group.reduce((sum,p)=>sum+p.otherZ,0)/group.length;
        const envelope=group.flatMap(hit=>{
          const {points}=hit.segment.path,{stations}=hit.segment;
          const reach=opening*Math.sqrt(1-hit.sine**2)+.16;
          return Array.from({length:7},(_,j)=>sample(points,stations,hit.otherD+reach*(j/3-1)).z);
        });
        const high=Math.max(...group.map(p=>p.otherZ)),low=Math.min(...group.map(p=>p.otherZ));
        crossings.push({x,y,z,d,sine,otherZ,id:path.id+'@'+i,name:path.name,
          left:group[0].d-opening,right:group.at(-1).d+opening,high,low,
          clearanceTop:Math.max(high,...envelope),clearanceBottom:Math.min(low,...envelope),
          levelZ:otherZ,
          over:group.every(p=>p.z-p.otherZ>=bridgeClearance-.002),
          under:group.every(p=>p.otherZ-p.z>=tunnelClearance-.002),
          otherBridge:group.every(p=>p.otherBridge),otherTunnel:group.every(p=>p.otherTunnel),
          options:[...treatments],issue:'',cost:0,
        });
      }
    }
    return crossings.sort((a,b)=>a.d-b.d||a.id.localeCompare(b.id));
  }

  function sample(points,along,d){
    let lo=0,hi=points.length-1;
    while(hi-lo>1){
      const mid=(lo+hi)>>1;
      if(along[mid]<=d)lo=mid;else hi=mid;
    }
    const a=points[lo],b=points[hi],f=clamp((d-along[lo])/(along[hi]-along[lo]||1),0,1);
    if(f<1e-7)return {...a};
    if(f>1-1e-7)return {...b};
    return {...(f<.5?a:b),x:lerp(a.x,b.x,f),y:lerp(a.y,b.y,f),z:lerp(a.z,b.z,f),
      dx:Number.isFinite(a.dx)&&Number.isFinite(b.dx)?lerp(a.dx,b.dx,f):undefined,
      dy:Number.isFinite(a.dy)&&Number.isFinite(b.dy)?lerp(a.dy,b.dy,f):undefined};
  }
  function terrainAt(valley,p){
    return (valley.designGround??valley.ground)?.(p.x,p.y)??p.z;
  }

  function hermite(from,to,start,end,fromGrade,toGrade){
    const span=to-from,delta=end-start;
    const a=-2*delta+span*(fromGrade+toGrade),b=3*delta-span*(2*fromGrade+toGrade);
    const slope=f=>(3*a*f*f+2*b*f)/span+fromGrade;
    const extrema=a?clamp(-b/(3*a),0,1):0;
    return {from,to,maxSlope:Math.max(Math.abs(slope(0)),Math.abs(slope(1)),Math.abs(slope(extrema))),
      at:d=>{const f=clamp((d-from)/span,0,1);return start+f*(span*fromGrade+f*(b+f*a));}};
  }
  function approach(points,along,edge,z,boundary,direction,maxSlope){
    const room=(boundary-edge)*direction;
    if(room<.02)return null;
    for(let extent=Math.min(.10,room);;extent=Math.min(room,extent*1.25+.08)){
      const join=edge+direction*extent;
      const base=sample(points,along,join).z;
      const outside=clamp(join+direction*.08,0,along.at(-1));
      const inside=clamp(join-direction*.08,0,along.at(-1));
      const slope=(sample(points,along,outside).z-sample(points,along,inside).z)/(outside-inside||1);
      const curve=direction<0?hermite(join,edge,base,z,slope,0):hermite(edge,join,z,base,0,slope);
      if(curve.maxSlope<=maxSlope+1e-6)return curve;
      if(extent>=room)return null;
    }
  }

  function design({mode,points,valley,heightScale=5/.23,choices={},excluded,startClearance=0,endClearance=0,maxGrade}){
    if(!points||points.length<2||!valley?.transport)return {points,crossings:[],issue:'',cost:0,maxGrade:0};
    const along=distances(points),length=along.at(-1);
    const limit=Number.isFinite(maxGrade)&&maxGrade>0?maxGrade:mode==='rail'?4:8;
    const allowed=limit*metresPerUnit/(heightScale*100);
    const crossings=findCrossings(points,along,opposingPaths(mode,valley,excluded));
    const planned=[];
    for(const crossing of crossings){
      const {id,high,low,levelZ,d}=crossing;
      const preference=choices instanceof Map?choices.get(id):choices?.[id];
      const selected=treatments.includes(preference);
      const choice=selected?preference:crossing.over?'bridge':crossing.under?'tunnel':'level';
      crossing.choice=choice;
      crossing.preserved=!selected&&(crossing.over||crossing.under);
      const structure=choice!=='level'&&!(crossing.preserved&&
        (choice==='bridge'?crossing.otherTunnel:crossing.otherBridge));
      crossing.structure=structure?choice:null;
      const levelPad=Math.min(.12,(d-crossing.left)*.5,(crossing.right-d)*.5);
      let left=choice==='level'?d-levelPad:crossing.left;
      let right=choice==='level'?d+levelPad:crossing.right;
      const samples=Array.from({length:7},(_,i)=>sample(points,along,lerp(left,right,i/6)));
      const ground=samples.map(p=>terrainAt(valley,p));
      let target=levelZ;
      if(choice==='bridge')target=Math.max(crossing.clearanceTop+bridgeClearance,...ground.map(z=>z+.085));
      if(choice==='tunnel')target=Math.min(crossing.clearanceBottom-tunnelClearance,...ground.map(z=>z-.25));
      crossing.targetZ=crossing.preserved?crossing.z:target;
      const wet=samples.some(p=>p.water||valley.wet?.(p.x,p.y));
      if(!crossing.preserved&&choice!=='level'&&crossing.sine<.045){
        crossing.issue='Cross at a steeper angle to leave room for a structure.';
      }else if(!crossing.preserved&&choice==='tunnel'&&wet){
        crossing.issue='Move this tunnel away from the water crossing.';
      }else if(!crossing.preserved&&choice==='level'&&(wet||high-low>.095)){
        crossing.issue=wet?'Use a bridge or change the alignment at this water crossing.':
          'The existing tracks cross at different heights. Choose a bridge or tunnel.';
      }
      if(crossing.issue)continue;
      const unchanged=choice==='level'&&Math.abs(crossing.z-target)<.006;
      const protectedGeometry=unchanged||crossing.preserved&&!structure;
      const lower=Math.max(0,startClearance),upper=length-Math.max(0,endClearance);
      if(protectedGeometry){left=Math.max(0,left);right=Math.min(length,right);}
      else if(left<lower-.001||right>upper+.001){
        crossing.issue='Move the crossing away from the station or alignment endpoint.';
        continue;
      }
      planned.push({crossings:[crossing],choice,structure:crossing.structure,left,right,target,
        preserved:unchanged||crossing.preserved});
    }

    const groups=[];
    for(const item of planned){
      const previous=groups.at(-1);
      const compatible=previous&&item.choice===previous.choice&&item.structure===previous.structure&&item.preserved===previous.preserved&&
        (item.choice!=='level'||Math.abs(item.target-previous.target)<.033);
      const allowance=compatible&&!item.preserved?Math.max(.25,1.2*Math.abs(item.target-previous.target)/allowed):0;
      if(compatible&&item.left<=previous.right+allowance){
        previous.right=Math.max(previous.right,item.right);
        if(item.choice==='level')previous.target=lerp(previous.target,item.target,1/(previous.crossings.length+1));
        else previous.target=item.choice==='bridge'?Math.max(item.target,previous.target):Math.min(item.target,previous.target);
        previous.crossings.push(...item.crossings);
      }else groups.push(item);
    }

    const profiles=[];
    for(const [i,item] of groups.entries()){
      const {left,right,target,preserved,structure,crossings:members}=item;
      if(preserved&&!structure)continue;
      const previous=groups[i-1],next=groups[i+1];
      const lower=previous?Math.max(startClearance,(previous.right+left)/2):startClearance;
      const upper=next?Math.min(length-endClearance,(right+next.left)/2):length-endClearance;
      const conflict=lower>left+.001||upper<right-.001;
      const a=!conflict&&!preserved?approach(points,along,left,target,lower,-1,allowed):null;
      const b=!conflict&&!preserved?approach(points,along,right,target,upper,1,allowed):null;
      if(conflict||(!preserved&&(!a||!b))){
        const issue=conflict?'Nearby crossings need compatible treatments or more space.':
          'There is not enough room for '+(structure==='bridge'?'bridge':structure==='tunnel'?'tunnel':'level-crossing')+
          ' approaches within the '+limit+'% grade limit.';
        for(const crossing of members)crossing.issue=issue;
        continue;
      }
      if(a&&b){
        const count=Math.ceil((b.to-a.from)/.16);
        const waterConflict=Array.from({length:count+1},(_,j)=>lerp(a.from,b.to,j/count)).some(d=>{
          const p=sample(points,along,d);
          const z=d<left?a.at(d):d>right?b.at(d):target;
          return z<.20-.001&&(p.water||valley.wet?.(p.x,p.y));
        });
        if(waterConflict){
          for(const crossing of members)crossing.issue='The approach would run below water clearance. Move the crossing or choose a bridge.';
          continue;
        }
      }
      const builtLength=(right-left)*metresPerUnit;
      const fixed=mode==='rail'?(structure==='bridge'?16000:23000):(structure==='bridge'?9500:15000);
      const rate=mode==='rail'?(structure==='bridge'?790:1170):(structure==='bridge'?500:770);
      const regional=valley.region==='mixed'?.32:1;
      const cost=structure?Math.round((fixed+builtLength*rate)*regional):0;
      members[0].cost=cost;
      profiles.push({...item,a,b,type:structure});
    }

    const boundaries=profiles.flatMap(item=>[item.left,item.right,item.a?.from,item.b?.to].filter(Number.isFinite));
    // Sampling the ramp also makes sparse paths usable by the scene and vehicle interpolators.
    for(const item of profiles)if(item.a&&item.b){
      const from=item.a.from,to=item.b.to,steps=Math.ceil((to-from)/.16);
      for(let i=1;i<steps;i++)boundaries.push(lerp(from,to,i/steps));
    }
    const all=profiles.length?[...along,...boundaries].sort((a,b)=>a-b).filter((d,i,list)=>!i||d-list[i-1]>.00001):along;
    const adjusted=profiles.length?all.map(d=>{
      const p={...sample(points,along,d),d};
      if(Number.isFinite(p.ground))p.ground=terrainAt(valley,p);
      if(p.water!==undefined)p.water=valley.wet?.(p.x,p.y)??p.water;
      const profile=profiles.find(item=>d>=(item.a?.from??item.left)-1e-7&&d<=(item.b?.to??item.right)+1e-7);
      if(!profile)return p;
      const isStructure=profile.type&&d>=profile.left-1e-7&&d<=profile.right+1e-7;
      if(!profile.preserved){
        const proposed=d<profile.left?profile.a.at(d):d>profile.right?profile.b.at(d):profile.target;
        if(!isStructure&&Math.abs(p.z-proposed)>1e-6)p.gradeApproach=profile.crossings[0].id;
        p.z=proposed;
      }
      if(isStructure){
        p.bridge=profile.type==='bridge';
        p.tunnel=profile.type==='tunnel';
        p.gradeSeparation=profile.crossings[0].id;
      }
      return p;
    }):points;
    let grade=0;
    const sampled=profiles.length?all:along;
    for(let i=1;i<adjusted.length;i++){
      const run=sampled[i]-sampled[i-1];
      if(run>.000001)grade=Math.max(grade,Math.abs(adjusted[i].z-adjusted[i-1].z)*heightScale*100/(metresPerUnit*run));
    }
    for(const crossing of crossings){
      crossing.z=sample(adjusted,sampled,crossing.d).z;
    }
    return {points:adjusted,crossings,cost:crossings.reduce((sum,crossing)=>sum+crossing.cost,0),
      issue:crossings.find(crossing=>crossing.issue)?.issue??'',maxGrade:grade};
  }
  window.ContourGradeSeparation={design};
})();
