'use strict';
// Present saved, identity-checked parking facts. Never fetch data or change scores.
const {escapeHtml:e,todayKst,validDate}=require('./core.cjs');
const identityRules=require('./property-identity.cjs'),access=require('./living-access.cjs');
const members=report=>report.members||report.comparisonMembers||[report];
const count=value=>(typeof value==='number'||typeof value==='string'&&/^\d+$/.test(value.trim()))&&Number.isSafeInteger(Number(value))&&Number(value)>=0?Number(value):null;
const fmt=value=>new Intl.NumberFormat('ko-KR').format(value);
const RATIO_NOTE='세대당 대수는 같은 자료의 총 주차대수 ÷ 세대수로 계산해 소수 둘째 자리까지 반올림했습니다. 실제 이용 가능한 주차공간은 별도 확인이 필요합니다.';
function day(value){
 if(validDate(value))return value;
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value))return null;
 const time=Date.parse(value);return Number.isFinite(time)&&time<=Date.now()?todayKst(new Date(time)):null;
}
function fact({total=null,units=null,sourceName,sourceUrl,checkedAt}){
 units=units>0?units:null;
 return {status:total!==null?'verified':'unavailable',total,units,perUnit:total!==null&&units!==null?total/units:null,sourceName,sourceUrl,checkedAt,sourceDate:day(checkedAt)};
}
function naver(member){
 const identity=member.prices?.buildingResolution,asOf=member.input?.asOf;
 if(!identity?.code||!identity.building||!identity.province||!identity.region||!identity.town||!identity.lot||!/^\d{5}$/.test(String(identity.regionCode||'')))return null;
 const records=[];for(const value of [member.prices?.naverLand,member.assessment?.evidence?.naverLand])try{
  const record=require('./naver-land.cjs').normalize(value);
  if(day(record.checkedAt)!==asOf||!identityRules.matchesKaptIdentity(identity,{name:record.name,addressJibun:record.addressJibun,addressRoad:record.addressRoad}))continue;
  const official=access.point(identity),point=access.point(record);if(official&&point&&access.distance(official,point)>100)continue;
  records.push(record);
 }catch{}
 const time=value=>Date.parse(validDate(value)?value+'T00:00:00+09:00':value),record=records.sort((a,b)=>time(b.checkedAt)-time(a.checkedAt))[0];
 return record?fact({total:count(record.basic?.parkingSpaces),units:count(record.basic?.units),sourceName:'네이버 부동산',sourceUrl:record.sourceUrl,checkedAt:record.checkedAt}):null;
}
function kapt(member){
 const identity=member.prices?.buildingResolution,evidence=member.assessment?.evidence,context=evidence?.nearbyContext,asOf=member.input?.asOf;
 if(!identity?.code||context?.version!==require('./nearby-context.cjs').VERSION||context.asOf!==asOf||String(context.identityCode)!==String(identity.code)||context.status!=='checked')return null;
 const source=context.sources?.find(s=>{try{const url=new URL(s.url);return url.protocol==='https:'&&['k-apt.go.kr','www.k-apt.go.kr'].includes(url.hostname)&&!url.username&&!url.password;}catch{return false;}});if(!source)return null;
 const rows=(context.rows||[]).filter(row=>row.target===true&&day(row.checkedAt)===asOf&&/^[A-Za-z0-9]{5,30}$/.test(String(row.kaptCode||''))&&require('./nearby-context.cjs').targetMatch(identity,{name:row.name,basic:{address_jibun:row.address,address_road:row.addressRoad,bjd_code:row.bjdCode}}));
 if(rows.length!==1)return null;const row=rows[0],ground=count(row.parkingGround),underground=count(row.parkingUnderground),total=ground!==null&&underground!==null?ground+underground:null,units=count(row.units);
 return fact({total,units,sourceName:'국토교통부 K-apt',sourceUrl:source.url,checkedAt:row.checkedAt});
}
function snapshot(member){
 if(member.input?.asset!=='apartment')return null;
 const arch=require('./archhub.cjs'),a=arch.snapshot(member)||arch.original(member);
 if(a?.basic?.parkingSpaces!=null)return fact({total:a.basic.parkingSpaces,units:count(a.basic.units),sourceName:a.sourceName,sourceUrl:a.sourceUrl,checkedAt:a.checkedAt});
 const record=require('./report-basics.cjs').snapshotRecord(member),supplement=record?fact({total:count(record.basic?.parkingSpaces),units:count(record.basic?.units),sourceName:'네이버 부동산'+(member.basicSnapshot?.status==='last-confirmed'?' · 마지막 확인자료':''),sourceUrl:record.sourceUrl,checkedAt:record.checkedAt}):null;
 const official=kapt(member),saved=naver(member);
 return [supplement,saved,official].find(value=>value?.total!==null&&value?.total!==undefined)||supplement||saved||official||{status:'unavailable',total:null,units:null,perUnit:null,sourceName:'',sourceUrl:'',checkedAt:null,sourceDate:null};
}
function label(value){
 if(!value)return '';
 return ['총 주차대수 '+(value.total!==null?fmt(value.total)+'대':'미확인'),'세대당 '+(value.perUnit!==null?value.perUnit.toFixed(2)+'대':'미확인'),'세대수 '+(value.units!==null?fmt(value.units)+'세대':'미확인')].join(' · ');
}
function sourceLabel(value){return value?.sourceName?'출처 '+value.sourceName+' · 조회 '+(value.sourceDate||'미확인'):'저장된 단지 주차자료 없음';}
function rows(report){const ms=members(report);return ms.flatMap((member,index)=>{const value=snapshot(member);return value?[{name:(ms.length>1?(member.key||String.fromCharCode(65+index))+' · ':'')+(member.input.building||member.input.target),...value,text:label(value),sourceText:sourceLabel(value)}]:[];});}
function lines(report){const values=rows(report);return [...values.flatMap(row=>[row.name+' · '+row.text,row.sourceText]),...(values.length?[RATIO_NOTE]:[])];}
function html(report){
 const values=rows(report);if(!values.length)return '';
 return `<div class="parking-overview" data-role="parking-overview" aria-label="단지 주차정보">${values.map(value=>`<div class="parking-item"><strong>${e(value.name)}</strong><p>${e(value.text)}</p><p class="note">${value.sourceUrl?`출처 <a href="${e(value.sourceUrl)}">${e(value.sourceName)}</a> · 조회 ${e(value.sourceDate||'미확인')}`:e(value.sourceText)}</p></div>`).join('')}<p class="note parking-note">${e(RATIO_NOTE)}</p></div>`;
}
const CSS='.parking-overview{margin:0 0 12px;border:1px solid #d9dfe5;border-radius:4px;padding:10px 13px;break-inside:avoid}.parking-item+ .parking-item{border-top:1px solid #d9dfe5;margin-top:7px;padding-top:7px}.parking-item strong{font-size:12px}.parking-item p{margin:2px 0;font-size:12px;line-height:1.55}.parking-item .note,.parking-overview .parking-note{font-size:10px;line-height:1.5;margin:3px 0}.parking-note{color:#5f6b78}@media print{.parking-overview{padding:7px 10px;margin-bottom:9px}.parking-item p{font-size:11px}.parking-item .note,.parking-overview .parking-note{font-size:9px}}';
module.exports={snapshot,label,sourceLabel,rows,lines,html,CSS,RATIO_NOTE};
