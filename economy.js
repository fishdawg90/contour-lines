// Quantities are whole loads or passengers. Coordinates are 40 metres per map unit.
window.contourStationKey=station=>station.mode==='rail'&&station.id?'rail:'+station.id:[station.x,station.y,station.z].join(':');
window.ContourEconomy = function(valley) {
  const data=valley.transport;
  const startingCash={relaxed:3000000,standard:2000000,hard:1250000};
  const state=data.market??={cash:startingCash[data.difficulty]??startingCash.standard,stock:0,orders:{},received:{}};
  const radius=7, fare=480, vehiclePrice=6000, stockLimit=96, weekSeconds=15;
  const millUpgradeDemand=60;
  const runningCostMultiplier=1.5;
  const truckCapacity=4, busCapacity=8, startupWeeks=1;
  const rail=window.ContourRail,isRail=route=>route.mode==='rail';
  const equipmentQuotes=new WeakMap();
  let crossingGeometry,crossingRuns,crossingLocal=[];
  const noCrossingLimit={roadLimit:()=>Infinity,trainLimit:()=>Infinity};
  function railCargo(route){return routeTrade(route)?.cargo??route.cargo??'passengers';}
  function railQuote(route,vehicle){
    const cargo=railCargo(route);
    if(!vehicle)return rail.quote(rail.defaultConsist(cargo),cargo);
    vehicle.consist??=rail.defaultConsist(cargo);
    const cached=equipmentQuotes.get(vehicle.consist);
    if(cached?.cargo===cargo)return cached.quote;
    const quote=rail.quote(vehicle.consist,cargo);
    equipmentQuotes.set(vehicle.consist,{cargo,quote});
    return quote;
  }
  function railRunningCost(consist){
    return (62+consist.locomotives.length*31+consist.cars.length*8)*runningCostMultiplier;
  }
  function fitsPlatforms(route,quote){
    return route.stations.every(station=>quote.length<=(station.platformLength??2.4)*rail.metresPerUnit+1e-6);
  }
  function railState(vehicle){
    return vehicle.rail??={from:0,distance:0,speed:0,dwell:0,active:false};
  }
  function vehicleSide(route,vehicle,run){
    return isRail(route)?railState(vehicle).from:vehicle.phase>=run.travel+bayTime?1:0;
  }
  function vehicleCapacity(route,vehicle){
    return isRail(route)?railQuote(route,vehicle).capacity:isFreight(route)?truckCapacity:busCapacity;
  }
  const previous=state.version!==2;
  if(previous){
    Object.assign(state,{version:2,week:0,weekTime:0,stock:0,timber:{},connections:{},orders:{},
      mill:{level:1,credits:0,produced:0,goodMonths:0,monthUsed:0,lastMonth:0},
      finance:{history:[],current:{revenue:0,operating:0,capital:0}}});
  }
  state.mill.uncollectedWeeks??=0;
  state.mill.pickedUpThisWeek??=0;
  const financeArchive=state.finance.archive??=[];
  const serviceHistory=state.serviceHistory??={
    firstMonth:Math.ceil((state.week+(state.weekTime>0?1:0))/4),months:[],localTrips:{}
  };
  const migratePassengers=!state.passengerStops;
  state.passengerStops??={};
  const receipts=new WeakMap(),localRoutes=data.localRoutes??=[];
  const townNetwork=window.ContourTown;
  const mill=valley.industry;
  const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
  const industries=valley.industries??[mill];
  for(const depot of valley.publicDepots??[])depot.cargos=data.depotCargo?.[depot.id]??depot.cargos;
  const depots=()=>[...(valley.publicDepots??[]),...(data.depots??[])];
  let locationCount=-1,locationList,byPlace;
  function places(){
    const count=data.depots?.length??0;
    if(count!==locationCount){
      locationCount=count;
      locationList=[...valley.towns,...industries,...depots()];
      byPlace=new Map(locationList.map(place=>[place.id,place]));
    }
    return locationList;
  }
  const isIndustry=place=>Boolean(place&&(place===mill||place.output||place.depot));
  const trade=(a,b,cargo,from)=>valley.region==='mixed'?ContourRegion.trade(a,b,cargo,from):
    a&&b&&a!==b?(a===mill||b===mill)?
      {cargo:'timber',from:mill,to:a===mill?b:a}:{cargo:'passengers',from:a,to:b}:null;
  const trades=(a,b)=>valley.region==='mixed'?ContourRegion.trades(a,b):[trade(a,b)].filter(Boolean);
  const routeTrades=new WeakMap();
  function routeTrade(route){
    if(route.local)return null;
    const cached=routeTrades.get(route);
    if(cached&&cached.stations===route.stations&&cached.cargo===route.cargo&&cached.from===route.cargoFrom)return cached.plan;
    const [a,b]=route.stations.map(source);
    const plan=trade(a,b,route.cargo,route.cargoFrom)??(valley.region&&ContourRegion.trade(a,b,route.cargo,route.cargoFrom,{allowFormerDemand:true}));
    routeTrades.set(route,{stations:route.stations,cargo:route.cargo,from:route.cargoFrom,plan});
    return plan;
  }
  const formerDemand=plan=>Boolean(plan&&plan.cargo!=='passengers'&&!isIndustry(plan.to)&&
    !ContourRegion.acceptsTownCargo(plan.to,plan.cargo));
  const freight=valley.region==='mixed'?ContourFreight({state,industries,homes,level:city=>state.received[city.id]?.expansion??0,weekSeconds}):null;
  function depotCargoLocked(depot,cargo){
    const inventory=freight.storage(depot,cargo);
    return inventory.stock>0||inventory.inbound>0||data.routes.some(route=>{
      const plan=routeTrade(route);
      return plan?.cargo===cargo&&(plan.from===depot||plan.to===depot);
    });
  }
  function setDepotCargo(depot,cargo,enabled){
    if(!enabled&&depotCargoLocked(depot,cargo))return false;
    depot.cargos=enabled?[...new Set([...depot.cargos,cargo])]:depot.cargos.filter(item=>item!==cargo);
    (data.depotCargo??={})[depot.id]=depot.cargos;
    return true;
  }
  const isFreight=route=>route.local?route.local==='delivery':Boolean(routeTrade(route)&&routeTrade(route).cargo!=='passengers');
  function source(s){
    const all=places();
    return byPlace.get(s.place)||all.find(t=>t.name===s.name)||
      all.filter(t=>distance(t,s)<radius).sort((a,b)=>distance(a,s)-distance(b,s))[0];
  }
  function homes(city){
    return city.lots.filter(l=>city.built.has(l.id)&&!data.removedLots.includes(city.id+':'+l.id));
  }
  function orders(city,lot){
    return state.orders[city.id+':'+lot.id]??={};
  }
  function timberMarket(city){
    return state.timber[city.id]??={stock:0,inbound:0,used:0,monthUsed:0,monthDemand:0,lastUsed:0,lastDemand:0,goodMonths:0};
  }
  function passengerStop(city){
    return state.passengerStops[city.id]??={waiting:0,inbound:0,visits:0,lastWeek:0};
  }
  function weeklyVisits(city){return Math.max(1,Math.ceil(homes(city).length*.5));}
  function passengerBuffer(city){return weeklyVisits(city)*2;}
  const people=state.travellers??={};
  const stationKey=s=>townNetwork.stationKey(s);
  const clock=()=>state.week*weekSeconds+state.weekTime;
  function sidewalkPath(graph,lot,anchor,destination){
    const street=graph.sidewalkRoute(lot,anchor);
    const home={x:lot.x,y:lot.y,z:lot.z??street[0]?.z??0};
    const path=[home];
    if(street.length>1){
      const directions=street.slice(1).map((p,i)=>{
        const a=street[i],length=distance(a,p);
        return {x:(p.x-a.x)/length,y:(p.y-a.y)/length};
      });
      const first=directions[0],origin=street[0];
      const side=Math.sign(first.x*(home.y-origin.y)-first.y*(home.x-origin.x))||1;
      for(const [i,p] of street.entries()){
        const a=directions[Math.max(0,i-1)],b=directions[Math.min(i,directions.length-1)];
        const dot=a.x*b.x+a.y*b.y;
        const offset=.187*side/Math.max(1.25,1+dot);
        path.push({x:p.x-(a.y+b.y)*offset,y:p.y+(a.x+b.x)*offset,z:p.z+.022});
      }
    }else if(street.length){
      const p=street[0],length=distance(home,p)||1;
      path.push({x:p.x+(home.x-p.x)/length*.187,y:p.y+(home.y-p.y)/length*.187,z:p.z+.022});
    }
    if(distance(anchor,destination)>.25){
      const dx=destination.x-anchor.x,dy=destination.y-anchor.y,length=Math.hypot(dx,dy);
      const edge=path.at(-1),side=Math.sign(dx*(edge.y-anchor.y)-dy*(edge.x-anchor.x))||1;
      path.push({x:anchor.x-dy/length*.187*side,y:anchor.y+dx/length*.187*side,z:anchor.z+.022});
      path.push({x:destination.x-dy/length*.187*side,y:destination.y+dx/length*.187*side,z:destination.z});
    }
    path.push(destination);
    return path;
  }
  function startWalk(person,city,lot,anchor,destination){
    const graph=townNetwork.getGraph(valley,city);
    const path=sidewalkPath(graph,lot,anchor,destination);
    let length=0;
    const points=path.map((point,i)=>{
      if(i)length+=distance(path[i-1],point);
      return {x:point.x,y:point.y,z:point.z??0,distance:length};
    });
    person.walk={sidewalk:true,points,start:clock(),duration:Math.max(.5,length*2.1),queue:person.queue};
    delete person.queue;
  }
  function walkPosition(person){
    const walk=person.walk,points=walk.points,total=points.at(-1).distance;
    const progress=Math.min(1,(clock()-walk.start)/walk.duration)*total;
    const index=points.findIndex((p,i)=>i>0&&p.distance>=progress);
    const a=points[Math.max(0,index-1)],b=points[index]??points.at(-1);
    const t=(progress-a.distance)/(b.distance-a.distance||1);
    return {x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,z:a.z+(b.z-a.z)*t+.035,yaw:Math.atan2(b.y-a.y,b.x-a.x)};
  }
  function joinQueue(person,key,city=person.origin){
    person.queue=key;
    person.queueCity=city;
    person.queuedAt=clock();
  }
  const queueGraceWeeks=2,ridersPerPenalty=6,maxQueuePenalty=4;
  function overdueRiders(city){
    const cutoff=clock()-queueGraceWeeks*weekSeconds+1e-7;
    return Object.values(people).filter(p=>p.queue&&p.queueCity===city.id&&p.queuedAt<=cutoff).length;
  }
  function finishWalks(){
    for(const p of Object.values(people))if(p.walk&&(!p.walk.sidewalk||clock()>=p.walk.start+p.walk.duration)){
      joinQueue(p,p.walk.queue);delete p.walk;
    }
  }
  const stopKey=(city,p)=>[city,p.x.toFixed(3),p.y.toFixed(3),p.z.toFixed(3)].join('/');
  function waitingAt(key){return Object.values(people).filter(p=>p.queue===key);}
  function board(vehicle,key,accept,capacity,intercity=false){
    const ids=vehicle.passengers??=[];
    for(const p of waitingAt(key).sort((a,b)=>(a.queuedAt??0)-(b.queuedAt??0))){
      if(vehicle.load>=capacity)break;
      if(!accept(p))continue;
      if(intercity)p.intercity=true;
      ids.push(p.id);vehicle.load++;delete p.queue;delete p.queuedAt;delete p.queueCity;delete p.firstWaitUntil;
    }
  }
  const serviceWindow=8,serviceGraceWeeks=1,downgradeThreshold=.05,downgradeMonths=3;
  const homeService=state.homeService??={};
  const hudHistory=state.hudHistory??={goods:{},trips:{}};
  const satisfaction=state.satisfaction??={towns:{},homes:{}};
  const goodsRetention=.90,passengerRetention=.875,creditPerLoad=.5,capacityWeeks=4;
  const townSatisfaction=city=>satisfaction.towns[city.id]??={goods:{},trips:{}};
  const homeBalances=city=>satisfaction.homes[city.id]??={};
  const ratio=entry=>entry?.demand>0?Math.min(1,entry.credit/(capacityWeeks*entry.demand)):null;
  function updateSatisfaction(entries,key,demand,delivered){
    if(!(demand>0))return;
    const credit=Math.min(capacityWeeks*demand,(entries[key]?.credit??0)*goodsRetention+creditPerLoad*delivered);
    entries[key]={credit,demand};
  }
  function townGoods(city){
    const timber=weeklyDemand(city);
    const goods=(freight?.townGoods(city)??[]).filter(item=>item.demand>0);
    if(timber)goods.unshift({cargo:'timber',name:'Timber',unlock:0,demand:timber});
    return goods;
  }
  function activePassengerDestinations(city){
    const destinations=new Set();
    for(const route of data.routes){
      const plan=routeTrade(route);
      if(plan?.cargo!=='passengers'||!isActive(plan.from,plan.to)||!fleet(route).vehicles.some(v=>!v.retiring))continue;
      if(plan.from===city)destinations.add(plan.to.id);
      if(plan.to===city)destinations.add(plan.from.id);
    }
    return destinations;
  }
  function updatePassengerScore(entries,key,completed,missed){
    const previous=entries[key];
    if(!previous&&!completed&&!missed)return;
    entries[key]={completed:(previous?.completed??0)*passengerRetention+completed,
      missed:(previous?.missed??0)*passengerRetention+missed};
    if(entries[key].completed+entries[key].missed<.025)delete entries[key];
  }
  function passengerRate(entry,unserved=0,aboard=0){
    const served=(entry?.completed??0)+aboard,due=served+(entry?.missed??0)+unserved;
    return due>0?served/due:null;
  }
  function pendingPassengers(city,keyFor){
    const counts=new Map(),cutoff=clock()-queueGraceWeeks*weekSeconds;
    for(const person of Object.values(people)){
      if(person.home!==city.id||person.returning||person.visiting)continue;
      const key=keyFor(person);
      if(key==null)continue;
      const count=counts.get(key)??{aboard:0,overdue:0};
      if(person.intercity)count.aboard++;
      else if(person.queue&&person.queuedAt<=cutoff)count.overdue++;
      counts.set(key,count);
    }
    return counts;
  }
  function passengerScores(city){
    const active=activePassengerDestinations(city),entries=townSatisfaction(city).trips;
    const pending=pendingPassengers(city,person=>person.hudDestination??person.dest);
    return new Map(valley.towns.filter(town=>town!==city).map(({id})=>{
      const {aboard=0,overdue=0}=pending.get(id)??{};
      const rate=active.has(id)||aboard?passengerRate(entries[id],overdue,aboard):null;
      return [id,{active:active.has(id),rate,aboard,overdue}];
    }));
  }
  function updateTownTrips(city,week){
    const entries=townSatisfaction(city).trips;
    for(const dest of valley.towns){
      const sample=hudHistory.trips[week]?.[city.id+':'+dest.id];
      updatePassengerScore(entries,dest.id,sample?.completed??0,sample?.missed??0);
    }
  }
  function updateHomeBalances(city,lots,week,goods=true){
    const entries=homeBalances(city);
    for(const lot of lots){
      const key=city.id+':'+lot.id,entry=entries[lot.id]??={};
      const trips=homeService.passengers?.[week]?.[key];
      updatePassengerScore(entry,'passengers',trips?.served??0,trips?.missed??0);
      if(!goods)continue;
      for(const service of ['timber','starter']){
        const sample=homeService[service]?.[week]?.[key];
        if(!sample&&!entry[service])continue;
        updateSatisfaction(entry,service,sample?.demand??entry[service]?.demand??0,sample?.served??0);
      }
    }
  }
  function average(values){
    return values.length?values.reduce((sum,n)=>sum+(n??0),0)/values.length:0;
  }
  function serviceGrowth(city,goods=townGoods(city)){
    const entries=townSatisfaction(city);
    const rates=tier=>goods.filter(item=>item.unlock===tier).map(item=>ratio(entries.goods[item.cargo]));
    const goodsPoints=Math.round(18*average(rates(0))+14*average(rates(3))+16*average(rates(5)));
    const trips=[...passengerScores(city).values()].filter(trip=>trip.active&&trip.rate!==null);
    const reach=trips.length?passengerCoverage(city).size/Math.max(1,homes(city).length):0;
    const passengerPoints=Math.round(16*average(trips.map(trip=>trip.rate))*Math.sqrt(reach));
    return {goods:goodsPoints,passengers:passengerPoints};
  }
  function serviceSample(history,key,week){
    const period=history[week]??={};
    return period[key]??={demand:0,served:0};
  }
  function requestTrip(home,destination,week){
    const key=home+':'+destination,period=hudHistory.trips[week]??={};
    const sample=period[key]??={requested:0,completed:0};
    sample.requested++;
  }
  function finishResidentTrip(person,destination){
    const {home,homeLot,demandWeek,hudDestination}=person;
    if(!home)return;
    // Keep a completed journey in the window from its arrival. Move its request
    // with it when the original cohort is still present, or restore the pair.
    const key=home+':'+destination;
    const original=hudDestination===destination?hudHistory.trips[demandWeek]?.[key]:null;
    if(original&&original.requested>original.completed)original.requested--;
    const period=hudHistory.trips[state.week]??={};
    const arrived=period[key]??={requested:0,completed:0};
    arrived.requested++;
    arrived.completed++;
    if(homeLot==null)return;
    const history=homeService.passengers??={};
    const homeKey=home+':'+homeLot,homeRequest=history[demandWeek]?.[homeKey];
    if(homeRequest&&homeRequest.demand>homeRequest.served)homeRequest.demand--;
    const homeArrival=serviceSample(history,homeKey,state.week);
    homeArrival.demand++;
    homeArrival.served++;
  }
  function abandonTrip(person){
    if(person.home&&!person.returning&&!person.visiting){
      const destination=person.hudDestination??person.dest;
      if(destination){
        const key=person.home+':'+destination,period=hudHistory.trips[state.week]??={};
        const sample=period[key]??={requested:0,completed:0};
        sample.missed=(sample.missed??0)+1;
      }
      if(person.homeLot!=null){
        const history=homeService.passengers??={};
        const sample=serviceSample(history,person.home+':'+person.homeLot,state.week);
        sample.missed=(sample.missed??0)+1;
      }
    }
    delete people[person.id];
  }
  function townServices(city){
    const scores=townSatisfaction(city),goods=townGoods(city);
    const graceByDestination={},tripScores=passengerScores(city);
    const deadline=clock()-serviceGraceWeeks*weekSeconds;
    for(const person of Object.values(people)){
      const destination=person.hudDestination;
      if(person.home===city.id&&destination&&!person.visiting&&!person.returning&&person.demandAt>deadline&&
         person.demandWeek>=state.week-serviceWindow+1)graceByDestination[destination]=(graceByDestination[destination]??0)+1;
    }
    return {
      goods:goods.map(good=>{
        let requested=0,completed=0;
        for(const period of Object.values(hudHistory.goods)){
          const sample=period[city.id]?.[good.cargo];
          requested+=sample?.requested??0;
          completed+=sample?.completed??0;
        }
        return {...good,requested,completed,rate:ratio(scores.goods[good.cargo])};
      }),
      trips:valley.towns.filter(town=>town!==city).map(town=>{
        let requested=0,completed=0,missed=0;
        for(const period of Object.values(hudHistory.trips)){
          const sample=period[city.id+':'+town.id];
          requested+=sample?.requested??0;
          completed+=sample?.completed??0;
          missed+=sample?.missed??0;
        }
        const grace=graceByDestination[town.id]??0;
        return {town,requested,completed,missed,grace,...tripScores.get(town.id)};
      })
    };
  }
  function industryPulse(site){
    if(site.depot){
      const stored=site.cargos.map(cargo=>freight.storage(site,cargo).stock);
      const limit=stored.length*site.limit,stock=stored.reduce((sum,n)=>sum+n,0);
      return {stock,limit,usage:limit?stock/limit:null};
    }
    const isMill=site===mill;
    const inventory=isMill?state.mill:freight.siteStock(site);
    const {picked=0,available=0}=inventory.lastPickup??{};
    return {
      stock:isMill?state.stock:inventory.output,limit:isMill?stockLimit:site.limit*3,
      picked,available,usage:available?picked/available:null,
      efficiency:isMill?productionEfficiency():inventory.lastPickup?inventory.lastProduced/site.limit:null,
      produced:isMill?inventory.lastWeekProduced??0:inventory.lastProduced,
      level:isMill?inventory.level:null,
      upgrade:isMill&&inventory.level===1?inventory.goodMonths/3:null
    };
  }
  function recordHomeService(service,cityId,lotId,week,demand,served){
    if(week<state.week-serviceWindow+1)return;
    const history=homeService[service]??={};
    const sample=serviceSample(history,cityId+':'+lotId,week);
    sample.demand+=demand;
    sample.served+=served;
  }
  function homeSatisfaction(city,service){
    const covered=coverageLots(city)[service]??new Set();
    const history=homeService[service]??{},balances=homeBalances(city);
    const pending=new Map(),tripStatus=service==='passengers'?pendingPassengers(city,person=>person.homeLot):null;
    if(service==='passengers'){
      const deadline=clock()-serviceGraceWeeks*weekSeconds;
      for(const person of Object.values(people)){
        const {demandWeek,home,homeLot}=person;
        if(home!==city.id||person.returning||person.visiting||!Number.isInteger(demandWeek))continue;
        if((person.demandAt??demandWeek*weekSeconds)<=deadline)continue;
        pending.set(homeLot,(pending.get(homeLot)??0)+1);
      }
    }
    return homes(city).map(lot=>{
      const key=city.id+':'+lot.id;
      let demand=0,served=0;
      let withinGrace=pending.get(lot.id)??0;
      for(const [week,period] of Object.entries(history)){
        const sample=period[key];
        if(!sample)continue;
        demand+=sample.demand;
        served+=sample.served;
        if(service==='timber'&&Number(week)>=state.week-serviceGraceWeeks){
          withinGrace+=Math.max(0,sample.demand-sample.served);
        }
      }
      withinGrace=Math.min(withinGrace,Math.max(0,demand-served));
      const due=Math.max(0,demand-withinGrace);
      const entry=balances[lot.id]?.[service],trip=tripStatus?.get(lot.id);
      const score=tripStatus?(covered.has(lot.id)?passengerRate(entry,trip?.overdue,trip?.aboard):null):ratio(entry);
      const unmet=tripStatus?score===0||!covered.has(lot.id):due>1e-8||!covered.has(lot.id);
      const status=score>=.999?'full':score>0?'partial':unmet?'unmet':'pending';
      return {lot,ratio:score,status,demand,served,withinGrace,covered:covered.has(lot.id)};
    });
  }

  function serviceTotals(city,service){
    return homeSatisfaction(city,service).reduce((total,home)=>{
      total.requested+=home.demand;total.completed+=home.served;total.withinGrace+=home.withinGrace;
      return total;
    },{requested:0,completed:0,withinGrace:0});
  }
  function cityServiceRate(city,service){
    const entries=townSatisfaction(city);
    const scores=service==='passengers'?[...passengerScores(city).values()].filter(trip=>trip.active&&trip.rate!==null).map(trip=>trip.rate):
      service==='starter'?(city.starterGoods??[]).map(cargo=>ratio(entries.goods[cargo])):[ratio(entries.goods.timber)];
    if(!scores.some(score=>score!==null))return null;
    return average(scores);
  }
  function planTrips(){
    const quarter=Math.floor(state.weekTime/(weekSeconds/4)),tick=state.week*4+quarter;
    if(state.tripTick===tick)return;
    state.tripTick=tick;
    for(const p of Object.values(people)){
      if(p.queue&&p.firstWaitUntil<=tick){
        abandonTrip(p);continue;
      }
      if(p.queue&&p.queuedAt===undefined){
        const city=p.localDrop?(p.returning?p.home:p.visiting):p.origin;
        joinQueue(p,p.queue,city);
      }
      if(p.visitUntil<=tick){
        p.dest=p.home;p.returning=true;p.localDrop=null;p.origin=p.visiting;p.hub=p.arrivalHub;
        joinQueue(p,p.visitStop??p.arrivalHub);
        delete p.visitUntil;
      }
    }
    const stops=new Set(localRoutes.filter(r=>r.local==='bus').flatMap(r=>r.stops.map(p=>stopKey(r.city,p)+'|'+r.hub)));
    for(const p of Object.values(people)){
      if(p.queue?.includes('/')&&!stops.has(p.queue+'|'+p.hub)){
        if(p.returning)joinQueue(p,p.arrivalHub);
        else abandonTrip(p);
      }
      if(p.localDrop&&p.queue&&!stops.has(p.localDrop+'|'+p.queue)){
        if(p.returning)delete people[p.id];
        else Object.assign(p,{localDrop:null,queue:null,visitUntil:tick+4});
      }
    }
    for(const city of valley.towns){
      const choices=new Map();
      for(const route of data.routes){
        if(kind(route)!=='Passengers')continue;
        const index=route.stations.findIndex(s=>source(s)===city);
        if(index<0)continue;
        const station=route.stations[index],dest=source(route.stations[1-index]);
        if(!isActive(city,dest)||!fleet(route).vehicles.some(v=>!v.retiring))continue;
        const hub=stationKey(station);
        function offer(lot,queue,endpoint){
          if(!choices.has(lot.id))choices.set(lot.id,new Map());
          const options=choices.get(lot.id);
          const previous=options.get(dest.id);
          const direct=queue===hub,previousDirect=previous?.queue===previous?.hub;
          if(!previous||(direct&&!previousDirect)||(direct===previousDirect&&distance(lot,endpoint)<distance(lot,previous.endpoint))){
            options.set(dest.id,{hub,queue,dest:dest.id,lot,endpoint});
          }
        }
        for(const lot of catchment(station,city))offer(lot,hub,station);
        for(const loop of feeders(station,'bus').filter(loop=>fleet(loop).vehicles.some(v=>!v.retiring)))for(const stop of loop.stops){
          for(const lot of localCatchment(loop,city,stop))offer(lot,stopKey(city.id,stop),stop);
        }
      }
      for(const [lot,options] of choices)for(let slot=0;slot<4;slot++){
        const id=city.id+'/'+lot+'/'+slot;
        let hash=2166136261;
        for(const ch of id+'/'+Math.floor(tick/64))hash=Math.imul(hash^ch.charCodeAt(0),16777619)>>>0;
        if(hash%64!==tick%64||people[id])continue;
        recordHomeService('passengers',city.id,lot,state.week,1,0);
        const trip=[...options.values()][(hash>>>8)%options.size];
        const {lot:home,endpoint,...journey}=trip;
        requestTrip(city.id,trip.dest,state.week);
        const person=people[id]={id,hudDestination:trip.dest,demandWeek:state.week,demandAt:clock(),home:city.id,origin:city.id,homeLot:home.id,homeStop:journey.queue===journey.hub?null:journey.queue,firstWaitUntil:tick+16,...journey};
        const anchor=journey.queue===journey.hub?townNetwork.stationAnchor(endpoint,city):endpoint;
        const destination=valley.platforms?.get(journey.queue)??endpoint;
        startWalk(person,city,home,anchor??endpoint,destination);
      }
    }
  }
  function townProgress(city){
    const timber=timberMarket(city),level=state.received[city.id]?.expansion??0;
    const population=homes(city).length*4;
    const monthlyTimber=timber.monthDemand+(4-state.week%4)*weeklyDemand(city);
    const stop=passengerStop(city);
    const goal=80+Math.ceil(population/2)+20*level;
    const points=Math.min(goal,timber.growthPoints??0);
    const decayFactor=Math.min(2,Math.max(.5,state.growthDecayFactor??1));
    const weeklyDecay=level===0?0:Math.round((4+3*level+population/64)*decayFactor);
    const naturalGrowth=level===0?1:0;
    const overdue=overdueRiders(city),queuePenalty=Math.min(maxQueuePenalty,Math.floor(overdue/ridersPerPenalty));
    const lastMonthGrowth=timber.lastMonthGrowth??null;
    const strongTrend=Math.ceil(goal*.10);
    const trend=lastMonthGrowth===null?'Pending':lastMonthGrowth>=strongTrend?'Growing fast':
      lastMonthGrowth>0?'Growing':lastMonthGrowth<=-strongTrend?'Declining fast':lastMonthGrowth<0?'Declining':'Stable';
    return {level,population,goal,points,weeklyDecay,trend,strongTrend,lastMonthGrowth,lowMonths:timber.lowMonths??0,downgradeMonths,naturalGrowth,overdue,queuePenalty,lastQueuePenalty:timber.lastQueuePenalty??0,remaining:goal-points,
      percent:Math.floor(100*points/goal),used:timber.monthUsed,monthlyTimber,
      riders:stop.monthHandled??0,monthlyRiders:(stop.monthDemand??0)+(4-state.week%4)*weeklyVisits(city),
      serviceGrowth:timber.lastServiceGrowth??{goods:0,passengers:0}};
  }
  function cargoNeed(city,cargo,reachableHomes){
    return ContourRegion.townWeeklyDemand(city,cargo,state.received[city.id]?.expansion??0,homes(city).length,reachableHomes);
  }
  function weeklyDemand(city){return cargoNeed(city,'timber');}
  function timberBuffer(city){return weeklyDemand(city)*2;}
  function timberForRoute(city,station,travel){
    const market=timberMarket(city);
    const reached=catchment(station,city,'delivery').length;
    if(!reached||!weeklyDemand(city))return 0;
    // Order ahead for timber already travelling, while limiting physical stock at the town.
    const target=Math.ceil(cargoNeed(city,'timber',reached)*(1+travel/weekSeconds));
    const yard=timberYard(station,city);
    const yardTarget=yard?Math.floor(target*districtShare(station,city)):0;
    const directTarget=target-yardTarget;
    const needed=Math.max(0,directTarget-market.stock)+Math.max(0,yardTarget-(yard?.timber??0));
    return Math.max(0,needed-market.inbound);
  }
  function timberLoading(route,from,run,load=0,batch=capacity(route)){
    const station=route.stations[1-from],town=source(station);
    const demand=timberForRoute(town,station,run.travel);
    const remaining=batch-load;
    const market=timberMarket(town);
    const room=timberBuffer(town)-market.stock-market.inbound;
    const order=isRail(route)?Math.min(demand,Math.max(0,room)):demand;
    // An open order may be rounded up to a whole vehicle if the town can store it.
    const canFill=order>=remaining||((order>0||load>0)&&room>=remaining);
    return {order,remaining,canFill};
  }
  function timberOpen(city){
    let order=0,connected=false;
    for(const [index,route] of data.routes.entries()){
      const plan=routeTrade(route);
      const station=plan?.cargo==='timber'&&plan.to===city?route.stations.find(s=>source(s)===city):null;
      if(!station)continue;
      connected=true;
      order=Math.max(order,timberForRoute(city,station,valley.truckRuns[index].travel));
    }
    if(connected)return order;
    const market=timberMarket(city);
    return Math.max(0,weeklyDemand(city)-market.stock-market.inbound);
  }
  function pair(a,b){return [a.id,b.id].sort().join(':');}
  function connect(route){
    const [a,b]=route.stations.map(source);
    if(!a||!b||a===b)return;
    const key=pair(a,b);
    if(state.connections[key]!==undefined)return;
    state.connections[key]=state.week+startupWeeks+(state.weekTime>1e-7?1:0);
    if(a===mill||b===mill){
      const buyer=a===mill?b:a;
      state.mill.credits+=buyer.depot?truckCapacity*2:weeklyDemand(buyer)*2;
    }
  }
  function isActive(a,b){
    return Boolean(a&&b&&state.connections[pair(a,b)]!==undefined&&state.connections[pair(a,b)]<=state.week);
  }
  function capacity(route){
    if(!isRail(route))return vehicleCapacity(route);
    const vehicles=fleet(route).vehicles.filter(v=>!v.retiring);
    return vehicles.length?Math.max(...vehicles.map(v=>vehicleCapacity(route,v))):vehicleCapacity(route);
  }
  function book(kind,amount){
    state.finance.current[kind]+=amount;
    state.cash+=kind==='revenue'?amount:-amount;
  }
  function bookRoute(service,kind,amount){
    service[kind]+=amount;
    service.thisMonth[kind]=(service.thisMonth[kind]??0)+amount;
  }
  function addFinanceMonth(months,sample){
    const month=Math.floor(sample.week/4);
    let total=months.at(-1);
    if(total?.month!==month){
      total={month,firstWeek:sample.week,revenue:0,operating:0,capital:0};
      months.push(total);
    }
    total.week=sample.week;total.cash=sample.cash;
    total.revenue+=sample.revenue;total.operating+=sample.operating;total.capital+=sample.capital;
  }
  function financeMonths(){
    const months=financeArchive.slice();
    if(months.length)months[months.length-1]={...months.at(-1)};
    for(const sample of state.finance.history)addFinanceMonth(months,sample);
    addFinanceMonth(months,{...state.finance.current,cash:state.cash,week:state.week});
    return months;
  }
  function monthlyClose(){
    const month=state.week/4-1;
    const townStats={};
    for(const route of [...data.routes,...localRoutes]){
      const service=fleet(route);
      service.lastMonth=service.thisMonth;
      service.thisMonth={revenue:0,expenses:0,delivered:0,km:0};
    }
    for(const city of valley.towns){
      const t=timberMarket(city);
      t.lastUsed=t.monthUsed;t.lastDemand=t.monthDemand;
      if(t.growthWeeks===4)t.lastMonthGrowth=t.monthGrowth;
      const received=state.received[city.id];
      if(received?.expansion>0&&t.lowGrowthWeeks===4){
        t.lowMonths=(t.lowMonths??0)+1;
        if(t.lowMonths>=downgradeMonths){
          received.peakExpansion=Math.max(received.peakExpansion??0,received.expansion);
          received.expansion--;
          t.lowMonths=0;
        }
      }
      t.lowGrowthWeeks=0;
      t.monthGrowth=0;t.growthWeeks=0;
      const stop=passengerStop(city);
      stop.lastMonth=stop.monthHandled??0;
      stop.lastDemand=stop.monthDemand??0;
      if(month>=serviceHistory.firstMonth){
        const percentage=service=>{
          const rate=cityServiceRate(city,service);
          return rate===null?null:Math.round(rate*100);
        };
        townStats[city.id]={intercity:stop.lastMonth,local:serviceHistory.localTrips[city.id]??0,
          passengers:percentage('passengers'),...(city.starterGoods?{starter:percentage('starter')}:{timber:percentage('timber')})};
      }
      t.monthUsed=0;t.monthDemand=0;stop.monthHandled=0;stop.monthDemand=0;
    }
    if(month>=serviceHistory.firstMonth)serviceHistory.months.push({month,towns:townStats});
    serviceHistory.localTrips={};
    const industry=state.mill;
    industry.lastMonth=industry.monthUsed;
    industry.goodMonths=industry.monthUsed>=millUpgradeDemand?industry.goodMonths+1:0;
    if(industry.goodMonths>=3)industry.level=2;
    industry.monthUsed=0;
  }
  function closeWeek(){
    state.finance.history.push({...state.finance.current,cash:state.cash,week:state.week});
    if(state.finance.history.length>520)addFinanceMonth(financeArchive,state.finance.history.shift());
    state.finance.current={revenue:0,operating:0,capital:0};
    for(const city of valley.towns){
      const lots=homes(city),reachable=timberCoverage(city);
      const t=timberMarket(city),need=weeklyDemand(city),used=Math.min(t.stock,cargoNeed(city,'timber',reachable.size));
      t.stock-=used;t.used+=used;t.monthUsed+=used;t.monthDemand+=need;
      if(lots.length){
        const perHome=need/lots.length;
        const suppliedPerHome=reachable.size?Math.min(perHome,used/reachable.size):0;
        for(const lot of lots)recordHomeService('timber',city.id,lot.id,state.week,perHome,
          reachable.has(lot.id)?suppliedPerHome:0);
      }
      state.mill.credits+=used;state.mill.monthUsed+=used;
      const stop=passengerStop(city);
      stop.lastWeek=stop.waiting;
      stop.waiting=0;stop.visits+=stop.lastWeek;
      stop.monthHandled=(stop.monthHandled??0)+stop.lastWeek;
      stop.monthDemand=(stop.monthDemand??0)+weeklyVisits(city);
      const growth=townProgress(city);
      t.lastQueuePenalty=growth.queuePenalty;
      const consumed={timber:used};
      const coverage=new Map([['timber',reachable]]);
      function coveredHomes(cargo){
        if(!coverage.has(cargo))coverage.set(cargo,freightCoverage(city,cargo));
        return coverage.get(cargo);
      }
      freight?.consumeWeek(city,state.week%4===3,cargo=>coveredHomes(cargo).size,
        (cargo,amount)=>{consumed[cargo]=amount;});
      const goodsWeek=hudHistory.goods[state.week]??={};
      const demands=townGoods(city);
      goodsWeek[city.id]=Object.fromEntries(demands.map(({cargo,demand})=>[
        cargo,{requested:demand,completed:consumed[cargo]??0}
      ]));
      if(city.starterGoods&&lots.length){
        const delivered=city.starterGoods.map(cargo=>{
          const demand=cargo==='timber'?need:freight.weeklyDemand(city,cargo);
          const covered=coveredHomes(cargo);
          const served=covered.size&&demand?Math.min(1,(consumed[cargo]??0)*lots.length/(demand*covered.size)):0;
          return {covered,served};
        });
        for(const lot of lots)recordHomeService('starter',city.id,lot.id,state.week,delivered.length,
          delivered.reduce((sum,{covered,served})=>sum+(covered.has(lot.id)?served:0),0));
      }
      const scores=townSatisfaction(city);
      for(const {cargo,demand} of demands)updateSatisfaction(scores.goods,cargo,demand,consumed[cargo]??0);
      for(const cargo of Object.keys(scores.goods)){
        if(!demands.some(good=>good.cargo===cargo))delete scores.goods[cargo];
      }
      updateTownTrips(city,state.week);
      updateHomeBalances(city,lots,state.week);
      const service=serviceGrowth(city,demands);
      t.lastServiceGrowth=service;
      const balance=growth.naturalGrowth+service.goods+service.passengers-growth.weeklyDecay-growth.queuePenalty;
      t.monthGrowth=(t.monthGrowth??0)+balance;
      t.growthWeeks=(t.growthWeeks??0)+1;
      t.growthPoints=Math.max(0,growth.points+balance);
      const levelledUp=t.growthPoints>=growth.goal;
      if(levelledUp){
        const received=state.received[city.id]??={timber:0,passengers:0};
        t.growthPoints-=growth.goal;
        received.expansion=growth.level+1;
        const peak=received.peakExpansion??growth.level;
        if(received.expansion>peak)valley.expandTown?.(city,received.expansion);
        received.peakExpansion=Math.max(peak,received.expansion);
      }
      if(!levelledUp&&growth.level>0&&t.growthPoints<growth.goal*downgradeThreshold){
        t.lowGrowthWeeks=(t.lowGrowthWeeks??0)+1;
      }else{
        t.lowGrowthWeeks=0;t.lowMonths=0;
      }
    }
    const picked=state.mill.hudPickedUp??0;
    state.mill.lastPickup={picked,available:picked+state.stock};
    state.mill.hudPickedUp=0;
    state.week++;
    delete hudHistory.goods[state.week-serviceWindow-1];
    delete hudHistory.trips[state.week-serviceWindow];
    for(const history of Object.values(homeService))delete history[state.week-serviceWindow];
    state.weekTime=0;
    if(state.week%4===0)monthlyClose();
    if(freight){
      const services=data.routes.filter(route=>fleet(route).vehicles.some(v=>!v.retiring))
        .map(routeTrade).filter(plan=>plan&&plan.cargo!=='passengers'&&isActive(plan.from,plan.to));
      freight.supplyWeek(services);
    }
    if([...valley.towns,...depots()].some(city=>isActive(mill,city))){
      updateMillEfficiency();
      const orders=weeklyMillOrders();
      const produced=Math.min(productionLimit(),Math.max(state.mill.credits,orders-state.stock),stockLimit-state.stock);
      state.stock+=produced;state.mill.credits=Math.max(0,state.mill.credits-produced);state.mill.produced+=produced;
      state.mill.lastWeekProduced=produced;
    }
  }
  function weeklyMillOrders(){
    const orders=new Map();
    for(const [index,route] of data.routes.entries()){
      const plan=routeTrade(route);
      if(plan?.from!==mill||formerDemand(plan)||!fleet(route).vehicles.some(v=>!v.retiring))continue;
      const city=plan.to,station=route.stations.find(s=>source(s)===city);
      if(!city||!isActive(mill,city))continue;
      if(city.depot){
        const {order}=freight.orders(city,'timber');
        orders.set(city.id,order);continue;
      }
      const from=route.stations.indexOf(station)===0?1:0,run=valley.truckRuns[index];
      const {order,canFill}=timberLoading(route,from,run);
      const waiting=fleet(route).vehicles.find(v=>!v.retiring&&v.ready&&v.load>0&&vehicleSide(route,v,run)===from);
      const waitingLoad=waiting?.load??0,batchCapacity=waiting?vehicleCapacity(route,waiting):capacity(route);
      const canFinish=waitingLoad&&timberLoading(route,from,run,waitingLoad,batchCapacity).canFill;
      const batch=canFinish?batchCapacity-waitingLoad:canFill?batchCapacity:0;
      const demand=route.fillWait?Math.max(order,batch):order;
      orders.set(city.id,Math.max(demand,orders.get(city.id)??0));
    }
    return [...orders.values()].reduce((total,order)=>total+order,0);
  }
  function updateMillEfficiency(){
    const industry=state.mill;
    const yardBackedUp=state.stock>=Math.ceil(stockLimit*.75)&&industry.pickedUpThisWeek<4;
    if(state.stock>=truckCapacity&&(!industry.pickedUpThisWeek||yardBackedUp)){
      industry.uncollectedWeeks=Math.min(6,industry.uncollectedWeeks+1);
    }else{
      industry.uncollectedWeeks=Math.max(0,industry.uncollectedWeeks-(industry.pickedUpThisWeek?2:1));
    }
    industry.pickedUpThisWeek=0;
  }
  function productionEfficiency(){
    const weeks=state.mill.uncollectedWeeks;
    return weeks>=6?.5:weeks>=3?.75:1;
  }
  function productionLimit(){
    return Math.floor((state.mill.level===2?72:48)*productionEfficiency());
  }
  function localCatchment(route,city,stop){
    return townNetwork.getGraph(valley,city).catchment(stop,homes(city),4.5);
  }
  const localCargo=route=>route.cargo??'timber';
  const cargoDemand=(city,cargo)=>cargo==='timber'?weeklyDemand(city):freight?.weeklyDemand(city,cargo)??0;
  const localDepot=(city,hub,cargo)=>depots().find(site=>site.host===city.id&&site.hubKey===hub&&site.cargos.includes(cargo));
  function localCargoOptions(city,hub){
    const goods=new Set(depots().filter(site=>site.host===city.id&&site.hubKey===hub).flatMap(site=>site.cargos));
    for(const route of data.routes){
      const plan=routeTrade(route);
      if(plan?.to!==city||plan.cargo==='passengers')continue;
      if(route.stations.some(station=>source(station)===city&&stationKey(station)===hub))goods.add(plan.cargo);
    }
    return [...goods].filter(cargo=>(cargo==='timber'||freight)&&ContourRegion.acceptsTownCargo(city,cargo));
  }
  function yardStock(hub,cargo){
    const stock=data.hubStock?.[hub];
    return (cargo==='timber'?stock?.timber:stock?.goods?.[cargo])??0;
  }
  function changeYardStock(hub,cargo,change){
    if(!change)return;
    const stock=townNetwork.hubStock(valley,hub);
    if(cargo==='timber')stock.timber+=change;
    else (stock.goods??={})[cargo]=yardStock(hub,cargo)+change;
  }
  function localStock(route){
    const cargo=localCargo(route),city=valley.towns.find(t=>t.id===route.city);
    const depot=city&&localDepot(city,route.hub,cargo);
    return yardStock(route.hub,cargo)+(depot?freight.available(depot,cargo):0);
  }
  function takeLocalStock(route,city,count){
    const cargo=localCargo(route),fromYard=Math.min(yardStock(route.hub,cargo),count);
    changeYardStock(route.hub,cargo,-fromYard);
    if(count>fromYard)freight.take(localDepot(city,route.hub,cargo),cargo,count-fromYard);
  }
  function feeders(station,mode){
    if(!townNetwork)return [];
    const key=townNetwork.stationKey(station);
    return localRoutes.filter(route=>route.local===mode&&route.hub===key);
  }
  function catchment(s,city=source(s),mode,cargo='timber'){
    if(!city||isIndustry(city))return [];
    if(!townNetwork||!city.roads)return homes(city).filter(l=>distance(s,l)<=radius);
    const graph=townNetwork.getGraph(valley,city),anchor=townNetwork.stationAnchor(s,city);
    const direct=anchor?graph.catchment(anchor,homes(city),radius):[];
    if(!mode)return direct;
    const all=new Map(direct.map(l=>[l.id,l]));
    for(const route of feeders(s,mode)){
      if(!fleet(route).vehicles.some(v=>!v.retiring)||mode==='delivery'&&localCargo(route)!==cargo)continue;
      for(const stop of route.stops)for(const lot of localCatchment(route,city,stop))all.set(lot.id,lot);
    }
    return [...all.values()];
  }
  function timberYard(station,city){
    if(!feeders(station,'delivery').some(loop=>localCargo(loop)==='timber'&&fleet(loop).vehicles.some(v=>!v.retiring)))return null;
    return townNetwork.hubStock(valley,townNetwork.stationKey(station));
  }
  function districtShare(station,city,cargo){
    const direct=catchment(station,city).length,extended=catchment(station,city,'delivery',cargo).length;
    return extended?Math.max(0,(extended-direct)/extended):0;
  }
  function kind(r){
    if(r.local)return r.local==='delivery'?ContourRegion.goods[localCargo(r)][0]:'Passengers';
    const cargo=routeTrade(r)?.cargo;
    return cargo&&cargo!=='passengers'?ContourRegion.goods[cargo][0]:'Passengers';
  }
  function fleet(r){
    const service=r.service??={vehicles:[{phase:0,load:0,ready:true}],revenue:0,expenses:0,delivered:0,km:0};
    service.thisMonth??={revenue:0,expenses:0,delivered:0,km:0};
    if(isRail(r))for(const vehicle of service.vehicles){
      vehicle.consist??=rail.defaultConsist(railCargo(r));
      railState(vehicle);
    }
    return service;
  }
  function townTotals(city){
    const totals={timber:timberOpen(city)};
    for(const t of valley.towns)if(t!==city)totals[t.id]=0;
    for(const p of Object.values(people))if(p.queue&&p.origin===city.id)totals[p.dest]=(totals[p.dest]??0)+1;
    return totals;
  }
  function timberCoverage(city){
    return freightCoverage(city,'timber');
  }
  function freightCoverage(city,cargo){
    const covered=new Set();
    for(const route of data.routes){
      const plan=routeTrade(route);
      const station=plan?.cargo===cargo&&plan.to===city&&!formerDemand(plan)&&
        (!city.starterGoods||fleet(route).vehicles.length)?route.stations.find(s=>source(s)===city):null;
      if(!station)continue;
      for(const lot of catchment(station,city,'delivery',cargo))covered.add(lot.id);
    }
    for(const route of localRoutes){
      if(route.local!=='delivery'||route.city!==city.id||localCargo(route)!==cargo||
          !localDepot(city,route.hub,cargo)||!fleet(route).vehicles.some(v=>!v.retiring))continue;
      for(const stop of route.stops)for(const lot of localCatchment(route,city,stop))covered.add(lot.id);
    }
    return covered;
  }
  function passengerCoverage(city){
    const passengers=new Set();
    for(const route of data.routes){
      const [a,b]=route.stations.map(source);
      if(a!==city&&b!==city)continue;
      const other=a===city?b:a;
      if(!other||other===city)continue;
      const station=route.stations[a===city?0:1];
      const plan=routeTrade(route);
      if(plan?.cargo==='passengers'&&isActive(city,other)&&fleet(route).vehicles.some(v=>!v.retiring)){
        for(const lot of catchment(station,city,'bus'))passengers.add(lot.id);
      }
    }
    return passengers;
  }
  function coverageLots(city){
    return {timber:freightCoverage(city,'timber'),passengers:passengerCoverage(city),
      starter:new Set(city.starterGoods?.flatMap(cargo=>[...freightCoverage(city,cargo)]))};
  }
  function coverage(city){
    const {timber,passengers,starter}=coverageLots(city);
    return {homes:homes(city).length,timber:timber.size,passengers:passengers.size,starter:starter.size};
  }
  function dispatchPassengers(r,v,from){
    const a=r.stations[from],b=r.stations[1-from],origin=source(a),dest=source(b);
    if(!isActive(origin,dest)||dest===mill)return;
    if(origin===mill)return;
    const onboard=v.load;
    board(v,stationKey(a),p=>!p.localDrop&&p.dest===dest.id,vehicleCapacity(r,v),true);
    passengerStop(dest).inbound+=v.load-onboard;
    if(!v.load&&!waitingAt(stationKey(b)).some(p=>!p.localDrop&&p.dest===origin.id))return 'orders';
  }
  function loadFreight(route,vehicle,from,run,dt,plan){
    const legacy=plan.cargo==='timber'&&!plan.to.depot;
    const batch=vehicleCapacity(route,vehicle),remaining=batch-vehicle.load;
    const target=route.stations[1-from];
    const reachableHomes=legacy||isIndustry(plan.to)?0:catchment(target,plan.to,'delivery',plan.cargo).length;
    const request=!legacy&&freight.orders(plan.to,plan.cargo,run.travel,reachableHomes);
    if(request&&!isIndustry(plan.to)){
      const staged=yardStock(stationKey(target),plan.cargo);
      request.order=Math.max(0,request.order-staged);
      request.room=Math.max(0,request.room-staged);
    }
    const loading=legacy?timberLoading(route,from,run,vehicle.load,batch):{
      order:request.order,canFill:request.order>=remaining||(request.order>0||vehicle.load>0)&&request.room>=remaining
    };
    const stock=plan.from===mill?state.stock:freight.available(plan.from,plan.cargo);
    const policy=route.fillWait??0;
    const wait=policy==='full'||(vehicle.fillElapsed??0)<policy*weekSeconds;
    const full=loading.canFill&&stock>=remaining;
    if(wait&&!full&&remaining>0&&!vehicle.retiring){
      vehicle.fillElapsed=(vehicle.fillElapsed??0)+dt;
      if(!loading.canFill)return 'orders';
      // A factory's pickup truck must let incoming material reach the same bay.
      if(plan.from.depot)return 'inputs';
      if(plan.from!==mill&&Object.entries(plan.from.inputs).some(([cargo,amount])=>
          (freight.siteStock(plan.from).inputs[cargo]??0)<(remaining-stock)*amount))return 'inputs';
      return 'filling';
    }
    const picked=Math.min(remaining,stock,policy&&full?remaining:loading.order);
    vehicle.load+=picked;
    if(plan.from===mill){
      state.stock-=picked;
      state.mill.pickedUpThisWeek+=picked;
      state.mill.hudPickedUp=(state.mill.hudPickedUp??0)+picked;
    }else freight.take(plan.from,plan.cargo,picked);
    if(legacy)timberMarket(plan.to).inbound+=picked;
    else freight.reserve(plan.to,plan.cargo,picked);
  }
  function arrival(r,v,dest,run){
    v.unloaded=v.load;
    if(!v.load)return;
    const city=source(r.stations[dest]),svc=fleet(r),plan=routeTrade(r),cargo=isFreight(r),timber=plan?.cargo==='timber'&&!plan.to.depot;
    const direct=distance(source(r.stations[0]),source(r.stations[1]))*.04;
    const travel=isRail(r)?(railState(v).travelElapsed||run.travel):run.travel;
    const quality=Math.min(1,(35+direct*45)/travel);
    const rate=timber?fare*.88:cargo?ContourRegion.goods[plan.cargo][3]:120;
    const distanceFactor=valley.region?Math.sqrt(direct)*.72+direct*.31:Math.sqrt(direct);
    const pay=city.depot?0:Math.round(v.load*rate*distanceFactor*quality);
    const handling=v.load*(cargo?12:5);
    if(pay)receipts.set(v,{pay,age:0});
    bookRoute(svc,'revenue',pay);bookRoute(svc,'expenses',handling);bookRoute(svc,'delivered',v.load);
    book('revenue',pay);book('operating',handling);
    if(cargo&&!timber){
      const station=r.stations[dest];
      const share=isIndustry(city)?0:districtShare(station,city,plan.cargo);
      let staged=0;
      if(share>0){
        const key=stationKey(station),yard=townNetwork.hubStock(valley,key);
        const credits=yard.freightSplitCredit??={};
        const exact=(credits[plan.cargo]??0)+v.load*share;
        const room=freight.storage(city,plan.cargo).limit-yardStock(key,plan.cargo);
        staged=Math.max(0,Math.min(room,Math.floor(exact)));
        credits[plan.cargo]=exact-Math.floor(exact);
        changeYardStock(key,plan.cargo,staged);
      }
      freight.deliver(city,plan.cargo,v.load-staged,v.load);
      v.load=0;
      return;
    }
    const received=state.received[city.id]??={timber:0,passengers:0};
    if(timber){
      const market=timberMarket(city),yard=timberYard(r.stations[dest],city);
      const exact=yard?(yard.splitCredit??0)+v.load*districtShare(r.stations[dest],city):0;
      const staged=yard?Math.max(0,Math.min(timberBuffer(city)-yard.timber,Math.floor(exact))):0;
      if(yard)yard.splitCredit=exact-Math.floor(exact);
      if(yard)yard.timber+=Math.max(0,staged);
      received.timber+=v.load-Math.max(0,staged);
      market.inbound=Math.max(0,market.inbound-v.load);market.stock+=v.load-Math.max(0,staged);
    }else{
      received.passengers+=v.load;
      const stop=passengerStop(city);
      stop.inbound=Math.max(0,stop.inbound-v.load);stop.waiting+=v.load;
      for(const id of v.passengers??[]){
        const p=people[id];if(!p)continue;
        delete p.intercity;
        if(!p.returning)finishResidentTrip(p,city.id);
        const station=r.stations[dest],hub=stationKey(station);
        const loops=feeders(station,'bus');
        if(p.returning){
          if(loops.some(loop=>loop.stops.some(stop=>stopKey(city.id,stop)===p.homeStop))){
            p.localDrop=p.homeStop;
            joinQueue(p,hub,city.id);
          }else delete people[id];
          continue;
        }
        const direct=new Set(catchment(station,city).map(lot=>lot.id));
        const remote=loops.flatMap(loop=>loop.stops.filter(stop=>localCatchment(loop,city,stop).some(lot=>!direct.has(lot.id))));
        const slot=Number(p.id.split('/').at(-1));
        if(remote.length&&slot%2===0){
          Object.assign(p,{visiting:city.id,arrivalHub:hub,localDrop:stopKey(city.id,remote[slot%remote.length])});
          joinQueue(p,hub,city.id);
        }else Object.assign(p,{visiting:city.id,arrivalHub:hub,visitUntil:state.tripTick+4});
      }
      v.passengers=[];
    }
    v.load=0;
  }
  const unloadTime=2.8, bayTime=unloadTime+1.4, truckGap=.42,localDwell=.8;
  const localSpeed=route=>route.local==='delivery'?.72:.88;
  function routeThroughput(route,index){
    const account=fleet(route),actual=account.lastMonth?.delivered??null;
    const vehicles=account.vehicles.filter(vehicle=>!vehicle.retiring);
    const activeVehicles=vehicles.length;
    if(isRail(route)){
      const run=valley.truckRuns[index],cargo=railCargo(route);
      const cycles=vehicles.map(vehicle=>rail.estimate(vehicle.consist,cargo,run))
        .filter(timed=>timed.valid&&!timed.stalled&&fitsPlatforms(route,timed));
      const potential=cycles.reduce((total,timed)=>{
        const cycle=timed.travel+timed.returnTravel+2*bayTime;
        return total+4*weekSeconds*timed.capacity*(isFreight(route)?1:2)/cycle;
      },0);
      const lanes=run?.blocks.length&&run.blocks.every(block=>block.tracks===2)&&!run.switches.length&&!run.crossings.length?2:1;
      return {actual,potential:potential*Math.min(1,lanes/Math.max(1,cycles.length))};
    }
    const travel=valley.truckRuns?.[index]?.travel;
    const cycle=route.local?route.length/localSpeed(route)+(route.events?.length-1)*localDwell:
      2*(travel+bayTime);
    const capacityPerCycle=capacity(route)*(isFreight(route)?1:2);
    const potential=Number.isFinite(cycle)&&cycle>0&&(!route.local||validLoop(route))?
      4*weekSeconds*activeVehicles*capacityPerCycle/cycle:0;
    return {actual,potential};
  }
  function interpolatePath(run,value,input,output){
    const p=run.path;
    let lo=0,hi=p.length-1;
    while(hi-lo>1){
      const mid=(lo+hi)>>1;
      if(p[mid][input]<value)lo=mid;else hi=mid;
    }
    const a=p[lo],b=p[hi];
    return a[output]+(b[output]-a[output])*(value-a[input])/(b[input]-a[input]);
  }
  function departureTime(run,from,distance){
    const length=run.path.at(-1).length;
    const t=interpolatePath(run,from?length-distance:distance,'length','travel');
    return from?run.travel-t:t;
  }
  function distanceAlongLane(run,from,time){
    const d=interpolatePath(run,from?run.travel-time:time,'travel','length');
    return from?run.path.at(-1).length-d:d;
  }
  function step(dt){
    // Dispatch, traffic and station dwell must see the same ticks at every playback speed.
    const tick=1/32;
    const elapsed=(state.tickRemainder??0)+dt;
    const ticks=Math.floor((elapsed+1e-12)/tick);
    state.tickRemainder=Math.max(0,elapsed-ticks*tick);
    for(let i=0;i<ticks;i++)advanceClock(tick);
  }
  function advanceClock(dt){
    while(dt>1e-7){
      const timeToClose=weekSeconds-state.weekTime;
      const quarter=weekSeconds/4;
      const span=Math.min(dt,timeToClose,quarter-state.weekTime%quarter);
      finishWalks();planTrips();drive(span);
      dt-=span;
      state.weekTime+=span;
      if(span===timeToClose)closeWeek();
    }
  }
  function roadPose(path,d,key,lane,reverse=false){
    let lo=0,hi=path.length-1;
    while(hi-lo>1){
      const mid=(lo+hi)>>1;
      if(path[mid][key]<=d)lo=mid;else hi=mid;
    }
    const a=path[lo],b=path[hi],t=Math.max(0,Math.min(1,(d-a[key])/(b[key]-a[key]||1)));
    const length=distance(a,b)||1,sign=reverse?-1:1;
    const dx=sign*(b.x-a.x)/length,dy=sign*(b.y-a.y)/length;
    return {x:a.x+(b.x-a.x)*t+dy*lane,y:a.y+(b.y-a.y)*t-dx*lane,z:a.z+(b.z-a.z)*t+.031,
      dx,dy,yaw:Math.atan2(dy,dx)};
  }
  const localPose=(route,phase)=>roadPose(route.path,phase,'distance',.055);
  const mainPose=(run,from,d)=>roadPose(run.path,from?run.path.at(-1).length-d:d,'length',.073,from===1);
  function townTraffic(services,loops){
    const occupied=new Map();
    function place(route,vehicle,pose){occupied.set(vehicle,{route,pose});}
    for(const {route,run,service} of services){
      const half=run.travel+bayTime;
      for(const v of service.vehicles){
        const from=v.phase>=half?1:0,local=v.phase-from*half;
        if(!v.ready)place(route,v,mainPose(run,from,distanceAlongLane(run,from,Math.min(run.travel,local))));
      }
    }
    for(const {route,service} of loops)for(const v of service.vehicles){
      if(v.phase>0||v.next)place(route,v,localPose(route,v.phase));
    }
    function canMove(route,vehicle,from,to){
      for(const [other,{route:otherRoute,pose}] of occupied){
        if(other===vehicle||(!route.local&&route===otherRoute)||Math.abs(pose.z-to.z)>.06)continue;
        const x=pose.x-from.x,y=pose.y-from.y;
        if(Math.abs(x)>.8||Math.abs(y)>.8)continue;
        const dot=from.dx*pose.dx+from.dy*pose.dy;
        const gap=Math.hypot(pose.x-to.x,pose.y-to.y),before=Math.hypot(x,y);
        const front=x*from.dx+y*from.dy,side=Math.abs(x*from.dy-y*from.dx);
        if(dot>.70){
          if(front>0&&front<.38&&side<.12&&gap<=before+1e-7)return false;
        }else{
          const clearance=dot<-.70?.10:.17;
          if(gap<clearance&&gap<before-1e-7)return false;
          const cross=from.dx*pose.dy-from.dy*pose.dx;
          if(Math.abs(cross)<=.50)continue;
          const mine=(x*pose.dy-y*pose.dx)/cross,theirs=(x*from.dy-y*from.dx)/cross;
          // Yield to a vehicle entering from the cross street if it is closer.
          if(mine>=.08&&mine<.27&&theirs>=-.06&&theirs<mine-.01)return false;
        }
      }
      return true;
    }
    function canEnter(vehicle,position){
      for(const [other,{pose}] of occupied){
        if(other!==vehicle&&Math.abs(pose.z-position.z)<.06&&distance(pose,position)<.25)return false;
      }
      return true;
    }
    return {place,canMove,canEnter,leave:vehicle=>occupied.delete(vehicle)};
  }
  function trafficPass(vehicle,clear,dt,travelled=0){
    if(vehicle.trafficClearance>0){
      vehicle.trafficClearance=Math.max(0,vehicle.trafficClearance-travelled);
      return true;
    }
    if(clear){vehicle.trafficWait=0;return true;}
    vehicle.trafficWait=(vehicle.trafficWait??0)+dt;
    if(vehicle.trafficWait<2.5)return false;
    vehicle.trafficWait=0;
    vehicle.trafficClearance=.48;
    return true;
  }
  function getCrossings(){
    const runs=valley.truckRuns,locals=localRoutes.map(route=>route.path);
    if(crossingGeometry&&runs===crossingRuns&&locals.length===crossingLocal.length&&locals.every((path,i)=>path===crossingLocal[i]))return crossingGeometry;
    const roads=[],rails=[];
    for(const [i,route] of data.routes.entries()){
      const run=runs[i];
      if(!(run?.path.length>1))continue;
      if(isRail(route)){
        for(const from of [0,1]){
          const path=run.path.map(({length})=>{
            const distance=(from?run.length-length:length)*rail.metresPerUnit;
            return {...rail.pose(run,{rail:{from,distance}}),length};
          });
          rails.push({route,path,from});
        }
      }else roads.push({route,path:run.path,key:'length'});
    }
    for(const route of localRoutes)if(route.path?.length>1)roads.push({route,path:route.path,key:'distance'});
    crossingRuns=runs;
    crossingLocal=locals;
    crossingGeometry=window.ContourCrossings?.build(roads,rails)??{byRoad:new Map(),byRail:new Map()};
    return crossingGeometry;
  }
  function gradeCrossings(roadServices,loops,railServices){
    const {byRoad,byRail}=getCrossings();
    if(!byRail.size)return noCrossingLimit;
    const closed=new Set(),roadEntries=new Map([...roadServices,...loops].map(entry=>[entry.route,entry]));
    for(const {route,run,service} of railServices){
      const crossings=byRail.get(route);
      if(!crossings)continue;
      for(const vehicle of service.vehicles){
        const motion=railState(vehicle),unit=rail.metresPerUnit;
        const {front,tail}=rail.trainSpan(run,vehicle,railQuote(route,vehicle).length/unit);
        const approaches=motion.active&&motion.dwell<=0;
        const warning=approaches?Math.max(1.45,motion.speed/unit*2.6*2.1):0;
        for(const crossing of crossings){
          if(crossing.railFrom!==motion.from)continue;
          const along=motion.from?run.length-crossing.railAt:crossing.railAt;
          if(front+warning>=along-crossing.railWidth&&tail<=along+crossing.railWidth)closed.add(crossing);
        }
      }
    }
    function roadLimit(route,from,length,oldDistance){
      let limit=Infinity;
      for(const crossing of byRoad.get(route)??[]){
        if(!closed.has(crossing))continue;
        const along=from?length-crossing.roadAt:crossing.roadAt;
        const stop=Math.max(0,along-crossing.roadWidth);
        // Vehicles that passed the stop line can clear the junction.
        if(oldDistance<=stop+1e-7)limit=Math.min(limit,stop);
      }
      return limit;
    }
    function roadOccupies(crossing){
      const entry=roadEntries.get(crossing.road);
      if(!entry)return false;
      const {route,run,service}=entry;
      const low=crossing.roadAt-crossing.roadWidth,high=crossing.roadAt+crossing.roadWidth;
      return service.vehicles.some(vehicle=>{
        if(route.local)return vehicle.phase>Math.max(0,low)+1e-7&&vehicle.phase<high-1e-7;
        if(vehicle.ready)return false;
        const half=run.travel+bayTime,from=vehicle.phase>=half?1:0;
        const local=Math.min(run.travel,vehicle.phase-from*half);
        const distance=distanceAlongLane(run,from,local);
        const position=from?run.length-distance:distance;
        return distance>1e-7&&position>low+1e-7&&position<high-1e-7;
      });
    }
    function trainLimit(route,run,vehicle,quote){
      const available=byRail.get(route);
      if(!available)return Infinity;
      const motion=railState(vehicle),unit=rail.metresPerUnit;
      const {front}=rail.trainSpan(run,vehicle,quote.length/unit);
      let limit=Infinity;
      for(const crossing of available){
        if(crossing.railFrom!==motion.from)continue;
        const along=motion.from?run.length-crossing.railAt:crossing.railAt;
        const stop=along-crossing.railWidth;
        if(front<=stop+1e-7&&roadOccupies(crossing))limit=Math.min(limit,Math.max(motion.distance,stop*unit));
      }
      return limit;
    }
    return {roadLimit,trainLimit};
  }
  function drive(dt){
    const services=[],railServices=[];
    for(const [i,route] of data.routes.entries()){
      if(!isActive(...route.stations.map(source)))continue;
      const run=valley.truckRuns[i],service=fleet(route),plan=routeTrade(route);
      if(!run||!plan)continue;
      if(isRail(route)){
        if(run.segments.length)railServices.push({route,run,service,plan});
      }else{
        const stops=route.stations.map((station,side)=>{
          const key=window.contourStationKey(station);
          const yard=Boolean(data.stationLayouts?.[key]);
          const dock=yard?key+'/'+(ContourTown.stationBay(data,route,side)?.id??'1'):key;
          const industry=isIndustry(source(station));
          const internal=(run.extraTravel?.[side]??0)*.91/3.3;
          return {dock,industry,yard,sharedBay:yard||industry,
            reach:Math.max(yard?internal+.5:0,valley.stationApproaches?.get(key)??0)};
        });
        services.push({route,run,service,stops,plan});
      }
      for(const vehicle of service.vehicles){
        const receipt=receipts.get(vehicle);
        if(receipt){receipt.age+=dt;if(receipt.age>=3)receipts.delete(vehicle);}
      }
    }
    const loops=localRoutes.flatMap(route=>{
      const city=valley.towns.find(p=>p.id===route.city);
      return city&&route.events?.length>=2&&route.length&&route.path?.length>1&&validLoop(route)?
        [{route,city,service:fleet(route)}]:[];
    });
    // Reserve each bay approach separately. Shared stretches of road use physical traffic spacing.
    for(let left=dt;left>1e-7;left-=.10){
      const locks=new Map(),industryBays=new Map();
      for(const {route,run,service,stops} of services){
        const half=run.travel+bayTime,length=run.path.at(-1).length;
        for(const v of service.vehicles){
          const from=v.phase>=half?1:0,local=v.phase-from*half;
          const origin=stops[from],destination=stops[1-from];
          if(v.ready){
            if(v.industryLoading&&origin.sharedBay&&!industryBays.has(origin.dock))industryBays.set(origin.dock,v);
            continue;
          }
          if(destination.sharedBay&&local>=run.travel)industryBays.set(destination.dock,v);
          if(!origin.reach&&!destination.reach)continue;
          const distance=local>=run.travel?length:distanceAlongLane(run,from,local);
          if(origin.reach&&distance<origin.reach)locks.set(origin.dock,route);
          if(destination.reach&&length-distance<destination.reach&&(!destination.yard||local<run.travel))locks.set(destination.dock,route);
        }
      }
      const span=Math.min(.10,left),traffic=townTraffic(services,loops),crossings=gradeCrossings(services,loops,railServices);
      for(const entry of services)advanceRoute(entry,span,locks,industryBays,traffic,crossings);
      driveLocal(span,loops,traffic,crossings);
      advanceRail(railServices,span,crossings);
    }
  }
  function canUnload(route,vehicle,destination,plan){
    if(!isFreight(route))return true;
    const station=route.stations[destination],town=source(station);
    if(plan.cargo==='timber'&&!plan.to.depot){
      const yard=timberYard(station,town);
      const staged=yard?Math.max(0,Math.min(timberBuffer(town)-yard.timber,
        Math.floor((yard.splitCredit??0)+vehicle.load*districtShare(station,town)))):0;
      return vehicle.load<=timberBuffer(town)-timberMarket(town).stock+staged;
    }
    const {limit,stock,inbound}=freight.storage(town,plan.cargo);
    return vehicle.load<=Math.max(limit,stock+inbound)-stock;
  }
  function railResources(entry,from){
    const {route,run}=entry;
    const blocks=rail.blockKeys(run,from);
    const ends=route.stations.flatMap((station,side)=>{
      const block=side?run.blocks.at(-1):run.blocks[0];
      const key='station:'+stationKey(station),platform=route.platforms?.[side];
      const profile=block.profile?.[(side===0)===(block.direction===1)?'start':'end'];
      const platformKey=key+'/platform-'+(platform??1);
      if(profile){
        const lane=profile.layout.lanes.find(lane=>lane.index===(platform??1));
        const keys=[lane?platformKey:key+'/platform-1'];
        if(block.tracks===2){
          const direction=(from?1:-1)*block.direction;
          const offset=(lane?.offset??0)*profile.side;
          // A train crossing the centre of a double-track approach fouls the opposing running line.
          keys.push(key+'/throat/'+direction);
          if(offset*direction<0)keys.push(key+'/throat/'+(-direction));
        }
        return keys;
      }
      if(platform>1)return [platformKey];
      if(platform===1||block.tracks===1)return [platformKey+'/out',platformKey+'/in'];
      return [platformKey+(side===from?'/out':'/in')];
    });
    return [...blocks,...ends];
  }
  function advanceRail(entries,dt,crossings){
    const claims=new Map(),staged=[];
    for(const entry of entries){
      const {route,run,service,plan}=entry;
      const cargo=railCargo(route);
      for(const vehicle of service.vehicles.slice()){
        const motion=railState(vehicle),quote=railQuote(route,vehicle);
        if(!motion.active){
          staged.push({entry,vehicle,motion,quote,cargo});
          continue;
        }
        let crossingStop=false;
        if(motion.dwell>0){
          const next=motion.dwell+dt,destination=1-motion.from;
          if(next>=unloadTime&&vehicle.load){
            if(!formerDemand(plan)&&!canUnload(route,vehicle,destination,plan)){
              vehicle.waiting='storage';
              for(const key of railResources(entry,motion.from))claims.set(key,vehicle);
              continue;
            }
            arrival(route,vehicle,destination,run);
          }
          if(next>=bayTime){
            if(vehicle.retiring)removeFromFleet(service,vehicle);
            else{
              Object.assign(motion,{from:destination,distance:0,speed:0,dwell:0,active:false,waitAge:0});
              vehicle.ready=true;
              staged.push({entry,vehicle,motion,quote,cargo});
            }
            continue;
          }
          motion.dwell=next;
        }else{
          const previous=motion.distance;
          motion.travelElapsed=(motion.travelElapsed??0)+dt;
          const stop=crossings.trainLimit(route,run,vehicle,quote);
          const done=rail.advance(run,motion,quote,cargo,vehicle.load,dt,stop);
          crossingStop=Number.isFinite(stop)&&stop-motion.distance<1&&motion.speed<.6;
          const km=(motion.distance-previous)/1000;
          const expense=km*railRunningCost(vehicle.consist);
          bookRoute(service,'km',km);bookRoute(service,'expenses',expense);book('operating',expense);
          if(done){
            vehicle.unloaded=vehicle.load;
            motion.dwell=dt;
            motion.tracting=0;
            motion.braking=0;
          }
        }
        vehicle.waiting=crossingStop?'crossing':motion.stallTime>1&&motion.dwell===0?'traction':null;
        for(const key of railResources(entry,motion.from))claims.set(key,vehicle);
      }
    }
    // Older requests are considered first. Reserve the complete itinerary atomically.
    staged.sort((a,b)=>(b.motion.waitAge??0)-(a.motion.waitAge??0));
    for(const {entry,vehicle,motion,quote,cargo} of staged){
      const {route,run,plan,service}=entry,from=motion.from;
      vehicle.waiting=null;
      if(vehicle.retiring&&!vehicle.load){removeFromFleet(service,vehicle);continue;}
      if(vehicle.hold&&!vehicle.retiring&&!vehicle.load){vehicle.waiting='held';continue;}
      if(formerDemand(plan)&&!vehicle.load){vehicle.waiting='orders';continue;}
      if(!fitsPlatforms(route,quote)){vehicle.waiting='platform';continue;}
      if(!quote.valid||rail.estimate(vehicle.consist,cargo,run).stalled){vehicle.waiting='traction';continue;}
      const keys=railResources(entry,from);
      if(keys.some(key=>claims.has(key))){
        vehicle.waiting='signal';
        motion.waitAge=(motion.waitAge??0)+dt;
        continue;
      }
      const freight=isFreight(route);
      const wait=vehicle.retiring?null:freight?
        source(route.stations[from])===plan.from?loadFreight(route,vehicle,from,run,dt,plan):null:
        dispatchPassengers(route,vehicle,from);
      if(wait){vehicle.waiting=wait;continue;}
      if(freight&&!vehicle.load&&source(route.stations[from])===plan.from&&!vehicle.retiring){
        vehicle.waiting='orders';
        continue;
      }
      for(const key of keys)claims.set(key,vehicle);
      motion.active=true;
      motion.travelElapsed=0;
      motion.waitAge=0;
      vehicle.fillElapsed=0;
      vehicle.ready=false;
    }
  }
  function advanceRoute({route,run,service,stops,plan},dt,locks,industryBays,traffic,crossings){
    const elsewhere=stop=>stop.reach&&locks.has(stop.dock)&&locks.get(stop.dock)!==route;
    const half=run.travel+bayTime,length=run.path.at(-1).length;
    const gap=Math.min(truckGap,length/4);
    const lanes=[[],[]],occupied=[false,false];
    const hauling=isFreight(route),paused=formerDemand(plan);
    for(const v of [...service.vehicles]){
      const from=v.phase>=half?1:0,local=v.phase-from*half;
      v.waiting=null;
      if(local+1e-9<run.travel){
        lanes[from].push({v,local});
        continue;
      }
      const destination=1-from;
      const next=local+dt;
      if(next>=run.travel+unloadTime&&v.load){
        if(!paused&&!canUnload(route,v,destination,plan)){
          v.waiting='storage';
          occupied[destination]=true;
          continue;
        }
        arrival(route,v,destination,run);
        if(v.retiring){removeFromFleet(service,v);traffic.leave(v);continue;}
      }
      if(next>=half){
        v.phase=destination*half;
        v.ready=true;traffic.leave(v);
      }else{
        v.phase=from*half+next;
        occupied[destination]=true;
      }
    }
    // The outbound lane and inbound lane each keep their own front-to-back order.
    for(const [from,lane] of lanes.entries()){
      const destination=1-from;
      const originStop=stops[from],destinationStop=stops[destination];
      let ahead=Infinity;
      lane.sort((a,b)=>b.local-a.local);
      for(const {v,local} of lane){
        const oldDistance=distanceAlongLane(run,from,local);
        if(v.delay>0){v.delay=Math.max(0,v.delay-dt);continue;}
        const reserved=elsewhere(destinationStop);
        const bayBusy=occupied[destination]||destinationStop.sharedBay&&industryBays.has(destinationStop.dock);
        const limit=Math.min(reserved?Math.max(0,length-destinationStop.reach-gap):bayBusy?length-gap:length,ahead-gap);
        const crossingLimit=crossings.roadLimit(route,from,length,oldDistance);
        if(v.ready){
          if(crossingLimit<=1e-8){v.waiting='crossing';continue;}
          if(paused&&!v.load){v.waiting='orders';v.industryLoading=false;continue;}
          const owner=industryBays.get(originStop.dock);
          if((originStop.sharedBay?owner&&owner!==v:occupied[from])||
              (owner!==v&&elsewhere(originStop))||limit<=1e-9){v.waiting='traffic';continue;}
          const wait=v.retiring?null:hauling?
            source(route.stations[from])===plan.from?loadFreight(route,v,from,run,dt,plan):null:
            dispatchPassengers(route,v,from);
          if(originStop.industry){
            v.industryLoading=wait==='filling';
            if(v.industryLoading)industryBays.set(originStop.dock,v);
            else if(owner===v)industryBays.delete(originStop.dock);
          }
          if(wait){v.waiting=wait;continue;}
          v.fillElapsed=0;
          v.ready=false;
        }
        const target=Math.min(run.travel,local+dt);
        const desired=distanceAlongLane(run,from,target);
        let distance=Math.max(oldDistance,Math.min(desired,limit,crossingLimit));
        const before=mainPose(run,from,oldDistance),after=mainPose(run,from,distance);
        if(!trafficPass(v,traffic.canMove(route,v,before,after),dt,distance-oldDistance))distance=oldDistance;
        traffic.place(route,v,distance===oldDistance?before:after);
        const travel=distance>=length-1e-8?run.travel:
          distance+1e-8>=desired?target:departureTime(run,from,distance);
        const km=Math.max(0,distance-oldDistance)*.04;
        const expense=km*(hauling?90:65)*runningCostMultiplier;
        bookRoute(service,'km',km);bookRoute(service,'expenses',expense);book('operating',expense);
        v.phase=from*half+travel;
        if(originStop.reach&&distance<originStop.reach)locks.set(originStop.dock,route);
        if(destinationStop.reach&&length-distance<destinationStop.reach)locks.set(destinationStop.dock,route);
        if(travel===run.travel){
          // Entering the bay starts unloading. Delivery is booked when unloading ends.
          v.unloaded=v.load;
          occupied[destination]=true;
          if(destinationStop.sharedBay)industryBays.set(destinationStop.dock,v);
        }else if(distance+1e-8<desired){
          v.waiting=crossingLimit<=limit&&distance+1e-7>=crossingLimit?'crossing':reserved||bayBusy&&limit>=length-gap-1e-8?'bay':'traffic';
        }
        ahead=distance;
      }
    }
  }
  function settleLocal(route,vehicle,event,city,service){
    const cap=capacity(route);
    if(route.local==='delivery'){
      const cargo=localCargo(route),timber=cargo==='timber';
      const market=timber?timberMarket(city):freight.storage(city,cargo);
      const room=Math.max(0,(timber?timberBuffer(city):market.limit)-market.stock);
      if(event.stop===undefined){
        if(vehicle.retiring){
          changeYardStock(route.hub,cargo,vehicle.load);
          vehicle.load=0;
          return;
        }
        const count=Math.min(cap-vehicle.load,room,localStock(route));
        takeLocalStock(route,city,count);
        vehicle.load+=count;
        return;
      }
      const hub=townNetwork.hubStations(valley,city).get(route.hub);
      const direct=new Set(hub&&!localDepot(city,route.hub,cargo)?catchment(hub,city).map(l=>l.id):[]);
      const reach=localCatchment(route,city,route.stops[event.stop]).filter(l=>!direct.has(l.id)).length;
      const count=Math.min(vehicle.load,cargoNeed(city,cargo,reach),room);
      if(timber){
        market.stock+=count;
        const received=state.received[city.id]??={timber:0,passengers:0};
        received.timber+=count;
      }else freight.deliver(city,cargo,count,0);
      vehicle.load-=count;
      payLocal(service,vehicle,count,65);
      return;
    }
    if(event.stop===undefined){
      const ids=vehicle.passengers??=[];
      let dropped=0;
      for(let i=ids.length-1;i>=0;i--){
        const person=people[ids[i]];
        if(person?.localDrop)continue;
        if(person)joinQueue(person,route.hub,city.id);
        ids.splice(i,1);dropped++;
      }
      vehicle.load=ids.length;
      payLocalPassengers(service,vehicle,dropped,city);
      if(!vehicle.retiring)board(vehicle,route.hub,p=>route.stops.some(stop=>stopKey(city.id,stop)===p.localDrop),cap);
      return;
    }
    const key=stopKey(city.id,route.stops[event.stop]);
    const ids=vehicle.passengers??=[];
    let dropped=0;
    for(let i=ids.length-1;i>=0;i--){
      const person=people[ids[i]];
      if(person?.localDrop!==key)continue;
      if(person.returning)delete people[person.id];
      else Object.assign(person,{localDrop:null,visitStop:key,visitUntil:state.tripTick+4});
      ids.splice(i,1);dropped++;
    }
    vehicle.load=ids.length;
    payLocalPassengers(service,vehicle,dropped,city);
    if(!vehicle.retiring)board(vehicle,key,p=>p.hub===route.hub,cap);
  }
  function payLocalPassengers(service,vehicle,count,city){
    if(!count)return;
    const trips=serviceHistory.localTrips;
    trips[city.id]=(trips[city.id]??0)+count;
    payLocal(service,vehicle,count,20);
  }
  function payLocal(service,vehicle,count,rate){
    if(!count)return;
    const pay=count*rate;
    bookRoute(service,'delivered',count);bookRoute(service,'revenue',pay);book('revenue',pay);
    receipts.set(vehicle,{pay,age:0});
  }
  function validLoop(route){
    if(route.local==='delivery'){
      const city=valley.towns.find(p=>p.id===route.city);
      return Boolean(city&&cargoDemand(city,localCargo(route)));
    }
    return route.local!=='bus'||Boolean(townNetwork?.hubServices(valley,kind).get(route.hub)?.has('bus'));
  }
  function resetLocalFleet(route,nextHub=route.hub){
    const city=valley.towns.find(p=>p.id===route.city);
    const stock=townNetwork.hubStock(valley,route.hub);
    for(const [i,vehicle] of fleet(route).vehicles.entries()){
      if(route.local==='delivery')changeYardStock(route.hub,localCargo(route),vehicle.load);
      else for(const [dest,n] of Object.entries(vehicle.riders??{})){
        if(nextHub===route.hub&&validLoop(route))stock.riders[dest]=(stock.riders[dest]??0)+n;
        else if(city){
          const previousStop=route.events[(vehicle.next??0)-1]?.stop;
          const stop=route.stops[previousStop??0];
          const home=(stop&&localCatchment(route,city,stop)[0])??homes(city)[0];
          if(home){const queue=orders(city,home);queue[dest]=(queue[dest]??0)+n;}
        }
      }
      for(const id of vehicle.passengers??[])if(people[id])joinQueue(people[id],route.hub,route.city);
      vehicle.passengers=[];
      receipts.delete(vehicle);
      Object.assign(vehicle,{phase:0,load:0,ready:true,delay:Math.min(i*2,8),next:0,riders:{},trafficWait:0,trafficClearance:0});
    }
  }
  function driveLocal(dt,loops,traffic,crossings){
    for(const {route,city,service} of loops){
      for(const vehicle of [...service.vehicles]){
        vehicle.waiting=null;
        const receipt=receipts.get(vehicle);
        if(receipt){receipt.age+=dt;if(receipt.age>=3)receipts.delete(vehicle);}
        let left=dt;
        while(left>1e-7){
          if(vehicle.delay>0){const span=Math.min(left,vehicle.delay);vehicle.delay-=span;left-=span;continue;}
          const next=route.events[vehicle.next??0];
          const speed=localSpeed(route);
          const desired=Math.min(Math.max(0,next.distance-vehicle.phase),left*speed);
          const limit=crossings.roadLimit(route,0,route.length,vehicle.phase);
          const length=Math.min(desired,Math.max(0,limit-vehicle.phase));
          const before=localPose(route,vehicle.phase),after=localPose(route,vehicle.phase+length);
          const spawning=!vehicle.phase&&!vehicle.next;
          if(spawning&&limit<=1e-8){vehicle.waiting='crossing';break;}
          const clear=spawning?traffic.canEnter(vehicle,before):traffic.canMove(route,vehicle,before,after);
          if(!trafficPass(vehicle,clear,left,length)){
            vehicle.waiting='traffic';break;
          }
          vehicle.phase+=length;left-=length/speed;
          traffic.place(route,vehicle,after);
          const km=length*.04,expense=km*(route.local==='delivery'?80:63)*runningCostMultiplier;
          bookRoute(service,'km',km);bookRoute(service,'expenses',expense);book('operating',expense);
          if(length+1e-7<desired){vehicle.waiting='crossing';break;}
          if(vehicle.phase+1e-7<next.distance)break;
          settleLocal(route,vehicle,next,city,service);
          if(vehicle.retiring&&!vehicle.load){removeFromFleet(service,vehicle);traffic.leave(vehicle);break;}
          vehicle.delay=localDwell;
          vehicle.next=((vehicle.next??0)+1)%route.events.length;
          if(!vehicle.next){vehicle.phase=0;vehicle.next=1;traffic.place(route,vehicle,localPose(route,0));}
        }
      }
    }
  }
  function staged(index,vehicle){
    if(isRail(data.routes[index]))return vehicle.ready&&!railState(vehicle).active&&!vehicle.load;
    const half=valley.truckRuns[index].travel+bayTime;
    return vehicle.ready&&!vehicle.industryLoading&&(vehicle.phase===0||vehicle.phase===half);
  }
  function removeFromFleet(service,vehicle){
    const index=service.vehicles.indexOf(vehicle);
    if(index>=0)service.vehicles.splice(index,1);
  }
  function retireVehicle(route,selected){
    const service=fleet(route);
    const candidates=service.vehicles.filter(v=>!v.retiring);
    const vehicle=selected?candidates.find(v=>v===selected):candidates.findLast(v=>!v.load)??candidates.at(-1);
    if(!vehicle)return false;
    if(!vehicle.load&&(!isRail(route)||!railState(vehicle).active))removeFromFleet(service,vehicle);
    else if(route.local==='delivery'&&!validLoop(route)){
      changeYardStock(route.hub,localCargo(route),vehicle.load);
      removeFromFleet(service,vehicle);
    }
    else if(route.local==='bus'&&!validLoop(route)){
      for(const id of vehicle.passengers??[]){
        if(people[id])joinQueue(people[id],route.hub,route.city);
      }
      removeFromFleet(service,vehicle);
    }else vehicle.retiring=true;
    return true;
  }
  function releaseRouteLoads(route,index){
    const plan=routeTrade(route);
    if(!plan)return;
    const run=valley.truckRuns[index];
    for(const vehicle of fleet(route).vehicles){
      if(!vehicle.load)continue;
      const count=vehicle.load;
      if(plan.cargo==='passengers'){
        const side=vehicleSide(route,vehicle,run),origin=route.stations[side],destination=source(route.stations[1-side]);
        const stop=passengerStop(destination),hub=stationKey(origin);
        stop.inbound=Math.max(0,stop.inbound-count);
        const alternative=data.routes.some(other=>other!==route&&routeTrade(other)?.cargo==='passengers'&&
          fleet(other).vehicles.some(v=>!v.retiring)&&other.stations.some((station,i)=>
            stationKey(station)===hub&&source(other.stations[1-i])===destination));
        for(const id of vehicle.passengers??[]){
          const person=people[id];if(!person)continue;
          delete person.intercity;
          if(alternative)joinQueue(person,hub,source(origin).id);
          else abandonTrip(person);
        }
      }else if(plan.cargo==='timber'&&!plan.to.depot){
        const market=timberMarket(plan.to);
        market.inbound=Math.max(0,market.inbound-count);
        state.stock+=count;
      }else if(plan.from===mill){
        freight.deliver(plan.to,plan.cargo,0,count);
        state.stock+=count;
      }else freight.returnLoad(plan.from,plan.to,plan.cargo,count);
    }
  }
  function copyConsist(consist){
    return {locomotives:[...consist.locomotives],cars:[...consist.cars]};
  }
  function consistEditPrice(route,vehicle,consist){
    if(!isRail(route))return Infinity;
    const cargo=railCargo(route),newQuote=rail.quote(consist,cargo);
    if(!newQuote.valid||!fitsPlatforms(route,newQuote))return Infinity;
    const current=railQuote(route,vehicle);
    if(!current.valid)return newQuote.price;
    let unchanged=0;
    for(const [group,catalog] of [['locomotives',rail.locomotives],['cars',rail.cars]]){
      const available=[...vehicle.consist[group]];
      for(const id of consist[group]){
        const index=available.indexOf(id);
        if(index<0)continue;
        available.splice(index,1);
        unchanged+=catalog[id].price;
      }
    }
    return Math.max(0,Math.round(newQuote.price-unchanged-.75*(current.price-unchanged)));
  }
  function setConsist(route,vehicle,consist){
    if(!isRail(route)||!fleet(route).vehicles.includes(vehicle)||!railStatus(route,vehicle).canEdit)return false;
    const cost=consistEditPrice(route,vehicle,consist);
    if(cost>state.cash)return false;
    if(cost)book('capital',cost);
    vehicle.consist=copyConsist(consist);
    return true;
  }
  function setRailHold(route,vehicle,hold){
    if(!isRail(route)||!fleet(route).vehicles.includes(vehicle)||vehicle.retiring)return false;
    vehicle.hold=Boolean(hold);
    return true;
  }
  function railStatus(route,vehicle){
    if(!isRail(route))return null;
    const motion=railState(vehicle),quote=railQuote(route,vehicle);
    const run=valley.truckRuns[data.routes.indexOf(route)];
    const {grade,curveRadius}=run?.segments?.length?rail.conditions(run,motion):{grade:0,curveRadius:Infinity};
    return {speed:motion.speed*3.6,grade:grade*100,curveRadius,tracting:motion.tracting??0,braking:motion.braking??0,
      waiting:vehicle.waiting,hold:Boolean(vehicle.hold),canEdit:!motion.active&&!vehicle.load&&!vehicle.retiring,capacity:quote.capacity,
      mass:rail.massFor(quote,railCargo(route),vehicle.load)};
  }
  function purchase(r,consist){
    if(isRail(r)){
      const cargo=railCargo(r);
      const selected=consist??rail.defaultConsist(cargo);
      const quote=rail.quote(selected,cargo);
      if(!quote.valid||!fitsPlatforms(r,quote)||state.cash<quote.price)return false;
      book('capital',quote.price);
      const vehicles=fleet(r).vehicles;
      const from=vehicles.length%2;
      const vehicle={phase:0,load:0,ready:true,consist:copyConsist(selected)};
      railState(vehicle).from=from;
      vehicles.push(vehicle);
      return true;
    }
    if(state.cash<vehiclePrice)return false;
    book('capital',vehiclePrice);
    const vehicles=fleet(r).vehicles;
    vehicles.push({phase:0,load:0,ready:true,delay:Math.min(vehicles.length*2,8)});
    return true;
  }
  for(const [index,route] of data.routes.entries()){
    connect(route);
    if(previous&&kind(route)==='Timber'){
      const [a,b]=route.stations.map(source),city=a===mill?b:a;
      if(city&&city!==mill)timberMarket(city).inbound+=fleet(route).vehicles.reduce((total,v)=>total+v.load,0);
    }
    if(kind(route)==='Passengers'){
      for(const vehicle of fleet(route).vehicles){
        for(const id of vehicle.passengers??[])if(people[id])people[id].intercity=true;
        if(!migratePassengers||!vehicle.load)continue;
        const dest=source(route.stations[1-vehicleSide(route,vehicle,valley.truckRuns[index])]);
        if(dest)passengerStop(dest).inbound+=vehicle.load;
      }
    }
  }
  if(!satisfaction.initialized||!satisfaction.passengerOutcomes){
    for(const city of valley.towns){
      const lots=homes(city),entries=townSatisfaction(city),goods=townGoods(city);
      if(!satisfaction.passengerOutcomes){
        entries.trips={};
        for(const entry of Object.values(homeBalances(city)))delete entry.passengers;
      }
      for(let week=Math.max(0,state.week-serviceWindow);week<state.week;week++){
        if(!satisfaction.initialized)for(const {cargo,demand} of goods){
          const sample=hudHistory.goods[week]?.[city.id]?.[cargo];
          if(sample||entries.goods[cargo])updateSatisfaction(entries.goods,cargo,demand,sample?.completed??0);
        }
        updateTownTrips(city,week);
        updateHomeBalances(city,lots,week,!satisfaction.initialized);
      }
    }
    satisfaction.initialized=true;
    satisfaction.passengerOutcomes=true;
  }
  return {state,source,trade,trades,depots,townServices,industryPulse,depotCargoLocked,setDepotCargo,routeTrade,formerDemand,isIndustry,isFreight,freight,homes,orders,townTotals,catchment,coverage,homeSatisfaction,cityServiceRate,serviceTotals,kind,fleet,routeThroughput,financeMonths,step,purchase,setConsist,setRailHold,consistEditPrice,railStatus,railRunningCost,vehicleCapacity,retireVehicle,releaseRouteLoads,vehiclePrice,radius,receipts,
    stockLimit,millUpgradeDemand,weekSeconds,weeklyDemand,townProgress,serviceWindow,serviceGraceWeeks,timberMarket,timberOpen,capacity,connect,book,productionLimit,productionEfficiency,weeklyMillOrders,timberBuffer,passengerStop,passengerBuffer,weeklyVisits,isActive,staged,localRoutes,localCatchment,localPose,validLoop,resetLocalFleet,localCargo,localCargoOptions,localStock,yardStock,waitingAt,stopKey,walkingTo:key=>Object.values(people).filter(person=>person.walk?.queue===key).length,walkers:()=>Object.values(people).filter(person=>person.walk).map(walkPosition)};
};
