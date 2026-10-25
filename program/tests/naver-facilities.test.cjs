'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const provider=require('../src/naver-facilities.cjs'),walking=require('../src/naver-walking.cjs'),{todayKst}=require('../src/core.cjs'),{walkingFixture}=require('./naver-walking-fixture.cjs');
const yesterday=()=>new Date(Date.now()-86400000).toISOString();
function fixture(){
 const f=walkingFixture(),d=f.fact.walking.destination;d.lat=f.identity.lat+.002;d.lng=f.identity.lng;
 f.fact.coordinateProof={method:'visible-place-coordinate',placeId:f.fact.placeId,name:f.fact.name,address:f.fact.address,sourceUrl:f.fact.sourceUrl,checkedAt:f.fact.checkedAt,text:'위도 '+d.lat+' 경도 '+d.lng};
 return {...f,prices:{buildingResolution:f.identity},context:{center:{lat:f.identity.lat,lng:f.identity.lng},asOf:f.input.asOf,identity:f.identity}};
}
test('a same-day visible place coordinate and verified Naver walk yield a provider record without claiming a nearest or complete search',()=>{
 const f=fixture(),before=JSON.stringify(f),records=provider.fromFacts(f.input,f.prices,[f.fact]);assert.equal(records.length,1);assert.equal(JSON.stringify(f),before);
 const p=records[0];assert.equal(provider.validPlace(p,f.context),true);assert.equal(p.provider,'naver-public-map');assert.equal(p.id,'naver-'+f.fact.placeId);assert.equal(p.sourceId,provider.sourceId(f.fact.placeId));assert.equal(p.coordinateBasis,'registered-place');assert.equal(p.distanceM,222);assert.equal(p.walking.distanceM,832);assert.notEqual(p.distanceM,p.walking.distanceM);assert.match(p.distanceBasis,/直線|직선/);assert.equal(p.complete,false);assert.equal(p.nearestProven,false);assert.equal(p.emptyProven,false);
});
test('names, route distance or opaque route endpoints alone never supply coordinates or scored facilities',()=>{
 const f=fixture();assert.equal(walking.validWalking(f.fact.walking,{input:f.input,identity:f.identity,fact:f.fact}),true);
 const withoutCoordinate=structuredClone(f.fact);delete withoutCoordinate.coordinateProof;assert.deepEqual(provider.fromFacts(f.input,f.prices,[withoutCoordinate]),[]);
 const opaque=walkingFixture();assert.deepEqual(provider.fromFacts(opaque.input,{buildingResolution:opaque.identity},[opaque.fact]),[]);
 const nameOnly={category:'nature',name:'가상 송도 숲길',address:f.fact.address,checkedAt:f.fact.checkedAt};assert.deepEqual(provider.fromFacts(f.input,f.prices,[nameOnly]),[]);assert.deepEqual(provider.seedNames([nameOnly],f.input.asOf),['가상 송도 숲길']);
 const withoutWalking=structuredClone(f.fact);delete withoutWalking.walking;assert.deepEqual(provider.fromFacts(f.input,f.prices,[withoutWalking]),[]);
 const estimated=structuredClone(f.fact);estimated.coordinateProof.method='route-endpoint-estimate';assert.deepEqual(provider.fromFacts(f.input,f.prices,[estimated]),[]);
});
test('collection dates, identity, visible-coordinate proof and walking proof must all agree before reuse',()=>{
 const f=fixture(),record=provider.fromFacts(f.input,f.prices,[f.fact])[0];
 for(const change of [p=>p.checkedAt=yesterday(),p=>p.coordinateProof.checkedAt=yesterday(),p=>p.walking.checkedAt=yesterday(),p=>p.checkedAt=new Date(Date.now()+3600000).toISOString(),p=>p.coordinateProof.name='다른 시설',p=>p.coordinateProof.address='서울 서대문구 다른로 1',p=>p.coordinateProof.placeId='12345',p=>p.coordinateProof.sourceUrl='https://map.naver.com/p/entry/place/12345',p=>p.coordinateProof.text='위도 '+(p.lat+.01)+' 경도 '+p.lng,p=>p.origin.identityCode='다른단지',p=>p.distanceM=1,p=>p.sourceId='arbitrary',p=>p.url='https://map.naver.com.evil.example/p/entry/place/'+p.naverPlaceId,p=>p.name+=' 폐업',p=>p.classification+=' 휴업']){
  const changed=structuredClone(record);change(changed);assert.equal(provider.validPlace(changed,f.context),false);
 }
 assert.equal(provider.validPlace(record,{...f.context,center:{lat:f.identity.lat+.01,lng:f.identity.lng}}),false);assert.deepEqual(provider.fromFacts({...f.input,asOf:todayKst(new Date(Date.now()-86400000))},f.prices,[f.fact]),[]);
});
test('official-route seed names accept only current public nature names and reject blocked or planned trails',()=>{
 const current={category:'nature',name:'가상 송도 숲길',checkedAt:new Date().toISOString()},facts=[current,{...current},{...current,category:'shopping',name:'다른 자락길'},{...current,name:'일반 공원'},{...current,name:'과거 둘레길',checkedAt:yesterday()},{...current,name:'미래 산책로',checkedAt:new Date(Date.now()+3600000).toISOString()},...['폐쇄','출입금지','공사중','예정'].map(s=>({...current,name:'검증 숲길 '+s}))];
 assert.deepEqual(provider.seedNames(facts,todayKst()),['가상 송도 숲길']);const several=Array.from({length:8},(_,i)=>({...current,name:'가상 '+i+' 숲길'}));assert.equal(provider.seedNames(several,todayKst()).length,4);
});
test('purpose selection limits routes to useful categories, validates place links and keeps each public place only once',()=>{
 const base=walkingFixture().fact,mk=(category,id,name)=>({...base,category,placeId:String(id),sourceUrl:'https://map.naver.com/p/entry/place/'+id,name:name||category+' 시설 '+id}),facts=[...Array.from({length:5},(_,i)=>mk('shopping',100+i)),...Array.from({length:2},(_,i)=>mk('medical',200+i)),...Array.from({length:2},(_,i)=>mk('nature',300+i)),mk('academy',400),mk('shopping',500,'검증 마트 폐업'),{...mk('shopping',501),sourceUrl:'https://evil.example/place/501'},{...mk('shopping',502),sourceUrl:'https://map.naver.com/p/entry/place/503'}],before=JSON.stringify(facts),result=provider.purposeFacts(facts);
 assert.equal(result.length,5);assert.deepEqual(result.map(f=>f.category),['shopping','shopping','shopping','medical','nature']);assert.equal(JSON.stringify(facts),before);
 const duplicate=mk('shopping',100);assert.equal(provider.purposeFacts([duplicate,{...duplicate,category:'nature'}]).length,1);assert.deepEqual(provider.purposeFacts([{...mk('medical',600),address:''},mk('nature',601,'검증 산책로 예정')]),[]);
});
