'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {normalize,current,candidates,NaverLandStore}=require('../src/naver-land.cjs'),{todayKst}=require('../src/core.cjs');
const asOf=todayKst(),identity={building:'테스트1차아파트',code:'official-123',regionCode:'28185',province:'인천광역시',region:'연수구',town:'송도동',lot:'1',lat:37.4,lng:126.64};
const input={target:'인천광역시 연수구 송도동 테스트1차아파트',building:identity.building,asset:'apartment',asOf};
function record(change={}){return {complexNo:'123456',name:'테스트1차아파트',addressJibun:'인천광역시 연수구 송도동 1 테스트1차아파트',addressRoad:'인천광역시 연수구 예시로 1',lat:37.4,lng:126.64,coordinateBasis:'complex',checkedAt:new Date().toISOString(),sourceUrl:'https://fin.land.naver.com/complexes/123456',basic:{approvalDate:'2017-02-01',units:1834,parkingSpaces:2434},...change};}
function native(change={}){return {complexDetail:{complexNo:'123456',complexName:identity.building,address:'인천광역시 연수구 송도동 1 테스트1차아파트',roadAddress:'인천광역시 연수구 예시로 1',latitude:'37.4',longitude:'126.64',useApproveYmd:'20170201',totalHouseholdCount:'1834',totalParkingCount:2434},checkedAt:new Date().toISOString(),sourceUrl:'https://new.land.naver.com/complexes/123456',...change};}
function yesterday(){return new Date(Date.parse(asOf+'T00:00:00+09:00')-86400000).toISOString();}

test('canonical public records retain their source and strip credentials, customer fields and unrelated nested data',()=>{
 const value=record({sourceUrl:'https://fin.land.naver.com/complexes/123456?token=SECRET&ms=37.4,126.6#secret',customer:{name:'PRIVATE_CUSTOMER'},memo:'PRIVATE_MEMO',cookies:'PRIVATE_COOKIES',tokens:'PRIVATE_TOKEN'});value.basic.contact='PRIVATE_CONTACT';const before=structuredClone(value),r=normalize(value);
 assert.equal(r.checkedAt,value.checkedAt);assert.equal(r.sourceUrl,'https://fin.land.naver.com/complexes/123456');assert.deepEqual(r.basic,{approvalDate:'2017-02-01',units:1834,parkingSpaces:2434});assert.doesNotMatch(JSON.stringify(r),/SECRET|PRIVATE|token|cookie|memo|customer/);assert.deepEqual(value,before);
 assert.deepEqual(normalize(JSON.stringify(value)),r);assert.equal(normalize({...record(),checkedAt:asOf}).checkedAt,asOf);
});

test('native detail fields become public facts and only direct detail coordinates establish the complex point',()=>{
 const value=native({map:{lat:38,lng:127},ms:'38,127,16'}),r=normalize(value);assert.equal(r.name,identity.building);assert.equal(r.lat,37.4);assert.equal(r.lng,126.64);assert.equal(r.coordinateBasis,'complex');assert.deepEqual(r.basic,{approvalDate:'2017-02-01',units:1834,parkingSpaces:2434});assert.equal(Object.hasOwn(r,'complexDetail'),false);
 const without=native();delete without.complexDetail.latitude;delete without.complexDetail.longitude;without.ms='37.4,126.64';without.lat=37.4;without.lng=126.64;assert.equal(Object.hasOwn(normalize(without),'lat'),false);
 for(const change of [{latitude:undefined},{latitude:'not-a-number'},{longitude:999}]){const v=native();Object.assign(v.complexDetail,change);assert.throws(()=>normalize(v),/단지 기준점/);}
 assert.throws(()=>normalize(native({coordinateBasis:'map-center'})),/단지 기준점/);
});

test('invalid source, identity, address and time never become reusable evidence',()=>{
 const changes=[{complexNo:'123457'},{complexNo:'../secret'},{name:''},{addressJibun:'송도동 1'},{addressJibun:'인천광역시 연수구 예시로 1'},{checkedAt:'2026-02-30T01:00:00Z'},{checkedAt:'2026-10-19 10:00:00'},{checkedAt:new Date(Date.now()+3600000).toISOString()},{sourceUrl:'http://fin.land.naver.com/complexes/123456'},{sourceUrl:'https://fin.land.naver.com.evil.example/complexes/123456'},{sourceUrl:'https://fin.land.naver.com/articles/123456'},{sourceUrl:'https://fin.land.naver.com/complexes/123456/extra'},{sourceUrl:'https://user:secret@fin.land.naver.com/complexes/123456'},{sourceUrl:'https://land.naver.com/complexes/123456'}];
 for(const change of changes)assert.throws(()=>normalize(record(change)),undefined,JSON.stringify(change));
 for(const change of [{coordinateBasis:undefined},{coordinateBasis:'map-center'},{lng:undefined},{lat:0}])assert.throws(()=>normalize(record(change)),/단지 기준점/);
 assert.throws(()=>normalize('not JSON'),/JSON/);assert.throws(()=>normalize(null),/공개 단지정보/);
});

test('missing or invalid optional basic facts stay absent rather than becoming invented zeroes or dates',()=>{
 const v=native();Object.assign(v.complexDetail,{useApproveYmd:'20260230',totalHouseholdCount:true,totalParkingCount:-1});assert.equal(normalize(v).basic,undefined);
 v.complexDetail.useApproveYmd='20990101';v.complexDetail.totalParkingCount=0;assert.deepEqual(normalize(v).basic,{parkingSpaces:0});
 const noPoint=record();delete noPoint.lat;delete noPoint.lng;delete noPoint.coordinateBasis;assert.equal(Object.hasOwn(normalize(noPoint),'lat'),false);assert.equal(current(noPoint,{identity,asOf}),true);
});

test('current requires same Korean day and the same official physical apartment',()=>{
 const r=record();assert.equal(current(r,{identity,asOf}),true);assert.equal(current(record({checkedAt:yesterday()}),{identity,asOf}),false);assert.equal(current(r,{identity,asOf:'2000-01-01'}),false);
 for(const changed of [{lot:'2'},{town:'동춘동'},{province:'서울특별시',region:'송파구'},{building:'테스트2차아파트'},{lat:37.42},{code:undefined},{province:undefined},{region:undefined}])assert.equal(current(r,{identity:{...identity,...changed},asOf}),false,JSON.stringify(changed));
 assert.equal(current(record({lat:37.42}),{identity,asOf}),false);assert.equal(current(record({addressJibun:'서울특별시 송파구 송도동 1 테스트1차아파트'}),{identity,asOf}),false);
 assert.equal(current(record({name:'테스트2차아파트'}),{identity,asOf}),false);
});

test('candidate reuse filters region, phase, stale sources and duplicate IDs without confusing provider codes',()=>{
 const r=record(),otherCity=record({complexNo:'222222',sourceUrl:'https://fin.land.naver.com/complexes/222222',addressJibun:'서울특별시 송파구 송도동 1 테스트1차아파트'}),wrongPhase=record({complexNo:'333333',sourceUrl:'https://fin.land.naver.com/complexes/333333',name:'테스트2차아파트'}),stale=record({complexNo:'444444',sourceUrl:'https://fin.land.naver.com/complexes/444444',checkedAt:yesterday()});
 const values=[r,structuredClone(r),otherCity,wrongPhase,stale,{...r,sourceUrl:'https://example.com'}],all=candidates(input,values);assert.equal(all.length,1);assert.equal(all[0].id,'naver-123456');assert.equal(all[0].address,r.addressJibun);assert.equal(all[0].road,r.addressRoad);assert.equal(all[0].naverSource,r.sourceUrl);assert.equal(all[0].naverCheckedAt,r.checkedAt);assert.equal(all[0].naverComplexNo,r.complexNo);assert.equal(Object.hasOwn(all[0],'officialCode'),false);assert.equal(Object.hasOwn(all[0],'kaptCode'),false);
 assert.equal(candidates({...input,target:'테스트1차아파트'},values).length,2);assert.equal(candidates({...input,target:'인천 연수구 송도동 테스트1차아파트'},values).length,1);assert.equal(candidates({...input,target:'서울 송파구 테스트1차아파트'},values).length,1);assert.equal(candidates({...input,asset:'villa'},values).length,0);assert.equal(candidates({...input,asOf:'2000-01-01'},values).length,0);
});

test('store persists sanitized daily records, rejects ambiguity and handles optional memory storage',async()=>{
 const temp=await fs.mkdtemp(path.join(os.tmpdir(),'naver-land-test-')),resolved=path.resolve(temp);assert.ok(resolved.startsWith(path.resolve(os.tmpdir())+path.sep));
 try{
  const store=new NaverLandStore(temp),r=await store.import(record({memo:'PRIVATE_MEMO',cookies:'PRIVATE_COOKIE'}));assert.equal(store.root,path.join(resolved,'naver-land-cache'));const contents=await fs.readFile(path.join(store.root,'123456.json'),'utf8');assert.doesNotMatch(contents,/PRIVATE|cookies|memo/);assert.equal((await new NaverLandStore(temp).list(asOf)).length,1);
  assert.deepEqual(await store.forIdentity(input,{buildingResolution:identity}),r);await store.import(record({complexNo:'222222',sourceUrl:'https://fin.land.naver.com/complexes/222222'}));assert.equal(await store.forIdentity(input,{buildingResolution:identity}),null);
  await store.import(record({complexNo:'333333',sourceUrl:'https://fin.land.naver.com/complexes/333333',checkedAt:yesterday()}));assert.equal((await store.list(asOf)).length,2);assert.deepEqual(await store.list('2000-01-01'),[]);
  await fs.writeFile(path.join(store.root,'999999.json'),JSON.stringify(record()));await fs.writeFile(path.join(store.root,'888888.json'),'not json');assert.equal((await new NaverLandStore(temp).list(asOf)).length,2);
  const memory=new NaverLandStore();await memory.import(r);assert.deepEqual(await memory.forIdentity(input,{buildingResolution:identity}),r);const listed=await memory.list(asOf);listed[0].name='altered';assert.equal((await memory.list(asOf))[0].name,r.name);
 }finally{assert.equal(path.dirname(resolved),path.resolve(os.tmpdir()));await fs.rm(resolved,{recursive:true,force:true});}
});
test('public supplementary facts keep their own category and source while educational rankings and foreign sources are excluded',()=>{
 const source=record(),fact={category:'education',text:'네이버 배정 표시: 인천첨단초등학교 · 519m도보 7분. 실제 배정은 교육지원청 확인이 필요합니다.',sourceUrl:source.sourceUrl,checkedAt:source.checkedAt,distanceBasis:'네이버 표시 거리, 실제 통학 동선 미확인',sourceId:'naver-school-source'},r=normalize({...source,publicFacts:[fact,{...fact,text:'학급당 학생 수 24.7명'},{...fact,text:'전국 순위 1위'},{...fact,sourceUrl:'https://fin.land.naver.com/complexes/110656'},{...fact,text:'cookie=PRIVATE'},{...fact,text:'전문가 문의 010-1234-5678'}, {...fact,category:'transport',text:'네이버 주변 대중교통 표시: 버스 간선16,4,58'}]});assert.equal(r.publicFacts.length,2);assert.equal(r.publicFacts[0].sourceId,'naver-school-source');assert.equal(r.publicFacts[0].distanceBasis,fact.distanceBasis);assert.equal(r.publicFacts[1].category,'transport');assert.doesNotMatch(JSON.stringify(r),/24\.7|전국|PRIVATE|010-1234/);
});
