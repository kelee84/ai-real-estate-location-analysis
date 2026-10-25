'use strict';
const {todayKst}=require('./core.cjs'),{matchesKaptIdentity}=require('./property-identity.cjs');
const {createHash}=require('node:crypto');
const UNSUPPORTED=/성적|성취|순위|학급당|교사당|학원|교습소|태권도장|거리\s*(?:미산정|미확인)|도보\s*(?:미산정|미확인)/;
function dated(value,asOf){return Number.isFinite(Date.parse(value))&&Date.parse(value)<=Date.now()&&todayKst(new Date(value))===asOf;}
function walkingFact(f,m,identity){
 if(!['medical','shopping','nature'].includes(f?.category)||!f.name||f.name.length>120||UNSUPPORTED.test(f.name)||!dated(f.checkedAt,m.input.asOf))return null;
 let walking;try{walking=require('./naver-walking.cjs');if(!walking.validWalking(f.walking,{input:m.input,identity,fact:f}))return null;}catch{return null;}
 const distance=walking.displayDistance(f.walking);if(!distance)return null;
 return {...f,text:f.name+' · '+distance,sourceUrl:f.walking.sourceUrl,placeSourceUrl:f.sourceUrl,checkedAt:f.walking.checkedAt,distanceBasis:'네이버 지도 도보 경로'};
}
function sections(report){const out=[];for(const m of report.members||report.comparisonMembers||[report]){
 const i=m.prices?.buildingResolution;if(!i?.code)continue;const facts=[];
 for(const v of [m.prices?.naverLand,m.assessment?.evidence?.naverLand])try{const r=require('./naver-land.cjs').normalize(v);if(!dated(r.checkedAt,m.input.asOf)||!matchesKaptIdentity(i,{name:r.name,addressJibun:r.addressJibun,addressRoad:r.addressRoad}))continue;facts.push(...(r.publicFacts||[]).map(require('./naver-page.cjs').normalizePublicFact).filter(f=>f&&f.text.length<=220&&!UNSUPPORTED.test(f.text+' '+(f.distanceBasis||''))).map(f=>({...f,distanceBasis:f.distanceBasis||'단지 공개정보 (거리 항목 아님)'})));break;}catch{}
 const nearby=m.prices?.naverNearby;if(nearby?.identityCode===i.code&&nearby.asOf===m.input.asOf){const verified=(nearby.facts||[]).map(f=>walkingFact(f,m,i)).filter(Boolean).sort((a,b)=>a.walking.distanceM-b.walking.distanceM||a.name.localeCompare(b.name));for(const category of ['medical','shopping','nature'])facts.push(...verified.filter(f=>f.category===category).slice(0,2));}
 const unique=[...new Map(facts.filter(f=>typeof f.text==='string'&&f.text&&f.category!=='academy'&&!UNSUPPORTED.test(f.text)).map(f=>[f.text,f])).values()];if(!unique.length)continue;
 const sources=[...new Map(unique.map(f=>[f.sourceUrl,{title:'네이버 공개정보',url:f.sourceUrl,checkedAt:f.checkedAt}])).values()];
 out.push({heading:(m.key?m.key+' · ':'')+(m.input.building||i.building)+' · 네이버에서 확인한 생활정보',body:unique.map(f=>f.text).join('\n'),facts:unique.map(f=>({...f})),sources});
 }return out;}
function sources(report){return [...new Map(sections(report).flatMap(s=>s.sources).map(s=>[s.url,{...s,id:'naver-public-'+createHash('sha256').update(s.url).digest('hex').slice(0,16)}])).values()];}
module.exports={sections,sources};
