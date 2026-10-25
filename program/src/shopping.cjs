'use strict';
const access=require('./living-access.cjs');
const VERSION='2026-10-20-shopping-verified-venue-v3',RADIUS=5000,MALL_QUERIES=['쇼핑몰','쇼핑센터','백화점','아울렛'],MART_QUERIES=['대형마트','이마트','홈플러스','롯데마트','코스트코','트레이더스'],QUERIES=[...MALL_QUERIES,...MART_QUERIES];
const BANDS=[[500,95],[1000,85],[2000,70],[3000,55],[5000,35]];
const COLLECTION_POLICY='official-mall-proof-required';
const labelOf=p=>String(p?.provider==='sbiz-csv'&&p.category==='supermarket'?'슈퍼마켓':p?.provider==='naver-public-map'?p.classification||'':p?.kakao_category_name||'');
const sameDay=(stamp,asOf)=>Number.isFinite(Date.parse(stamp))&&Date.parse(stamp)<=Date.now()&&require('./core.cjs').todayKst(new Date(stamp))===asOf;
const compact=value=>String(value||'').normalize('NFKC').replace(/\s+/g,'').toLowerCase();
// A generic map category can also describe an online retailer. It does not prove
// that the place is a large physical venue. Bind the visible official venue page
// to the exact name and coordinates before admitting a representative mall.
const OPERATORS=[[/^(?:www\.|m\.|home\.)?ehyundai\.com$/,/현대(?:백화점|프리미엄아울렛|시티아울렛|아울렛)|더현대/],[/^(?:www\.|m\.|store\.)?lotteshopping\.com$/,/롯데(?:백화점|프리미엄아울렛|아울렛|몰|영플라자)|타임빌라스/],[/^(?:www\.|m\.)?shinsegae\.com$/,/신세계(?:백화점|아울렛)/],[/^(?:www\.)?premiumoutlets\.co\.kr$/,/프리미엄아울렛|신세계사이먼/],[/^(?:www\.)?starfield\.co\.kr$/,/스타필드/],[/^(?:www\.)?ifcmallseoul\.com$/,/IFC몰/i],[/^(?:www\.)?iparkmall\.co\.kr$/,/아이파크몰/],[/^(?:www\.)?akplaza\.com$/,/AK플라자|AK몰|AK&/i],[/^(?:www\.)?triplestreet\.com$/,/트리플스트리트/],[/^(?:www\.)?enter6\.co\.kr$/,/엔터식스/]];
function mallProof(p,{asOf=require('./core.cjs').todayKst()}={}){
 const v=p?.mallProof;if(v?.version!=='shopping-venue-proof-v1'||v.status!=='verified'||v.method!=='public-visible-page'||!['department-store','shopping-center','outlet'].includes(v.kind)||!sameDay(v.checkedAt,asOf)||compact(v.name)!==compact(p.name)||!v.address||!access.point(v)||!access.point(p)||access.distance(v,p)>5)return false;
 let u;try{u=new URL(v.sourceUrl);}catch{return false;}if(u.protocol!=='https:'||u.port||u.username||u.password||u.pathname==='/'||!OPERATORS.some(([host,name])=>host.test(u.hostname)&&name.test(String(p.name))))return false;
 const proof=v.proof;return proof?.scope==='whole-venue'&&compact(proof.facilityName)===compact(v.name)&&compact(proof.address)===compact(v.address)&&typeof proof.text==='string'&&compact(proof.text).includes(compact(v.name))&&compact(proof.text).includes(compact(v.address));
}
function open(p){return !/예정|계획|공사\s*중|폐점|폐업|휴업/.test(String(p.name||''));}
function mallCategory(p){const label=labelOf(p);return /^(?:가정,생활 > )?(?:복합쇼핑몰|쇼핑센터|백화점)(?: > [^>]+)?$/.test(label)||/^가정,생활 > 상설할인매장 > (?:현대아울렛|롯데아울렛|신세계사이먼|뉴코아아울렛)$/.test(label)||p?.provider==='naver-public-map'&&/^(?:프리미엄)?아울렛$/.test(label);}
function eligible(p,context){return open(p)&&mallCategory(p)&&mallProof(p,context);}
function eligibleMart(p){const name=String(p.name||''),label=labelOf(p);if(!open(p)||/에브리데이|익스프레스|롯데슈퍼|홈플러스슈퍼|노브랜드|편의점|주유소|문화센터|주차장|푸드코트|약국|치과|안경|미용|사진|세탁|정비|카페|전문점/.test(name+' '+label))return false;return /(?:^| > )대형마트(?: >|$)/.test(label)&&!/슈퍼마켓|편의점/.test(label)||/^(?:가정,생활 > )?(?:대형슈퍼 > )?(?:이마트|홈플러스|롯데마트|코스트코|트레이더스)(?: > [^>]+)?$/.test(label);}
function supermarket(p){return open(p)&&(/(?:^| > )(?:슈퍼마켓|기업형슈퍼마켓|SSM|대형슈퍼)(?: >|$)/i.test(labelOf(p))||p?.provider==='naver-public-map'&&labelOf(p)==='슈퍼,마트')&&!eligibleMart(p)&&!/하이마트|ABC마트|에이비씨마트|편의점|식자재도매|주차|약국|식당|카페|전자제품|신발|의류/.test(String(p.name||'')+' '+labelOf(p));}
function classify(p,context){return eligibleMart(p)?'mart_large':eligible(p,context)?'shopping_large':supermarket(p)?'supermarket':null;}
function dailySnapshot(tools,{center,asOf}){
 const eligible=(tools||[]).filter(t=>t.server==='ipzitalk'&&t.tool==='search_by_nearby_category'&&Array.isArray(t.arguments?.categories)&&(t.arguments.categories.includes('mart_large')||Array.isArray(access.payload(t)?.results?.mart_large))&&Number(t.arguments.radius_m)===1500);
 if(!eligible.length)return null;
 const records=eligible.map(t=>{const data=access.payload(t),valid=data&&Array.isArray(data.results?.mart_large)&&access.point(data.center)&&access.point(center)&&access.distance(data.center,center)<=2&&Number(data.radius_m)===1500&&Number.isFinite(Date.parse(data.metadata?.collected_at))&&require('./core.cjs').todayKst(new Date(data.metadata.collected_at))===asOf;
  return {status:valid?'received':'unavailable',checkedAt:valid?data.metadata.collected_at:null,returned:valid?data.results.mart_large.length:null,truncated:valid&&(data.metadata?.truncated===true||data.pagination?.has_more===true),reason:valid?null:t.error||'일상 마트 검색의 조회일·중심·반경·결과를 대조하지 못했습니다.'};}).sort((a,b)=>Date.parse(b.checkedAt||0)-Date.parse(a.checkedAt||0));
 const record=records.find(r=>r.status==='received')||records[0];return {version:'2026-10-18-daily-shopping-v1',asOf,center:{...center},radiusM:1500,...record,scope:'반경 1.5km의 등록 마트·슈퍼 분류 조회. 검색 실패와 빈 결과를 구분하며 빈 결과를 임의 점수로 채우지 않습니다.'};
}
function dailyCurrent(e,input){const s=e?.dailyShopping;if(s?.provider==='sbiz-csv')return s.version==='sbiz-daily-shopping-v1'&&s.asOf===input.asOf&&s.status==='received'&&s.radiusM===1500&&s.returned===1&&s.complete===false&&s.nearestProven===false&&s.sourceDate===s.nearest?.sourceDate&&s.checkedAt===s.nearest?.checkedAt&&access.point(s.center)&&access.point(e.center)&&access.distance(s.center,e.center)<=2&&s.nearest?.category==='supermarket'&&require('./sbiz-evidence.cjs').validPlace(s.nearest,{center:e.center,identity:e.identity,asOf:input.asOf});return s?.version==='2026-10-18-daily-shopping-v1'&&s.asOf===input.asOf&&s.status==='received'&&s.radiusM===1500&&Number.isInteger(s.returned)&&s.returned>=0&&Number.isFinite(Date.parse(s.checkedAt))&&require('./core.cjs').todayKst(new Date(s.checkedAt))===input.asOf&&access.point(s.center)&&access.point(e.center)&&access.distance(s.center,e.center)<=2;}
function queryRecord(tool,spec,center,asOf){
 const record=access.queryRecord(tool,spec,center,asOf,p=>eligible(p,{asOf})||eligibleMart(p));if(!record)return null;
 const data=access.payload(tool),raw=Array.isArray(data?.results)?data.results:[];
 // Keep the official page proof with the normalized venue; an unsupported mall
 // candidate is incomplete evidence, never a proven absence of shopping venues.
 for(const p of record.places){const source=raw.find(v=>String(v.kakao_place_id)===p.id&&v.name===p.name&&access.point(v)&&access.distance(v,p)<=2);if(source?.mallProof&&eligible(source,{asOf}))p.mallProof=structuredClone(source.mallProof);}
 const unverified=raw.filter(p=>open(p)&&mallCategory(p)&&!eligible(p,{asOf})).length;if(unverified){record.rejected+=unverified;record.unverifiedVenues=unverified;}
 return record;
}
function snapshot(tools,{center,asOf}){
 if(!access.point(center))return null;const queries=QUERIES.map(query=>tools.map(t=>queryRecord(t,{query,radiusM:RADIUS},center,asOf)).filter(Boolean).sort((a,b)=>Date.parse(b.checkedAt)-Date.parse(a.checkedAt))[0]||{query,radiusM:RADIUS,status:'unavailable',returned:null,truncated:false,places:[]});
 const batch=tools.map(t=>access.queryRecord(t,{category:'mart_large',radiusM:RADIUS},center,asOf,eligibleMart)).filter(Boolean).sort((a,b)=>Date.parse(b.checkedAt)-Date.parse(a.checkedAt))[0];
 if(!batch&&!queries.some(q=>q.checkedAt))return null;
 const group=(selected,kind)=>{const records=[...queries.filter(q=>selected.includes(q.query)),...(kind==='mart_large'&&batch?[batch]:[])],places=[...new Map(records.flatMap(q=>q.places).filter(p=>classify(p,{asOf})===kind).map(p=>[p.id,p])).values()].sort((a,b)=>a.distanceM-b.distanceM||a.id.localeCompare(b.id)),nearest=places[0]||null,complete=kind==='mart_large'&&access.usableRecord(batch)&&!batch.truncated||queries.filter(q=>selected.includes(q.query)).every(access.completeRecord);return {complete,status:nearest?'observed':complete?'empty':'unavailable',nearest,points:nearest?points(nearest.distanceM):complete?20:null,places};};
 const largeMart=group(MART_QUERIES,'mart_large'),shoppingMall=group(MALL_QUERIES,'shopping_large');
 return {version:VERSION,collectionPolicy:COLLECTION_POLICY,asOf,center:{...center},checkedAt:[...queries,...(batch?[batch]:[])].map(q=>q.checkedAt).filter(Boolean).sort().at(-1),queries:queries.map(({places,...q})=>q),...(batch?{batch:(({places,...q})=>q)(batch)}:{}),complete:largeMart.complete&&shoppingMall.complete,largeMart,shoppingMall,scope:'반경 5km의 등록 대형마트와 공식 시설정보를 대조한 대형 쇼핑시설 직선 접근성. 슈퍼·편의점·입점 매장은 대형마트에서 제외하며 규모가 확인되지 않은 업체는 대형 쇼핑시설로 표시하지 않습니다.'};
}
function validNaver(p,context){try{return p?.provider==='naver-public-map'&&require('./naver-facilities.cjs').validPlace(p,context);}catch{return false;}}
function validSnapshot(s,{center,asOf,identity}={}){
 if(s?.version!==VERSION||s.asOf!==asOf||!Array.isArray(s.queries)||!access.point(s.center)||!access.point(center)||access.distance(s.center,center)>2)return false;
 const checked=stamp=>sameDay(stamp,asOf);
 if(s.batch&&(s.batch.category!=='mart_large'||s.batch.query!=='category:mart_large'||s.batch.radiusM!==RADIUS||!checked(s.batch.checkedAt)||!Number.isInteger(s.batch.returned)||s.batch.returned<0||!Number.isInteger(s.batch.rejected)||s.batch.rejected<0))return false;
 if(s.batch?.nearestProven&&(!Number.isInteger(s.batch.matched)||s.batch.matched<1||s.batch.matched>s.batch.returned||s.largeMart?.status!=='observed'))return false;
 for(const [key,queries,accept]of [['largeMart',MART_QUERIES,eligibleMart],['shoppingMall',MALL_QUERIES,eligible]]){
  const g=s[key];if(!g||!['observed','empty','unavailable'].includes(g.status))return false;
  if(g.status==='observed'){const p=g.nearest,naver=p?.provider==='naver-public-map',sourceValid=naver?validNaver(p,{center,asOf,identity}):/^\d+$/.test(p?.id||'')&&p.sourceId===access.placeSourceId(p.id)&&p.url==='https://place.map.kakao.com/'+p.id;if(!p||!accept(p,{asOf})||!access.point(p)||!sourceValid||!checked(p.checkedAt)||!Number.isFinite(p.distanceM)||p.distanceM<0||p.distanceM>RADIUS||Math.abs(access.distance(center,p)-p.distanceM)>2||g.points!==points(p.distanceM)||naver&&(g.complete!==false||g.nearestProven===true))return false;}
  else if(g.status==='empty'&&(g.complete!==true||g.points!==20||!queries.every(query=>s.queries.some(q=>q.query===query&&checked(q.checkedAt)&&q.radiusM===RADIUS&&q.truncated===false&&q.rejected===0))))return false;
  else if(g.status==='unavailable'&&g.points!==null)return false;
 }
 return true;
}
function current(e,input){const s=e?.shopping;return validSnapshot(s,{center:e?.center,asOf:input.asOf,identity:e?.identity})&&QUERIES.every(query=>MART_QUERIES.includes(query)&&(s.largeMart.status==='observed'||access.usableRecord(s.batch))||MALL_QUERIES.includes(query)&&(s.shoppingMall.status==='observed'||s.collectionPolicy===COLLECTION_POLICY&&s.shoppingMall.status==='unavailable')||s.queries.some(q=>q.query===query&&q.checkedAt));}
function policySnapshot({center,asOf,identity}={}){if(!access.point(center))return null;const empty=()=>({complete:false,status:'unavailable',nearest:null,points:null,places:[]});return {version:VERSION,collectionPolicy:COLLECTION_POLICY,asOf,center:{...center},...(identity?.code?{identityCode:identity.code}:{}),queries:QUERIES.map(query=>({query,radiusM:RADIUS,status:'unavailable',returned:null,truncated:false,rejected:0})),complete:false,largeMart:empty(),shoppingMall:{...empty(),reason:'대형 쇼핑시설의 공식 규모·시설정보가 확인되지 않아 해당 세부지표는 평가하지 않습니다.'}};}
function mergeNaver(saved,places,{center,asOf,identity}={}){
 if(!access.point(center)||!identity?.code)return saved;
 const verified=(places||[]).filter(p=>validNaver(p,{center,asOf,identity})),candidates=verified.filter(p=>eligibleMart(p)||eligible(p,{asOf}));
 const s=saved?.version===VERSION?structuredClone(saved):policySnapshot({center,asOf,identity});
 if(s.asOf!==asOf||!access.point(s.center)||access.distance(s.center,center)>2)return saved;
 for(const [key,kind]of [['largeMart','mart_large'],['shoppingMall','shopping_large']]){const extra=candidates.filter(p=>classify(p,{asOf})===kind&&p.distanceM<=RADIUS);if(!extra.length)continue;const existing=(s[key]?.places||[s[key]?.nearest]).filter(Boolean).filter(p=>classify(p,{asOf})===kind),all=[...new Map([...existing,...extra].map(p=>[p.id,p])).values()].sort((a,b)=>a.distanceM-b.distanceM||a.id.localeCompare(b.id));s[key]={complete:false,nearestProven:false,emptyProven:false,status:'observed',nearest:all[0],points:points(all[0].distanceM),places:all};}
 s.complete=false;s.identityCode=identity.code;s.checkedAt=[s.checkedAt,...candidates.map(p=>p.checkedAt)].filter(Boolean).sort().at(-1);return s;
}
function points(distance){return BANDS.find(([limit])=>distance<=limit)?.[1]??null;}
module.exports={dailySnapshot,dailyCurrent,VERSION,RADIUS,MALL_QUERIES,MART_QUERIES,QUERIES,BANDS,COLLECTION_POLICY,mallProof,eligible,eligibleMart,supermarket,classify,snapshot,current,points,validSnapshot,mergeNaver,policySnapshot};
