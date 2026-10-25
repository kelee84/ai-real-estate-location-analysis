'use strict';
const {createHash}=require('node:crypto');
const {sixMonthWindow,todayKst,validDate,normalize,money,areaSelection,matchesArea}=require('./core.cjs');
const {compatibleName}=require('./property-identity.cjs');
const peerRules=require('./peer-comparison.cjs');
const NAME='가격 경쟁력',URL='https://rt.molit.go.kr/pt/xls/xls.do',VERSION='2026-10-17-price-basis-v1';
const positive=n=>Number.isFinite(n)&&n>0;
const close=(a,b)=>Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=Math.max(.000001,Math.abs(b)*1e-10);
const mean=(rows,key)=>rows.reduce((s,t)=>s+t[key],0)/rows.length;
const unitMean=rows=>rows.reduce((s,t)=>s+t.price/t.area,0)/rows.length;
const point=p=>Number.isFinite(p?.lat)&&Number.isFinite(p?.lng)&&p.lat>=25&&p.lat<=45&&p.lng>=120&&p.lng<=135;
function distance(a,b){const rad=n=>n*Math.PI/180,v=Math.sin(rad(b.lat-a.lat)/2)**2+Math.cos(rad(a.lat))*Math.cos(rad(b.lat))*Math.sin(rad(b.lng-a.lng)/2)**2;return 6371008.8*2*Math.atan2(Math.sqrt(v),Math.sqrt(Math.max(0,1-v)));}
const lot=s=>String(s||'').split('-').map(n=>/^\d+$/.test(n)?String(Number(n)):n).join('-');
function date(value){if(typeof value!=='string')return null;if(validDate(value))return value;if(!validDate(value.slice(0,10))||!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/i.test(value))return null;const n=Date.parse(value);if(!Number.isFinite(n))return null;const d=todayKst(new Date(n));return validDate(d)?d:null;}
function official(url,host='rt.molit.go.kr'){try{const u=new globalThis.URL(url);return u.protocol==='https:'&&u.hostname===host;}catch{return false;}}
function checkedDate(prices,e,dataCheckedAt,lastContract){
 const coverage=(prices.coverage||[]).filter(c=>c.deal==='trade'&&c.status==='success'&&official(c.source));
 const verified=(e.sources||[]).filter(s=>official(s.url));
 if(!coverage.length&&!verified.length)return null;
 const dates=[dataCheckedAt,...coverage.map(c=>c.checkedAt),...verified.map(s=>s.checkedAt)].map(date).filter(Boolean);
 return dates.find(d=>d<=todayKst()&&d>=lastContract)||null;
}
function ownFacts(input,prices){
 const period=sixMonthWindow(input.asOf);if(prices.period?.start!==period.start||prices.period?.end!==period.end)throw new Error('거래표의 분석 기간과 가격 평가 기준일이 일치하지 않습니다.');
 const rows=(prices.rows||[]).filter(t=>t.kind==='trade');if(!rows.length)throw new Error('최근 6개월에 동일 단지·선택 면적의 유효 매매 계약이 없습니다.');
 const selection=prices.effectiveArea||areaSelection(input),ids=new Set(),identity=prices.buildingResolution;
 for(const t of rows){
  if(typeof t.id!=='string'||!t.id||ids.has(t.id)||t.cancelled||!validDate(t.date)||t.date<period.start||t.date>period.end||!positive(t.price)||!positive(t.area)||t.areaBasis!=='전용면적'||!matchesArea(t.area,selection))throw new Error('가격 평가의 개별 계약에서 중복·해제·날짜·금액·전용면적 조건이 일치하지 않습니다.');
  if(input.building&&normalize(t.building)!==normalize(input.building)||identity&&(identity.town&&!String(t.location||'').split(/\s+/).includes(identity.town)||identity.lot&&lot(t.lot)!==lot(identity.lot)))throw new Error('가격 평가의 거래 단지·법정동·지번이 분석 대상과 다릅니다.');ids.add(t.id);
 }
 const amounts=mean(rows,'price'),areas=mean(rows,'area'),unit=unitMean(rows);
 if(!positive(amounts)||!positive(areas)||!positive(unit))throw new Error('가격 평균 계산에 필요한 유효 금액·면적이 없습니다.');
 if(Math.max(...rows.map(t=>t.area))-Math.min(...rows.map(t=>t.area))>=6.611569)throw new Error('전용면적이 2평 이상 다른 거래를 묶은 가격 평균은 평가할 수 없습니다. 타입별로 분리해야 합니다.');
 const groups=(prices.summaries||[]).filter(g=>g.kind==='trade');let count=0;
 for(const g of groups){const part=selection.areaMode==='all'?rows.filter(t=>t.area===g.area):rows;if(!Number.isInteger(g.n)||g.n!==part.length||!part.length||!close(g.price,mean(part,'price')))throw new Error('거래표의 매매 평균·건수와 개별 계약의 재계산이 일치하지 않습니다.');count+=g.n;}
 if(count!==rows.length)throw new Error('거래표의 매매 표본 건수와 가격 평가 표본이 일치하지 않습니다.');
 const cv=Math.sqrt(rows.reduce((s,t)=>s+(t.price-amounts)**2,0)/rows.length)/amounts;
 return {rows,period,selection,identity,mean:amounts,areaMean:areas,unitMean:unit,cv,lastContract:rows.map(t=>t.date).sort().at(-1)};
}
function peerFacts(e,input,own,prices){
 const p=e.peers;if(!p||p.status!=='verified')throw new Error(p?.reason||'동일 기간·유사 면적의 주변 비교 단지 거래를 확인하지 못했습니다.');
 if(p.period?.start!==own.period.start||p.period?.end!==own.period.end)throw new Error('주변 비교 거래와 대상 단지의 최근 6개월 기간이 다릅니다.');
 const checked=date(p.checkedAt),age=checked?(Date.parse(input.asOf)-Date.parse(checked))/86400000:NaN;if(!Number.isFinite(age)||age<0||age>30)throw new Error('주변 비교 거래 근거의 조회일이 없거나 평가 기준일·유효기간과 맞지 않습니다.');
 if(own.rows.length<3||!Number.isInteger(p.target?.n)||p.target.n!==own.rows.length||!close(p.target.unitMean,own.unitMean)||normalize(p.target.name)!==normalize(input.building))throw new Error('대상 단지의 매매 표본·㎡당 평균과 비교 근거가 일치하지 않습니다.');
 if(!Array.isArray(p.peers)||p.peers.length<2)throw new Error('가격의 상대 수준을 평가하려면 각 매매 3건 이상인 비교 단지가 2곳 이상 필요합니다.');
 const origin=e.center||own.identity,ownBasic=e.product?.status==='verified'?e.product:e.basic,ageBasis=peerRules.targetYearBasis({input,prices,basic:ownBasic}),town=own.identity?.town||pricesTown(own.rows[0],input),district=peerRules.districtOf(own.rows[0].location,town),expanded=p.version===peerRules.DISTRICT_VERSION;
 if(p.version&&![peerRules.SAME_TOWN_VERSION,peerRules.DISTRICT_VERSION].includes(p.version)||expanded&&p.scope!==peerRules.DISTRICT_SCOPE||!expanded&&p.scope&&p.scope!==peerRules.SAME_TOWN_SCOPE)throw new Error('주변 비교 자료의 기준 버전과 평가 범위가 일치하지 않습니다.');
 if(!point(origin)||!ageBasis||!town)throw new Error('주변 단지와 대조할 대상 단지의 좌표·사용승인 연도 또는 검증된 건축연도·법정동을 확인하지 못했습니다.');
 if(point(own.identity)&&distance(origin,own.identity)>100)throw new Error('가격 비교 기준 좌표가 공식 대상 단지 기준점과 일치하지 않습니다.');
 if(p.targetAge&&(p.targetAge.kind!==ageBasis.kind||p.targetAge.year!==ageBasis.year||p.targetAge.approvalDate!==ageBasis.approvalDate||ageBasis.kind==='transaction-building-year'&&(p.targetAge.n!==ageBasis.n||p.targetAge.period?.start!==own.period.start||p.targetAge.period?.end!==own.period.end||p.targetAge.identity?.code!==own.identity?.code||p.targetAge.identity?.town!==town||lot(p.targetAge.identity?.lot)!==lot(own.identity?.lot)||p.targetAge.source?.url!==ageBasis.source.url||date(p.targetAge.source?.checkedAt)!==date(ageBasis.source.checkedAt))))throw new Error('대상 단지 연식 근거가 현재 거래·단지 자료의 재검증과 일치하지 않습니다.');
 if(ageBasis.kind==='transaction-building-year'&&!p.targetAge)throw new Error('거래 기록 건축연도의 사용 범위와 근거가 없어 연식 비교를 보류합니다.');
 const expansion=p.expansion,sameTownCount=p.peers.filter(peer=>peer.town===town).length;
 if(expanded&&(!p.targetAge||!/^\d{5}$/.test(String(own.identity?.regionCode||''))||!district||expansion?.fromScope!==peerRules.SAME_TOWN_SCOPE||expansion.targetTown!==town||expansion.regionCode!==String(own.identity.regionCode)||expansion.sameTownPeerCount!==sameTownCount||sameTownCount>=2||expansion.requiredPeerBuildings!==2||typeof expansion.reason!=='string'||!expansion.reason.trim()||expansion.distanceBasis!=='공식 대상 단지 기준점과 등록 비교 단지 좌표 간 직선거리'||!Array.isArray(expansion.towns)||JSON.stringify(expansion.towns)!==JSON.stringify([...new Set(p.peers.map(peer=>peer.town))].sort())||sameTownCount===p.peers.length))throw new Error('같은 동의 표본 부족·같은 구 인접 동의 범위 확대 사유와 기준을 확인하지 못했습니다.');
 const ids=new Set(own.rows.map(t=>t.id)),contractKeys=new Set(own.rows.map(t=>peerRules.contractKey(t))),kaptCodes=new Set(),physical=new Set(),targetPhysical=new Set(own.rows.map(t=>[normalize(t.building),pricesTown(t,input),lot(t.lot)].join('|'))),contracts=[],addressSources=[],tolerance=Math.min(own.areaMean*.05,6.611569);
 for(const peer of p.peers){
  const b=peer.basicSource,bChecked=date(b?.checkedAt),bAge=bChecked?(Date.parse(input.asOf)-Date.parse(bChecked))/86400000:NaN;
  if(!official(peer.priceSource)||!official(b?.originalReference,'www.k-apt.go.kr')||!Number.isFinite(bAge)||bAge<0||bAge>30||b.basicUpdatedAt&&(!date(b.basicUpdatedAt)||date(b.basicUpdatedAt)>input.asOf))throw new Error('비교 단지의 거래·단지 등록 출처와 조회일을 확인하지 못했습니다.');
  if(!peer.name||!peer.town||!peer.lot||!validDate(peer.approvalDate)||peer.approvalDate>input.asOf||!Number.isInteger(peer.n)||peer.n<3||!Array.isArray(peer.contracts)||peer.contracts.length!==peer.n)throw new Error('비교 단지의 식별 조건·사용승인·개별 계약 건수가 부족하거나 일치하지 않습니다.');
  if(!expanded&&peer.town!==town||Math.abs(Number(peer.approvalDate.slice(0,4))-ageBasis.year)>5||!point(peer)||!Number.isFinite(peer.distanceM)||peer.distanceM<0||peer.distanceM>2000||distance(origin,peer)>2000||Math.abs(distance(origin,peer)-peer.distanceM)>Math.max(35,peer.distanceM*.08))throw new Error('비교 단지의 법정동·연식·실제 직선거리 조건이 대상 단지와 맞지 않습니다.');
  if(p.version||peer.officialAddress||peer.bjdCode||peer.regionProof){const address=peerRules.addressFacts(peer.officialAddress),bjdCode=String(peer.bjdCode||''),proof=!bjdCode&&peerRules.validRegionProof(peer.regionProof,{address,candidate:peer,regionCode:own.identity?.regionCode,asOf:input.asOf})?peer.regionProof:null,code=bjdCode||proof?.response.region_code||'';if(!address||!/^\d{10}$/.test(code)||!bjdCode&&!proof||proof&&peer.regionCodeBasis!=='exact-address-geocode'||peer.regionCode!==code.slice(0,5)||own.identity?.regionCode&&peer.regionCode!==String(own.identity.regionCode)||normalize(address.district)!==district||address.town!==peer.town||address.lot!==lot(peer.lot)||normalize(address.location)!==normalize(peer.location))throw new Error('비교 단지의 공식 주소·법정동 코드 또는 별도 정확 주소 지오코딩이 대상과 같은 구로 확인되지 않습니다.');if(proof)addressSources.push({id:'ev-peer-geo-'+createHash('sha256').update([peer.kaptCode,proof.queryAddress,proof.checkedAt].join('|')).digest('hex').slice(0,12),title:'정확 주소 지오코딩 · '+peer.name+' ('+proof.provider+')',url:proof.sourceUrl,checkedAt:date(proof.checkedAt)});}
  if(peer.kaptCode&&kaptCodes.has(peer.kaptCode))throw new Error('같은 비교 단지 번호가 중복되어 주변 가격 비교를 보류합니다.');if(peer.kaptCode)kaptCodes.add(peer.kaptCode);
  if(peer.kaptCode&&peer.kaptCode===ownBasic?.kaptCode||lot(peer.lot)===lot(own.identity?.lot||own.rows[0].lot)&&compatibleName(peer.name,input.building)||[...physical].some(key=>{const [name,peerTown,peerLot]=key.split('|');return peerTown===peer.town&&peerLot===lot(peer.lot)&&compatibleName(name,peer.name);}))throw new Error('대상 단지 자체 또는 같은 단지의 명칭 변형이 중복되어 주변 가격 비교를 보류합니다.');
  const key=[normalize(peer.name),peer.town,lot(peer.lot)].join('|');if(physical.has(key)||targetPhysical.has(key))throw new Error('같은 비교 단지가 중복되거나 대상 단지 자체가 포함되어 상대 가격을 산출하지 않았습니다.');physical.add(key);
  for(const t of peer.contracts){const contractKey=peerRules.contractKey(t,peer);if(typeof t.id!=='string'||!t.id||ids.has(t.id)||contractKeys.has(contractKey)||t.cancelled||!validDate(t.date)||t.date<own.period.start||t.date>own.period.end||!positive(t.price)||!positive(t.area)||Math.abs(t.area-own.areaMean)>tolerance||Math.abs(t.area-own.areaMean)>=6.611569||(expanded||p.version)&&(t.kind!=='trade'||t.areaBasis!=='전용면적'||normalize(t.location)!==normalize(peer.location)||lot(t.lot)!==lot(peer.lot)||!compatibleName(t.building,peer.name)))throw new Error('주변 비교 계약의 중복·날짜·금액·면적·공식 주소 조건이 맞지 않습니다.');ids.add(t.id);contractKeys.add(contractKey);contracts.push(t);}
  if(!close(peer.unitMean,unitMean(peer.contracts)))throw new Error('비교 단지의 ㎡당 평균과 개별 계약 재계산이 일치하지 않습니다.');
 }
 const unit=unitMean(contracts),gap=(own.unitMean/unit-1)*100;if(!positive(unit)||p.peerContracts!==contracts.length||!close(p.peerUnitMean,unit)||!close(p.gapPercent,gap)||Math.abs(gap)>40)throw new Error('주변 계약 전체의 평균·건수·가격 차이가 재계산과 다르거나 차이가 커서 조건 확인이 필요합니다.');
 return {unitMean:unit,gapPercent:gap,n:contracts.length,buildings:p.peers.length,contracts,checkedAt:checked,criteria:p.criteria||'같은 기간·같은 법정동·유사 전용면적·유사 연식의 비교 계약',version:expanded?peerRules.DISTRICT_VERSION:peerRules.SAME_TOWN_VERSION,scope:expanded?peerRules.DISTRICT_SCOPE:peerRules.SAME_TOWN_SCOPE,expanded,expansion:expanded?expansion:null,targetAge:ageBasis,addressSources,registrationNote:addressSources.length?'일부 단지의 등록 스냅샷에는 법정동 코드가 없어 정확 주소 지오코딩의 같은 구 코드·동·지번과 등록 좌표 100m 이내를 별도로 대조했습니다. 공식 단건 K-apt 기본정보의 해당 코드는 미확인입니다. ':'',locations:p.peers.map(peer=>({name:peer.name,town:peer.town,distanceM:peer.distanceM,n:peer.n}))};
}
function pricesTown(t,input){return String(t.location||'').split(/\s+/).find(s=>/(?:동|리|읍|면)$/.test(s))||String(input.target||'').split(/\s+/).find(s=>/(?:동|리|읍|면)$/.test(s))||'';}
function differencePoints(gap){return gap<=-10+1e-9?90:gap<=-5+1e-9?80:gap<=5+1e-9?65:gap<=10+1e-9?50:35;}
function listingFacts(e,input,prices){
 if(!input.types?.includes('trade'))throw new Error('매매 호가 평가는 매매 거래 유형을 선택한 경우에만 적용합니다.');
 const data=e.listings;if(data?.status!=='verified')throw new Error(data?.reason||'현재 활성 호가를 제공하는 검증된 매물 자료 연결이 없습니다.');
 if(data.provenance!=='authorized-source-records'||data.complete!==true||data.truncated||data.hasMore||data.pagination?.has_more||data.metadata?.truncated||!Array.isArray(data.listings))throw new Error('현재 호가의 허가된 원자료·활성 목록 전체 조회 여부를 확인하지 못했습니다.');
 const source=data.source,checked=date(data.checkedAt||source?.checkedAt),sourceDate=date(source?.checkedAt);let parsed;try{parsed=new globalThis.URL(source?.url);}catch{}if(typeof source?.id!=='string'||!source.id||!source.title||!parsed||parsed.protocol!=='https:'||parsed.username||parsed.password||[...parsed.searchParams.keys()].some(k=>/token|auth|secret|password|api.?key|service.?key/i.test(k))||checked!==input.asOf||sourceDate!==checked||checked>todayKst()||data.asOf!==input.asOf)throw new Error('현재 호가 출처·조회일·분석 기준일을 확인하지 못했습니다.');
 const identity=prices.buildingResolution;if(!identity?.code||String(data.identity?.code)!==String(identity.code)||data.identity?.town!==identity.town||lot(data.identity?.lot)!==lot(identity.lot))throw new Error('현재 호가 목록의 공식 단지·법정동·지번이 분석 대상과 다릅니다.');
 const selection=prices.effectiveArea||areaSelection(input);if(selection.areaMode==='all')throw new Error('현재 호가 평균에는 비교할 전용면적·타입 선택이 필요합니다.');
 const units=new Map(),ads=new Map();for(const item of data.listings){
  if(typeof item.id!=='string'||!item.id.trim()||item.id!==item.id.trim()||typeof item.unitId!=='string'||!item.unitId.trim()||item.unitId!==item.unitId.trim()||item.active!==true||item.status&&item.status!=='active'||item.cancelled||item.removed||item.kind!=='trade'||String(item.buildingCode)!==String(identity.code)||item.areaBasis!=='전용면적'||!positive(item.area)||!matchesArea(item.area,selection)||!positive(item.price)||date(item.verifiedAt)!==checked||item.updatedAt&&(!date(item.updatedAt)||date(item.updatedAt)>checked)||item.sourceId&&item.sourceId!==source.id)throw new Error('현재 매물의 활성 상태·호수 식별·전용면적·거래 유형·가격·확인일을 대조하지 못했습니다.');
  if(ads.has(item.id)&&ads.get(item.id)!==item.unitId)throw new Error('같은 매물 번호에 서로 다른 호수가 연결되어 호가 평균을 산출하지 않았습니다.');ads.set(item.id,item.unitId);
  const old=units.get(item.unitId);if(old&&(!close(old.price,item.price)||!close(old.area,item.area)))throw new Error('같은 호수의 등록 가격·면적이 서로 달라 호가 평균을 산출하지 않았습니다.');if(!old)units.set(item.unitId,item);
 }
 if(data.totalCount!=null&&(!Number.isInteger(data.totalCount)||data.totalCount!==data.listings.length))throw new Error('조회된 현재 호가 목록과 제공 건수가 달라 누락 여부를 확인해야 합니다.');
 const records=[...units.values()];if(records.length<3)throw new Error(`활성·중복 호수 제외 후 확인된 매매 호가는 ${records.length}개입니다. 현재 호가 평균 평가에는 비교 가능한 3개 호수 이상이 필요합니다.`);
 const amount=mean(records,'price'),cv=Math.sqrt(records.reduce((s,t)=>s+(t.price-amount)**2,0)/records.length)/amount;return {source:{id:source.id,title:String(source.title).slice(0,200),url:source.url,checkedAt:checked},checkedAt:checked,n:records.length,rawCount:data.listings.length,mean:amount,unitMean:unitMean(records),areaMean:mean(records,'area'),cv,records};
}
function applyPrice(scores,e,{input,prices,dataCheckedAt}={}){
 const index=scores.findIndex(s=>s.name===NAME);if(index<0)return {row:null,priceBasis:null};
 const mode=input.priceBasisMode||'listing-first',offered=input.offered,hasOffered=offered!==null&&offered!==undefined;
 let listing=null,basis={kind:hasOffered?'offered':mode==='recent-transactions'?'transaction-average':mode,requestedKind:hasOffered?'offered':mode==='recent-transactions'?'recent-transactions':'current-listings',status:'unavailable',amount:null,currency:'만원',asOf:input.asOf},row={name:NAME,score:null,status:'withheld',coverage:0,scope:'평가 보류',observed:'가격 평가에 필요한 거래 근거를 확인하지 못했습니다.',needed:'같은 단지·선택 전용면적의 최근 6개월 매매 계약과 출처',reason:'가격 평가 근거 미확인',method:'필요한 조건을 확인하지 못한 항목은 점수를 만들지 않습니다. '+VERSION,sourceIds:[]};
 const finish=()=>{row.priceBasis=basis;scores[index]=row;e.priceBasis=basis;return {row,priceBasis:basis};};
 try{
  if(!hasOffered&&['listing-first','current-listings'].includes(mode)){
   try{listing=listingFacts(e,input,prices);basis={...basis,kind:'current-listing-average',status:'verified',amount:listing.mean,n:listing.n,checkedAt:listing.checkedAt,sourceId:listing.source.id,fallback:false,method:'같은 단지·전용면적·매매의 현재 활성 매물을 확인하고 같은 호수 중복을 제외한 호가 합계 ÷ 고유 호수 수',note:'확인한 현재 등록 매물의 호가 평균이며 실거래가·확정 거래 가능 가격이 아닙니다.'};if(!Array.isArray(e.sources))e.sources=[];if(!e.sources.some(s=>s.id===listing.source.id))e.sources.push(listing.source);row.observed=`현재 활성 매매 ${listing.n}개 호수 / 등록 호가 평균 ${money(listing.mean)}`;row.sourceIds=[listing.source.id];}
   catch(error){if(mode==='current-listings'){row.reason=error.message+' 실거래 평균을 현재 호가로 대신 사용하지 않았습니다.';row.needed='현재 등록 호가 자료의 공식·허가된 연결 또는 확인 가능한 매물 목록';basis.reason=row.reason;return finish();}basis={...basis,kind:'transaction-average',fallback:true,fallbackReason:error.message,note:'현재 등록 호가를 확인할 자료가 없거나 부족하여 최근 6개월 실거래 평균을 참고합니다. 현재 호가로 표시하지 않습니다.'};}
  }
  if(!hasOffered&&!['recent-transactions','listing-first','current-listings'].includes(mode))throw new Error('가격 평가 기준을 다시 선택해야 합니다.');
  if(hasOffered&&(!Number.isFinite(offered)||offered<0))throw new Error('제시가격이 유효한 만원 단위 금액이 아닙니다.');
  if(!input.types?.includes('trade'))throw new Error('선택한 거래 유형에 매매가 없어 매매 가격 경쟁력을 산출하지 않았습니다.');
  const own=ownFacts(input,prices),checkedAt=checkedDate(prices,e,dataCheckedAt,own.lastContract);if(!checkedAt)throw new Error('동일 단지 거래의 공식 출처와 실제 조회일을 확인하지 못해 가격 점수를 보류합니다.');
  if(own.selection.areaMode==='all')throw new Error('여러 크기의 매매 금액을 한 가격으로 비교할 수 없어 전용면적·타입 선택이 필요합니다.');
  const id='ev-price-'+createHash('sha256').update([input.building,input.asOf,own.selection.label,basis.kind].join('|')).digest('hex').slice(0,12),source={id,title:'국토교통부 실거래가 · 동일 단지·선택 면적 매매',url:URL,checkedAt};
  if(!Array.isArray(e.sources))e.sources=[];const old=e.sources.findIndex(s=>s.id===id);if(old<0)e.sources.push(source);else e.sources[old]=source;
  row.observed=(listing?row.observed+' / ':'')+`동일 단지 매매 ${own.rows.length}건 / 최근 6개월 평균 ${money(own.mean)}`;row.sourceIds=listing?[listing.source.id,id]:[id];
  basis={...basis,status:'verified',amount:hasOffered?offered:listing?listing.mean:own.mean,n:listing?listing.n:own.rows.length,ownN:own.rows.length,period:listing?{start:input.asOf,end:input.asOf}:own.period,referencePeriod:own.period,checkedAt:listing?listing.checkedAt:checkedAt,sourceId:listing?listing.source.id:id,transactionSourceId:id,actualAreas:[...new Set((listing?listing.records:own.rows).map(t=>t.area))].sort((a,b)=>a-b),ownActualAreas:[...new Set(own.rows.map(t=>t.area))].sort((a,b)=>a-b),ownMean:own.mean,ownUnitMean:own.unitMean,areaMean:listing?listing.areaMean:own.areaMean,ownAreaMean:own.areaMean,method:listing?basis.method:'최근 6개월의 비교 가능한 개별 매매 계약 금액 합계 ÷ 계약 건수. 월별·타입별 평균의 단순평균이 아닙니다.',note:hasOffered?'사용자가 입력한 제시가격과 동일 단지의 계약 표본을 비교합니다.':listing?basis.note:(basis.fallback?'현재 등록 호가 자료가 없거나 부족하여 실거래 평균을 참고했습니다. ':'')+'최근 6개월 계약 표본의 산술평균이며 현재 등록 호가·특정 매물 제시가격·확정 거래 가능 가격이 아닙니다.'};
  if(prices.areaResolution)throw new Error('요청한 타입과 다른 면적군을 적용해 가격 경쟁력 평가를 보류합니다.');
  if(hasOffered){
   if(!Number.isFinite(offered)||offered<0)throw new Error('제시가격이 유효한 만원 단위 금액이 아닙니다.');
   if(own.rows.length<5)throw new Error('제시가격 평가에는 비교 가능한 동일 단지 매매 계약이 5건 이상 필요합니다.');
   const gap=(offered/own.mean-1)*100;if(Math.abs(gap)>25+1e-9||own.cv>.2+1e-12)throw new Error('제시가격 차이 또는 거래 표본의 가격 편차가 커서 조건 차이를 확인하기 전에는 점수를 산출하지 않습니다.');
   const gapPoints=differencePoints(gap),reliability=own.rows.length>=10?90:75,score=Math.round(gapPoints*.6+reliability*.4);basis.gapPercent=gap;
   row={...row,score,status:'partial',coverage:60,scope:'제시가격·거래 표본 비교',observed:row.observed+` / 제시 ${money(offered)} / 평균 대비 ${gap>=0?'+':''}${gap.toFixed(1)}%`,needed:'동·층·향·수선 상태와 거래 조건 차이의 개별 대조',reason:'제시가격 차이와 표본 건수를 함께 반영한 부분 평가입니다. 개별 세대 상태를 확인한 적정가격 평가가 아닙니다.',method:`${VERSION}. 표본 5건 이상·가격 변동계수 ≤0.20·제시가격 차이 절댓값 ≤25%에서만 산출. 차이 ≤-10% 90 / ≤-5% 80 / ≤5% 65 / ≤10% 50 / 초과 35점. 차이 점수 60% + 표본(10건 이상 90·5~9건 75점) 40%. 반올림. 전체 배점 중 확인 비중 60%. 층·향·상태는 미평가.`,calculation:[{indicator:'제시가격 차이',value:gap,unit:'%',points:gapPoints,weight:60},{indicator:'표본 건수',value:own.rows.length,unit:'건',points:reliability,weight:40}]};return finish();
  }
  if(listing){
   if(own.rows.length<5)throw new Error('현재 호가 평균과 대조할 같은 단지의 최근 6개월 매매 계약이 5건 미만입니다.');
   const gap=(listing.unitMean/own.unitMean-1)*100;if(Math.abs(gap)>25+1e-9||listing.cv>.2+1e-12||own.cv>.2+1e-12)throw new Error('현재 호가와 실거래의 가격 차이 또는 표본 편차가 커서 개별 조건을 확인하기 전에는 점수를 산출하지 않습니다.');
   const points=differencePoints(gap);basis.comparison={kind:'same-complex-transaction-average',n:own.rows.length,unitMean:own.unitMean,askingUnitMean:listing.unitMean,gapPercent:gap,period:own.period,checkedAt};
   row={...row,score:points,status:'partial',coverage:40,scope:'등록 호가평균·실거래 비교',observed:row.observed+` / ㎡당 호가 평균과 실거래 평균 차이 ${gap>=0?'+':''}${gap.toFixed(1)}%`,needed:'개별 호수의 층·향·수선·입주 조건과 실제 협상 가격. 호가 평균은 체결 가능한 가격을 보장하지 않습니다.',reason:'허가된 원자료에서 확인한 현재 활성 매매 호가와 과거 계약 표본을 구분해 대조한 부분 평가입니다.',method:`${VERSION}. 활성 매매 3개 고유 호수 이상·같은 단지 실거래 5건 이상·양쪽 가격 변동계수 ≤0.20·㎡당 평균 차이 절댓값 ≤25%. 차이 ≤-10%90 / ≤-5%80 / ≤5%65 / ≤10%50 / 초과35점. 확인 배점40%. 호가와 실거래의 성격·시점 차이를 공개하며 개별 매물 적정가격·미래 수익은 미평가.`,calculation:[{indicator:'현재 호가·최근 실거래 ㎡당 평균 차이',value:gap,unit:'%',weight:40,points}]};return finish();
  }
  const peer=peerFacts(e,input,own,prices),points=differencePoints(peer.gapPercent);basis.comparison={kind:peer.expanded?'district-nearby-transaction-average':'nearby-transaction-average',version:peer.version,scope:peer.scope,peerBuildings:peer.buildings,n:peer.n,unitMean:peer.unitMean,targetArea:own.areaMean,targetNormalizedAmount:own.unitMean*own.areaMean,peerSameAreaAmount:peer.unitMean*own.areaMean,gapPercent:peer.gapPercent,period:own.period,checkedAt:peer.checkedAt,criteria:peer.criteria,expansion:peer.expansion,targetAge:peer.targetAge,locations:peer.locations};
  for(const source of peer.addressSources){if(!e.sources.some(s=>s.id===source.id))e.sources.push(source);row.sourceIds.push(source.id);}basis.comparison.addressSources=peer.addressSources;basis.comparison.registrationNote=peer.registrationNote;
  basis.method+=' 상대 수준은 대상·주변 각각의 개별 계약별 (금액÷전용면적) 산술평균을 산출한 후 (대상 평균÷주변 평균-1)×100으로 비교합니다. 표시 전용면적에 곱한 환산금액은 비교 보조값이며 실제 해당 면적 계약의 평균으로 바꾸어 표시하지 않습니다.';
  const scope=peer.expanded?'동일면적 거래평균·같은 구 인접동 비교':'동일면적 거래평균·주변단지 비교',scopeNote=(peer.expanded?peer.expansion.reason+' 비교 동·직선거리: '+peer.locations.map(p=>`${p.name}(${p.town}, ${p.distanceM}m)`).join(' / ')+'. 같은 법정동만 비교한 점수와 평가 범위가 다릅니다. ':'')+peer.registrationNote;
  row={...row,score:points,status:'partial',coverage:40,scope,comparisonVersion:peer.version,comparisonScope:peer.scope,observed:row.observed+` / 주변 ${peer.buildings}개 단지 ${peer.n}건 / ㎡당 계약 평균 대비 ${peer.gapPercent>=0?'+':''}${peer.gapPercent.toFixed(1)}%`+(peer.expanded?' / 같은 구·직선 2km 인접 동 포함':'')+(basis.fallback?' / 현재 호가 자료 부족에 따른 실거래 참고 기준':''),needed:'특정 매물의 제시가격·동·층·향·수선·거래 조건. 현재 등록 호가나 특정 매물의 적정가격 평가는 별도 확인이 필요합니다.',reason:scopeNote+'같은 기간·유사 면적의 주변 계약과 비교한 관측 상대가격의 부분 평가입니다. 자기 평균을 자기 평균과 비교하거나 제시가격으로 대입하지 않았습니다.',method:`${VERSION}. 비교 기준 ${peer.version} / ${peer.scope}. ${scopeNote}${peer.criteria}. ${peer.targetAge.note} ㎡당 개별 계약 평균 차이 ≤-10% 90 / ≤-5% 80 / ≤5% 65 / ≤10% 50 / 초과 35점. 확인 배점 40%. 대상 3건 이상·각 3건 이상인 비교 단지 2곳 이상. 모든 계약·평균·건수·기간·출처를 재대조. 개별 매물 조건·호가·적정 매수가·미래 수익은 미평가.`,calculation:[{indicator:'주변 거래 대비 동일 면적 기준 상대가격',value:peer.gapPercent,unit:'%',weight:40,points},{indicator:'대상 ㎡당 개별 계약 평균',value:own.unitMean,unit:'만원/㎡',weight:0},{indicator:'주변 ㎡당 개별 계약 평균',value:peer.unitMean,unit:'만원/㎡',weight:0}]};
 }catch(error){row.reason=error.message;row.needed=hasOffered?'동일 단지·선택 전용면적의 충분한 매매 표본·조회일 / 제시가격과 개별 조건 대조':'동일 기간·유사 면적 비교 단지 2곳 이상과 단지별 매매 3건 이상 / 개별 매물 제시가격·조건';basis.scoringStatus='withheld';basis.reason=error.message;}
 return finish();
}
module.exports={VERSION,applyPrice,ownFacts,checkedDate,peerFacts,listingFacts,differencePoints};
