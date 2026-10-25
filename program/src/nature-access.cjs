'use strict';
const {createHash}=require('node:crypto');
const {todayKst,validDate,normalize}=require('./core.cjs');
const {boundedBytes}=require('./school-zone.cjs');
const VERSION='2026-10-18-nature-access-v1',QUERIES=['등산로입구','숲길','산책로'],RADIUS=3000;
const MAX_TRAILS=256;
const CRITERIA='대표 대형공원과 조회된 숲길·등산로·수변 산책로의 접근성을 함께 대조합니다. 확인된 자연공간 중 가장 가까운 등록 진입점·시설 기준점 또는 공식 경로점의 직선거리로 접근 배점 50%를 부분 평가합니다. 같은 공간을 중복 가산하지 않습니다. 출입구·실제 보행 동선·경사·통제·세대 조망과 환경 제약은 미확인 시 점수에 넣지 않습니다.';
const coord=p=>Number.isFinite(p?.lat)&&Number.isFinite(p?.lng)&&p.lat>=25&&p.lat<=45&&p.lng>=120&&p.lng<=135;
function distance(a,b){return require('./scoring.cjs').haversine(a,b);}
const fresh=(value,asOf)=>{const day=String(value||'').slice(0,10),age=(Date.parse(asOf)-Date.parse(day))/86400000;return validDate(day)&&Number.isFinite(age)&&age>=0&&age<=30;};
function lines(geometry,depth=0){if(!geometry||depth>8)return [];if(geometry.type==='FeatureCollection')return Array.isArray(geometry.features)?geometry.features.slice(0,100).flatMap(f=>lines(f,depth+1)):[];if(geometry.type==='Feature')return lines(geometry.geometry,depth+1);if(geometry.type==='LineString')return Array.isArray(geometry.coordinates)?[geometry.coordinates]:[];if(geometry.type==='MultiLineString')return Array.isArray(geometry.coordinates)?geometry.coordinates:[];return [];}
function nearest(geometry,center){
 if(!coord(center))return null;const paths=lines(geometry);if(paths.reduce((n,p)=>n+(Array.isArray(p)?p.length:50001),0)>50000)return null;
 let best;const scale=Math.cos(center.lat*Math.PI/180);
 for(const path of paths){if(!Array.isArray(path)||path.length<2)continue;for(let i=1;i<path.length;i++){
  const a={lng:path[i-1]?.[0],lat:path[i-1]?.[1]},b={lng:path[i]?.[0],lat:path[i]?.[1]};if(!coord(a)||!coord(b)||distance(a,b)>800)continue;
  const ax=(a.lng-center.lng)*scale,ay=a.lat-center.lat,bx=(b.lng-center.lng)*scale,by=b.lat-center.lat,dx=bx-ax,dy=by-ay,t=Math.max(0,Math.min(1,-(ax*dx+ay*dy)/(dx*dx+dy*dy||1)));
  const p={lng:a.lng+(b.lng-a.lng)*t,lat:a.lat+(b.lat-a.lat)*t},d=distance(center,p);if(!best||d<best.distanceM)best={...p,distanceM:d};
 }}return best?{...best,distanceM:Math.round(best.distanceM)}:null;
}
function placeCandidates(tools,{center,asOf}){
 const result=new Map();
 for(const t of tools||[]){if(t.server!=='ipzitalk'||t.tool!=='search_by_nearby_keyword'||!QUERIES.includes(t.arguments?.query)||t.error)continue;const d=require('./research.cjs').payload(t);if(!fresh(d?.metadata?.collected_at,asOf)||!coord(d?.center)||distance(center,d.center)>100||d.radius_m!==RADIUS)continue;
  for(const p of d.results||[]){const name=String(p.name||''),category=String(p.kakao_category_name||''),id=String(p.kakao_place_id||'');
   if(!coord(p)||!/^\d+$/.test(id)||!/등산로|숲길|자락길|둘레길|산책로|탐방로|나들길/.test(name)||/예정|폐쇄|출입금지|공사중/.test(name)||!/도보여행|등산로|입출구/.test(category))continue;
   const dist=distance(center,p),reported=Number(p.distance_m);if(dist>RADIUS||!Number.isFinite(reported)||Math.abs(dist-reported)>Math.max(35,reported*.08))continue;
   const source={id:'ev-nature-place-'+id,title:'카카오 등록 숲길·진입 지점 · '+name,url:'https://place.map.kakao.com/'+id,checkedAt:todayKst(new Date(d.metadata.collected_at))};
   result.set(id,{id,name,kind:'registered-trail',lat:p.lat,lng:p.lng,distanceM:Math.round(dist),pointRole:/입구|진입/.test(name)?'등록 진입 지점':'등록 시설 기준점',source,limited:!!d.metadata.truncated});
  }
 }return [...result.values()].sort((a,b)=>a.distanceM-b.distanceM);
}
function routeLinks(html){const result=[];for(const match of html.matchAll(/<a\b[^>]*href="(\/trail\/view\.do\?[^"<>]+)"[^>]*title="\[새창열림\]\s*([^"<>]+?)\s*상세보기"/g)){const name=match[2].trim();if(!/산|숲|둘레|자락|수변|하천|강변|산책|생태|해안/.test(name))continue;const url=new URL(match[1].replaceAll('&amp;','&'),'https://gil.seoul.go.kr');if(/^\d+$/.test(url.searchParams.get('sc_trailSn')))result.push({name,url:url.href});}return result;}
const catalogueCache=new Map();
async function discoverSeoul(places,{center,signal,fetchImpl=fetch,readTrail}){
 if(!readTrail||center.lat<37.4||center.lat>37.75||center.lng<126.75||center.lng>127.2)return [];
 const terms=[...new Set(places.map(p=>p.name.match(/^(.{1,12}?산)(?=\s|자락|둘레|숲|등산|산책)/)?.[1]||p.name.replace(/(?:\s*(?:입구|진입로|진입점))$/,'')).filter(s=>s.length>=2&&s.length<=25))].slice(0,2),routes=[];
 for(const term of terms){
  const cacheKey=todayKst()+':'+term,cached=catalogueCache.get(cacheKey);let found=cached?.fetchImpl===fetchImpl?cached.routes:null;
  if(!found){const url='https://gil.seoul.go.kr/trail/list.do?key=2405200007&sw='+encodeURIComponent(term),html=(await boundedBytes(url,{signal,fetchImpl,maxBytes:2*1024*1024})).toString('utf8');found=routeLinks(html).filter(r=>normalize(r.name).startsWith(normalize(term)));catalogueCache.set(cacheKey,{fetchImpl,routes:found});}
  for(const entry of found.slice(0,2)){try{
   const html=(await boundedBytes(entry.url,{signal,fetchImpl,maxBytes:2*1024*1024})).toString('utf8'),link=html.match(/https:\/\/map\.seoul\.go\.kr\/smgis2\/poiViewMap\?ti=\d+&(?:amp;)?pi=[A-Za-z0-9_-]+&(?:amp;)?lang=ko/);if(!link)continue;
   const geometrySource=link[0].replaceAll('&amp;','&'),data=await readTrail(geometrySource,{signal});if(normalize(data.name)!==normalize(entry.name))continue;
   const point=nearest(data.geometry,center);if(!point||point.distanceM>RADIUS)continue;
   const id='seoul-'+data.theme+'-'+data.id,source={id:'ev-nature-'+id,title:'서울시 공식 산책로 · '+entry.name,url:entry.url,checkedAt:todayKst()};
   routes.push({id,name:entry.name,kind:'official-route',...point,pointRole:'공식 경로의 최근접점·출입구 미확인',source,geometrySource,geometry:data.geometry,updatedAt:data.updatedAt});
  }catch(error){if(signal?.aborted)throw error;}}
 }return routes;
}
function seedPlaces(names){return [...new Set((Array.isArray(names)?names:[]).filter(name=>typeof name==='string'&&name.length>=2&&name.length<=80&&!/[<>\u0000-\u001f]/.test(name)&&/산|숲|둘레|자락|수변|하천|강변|산책|생태|해안|탐방|나들/.test(name)&&!/예정|폐쇄|출입금지|공사중/.test(name)).map(name=>name.trim()))].slice(0,4).map(name=>({name}));}
function sameDayTrails(trails,{center,asOf}){
 return (Array.isArray(trails)?trails:[]).filter(p=>String(p?.source?.checkedAt||'').slice(0,10)===asOf).slice(0,MAX_TRAILS).filter(p=>verified({version:VERSION,asOf,center,checkedAt:asOf,status:'verified',trails:[p]},{center,asOf})).map(p=>structuredClone(p));
}
function routeHash(p){return createHash('sha256').update(JSON.stringify({id:p.id,name:p.name,geometrySource:p.geometrySource,geometry:p.geometry})).digest('hex');}
function catalogueRoutes(value,{center,asOf}){
 const publicTrails=require('./public-trails.cjs');if(!coord(center)||!publicTrails.validCatalogue(value,{asOf}))return [];
 const routes=[];for(const r of value.rows){
  if(!/산|숲|둘레|자락|수변|하천|강변|산책|생태|해안|계곡|천|벚꽃/.test(r.name)&&!/숲|하천|계곡/.test(r.category||''))continue;
  if(/예정|폐쇄|출입금지|공사중/.test(r.name))continue;const point=nearest(r.geometry,center);if(!point||point.distanceM>RADIUS)continue;
  const id='seoul-'+r.theme+'-'+r.id,geometrySource='https://map.seoul.go.kr/smgis2/poiViewMap?'+new URLSearchParams({ti:r.theme,pi:r.id,lang:'ko'}),p={id,name:r.name,kind:'official-route',...point,pointRole:'공식 경로의 최근접점·출입구 미확인',source:{id:'ev-nature-'+id,title:'서울시 공식 산책로 · '+r.name,url:geometrySource,checkedAt:todayKst(new Date(value.checkedAt))},geometrySource,geometry:structuredClone(r.geometry)};
  if(r.updatedAt&&validDate(String(r.updatedAt).slice(0,10))&&String(r.updatedAt).slice(0,10)<=asOf)p.updatedAt=r.updatedAt;
  p.catalogueProof={version:value.version,sourceUrl:value.sourceUrl,checkedAt:value.checkedAt,declaredCount:value.declaredCount,rowsRead:value.rows.length,recordHash:routeHash(p)};routes.push(p);
 }return routes.sort((a,b)=>a.distanceM-b.distanceM||a.id.localeCompare(b.id));
}
function checkAbort(signal){if(signal?.aborted)throw signal.reason||new Error('숲길 조회를 중지했습니다.');}
async function query({center,asOf,call,signal,fetchImpl=fetch,readTrail,seedNames=[],initialTrails=[]}){
 const base={version:VERSION,asOf,center,checkedAt:new Date().toISOString(),status:'unavailable',criteria:CRITERIA,trails:[],warnings:[]};
 checkAbort(signal);
 if(!coord(center)||asOf!==todayKst())return {...base,reason:'현재 기준의 단지 좌표·숲길 자료가 필요합니다. 과거 보고서에 현재 경로를 대신 적용하지 않았습니다.'};
 // A public search name is only a catalogue hint. Geometry and its official
 // source must independently establish the coordinate and straight distance.
 const previous=sameDayTrails(initialTrails,{center,asOf});let official=previous.filter(p=>p.kind==='official-route');
 const discover=async places=>{try{return await discoverSeoul(places,{center,signal,fetchImpl,readTrail});}catch(error){if(signal?.aborted)throw error;base.warnings.push('공식 산책로 경로 조회 미완료: '+error.message);return [];}};
 let catalogue=null;if(typeof readTrail?.catalogue==='function'&&center.lat>=37.4&&center.lat<=37.75&&center.lng>=126.75&&center.lng<=127.2){try{const value=await readTrail.catalogue({signal});if(require('./public-trails.cjs').validCatalogue(value,{asOf})){catalogue={sourceUrl:value.sourceUrl,checkedAt:value.checkedAt,rowsRead:value.rows.length};official=[...catalogueRoutes(value,{center,asOf}),...official];}else base.warnings.push('공식 산책로 전체 목록의 날짜·완전성을 확인하지 못했습니다.');}catch(error){if(signal?.aborted)throw error;base.warnings.push('공식 산책로 전체 목록 조회 미완료: '+error.message);}}
 if(!official.some(p=>p.distanceM<=300))official.push(...await discover(seedPlaces(seedNames)));
 checkAbort(signal);
 official=[...new Map(official.map(p=>[p.id,p])).values()].filter(p=>verified({...base,status:'verified',trails:[p]},{center,asOf}));
 const close=official.filter(p=>p.distanceM<=300).sort((a,b)=>a.distanceM-b.distanceM);
 if(close.length){const trails=[...new Map([...official,...previous].map(p=>[p.id,p])).values()].sort((a,b)=>a.distanceM-b.distanceM||a.id.localeCompare(b.id));return {...base,status:'verified',trails,limited:true,scope:'확인한 공식 경로의 직선 접근성 · 주변 자연공간 전수 미검증',reason:'공식 경로의 최근접점이 직선 300m 이내로 확인되어 접근성의 최고 배점 구간을 충족했습니다. 등록 시설의 추가 검색은 생략했으며 실제 출입구·보행 경로와 주변 자연공간 전체는 확인하지 않았습니다.',collection:{officialFirst:true,...(catalogue?{catalogue}:{}),skippedKeywordQueries:[...QUERIES],skipReason:'verified-official-route-within-maximum-distance-band'}};}
 const tools=[],attempts=await Promise.allSettled(QUERIES.map(query=>call('search_by_nearby_keyword',{query,center_lat:center.lat,center_lng:center.lng,radius_m:RADIUS})));
 for(const attempt of attempts){if(attempt.status==='fulfilled'&&attempt.value)tools.push(attempt.value);else if(attempt.status==='rejected'){if(signal?.aborted)throw attempt.reason;base.warnings.push('일부 자연공간 검색 미완료');}}
 checkAbort(signal);
 const places=placeCandidates(tools,{center,asOf});official=[...new Map([...official,...await discover(places)].map(p=>[p.id,p])).values()];checkAbort(signal);
 const routeNames=new Set(official.map(p=>normalize(p.name))),trails=[...new Map([...official,...places.filter(p=>!routeNames.has(normalize(p.name))),...previous].map(p=>[p.id,p])).values()].sort((a,b)=>a.distanceM-b.distanceM||a.id.localeCompare(b.id));
 return {...base,status:trails.length?'verified':'unavailable',trails,reason:trails.length?'조회된 등록 숲길·진입 지점과 확인 가능한 공식 경로를 대조했습니다.':'비교 가능한 숲길·등산로·산책로 위치를 확인하지 못했습니다.',limited:places.some(p=>p.limited),collection:{officialFirst:true,...(catalogue?{catalogue}:{}),skippedKeywordQueries:[]}};
}
function current(data,{center,asOf}){return data?.version===VERSION&&data.asOf===asOf&&coord(center)&&coord(data.center)&&distance(center,data.center)<=100&&fresh(data.checkedAt,asOf);}
function verified(data,{center,asOf}){
 if(!current(data,{center,asOf})||data.status!=='verified'||!Array.isArray(data.trails)||!data.trails.length||data.trails.length>MAX_TRAILS)return false;
 return data.trails.every(p=>{if(!coord(p)||!Number.isFinite(p.distanceM)||p.distanceM<0||p.distanceM>RADIUS||Math.abs(distance(center,p)-p.distanceM)>2||!fresh(p.source?.checkedAt,asOf)||!p.source?.id)return false;
  if(p.kind==='official-route'){const publicTrails=require('./public-trails.cjs'),safe=publicTrails.safeUrl(p.geometrySource),proof=p.catalogueProof,legacy=/^https:\/\/gil\.seoul\.go\.kr\/trail\/view\.do\?/.test(p.source.url),catalogue=proof?.version===publicTrails.CATALOGUE_VERSION&&proof.sourceUrl===publicTrails.CATALOGUE_URL&&Number.isFinite(Date.parse(proof.checkedAt))&&Date.parse(proof.checkedAt)<=Date.now()&&todayKst(new Date(proof.checkedAt))===asOf&&Number.isInteger(proof.declaredCount)&&proof.declaredCount>0&&proof.declaredCount<=500&&proof.rowsRead===proof.declaredCount&&proof.recordHash===routeHash(p)&&p.source.url===p.geometrySource&&safe?.searchParams.get('ti')==='100715'&&p.id==='seoul-100715-'+safe?.searchParams.get('pi');if(p.pointRole!=='공식 경로의 최근접점·출입구 미확인'||!safe||(!legacy&&!catalogue))return false;const point=nearest(p.geometry,center);return !!point&&Math.abs(point.distanceM-p.distanceM)<=2&&distance(point,p)<2;}
  return p.kind==='registered-trail'&&/^https:\/\/place\.map\.kakao\.com\/\d+$/.test(p.source.url)&&/등록/.test(p.pointRole);
 });
}
function apply(scores,e,{input,distanceScore}){
 const data=e.natureAccess;if(!verified(data,{center:e.center,asOf:input.asOf}))return false;
 const park=require('./regional-park.cjs').verified(e.nature,{center:e.center,asOf:input.asOf})?{...e.nature.selected,kind:'regional-park',pointRole:'공원 등록 기준점',source:e.nature.source}:null;
 const candidates=[...(park?[park]:[]),...data.trails].sort((a,b)=>a.distanceM-b.distanceM||a.id.localeCompare(b.id)),p=candidates[0],row=scores.find(s=>s.name==='자연환경'),sourceIds=[p.source.id];
 data.selected=p;data.candidates=candidates;e.sources=[...new Map([...(e.sources||[]),...data.trails.map(p=>p.source)].map(s=>[s.id,s])).values()];
 if(p.kind!=='regional-park'){delete row.regionalPark;delete row.landmarkPark;delete row.parkSizeRatio;}
 Object.assign(row,{score:distanceScore(p.distanceM),status:'partial',coverage:50,scope:'공원·숲길·산책로 직선 접근성',observed:`${p.name} · ${p.pointRole} · 직선 약 ${p.distanceM.toLocaleString('ko-KR')}m`+(data.limited?(data.collection?.skipReason?' · 확인한 경로 기준':' · 조회된 시설 기준'):''),needed:'실제 진입 동선·보행거리·경사·계단·개방 및 통제 상태 / 세대 조망·소음·재해 제약',method:VERSION+'. '+CRITERIA+' 직선거리 ≤300m95 / ≤600m85 / ≤1000m70 / ≤1500m55 / 초과35. 확인 배점50%.',sourceIds,calculation:[{indicator:'확인된 자연공간 직선 접근',value:p.distanceM,unit:'m (직선)',weight:50,points:distanceScore(p.distanceM),sourceId:p.source.id}]});row.reason=row.observed+'. '+row.needed+'은 별도 확인이 필요합니다.';return true;
}
function compact(data){if(!data)return null;const slim=p=>{const {geometry,...out}=p;return out;};return {...data,trails:data.trails?.map(slim),candidates:data.candidates?.map(slim),selected:data.selected?slim(data.selected):undefined};}
module.exports={VERSION,QUERIES,RADIUS,CRITERIA,nearest,placeCandidates,routeLinks,discoverSeoul,catalogueRoutes,query,current,verified,apply,compact};
