'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const maps=require('../src/map-markers.cjs'),access=require('../src/living-access.cjs'),parks=require('../src/regional-park.cjs'),trails=require('../src/nature-access.cjs');
const center={lat:37.567566,lng:126.9584477},asOf='2026-10-20',checkedAt='2026-10-20T02:00:00Z',input={building:'천연뜨란채',asOf};
const labels={general:'의료,건강 > 병원 > 종합병원',pediatrics:'의료,건강 > 병원 > 소아청소년과',orthopedics:'의료,건강 > 병원 > 정형외과',dental:'의료,건강 > 병원 > 치과',entrance:'교육,학문 > 학원 > 입시학원',korean:'교육,학문 > 학원 > 입시학원 > 국어학원',english:'교육,학문 > 학원 > 어학원 > 영어학원',math:'교육,학문 > 학원 > 입시학원 > 수학학원'};
function place(id,name,category,offset=.002,label=''){const p={id:String(id),name,category,kakao_category_name:label,lat:center.lat+offset,lng:center.lng,sourceId:'source-'+id,checkedAt};return {...p,distanceM:Math.round(access.distance(center,p))};}
function livingSnapshot({sameMath=false}={}){const tools=access.QUERIES.map((spec,i)=>{const key=sameMath&&['entrance','math'].includes(spec.key)?'entrance':spec.key,id=100+access.SPECS.findIndex(s=>s.key===key),p=place(id,key==='entrance'?'수학입시학원':spec.label,spec.group,.001+i*.0005,labels[key]);return {server:'ipzitalk',tool:'search_by_nearby_keyword',arguments:{query:spec.query,center_lat:center.lat,center_lng:center.lng,radius_m:spec.radiusM},result:{structuredContent:{query:spec.query,center,radius_m:spec.radiusM,results:[{...p,kakao_place_id:p.id,distance_m:p.distanceM}],metadata:{collected_at:checkedAt,truncated:false}}}};});if(sameMath){const source=tools.find(t=>t.arguments.query==='입시학원').result.structuredContent.results;for(const t of tools.filter(t=>['보습학원','수학학원'].includes(t.arguments.query)))t.result.structuredContent.results=structuredClone(source);}return access.snapshot(tools,{center,asOf});}
function natureTrail(id,offset,name){const p=place(id,name,'nature',offset);return {...p,kind:'registered-trail',pointRole:'등록 진입 지점',source:{id:'trail-'+id,url:'https://place.map.kakao.com/'+id,checkedAt:asOf}};}

test('주요 시설을 기존 좌표로 번호·색상·직선거리와 함께 표시하고 공식 연계 초등학교를 우선한다',()=>{
 const places=[place(1,'독립문역 3호선','subway',.004,'교통,수송 > 지하철,전철 > 수도권3호선'),place(2,'독립문역 3호선','subway',.005,'교통,수송 > 지하철,전철 > 수도권3호선'),place(3,'서대문역 5호선','subway',.008,'교통,수송 > 지하철,전철 > 수도권5호선'),place(4,'가까운초등학교','school_elementary',.002,'교육,학문 > 학교 > 초등학교'),place(5,'연계초등학교','school_elementary',.006,'교육,학문 > 학교 > 초등학교'),place(6,'검증마트','mart_large',.015,'가정,생활 > 대형마트'),place(7,'슈퍼','supermarket',.001,'가정,생활 > 슈퍼마켓')];
 const before=JSON.stringify(places),r=maps.buildMapMarkers({input,evidence:{center,places,school:{status:'verified',schoolNames:['연계초등학교']}}});
 assert.equal(r.markers.length,5);assert.match(r.markers[0].name,/^01 천연뜨란채$/);assert.equal(r.markers[0].color,'Red');assert.deepEqual({lat:r.markers[0].lat,lng:r.markers[0].lng},center);assert.ok(r.markers.some(p=>p.name.includes('연계초등학교')));assert.ok(!r.markers.some(p=>p.name.includes('가까운초등학교')||p.name.includes('슈퍼')));assert.equal(r.markers.filter(p=>p.color==='Blue').length,2);assert.match(r.legend,/주황: 대형마트/);assert.match(r.markers.find(p=>p.name.includes('연계초등학교')).info,/공식 통학구역 연계 학교/);assert.ok(r.markers.slice(1).every(p=>/직선 [\d,]+m · 기준일 2026-10-20/.test(p.info)));assert.ok(r.radiusM>=1700&&r.radiusM<=3000);assert.equal(JSON.stringify(places),before);
 for(const marker of r.markers.slice(1)){const original=places.find(p=>marker.name.includes(p.name));assert.equal(marker.lat,original.lat);assert.equal(marker.lng,original.lng);}
});
test('입시·국영수 네 과목과 주요 병원을 표시하며 같은 시설의 과목을 한 핀에 합친다',()=>{
 const livingAccess=livingSnapshot({sameMath:true}),r=maps.buildMapMarkers({input,evidence:{center,places:[],livingAccess}}),academic=r.markers.filter(p=>p.color===maps.STYLES.academy.color);
 assert.equal(academic.length,3);assert.ok(academic.some(p=>/입시·보습학원/.test(p.info)&&/수학학원/.test(p.info)));assert.ok(academic.some(p=>/국어학원/.test(p.info)));assert.ok(academic.some(p=>/영어학원/.test(p.info)));assert.equal(r.markers.filter(p=>p.color===maps.STYLES.hospital.color).length,2);assert.ok(!JSON.stringify(r).match(/미술|음악|태권도|체육/));assert.equal(new Set(r.markers.map(p=>p.lat+':'+p.lng)).size,r.markers.length);assert.match(r.legend,/남색: 입시·국영수/);
});
test('만료·조작 거리·잘못된 분류·폐업 시설은 지도에서 제외하고 배정 학교를 임의 확정하지 않는다',()=>{
 const good=place(1,'주변초등학교','school_elementary',.002,'교육,학문 > 학교 > 초등학교'),r=maps.buildMapMarkers({input,evidence:{center,places:[good,{...place(2,'과거역','subway',.004,'교통,수송 > 지하철,전철'),checkedAt:'2026-10-19T02:00:00Z'},{...place(3,'오류역','subway',.004,'교통,수송 > 지하철,전철'),distanceM:2},place(4,'폐업마트','mart_large',.001,'가정,생활 > 대형마트'),place(5,'SSM','mart_large',.003,'가정,생활 > 슈퍼마켓')]}});
 assert.equal(r.markers.length,2);assert.match(r.markers[1].info,/배정 학교 미확인/);assert.equal(maps.buildMapMarkers({input,evidence:{places:[good]}}).markers.length,0);
});
test('먼 대표공원을 근거리 지도로 끌어들이지 않고 가까운 숲길은 원래 진입점 역할로 표시한다',()=>{
 const rows=[{MANAGE_NO:'11410-1',PARK_NM:'먼대표공원',PARK_SE:'근린공원',PARK_AR:200000,LATITUDE:center.lat+.04,LONGITUDE:center.lng,LNMADR:'서울특별시 서대문구 천연동',REFERENCE_DATE:'2026-01-01'}],choice=parks.choosePark(rows,{center,identity:{town:'천연동',regionCode:'11410'},asOf}),nature={...choice,version:parks.VERSION,asOf,center,status:'verified',complete:true,source:{id:'park',url:parks.SOURCE},checkedAt:asOf},natureAccess={version:trails.VERSION,asOf,center,status:'verified',checkedAt:asOf,trails:[natureTrail(10,.003,'인왕산 숲길입구')]};
 assert.ok(parks.verified(nature,{center,asOf}));assert.ok(trails.verified(natureAccess,{center,asOf}));const r=maps.buildMapMarkers({input,evidence:{center,places:[],nature,natureAccess}});assert.equal(r.markers.length,2);assert.ok(r.markers.some(p=>p.name.includes('인왕산 숲길입구')));assert.match(r.markers[1].info,/등록 진입 지점/);assert.ok(!r.markers.some(p=>p.name.includes('먼대표공원')));assert.ok(r.omitted.some(p=>p.name==='먼대표공원'&&p.distanceM>3000));assert.ok(r.radiusM<1000);
});

test('identity-bound public academy proof keeps hospital and subject markers in the shared map',()=>{
 const {snapshot,context}=require('./sbiz-evidence.test.cjs'),sbiz=require('../src/sbiz-evidence.cjs');
 const livingAccess=sbiz.mergeLiving(null,snapshot(),context),evidence={center:context.center,identity:context.identity,livingAccess};
 const result=maps.buildMapMarkers({input:{building:'검증단지',asOf:context.asOf},evidence});
 assert.ok(result.markers.some(p=>p.color===maps.STYLES.academy.color));
 assert.ok(!maps.buildMapMarkers({input:{building:'검증단지',asOf:context.asOf},evidence:{...evidence,identity:{...context.identity,code:'wrong'}}}).markers.some(p=>p.color===maps.STYLES.academy.color));
});
