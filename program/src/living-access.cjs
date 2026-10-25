'use strict';
const {createHash}=require('node:crypto');
const {todayKst}=require('./core.cjs');
const VERSION='2026-10-20-academy-four-access-v2',LEGACY_VERSION='2026-10-18-living-access-v1';
const SPECS=[
 {key:'general',group:'hospital',label:'종합·대학병원',queries:['종합병원','대학병원'],radiusM:5000,weight:40},
 {key:'pediatrics',group:'hospital',label:'소아청소년과',queries:['소아청소년과','소아과'],radiusM:1500,weight:20},
 {key:'orthopedics',group:'hospital',label:'정형외과',queries:['정형외과'],radiusM:1500,weight:20},
 {key:'dental',group:'hospital',label:'치과',queries:['치과'],radiusM:1500,weight:20},
 {key:'entrance',group:'academy',label:'입시·보습학원',queries:['입시학원','보습학원'],radiusM:1500,weight:40},
 {key:'korean',group:'academy',label:'국어학원',queries:['국어학원'],radiusM:1500,weight:20},
 {key:'english',group:'academy',label:'영어학원',queries:['영어학원'],radiusM:1500,weight:20},
 {key:'math',group:'academy',label:'수학학원',queries:['수학학원'],radiusM:1500,weight:20}
];
const QUERIES=SPECS.flatMap(s=>s.queries.map(query=>({...s,query})));
const BANDS=[[300,95],[600,85],[1000,70],[1500,55]],GENERAL_BANDS=[[500,95],[1000,85],[2000,70],[3500,55],[5000,40]];
const CLOSED=/예정|계획|공사\s*중|폐점|폐업|폐원|휴업|휴원/;
function placeSourceId(id){return 'ev-'+createHash('sha256').update('place:'+id).digest('hex').slice(0,12);}
function point(p){const lat=Number(p?.lat),lng=Number(p?.lng);return p?.lat!=null&&p?.lng!=null&&Number.isFinite(lat)&&Number.isFinite(lng)&&lat>=25&&lat<=45&&lng>=120&&lng<=135?{lat,lng}:null;}
function distance(a,b){const r=n=>n*Math.PI/180,x=r(b.lat-a.lat),y=r(b.lng-a.lng),v=Math.sin(x/2)**2+Math.cos(r(a.lat))*Math.cos(r(b.lat))*Math.sin(y/2)**2;return 6371008.8*2*Math.atan2(Math.sqrt(v),Math.sqrt(Math.max(0,1-v)));}
function payload(t){if(t.server!=='ipzitalk'||t.error||t.result?.isError)return null;if(t.result?.structuredContent&&typeof t.result.structuredContent==='object')return t.result.structuredContent;for(const c of t.result?.content||[])if(c.type==='text')try{return JSON.parse(c.text);}catch{}return null;}
function eligible(p,key){
 const name=String(p.name||''),label=String(p.kakao_category_name||'');if(!name||CLOSED.test(name))return false;
 if(key==='general')return /(?:^| > )(?:상급종합병원|종합병원|대학병원)$/.test(label)&&!/동물|요양|병원부속시설/.test(label);
 if(['pediatrics','orthopedics','dental'].includes(key))return /의료|병원|의원/.test(label)&&!/(동물|한방|한의원)/.test(label)&&({pediatrics:/소아(?:청소년)?과/,orthopedics:/정형외과/,dental:/치과/}[key]).test(label);
 if(!/학원/.test(label)||/독서실|고시원|운전|컴퓨터|성인|평생|출판|서점/.test(label))return false;
 const match={entrance:/입시학원|보습학원/,korean:/국어/,english:/영어/,math:/수학/}[key];
 if(!match)return false;
 if(key==='entrance')return /(?:^| > )(?:입시학원|보습학원)$/.test(label);
 if(key==='english'&&/중국어|일본어|불어|독일어|성인회화/.test(label+' '+name)&&!/영어/.test(label+' '+name))return false;
 return match.test(label+' '+name);
}
function points(key,value){return (key==='general'?GENERAL_BANDS:BANDS).find(([limit])=>value<=limit)?.[1]??null;}
function limited(d){return d.metadata?.truncated===true||d.metadata?.has_more===true||d.pagination?.has_more===true||d.has_more===true;}
function sameDay(stamp,asOf){return Number.isFinite(Date.parse(stamp))&&todayKst(new Date(stamp))===asOf;}
function queryRecord(t,spec,center,asOf,accept=p=>eligible(p,spec.key)){
 const d=payload(t),c=point(d?.center),args=t.arguments||{};
 const batch=!!spec.category,results=batch?d?.results?.[spec.category]:d?.results;
 if(batch?(t.tool!=='search_by_nearby_category'||!Array.isArray(args.categories)||!Array.isArray(d?.results?.[spec.category])):(t.tool!=='search_by_nearby_keyword'||args.query!==spec.query||d?.query&&d.query!==spec.query))return null;
 if(!d||!c||!point(center)||distance(c,center)>2||Number(d.radius_m)!==spec.radiusM||!Array.isArray(results))return null;
 if(args.lat!=null&&args.lng!=null&&(!point(args)||distance(point(args),center)>2)||args.radius_m!=null&&Number(args.radius_m)!==spec.radiusM)return null;
 if(args.center_lat!=null&&args.center_lng!=null&&(!point({lat:args.center_lat,lng:args.center_lng})||distance({lat:Number(args.center_lat),lng:Number(args.center_lng)},center)>2))return null;
 const stamp=Date.parse(d.metadata?.collected_at);if(!Number.isFinite(stamp)||todayKst(new Date(stamp))!==asOf)return null;
 const rows=[];let rejected=0;
 for(const p of results){if(!accept(p))continue;const coord=point(p),id=String(p.kakao_place_id||''),reported=Number(p.distance_m);if(!coord||!/^\d+$/.test(id)||p.distance_m==null||String(p.distance_m).trim()===''||!Number.isFinite(reported)||reported<0){rejected++;continue;}const actual=distance(center,coord);if(actual>spec.radiusM||Math.abs(distance(c,coord)-reported)>Math.max(35,reported*.08)){rejected++;continue;}const sourceId=placeSourceId(id);rows.push({id,name:String(p.name).slice(0,120),kakao_category_name:String(p.kakao_category_name||''),lat:coord.lat,lng:coord.lng,distanceM:Math.round(actual),distanceBasis:'단지 기준점과 시설 좌표 사이의 직선거리',sourceId,url:'https://place.map.kakao.com/'+id,checkedAt:d.metadata.collected_at});}
 const page=batch?d.pagination_by_category?.[spec.category]:null;
 const truncated=batch?(!page||page.source_cap_reached!==false||page.returned_count!==results.length||page.collected_count!==results.length):limited(d);
 // IpziTalk's category contract sorts at source by distance. A capped, intact
 // unfiltered prefix can prove the nearest matching subtype, never its count.
 const ordered=batch&&page&&page.returned_count===results.length&&page.collected_count===results.length&&!args.subcategory_filter&&results.every((p,i)=>{const coord=point(p),n=Number(p.distance_m);return coord&&/^\d+$/.test(String(p.kakao_place_id||''))&&distance(c,coord)<=spec.radiusM&&p.distance_m!=null&&String(p.distance_m).trim()!==''&&Number.isFinite(n)&&n>=0&&(!i||n>=Number(results[i-1].distance_m))&&Math.abs(distance(c,coord)-n)<=Math.max(35,n*.08);});
 return {query:batch?'category:'+spec.category:spec.query,...(batch?{category:spec.category,nearestProven:!!ordered&&rows.length>0&&!rejected,matched:rows.length}:{}),radiusM:spec.radiusM,checkedAt:d.metadata.collected_at,truncated,returned:results.length,rejected,places:rows};
}
function batchCategory(spec){return spec.group==='hospital'?'hospital':'academy';}
function batchRecord(tools,spec,center,asOf){const category=batchCategory(spec);return category?tools.map(t=>queryRecord(t,{...spec,category},center,asOf)).filter(Boolean).sort((a,b)=>Date.parse(b.checkedAt)-Date.parse(a.checkedAt))[0]||null:null;}
function completeRecord(q){return !!q?.checkedAt&&!q.truncated&&!q.rejected;}
function usableRecord(q){return q?.category?!!q.checkedAt&&q.matched>0&&!q.rejected&&(completeRecord(q)||q.nearestProven===true):completeRecord(q);}
function snapshot(tools,{center,asOf}){
 if(!point(center))return null;const groups={};let count=0;
 for(const group of ['hospital','academy']){
  const categories=SPECS.filter(s=>s.group===group).map(spec=>{
   const queries=spec.queries.map(query=>{const matches=tools.map(t=>queryRecord(t,{...spec,query},center,asOf)).filter(Boolean).sort((a,b)=>Date.parse(b.checkedAt)-Date.parse(a.checkedAt));return matches[0]||{query,radiusM:spec.radiusM,status:'unavailable',returned:null,truncated:false,places:[]};});
   const batch=batchRecord(tools,spec,center,asOf),successful=[...queries.filter(q=>q.checkedAt),...(batch?[batch]:[])];count+=successful.length;
   const places=[...new Map(successful.flatMap(q=>q.places).map(p=>[p.id,p])).values()].sort((a,b)=>a.distanceM-b.distanceM||a.id.localeCompare(b.id)),nearest=places[0]||null;
   const complete=usableRecord(batch)&&!batch.truncated||queries.every(completeRecord),status=nearest?'observed':complete?'empty':'unavailable';
   return {key:spec.key,label:spec.label,weight:spec.weight,radiusM:spec.radiusM,status,complete,limited:successful.some(q=>q.truncated),nearest,points:nearest?points(spec.key,nearest.distanceM):status==='empty'?20:null,queries:queries.map(({places,...q})=>q),...(batch?{batch:(({places,...q})=>q)(batch)}:{}),places};
  });
  groups[group]={complete:categories.every(c=>c.complete),queries:categories.flatMap(c=>[...c.queries,...(c.batch?[c.batch]:[])]),categories};
 }
 if(!count)return null;
 return {version:VERSION,asOf,center:{...center},checkedAt:groups.hospital.queries.concat(groups.academy.queries).map(q=>q.checkedAt).filter(Boolean).sort().at(-1),groups,scope:'등록 시설의 직선 접근성 평가. 실제 보행·진료 가능 여부·진료 수준·학원 실적·수업의 질·현재 운영 상태는 별도 확인합니다.'};
}
function current(e,input){
 const context={center:e?.center,asOf:input.asOf,identity:e?.identity},s=upgradeSnapshot(e?.livingAccess,context);if(!s)return false;
 const collected=group=>s.groups[group].categories.every(c=>c.hospitalEvidence?require('./public-hospitals.cjs').validCategory(c,context):c.publicEvidence?require('./sbiz-evidence.cjs').validEntranceCategory(c,context):usableRecord(c.batch)||c.queries.length>0&&c.queries.every(q=>q.checkedAt));
 return collected('hospital')&&collected('academy');
}
function validSnapshot(s,{center,asOf,identity}){
 if(s?.version!==VERSION||s.asOf!==asOf||!point(s.center)||!point(center)||distance(s.center,center)>2)return false;
 for(const group of ['hospital','academy']){const categories=s.groups?.[group]?.categories,specs=SPECS.filter(spec=>spec.group===group);if(!Array.isArray(categories)||categories.length!==specs.length||new Set(categories.map(c=>c?.key)).size!==specs.length)return false;}
 for(const spec of SPECS){
  const categories=s.groups?.[spec.group]?.categories,c=Array.isArray(categories)?categories.find(c=>c?.key===spec.key):null;
  if(!validCategory(c,spec,{center,asOf,identity}))return false;
 }
 return true;
}
function validCategory(c,spec,{center,asOf,identity}){
  if(c?.hospitalEvidence||c?.nearest?.provider==='seoul-hospital-register')return spec.group==='hospital'&&require('./public-hospitals.cjs').validCategory(c,{center,asOf,identity});
  if(c?.publicEvidence||c?.nearest?.provider==='sbiz-csv')return spec.key==='entrance'&&require('./sbiz-evidence.cjs').validEntranceCategory(c,{center,asOf,identity});
  if(!c||c.label!==spec.label||c.weight!==spec.weight||c.radiusM!==spec.radiusM||!['observed','empty','unavailable'].includes(c.status)||!Array.isArray(c.queries)||!spec.queries.every(query=>c.queries.some(q=>q?.query===query&&q.radiusM===spec.radiusM)))return false;
  if(c.batch&&(c.batch.category!==batchCategory(spec)||c.batch.query!=='category:'+batchCategory(spec)||c.batch.radiusM!==spec.radiusM||!sameDay(c.batch.checkedAt,asOf)||!Number.isInteger(c.batch.returned)||c.batch.returned<0||!Number.isInteger(c.batch.rejected)||c.batch.rejected<0))return false;
  if(c.batch?.nearestProven&&(!Number.isInteger(c.batch.matched)||c.batch.matched<1||c.batch.matched>c.batch.returned||c.status!=='observed'))return false;
  if(c.status==='observed'){
   const p=c.nearest;
   if(!point(p)||!/^\d+$/.test(p.id||'')||!eligible(p,spec.key)||p.sourceId!==placeSourceId(p.id)||p.url!=='https://place.map.kakao.com/'+p.id||!Number.isFinite(p.distanceM)||p.distanceM<0||Math.abs(distance(center,p)-p.distanceM)>2||p.distanceM>spec.radiusM||c.points!==points(spec.key,p.distanceM)||!sameDay(p.checkedAt,asOf)||!c.queries.some(q=>sameDay(q.checkedAt,asOf))&&!sameDay(c.batch?.checkedAt,asOf))return false;
  }else if(c.status==='empty'&&(c.complete!==true||c.points!==20||!spec.queries.every(query=>c.queries.some(q=>q.query===query&&sameDay(q.checkedAt,asOf)&&q.truncated===false&&q.rejected===0))))return false;
  else if(c.status==='unavailable'&&c.points!==null)return false;
 return true;
}
function unavailableCategory(spec){return {key:spec.key,label:spec.label,weight:spec.weight,radiusM:spec.radiusM,status:'unavailable',complete:false,limited:false,nearest:null,points:null,queries:spec.queries.map(query=>({query,radiusM:spec.radiusM,status:'unavailable',returned:null,truncated:false,places:[]})),places:[]};}
// Recalculate the selected four subjects from validated saved facility proof.
// A malformed legacy academic row must not discard independent hospital proof.
function upgradeSnapshot(s,options){
 if(validSnapshot(s,options))return structuredClone(s);
 const {center,asOf}=options;
 if(s?.version!==LEGACY_VERSION||s.asOf!==asOf||!point(s.center)||!point(center)||distance(s.center,center)>2)return null;
 const out={...structuredClone(s),version:VERSION,migratedFrom:LEGACY_VERSION,scope:'등록 시설의 직선 접근성 평가. 학원은 입시·국어·영어·수학만 반영합니다. 실제 보행·진료 가능 여부·진료 수준·학원 실적·수업의 질·현재 운영 상태는 별도 확인합니다.',groups:{}};
 for(const group of ['hospital','academy']){
  const categories=SPECS.filter(spec=>spec.group===group).map(spec=>{const old=s.groups?.[group]?.categories?.find(c=>c?.key===spec.key),legacySpec=group==='academy'&&spec.key!=='entrance'?{...spec,weight:10}:spec;return validCategory(old,legacySpec,options)?{...structuredClone(old),weight:spec.weight}:unavailableCategory(spec);});
  out.groups[group]={categories,complete:categories.every(c=>c.complete),queries:categories.flatMap(c=>[...c.queries,...(c.batch?[c.batch]:[])])};
 }
 return validSnapshot(out,options)?out:null;
}
function mergeSnapshot(previous,fresh,options){
 previous=upgradeSnapshot(previous,options);fresh=upgradeSnapshot(fresh,options);
 const oldValid=!!previous,newValid=!!fresh;if(!oldValid)return newValid?structuredClone(fresh):null;if(!newValid)return structuredClone(previous);
 const out=structuredClone(fresh);for(const group of ['hospital','academy']){out.groups[group].categories=out.groups[group].categories.map(c=>{const old=previous.groups[group].categories.find(p=>p.key===c.key);return c.status==='unavailable'&&old?.status!=='unavailable'?{...structuredClone(old),lookupReason:'새 조회가 불완전해 같은 기준일에 검증한 기존 시설 근거를 유지했습니다.'}:c;});out.groups[group].queries=out.groups[group].categories.flatMap(c=>c.queries);out.groups[group].complete=out.groups[group].categories.every(c=>c.complete);}return out;
}
function apply(scores,e,{input}){
 const s=upgradeSnapshot(e.livingAccess,{center:e.center,asOf:input.asOf,identity:e.identity});if(!s)return;e.livingAccess=s;
 for(const [key,name]of [['hospital','병원 환경'],['academy','학원 환경']]){
  const index=scores.findIndex(x=>x.name===name);if(index<0)continue;const categories=s.groups[key].categories,used=categories.filter(c=>c.points!=null),coverage=used.reduce((n,c)=>n+c.weight,0);if(!coverage)continue;
  const score=Math.round(used.reduce((n,c)=>n+c.points*c.weight,0)/coverage),observed=categories.map(c=>`${c.label}: ${c.nearest?c.nearest.name+' · 직선 '+c.nearest.distanceM.toLocaleString('ko-KR')+'m'+(['sbiz-csv','seoul-hospital-register'].includes(c.nearest.provider)?' ('+c.nearest.sourceDate+' 등록자료)':''):c.status==='empty'?'반경 '+(c.radiusM/1000)+'km 검색 내 등록 시설 미확인':'자료 미확인'}`).join(' / ');
  const needed=key==='hospital'?'실제 출입구·이동 동선 / 진료과·소아 진료·진료시간·응급진료 가능 여부':'자녀 연령·과목별 실제 수업과 정원·비용 / 안전한 통학 동선·운영 여부';
  scores[index]={name,score,status:'partial',coverage,scope:key==='hospital'?'종합병원·소아과·정형외과·치과 직선 접근성':'입시·국어·영어·수학 등록 교육시설 직선 접근성',observed,needed,reason:observed+'. '+needed+'은 별도 확인이 필요합니다.'+(categories.some(c=>c.limited)?' 검색 제공 건수에 제한이 있어 조회된 시설 기준입니다.':''),method:VERSION+'. '+categories.map(c=>c.label+c.weight+'%').join(' + ')+'. 일반 진료·학원: ≤300m95 / ≤600m85 / ≤1000m70 / ≤1500m55. 종합병원: ≤500m95 / ≤1000m85 / ≤2000m70 / ≤3500m55 / ≤5000m40. 모든 지정 조회가 정상 완료되고 반경 내 적합 시설이 없으면20점. 조회 실패·제한·잘못된 위치·거리 자료는 빈 결과로 간주하지 않습니다. 확인 배점 '+coverage+'%를 가중평균·반올림. 시설 수·규모·의료 수준·학원 성과를 점수로 추정하지 않습니다.',sourceIds:[...new Set(used.map(c=>c.nearest?.sourceId).filter(Boolean))],calculation:categories.map(c=>({indicator:c.label,weight:c.weight,value:c.nearest?.distanceM??null,unit:'m (직선)',points:c.points,sourceId:c.nearest?.sourceId||null,status:c.status,facility:c.nearest?.name||null,radiusM:c.radiusM})),accessCategories:categories.map(({places,...c})=>c)};
  for(const c of used)if(c.nearest)e.sources.push(c.nearest.provider==='seoul-hospital-register'?require('./public-hospitals.cjs').source(c.nearest):c.nearest.provider==='sbiz-csv'?require('./sbiz-evidence.cjs').source(c.nearest):{id:c.nearest.sourceId,title:'카카오 장소정보 · '+c.nearest.name,url:c.nearest.url,checkedAt:input.asOf});
  if(used.some(c=>c.status==='empty')){const id='ev-access-'+key+'-'+asOfKey(input.asOf);e.sources.push({id,title:'카카오 장소정보 · '+(key==='hospital'?'의료시설':'학원')+' 지정 키워드 검색 결과',url:'https://map.kakao.com/',checkedAt:input.asOf});scores[index].sourceIds.push(id);}
 }
}
function asOfKey(s){return String(s).replace(/-/g,'');}
function compact(s){if(!s)return null;return {version:s.version,asOf:s.asOf,scope:s.scope,groups:Object.fromEntries(Object.entries(s.groups||{}).map(([k,g])=>[k,{complete:g.complete,categories:(g.categories||[]).map(c=>({key:c.key,label:c.label,status:c.status,weight:c.weight,points:c.points,radiusM:c.radiusM,nearest:c.nearest?{name:c.nearest.name,distanceM:c.nearest.distanceM,sourceId:c.nearest.sourceId,...(['sbiz-csv','seoul-hospital-register'].includes(c.nearest.provider)?{provider:c.nearest.provider,sourceDate:c.nearest.sourceDate,checkedAt:c.nearest.checkedAt}:{} )}:null,limited:c.limited}))}]))};}
module.exports={payload,VERSION,SPECS,QUERIES,BANDS,GENERAL_BANDS,eligible,points,snapshot,current,validSnapshot,upgradeSnapshot,mergeSnapshot,apply,compact,point,distance,queryRecord,placeSourceId,batchRecord,completeRecord,usableRecord,unavailableCategory};
