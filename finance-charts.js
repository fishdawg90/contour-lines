window.drawFinanceChart=function(canvas,samples,series,label,ceiling,showSample){
  const width=canvas.clientWidth,height=canvas.clientHeight;
  if(!width||!height||!samples.length)return;
  const scale=Math.min(2,devicePixelRatio||1);
  canvas.width=width*scale;canvas.height=height*scale;
  const pen=canvas.getContext('2d');
  pen.scale(scale,scale);
  const inset={left:49,right:12,top:13,bottom:23};
  const firstWeek=samples[0].week,last=samples.length-1,lastWeek=samples[last].week;
  const span=width-inset.left-inset.right;
  const weekSpan=Math.max(1,lastWeek-firstWeek);
  const x=i=>inset.left+(last?span*(samples[i].week-firstWeek)/weekSpan:span/2);

  // Fit a rolling trend in calendar time. Preserve gaps in unavailable readings.
  const halfWindow=Math.max(4,Math.round(weekSpan/65));
  const plots=series.map(([key,color,,perWeek])=>{
    const values=samples.map(sample=>Number.isFinite(sample[key])?
      sample[key]/(perWeek?(sample.periodWeeks??1):1):null);
    let low=0,high=0,sum=0,weight=0;
    const trend=values.map((value,i)=>{
      const week=samples[i].week;
      while(high<values.length&&samples[high].week<=week+halfWindow){
        if(values[high]!==null){
          const weeks=samples[high].periodWeeks??1;
          sum+=values[high]*weeks;weight+=weeks;
        }
        high++;
      }
      while(low<high&&samples[low].week<week-halfWindow){
        if(values[low]!==null){
          const weeks=samples[low].periodWeeks??1;
          sum-=values[low]*weeks;weight-=weeks;
        }
        low++;
      }
      return value===null||!weight?null:sum/weight;
    });
    return {color,values,trend};
  });
  let low=Infinity,high=-Infinity;
  for(const {values} of plots)for(const value of values)if(value!==null){
    low=Math.min(low,value);high=Math.max(high,value);
  }
  const lo=Number.isFinite(low)?(series[0][0]==='cash'?low:Math.min(0,low)):0;
  const hi=ceiling??Math.max(lo+1,high);
  const compact=new Intl.NumberFormat('en-GB',{notation:'compact',maximumFractionDigits:2});
  const y=value=>inset.top+(height-inset.top-inset.bottom)*(hi-value)/(hi-lo);

  function line(values){
    pen.beginPath();
    let connected=false;
    for(const [index,value] of values.entries()){
      if(value===null){connected=false;continue;}
      if(connected)pen.lineTo(x(index),y(value));else pen.moveTo(x(index),y(value));
      connected=true;
    }
    pen.stroke();
  }
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
    for(const {color,values,trend} of plots){
      pen.strokeStyle=color;
      pen.globalAlpha=.32;pen.lineWidth=1.25;line(values);
      pen.globalAlpha=1;pen.lineWidth=2.5;line(trend);
      const value=values[selected];
      if(value===null)continue;
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
    const closest=samples.reduce((best,_,i)=>Math.abs(x(i)-event.offsetX)<Math.abs(x(best)-event.offsetX)?i:best,0);
    select(closest);
  });
  canvas.addEventListener('keydown',event=>{
    if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
    event.preventDefault();
    const direction=event.key==='ArrowLeft'?-1:1;
    select(event.key==='Home'?0:event.key==='End'?last:cursor+direction);
  });
  canvas.addEventListener('blur',()=>select(last));
};
