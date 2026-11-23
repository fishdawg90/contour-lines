// Biome models from the Contour Lines Asset Lab.
(()=>{
"use strict";
const clamp = (n,a,b) => Math.min(b,Math.max(a,n));
const mix = (a,b,t) => a+(b-a)*t;
const tau = Math.PI*2;
const palette = {glass:'#668b89', darkGlass:'#375457', tyre:'#323536', hub:'#a8a49a', stone:'#b0ab91', cream:'#e9dbb9', wood:'#886a48', brick:'#a76e50'};
function normal([a,b,c]){
  const u=b.map((v,i)=>v-a[i]),v=c.map((n,i)=>n-a[i]);
  return [u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];
}
function solid(mesh, points, faces, colours){
  const mid=points[0].map((_,i)=>points.reduce((t,p)=>t+p[i],0)/points.length);
  for(const [i,ids] of faces.entries()){
    const p=ids.map(j=>points[j]);
    let n=normal(p);
    if(n.reduce((t,v,j)=>t+v*(p[0][j]-mid[j]),0)<0){p.reverse();n=normal(p);}
    const len=Math.hypot(...n);
    if(len>1e-8)mesh.push({p,n:n.map(v=>v/len),c:Array.isArray(colours)?colours[i%colours.length]:colours});
  }
}
function box(m,x,y,z,l,w,h,c){
  const a=x-l/2,b=x+l/2,d=y-w/2,e=y+w/2;
  solid(m,[[a,d,z],[b,d,z],[b,e,z],[a,e,z],[a,d,z+h],[b,d,z+h],[b,e,z+h],[a,e,z+h]],
    [[0,1,2,3],[4,5,6,7],[0,1,5,4],[1,2,6,5],[2,3,7,6],[3,0,4,7]],c);
}
function gable(m,x,y,z,l,w,h,c){
  const a=x-l/2,b=x+l/2,d=y-w/2,e=y+w/2;
  solid(m,[[a,d,z],[a,e,z],[a,y,z+h],[b,d,z],[b,e,z],[b,y,z+h]],[[0,1,2],[3,4,5],[0,3,4,1],[0,2,5,3],[1,4,5,2]],c);
}
function ring(m,x,y,z,r,R,h,c,sides=8,axis='z',rx=1,ry=1){
  const p=[];
  for(const [radius,d] of [[r,0],[R,h]])for(let i=0;i<sides;i++){
    const u=Math.cos(i*tau/sides)*radius*rx,v=Math.sin(i*tau/sides)*radius*ry;
    p.push(axis==='z'?[x+u,y+v,z+d]:axis==='y'?[x+u,y+d,z+v]:[x+d,y+u,z+v]);
  }
  const base=Array.from({length:sides},(_,i)=>i);
  solid(m,p,[base,base.map(i=>i+sides),...base.map(i=>[i,(i+1)%sides,(i+1)%sides+sides,i+sides])],c);
}
function shade(hex,f){
  const n=parseInt(hex.slice(1),16);
  const rgb=[n>>16,(n>>8)&255,n&255].map(v=>clamp(Math.round(v*f),0,255));
  return 'rgb('+rgb.join(',')+')';
}
function panel(m,axis,side,plane,centre,z,width,height,c){
  const point=(u,v)=>axis==='y'?[u,side*plane,v]:[side*plane,u,v];
  const a=centre-width/2,b=centre+width/2;
  const p=[point(a,z),point(b,z),point(b,z+height),point(a,z+height)];
  if((axis==='y'? -1:1)!==side)p.reverse();
  m.push({p,n:axis==='y'?[0,side,0]:[side,0,0],c});
}
function cargo(name){
  const m=[];
  const pallet=(x,y,l,w)=>{
    for(const dy of [-.36,0,.36])box(m,x,y+dy*w,0,l,.11,.107,'#77604a');
    for(const dx of [-.36,0,.36])box(m,x+dx*l,y,.107,.23*l,w,.064,'#9a7958');
  };
  if(name==='Log stack'){
    for(const x of [-.73,.74])box(m,x,0,0,.16,1.18,.129,'#736049');
    for(const [y,z,r,x,l] of [[-.38,.29,.19,.03,2.26],[0,.28,.18,-.08,2.36],[.40,.28,.17,.08,2.22],[-.18,.59,.18,.02,2.24],[.20,.57,.16,-.03,2.33],[-.01,.85,.155,.05,2.17]]){
      const from=x-l/2,to=x+l/2;
      ring(m,from,y,z,r*.97,r,l,'#806346',8,'x');
      for(const sign of [-1,1]){
        const end=sign<0?from:to;
        ring(m,end+(sign<0?-.018:.004),y,z,r*.82,r*.82,.014,'#c19b70',8,'x');
        ring(m,end+(sign<0?-.030:.022),y,z,r*.43,r*.43,.009,'#a77d56',7,'x');
      }
    }
  }else if(name==='Sawn timber'){
    for(const x of [-.7,.72])box(m,x,0,0,.16,1.36,.13,'#775b43');
    for(let row=0;row<4;row++){
      const z=.13+row*.17,w=1.30-row*.035;
      box(m,0,0,z,2.44-row*.071,w,.125,['#c4a477','#b69568','#d2b487','#c7a67b'][row]);
      for(const side of [-1,1]){
        const end=(2.44-row*.071)/2+.012;
        for(const y of [-.32,.01,.34])panel(m,'x',side,end,y,z+.012,.02,.101,'#967654');
      }
      for(const x of [-.73,.73])if(row<3)box(m,x,0,z+.125,.065,w+.046,.045,'#897254');
    }
    for(const x of [-.69,.68]){
      box(m,x,0,.769,.065,1.23,.034,'#525c51');
      for(const y of [-.62,.62])box(m,x,y,.15,.063,.021,.61,'#576255');
    }
  }else if(name==='Crated goods'){
    pallet(0,0,1.87,1.30);
    for(const [x,y,z,l,w,h] of [[-.46,.02,.171,.84,1.12,.55],[.44,.02,.171,.82,1.10,.54],[-.42,.03,.731,.69,.89,.50]]){
      box(m,x,y,z,l,w,h,'#a27e58');
      for(const side of [-1,1]){
        for(const across of [y-w*.34,y+w*.34])box(m,x+side*l*.50,across,z+.012,.07,.083,h-.026,'#c6a375');
        const plane=Math.abs(y+side*w/2)+.018;
        panel(m,'y',side,plane,x,z+h*.48,l*.86,.043,'#785a3f');
        box(m,x,y+side*w*.48,z+h-.038,l-.036,.076,.06,'#c9a678');
      }
      panel(m,'x',1,x+l/2+.023,y,z+h*.52,.22,.15,'#d9caa3');
    }
  }else if(name==='Pallet sacks'){
    pallet(0,0,1.43,1.19);
    for(let row=0;row<3;row++)for(const side of [-1,1]){
      const x=side*.30+(row%2)*.06,y=side*(row===2?.05:.13),z=.175+row*.227;
      const col=['#baaa83','#c9b894','#d4c39d'][row];
      ring(m,x,y,z,.34,.45,.085,col,8,'z',.76,1.29);
      ring(m,x,y,z+.085,.45,.35,.128,col,8,'z',.76,1.29);
      panel(m,'x',side,Math.abs(x)+.314,y,z+.084,.25,.040,'#8c7960');
    }
  }else if(name==='Aggregate bay'){
    const concrete='#a19d86';
    box(m,0,0,0,2.52,1.77,.13,'#97917d');
    box(m,-1.14,0,.13,.18,1.77,.85,concrete);
    for(const side of [-1,1])box(m,-.12,side*.798,.13,2.12,.17,.71,concrete);
    const stones=['#858574','#a09b83','#b3aa8e','#969681'];
    ring(m,-.17,0,.137,.97,.32,.57,stones,9,'z',1.05,.71);
    for(const [x,y,z,r] of [[.52,.13,.17,.18],[.69,-.43,.16,.14],[.20,.48,.22,.16],[.79,.23,.145,.11],[-.27,.38,.47,.17]])ring(m,x,y,z,r,r*.59,r*.57,stones,5);
  }
  return m;
}
function mergeModel(out,mesh,x,y,z,yaw=0,scale=1){
  const c=Math.cos(yaw),s=Math.sin(yaw);
  for(const {p,n,c:colour} of mesh){
    const [nx,ny,nz]=n;
    out.push({p:p.map(([u,v,w])=>[x+(c*u-s*v)*scale,y+(s*u+c*v)*scale,z+w*scale]),
      n:[c*nx-s*ny,s*nx+c*ny,nz],c:colour});
  }
}
const westColour={wood:'#986b48',dark:'#594335',board:'#bc925f',trim:'#d8b780',iron:'#514e47',stone:'#9f8065',cream:'#dfc394',glass:'#536568',roof:'#775c48'};
function beamBetween(m,a,b,width,colour){
  const d=b.map((v,i)=>v-a[i]),l=Math.hypot(...d);
  if(l<.001)return;
  const v=d.map(n=>n/l),cross=Math.hypot(v[0],v[1]);
  const u=cross<.001?[1,0,0]:[-v[1]/cross,v[0]/cross,0];
  const w=[v[1]*u[2]-v[2]*u[1],v[2]*u[0]-v[0]*u[2],v[0]*u[1]-v[1]*u[0]];
  const p=[a,b].flatMap(q=>[[-1,-1],[1,-1],[1,1],[-1,1]].map(([s,t])=>q.map((n,i)=>n+width/2*(s*u[i]+t*w[i]))));
  solid(m,p,[[0,1,2,3],[4,5,6,7],[0,1,5,4],[1,2,6,5],[2,3,7,6],[3,0,4,7]],colour);
}
function shopWindow(m,x,y,z,w,h,frame=westColour.trim){
  panel(m,'y',1,y+.021,x,z,w,h,frame);
  panel(m,'y',1,y+.047,x,z+.072,w-.13,h-.135,westColour.glass);
  panel(m,'y',1,y+.067,x,z+.071,.042,h-.141,frame);
  panel(m,'y',1,y+.069,x,z+h*.54,w-.129,.038,frame);
}
function shopSign(m,y,z,w,text){
  box(m,0,y+.031,z,w,.095,.36,'#51443a');
  const glyphs={
    A:['010','101','111','101','101'],B:['110','101','110','101','110'],C:['011','100','100','100','011'],
    D:['110','101','101','101','110'],E:['111','100','110','100','111'],F:['111','100','110','100','100'],
    H:['101','101','111','101','101'],I:['111','010','010','010','111'],L:['100','100','100','100','111'],
    N:['101','111','111','111','101'],O:['111','101','101','101','111'],P:['110','101','110','100','100'],R:['110','101','110','101','101'],
    S:['011','100','010','001','110'],T:['111','010','010','010','010'],V:['101','101','101','101','010'],Y:['101','101','010','010','010']
  };
  const dx=Math.min(.050,(w-.23)/(text.length*4-1)),start=-(text.length*4-2)*dx/2;
  [...text].forEach((letter,i)=>glyphs[letter]?.forEach((row,j)=>{
    for(const [k,bit] of [...row].entries())if(bit==='1')panel(m,'y',1,y+.093,start+(i*4+k)*dx,z+.084+(4-j)*dx,dx*.92,dx*.91,'#e8c998');
  }));
}
function leanRoof(m,x,y,z,l,w,fall,col){
  const [a,b,d,e]=[x-l/2,x+l/2,y-w/2,y+w/2],thickness=.077;
  const p=[[a,d,z+fall],[b,d,z+fall],[b,e,z],[a,e,z]];
  solid(m,p.concat(p.map(([x,y,z])=>[x,y,z+thickness])),
    [[0,1,2,3],[4,5,6,7],[0,1,5,4],[1,2,6,5],[2,3,7,6],[3,0,4,7]],col);
}
function timberLadder(m,x,y,z,height,col=westColour.wood){
  for(const dx of [-.145,.145])box(m,x+dx,y,z,.049,.065,height,col);
  for(let i=.18;i<height;i+=.24)box(m,x,y+.009,z+i,.32,.046,.042,col);
}
function railFence(m,x,y,z,length,height,col){
  for(let i=0;i<=6;i++)box(m,x+length*(i/6-.5),y,z,.053,.062,height,col);
  box(m,x,y,z+height-.035,length+.07,.093,.066,col);
  box(m,x,y,z+.093,length+.015,.048,.052,col);
}
function frontDoor(m,x,y,z,width,height,colour,trim=westColour.trim){
  panel(m,'y',1,y+.020,x,z,width+.115,height+.10,trim);
  panel(m,'y',1,y+.041,x,z+.036,width,height,colour);
  box(m,x,y+.05,z-.066,width+.186,.21,.073,trim);
  panel(m,'y',1,y+.060,x+width*.28,z+height*.50,.048,.051,'#c39e6c');
}
function buildChimney(m,x,y,z,h,c='#a18570'){
  box(m,x,y,z,.32,.32,h,c);
  box(m,x,y,z+h,.41,.41,.111,'#ad987c');
  box(m,x,y,z+h+.111,.18,.18,.023,'#5b5045');
}
function westernBuilding(name){
  const m=[],c=westColour;
  const deck=(x,y,z,l,w)=>box(m,x,y,z,l,w,.115,'#b18a60');
  const siding=(l,w,h,wall)=>{
    box(m,0,0,0,l+.13,w+.16,.16,c.stone);
    box(m,0,0,.16,l,w,h-.16,wall);
  };
  const pitched=(l,w,h,rise,col,axis='x')=>{
    if(axis==='x')gable(m,0,0,h,l,w,rise,col);
    else{
      const roof=[];gable(roof,0,0,h,w,l,rise,col);
      mergeModel(m,roof,0,0,0,Math.PI/2);
    }
  };
  const door=(x,y,w=.51,h=1.02,col=c.dark)=>frontDoor(m,x,y,.23,w,h,col);
  const porch=(x,y,z,l,depth,colour)=>{
    deck(x,y+depth/2,.083,l,depth);
    for(const dx of [-l*.46,l*.46])box(m,x+dx,y+depth-.088,.198,.092,.093,z-.198,c.trim);
    leanRoof(m,x,y+depth*.52,z,l+.15,depth*1.13,.15,colour);
  };

  if(name==='General store'){
    siding(3.51,2.34,2.30,'#81927c');
    leanRoof(m,0,-.07,2.31,3.61,2.38,.29,'#687266');
    box(m,0,1.18,2.30,3.56,.18,.46,'#8fa28b');
    box(m,0,1.19,2.76,3.75,.245,.095,'#e0bd8e');
    box(m,0,1.19,2.85,2.76,.19,.104,'#acb29a');
    shopSign(m,1.289,2.325,2.56,'STORE');
    porch(0,1.17,1.63,3.72,.83,'#9c9f7e');
    for(const x of [-1.20,-.60,0,.60,1.20]){
      leanRoof(m,x,1.17+.432,1.718,.257,.868,.153,'#d9c5a2');
    }
    door(.07,1.17,.53,1.12,'#526a5e');
    for(const x of [-1.03,1.06]){
      shopWindow(m,x,1.17,.55,1.01,.91);
      box(m,x,1.26,.481,.97,.18,.069,'#c5b08a');
    }
    box(m,-1.42,1.83,.204,.49,.34,.27,'#a88762');
    box(m,-1.42,1.83,.475,.43,.29,.047,'#908c63');
  }else if(name==='Saloon'){
    siding(3.52,2.48,2.48,'#a96851');
    pitched(3.81,2.71,2.48,.68,'#7a4d41');
    for(const [width,height,z] of [[3.53,.35,2.48],[2.54,.27,2.83],[1.82,.24,3.1]]){
      box(m,0,1.29,z,width,.20,height,'#aa7055');
      box(m,0,1.408,z+height-.08,width+.12,.097,.069,'#deab7b');
    }
    shopSign(m,1.40,2.78,2.28,'SALOON');
    deck(0,1.68,.087,3.82,.88);
    deck(0,1.60,1.52,3.78,.69);
    for(const x of [-1.69,1.69]){
      box(m,x,1.88,.201,.108,.108,1.32,'#d2a378');
      box(m,x,1.88,1.635,.096,.096,.56,'#d4a981');
    }
    railFence(m,0,1.93,1.636,3.35,.39,'#d7a97c');
    door(0,1.24,.81,1.08,'#52372f');
    for(const x of [-.236,.236])panel(m,'y',1,1.312,x,.54,.35,.53,'#dfb77a');
    for(const x of [-1.16,1.16]){
      shopWindow(m,x,1.24,.63,.63,.64);
      shopWindow(m,x,1.24,1.83,.51,.52);
    }
  }else if(name==='Sheriff office'){
    siding(3.17,2.35,1.92,'#be9c76');
    box(m,0,0,1.92,3.27,2.46,.16,'#c4a785');
    for(const y of [-1.15,1.15])box(m,0,y,2.08,3.21,.16,.26,'#a58564');
    for(const x of [-1.53,1.53])box(m,x,0,2.08,.15,2.28,.26,'#a58564');
    box(m,0,1.151,2.34,1.18,.184,.15,'#bb9e7d');
    shopSign(m,1.243,1.71,2.43,'SHERIFF');
    door(-.68,1.175,.51,1.07,'#695b4e');
    shopWindow(m,.69,1.175,.73,.73,.61,'#ab8b6e');
    for(const x of [.49,.62,.75,.88])box(m,x,1.26,.799,.038,.034,.489,'#665c51');
    deck(0,1.436,.067,3.21,.53);
    ring(m,-1.24,1.252,1.47,.133,.109,.055,'#c4a364',6,'y');
  }else if(name==='Frontier hotel'){
    siding(3.76,2.58,3.12,'#c4a67d');
    const outline=(l,w,z)=>[[-l,-w,z],[l,-w,z],[l,w,z],[-l,w,z]];
    solid(m,outline(2.03,1.43,3.12).concat(outline(1.34,.62,3.63)),
      [[0,1,2,3],[4,5,6,7],[0,1,5,4],[1,2,6,5],[2,3,7,6],[3,0,4,7]],'#796e60');
    box(m,0,1.294,2.91,3.94,.234,.193,'#e0c399');
    box(m,0,1.30,3.104,2.13,.18,.25,'#b28d66');
    shopSign(m,1.402,2.96,1.99,'HOTEL');
    deck(0,1.77,.086,3.97,.98);deck(0,1.72,1.686,3.96,.87);
    for(const x of [-1.8,-.93,.93,1.8])box(m,x,2.07,.20,.081,.086,1.486,'#dbc099');
    railFence(m,0,2.12,1.801,3.87,.445,'#e1c499');
    for(const x of [-1.25,0,1.25])shopWindow(m,x,1.29,2.10,.62,.72,'#e1c699');
    for(const x of [-1.21,1.21])shopWindow(m,x,1.29,.64,.70,.78,'#e0c399');
    door(0,1.29,.68,1.23,'#705746');
    buildChimney(m,-1.14,-.69,3.28,.51);
  }else if(name==='Adobe house'){
    siding(3.13,2.44,1.80,'#c39776');
    box(m,0,0,1.80,3.24,2.53,.16,'#d3a784');
    for(const y of [-1.20,1.20])box(m,0,y,1.96,3.21,.14,.22,'#c79b79');
    for(const x of [-1.51,1.51])box(m,x,0,1.96,.14,2.25,.22,'#c79b79');
    box(m,-.81,-.63,1.98,.95,.80,.51,'#b38769');
    box(m,-.81,-.63,2.49,1.03,.87,.094,'#d1a583');
    door(.51,1.22,.48,.95,'#765542');
    shopWindow(m,-.58,1.22,.77,.62,.54,'#a46d51');
    timberLadder(m,1.09,1.35,.05,2.26,c.wood);
    for(const x of [-1.11,-.68,-.24,.19,.62,1.05])box(m,x,1.22,1.57,.136,.30,.11,c.wood);
  }else if(name==='Rail water tower'){
    for(const x of [-.7,.7])for(const y of [-.7,.7]){
      box(m,x,y,0,.24,.24,.20,c.stone);box(m,x,y,.20,.15,.15,2.59,c.dark);
    }
    for(const y of [-.73,.73])for(const s of [-1,1])beamBetween(m,[s*.7,y,.54],[-s*.7,y,2.38],.071,c.wood);
    box(m,0,0,2.78,1.87,1.87,.16,c.wood);
    ring(m,0,0,2.94,.88,.88,1.33,c.board,12);
    for(const z of [3.06,3.49,4.12])ring(m,0,0,z,.913,.913,.065,c.iron,12);
    ring(m,0,0,4.27,.99,.13,.50,'#786859',12);
    ring(m,0,0,4.766,.24,.18,.112,'#61564c',8);
    timberLadder(m,-.43,.901,.16,4.15);
    for(const y of [-.54,.54])box(m,.88,y,2.94,.062,.062,.45,c.wood);
    box(m,.88,0,3.37,.072,1.12,.059,c.wood);
    beamBetween(m,[.75,0,3.15],[1.15,0,2.89],.16,c.iron);
    beamBetween(m,[1.15,0,2.89],[1.58,0,2.4],.12,c.iron);
  }else if(name==='Rail depot'){
    siding(4.68,2.41,1.97,'#b08055');
    pitched(5.04,2.73,1.97,.57,'#716457');
    porch(0,1.205,1.46,4.96,.94,'#797060');
    box(m,0,1.23,.19,1.13,.41,1.30,'#b28860');
    shopWindow(m,0,1.434,.84,.87,.53);
    leanRoof(m,0,1.467,1.47,1.32,.60,.14,'#766859');
    door(1.27,1.205,.57,1.05,'#6f503c');
    shopWindow(m,-1.23,1.205,.69,.77,.62);
    shopSign(m,1.235,1.70,1.86,'DEPOT');
    buildChimney(m,-1.57,-.59,2.19,.63);
    railFence(m,-1.52,2.13,.198,1.25,.47,'#c7a77b');
  }else if(name==='Livery stable'){
    siding(3.86,2.57,1.91,'#8e614a');
    pitched(4.12,2.85,1.91,.91,'#785444','y');
    panel(m,'y',1,1.309,0,.22,1.81,1.47,'#4f3a30');
    for(const x of [-.75,.75]){
      box(m,x,1.328,.219,.207,.086,1.47,'#a17b58');
      beamBetween(m,[x,1.38,.28],[x*.54,1.38,1.42],.07,'#c29870');
    }
    box(m,0,1.308,1.64,1.83,.12,.13,c.trim);
    shopSign(m,1.306,1.87,1.72,'LIVERY');
    for(const x of [-1.40,1.40])box(m,x,1.28,1.33,.38,.11,.30,'#6c4d3d');
    deck(0,1.61,.087,3.69,.62);
    railFence(m,-1.24,1.94,.202,1.12,.64,'#9d7756');
    box(m,1.42,1.65,.207,.66,.52,.30,'#c4a067');
    for(const x of [1.22,1.59])box(m,x,1.65,.509,.041,.48,.02,'#8e774f');
  }else if(name==='Freight shed'){
    siding(3.83,2.41,1.83,'#8b7764');
    leanRoof(m,0,-.08,1.83,4.08,2.54,.46,'#716a60');
    deck(0,1.66,.245,4.01,.91);
    for(const x of [-1.62,-.57,.57,1.62])box(m,x,1.98,.03,.16,.14,.215,c.dark);
    porch(0,1.205,1.55,3.96,.88,'#827465');
    panel(m,'y',1,1.241,.42,.359,1.45,1.12,'#554b40');
    box(m,-.21,1.28,.358,.24,.13,1.10,'#a18d72');
    box(m,.59,1.33,1.49,1.82,.063,.051,c.iron);
    for(const [x,z] of [[-1.42,.36],[-1.12,.36],[-1.39,.68]])box(m,x,1.78,z,.27,.37,.29,'#b6946a');
  }else{
    siding(3.02,2.42,1.74,'#aa865f');
    pitched(3.34,2.69,1.74,.87,'#896954');
    porch(.30,1.21,1.33,2.21,.66,'#a28462');
    door(.52,1.21,.50,.93);
    shopWindow(m,-.85,1.21,.65,.57,.60);
    for(const z of [.36,.59,.84,1.09,1.35,1.59]){
      panel(m,'y',-1,1.224,0,z,2.97,.032,'#886849');
      panel(m,'x',1,1.523,0,z,2.38,.032,'#886849');
    }
    buildChimney(m,-.91,-.59,1.97,.82,'#a38b75');
  }
  return m;
}
function desertProp(name){
  const m=[],c=westColour;
  if(name==='Saguaro'||name==='Young saguaro'){
    ring(m,0,0,0,.17,.14,name==='Saguaro'?2.7:1.68,['#63805a','#719468','#5b7754'],8);
    if(name==='Saguaro')for(const [x,z,h] of [[-.58,1.17,1.02],[.60,1.59,.72]]){
      beamBetween(m,[0,0,z],[x*.88,0,z+.12],.22,'#66865e');
      ring(m,x,0,z+.095,.129,.095,h,'#77996c',7);
    }
    ring(m,0,0,name==='Saguaro'?2.70:1.68,.14,.06,.19,'#80a376',8);
  }else if(name==='Prickly pear'){
    for(const [x,y,z,r,s] of [[0,.02,.32,.33,1],[-.32,.06,.48,.23,.82],[.30,0,.51,.23,.79],[.45,.04,.71,.17,.65],[.03,-.11,.69,.21,.85],[-.37,.10,.72,.18,.65]]){
      ring(m,x,y-.08,z,r,r,.16,['#7d9d70','#65865d','#769469'],8,'y',.76,s);
      if(z>.68)ring(m,x+.04,y,z+r*s,.05,.031,.07,'#bc7154',6);
    }
  }else if(name==='Desert scrub'){
    for(const [x,y,z,r] of [[0,0,.03,.37],[-.28,.08,.07,.27],[.27,-.07,.06,.29],[.02,.24,.037,.25]]){
      ring(m,x,y,z,r*.59,r,.15,'#8f9468',6);
      ring(m,x,y,z+.15,r,.04,.27,'#a09c6d',6);
    }
  }else if(name==='Sandstone outcrop'){
    for(const [x,y,r,h] of [[-.69,.12,.71,.96],[.24,.05,.85,1.32],[.96,.40,.47,.63],[.55,-.55,.51,.42]]){
      ring(m,x,y,0,r*.90,r,h*.44,['#aa7758','#bc8f68','#a37055'],6,'z',1,.84);
      ring(m,x,y,h*.44,r,r*.78,h*.12,'#c89b73',6,'z',1,.84);
      ring(m,x,y,h*.56,r*.78,r*.53,h*.44,'#af805f',6,'z',1,.84);
    }
  }else if(name==='Hitching rail'){
    for(const x of [-1.12,0,1.12])box(m,x,0,0,.14,.15,1.05,c.wood);
    box(m,0,0,.83,2.47,.13,.12,c.dark);
  }else if(name==='Water trough'){
    box(m,0,0,.025,1.55,.63,.13,c.wood);
    for(const x of [-.42,.42])box(m,x,0,0,.14,.82,.125,c.dark);
    for(const y of [-.29,.29])box(m,0,y,.14,1.57,.072,.32,c.board);
    for(const x of [-.75,.75])box(m,x,0,.14,.075,.52,.32,c.wood);
    box(m,0,0,.16,1.42,.51,.18,'#708e86');
  }else if(name==='Barrel cluster'){
    for(const [x,y,z] of [[-.34,.08,.0],[.28,-.12,0],[.24,.4,.0]]){
      ring(m,x,y,z,.24,.29,.23,c.wood,8);ring(m,x,y,z+.23,.29,.24,.29,c.board,8);
      for(const zz of [.083,.365])ring(m,x,y,z+zz,.286,.286,.038,c.iron,8);
      ring(m,x,y,z+.521,.197,.197,.022,'#786048',8);
    }
  }else if(name==='Boardwalk bench'){
    for(const x of [-.68,.68])box(m,x,0,0,.095,.49,.38,c.dark);
    box(m,0,0,.38,1.55,.51,.089,c.board);
    for(const x of [-.68,.68])box(m,x,-.19,.468,.087,.083,.42,c.wood);
    for(const z of [.62,.78])box(m,0,-.205,z,1.49,.08,.095,c.board);
  }
  return m;
}
function orePile(m,x,y,z,r,h,col){
  ring(m,x,y,z,r*.93,r,.13,col,7,'z',1,.72);
  ring(m,x+.07,y,z+.13,r,r*.43,h,col,7,'z',1,.72);
}
function workTrack(m,x,y,z,length,gauge){
  for(let d=-length/2+.12;d<length/2;d+=.23)box(m,x,y+d,z,gauge+.22,.075,.036,'#745d48');
  for(const dx of [-gauge/2,gauge/2])box(m,x+dx,y,z+.035,.033,length,.038,'#5c5750');
}
function mineCart(m,x,y,z,colour){
  for(const offset of [-.18,.18])ring(m,x-.235,y+offset,z+.083,.083,.083,.47,'#4e4a45',8,'x');
  const p=[[-.19,-.25],[.19,-.25],[.19,.25],[-.19,.25]];
  const p3=p.map(([u,v])=>[x+u,y+v,z+.135]).concat(p.map(([u,v])=>[x+u*1.25,y+v*1.12,z+.34]));
  solid(m,p3,[[0,1,2,3],[4,5,6,7],[0,1,5,4],[1,2,6,5],[2,3,7,6],[3,0,4,7]],'#7d6855');
  box(m,x,y,z+.342,.38,.44,.042,colour);
  for(const dx of [-.19,.19])box(m,x+dx,y,z+.338,.053,.57,.041,'#5d5348');
}
function hopper(m,x,y,z,l,w,height,colour){
  const p=[[-l/2,-w/2],[l/2,-w/2],[l/2,w/2],[-l/2,w/2]];
  const floor=p.map(([u,v])=>[x+u*.38,y+v*.39,z]);
  const top=p.map(([u,v])=>[x+u,y+v,z+height]);
  solid(m,floor.concat(top),[[0,1,2,3],[4,5,6,7],[0,1,5,4],[1,2,6,5],[2,3,7,6],[3,0,4,7]],colour);
  for(const side of [-1,1])box(m,x,y+side*w*.50,z+height-.025,l+.055,.052,.055,'#675a49');
}
function brickBatches(m,x,y,z,style){
  for(let layer=0;layer<3;layer++){
    for(const dy of [-.14,.14])for(const dx of [-.246,0,.246]){
      box(m,x+dx+layer*.039,y+dy,z+layer*.14,.228,.243,.125,style[(layer+Math.round(dx/.246)+1)%style.length]);
    }
  }
}
function industry(name){
  const m=[],c=westColour;
  const floor=(l,w,tone)=>box(m,0,0,0,l,w,.12,tone);
  const mill=(l,w,h,wall,roof)=>{
    box(m,0,0,0,l+.16,w+.16,.16,c.stone);box(m,0,0,.16,l,w,h-.16,wall);
    gable(m,0,0,h+.01,l+.26,w+.22,.61,roof);
    for(const x of [-l*.31,l*.31])shopWindow(m,x,w/2,h*.52,.48,.43,c.cream);
  };
  const stack=(x,y,z,w,h,col='#ad7358')=>{
    box(m,x,y,z,w,w,h,col);
    for(const dz of [h*.38,h*.72,h-.19])box(m,x,y,z+dz,w+.041,w+.041,.052,'#967463');
    box(m,x,y,z+h,w*1.20,w*1.20,.13,c.stone);
    box(m,x,y,z+h+.132,w*.63,w*.63,.044,'#423c33');
  };
  const ore=(x,y,r,h,col)=>orePile(m,x,y,.13,r,h,col);

  if(name==='Grain farm'){
    box(m,-1.58,0,.015,2.07,2.78,.096,'#a48a5d');
    for(const x of [-2.37,-2.00,-1.63,-1.26,-.89]){
      box(m,x,0,.112,.27,2.56,.059,'#bc985a');
      for(const y of [-1.07,-.73,-.38,.01,.39,.77,1.12]){
        ring(m,x,y,.172,.041,.025,.23,'#b6a15f',4);
        ring(m,x+.019,y,.382,.059,.026,.154,'#d8b96d',4);
      }
    }
    box(m,1.02,-.15,0,2.20,1.99,1.58,'#a47551');
    gable(m,1.02,-.15,1.581,2.42,2.23,.72,'#9b644e');
    frontDoor(m,1.04,.845,.13,1.13,1.10,'#674635');
    for(const s of [-1,1]){
      beamBetween(m,[1.04+s*.05,.91,.30],[1.04+s*.53,.91,1.17],.067,'#c59b70');
      box(m,1.04+s*.84,.90,.98,.28,.086,.29,'#7a6249');
    }
    box(m,1.02,.47,1.89,.26,.29,.15,'#cfab76');
    for(const [x,y,r] of [[.41,1.22,.25],[.89,1.25,.26],[.67,1.20,.22]]){
      const z=r===.22?.32:0;
      box(m,x,y,z,.42,.32,.27,'#c7aa67');
      box(m,x,y,z+.271,.053,.333,.03,'#a88b58');
    }
    ring(m,2.65,-.15,0,.44,.44,1.62,'#bba285',10);
    ring(m,2.65,-.15,1.62,.51,.056,.31,'#7b6d5c',10);
    for(const z of [.26,.83,1.44])ring(m,2.65,-.15,z,.455,.455,.044,'#807561',10);
    timberLadder(m,2.65,.34,.045,1.52);
    beamBetween(m,[2.40,-.15,1.43],[1.96,-.19,1.02],.14,'#74695c');
  }else if(name==='Stone quarry'||name==='Clay pit'){
    const clay=name==='Clay pit',cols=clay?['#ad7359','#c88a69','#dfa57e']:['#a49684','#b0a596','#cebfad'];
    floor(5.46,3.45,clay?'#94634f':'#938b7f');
    const tiers=[[-1.29,-.71,2.58,1.95,.12,.59],[-1.56,-.80,2.04,1.71,.71,.49],[-1.96,-.87,1.30,1.52,1.20,.42]];
    for(const [i,[x,y,l,w,z,h]] of tiers.entries()){
      box(m,x,y,z,l,w,h,cols[i]);
      for(const dx of [-.37,-.13,.15,.38])panel(m,'y',1,y+w/2+.012,x+dx*l,z+h*.16,.031,h*.72,clay?'#a46c52':'#968b7b');
      panel(m,'y',1,y+w/2+.014,x,z+h*.64,l*.955,.039,clay?'#b2785b':'#ded0b9');
    }
    for(const [x,y,r] of [[-.14,-.62,.35],[.53,-.84,.47],[1.17,-.78,.46],[2.01,-.82,.32]])ore(x,y,r,r*.49,cols[1]);
    if(clay){
      box(m,.36,.91,.121,2.72,.99,.039,'#ad795b');
      for(const y of [.45,1.38])box(m,.36,y,.158,2.73,.084,.18,'#997051');
      for(const x of [-.94,-.23,.45,1.12,1.71])box(m,x,.91,.167,.081,.98,.10,'#9d7253');
      for(const [x,y,r] of [[.0,1.02,.32],[.38,.81,.36],[.87,.88,.41]])orePile(m,x,y,.173,r,r*.27,'#bb8063');
      box(m,2.18,.98,.12,.77,.92,.71,'#976d51');
      leanRoof(m,2.18,.98,.831,.91,1.05,.19,'#805b48');
      panel(m,'y',1,1.446,2.16,.167,.44,.48,'#654a3b');
    }else{
      for(const [x,y,z,l,w] of [[-.04,.82,.126,.51,.53],[.51,1.11,.126,.69,.60],[.51,1.11,.46,.55,.51],[1.22,1.11,.127,.54,.49]]){
        box(m,x,y,z,l,w,.323,cols[2]);
        panel(m,'y',1,y+w/2+.013,x,z+.11,l*.90,.025,'#ad9d88');
      }
      for(const y of [.50,1.44])box(m,2.19,y,.123,.117,.121,1.33,'#8c745b');
      box(m,2.19,.97,1.455,.138,1.12,.164,'#a88a6c');
      beamBetween(m,[1.67,.97,1.47],[2.28,.97,1.72],.108,'#6b5c4c');
      box(m,1.67,.97,.46,.035,.035,1.01,'#5c5549');
    }
  }else if(name==='Brick maker'){
    mill(3.04,2.25,1.73,'#ae7156','#875e4b');
    stack(-1.08,-.65,1.78,.46,1.69,'#aa6e54');
    ring(m,1.98,.11,0,.67,.61,1.13,'#bb7c5c',12);
    ring(m,1.98,.11,1.13,.61,.23,.47,'#a36d54',12);
    for(const z of [.31,.74,1.071])ring(m,1.98,.11,z,.645,.645,.043,'#9e6750',12);
    ring(m,1.98,.11,1.60,.249,.202,.19,'#9b6750',9);
    panel(m,'y',1,.743,1.98,.055,.51,.54,'#533a30');
    ring(m,1.98,.713,.48,.265,.24,.038,'#714d3c',8,'y',1,.68);
    for(const [x,y] of [[-.72,1.66],[.31,1.67],[1.50,1.48]])brickBatches(m,x,y,.018,['#b77754','#cf8c65','#a96046']);
    for(const x of [-1.31,.83])box(m,x,1.76,.03,.074,.087,.99,'#a38465');
    leanRoof(m,-.25,1.76,1.02,2.30,.73,.14,'#8d7560');
  }else if(['Iron mine','Copper mine','Coal mine'].includes(name)){
    const coal=name==='Coal mine',copper=name==='Copper mine',col=coal?'#4f4c45':copper?'#ab7353':'#936452';
    floor(4.57,3.65,coal?'#9b8a77':'#ad947b');
    if(coal){
      ore(-.66,-.74,.98,.96,'#857263');
      box(m,0,-.42,.124,1.48,1.38,1.42,'#74614e');
      panel(m,'y',1,.286,0,.144,1.03,1.08,'#312e2a');
      for(const x of [-.63,.63]){
        box(m,x,.330,.148,.18,.228,1.32,c.wood);
        beamBetween(m,[x*1.31,.59,.142],[x,.38,.93],.094,'#7e6550');
      }
      box(m,0,.329,1.33,1.48,.244,.20,c.wood);
      workTrack(m,0,1.02,.124,1.49,.42);
      mineCart(m,0,1.13,.195,col);
      ore(1.39,.32,.54,.49,col);ore(1.56,1.13,.55,.29,'#5c584e');
      box(m,1.51,.61,.129,.754,.12,.489,'#8b7159');
    }else{
      const d=copper?.66:.84,top=copper?2.41:3.04;
      for(const x of [-d,d])for(const y of [-.57,.57])beamBetween(m,[x,y,.13],[x*.55,y*.80,top],copper?.146:.162,c.wood);
      for(const y of [-.56,.56])for(const s of [-1,1])beamBetween(m,[s*d*.93,y,.58],[-s*d*.61,y*.85,top-.44],.074,c.dark);
      box(m,0,0,top-.154,1.34,1.29,.16,'#66513e');
      ring(m,0,-.20,top+.22,.333,.333,.28,'#716759',10,'y');
      ring(m,0,.084,top+.22,.212,.212,.034,'#4d4a44',8,'y');
      box(m,0,0,top+.56,1.20,1.19,.139,copper?'#8b7963':'#8f654f');
      timberLadder(m,-d*.43,.627,.14,top-.15,'#a17e60');
      const x=copper?-1.43:1.46;
      box(m,x,-.69,.12,1.07,1.40,1.14,copper?'#a28163':'#8f6c53');
      leanRoof(m,x,-.69,1.26,1.25,1.58,.18,'#7f6c5a');
      panel(m,'y',1,.032,x,.23,.49,.78,'#5c493a');
      if(copper){
        for(const y of [.25,.72])beamBetween(m,[.24,y,1.83],[1.86,y,.68],.092,'#7b6952');
        beamBetween(m,[.25,.48,1.82],[1.89,.48,.681],.33,'#aa8966');
        hopper(m,1.66,.52,.205,.83,.79,.48,'#8e745b');
        ore(1.13,1.17,.43,.32,col);ore(-1.37,1.17,.49,.32,'#8b8465');
        for(const [x,y] of [[-.99,1.06],[-1.39,1.25],[1.02,1.13],[1.24,1.31]])orePile(m,x,y,.38,.15,.07,'#769186');
      }else{
        hopper(m,1.36,.68,.19,.87,.76,.59,'#a08060');
        for(const x of [.99,1.72])box(m,x,.72,.13,.081,.084,.70,'#80674f');
        ore(-1.52,.74,.55,.34,col);ore(1.52,1.34,.46,.30,'#ab7d63');
      }
      workTrack(m,-.25,.918,.13,1.67,.38);
      mineCart(m,-.25,1.35,.198,col);
    }
  }else if(name==='Smelter'){
    mill(3.67,2.40,2.12,'#8e7161','#6a5a50');
    stack(-1.03,-.55,2.12,.50,2.40,'#9b6753');stack(.24,-.64,2.13,.385,2.07,'#ad7259');
    box(m,-.82,1.20,.018,1.44,.214,1.17,'#705746');
    panel(m,'y',1,1.322,-.82,.27,.90,.52,'#493c34');
    for(const x of [-1.04,-.77,-.50])panel(m,'y',1,1.342,x,.290,.16,.34,'#c48558');
    ring(m,2.19,-.25,0,.681,.56,1.61,'#73695e',10);
    ring(m,2.19,-.25,1.61,.56,.30,.45,'#87745a',10);
    for(const z of [.32,.89,1.46])ring(m,2.19,-.25,z,.66,.66,.048,'#584f45',10);
    beamBetween(m,[1.31,-.24,1.42],[2.18,-.24,1.72],.29,c.iron);
    beamBetween(m,[2.55,.084,1.54],[2.55,.92,.77],.16,'#81674f');
    hopper(m,2.44,.98,.112,.87,.72,.53,'#8e7460');
    box(m,-.68,1.73,.02,1.29,.47,.132,'#8b8170');
    for(const x of [-1.03,-.68,-.33])box(m,x,1.73,.153,.28,.34,.16,'#b9a690');
    ore(1.31,1.63,.52,.26,'#645a50');
  }else if(name==='Woodworking shop'){
    mill(3.47,2.27,1.84,'#a58160','#815f4d');
    panel(m,'y',1,1.165,.49,.18,1.11,1.18,c.dark);
    for(const x of [-.34,1.31])box(m,x,1.83,0,.105,.10,1.42,c.wood);
    leanRoof(m,.49,1.53,1.43,1.98,.91,.18,'#98765a');
    box(m,.21,1.81,.029,.055,.29,.48,c.dark);box(m,.91,1.81,.029,.055,.29,.48,c.dark);
    box(m,.56,1.82,.505,.91,.38,.09,'#9c8062');
    ring(m,.64,1.82,.601,.161,.161,.029,'#776d5c',9,'y');
    for(const x of [-.95,-1.61])box(m,x,1.88,0,.110,.59,.22,'#785f4c');
    for(const y of [1.66,1.83,2.0,2.17])box(m,-1.32,y,.23,1.22,.132,.105,'#c3a479');
    mergeModel(m,cargo('Sawn timber'),-1.34,-1.57,0,0,.56);
    orePile(m,1.27,1.92,.017,.29,.15,'#bb9c70');
  }else if(name==='Flour mill'){
    mill(3.25,2.39,2.63,'#c4a87d','#806a57');
    box(m,0,1.252,.029,1.04,.159,1.27,c.dark);
    for(const x of [-.84,.84])shopWindow(m,x,1.197,1.94,.47,.43,c.cream);
    gable(m,0,.91,2.78,1.31,1.03,.32,'#8b7159');
    box(m,0,.88,2.31,1.10,.74,.48,'#c4a078');
    panel(m,'y',1,1.266,0,2.36,.39,.32,'#645044');
    beamBetween(m,[.02,1.24,2.53],[.02,1.66,2.53],.071,'#78664f');
    box(m,.02,1.64,1.62,.026,.026,.91,'#685345');
    box(m,.03,1.55,.134,1.48,.71,.096,'#a98b68');
    for(const [x,y] of [[2.01,-.27],[2.72,-.38]]){
      ring(m,x,y,0,.34,.34,2.42,'#ac9c84',9);
      ring(m,x,y,2.42,.376,.035,.36,'#7c6d5b',9);
      for(const z of [.38,1.35,2.03])ring(m,x,y,z,.36,.36,.061,'#84786a',9);
    }
    beamBetween(m,[1.17,-.54,2.79],[2.20,-.26,2.29],.17,'#897969');
    beamBetween(m,[2.11,-.31,2.24],[2.64,-.37,2.19],.135,'#8f7a62');
    mergeModel(m,cargo('Pallet sacks'),-1.03,1.67,0,0,.66);
  }
  return m;
}
const marsh={wood:'#7d6c54',dark:'#49463c',plank:'#8b826b',trim:'#a2977d',iron:'#535d57',reed:'#839262',water:'#456b64'};
const roofing={
  tin:['#74786b','#797a69','#805f4d','#737a71','#8a6952','#6e746b','#7c7769','#6b776e'],
  rust:['#80604d','#6e5344','#8e6a55','#777364','#6b6558','#865a46','#595d55','#826a55'],
  slate:['#5b6c68','#72807a','#637777','#745e52','#6a7972','#596c69','#6e776e','#6b746b']
};
const deckBoards=['#8b8068','#9b8a70','#82775f','#8a836d','#776e59','#958367','#a4977d','#887860'];
function agedTimber(hex,value){
  const c=parseInt(hex.slice(1),16);
  return '#'+[c>>16,(c>>8)&255,c&255].map(n=>clamp(Math.round(n*value),0,255).toString(16).padStart(2,'0')).join('');
}
function patchedWalls(m,x,y,z,l,w,h,paint){
  box(m,x,y,z,l,w,h,paint);
  for(const [axis,offset,span,anchor] of [['y',y,w,l],['x',x,l,w]]){
    for(const side of [-1,1]){
      const plane=offset*side+span/2+.011, centre=axis==='y'?x:y;
      const courses=Math.ceil(h/.182),rise=h/courses;
      for(let i=0;i<courses;i++){
        const colour=agedTimber(paint,[.72,.81,.89,.97,.92,.84,1.05,.95][(i+(side<0?1:0))%8]);
        panel(m,axis,side,plane,centre,z+i*rise+.014,anchor-.033,rise-.023,colour);
      }
      for(const [f,r,width,colour] of [[.28,.20,.26,'#77705d'],[.72,.37,.18,'#8d7a60'],[.48,.08,.32,'#686653']]){
        panel(m,axis,side,plane+.009,centre+(f-.5)*anchor,z+r*h,width*anchor,h*.10,colour);
      }
    }
  }
}
function sheetMetal(m,x,y,z,l,w,rise,finish,lean=false){
  const tones=roofing[finish],count=Math.ceil(l/.33),step=l/count;
  const apex=x+l*.035;
  const top=(u,v)=>{
    const sag=.073*Math.sin((u-x+l/2)/l*Math.PI);
    const pitch=lean?(y+w/2-v)/w:1-Math.abs(v-y)/(.5*w);
    return z+pitch*rise-sag*(.48+pitch*.52)+.019*(u-apex)/l;
  };
  const sheet=(a,b,f,g,col,offset,thickness)=>{
    const p=[[a,f],[b,f],[b,g],[a,g]].map(([u,v])=>[u,v,top(u,v)+offset]);
    solid(m,p.concat(p.map(([u,v,h])=>[u,v,h-thickness])),
      [[0,1,2],[0,2,3],[4,6,5],[4,7,6],[0,4,5,1],[1,5,6,2],[2,6,7,3],[3,7,4,0]],col);
  };
  for(let i=0;i<count;i++){
    const a=x-l/2+i*step,b=a+step-.009;
    const fr=y-w/2+[0,.042,-.05,.025,.068,-.021,-.039][i%7];
    const to=y+w/2+[.032,-.06,.065,-.026,.016,.083,-.018][(i+2)%7];
    const patch=(i*5+Math.floor(i/3)+count)%tones.length;
    if(lean)sheet(a,b,fr,to,tones[patch],0,.068);
    else{
      sheet(a,b,fr,y,tones[(patch+2)%tones.length],0,.072);
      sheet(a,b,y,to,tones[patch],0,.072);
    }
    if(i%4===1){
      const from=y+w*(.10+(i%3)*.07);
      sheet(a+.043,b-.027,from,from+w*.21,'#786052',.023,.027);
    }
  }
  if(!lean){
    for(let i=0;i<count;i++){
      const a=x-l/2+i*step-.01,b=a+step+.001;
      sheet(a,b,y-.077,y,'#5d564b',.035,.045);
      sheet(a,b,y,y+.082,'#6c6051',.035,.045);
    }
  }
}
function pileFrame(m,l,w,deck,colour=marsh.plank){
  const x=l*.41,y=w*.39;
  for(const side of [-1,1])for(const end of [-1,1]){
    const offset=side*.088+end*.059;
    beamBetween(m,[end*x+offset,side*y+end*.080,-.29],[end*x,side*y,deck+.025],.143,'#635947');
    box(m,end*x+offset*.51,side*y+end*.048,.113,.154,.151,.132,'#585a48');
  }
  beamBetween(m,[-x,-y,.12],[x,-y,deck-.045],.077,'#76644c');
  beamBetween(m,[x,y,.049],[-x,y,deck-.048],.093,'#796a50');
  beamBetween(m,[-x,-y,.12],[-x,y,deck-.045],.067,'#685b46');
  for(const side of [-1,1])box(m,0,side*w*.35,deck-.095,l-.085,.118,.118,'#665642');
  box(m,0,0,deck,l,w,.098,colour);
  const planks=Math.ceil(l/.24),dx=l/planks;
  for(let i=0;i<planks;i++){
    const trim=[-.026,.041,-.054,.017,.044,-.035][i%6];
    box(m,-l/2+(i+.5)*dx,trim*.48,deck+.099,dx-.016,w+trim,.023,deckBoards[i%deckBoards.length]);
  }
}
function marshStairs(m,x,y,z,h,w){
  for(let i=0;i<4;i++){
    box(m,x+[0,.022,-.044,.031][i],y+i*.18,z-i*h/4,w-.012*i,.197,.070,deckBoards[i+2]);
  }
  for(const side of [-1,1])beamBetween(m,[x+side*w*.45,y-.05,z-.043],[x+side*w*.45,y+.66,z-h],.055,marsh.wood);
}
function brokenRail(m,x,y,z,length,side=1){
  for(const [u,lean,h] of [[-.51,-.04,.43],[-.22,.03,.41],[.14,-.065,.28],[.49,.07,.41]]){
    beamBetween(m,[x+u*length,y,z],[x+u*length+lean,y+side*lean*.68,z+h],.063,'#79694f');
  }
  beamBetween(m,[x-length*.54,y-.03,z+.38],[x-length*.11,y+.013,z+.355],.064,'#87775d');
  beamBetween(m,[x+length*.15,y+.02,z+.212],[x+length*.52,y+.045,z+.385],.058,'#75664f');
}
function marshPanel(m,x,y,z,w,h,col,boarded=false){
  panel(m,'y',1,y+.026,x,z,w,h,marsh.trim);
  panel(m,'y',1,y+.044,x,z+.057,w-.103,h-.110,'#435b55');
  panel(m,'y',1,y+.057,x,z+.061,.041,h-.114,col);
  if(boarded)for(const [h0,h1] of [[.12,.28],[.43,.45]]){
    beamBetween(m,[x-w*.5,y+.082,z+h*h0],[x+w*.53,y+.088,z+h*h1],.084,'#776855');
  }
}
function salvageDrum(m,x,y,z,colour='#6c6b56'){
  ring(m,x,y,z,.142,.134,.412,colour,8);
  for(const u of [.045,.23,.373])ring(m,x,y,z+u,.151,.151,.037,'#74614c',8);
  ring(m,x,y,z+.412,.119,.119,.015,'#53554b',8);
}
function swampBuilding(name){
  const m=[],c=marsh;
  if(name==='Boardwalk module'||name==='Marsh landing'){
    const landing=name==='Marsh landing',l=landing?3.78:3.0,w=landing?2.01:1.13;
    pileFrame(m,l,w,.56);
    if(landing)for(const x of [-1.64,1.64]){
      beamBetween(m,[x,w*.43,.67],[x+.062,w*.43-.049,1.40],.137,c.wood);
      ring(m,x+.028,w*.43-.023,1.02,.104,.104,.088,'#aaa085',8);
    }
    if(landing){
      mergeModel(m,cargo('Crated goods'), .62,-.39,.69,.1,.47);
      salvageDrum(m,1.40,-.64,.68,'#74634e');
    }else{
      brokenRail(m,0,-w*.44,.68,l-.16,-1);
    }
    return m;
  }
  if(name==='Fire lookout'){
    pileFrame(m,2.22,2.30,1.88,'#8e8069');
    patchedWalls(m,0,-.16,2.01,1.61,1.51,1.19,'#989a81');
    gable(m,0,-.16,3.19,1.69,1.55,.33,'#6a6b59');
    sheetMetal(m,0,-.16,3.205,1.99,1.87,.45,'slate');
    marshPanel(m,.10,.600,2.67,.89,.43,'#808a7f',true);
    brokenRail(m,0,.96,2.00,1.73);
    timberLadder(m,-.89,1.21,.035,2.17);
    beamBetween(m,[.50,-.61,3.22],[.42,-.57,3.83],.082,'#68665a');
    return m;
  }
  const mode={
    'Stilt cottage':{l:3.02,w:2.68,d: .68,h:1.57,wall:'#9a9b7b',roof:'tin'},
    'Boathouse':{l:3.67,w:2.74,d:.25,h:1.83,wall:'#858876',roof:'slate'},
    'Marsh trading post':{l:3.85,w:2.72,d:.67,h:2.04,wall:'#a18a69',roof:'rust'},
    'Wetland station':{l:4.78,w:2.76,d:.58,h:1.94,wall:'#809785',roof:'slate'}
  }[name];
  const {l,w,d,h,wall,roof}=mode,boat=name==='Boathouse',station=name==='Wetland station',trade=name==='Marsh trading post';
  pileFrame(m,l,w,d);
  const z=d+.12,y=w/2-.512;
  if(boat){
    for(const x of [-1.44,1.44]){
      patchedWalls(m,x,-.16,z,.30,2.55,h,wall);
      box(m,x,.59,z+.22,.108,.105,h-.23,c.wood);
    }
    patchedWalls(m,0,-1.18,z,2.63,.16,h,wall);
    box(m,0,.89,z+h-.35,2.67,.131,.35,c.wood);
    const cap=[];
    gable(cap,0,0,z+h-.04,2.54,l-.27,.51,'#626858');
    sheetMetal(cap,0,0,z+h,2.94,l+.24,.65,roof);
    mergeModel(m,cap,0,-.18,0,Math.PI/2);
    for(const x of [-1.31,1.35])beamBetween(m,[x,.93,z+.04],[x*.94,.95,z+1.42],.102,'#6b5e4a');
    for(const x of [-.98,1.05])beamBetween(m,[x,.932,z+h-.32],[x+.052,.952,z+1.11],.033,'#65594a');
    for(const x of [-.91,.91])box(m,x,.34,z-.009,.18,1.53,.04,c.plank);
    mergeModel(m,cargo('Crated goods'),1.16,-.82,z,0,.42);
    salvageDrum(m,-1.17,.63,z,'#8d725b');
  }else{
    patchedWalls(m,0,-.28,z,l-.24,w-1.00,h,wall);
    gable(m,0,-.28,z+h-.048,l-.28,w-1.05,trade?.34:.49,'#685f4e');
    sheetMetal(m,0,-.28,z+h,l+.15,w-.61,trade?.46:.63,roof);
    box(m,0,y+.28,z,.91*l,.54,.075,c.plank);
    const porchCount=Math.ceil(l/.242),dx=.91*l/porchCount;
    for(let i=0;i<porchCount;i++){
      box(m,-.455*l+(i+.5)*dx,y+.276,z+.076,dx-.012,.556+((i%5)-2)*.019,.019,deckBoards[(i+3)%deckBoards.length]);
    }
    for(const x of [-l*.425,l*.425])beamBetween(m,[x,y+.50,z+.093],[x+(x>0?-.099:.035),y+.45,z+1.21],.094,'#81745b');
    sheetMetal(m,0,y+.27,z+1.209,l+.032,.83,.133,trade?'tin':roof,true);
    frontDoor(m,.12,y,z+.057,trade?.74:.54,1.02,c.dark,c.trim);
    for(const x of [-l*.30,l*.30])marshPanel(m,x,y,z+.54,trade?.74:.57,.58,wall,x>0&&!station);
    if(station){
      box(m,-1.49,y+.309,z+.112,.61,.47,.82,'#6b8376');
      marshPanel(m,-1.49,y+.56,z+.59,.49,.37,'#9baf9f');
      brokenRail(m,1.28,y+.571,z+.095,1.39);
      shopSign(m,y+.038,z+1.488,1.94,'DEPOT');
    }else if(trade){
      shopSign(m,y+.039,z+1.497,2.2,'TRADE');
      mergeModel(m,cargo('Crated goods'),-1.34,y+.48,z+.099,.09,.41);
      salvageDrum(m,1.15,y+.364,z+.12,'#6f6251');
    }else{
      buildChimney(m,-.86,-.76,z+h+.14,.68,'#877b70');
      brokenRail(m,-1.04,y+.59,z+.096,.86);
      beamBetween(m,[.48,y+.049,z+.12],[1.37,y+.074,z+.79],.085,'#766955');
      salvageDrum(m,1.09,y+.39,z+.102);
    }
    marshStairs(m,.19,w/2+.095,z+.031,z-.20,.74);
  }
  return m;
}
function swampProp(name){
  const m=[],c=marsh;
  if(name==='Bald cypress'){
    ring(m,0,0,-.19,.46,.19,1.30,'#766955',8);
    ring(m,0,0,1.11,.188,.092,2.02,'#83735a',8);
    for(const [x,y,z,r] of [[-.96,.13,2.31,.75],[.62,.36,2.64,.79],[.64,-.60,2.34,.69],[.01,-.02,3.01,.96],[-.31,.56,2.77,.73]]){
      beamBetween(m,[0,0,1.57],[x,y,z+.09],.12,'#726557');
      ring(m,x,y,z,.31,r,.37,['#4f6d54','#58755b','#607c5d'],7,'z',1,.82);
      ring(m,x,y,z+.37,r,.11,.55,['#688263','#68805b','#718965'],7,'z',1,.82);
      if(x!==.01)for(const off of [-.19,.19]){
        beamBetween(m,[x+off,y+.18,z+.12],[x+off+.094,y+.22,z-.43],.083,'#90a184');
      }
    }
    for(const [x,y,s] of [[-.52,.18,.28],[.42,.41,.22],[.35,-.59,.30],[-.51,-.34,.3]])ring(m,x,y,-.13,.132,.042,s+.13,'#796c56',6);
  }else if(name==='Cattails'){
    for(const [x,y,h] of [[-.34,.08,.83],[-.07,-.13,1.07],[.18,.14,.94],[.38,-.09,.65],[.07,.35,.63]]){
      ring(m,x,y,-.15,.032,.024,h+.15,'#7d9060',5);
      ring(m,x,y,h-.17,.054,.052,.17,'#765943',6);
      beamBetween(m,[x,y,-.03],[x+.13,y+.14,h*.65],.035,'#8c9b69');
    }
  }else if(name==='Lily patch'){
    for(const [x,y,r] of [[-.39,.04,.22],[.27,-.14,.25],[.14,.33,.18],[-.24,-.31,.155],[.52,.25,.15]]){
      ring(m,x,y,0,r,r,.020,['#6e935f','#7d9e66','#83a36b'],7,'z',1,.81);
    }
    for(const [x,y] of [[.27,-.14],[-.39,.04]]){
      ring(m,x,y,.025,.073,.09,.042,'#e2c1ba',7);
      ring(m,x,y,.067,.061,.026,.056,'#d5a3a2',6);
    }
  }else if(name==='Cypress knees'){
    for(const [x,y,h] of [[-.43,.12,.51],[-.13,-.15,.37],[.23,.16,.64],[.53,-.08,.32],[-.06,.39,.24]]){
      ring(m,x,y,-.16,.132,.092,h*.74+.16,'#766955',6);
      ring(m,x,y,h*.74,.092,.027,h*.26,'#948366',6);
    }
  }else if(name==='Driftwood'){
    beamBetween(m,[-.72,-.14,-.075],[.68,.16,.22],.207,'#9c8c71');
    for(const [x,y,z] of [[-.37,-.067,.16],[.27,.083,.24]]){
      beamBetween(m,[x,y,z],[x+.29,y-.38,z+.28],.105,'#aa9982');
    }
    ring(m,-.73,-.141,.01,.117,.116,.032,'#baaa8b',7,'x');
  }else if(name==='Heron'){
    ring(m,-.21,0,.40,.124,.11,.38,'#919c97',7,'x',.82,1.18);
    for(const y of [-.061,.061]){
      beamBetween(m,[-.08,y,0],[-.02,y,.366],.024,'#857962');
      beamBetween(m,[-.067,y,.011],[.07,y,.012],.021,'#82735d');
    }
    beamBetween(m,[.11,0,.45],[.004,0,.62],.088,'#aab4ac');
    beamBetween(m,[.004,0,.62],[.16,0,.89],.072,'#b3bdb0');
    ring(m,.136,0,.868,.057,.043,.11,'#acb3a8',7,'x');
    ring(m,.244,0,.869,.020,0,.123,'#a88d5d',6,'x');
  }
  return m;
}
function swampIndustry(name){
  const m=[],c=marsh;
  const shop=(wall,roof)=>{
    pileFrame(m,4.82,3.46,.58);
    patchedWalls(m,-.25,-.53,.70,3.36,1.95,1.48,wall);
    gable(m,-.25,-.53,2.131,3.34,1.96,.49,'#696252');
    sheetMetal(m,-.25,-.53,2.178,3.70,2.29,.61,roof);
    frontDoor(m,-.06,.445,.761,.58,.93,c.dark,c.trim);
    marshPanel(m,-1.13,.446,1.23,.57,.53,c.wood,true);
    salvageDrum(m,1.17,.737,.70,'#7c6e58');
  };
  if(name==='Stilt fishery'){
    shop('#8c9584','slate');
    brokenRail(m,-1.49,1.59,.70,1.27);
    for(const x of [1.31,2.15])box(m,x,1.30,.70,.084,.097,1.10,c.wood);
    box(m,1.74,1.27,1.72,1.06,.122,.077,c.wood);
    for(const x of [1.48,1.74,1.99])ring(m,x,1.26,1.00,.082,.083,.625,'#9d916d',5);
    mergeModel(m,cargo('Crated goods'),-1.17,1.00,.705,0,.47);
    for(const x of [.48,.87])box(m,x,1.26,.703,.30,.47,.25,'#929783');
    sheetMetal(m,1.52,.64,1.67,1.62,1.48,.23,'tin',true);
  }else if(name==='Reed harvest depot'){
    shop('#a59476','tin');
    for(const x of [-1.70,-.90,.85,1.68]){
      const z=.73+(x>.9?.12:0);
      for(const y of [.86,1.27]){
        ring(m,x,y-.12,z+.145,.152,.148,.66,'#b19c68',7,'y',1,.74);
        for(const d of [.11,.43])ring(m,x,y-.12+d,z+.145,.155,.155,.042,'#7c7253',7,'y',1,.74);
      }
    }
    for(const x of [-1.88,1.79])box(m,x,1.68,.70,.09,.10,1.17,c.wood);
    sheetMetal(m,0,1.17,1.84,3.99,1.24,.22,'tin',true);
  }else if(name==='Peat cutting yard'){
    box(m,0,0,-.20,5.02,3.25,.54,'#786b54');
    for(const x of [-1.77,-1.25,-.73,-.21]){
      box(m,x,-.37,.339,.28,2.27,.095,'#514b40');
      box(m,x+.22,-.34,.34,.080,2.18,.058,'#968568');
    }
    patchedWalls(m,1.15,-.51,.341,1.76,1.60,1.19,'#96866d');
    sheetMetal(m,1.15,-.50,1.532,1.99,1.87,.29,'rust',true);
    panel(m,'y',1,.329,1.15,.40,.55,.89,'#5a4d40');
    salvageDrum(m,1.94,.485,.346,'#75735b');
    brickBatches(m,1.35,1.0,.345,['#5c5143','#6b5949','#756352']);
    workTrack(m,-.24,.97,.349,1.10,.36);
    mineCart(m,-.24,.97,.41,'#625743');
  }else if(name==='Floodgate pump house'){
    for(const x of [-1.84,1.84]){
      box(m,x,0,-.16,1.18,3.51,1.03,'#8a9181');
      for(const [dy,col,h] of [[-.42,'#636c57',.19],[.09,'#767c63',.14],[.43,'#69745b',.09]]){
        panel(m,'y',1,1.767,x+dy,.24,.23,h,col);
        panel(m,'x',Math.sign(x),2.443,dy*2.25,.22,.40,h,col);
      }
    }
    box(m,0,.39,.89,3.92,.75,.15,'#a5ab96');
    brokenRail(m,0,.763,1.029,3.58);
    for(const x of [-.76,.76])box(m,x,-.08,.57,.125,.19,1.55,c.iron);
    box(m,0,-.09,2.12,1.63,.26,.16,c.iron);
    box(m,0,-.085,.38,1.34,.178,.67,'#71877d');
    for(const x of [-.44,.44])box(m,x,.021,.41,.056,.064,.55,'#60786f');
    patchedWalls(m,-1.87,-.71,.88,1.38,1.52,1.45,'#9b9f85');
    gable(m,-1.87,-.71,2.31,1.39,1.48,.32,'#636a5a');
    sheetMetal(m,-1.87,-.71,2.337,1.68,1.82,.44,'rust');
    beamBetween(m,[-1.78,.170,1.61],[-1.08,.170,1.61],.176,c.iron);
    beamBetween(m,[-1.08,.170,1.61],[-1.08,.17,.32],.176,c.iron);
    ring(m,.02,-.08,2.23,.21,.21,.073,'#777667',10);
  }else if(name==='Marsh sawmill'){
    shop('#92856e','rust');
    for(const x of [-1.55,1.37])box(m,x,1.33,.70,.102,.113,1.12,c.wood);
    sheetMetal(m,-.1,.95,1.81,3.37,1.09,.25,'tin',true);
    mergeModel(m,cargo('Sawn timber'),1.08,.99,.70,0,.61);
    mergeModel(m,cargo('Log stack'),-1.28,.98,.70,.06,.56);
    for(const x of [-1.70,1.76])box(m,x,1.60,-.06,.15,.15,1.08,c.dark);
    for(const y of [1.83,2.13,2.43])ring(m,-1.26,y,.198,.144,.147,2.35,'#816b53',8,'x');
    box(m,-.02,1.20,.70,.058,.78,.50,c.iron);
    ring(m,-.016,1.20,1.18,.188,.188,.038,'#a0a695',9,'y');
  }
  return m;
}
const makers={westernBuilding,desertProp,industry,swampBuilding,swampProp,swampIndustry,cargo};
const cache=new Map();
window.contourBiomeModel=function(group,name){
  const key=group+'/'+name;
  if(cache.has(key))return cache.get(key);
  const raw=makers[group](name);
  if(!raw.length)throw new Error('Missing biome model '+key);
  const bounds=[[Infinity,-Infinity],[Infinity,-Infinity],[Infinity,-Infinity]];
  const mesh=raw.map(({p,c})=>{
    for(const point of p)for(let i=0;i<3;i++){
      bounds[i][0]=Math.min(bounds[i][0],point[i]);
      bounds[i][1]=Math.max(bounds[i][1],point[i]);
    }
    return {points:p,color:c};
  });
  const [width,depth,height]=bounds.map(([a,b])=>b-a);
  const model={mesh,width,depth,height};
  cache.set(key,model);
  return model;
};
})();
