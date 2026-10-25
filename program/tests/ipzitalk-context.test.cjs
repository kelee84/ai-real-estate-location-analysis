'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),access=require('../src/living-access.cjs'),context=require('../src/ipzitalk-context.cjs'),nearby=require('../src/nearby-context.cjs'),{todayKst}=require('../src/core.cjs');
const asOf=todayKst(),center={lat:37.56,lng:126.95},identity={building:'두산',code:'469',regionCode:'11410',province:'서울특별시',region:'서대문구',town:'북아현동',lot:'1009',road:'이화여대8길 62',...center},input={asset:'apartment',asOf,request:'주차와 주변 단지 비교',building:'두산'},prices={buildingResolution:identity};
const category='교통,수송 > 지하철,전철 > 수도권2호선';
function station(id,offset=.002,line=category){const p={id,name:'검증역 2호선',category:'subway',kakao_category_name:line,lat:center.lat+offset,lng:center.lng,sourceId:'station-'+id};return {...p,distanceM:Math.round(access.distance(center,p))};}
function data(id='A12079501',name='북아현두산',lot='1009',road='이화여대8길 62'){return {kapt_code:id,name,basic:{bjd_code:null,address_jibun:'서울특별시 서대문구 북아현동 '+lot+' '+name,address_road:'서울특별시 서대문구 '+road,total_units:100,use_approval_date:'20100101'},detail:{parking_ground:50,parking_underground:100},derived:{parking_per_unit:1.5},metadata:{collected_at:new Date().toISOString()}};}
function fixture(){const target=data(),peer=data('A12079502','비교단지','1010','이화여대8길 64'),p={identifiers:{kapt_code:peer.kapt_code},name:peer.name,address:peer.basic.address_road,...center};return {batch:{results:[{status:'success',data:target},{status:'success',data:peer}]},candidates:[p],options:{input,prices,center}};}
test('upstream proximity boundaries are deterministic descriptive signals, without changing numeric scores',()=>{
 assert.equal(context.band('subway',500),'역세권');assert.equal(context.band('subway',501),'준역세권');assert.equal(context.band('park',700),'자연공간 근접');assert.equal(context.band('park',701),'자연공간과 다소 이격');assert.equal(context.band('hospital',1000),'종합병원 인접');assert.equal(context.band('elementary',300),'초등학교 인접');assert.equal(context.band('subway',null),null);
 const p=station('1'),score={name:'교통 환경',score:85,sourceIds:[p.sourceId]},member={input,assessment:{evidence:{asOf,center,places:[p,{...station('2'),kakao_category_name:'교통,수송 > 지하철,전철 > 수도권2호선'},{...station('3'),kakao_category_name:'교통,수송 > 지하철,전철 > 경의중앙선'}]}}},before=JSON.stringify(member);
 assert.match(context.prefix(score,member),/역세권.*2개 노선/);assert.equal(JSON.stringify(member),before);assert.equal(score.score,85);assert.equal(context.prefix({...score,score:null},member),'');
});
test('elementary signal never asserts school assignment, safe routes or confirmed inside-complex school',()=>{
 const p={...station('1'),name:'검증초등학교',category:'school_elementary'},s={name:'교육 환경',score:90,sourceIds:[p.sourceId]},member={input,assessment:{evidence:{asOf,center,places:[p]}}};assert.match(context.prefix(s,member),/초등학교 인접.*초품아·배정·통학로 별도 확인/);
 p.name='검증초등학교 휴교';assert.equal(context.prefix(s,member),'');member.assessment.evidence.asOf='2000-01-01';assert.equal(context.prefix(s,member),'');
});
test('hospital and subway evidence exclude hospital annexes, planned and closed facilities',()=>{
 const p={name:'검증센터',kakao_category_name:'의료,건강 > 병원 > 대학병원 > 병원부속시설'};assert.equal(access.eligible(p,'general'),false);assert.equal(access.eligible({...p,kakao_category_name:'의료,건강 > 병원 > 대학병원'},'general'),true);
 const s=station('1');s.name='검증역 미개통';assert.equal(context.prefix({name:'교통 환경',score:85,sourceIds:[s.sourceId]},{input,assessment:{evidence:{asOf,center,places:[s]}}}), '');
});
test('parking totals use both original counts; null or contradictory derived ratios never become zero or a ranking',()=>{
 const f=fixture(),out=nearby.parseBatch(f.batch,f.candidates,f.options);assert.equal(out.rows.length,2);assert.equal(out.rows[0].target,true);assert.equal(out.rows[0].parkingPerUnit,1.5);
 for(const change of [d=>d.detail.parking_ground=null,d=>d.detail.parking_underground=null,d=>d.basic.total_units=0,d=>d.derived.parking_per_unit=9,d=>{d.detail.parking_ground=0;d.detail.parking_underground=0;}]){const f=fixture();change(f.batch.results[0].data);assert.equal(nearby.parseBatch(f.batch,f.candidates,f.options).rows[0].parkingPerUnit,null);}
 const z=fixture();z.batch.results[0].data.detail.parking_ground=0;z.batch.results[0].data.derived.parking_per_unit=1;assert.equal(nearby.parseBatch(z.batch,z.candidates,z.options).rows[0].parkingPerUnit,1);
});
test('saved target rows retain actual legal-code and road-address proofs and reject nonnumeric parking counts',()=>{
 for(const bjdCode of [null,'1141010100']){const f=fixture(),d=f.batch.results[0].data;d.basic.bjd_code=bjdCode;const before=JSON.stringify(f.batch),row=nearby.parseBatch(f.batch,f.candidates,f.options).rows[0];assert.equal(row.target,true);assert.equal(row.bjdCode,bjdCode);assert.equal(row.addressRoad,d.basic.address_road);assert.equal(JSON.stringify(f.batch),before);}
 for(const value of [false,true,[],[0],{},'','1.5',Number.MAX_SAFE_INTEGER+1]){assert.equal(nearby.count(value),null);const f=fixture();f.batch.results[0].data.detail.parking_ground=value;const row=nearby.parseBatch(f.batch,f.candidates,f.options).rows[0];assert.equal(row.parkingGround,null);assert.equal(row.parkingPerUnit,null);}
 assert.equal(nearby.count(0),0);assert.equal(nearby.count('0'),0);assert.equal(nearby.count(' 100 '),100);
});
test('legal-code omissions require independently matching full addresses, road numbers and permitted target alias',()=>{
 const f=fixture();assert.ok(nearby.targetMatch(identity,f.batch.results[0].data));
 for(const change of [d=>d.basic.address_road='서울특별시 서대문구 다른길 62',d=>d.basic.address_jibun='서울특별시 강남구 북아현동 1009 북아현두산',d=>d.basic.address_jibun='서울특별시 서대문구 북아현동 1010 북아현두산',d=>d.name='북아현두산2단지',d=>d.basic.bjd_code='1168010100']){const d=data();change(d);assert.equal(nearby.targetMatch(identity,d),false);}
 f.batch.results.reverse();const out=nearby.parseBatch(f.batch,f.candidates,f.options);assert.equal(out.rows.filter(r=>r.target).length,1);assert.equal(out.rows.find(r=>r.target).kaptCode,'A12079501');
});
test('ranking has explicit denominators, ties and missing values; age uses completed anniversaries',()=>{
 const rows=[{value:1.5},{value:1.5},{value:1},{value:null}];assert.equal(nearby.ranks(rows,'value',true),3);assert.deepEqual(rows.map(r=>r.valueRank),[1,1,3,null]);
 assert.equal(nearby.age('2016-10-18','2026-10-18'),10);assert.equal(nearby.age('2016-10-19','2026-10-18'),9);assert.equal(nearby.age('2026-10-18','2026-10-18'),0);assert.equal(nearby.age('2099-01-01','2026-10-18'),null);
});
test('nearby subway ranking requires source coverage around each peer rather than reusing target distance blindly',()=>{
 const p=station('1'),row={...center,lat:center.lat+.018,distanceM:Math.round(access.distance(center,{lat:center.lat+.018,lng:center.lng})),subwayDistanceM:null},raw={kakao_place_id:p.id,name:p.name,kakao_category_name:p.kakao_category_name,lat:p.lat,lng:p.lng,distance_m:p.distanceM},t={server:'ipzitalk',tool:'search_by_nearby_category',arguments:{categories:['subway'],center_lat:center.lat,center_lng:center.lng,radius_m:5000},result:{structuredContent:{center,radius_m:5000,results:{subway:[raw]},pagination_by_category:{subway:{returned_count:1,collected_count:1,source_cap_reached:true}},metadata:{collected_at:new Date().toISOString()}}}};
 nearby.transit([row],[t],{center,asOf});assert.equal(row.subwayDistanceM,null);t.result.structuredContent.pagination_by_category.subway.source_cap_reached=false;nearby.transit([row],[t],{center,asOf});assert.ok(row.subwayDistanceM>1000);
});
test('request gate makes surrounding comparisons optional and does not revive product or price scores',async()=>{
 assert.equal(nearby.requested({request:'입지와 장단점 분석'}),false);let calls=0;const result=await nearby.collect(async()=>{calls++;}, {...input,request:''},prices,{center,tools:[]});assert.equal(calls,0);assert.equal(result.status,'unavailable');
 const missing=nearby.section({input,prices,assessment:{evidence:{nearbyContext:{version:nearby.VERSION,asOf,identityCode:identity.code,status:'unavailable',rows:[],reason:'자료 부족'}}}});assert.match(missing.rows[0][1],/자료 부족/);assert.ok(!missing.rows.flat().some(x=>x==='0점'));
});
test('basic parking and academy requests neither query peers nor display saved optional comparisons',async()=>{
 const saved={version:nearby.VERSION,asOf,identityCode:identity.code,status:'checked',rows:[{name:'이전에 조회한 주변 단지',parkingPerUnit:.78}],reason:'기존 주변 비교 자료'};
 for(const request of ['주차대수 알려줘','주차대수도 표시해줘','주차대수 포함해줘','주차대수 확인','천연뜨란채로 보고서 한번 만들어서 주차대수랑 과목별 학원표가 제대로 나오는지 확인하고, 입지톡이 실제 몇 회 조회되는지도 알려줘.','준공연도와 주차대수 알려줘','주변 단지 이름 알려줘','주차대수 확인. 과목별 표를 비교해서 설명해줘','주차대수를 확인하고 과목별 학원표도 비교해줘','주차대수와 학원 환경을 비교해줘']){
  const basicInput={...input,request};let calls=0;assert.equal(nearby.requested(basicInput),false,request);
  const result=await nearby.collect(async()=>{calls++;throw Error('불필요한 주변 조회');},basicInput,prices,{center,tools:[]});assert.equal(calls,0,request);assert.equal(result.status,'unavailable');
  assert.equal(nearby.section({input:basicInput,prices,assessment:{evidence:{nearbyContext:saved}}}),null,request);
 }
});
test('explicit parking, age, subway and nearby comparison or ranking intent keeps the peer lookup',async()=>{
 for(const request of ['주차 순위','주차 비교','세대당 주차대수를 주변과 비교해줘','주차와 주변 단지 비교','주변 단지 비교','주변 아파트와 비교','인근 단지 순위','노후도 비교','준공연도 비교','사용승인 만 연차 비교','지하철 순위','지하철 접근성 비교','단지 순위','아파트 랭킹']){
  const comparedInput={...input,request};let calls=0;assert.equal(nearby.requested(comparedInput),true,request);
  await nearby.collect(async tool=>{calls++;assert.equal(tool,'find_complexes_near_point');return null;},comparedInput,prices,{center,tools:[]});assert.equal(calls,1,request);
 }
});
