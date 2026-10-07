'use strict';
const byId=id=>document.getElementById(id),keys=['homeScore','awayScore','seconds'];
let config={regions:{},reader:'segments',polarity:'light',confidence:70,clockEnabled:false,device:''};
try{const c=JSON.parse(localStorage.getItem('htv-camera')||'{}');config={...config,...c,regions:c.regions||{}}}catch(e){}
let stream=null,worker=null,loading=null,busy=false,running=false,generation=0,selected=null,drag=null,lastTest=null,verified=false;
let candidates={};const video=byId('video'),overlay=byId('overlay'),ctx=overlay.getContext('2d');
const palette={homeScore:'#36d0ff',awayScore:'#ffb63b',seconds:'#70ed9a'};
function status(text){byId('status').textContent=text}
function store(){localStorage.setItem('htv-camera',JSON.stringify(config))}
function parseReading(key,text){const clean=String(text).replace(/\s/g,'');if(key!=='seconds'){if(!/^\d{1,3}$/.test(clean))return null;const n=Number(clean);return n<=199?n:null}const m=clean.match(/^(\d{1,2}):(\d{2})$/);return m&&Number(m[2])<60?Number(m[1])*60+Number(m[2]):null}
function format(key,value){return value===null?'—':key==='seconds'?Math.floor(value/60)+':'+String(value%60).padStart(2,'0'):String(value)}
function activeKeys(){return config.clockEnabled?keys:keys.slice(0,2)}
function ready(){return stream&&video.readyState>=2&&activeKeys().every(k=>config.regions[k])}
function buttons(){byId('test').disabled=!ready()||busy||running;byId('start').disabled=!ready()||busy||running||!verified;byId('pause').disabled=!running;byId('apply').disabled=running||busy||!lastTest||!activeKeys().every(k=>lastTest[k]?.value!==null);byId('disconnect').disabled=!stream;byId('connect').disabled=busy||running}
function pause(message='Automatic updates paused.'){running=false;generation++;candidates={};buttons();status(message)}
function invalidate(){pause('Reading areas changed. Test the readings before starting.');verified=false;lastTest=null;buttons()}
function point(event){const b=overlay.getBoundingClientRect();return {x:Math.max(0,Math.min(1,(event.clientX-b.left)/b.width)),y:Math.max(0,Math.min(1,(event.clientY-b.top)/b.height))}}
function renderBoxes(){if(!video.videoWidth)return;overlay.width=video.videoWidth;overlay.height=video.videoHeight;ctx.clearRect(0,0,overlay.width,overlay.height);const regions={...config.regions};if(drag)regions[selected]={x:Math.min(drag.start.x,drag.end.x),y:Math.min(drag.start.y,drag.end.y),w:Math.abs(drag.end.x-drag.start.x),h:Math.abs(drag.end.y-drag.start.y)};for(const [key,r] of Object.entries(regions)){if(!keys.includes(key))continue;ctx.strokeStyle=palette[key];ctx.lineWidth=3;ctx.strokeRect(r.x*overlay.width,r.y*overlay.height,r.w*overlay.width,r.h*overlay.height);ctx.fillStyle=palette[key];ctx.font='bold 18px Arial';ctx.fillText(key==='seconds'?'Clock':key==='homeScore'?'Left score':'Right score',r.x*overlay.width+4,Math.max(20,r.y*overlay.height-6))}}
overlay.addEventListener('pointerdown',event=>{if(!selected||!stream)return;invalidate();overlay.setPointerCapture(event.pointerId);drag={start:point(event),end:point(event)};renderBoxes()});
overlay.addEventListener('pointermove',event=>{if(drag){drag.end=point(event);renderBoxes()}});
overlay.addEventListener('pointerup',event=>{if(!drag)return;drag.end=point(event);const r={x:Math.min(drag.start.x,drag.end.x),y:Math.min(drag.start.y,drag.end.y),w:Math.abs(drag.end.x-drag.start.x),h:Math.abs(drag.end.y-drag.start.y)};if(r.w>.008&&r.h>.008){config.regions[selected]=r;store();status('Area saved. Select the next area or click Test reading.')}drag=null;renderBoxes();buttons()});
overlay.addEventListener('pointercancel',()=>{drag=null;renderBoxes()});
for(const button of document.querySelectorAll('[data-region]'))button.onclick=()=>{selected=button.dataset.region;for(const b of document.querySelectorAll('[data-region]'))b.classList.toggle('active',b===button);status('Drag a box around '+button.textContent.toLowerCase()+'.')};
async function connect(){pause();verified=false;lastTest=null;buttons();try{if(!navigator.mediaDevices?.getUserMedia)throw Error('Camera access is unavailable. Open this page in Chrome using the HTTPS link.');if(stream)stream.getTracks().forEach(t=>t.stop());stream=null;const requested=byId('device').value;stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{...(requested?{deviceId:{exact:requested}}:{}),width:{ideal:1920},height:{ideal:1080}}});video.srcObject=stream;await video.play();const devices=await navigator.mediaDevices.enumerateDevices();byId('device').replaceChildren();for(const d of devices.filter(d=>d.kind==='videoinput')){const o=document.createElement('option');o.value=d.deviceId;o.textContent=d.label||'Camera '+(byId('device').options.length+1);byId('device').appendChild(o)}const actual=stream.getVideoTracks()[0].getSettings().deviceId;byId('device').value=actual||requested;config.device=byId('device').value;store();renderBoxes();status('Camera connected. Mark the two scores, then test.');stream.getVideoTracks()[0].addEventListener('ended',()=>disconnect('Camera disconnected. Updates paused.'))}catch(e){status(e.name==='NotAllowedError'?'Camera permission denied. Allow camera access in your browser and try again.':e.message);stream=null}buttons()}
function disconnect(message='Camera disconnected.'){pause(message);if(stream)stream.getTracks().forEach(t=>t.stop());stream=null;video.srcObject=null;verified=false;lastTest=null;ctx.clearRect(0,0,overlay.width,overlay.height);buttons()}
async function engine(){if(worker)return worker;if(!window.Tesseract)throw Error('The reading engine did not load. Check your internet connection and reload this page.');if(!loading)loading=(async()=>{status('Loading reading engine for first use…');const w=await Tesseract.createWorker('eng',1,{logger:m=>{if(m.status?.includes('loading')||m.status?.includes('initializing'))status('Loading reading engine… '+Math.round((m.progress||0)*100)+'%')}});await w.setParameters({tessedit_char_whitelist:'0123456789:',tessedit_pageseg_mode:Tesseract.PSM.SINGLE_LINE,user_defined_dpi:'150'});worker=w;return w})().catch(e=>{loading=null;throw e});return loading}
function crop(frame,r){const sw=Math.max(1,Math.round(r.w*frame.width)),sh=Math.max(1,Math.round(r.h*frame.height)),scale=Math.min(6,Math.max(2,100/sh)),pad=15;const c=document.createElement('canvas');c.width=Math.round(sw*scale)+pad*2;c.height=Math.round(sh*scale)+pad*2;const x=c.getContext('2d',{willReadFrequently:true});x.fillStyle='white';x.fillRect(0,0,c.width,c.height);x.drawImage(frame,r.x*frame.width,r.y*frame.height,sw,sh,pad,pad,c.width-pad*2,c.height-pad*2);if(config.polarity!=='original'){const image=x.getImageData(pad,pad,c.width-pad*2,c.height-pad*2),p=image.data;let lo=255,hi=0;for(let i=0;i<p.length;i+=4){const v=Math.max(p[i],p[i+1],p[i+2]);lo=Math.min(lo,v);hi=Math.max(hi,v)}for(let i=0;i<p.length;i+=4){let v=255*(Math.max(p[i],p[i+1],p[i+2])-lo)/Math.max(1,hi-lo);if(config.polarity==='light')v=255-v;p[i]=p[i+1]=p[i+2]=v}x.putImageData(image,pad,pad)}return c}
// Read the seven lit bars directly instead of asking a text model to guess a font.
function readSevenSegment(image,key){
 const w=image.width,h=image.height,p=image.getContext('2d').getImageData(0,0,w,h).data;
 const hist=new Array(256).fill(0),gray=new Uint8Array(w*h);
 for(let i=0;i<gray.length;i++){gray[i]=Math.round((p[i*4]+p[i*4+1]+p[i*4+2])/3);hist[gray[i]]++}
 let sum=0;for(let i=0;i<256;i++)sum+=i*hist[i];let count=0,left=0,best=-1,threshold=128;
 for(let i=0;i<255;i++){count+=hist[i];left+=i*hist[i];if(!count||count===gray.length)continue;const delta=left/count-(sum-left)/(gray.length-count),variance=count*(gray.length-count)*delta*delta;if(variance>best){best=variance;threshold=i}}
 // Crops are contrast-normalized. Do not count mid-gray screen shadows as bars.
 threshold=Math.min(threshold,110);
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
 let colonX=null;
 if(key==='seconds'){const dots=components.filter(c=>c.b-c.t+1<height*.24&&c.r-c.l+1<height*.25&&c.points.length>=height*.3);
  for(const a of dots)for(const b of dots)if(a!==b&&Math.abs((a.l+a.r-b.l-b.r)/2)<height*.18&&b.t-a.b>height*.15&&b.t-a.b<height*.65){colonX=(a.l+a.r+b.l+b.r)/4;for(const n of [...a.points,...b.points])ink[n]=0}
 }
 for(const c of components)if(c.points.length<height*height*.012)for(const n of c.points)ink[n]=0;
 cols.fill(0);top=h;bottom=-1;for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(ink[y*w+x]){cols[x]++;top=Math.min(top,y);bottom=Math.max(bottom,y)}height=bottom-top+1;if(height<12)return null;
 const runs=[];let start=-1,gap=0;const maxGap=Math.max(1,Math.round(height*.035));
 for(let x=0;x<=w+maxGap;x++){if(x<w&&cols[x]>0){if(start<0)start=x;gap=0}else if(start>=0&&++gap>maxGap){runs.push({left:start,right:x-gap});start=-1}}
 const patterns=['1111110','0110000','1101101','1111001','0110011','1011011','1011111','1110000','1111111','1111011'];
 // Order: top, upper right, lower right, bottom, lower left, upper left, middle.
 const regions=[[.22,0,.78,.17],[.7,.16,1,.43],[.7,.57,1,.86],[.22,.84,.78,1],[0,.57,.3,.86],[0,.16,.3,.43],[.22,.42,.78,.59]];
 let text='',confidence=100,digits=0,colons=0;
 for(const run of runs){if(colonX!==null&&run.left>colonX&&!colons){text+=':';colons++}let yt=h,yb=-1,area=0;for(let y=top;y<=bottom;y++)for(let x=run.left;x<=run.right;x++)if(ink[y*w+x]){yt=Math.min(yt,y);yb=Math.max(yb,y);area++}
  const dh=yb-yt+1,dw=run.right-run.left+1;if(area<height*.04)continue;
  if(dh<height*.72){if(key==='seconds'&&dh>height*.18&&dw<height*.3){text+=':';colons++;continue}return null}
  if(dw/dh<.24){text+='1';digits++;confidence=Math.min(confidence,92);continue}
  if(dw/dh>1.05)return null;
  let match=null;
  // Test modest lean angles; seven-segment fonts and camera perspective can
  // shift the lower bars sideways without changing the digit.
  for(let shear=-.32;shear<=.161;shear+=.04){let left=w,right=-w;const points=[];
   for(let y=yt;y<=yb;y++)for(let x=run.left;x<=run.right;x++)if(ink[y*w+x]){const xx=x-shear*(y-yt);points.push([xx,y]);left=Math.min(left,xx);right=Math.max(right,xx)}
   const width=right-left+1;
   if(width/dh<.24){const upper=points.some(([,y])=>y<yt+dh*.35),lower=points.some(([,y])=>y>yt+dh*.65);if(upper&&lower)match={digit:1,quality:1,certainty:.9};continue}
   const coverage=regions.map(([x0,y0,x1,y1])=>{let on=0;for(const [x,y] of points)if(x>=left+x0*width&&x<left+x1*width&&y>=yt+y0*dh&&y<yt+y1*dh)on++;return Math.min(1,on/Math.max(1,(x1-x0)*width*(y1-y0)*dh))});
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
 if(key==='seconds'?(colons!==1||digits<3||digits>4):(colons||digits<1||digits>3))return null;
 const value=parseReading(key,text);return value===null?null:{value,text,confidence,method:'Seven-segment'};
}

async function scan(){if(!ready())throw Error('Connect a camera and mark both score areas first.');const w=config.reader==='text'?await engine():null,frame=document.createElement('canvas');frame.width=video.videoWidth;frame.height=video.videoHeight;frame.getContext('2d').drawImage(video,0,0);const result={};for(const key of activeKeys()){const image=crop(frame,config.regions[key]);const preview=byId(key+'Crop');preview.src=image.toDataURL('image/png');preview.hidden=false;let reading;
if(config.reader==='segments')reading=readSevenSegment(image,key);
else{const {data}=await w.recognize(image);reading={value:parseReading(key,data.text),text:data.text.trim(),confidence:Number(data.confidence)||0,method:'Text OCR'}}
const confidence=reading?.confidence||0;result[key]={value:reading&&confidence>=config.confidence?reading.value:null,text:reading?.text||'',confidence};
byId(key+'Value').textContent=format(key,result[key].value);byId(key+'Note').textContent=result[key].value===null?(reading?'Uncertain: '+reading.text+' ('+Math.round(confidence)+'%)':'Seven-segment bars incomplete or unclear — keeping the last confirmed number'):reading.method+' · '+Math.round(confidence)+'% confidence';}return result}
function stable(key,value,time){if(value===null){delete candidates[key];return false}const previous=candidates[key];let consistent=previous&&previous.value===value;if(key==='seconds'&&previous){const elapsed=Math.max(1,Math.ceil((time-previous.time)/1000));consistent=value<=previous.value&&previous.value-value<=elapsed+2}candidates[key]={value,time,count:consistent?(previous.count||1)+1:1};return candidates[key].count>=2}
function readState(){try{return {homeScore:0,awayScore:0,seconds:480,period:1,running:false,...JSON.parse(localStorage.getItem('htv-score')||'{}')}}catch(e){return {homeScore:0,awayScore:0,seconds:480,period:1,running:false}}}
function apply(result,automatic){const state=readState(),time=Date.now();if(state.running)state.seconds=Math.max(0,state.seconds-Math.floor((time-(state.stamp||time))/1000));let changed=false;for(const key of activeKeys()){const value=result[key]?.value??null;if(value===null)continue;if(automatic&&!stable(key,value,time))continue;if(automatic&&key!=='seconds'&&Math.abs(value-state[key])>3){status('A large score change was held. Pause and verify it, then Apply this reading once.');continue}if(state[key]!==value){state[key]=value;changed=true}if(key==='seconds'){state.running=false;state.stamp=time;changed=true}}if(changed){state.stamp=time;localStorage.setItem('htv-score',JSON.stringify(state));byId('status').textContent='Updated overlay at '+new Date().toLocaleTimeString()}return changed}
async function test(){if(busy)return;busy=true;buttons();const token=generation;try{const result=await scan();if(token!==generation)return;lastTest=result;verified=activeKeys().every(k=>result[k].value!==null);status(verified?'Check these numbers against the gym scoreboard. If correct, start automatic updates.':'Some digit bars could not be confirmed. Check the crop previews and reader type, then test again.')}catch(e){verified=false;status(e.message)}finally{busy=false;buttons()}}
async function start(){if(!verified||!ready()||busy)return;running=true;candidates={};const token=++generation;buttons();status('Automatic updates on. Confirming two readings…');while(running&&token===generation){busy=true;try{const result=await scan();if(!running||token!==generation)break;apply(result,true);if(activeKeys().some(k=>result[k].value===null))status('Reading uncertain — keeping the last confirmed numbers.')}catch(e){pause('Updates paused: '+e.message);break}finally{busy=false;buttons()}await new Promise(resolve=>setTimeout(resolve,350))}}
byId('connect').onclick=connect;byId('disconnect').onclick=()=>disconnect();byId('test').onclick=test;byId('start').onclick=start;byId('pause').onclick=()=>pause();byId('apply').onclick=()=>{if(lastTest&&!running)apply(lastTest,false)};
byId('clear').onclick=()=>{invalidate();config.regions={};store();renderBoxes();buttons()};
for(const key of ['reader','polarity','confidence','clockEnabled']){const input=byId(key);if(key==='clockEnabled')input.checked=config[key];else input.value=config[key];input.onchange=()=>{invalidate();config[key]=key==='clockEnabled'?input.checked:key==='confidence'?Number(input.value):input.value;store();buttons()}}
byId('device').onchange=()=>{config.regions={};invalidate();if(stream)disconnect('Camera changed. Click Start camera and mark the new picture.');store()};
window.addEventListener('beforeunload',()=>{running=false;if(stream)stream.getTracks().forEach(t=>t.stop());if(worker)worker.terminate()});
buttons();

