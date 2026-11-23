window.drawFinanceChart=function(canvas,samples,series,label,ceiling,showSample){
  const width=canvas.clientWidth,height=canvas.clientHeight;
  if(!width||!height)return;
  const scale=Math.min(2,devicePixelRatio||1);
  canvas.width=width*scale;canvas.height=height*scale;
  const pen=canvas.getContext('2d');
  pen.scale(scale,scale);
  const inset={left:49,right:12,top:13,bottom:23};
  let low=Infinity,high=-Infinity;
  for(const sample of samples)for(const [key] of series){
    if(!Number.isFinite(sample[key]))continue;
    low=Math.min(low,sample[key]);high=Math.max(high,sample[key]);
  }
  const lo=series[0][0]==='cash'&&Number.isFinite(low)?low:0;
  const hi=ceiling??Math.max(lo+1,high);
  const compact=new Intl.NumberFormat('en-GB',{notation:'compact',maximumFractionDigits:2});
  const span=width-inset.left-inset.right,last=samples.length-1;
  const x=i=>inset.left+span*i/Math.max(1,last);
  const y=value=>inset.top+(height-inset.top-inset.bottom)*(hi-value)/(hi-lo);

  function draw(selected){
    pen.clearRect(0,0,width,height);
    pen.font='10px system-ui';pen.fillStyle='#b6c9ba';pen.textAlign='left';
    pen.lineWidth=1;
    for(const fraction of [0,.5,1]){
      const value=lo+(hi-lo)*fraction,ordinate=y(value);
      pen.strokeStyle='#53665a';
      pen.beginPath();pen.moveTo(inset.left,ordinate);pen.lineTo(width-inset.right,ordinate);pen.stroke();
      pen.textBaseline='middle';pen.fillText(compact.format(value)+(ceiling?'%':''),0,ordinate);
    }
    if(selected!==last){
      pen.strokeStyle='#b6c9ba';
      pen.beginPath();pen.moveTo(x(selected),y(hi));pen.lineTo(x(selected),y(lo));pen.stroke();
    }
    for(const [key,color] of series){
      pen.beginPath();
      let connected=false;
      for(const [index,sample] of samples.entries()){
        if(!Number.isFinite(sample[key])){connected=false;continue;}
        const ordinate=y(sample[key]);
        if(connected)pen.lineTo(x(index),ordinate);else pen.moveTo(x(index),ordinate);
        connected=true;
      }
      pen.strokeStyle=color;pen.lineWidth=2;pen.stroke();
      const value=samples[selected][key];
      if(!Number.isFinite(value))continue;
      pen.fillStyle=color;
      pen.beginPath();pen.arc(x(selected),y(value),2.75,0,Math.PI*2);pen.fill();
    }
    pen.fillStyle='#b6c9ba';pen.textBaseline='bottom';
    pen.fillText(label(samples[0]),inset.left,height-3);
    if(last){
      pen.textAlign='right';pen.fillText(label(samples[last]),width-2,height-3);
    }
  }

  let cursor=last;
  function select(index){
    cursor=Math.max(0,Math.min(last,index));
    draw(cursor);showSample(samples[cursor]);
  }
  draw(cursor);
  canvas.addEventListener('pointerup',event=>{
    canvas.focus({preventScroll:true});
    select(Math.round((event.offsetX-inset.left)/span*last));
  });
  canvas.addEventListener('keydown',event=>{
    if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
    event.preventDefault();
    const direction=event.key==='ArrowLeft'?-1:1;
    select(event.key==='Home'?0:event.key==='End'?last:cursor+direction);
  });
  canvas.addEventListener('blur',()=>select(last));
};
