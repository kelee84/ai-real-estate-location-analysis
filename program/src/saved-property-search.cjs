'use strict';
// Only public identity fields leave the saved report. The candidate is still
// selected by the user and rechecked against the live official type catalogue.
const {normalizeInput,todayKst}=require('./core.cjs');
const identityRules=require('./property-identity.cjs');
const search=require('./property-search.cjs');
const SOURCE='https://rt.molit.go.kr/pt/gis/gis.do';
const exact=s=>String(s||'').normalize('NFKC').replace(/\s/g,'').toLowerCase().replace(/(?:아파트|apt)$/,'');
const current=(value,day)=>{const time=Date.parse(value);return Number.isFinite(time)&&time<=Date.now()&&todayKst(new Date(time))===day;};
function candidate(member,report,query,day){
 const i=member?.prices?.buildingResolution;
 if(member?.input?.asset!=='apartment'||member.input.asOf!==day||report.demo||member.demo||!current(report.createdAt,day)||!current(i?.checkedAt,day)||i?.source!==SOURCE||!/^\d{1,20}$/.test(String(i.code||''))||!/^\d{5}$/.test(String(i.regionCode||''))||!i.province||!i.region||!i.town||!/^\d{1,4}(?:-\d{1,4})?$/.test(String(i.lot||''))||!i.building||!search.point(i))return null;
 const archhub=require('./archhub.cjs').verified(member.prices.archhub,{identity:i,asOf:day});
 const naver=require('./naver-land.cjs').current(member.prices.naverLand,{identity:i,asOf:day})?require('./naver-land.cjs').normalize(member.prices.naverLand):null;
 if(!archhub&&!naver)return null;
 // A legal-neighborhood prefix is parsed as a location qualifier, not a
 // free-form nickname. No substring, fuzzy, phase or historical alias match.
 const names=[i.building,archhub?.name,naver?.name].filter(Boolean).map(exact);
 const requested=exact(query),stem=String(i.town).replace(/(?:동|읍|면|리)$/,'');
 const qualified=exact(i.building).length===2&&[exact(i.town)+exact(i.building),exact(stem)+exact(i.building)].includes(requested);
 if(!requested||identityRules.identityConflict(query,i.building)||!names.includes(requested)&&!qualified)return null;
 const region={code:String(i.regionCode),name:i.region,province:{name:i.province}};
 return {region,choice:{id:'rtms-'+i.code,officialCode:String(i.code),name:i.building,town:i.town,address:[i.province,i.region,i.town,i.lot].join(' '),road:i.road||'',lat:i.lat,lng:i.lng},checkedAt:i.checkedAt};
}
async function find(store,raw,{forceRefresh=false,signal}={}){
 if(!store?.list||!store?.load||forceRefresh||raw.forceRefresh)return null;
 const input=normalizeInput(raw),day=todayKst();
 if(input.asset!=='apartment'||input.asOf!==day||search.hasRegion(input.target)||/최신|새로\s*조회|재조회/.test(input.request||''))return null;
 const query=identityRules.requestedName(input);if(exact(query).length<2)return null;
 const found=new Map();let reports;
 try{reports=await store.list();}catch{return null;}
 for(const item of reports){
  if(signal?.aborted)throw Error('단지 검색을 중지했습니다.');
  if(item.demo||item.asOf!==day||!current(item.createdAt,day))continue;
  try{const report=await store.load(item.id);for(const member of report.mode==='comparison'?report.members||[]:[report]){
   const value=candidate(member,report,query,day);if(!value)continue;
   const key=value.choice.officialCode,previous=found.get(key);
   // An inconsistent saved identity must not collapse into a convenient match.
   if(previous&&JSON.stringify(previous.choice)!==JSON.stringify(value.choice))return null;
   if(!previous)found.set(key,value);
  }}catch{continue;}
 }
 if(!found.size)return null;
 const values=[...found.values()],regions=new Set(values.map(v=>JSON.stringify(v.region)));
 // The existing selection API has one region for the candidate group. Defer
 // cross-region ambiguity to the existing search rather than dropping choices.
 if(regions.size!==1)return null;
 return {input,region:values[0].region,candidates:values.map(v=>v.choice),checkedAt:values.map(v=>v.checkedAt).sort().at(-1),sourceName:'당일 공식 단지·건축HUB·네이버 저장정보',reason:'오늘 주소와 출처를 대조한 단지 후보입니다. 선택 후 공식 단지 목록에서 주소·좌표·면적을 다시 확인합니다.'};
}
module.exports={find,candidate};
