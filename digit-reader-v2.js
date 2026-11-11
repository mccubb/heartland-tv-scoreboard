// Heartland TV connected-glyph seven-segment reader.
// Treats each complete slanted digit as one shape instead of interpreting its
// separate vertical LED bars as extra 1s. No changes to the camera or smoothing.
function readSevenSegmentFast(image,key){
 if(!['homeScore','awayScore','seconds','period'].includes(key))return null;
 const sourceW=image.width,sourceH=image.height;
 if(sourceW<8||sourceH<12)return null;
 // Average to a compact image for fast processing of large camera crops.
 const scale=Math.min(1,140/sourceW,90/sourceH);
 const w=Math.max(8,Math.round(sourceW*scale)),h=Math.max(12,Math.round(sourceH*scale));
 const raw=segmentPixels(image).gray,gray=new Uint8Array(w*h);
 if(w===sourceW&&h===sourceH)gray.set(raw);
 else for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  const xa=Math.floor(x*sourceW/w),xb=Math.max(xa+1,Math.floor((x+1)*sourceW/w));
  const ya=Math.floor(y*sourceH/h),yb=Math.max(ya+1,Math.floor((y+1)*sourceH/h));
  let sum=0,count=0;
  for(let yy=ya;yy<yb;yy++)for(let xx=xa;xx<xb;xx++){sum+=raw[yy*sourceW+xx];count++}
  gray[y*w+x]=Math.round(sum/count);
 }
 const patterns=['1111110','0110000','1101101','1111001','0110011','1011011','1011111','1110000','1111111','1111011'];
 const regions=[[.22,0,.78,.17],[.70,.16,1,.43],[.70,.57,1,.86],[.22,.84,.78,1],[0,.57,.30,.86],[0,.16,.30,.43],[.22,.42,.78,.59]];
 const votes=new Map();
 for(const cutoff of [65,85,105,125,145]){
  const ink=new Uint8Array(w*h),seen=new Uint8Array(w*h);
  for(let i=0;i<gray.length;i++)if(gray[i]<cutoff)ink[i]=1;
  const components=[];
  for(let i=0;i<ink.length;i++){
   if(!ink[i]||seen[i])continue;
   const stack=[i],points=[];seen[i]=1;
   let left=w,right=-1,top=h,bottom=-1;
   while(stack.length){
    const n=stack.pop(),x=n%w,y=Math.floor(n/w);
    points.push(n);left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);
    let nn=n-1;
    if(x>0&&ink[nn]&&!seen[nn]){seen[nn]=1;stack.push(nn)}
    nn=n+1;
    if(x+1<w&&ink[nn]&&!seen[nn]){seen[nn]=1;stack.push(nn)}
    nn=n-w;
    if(y>0&&ink[nn]&&!seen[nn]){seen[nn]=1;stack.push(nn)}
    nn=n+w;
    if(y+1<h&&ink[nn]&&!seen[nn]){seen[nn]=1;stack.push(nn)}
    nn=n-w-1;
    if(x>0&&y>0&&ink[nn]&&!seen[nn]){seen[nn]=1;stack.push(nn)}
    nn=n-w+1;
    if(x+1<w&&y>0&&ink[nn]&&!seen[nn]){seen[nn]=1;stack.push(nn)}
    nn=n+w-1;
    if(x>0&&y+1<h&&ink[nn]&&!seen[nn]){seen[nn]=1;stack.push(nn)}
    nn=n+w+1;
    if(x+1<w&&y+1<h&&ink[nn]&&!seen[nn]){seen[nn]=1;stack.push(nn)}
   }
   if(points.length<Math.max(5,h*.085))continue;
   const cw=right-left+1,ch=bottom-top+1;
   components.push({left,right,top,bottom,w:cw,h:ch,area:points.length,points,cx:(left+right)/2,cy:(top+bottom)/2});
  }
  const potential=components.filter(c=>c.h>=Math.max(9,h*.24)&&c.w/c.h>=.065&&c.w/c.h<=1.12&&c.area>=c.h*.7);
  if(!potential.length)continue;
  const maxH=Math.max(...potential.map(c=>c.h));
  const digits=potential.filter(c=>c.h>=maxH*.60).sort((a,b)=>a.left-b.left);
  if(!digits.length||digits.length>5)continue;
  const tops=Math.min(...digits.map(c=>c.top));
  const dots=components.filter(c=>!digits.includes(c)&&c.h<maxH*.29&&c.w<maxH*.28&&c.area>Math.max(4,maxH*.10));
  let colon=null,decimal=null;
  if(key==='seconds'){
   for(const a of dots)for(const b of dots){
    if(a===b)continue;
    if(Math.abs(a.cx-b.cx)<maxH*.20&&b.cy-a.cy>maxH*.22&&b.cy-a.cy<maxH*.72)colon=(a.cx+b.cx)/2;
   }
   if(colon===null){
    const dotsBelow=dots.filter(d=>d.cy>tops+maxH*.62&&digits.some(c=>c.cx<d.cx)&&digits.some(c=>c.cx>d.cx));
    if(dotsBelow.length)decimal=Math.max(...dotsBelow.map(d=>d.cx));
   }
  }
  const used=digits.filter(c=>decimal===null||c.cx<decimal);
  const decoded=[];
  for(const c of used){
   let d;
   if(c.w/c.h<.36)d='1';
   else{
    const cov=[];
    for(const [x0,y0,x1,y1] of regions){
     const xa=c.left+Math.floor(x0*c.w),xb=Math.max(xa+1,c.left+Math.ceil(x1*c.w));
     const ya=c.top+Math.floor(y0*c.h),yb=Math.max(ya+1,c.top+Math.ceil(y1*c.h));
     let count=0;
     for(const n of c.points){const x=n%w,y=Math.floor(n/w);if(x>=xa&&x<xb&&y>=ya&&y<yb)count++}
     cov.push(count/Math.max(1,(xb-xa)*(yb-ya)));
    }
    const peak=Math.max(...cov),bits=cov.map(x=>x>Math.max(.10,peak*.38)?'1':'0').join('');
    const index=patterns.indexOf(bits);if(index<0)break;d=String(index);
   }
   decoded.push({component:c,digit:d});
  }
  if(decoded.length!==used.length||!decoded.length)continue;
  let text='';
  if(key==='seconds'&&colon!==null){
   const before=decoded.filter(p=>p.component.cx<colon).map(p=>p.digit).join('');
   const after=decoded.filter(p=>p.component.cx>colon).map(p=>p.digit).join('');
   if(!before||after.length!==2)continue;
   text=before+':'+after;
  }else{
   text=decoded.map(p=>p.digit).join('');
   // If the tiny decimal dot is invisible, the third digit is tenths.
   if(key==='seconds'&&decimal===null&&text.length===3)text=text.slice(0,2);
   if(key==='seconds'&&text.length>2)continue;
  }
  if(!text)continue;
  const value=parseReading(key,text);
  if(value===null)continue;
  const vote=votes.get(value)||{value,text,count:0};vote.count++;votes.set(value,vote);
 }
 const ordered=[...votes.values()].sort((a,b)=>b.count-a.count);
 if(!ordered.length||ordered[0].count<3||ordered[1]?.count===ordered[0].count)return null;
 const winner=ordered[0];
 return {value:winner.value,text:winner.text,confidence:Math.min(98,85+winner.count*2),method:'Connected LED digits'};
}
