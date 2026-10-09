(function(){
'use strict';
const KEY='htv-volleyball-score',ROOM_KEY='htv-volleyball-score-room',BACKUP='htv-volleyball-branded-backup';
const p=new URLSearchParams(location.search),role=window.HTV_SCORE_ROLE||'overlay';
const room=(p.get('room')||localStorage.getItem(ROOM_KEY)||'').trim().replace(/[^a-zA-Z0-9_-]/g,'').slice(0,80);
if(!room||!window.ScoreboardWire)return;
localStorage.setItem(ROOM_KEY,room);
let applying=false,lastConfig='',lastScores='',lastDisplay='';
const status=t=>{const el=document.getElementById('syncStatus');if(el)el.textContent='LIVE SYNC: '+t};
function read(){try{return JSON.parse(localStorage.getItem(KEY)||'{}')||{}}catch{return {}}}
function customStyle(s){return (s.home&&s.home.logo)||(s.away&&s.away.logo)||(s.homeName&&s.homeName!=='MUSTANGS')||(s.awayName&&s.awayName!=='PATRIOTS')}
function saveBrandBackup(s){try{if(customStyle(s))localStorage.setItem(BACKUP,JSON.stringify(s))}catch(e){}}
function writePatch(patch){
 const before=read(),s={...before,...patch};
 // Keep a copy of custom branding before a remote message can replace it.
 if('home' in patch||'away' in patch||'homeName' in patch||'awayName' in patch)saveBrandBackup(before);
 applying=true;localStorage.setItem(KEY,JSON.stringify(s));
 lastConfig=JSON.stringify(configOf(s));lastScores=JSON.stringify(scoresOf(s));lastDisplay=JSON.stringify(displayOf(s));
 window.dispatchEvent(new StorageEvent('storage',{key:KEY,newValue:JSON.stringify(s),storageArea:localStorage}));
 setTimeout(()=>{applying=false},0)
}
function configOf(s){const o={...s};delete o.homeScore;delete o.awayScore;delete o.homeSets;delete o.awaySets;delete o.overlayVisible;return o}
function scoresOf(s){return {homeScore:Number(s.homeScore)||0,awayScore:Number(s.awayScore)||0,homeSets:Number(s.homeSets)||0,awaySets:Number(s.awaySets)||0}}
function displayOf(s){return {overlayVisible:s.overlayVisible!==false}}
// Never broadcast saved/default content on opening/reloading a controller,
// overlay, or camera. A newly opened laptop has no authority to wipe team
// logos, colors, or names stored in the live shared room.
function baseline(){const x=read();lastConfig=JSON.stringify(configOf(x));lastScores=JSON.stringify(scoresOf(x));lastDisplay=JSON.stringify(displayOf(x))}
baseline();
window.ScoreboardWire.start({
 room,
 role,
 status,
 ready(){status('connected · room '+room);baseline()},
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