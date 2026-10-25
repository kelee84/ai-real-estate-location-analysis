'use strict';
const {normalize,validDate}=require('./core.cjs');
function partial(name,{score,coverage,scope,observed,needed,method,sourceIds,calculation}){return {name,score:Math.max(1,Math.min(100,Math.round(score))),status:'partial',coverage,scope,observed,needed,reason:observed+'. '+needed,method,sourceIds:[...new Set(sourceIds.filter(Boolean))],calculation};}
function applyEducation(scores,e,{input,distanceScore}){
 const row=scores.find(s=>s.name==='교육 환경');if(!row)return;
 const places=e.places.filter(p=>p.category==='school_elementary'),zone=e.school,verified=zone?.status==='verified';
 const names=verified?zone.schoolNames||[]:[],assigned=places.find(p=>names.some(n=>normalize(n)===normalize(p.name))),place=assigned||places[0];
 const zoneText=verified?`공식 학구도 기준점 포함 구역: ${zone.name} (자료 기준 ${zone.updatedAt||'제공 기준일'})`:'',missing=zone?.reason||'공식 통학구역·학교 연계 자료를 확인하지 못했습니다.';
 const middle=e.places.find(p=>p.category==='school_middle'),high=e.places.find(p=>p.category==='school_high'),parts=[];
 if(place)parts.push({indicator:assigned?'공식 통학구역 연계 초등학교 접근':'주변 등록 초등학교 접근',place,weight:assigned?45:15});
 if(middle)parts.push({indicator:'인근 중학교 접근',place:middle,weight:10});
 if(high)parts.push({indicator:'인근 고등학교 접근',place:high,weight:10});
 if(!parts.length){row.reason=missing+' 초·중·고교의 검증된 좌표 자료가 없어 교육 점수를 산출하지 않았습니다.';row.observed=zoneText||'학교 위치·통학구역 자료 미확인';row.needed='공식 통학구역과 연계 학교의 위치 / 실제 통학 안전·중고교 배정';if(verified)row.sourceIds=[zone.source.id];return;}
 const coverage=parts.reduce((s,p)=>s+p.weight,0),score=parts.reduce((s,p)=>s+distanceScore(p.place.distanceM)*p.weight,0)/coverage,scope=parts.map(p=>p.indicator.replace(' 접근','')).join('·')+' 직선 접근성',ids=[...parts.map(p=>p.place.sourceId),...(verified?[zone.source?.id,zone.schoolSource?.id]:[])],needed=(assigned?'동·호수별 최종 배정과 실제 통학 동선·안전 / 중고교 배정 조건':'공식 통학구역·배정 학교 확인 / 실제 통학 동선·안전 / 중고교 배정 조건');
 scores[scores.indexOf(row)]=partial(row.name,{score,coverage,scope,observed:[...parts.map(p=>`${p.indicator} · ${p.place.name}: 단지 기준점에서 직선 약 ${p.place.distanceM.toLocaleString('ko-KR')}m`),zoneText,place?(assigned?'공식 학구도·초등학교 연계 자료를 대조했습니다.':'인근 초등학교의 등록 위치 범위이며 배정 학교를 뜻하지 않습니다.'):null,middle||high?'중·고교는 인근 등록 학교이며 배정 학교를 뜻하지 않습니다.':null,!verified?missing:null].filter(Boolean).join(' / '),needed,method:'공통 기준 2026-10-17-three-school-rubric-v1. 직선거리 ≤300m 95 / ≤600m 85 / ≤1000m 70 / ≤1500m 55 / 초과 35점. 초등학교: 공식 구역·학교 좌표 연계45%, 미연계 시 인근 학교15%만 적용. 인근 중학교10%·고등학교10%. 확인 지표의 가중평균을 반올림하며 중고교 배정·통학 안전·실제 보행·학업 성과 미평가.',sourceIds:ids,calculation:parts.map(p=>({indicator:p.indicator,value:p.place.distanceM,unit:'m (직선)',weight:p.weight,points:distanceScore(p.place.distanceM),sourceId:p.place.sourceId}))});
}
function applyRegisteredProduct(scores,e,{input}){
 const row=scores.find(s=>s.name==='상품 경쟁력');if(!row)return;
 const p=e.product?.status==='verified'?e.product:e.basic;if(!p){row.reason=e.product?.reason||row.reason;row.needed='같은 공식 단지로 대조된 사용승인·주차·공용복도 구성 / 평면·관리 상태';return;}
 const ids=[p.source?.id||p.sourceId],parts=[],observed=[],needed=[];
 if(validDate(p.approvalDate)&&p.approvalDate<=input.asOf){const [y,m,d]=p.approvalDate.split('-').map(Number),[ay,am,ad]=input.asOf.split('-').map(Number),age=ay-y-((am<m||am===m&&ad<d)?1:0);if(age>=0&&age<=150){const points=age<=5?95:age<=10?85:age<=15?70:age<=20?55:40;parts.push({indicator:'사용승인 연령',value:age,unit:'년',weight:20,points});observed.push('사용승인 '+p.approvalDate);}}
 const ratio=Number(p.parkingTotal)/Number(p.units);if(Number.isInteger(p.parkingTotal)&&p.parkingTotal>=0&&Number.isInteger(p.units)&&p.units>0&&ratio<=5){const points=ratio>=1.5?95:ratio>=1.2?85:ratio>=1?70:ratio>=.8?55:35;parts.push({indicator:'등록 세대당 주차',value:ratio,unit:'대/세대',weight:25,points});observed.push(`등록 주차 ${p.parkingTotal.toLocaleString('ko-KR')}대 / ${p.units.toLocaleString('ko-KR')}세대 = 세대당 ${ratio.toFixed(2)}대`);}else needed.push('등록 주차대수와 세대수 대조');
 const hall=String(p.hallType||''),hallPoints=hall==='계단식'?85:hall==='복도식'?65:/^(혼합식|혼합|계단복도혼합식)$/.test(hall)?75:null;if(hallPoints!==null){parts.push({indicator:'공용복도 구성',value:hall,unit:'등록 구조',weight:10,points:hallPoints});observed.push('공용복도 '+hall);}else needed.push('공용복도 구성');
 if(p.structure)observed.push('등록 구조 '+p.structure);if(Number.isInteger(p.elevators)&&p.elevators>=0)observed.push('등록 승강기 '+p.elevators+'대 (점수 미반영)');
 if(e.product?.status==='unavailable'&&e.product.reason)observed.push('공식 관리시설 상세: '+e.product.reason);
 needed.push('해당 세대 평면·향·수선·관리 상태와 실제 주차 이용 조건');
 if(parts.length<2||!parts.some(x=>x.indicator!=='사용승인 연령')){row.observed=observed.join(' / ')||row.observed;row.reason=(e.product?.reason||'주차·공용복도 등 다른 상품 조건을 확인하지 못했습니다.')+' 사용승인 연령 하나만으로 상품 점수를 산출하지 않습니다.';row.needed=needed.join(' / ');row.sourceIds=ids.filter(Boolean);return;}
 const coverage=parts.reduce((s,x)=>s+x.weight,0),score=parts.reduce((s,x)=>s+x.points*x.weight,0)/coverage;
 scores[scores.indexOf(row)]=partial(row.name,{score,coverage,scope:parts.map(x=>x.indicator.replace('등록 세대당 ','')).join('·'),observed:observed.join(' / '),needed:needed.join(' / '),sourceIds:ids,calculation:parts,method:'공통 기준 2026-10-17-evidence-rubric-v2. 연령20%: ≤5년95 / ≤10년85 / ≤15년70 / ≤20년55 / 초과40. 주차25%: 세대당 ≥1.5대95 / ≥1.2대85 / ≥1.0대70 / ≥0.8대55 / 미만35. 공용복도10%: 계단식85 / 혼합75 / 복도식65. 확인 지표 배점 가중평균 반올림. 연령 하나로 평가하지 않으며 공용복도 구분은 사전 공개된 분석 기준입니다. 실제 주차 가용성·관리·평면·세대 상태는 미평가.'});
}
function applyProduct(scores,e,options){applyRegisteredProduct(scores,e,options);require('./product-transactions.cjs').apply(scores,e,options);}
module.exports={applyEducation,applyProduct};
