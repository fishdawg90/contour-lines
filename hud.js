window.ContourHUD=(()=>{
  const acronyms={millbank:'MBK',alderbrook:'ALD',eastmere:'EAS',mesa:'RDW',willow:'WLR',mire:'MRL'};
  const colors=['#8cdce2','#acbbff','#e3b8f1','#8ddfc4','#9ec8f4','#ebc6e0'];
  const trend={'Growing fast':'↑↑',Growing:'↑',Stable:'→',Declining:'↓','Declining fast':'↓↓',Pending:'·'};
  const shapes={
    log:'M4 10l9-5 4 4-9 5M8 14c0 2-4 2-4 0v-4c0-2 4-2 4 0zM6 12h.01',
    stone:'M2 14l3-7 6-3 6 5 1 5-8 3zM5 7l5 4 7-2m-7 2v6',
    fish:'M2 10c4-7 10-6 13-2l3-2v8l-3-2c-3 4-9 5-13-2zm5-1h.01',
    leaf:'M4 16c0-8 4-12 12-12 0 8-4 12-10 11m-3 3 9-9',
    sack:'M7 3h6l-1 4 4 6v3H4v-3l4-6zM8 7h4m-5 6h6',
    brick:'M2 5h16v10H2zm0 5h16M7 5v5m6 0v5',
    chair:'M5 3v9h10V8M5 12v5m10-5v5M5 8h10',
    beam:'M3 5h14v3h-5v4h5v3H3v-3h5V8H3z',
    rock:'M3 12l4-7 8 1 3 7-6 4-8-1zm4-7 5 12m3-11-6 5',
    wheat:'M10 17V4m0 6Q4 10 5 5q5 0 5 5zm0 3q6 0 5-5-5 0-5 5z',
    cloth:'M3 5h14v10H3zm3 0v10m4-10v10m4-10v10',
    board:'M3 14 14 3l4 4L7 18zm3 0L15 5',
    barrel:'M6 3h8l2 5v4l-2 5H6l-2-5V8zm-2 5h12m-12 4h12',
    crate:'M3 4h14v12H3zm0 0 14 12m0-12L3 16',
    pot:'M6 3h8m-7 0v4c-6 4-3 10 3 10s9-6 3-10V3',
    bolt:'m11 2-6 9h5l-1 7 6-9h-5z',
    bus:'M4 4h12v11H4zm0 7h12M6 15v2m8-2v2m-7-4h.01m6 0h.01'
  };
  const cargoStyles={
    timber:['log','#eac17c'],stone:['stone','#c7c8c3'],fish:['fish','#88d5e1'],peat:['leaf','#b4a280'],
    flour:['sack','#efe0ae'],bricks:['brick','#eb977f'],furniture:['chair','#e4af86'],steel:['beam','#b9c3d6'],
    copper:['beam','#f0ac84'],grain:['wheat','#e7ce77'],clay:['rock','#d7a29a'],iron:['rock','#a9b6c7'],
    copperOre:['rock','#de977b'],coal:['rock','#a3a5a5'],reeds:['wheat','#b7cf83'],fabric:['cloth','#d5a9e1'],
    logs:['log','#cbb28a'],boards:['board','#ecc386'],produce:['leaf','#abd591'],fuel:['barrel','#efad75'],
    pine:['log','#a8cca5'],joinery:['board','#e7bc99'],kaolin:['rock','#e9ddd3'],ceramics:['pot','#f2b69f'],
    insulation:['cloth','#e7d2a2'],transit:['bus','#adbfef'],power:['bolt','#f4dc80'],
    passengers:['bus','#87dce2'],depot:['crate','#e1c9a6']
  };
  const cargoLabel=cargo=>ContourRegion.goods[cargo]?.[0]??(cargo==='depot'?'Trading depot':'Passengers');
  const color=cargo=>cargoStyles[cargo]?.[1]??'#e7d8ba';
  function icon(cargo){
    const [shape]=cargoStyles[cargo]??cargoStyles.depot;
    const ns='http://www.w3.org/2000/svg';
    const svg=document.createElementNS(ns,'svg'),path=document.createElementNS(ns,'path');
    svg.setAttribute('viewBox','0 0 20 20');
    svg.setAttribute('class','cargoGlyph');
    svg.setAttribute('aria-hidden','true');
    svg.style.color=color(cargo);
    path.setAttribute('d',shapes[shape]);svg.append(path);
    return svg;
  }
  const short=town=>acronyms[town.id]??town.name.slice(0,3).toUpperCase();
  const percent=rate=>rate==null?'—':Math.round(Math.min(1,Math.max(0,rate))*100)+'%';
  return {short,trend,cargoLabel,color,icon,percent,tripColor:(towns,town)=>colors[towns.indexOf(town)%colors.length]};
})();
