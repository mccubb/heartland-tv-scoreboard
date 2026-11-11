// Heartland TV seven-segment reader, verified against photographed 22 / 0 / 1:39 samples.
// This supplements the original reader; its existing engine remains as fallback.
// Uses five exposure cutoffs and only accepts strong multi-cutoff agreement.
function readSevenSegmentFast(image, key) {
  if (!['homeScore','awayScore','seconds','period'].includes(key)) return null;
  const w=image.width, h=image.height;
  if(w<8||h<12)return null;
  const prepared=segmentPixels(image),gray=prepared.gray;
  const patterns=['1111110','0110000','1101101','1111001','0110011','1011011','1011111','1110000','1111111','1111011'];
  const regions=[[.22,0,.78,.17],[.70,.16,1,.43],[.70,.57,1,.86],[.22,.84,.78,1],[0,.57,.30,.86],[0,.16,.30,.43],[.22,.42,.78,.59]];
  const votes=new Map();
  for (const threshold of [65,80,95,110,125]) {
    const ink=new Uint8Array(w*h),cols=new Uint16Array(w);
    for(let i=0;i<ink.length;i++)if(gray[i]<threshold){ink[i]=1;cols[i%w]++}
    const runs=[];let start=-1,gap=0;
    for(let x=0;x<=w+1;x++){
      if(x<w&&cols[x]>=Math.max(2,Math.floor(h*.035))){
        if(start<0)start=x;gap=0;
      }else if(start>=0&&++gap>1){
        runs.push({left:start,right:x-gap+1});start=-1;
      }
    }
    if(!runs.length||runs.length>7)continue;
    const glyphs=[];let maxH=0,globalTop=h;
    for(const run of runs){
      let top=h,bottom=-1,count=0;
      for(let y=0;y<h;y++)for(let x=run.left;x<run.right;x++)if(ink[y*w+x]){
        top=Math.min(top,y);bottom=Math.max(bottom,y);count++;
      }
      if(count<5||bottom<top)continue;
      const gh=bottom-top+1;
      glyphs.push({left:run.left,right:run.right,top,bottom,gh,count});
      maxH=Math.max(maxH,gh);globalTop=Math.min(globalTop,top);
    }
    if(!glyphs.length||maxH<h*.12)continue;
    let output='',decimal=false,failed=false;
    for(const g of glyphs){
      const dw=g.right-g.left,dh=g.gh;
      if(key==='seconds'&&dh<maxH*.34&&g.top>globalTop+maxH*.52&&dw<maxH*.30){
        // Some clock decimal points are extremely short, but still meaningful.
        decimal=true;break;
      }
      if(dh<maxH*.14)continue;
      if(key==='seconds'&&dh<maxH*.76&&dw<maxH*.43) {
        if(!output.includes(':')){output+=':';continue}
        failed=true;break;
      }
      if(dw/dh<.29&&dh>maxH*.70){output+='1';continue}
      if(dh<maxH*.55||dw/dh>1.08){failed=true;break}
      const coverage=[];
      for(const [x0,y0,x1,y1] of regions){
        const xa=g.left+Math.floor(x0*dw),xb=Math.max(xa+1,g.left+Math.ceil(x1*dw));
        const ya=g.top+Math.floor(y0*dh),yb=Math.max(ya+1,g.top+Math.ceil(y1*dh));
        let on=0;
        for(let y=ya;y<yb;y++)for(let x=xa;x<xb;x++)if(ink[y*w+x])on++;
        coverage.push(on/Math.max(1,(xb-xa)*(yb-ya)));
      }
      const peak=Math.max(...coverage);
      if(peak<.14){failed=true;break}
      const bits=coverage.map(v=>v>Math.max(.10,peak*.38)?'1':'0').join('');
      const digit=patterns.indexOf(bits);
      if(digit<0){failed=true;break}
      output+=String(digit);
    }
    if(failed||!output)continue;
    if(key==='seconds'){
      if(decimal){
        if(!/^\d{1,2}$/.test(output))continue;
      }else if(!/^(?:\d{1,2}:\d{2}|\d{1,2})$/.test(output))continue;
    }else if(!/^\d{1,3}$/.test(output))continue;
    const value=parseReading(key,output);
    if(value===null)continue;
    const id=String(value);
    const found=votes.get(id)||{value,text:output,count:0};
    found.count++;
    votes.set(id,found);
  }
  const ordered=[...votes.values()].sort((a,b)=>b.count-a.count);
  // Four matching thresholds are required before overriding the existing
  // decoder. A low-confidence alternate cannot change the live broadcast.
  if(!ordered.length||ordered[0].count<4|| (ordered[1]&&ordered[1].count>=ordered[0].count))return null;
  const best=ordered[0];
  return {value:best.value,text:best.text,confidence:Math.min(98,90+best.count),method:'Verified seven-segment'};
}
