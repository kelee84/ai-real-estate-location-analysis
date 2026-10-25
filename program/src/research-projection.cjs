'use strict';
const {todayKst}=require('./core.cjs');
const access=require('./living-access.cjs');

// A wider category result is reused only when its original per-category page
// contract and all coordinates/distances are intact. A capped source remains
// capped after filtering; it can never prove absence in the smaller radius.
function projectCategory(t,{radiusM,categories,asOf}){
 const d=access.payload(t),args=t?.arguments||{},center=access.point(d?.center),radius=Number(d?.radius_m);
 if(t?.tool!=='search_by_nearby_category'||!center||!Number.isFinite(radius)||radius<=radiusM||!Array.isArray(args.categories)||Number(args.radius_m)!==radius||args.subcategory_filter||!Number.isFinite(Date.parse(d?.metadata?.collected_at))||todayKst(new Date(d.metadata.collected_at))!==asOf)return null;
 const requested=access.point({lat:args.center_lat,lng:args.center_lng});if(!requested||access.distance(center,requested)>2)return null;
 const results={},pagination={};
 for(const category of categories){
  const rows=d.results?.[category],page=d.pagination_by_category?.[category];
  if(!Array.isArray(rows)||!page||typeof page.source_cap_reached!=='boolean'||page.returned_count!==rows.length||page.collected_count!==rows.length)continue;
  let ordered=true;
  const valid=rows.every((p,i)=>{const c=access.point(p),n=Number(p.distance_m);if(i&&n<Number(rows[i-1].distance_m))ordered=false;return c&&/^\d+$/.test(String(p.kakao_place_id||''))&&p.distance_m!=null&&String(p.distance_m).trim()!==''&&Number.isFinite(n)&&n>=0&&access.distance(center,c)<=radius&&Math.abs(access.distance(center,c)-n)<=Math.max(35,n*.08);});
  if(!valid||page.source_cap_reached&&!ordered)continue;
  results[category]=rows.filter(p=>access.distance(center,p)<=radiusM);
  pagination[category]={...page,returned_count:results[category].length,collected_count:results[category].length,source_cap_reached:page.source_cap_reached};
 }
 if(!Object.keys(results).length)return null;
 const derivedData={...structuredClone(d),radius_m:radiusM,results,pagination_by_category:pagination,metadata:{...d.metadata,truncated:Object.values(pagination).some(p=>p.source_cap_reached)}};
 return {server:'ipzitalk',tool:t.tool,arguments:{...args,categories:Object.keys(results),radius_m:radiusM},result:{structuredContent:derivedData},networkSkipped:true,reused:true,derived:true,researchNetworkAttempt:false,sourceQuery:{tool:t.tool,arguments:structuredClone(args),checkedAt:d.metadata.collected_at,radiusM:radius,method:'validated-category-radius-filter-v1',note:'원본 묶음 응답을 좌표로 필터링했습니다. 신규 입지톡 요청이 아니며 원본의 조회 제한을 유지합니다.'}};
}
function projections(t,asOf){return [projectCategory(t,{radiusM:1500,categories:['subway','school_elementary','mart_large','pharmacy','hospital','academy'],asOf}),projectCategory(t,{radiusM:3000,categories:['school'],asOf})].filter(Boolean);}
function elementarySchoolProof(tools,{center,asOf}){
 const accept=p=>!!String(p.name||'').trim()&&!/예정|계획|폐교|휴교|공사\s*중/.test(String(p.name))&&/(?:^| > )초등학교(?: >|$)/.test(String(p.kakao_category_name||''));
 for(const t of tools||[]){
  const q=access.queryRecord(t,{category:'school',radiusM:3000},center,asOf,accept);
  // A complete, intact distance prefix can establish a positive nearest
  // primary-school observation inside 1.5 km. It cannot establish absence.
  if(!q?.nearestProven||!access.usableRecord(q))continue;
  const nearest=[...q.places].sort((a,b)=>a.distanceM-b.distanceM||a.id.localeCompare(b.id))[0];
  if(nearest&&access.distance(center,nearest)<=1500)return {record:q,nearest,sourceArguments:structuredClone(t.arguments)};
 }
 return null;
}
module.exports={projectCategory,projections,elementarySchoolProof};
