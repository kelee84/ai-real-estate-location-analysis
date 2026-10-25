'use strict';
const capture=require('./map-capture.cjs'),{todayKst}=require('./core.cjs');
function plan(members){
 const targets=members.filter(m=>m.input.asset==='apartment').map(m=>({name:m.input.building||m.input.target,...m.scoreEvidence.center,coordinateLabel:m.scoreEvidence.centerSource?'네이버 등록 단지 기준점(공식 주소 대조)':'공식 단지 기준점'}));
 const colors=['Red','Blue','Purple'],markers=targets.map((t,i)=>({...t,color:colors[i],info:'비교 대상 '+String.fromCharCode(65+i)+' · '+t.coordinateLabel})),parkIds=new Set();
 for(const m of members){const n=m.scoreEvidence.nature;if(require('./regional-park.cjs').verified(n,{center:m.scoreEvidence.center,asOf:m.input.asOf}))for(const p of [n.reference,n.selected])if(!parkIds.has(p.id)){parkIds.add(p.id);markers.push({lat:p.lat,lng:p.lng,name:p.name,color:'Green',info:(p.id===n.reference.id?'기준 랜드마크':'평가 대형공원')+' · 공식 면적 '+p.areaM2.toLocaleString('ko-KR')+'㎡'});}}
 for(const m of members){const n=m.scoreEvidence.natureAccess;if(require('./nature-access.cjs').verified(n,{center:m.scoreEvidence.center,asOf:m.input.asOf})){const p=n.trails[0];markers.push({lat:p.lat,lng:p.lng,name:m.key+' · '+p.name,color:'Green',info:p.pointRole+' · 실제 진입·보행 동선 별도 확인'});}}
 const shoppingIds=new Set();for(const m of members){const p=m.scoreEvidence.places.find(p=>p.category==='shopping_large');if(p&&!shoppingIds.has(p.id)){shoppingIds.add(p.id);markers.push({lat:p.lat,lng:p.lng,name:p.name,color:'Blue',info:'평가 쇼핑시설 · 등록 시설 좌표 기준'});}}
 return {targets,args:{markers,center:{lat:targets.reduce((s,t)=>s+t.lat,0)/targets.length,lng:targets.reduce((s,t)=>s+t.lng,0)/targets.length},maptype:'normal',title:members.length+'개 단지 입지 비교'}};
}
const markerFacts=p=>({lat:p.lat,lng:p.lng,name:p.name,color:p.color,info:p.info||''});
function matches(map,p){
 // Compare every current marker, including facilities, text, colors and order.
 // Matching apartment centers alone cannot prove that an old map is complete.
 return capture.isValidatedMap(map)&&map.validation.targetCount===p.targets.length&&Array.isArray(map.markerDetails)&&JSON.stringify(map.markerDetails.map(markerFacts))===JSON.stringify(p.args.markers.map(markerFacts));
}
function reusable(map,p,day){
 return day===todayKst()&&Number.isFinite(Date.parse(map?.capturedAtTime))&&todayKst(new Date(map.capturedAtTime))===day&&matches(map,p)&&!!capture.safeSavedCandidate(map,p.targets);
}
async function request(service,members,previous,directory,{forceRefresh=false,signal,onWarning=()=>{}}={}){
 const p=plan(members),out={...p,tools:[],map:null};
 if(!p.targets.length||!p.targets.every(t=>Number.isFinite(t.lat)&&Number.isFinite(t.lng)))return out;
 const check=()=>{if(signal?.aborted)throw Error('지도 불러오기를 중지했습니다.');};check();
 if(!forceRefresh&&typeof service.captureMap==='function'&&members.every(m=>m.input.asOf===members[0].input.asOf)&&reusable(previous?.map,p,members[0].input.asOf)){
  service.onEvent?.({stage:'map',message:'오늘 확인한 지도 링크와 전체 마커를 재사용해 지도를 확인하고 있습니다.'});
  try{const map=await service.captureMap([],directory,{targets:p.targets,savedMap:previous.map,signal});check();if(matches(map,p)){out.map=map;return out;}}
  catch(e){check();onWarning('저장된 지도 연결 확인 실패: '+e.message);}
 }
 // Expired, changed or failed saved maps use one normal provider request.
 if(typeof service.bridge.evidenceSession==='function')try{
  const session=members.find(m=>m.researchData?.session)?.researchData.session||await service.bridge.evidenceSession({signal});check();out.tools.push(await service.bridge.evidenceTool(session,'get_map_embed_url',p.args,{signal}));check();
 }catch(e){check();onWarning('입지톡 비교 지도 조회 실패: '+e.message);}
 return out;
}
module.exports={plan,matches,reusable,request};
