'use strict';
// Adapted distance signals from chatdaeri/ipzitalk c2020bb34d660c421e0cf0246558d86acf22ae71.
// Signals explain saved evidence; they neither create points nor request data.
const access=require('./living-access.cjs');
const VERSION='2026-10-18-ipzitalk-consumer-v1';
const BANDS={subway:[[500,'역세권'],[800,'준역세권'],[1200,'역과 다소 이격'],[Infinity,'역과 이격']],hospital:[[1000,'종합병원 인접'],[2000,'종합병원 근접'],[3000,'종합병원과 다소 이격'],[Infinity,'종합병원과 이격']],retail:[[1000,'생활 상권 인접'],[2000,'생활 상권 근접'],[3000,'상권과 다소 이격'],[Infinity,'상권과 이격']],park:[[300,'자연공간 인접'],[700,'자연공간 근접'],[1200,'자연공간과 다소 이격'],[Infinity,'자연공간과 이격']],elementary:[[300,'초등학교 인접'],[500,'초등학교 근접'],[1000,'초등학교와 다소 이격'],[Infinity,'초등학교와 이격']]};
const CLOSED=/예정|계획|공사\s*중|폐역|휴역|미개통|폐교|휴교/;
function band(kind,d){return Number.isFinite(d)&&d>=0?BANDS[kind]?.find(([n])=>d<=n)?.[1]||null:null;}
function prefix(score,member){
 const e=member.assessment?.evidence,asOf=member.input?.asOf;
 if(!Number.isInteger(score?.score)||!e||e.asOf!==asOf||!access.point(e.center))return '';
 const pick=category=>(e.places||[]).filter(p=>p.category===category&&!CLOSED.test(p.name||'')&&score.sourceIds?.includes(p.sourceId)&&Number.isFinite(p.distanceM)).sort((a,b)=>a.distanceM-b.distanceM)[0];
 if(score.name==='교통 환경'){
  const p=pick('subway');if(!p)return '';const lines=new Set((e.places||[]).filter(p=>p.category==='subway'&&p.distanceM<=1000&&!CLOSED.test(p.name||'')).map(p=>String(p.kakao_category_name||'').split(' > ').at(-1)).filter(s=>/호선|분당선|중앙선|경춘선|공항철도|신림선|우이신설선|김포골드라인|서해선/.test(s)));
  return band('subway',p.distanceM)+(lines.size>=2?' · 확인된 '+lines.size+'개 노선(1km 내)':'');
 }
 if(score.name==='병원 환경'&&access.validSnapshot(e.livingAccess,{center:e.center,asOf})){const p=e.livingAccess.groups.hospital.categories.find(c=>c.key==='general')?.nearest;return p&&score.sourceIds?.includes(p.sourceId)?band('hospital',p.distanceM):'';}
 if(score.name==='교육 환경'){const p=pick('school_elementary');return p?band('elementary',p.distanceM)+' · 초품아·배정·통학로 별도 확인':'';}
 if(score.name==='상권 환경'){
  const eligible=(score.calculation||[]).filter(c=>c.status==='observed'&&Number.isFinite(c.value)).sort((a,b)=>a.value-b.value),p=eligible[0];return p?band('retail',p.value)+(/슈퍼/.test(p.indicator)?' · 생활 슈퍼 기준':''):'';
 }
 if(score.name==='자연환경'){const p=e.natureAccess?.selected||score.regionalPark||e.nature?.selected;return p&&score.sourceIds?.includes(p.source?.id||p.sourceId||e.nature?.source?.id)?band('park',p.distanceM):'';}
 return '';
}
module.exports={VERSION,BANDS,CLOSED,band,prefix};
