window.createNetworkUI=function({getValley,focus,redraw,zoom,pause,resumeState,save,restart,stationDepot,editStation,openRailway,upgradeRailTrack,editRailRoute,editRailStation,deleteRailStation,switchRegion,getSpeed,setSpeed,buildRoute,editTown,deleteLoop,deleteRoute}){
  const el=id=>document.getElementById(id), panel=el('networkPanel'),body=el('panelBody'),footer=el('panelFooter');
  const months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  let view='',overlay='routes',routeIndex=0,filter='',type='',mode='',listScroll=0,townId='';
  const cash=n=>Math.round(n).toLocaleString('en-GB')+' cr';
  const amount=new Intl.NumberFormat('en-GB',{maximumFractionDigits:2});
  const profit=period=>period.revenue-period.expenses;
  let selectedTrack=null,trackFeedback='';
  let routeChoices=[],selectedStop,selectedHome,labels=true,financeEnd=null,financeRange=0,financeView='finances',statsTown='';
  let selectedTrain=null,railDraft=null,railFeedback='';
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
  const routeCargo=(m,r)=>r.local==='delivery'?m.localCargo(r):m.routeTrade(r)?.cargo??r.cargo??'passengers';
  function open(next,fromHistory=false){
    if(!fromHistory){
      if(next&&!view)history.pushState({networkPanel:true},'','');
      else if(!next&&view&&history.state?.networkPanel)history.replaceState(null,'','');
    }
    if(view==='routes')listScroll=body.scrollTop;
    if(next!=='detail'){selectedTrain=null;railDraft=null;railFeedback='';}
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
  function inspectRoute(index,vehicle=null){routeIndex=index;selectedTrain=vehicle;railDraft=null;railFeedback='';open('detail');}
  const isRail=route=>route?.mode==='rail';
  const isRailPlatform=platform=>isRail(platform)||isRail(platform.station);
  const transportMode=route=>isRail(route)?'rail':'road';
  const railPlatformCount=(transport,station)=>(transport.railStations?.[station.id]??station).platformCount??1;
  const assignedPlatform=(route,side)=>route.platforms?.[side]??1;
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
        if(isRail(route)){
          body.insertBefore(node('section','','railManagement'),more);
          if(openRailway)footer.append(button('Service tracks',()=>openRailway(routeIndex),'loopAction'));
          if(editRailRoute)footer.append(button('Edit track and stations',()=>{open('');editRailRoute(route,routeIndex);},'loopAction'));
        }else{
          footer.append(button('Add '+kind+' · '+cash(m.vehiclePrice),()=>{
            m.purchase(route);save();render();
          },'buy'),button('Remove '+kind,()=>{
            m.retireVehicle(route);save();redraw();render();
          },'removeVehicle'));
        }
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
        const rail=isRailPlatform(selectedStop.platform);
        const edit=rail?editRailStation:editStation;
        if(edit)footer.append(button('Edit station',()=>{open('');edit(station);},'buy'));
        if(rail&&deleteRailStation&&!valley.transport.routes.some(route=>isRail(route)&&route.stations.some(stop=>ContourTown.stationKey(stop)===selectedStop.key))){
          footer.append(button('Remove station',()=>open('removeStation'),'loopAction'));
        }
        if(valley.region&&!rail){
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
    const rail=isRail(r),freight=m.isFreight(r),noun=rail?'train':freight?'truck':'bus',plural=rail?'trains':freight?'trucks':'buses';
    const retiring=s.vehicles.filter(v=>v.retiring).length;
    const count=s.vehicles.length,onBoard=s.vehicles.reduce((n,v)=>n+v.load,0);
    const blocked=s.vehicles.filter(v=>v.waiting==='storage').length;
    const waiting=s.vehicles.filter(v=>v.waiting==='orders').length;
    const filling=s.vehicles.filter(v=>v.waiting==='filling').length;
    const waitingInputs=s.vehicles.filter(v=>v.waiting==='inputs').length;
    const crossing=s.vehicles.filter(v=>v.waiting==='crossing').length;
    const queued=s.vehicles.filter(v=>(rail||r.local||!m.staged(routeIndex,v))&&['bay','traffic','signal'].includes(v.waiting)).length;
    const last=s.lastMonth,net=last?profit(last):null;
    const signed=n=>(n>0?'+':n<0?'−':'')+cash(Math.abs(n));
    const {actual,potential}=m.routeThroughput(r,routeIndex);
    const service=node('div','','inspectorContext inspectorService');
    const cargo=routeCargo(m,r);
    const totalCapacity=rail?s.vehicles.reduce((sum,v)=>sum+m.vehicleCapacity(r,v),0):count*m.capacity(r);
    service.append(hud.icon(rail?'train':cargo),document.createTextNode(m.kind(r)+' · '+(rail?'Rail':r.local?'Local':'Intercity')));
    overview.append(service,stats(['Last month’s profit',net===null?'—':signed(net),net==null?'':net<0?'negative':'positive'],
      ['Fleet',count+' '+(count===1?noun:plural)]),
      meters(meter('Monthly throughput',actual==null||!potential?null:actual/potential,{value:(actual??'—')+' / '+Math.round(potential)}),
        meter('On board',totalCapacity?onBoard/totalCapacity:null,{value:onBoard+' / '+totalCapacity,cargo})));
    const active=r.local||m.isActive(...r.stations.map(m.source));
    if(!count)overview.append(node('p','No vehicles assigned.','inspectorNotice'));
    else if(r.local&&!m.validLoop(r))overview.append(node('p',r.local==='delivery'?
      'Paused · this town has no demand for '+m.kind(r).toLowerCase()+'.':'Edit this loop to connect it to a passenger station.','inspectorNotice warning'));
    else if(!active)overview.append(node('p','Starting up · service begins after the first weekly turnover.','inspectorNotice'));
    else if(m.formerDemand(m.routeTrade(r)))overview.append(node('p','Paused · this town no longer requests '+m.kind(r).toLowerCase()+'.','inspectorNotice'));
    else if(blocked)overview.append(node('p',freight?'Destination storage full · awaiting unloading space.':'Waiting to unload.','inspectorNotice warning'));
    else if(filling)overview.append(node('p','Waiting at the '+(rail?'platform':'loading bay')+' for stock'+(queued?' · '+queued+' queued':'')+'.','inspectorNotice'));
    else if(waitingInputs)overview.append(node('p','Pickup waiting for the factory’s inputs.','inspectorNotice'));
    else if(queued)overview.append(node('p',queued+' '+(queued===1?noun:plural)+' queued','inspectorNotice'));
    else if(waiting)overview.append(node('p',freight?waiting+' waiting for orders or storage space.':'Waiting for passengers.','inspectorNotice'));
    if(crossing&&!rail)overview.append(node('p',crossing===1?
      'One '+noun+' waiting for a train to clear the crossing.':crossing+' '+plural+' waiting for trains to clear crossings.','inspectorNotice'));
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
      row('Vehicle distance',s.km.toFixed(2)+' km'),row(r.local?'Setup cost':rail?'Track construction':'Road construction',r.capital?cash(r.capital):rail?'—':'Legacy road'),
      row(rail?'Queued on track':'Queued on road',queued),row('Waiting to unload',blocked),row('Waiting to fill',filling),row('Finishing before removal',retiring),
      row(freight?'Waiting for orders':'Waiting for riders',waiting));
    if(s.lastDelivery){
      const {elapsed,bonus,pay}=s.lastDelivery;
      data.append(node('h3','Last paid delivery'),row(r.local?'Average time aboard':'Time aboard',
        elapsed==null?'—':Math.round(elapsed)+' s'),row('Speed bonus',cash(bonus)),row('Total paid',cash(pay)));
    }
    if(crossing)data.append(row(rail?'Waiting at level crossings':'Waiting for trains at crossings',crossing));
    if(r.local){
      data.append(row('Loop length',Math.round(r.length*40)+' m'),row('Stops',r.stops.length),
        row(freight?m.kind(r)+' available at station':'Riders awaiting intercity service',freight?m.localStock(r):m.waitingAt(r.hub).length));
    }
    const stationData=rail?node('div','','stationPlatformData'):data;
    if(rail){
      if(valley.truckRuns?.[routeIndex]?.blocks.some(block=>block.tracks===2)){
        const fixed=r.runningTrack==='left'||r.runningTrack==='right';
        stationData.append(row('Running track',fixed?(r.runningTrack==='left'?'Left':'Right')+' from '+r.stations[0].name+' · both ways':'Automatic · by direction'));
      }
      stationData.append(node('h3','Station platforms'));
    }
    for(const [side,station] of r.stations.entries()){
      const key=ContourTown.stationKey(station),platform=valley.platforms?.get(key);
      const assignment=rail?'Platform '+assignedPlatform(r,side)+' of '+railPlatformCount(valley.transport,station):'';
      if(!freight)stationData.append(row(station.name+' station · waiting',m.waitingAt(key).length));
      stationData.append(row(station.name,m.isIndustry(m.source(station))?(rail?'Industry platform':'Industry loading bay'):m.catchment(station).length+' homes in range'));
      if(platform)stationData.append(button(rail?station.name+' · '+assignment:'Open '+station.name+' station',()=>{
        selectedStop={key,platform};open('stop');
      },'menuItem'));
      else if(rail)stationData.append(row(station.name,assignment));
    }
    if(rail){data.prepend(stationData);renderRailManagement(valley,r,s,cargo);return;}
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
  function renderRailManagement(valley,route,fleet,cargo){
    const section=body.querySelector('.railManagement'),m=valley.market;
    const vehicles=fleet.vehicles;
    const hasTrain=vehicles.includes(selectedTrain);
    if(!hasTrain)selectedTrain=null;
    if(railDraft?.vehicle&&!vehicles.includes(railDraft.vehicle)){
      railDraft=null;railFeedback='The train has left the fleet.';
      panel.classList.remove('railDepotPanel');
    }
    const model=ContourRail;
    const defaultConsist=()=>model.defaultConsist(cargo);
    const copyConsist=({locomotives,cars})=>({locomotives:[...locomotives],cars:[...cars]});
    const action=(label,handler,cls)=>button(label,()=>{handler();render();},cls);
    const startDraft=vehicle=>{
      const consist=copyConsist(vehicle?.consist??defaultConsist());
      railDraft={vehicle,consist,original:copyConsist(consist),selected:{part:'locomotives',index:0},
        tab:'locomotives',returnScroll:body.scrollTop};
      railFeedback='';
      render();
      body.scrollTop=0;
      section.querySelector('.railUnit[aria-pressed="true"]')?.focus({preventScroll:true});
    };
    const unit=cargo==='passengers'?'riders':'loads';
    const kmh=speed=>Math.round(speed??0)+' km/h';
    const waits={block:'Waiting for clear track',signal:'Waiting for a signal',meet:'Waiting for opposing train',
      crossing:'Waiting at the level crossing',
      traffic:'Waiting for clear track',bay:'Waiting for platform',platform:'Waiting for platform',orders:'Waiting for orders',
      filling:'Loading',storage:'Waiting for storage',inputs:'Waiting for inputs',loading:'Loading',station:'At station',
      departure:'Awaiting departure',track:'Waiting for clear track',traction:'Insufficient tractive effort',
      held:'Held at station'};
    const heading=node('div','','railFleetHeading');
    heading.append(hud.icon('train'),node('h3','Trains'),button('Add train',()=>startDraft(null),'buy'));
    const controls=node('div',''),liveReadout=node('div',''),trainActions=node('div','','railActions'),draftSlot=node('div','');
    controls.append(heading);
    if(!selectedTrain&&vehicles.length&&!railDraft)selectedTrain=vehicles[0];
    if(vehicles.length){
      const vehicle=selectedTrain;
      const selector=picker([...(vehicle?[]:[['','Choose a train']]),
        ...vehicles.map((v,i)=>[String(i),'Train '+(v.id??i+1)+(v.retiring?' · retiring':'')])],
        vehicle?String(vehicles.indexOf(vehicle)):'',value=>{
          if(value==='')return;
          selectedTrain=vehicles[Number(value)];railDraft=null;railFeedback='';render();
        },'Select train');
      controls.append(selector);
      if(vehicle){
        const live=m.railStatus(route,vehicle);
        const quote=model.quote(vehicle.consist??defaultConsist(),cargo);
        const parts=vehicle.consist??defaultConsist();
        const engines=parts.locomotives.length,wagons=parts.cars.length;
        const movement=waits[live.waiting]??(live.braking?'Braking':live.tracting?'Pulling':live.speed>0?'Coasting':'At station');
        const status=vehicle.retiring?'Retiring after unloading':live.hold&&live.waiting!=='held'?movement+' · hold requested':movement;
        const operating=m.railRunningCost?.(parts);
        liveReadout.append(node('small',engines+' '+(engines===1?'locomotive':'locomotives')+' · '+wagons+' '+
          (cargo==='passengers'?(wagons===1?'coach':'coaches'):(wagons===1?'wagon':'wagons'))+' · '+Math.round(quote.length)+' m'),meters(
          meter('Live speed',live.speed/quote.maxSpeed,{cargo:'speed',value:kmh(live.speed)}),
          meter('On board',vehicle.load/live.capacity,{cargo,value:vehicle.load+' / '+live.capacity+' '+unit}),
          meter('Current mass',live.mass/quote.loadedMass,{cargo:'mass',value:Math.round(live.mass)+' t'})),
          node('p',status,'inspectorNotice'));
        if(Number.isFinite(live.grade)||Number.isFinite(live.curveRadius)||operating!=null){
          const profile=[];
          if(Number.isFinite(live.grade))profile.push(live.grade.toFixed(1)+'% grade');
          if(Number.isFinite(live.curveRadius))profile.push(Math.round(live.curveRadius)+' m radius');
          if(operating!=null)profile.push(cash(operating)+'/km');
          liveReadout.append(node('small',profile.join(' · '),'railLiveProfile'));
        }
        const edit=button('Edit consist',()=>startDraft(vehicle),'railRefitButton');
        const retire=action('Retire train',()=>{
          if(m.retireVehicle(route,vehicle)){if(railDraft?.vehicle===vehicle)railDraft=null;save();redraw();}
        });
        edit.disabled=retire.disabled=!!vehicle.retiring;
        trainActions.append(edit,retire);
        if(m.setRailHold){
          const hold=action(live.hold?'Release hold':'Hold at station',()=>{
            if(m.setRailHold(route,vehicle,!m.railStatus(route,vehicle).hold)){save();redraw();}
          });
          hold.disabled=!!vehicle.retiring;
          trainActions.append(hold);
        }
      }
    }
    if(railDraft)draftSlot.append(renderRailDepot({route,market:m,run:valley.truckRuns[routeIndex],cargo,vehicles,kmh,copyConsist}));
    else if(railFeedback)draftSlot.append(node('p',railFeedback,'inspectorNotice'));
    const active=document.activeElement;
    if(!section.childElementCount)for(let i=0;i<4;i++)section.append(node('div',''));
    const [controlHolder,liveHolder,actionHolder,draftHolder]=section.children;
    const stripScroll=draftHolder.querySelector('.railFormationStrip')?.scrollLeft??0;
    controls.dataset.train=controls.querySelector('select')?.value??'';
    const selectorFocused=controlHolder.contains(active)&&active.tagName==='SELECT';
    const activeKey=active?.dataset.railControl;
    replaceContent(controlHolder,controls);
    if(!liveHolder.childElementCount)liveHolder.append(node('div',''),node('div',''));
    replaceContent(liveHolder,liveReadout);
    if(section.train!==selectedTrain){section.train=selectedTrain;actionHolder.replaceChildren(trainActions);}
    else replaceContent(actionHolder,trainActions);
    if(section.draft!==railDraft){section.draft=railDraft;draftHolder.replaceChildren(draftSlot);}
    else replaceContent(draftHolder,draftSlot);
    const strip=draftHolder.querySelector('.railFormationStrip');
    if(strip){
      strip.scrollLeft=stripScroll;
      if(railDraft.reveal){
        const frame=strip.getBoundingClientRect();
        const picked=strip.querySelector('[aria-pressed="true"]').getBoundingClientRect();
        if(picked.right>frame.right)strip.scrollLeft+=picked.right-frame.right+6;
        else if(picked.left<frame.left)strip.scrollLeft-=frame.left-picked.left+6;
        railDraft.reveal=false;
      }
    }
    if(!active?.isConnected&&activeKey)draftHolder.querySelector('[data-rail-control="'+activeKey+'"]:not(:disabled)')?.focus({preventScroll:true});
    else if(!active?.isConnected&&selectorFocused)controlHolder.querySelector('select')?.focus({preventScroll:true});
  }
  function renderRailDepot({route,market,run,cargo,vehicles,kmh,copyConsist}){
    const draft=railDraft,{consist,vehicle}=draft,model=ContourRail;
    const passenger=cargo==='passengers',unit=passenger?'riders':'loads',carLabel=passenger?'Coaches':'Wagons';
    const gradeRun=draft.estimate??=model.estimate(consist,cargo,run);
    const original=draft.originalEstimate??=model.estimate(draft.original,cargo,run);
    const grade=gradeRun.maxGrade,radius=gradeRun.minRadius;
    const hillSpeed=estimate=>Math.round(model.speedLimit(estimate,grade,Infinity));
    const hill=hillSpeed(gradeRun),curve=Math.round(model.speedLimit(gradeRun,0,radius));
    const shortest=Math.min(...route.stations.map(station=>(station.platformLength??2.4)*model.metresPerUnit));
    const spare=shortest-gradeRun.length;
    const changeText=(current,base,suffix)=>{
      const delta=Math.round(current-base);
      return delta?((delta>0?'+':'−')+Math.abs(delta)+' '+suffix):'';
    };
    const depot=node('div','','railConsist');
    const label=node('div','','railDepotHeading');
    label.append(node('h4',vehicle?'Refit train':'Assemble a train'),node('span',hud.cargoLabel(cargo)));
    depot.append(label);
    const change=(handler)=>{
      handler();draft.estimate=null;railFeedback='';
      render();
    };
    const keyButton=(label,key,handler,cls)=>{
      const control=button(label,handler,cls);control.dataset.railControl=key;return control;
    };
    const groups={locomotives:{label:'Locomotives',kind:'locomotive',catalog:model.locomotives,limit:4},
      cars:{label:carLabel,kind:passenger?'passenger':'freight',
        catalog:Object.fromEntries(Object.entries(model.cars).filter(([,item])=>item.type===(passenger?'passengers':'freight'))),limit:12}};
    const selected=()=>draft.selected;
    const insert=(part,id)=>change(()=>{
      const current=selected(),group=consist[part];
      const index=current.part===part?current.index+1:group.length;
      group.splice(index,0,id);draft.selected={part,index};draft.reveal=true;
    });
    const formation=node('section','','railFormation');
    const formationHeading=node('div','','railSectionHeading');
    formationHeading.append(node('h5','Formation'),node('span',gradeRun.length+' m / '+Math.round(shortest)+' m platform',spare<0?'warning':''));
    const stage=node('div','','railFormationStage');
    const preview=node('canvas','');
    preview.width=740;preview.height=158;
    preview.setAttribute('aria-hidden','true');
    preview.dataset.formation=JSON.stringify(consist);
    window.ContourRailAssets?.renderRailConsist(preview,consist,cargo);
    const bounds=window.ContourRailAssets?.formationBounds(preview)??[];
    const stageTargets=node('div','','railStageTargets');
    stageTargets.style.setProperty('--formation-aspect',String(preview.width/preview.height));
    stageTargets.setAttribute('aria-hidden','true');
    stage.append(preview,stageTargets);
    formation.append(formationHeading,stage);
    const strip=node('div','','railFormationStrip');
    strip.setAttribute('aria-label','Train formation');
    let position=0;
    for(const [part,group] of Object.entries(groups)){
      consist[part].forEach((id,index)=>{
        const unit=group.catalog[id],current=selected();
        const picked=current.part===part&&current.index===index;
        const choose=()=>{draft.selected={part,index};draft.reveal=true;render();};
        const select=keyButton('',part+'-'+index,choose,'railUnit');
        select.style.setProperty('--stock-size',Math.round(20+unit.length*4)+'px');
        select.setAttribute('aria-label','Select '+unit.name+' '+(index+1)+' of '+consist[part].length);
        select.setAttribute('aria-pressed',String(picked));
        select.title=unit.name;
        select.append(railStockCanvas(group.kind,id,126,52),node('span',unit.name));
        strip.append(select);
        const area=bounds[position++];
        if(area){
          const hit=button('',()=>{
            choose();
            body.querySelector('[data-rail-control="'+part+'-'+index+'"]')?.focus({preventScroll:true});
          },'railStageTarget');
          hit.tabIndex=-1;hit.title=unit.name;
          hit.dataset.picked=String(picked);
          hit.style.left=area.left*100+'%';hit.style.width=(area.right-area.left)*100+'%';
          stageTargets.append(hit);
        }
      });
    }
    formation.append(node('p','Select a vehicle to move, duplicate or remove it.','railSelectionHint'),strip);
    const {part,index}=selected(),group=groups[part],items=consist[part],selectedId=items[index];
    const selection=node('div','','railSelection');
    const selectedName=group.catalog[selectedId].name;
    selection.append(node('strong',selectedName));
    const tools=node('div','','railSelectionTools');
    const move=(delta)=>change(()=>{
      const next=index+delta;
      [items[index],items[next]]=[items[next],items[index]];
      draft.selected={part,index:next};draft.reveal=true;
    });
    for(const [icon,description,delta] of [['‹','Move toward front',-1],['›','Move toward rear',1]]){
      const control=keyButton(icon,'move-'+delta,()=>move(delta));
      control.title=description;control.setAttribute('aria-label',description);
      control.disabled=!items[index+delta]||items[index+delta]===selectedId;
      tools.append(control);
    }
    const duplicate=keyButton('Duplicate','duplicate',()=>insert(part,selectedId));
    duplicate.disabled=items.length>=group.limit;
    const remove=keyButton('Remove','remove',()=>change(()=>{
      items.splice(index,1);draft.selected={part,index:Math.min(index,items.length-1)};
    }));
    remove.disabled=items.length<=1;
    if(remove.disabled)remove.title=part==='cars'?'Keep at least one '+(passenger?'coach':'wagon'):'Keep at least one locomotive';
    tools.append(duplicate,remove);
    selection.append(tools);formation.append(selection);depot.append(formation);

    const gallery=node('section','','railGallery');
    const galleryNav=node('div','','railSectionHeading');
    galleryNav.append(node('h5','Rolling stock'));
    const tabs=node('div','','railStockTabs');
    tabs.setAttribute('aria-label','Rolling stock type');
    for(const [part,{label}] of Object.entries(groups)){
      const tab=keyButton(label,'tab-'+part,()=>{draft.tab=part;render();});
      tab.setAttribute('aria-pressed',String(draft.tab===part));tabs.append(tab);
    }
    galleryNav.append(tabs);gallery.append(galleryNav);
    const cards=node('div','','railStockCards');
    const galleryGroup=groups[draft.tab],galleryItems=consist[draft.tab];
    for(const [id,item] of Object.entries(galleryGroup.catalog)){
      const card=keyButton('','add-'+id,()=>insert(draft.tab,id),'railStockCard');
      card.setAttribute('aria-label','Add '+item.name);
      const canAdd=galleryItems.length<galleryGroup.limit;
      card.disabled=!canAdd;
      const visual=node('span','','railStockArt');
      visual.append(railStockCanvas(galleryGroup.kind,id,200,88),node('span','+','railStockAdd'));
      card.append(visual,node('strong',item.name));
      const info=draft.tab==='cars'?item.capacity+' '+unit+' · '+item.speed+' km/h':item.power.toLocaleString('en-GB')+' kW · '+item.tractiveEffort+' kN';
      card.append(node('span',info,'railStockInfo'));
      const trial=copyConsist(consist);
      trial[draft.tab].push(id);
      const trialQuote=model.quote(trial,cargo);
      const hillDelta=trialQuote.valid?changeText(hillSpeed(trialQuote),hill,grade>=.05?'km/h uphill':'km/h on level track'):'';
      const effect=node('span',!canAdd?'Consist limit reached':trialQuote.length>shortest?'Exceeds platform':hillDelta||'+'+item.length+' m','railStockEffect');
      if(!canAdd||trialQuote.length>shortest)effect.classList.add('warning');
      card.append(node('span',cash(item.price),'railStockPrice'),effect);
      cards.append(card);
    }
    gallery.append(cards);depot.append(gallery);

    const report=node('section','','railReport');
    report.append(node('h5','Loaded on this line'));
    const power=node('span',gradeRun.power.toLocaleString('en-GB')+' kW · '+gradeRun.tractiveEffort+' kN');
    power.title='Tractive effort is the pull available when starting. Power helps sustain speed once the train is moving.';
    const grades=changeText(hill,hillSpeed(original),'km/h');
    const seats=changeText(gradeRun.capacity,original.capacity,unit);
    const operating=market.railRunningCost?.(consist);
    const originalOperating=market.railRunningCost?.(draft.original);
    const running=operating==null?'—':cash(operating)+'/km';
    const runningDelta=operating==null||originalOperating==null?'':changeText(operating,originalOperating,'cr/km');
    const details=node('div','','railReportGrid');
    for(const [name,value,delta,icon] of [
      ['Capacity',gradeRun.capacity+' '+unit,seats,cargo],
      ['Running cost',running,runningDelta,'train'],
      [grade>=.05?grade.toFixed(1)+'% grade':'Level track',kmh(hill),grades,'grade'],
      ['Tightest curve',Number.isFinite(radius)?kmh(curve):'Straight',Number.isFinite(radius)?Math.round(radius)+' m radius':'','curve']
    ]){
      const metric=node('div','','railMetric');
      const caption=node('span','','railMetricCaption');caption.append(hud.icon(icon),node('span',name));
      metric.append(caption,node('strong',value));
      if(delta)metric.append(node('span',delta,'railMetricDelta'));
      details.append(metric);
    }
    const mechanics=node('div','','railMechanics');
    mechanics.append(power,node('span',Math.round(gradeRun.loadedMass)+' t loaded'));
    if(Number.isFinite(gradeRun.travel)&&Number.isFinite(gradeRun.returnTravel)){
      mechanics.append(node('span',Math.round(gradeRun.travel)+' s out / '+Math.round(gradeRun.returnTravel)+' s back'));
    }
    report.append(details,mechanics);depot.append(report);

    const live=vehicle?market.railStatus(route,vehicle):null;
    const price=vehicle?market.consistEditPrice(route,vehicle,consist):gradeRun.price;
    const unchanged=vehicle&&JSON.stringify(consist)===JSON.stringify(draft.original);
    const formerDemand=!vehicle&&market.formerDemand(market.routeTrade(route));
    const warning=railFeedback||(!gradeRun.valid?gradeRun.reason:spare<0?'Remove '+Math.ceil(-spare)+' m of rolling stock to fit the shortest platform.':
      gradeRun.stalled?'Add starting pull or remove weight. The loaded train stalls on this line.':
      market.state.cash<price?'Insufficient funds for this formation.':formerDemand?'This line has no active cargo demand.':'');
    const dock=node('div','','railDepotActions');
    const message=node('p',warning||(live&&!live.canEdit?(live.hold?'Train will stop for refit after its next delivery.':'Refit requires an empty train at a station.'):
      hill<25&&grade>0?'Slow on the steepest grade. Try a stronger locomotive or fewer cars.':''),
    warning?'warning':'');
    if(message.textContent){message.setAttribute('role','status');dock.append(message);}
    const actions=node('div','','railActions');
    actions.append(keyButton('Cancel','cancel',closeRailDepot));
    if(live&&!live.canEdit&&!live.hold&&market.setRailHold){
      actions.append(keyButton('Hold at station','depot-hold',()=>{
        if(market.setRailHold(route,vehicle,true)){save();redraw();}
        render();
      }));
    }
    const confirm=keyButton((vehicle?'Apply':'Purchase')+(Number.isFinite(price)?' · '+cash(price):''),'confirm',()=>{
      const ok=vehicle?market.setConsist(route,vehicle,copyConsist(consist)):market.purchase(route,copyConsist(consist));
      if(ok){
        selectedTrain=vehicle??vehicles.at(-1);save();redraw();closeRailDepot();
      }else{railFeedback=vehicle?'Could not apply this consist.':'Could not purchase this train.';render();}
    },'buy');
    confirm.disabled=!gradeRun.valid||spare<0||gradeRun.stalled||market.state.cash<price||!!(live&&!live.canEdit)||!!unchanged||formerDemand;
    actions.append(confirm);dock.append(actions);depot.append(dock);
    return depot;
  }
  function railStockCanvas(kind,id,width,height){
    const canvas=node('canvas','');
    canvas.width=width;canvas.height=height;canvas.dataset.stockKind=kind;canvas.dataset.stockModel=id;
    canvas.setAttribute('aria-hidden','true');
    window.ContourRailAssets?.renderRailStock(canvas,kind,id);
    return canvas;
  }
  function closeRailDepot(){
    const wasRefit=!!railDraft?.vehicle;
    const scroll=railDraft?.returnScroll??0;
    railDraft=null;railFeedback='';render();body.scrollTop=scroll;
    body.querySelector(wasRefit?'.railRefitButton':'.railFleetHeading button')?.focus({preventScroll:true});
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
      node('small','Each twelve riders waiting at least two weeks cost one growth point per week, up to two.'),
      row('Goods growth last week','+'+growth.serviceGrowth.goods+' pts'),
      row('Passenger growth last week','+'+growth.serviceGrowth.passengers+' pts'),
      row('Passenger arrivals this month',growth.riders));
    if(m.freight){
      const freightGoods=m.freight.townGoods(t);
      if(t.starterGoods.includes('timber')){
        const demand=m.weeklyDemand(t);
        freightGoods.push({cargo:'timber',name:'Timber',unlock:0,demand,stock:timber.stock,inbound:timber.inbound,lastUsed:timber.lastUsed});
        data.append(row('Timber homes in range',coverage.timber+' / '+coverage.homes),
          row('Timber used / needed last month',timber.lastDemand?amount.format(timber.lastUsed)+' / '+timber.lastDemand+' loads':'Pending'));
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
        if(good.lastUsed)data.append(row(good.name+' used last month',amount.format(good.lastUsed)));
        }
      }
    }
    if(!t.starterGoods)data.append(node('h3','Timber'),row('Weekly demand',m.weeklyDemand(t)+' loads'),row('En route',timber.inbound+' loads'),
      row('Delivered / used',(received.timber||0)+' / '+timber.used+' loads'),
      row('Last month’s demand met',timber.lastDemand?amount.format(timber.lastUsed)+' / '+timber.lastDemand+' loads':'Pending'),
      row('Homes served',coverage.timber+' / '+coverage.homes));
    data.append(row('Homes',coverage.homes),row('Expansion steps',growth.level),node('h3','Passengers waiting for'));
    for(const dest of valley.towns)if(dest!==t)data.append(row(dest.name,tot[dest.id]));
    data.append(node('h3','Completed trips / requested · recent weeks'));
    for(const item of trips)data.append(row(item.town.name,item.completed+' / '+item.requested+
      (item.aboard?' · '+item.aboard+' aboard':'')+(item.overdue?' · '+item.overdue+' overdue':'')+
      (item.missed?' · '+item.missed+' gave up':'')));
    data.append(node('h3','Goods used / requested · recent weeks'));
    for(const item of goods)data.append(row(item.name,amount.format(item.completed)+' / '+item.requested));
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
    const rail=isRailPlatform(p);
    const bays=!rail&&p.station&&v.transport.stationLayouts?.[window.contourStationKey(p.station)]?.bays;
    if(rail){
      const station=p.station??p;
      const served=v.transport.routes.flatMap((route,index)=>isRail(route)?route.stations.flatMap((stop,side)=>
        ContourTown.stationKey(stop)===key?[{route,index,side}]:[]):[]);
      const heading=node('div','','inspectorContext inspectorService');
      heading.append(hud.icon('train'),document.createTextNode('Rail · '+(station.terminal||station.kind==='terminal'?'Terminal':'Through station')));
      overview.append(heading,stats(['Platform length',Math.round((station.platformLength??2.4)*ContourRail.metresPerUnit)+' m'],
        ['Platform tracks',railPlatformCount(v.transport,station)],['Lines',served.length]));
      if(served.length)data.append(node('h3','Platform assignments'));
      for(const {route,index,side} of served){
        data.append(button('Platform '+assignedPlatform(route,side)+' · Line '+(index+1)+' → '+route.stations[1-side].name,
          ()=>inspectRoute(index),'menuItem'));
      }
    }
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
    const starter=service==='starter',freight=service!=='passengers';
    const units=starter?'':freight?' loads':' trips';
    overview.append(stats(['Service',states[home.status]],['Coverage',home.covered?'In range':'Out of range']),
      meters(meter('Satisfaction',home.ratio,{cargo:starter?null:freight?'timber':'passengers'})));
    data.append(row(starter?'Starter goods':freight?'Estimated demand':'Trips requested',starter?
        city.starterGoods.map(cargo=>ContourRegion.goods[cargo][0]).join(' + '):amount.format(home.demand)+units),
      ...(starter?[]:[row(freight?'Stock used':'Trips completed',amount.format(home.served)+units)]));
    if(starter&&home.lastGoods){
      data.append(node('h3','Last week · supplied / needed'));
      for(const [cargo,{served,demand}] of Object.entries(home.lastGoods)){
        data.append(row(ContourRegion.goods[cargo][0],amount.format(served)+' / '+amount.format(demand)+' loads'));
      }
    }
    if(home.withinGrace>.001)data.append(row('Within grace period',amount.format(home.withinGrace)+units));
    if(freight){
      const weekly=starter?city.starterGoods.reduce((sum,cargo)=>sum+(cargo==='timber'?m.weeklyDemand(city):m.freight.weeklyDemand(city,cargo)),0):m.weeklyDemand(city);
      data.append(row('Weekly need per home',amount.format(weekly/Math.max(1,m.homes(city).length))+' loads'));
    }
    data.append(row('Activity counts','Last '+m.serviceWindow+' game weeks'),
      node('small',freight?'Satisfaction fades by 10% of its current value per week and recovers with service.':
        'Passenger satisfaction uses actual trips, including riders aboard and riders who waited too long.'),
      node('small',starter?'Both starter goods have equal weight. Supplies go to homes nearest the receiving station or truck drop-off along connected streets.':
        freight?'Timber serves nearby homes from the receiving station or the stop where a truck unloaded.':
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
        return {line:index+1,name:routeName(route),service:m.kind(route),mode:transportMode(route),local:route.local??null,
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
    el('cash').textContent=v.unlimitedFunds?'Unlimited funds':cash(m.state.cash);clock();
    if(overlay==='service:timber'&&v.region)overlay='service:starter';
    if(overlay==='service:starter'&&!v.region)overlay='service:timber';
    const serviceLegend=el('serviceLegend'),service=overlay.split(':')[1];
    const cargoLabel=v.region?'Starter goods satisfaction':'Timber satisfaction';
    el('toggleTimberService').title=cargoLabel;
    el('toggleTimberService').setAttribute('aria-label',cargoLabel);
    serviceLegend.hidden=!service;
    if(service){
      el('serviceLegendTitle').textContent=service==='passengers'?'Passenger satisfaction':cargoLabel;
      el('serviceLegendPeriod').textContent=service==='passengers'?'Satisfaction fades weekly':'Ring shows household satisfaction';
    }
    el('togglePassengerService').setAttribute('aria-pressed',String(service==='passengers'));
    el('toggleTimberService').setAttribute('aria-pressed',String(service==='timber'||service==='starter'));
    el('toggleLabels').setAttribute('aria-pressed',String(labels));
    el('toggleRoutes').setAttribute('aria-pressed',String(overlay==='routes'));panel.hidden=!view;
    panel.classList.toggle('financePanel',view==='finance');
    panel.classList.toggle('inspectorPanel',inspectors.has(view));
    const railInspector=view==='detail'&&isRail(rs[routeIndex]);
    panel.classList.toggle('railPanel',railInspector);
    panel.classList.toggle('railDepotPanel',railInspector&&!!railDraft);
    footer.hidden=!inspectors.has(view)||view==='home'||(view==='stop'&&!selectedStop?.platform.station);
    el('toolMenu').setAttribute('aria-expanded',String(!!view));
    if(!view){delete body.dataset.inspector;return;}
    const title={tools:'Network tools',build:'New route',routes:'Existing routes',routeChoice:'Choose a route',track:'Rail track',detail:'Route accounts',towns:'Towns and industries',town:'Town demand',layers:'Map overlays',mill:'Valley Sawmill',settings:'Settings',restart:'Restart valley',deleteLoop:'Delete loop',removeRoute:'Remove route',removeStation:'Remove station',finance:'Company history'}[view];
    if(inspectors.has(view)){
      const name=view==='home'?v.towns.find(t=>t.id===selectedHome.cityId)?.name+' · '+(selectedHome.service==='starter'?'Starter goods':selectedHome.service==='timber'?'Timber':'Passengers'):view==='stop'?selectedStop.platform.name:view==='detail'?routeName(rs[routeIndex]):view==='mill'?sites(v).find(site=>site.id===townId).name:v.towns.find(t=>t.id===townId).name;
      if(el('panelTitle').textContent!==name)el('panelTitle').textContent=name;
      renderInspector(v);
      return;
    }
    delete body.dataset.inspector;
    el('panelTitle').textContent=title;body.replaceChildren();
    if(view==='track'){
      body.append(button('Edit railway · paths and connections',()=>openRailway(),'menuItem'));
      const track=v.transport.railTracks?.[selectedTrack];
      if(!track){body.append(node('small','This track is no longer available.'));return;}
      const stations=v.transport.railStations??{};
      const name=id=>stations[id]?.name??'Junction';
      body.append(node('strong',name(track.from)+' → '+name(track.to)));
      const length=track.points.slice(1).reduce((sum,p,i)=>sum+Math.hypot(p.x-track.points[i].x,p.y-track.points[i].y),0);
      body.append(row('Length',Math.round(length*40)+' m'),row('Tracks',track.tracks===2?'Double':'Single'));
      if(track.tracks!==2){
        const cost=ContourRail.secondTrackCost(track,v.region==='mixed');
        body.append(button('Add second track · '+cash(cost),()=>{
          const result=upgradeRailTrack(selectedTrack);
          trackFeedback=result===true?'Second track built.':result||'The track could not be upgraded.';
          render();
        },'menuItem'));
      }
      if(trackFeedback)body.append(node('small',trackFeedback));
      const services=v.transport.routes.filter(r=>r.mode==='rail'&&r.trackIds?.includes(track.id));
      for(const route of services)body.append(button(routeName(route)+'  ›',()=>{routeIndex=rs.indexOf(route);open('detail');},'menuItem'));
    }
    if(view==='finance')finance(v);
    if(view==='build'){
      body.append(button('Road route',()=>{open('');buildRoute('road');},'menuItem'));
      body.append(button('Rail route',()=>{open('');buildRoute('rail');},'menuItem'));
      body.append(button('Local bus loop',()=>{open('');editTown('bus');},'menuItem'));
      body.append(button('Local delivery loop',()=>{open('');editTown('delivery');},'menuItem'));
    }
    if(view==='tools'){
      body.append(button('Railway · tracks and services',()=>openRailway(),'menuItem'));
      for(const [id,name] of [['towns','Towns and industries'],['layers','Map overlays']])body.append(button(name+'  ›',()=>open(id),'menuItem'));
      body.append(button('Whole valley',()=>{focus('region');open('');},'menuItem'));
      body.append(button(resumeState()?'Pause simulation':'Resume simulation',()=>{pause();render();},'menuItem'));
    }
    if(view==='layers'){
      for(const [id,name] of [['standard','Standard map'],['range','Station catchments'],[v.region?'service:starter':'service:timber',cargoLabel],['service:passengers','Passenger satisfaction'],['routes','Routes and vehicles']])
        body.append(button((overlay===id?'✓  ':'')+name,()=>setOverlay(id),'menuItem'));
      if(overlay==='range')body.append(node('small','Green dots mark homes reached along connected streets. Local stops can extend coverage beyond a station.'));
      if(overlay==='routes')body.append(node('small','Tap a highlighted route or vehicle badge for its accounts. Badges show line number, passenger or goods icon, and load / capacity. Q marks a queue. Full means the town has no room to unload.'));

    }
    if(view==='routeChoice'){
      for(const index of routeChoices){
        const route=rs[index];
        if(!route)continue;
        const choice=button('',()=>inspectRoute(index),'routeItem routeChoice');
        const dot=node('span','','routeChoiceColor');
        dot.style.backgroundColor=ContourRouteOverlay.color(index);
        choice.append(dot,node('strong',routeName(route)),node('small','Line '+(index+1)+' · '+(isRail(route)?'Rail · ':'')+m.kind(route)));
        body.append(choice);
      }
      return;
    }
    if(view==='routes'){
      const filters=node('div','','routeFilters');
      const locations=[...v.towns,...sites(v)];
      const cargo=[...new Set(rs.map(m.kind))].sort();
      filters.append(picker([['','All places'],...locations.map(t=>[t.id,t.name])],filter,x=>{filter=x;render();},'Filter by place'),
        picker([['','All services'],...cargo.map(name=>[name,name])],type,x=>{type=x;render();},'Filter by service'),
        picker([['','Road and rail'],['road','Road'],['rail','Rail']],mode,x=>{mode=x;render();},'Filter by transport mode'));
      body.append(filters,node('small','Monthly throughput · actual / potential'));
      let count=0;rs.forEach((r,i)=>{
        if((filter&&!r.stations.some(s=>m.source(s)?.id===filter))||(type&&m.kind(r)!==type)||(mode&&transportMode(r)!==mode))return;
        const last=m.fleet(r).lastMonth,net=last?profit(last):null,kind=m.kind(r);
        const b=button('',()=>inspectRoute(i),'routeItem');
        const {actual,potential}=m.routeThroughput(r,i);
        const units=m.isFreight(r)?'loads':'riders';
        const icon=hud.icon(isRail(r)?'train':routeCargo(m,r));
        icon.setAttribute('aria-hidden','true');
        b.setAttribute('aria-label','Line '+(i+1)+', '+(isRail(r)?'rail':'road')+', '+kind+', '+routeName(r)+', '+
          (actual===null?'actual throughput pending':actual+' '+units+' completed last month')+
          ', estimated potential '+Math.round(potential)+' '+units+' per month'+(net===null?'':', '+cash(net)+' last month'));
        const throughput=node('small',(isRail(r)?'Rail · ':'')+kind+' · '+(actual??'—')+' / '+Math.round(potential)+' '+units,'routeThroughput');
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
          if(switchRegion()){filter=type=mode=statsTown='';financeEnd=null;open('');}
        },'menuItem'),
        button(v.region?'Restart Three Biomes':'Restart with a new valley',()=>open('restart'),'menuItem'));

    }
    if(view==='deleteLoop'||view==='removeRoute'){
      const route=rs[routeIndex];
      body.append(node('p','Remove '+routeName(route)+'? '+(route.local?
        'This removes the loop and its vehicles. Shared stops stay in place.':
        'This removes the service and its vehicles. '+(isRail(route)?'Tracks':'Roads')+' and stations stay available for future routes.')));
      body.append(button('Confirm removal',()=>{(route.local?deleteLoop:deleteRoute)(route);open('routes');},'restartAction'));
      body.append(button('Cancel',()=>open('detail'),'back'));
      return;
    }
    if(view==='removeStation'){
      const {station,name}=selectedStop.platform;
      body.append(node('p','Remove '+name+'?'),button('Confirm removal',()=>{
        if(deleteRailStation(station))open('');
        else open('stop');
      },'restartAction'),button('Cancel',()=>open('stop'),'back'));
      return;
    }
    if(view==='restart'){
      body.append(node('p','Generate a new valley and clear this valley’s roads, vehicles, finances and route draft.'));
      body.append(button('Restart valley',()=>{
        try{
          if(restart()){overlay=baseOverlay='routes';filter=type=mode='';financeEnd=null;statsTown='';listScroll=0;open('');return;}
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
  el('toolMenu').onclick=()=>open(view?'':'tools');el('panelClose').onclick=()=>railDraft?closeRailDepot():open(view==='detail'?'routes':'');
  el('zoomIn').onclick=()=>zoom(1.25);el('zoomOut').onclick=()=>zoom(.8);
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&view){if(railDraft)closeRailDepot();else open('');}});
  window.addEventListener('popstate',()=>{if(view)open('',true);});
  function tick(){
    const valley=getValley();if(!valley)return;
    el('cash').textContent=valley.unlimitedFunds?'Unlimited funds':cash(valley.market.state.cash);
    if(inspectors.has(view)||view==='stop'){
      const editor=body.querySelector('.railConsist');
      const anchor=editor?.getBoundingClientRect().top;
      render();
      if(editor&&railDraft){
        const updated=body.querySelector('.railConsist');
        if(updated)body.scrollTop+=updated.getBoundingClientRect().top-anchor;
      }
      return;
    }
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
  return {render,open,tick,clock,inspectTrack(id){selectedTrack=id;trackFeedback='';open('track');},inspectPlace,inspectRoute,inspectVehicle:inspectRoute,inspectRoutes,inspectStop(key,platform){selectedStop={key,platform};open('stop');},inspectHome(cityId,lotId,service){selectedHome={cityId,lotId,service};open('home');},get selectedHome(){return view==='home'?selectedHome:null;},get labels(){return labels;},get activeRoute(){return view==='detail'?routeIndex:null;},get overlay(){return overlay;},get view(){return view;}};
};
