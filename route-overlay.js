(() => {
  'use strict';
  const colors=['#f2c16d','#9de2df','#dbb5fa','#f2a79c','#b7e88c'];
  const clamp=(value,low,high)=>Math.min(high,Math.max(low,value));
  const interpolate=(a,b,t)=>({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,z:a.z+(b.z-a.z)*t});

  function sharedSegments(paths){
    const bins=new Map();
    const rows=paths.map((path,index)=>{
      const segments=[];
      for(let i=1;i<path.length;i++){
        const a=path[i-1],b=path[i],length=Math.hypot(b.x-a.x,b.y-a.y);
        if(length<1e-5)continue;
        const count=Math.ceil(length/.18);
        for(let n=0;n<count;n++){
          const start=interpolate(a,b,n/count),end=interpolate(a,b,(n+1)/count);
          const middle=interpolate(start,end,.5);
          const segment={index,start,end,middle,dx:(b.x-a.x)/length,dy:(b.y-a.y)/length};
          const key=Math.floor(middle.x)+','+Math.floor(middle.y);
          if(!bins.has(key))bins.set(key,[]);
          bins.get(key).push(segment);
          segments.push(segment);
        }
      }
      return segments;
    });
    return rows.map(segments=>segments.map(segment=>{
      const {middle,dx,dy,index}=segment,others=new Map();
      const cx=Math.floor(middle.x),cy=Math.floor(middle.y);
      for(let y=cy-1;y<=cy+1;y++)for(let x=cx-1;x<=cx+1;x++){
        for(const candidate of bins.get(x+','+y)??[]){
          if(candidate.index===index||Math.abs(dx*candidate.dx+dy*candidate.dy)<.95)continue;
          const {start,end}=candidate;
          const length=Math.hypot(end.x-start.x,end.y-start.y);
          const t=((middle.x-start.x)*candidate.dx+(middle.y-start.y)*candidate.dy)/length;
          if(t<-.10||t>1.10)continue;
          const p=interpolate(start,end,clamp(t,0,1));
          const distance=Math.hypot(middle.x-p.x,middle.y-p.y);
          if(distance>.075||Math.abs(p.z-middle.z)>.043||distance>=(others.get(candidate.index)?.distance??Infinity))continue;
          others.set(candidate.index,{candidate,distance});
        }
      }
      const group=[index,...others.keys()].sort((a,b)=>a-b);
      const anchor=others.get(group[0])?.candidate??segment;
      return {...segment,group,side:dx*anchor.dx+dy*anchor.dy<0?-1:1};
    }));
  }

  function layout(groups,project){
    return groups.map((segments,index)=>{
      const lines=segments.map(segment=>{
        const a=project(segment.start),b=project(segment.end);
        const dx=b[0]-a[0],dy=b[1]-a[1],length=Math.hypot(dx,dy)||1;
        const {group,side}=segment;
        const offset=(group.indexOf(index)-(group.length-1)/2)*6.5*side;
        return {a,b,group,offset:[-dy/length*offset,dx/length*offset]};
      });
      const points=[];
      for(let i=0;i<=lines.length&&lines.length;i++){
        const before=lines[i-1],after=lines[i];
        const [x,y]=after?.a??before.b;
        const first=before?.offset??after.offset,last=after?.offset??before.offset;
        points.push([x+(first[0]+last[0])/2,y+(first[1]+last[1])/2]);
      }
      return {index,points,lines,badges:[]};
    });
  }

  function railLayout(run,index,project){
    const paths=[],segments=[];
    for(const block of run?.blocks??[]){
      const directions=ContourRail.runningLane(block,0)===ContourRail.runningLane(block,1)?[0]:[0,1];
      for(const from of directions){
        const points=ContourRail.serviceRail(block,from).map(project);
        if(points.length<2)continue;
        paths.push({points,dashed:from===1});
        for(let i=1;i<points.length;i++)segments.push([points[i-1],points[i]]);
      }
    }
    return {index,paths,segments,lines:[],badges:[]};
  }
  function segmentDistance(x,y,a,b){
    const dx=b[0]-a[0],dy=b[1]-a[1],length=dx*dx+dy*dy;
    const t=length?clamp(((x-a[0])*dx+(y-a[1])*dy)/length,0,1):0;
    return Math.hypot(x-a[0]-dx*t,y-a[1]-dy*t);
  }
  function pick(hits,[x,y]){
    for(let i=hits.length-1;i>=0;i--){
      const hit=hits[i];
      if(hit.badges.some(b=>Math.abs(x-b.x)<=b.w/2+5&&Math.abs(y-b.y)<=13))return [hit.index];
    }
    let best=13,group=[];
    for(const hit of hits)for(const [i,line] of hit.lines.entries()){
      const offsetDistance=segmentDistance(x,y,hit.points[i],hit.points[i+1]);
      const distance=line.group.length>1?Math.min(offsetDistance,segmentDistance(x,y,line.a,line.b)):offsetDistance;
      if(distance<best){best=distance;group=line.group;}
    }
    const railDistances=hits.filter(hit=>hit.segments?.length).map(hit=>({
      index:hit.index,distance:hit.segments.reduce((min,[a,b])=>Math.min(min,segmentDistance(x,y,a,b)),13),
    }));
    const nearest=Math.min(13,...railDistances.map(rail=>rail.distance));
    if(nearest<13&&nearest<=best){
      return railDistances.filter(rail=>rail.distance<13&&rail.distance<nearest+1.25).map(rail=>rail.index);
    }
    return group;
  }

  window.ContourRouteOverlay={sharedSegments,layout,railLayout,pick,color:index=>colors[index%colors.length]};
})();
