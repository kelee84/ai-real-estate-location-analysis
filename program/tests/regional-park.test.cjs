'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const park=require('../src/regional-park.cjs'),{todayKst}=require('../src/core.cjs');
const asOf=todayKst(),center={lat:37.4,lng:126.64},identity={town:'송도동',regionCode:'28185'};
const row=(id,name,area,lat=37.401,extra={})=>({MANAGE_NO:'28185-'+id,PARK_NM:name,PARK_SE:'근린공원',PARK_AR:String(area),LATITUDE:String(lat),LONGITUDE:'126.64',RDNMADR:'',LNMADR:'인천광역시 연수구 송도동 '+id,REFERENCE_DATE:asOf,...extra});
test('nearby pocket park is excluded; same-town named regional park wins over anonymous large plots',()=>{
 const r=park.choosePark([row('01','어린이공원',2000,37.4001),row('02','센트럴파크',350000,37.405),row('03','산업단지4호근린공원',900000,37.402),row('04','큰호수공원',800000,37.403,{LNMADR:'인천광역시 연수구 옥련동 1'})],{center,identity,asOf});
 assert.equal(r.reference.name,'센트럴파크');assert.equal(r.scope,'같은 읍면동');assert.equal(r.candidates.length,3);assert.equal(r.selected.name,'산업단지4호근린공원');assert.ok(Math.abs(r.thresholdM2-175000)<1e-6);
});
test('50% 경계와 최소10만㎡를 적용하며 가까운 적격 공원을 대표공원과 같은 거리 배점으로 평가',async()=>{
 const rows=[row('01','센트럴파크',350000,37.412),row('02','근처큰공원',175000,37.402),row('03','기준미달공원',174999,37.4001)];
 const fetchImpl=async url=>new Response(JSON.stringify(String(url).includes('columList')?{totalCount:rows.length,tableVO:{svcTableNm:'tn_pubr_public_cty_park_info_svc',colNmList:Object.keys(rows[0])}}:rows));
 const n=await park.queryRegionalPark({center,identity,asOf,fetchImpl});assert.equal(n.selected.name,'근처큰공원');assert.equal(n.reference.name,'센트럴파크');assert.equal(n.similarityRatio,.5);assert.ok(park.verified(n,{center,asOf}));
 const scoring=require('../src/scoring.cjs'),input={asset:'apartment',building:'검증단지',target:'검증단지',asOf,types:['trade']},prices={buildingResolution:{...identity,building:input.building,code:'test'},rows:[],summaries:[],coverage:[]},e={version:scoring.VERSION,building:input.building,asOf,identity:{code:'test'},center,places:[],sources:[n.source],nature:n};
 const s=scoring.assessScores({scores:[]},{input,prices,previousEvidence:e}).scores[3];assert.equal(s.score,95);assert.equal(s.coverage,50);assert.equal(s.regionalPark.name,'근처큰공원');assert.equal(s.landmarkPark.name,'센트럴파크');assert.match(s.method,/50%/);
 const small=park.choosePark([row('01','중앙공원',120000,37.412),row('02','작은공원',90000,37.4001)],{center,identity,asOf});assert.equal(small.thresholdM2,100000);assert.equal(small.selected.name,'중앙공원');
 const bad=structuredClone(n);bad.similarityRatio=.7;assert.equal(park.verified(bad,{center,asOf}),false);
});
test('latest same-park record replaces older area and coordinate; equally dated conflicts are rejected',()=>{
 const r=row('01','호수공원',350000),old={...r,REFERENCE_DATE:'2026-01-01',PARK_AR:'370000'};
 assert.equal(park.records([old,r],asOf)[0].areaM2,350000);
 assert.equal(park.records([r,{...r,PARK_AR:'500000'}],asOf).length,0);
});
test('missing or invalid size, stale/future data, wrong location and unbuilt park never become a landmark',()=>{
 const r=park.choosePark([row('01','중앙공원',''),row('02','호수공원',99999),row('03','대공원',500000,38),row('04','미조성 중앙공원',500000),row('05','옛공원',500000,37.401,{REFERENCE_DATE:'2020-01-01'}),row('06','미래공원',500000,37.401,{REFERENCE_DATE:'2099-01-01'})],{center,identity,asOf});
 assert.equal(r.selected,null);assert.match(r.reason,/소공원으로 대체하지/);
});
test('public download validates total and mandatory columns, saves source date and never needs an API key',async()=>{
 const rows=[row('01','중앙공원',300000)],urls=[];
 const fetchImpl=async url=>{urls.push(String(url));return new Response(JSON.stringify(String(url).includes('columList')?{totalCount:1,tableVO:{svcTableNm:'tn_pubr_public_cty_park_info_svc',colNmList:Object.keys(rows[0])}}:rows));};
 const r=await park.queryRegionalPark({center,identity,asOf,fetchImpl});assert.equal(r.status,'verified');assert.equal(r.totalRecords,1);assert.equal(r.source.url,park.SOURCE);assert.ok(park.verified(r,{center,asOf}));assert.equal(urls.length,2);assert.ok(urls[1].includes('totalCount=1'));assert.ok(!urls.some(s=>/key|token|auth/i.test(s)));
 const scoring=require('../src/scoring.cjs'),input={asset:'apartment',building:'검증단지',target:'검증단지',asOf,types:['trade']},prices={buildingResolution:{...identity,building:input.building,code:'test'},rows:[],summaries:[],coverage:[]};
 const previous={version:scoring.VERSION,building:input.building,asOf,identity:{code:'test'},center,places:[],sources:[r.source],nature:r};
 const assessed=scoring.assessScores({scores:[]},{input,prices,previousEvidence:previous}),nature=assessed.scores.find(s=>s.name==='자연환경');assert.equal(nature.score,95);assert.equal(nature.coverage,50);assert.match(nature.observed,/300,000㎡/);assert.ok(nature.sourceIds.includes(r.source.id));
 for(const mutate of [n=>n.selected.distanceM=1,n=>n.selected.areaM2=100,n=>n.source.url='https://example.com',n=>n.center.lat=38,n=>n.asOf='2000-01-01']){const n=structuredClone(r);mutate(n);assert.ok(!park.verified(n,{center,asOf}));}
});
test('failed or incomplete download returns a specific withheld reason and no fabricated park',async()=>{
 const columns=Object.keys(row('01','중앙공원',300000));
 for(const response of [()=>new Response('error',{status:503}),url=>new Response(JSON.stringify(String(url).includes('columList')?{totalCount:2,tableVO:{svcTableNm:'tn_pubr_public_cty_park_info_svc',colNmList:columns}}:[row('01','중앙공원',300000)]))]){
  const r=await park.queryRegionalPark({center,identity,asOf,fetchImpl:async url=>response(url)});assert.equal(r.status,'unavailable');assert.ok(!r.selected);assert.match(r.reason,/조회|누락/);
 }
});
test('legacy comparison evidence supplements only current park facts without altering source or historical dates',async()=>{
 const e={center,identity,places:[],sources:[],school:{name:'기존 학교'},product:{units:10}},before=JSON.stringify(e);let calls=0;
 const query=async()=>{calls++;return {status:'verified',source:{id:'official-park',url:park.SOURCE},checkedAt:new Date().toISOString(),selected:{name:'대표공원'}};};
 const current=await park.ensureEvidence(e,{input:{asset:'apartment',asOf},query});assert.equal(calls,1);assert.equal(current.refreshed,true);assert.equal(current.evidence.nature.selected.name,'대표공원');assert.deepEqual(current.evidence.school,e.school);assert.equal(JSON.stringify(e),before);
 const old=await park.ensureEvidence(e,{input:{asset:'apartment',asOf:'2020-01-01'},query});assert.equal(calls,1);assert.equal(old.refreshed,false);assert.equal(old.evidence,e);assert.match(old.reason,/과거 기준일/);
});
