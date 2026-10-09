(function(){
'use strict';
const KEY='htv-volleyball-score',ROOM_KEY='htv-volleyball-score-room';
const p=new URLSearchParams(location.search),role=window.HTV_SCORE_ROLE||'overlay';
const room=(p.get('room')||localStorage.getItem(ROOM_KEY)||'').trim().replace(/[^a-zA-Z0-9_-]/g,'').slice(0,80);
if(!room||!window.ScoreboardWire)return;
localStorage.setItem(ROOM_KEY,room);
let applying=false,lastConfig='',lastScores='',lastDisplay='';
const status=t=>{const el=document.getElementById('syncStatus');if(el)el.textContent='LIVE SYNC: '+t};
function read(){try{return JSON.parse(localStorage.getItem(KEY)||'{}')||{}}catch{return {}}}
function writePatch(patch){const s={...read(),...patch};applying=true;localStorage.setItem(KEY,JSON.stringify(s));window.dispatchEvent(new StorageEvent('storage',{key:KEY,newValue:JSON.stringify(s),storageArea:localStorage}));setTimeout(()=>{applying=false},0)}
function configOf(s){const o={...s};delete o.homeScore;delete o.awayScore;delete o.homeSets;delete o.awaySets;delete o.overlayVisible;return o}
function scoresOf(s){return {homeScore:Number(s.homeScore)||0,awayScore:Number(s.awayScore)||0,homeSets:Number(s.homeSets)||0,awaySets:Number(s.awaySets)||0}}
function displayOf(s){return {overlayVisible:s.overlayVisible!==false}}
function publishNow(){
 if(!window.ScoreboardWire.connected)return;
 const s=read();
 if(role==='controller'){
  const cfg=configOf(s),sc=scoresOf(s),di=displayOf(s);
  window.ScoreboardWire.publish('config',cfg);
  window.ScoreboardWire.publish('scores',sc);
  window.ScoreboardWire.publish('display',di);
 }else if(role==='camera'){
  window.ScoreboardWire.publish('scores',scoresOf(s));
 }
}
window.ScoreboardWire.start({
 room,
 role,
 status,
 ready(){status('connected · room '+room);setTimeout(publishNow,350)},
 config(value){if(role==='camera'||!value||typeof value!=='object')return;writePatch(value)},
 scores(value){if(!value||typeof value!=='object')return;writePatch(scoresOf(value))},
 display(value){if(role==='camera'||!value||typeof value!=='object')return;writePatch({overlayVisible:value.overlayVisible!==false})}
});
setInterval(()=>{
 if(applying||!window.ScoreboardWire.connected)return;
 const s=read(),cfg=JSON.stringify(configOf(s)),sc=JSON.stringify(scoresOf(s)),di=JSON.stringify(displayOf(s));
 if(role==='controller'){
  if(cfg!==lastConfig){lastConfig=cfg;window.ScoreboardWire.publish('config',JSON.parse(cfg))}
  if(sc!==lastScores){lastScores=sc;window.ScoreboardWire.publish('scores',JSON.parse(sc))}
  if(di!==lastDisplay){lastDisplay=di;window.ScoreboardWire.publish('display',JSON.parse(di))}
 }else if(role==='camera'){
  if(sc!==lastScores){lastScores=sc;window.ScoreboardWire.publish('scores',JSON.parse(sc))}
 }
},180);
})();