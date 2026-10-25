'use strict';
const {todayKst}=require('./core.cjs');
const VERSION='2026-10-17-secondary-schools-v1',RADIUS=3000;
function payload(t){if(t.server!=='ipzitalk'||t.result?.isError)return null;if(t.result?.structuredContent)return t.result.structuredContent;for(const c of t.result?.content||[])if(c.type==='text')try{return JSON.parse(c.text);}catch{}return null;}
function snapshot(tools,{center,asOf}){
 const t=tools.find(t=>t.tool==='search_by_nearby_category'&&Array.isArray(t.arguments?.categories)&&(()=>{const d=payload(t);return Array.isArray(d?.results?.school)&&d?.center&&Math.abs(d.center.lat-center?.lat)<.00001&&Math.abs(d.center.lng-center?.lng)<.00001&&d.radius_m===RADIUS&&Number.isFinite(Date.parse(d.metadata?.collected_at))&&todayKst(new Date(d.metadata.collected_at))===asOf;})());
 if(!t)return null;const d=payload(t);return {version:VERSION,asOf,center,checkedAt:d.metadata.collected_at,truncated:!!d.metadata.truncated,complete:true,scope:'반경 3km의 등록 중학교·고등학교 위치와 직선 접근성. 인근 학교이며 배정 학교를 의미하지 않습니다.'};
}
function current(e,input){const s=e?.secondarySchools;return s?.version===VERSION&&s.asOf===input.asOf&&s.complete===true&&s.center?.lat===e.center?.lat&&s.center?.lng===e.center?.lng;}
module.exports={VERSION,RADIUS,snapshot,current};
