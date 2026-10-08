/* Heartland TV matchup cross-device sync.
   Uses a public demonstration MQTT broker. Only public team/graphic data;
   no passwords, student information, or private records should be sent.
   Same-browser localStorage works independently when offline. */
(function(){
'use strict';
let TOPIC='heartland-tv/demo/volleyball/matchup/v4-7bc871cd2a0e4f44a93650dc198f552b';
const URLS=['wss://broker.emqx.io:8084/mqtt','wss://test.mosquitto.org:8081/mqtt'];
const enc=new TextEncoder(),dec=new TextDecoder();
const byteString=s=>{const b=enc.encode(String(s));return [...[(b.length>>8)&255,b.length&255],...b]};
function remaining(n){const out=[];do{let b=n%128;n=Math.floor(n/128);if(n)b|=128;out.push(b)}while(n);return out}
function packet(type,body){return new Uint8Array([type,...remaining(body.length),...body])}
function connectPacket(id){return packet(0x10,[0,4,77,81,84,84,4,2,0,40,...byteString(id)])}
function subscribePacket(topics){const arr=[0,1];for(const topic of topics)arr.push(...byteString(topic),0);return packet(0x82,arr)}
function publishPacket(topic,data){const msg=enc.encode(JSON.stringify(data)),t=byteString(topic);return packet(0x31,[...t,...msg])}
let socket=null,connected=false,ready=false,reconnectTimer=null,pingTimer=null,serverIndex=0,client=null,closing=false,remoteConfig=false,remoteDisplay=false;
const callbacks={};
function status(s){callbacks.status?.(s)}
function send(bytes){if(socket&&socket.readyState===1)try{socket.send(bytes)}catch(e){}}
function broadcast(type,payload){if(!ready)return false;try{
  const message={value:payload,time:Date.now(),origin:client};
  const bytes=publishPacket(TOPIC+'/'+type,message);
  if(bytes.length>115000){status('Logo too large to send');return false}
  send(bytes);return true
 }catch(e){status('Send error');return false}}
function heartbeat(){if(callbacks.role==='overlay'&&ready)broadcast('presence',{active:true})}
function setup(url){
 status('Connecting to live service…');
 const id='htv-vb-'+Math.random().toString(36).slice(2,11);
 try{socket=new WebSocket(url,'mqtt');socket.binaryType='arraybuffer'}
 catch(e){fail();return}
 const ws=socket;
 ws.onopen=()=>{send(connectPacket(id));};
 ws.onmessage=event=>{
  try{
   const bytes=new Uint8Array(event.data);let ptr=0;
   while(ptr<bytes.length){
    const header=bytes[ptr++];let len=0,factor=1,x;
    do{x=bytes[ptr++];len+=(x&127)*factor;factor*=128}while(x&128&&ptr<bytes.length);
    const end=Math.min(ptr+len,bytes.length),type=header>>4;
    if(type===2){
     if(bytes[ptr+1]!==0){status('Broker refused connection');ws.close();return}
     connected=true;send(subscribePacket(['config','display','presence'].map(t=>TOPIC+'/'+t)));
    }else if(type===9){
     ready=true;status('Connected');
     remoteConfig=false;remoteDisplay=false;
     if(callbacks.role==='overlay')heartbeat();
     if(callbacks.role==='controller'){
      setTimeout(()=>{
       if(!ready||socket!==ws)return;
       if(!remoteConfig&&callbacks.snapshotConfig)broadcast('config',callbacks.snapshotConfig());
       if(!remoteDisplay&&callbacks.snapshotDisplay)broadcast('display',callbacks.snapshotDisplay());
      },2200);
     }
    }else if(type===3){
     const topicLength=(bytes[ptr]<<8)|bytes[ptr+1],topic=dec.decode(bytes.slice(ptr+2,ptr+2+topicLength));
     let start=ptr+2+topicLength;
     const qos=(header>>1)&3;if(qos>0)start+=2;
     const raw=dec.decode(bytes.slice(start,end));
     const msg=JSON.parse(raw);
     if(!msg||!msg.value||msg.origin===client){}else if(topic===TOPIC+'/config'){
      remoteConfig=true;callbacks.config?.(msg.value)
     }else if(topic===TOPIC+'/display'){
      remoteDisplay=true;callbacks.display?.(msg.value)
     }else if(topic===TOPIC+'/presence'){
      callbacks.presence?.(msg.value,msg.time);
     }
    }
    ptr=end;
   }
  }catch(e){status('Live message error')}
 };
 ws.onerror=()=>{status('Live connection unavailable')};
 ws.onclose=()=>{
   if(socket!==ws)return;
   ready=false;connected=false;clearInterval(pingTimer);status('Disconnected — reconnecting…');
   if(!closing){serverIndex=(serverIndex+1)%URLS.length;clearTimeout(reconnectTimer);reconnectTimer=setTimeout(()=>setup(URLS[serverIndex]),2400)}
 };
 clearInterval(pingTimer);
 pingTimer=setInterval(()=>{if(ready){send(new Uint8Array([0xc0,0]));heartbeat()}},18000);
}
function fail(){serverIndex=(serverIndex+1)%URLS.length;clearTimeout(reconnectTimer);reconnectTimer=setTimeout(()=>setup(URLS[serverIndex]),3500)}
window.MatchupWire={
 start(opts){Object.assign(callbacks,opts);if(opts.room&&/^[a-zA-Z0-9_-]{12,80}$/.test(opts.room))TOPIC='heartland-tv/share/volleyball/matchup/'+opts.room;client='htv-'+Math.random().toString(36).slice(2)+'-'+Date.now().toString(36);setup(URLS[0])},
 publish(type,payload){return broadcast(type,payload)},
 get connected(){return ready}
};
window.addEventListener('pagehide',()=>{closing=true;clearInterval(pingTimer);clearTimeout(reconnectTimer);try{socket?.close()}catch(e){}});
})();