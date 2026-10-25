'use strict';
const {createHash}=require('node:crypto');
const {SCORE_ITEMS,normalize,todayKst,money,validDate}=require('./core.cjs');
const VERSION='2026-10-20-verified-report-rubric-v8';
const NEEDS={
 '교통 환경':['단지 출입구부터 역·정류장까지의 실제 보행 동선','주요 통근 목적지와 시간대별 이동 조건'],
 '교육 환경':['공식 초등 통학구역·배정 학교','실제 통학로 안전·중고교 배정 조건'],
 '상권 환경':['생활시설의 현재 운영 여부·영업시간','실제 출입구·생활 동선과 시설 구성'],
 '자연환경':['공원 출입구와 실제 이용 동선','세대별 조망·소음·재해 등 확인된 제약'],
 '병원 환경':['종합병원·소아청소년과·정형외과·치과 위치','실제 이동 동선·진료시간·진료 가능 여부'],
 '학원 환경':['입시·국어·영어·수학 교육시설 위치','자녀 연령·과목별 수업과 비용·안전한 통학 동선']
};
const RUBRIC='교통: 역 직선 접근40·실제 보행25·통근 연결35 / 교육: 공식 통학구역상 학교 접근45(미연계 인근 초등학교15만 부분 평가)·인근 중학교10·고등학교10·통학 안전25·중고교 배정10. / 상권: 대형마트40·일상 슈퍼마켓35·대형 쇼핑시설25. 병원·약국은 상권 점수에 중복 반영하지 않음 / 자연: 대표 대형공원·숲길·등산로·수변 산책로의 확인 지점 직선 접근50·환경 제약30·세대 조망20. 대형공원은 대표공원 면적50% 이상·최소10만㎡ 기준 유지 / 병원: 종합병원40·소아청소년과20·정형외과20·치과20 / 학원: 입시·보습40·국어20·영어20·수학20. 의료·교육시설은 등록 위치의 직선 접근성만 평가하고 진료 수준·학업 성과·수업의 질을 추정하지 않음. 부분 평가는 확인 지표의 가중평균을 반올림하며 확인 배점 비중을 표시한다. 확인하지 않은 지표는 점수로 채우지 않는다.';
const DISTANCE_BANDS=[[300,95],[600,85],[1000,70],[1500,55],[Infinity,35]];
const INSTRUCTIONS='생활환경 평가 점수는 앱이 실제 도구 반환값과 고정 기준으로 계산한다. scores의 6행은 score:null로 두고 reason에 확인한 사실·빠진 자료를 항목별로 다르게 작성한다. 근거 없이 숫자 점수를 채우지 않는다. 앱 고정 기준: '+RUBRIC+' 제공된 근거의 livingAccess·shopping를 참고한다. 등록 슈퍼마켓·편의점을 대형마트로 부르지 않는다. 자연환경은 natureAccess.selected의 공원·숲길·등산로·산책로를 함께 반영한다. 공식 경로점과 등록 진입점·출입구·실제 보행거리를 구분한다. 학교 위치를 배정 학교로, 직선거리를 도보거리·시간으로 쓰지 않는다. 시설 등록 결과가 현재 영업을 확인한 것은 아니다. 실거래 평균과 매물 조건은 가격 자료로 설명하되 상품·가격 점수 행을 추가하지 않는다.';
function haversine(a,b){const rad=n=>n*Math.PI/180,x=rad(b.lat-a.lat),y=rad(b.lng-a.lng),v=Math.sin(x/2)**2+Math.cos(rad(a.lat))*Math.cos(rad(b.lat))*Math.sin(y/2)**2;return 6371008.8*2*Math.atan2(Math.sqrt(v),Math.sqrt(Math.max(0,1-v)));}
function point(p){const lat=Number(p?.lat),lng=Number(p?.lng);return Number.isFinite(lat)&&Number.isFinite(lng)&&lat>=25&&lat<=45&&lng>=120&&lng<=135?{lat,lng}:null;}
function payload(t){if(t.server!=='ipzitalk'||t.error||t.result?.isError)return null;const value=t.result?.structuredContent;if(value&&typeof value==='object')return value;for(const c of t.result?.content||[])if(c.type==='text')try{return JSON.parse(c.text);}catch{}return null;}
function fresh(metadata,asOf){const date=Date.parse(metadata?.collected_at);if(!Number.isFinite(date))return false;const day=todayKst(new Date(date)),age=(Date.parse(asOf)-Date.parse(day))/86400000;return age>=0&&age<=30;}
const escapeRegex=s=>String(s).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const lot=s=>String(s||'').split('-').map(n=>/^\d+$/.test(n)?String(Number(n)):n).join('-');
function addressMatches(data,identity){
 if(!identity?.town||!identity?.lot)return false;
 const sourceRegion=String(data.region_code||data.basic?.bjd_code||'').slice(0,5);
 if(identity.regionCode&&sourceRegion&&String(identity.regionCode)!==sourceRegion)return false;
 if(identity.regionCode&&!sourceRegion){const address=data.basic?.address_jibun||data.normalized_address||data.address_jibun||data.address||'';if(!identity.province||!identity.region||!normalize(address).includes(normalize(identity.province))||!normalize(address).includes(normalize(identity.region)))return false;}
 if(data.region?.eupmyeondong===identity.town&&lot(data.region?.jibun)===lot(identity.lot))return true;
 const text=data.basic?.address_jibun||data.normalized_address||data.address_jibun||data.address||'';
 const match=text.match(new RegExp(escapeRegex(identity.town)+'\\s+(\\d+(?:-\\d+)?)(?=\\s|$)'));
 return !!match&&lot(match[1])===lot(identity.lot);
}
function source(kind,key,title,url,checkedAt){return {id:'ev-'+createHash('sha256').update(kind+':'+key).digest('hex').slice(0,12),title,url,checkedAt:todayKst(new Date(checkedAt))};}
function attachNaver(evidence,record){
 if(!record)return evidence;
 const s=source('naver-land',record.complexNo,'네이버 부동산 단지정보 · '+record.name,record.sourceUrl,record.checkedAt);
 evidence.naverLand={...structuredClone(record),sourceId:s.id};
 const facts=(record.publicFacts||[]).filter(f=>f.sourceId).map(f=>({id:f.sourceId,title:'네이버 부동산 공개정보 · '+record.name,url:f.sourceUrl,checkedAt:todayKst(new Date(f.checkedAt))}));
 evidence.sources=[...new Map([...(evidence.sources||[]).filter(old=>old.id!==s.id),s,...facts].map(s=>[s.id,s])).values()];return evidence;
}
function attachAcademy(evidence){delete evidence.academyWeb;evidence.livingAccess=require('./living-access.cjs').upgradeSnapshot(evidence.livingAccess,{center:evidence.center,asOf:evidence.asOf,identity:evidence.identity});return evidence;}
function listingSnapshot(value){
 if(!value)return null;
 const pick=(v,keys)=>Object.fromEntries(keys.filter(k=>v&&Object.hasOwn(v,k)).map(k=>[k,structuredClone(v[k])]));
 if(value.source?.url)try{const u=new URL(value.source.url);if(u.protocol!=='https:'||u.username||u.password||[...u.searchParams.keys()].some(k=>/token|auth|secret|password|api.?key|service.?key/i.test(k)))throw new Error();}catch{return {status:'unavailable',reason:'호가 출처 주소의 인증정보가 제외되어 실거래 기준을 참고합니다.',checkedAt:value.checkedAt,asOf:value.asOf};}
 return {...pick(value,['status','reason','checkedAt','asOf','provenance','complete','truncated','hasMore','totalCount']),source:pick(value.source,['id','title','url','checkedAt']),identity:pick(value.identity,['code','town','lot']),pagination:pick(value.pagination,['has_more']),metadata:pick(value.metadata,['truncated']),listings:Array.isArray(value.listings)?value.listings.map(v=>pick(v,['id','unitId','active','status','cancelled','removed','kind','buildingCode','areaBasis','area','price','verifiedAt','updatedAt','sourceId'])):undefined};
}
function collectEvidence({input,prices,tools=[],previous,school,product,nature,natureAccess,peers,listings,livingAccess,nearbyContext}){
 const identity=prices.buildingResolution,academy=prices.academyWeb||previous?.academyWeb;
 const arch=require('./archhub.cjs'),officialBasic=arch.verified(prices.archhub,{identity,asOf:input.asOf}),finish=e=>require('./hospital-enrichment.cjs').attach(require('./sbiz-enrichment.cjs').attach(arch.attach(e,officialBasic),prices.sbizSnapshot,{identity,asOf:input.asOf}),prices.hospitalSnapshot,{identity,asOf:input.asOf});
 const naver=require('./naver-land.cjs').current(prices.naverLand,{identity,asOf:input.asOf})?require('./naver-land.cjs').normalize(prices.naverLand):null;
 const preferred=point(identity)||(naver?.coordinateBasis==='complex'?point(naver):null);
 const changedCenter=point(previous?.center)&&preferred&&haversine(previous.center,preferred)>2;
 const out={version:VERSION,target:input.target,building:input.building||identity?.building||'',asOf:input.asOf,identity:identity?{building:identity.building,code:identity.code,regionCode:identity.regionCode,town:identity.town,lot:identity.lot}:null,center:null,basic:null,school:null,livingAccess:null,product:null,nature:null,peers:null,listings:null,places:[],warnings:[],sources:[]};
 if([VERSION,'2026-10-20-academy-four-rubric-v7','2026-10-20-ipzitalk-academy-rubric-v6','2026-10-18-buyer-living-rubric-v5','2026-10-17-regional-park-rubric-v4','2026-10-17-six-item-rubric-v3','2026-10-17-evidence-rubric-v2'].includes(previous?.version)&&previous.building===out.building&&previous.asOf===input.asOf&&previous.identity?.code===identity?.code&&!tools.length&&!changedCenter){const saved=structuredClone(previous);if(point(identity)){saved.center=point(identity);delete saved.centerSource;}if(![VERSION,'2026-10-20-academy-four-rubric-v7','2026-10-20-ipzitalk-academy-rubric-v6','2026-10-18-buyer-living-rubric-v5'].includes(previous.version)){saved.places=(saved.places||[]).map(p=>p.category==='mart_large'?{...p,category:p.kakao_category_name?require('./shopping.cjs').classify(p)||'legacy_retail_unclassified':'legacy_retail_unclassified'}:p);saved.livingAccess=null;saved.warnings=[...(saved.warnings||[]),'기존 상품·가격 점수는 새 병원·학원 점수로 전환하지 않았습니다. 새 생활시설 조회가 필요합니다.'];}for(const [key,value]of Object.entries({school,livingAccess,nature,natureAccess,nearbyContext}))if(value)saved[key]=structuredClone(value);return finish(attachAcademy(attachNaver({...out,...saved,version:VERSION},naver),academy,{input,identity}));}
 if(previous?.version==='2026-10-16-evidence-rubric-v1'&&previous.building===out.building&&previous.asOf===input.asOf&&previous.identity?.code&&previous.identity.code===identity?.code&&point(previous.center)&&!changedCenter){
   const saved=structuredClone(previous),sourceIds=new Set((saved.sources||[]).filter(s=>s.id&&/^https:\/\//.test(s.url||'')&&fresh({collected_at:s.checkedAt},input.asOf)).map(s=>s.id));
   saved.places=(saved.places||[]).filter(p=>point(p)&&sourceIds.has(p.sourceId)&&['subway','school_elementary','mart_large','supermarket','hospital','pharmacy','park'].includes(p.category)&&Number.isFinite(p.distanceM)&&Math.abs(haversine(saved.center,p)-p.distanceM)<=2).map(p=>p.category==='mart_large'?{...p,category:p.kakao_category_name?require('./shopping.cjs').classify(p)||'legacy_retail_unclassified':'legacy_retail_unclassified'}:p);
   if(saved.basic&&!sourceIds.has(saved.basic.sourceId))saved.basic=null;
   return finish(attachAcademy({...out,...saved,version:VERSION,school:null,product:null,peers:null,livingAccess:null,warnings:[...(saved.warnings||[]),'기존 보고서의 당시 위치·단지 근거를 재사용했습니다. 새 학교·병원·학원 자료는 새 조회가 필요합니다.']},academy,{input,identity}));
 }
 const entries=tools.map(t=>({tool:t.tool,args:t.arguments||{},data:payload(t)})).filter(t=>t.data&&fresh(t.data.metadata,input.asOf));
 const geo=entries.find(t=>t.tool==='get_geocode'&&t.data.confidence==='exact'&&addressMatches(t.data,identity)&&point(t.data));

 const official=point(identity);out.center=official||(naver?.coordinateBasis==='complex'?point(naver):null)||(geo?point(geo.data):null);
 attachNaver(out,naver);
 if(!official&&naver?.coordinateBasis==='complex'&&point(naver))out.centerSource={provider:'네이버 부동산',url:naver.sourceUrl,checkedAt:naver.checkedAt,basis:'공식 단지명·지번주소 대조 후 네이버 등록 단지 기준점 재사용'};
 if(official&&geo&&haversine(official,point(geo.data))>100)out.warnings.push('주소 좌표가 공식 단지 기준점과 달라 주변 시설 평가에서 제외했습니다.');
 const basicCandidates=entries.filter(t=>t.tool==='get_complex_info_by_query'&&t.data.basic&&/^[A-Za-z0-9]{5,30}$/.test(String(t.data.kapt_code||''))&&addressMatches(t.data,identity)&&require('./property-identity.cjs').matchesKaptIdentity(identity,{name:t.data.name,regionCode:t.data.basic.bjd_code||t.data.region_code,addressJibun:t.data.basic.address_jibun,addressRoad:t.data.basic.address_road}));
 const basicByCode=new Map(basicCandidates.map(t=>[String(t.data.kapt_code),t])),basic=basicByCode.size===1?[...basicByCode.values()][0]:null;
 if(basicByCode.size>1)out.warnings.push('같은 단지·주소 조건에 서로 다른 K-apt 단지번호가 반환되어 상품 기본정보 연결을 보류했습니다.');
 if(basic&&/^[A-Za-z0-9]{5,30}$/.test(String(basic.data.kapt_code||''))){const d=basic.data,b=d.basic,s=source('kapt',d.kapt_code,'국토교통부 K-apt 공동주택 기본정보 · '+d.kapt_code,'https://www.k-apt.go.kr/',d.metadata.collected_at),date=String(b.use_approval_date||'').replace(/^(\d{4})(\d{2})(\d{2})$/,'$1-$2-$3');out.sources.push(s);out.basic={name:d.name,kaptCode:d.kapt_code,approvalDate:validDate(date)&&date<=input.asOf?date:null,units:Number.isInteger(Number(b.total_units))&&Number(b.total_units)>0?Number(b.total_units):null,hallType:typeof b.hall_type==='string'?b.hall_type:null,sourceId:s.id,checkedAt:d.metadata.collected_at};}
 for(const entry of entries){
  if(!out.center||!['search_by_nearby_category','search_by_nearby_keyword'].includes(entry.tool))continue;
  const d=entry.data,center=point(d.center);if(!center||haversine(center,out.center)>100){out.warnings.push('검색 중심이 대상 단지와 다른 시설 자료를 제외했습니다.');continue;}
  const radius=Number(d.radius_m);if(!Number.isFinite(radius)||radius<=0||radius>20000)continue;
  const keywordCategory=require('./shopping.cjs').QUERIES.includes(entry.args.query)?'shopping_large':'park';
  const lists=Array.isArray(d.results)?[[keywordCategory,d.results]]:Object.entries(d.results||{});
  for(const [kind,items]of lists){if(!Array.isArray(items))continue;for(const p of items){
    const coord=point(p),id=String(p.kakao_place_id||''),label=String(p.kakao_category_name||'');
    const shopping=require('./shopping.cjs'),category=kind==='school'?(/중학교/.test(label)?'school_middle':/고등학교/.test(label)?'school_high':/초등학교/.test(label)?'school_elementary':'other_school'):['mart_large','shopping_large'].includes(kind)?shopping.classify(p,{asOf:input.asOf}):kind;
    if(!coord||!/^\d+$/.test(id)||!p.name)continue;
    const allowed=category==='subway'&&/지하철|전철/.test(label)||category==='school_elementary'&&/초등학교/.test(label)||category==='mart_large'&&shopping.eligibleMart(p)||category==='supermarket'&&shopping.supermarket(p)||category==='hospital'&&/병원|의원/.test(label)||category==='pharmacy'&&/약국/.test(label)||category==='park'&&/공원/.test(label)&&!/음식|카페|주차|입구|정류장/.test(label);
    if(!allowed&&!(category==='school_middle'&&/학교 > 중학교(?: >|$)/.test(label)||category==='school_high'&&/학교 > 고등학교(?: >|$)/.test(label))&&!(category==='shopping_large'&&require('./shopping.cjs').eligible(p,{asOf:input.asOf})))continue;
    if(category.startsWith('school_')&&/예정|계획|폐교|휴교|공사중|공사 중/.test(p.name))continue;
    if(category==='subway'&&/예정|계획|폐역|휴역|미개통|공사\s*중/.test(p.name))continue;
    // New 5 km batches must pass the strict source validation in the
    // radius projection before contributing to the original 1.5 km axes.
    // Keep positive nearby elementary facts from the existing 3 km school API.
    if(['subway','school_elementary','pharmacy'].includes(category)&&radius>3000)continue;
    if(category==='shopping_large'&&radius>require('./shopping.cjs').RADIUS)continue;
    if(['school_middle','school_high'].includes(category)&&radius>require('./secondary-schools.cjs').RADIUS)continue;
    const distance=haversine(out.center,coord),reported=Number(p.distance_m),fromSearch=haversine(center,coord);
    if(['subway','school_elementary','pharmacy'].includes(category)&&distance>1500)continue;
    if(['school_middle','school_high'].includes(category)&&distance>3000)continue;
    if(distance>radius+100||category==='shopping_large'&&distance>5000||p.distance_m==null||String(p.distance_m).trim()===''||!Number.isFinite(reported)||reported<0||Math.abs(fromSearch-reported)>Math.max(35,reported*.08))continue;
    if(out.places.some(x=>x.id===id&&x.category===category))continue;
    const s=source('place',id,'카카오 장소정보 · '+String(p.name),'https://place.map.kakao.com/'+id,d.metadata.collected_at);out.sources.push(s);
    out.places.push({id,name:String(p.name).slice(0,120),category,kakao_category_name:label,lat:coord.lat,lng:coord.lng,distanceM:Math.round(distance),distanceBasis:'단지 기준점과 시설 좌표 사이의 직선거리',sourceId:s.id,checkedAt:d.metadata.collected_at,limited:!!d.metadata.truncated,...(category==='shopping_large'&&p.mallProof?{mallProof:structuredClone(p.mallProof)}:{})});
  }}
 }
 out.shopping=require('./shopping.cjs').snapshot(tools,{center:out.center,asOf:input.asOf});
 out.dailyShopping=require('./shopping.cjs').dailySnapshot(tools,{center:out.center,asOf:input.asOf});
 out.livingAccess=require('./living-access.cjs').snapshot(tools,{center:out.center,asOf:input.asOf});
 out.secondarySchools=require('./secondary-schools.cjs').snapshot(tools,{center:out.center,asOf:input.asOf});
 for(const [key,value]of Object.entries({school,livingAccess,nearbyContext,product,nature,natureAccess,peers,listings:listingSnapshot(listings)}))if(value){out[key]=structuredClone(value);if(value.status==='verified'&&value.source?.id&&/^https:\/\//.test(value.source.url||''))out.sources.push(value.source);if(value.status==='verified'&&value.schoolSource?.id)out.sources.push(value.schoolSource);if(key==='nearbyContext')out.sources.push(...(value.sources||[]));}
 out.sources=[...new Map(out.sources.map(s=>[s.id,s])).values()];out.places.sort((a,b)=>a.distanceM-b.distanceM);out.warnings=[...new Set(out.warnings)];return finish(attachAcademy(out,academy,{input,identity}));
}
function recoveredReason(report,s){
 if(s?.reason&&!/정량 근거를 직접 대조하지 못해|평가 근거를 확보하지 못해/.test(s.reason))return s.reason;
 const old=report.verification?.numericClaimsRejected?.find(x=>x.field==='scores.'+s?.name);
 const recovered=old?.reason||old?.text?.split(/\s+지역[:·]|\s+지역·유형·면적[:·]/)[0]||'';
 return /[0-9０-９]/.test(recovered)?'':recovered;
}
function assessScores(report,{input,prices,tools=[],previousEvidence,dataCheckedAt}={}){
 const evidence=collectEvidence({input,prices,tools,previous:previousEvidence});
 const held=(name,observed,needed,reason)=>({name,score:null,status:'withheld',coverage:0,scope:'평가 보류',observed:observed||name+' 점수 산정에 필요한 자료를 확보하지 못했습니다.',needed:needed||NEEDS[name].join(' / '),reason:reason||needed||NEEDS[name].join(' / '),method:'필수 자료가 부족해 점수를 산출하지 않았습니다. 공통 기준 '+VERSION+'을 적용합니다.',sourceIds:[]});
 const scores=SCORE_ITEMS.map(name=>{const old=report.scores?.find(s=>s.name===name),reason=recoveredReason(report,old),row=held(name,reason||'',null,reason||null);row.sourceIds=old?.sourceIds||[];return row;});
 const nearest=category=>evidence.places.find(p=>p.category===category);
 const distanceScore=d=>DISTANCE_BANDS.find(([limit])=>d<=limit)[1];
 const assessment=(name,items,scope,coverage,needed)=>{
   const used=items.filter(Boolean);if(!used.length)return;
   const weight=used.reduce((sum,i)=>sum+i.weight,0),score=Math.max(1,Math.min(100,Math.round(used.reduce((sum,i)=>sum+i.score*i.weight,0)/weight)));
   const observed=used.map(i=>`${i.place.name}: 직선 약 ${i.place.distanceM.toLocaleString('ko-KR')}m`).join(' / ');
   const limited=used.some(i=>i.place.limited)?' 검색 결과의 제공 건수에 제한이 있어 조회된 시설 기준입니다.':'';
   const method='고정 기준 '+VERSION+'. 직선거리 ≤300m 95점 / ≤600m 85점 / ≤1,000m 70점 / ≤1,500m 55점 / 초과 35점. '+used.map(i=>i.label+' '+i.weight+'%').join(' + ')+'. 확인 지표 가중평균을 반올림. 전체 항목의 배점 중 확인 비중 '+weight+'%. 실제 보행거리·시간·시설 운영을 평가한 점수가 아닙니다.';
   const row={name,score,status:'partial',scope,coverage:coverage||weight,observed:observed+limited,needed,reason:observed+'. '+scope+'만 평가했습니다. '+needed+limited,method,sourceIds:[...new Set(used.map(i=>i.place.sourceId))],calculation:used.map(i=>({indicator:i.label,weight:i.weight,value:i.place.distanceM,unit:'m (직선)',points:i.score,sourceId:i.place.sourceId}))};
   scores[SCORE_ITEMS.indexOf(name)]=row;
 };
 const item=(category,label,weight)=>{const p=nearest(category);return p?{place:p,label,weight,score:distanceScore(p.distanceM)}:null;};
 assessment('교통 환경',[item('subway','등록 역 접근',40)],'역 직선 접근성',40,NEEDS['교통 환경'].join(' / ')+'은 별도 확인이 필요합니다.');
 applyCommerce(scores,evidence,{input,distanceScore});
 const nature=evidence.nature;
 if(require('./regional-park.cjs').verified(nature,{center:evidence.center,asOf:input.asOf})){
  const p=nature.selected,place={...p,sourceId:nature.source.id};
  assessment('자연환경',[{place,label:'대표·유사 규모 대형공원 접근',weight:50,score:distanceScore(p.distanceM)}],'대표·유사 규모 공원 직선 접근성',50,NEEDS['자연환경'].join(' / ')+'은 별도 확인이 필요합니다.');
  const row=scores[3];row.observed=`평가 공원 ${p.name} · 공식 면적 ${p.areaM2.toLocaleString('ko-KR')}㎡ · 직선 약 ${p.distanceM.toLocaleString('ko-KR')}m · 기준 랜드마크 ${nature.reference.name} · 면적 비율 ${(p.areaM2/nature.reference.areaM2*100).toFixed(1)}% · 공원 자료 기준 ${p.referenceDate}`;row.reason=row.observed;row.method+=' '+nature.criteria;row.regionalPark={...p};row.landmarkPark={...nature.reference};row.parkSizeRatio=p.areaM2/nature.reference.areaM2;
 }else{scores[3]=held('자연환경','',null,nature?.reason||'지역 대표 대형공원의 공식 면적·좌표·선정 자료가 저장되어 있지 않습니다. 가까운 소공원으로 대체하지 않았습니다.');}
 require('./nature-access.cjs').apply(scores,evidence,{input,distanceScore});
 require('./extended-scoring.cjs').applyEducation(scores,evidence,{input,distanceScore});
 require('./living-access.cjs').apply(scores,evidence,{input});
 if(input.asset!=='apartment')return {scores,sources:[],assessment:{version:VERSION,evidence,summary:'아파트 환경·가치 점수 산정 대상이 아닙니다.'}};
 evidence.sources=[...new Map(evidence.sources.map(s=>[s.id,s])).values()];
 const usedIds=new Set(scores.flatMap(s=>s.sourceIds||[]));
 return {scores,sources:evidence.sources.filter(s=>usedIds.has(s.id)),assessment:{version:VERSION,evidence,summary:summary(scores),rubric:RUBRIC,checkedAt:new Date().toISOString()}};
}
function applyCommerce(scores,e,{input,distanceScore}){
 const shopping=require('./shopping.cjs'),rows=[],snapshot=e.shopping,current=shopping.validSnapshot(snapshot,{center:e.center,asOf:input.asOf,identity:e.identity});
 for(const [key,label,weight,category]of [['largeMart','대형마트 접근',40,'mart_large'],['shoppingMall','대형 쇼핑시설 접근',25,'shopping_large']]){
  const eligible=p=>category==='shopping_large'?shopping.eligible(p,{asOf:input.asOf}):shopping.eligibleMart(p);
  const group=current?snapshot[key]:null,p=group?.nearest&&eligible(group.nearest)?group.nearest:e.places.find(p=>p.category===category&&p.distanceM<=5000&&eligible(p));
  if(p){rows.push({label,weight,place:p,points:shopping.points(p.distanceM),status:'observed'});if(group?.nearest?.id===p.id)e.sources.push({id:p.sourceId,title:(p.provider==='naver-public-map'?'네이버 장소정보':'카카오 장소정보')+' · '+p.name,url:p.url,checkedAt:input.asOf});}
  else if(group?.status==='empty'&&group.complete===true)rows.push({label,weight,place:null,points:20,status:'empty'});
 }
 const supermarket=e.places.find(p=>p.category==='supermarket'&&p.distanceM<=1500&&shopping.supermarket(p)&&(p.provider!=='sbiz-csv'||require('./sbiz-evidence.cjs').validPlace(p,{center:e.center,identity:e.identity,asOf:input.asOf})));if(supermarket){rows.push({label:'일상 슈퍼마켓 접근',weight:35,place:supermarket,points:distanceScore(supermarket.distanceM),status:'observed'});if(supermarket.provider==='sbiz-csv')e.sources.push(require('./sbiz-evidence.cjs').source(supermarket));}
 if(!rows.length)return;const coverage=rows.reduce((s,p)=>s+p.weight,0),observed=rows.map(p=>p.place?`${p.label} · ${p.place.name}: 직선 ${p.place.distanceM.toLocaleString('ko-KR')}m${p.place.provider==='sbiz-csv'?' ('+p.place.sourceDate+' 등록자료)':''}`:`${p.label}: 반경 5km 지정 검색 내 등록 시설 미확인`).join(' / '),sourceIds=rows.map(p=>p.place?.sourceId).filter(Boolean),needed=NEEDS['상권 환경'].join(' / ')+'은 별도 확인이 필요합니다.';
 if(rows.some(p=>p.status==='empty')){const id='ev-shopping-empty-'+input.asOf.replace(/-/g,'');sourceIds.push(id);e.sources.push({id,title:'카카오 장소정보 · 쇼핑·대형마트 지정 키워드 검색 결과',url:'https://map.kakao.com/',checkedAt:input.asOf});}
 scores[SCORE_ITEMS.indexOf('상권 환경')]={name:'상권 환경',score:Math.round(rows.reduce((s,p)=>s+p.points*p.weight,0)/coverage),status:'partial',coverage,scope:'대형마트·일상 슈퍼·쇼핑시설 직선 접근성',observed,needed,reason:observed+'. '+needed+(e.places.some(p=>rows.some(r=>r.place?.id===p.id)&&p.limited)||snapshot?.queries?.some(q=>q.truncated)?' 검색 결과의 제공 건수에 제한이 있어 조회된 시설 기준입니다.':''),method:VERSION+'. 대형마트40%·일상 슈퍼마켓35%·대형 쇼핑시설25%. 대형마트·쇼핑시설: ≤500m95 / ≤1000m85 / ≤2000m70 / ≤3000m55 / ≤5000m35. 일상 슈퍼: ≤300m95 / ≤600m85 / ≤1000m70 / ≤1500m55. 모든 지정 조회가 정상 완료되고 반경 내 적합 시설이 없으면20점. 확인 배점 '+coverage+'%를 가중평균·반올림. 의료·약국 배점은 제외하고 편의점·SSM·입점 매장을 대형마트로 중복 가산하지 않습니다.',sourceIds:[...new Set(sourceIds)],calculation:rows.map(p=>({indicator:p.label,weight:p.weight,value:p.place?.distanceM??null,unit:'m (직선)',points:p.points,sourceId:p.place?.sourceId||null,status:p.status,facility:p.place?.name||null}))};
}
function repairCommerce(report){
 if(!report?.assessment?.evidence?.center||report.input?.asset!=='apartment'||report.demo)return report;
 const e=structuredClone(report.assessment.evidence),shopping=require('./shopping.cjs'),input=report.input;
 const commerceRejectedNames=[...new Set([...(report.assessment.commerceRejectedNames||[]),...(e.places||[]).filter(p=>p.category==='shopping_large'&&!shopping.eligible(p,{asOf:input.asOf})).map(p=>p.name),...(e.shopping?.shoppingMall?.nearest&&!shopping.eligible(e.shopping.shoppingMall.nearest,{asOf:input.asOf})?[e.shopping.shoppingMall.nearest.name]:[])].filter(Boolean))];
 e.places=(e.places||[]).filter(p=>p.category!=='shopping_large'||shopping.eligible(p,{asOf:input.asOf}));
 if(!shopping.validSnapshot(e.shopping,{center:e.center,asOf:input.asOf,identity:e.identity}))e.shopping=shopping.policySnapshot({center:e.center,asOf:input.asOf,identity:e.identity});
 e.sources||=[];const scores=projectScores(report.scores),index=SCORE_ITEMS.indexOf('상권 환경');
 scores[index]={name:'상권 환경',score:null,status:'withheld',coverage:0,scope:'평가 보류',observed:'시설의 분류·규모·위치 근거를 확인하지 못했습니다.',needed:NEEDS['상권 환경'].join(' / '),reason:'검증된 상권 근거가 없어 점수를 산출하지 않았습니다.',method:VERSION,sourceIds:[]};
 applyCommerce(scores,e,{input,distanceScore:d=>DISTANCE_BANDS.find(([limit])=>d<=limit)[1]});
 return {...report,scores,assessment:{...report.assessment,evidence:e,commerceRepairVersion:shopping.VERSION,commerceRejectedNames}};
}
function summary(scores){const count=SCORE_ITEMS.filter(name=>(scores||[]).some(s=>s.name===name&&s.score!=null)).length;return `부분 평가 ${count}개 · 자료 미충족 ${SCORE_ITEMS.length-count}개. 항목별 평가 범위를 표시합니다.`;}
function label(s){return s?.score==null?'평가 보류':s.status==='partial'?`${s.score}점 · 부분`:`${s.score}점`;}
function result(s){return s?.score==null?'평가 보류':s.status==='partial'?`${s.score}점 · 부분 평가\n${s.scope}\n확인 배점 ${s.coverage}%`:`${s.score}점`;}
function detail(s){return s?.observed||s?.reason||'평가 근거 미확인';}
function needed(s){return s?.needed||s?.reason||NEEDS[s?.name]?.join(' / ')||'추가 자료 확인';}
function prepareReport(report){
 if(!report||typeof report!=='object')return report;
 if(report.mode==='comparison'){
   const members=(report.members||[]).map(m=>prepareReport(m));
   return require('./comparison-basis.cjs').repair({...report,members,scores:projectScores(report.scores),assessment:report.assessment?{...report.assessment,summary:summary(projectScores(report.scores))}:report.assessment});
 }
 let out={...report,scores:projectScores(report.scores)};
 const legacy=report.assessment?.version!==VERSION;
 if(!report.demo&&report.input?.asset==='apartment'&&report.prices&&legacy&&report.assessment?.evidence){
   const assessed=assessScores(out,{input:report.input,prices:report.prices,previousEvidence:report.assessment.evidence,dataCheckedAt:report.dataCheckedAt||report.createdAt});
   out={...out,scores:assessed.scores,assessment:{...assessed.assessment,legacyReasonRepair:true,legacyScoreItems:(report.scores||[]).filter(s=>!SCORE_ITEMS.includes(s.name)).map(s=>({name:s.name,score:s.score,status:s.status})),migrationReason:'기존 학원 근거 중 입시·국어·영어·수학만 새 배점으로 재계산했습니다. 같은 기준일·좌표의 검증된 병원 등 생활시설 근거는 유지하며, 확인되지 않은 항목은 평가 보류합니다.'},sources:[...(report.sources||[]),...assessed.sources]};
 }else if(!report.demo&&report.input?.asset==='apartment'&&legacy&&out.scores.every(s=>s.score==null&&/정량 근거를 직접 대조하지 못해/.test(s.reason||''))){
   const assessed=assessScores(out,{input:report.input,prices:report.prices,dataCheckedAt:report.dataCheckedAt||report.createdAt});out={...out,scores:assessed.scores,assessment:{...assessed.assessment,legacyReasonRepair:true},sources:[...(report.sources||[]),...assessed.sources]};
 }
 out=repairCommerce(out);
 if(out.assessment)out.assessment={...out.assessment,summary:summary(out.scores)};
 return out;
}
function projectScores(scores){return SCORE_ITEMS.map(name=>{const s=(scores||[]).find(s=>s.name===name);return s?{...s}:{name,score:null,status:'withheld',coverage:0,scope:'평가 보류',reason:'해당 항목의 평가 자료 없음',method:'',sourceIds:[]};});}
module.exports={VERSION,RUBRIC,INSTRUCTIONS,NEEDS,haversine,collectEvidence,assessScores,summary,label,result,detail,needed,prepareReport,repairCommerce};
