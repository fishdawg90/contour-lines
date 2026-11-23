// Models adapted from Contour Lines Asset Lab for the live valley renderer.
(()=>{
'use strict';
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
function panel(m,axis,side,plane,centre,z,width,height,c){
  const point=(u,v)=>axis==='y'?[u,side*plane,v]:[side*plane,u,v];
  const a=centre-width/2,b=centre+width/2;
  const p=[point(a,z),point(b,z),point(b,z+height),point(a,z+height)];
  if((axis==='y'? -1:1)!==side)p.reverse();
  m.push({p,n:axis==='y'?[0,side,0]:[side,0,0],c});
}
function house(kind,wall,roof){
  const m=[],terrace=kind==='Terrace';
  const l=terrace?5.15:3.1,w=terrace?2.35:2.6,h=kind==='Cottage'?1.65:2.35;
  const units=terrace?3:1;
  const trim=terrace?'#d3b795':'#e1ceb0';
  box(m,0,0,0,l+.16,w+.17,.20,palette.stone);
  box(m,0,0,.20,l,w,h-.20,wall);
  gable(m,0,0,h,l,w,.76,wall);
  gable(m,0,0,h+.018,l+.34,w+.30,.87,roof);
  for(const side of [-1,1])box(m,0,side*(w/2+.125),h-.04,l+.27,.086,.091,trim);
  ring(m,-l/2-.13,0,h+.862,.065,.065,l+.26,roof,6,'x');
  function window(axis,side,plane,x,z,width,height,sash=true){
    panel(m,axis,side,plane+.025,x,z,width,height,trim);
    panel(m,axis,side,plane+.042,x,z+.055,width-.108,height-.11,palette.darkGlass);
    panel(m,axis,side,plane+.058,x,z+.055,.032,height-.11,palette.cream);
    if(sash)panel(m,axis,side,plane+.065,x,z+height*.50,width-.108,.028,palette.cream);
    if(axis==='y'){
      box(m,x,side*(plane+.036),z-.036,width+.12,.144,.055,trim);
      panel(m,axis,side,plane+.030,x,z+height+.017,width+.1,.055,trim);
    }
  }
  for(let i=0;i<units;i++){
    const x=l*((i+.5)/units-.5), door=x+.29,doorWidth=.42;
    panel(m,'y',1,w/2+.027,door,.21,doorWidth+.14,.92,trim);
    panel(m,'y',1,w/2+.049,door,.235,doorWidth,.81,terrace?'#466559':'#67574c');
    panel(m,'y',1,w/2+.071,door-.12,.649,.041,.039,'#c7aa74');
    box(m,door,w/2+.095,.042,doorWidth+.225,.35,.118,'#9c9782');
    box(m,door,w/2+.054,.156,doorWidth+.128,.236,.07,trim);
    window('y',1,w/2,x-.42,.62,terrace?.49:.64,.57);
    window('y',-1,w/2,x+.12,.62,.62,.55);
    if(h>2){
      for(const dx of [-.43,.33])window('y',1,w/2,x+dx,1.56,.50,.55);
      window('y',-1,w/2,x-.24,1.55,.51,.52,false);
    }
    const chimney=x+l/units*.29;
    box(m,chimney,-.36,h+.36,.32,.33,.66,terrace?'#946047':'#a28b73');
    box(m,chimney,-.36,h+1.02,.405,.41,.10,'#5f5951');
    ring(m,chimney,-.36,h+1.12,.091,.078,.13,'#8d6551',6);
  }
  window('x',1,l/2,0,h*.51,.55,.53);
  return m;
}
function tree(kind){
  const m=[];
  if(kind==='Pine'||kind==='Fir'){
    const pine=kind==='Pine';
    ring(m,0,0,0,.2,.12,2.1,'#725a3f',6);
    for(let i=0;i<3;i++)ring(m,0,0,.56+i*.85,(pine?1.14:1.31)-i*.24,.015,pine?2.33:1.82,
      (pine?['#456346','#557b52','#6f8a54']:['#496153','#60795d','#758b67'])[i],7);
  }else{
    const birch=kind==='Birch';
    ring(m,0,0,0,birch?.135:.24,.105,3.1,birch?'#d6cdb1':'#756146',6);
    if(birch)for(let i=0;i<5;i++)box(m,.101,0,.31+i*.35,.045,.16,.065,'#6a6757');
    for(const [x,y,z,r,c] of [[-.58,.08,1.66,1.03,'#739458'],[.54,-.22,1.9,1.04,'#83a058'],[.07,.55,2.0,1.05,'#668a50'],[.03,0,2.64,1.13,'#91a962']]){
      const radius=r*(birch?.72:1);
      ring(m,x*(birch?.62:1),y,z,.23,radius,.5,birch?'#8b9c63':c,7);
      ring(m,x*(birch?.62:1),y,z+.5,radius,.14,birch?1.17:.89,birch?'#a4b276':c,7);
    }
  }
  return m;
}
const wheelMesh=[];
ring(wheelMesh,0,-.36,0,1,1,.72,palette.tyre,12,'y');
ring(wheelMesh,0,-.42,0,.61,.61,.84,'#7b7c72',10,'y');
ring(wheelMesh,0,-.45,0,.26,.26,.90,'#c4bfa8',8,'y');
for(const y of [-.433,.433])for(let i=0;i<3;i++){
  const angle=i*tau/3;
  box(wheelMesh,.438*Math.cos(angle),y,.438*Math.sin(angle)-.075,.15,.026,.15,'#d2ccac');
}
function vehicle(kind,colour){
  const m=[],bus=kind==='Single-decker';
  const length=bus?5.4:5.1, width=bus?1.54:1.46, radius=.28;
  const cap=length/2,sideFace=width/2;
  const axes=bus?[-cap+.58,cap-.59]:[-cap+.59,-cap+1.26,cap-.67];
  const wheels=axes.flatMap((x,i)=>[-1,1].map(side=>({x,y:side*(sideFace+.045),z:radius,radius,front:i===axes.length-1,side,axle:i+1})));
  box(m,0,0,.25,length-.12,width-.18,.19,'#454748');
  if(bus){
    const top=1.48;
    box(m,0,0,.38,length,width,.52,colour);
    {
      const z=.90;
      box(m,0,0,z,length,width,.48,palette.cream);
      box(m,0,0,z+.48,length,width,.10,colour);
      for(const side of [-1,1]){
        for(let i=0;i<7;i++)panel(m,'y',side,sideFace+.026,-2.12+i*.70,z+.055,.57,.347,palette.darkGlass);
        panel(m,'x',side,cap+.027,0,z+.044,width*(side===1?.81:.62),.368,palette.glass);
      }
    }
    box(m,0,0,top+.002,length-.16,width-.105,.071,colour);
    panel(m,'y',1,sideFace+.030,1.62,.50,.56,.36,'#586861');
    panel(m,'y',1,sideFace+.048,1.62,.52,.032,.31,'#bbc4ad');
    const stripe=(side,from,to)=>panel(m,'y',side,sideFace+.027,(from+to)/2,.665,to-from,.039,'#d1c19e');
    stripe(-1,-cap+.14,cap-.14);
    stripe(1,-cap+.14,1.33);stripe(1,1.91,cap-.14);
    panel(m,'x',1,cap+.031,0,.64,.69,.071,'#494e47');
  }else{
    box(m,1.61,0,.40,1.65,width,1.36,colour);
    box(m,2.46,0,.405,.18,width-.10,.25,'#545750');
    box(m,-2.47,0,.375,.16,width-.10,.25,'#545750');
    panel(m,'x',1,2.435+.028,0,1.13,width*.81,.45,palette.darkGlass);
    for(const side of [-1,1])panel(m,'y',side,sideFace+.027,1.85,1.13,.62,.47,palette.glass);
    box(m,-.77,0,.43,3.48,width*.97,.17,palette.wood);
    for(const x of [-2.15,.58])for(const y of [-.66,.66])box(m,x,y,.53,.12,.12,1.21,'#5a5a4e');
  }
  for(const side of [-1,1]){
    panel(m,'x',1,cap+.027,side*width*.34,.445,.224,.143,'#fff1c0');
    panel(m,'x',-1,cap+.027,side*width*.34,.418,.152,.165,'#a54339');
  }
  return {mesh:m,wheels,wheelbase:(axes.at(-1)-axes[0])};
}
function prop(kind){
  const m=[];
  if(kind==='Reed clump'){
    for(let i=0;i<12;i++){
      const phi=i*2.4,x=Math.cos(phi)*(.18+i*.047),y=Math.sin(phi)*(.14+i*.038);
      const h=.39+(i%5)*.14;
      solid(m,[[x-.043,y,0],[x+.045,y,0],[x,y+.07,0],[x*1.65,y*1.65,h]],[[0,1,2],[0,1,3],[1,2,3],[2,0,3]],['#819253','#627945','#8d9d5e','#a5a968']);
    }
  }else if(kind==='Stone cluster'){
    for(const [x,y,r,c] of [[-.62,.12,.63,'#9f9e88'],[.34,.13,.58,'#a9a894'],[.7,.52,.3,'#b5ad93'],[.19,-.49,.35,'#929988']]){
      ring(m,x,y,0,r*.68,r,.19,c,6,'z',1,.77);
      ring(m,x,y,.19,r,r*.42,r*.65,c,6,'z',1,.77);
    }
  }else if(kind==='Canal launch'){
    solid(m,[[-1.95,-.46,.19],[-1.95,.46,.19],[1.15,.46,.19],[2,0,.28],[1.15,-.46,.19],[-1.60,-.30,0],[-1.60,.30,0],[.88,.30,0],[1.58,0,.03],[.88,-.30,0]],
      [[0,1,2,3,4],[5,6,7,8,9],[0,1,6,5],[1,2,7,6],[2,3,8,7],[3,4,9,8],[4,0,5,9]],'#a34d39');
    box(m,-.17,0,.18,2.9,.79,.10,'#dbbe8d');box(m,-.37,0,.27,1.34,.69,.53,'#e3dec2');
    for(const y of [-.36,.36])for(const x of [-.77,-.25,.12])box(m,x,y,.51,.24,.028,.17,palette.darkGlass);
    box(m,-.37,0,.79,1.5,.81,.09,'#5e7164');ring(m,.07,0,.87,.075,.071,.23,'#58554f',6);
  }else if(kind==='River gull'){
    ring(m,0,0,.12,.19,.17,1.0,'#f0ead8',7,'x',.75,.69);
    ring(m,.95,0,.12,.145,.015,.28,'#c2a169',6,'x',.58,.52);
    for(const side of [-1,1]){
      const w=.24;
      solid(m,[[.71,side*.10,.14],[.46,side*.85,w],[.15,side*1.42,w*.7],[.25,side*.61,w+.04],[.28,side*.1,.12],[.38,side*.55,w-.11]],
        [[0,1,3,4],[1,2,3],[0,4,5],[0,5,1],[1,5,2],[2,5,3],[3,5,4]],['#f7f1dd','#505d59','#e0ddcc','#e0ddcc','#656d66','#656d66','#e0ddcc']);
    }
  }else if(kind==='Farm fence'){
    for(const x of [-2,0,2])box(m,x,0,0,.14,.17,.97,'#897451');
    for(const z of [.34,.71])box(m,0,0,z,4.22,.11,.11,'#9d8863');
  }
  return m;
}

function streetProp(kind){
  const m=[],iron='#4c5851',wood='#9d7955';
  if(kind==='Street lamp'){
    ring(m,0,0,0,.14,.105,.22,'#74786b',6);
    ring(m,0,0,.22,.065,.05,2.44,iron,6);
    box(m,.18,0,2.59,.43,.095,.077,iron);
    box(m,.36,0,2.56,.24,.22,.105,'#ece1af');
    box(m,.36,0,2.665,.29,.26,.055,iron);
  }else if(kind==='Bench'){
    for(const y of [-.57,.57]){
      box(m,0,y,.02,.45,.09,.38,iron);
      box(m,-.22,y,.41,.069,.07,.38,iron);
    }
    for(const x of [-.17,0,.17])box(m,x,0,.392,.143,1.51,.062,wood);
    for(const z of [.57,.715])box(m,-.242,0,z,.065,1.51,.097,wood);
  }else if(kind==='Litter bin'){
    ring(m,0,0,0,.18,.22,.59,'#567064',8);
    ring(m,0,0,.59,.23,.20,.103,'#424f49',8);
    panel(m,'x',1,.209,0,.619,.22,.044,'#293a33');
  }else if(kind==='Bus shelter'){
    box(m,0,0,0,1.12,2.35,.09,'#b5b2a1');
    for(const y of [-1.01,1.01])for(const x of [-.45,.40])box(m,x,y,.09,.075,.072,1.77,iron);
    box(m,-.442,0,.48,.047,1.93,1.31,'#9bab9b');
    box(m,-.20,0,.47,.32,1.47,.079,wood);
    box(m,0,0,1.86,1.23,2.31,.13,'#5f796e');
    panel(m,'x',1,.618,0,1.901,1.16,.053,'#e6d6a6');
  }else if(kind==='Bus stop pole'){
    ring(m,0,0,0,.048,.044,1.92,iron,6);
    box(m,0,0,1.61,.12,.40,.35,'#71907a');
    for(const side of [-1,1])panel(m,'x',side,.076,0,1.70,.21,.15,'#e5dfbb');
  }else if(kind==='Flower planter'){
    box(m,0,0,0,.57,1.18,.31,'#ad9070');
    box(m,0,0,.31,.61,1.22,.056,'#827759');
    for(const [x,y,c] of [[-.17,-.42,'#cb8367'],[.12,-.28,'#dfc58b'],[-.08,-.05,'#d8bf80'],[.09,.27,'#c58d87'],[-.16,.42,'#e0c49b']]){
      ring(m,x,y,.367,.11,.08,.17,'#738451',5);
      ring(m,x,y,.50,.056,.036,.064,c,5);
    }
  }
  return m;
}

function person(outfit,pants,skin,hair,extra){
  const mesh=[];
  box(mesh,0,0,.694,.245,.288,.229,pants);
  box(mesh,.006,0,.845,.267,.334,.528,outfit);
  ring(mesh,.008,0,1.32,.081,.084,.164,skin,7);
  ring(mesh,.022,0,1.445,.131,.128,.226,skin,8,'z',1.04,1);
  ring(mesh,.008,0,1.615,.139,.106,.087,hair,8,'z',1.01,1);
  if(extra==='pack'){
    box(mesh,-.169,0,.936,.15,.237,.36,'#977649');
    for(const y of [-.080,.080])panel(mesh,'x',1,.158,y,.956,.025,.374,'#a68b5f');
  }
  if(extra==='cap'){
    ring(mesh,.02,0,1.662,.147,.098,.077,outfit,7);
    box(mesh,.144,0,1.661,.16,.225,.029,'#526a61');
  }
  for(const side of [-1,1]){
    const start=mesh.length;
    box(mesh,0,side*.082,.115,.135,.128,.627,pants);
    box(mesh,.051,side*.082,.016,.222,.139,.104,'#454944');
    for(let i=start;i<mesh.length;i++)mesh[i].joint=side>0?0:1;
    const arm=mesh.length;
    box(mesh,.015,side*.203,.987,.131,.093,.338,outfit);
    box(mesh,.029,side*.205,.819,.10,.081,.170,skin);
    for(let i=arm;i<mesh.length;i++)mesh[i].joint=side>0?2:3;
  }
  for(const face of mesh)face.person=true;
  return mesh;
}

function cargo(name){
  const m=[];
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
function park(name){
  const m=[],play=name==='Play park',l=play?5.5:4.8,w=play?3.9:3.6;
  const a=l/2,b=w/2,r=.19;
  const outline=[[-a+r,-b],[a-r,-b],[a,-b+r],[a,b-r],[a-r,b],[-a+r,b],[-a,b-r],[-a,-b+r]];
  const faces=outline.map((_,i)=>[i,(i+1)%8,(i+1)%8+8,i+8]);
  const base=[]; // Retaining skirt sits below the park's placement datum.
  for(const z of [-.83,.09])for(const [x,y] of outline)base.push([x,y,z]);
  solid(m,base,[[0,1,2,3,4,5,6,7],[8,9,10,11,12,13,14,15],...faces],['#908a74','#c5bba1','#a8a188']);
  const grass='#879762',edge='#afaa90';
  if(play){
    box(m,.24,0,.09,3.69,2.99,.056,'#c6ab7f');
    box(m,-2.06,-1.00,.09,.91,1.60,.061,grass);
    box(m,-2.06,1.05,.09,.91,1.48,.061,grass);
    for(const y of [-.87,.37]){
      for(const x of [-.86,.13])box(m,x,y,.15,.062,.059,1.35,'#566e66');
      box(m,-.36,y,1.43,1.12,.059,.066,'#566e66');
    }
    box(m,-.36,-.25,1.51,.062,1.36,.065,'#648177');
    for(const y of [-.39,-.13])box(m,-.39,y,.57,.031,.028,.96,'#7b775b');
    box(m,-.39,-.26,.55,.28,.38,.061,'#a3694e');
    const slideY=.64;
    for(const y of [slideY-.22,slideY+.22])box(m,.17,y,.15,.064,.064,.92,'#8e6950');
    for(const z of [.38,.63,.88])box(m,.17,slideY,z,.066,.52,.050,'#967454');
    function chute(y0,y1,offset,thickness,col){
      const v=[ [.18,y0,1.065],[1.21,y0,.32],[1.44,y0,.29],[.18,y1,1.065],[1.21,y1,.32],[1.44,y1,.29] ];
      for(let i=0;i<2;i++){
        const edge=[v[i],v[i+1],v[i+4],v[i+3]].map(([x,y,z])=>[x,y,z+offset]);
        solid(m,edge.concat(edge.map(([x,y,z])=>[x,y,z+thickness])),
          [[0,1,2,3],[4,5,6,7],[0,1,5,4],[1,2,6,5],[2,3,7,6],[3,0,4,7]],col);
      }
    }
    chute(slideY-.22,slideY+.22,0,.054,'#d3a663');
    for(const y of [slideY-.22,slideY+.19])chute(y,y+.031,.053,.044,'#b7854e');
    box(m,1.62,-1.04,.151,1.12,.74,.16,'#9e885f');
    box(m,1.62,-1.04,.311,.93,.58,.032,'#e0c89c');
    mergeModel(m,streetProp('Bench'),-1.76,.95,.151,Math.PI*.09,.67);
    mergeModel(m,tree('Birch'),-1.92,-1.26,.153,0,.53);
  }else{
    box(m,.06,.98,.09,4.34,1.20,.062,grass);
    box(m,.06,-.98,.09,4.34,1.20,.062,grass);
    for(const y of [-1.56,1.56])box(m,.06,y,.151,4.30,.09,.087,edge);
    mergeModel(m,tree('Oak'),.94,.94,.152,.26,.57);
    mergeModel(m,streetProp('Bench'),-.75,-.74,.152,Math.PI/2,.69);
    mergeModel(m,streetProp('Bench'),-.66,.78,.152,-Math.PI/2,.69);
    mergeModel(m,streetProp('Flower planter'),1.24,-.99,.153,Math.PI/2,.80);
    mergeModel(m,streetProp('Litter bin'),-1.94,-.78,.152,0,.70);
    ring(m,.80,-.08,.09,.42,.37,.17,'#9f9d89',9);
    ring(m,.80,-.08,.26,.31,.30,.026,'#679594',9);
    ring(m,.80,-.08,.287,.077,.052,.12,'#b4baa1',6);
  }
  return m;
}


function timberLoad(){
  const m=[];
  for(const [y,z,r] of [[-.42,.84,.25],[.02,.85,.25],[.43,.82,.22],[-.2,1.22,.23],[.22,1.19,.22]]){
    ring(m,-2.37,y,z,r,r,3.05,'#806141',8,'x');
    ring(m,-2.398,y,z,r*.79,r*.79,.038,'#c49b66',8,'x');
    ring(m,-2.429,y,z,r*.38,r*.38,.035,'#ab8150',7,'x');
  }
  return m;
}
function model(faces){
  return faces.map(({p,n,c,joint})=>{
    const light=n[0]*-.40+n[1]*-.53+n[2]*.75;
    const tint=parseInt(c.slice(1),16), factor=.86+.18*light;
    const channels=[tint>>16,(tint>>8)&255,tint&255].map(v=>Math.min(255,Math.round(v*factor)));
    return {points:p,color:'rgb('+channels.join(',')+')',joint};
  });
}
const houses=[
  ['Cottage',3.1,2.6,1.65,'#d9c498','#a4644e'],
  ['Cottage',3.1,2.6,1.65,'#e1d4ba','#6e7569'],
  ['Terrace',5.15,2.35,2.35,'#b78364','#6c645d'],
];
const trees=['Pine','Fir','Oak','Birch'].map(kind=>model(tree(kind)));
const truck=vehicle('Log truck','#5d7d64'),bus=vehicle('Single-decker','#638b78');
const props=['Reed clump','Stone cluster','Canal launch','River gull','Farm fence'];
const rollingWheel=model(wheelMesh);
const distantWheel=[];
ring(distantWheel,0,-.36,0,1,1,.72,palette.tyre,7,'y');
ring(distantWheel,0,-.41,0,.49,.49,.82,palette.hub,7,'y');
const simpleWheel=model(distantWheel);
function scaledVehicle(rig,scale){
  const body=model(rig.mesh);
  const fixedWheels=rig.wheels.flatMap(wheel=>simpleWheel.map(face=>({
    ...face,points:face.points.map(([x,y,z])=>[wheel.x+x*wheel.radius,wheel.y+y*wheel.radius,wheel.z+z*wheel.radius])
  })));
  return {model:body,compact:[...body,...fixedWheels],wheels:rig.wheels,wheelbase:rig.wheelbase,scale};
}
const people=[model(person('#51798b','#443f49','#bc9678','#423c37','pack')),model(person('#a96c4c','#555c54','#d6ae88','#594534','cap'))];
const walking=Array.from({length:8},(_,frame)=>people[0].map(face=>{
  if(face.joint===undefined)return face;
  const hip=face.joint<2?.74:1.24;
  const swing=Math.sin(frame*Math.PI/4)*.43*(face.joint%2===0?1:-1)*(face.joint<2?1:-1);
  const c=Math.cos(swing),s=Math.sin(swing);
  return {...face,points:face.points.map(([x,y,z])=>[x*c+(z-hip)*s,y,hip-x*s+(z-hip)*c])};
}));
window.contourAssets={
  houses:houses.map(([kind,width,depth,height,wall,roof])=>({width,depth,height,mesh:model(house(kind,wall,roof))})),
  trees,truck:scaledVehicle(truck,.057),bus:scaledVehicle(bus,.057),
  props:Object.fromEntries(props.map(kind=>[kind,model(prop(kind))])),
  streetProps:Object.fromEntries(['Street lamp','Bench','Litter bin','Flower planter','Bus shelter','Bus stop pole'].map(kind=>[kind,model(streetProp(kind))])),
  people,walking,
  parks:['Pocket park','Play park'].map(name=>model(park(name))),
  storage:[model(cargo('Log stack')),model(cargo('Sawn timber'))],
  timber:model(timberLoad()),wheel:rollingWheel
};
})();
