window.ContourFreight=function({state,industries,homes,level,weekSeconds}){
  const {goods}=ContourRegion;
  const data=state.freight??={sites:{},towns:{}};
  function siteStock(site){
    return data.sites[site.id]??={output:0,inputs:{},inbound:{},produced:0,lastProduced:0};
  }
  function townStock(town,cargo){
    const account=data.towns[town.id]??={};
    return account[cargo]??={stock:0,inbound:0,used:0,lastUsed:0,monthlyUsed:0};
  }
  function weeklyDemand(town,cargo,reachableHomes){
    return ContourRegion.townWeeklyDemand(town,cargo,level(town),homes(town).length,reachableHomes);
  }
  const depotStore=place=>siteStock(place);
  const available=(from,cargo)=>from.depot?depotStore(from).inputs[cargo]??0:siteStock(from).output;
  function accepts(to,cargo){
    if(to.depot)return to.cargos.includes(cargo);
    return to.output?Boolean(to.inputs[cargo]):weeklyDemand(to,cargo)>0;
  }
  function storage(to,cargo){
    if(to.depot){
      const site=depotStore(to);
      return {stock:site.inputs[cargo]??0,inbound:site.inbound[cargo]??0,limit:to.limit};
    }
    if(to.output){
      const site=siteStock(to),limit=to.limit*to.inputs[cargo]*3;
      return {stock:site.inputs[cargo]??0,inbound:site.inbound[cargo]??0,limit};
    }
    const town=townStock(to,cargo);
    return {stock:town.stock,inbound:town.inbound,limit:weeklyDemand(to,cargo)*3};
  }
  function orders(to,cargo,travel,reachableHomes){
    const {limit,stock,inbound}=storage(to,cargo);
    const target=to.output||to.depot?limit:Math.min(limit,Math.ceil(weeklyDemand(to,cargo,reachableHomes)*(1+travel/weekSeconds)));
    return {order:Math.max(0,target-stock-inbound),room:Math.max(0,limit-stock-inbound)};
  }
  function take(from,cargo,count){
    if(!count)return;
    if(from.depot)depotStore(from).inputs[cargo]-=count;
    else{
      const inventory=siteStock(from);
      inventory.output-=count;
      inventory.pickedUp=(inventory.pickedUp??0)+count;
    }
  }
  function reserve(to,cargo,count){
    if(!count)return;
    if(to.output||to.depot){
      const {inbound}=siteStock(to);
      inbound[cargo]=(inbound[cargo]??0)+count;
    }else townStock(to,cargo).inbound+=count;
  }
  function deliver(to,cargo,count,reserved=count){
    if(to.output||to.depot){
      const {inputs,inbound}=siteStock(to);
      inputs[cargo]=(inputs[cargo]??0)+count;
      inbound[cargo]=Math.max(0,(inbound[cargo]??0)-reserved);
    }else{
      const town=townStock(to,cargo);
      town.stock+=count;town.inbound=Math.max(0,town.inbound-reserved);
    }
  }
  function returnLoad(from,to,cargo,count){
    deliver(to,cargo,0,count);
    const inventory=siteStock(from);
    if(from.depot)inventory.inputs[cargo]=(inventory.inputs[cargo]??0)+count;
    else inventory.output+=count;
  }
  function supplyWeek(services){
    const connected=new Set(services.filter(service=>accepts(service.to,service.cargo)).map(service=>service.from.id));
    for(const site of industries){
      if(site.id==='sawmill')continue;
      const inventory=siteStock(site),inputs=Object.entries(site.inputs);
      const picked=inventory.pickedUp??0;
      inventory.lastPickup={picked,available:picked+inventory.output};
      inventory.pickedUp=0;
      const produced=connected.has(site.id)?Math.max(0,Math.min(site.limit,site.limit*3-inventory.output,
        ...inputs.map(([cargo,amount])=>Math.floor((inventory.inputs[cargo]??0)/amount)))):0;
      for(const [cargo,amount] of inputs)inventory.inputs[cargo]=(inventory.inputs[cargo]??0)-amount*produced;
      inventory.output+=produced;inventory.lastProduced=produced;inventory.produced+=produced;
    }
  }
  function consumeWeek(town,lastWeekOfMonth,reachableHomes,onConsumption){
    for(const [cargo,entry] of Object.entries(data.towns[town.id]??{})){
      const availableDemand=Math.min(entry.stock,weeklyDemand(town,cargo));
      const amount=availableDemand?Math.min(availableDemand,weeklyDemand(town,cargo,reachableHomes(cargo))):0;
      if(amount)onConsumption?.(cargo,amount);
      entry.stock-=amount;entry.used+=amount;entry.monthlyUsed+=amount;
      if(lastWeekOfMonth){entry.lastUsed=entry.monthlyUsed;entry.monthlyUsed=0;}
    }
  }
  function townGoods(town){
    return Object.entries(goods).filter(([cargo])=>cargo!=='timber'&&ContourRegion.acceptsTownCargo(town,cargo)).map(([cargo,[name,,unlock]])=>{
      const demand=weeklyDemand(town,cargo),stock=data.towns[town.id]?.[cargo];
      return {cargo,name,unlock,demand,stock:stock?.stock??0,inbound:stock?.inbound??0,lastUsed:stock?.lastUsed??0};
    });
  }
  return {siteStock,weeklyDemand,accepts,orders,storage,available,take,reserve,deliver,returnLoad,supplyWeek,consumeWeek,townGoods};
};
