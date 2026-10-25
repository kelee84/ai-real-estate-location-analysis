'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {SCORE_ITEMS,normalizeInput,aggregate,sixMonthWindow}=require('../src/core.cjs');
const {applyPrice,differencePoints}=require('../src/price-scoring.cjs');
const input=normalizeInput({target:'인천 연수구 송도동 대상단지',building:'대상단지',area:'84.9',asOf:'2026-10-17',types:['trade']});
const checkedAt='2026-10-16T15:39:30.805Z',url='https://rt.molit.go.kr/pt/xls/xls.do';
// Historical engine compatibility is tested explicitly; new living axes do not include a price score.
const rows=()=>['가격 경쟁력'].map(name=>({name,score:null,status:'withheld',reason:'기존 보류',sourceIds:[]}));
function prices(n=5,amounts){const p=aggregate(Array.from({length:n},(_,i)=>({id:'t'+i,kind:'trade',date:'2026-08-'+String(i+1).padStart(2,'0'),price:amounts?.[i]??100000,area:84.9,areaBasis:'전용면적',building:'대상단지',location:'인천광역시 연수구 송도동',lot:'18-6'})),input,[{deal:'trade',status:'success',source:url,checkedAt}]);p.buildingResolution={building:'대상단지',code:'target',town:'송도동',lot:'18-6'};return p;}
function evidence(p=prices(),peerPrice=110000){
 const peers=[1,2].map(i=>{const contracts=[1,2,3].map(j=>({id:'p'+i+'-'+j,date:'2026-07-0'+j,price:peerPrice,area:84.9}));return {kaptCode:'Apeer00'+i,name:'비교단지'+i,town:'송도동',lot:'2'+i+'-1',lat:i===1?37.401:37.399,lng:126.64,distanceM:111,approvalDate:'2014-08-29',n:3,contracts,unitMean:peerPrice/84.9,priceSource:url,basicSource:{dataSource:'REF_DB',checkedAt,originalReference:'https://www.k-apt.go.kr/'}};});
 const ownUnit=p.rows.reduce((s,t)=>s+t.price/t.area,0)/p.rows.length,peerUnit=peerPrice/84.9;
 return {sources:[],center:{lat:37.4,lng:126.64},basic:{kaptCode:'Atarget01',approvalDate:'2014-08-29'},peers:{status:'verified',period:sixMonthWindow(input.asOf),checkedAt,criteria:'같은 기간·동일 법정동·유사 전용면적·사용승인 차이 5년 이내',target:{name:input.building,n:p.rows.length,unitMean:ownUnit},peers,peerContracts:6,peerUnitMean:peerUnit,gapPercent:(ownUnit/peerUnit-1)*100}};
}
function run({p=prices(),e=evidence(p),i=input,dataCheckedAt=checkedAt}={}){const scores=rows(),before=structuredClone(i),result=applyPrice(scores,e,{input:i,prices:p,dataCheckedAt});assert.deepEqual(i,before);return {scores,e,...result};}
test('missing offer uses real transaction average and independent peer prices, never mean versus itself',()=>{
 const r=run();assert.equal(r.row.score,80);assert.equal(r.row.coverage,40);assert.equal(r.row.scope,'동일면적 거래평균·주변단지 비교');assert.equal(r.priceBasis.kind,'transaction-average');assert.equal(r.priceBasis.amount,100000);assert.ok(Math.abs(r.priceBasis.comparison.peerSameAreaAmount-110000)<.000001);assert.equal(r.priceBasis.comparison.n,6);assert.equal(r.priceBasis.comparison.peerBuildings,2);assert.equal(input.offered,null);assert.match(r.priceBasis.note,/현재 등록 호가/);assert.doesNotMatch(r.row.scope,/프리미엄/);
 const expensive=run({e:evidence(prices(),90000)});assert.equal(expensive.row.score,35);assert.notEqual(expensive.row.score,r.row.score);
});
test('same-property arithmetic means are not substituted into offered or given a constant score',()=>{
 const e={sources:[],peers:{status:'unavailable',reason:'동일 조건 비교 단지가 부족합니다.'}},r=run({e});assert.equal(r.row.score,null);assert.equal(r.priceBasis.amount,100000);assert.equal(r.priceBasis.status,'verified');assert.match(r.row.reason,/비교 단지/);assert.equal(input.offered,null);
});
test('manual offer retains five-contract, dispersion, gap and disclosed 60% rules',()=>{
 const r=run({i:{...input,offered:100000}});assert.equal(r.row.score,69);assert.equal(r.row.coverage,60);assert.equal(r.priceBasis.kind,'offered');assert.equal(r.priceBasis.amount,100000);assert.equal(run({p:prices(10),i:{...input,offered:100000}}).row.score,75);
 for(const [p,offered]of [[prices(4),100000],[prices(),150000],[prices(5,[10000,10000,10000,400000,400000]),166000]])assert.equal(run({p,i:{...input,offered}}).row.score,null);
});
test('percentage band boundaries use mathematical thresholds despite floating point roundoff',()=>{
 assert.equal(differencePoints(-9.999999999999998),90);assert.equal(differencePoints(5.000000000000004),65);assert.equal(differencePoints(10.000000000000009),50);assert.equal(run({i:{...input,offered:90000}}).row.score,84);assert.equal(run({i:{...input,offered:105000}}).row.score,69);
});
test('current-listing mode stays unavailable without active verified listings and cannot use transaction fallback',()=>{
 const r=run({i:{...input,priceBasisMode:'current-listings'}});assert.equal(r.row.score,null);assert.equal(r.priceBasis.kind,'current-listings');assert.equal(r.priceBasis.amount,null);assert.equal(r.priceBasis.status,'unavailable');assert.match(r.row.reason,/현재 활성/);assert.match(r.row.reason,/대신 사용하지/);assert.equal(r.e.sources.length,0);
 const explicit=run({i:{...input,offered:100000,priceBasisMode:'current-listings'}});assert.equal(explicit.row.score,69);assert.equal(explicit.priceBasis.kind,'offered');
});
test('price proof references the real source and Korean lookup date while preserving input and prices',()=>{
 const p=prices(),before=structuredClone(p),r=run({p});assert.deepEqual(p,before);assert.equal(r.e.sources[0].checkedAt,'2026-10-17');assert.equal(r.e.sources[0].url,url);assert.equal(r.row.sourceIds[0],r.e.sources[0].id);assert.equal(r.priceBasis.checkedAt,'2026-10-17');assert.equal(r.e.priceBasis,r.priceBasis);
});
test('missing, unverified or future-dated transaction source cannot produce a price score',()=>{
 for(const change of [p=>p.coverage=[],p=>p.coverage[0].source='https://rt.molit.go.kr.invalid.test/',p=>p.coverage[0].checkedAt='2099-01-01']){const p=prices();change(p);const r=run({p,e:evidence(p),dataCheckedAt:null});assert.equal(r.row.score,null);assert.match(r.row.reason,/공식 출처|조회일/);}
});
test('target contracts and displayed arithmetic summaries are independently cross-checked',()=>{
 for(const mutate of [p=>p.summaries[0].price+=1,p=>p.summaries[0].n+=1,p=>p.rows[0].date='2026-04-32',p=>p.rows[0].cancelled=true,p=>p.rows[0].price=0,p=>p.rows[0].price=NaN,p=>p.rows[0].area=0,p=>p.rows[0].id=p.rows[1].id,p=>p.rows[0].building='다른단지',p=>p.rows[0].lot='18-7',p=>p.period.start='2026-04-16']){const p=prices();mutate(p);assert.equal(run({p,e:evidence(prices())}).row.score,null);}
});
test('area substitution and an unspecified size do not silently price a different product',()=>{
 const p=prices();p.areaResolution={requested:84,applied:83};assert.equal(run({p}).row.score,null);
 const allInput={...input,area:null,areaMode:'all'},all=aggregate(prices().rows,allInput,prices().coverage);all.buildingResolution=prices().buildingResolution;const r=run({p:all,i:allInput,e:evidence(all)});assert.equal(r.row.score,null);assert.equal(r.priceBasis.amount,null);assert.match(r.row.reason,/전용면적/);
});
test('automatic assessment requires two peer buildings, three contracts each, matching target and periods',()=>{
 for(const mutate of [e=>e.peers.peers.pop(),e=>e.peers.peers[0].n=2,e=>e.peers.target.n=2,e=>e.peers.period.start='2026-04-16',e=>e.peers.checkedAt='2099-01-01',e=>e.peers.checkedAt='2026-08-01',e=>e.peers.target.name='다른단지']){const e=evidence();mutate(e);assert.equal(run({e}).row.score,null);}
});
test('peer stored means, individual amounts, counts, area and source are rechecked',()=>{
 const cases=[e=>e.peers.peerUnitMean+=1,e=>e.peers.peerContracts+=1,e=>e.peers.gapPercent+=1,e=>e.peers.target.unitMean+=1,e=>e.peers.peers[0].unitMean+=1,e=>e.peers.peers[0].contracts[0].price=0,e=>e.peers.peers[0].contracts[0].area=59,e=>e.peers.peers[0].contracts[0].date='2026-04-32',e=>e.peers.peers[0].contracts[0].cancelled=true,e=>e.peers.peers[0].priceSource='https://other.test/',e=>e.peers.peers[0].basicSource.checkedAt='2099-01-01',e=>e.peers.peers[0].basicSource.originalReference='https://other.test/'];
 for(const mutate of cases){const e=evidence();mutate(e);assert.equal(run({e}).row.score,null);}
});
test('duplicate peer contracts, duplicate buildings and target self-comparisons cannot pass',()=>{
 for(const mutate of [e=>e.peers.peers[1].contracts[0].id=e.peers.peers[0].contracts[0].id,e=>{e.peers.peers[1].name=e.peers.peers[0].name;e.peers.peers[1].lot=e.peers.peers[0].lot;},e=>{e.peers.peers[0].name=input.building;e.peers.peers[0].lot='18-6';},e=>e.peers.peers[0].contracts[0].id='t0']){const e=evidence();mutate(e);assert.equal(run({e}).row.score,null);}
});
test('invalid offered values and unavailable raw trades leave no fabricated amount',()=>{
 for(const offered of [NaN,Infinity,-1,'100000']){const r=run({i:{...input,offered}});assert.equal(r.row.score,null);assert.equal(r.priceBasis.amount,null);}
 const p=prices();p.rows=[];p.summaries=[];const r=run({p,e:{sources:[]}});assert.equal(r.row.score,null);assert.equal(r.priceBasis.amount,null);
});
function listings(){return {status:'verified',provenance:'authorized-source-records',complete:true,asOf:input.asOf,checkedAt,identity:{code:'target',town:'송도동',lot:'18-6'},source:{id:'authorized-listings',title:'허가된 활성 매물 원자료 · 테스트 예시',url:'https://provider.example.test/active-listings',checkedAt},totalCount:3,listings:[1,2,3].map(i=>({id:'ad-'+i,unitId:'physical-unit-'+i,active:true,status:'active',kind:'trade',buildingCode:'target',areaBasis:'전용면적',area:84.9,price:105000,verifiedAt:checkedAt}))};}
test('default requests current listings first and explicitly falls back to recent actual contracts',()=>{
 const e=evidence();e.listings={status:'unavailable',reason:'현재 활성 매물 호가 제공 연결이 없습니다.'};const r=run({e});assert.equal(r.row.score,80);assert.equal(r.priceBasis.kind,'transaction-average');assert.equal(r.priceBasis.requestedKind,'current-listings');assert.equal(r.priceBasis.fallback,true);assert.match(r.priceBasis.fallbackReason,/제공 연결/);assert.match(r.priceBasis.note,/실거래 평균/);assert.match(r.row.observed,/현재 호가 자료 부족/);
});
test('verified complete active listings use unique physical units and stay separate from recorded trades',()=>{
 const e=evidence();e.listings=listings();e.listings.source.secret='must not export';const r=run({e});assert.equal(r.priceBasis.kind,'current-listing-average');assert.equal(r.priceBasis.amount,105000);assert.equal(r.priceBasis.n,3);assert.equal(r.priceBasis.fallback,false);assert.equal(r.priceBasis.requestedKind,'current-listings');assert.equal(r.row.score,65);assert.equal(r.row.coverage,40);assert.match(r.row.scope,/호가평균/);assert.equal(r.priceBasis.ownMean,100000);assert.doesNotMatch(JSON.stringify(r.e.sources),/must not export|secret/);assert.equal(r.row.sourceIds.length,2);
});
test('insufficient listings, unverified AI extraction, inactive, wrong type, area or identity use the authorized fallback',()=>{
 const cases=[l=>l.listings.pop(),l=>delete l.provenance,l=>l.complete=false,l=>l.truncated=true,l=>l.pagination={has_more:true},l=>l.listings[0].active=false,l=>l.listings[0].status='sold',l=>l.listings[0].cancelled=true,l=>l.listings[0].unitId=' ',l=>l.listings[0].updatedAt='2099-01-01',l=>l.listings[0].kind='jeonse',l=>l.listings[0].area=59,l=>l.listings[0].buildingCode='other',l=>l.identity.code='other',l=>l.listings[0].verifiedAt='2026-10-16',l=>l.checkedAt='2099-01-01',l=>l.source.checkedAt='2026-10-16',l=>l.totalCount=4];
 for(const mutate of cases){const e=evidence();e.listings=listings();mutate(e.listings);const r=run({e});assert.equal(r.priceBasis.kind,'transaction-average');assert.equal(r.priceBasis.fallback,true);assert.ok(r.priceBasis.fallbackReason);assert.equal(r.row.score,80);}
});
test('physical unit duplicates are collapsed and conflicting duplicate prices trigger fallback',()=>{
 const e=evidence();e.listings=listings();e.listings.listings.push({...e.listings.listings[0],id:'duplicate-ad'});e.listings.totalCount=4;const r=run({e});assert.equal(r.priceBasis.kind,'current-listing-average');assert.equal(r.priceBasis.n,3);assert.equal(r.priceBasis.amount,105000);
 const bad=evidence();bad.listings=listings();bad.listings.listings.push({...bad.listings.listings[0],id:'duplicate-ad',price:90000});bad.listings.totalCount=4;assert.equal(run({e:bad}).priceBasis.fallback,true);
});
test('current-listing sources with credentials or secret-bearing parameters are never exported',()=>{
 for(const unsafe of ['https://user:password@provider.example.test/listings','https://provider.example.test/listings?token=secret','https://provider.example.test/listings?auth=secret','https://provider.example.test/listings?serviceKey=secret','https://provider.example.test/listings?apiKey=secret','https://provider.example.test/listings?secret=secret','http://provider.example.test/listings']){const e=evidence();e.listings=listings();e.listings.source.url=unsafe;const r=run({e});assert.equal(r.priceBasis.fallback,true);assert.ok(r.e.sources.every(s=>s.url!==unsafe));}
});
test('reused peer proof is rechecked for town, coordinates, true radius, approval age and target aliases',()=>{
 for(const mutate of [e=>e.peers.peers[0].town='잠실동',e=>e.peers.peers[0].lat=35,e=>e.peers.peers[0].distanceM=999999,e=>e.peers.peers[0].approvalDate='1950-01-01',e=>{e.peers.peers[0].name='대상단지아파트';e.peers.peers[0].lot='18-6';},e=>e.peers.peers[0].kaptCode='Atarget01',e=>delete e.center,e=>e.basic.approvalDate=null]){const e=evidence();mutate(e);assert.equal(run({e}).row.score,null);}
});

function expandedEvidence(p){
 const e=evidence(p),rules=require('../src/peer-comparison.cjs');p.buildingResolution.regionCode='28185';
 for(const [i,peer]of e.peers.peers.entries()){peer.town=i?'동춘동':'연수동';peer.location='인천광역시 연수구 '+peer.town;peer.officialAddress=peer.location+' '+peer.lot;peer.bjdCode='2818510'+(i+1)+'00';peer.regionCode='28185';for(const t of peer.contracts)Object.assign(t,{kind:'trade',areaBasis:'전용면적',building:peer.name,location:peer.location,lot:peer.lot});}
 Object.assign(e.peers,{version:rules.DISTRICT_VERSION,scope:rules.DISTRICT_SCOPE,criteria:'같은 구·인접 법정동 포함·'+rules.COMMON_CRITERIA,targetAge:rules.targetYearBasis({input,prices:p,basic:e.basic}),expansion:{fromScope:rules.SAME_TOWN_SCOPE,targetTown:'송도동',regionCode:'28185',sameTownPeerCount:0,requiredPeerBuildings:2,reason:'같은 동의 적격 비교 단지가 0곳으로 부족해 같은 구·직선 2km 이내 인접 동을 비교했습니다.',distanceBasis:'공식 대상 단지 기준점과 등록 비교 단지 좌표 간 직선거리',towns:['동춘동','연수동']}});return e;
}

test('district-nearby transaction score discloses expansion, towns and real distances under a separate scope and version',()=>{
 const p=prices(),e=expandedEvidence(p),r=run({p,e});assert.equal(r.row.score,80);assert.equal(r.row.coverage,40);assert.equal(r.row.scope,'동일면적 거래평균·같은 구 인접동 비교');assert.equal(r.row.comparisonScope,'same-district-adjacent-towns-2km');assert.equal(r.row.comparisonVersion,'2026-10-18-peer-district-nearby-v2');assert.equal(r.priceBasis.comparison.kind,'district-nearby-transaction-average');assert.match(r.row.reason,/표본|부족/);assert.match(r.row.reason,/연수동, 111m/);assert.match(r.row.method,/같은 법정동만 비교한 점수와 평가 범위가 다릅니다/);assert.equal(input.offered,null);assert.equal(r.priceBasis.kind,'transaction-average');assert.equal(r.priceBasis.amount,100000);assert.ok(Math.abs(r.priceBasis.comparison.peerSameAreaAmount-110000)<.000001);
});

test('reused expanded peer evidence must preserve official address, district, contracts, scope and disclosed fallback condition',()=>{
 const cases=[e=>delete e.peers.version,e=>e.peers.version='invented-version',e=>e.peers.scope='same-town-2km',e=>delete e.peers.expansion,e=>delete e.peers.targetAge,e=>e.peers.expansion.sameTownPeerCount=2,e=>e.peers.expansion.regionCode='11410',e=>e.peers.expansion.reason='',e=>e.peers.expansion.towns=['연수동'],e=>e.peers.peers[0].bjdCode='1141010100',e=>delete e.peers.peers[0].bjdCode,e=>e.peers.peers[0].regionCode='11410',e=>e.peers.peers[0].officialAddress='서울특별시 서대문구 연수동 21-1',e=>e.peers.peers[0].officialAddress=e.peers.peers[0].location+' 999-1',e=>e.peers.peers[0].contracts[0].location='인천광역시 남동구 연수동',e=>e.peers.peers[0].contracts[0].lot='999-1',e=>e.peers.peers[0].contracts[0].building='다른단지',e=>e.peers.peers[0].contracts[0].kind='jeonse',e=>e.peers.peers[0].contracts[0].areaBasis='공급면적',e=>e.peers.peers[0].lat=37.43,e=>e.peers.peers[1].kaptCode=e.peers.peers[0].kaptCode,e=>{const t=e.peers.peers[0].contracts[0];Object.assign(e.peers.peers[0].contracts[1],{...t,id:'new-duplicate-id'});}];
 for(const mutate of cases){const p=prices(),e=expandedEvidence(p);mutate(e);assert.equal(run({p,e}).row.score,null);}
});

test('verified same-property construction year supports relative price age checks without inventing approval date',()=>{
 const rules=require('../src/peer-comparison.cjs'),p=prices();p.rows.forEach(t=>{t.built='2014';});const e=expandedEvidence(p);e.basic.approvalDate=null;e.peers.targetAge=rules.targetYearBasis({input,prices:p,basic:e.basic});
 const r=run({p,e});assert.equal(r.row.score,80);assert.equal(r.priceBasis.comparison.targetAge.kind,'transaction-building-year');assert.equal(r.priceBasis.comparison.targetAge.approvalDate,undefined);assert.match(r.row.method,/정확한 사용승인일은 미확인/);
 for(const mutate of [x=>x.rows[0].built='2015',x=>x.rows[0].built=null,x=>x.coverage[0].source='https://unverified.test/']){const bad=structuredClone(p);mutate(bad);assert.equal(run({p:bad,e:structuredClone(e)}).row.score,null);}
 const borrowed=structuredClone(e);borrowed.peers.targetAge.identity.code='another-target';assert.equal(run({p,e:borrowed}).row.score,null);
});

function geocodedEvidence(p){
 const e=expandedEvidence(p),rules=require('../src/peer-comparison.cjs');for(const peer of e.peers.peers){peer.bjdCode=null;peer.regionCodeBasis='exact-address-geocode';const query=peer.location+' '+peer.lot;peer.regionProof=rules.regionProofFrom({address:query,normalized_address:query+' '+peer.name,lat:peer.lat,lng:peer.lng,confidence:'exact',matched_provider:'naver',region_code:peer.town==='연수동'?'2818510100':'2818510200',region:{sido:'인천광역시',sigungu:'연수구',eupmyeondong:peer.town,jibun:peer.lot},metadata:{collected_at:checkedAt}},query);}return e;
}

test('missing batch legal-dong codes stay null while exact-address geocoding is checked and cited separately',()=>{
 const p=prices(),e=geocodedEvidence(p),r=run({p,e});assert.equal(r.row.score,80);assert.ok(e.peers.peers.every(peer=>peer.bjdCode===null));assert.equal(r.row.sourceIds.length,3);assert.equal(r.priceBasis.comparison.addressSources.length,2);assert.ok(r.e.sources.some(s=>s.url==='https://maps.apigw.ntruss.com/map-geocode/v2/geocode'&&s.checkedAt==='2026-10-17'));assert.match(r.row.reason,/등록 스냅샷.*정확 주소 지오코딩.*100m/);assert.match(r.row.reason,/공식 단건 K-apt 기본정보.*미확인/);
});

test('geocode proof rejects forged dates, provider, source, district, lot, confidence and coordinates, without replacing contradictory K-apt codes',()=>{
 const changes=[p=>p.response.confidence='approximate',p=>p.response.region_code='1141010100',p=>p.response.region_code='28185',p=>p.response.region.eupmyeondong='다른동',p=>p.response.region.jibun='999-1',p=>p.response.region.sido='서울특별시',p=>p.response.region.sigungu='다른구',p=>p.queryAddress='인천광역시 연수구 연수동 999-1',p=>p.response.normalized_address='인천광역시 연수구 연수동 999-1',p=>p.response.lat+=.001,p=>p.sourceUrl='https://unverified.test/',p=>p.provider='kakao',p=>p.response.matched_provider='kakao',p=>{p.checkedAt='2099-01-01T00:00:00Z';p.response.metadata.collected_at=p.checkedAt;},p=>{p.checkedAt='2026-08-01T00:00:00Z';p.response.metadata.collected_at=p.checkedAt;},p=>delete p.response.metadata,p=>p.source='추정 코드'];
 for(const change of changes){const p=prices(),e=geocodedEvidence(p);change(e.peers.peers[0].regionProof);assert.equal(run({p,e}).row.score,null);}
 for(const change of [peer=>peer.regionCodeBasis='kapt-basic',peer=>peer.bjdCode='1141010100',peer=>peer.bjdCode='malformed']){const p=prices(),e=geocodedEvidence(p);change(e.peers.peers[0]);assert.equal(run({p,e}).row.score,null);}
});
