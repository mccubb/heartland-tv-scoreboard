/* Heartland TV volleyball scoreboard cross-device sync.
   Mirrors the proven matchup overlay transport: retained MQTT messages over WSS. */
(function(){
'use strict';
let TOPIC='heartland-tv/demo/volleyball/scoreboard/v1';
const URLS=['wss://broker.emqx.io:8084/mqtt','wss://test.mosquitto.org:8081/mqtt'];
const enc=new TextEncoder(),dec=new TextDecoder();
const byteString=s=>{const b=enc.encode(String(s));return [...[(b.length>>8)&255,b.length&255],...b]};
function remaining(n){const out=[];do{let b=n%128;n=Math.floor(n/128);if(n)b|=128;out.push(b)}while(n);return out}
function packet(type,body){return new Uint8Array([type,...remaining(body.length),...body])}
function connectPacket(id){return packet(0x10,[0,4,77,81,84,84,4,2,0,40,...byteString(id)])}
function subscribePacket(topics){const arr=[0,1];for(const topic of topics)arr.push(...byteString(topic),0);return packet(0x82,arr)}
function publishPacket(topic,data){const msg=enc.encode(JSON.stringify(data)),t=byteString(topic);return packet(0x31,[...t,...msg])}
let socket=null,ready=false,reconnectTimer=null,pingTimer=null,serverIndex=0,client=null,closing=false;
const callbacks={};
function status(s){callbacks.status?.(s)}
function send(bytes){if(socket&&socket.readyState===1)try{socket.send(bytes)}catch(e){}}
function broadcast(type,payload){if(!ready)return false;try{
 const message={value:payload,time:Date.now(),origin:client};
 const bytes=publishPacket(TOPIC+'/'+type,message);
 if(bytes.length>115000){status('Logo too large to send');return false}
 send(bytes);return true
}catch(e){status('Send error');return false}}
function setup(url){
 status('Connecting…');
 const id='htv-vb-score-'+Math.random().toString(36).slice(2,11);
 try{socket=new WebSocket(url,'mqtt');socket.binaryType='arraybuffer'}catch(e){fail();return}
 const ws=socket;
 ws.onopen=()=>send(connectPacket(id));
 ws.onmessage=event=>{
  try{
   const bytes=new Uint8Array(event.data);let ptr=0;
   while(ptr<bytes.length){
    const header=bytes[ptr++];let len=0,factor=1,x;
    do{x=bytes[ptr++];len+=(x&127)*factor;factor*=128}while(x&128&&ptr<bytes.length);
    const end=Math.min(ptr+len,bytes.length),type=header>>4;
    if(type===2){
      if(bytes[ptr+1]!==0){status('Broker refused connection');ws.close();return}
      send(subscribePacket(['config','scores','display'].map(t=>TOPIC+'/'+t)));
    }else if(type===9){
      ready=true;status('Connected');
      callbacks.ready?.();
    }else if(type===3){
      const topicLength=(bytes[ptr]<<8)|bytes[ptr+1],topic=dec.decode(bytes.slice(ptr+2,ptr+2+topicLength));
      let start=ptr+2+topicLength;const qos=(header>>1)&3;if(qos>0)start+=2;
      const msg=JSON.parse(dec.decode(bytes.slice(start,end)));
      if(msg&&msg.value&&msg.origin!==client){
       if(topic===TOPIC+'/config')callbacks.config?.(msg.value,msg.time);
       else if(topic===TOPIC+'/scores')callbacks.scores?.(msg.value,msg.time);
       else if(topic===TOPIC+'/display')callbacks.display?.(msg.value,msg.time);
      }
    }
    ptr=end;
   }
  }catch(e){status('Live message error')}
 };
 ws.onerror=()=>status('Live connection unavailable');
 ws.onclose=()=>{if(socket!==ws)return;ready=false;clearInterval(pingTimer);status('Disconnected — reconnecting…');if(!closing){serverIndex=(serverIndex+1)%URLS.length;clearTimeout(reconnectTimer);reconnectTimer=setTimeout(()=>setup(URLS[serverIndex]),2400)}};
 clearInterval(pingTimer);pingTimer=setInterval(()=>{if(ready)send(new Uint8Array([0xc0,0]))},18000);
}
function fail(){serverIndex=(serverIndex+1)%URLS.length;clearTimeout(reconnectTimer);reconnectTimer=setTimeout(()=>setup(URLS[serverIndex]),3500)}
window.ScoreboardWire={
 start(opts){Object.assign(callbacks,opts);if(opts.room&&/^[a-zA-Z0-9_-]{8,80}$/.test(opts.room))TOPIC='heartland-tv/share/volleyball/scoreboard/'+opts.room;client='htv-score-'+Math.random().toString(36).slice(2)+'-'+Date.now().toString(36);setup(URLS[0])},
 publish(type,payload){return broadcast(type,payload)},
 get connected(){return ready}
};
window.addEventListener('pagehide',()=>{closing=true;clearInterval(pingTimer);clearTimeout(reconnectTimer);try{socket?.close()}catch(e){}});
})();