// Generation and cargo compatibility shared by the map, economy, and route planner.
(()=>{
'use strict';
const bounds={west:-126,east:126,north:-77,south:77};
const names={valley:'Green Valley',western:'Red Mesa',swamp:'Cypress Wetlands'};
const goods={
  timber:['Timber',8,0,248],stone:['Stone',6,0,205],fish:['Fish',7,0,210],
  peat:['Peat',5,0,180],flour:['Flour',7,3,260],bricks:['Bricks',5,3,265],
  furniture:['Furniture',4,3,330],steel:['Steel',5,3,330],copper:['Copper',4,3,320],
  grain:['Grain',0,0,185],clay:['Clay',0,0,170],iron:['Iron ore',0,0,195],
  copperOre:['Copper ore',0,0,195],coal:['Coal',0,0,175],reeds:['Reeds',0,0,175],
  fabric:['Fabric',0,0,228],logs:['Logs',0,0,180],boards:['Boards',6,3,245],
  produce:['Produce',7,0,195],fuel:['Fuelwood',5,0,184],pine:['Pine logs',0,0,200],
  joinery:['Pine frames',0,0,290],kaolin:['Kaolin',0,0,215],ceramics:['Ceramics',4,3,315],
  insulation:['Reed insulation',0,0,280],transit:['Transit kits',5,5,535],power:['Power equipment',5,5,565]
};
const roster=[
  // Outputs with inputs are recipes. Each input quantity is per load produced.
  ['sawmill','Valley Sawmill','valley',8,5,null,'timber',{},12],
  ['grain','Prairie Grain Farm','western',-58,-53,'Grain farm','grain',{},16],
  ['quarry','Mesa Stone Quarry','western',-107,-8,'Stone quarry','stone',{},16],
  ['clay','Red Clay Pit','western',-52,-19,'Clay pit','clay',{},14],
  ['brick','Canyon Brickworks','western',-62,5,'Brick maker','bricks',{clay:1},12],
  ['iron','Iron Ridge Mine','western',-105,13,'Iron mine','iron',{},14],
  ['copper','Copper Crown Mine','western',-105,36,'Copper mine','copperOre',{},14],
  ['coal','Black Rock Colliery','western',-109,-29,'Coal mine','coal',{},18],
  ['steel','Mesa Smelter','western',-71,-2,'Smelter','steel',{iron:1,coal:1},10],
  ['foundry','Copper Foundry','western',-72,18,'Smelter','copper',{copperOre:1,coal:1},10],
  ['flour','Prairie Flour Mill','western',-48,40,'Flour mill','flour',{grain:1},14],
  ['furniture','Valley Furniture Works','valley',-23,5,'Woodworking shop','furniture',{boards:1,fabric:1},10],
  ['fish','Backwater Fishery','swamp',101,1,'Stilt fishery','fish',{},16],
  ['reeds','Cypress Reed Depot','swamp',64,1,'Reed harvest depot','reeds',{},14],
  ['fabric','Reed Weavers','swamp',77,14,'Reed harvest depot','fabric',{reeds:1},10],
  ['peat','Blackwater Peat Yard','swamp',116,-12,'Peat cutting yard','peat',{},15],
  ['logs','Cypress Logging Camp','swamp',114,47,'Marsh sawmill','logs',{},16],
  ['boards','Marsh Sawmill','swamp',52,-16,'Marsh sawmill','boards',{logs:1},12]
];
const advanced=[
  ['pine','Valley Pine Camp','valley',15,-28,'Marsh sawmill','pine',{},16,'swampIndustry'],
  ['frames','Valley Frame Mill','valley',-10,-7,'Woodworking shop','joinery',{pine:1},12],
  ['kaolin','Chalk Ridge Pit','valley',21,15,'Clay pit','kaolin',{},16],
  ['ceramics','Valley Ceramic Works','valley',18,30,'Brick maker','ceramics',{kaolin:1},12],
  ['insulation','Fen Insulation Works','swamp',69,27,'Reed harvest depot','insulation',{reeds:1},12,'swampIndustry'],
  ['transit','Regional Transit Works','valley',19,-7,'Woodworking shop','transit',{joinery:1,steel:1,fabric:1},12],
  ['power','Regional Power Works','valley',22,-48,'Smelter','power',{ceramics:1,copper:1,insulation:1},12]
];
const starter=[
  ['produce','Produce Farm','Grain farm','industry'],
  ['stone','Stone Yard','Stone quarry','industry'],
  ['fuel','Woodlot','Marsh sawmill','swampIndustry']
];
const starterByTown={
  millbank:['produce','timber'],alderbrook:['stone','fuel'],eastmere:['produce','stone'],
  mesa:['produce','fuel'],willow:['fish','produce'],mire:['fish','peat']
};
const levelThreeByTown={
  millbank:['flour','furniture'],alderbrook:['bricks','steel'],eastmere:['flour','boards'],
  mesa:['bricks','copper'],willow:['boards','ceramics'],mire:['furniture','ceramics']
};
const levelFiveGoods=Object.keys(goods).filter(id=>goods[id][2]===5&&goods[id][1]>0);
function acceptsTownCargo(town,cargo){
  const good=goods[cargo];
  if(!good?.[1]||!town.starterGoods)return Boolean(good?.[1]);
  if(good[2]===0)return town.starterGoods.includes(cargo);
  if(good[2]===3)return (levelThreeByTown[town.id]??levelThreeByTown.millbank).includes(cargo);
  return true;
}
function townWeeklyDemand(town,cargo,level,homeCount,reachableHomes=homeCount){
  if(!homeCount)return 0;
  if(!town.starterGoods)return cargo==='timber'?Math.min(homeCount,reachableHomes):0;
  const active=[...town.starterGoods];
  if(level>=3)active.push(...(levelThreeByTown[town.id]??levelThreeByTown.millbank));
  if(level>=5)active.push(...levelFiveGoods);
  const index=active.indexOf(cargo);
  if(index<0)return 0;
  const total=homeCount*2; // Four residents per home, half a load per resident across all goods.
  const demand=Math.floor(total/active.length)+(index<total%active.length?1:0);
  return Math.ceil(demand*Math.min(1,reachableHomes/homeCount));
}
function trades(a,b,{allowFormerDemand=false}={}){
  if(!a||!b||a.id===b.id)return [];
  if(!a.output&&!b.output&&!a.depot&&!b.depot)return [{cargo:'passengers',from:a,to:b}];
  const options=[];
  for(const [from,to] of [[a,b],[b,a]]){
    const cargoes=from.depot?from.cargos:from.output?[from.output]:[];
    for(const cargo of cargoes){
      const accepts=to.depot?to.cargos.includes(cargo):to.output?to.inputs[cargo]:
        allowFormerDemand?goods[cargo]?.[1]:acceptsTownCargo(to,cargo);
      if(accepts)options.push({cargo,from,to});
    }
  }
  return options;
}
const trade=(a,b,cargo,from,options)=>trades(a,b,options).find(option=>
  (!cargo||cargo===option.cargo)&&(!from||from===option.from.id))??null;
const mix=(a,b,t)=>a+(b-a)*t;
function ease(t){t=Math.min(1,Math.max(0,t));return t*t*(3-2*t);}
function seeded(seed){
  let state=seed>>>0;
  return ()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};
}
function generate(seed,step){
  const random=seeded(seed);
  const [a,b,c,d]=Array.from({length:4},()=>random()*Math.PI*2);
  const riverX=y=>6.5*Math.sin(y*.067+a)+2.6*Math.sin(y*.143+b)-.09*y;
  const riverWidth=y=>1.7+.46*Math.sin(y*.089+c)+.40*ease((y+77)/154);
  function channels(y){
    return [
      [riverX(y),riverWidth(y),'valley'],
      [51+8*Math.sin(y*.065+b)+4*Math.sin(y*.14+c),3.1+1.5*Math.sin(y*.074+a)**2,'swamp'],
      [79+10*Math.sin(y*.063+a)+3*Math.sin(y*.15+d),4.7+3.5*Math.sin(y*.043+c)**4,'swamp'],
      [108+8*Math.sin(y*.074+d),4.0+2.2*Math.sin(y*.099+a)**2,'swamp']
    ];
  }
  function waterEdge(x,y){
    let distance=Infinity;
    for(const [center,width] of channels(y))distance=Math.min(distance,Math.abs(x-center)-width);
    return distance;
  }
  const wet=(x,y,margin=0)=>waterEdge(x,y)<margin;
  const westernEdge=y=>-43+4.0*Math.sin(y*.073+a)+1.6*Math.sin(y*.18+c);
  const swampEdge=y=>39+4.5*Math.sin(y*.067+b)+1.4*Math.cos(y*.182+d);
  const biome=(x,y)=>x<westernEdge(y)?'western':x>swampEdge(y)?'swamp':'valley';
  function biomeMix(x,y){
    return [ease((westernEdge(y)-x+5)/10),ease((x-swampEdge(y)+5)/10)];
  }
  function natural(x,y){
    const bank=waterEdge(x,y);
    if(bank<=0)return 0;
    const grass=.82+.37*Math.sin(x*.094+y*.071+a)+.25*Math.cos(y*.13-x*.058+b)+.18*Math.sin(x*.14+y*.20+d);
    const mesa=1.65+1.20*ease((Math.sin(x*.057+y*.038+c)+.78*Math.cos(y*.073+d)+.55)/1.35)
      +.55*ease((Math.sin(y*.103-x*.033+a)+.14)/.65);
    const gorgeY=-12+15*Math.sin((x+95)*.055+b)+4.7*Math.sin(x*.139+c);
    const canyon=Math.abs(y-gorgeY);
    const tributary=Math.abs(y-(37+13*Math.sin(x*.076+d)));
    const mesaCut=mix(.48,mesa,ease((canyon-3.0)/5.2))*mix(.62,1,ease((tributary-1.2)/3.9));
    const bog=.34+.17*Math.sin(x*.14+y*.073+a)+.12*Math.cos(y*.11-x*.059+d);
    const high=mix(mix(grass,mesaCut,ease((-x-35)/20)),bog,ease((x-29)/24));
    return Math.max(.095,mix(.095,high,ease(bank/(x>39?3.2:2.0))));
  }
  const pads=[];
  function nearbyWater(x,y,r,margin=.8){
    if(wet(x,y,margin))return true;
    for(let j=-r;j<=r;j+=2)for(let i=-r;i<=r;i+=2)if(wet(x+i,y+j,margin))return true;
    return [[-r,-r],[r,r],[r,-r],[-r,r]].some(([dx,dy])=>wet(x+dx,y+dy,margin));
  }
  function choose(tx,ty,zone,r,separated){
    let best=null,score=Infinity;
    for(let y=Math.max(bounds.north+r+2,ty-35);y<=Math.min(bounds.south-r-2,ty+35);y+=1.65){
      for(let x=Math.max(bounds.west+r+2,tx-43);x<=Math.min(bounds.east-r-2,tx+43);x+=1.65){
        if(biome(x,y)!==zone||nearbyWater(x,y,r)||!separated(x,y))continue;
        const here=natural(x,y);
        const slope=Math.abs(here-natural(x+r*.55,y))+Math.abs(here-natural(x,y+r*.55));
        const value=Math.hypot(x-tx,y-ty)+slope*8+random()*1.7;
        if(value<score){score=value;best={x,y,z:Math.max(step*(zone==='swamp'?3:2),Math.floor(here/step)*step)};}
      }
    }
    return best;
  }
  const specs=[
    ['millbank','Millbank','High street','valley',-19,49],
    ['alderbrook','Alderbrook','Market ring','valley',-25,-49],
    ['eastmere','Eastmere','High street','western',-90,-49],
    ['mesa','Redwater','Market ring','western',-89,50],
    ['willow','Willow Reach','High street','swamp',64,-47],
    ['mire','Mire Landing','Market ring','swamp',94,49]
  ];
  const towns=[];
  for(const [id,name,pattern,zone,x,y] of specs){
    const site=choose(x,y,zone,8.6,(x,y)=>towns.every(t=>Math.hypot(x-t.x,y-t.y)>49));
    if(!site)return null;
    towns.push({...site,id,name,pattern,biome:zone,starterGoods:starterByTown[id]});
    pads.push({...site,inner:8.0,outer:15.0});
  }
  const industries=[];
  for(const [id,name,zone,x,y,asset,output,inputs,limit] of roster){
    const minimum=id==='sawmill'?33:29;
    const site=choose(x,y,zone,3.55,(x,y)=>towns.every(t=>Math.hypot(x-t.x,y-t.y)>=minimum)&&
      industries.every(t=>Math.hypot(x-t.x,y-t.y)>=9.2));
    if(!site)return null;
    const model=['fish','reeds','fabric','peat','logs','boards'].includes(id)?'swampIndustry':'industry';
    industries.push({...site,id,name,biome:zone,asset,model,output,inputs,limit,halfWidth:1.60,halfDepth:1.38,apron:1.07});
    pads.push({...site,inner:3.8,outer:6.0});
  }
  function addSite(site,id,name,zone,asset,model,output,inputs,limit){
    const place={...site,id,name,biome:zone,asset,model,output,inputs,limit,halfWidth:1.60,halfDepth:1.38,apron:1.07};
    industries.push(place);
    pads.push({...site,inner:3.8,outer:6.0});
    return place;
  }
  const separated=(x,y)=>industries.every(site=>Math.hypot(x-site.x,y-site.y)>=8);
  for(const town of towns){
    const options=town.biome==='swamp'?
      [['fish','Fishery','Stilt fishery','swampIndustry'],['peat','Peat Yard','Peat cutting yard','swampIndustry'],starter[0]]:starter;
    options.forEach(([output,name,asset,model],index)=>{
      const angle=(index/3)*Math.PI*2+random()*.45;
      const distance=(x,y)=>Math.hypot(x-town.x,y-town.y);
      const ideal=23;
      const site=choose(town.x+Math.cos(angle)*ideal,town.y+Math.sin(angle)*ideal,town.biome,3.05,
        (x,y)=>distance(x,y)>=14&&distance(x,y)<=27&&separated(x,y)&&towns.every(other=>other===town||
          Math.hypot(other.x-x,other.y-y)>=14));
      const nearby=site??choose(town.x,town.y,town.biome,3.05,
        (x,y)=>distance(x,y)>=14&&distance(x,y)<=32&&separated(x,y));
      if(nearby)addSite(nearby,town.id+'-'+output,town.name+' '+name,town.biome,asset,model,output,{},14);
    });
  }
  for(const [id,name,zone,x,y,asset,output,inputs,limit,model='industry'] of advanced){
    const site=choose(x,y,zone,3.55,(px,py)=>separated(px,py)&&
      towns.every(t=>Math.hypot(px-t.x,py-t.y)>=15));
    if(!site)return null;
    addSite(site,id,name,zone,asset,model,output,inputs,limit);
  }
  const depotPad=choose(18,48,'valley',3.55,(x,y)=>separated(x,y)&&towns.every(t=>Math.hypot(x-t.x,y-t.y)>=14));
  if(!depotPad)return null;
  const depot={...depotPad,id:'exchange',name:'Continental Exchange',biome:'valley',depot:true,
    asset:'Freight shed',model:'westernBuilding',cargos:Object.keys(goods),limit:48,halfWidth:1.60,halfDepth:1.38,apron:1.07};
  pads.push({...depotPad,inner:3.8,outer:6.0});
  function raw(x,y){
    let height=natural(x,y);
    if(height===0)return 0;
    for(const {x:px,y:py,z,inner,outer} of pads){
      if(Math.abs(x-px)>=outer||Math.abs(y-py)>=outer)continue;
      const distance=Math.hypot(x-px,y-py);
      if(distance<outer)height=mix(z+step*.1,height,ease((distance-inner)/(outer-inner)));
    }
    return height;
  }
  const ground=(x,y)=>Math.floor((raw(x,y)+1e-8)/step)*step;
  const designGround=(x,y)=>Math.max(0,raw(x,y)-step*.5);
  const grove=[];
  for(let i=0;i<1000&&grove.length<420;i++){
    const x=mix(bounds.west+2,bounds.east-2,random()),y=mix(bounds.north+2,bounds.south-2,random());
    if(towns.some(t=>Math.hypot(x-t.x,y-t.y)<14)||industries.some(t=>Math.hypot(x-t.x,y-t.y)<5))continue;
    const bank=waterEdge(x,y),zone=biome(x,y);
    if(zone==='swamp'?bank< -2.1:bank<1.0)continue;
    grove.push([x,y,.65+.52*random(),0,bank]);
  }
  return {seed,region:'mixed',towns,industries,industry:industries[0],publicDepots:[depot],bounds,riverX,riverWidth,channels,wet,ground,designGround,grove,biome,biomeMix};
}
window.ContourRegion={generate,trade,trades,acceptsTownCargo,townWeeklyDemand,names,goods,bounds};
})();
