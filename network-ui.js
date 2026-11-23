window.createNetworkUI=function({getValley,focus,redraw,zoom,pause,resumeState,save,restart,stationDepot,editStation,switchRegion,getSpeed,setSpeed,buildRoute,editTown,deleteLoop,deleteRoute}){
  const el=id=>document.getElementById(id), panel=el('networkPanel'),body=el('panelBody'),footer=el('panelFooter');
  const months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  let view='',overlay='routes',routeIndex=0,filter='',type='',listScroll=0,townId='';
  const cash=n=>Math.round(n).toLocaleString('en-GB')+' cr';
  const profit=period=>period.revenue-period.expenses;
  let routeChoices=[],selectedStop,selectedHome,labels=true,financeEnd=null,financeRange=0,financeView='finances',statsTown='';
  const inspectors=new Set(['town','mill','detail','stop','home']);
  function node(tag,text,cls){
    const n=document.createElement(tag);n.textContent=text;if(cls)n.className=cls;return n;
  }
  function button(text,fn,cls){
    const b=node('button',text,cls);b.onclick=fn;return b;
  }
  function row(title,value){const n=node('div','','ledger');n.append(node('span',title),node('strong',value));return n;}
  const hud=ContourHUD;
  function stats(...items){
    const grid=node('div','','inspectorStats');
    for(const [name,value,tone,description] of items){
      const cell=node('div','','inspectorStat');
      if(description)cell.title=description;
      cell.append(node('strong',value,tone),node('span',name));grid.append(cell);
    }
    return grid;
  }
  function meter(name,rate,{color,cargo,value,label=name}={}){
    const item=node('div','','inspectorMeter');
    const caption=node('span','','inspectorMeterLabel');
    if(cargo)caption.append(hud.icon(cargo));
    caption.append(document.createTextNode(name));
    const track=node('progress','');track.max=1;track.value=rate??0;
    track.setAttribute('aria-hidden','true');
    if(color||cargo)item.style.setProperty('--meter-color',color??hud.color(cargo));
    if(rate==null)item.dataset.pending='';
    const shown=value??hud.percent(rate);
    item.title=label+' · '+(rate==null&&value==null?'No recent data':shown);
    item.append(caption,node('strong',shown),track);
    if(label!==name)caption.setAttribute('aria-label',label);
    return item;
  }
  function meters(...items){
    const group=node('div','','inspectorMeters');group.append(...items);return group;
  }
  function cargoChip(cargo,value){
    const chip=node('span','','inspectorCargoChip');
    chip.append(hud.icon(cargo),node('strong',value));
    chip.title=hud.cargoLabel(cargo)+' · '+value;
    chip.setAttribute('aria-label',chip.title);
    return chip;
  }
  const routeCargo=(m,r)=>r.local==='delivery'?m.localCargo(r):m.routeTrade(r)?.cargo??'passengers';
  function open(next,fromHistory=false){
    if(!fromHistory){
      if(next&&!view)history.pushState({networkPanel:true},'','');
      else if(!next&&view&&history.state?.networkPanel)history.replaceState(null,'','');
    }
    if(view==='routes')listScroll=body.scrollTop;
    view=next;render();redraw();if(next==='routes')body.scrollTop=listScroll;else body.scrollTop=0;
  }
  function sites(valley){
    return [...(valley.industries??[valley.industry]),...valley.market.depots()];
  }
  function inspectPlace(id,center=false){
    townId=id;
    if(center)focus(id);
    open(getValley().market.isIndustry(sites(getValley()).find(place=>place.id===id))?'mill':'town');
  }
  function inspectRoute(index){routeIndex=index;open('detail');}
  function inspectRoutes(indices){
    if(indices.length===1){inspectRoute(indices[0]);return;}
    routeChoices=indices;
    open('routeChoice');
  }
  function routeName(r){return r.local?r.stations[0].name+(r.local==='bus'?' bus loop':' delivery loop'):r.stations.map(s=>s.name).join(' ↔ ');}
  function picker(values,selected,fn,label){
    const s=document.createElement('select');s.setAttribute('aria-label',label);
    for(const [value,name] of values)s.add(new Option(name,value));s.value=selected;s.onchange=()=>fn(s.value);return s;
  }
  function clock(){
    const market=getValley()?.market;
    if(!market)return;
    const week=market.state.week,month=Math.floor(week/4);
    const date=months[month%12]+' · W'+(week%4+1)+' / 4';
    if(el('calendar').textContent!==date){
      el('calendar').textContent=date;
      el('calendar').title='Year '+(Math.floor(month/12)+1)+' · week '+(week+1);
      el('calendar').setAttribute('aria-label',el('calendar').title+' · '+date);
    }
    const speed=el('speed');
    speed.textContent=resumeState()?getSpeed()+'×':'▶';
    speed.setAttribute('aria-label',resumeState()?'Game speed '+getSpeed()+' times. Tap to change.':'Resume simulation');
  }
  function monthLabel(month){
    return months[month%12]+' Y'+(Math.floor(month/12)+1);
  }
  function historyChart(title,samples,series,label,format,ceiling){
    const figure=node('figure','','financeChart');
    const caption=node('figcaption',title);
    const date=node('small','','chartDate');
    const legend=node('div','','chartLegend');
    const values=series.map(([,color])=>{
      const item=node('span','');
      item.style.color=color;legend.append(item);
      return item;
    });
    const canvas=node('canvas','');
    canvas.tabIndex=0;
    canvas.setAttribute('role','img');
    function showSample(sample){
      date.textContent=label(sample);
      series.forEach(([key,,name],index)=>{
        const value=sample[key];
        values[index].textContent=name+' '+(value==null?'—':format(value));
      });
      canvas.setAttribute('aria-label',title+', '+label(sample)+'. '+values.map(item=>item.textContent).join(', ')+'. Use arrow keys to browse.');
    }
    showSample(samples.at(-1));
    figure.append(caption,date,legend,canvas);body.append(figure);
    drawFinanceChart(canvas,samples,series,label,ceiling,showSample);
  }
  function finance(valley){
    const m=valley.market;
    const tabs=node('div','','financeTabs');
    tabs.setAttribute('aria-label','Company history');
    for(const [key,name] of [['finances','Finances'],['satisfaction','Satisfaction'],['trips','Trips']]){
      const tab=button(name,()=>{financeView=key;render();body.scrollTop=0;});
      tab.setAttribute('aria-pressed',String(financeView===key));
      tabs.append(tab);
    }
    body.append(tabs);
    if(financeView!=='finances'){townHistory(valley);return;}

    const {history,current}=m.state.finance;
    const all=[...history,{...current,cash:m.state.cash,week:m.state.week}];
    const monthly=financeRange===0;
    const controls=node('div','','financeControls');
    const range=picker([['0','All time'],['24','24 weeks'],['52','52 weeks'],['104','104 weeks']],
      String(financeRange),value=>{financeRange=Number(value);financeEnd=null;render();},'History range');
    let samples,label;
    if(monthly){
      controls.classList.add('fullRange');controls.append(range);
      samples=m.financeMonths();
      label=sample=>monthLabel(sample.month);
    }else{
      const firstEnd=Math.min(all.length,financeRange);
      const cutoff=financeEnd===null?-1:all.findIndex(sample=>sample.week>financeEnd);
      const end=Math.max(firstEnd,cutoff<0?all.length:cutoff);
      const start=Math.max(0,end-financeRange);
      const earlier=button('Earlier',()=>{financeEnd=all[Math.max(firstEnd,start)-1].week;render();});
      const later=button('Later',()=>{const next=end+financeRange;financeEnd=next>=all.length?null:all[next-1].week;render();});
      earlier.disabled=start===0;later.disabled=end===all.length;
      controls.append(earlier,range,later);
      samples=all.slice(start,end);
      label=sample=>'W'+(sample.week+1);
    }
    body.append(controls);
    const first=samples[0],last=samples.at(-1),live=last.week===m.state.week;
    const period=monthly?'month':'week';
    const totals=monthly?samples.reduce((sum,sample)=>{
      sum.revenue+=sample.revenue;sum.operating+=sample.operating;sum.capital+=sample.capital;
      return sum;
    },{revenue:0,operating:0,capital:0}):last;
    body.append(node('small',label(first)+' – '+label(last)+(live?' · current '+period+' in progress':''),
      'historyNote'));
    if(monthly&&(first.firstWeek??0)>0){
      body.append(node('small','Records start at week '+(first.firstWeek+1)+'. Earlier weeks were dropped by a previous version.','historyNote'));
    }
    body.append(row(monthly?'Recorded revenue':live?'Revenue this week':'Revenue · '+label(last),cash(totals.revenue)),
      row(monthly?'Recorded running costs':'Running costs'+(live?' this week':' · '+label(last)),cash(totals.operating)),
      row(monthly?'Recorded investment':'Investment'+(live?' this week':' · '+label(last)),cash(totals.capital)));
    const sections=[
      ['Cash balance',[['cash','#b5e39d','Cash']]],
      [monthly?'Monthly trading':'Weekly trading',[['revenue','#b5e39d','Revenue'],['operating','#f5ae9d','Running costs']]],
      [monthly?'Monthly investment':'Weekly investment',[['capital','#efc879','Roads and vehicles']]],
    ];
    for(const [title,series] of sections)historyChart(title,samples,series,label,cash);
  }
  function townHistory(valley){
    const {months:records,firstMonth}=valley.market.state.serviceHistory;
    const trips=financeView==='trips';
    const towns=valley.towns.map(town=>[town.id,town.name]);
    if(trips)towns.unshift(['','All towns']);
    const selected=towns.some(([id])=>id===statsTown)?statsTown:towns[0][0];
    const controls=node('div','','financeControls fullRange');
    controls.append(picker(towns,selected,value=>{statsTown=value;render();},'Town'));
    body.append(controls);
    if(!records.length){
      body.append(node('p','The first reading will be available after '+monthLabel(firstMonth)+'.','inspectorNotice'));
      return;
    }
    const samples=records.map(({month,towns})=>{
      const values=selected?towns[selected]:Object.values(towns).reduce((sum,town)=>{
        sum.intercity+=town.intercity;sum.local+=town.local;return sum;
      },{intercity:0,local:0});
      return {month,...values};
    });
    const label=sample=>monthLabel(sample.month);
    body.append(node('small',label(samples[0])+' – '+label(samples.at(-1))+' · completed months','historyNote'));
    if(trips){
      historyChart('Passenger journeys per month',samples,[['intercity','#b5e39d','Intercity arrivals'],
        ['local','#89d6dc','Local bus legs']],label,n=>n.toLocaleString('en-GB'));
      body.append(node('small','Intercity trips count at the town where passengers arrive. Each completed bus leg counts separately.','historyNote'));
    }else{
      const cargo=valley.region?['starter','#efc879','Starter goods']:['timber','#efc879','Timber'];
      historyChart('Satisfaction at month end',samples,[['passengers','#89d6dc','Passengers'],cargo],label,n=>n+'%',100);
      body.append(node('small',valley.region?'Starter satisfaction weights both starter goods equally. Earlier months may have no starter reading.':
        'Satisfaction is sampled at month end.','historyNote'));
    }
  }
  function replaceContent(container,content){
    const old=container.firstChild;
    if(!old?.isEqualNode(content))container.replaceChildren(content);
  }
  function renderInspector(valley){
    const m=valley.market;
    const routes=[...valley.transport.routes,...m.localRoutes];
    const key=view+':'+(view==='detail'?routeIndex:view==='stop'?selectedStop.key:view==='home'?[selectedHome.cityId,selectedHome.lotId,selectedHome.service].join(':'):townId);
    if(body.dataset.inspector!==key){
      body.dataset.inspector=key;
      const main=node('div','','inspectorOverview');
      const more=node('details','','inspectorMore');
      more.append(node('summary','More data'),node('div','','inspectorData'));
      body.replaceChildren(main,more);
      const back=button('‹ '+(view==='detail'?'Routes':'Places'),()=>open(view==='detail'?'routes':'towns'),'inspectorBack');
      footer.replaceChildren(...(view==='stop'||view==='home'?[]:[back]));
      if(view==='detail'){
        const route=routes[routeIndex];
        const kind=m.isFreight(route)?'truck':'bus';
        footer.append(button('Add '+kind+' · '+cash(m.vehiclePrice),()=>{
          m.purchase(route);save();render();
        },'buy'),button('Remove '+kind,()=>{
          m.retireVehicle(route);save();redraw();render();
        },'removeVehicle'));
        if(!route.local&&m.isFreight(route)){
          const select=picker([['0','Leave immediately'],['0.25','Up to ¼ week'],['0.5','Up to ½ week'],
            ['1','Up to 1 week'],['2','Up to 2 weeks'],['full','Until full']],
            String(route.fillWait??0),value=>{
              route.fillWait=value==='full'?value:Number(value);
              for(const v of m.fleet(route).vehicles)v.fillElapsed=0;
              save();
            },'Industry loading policy');
          const policy=node('label','Loading policy ','loadingPolicy');
          policy.append(select);body.insertBefore(policy,more);
        }
        if(route.local)footer.append(
          button('Edit loop',()=>{open('');editTown(route.local,route.city,route);},'loopAction'),
          button('Delete loop',()=>open('deleteLoop'),'loopAction'));
        else footer.append(button('Remove route',()=>open('removeRoute'),'loopAction'));
      }else if(view==='town')footer.append(button('Add roads',()=>{const id=townId;open('');editTown('roads',id);},'buy'));
      else if(view==='stop'&&selectedStop.platform.station){
        const station=selectedStop.platform.station;
        footer.append(button('Edit station',()=>{open('');editStation(station);},'buy'));
        if(valley.region){
          const hub=ContourTown.stationKey(station);
          const depot=m.source(station)?.depot||m.depots().some(site=>site.hubKey===hub);
          const action=button(depot?'Open trading depot':'Add trading depot · 18,000 cr',()=>{
            const site=stationDepot(station);
            if(site)inspectPlace(site.id);
          },'loopAction');
          action.disabled=!depot&&m.state.cash<18000;footer.append(action);
        }
      }else if(view==='mill'){
        const site=sites(valley).find(place=>place.id===townId);
        if(site?.depot)body.append(depotCargoControls(m,site));
      }
    }
    const overview=node('div','');
    const data=node('div','');
    if(view==='detail')routeInspector(valley,overview,data);
    if(view==='town')townInspector(valley,overview,data);
    if(view==='mill')industryInspector(valley,sites(valley).find(site=>site.id===townId),overview,data);
    if(view==='stop')stopInspector(valley,overview,data);
    if(view==='home')homeInspector(valley,overview,data);
    replaceContent(body.querySelector('.inspectorOverview'),overview);
    replaceContent(body.querySelector('.inspectorData'),data);
  }
  function routeInspector(valley,overview,data){
    const m=valley.market,r=[...valley.transport.routes,...m.localRoutes][routeIndex],s=m.fleet(r);
    const freight=m.isFreight(r),noun=freight?'truck':'bus',plural=freight?'trucks':'buses';
    const retiring=s.vehicles.filter(v=>v.retiring).length;
    const count=s.vehicles.length,onBoard=s.vehicles.reduce((n,v)=>n+v.load,0);
    const blocked=s.vehicles.filter(v=>v.waiting==='storage').length;
    const waiting=s.vehicles.filter(v=>v.waiting==='orders').length;
    const filling=s.vehicles.filter(v=>v.waiting==='filling').length;
    const waitingInputs=s.vehicles.filter(v=>v.waiting==='inputs').length;
    const queued=s.vehicles.filter(v=>(r.local||!m.staged(routeIndex,v))&&(v.waiting==='bay'||v.waiting==='traffic')).length;
    const last=s.lastMonth,net=last?profit(last):null;
    const signed=n=>(n>0?'+':n<0?'−':'')+cash(Math.abs(n));
    const {actual,potential}=m.routeThroughput(r,routeIndex);
    const service=node('div','','inspectorContext inspectorService');
    service.append(hud.icon(routeCargo(m,r)),document.createTextNode(m.kind(r)+' · '+(r.local?'Local':'Intercity')));
    overview.append(service,stats(['Last month’s profit',net===null?'—':signed(net),net==null?'':net<0?'negative':'positive'],
      ['Fleet',count+' '+(count===1?noun:plural)]),
      meters(meter('Monthly throughput',actual==null||!potential?null:actual/potential,{value:(actual??'—')+' / '+Math.round(potential)}),
        meter('On board',count?onBoard/(count*m.capacity(r)):null,{value:onBoard+' / '+count*m.capacity(r),cargo:routeCargo(m,r)})));
    const active=r.local||m.isActive(...r.stations.map(m.source));
    if(!count)overview.append(node('p','No vehicles assigned.','inspectorNotice'));
    else if(r.local&&!m.validLoop(r))overview.append(node('p',r.local==='delivery'?
      'Paused · this town has no demand for '+m.kind(r).toLowerCase()+'.':'Edit this loop to connect it to a passenger station.','inspectorNotice warning'));
    else if(!active)overview.append(node('p','Starting up · service begins after the first weekly turnover.','inspectorNotice'));
    else if(m.formerDemand(m.routeTrade(r)))overview.append(node('p','Paused · this town no longer requests '+m.kind(r).toLowerCase()+'.','inspectorNotice'));
    else if(blocked)overview.append(node('p',freight?'Destination storage full · awaiting unloading space.':'Waiting to unload.','inspectorNotice warning'));
    else if(filling)overview.append(node('p','Waiting at the loading bay for stock'+(queued?' · '+queued+' queued':'')+'.','inspectorNotice'));
    else if(waitingInputs)overview.append(node('p','Pickup waiting for the factory’s inputs.','inspectorNotice'));
    else if(queued)overview.append(node('p',queued+' '+(queued===1?noun:plural)+' queued','inspectorNotice'));
    else if(waiting)overview.append(node('p',freight?waiting+' waiting for orders or storage space.':'Waiting for passengers.','inspectorNotice'));
    data.append(node('h3','Monthly throughput'),
      row('Completed last month',actual??'Pending'),row('Estimated with current fleet',Math.round(potential)),
      node('small','Potential assumes full loads and standard stop times. Queues, extra loading waits and demand affect actual throughput.'),
      node('h3','Revenue'),
      row('Last month',last?cash(last.revenue):'Pending'),row('This month',cash(s.thisMonth.revenue)),
      row('Since opening',cash(s.revenue)),node('h3','Operating costs and profit'),
      row('Last month’s costs',last?cash(last.expenses):'Pending'),row('This month’s costs',cash(s.thisMonth.expenses)),
      row('This month’s profit',signed(profit(s.thisMonth))),
      row('Lifetime costs',cash(s.expenses)),row('Lifetime profit',signed(profit(s))),
      node('h3','Service'),row('Delivered',s.delivered+(freight?' loads':' passengers')),
      row('Vehicle distance',s.km.toFixed(2)+' km'),row(r.local?'Setup cost':'Road construction',r.capital?cash(r.capital):'Legacy road'),
      row('Queued on road',queued),row('Waiting to unload',blocked),row('Waiting to fill',filling),row('Finishing before removal',retiring),
      row(freight?'Waiting for orders':'Waiting for riders',waiting));
    if(r.local){
      data.append(row('Loop length',Math.round(r.length*40)+' m'),row('Stops',r.stops.length),
        row(freight?m.kind(r)+' available at station':'Riders awaiting intercity service',freight?m.localStock(r):m.waitingAt(r.hub).length));
    }
    for(const station of r.stations){
      const key=ContourTown.stationKey(station),platform=valley.platforms?.get(key);
      if(!freight)data.append(row(station.name+' station · waiting',m.waitingAt(key).length));
      data.append(row(station.name,m.isIndustry(m.source(station))?'Industry loading bay':m.catchment(station).length+' homes in range'));
      if(platform)data.append(button('Open '+station.name+' station',()=>{
        selectedStop={key,platform};open('stop');
      },'menuItem'));
    }
    footer.querySelector('.removeVehicle').disabled=count===retiring;
    if(!r.local){
      data.append(node('h3','Station bays'));
      r.stations.forEach((station,side)=>{
        const assigned=ContourTown.stationBay(valley.transport,r,side);
        data.append(button(station.name+' · Bay '+(assigned?.id??'1'),()=>{open('');editStation(station,assigned?.id);},'menuItem'));
      });
    }
    footer.querySelector('.buy').disabled=m.state.cash<m.vehiclePrice||m.formerDemand(m.routeTrade(r))||(r.local&&!m.validLoop(r));
  }
  function townInspector(valley,overview,data){
    const m=valley.market,t=valley.towns.find(city=>city.id===townId),tot=m.townTotals(t);
    const coverage=m.coverage(t),timber=m.timberMarket(t),passengers=m.passengerStop(t);
    const received=m.state.received[t.id]??{};
    const waiting=valley.towns.reduce((sum,dest)=>sum+(dest===t?0:tot[dest.id]),0);
    const growth=m.townProgress(t);
    const {goods,trips}=m.townServices(t);
    const group=(title,items)=>{
      const section=node('section','','inspectorMeterGroup');
      section.append(node('h3',title,'inspectorMeterHeading'),...items);
      return section;
    };
    const townMeter=node('div','','townInspectorMeters');
    townMeter.append(group('Goods',goods.map(item=>meter(item.name,item.rate,{cargo:item.cargo}))),
      group('Trips to',trips.map(item=>meter(hud.short(item.town),item.rate,{
        color:hud.tripColor(valley.towns,item.town),label:item.town.name
      }))));
    overview.append(stats(['Level',growth.level],['Population',growth.population],
      ['Trend',hud.trend[growth.trend],growth.lastMonthGrowth<0?'negative':growth.lastMonthGrowth>0?'positive':'',growth.trend]),
      meters(meter('Next level',growth.points/growth.goal,{color:'#eac68a'})),townMeter);
    const aboard=trips.filter(item=>item.aboard).map(item=>item.aboard+' to '+hud.short(item.town));
    if(aboard.length)overview.append(node('p','Aboard · '+aboard.join(' · '),'inspectorNotice'));
    if(growth.lowMonths)overview.append(node('p','Downgrade risk · '+growth.lowMonths+' / '+growth.downgradeMonths+' months','inspectorNotice warning'));
    data.append(node('small','Goods satisfaction fades by 10% per week. Passenger satisfaction measures actual trips served. Growth also depends on how many homes your passenger network reaches.'),
      row('Waiting riders',waiting),row('Monthly trend',growth.trend));
    const balance=growth.lastMonthGrowth;
    if(balance!==null)data.append(row('Net growth last month',(balance>0?'+':'')+balance+' pts'),
      row('Fast growth or decline threshold','±'+growth.strongTrend+' pts'));
    if(growth.level>0)data.append(node('small','The town drops one level after '+growth.downgradeMonths+' consecutive months below 5% growth progress.'));
    data.append(row('Growth points needed',growth.remaining),row('Base weekly growth before service',growth.weeklyDecay?'−'+growth.weeklyDecay:'+'+growth.naturalGrowth),
      row('Waiting two weeks or more',growth.overdue),
      row('Queue penalty · now / last week','−'+growth.queuePenalty+' / −'+growth.lastQueuePenalty),
      node('small','Each six riders waiting at least two weeks cost one growth point per week, up to four.'),
      row('Goods growth last week','+'+growth.serviceGrowth.goods+' pts'),
      row('Passenger growth last week','+'+growth.serviceGrowth.passengers+' pts'),
      row('Passenger arrivals this month',growth.riders));
    if(m.freight){
      const freightGoods=m.freight.townGoods(t);
      if(t.starterGoods.includes('timber')){
        const demand=m.weeklyDemand(t);
        freightGoods.push({cargo:'timber',name:'Timber',unlock:0,demand,stock:timber.stock,inbound:timber.inbound,lastUsed:timber.lastUsed});
        data.append(row('Timber homes in range',coverage.timber+' / '+coverage.homes),
          row('Timber used / needed last month',timber.lastDemand?timber.lastUsed+' / '+timber.lastDemand+' loads':'Pending'));
      }
      const level=growth.level;
      const next=level<3?3:level<5?5:null;
      if(next)data.append(row('Next freight tier','Level '+next));
      const suppliers=t.starterGoods.map(cargo=>valley.industries.filter(site=>site.output===cargo)
        .sort((a,b)=>Math.hypot(a.x-t.x,a.y-t.y)-Math.hypot(b.x-t.x,b.y-t.y))[0]).filter(Boolean);
      if(suppliers.length){
        data.append(node('h3','Nearby starter suppliers'));
        for(const site of suppliers){
          const km=Math.hypot(site.x-t.x,site.y-t.y)*.04;
          data.append(row(site.name,km.toFixed(1)+' km direct'));
        }
      }
      data.append(node('h3','Town freight demand'),node('small','The town needs half a load per resident each week, split across its required goods.'));
      for(const tier of [0,3,5]){
        data.append(node('h4',tier?'Level '+tier+' cargo':'Starting cargo'));
        for(const good of freightGoods.filter(g=>g.unlock===tier)){
        const value=good.demand?good.demand+' / week · '+good.stock+' stored · '+good.inbound+' en route':
          'Opens at level '+good.unlock;
        data.append(row(good.name,value));
        if(good.lastUsed)data.append(row(good.name+' used last month',good.lastUsed));
        }
      }
    }
    if(!t.starterGoods)data.append(node('h3','Timber'),row('Weekly demand',m.weeklyDemand(t)+' loads'),row('En route',timber.inbound+' loads'),
      row('Delivered / used',(received.timber||0)+' / '+timber.used+' loads'),
      row('Last month’s demand met',timber.lastDemand?timber.lastUsed+' / '+timber.lastDemand+' loads':'Pending'),
      row('Homes served',coverage.timber+' / '+coverage.homes));
    data.append(row('Homes',coverage.homes),row('Expansion steps',growth.level),node('h3','Passengers waiting for'));
    for(const dest of valley.towns)if(dest!==t)data.append(row(dest.name,tot[dest.id]));
    data.append(node('h3','Completed trips / requested · recent weeks'));
    for(const item of trips)data.append(row(item.town.name,item.completed+' / '+item.requested+
      (item.aboard?' · '+item.aboard+' aboard':'')+(item.overdue?' · '+item.overdue+' overdue':'')+
      (item.missed?' · '+item.missed+' gave up':'')));
    data.append(node('h3','Goods used / requested · recent weeks'));
    for(const item of goods)data.append(row(item.name,item.completed+' / '+item.requested));
    const totals=m.serviceTotals(t,'passengers');
    data.append(row('All residents’ trips completed / requested',totals.completed+' / '+totals.requested),
      row('Residents’ trips within grace',totals.withinGrace));
    data.append(node('h3','Passenger network'),row('Homes served',coverage.passengers+' / '+coverage.homes),
      row('Inbound',passengers.inbound),row('Residents per home',4),row('Outbound trip opportunities','About 1 per 16 weeks for each eligible resident'),
      row('Handled last week',passengers.lastWeek+' / '+m.weeklyVisits(t)),
      row('Total arrivals',received.passengers||0));
  }
  function industrySummary(m,site,overview,status){
    const pulse=m.industryPulse(site),cargo=site.output??'timber';
    const heading=node('div','','inspectorContext inspectorService');
    heading.append(hud.icon(cargo),document.createTextNode(hud.cargoLabel(cargo)));
    overview.append(heading,stats(['Stock',pulse.stock+' / '+pulse.limit],
      [pulse.level?'Level':'Produced last week',pulse.level??pulse.produced]),
      meters(meter('Stock collected',pulse.usage,{color:'#a6dbb0'}),
        meter(pulse.level?'Efficiency':'Output last week',pulse.efficiency,{color:'#edcc85'}),
        ...(pulse.upgrade==null?[]:[meter('Level 2',pulse.upgrade,{color:'#b8c5ff',value:Math.round(pulse.upgrade*3)+' / 3 months'})])),
      node('p',status,'inspectorNotice'));
  }
  function millInspector(valley,overview,data){
    const m=valley.market,industry=m.state.mill;
    const freight=valley.transport.routes.filter(route=>m.kind(route)==='Timber');
    const live=freight.some(route=>m.isActive(...route.stations.map(m.source)));
    const delivered=freight.reduce((total,route)=>total+m.fleet(route).delivered,0);
    const used=Object.values(m.state.timber).reduce((total,town)=>total+town.used,0);
    const efficiency=Math.round(m.productionEfficiency()*100);
    const orders=m.weeklyMillOrders();
    const status=!freight.length?'Awaiting a route':!live?'Starting up':m.state.stock>=m.stockLimit?'Stockyard full':
      !industry.credits&&orders<=m.state.stock?'Enough stock for open orders':efficiency<100?'Output reduced · timber awaiting pickup':'Ready for next batch';
    industrySummary(m,valley.industry,overview,status);
    const {picked,available}=m.industryPulse(valley.industry);
    data.append(row('Collected / available last week',picked+' / '+available),row('Level',industry.level),row('Weekly output limit',m.productionLimit()),row('Open orders',orders+' loads'),row('Efficiency',efficiency+'%'));
    data.append(node('h3','Production'),row('Total produced',industry.produced+' loads'),
      row('Delivered / used',delivered+' / '+used+' loads'),row('Used last month',industry.lastMonth+' loads'),
      row('Backlog pressure',industry.uncollectedWeeks+' / 6'));
    if(industry.level===1)data.append(node('h3','Level 2'),
      row('Qualifying months',industry.goodMonths+' / 3'),
      node('small','Towns must use at least '+m.millUpgradeDemand+' loads per month for three months in a row.'));
  }
  function industryInspector(valley,site,overview,data){
    const m=valley.market;
    if(site.depot){depotInspector(m,site,overview,data);return;}
    if(site===valley.industry){millInspector(valley,overview,data);return;}
    const stock=m.freight.siteStock(site),output=ContourRegion.goods[site.output][0];
    const inputs=Object.entries(site.inputs);
    const connected=valley.transport.routes.some(route=>m.routeTrade(route)?.from===site&&m.fleet(route).vehicles.some(v=>!v.retiring));
    const shortages=inputs.filter(([cargo,amount])=>(stock.inputs[cargo]??0)<amount)
      .map(([cargo])=>ContourRegion.goods[cargo][0]);
    const status=!connected?'Awaiting an outbound route':stock.output>=site.limit*3?'Output yard full':
      shortages.length?'Waiting for '+shortages.join(' and '):'Producing';
    industrySummary(m,site,overview,status);
    const {picked,available}=m.industryPulse(site);
    data.append(row('Collected / available last week',picked+' / '+available),row('Produced last week',stock.lastProduced+' loads'),row('Weekly output limit',site.limit+' loads'),
      row('Total produced',stock.produced+' loads'));
    if(inputs.length){
      data.append(node('h3','Inputs'));
      for(const [cargo,amount] of inputs){
        const inventory=m.freight.storage(site,cargo);
        data.append(row(ContourRegion.goods[cargo][0],inventory.stock+' / '+inventory.limit+' stored · '+inventory.inbound+' en route'),
          node('small',amount+' input load'+(amount===1?'':'s')+' per '+output.toLowerCase()+' load'));
      }
    }
    const buyers=(valley.industries??[]).filter(t=>m.trade(site,t)?.from===site);
    const townDemand=ContourRegion.goods[site.output][1],minLevel=ContourRegion.goods[site.output][2];
    data.append(node('h3','Customers'),node('p',[...buyers.map(t=>t.name),
      ...(townDemand?[minLevel?'Towns at level '+minLevel+' or above':'All towns']:[])].join(' · ')));
  }
  function depotCargoControls(m,depot){
    const details=node('details','','inspectorMore depotSettings');
    details.append(node('summary','Choose stored materials'),node('small','Materials with stock, inbound loads or assigned lines stay enabled.'));
    const options=node('div','','depotCargoGrid');
    for(const [cargo,[name]] of Object.entries(ContourRegion.goods)){
      const label=node('label',''),toggle=node('input','');
      toggle.type='checkbox';toggle.checked=depot.cargos.includes(cargo);
      toggle.disabled=toggle.checked&&m.depotCargoLocked(depot,cargo);
      toggle.onchange=()=>{
        if(!m.setDepotCargo(depot,cargo,toggle.checked))toggle.checked=true;
        save();render();
      };
      label.append(toggle,node('span',name));options.append(label);
    }
    details.append(options);
    return details;
  }
  function depotInspector(m,depot,overview,data){
    const inventory=depot.cargos.map(cargo=>[cargo,m.freight.storage(depot,cargo)]);
    const active=inventory.filter(([,v])=>v.stock||v.inbound);
    const pulse=m.industryPulse(depot);
    overview.append(stats(['Loads stored',pulse.stock],['Loads en route',active.reduce((sum,[,v])=>sum+v.inbound,0)]),
      meters(meter('Storage filled',pulse.usage,{value:pulse.stock+' / '+pulse.limit})));
    const stock=node('div','','inspectorCargoList');
    for(const [cargo,entry] of active){
      if(entry.stock)stock.append(cargoChip(cargo,entry.stock));
      data.append(row(hud.cargoLabel(cargo),entry.stock+' stored · '+entry.inbound+' en route'));
    }
    if(stock.childElementCount)overview.append(stock);
    data.append(row('Capacity per material',depot.limit+' loads'),row('Materials enabled',depot.cargos.length));
    data.append(node('p','Build one line into the depot and another line out. Choose the same material on both. Depot transfers cover storage. Revenue is earned when freight reaches a town or factory.'));
  }
  function stopInspector(v,overview,data){
    const m=v.market;
    const {key,platform:p}=selectedStop;
    const bays=p.station&&v.transport.stationLayouts?.[window.contourStationKey(p.station)]?.bays;
    if(bays?.length>1){
      const chooser=node('div','','inspectorCargoList');
      for(const bay of bays)chooser.append(button('Bay '+bay.id,()=>{open('');editStation(p.station,bay.id);},'stationBayShortcut'));
      overview.append(chooser);
    }
    const queue=m.waitingAt(key);
    if(p.passengers||p.busStop){
      const local=queue.filter(person=>person.localDrop).length;
      if(p.busStop)overview.append(stats(['At shelter',queue.length],['Walking here',m.walkingTo(key)]));
      else overview.append(stats(['⇄ Intercity',queue.length-local],['⌂ Local transfer',local]));
      data.append(row('Walking here',m.walkingTo(key)));
      const destinations=new Map();
      for(const person of queue){
        const name=person.localDrop?'Local bus connection':v.towns.find(t=>t.id===person.dest)?.name??'Onward connection';
        destinations.set(name,(destinations.get(name)??0)+1);
      }
      for(const [name,count] of destinations)data.append(row(name,count));
    }
    if(p.freight){
      const place=m.source(p.station),stockList=node('div','','inspectorCargoList');
      overview.append(stockList);
      for(const cargo of p.cargos??['timber']){
        const name=ContourRegion.goods[cargo][0];
        if(place?.depot){
          const {stock,inbound,limit}=m.freight.storage(place,cargo);
          stockList.append(cargoChip(cargo,stock));
          data.append(row(name+' stored',stock+' / '+limit));
          data.append(row(name+' en route',inbound+' loads'));
        }else if(cargo==='timber'){
          const stock=p.station.millBay?m.state.stock:v.transport.hubStock?.[key]?.timber??0;
          stockList.append(cargoChip(cargo,stock));
          data.append(row('Timber stored',stock+' loads'));
          if(place&&!m.isIndustry(place))data.append(row('Town timber orders',m.timberOpen(place)+' loads'));
        }else if(place?.output===cargo){
          const stock=m.freight.siteStock(place).output;
          stockList.append(cargoChip(cargo,stock));
          data.append(row(name+' ready',stock+' loads'));
        }else if(place){
          const {stock,inbound,limit}=m.freight.storage(place,cargo);
          const stored=m.isIndustry(place)?stock:m.yardStock(key,cargo);
          stockList.append(cargoChip(cargo,stored));
          data.append(row(name,m.isIndustry(place)?stock+' / '+limit+' loads stored':stored+' loads for local delivery'));
          data.append(row(name+' en route',inbound+' loads'));
        }
      }
    }
  }
  function homeInspector(valley,overview,data){
    const {cityId,lotId,service}=selectedHome,m=valley.market;
    const city=valley.towns.find(t=>t.id===cityId);
    const home=city&&m.homeSatisfaction(city,service).find(item=>item.lot.id===lotId);
    if(!home){overview.append(node('p','This home is no longer on the map.','inspectorNotice'));return;}
    const states={full:'Fully served',partial:'Partly served',unmet:'Unmet',pending:'No recent data'};
    const starter=service==='starter',freight=service!=='passengers',amount=new Intl.NumberFormat('en-GB',{maximumFractionDigits:2});
    const units=starter?'':freight?' loads':' trips';
    overview.append(stats(['Service',states[home.status]],['Coverage',home.covered?'In range':'Out of range']),
      meters(meter('Satisfaction',home.ratio,{cargo:starter?null:freight?'timber':'passengers'})));
    data.append(row(starter?'Starter goods':freight?'Estimated demand':'Trips requested',starter?
        city.starterGoods.map(cargo=>ContourRegion.goods[cargo][0]).join(' + '):amount.format(home.demand)+units),
      ...(starter?[]:[row(freight?'Estimated stock used':'Trips completed',amount.format(home.served)+units)]));
    if(home.withinGrace>.001)data.append(row('Within grace period',amount.format(home.withinGrace)+units));
    if(freight){
      const weekly=starter?city.starterGoods.reduce((sum,cargo)=>sum+(cargo==='timber'?m.weeklyDemand(city):m.freight.weeklyDemand(city,cargo)),0):m.weeklyDemand(city);
      data.append(row('Weekly need per home',amount.format(weekly/Math.max(1,m.homes(city).length))+' loads'));
    }
    data.append(row('Activity counts','Last '+m.serviceWindow+' game weeks'),
      node('small',freight?'Satisfaction fades by 10% of its current value per week and recovers with service.':
        'Passenger satisfaction uses actual trips, including riders aboard and riders who waited too long.'),
      node('small',starter?'Both starter goods have equal weight. Estimates use town consumption and each good’s station coverage.':
        freight?'Timber is estimated from the stock the town consumed and which homes its routes can reach.':
          'Trips count towards the home that requested them when the passenger reaches the destination town.'));
  }
  function vRegionData(valley){
    if(!valley.region)return {};
    const m=valley.market;
    return {region:valley.region,industries:valley.industries.filter(site=>site!==valley.industry).map(site=>({
      name:site.name,output:site.output,...m.freight.siteStock(site)
    }))};
  }
  function balanceReport(valley){
    const m=valley.market,week=m.state.week;
    const round=value=>typeof value==='number'?Math.round(value*100)/100:null;
    const period=values=>values?{
      completed:values.delivered??null,distanceKm:round(values.km),
      revenue:round(values.revenue),cost:round(values.expenses),profit:round(values.revenue-values.expenses)
    }:null;
    return {
      format:'Contour Lines balance report v1',seed:valley.seed,gameWeek:week+1,
      elapsedWeekFraction:round(m.state.weekTime/m.weekSeconds),
      notes:['This month is in progress. Monthly counters in older saves may begin partway through a month.',
        'Town passenger totals count intercity arrivals, including return trips. Resident satisfaction tracks outbound trip requests by home.',
        'Sawmill open orders may include rounding up for whole-truck batches. Town open orders show demand before rounding.',
        'Local and intercity lines count their own completed legs. Goods satisfaction decays by 10% weekly. Passenger satisfaction uses actual trips and includes riders on board, overdue, or who gave up.'],
      cash:round(m.state.cash),
      ...(vRegionData(valley)),
      sawmill:{level:m.state.mill.level,stock:m.state.stock,productionCredits:m.state.mill.credits,
        weeklyOutputLimit:m.productionLimit(),openOrders:m.weeklyMillOrders(),producedLastWeek:m.state.mill.lastWeekProduced??null,efficiencyPercent:Math.round(m.productionEfficiency()*100),
        timberUsedLastMonth:m.state.mill.lastMonth},
      towns:valley.towns.map(city=>{
        const growth=m.townProgress(city),timber=m.timberMarket(city),passengers=m.passengerStop(city);
        const services=m.townServices(city);
        return {name:city.name,population:growth.population,level:growth.level,
          satisfactionPercent:Object.fromEntries(['passengers',city.starterGoods?'starter':'timber'].map(service=>{
            const rate=m.cityServiceRate(city,service);
            return [service,rate===null?null:round(100*rate)];
          })),
          goodsSatisfaction:Object.fromEntries(services.goods.map(({cargo,demand,rate})=>[
            cargo,{weeklyDemand:demand,satisfactionPercent:rate==null?null:round(100*rate)}
          ])),
          coverage:m.coverage(city),growth:{points:growth.points,target:growth.goal,weeklyDecay:growth.weeklyDecay,serviceGrowth:growth.serviceGrowth,
            overdueRiders:growth.overdue,queuePenalty:growth.queuePenalty,lastMonthBalance:growth.lastMonthGrowth,trend:growth.trend},
          timber:{stock:timber.stock,inbound:timber.inbound,openOrders:m.timberOpen(city),weeklyDemand:m.weeklyDemand(city),
            lastMonthDemand:timber.lastDemand,lastMonthUsed:timber.lastUsed},
          passengers:{residentTrips:m.serviceTotals(city,'passengers'),
            residentTripsByDestination:Object.fromEntries(services.trips.map(({town,requested,completed,grace,aboard,overdue,missed,rate})=>[
              town.id,{requested,completed,withinGrace:grace,aboard,overdue,missed,satisfactionPercent:rate==null?null:round(100*rate)}
            ])),waitingByDestination:Object.fromEntries(Object.entries(m.townTotals(city)).filter(([key])=>key!=='timber')),
            inbound:passengers.inbound,lastMonthTrips:passengers.lastMonth??null}};
      }),
      lines:[...valley.transport.routes,...m.localRoutes].map((route,index)=>{
        const account=m.fleet(route);
        const waits={};
        for(const vehicle of account.vehicles)if(vehicle.waiting)waits[vehicle.waiting]=(waits[vehicle.waiting]??0)+1;
        return {line:index+1,name:routeName(route),service:m.kind(route),local:route.local??null,
          vehicleCapacity:m.capacity(route),fleet:account.vehicles.length,onBoard:account.vehicles.reduce((sum,v)=>sum+v.load,0),
          waitingVehicles:account.vehicles.filter(v=>v.waiting).length,waitingByReason:waits,
          ...(!route.local&&m.isFreight(route)?{fillWait:route.fillWait??0}:{}),
          retiring:account.vehicles.filter(v=>v.retiring).length,
          thisMonth:period(account.thisMonth),lastMonth:period(account.lastMonth),totalCompleted:account.delivered};
      })
    };
  }
  async function copyBalanceReport(valley,feedback){
    const report=JSON.stringify(balanceReport(valley),null,2);
    try{
      await navigator.clipboard.writeText(report);
      feedback.textContent='Balance report copied.';
    }catch{
      const field=node('textarea','');
      field.value=report;field.readOnly=true;field.rows=7;
      field.setAttribute('aria-label','Balance report');
      feedback.replaceChildren(node('small','Select and copy the report below.'),field);
      field.focus();field.select();
    }
  }
  let baseOverlay='routes';
  function setOverlay(next){
    if(!next.startsWith('service:'))baseOverlay=next;
    overlay=next;
    if(next.startsWith('service:')||view==='home')open('');
    else{redraw();render();}
  }
  function render(){
    const v=getValley();if(!v)return;
    const m=v.market,rs=[...v.transport.routes,...m.localRoutes];
    el('cash').textContent=cash(m.state.cash);clock();
    if(overlay==='service:timber'&&v.region)overlay='service:starter';
    if(overlay==='service:starter'&&!v.region)overlay='service:timber';
    const serviceLegend=el('serviceLegend'),service=overlay.split(':')[1];
    const cargoLabel=v.region?'Starter goods satisfaction':'Timber satisfaction';
    el('toggleTimberService').title=cargoLabel;
    el('toggleTimberService').setAttribute('aria-label',cargoLabel);
    serviceLegend.hidden=!service;
    if(service){
      el('serviceLegendTitle').textContent=service==='passengers'?'Passenger satisfaction':cargoLabel;
      el('serviceLegendPeriod').textContent=service==='starter'?'Both starter goods':'Satisfaction fades weekly';
    }
    el('togglePassengerService').setAttribute('aria-pressed',String(service==='passengers'));
    el('toggleTimberService').setAttribute('aria-pressed',String(service==='timber'||service==='starter'));
    el('toggleLabels').setAttribute('aria-pressed',String(labels));
    el('toggleRoutes').setAttribute('aria-pressed',String(overlay==='routes'));panel.hidden=!view;
    panel.classList.toggle('financePanel',view==='finance');
    panel.classList.toggle('inspectorPanel',inspectors.has(view));
    footer.hidden=!inspectors.has(view)||view==='home'||(view==='stop'&&!selectedStop?.platform.station);
    el('toolMenu').setAttribute('aria-expanded',String(!!view));
    if(!view){delete body.dataset.inspector;return;}
    const title={tools:'Network tools',build:'New route',routes:'Existing routes',routeChoice:'Choose a route',detail:'Route accounts',towns:'Towns and industries',town:'Town demand',layers:'Map overlays',mill:'Valley Sawmill',settings:'Settings',restart:'Restart valley',deleteLoop:'Delete loop',removeRoute:'Remove route',finance:'Company history'}[view];
    if(inspectors.has(view)){
      const name=view==='home'?v.towns.find(t=>t.id===selectedHome.cityId)?.name+' · '+(selectedHome.service==='starter'?'Starter goods':selectedHome.service==='timber'?'Timber':'Passengers'):view==='stop'?selectedStop.platform.name:view==='detail'?routeName(rs[routeIndex]):view==='mill'?sites(v).find(site=>site.id===townId).name:v.towns.find(t=>t.id===townId).name;
      if(el('panelTitle').textContent!==name)el('panelTitle').textContent=name;
      renderInspector(v);
      return;
    }
    delete body.dataset.inspector;
    el('panelTitle').textContent=title;body.replaceChildren();
    if(view==='finance')finance(v);
    if(view==='build'){
      body.append(button('Town or industry route',()=>{open('');buildRoute();},'menuItem'));
      body.append(button('Local bus loop',()=>{open('');editTown('bus');},'menuItem'));
      body.append(button('Local delivery loop',()=>{open('');editTown('delivery');},'menuItem'));
    }
    if(view==='tools'){
      for(const [id,name] of [['towns','Towns and industries'],['layers','Map overlays']])body.append(button(name+'  ›',()=>open(id),'menuItem'));
      body.append(button('Whole valley',()=>{focus('region');open('');},'menuItem'));
      body.append(button(resumeState()?'Pause simulation':'Resume simulation',()=>{pause();render();},'menuItem'));
    }
    if(view==='layers'){
      for(const [id,name] of [['standard','Standard map'],['range','Station catchments'],[v.region?'service:starter':'service:timber',cargoLabel],['service:passengers','Passenger satisfaction'],['routes','Routes and vehicles']])
        body.append(button((overlay===id?'✓  ':'')+name,()=>setOverlay(id),'menuItem'));
      if(overlay==='range')body.append(node('small','Green dots mark homes reached along connected streets. Local stops can extend coverage beyond a station.'));
      if(overlay==='routes')body.append(node('small','Tap a highlighted road or vehicle badge for its accounts. Badges show line number and load / capacity. Q marks a queue. Full means the town has no room to unload.'));

    }
    if(view==='routeChoice'){
      for(const index of routeChoices){
        const route=rs[index];
        if(!route)continue;
        const choice=button('',()=>inspectRoute(index),'routeItem routeChoice');
        const dot=node('span','','routeChoiceColor');
        dot.style.backgroundColor=ContourRouteOverlay.color(index);
        choice.append(dot,node('strong',routeName(route)),node('small','Line '+(index+1)+' · '+m.kind(route)));
        body.append(choice);
      }
      return;
    }
    if(view==='routes'){
      const filters=node('div','','routeFilters');
      const locations=[...v.towns,...sites(v)];
      const cargo=[...new Set(rs.map(m.kind))].sort();
      filters.append(picker([['','All places'],...locations.map(t=>[t.id,t.name])],filter,x=>{filter=x;render();},'Filter by place'),
        picker([['','All services'],...cargo.map(name=>[name,name])],type,x=>{type=x;render();},'Filter by service'));
      body.append(filters,node('small','Monthly throughput · actual / potential'));
      let count=0;rs.forEach((r,i)=>{
        if(filter&&!r.stations.some(s=>m.source(s)?.id===filter)||type&&m.kind(r)!==type)return;
        const last=m.fleet(r).lastMonth,net=last?profit(last):null,kind=m.kind(r);
        const b=button('',()=>inspectRoute(i),'routeItem');
        const {actual,potential}=m.routeThroughput(r,i);
        const units=m.isFreight(r)?'loads':'riders';
        const icon=hud.icon(routeCargo(m,r));
        icon.setAttribute('aria-hidden','true');
        b.setAttribute('aria-label','Line '+(i+1)+', '+kind+', '+routeName(r)+', '+
          (actual===null?'actual throughput pending':actual+' '+units+' completed last month')+
          ', estimated potential '+Math.round(potential)+' '+units+' per month'+(net===null?'':', '+cash(net)+' last month'));
        const throughput=node('small',kind+' · '+(actual??'—')+' / '+Math.round(potential)+' '+units,'routeThroughput');
        throughput.title='Last month completed / estimated capacity with the current fleet and no queues';
        b.append(icon,node('strong',routeName(r)),node('small',net===null?'—':cash(net),net===null?'':net<0?'negative':'positive'),throughput);
        body.append(b);count++;
      });
      if(!count)body.append(node('p',rs.length?'No matching services.':'Connect an industry to a customer for freight, or link two towns for passengers.'));
    }
    if(view==='towns'){
      const locations=[...v.towns,...sites(v)];
      if(v.region){
        for(const [zone,name] of Object.entries(ContourRegion.names)){
          const group=node('details','','inspectorMore');
          group.append(node('summary',name));
          for(const place of locations.filter(p=>p.biome===zone)){
            const label=place.output?place.name+' · '+ContourRegion.goods[place.output][0]:place.depot?place.name+' · Depot':place.name;
            group.append(button(label,()=>inspectPlace(place.id,true),'menuItem'));
          }
          body.append(group);
        }
      }else for(const t of locations)body.append(button(t.name,()=>inspectPlace(t.id,true),'menuItem'));
    }
    if(view==='settings'){
      const balance=node('label','Weekly growth decay','growthSetting');
      const slider=node('input',''),value=node('output',((m.state.growthDecayFactor??1)*100).toFixed(0)+'%');
      Object.assign(slider,{type:'range',min:50,max:200,step:5,value:(m.state.growthDecayFactor??1)*100});
      slider.setAttribute('aria-label','Weekly growth decay multiplier');
      slider.oninput=()=>{m.state.growthDecayFactor=Number(slider.value)/100;value.textContent=slider.value+'%';save();};
      balance.append(value,slider);
      const feedback=node('div','','balanceFeedback');
      feedback.setAttribute('aria-live','polite');
      body.append(row('Valley seed',v.seed),balance,node('small','Level 1 onward. Base decay = 4 + 3 × level + population ÷ 64 per week.'),
        button('Copy balance report',()=>copyBalanceReport(v,feedback),'menuItem'),feedback,
        button(v.region?'Open classic valley save':'Open Three Biomes save',()=>{
          if(switchRegion()){filter=type=statsTown='';financeEnd=null;open('');}
        },'menuItem'),
        button(v.region?'Restart Three Biomes':'Restart with a new valley',()=>open('restart'),'menuItem'));

    }
    if(view==='deleteLoop'||view==='removeRoute'){
      const route=rs[routeIndex];
      body.append(node('p','Remove '+routeName(route)+'? '+(route.local?
        'This removes the loop and its vehicles. Shared stops stay in place.':
        'This removes the service and its vehicles. Roads and stations stay available for future routes.')));
      body.append(button('Confirm removal',()=>{(route.local?deleteLoop:deleteRoute)(route);open('routes');},'restartAction'));
      body.append(button('Cancel',()=>open('detail'),'back'));
      return;
    }
    if(view==='restart'){
      body.append(node('p','Generate a new valley and clear this valley’s roads, vehicles, finances and route draft.'));
      body.append(button('Restart valley',()=>{
        try{
          if(restart()){overlay=baseOverlay='routes';filter=type='';financeEnd=null;statsTown='';listScroll=0;open('');return;}
        }catch(error){console.error(error);}
        body.append(node('p','Could not start a new valley.'));
      },'restartAction'));
    }
    if(!['tools','settings','finance'].includes(view))body.append(button('‹ Back',()=>open(view==='restart'?'settings':'tools'),'back'));
  }
  el('toggleLabels').onclick=()=>{labels=!labels;redraw();render();};
  for(const [id,service] of [['togglePassengerService','passengers'],['toggleTimberService','timber']]){
    el(id).onclick=()=>{
      const layer='service:'+(service==='timber'&&getValley()?.region?'starter':service);
      setOverlay(overlay===layer?baseOverlay:layer);
    };
  }
  el('toggleRoutes').onclick=()=>setOverlay(overlay==='routes'?'standard':'routes');
  el('brand').onclick=()=>open(view==='finance'?'':'finance');
  el('speed').onclick=()=>{
    if(!resumeState())pause();
    else setSpeed(({1:2,2:4,4:8,8:1})[getSpeed()]);
    clock();
  };
  el('settings').onclick=()=>open(view==='settings'?'':'settings');
  el('routesShortcut').onclick=()=>open(view==='routes'?'':'routes');
  el('toolMenu').onclick=()=>open(view?'':'tools');el('panelClose').onclick=()=>open(view==='detail'?'routes':'');
  el('zoomIn').onclick=()=>zoom(1.25);el('zoomOut').onclick=()=>zoom(.8);
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&view)open('');});
  window.addEventListener('popstate',()=>{if(view)open('',true);});
  function tick(){
    const valley=getValley();if(!valley)return;
    el('cash').textContent=cash(valley.market.state.cash);
    if(inspectors.has(view)||view==='stop'){render();return;}
    if(!['routes','finance'].includes(view)||body.contains(document.activeElement))return;
    // Keep the active controls and scrolling stable while the ledger updates.
    const original=[...body.childNodes],scroll=body.scrollTop;
    const focused=original.indexOf(document.activeElement);
    render();
    [...body.childNodes].forEach((fresh,i)=>{
      const old=original[i];
      if(!fresh.matches?.('.financeControls,.financeTabs,.financeChart')&&old?.nodeName===fresh.nodeName&&old.textContent===fresh.textContent){
        old.disabled=fresh.disabled;fresh.replaceWith(old);
      }
    });
    body.scrollTop=scroll;
    if(focused>=0)body.children[focused]?.focus({preventScroll:true});
  }
  return {render,open,tick,clock,inspectPlace,inspectRoute,inspectRoutes,inspectStop(key,platform){selectedStop={key,platform};open('stop');},inspectHome(cityId,lotId,service){selectedHome={cityId,lotId,service};open('home');},get selectedHome(){return view==='home'?selectedHome:null;},get labels(){return labels;},get activeRoute(){return view==='detail'?routeIndex:null;},get overlay(){return overlay;},get view(){return view;}};
};
