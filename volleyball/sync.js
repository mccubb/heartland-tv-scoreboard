'use strict';
(() => {
  const STATE_KEY='htv-volleyball-score';
  const ROOM_KEY='htv-volleyball-sync-room';
  const params=new URLSearchParams(location.search);
  const role=window.HTV_SYNC_ROLE||'client';
  const room=(params.get('room')||localStorage.getItem(ROOM_KEY)||'').trim().replace(/[^a-zA-Z0-9_-]/g,'').slice(0,40);
  if(!room||typeof Peer==='undefined') return;
  localStorage.setItem(ROOM_KEY,room);
  const hostId='heartland-vb-'+room.toLowerCase();
  let peer=null,hostConn=null,lastSeen=localStorage.getItem(STATE_KEY)||'',reconnectTimer=null,sharedState=null;
  const clients=new Set();
  const setStatus=t=>{const el=document.getElementById('syncStatus');if(el)el.textContent=t};
  const validState=s=>s&&typeof s==='object'&&('homeScore'in s||'awayScore'in s||'homeSets'in s||'awaySets'in s);
  function applyRemote(state){
    if(!validState(state))return;
    const json=JSON.stringify(state);
    if(json===localStorage.getItem(STATE_KEY))return;
    lastSeen=json;
    localStorage.setItem(STATE_KEY,json);
    window.dispatchEvent(new StorageEvent('storage',{key:STATE_KEY,newValue:json,storageArea:localStorage}));
  }
  function current(){try{return JSON.parse(localStorage.getItem(STATE_KEY)||'{}')}catch{return {}}}
  function broadcast(state){for(const c of [...clients]){if(c.open){try{c.send({type:'state',state})}catch{}}else clients.delete(c)}}
  function mergeCameraFields(base,next){const out={...(base||{})};for(const k of ['homeScore','awayScore','homeSets','awaySets'])if(k in next)out[k]=next[k];return out}
  function watchLocal(){
    setInterval(()=>{
      const now=localStorage.getItem(STATE_KEY)||'';
      if(now===lastSeen)return;
      lastSeen=now;
      let state;try{state=JSON.parse(now||'{}')}catch{return}
      if(role==='host'){sharedState=mergeCameraFields(sharedState||current(),state);const json=JSON.stringify(sharedState);lastSeen=json;localStorage.setItem(STATE_KEY,json);broadcast(sharedState)}
      else if(hostConn?.open){try{hostConn.send({type:'state',state})}catch{}}
    },180);
  }
  function setupHost(){
    sharedState=current();peer=new Peer(hostId);
    peer.on('open',()=>setStatus('LIVE SYNC: camera computer is hosting room '+room));
    peer.on('connection',conn=>{
      clients.add(conn);
      conn.on('open',()=>{try{conn.send({type:'state',state:sharedState||current()})}catch{}});
      conn.on('data',msg=>{if(msg?.type==='state'&&validState(msg.state)){sharedState=msg.state;applyRemote(sharedState);broadcast(sharedState)}else if(msg?.type==='request'){try{conn.send({type:'state',state:sharedState||current()})}catch{}}});
      conn.on('close',()=>clients.delete(conn));
    });
    peer.on('error',e=>setStatus('LIVE SYNC error: '+(e.type||e.message)));
  }
  function connectClient(){
    clearTimeout(reconnectTimer);
    if(!peer||peer.destroyed){peer=new Peer();peer.on('open',connectClient);peer.on('error',()=>{reconnectTimer=setTimeout(connectClient,2000)});return}
    if(!peer.open)return;
    if(hostConn?.open)return;
    setStatus('LIVE SYNC: connecting to camera computer…');
    const conn=peer.connect(hostId,{reliable:true});
    hostConn=conn;
    conn.on('open',()=>{setStatus('LIVE SYNC connected · room '+room);try{conn.send({type:'request'})}catch{}});
    conn.on('data',msg=>{if(msg?.type==='state')applyRemote(msg.state)});
    const retry=()=>{if(hostConn===conn)hostConn=null;reconnectTimer=setTimeout(connectClient,1500)};
    conn.on('close',retry);conn.on('error',retry);
  }
  if(role==='host')setupHost();else connectClient();
  watchLocal();
})();