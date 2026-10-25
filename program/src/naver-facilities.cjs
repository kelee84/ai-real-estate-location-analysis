'use strict';
// Provider-specific public evidence. Walking distance alone never proves a
// registered coordinate, nearest facility, complete radius or empty category.
const {createHash}=require('node:crypto');
const {todayKst}=require('./core.cjs');
const {placeSource}=require('./naver-nearby.cjs');
const point=p=>typeof p?.lat==='number'&&typeof p?.lng==='number'&&Number.isFinite(p.lat)&&Number.isFinite(p.lng)&&p.lat>=25&&p.lat<=45&&p.lng>=120&&p.lng<=135;
const key=v=>String(v||'').normalize('NFKC').replace(/\s+/g,'').trim();
const sameDay=(v,asOf)=>Number.isFinite(Date.parse(v))&&Date.parse(v)<=Date.now()&&todayKst(new Date(v))===asOf;
function distance(a,b){const r=n=>n*Math.PI/180,x=Math.sin(r(b.lat-a.lat)/2)**2+Math.cos(r(a.lat))*Math.cos(r(b.lat))*Math.sin(r(b.lng-a.lng)/2)**2;return 6371008.8*2*Math.atan2(Math.sqrt(x),Math.sqrt(Math.max(0,1-x)));}
const sourceId=id=>'naver-facility-'+createHash('sha256').update(String(id)).digest('hex').slice(0,16);
function validPlace(p,{center,asOf,identity}={}){
 if(p?.provider!=='naver-public-map'||!identity?.code||!point(identity)||!point(center)||distance(identity,center)>2||!point(p)||!sameDay(p.checkedAt,asOf)||!p.name||!p.address||!p.classification||/폐업|폐원|휴업|예정/.test(p.name+' '+p.classification))return false;
 const id=String(p.naverPlaceId||''),proof=p.coordinateProof;
 if(!/^\d{1,20}$/.test(id)||p.id!=='naver-'+id||p.sourceId!==sourceId(id)||placeSource(p.url)?.placeId!==id||p.coordinateBasis!=='registered-place'||p.origin?.identityCode!==String(identity.code)||!point(p.origin)||distance(p.origin,center)>2||!Number.isFinite(p.distanceM)||Math.abs(distance(center,p)-p.distanceM)>2)return false;
 if(proof?.method!=='visible-place-coordinate'||String(proof.placeId)!==id||placeSource(proof.sourceUrl)?.placeId!==id||key(proof.name)!==key(p.name)||key(proof.address)!==key(p.address)||!sameDay(proof.checkedAt,asOf))return false;
 const raw=String(proof.text||''),lat=raw.match(/(?:위도|latitude)\s*[:：]?\s*(-?\d+(?:\.\d+)?)/i),lng=raw.match(/(?:경도|longitude)\s*[:：]?\s*(-?\d+(?:\.\d+)?)/i);
 if(!lat||!lng||!point({lat:Number(lat[1]),lng:Number(lng[1])})||distance(p,{lat:Number(lat[1]),lng:Number(lng[1])})>2)return false;
 const fact={name:p.name,address:p.address,placeId:id,sourceUrl:p.url,checkedAt:p.checkedAt};
 return require('./naver-walking.cjs').validWalking(p.walking,{input:{asset:'apartment',asOf},identity,fact});
}
function fromFacts(input,prices,facts=[]){
 const identity=prices?.buildingResolution,center=identity;if(!point(center))return [];
 return facts.map(f=>{const d=f.walking?.destination,id=String(f.placeId||'');if(!point(d))return null;const p={provider:'naver-public-map',id:'naver-'+id,naverPlaceId:id,name:f.name,address:f.address,classification:f.classification,...{lat:d.lat,lng:d.lng},distanceM:Math.round(distance(center,d)),distanceBasis:'공식 단지 기준점과 네이버 등록 시설 좌표의 직선거리',coordinateBasis:'registered-place',coordinateProof:f.coordinateProof,url:f.sourceUrl,sourceId:sourceId(id),checkedAt:f.checkedAt,origin:{identityCode:String(identity.code),lat:center.lat,lng:center.lng},walking:f.walking,complete:false,nearestProven:false,emptyProven:false};return validPlace(p,{center,asOf:input.asOf,identity})?p:null;}).filter(Boolean);
}
function seedNames(facts=[],asOf=todayKst()){
 return [...new Set(facts.filter(f=>f.category==='nature'&&sameDay(f.checkedAt,asOf)&&/숲길|자락길|둘레길|산책로|등산로|탐방로/.test(f.name||'')&&!/폐쇄|금지|공사|예정/.test(f.name||'')).map(f=>String(f.name).trim()))].slice(0,4);
}
function purposeFacts(facts=[]){
 const count={shopping:0,medical:0,nature:0},limits={shopping:3,medical:1,nature:1},seen=new Set();
 return facts.filter(f=>{const source=placeSource(f.sourceUrl),id=String(f.placeId||'');if(!source||source.placeId!==id||seen.has(id)||!f.name||!f.address||/폐업|폐원|휴업|예정/.test(f.name+' '+f.classification)||!Object.hasOwn(limits,f.category)||count[f.category]>=limits[f.category])return false;seen.add(id);count[f.category]++;return true;});
}
module.exports={validPlace,fromFacts,sourceId,seedNames,purposeFacts};
