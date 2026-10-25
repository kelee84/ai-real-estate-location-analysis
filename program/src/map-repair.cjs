'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {normalize,todayKst}=require('./core.cjs'),{compatibleName}=require('./property-identity.cjs'),{haversine}=require('./scoring.cjs');
const {payload}=require('./research.cjs');
const VERSION='2026-10-21-saved-map-recapture-v2';
const RAW_NAMES=new Set(['RTMS-trade.csv','RTMS-rent.csv','RTMS-trend-trade.csv','query.json','naver-land.json','archhub.json','sbiz-snapshot.json','hospital-snapshot.json','naver-nearby.json','academy-web.json','nearby-context.json','trend-query.json','score-evidence.json','regional-park.json','product-evidence.json','future-developments.json','map-capture.json','map-repair.json','research-evidence.json','school-zone.json','kapt-public.json','peer-evidence.json','score-refresh.json','score-refresh-research.json','living-access.json','shopping-evidence.json','school-achievement.json']);
const allowedRaw=name=>RAW_NAMES.has(name)||/^[ABC]-/.test(name)&&RAW_NAMES.has(name.slice(2));
const allowedFigure=name=>/^(?:ipjitalk-map|comparison-map|[ABC]-map)\.png$/.test(name);
const point=x=>x&&Number.isFinite(Number(x.lat))&&Number.isFinite(Number(x.lng))&&Number(x.lat)>=25&&Number(x.lat)<=45&&Number(x.lng)>=120&&Number(x.lng)<=135?{lat:Number(x.lat),lng:Number(x.lng)}:null;
const lot=x=>String(x||'').split('-').map(n=>/^\d+$/.test(n)?String(Number(n)):n).join('-');
function retainedMarkers(map,targets){
 const capture=require('./map-capture.cjs'),a=map?.markers,b=map?.markerDetails,v=map?.validation;
 if(map?.provider!=='NAVER'||!capture.safeMapUrl(map.url)||!new Set(['2026-10-20-key-facilities-map-v4','2026-10-21-one-level-zoom-map-v5','2026-10-21-default-zoom-bottom-list-map-v6',capture.VERSION]).has(map.version)||v?.coordinates!=='WGS84 (EPSG:4326)'||!(v.tileCount>=4&&v.tileCoverage>=.85&&v.basemapVisual?.textureRatio>=.7)||!Array.isArray(a)||!Array.isArray(b)||!a.length||a.length>150||a.length!==b.length||!targets.length)return null;
 const valid=p=>point(p)&&typeof p.name==='string'&&p.name.trim();if(!a.every(valid)||!b.every(p=>valid(p)&&typeof p.color==='string'&&p.color.trim())||new Set(b.map(p=>normalize(p.name))).size!==b.length||!b.every(p=>a.some(q=>normalize(p.name)===normalize(q.name)&&haversine(point(p),point(q))<=5))||!targets.every(t=>b.some(p=>capture.matchingMarker(p,t)&&haversine(point(p),t)<=5)))return null;
 return b.map(p=>({...point(p),name:p.name,color:p.color,info:p.info||''}));
}
function addressMatches(data,identity){
 if(!identity?.town||!identity?.lot)return false;
 const region=String(data?.region_code||'').slice(0,5);if(identity.regionCode&&region!==String(identity.regionCode))return false;
 if(data?.region?.eupmyeondong===identity.town&&lot(data.region.jibun)===lot(identity.lot))return true;
 const text=data?.normalized_address||data?.address_jibun||data?.address||'',town=String(identity.town).replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),match=String(text).match(new RegExp('(?:^|\\s)'+town+'\\s+(\\d+(?:-\\d+)?)(?=\\s|$)'));
 return !!match&&lot(match[1])===lot(identity.lot);
}
function identityEvidence(member){
 const identity=member.prices?.buildingResolution,building=member.input?.building||identity?.building;
 if(!identity||!building||!identity.building||!compatibleName(building,identity.building)||!identity.town||!identity.lot)throw new Error('보관된 보고서의 공식 단지명·법정동·지번이 없어 지도 대상의 위치를 검증할 수 없습니다. 단지를 다시 검색해 분석해 주세요.');
 const evidence=member.assessment?.evidence,equal=evidence&&compatibleName(evidence.building,building)&&evidence.identity?.code&&evidence.identity.code===identity.code&&evidence.identity.town===identity.town&&lot(evidence.identity.lot)===lot(identity.lot);
 const official=point(identity),preserved=equal?point(evidence.center):null;
 return {identity,building,evidence:equal?evidence:null,center:official||preserved,coordinateSource:official?'보고서의 국토교통부 공식 단지 기준점':preserved?'같은 공식 단지번호·법정동·지번으로 대조된 보관 근거 좌표':null};
}
function mapIssue(text){return /get_map_embed_url/.test(String(text))||/(?:입지톡|지도).*(?:미첨부|확보하지 못|누락|불러오지 못|표시되지|연결.*확인|재연결|로딩|자료.*반환되지|연결되지|캡처.*실패)/.test(String(text));}
function scopedPois(entry){
 const out=[],e=entry.evidence;if(!e?.center||!point(e.center)||haversine(e.center,entry.center)>100)return out;
 const sources=new Set([...(entry.member.sources||[]),...(e.sources||[])].map(s=>s?.id).filter(Boolean));
 const access=e.natureAccess;if(require('./nature-access.cjs').verified(access,{center:entry.center,asOf:entry.member.input.asOf})){const p=access.selected||access.trails[0];if(sources.has(p.source.id))out.push({lat:p.lat,lng:p.lng,name:p.name,color:'Green',info:p.pointRole+' · 실제 진입·보행 동선 별도 확인'});}
 for(const category of ['school_elementary','subway','park','mart_large']){
  const p=(e.places||[]).find(p=>p.category===category&&point(p)&&p.name&&sources.has(p.sourceId)&&haversine(entry.center,p)<=2000&&Number.isFinite(p.distanceM)&&Math.abs(haversine(entry.center,p)-p.distanceM)<=Math.max(35,p.distanceM*.08));
  if(p)out.push({lat:p.lat,lng:p.lng,name:String(p.name).slice(0,120),color:category==='school_elementary'?'Purple':category==='park'?'Green':'Blue',info:'기존 보고서에서 위치를 대조한 시설 · 등록 위치이며 배정·운영·실제 보행 경로는 별도 확인'});
 }
 return out;
}
async function containedDirectory(store,id){
 const directory=path.resolve(store.path(id)),root=path.resolve(store.root);if(path.dirname(directory)!==root)throw new Error('보고서 보관 경로를 확인하지 못했습니다.');
 const rootReal=await fs.realpath(root),stat=await fs.lstat(directory);if(stat.isSymbolicLink()||!stat.isDirectory())throw new Error('안전한 보고서 폴더가 아닙니다.');
 const actual=await fs.realpath(directory);if(path.dirname(actual)!==rootReal||path.basename(actual)!==id)throw new Error('보고서 폴더가 보관함 밖으로 연결되어 있습니다.');return actual;
}
async function copyPreserved(store,sourceId,newId){
 const source=await containedDirectory(store,sourceId),target=await containedDirectory(store,newId),copied={raw:[],figures:[]};
 for(const [folder,allowed]of [['raw',allowedRaw],['figures',allowedFigure]]){
  const from=path.join(source,folder),to=path.join(target,folder);let entries;try{const stat=await fs.lstat(from);if(stat.isSymbolicLink()||!stat.isDirectory())continue;entries=await fs.readdir(from,{withFileTypes:true});}catch(e){if(e.code==='ENOENT')continue;throw e;}
  await fs.mkdir(to,{recursive:true});for(const entry of entries){if(!entry.isFile()||entry.isSymbolicLink()||!allowed(entry.name))continue;const file=path.join(from,entry.name),real=await fs.realpath(file);if(path.dirname(real)!==from)throw new Error('원자료의 보관 경로가 올바르지 않습니다.');await fs.copyFile(real,path.join(to,entry.name));copied[folder].push(entry.name);}
 }
 return copied;
}
async function removeGenerated(store,id,sourceId){if(!id||id===sourceId)return;let directory;try{directory=await containedDirectory(store,id);}catch(e){if(e.code==='ENOENT')return;throw e;}await fs.rm(directory,{recursive:true,force:true});}
async function repairMap(service,reportId){
 if(service.active)throw new Error('진행 중인 작업이 있습니다. 완료하거나 중지한 뒤 지도를 다시 불러와 주세요.');
 if(typeof service.captureMap!=='function'||typeof service.bridge?.evidenceSession!=='function'||typeof service.bridge?.evidenceTool!=='function')throw new Error('지도 재조회 기능을 사용할 수 없습니다. 프로그램을 최신 버전으로 업데이트해 주세요.');
 const controller=new AbortController(),activity={controller,kind:'map-repair',reportId};service.active=activity;let id,saved=false;
 const check=()=>{if(controller.signal.aborted)throw new Error('지도를 다시 불러오는 작업을 중지했습니다.');};
 const progress=message=>service.onEvent?.({stage:'map',message});
 try{
  const original=await service.store.load(reportId);check();if(original.id!==reportId||original.demo)throw new Error('실제 매물의 보관된 보고서에서 지도를 다시 불러와 주세요.');
  const members=original.mode==='comparison'?original.members:[original];if(!Array.isArray(members)||!members.length||members.length>3||members.some(m=>m.input?.asset!=='apartment'))throw new Error('아파트 보고서는 매물 최대 3개까지 지도를 다시 불러올 수 있습니다.');
  const entries=members.map((member,index)=>({...identityEvidence(member),member,key:original.mode==='comparison'?String.fromCharCode(65+index):null}));
  progress('보관된 보고서의 단지명·주소와 지도 연결을 확인하고 있습니다.');
  const tools=[];let session,map=null,reusedStoredLink=false,mcpRequests=0;
  const call=async(tool,args)=>{session??=await service.bridge.evidenceSession({model:service.settings?.model,signal:controller.signal});mcpRequests++;const t=await service.bridge.evidenceTool(session,tool,args,{signal:controller.signal});tools.push(t);return t;};
  for(const entry of entries){if(entry.center)continue;check();const region=entry.member.input.target.split(/\s+/).slice(0,2).join(' '),address=[region,entry.identity.town,entry.identity.lot].join(' '),t=await call('get_geocode',{address});const data=payload(t);
   if(data?.confidence!=='exact'||!addressMatches(data,entry.identity)||!point(data))throw new Error(`${entry.building}: 공식 법정동·지번과 정확히 일치하는 주소 좌표를 찾지 못했습니다. 단지를 다시 검색해 주세요.`);
   entry.center=point(data);entry.coordinateSource='입지톡 정확 일치 주소 조회 · 공식 법정동·지번 대조';
  }
  check();const targets=entries.map(e=>({...e.center,name:e.building})),retained=retainedMarkers(original.map,targets);
  id=randomUUID();const directory=service.store.path(id);await fs.mkdir(path.join(directory,'raw'),{recursive:true});await fs.mkdir(path.join(directory,'figures'),{recursive:true});
  const copied=await copyPreserved(service.store,reportId,id);check();
  if(retained&&require('./map-capture.cjs').safeSavedCandidate(original.map,targets)){
   progress('보관된 지도 링크와 전체 마커를 재사용해 지도 배치를 바꾸고 있습니다.');
   map=await service.captureMap([],directory,{targets,savedMap:original.map,signal:controller.signal});check();
   if(map?.status!=='ready'||!map.file)throw new Error(map?.reason||'보관된 지도를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.');
   reusedStoredLink=true;
  }
  if(!map){
   const markers=retained||entries.map((e,i)=>({...e.center,name:(e.key?e.key+' · ':'')+e.building,color:['Red','Blue','Green'][i],info:'분석 대상 · 공식 단지 기준점'})),seen=new Set(markers.map(m=>normalize(m.name)+':'+m.lat+':'+m.lng));
   if(!retained)for(const entry of entries)for(const p of scopedPois(entry)){const key=normalize(p.name)+':'+p.lat+':'+p.lng;if(markers.length>=9)break;if(!seen.has(key)){seen.add(key);markers.push(p);}}
   progress('대상 단지와 확인된 주요 시설을 입지톡 지도에 표시하고 있습니다.');
   const center={lat:targets.reduce((s,t)=>s+t.lat,0)/targets.length,lng:targets.reduce((s,t)=>s+t.lng,0)/targets.length};await call('get_map_embed_url',{markers,center,maptype:'normal',title:entries.length>1?entries.length+'개 아파트 비교 지도':entries[0].building+' 입지 지도'});check();
   map=await service.captureMap(tools,directory,{targets,signal:controller.signal});check();
  }
  if(!map?.file||map.status==='unavailable')throw new Error(map?.reason||'지도의 대상 마커와 배경을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.');
  if(!allowedFigure(map.file)||path.basename(map.file)!==map.file)throw new Error('생성된 지도 파일의 경로를 확인하지 못했습니다.');
  const image=await fs.lstat(path.join(directory,'figures',map.file));if(!image.isFile()||image.isSymbolicLink()||image.size===0)throw new Error('생성된 지도 이미지 파일을 찾지 못했습니다. 다시 시도해 주세요.');
  await fs.writeFile(path.join(directory,'raw','map-capture.json'),JSON.stringify(map,null,2));
  const checkedAt=new Date().toISOString(),repair={version:VERSION,sourceReportId:reportId,checkedAt,aiCalls:0,mcpRequests,reusedStoredLink,retainedMarkerCount:retained?.length||null,priceAndAssessmentUnchanged:true,coordinates:'WGS84 (EPSG:4326)',targets:entries.map(e=>({name:e.building,key:e.key,...e.center,identity:{code:e.identity.code,town:e.identity.town,lot:e.identity.lot},coordinateSource:e.coordinateSource})),preserved:copied,mapSource:map.url||null};
  await fs.writeFile(path.join(directory,'raw','map-repair.json'),JSON.stringify(repair,null,2));
  const report=structuredClone(original);Object.assign(report,{id,title:String(original.title).replace(/ · 지도 보완$/,'')+' · 지도 보완',map,createdAt:checkedAt,mapCheckedAt:checkedAt,mapRepair:repair,revisionOf:reportId,requestFingerprint:null,mapConnected:true});
  report.issues=(report.issues||[]).filter(issue=>!mapIssue(issue));report.status=report.issues.length?'검토 필요':'초안';
  report.sources=[...(report.sources||[])];if(map.url)report.sources.push({id:'map-'+id,title:'입지톡 실제 렌더링 지도 · NAVER',url:map.url,checkedAt:todayKst(new Date(checkedAt))});
  if(report.mode==='comparison')for(const member of report.members){if(member.map?.file&&!copied.figures.includes(member.map.file))member.map=null;}
  report.verification={...report.verification,map:(reusedStoredLink?'저장된 지도를 새 배치로 다시 캡처했습니다.':'지도만 다시 조회했습니다.')+' 거래자료·평가 점수·본문의 기존 기준일과 조회일은 유지했습니다.',mapCheckedAt:checkedAt};
  check();const result=await service.store.save(report);saved=true;service.onEvent?.({stage:'done',message:'지도를 보완한 새 보고서를 저장했습니다. 기존 보고서는 그대로 보관했습니다.',reportId:id});return result;
 }finally{try{if(id&&!saved)await removeGenerated(service.store,id,reportId);}finally{if(service.active===activity)service.active=null;}}
}
module.exports={VERSION,repairMap,addressMatches,identityEvidence,allowedRaw,allowedFigure,mapIssue,copyPreserved,removeGenerated,retainedMarkers};
