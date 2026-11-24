(() => {
  'use strict';
  const cellSize=4,verticalClearance=.15,roadBuffer=.40,railBuffer=.27;
  function eachCell(a,b,visit){
    for(let x=Math.floor(Math.min(a.x,b.x)/cellSize);x<=Math.floor(Math.max(a.x,b.x)/cellSize);x++){
      for(let y=Math.floor(Math.min(a.y,b.y)/cellSize);y<=Math.floor(Math.max(a.y,b.y)/cellSize);y++)visit(x+':'+y);
    }
  }
  function segmentCrossing(road,rail){
    const {a,b,key}=road,{a:c,b:d}=rail;
    const ux=b.x-a.x,uy=b.y-a.y,vx=d.x-c.x,vy=d.y-c.y;
    const cross=ux*vy-uy*vx,x=c.x-a.x,y=c.y-a.y;
    if(Math.abs(cross)<1e-9)return null;
    const t=(x*vy-y*vx)/cross,f=(x*uy-y*ux)/cross;
    if(t< -1e-8||t>1+1e-8||f< -1e-8||f>1+1e-8)return null;
    if(Math.abs(a.z+(b.z-a.z)*t-c.z-(d.z-c.z)*f)>=verticalClearance)return null;
    const sine=Math.abs(cross)/(Math.hypot(ux,uy)*Math.hypot(vx,vy));
    return {road:road.route,railFrom:rail.from,roadAt:a[key]+(b[key]-a[key])*t,
      railAt:c.length+(d.length-c.length)*f,roadWidth:roadBuffer/Math.max(.25,sine),
      railWidth:railBuffer/Math.max(.25,sine)};
  }
  function build(roads,rails){
    const bins=new Map(),byRoad=new Map(),byRail=new Map();
    if(!roads.length||!rails.length)return {byRoad,byRail};
    for(const {route,path,key} of roads){
      for(let i=1;i<path.length;i++){
        const a=path[i-1],b=path[i],segment={a,b,key,route};
        eachCell(a,b,cell=>{
          if(!bins.has(cell))bins.set(cell,[]);
          bins.get(cell).push(segment);
        });
      }
    }
    for(const {route,path,from} of rails){
      const found=byRail.get(route)??[];
      for(let i=1;i<path.length;i++){
        const a=path[i-1],b=path[i];
        eachCell(a,b,cell=>{
          for(const road of bins.get(cell)??[]){
            const crossing=segmentCrossing(road,{a,b,from});
            if(!crossing||found.some(other=>other.road===crossing.road&&other.railFrom===from&&
              Math.abs(other.roadAt-crossing.roadAt)<.04&&Math.abs(other.railAt-crossing.railAt)<.04))continue;
            found.push(crossing);
            if(!byRoad.has(road.route))byRoad.set(road.route,[]);
            byRoad.get(road.route).push(crossing);
          }
        });
      }
      if(found.length)byRail.set(route,found);
    }
    return {byRoad,byRail};
  }
  window.ContourCrossings={build};
})();
