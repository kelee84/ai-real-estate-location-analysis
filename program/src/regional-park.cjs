'use strict';
const {createHash}=require('node:crypto');
const {todayKst,validDate,normalize}=require('./core.cjs');
const {boundedJson,boundedBytes}=require('./school-zone.cjs');
const HOME='https://www.data.go.kr',SOURCE=HOME+'/data/15012890/standard.do';
const MIN_AREA=100000,RADIUS=5000,SIMILAR_RATIO=.5,VERSION='2026-10-17-comparable-park-v3';
const CRITERIA='반경 5km의 공식 면적 10만㎡ 이상 공원에서 같은 읍면동·시군구, 대표 명칭, 면적 순으로 기준 랜드마크를 정합니다. 기준 공원의 공식 면적 50% 이상(최소 10만㎡)인 공원 중 가장 가까운 공원을 같은 거리 배점으로 평가합니다. 면적이 충돌하는 자료는 제외하며 크기 보너스를 임의로 더하지 않습니다. 앱의 선정 기준이며 공인 등급이 아닙니다.';
let cache;
function coord(p){return Number.isFinite(p?.lat)&&Number.isFinite(p?.lng)&&p.lat>=25&&p.lat<=45&&p.lng>=120&&p.lng<=135;}
function distance(a,b){const rad=n=>n*Math.PI/180,x=rad(b.lat-a.lat),y=rad(b.lng-a.lng),v=Math.sin(x/2)**2+Math.cos(rad(a.lat))*Math.cos(rad(b.lat))*Math.sin(y/2)**2;return 6371008.8*2*Math.atan2(Math.sqrt(v),Math.sqrt(Math.max(0,1-v)));}
function records(rows,asOf){
 const result=new Map();
 for(const r of rows){
  const id=String(r.MANAGE_NO||''),name=String(r.PARK_NM||'').trim(),date=String(r.REFERENCE_DATE||''),area=Number(r.PARK_AR),lat=Number(r.LATITUDE),lng=Number(r.LONGITUDE),address=String(r.LNMADR||r.RDNMADR||'');
  if(!/^\d{5}-\d+$/.test(id)||!name||!address||!validDate(date)||date>asOf||(Date.parse(asOf)-Date.parse(date))/86400000>730||!Number.isFinite(area)||area<=0||area>100000000||!coord({lat,lng})||/어린이|소공원|미조성|조성\s*중|예정/.test(r.PARK_SE+' '+name))continue;
  const p={id,name,type:String(r.PARK_SE||''),areaM2:area,lat,lng,address,referenceDate:date,provider:String(r.INSTITUTION_NM||r.INSTT_NM||''),regionCode:id.slice(0,5)};
  const key=normalize(name)+'|'+address.replace(/\s+/g,' '),old=result.get(key);
  if(!old||old.referenceDate<date)result.set(key,p);
  else if(old.referenceDate===date&&(Math.abs(old.areaM2-area)>Math.max(1,area*.02)||distance(old,p)>100))result.set(key,{...old,conflict:true});
 }
 return [...result.values()].filter(p=>!p.conflict);
}
function choosePark(rows,{center,identity,asOf,areaAudits=[]}){
 if(!coord(center))throw Error('대상 단지의 공식 좌표를 확인하지 못했습니다.');
 const excluded=new Set(areaAudits.filter(a=>a.excluded).map(a=>a.id));
 const eligible=records(rows,asOf).filter(p=>!excluded.has(p.id)).map(p=>({...p,distanceM:Math.round(distance(center,p))})).filter(p=>p.areaM2>=MIN_AREA&&p.distanceM<=RADIUS);
 if(!eligible.length)return {selected:null,candidates:[],reason:'반경 5km의 공개 공원 자료에서 면적 10만㎡ 이상인 조성 공원을 확인하지 못했습니다. 어린이공원·소공원으로 대체하지 않았습니다.'};
 // Use a named public park; never reward a nearby pocket park as a regional landmark.
 const local=p=>identity?.town&&p.address.split(/\s+/).includes(identity.town)?2:identity?.regionCode&&p.regionCode===String(identity.regionCode)?1:0;
 const level=Math.max(...eligible.map(local)),pool=eligible.filter(p=>local(p)===level);
 const recognizable=p=>/(?:센트럴파크|중앙공원|호수공원|대공원|올림픽공원|월드컵공원|국가정원|수목원)/.test(p.name)?1:0;
 pool.sort((a,b)=>recognizable(b)-recognizable(a)||b.areaM2-a.areaM2||a.distanceM-b.distanceM||a.id.localeCompare(b.id));
 const reference=pool[0],thresholdM2=Math.max(MIN_AREA,reference.areaM2*SIMILAR_RATIO),comparable=eligible.filter(p=>p.areaM2+1e-8>=thresholdM2).sort((a,b)=>a.distanceM-b.distanceM||b.areaM2-a.areaM2||a.id.localeCompare(b.id));
 return {selected:comparable[0],reference,similarityRatio:SIMILAR_RATIO,thresholdM2,candidates:eligible.sort((a,b)=>a.distanceM-b.distanceM),areaAudits,scope:level===2?'같은 읍면동':level===1?'같은 시군구':'주변 생활권',reason:'기준 랜드마크와 공식 면적 50% 이상인 주변 대형공원을 대조하고 가장 가까운 적격 공원의 직선 접근성을 평가했습니다.'};
}
async function inventory({asOf,signal,fetchImpl=fetch}){
 const day=todayKst();if(cache?.day===day&&cache.fetchImpl===fetchImpl)return cache;
 const header=await boundedJson(HOME+'/download/columList.json?pk=15012890&ext=JSON',{signal,fetchImpl});
 const total=Number(header.totalCount),table=header.tableVO?.svcTableNm,columns=header.tableVO?.colNmList;
 const required=['MANAGE_NO','PARK_NM','PARK_SE','RDNMADR','LNMADR','LATITUDE','LONGITUDE','PARK_AR','REFERENCE_DATE'];
 if(!Number.isInteger(total)||total<1||total>50000||table!=='tn_pubr_public_cty_park_info_svc'||!Array.isArray(columns)||!required.every(k=>columns.includes(k))||columns.some(k=>!/^\w{1,50}$/.test(k)))throw Error('전국 공원 자료의 전체 건수·필수 항목·다운로드 형식이 변경됐습니다.');
 const rows=[];for(let page=1;page<=Math.ceil(total/10000);page++){
  const params=new URLSearchParams({publicDataPk:'15012890',svcTableNm:table,totalCount:String(total),perPage:'10000',page:String(page)});for(const column of columns)params.append('colNmList',column);
  const batch=JSON.parse((await boundedBytes(HOME+'/download/standard.json?'+params,{signal,fetchImpl,maxBytes:18*1024*1024})).toString('utf8'));
  if(!Array.isArray(batch)||batch.length!==Math.min(10000,total-rows.length))throw Error('전국 공원 자료의 일부 페이지가 누락되어 대표 공원을 선정하지 않았습니다.');rows.push(...batch);
 }
 const areaAudits=await require('./park-notices.cjs').auditParks(rows,{signal,fetchImpl});cache={day,fetchImpl,rows,total,areaAudits};return cache;
}
async function queryRegionalPark({center,identity,asOf,signal,fetchImpl=fetch}={}){
 const source={id:'ev-'+createHash('sha256').update('national-regional-park').digest('hex').slice(0,12),title:'공공데이터포털 · 전국도시공원정보표준데이터',url:SOURCE,checkedAt:todayKst()};
 const base={version:VERSION,status:'unavailable',source,checkedAt:new Date().toISOString(),asOf,center,criteria:CRITERIA};
 try{
  if(!validDate(asOf)||asOf!==todayKst())throw Error('지역 공원은 현재 공개 자료로 조회합니다. 과거·미래 기준일의 공원 상태로 대신 평가하지 않습니다.');
  if(!coord(center))throw Error('대상 단지의 공식 좌표를 확인하지 못했습니다.');
  const data=await inventory({asOf,signal,fetchImpl}),choice=choosePark(data.rows,{center,identity,asOf,areaAudits:data.areaAudits});
  return {...base,...choice,status:choice.selected?'verified':'unavailable',complete:true,totalRecords:data.total};
 }catch(e){if(signal?.aborted)throw e;return {...base,reason:'지역 대표 대형공원 조회: '+e.message};}
}
function verified(nature,{center,asOf}){
 const p=nature?.selected,reference=nature?.reference,age=(Date.parse(asOf)-Date.parse(String(nature?.checkedAt||'').slice(0,10)))/86400000;
 const valid=p=>coord(center)&&coord(p)&&Number.isFinite(p.areaM2)&&p.areaM2>=MIN_AREA&&p.areaM2<=100000000&&Number.isFinite(p.distanceM)&&p.distanceM>=0&&p.distanceM<=RADIUS&&Math.abs(distance(center,p)-p.distanceM)<=2&&validDate(p.referenceDate)&&p.referenceDate<=asOf&&(Date.parse(asOf)-Date.parse(p.referenceDate))/86400000<=730;
 if(!(nature?.status==='verified'&&nature.version===VERSION&&nature.asOf===asOf&&nature.complete===true&&nature.source?.url===SOURCE&&nature.source?.id&&coord(nature.center)&&coord(center)&&distance(nature.center,center)<=100&&valid(p)&&valid(reference)&&nature.similarityRatio===SIMILAR_RATIO&&Number.isFinite(age)&&age>=0&&age<=30))return false;
 const threshold=Math.max(MIN_AREA,reference.areaM2*SIMILAR_RATIO),excluded=new Set((nature.areaAudits||[]).filter(a=>a.excluded).map(a=>a.id)),candidates=(nature.candidates||[]).filter(x=>valid(x)&&!excluded.has(x.id)&&x.areaM2+1e-8>=threshold).sort((a,b)=>a.distanceM-b.distanceM||b.areaM2-a.areaM2||a.id.localeCompare(b.id));
 return Math.abs(nature.thresholdM2-threshold)<1e-6&&p.areaM2+1e-8>=threshold&&!excluded.has(reference.id)&&candidates[0]?.id===p.id&&candidates[0].areaM2===p.areaM2&&candidates[0].distanceM===p.distanceM;
}
async function ensureEvidence(evidence,{input,signal,query=queryRegionalPark}={}){
 if(input?.asset!=='apartment'||!coord(evidence?.center)||verified(evidence?.nature,{center:evidence.center,asOf:input.asOf}))return {evidence,refreshed:false};
 // Do not turn a current lookup into purported historical evidence.
 if(input.asOf!==todayKst())return {evidence,refreshed:false,reason:'기존 보고서의 과거 기준일을 유지하여 현재 공원 자료로 대신 평가하지 않았습니다.'};
 const nature=await query({center:evidence.center,identity:evidence.identity,asOf:input.asOf,signal});
 const updated={...evidence,nature,sources:[...(evidence.sources||[]).filter(s=>s.id!==nature.source?.id),...(nature.status==='verified'?[nature.source]:[])]};
 return {evidence:updated,refreshed:true,status:nature.status,checkedAt:nature.checkedAt,reason:nature.reason};
}
module.exports={MIN_AREA,RADIUS,SIMILAR_RATIO,VERSION,CRITERIA,SOURCE,choosePark,records,queryRegionalPark,verified,ensureEvidence};
