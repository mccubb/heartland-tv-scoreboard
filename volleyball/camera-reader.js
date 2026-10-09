'use strict';
const byId=id=>document.getElementById(id),keys=['homeScore','awayScore','homeSets','awaySets'];
let config={regions:{},reader:'segments',polarity:'dark',confidence:70,device:''};
try{const c=JSON.parse(localStorage.getItem('htv-volleyball-camera')||'{}');config={...config,...c,regions:c.regions||{}}}catch(e){}
// This gym camera shows DARK numerals on a BRIGHT face. Earlier builds
// defaulted to inverted polarity, causing hollow zeroes to be decoded as 8s.
// Correct that old default once. Users can still switch polarity manually.
try{if(!localStorage.getItem('htv-vb-dark-digits-v1')){if(config.polarity==='light')config.polarity='dark';localStorage.setItem('htv-volleyball-camera',JSON.stringify(config));localStorage.setItem('htv-vb-dark-digits-v1','1')}}catch(e){}
let stream=null,worker=null,loading=null,busy=false,running=false,generation=0,selected=null,drag=null,lastTest=null,verified=false;
let candidates={},confirmed={};const video=byId('video'),overlay=byId('overlay'),ctx=overlay.getContext('2d');
const palette={homeScore:'#36d0ff',awayScore:'#ffb63b',homeSets:'#70ed9a',awaySets:'#e79bff'};
function status(text){byId('status').textContent=text}
function store(){localStorage.setItem('htv-volleyball-camera',JSON.stringify(config))}
function parseReading(key,text){const clean=String(text).replace(/\s/g,'');if(!/^\d{1,2}$/.test(clean))return null;const n=Number(clean);return n<=(key.endsWith('Sets')?9:99)?n:null}
function format(key,value){return value===null?'—':String(value)}
function activeKeys(){return keys}
function ready(){return stream&&video.readyState>=2&&activeKeys().every(k=>config.regions[k])}
function buttons(){byId('test').disabled=!ready()||busy||running;byId('start').disabled=!ready()||busy||running||!verified;byId('pause').disabled=!running;byId('apply').disabled=running||busy||!lastTest||!activeKeys().some(k=>lastTest[k]?.value!=null);byId('disconnect').disabled=!stream;byId('connect').disabled=busy||running}
function pause(message='Automatic updates paused.'){running=false;generation++;candidates={};buttons();status(message)}
function invalidate(){pause('Reading areas changed. Test the readings before starting.');verified=false;lastTest=null;buttons()}
function point(event){const b=overlay.getBoundingClientRect();return {x:Math.max(0,Math.min(1,(event.clientX-b.left)/b.width)),y:Math.max(0,Math.min(1,(event.clientY-b.top)/b.height))}}
function renderBoxes(){if(!video.videoWidth)return;overlay.width=video.videoWidth;overlay.height=video.videoHeight;ctx.clearRect(0,0,overlay.width,overlay.height);const regions={...config.regions};if(drag)regions[selected]={x:Math.min(drag.start.x,drag.end.x),y:Math.min(drag.start.y,drag.end.y),w:Math.abs(drag.end.x-drag.start.x),h:Math.abs(drag.end.y-drag.start.y)};for(const [key,r] of Object.entries(regions)){if(!keys.includes(key))continue;ctx.strokeStyle=palette[key];ctx.lineWidth=3;ctx.strokeRect(r.x*overlay.width,r.y*overlay.height,r.w*overlay.width,r.h*overlay.height);ctx.fillStyle=palette[key];ctx.font='bold 18px Arial';ctx.fillText(({homeScore:'Left score',awayScore:'Right score',homeSets:'Left sets',awaySets:'Right sets'})[key],r.x*overlay.width+4,Math.max(20,r.y*overlay.height-6))}}
overlay.addEventListener('pointerdown',event=>{if(!selected||!stream)return;invalidate();overlay.setPointerCapture(event.pointerId);drag={start:point(event),end:point(event)};renderBoxes()});
overlay.addEventListener('pointermove',event=>{if(drag){drag.end=point(event);renderBoxes()}});
overlay.addEventListener('pointerup',event=>{if(!drag)return;drag.end=point(event);const r={x:Math.min(drag.start.x,drag.end.x),y:Math.min(drag.start.y,drag.end.y),w:Math.abs(drag.end.x-drag.start.x),h:Math.abs(drag.end.y-drag.start.y)};if(r.w>.008&&r.h>.008){config.regions[selected]=r;store();status('Area saved. Select the next area or click Test reading.')}drag=null;renderBoxes();buttons()});
overlay.addEventListener('pointercancel',()=>{drag=null;renderBoxes()});
for(const button of document.querySelectorAll('[data-region]'))button.onclick=()=>{selected=button.dataset.region;for(const b of document.querySelectorAll('[data-region]'))b.classList.toggle('active',b===button);status('Drag a box around '+button.textContent.toLowerCase()+'.')};
async function connect(){pause();verified=false;lastTest=null;buttons();try{if(!navigator.mediaDevices?.getUserMedia)throw Error('Camera access is unavailable. Open this page in Chrome using the HTTPS link.');if(stream)stream.getTracks().forEach(t=>t.stop());stream=null;const requested=byId('device').value;stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{...(requested?{deviceId:{exact:requested}}:{}),width:{ideal:1920},height:{ideal:1080}}});video.srcObject=stream;await video.play();const devices=await navigator.mediaDevices.enumerateDevices();byId('device').replaceChildren();for(const d of devices.filter(d=>d.kind==='videoinput')){const o=document.createElement('option');o.value=d.deviceId;o.textContent=d.label||'Camera '+(byId('device').options.length+1);byId('device').appendChild(o)}const actual=stream.getVideoTracks()[0].getSettings().deviceId;byId('device').value=actual||requested;config.device=byId('device').value;store();renderBoxes();status('Camera connected. Mark left score, right score, left sets, and right sets, then test.');stream.getVideoTracks()[0].addEventListener('ended',()=>disconnect('Camera disconnected. Updates paused.'))}catch(e){status(e.name==='NotAllowedError'?'Camera permission denied. Allow camera access in your browser and try again.':e.message);stream=null}buttons()}
function disconnect(message='Camera disconnected.'){pause(message);if(stream)stream.getTracks().forEach(t=>t.stop());stream=null;video.srcObject=null;verified=false;lastTest=null;ctx.clearRect(0,0,overlay.width,overlay.height);buttons()}
async function engine(){if(worker)return worker;if(!window.Tesseract)throw Error('The reading engine did not load. Check your internet connection and reload this page.');if(!loading)loading=(async()=>{status('Loading reading engine for first use…');const w=await Tesseract.createWorker('eng',1,{logger:m=>{if(m.status?.includes('loading')||m.status?.includes('initializing'))status('Loading reading engine… '+Math.round((m.progress||0)*100)+'%')}});await w.setParameters({tessedit_char_whitelist:'0123456789',tessedit_pageseg_mode:Tesseract.PSM.SINGLE_LINE,user_defined_dpi:'150'});worker=w;return w})().catch(e=>{loading=null;throw e});return loading}
function crop(frame,r){const sw=Math.max(1,Math.round(r.w*(frame.videoWidth||frame.width))),sh=Math.max(1,Math.round(r.h*(frame.videoHeight||frame.height))),scale=Math.min(6,Math.max(2,100/sh)),pad=15;const c=document.createElement('canvas');c.width=Math.round(sw*scale)+pad*2;c.height=Math.round(sh*scale)+pad*2;const x=c.getContext('2d',{willReadFrequently:true});x.fillStyle='white';x.fillRect(0,0,c.width,c.height);x.drawImage(frame,r.x*(frame.videoWidth||frame.width),r.y*(frame.videoHeight||frame.height),sw,sh,pad,pad,c.width-pad*2,c.height-pad*2);if(config.polarity!=='original'){const image=x.getImageData(pad,pad,c.width-pad*2,c.height-pad*2),p=image.data;let lo=255,hi=0;for(let i=0;i<p.length;i+=4){const v=Math.max(p[i],p[i+1],p[i+2]);lo=Math.min(lo,v);hi=Math.max(hi,v)}for(let i=0;i<p.length;i+=4){let v=255*(Math.max(p[i],p[i+1],p[i+2])-lo)/Math.max(1,hi-lo);if(config.polarity==='light')v=255-v;p[i]=p[i+1]=p[i+2]=v}x.putImageData(image,pad,pad)}return c}
// Read the seven lit bars directly instead of asking a text model to guess a font.
// Independent column check: do not collapse two visible seven-segment
// digits (for example 19) into an apparently confident single 8.
// Evaluate isolated left and right glyphs before accepting a one-digit result.
function readSeparatedDigits(image,key,prepared){
 if(key.endsWith('Sets'))return null;
 const w=image.width,h=image.height,g=prepared.gray;
 const cutoff=Math.min(prepared.threshold,145);
 const counts=new Int32Array(w);let minX=w,maxX=-1,minY=h,maxY=-1;
 for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(g[y*w+x]<=cutoff){
  counts[x]++;if(x<minX)minX=x;if(x>maxX)maxX=x;
  if(y<minY)minY=y;if(y>maxY)maxY=y;
 }
 if(maxX<minX||maxY<minY)return null;
 const width=maxX-minX+1,height=maxY-minY+1;
 // A single ordinary digit is narrower than its height. 19, 17 and 20
 // on our gym board can be wider than one character but touch diagonally.
 if(width<height*.76)return null;
 const a=Math.floor(minX+width*.24),b=Math.ceil(minX+width*.76);
 let cut=-1,best=Infinity;
 for(let x=a;x<=b;x++){
  // Prefer an actual clear column, but allow a small overlapping seam.
  const cost=counts[x]+.015*Math.abs(x-(minX+maxX)/2);
  if(cost<best){best=cost;cut=x}
 }
 if(cut<0)return null;
 const leftInk=counts.slice(minX,cut+1).reduce((x,y)=>x+y,0);
 const rightInk=counts.slice(cut+1,maxX+1).reduce((x,y)=>x+y,0);
 const total=leftInk+rightInk;
 if(leftInk<total*.085||rightInk<total*.085||best>height*.22)return null;
 const decodePart=(x0,x1)=>{
  const width=x1-x0+1,pixels=new Uint8ClampedArray(width*h*4);
  for(let y=0;y<h;y++)for(let x=0;x<width;x++){
   const gray=g[y*w+(x+x0)],i=(y*width+x)*4;
   pixels[i]=pixels[i+1]=pixels[i+2]=gray;pixels[i+3]=255;
  }
  const part={width,height:h,getContext:()=>({getImageData:()=>({data:pixels})})};
  const prep=segmentPixels(part);
  const readings=[80,110,145,185,220].map(t=>readSevenSegmentPass(part,key,t,prep))
   .filter(v=>v&&v.text.length===1);
  const freq=new Map();
  for(const v of readings)freq.set(v.text,(freq.get(v.text)||0)+1);
  const ranked=[...freq].sort((a,b)=>b[1]-a[1]);
  if(!ranked.length||ranked[0][1]<3||(ranked[1]&&ranked[1][1]===ranked[0][1]))return null;
  return ranked[0][0];
 };
 const left=decodePart(minX,cut),right=decodePart(cut+1,maxX);
 if(left===null||right===null)return null;
 const value=parseReading(key,left+right);
 return value===null?null:{value,text:left+right,confidence:92,method:'Seven-segment · separate digits'};
}
function readSevenSegment(image,key){
 // Check more than one exposure cutoff. A faint bar should not disappear
 // solely because a bright reflection changed the crop's contrast.
 const prepared=segmentPixels(image);
 const readings=[80,110,145,185,220].map(limit=>readSevenSegmentPass(image,key,limit,prepared)).filter(Boolean);
 if(!readings.length)return null;
 const groups=new Map();for(const r of readings){const g=groups.get(r.text)||[];g.push(r);groups.set(r.text,g)}
 const ranked=[...groups.values()].sort((a,b)=>b.length-a.length);
 if(ranked.length>1&&ranked[0].length<=ranked[1].length)return null;
 const votes=ranked[0];if(ranked.length>1&&votes.length<3)return null;
 const best=votes.sort((a,b)=>b.confidence-a.confidence)[0];
 const separated=readSeparatedDigits(image,key,prepared);
 if(separated&&separated.text.length===2){
  // Respect two independently recognized glyphs even if the original
  // overlapping projection happened to mistake the pair for one 8.
  if(best.text.length===1)return separated;
  if(best.text!==separated.text)return null;
 }
 // Never post a lone 8 from a crop containing an unresolved, clearly
 // two-character-wide display; hold the last correct score instead.
 if(best.text==='8'&&!key.endsWith('Sets')){
  const g=prepared.gray,w=image.width,h=image.height,t=Math.min(prepared.threshold,145);
  let l=w,r=-1,top=h,bottom=-1;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(g[y*w+x]<=t){
   l=Math.min(l,x);r=Math.max(r,x);top=Math.min(top,y);bottom=Math.max(bottom,y);
  }
  if(r>=l&&bottom>=top&&(r-l+1)/(bottom-top+1)>.92)return null;
 }
 return best;
}
function segmentPixels(image){
 const w=image.width,h=image.height,p=image.getContext('2d').getImageData(0,0,w,h).data;
 const hist=new Array(256).fill(0),gray=new Uint8Array(w*h);
 for(let i=0;i<gray.length;i++){gray[i]=Math.round((p[i*4]+p[i*4+1]+p[i*4+2])/3);hist[gray[i]]++}
 let sum=0;for(let i=0;i<256;i++)sum+=i*hist[i];let count=0,left=0,best=-1,threshold=128;
 for(let i=0;i<255;i++){count+=hist[i];left+=i*hist[i];if(!count||count===gray.length)continue;const delta=left/count-(sum-left)/(gray.length-count),variance=count*(gray.length-count)*delta*delta;if(variance>best){best=variance;threshold=i}}
 // Crops are contrast-normalized. Do not count mid-gray screen shadows as bars.
 return {gray,threshold};
}
function readSevenSegmentPass(image,key,limit,prepared=segmentPixels(image)){
 const w=image.width,h=image.height,gray=prepared.gray,threshold=Math.min(prepared.threshold,limit);
 const ink=new Uint8Array(w*h),cols=new Array(w).fill(0);let top=h,bottom=-1;
 for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(gray[y*w+x]<=threshold){ink[y*w+x]=1;cols[x]++;top=Math.min(top,y);bottom=Math.max(bottom,y)}
 let height=bottom-top+1;if(height<12)return null;
 // Remove isolated noise and separate the two colon dots even when their
 // columns overlap a slanted digit. Segment bars may remain disconnected.
 const seen=new Uint8Array(w*h),components=[];
 for(let i=0;i<ink.length;i++)if(ink[i]&&!seen[i]){const stack=[i],points=[];seen[i]=1;let l=w,r=0,t=h,b=0;
  while(stack.length){const n=stack.pop(),x=n%w,y=Math.floor(n/w);points.push(n);l=Math.min(l,x);r=Math.max(r,x);t=Math.min(t,y);b=Math.max(b,y);for(const next of [x>0?n-1:-1,x<w-1?n+1:-1,y>0?n-w:-1,y<h-1?n+w:-1])if(next>=0&&ink[next]&&!seen[next]){seen[next]=1;stack.push(next)}}
  components.push({l,r,t,b,points});
 }
 // A flat frame edge must not stretch the glyph height or bridge two digits.
 for(const c of components)if((c.t<=16||c.b>=h-17)&&c.r-c.l+1>height*.55&&c.b-c.t+1<height*.15)for(const n of c.points)ink[n]=0;
 top=h;bottom=-1;for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(ink[y*w+x]){top=Math.min(top,y);bottom=Math.max(bottom,y)}height=bottom-top+1;if(height<12)return null;
 let colonX=null,decimalX=null,decimalY=null;
 if(false){const dots=components.filter(c=>c.b-c.t+1<height*.24&&c.r-c.l+1<height*.25&&c.points.length>=height*.3);
  for(const a of dots)for(const b of dots)if(a!==b&&Math.abs((a.l+a.r-b.l-b.r)/2)<height*.18&&b.t-a.b>height*.15&&b.t-a.b<height*.65){colonX=(a.l+a.r+b.l+b.r)/4;for(const n of [...a.points,...b.points])ink[n]=0}
 }
 if(false&&colonX===null){const dots=components.filter(c=>c.t>=top+height*.68&&c.b-c.t+1<height*.2&&c.r-c.l+1<height*.25&&c.points.length>=height*height*.001);if(dots.length===1){decimalX=(dots[0].l+dots[0].r)/2;decimalY=(dots[0].t+dots[0].b)/2;for(const n of dots[0].points)ink[n]=0}}
 // Tenths are outside the whole-seconds number. Remove them before grouping,
 // so their bars cannot change its height, lean, or digit boundaries.
 if(decimalX!==null){
  const slopes=[];
  for(const c of components){const dh=c.b-c.t+1,dw=c.r-c.l+1;if(dh<height*.2||dh>height*.65||dw/dh>.85)continue;
   let sx=0,sy=0;for(const n of c.points){sx+=n%w;sy+=Math.floor(n/w)}const mx=sx/c.points.length,my=sy/c.points.length;let cov=0,variance=0;
   for(const n of c.points){const dy=Math.floor(n/w)-my;cov+=dy*(n%w-mx);variance+=dy*dy}const slope=cov/Math.max(1,variance);if(Math.abs(slope)<.4)slopes.push(slope);
  }
  slopes.sort((a,b)=>a-b);const lean=slopes.length>=2?slopes[Math.floor(slopes.length/2)]:0,tolerance=slopes.length>=2?0:height*.12;
  // Remove tenths by their complete shapes in the digit plane. A vertical
  // cut through the decimal point clips the upper bars of slanted seconds.
  for(const c of components){let center=0;for(const n of c.points)center+=n%w-lean*(Math.floor(n/w)-decimalY);
   if(center/c.points.length>decimalX+tolerance)for(const n of c.points)ink[n]=0;
  }
 }
 for(const c of components)if(c.points.length<height*height*.012)for(const n of c.points)ink[n]=0;
 cols.fill(0);top=h;bottom=-1;for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(ink[y*w+x]){cols[x]++;top=Math.min(top,y);bottom=Math.max(bottom,y)}height=bottom-top+1;if(height<12)return null;
 let runs=[];let start=-1,gap=0;const maxGap=false?1:Math.max(1,Math.round(height*.035));
 for(let x=0;x<=w+maxGap;x++){if(x<w&&cols[x]>0){if(start<0)start=x;gap=0}else if(start>=0&&++gap>maxGap){runs.push({left:start,right:x-gap});start=-1}}
 // Tight, leaning digits can overlap in the column projection. Keep their
 // separate connected shapes instead of merging "20" or "10" into one digit.
 const tall=components.filter(c=>c.b-c.t+1>=height*.72&&c.points.some(n=>ink[n]));
 const total=cols.reduce((a,v)=>a+v,0),covered=tall.reduce((a,c)=>a+c.points.filter(n=>ink[n]).length,0);
 if(tall.length&&tall.length<=4&&covered>=total*.98)runs=tall.sort((a,b)=>a.l-b.l).map(c=>({left:c.l,right:c.r,points:new Set(c.points.filter(n=>ink[n]))}));
 else{
  // LED bars can be separate islands. Estimate their common lean before
  // grouping columns, so the bottom of one digit cannot overlap the next.
  const slopes=[];
  for(const c of components){const dh=c.b-c.t+1,dw=c.r-c.l+1;if(dh<height*.2||dw/dh>(false?.85:.55))continue;const points=c.points.filter(n=>ink[n]);if(points.length<height*.3)continue;let sx=0,sy=0;for(const n of points){sx+=n%w;sy+=Math.floor(n/w)}const mx=sx/points.length,my=sy/points.length;let cov=0,variance=0;for(const n of points){const dy=Math.floor(n/w)-my;cov+=dy*(n%w-mx);variance+=dy*dy}const slope=cov/Math.max(1,variance);if(Math.abs(slope)<.4)slopes.push(slope)}
  if(slopes.length>=2){slopes.sort((a,b)=>a-b);const lean=slopes[Math.floor(slopes.length/2)],margin=Math.ceil(Math.abs(lean)*height)+3,projection=new Array(w+margin*2).fill(0),points=[];
   for(let y=top;y<=bottom;y++)for(let x=0;x<w;x++)if(ink[y*w+x]){const column=Math.round(x-lean*(y-top)+margin);projection[column]++;points.push({n:y*w+x,column})}
   // Clear tiny valleys and their antialias fringe together. This keeps
   // a real two-pixel digit gap from shrinking into a one-pixel bridge.
   if(false){
    const peak=Math.max(...projection);let a=0;
    while(a<projection.length){if(projection[a]>peak*.32){a++;continue}let b=a,min=Infinity;
     while(b<projection.length&&projection[b]<=peak*.32){min=Math.min(min,projection[b]);b++}
     if(b-a<=Math.max(2,height*.08)&&min<=peak*.04)for(let i=a;i<b;i++)projection[i]=0;
     a=b;
    }
   }
   const groups=[];let start=-1,gap=0;for(let x=0;x<=projection.length+maxGap;x++){if(x<projection.length&&projection[x]){if(start<0)start=x;gap=0}else if(start>=0&&++gap>maxGap){groups.push([start,x-gap]);start=-1}}
   runs=groups.map(([a,b])=>{const ns=points.filter(p=>p.column>=a&&p.column<=b).map(p=>p.n);let left=w,right=0;for(const n of ns){left=Math.min(left,n%w);right=Math.max(right,n%w)}return {left,right,points:new Set(ns)}});
  }
 }
 const patterns=['1111110','0110000','1101101','1111001','0110011','1011011','1011111','1110000','1111111','1111011'];
 // Order: top, upper right, lower right, bottom, lower left, upper left, middle.
 const regions=[[.22,0,.78,.17],[.7,.16,1,.43],[.7,.57,1,.86],[.22,.84,.78,1],[0,.57,.3,.86],[0,.16,.3,.43],[.22,.42,.78,.59]];
 let text='',confidence=100,digits=0,colons=0;
 for(const run of runs){if(decimalX!==null&&run.left>decimalX)break;const pixel=(x,y)=>run.points?run.points.has(y*w+x):ink[y*w+x];if(colonX!==null&&run.left>colonX&&!colons){text+=':';colons++}let yt=h,yb=-1,area=0;for(let y=top;y<=bottom;y++)for(let x=run.left;x<=run.right;x++)if(pixel(x,y)){yt=Math.min(yt,y);yb=Math.max(yb,y);area++}
  const dh=yb-yt+1,dw=run.right-run.left+1;if(area<height*.04)continue;
  if(dh<height*.72){if(false&&dh>height*.18&&dw<height*.3){text+=':';colons++;continue}return null}
  if(dw/dh<.24){text+='1';digits++;confidence=Math.min(confidence,92);continue}
  if(dw/dh>1.05)return null;
  let match=null;const glyphX=[],glyphY=[],rows=regions.map(()=>[]);
  for(let y=yt;y<=yb;y++)for(let x=run.left;x<=run.right;x++)if(pixel(x,y)){
   const n=glyphX.length;glyphX.push(x);glyphY.push(y-yt);
   for(let j=0;j<regions.length;j++)if(y>=yt+regions[j][1]*dh&&y<yt+regions[j][3]*dh)rows[j].push(n);
  }
  const transformed=new Float64Array(glyphX.length);
  // Test modest lean angles; seven-segment fonts and camera perspective can
  // shift the lower bars sideways without changing the digit.
  for(let shear=-.32;shear<=.161;shear+=.04){let left=w,right=-w;
   for(let n=0;n<glyphX.length;n++){const xx=glyphX[n]-shear*glyphY[n];transformed[n]=xx;left=Math.min(left,xx);right=Math.max(right,xx)}
   const width=right-left+1;
   if(width/dh<.24){const upper=glyphY.some(y=>y<dh*.35),lower=glyphY.some(y=>y>dh*.65);if(upper&&lower)match={digit:1,quality:1,certainty:.9};continue}
   const coverage=regions.map(([x0,y0,x1,y1],j)=>{let on=0;const lo=left+x0*width,hi=left+x1*width;for(const n of rows[j])if(transformed[n]>=lo&&transformed[n]<hi)on++;return Math.min(1,on/Math.max(1,(x1-x0)*width*(y1-y0)*dh))});
   const peak=Math.max(...coverage);if(peak<.2)continue;const bits=coverage.map(v=>v>Math.max(.14,peak*.37)?'1':'0').join('');
   let digit=patterns.indexOf(bits);if(bits==='1011110')digit=6;if(bits==='1110010')digit=7;if(bits==='1110011')digit=9;if(digit<0)continue;
   const certainty=Math.min(...coverage.map((v,i)=>bits[i]==='1'?Math.min(1,v/(peak*.65)):Math.min(1,1-v/(peak*.37))));
   const on=coverage.filter((v,i)=>bits[i]==='1'),off=coverage.filter((v,i)=>bits[i]==='0');
   const quality=on.reduce((a,v)=>a+v,0)/on.length/peak-(off.reduce((a,v)=>a+v,0)/Math.max(1,off.length)/peak)*.8-.04*Math.abs(shear);
   if(!match||quality>match.quality)match={digit,quality,certainty};
  }
  if(!match)return null;
  confidence=Math.min(confidence,80+Math.max(0,match.certainty)*18);text+=match.digit;digits++;
 }
 if(false?(colons===1?(digits<3||digits>4):(colons!==0||digits<1||digits>2)):(colons||digits<1||digits>3))return null;
 const value=parseReading(key,text);return value===null?null:{value,text,confidence,method:decimalX!==null?'Seven-segment · whole seconds':'Seven-segment'};
}

// A three-frame median suppresses compression noise and single-frame LED
// flicker without blending old and new digit bars into a different number.
function medianCrop(images){const c=images[1],x=c.getContext('2d'),data=images.map(im=>im.getContext('2d').getImageData(0,0,im.width,im.height));for(let i=0;i<data[1].data.length;i+=4)for(let channel=0;channel<3;channel++){const n=i+channel,a=data[0].data[n],b=data[1].data[n],d=data[2].data[n];data[1].data[n]=a+b+d-Math.min(a,b,d)-Math.max(a,b,d)}x.putImageData(data[1],0,0);return c}
// Separate clock and score workers keep expensive score recognition from
// blocking clock samples or browser painting. Unsupported browsers use the
// same decoder locally.
const decoderWorkers=new Map();let decoderRequest=0;
async function decodeSegments(image,key){
 if(typeof Worker==='undefined')return readSevenSegment(image,key);
 const lane=false?'clock':'scores';let entry=decoderWorkers.get(lane);
 if(!entry){
  try{
   const code=[parseReading,segmentPixels,readSevenSegmentPass,readSeparatedDigits,readSevenSegment].map(fn=>fn.toString()).join('\n')+`\nonmessage=event=>{const {id,key,width,height,pixels}=event.data;try{const image={width,height,getContext:()=>({getImageData:()=>({data:pixels})})};postMessage({id,reading:readSevenSegment(image,key)})}catch(e){postMessage({id,error:e.message})}}`;
   const url=URL.createObjectURL(new Blob([code],{type:'text/javascript'})),worker=new Worker(url);URL.revokeObjectURL(url);
   entry={worker,pending:new Map()};worker.onmessage=event=>{const pending=entry.pending.get(event.data.id);if(!pending)return;entry.pending.delete(event.data.id);event.data.error?pending.reject(Error(event.data.error)):pending.resolve(event.data.reading)};
   worker.onerror=()=>{for(const pending of entry.pending.values())pending.reject(Error('Digit reader worker failed. Reload the camera reader.'));entry.pending.clear();worker.terminate();decoderWorkers.delete(lane)};
   decoderWorkers.set(lane,entry);
  }catch(e){return readSevenSegment(image,key)}
 }
 const pixels=image.getContext('2d').getImageData(0,0,image.width,image.height).data,id=++decoderRequest;
 return new Promise((resolve,reject)=>{entry.pending.set(id,{resolve,reject});entry.worker.postMessage({id,key,width:image.width,height:image.height,pixels},[pixels.buffer])});
}
async function scan(onField,fields=activeKeys()){
 const token=generation;
 if(!ready())throw Error('Connect a camera and mark all four volleyball areas first.');
 const w=config.reader==='text'?await engine():null,frames=[];
 const order=[...fields].sort((a,b)=>(b==='seconds')-(a==='seconds'));
 // Capture only the marked rectangles. Repeated full-HD canvases produced
 // large temporary allocations that can cause periodic collection stalls.
 for(let i=0;i<(config.reader==='segments'?3:1);i++){
  if(i)await new Promise(resolve=>setTimeout(resolve,50));
  if(!ready())throw Error('Camera disconnected.');
  const images={};for(const key of order)images[key]=crop(video,config.regions[key]);
  frames.push({images,time:Date.now()});
 }
 const sampledAt=frames[Math.floor(frames.length/2)].time;
 const result={};for(const key of order){
  const crops=frames.map(frame=>frame.images[key]),image=crops.length===3?medianCrop(crops):crops[0];
  const preview=byId(key+'Crop');preview.src=image.toDataURL('image/png');preview.hidden=false;let reading;
  if(config.reader==='segments')reading=await decodeSegments(image,key);
  else{const {data}=await w.recognize(image);reading={value:parseReading(key,data.text),text:data.text.trim(),confidence:Number(data.confidence)||0,method:'Text OCR'}}
  const confidence=reading?.confidence||0;result[key]={sampledAt,value:reading&&confidence>=config.confidence?reading.value:null,text:reading?.text||'',confidence};
  const accepted=confirmed[key],observed=result[key].value;
  if(observed!==null)byId(key+'Value').textContent=format(key,observed);
  else if(accepted)byId(key+'Value').textContent=format(key,accepted.value);
  byId(key+'Note').textContent=observed===null?(accepted?'Holding confirmed '+format(key,accepted.value)+' · last confirmed '+Math.floor((Date.now()-accepted.time)/1000)+'s ago':'Checking digit bars — waiting for a clear sample'):reading.method+' · '+Math.round(confidence)+'% confidence'+(running?' · confirming for overlay':'');
  if(onField&&token===generation&&running)onField(key,result[key]);
  // Let the overlay receive the clock write before processing other fields.
  if(onField)await new Promise(resolve=>setTimeout(resolve,0));
 }return result;
}
function stable(key,value,time){
 const previous=candidates[key];
 // An unclear sample should not erase good recent evidence.
 if(value===null){if(previous&&time-previous.time>10000)delete candidates[key];return false}
 if(false){
  const accepted=confirmed[key],elapsed=previous?(time-previous.time)/1000:0;
  const same=previous&&previous.value===value;
  const observedAt=same?previous.observedAt??previous.time:time;
  const count=same?previous.count+1:1;
  if(accepted){
   const age=(time-(accepted.changedAt??accepted.time))/1000,drop=accepted.value-value;
   // Duplicate samples do not reset this budget. Allow one real second per
   // second, with a small allowance for camera jitter; never replay a backlog.
   const budget=Math.min(Math.max(0,Math.floor(age+.35)),Math.max(0,Math.ceil((time-accepted.time)/1000)));
   if(drop===0||(drop>0&&drop<=budget)){
    candidates[key]={value,time,observedAt,count:Math.max(2,count)};return true;
   }
   candidates[key]={value,time,observedAt,count};
   // A deliberate clock correction/reset requires a steady reading, rather
   // than accepting a quick run of values that would speed up the countdown.
   if(drop>0&&accepted.value<=60)return false;
   return count>=3&&time-observedAt>=(drop<0?400:800);
  }
  const consistent=previous&&elapsed<=10&&value<=previous.value&&previous.value-value<=Math.ceil(elapsed)+1;
  candidates[key]={value,time,observedAt,count:consistent?previous.count+1:1};
  return candidates[key].count>=2;
 }
 const history=(previous?.history||[]).filter(r=>time-r.time<=10000);history.push({value,time});while(history.length>5)history.shift();let count=0;for(let i=history.length-1;i>=0&&history[i].value===value;i--)count++;
 candidates[key]={value,time,count,history};return count>=2;
}
function readState(){try{return {homeScore:0,awayScore:0,homeSets:0,awaySets:0,...JSON.parse(localStorage.getItem('htv-volleyball-score')||'{}')}}catch(e){return {homeScore:0,awayScore:0,homeSets:0,awaySets:0}}}
function apply(result,automatic){
 const state=readState(),time=Date.now();
 
 let changed=false;
 for(const key of activeKeys()){
  const reading=result[key],value=reading?.value??null;if(value===null)continue;
  const sampleTime=reading.sampledAt??time;
  // A completed old frame must never masquerade as the current clock.
  if(automatic&&false&&(time-sampleTime>700||sampleTime<(confirmed[key]?.time??0)))continue;
  if(automatic&&!stable(key,value,sampleTime))continue;
  const prior=confirmed[key],transition=!prior||prior.value!==value;
  const changedAt=transition?(automatic?candidates[key]?.observedAt??sampleTime:sampleTime):prior.changedAt??prior.time;
  confirmed[key]={value,time:sampleTime,changedAt};
  if(state[key]!==value){state[key]=value;changed=true}
  if(false&&state.running){state.running=false;changed=true}
 }
 // Unchanged samples need no storage write or overlay redraw.
 if(changed){state.stamp=time;localStorage.setItem('htv-volleyball-score',JSON.stringify(state));status('Updated overlay at '+new Date().toLocaleTimeString())}
 for(const key of activeKeys())if(confirmed[key]&&result[key]?.value!=null&&confirmed[key].value===result[key].value)byId(key+'Note').textContent='Confirmed on overlay · '+format(key,confirmed[key].value);
 return changed;
}
async function test(){if(busy)return;busy=true;buttons();const token=generation;try{const result=await scan();if(token!==generation)return;lastTest=result;verified=activeKeys().some(k=>result[k].value!==null);const complete=activeKeys().every(k=>result[k].value!==null);status(verified?(complete?'Check these numbers against the gym scoreboard. If correct, start automatic updates.':'Clear fields are ready. Start automatic updates to update those fields while retrying the others.'):'No clear fields yet. Check the crop previews and test again.')}catch(e){verified=false;status(e.message)}finally{busy=false;buttons()}}
async function start(){
 if(!verified||!ready()||busy)return;
 running=true;candidates={};const seedTime=Date.now();
 for(const key of activeKeys())if(lastTest?.[key]?.value!=null)stable(key,lastTest[key].value,seedTime);
 const token=++generation;busy=true;buttons();status('Automatic updates on. Confirming readings…');
 const consume=(key,reading)=>{if(running&&token===generation)apply({[key]:reading},true)};
 async function loop(fields){while(running&&token===generation){
  await scan(consume,fields);if(!running||token!==generation)break;
  await new Promise(resolve=>setTimeout(resolve,40));
 }}
 try{
  const fields=activeKeys();
  // Text OCR shares one engine. The default segment reader has independent
  // clock sampling, so scores and quarter can never hold up its next frame.
  if(config.reader==='segments'&&fields.includes('seconds'))await Promise.all([loop(['seconds']),loop(fields.filter(k=>k!=='seconds'))]);
  else await loop(fields.sort((a,b)=>(b==='seconds')-(a==='seconds')));
 }catch(e){if(token===generation)pause('Updates paused: '+e.message)}
 finally{busy=false;buttons()}
}
byId('connect').onclick=connect;byId('disconnect').onclick=()=>disconnect();byId('test').onclick=test;byId('start').onclick=start;byId('pause').onclick=()=>pause();byId('apply').onclick=()=>{if(lastTest&&!running)apply(lastTest,false)};
byId('clear').onclick=()=>{invalidate();config.regions={};store();renderBoxes();buttons()};
for(const key of ['reader','polarity','confidence']){const input=byId(key);if(!input)continue;if(key==='clockEnabled'||key==='quarterEnabled')input.checked=config[key];else input.value=config[key];input.onchange=()=>{invalidate();config[key]=key==='confidence'?Number(input.value):input.value;store();buttons()}}
byId('device').onchange=()=>{config.regions={};invalidate();if(stream)disconnect('Camera changed. Click Start camera and mark the new picture.');store()};
window.addEventListener('beforeunload',()=>{running=false;if(stream)stream.getTracks().forEach(t=>t.stop());if(worker)worker.terminate();for(const entry of decoderWorkers.values())entry.worker.terminate()});
const versionLabel=byId('readerVersion');if(versionLabel)versionLabel.textContent='Volleyball Reader v8.4 · independent digit separation';
buttons();






