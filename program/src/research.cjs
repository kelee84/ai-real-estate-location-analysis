'use strict';
const {parse}=require('csv-parse/sync');
const {normalize,rowToContract,sixMonthWindow,todayKst,validDate}=require('./core.cjs');
const {compatibleName}=require('./property-identity.cjs');
const scoring=require('./scoring.cjs');
const peerRules=require('./peer-comparison.cjs');
function payload(t){if(t?.result?.isError)return null;const r=t?.result;if(r?.structuredContent&&typeof r.structuredContent==='object')return r.structuredContent;for(const c of r?.content||[])if(c.type==='text')try{return JSON.parse(c.text);}catch{}return null;}
const dailyShoppingSnapshot=(...args)=>require('./shopping.cjs').dailySnapshot(...args);
function regionalRows(raw){const f=raw?.find(r=>r.deal==='trade');if(!f)return [];const rows=parse(new TextDecoder('euc-kr',{fatal:true}).decode(Buffer.from(f.bytes,'base64')),{relax_column_count:true,skip_empty_lines:true}),at=rows.findIndex(r=>r[0]?.replace(/^\uFEFF/,'').trim()==='NO');if(at<0)return [];const h=rows[at].map(s=>s.trim());if(!['시군구','단지명','전용면적(㎡)','거래금액(만원)','계약년월','계약일','해제사유발생일'].every(k=>h.includes(k)))return [];return rows.slice(at+1).filter(r=>r.length===h.length).map(r=>rowToContract(Object.fromEntries(h.map((k,i)=>[k,r[i]])),'trade'));}
const lot=s=>String(s||'').split('-').map(n=>/^\d+$/.test(n)?String(Number(n)):n).join('-');
function peerEvidence({input,prices,raw,nearby,batch,basic,center,checkedAt=new Date().toISOString()}){
 const period=sixMonthWindow(input.asOf),identity=prices.buildingResolution,target=prices.rows.filter(r=>r.kind==='trade'),ageBasis=peerRules.targetYearBasis({input,prices,basic}),year=ageBasis?.year;
 const out={status:'unavailable',version:peerRules.SAME_TOWN_VERSION,scope:peerRules.SAME_TOWN_SCOPE,reason:'유사 조건의 비교 단지·매매 표본을 확보하지 못했습니다.',period,checkedAt,criteria:'같은 법정동·'+peerRules.COMMON_CRITERIA,targetAge:ageBasis,peers:[]};
 const fresh=metadata=>{const date=Date.parse(metadata?.collected_at);if(!Number.isFinite(date))return false;const day=todayKst(new Date(date)),age=(Date.parse(input.asOf)-Date.parse(day))/86400000;return age>=0&&age<=30;};
 if(!fresh(nearby?.metadata)){out.reason='비교 단지 검색 자료의 조회일이 없거나 기준일·유효기간과 맞지 않아 가격 비교를 보류합니다.';return out;}
 if(!target.length||!input.types.includes('trade')){out.reason='선택한 거래 유형·기간·면적에서 매매 표본이 없어 상대 매매가격을 산출하지 못했습니다.';return out;}
 if(prices.areaResolution){out.reason='요청한 타입과 적용 거래 면적이 달라 가격 비교 점수를 보류합니다.';return out;}
 if(target.length<3||!Number.isInteger(year)||year<1900){out.reason=target.length<3?'대상 단지의 비교 가능한 매매 계약이 3건 미만입니다.':'대상 단지 사용승인 연도 또는 검증된 거래 기록의 일치한 건축연도가 없어 유사 연식을 확인할 수 없습니다.';return out;}
 const targetTown=identity?.town,targetDistrict=peerRules.districtOf(target[0].location,targetTown),origin=center||prices.buildingResolution,area=target.reduce((s,r)=>s+r.area,0)/target.length,tolerance=Math.min(area*.05,6.611569),contracts=regionalRows(raw),candidates=nearby?.results||[],seen=new Set(),seenPhysical=new Set(),seenContracts=new Set(target.map(t=>t.id)),seenKeys=new Set(target.map(t=>peerRules.contractKey(t))),targetPhysical=new Set(target.map(t=>[t.location,lot(t.lot),normalize(t.building)].join('|'))),qualified=[];
 if(!targetTown||!targetDistrict||target.some(t=>t.cancelled||!validDate(t.date)||t.date<period.start||t.date>period.end||!Number.isFinite(t.price)||t.price<=0||!Number.isFinite(t.area)||t.area<=0||t.areaBasis!=='전용면적')){out.reason='대상 단지의 거래 기간·주소·금액·전용면적을 확인하지 못했습니다.';return out;}
 const searchCenter=nearby.query?.center;if(!searchCenter||!Number.isFinite(searchCenter.lat)||!Number.isFinite(searchCenter.lng)||searchCenter.lat<25||searchCenter.lat>45||searchCenter.lng<120||searchCenter.lng>135||!Number.isFinite(origin?.lat)||!Number.isFinite(origin?.lng)||scoring.haversine(origin,searchCenter)>100){out.reason='비교 단지 검색 중심이 공식 대상 단지와 일치하지 않습니다.';return out;}
 if(Number.isFinite(identity?.lat)&&Number.isFinite(identity?.lng)&&scoring.haversine(origin,identity)>100){out.reason='가격 비교 기준 좌표가 공식 대상 단지 기준점과 일치하지 않습니다.';return out;}
 const entries=[...(batch?.results||[])].sort((a,b)=>{const at=peerRules.addressFacts(a.data?.basic?.address_jibun)?.town,bt=peerRules.addressFacts(b.data?.basic?.address_jibun)?.town;return Number(bt===targetTown)-Number(at===targetTown);});
 for(const entry of entries){
  const d=entry.status==='success'?entry.data:null,b=d?.basic,c=candidates.find(c=>c.identifiers?.kapt_code===d?.kapt_code);if(!b||!c||!fresh(d.metadata)||d.metadata.basic_updated_at&&(!validDate(String(d.metadata.basic_updated_at).slice(0,10))||String(d.metadata.basic_updated_at).slice(0,10)>input.asOf)||seen.has(d.kapt_code)||d.kapt_code===basic?.kaptCode)continue;
  const approval=String(b.use_approval_date||c.move_in||'').replace(/^(\d{4})(\d{2})(\d{2})$/,'$1-$2-$3'),peerYear=Number(approval.slice(0,4));
  if(!validDate(approval)||approval>input.asOf||Math.abs(peerYear-year)>5||!Number.isFinite(c.lat)||!Number.isFinite(c.lng)||c.lat<25||c.lat>45||c.lng<120||c.lng>135||c.distance_m==null||String(c.distance_m).trim()===''||!Number.isFinite(Number(c.distance_m))||Number(c.distance_m)<0||Number(c.distance_m)>2000||!Number.isFinite(origin?.lat)||!Number.isFinite(origin?.lng))continue;
  const measured=scoring.haversine(origin,c);if(measured>2000||Math.abs(measured-Number(c.distance_m))>Math.max(35,Number(c.distance_m)*.08))continue;
  const address=b.address_jibun||'',addressIdentity=peerRules.addressFacts(address),bjdCode=String(b.bjd_code||''),regionProof=!bjdCode&&peerRules.validRegionProof(d.regionProof,{address:addressIdentity,candidate:c,regionCode:identity?.regionCode,asOf:input.asOf})?d.regionProof:null,sourceRegion=(bjdCode||regionProof?.response.region_code||'').slice(0,5);if(!addressIdentity||(!/^\d{10}$/.test(bjdCode)&&!regionProof)||normalize(addressIdentity.district)!==targetDistrict||identity?.regionCode&&sourceRegion!==String(identity.regionCode)||!compatibleName(c.name||d.name,d.name))continue;
  const {town}=addressIdentity;
  if(town===targetTown&&addressIdentity.lot===lot(identity.lot)&&compatibleName(d.name,input.building)||qualified.some(p=>p.town===town&&lot(p.lot)===addressIdentity.lot&&compatibleName(p.name,d.name)))continue;
  // Adjacent-town candidates require the official district code as well as
  // the full registered address. Radius alone cannot authorize another district.
  if(town!==targetTown&&(!/^\d{5}$/.test(String(identity?.regionCode||''))||!/^\d{10}$/.test(bjdCode)&&!regionProof))continue;
  const rows=contracts.filter(t=>!t.cancelled&&validDate(t.date)&&!seenContracts.has(t.id)&&!seenKeys.has(peerRules.contractKey(t))&&t.date>=period.start&&t.date<=period.end&&Number.isFinite(t.price)&&t.price>0&&Number.isFinite(t.area)&&t.area>0&&Math.abs(t.area-area)<=tolerance&&Math.abs(t.area-area)<6.611569&&t.areaBasis==='전용면적'&&normalize(t.location)===normalize(addressIdentity.location)&&lot(t.lot)===addressIdentity.lot&&compatibleName(t.building,d.name));
  const unique=[...new Map(rows.map(t=>[peerRules.contractKey(t),t])).values()];if(unique.length<3)continue;
  const names=[...new Set(unique.map(t=>normalize(t.building)))];if(names.length!==1)continue;
  const unitMean=unique.reduce((s,t)=>s+t.price/t.area,0)/unique.length;
  const physical=[unique[0].location,lot(unique[0].lot),normalize(unique[0].building)].join('|');if(seenPhysical.has(physical)||targetPhysical.has(physical))continue;
  seen.add(d.kapt_code);seenPhysical.add(physical);for(const t of unique){seenContracts.add(t.id);seenKeys.add(peerRules.contractKey(t));}qualified.push({kaptCode:d.kapt_code,name:unique[0].building,town,lot:addressIdentity.lot,location:addressIdentity.location,officialAddress:address,bjdCode:bjdCode||null,regionCode:sourceRegion,regionCodeBasis:regionProof?'exact-address-geocode':'kapt-basic',regionProof,approvalDate:approval,lat:c.lat,lng:c.lng,distanceM:Math.round(measured),n:unique.length,unitMean,contracts:unique.map(t=>({id:t.id,kind:'trade',date:t.date,area:t.area,areaBasis:t.areaBasis,price:t.price,floor:t.floor||null,building:t.building,location:t.location,lot:t.lot})),basicSource:{provider:'입지톡을 통한 단지 기본정보 중계',dataSource:d.metadata.data_source||'미확인',checkedAt:d.metadata.collected_at,basicUpdatedAt:d.metadata.basic_updated_at||null,originalReference:'https://www.k-apt.go.kr/'},priceSource:'https://rt.molit.go.kr/pt/xls/xls.do'});
 }
 const sameTown=qualified.filter(p=>p.town===targetTown);out.peers=sameTown.length>=2?sameTown:qualified;
 if(sameTown.length<2&&qualified.some(p=>p.town!==targetTown)){
  out.version=peerRules.DISTRICT_VERSION;out.scope=peerRules.DISTRICT_SCOPE;out.criteria='같은 구·인접 법정동 포함·'+peerRules.COMMON_CRITERIA;
  out.expansion={fromScope:peerRules.SAME_TOWN_SCOPE,targetTown,regionCode:String(identity.regionCode),sameTownPeerCount:sameTown.length,requiredPeerBuildings:2,reason:`같은 법정동에서 각 매매 3건 이상인 비교 단지가 ${sameTown.length}곳으로 2곳에 못 미쳐 같은 구·직선 2km 이내 인접 동까지 비교했습니다.`,distanceBasis:'공식 대상 단지 기준점과 등록 비교 단지 좌표 간 직선거리',towns:[...new Set(qualified.map(p=>p.town))].sort()};
 }
 if(out.peers.length<2){out.reason=`조건을 충족한 비교 단지는 ${out.peers.length}곳입니다. 같은 동을 우선하고 같은 구·직선 2km 이내 인접 동까지 대조했으나 각 3건 이상인 2곳이 필요합니다. 연식·면적·기간·최소 건수는 넓히지 않았습니다.`;return out;}
 const peerRows=out.peers.flatMap(p=>p.contracts),targetUnit=target.reduce((s,t)=>s+t.price/t.area,0)/target.length,peerUnit=peerRows.reduce((s,t)=>s+t.price/t.area,0)/peerRows.length,gap=(targetUnit/peerUnit-1)*100;
 if(!Number.isFinite(gap)||Math.abs(gap)>40){out.reason='유사 조건 표본 사이의 ㎡당 가격 차이가 커서 미확인 동·층·상태 차이를 제외하기 전에는 가격 비교 점수를 산출하지 않습니다.';return out;}
 out.status='verified';out.target={name:input.building,n:target.length,unitMean:targetUnit};out.peerContracts=peerRows.length;out.peerUnitMean=peerUnit;out.gapPercent=gap;out.reason=(out.expansion?out.expansion.reason+' ':'')+'동일 기간의 비교 가능한 개별 계약별 ㎡당 매매금액 평균을 대조했습니다. '+ageBasis.note+' 비교 단지의 주소·사용승인은 등록정보 중계자료를 사용했습니다. 입지·상품 차이의 인과효과나 미래 상승을 증명하지 않습니다.';return out;
}
async function collectResearch(bridge,input,prices,{signal,onProgress=()=>{},raw=[],previous,includeMap=true,onlyScores=false,readTrail,cache,forceRefresh=false,initialTools=[],maxCalls=null,reserveMap=0}={}){
 if(forceRefresh&&prices.naverLand&&prices.naverLookup?.status!=='received')prices={...prices,naverLand:null};
 const out={tools:[],issues:[],checks:[],school:null,nature:null,natureAccess:null,livingAccess:null,shopping:null,session:null};
 if(input.asset!=='apartment')return out;
 if(typeof bridge.evidenceSession!=='function'){out.issues.push('자동 자료 조회 기능을 사용할 수 없는 연결입니다.');return out;}
 const {call,metrics,cacheScope}=require('./research-query.cjs').createQuery(bridge,input,prices,{cache,forceRefresh,signal,out,initialTools,maxCalls,reserveMap});
 onProgress('공식 단지·주소와 주변 시설 자료를 앱에서 직접 조회하고 있습니다.');
 let identity=prices.buildingResolution||{};const tokens=input.target.split(/\s+/),townAt=tokens.indexOf(identity.town),prefix=tokens.slice(0,townAt>=0?townAt:2).join(' '),address=[identity.province&&identity.region?identity.province+' '+identity.region:prefix,identity.town,identity.lot].filter(Boolean).join(' ');
 // Six living scores need the verified physical center, not a K-apt product lookup.
 // A complete official transaction identity already supplies that center.
 const naver=require('./naver-land.cjs').current(prices.naverLand,{identity,asOf:input.asOf})?prices.naverLand:null;
 if(naver){metrics.naverReused=1;out.checks.push({tool:'naver_land_snapshot',status:'reused',source:naver.sourceUrl,checkedAt:naver.checkedAt});}
 let geo=null;if(!(require('./living-access.cjs').point(identity)||naver?.coordinateBasis==='complex'&&require('./living-access.cjs').point(naver))||!identity.town||!identity.lot||!identity.regionCode){
  geo=await call('get_geocode',{address:identity.road?address:input.target});
 }
 if(geo?.confidence==='exact'&&geo.region?.eupmyeondong===identity.town&&lot(geo.region?.jibun)===lot(identity.lot)&&/^\d{10}$/.test(String(geo.region_code||''))&&(!identity.regionCode||String(geo.region_code).startsWith(identity.regionCode))){identity={...identity,regionCode:String(geo.region_code).slice(0,5),province:identity.province||geo.region.sido,region:identity.region||geo.region.sigungu};prices.buildingResolution=identity;}
 let evidence=scoring.collectEvidence({input,prices,tools:out.tools});
 // A trade-register name can differ from the management-register name. Resolve
 // the verified physical address, then run the same name/lot/region checks.
 if(!evidence.center&&!metrics.terminalError&&identity.town&&identity.lot){
  onProgress('공식 주소·지번으로 단지 기본정보를 다시 대조하고 있습니다.');
  await call('get_complex_info_by_query',{complex_query:[identity.province&&identity.region?identity.province+' '+identity.region:prefix,identity.town,identity.lot].filter(Boolean).join(' ')});
  evidence=scoring.collectEvidence({input,prices,tools:out.tools});
 }
 const center=evidence.center;
 const scopedIdentity={...identity,regionCode:identity.regionCode||String(geo?.region_code||'').slice(0,5)};
 if(!center){out.issues.push('공식 단지와 대조된 주소 좌표를 확보하지 못해 학교·주변 시설·지도를 조회하지 않았습니다.');return out;}
 onProgress(onlyScores?'대형마트·병원·과목별 학원 접근 자료를 확인하고 있습니다.':'통학구역과 대형마트·병원·학원·자연공간을 확인하고 있습니다.');
 const shopping=require('./shopping.cjs'),living=require('./living-access.cjs'),args={center_lat:center.lat,center_lng:center.lng};
 // Read already completed public proofs before spending another lookup. This
 // also covers earlier runs where category aliases failed but keywords worked.
 // Reuse verified academy keyword results before requesting missing subjects.
 const baseCategories=onlyScores?['mart_large','hospital']:['subway','school_elementary','mart_large','pharmacy','hospital'],wideCategories=onlyScores?['mart_large','hospital']:['subway','school_elementary','mart_large','pharmacy','hospital','school'];
 if(cache&&!forceRefresh){
  const requests=[...[[...wideCategories],['subway','school_elementary','mart_large','pharmacy','hospital','school'],['mart_large','hospital']].map(categories=>['search_by_nearby_category',{...args,categories,radius_m:5000}]),...[[...baseCategories],['mart_large'],['mart_large','hospital','academy'],['subway','school_elementary','mart_large','pharmacy','hospital','academy'],['subway','school_elementary','mart_large','pharmacy']].map(categories=>['search_by_nearby_category',{...args,categories,radius_m:1500}]),...[[ 'hospital','mart_large'],['hospital'],['mart_large']].map(categories=>['search_by_nearby_category',{...args,categories,radius_m:5000}]),['search_by_nearby_category',{...args,categories:['school'],radius_m:3000}],...shopping.QUERIES.map(query=>['search_by_nearby_keyword',{...args,query,radius_m:shopping.RADIUS}]),...living.QUERIES.map(s=>['search_by_nearby_keyword',{...args,query:s.query,radius_m:s.radiusM}])];
  for(const [tool,query]of requests)await call(tool,query,false,{cachedOnly:true});
 }
 const sbiz=require('./sbiz-evidence.cjs'),sbizContext={center,identity:scopedIdentity,asOf:input.asOf},publicEntrance=sbiz.entrance(prices.sbizSnapshot,sbizContext),publicSupermarket=sbiz.nearest(prices.sbizSnapshot,'supermarket',sbizContext);
 if(publicEntrance){metrics.sbizEntranceReused=1;out.checks.push({tool:'sbiz_official_csv',status:'reused',source:sbiz.SOURCE,sourceDate:publicEntrance.sourceDate,checkedAt:publicEntrance.nearest.checkedAt});}
 const hospital=require('./public-hospitals.cjs'),publicHospitals=new Map(living.SPECS.filter(s=>s.group==='hospital').map(s=>[s.key,hospital.category(prices.hospitalSnapshot,s.key,sbizContext)]));
 if([...publicHospitals.values()].some(Boolean)){metrics.publicHospitalCategoriesReused=[...publicHospitals.values()].filter(Boolean).length;out.checks.push({tool:'seoul_hospital_register',status:'reused',sourceDate:prices.hospitalSnapshot.sourceDate});}
 const covered=spec=>{const c=living.snapshot(out.tools,{center,asOf:input.asOf})?.groups?.[spec.group]?.categories?.find(c=>c.key===spec.key);return living.usableRecord(c?.batch)||c?.queries?.length>0&&c.queries.every(q=>q.checkedAt)||spec.key==='entrance'&&!!publicEntrance||spec.group==='hospital'&&!!publicHospitals.get(spec.key);};
 const dailyCovered=()=>shopping.dailyCurrent({center,dailyShopping:shopping.dailySnapshot(out.tools,{center,asOf:input.asOf})},input)||!!publicSupermarket;
 const categoryReceived=(category,radiusM)=>out.tools.some(t=>living.queryRecord(t,{category,radiusM},center,input.asOf,()=>true))||category==='school_elementary'&&radiusM===1500&&!!require('./research-projection.cjs').elementarySchoolProof(out.tools,{center,asOf:input.asOf});
 const martCovered=()=>{const s=shopping.snapshot(out.tools,{center,asOf:input.asOf});return living.usableRecord(s?.batch)||shopping.MART_QUERIES.every(query=>s?.queries.some(q=>q.query===query&&q.checkedAt));};
 const needed=wideCategories.filter(category=>category==='hospital'?living.SPECS.some(s=>s.group==='hospital'&&!covered(s)):category==='mart_large'?!martCovered()||!dailyCovered():!categoryReceived(category,category==='school'?3000:1500));
 // One wider category response supplies the 5 km hospital/mart proof plus
 // conservatively filtered 1.5 km daily facilities and 3 km school records.
 if(needed.length)await call('search_by_nearby_category',{...args,categories:needed,radius_m:5000});
 // A failed/malformed wider result cannot silently replace a narrower proof.
 // Request only those original scopes that were not safely projected.
 const narrow=baseCategories.filter(category=>!categoryReceived(category,1500)&&(category==='hospital'?living.SPECS.some(s=>s.group==='hospital'&&s.radiusM===1500&&!covered(s)):category==='mart_large'?!dailyCovered():true));
 if(narrow.length)await call('search_by_nearby_category',{...args,categories:narrow,radius_m:1500});
 if(!onlyScores&&!categoryReceived('school',3000))await call('search_by_nearby_category',{...args,categories:['school'],radius_m:3000});
 const facilities=async()=>{
  const jobs=living.SPECS.map(spec=>async()=>{if(covered(spec))return;for(const query of spec.queries){if(covered(spec))break;if(call.remaining()<=0){call.defer();break;}await call('search_by_nearby_keyword',{...args,query,radius_m:spec.radiusM});}});
  // Keep explicit-budget priority unchanged. Otherwise three independent
  // categories overlap; synonyms within each category still run in order.
  if(typeof maxCalls==='number'&&Number.isFinite(maxCalls)){for(const job of jobs)await job();}
  else await require('./research-query.cjs').runQueries(jobs);
  await require('./research-query.cjs').supplementShopping(call,out.tools,{center,asOf:input.asOf});
 };
 const unavailable=reason=>({status:'unavailable',reason}),guard=job=>job.catch(error=>{if(signal?.aborted)throw error;out.issues.push(error.message);return unavailable(error.message);});
 const cachedPublic=(name,load,accept)=>cache?cache.snapshot(cacheScope,name,load,{forceRefresh,...(accept?{accept}:{})}):load();
 const schoolJob=onlyScores?Promise.resolve(null):guard(cachedPublic('school',()=>require('./school-zone.cjs').querySchoolZone({center,identity:scopedIdentity,asOf:input.asOf,signal})));
 const natureJob=onlyScores?Promise.resolve(null):guard(cachedPublic('nature',()=>require('./regional-park.cjs').queryRegionalPark({center,identity:scopedIdentity,asOf:input.asOf,signal})));
 const accessJob=onlyScores?Promise.resolve(null):guard(cachedPublic('natureAccess',()=>require('./nature-access.cjs').query({center,asOf:input.asOf,signal,readTrail,initialTrails:previous?.natureAccess?.trails||[],seedNames:require('./naver-facilities.cjs').seedNames(prices.naverNearby?.facts,input.asOf),call:(tool,args)=>call(tool,args,true)}),v=>require('./nature-access.cjs').verified(v,{center,asOf:input.asOf})));
 const budgeted=typeof maxCalls==='number'&&Number.isFinite(maxCalls);
 const results=await Promise.allSettled([schoolJob,natureJob,accessJob,...(budgeted?[]:[facilities()])]);
 const failed=results.find(r=>r.status==='rejected');if(failed)throw failed.reason;
 if(budgeted)await facilities();
 const [school,nature,natureAccess]=results.map(r=>r.value);
 Object.assign(out,{school,nature,natureAccess});
 if(!onlyScores&&require('./nearby-context.cjs').requested(input))out.nearbyContext=await guard(cachedPublic('nearbyContext',()=>require('./nearby-context.cjs').collect(call,input,prices,{center,tools:out.tools}),v=>v?.status==='checked'&&v.asOf===input.asOf&&v.identityCode===prices.buildingResolution?.code));
 if(nature)out.checks.push({tool:'national_regional_park',status:nature.status==='verified'?'received':'unavailable'});
 out.livingAccess=hospital.mergeLiving(sbiz.mergeLiving(living.snapshot(out.tools,{center,asOf:input.asOf}),prices.sbizSnapshot,sbizContext),prices.hospitalSnapshot,sbizContext);out.shopping=shopping.snapshot(out.tools,{center,asOf:input.asOf});
 evidence=scoring.collectEvidence({input,prices,tools:out.tools,school,nature,natureAccess,livingAccess:out.livingAccess});
 if(includeMap&&!onlyScores){const map=require('./map-markers.cjs').buildMapMarkers({input,identity:scopedIdentity,evidence,center,nature,natureAccess,livingAccess:out.livingAccess});
  out.mapMarkers={legend:map.legend,scope:map.scope,omitted:map.omitted,radiusM:map.radiusM};
  onProgress('대상 단지와 주요 시설이 표시된 입지톡 지도를 만들고 있습니다.');await call('get_map_embed_url',{markers:map.markers,center:map.center,radius_m:map.radiusM,maptype:'normal',title:(input.building||input.target)+' 입지 분석'});
 }
 out.issues=[...new Set(out.issues)];await cache?.prune();return out;
}
function compactShopping(value){
 if(!value)return null;const group=g=>g?{status:g.status,complete:g.complete,points:g.points,nearest:g.nearest?{name:g.nearest.name,distanceM:g.nearest.distanceM,sourceId:g.nearest.sourceId}:null}:null;
 return {version:value.version,asOf:value.asOf,checkedAt:value.checkedAt,complete:value.complete,scope:value.scope,largeMart:group(value.largeMart),shoppingMall:group(value.shoppingMall),limited:(value.queries||[]).some(q=>q.truncated)};
}
function compactResearch(e){
 const pick=(v,keys)=>v?Object.fromEntries(keys.filter(k=>v[k]!==undefined).map(k=>[k,v[k]])):null;
 const slim=p=>pick(p,['id','name','category','distanceM','distanceBasis','pointRole','areaM2','sourceId','source','sourceDate','downloadedAt','provider','checkedAt','limited']);
 const relevant=new Set(['subway','school_elementary','school_middle','school_high','mart_large','supermarket','shopping_large','park']);
 const places=(e.places||[]).filter(p=>relevant.has(p.category)&&(p.category!=='shopping_large'||require('./shopping.cjs').eligible(p,{asOf:e.asOf}))).filter((p,i,all)=>all.slice(0,i).filter(other=>other.category===p.category).length<2).map(slim),living=require('./living-access.cjs').compact(e.livingAccess),sourceIds=new Set(places.map(p=>p.sourceId));
 for(const f of e.naverLand?.publicFacts||[])if(f.sourceId)sourceIds.add(f.sourceId);
 for(const group of Object.values(living?.groups||{}))for(const category of group.categories||[])if(category.nearest?.sourceId)sourceIds.add(category.nearest.sourceId);
 const nature=pick(e.nature,['status','asOf','source','checkedAt','criteria','thresholdM2','similarityRatio','scope','reason','complete']);if(nature){nature.selected=slim(e.nature.selected);nature.reference=slim(e.nature.reference);}
 const natureAccess=pick(e.natureAccess,['status','asOf','checkedAt','scope','reason','limited']);if(natureAccess){natureAccess.selected=slim(e.natureAccess.selected);natureAccess.trails=(e.natureAccess.trails||[]).slice(0,3).map(slim);}
 return {summary:'실구매자용 6개 생활환경 평가. 등록 시설의 직선 접근성이며 실제 운영·진료·수업·보행은 별도 확인합니다. 상품·가격 점수는 제외하고 실거래 평균은 거래표를 따릅니다.',basic:e.archhub?.basic||e.basic,archhub:pick(e.archhub,['name','addressJibun','registerPk','basic','sourceUrl','sourceName','checkedAt','sourceId']),naverLand:pick(e.naverLand,['name','complexNo','addressJibun','basic','sourceUrl','checkedAt','sourceId','publicFacts']),school:pick(e.school,['status','reason','source','checkedAt','name','updatedAt','schoolNames','schoolSource','zoneClass','remark']),secondarySchools:e.secondarySchools,shopping:compactShopping(e.shopping),livingAccess:living,nature,natureAccess,places,sourceDates:e.sources?.filter(s=>sourceIds.has(s.id)||s.id===e.basic?.sourceId||s.id===e.naverLand?.sourceId||s.id===e.archhub?.sourceId).map(s=>({id:s.id,title:s.title,url:s.url,checkedAt:s.checkedAt,...(s.sourceDate?{sourceDate:s.sourceDate,downloadedAt:s.downloadedAt}:{})})),warnings:e.warnings};
}
function mergeLivingEvidence(previous,fresh){
 const evidence={...structuredClone(previous),version:scoring.VERSION};delete evidence.academyWeb;
 if(fresh.basic)evidence.basic=fresh.basic;
 if(fresh.naverLand)evidence.naverLand=structuredClone(fresh.naverLand);
 if(fresh.archhub)evidence.archhub=structuredClone(fresh.archhub);
 if(fresh.center){evidence.center=fresh.center;if(fresh.centerSource)evidence.centerSource=structuredClone(fresh.centerSource);else delete evidence.centerSource;}
 for(const field of ['school','nature','natureAccess','secondarySchools','shopping','livingAccess','nearbyContext','sbiz','hospitalSnapshot'])if(fresh[field])evidence[field]=structuredClone(fresh[field]);
 evidence.livingAccess=require('./living-access.cjs').mergeSnapshot(previous.livingAccess,fresh.livingAccess,{center:evidence.center,asOf:evidence.asOf,identity:evidence.identity});
 const replaceCategories=new Set(['shopping_large','mart_large']);
 const sameDayDaily=previous.dailyShopping?.asOf===evidence.asOf,oldDailyValid=sameDayDaily&&previous.dailyShopping.status==='received';
 if(fresh.dailyShopping?.status==='received'&&!fresh.dailyShopping.truncated||!oldDailyValid)replaceCategories.add('supermarket');
 if(fresh.dailyShopping)evidence.dailyShopping=structuredClone(fresh.dailyShopping);
 if(fresh.dailyShopping?.status!=='received'&&oldDailyValid)evidence.dailyShopping={...structuredClone(previous.dailyShopping),lookupReason:'일상 마트 재조회가 미완료여서 같은 기준일에 검증한 기존 시설 근거를 유지했습니다.'};
 const freshSchool=(fresh.places||[]).some(p=>p.category.startsWith('school_'));
 evidence.places=[...(previous.places||[]).filter(p=>!replaceCategories.has(p.category)&&(!freshSchool||!p.category.startsWith('school_'))),...(fresh.places||[])].filter((p,i,all)=>all.findIndex(other=>other.id===p.id&&other.category===p.category)===i).sort((a,b)=>a.distanceM-b.distanceM);
 evidence.sources=[...new Map([...(previous.sources||[]),...(fresh.sources||[])].map(s=>[s.id,s])).values()];
 return evidence;
}
async function ensureLivingEvidence(bridge,input,prices,{previous,raw=[],signal,onProgress,readTrail,cache,forceRefresh=false,collect=collectResearch}={}){
 const living=require('./living-access.cjs'),needLiving=!living.current(previous,input),needShopping=!require('./shopping.cjs').current(previous,input)||!require('./shopping.cjs').dailyCurrent(previous,input),needNature=!require('./nature-access.cjs').current(previous?.natureAccess,{center:previous?.center,asOf:input.asOf});
 if(input.asset!=='apartment'||input.asOf!==todayKst()||!previous||!forceRefresh&&!needLiving&&!needShopping&&!needNature)return {evidence:previous,refreshed:false,research:{tools:[],checks:[],issues:[]}};
 const research=await collect(bridge,input,prices,{previous,raw,signal,onProgress,includeMap:false,readTrail,cache,forceRefresh,onlyScores:!needNature&&!forceRefresh}),fresh=scoring.collectEvidence({input,prices,tools:research.tools,school:research.school,nature:research.nature,natureAccess:research.natureAccess,livingAccess:research.livingAccess,nearbyContext:research.nearbyContext});
 return {evidence:mergeLivingEvidence(previous,fresh),refreshed:true,research};
}
async function ensureShoppingEvidence(bridge,input,prices,{previous,tools=[],signal,cache}={}){
 const shopping=require('./shopping.cjs');
 if(input.asset!=='apartment'||input.asOf!==todayKst()||!previous?.center||shopping.current(previous,input))return {evidence:previous,refreshed:false,research:{tools:[],checks:[],issues:[]}};
 const research={tools:[],checks:[],issues:[]};let found=shopping.snapshot(tools,{center:previous.center,asOf:input.asOf});
 if(!shopping.current({center:previous.center,shopping:found},input)){
  const {call}=require('./research-query.cjs').createQuery(bridge,input,prices,{signal,cache,out:research,initialTools:tools});
  if(!found?.batch)await call('search_by_nearby_category',{center_lat:previous.center.lat,center_lng:previous.center.lng,categories:['hospital','mart_large'],radius_m:5000});
  const records=[...tools,...research.tools];await require('./research-query.cjs').supplementShopping(call,records,{center:previous.center,asOf:input.asOf});
  tools=[...tools,...research.tools];found=shopping.snapshot(tools,{center:previous.center,asOf:input.asOf});
 }
 const fresh=scoring.collectEvidence({input,prices:{...prices,buildingResolution:{...prices.buildingResolution,...previous.center}},tools}),places=[...(previous.places||[]).filter(p=>!['shopping_large','mart_large'].includes(p.category)),...fresh.places.filter(p=>['shopping_large','mart_large'].includes(p.category))];
 const evidence={...previous,shopping:found,places:places.sort((a,b)=>a.distanceM-b.distanceM),sources:[...new Map([...(previous.sources||[]),...fresh.sources].map(s=>[s.id,s])).values()]};
 return {evidence,refreshed:true,research};
}
async function ensureSecondaryEvidence(bridge,input,prices,{previous,tools=[],signal,cache}={}){
 const schools=require('./secondary-schools.cjs');
 if(input.asset!=='apartment'||input.asOf!==todayKst()||!previous?.center||schools.current(previous,input))return {evidence:previous,refreshed:false,research:{tools:[],checks:[],issues:[]}};
 const research={tools:[],checks:[],issues:[]};let found=schools.snapshot(tools,{center:previous.center,asOf:input.asOf});
 if(!found){const {call}=require('./research-query.cjs').createQuery(bridge,input,prices,{signal,cache,out:research,initialTools:tools});await call('search_by_nearby_category',{center_lat:previous.center.lat,center_lng:previous.center.lng,categories:['school'],radius_m:schools.RADIUS});tools=[...tools,...research.tools];found=schools.snapshot(tools,{center:previous.center,asOf:input.asOf});}
 const fresh=scoring.collectEvidence({input,prices:{...prices,buildingResolution:{...prices.buildingResolution,...previous.center}},tools}),categories=['school_middle','school_high'],places=[...(previous.places||[]).filter(p=>!categories.includes(p.category)),...fresh.places.filter(p=>categories.includes(p.category))];
 return {evidence:{...previous,secondarySchools:found,places:places.sort((a,b)=>a.distanceM-b.distanceM),sources:[...new Map([...(previous.sources||[]),...fresh.sources].map(s=>[s.id,s])).values()]},refreshed:true,research};
}
async function ensureNearbyEvidence(bridge,input,prices,{previous,tools=[],signal,cache}={}){
 const nearby=require('./nearby-context.cjs'),value=previous?.nearbyContext,research={tools:[],checks:[],issues:[]};
 if(!nearby.requested(input)||input.asset!=='apartment'||input.asOf!==todayKst()||!previous?.center||value?.status==='checked'&&value.asOf===input.asOf&&value.identityCode===prices.buildingResolution?.code)return {evidence:previous,research};
 const {call,cacheScope}=require('./research-query.cjs').createQuery(bridge,input,prices,{signal,cache,out:research,initialTools:tools}),load=()=>nearby.collect(call,input,prices,{center:previous.center,tools:research.tools});
 const snapshot=cache?await cache.snapshot(cacheScope,'nearbyContext',load,{accept:v=>v?.status==='checked'&&v.asOf===input.asOf&&v.identityCode===prices.buildingResolution?.code}):await load();
 return {evidence:{...previous,nearbyContext:snapshot,sources:[...new Map([...(previous.sources||[]),...(snapshot.sources||[])].map(s=>[s.id,s])).values()]},research};
}
function appendResearch(out,extra){for(const key of ['tools','checks','issues'])out[key].push(...(extra[key]||[]));if(extra.metrics){const metrics=out.metrics||{...extra.metrics,networkCalls:0,cacheHits:0,blockedCalls:0,batchCalls:0,keywordCalls:0};for(const key of ['networkCalls','cacheHits','blockedCalls','batchCalls','keywordCalls','sharedHits'])metrics[key]=(metrics[key]||0)+(extra.metrics[key]||0);metrics.terminalError||=extra.metrics.terminalError;metrics.budgetLimited||=extra.metrics.budgetLimited;out.metrics=metrics;}return out;}
module.exports={collectResearch,ensureLivingEvidence,ensureProductEvidence:ensureLivingEvidence,mergeLivingEvidence,ensureShoppingEvidence,ensureSecondaryEvidence,ensureNearbyEvidence,appendResearch,peerEvidence,regionalRows,payload,dailyShoppingSnapshot,compactResearch};
