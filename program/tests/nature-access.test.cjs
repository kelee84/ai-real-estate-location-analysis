'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const nature=require('../src/nature-access.cjs'),park=require('../src/regional-park.cjs'),{SCORE_ITEMS}=require('../src/core.cjs');
const center={lat:37.567566,lng:126.9584477},asOf=require('../src/core.cjs').todayKst(),geometry={type:'LineString',coordinates:[[126.954,37.5685],[126.960,37.5685]]};
const source={id:'seoul-trail',url:'https://gil.seoul.go.kr/trail/view.do?sc_trailSn=132',checkedAt:asOf};
function evidence(){const p={id:'trail',name:'가상 숲길',kind:'official-route',...nature.nearest(geometry,center),pointRole:'공식 경로의 최근접점·출입구 미확인',geometry,geometrySource:'https://map.seoul.go.kr/smgis2/poiViewMap?ti=100715&pi=A_008',source:{...source}};return {version:nature.VERSION,status:'verified',center,asOf,checkedAt:asOf,criteria:nature.CRITERIA,trails:[p]};}
const distanceScore=d=>d<=300?95:d<=600?85:d<=1000?70:d<=1500?55:35;
function tools(){return [{server:'ipzitalk',tool:'search_by_nearby_keyword',arguments:{query:'산책로'},result:{structuredContent:{center,radius_m:3000,metadata:{collected_at:asOf,truncated:true},results:[{name:'가상산자락길',kakao_place_id:'123',kakao_category_name:'여행 > 관광,명소 > 도보여행',lat:center.lat+.002,lng:center.lng,distance_m:222},{name:'등산로입구 화장실',kakao_place_id:'124',kakao_category_name:'가정,생활 > 화장실',lat:center.lat+.001,lng:center.lng,distance_m:111},{name:'가상산',kakao_place_id:'125',kakao_category_name:'여행 > 관광,명소 > 산',lat:center.lat+.001,lng:center.lng,distance_m:111}]}}}];}
test('공식 경로 선분에서 최근접점을 계산하고 산 정상·위경도 역전·긴 누락 구간은 대신 쓰지 않음',()=>{
 const p=nature.nearest(geometry,center);assert.ok(p.distanceM>100&&p.distanceM<110);assert.ok(Math.abs(p.lng-center.lng)<.000001);assert.equal(p.lat,37.5685);
 assert.equal(nature.nearest({type:'LineString',coordinates:[[37.5,126.9],[37.6,126.9]]},center),null);assert.equal(nature.nearest({type:'LineString',coordinates:[[126,37],[128,38]]},center),null);
});
test('등록 산책로·진입 지점만 대조하고 화장실·산 정상·다른 중심·날짜·허위 거리는 제외',()=>{
 const good=nature.placeCandidates(tools(),{center,asOf});assert.equal(good.length,1);assert.equal(good[0].limited,true);assert.equal(good[0].pointRole,'등록 시설 기준점');
 for(const change of [d=>d.center={lat:38,lng:127},d=>d.metadata.collected_at=require('../src/core.cjs').todayKst(new Date(Date.now()+86400000)),d=>d.results[0].distance_m=1,d=>d.results[0].kakao_category_name='음식점']){const t=tools();change(t[0].result.structuredContent);assert.equal(nature.placeCandidates(t,{center,asOf}).length,0);}
});
test('같은 조회일·공식 경로·좌표·거리 근거가 맞지 않으면 새로운 자연 점수에 사용하지 않음',()=>{
 assert.equal(nature.verified(evidence(),{center,asOf}),true);
 for(const change of [d=>d.trails[0].lat+=.01,d=>d.trails[0].distanceM=1,d=>d.trails[0].source.url='https://evil.test/trail',d=>d.trails[0].geometrySource='https://evil.test/map',d=>d.checkedAt='2026-08-01']){const data=evidence();change(data);assert.equal(nature.verified(data,{center,asOf}),false);}
 const unavailable={...evidence(),status:'unavailable',trails:[]};assert.equal(nature.current(unavailable,{center,asOf}),true);assert.equal(nature.verified(unavailable,{center,asOf}),false);
});
test('대형공원을 없애지 않고 가까운 숲길을 함께 비교하며 자원 수로 점수를 중복 가산하지 않음',()=>{
 const rows=[{MANAGE_NO:'11410-00001',PARK_NM:'가상대형공원',PARK_SE:'근린공원',PARK_AR:'300000',LATITUDE:center.lat+.0202,LONGITUDE:center.lng,LNMADR:'서울특별시 서대문구 천연동',REFERENCE_DATE:asOf}],choice=park.choosePark(rows,{center,identity:{town:'천연동'},asOf});
 const e={center,nature:{...choice,version:park.VERSION,status:'verified',asOf,checkedAt:asOf,center,complete:true,source:{id:'park',url:park.SOURCE}},natureAccess:evidence(),sources:[]},scores=SCORE_ITEMS.map(name=>({name,score:name==='자연환경'?35:null,regionalPark:choice.selected}));
 assert.equal(park.verified(e.nature,{center,asOf}),true);assert.equal(nature.apply(scores,e,{input:{asOf},distanceScore}),true);assert.equal(scores[3].score,95);assert.equal(scores[3].coverage,50);assert.equal(e.natureAccess.selected.name,'가상 숲길');assert.equal(scores[3].regionalPark,undefined);assert.equal(e.natureAccess.candidates.length,2);assert.match(scores[3].observed,/출입구 미확인/);assert.match(scores[3].needed,/경사.*통제/);
 const compact=nature.compact(e.natureAccess);assert.doesNotMatch(JSON.stringify(compact),/coordinates/);assert.ok(e.natureAccess.trails[0].geometry);assert.ok(e.sources.some(s=>s.id==='seoul-trail'));
});
test('서울시 공식 검색 링크만 추출하고 자연 길이 아닌 도시 관광 결과는 제외',()=>{
 const html='<a href="/trail/view.do?key=2405200007&sc_trailSn=132&sc_trailSeCd=SE001" title="[새창열림] 안산 자락길 상세보기">길</a><a href="https://evil.test/view.do?sc_trailSn=1" title="[새창열림] 가짜 숲길 상세보기"></a><a href="/trail/view.do?sc_trailSn=2" title="[새창열림] 옛골목 문화탐방 상세보기"></a>';
 assert.deepEqual(nature.routeLinks(html),[{name:'안산 자락길',url:'https://gil.seoul.go.kr/trail/view.do?key=2405200007&sc_trailSn=132&sc_trailSeCd=SE001'}]);
 const safe=require('../src/public-trails.cjs').safeUrl;assert.ok(safe('https://map.seoul.go.kr/smgis2/poiViewMap?ti=100715&pi=A_008'));for(const url of ['https://map.seoul.go.kr.evil.test/smgis2/poiViewMap?ti=1&pi=a','http://map.seoul.go.kr/smgis2/poiViewMap?ti=1&pi=a','https://map.seoul.go.kr/account?ti=1&pi=a'])assert.equal(safe(url),null);
});
test('부분 조회 실패는 남기고 성공한 등록 숲길은 표시하며 과거 기준일은 현재 자료로 채우지 않음',async()=>{
 let n=0;const data=await nature.query({center,asOf,call:async(_tool,args)=>{n++;if(args.query==='숲길')throw Error('연결 오류');const t=tools()[0];t.arguments=args;return t;}});assert.equal(n,3);assert.equal(data.status,'verified');assert.equal(nature.verified(data,{center,asOf}),true);assert.ok(data.warnings.length);assert.equal(data.limited,true);
 const old=await nature.query({center,asOf:'2026-10-17',call:()=>{throw Error('과거 보고서는 조회하면 안 됩니다.');}});assert.equal(old.status,'unavailable');
});
function officialReader({name='가상근린 숲길',routeGeometry=geometry,actualName=name}={}){
 const fetched=[],read=[];
 const fetchImpl=async url=>{fetched.push(url);return new Response(String(url).includes('/trail/list.do?')?`<a href="/trail/view.do?sc_trailSn=132" title="[새창열림] ${name} 상세보기">공식 길</a>`:'https://map.seoul.go.kr/smgis2/poiViewMap?ti=100715&amp;pi=A_008&amp;lang=ko');};
 const readTrail=async url=>{read.push(url);return {name:actualName,theme:'100715',id:'A_008',updatedAt:asOf,geometry:routeGeometry};};
 return {fetchImpl,readTrail,fetched,read};
}
test('네이버의 이름은 검색어로만 쓰고 가까운 공식 geometry 검증 후 자연공간 MCP 3회를 생략',async()=>{
 let n=0;const mock=officialReader(),data=await nature.query({center,asOf,seedNames:['가상근린 숲길'],...mock,call:async()=>{n++;throw Error('호출하면 안 됩니다.');}});
 assert.equal(n,0);assert.equal(mock.fetched.length,2);assert.equal(mock.read.length,1);assert.equal(nature.verified(data,{center,asOf}),true);assert.equal(data.trails[0].pointRole,'공식 경로의 최근접점·출입구 미확인');assert.ok(data.trails[0].distanceM<=300);assert.equal(data.limited,true);assert.match(data.scope,/전수 미검증/);assert.deepEqual(data.collection.skippedKeywordQueries,nature.QUERIES);assert.match(data.reason,/최고 배점 구간/);
 const scores=SCORE_ITEMS.map(name=>({name})),e={center,natureAccess:data,sources:[]};assert.equal(nature.apply(scores,e,{input:{asOf},distanceScore}),true);assert.equal(scores[3].score,95);assert.equal(scores[3].coverage,50);assert.match(scores[3].needed,/보행거리/);
});
test('공식 경로가 300m보다 멀면 기존 세 키워드 검색을 유지하고 가까운 등록 위치도 비교',async()=>{
 let n=0;const far={type:'LineString',coordinates:[[126.954,center.lat+.004],[126.960,center.lat+.004]]},mock=officialReader({routeGeometry:far});
 const data=await nature.query({center,asOf,seedNames:['가상근린 숲길'],...mock,call:async(_tool,args)=>{n++;const t=tools()[0];t.arguments=args;return t;}});
 assert.equal(n,3);assert.equal(nature.verified(data,{center,asOf}),true);assert.ok(data.trails.some(p=>p.kind==='official-route'&&p.distanceM>300));assert.equal(data.trails[0].kind,'registered-trail');assert.deepEqual(data.collection.skippedKeywordQueries,[]);
});
test('공식 이름이 다르거나 경로가 없으면 네이버 명칭에 좌표·점수를 만들지 않고 세 키워드로 보완',async()=>{
 for(const change of [{actualName:'다른 숲길'},{routeGeometry:{type:'LineString',coordinates:[[126,37],[128,38]]}}]){
  let n=0;const mock=officialReader(change),data=await nature.query({center,asOf,seedNames:['가상근린 숲길'],...mock,call:async()=>{n++;return null;}});
  assert.equal(n,3);assert.equal(data.status,'unavailable');assert.deepEqual(data.trails,[]);
 }
 let calls=0;const data=await nature.query({center,asOf,seedNames:['카페','가상 숲길 출입금지','<script>가상숲길</script>'],...officialReader(),call:async()=>{calls++;return null;}});assert.equal(calls,3);assert.equal(data.status,'unavailable');
});
test('같은 날 검증된 공식 geometry만 재사용하고 과거 확인일을 오늘로 바꾸지 않음',async()=>{
 const initial=evidence().trails,copy=structuredClone(initial);let n=0;
 const data=await nature.query({center,asOf,initialTrails:initial,call:async()=>{n++;return null;}});assert.equal(n,0);assert.equal(nature.verified(data,{center,asOf}),true);assert.deepEqual(initial,copy);assert.equal(data.trails[0].source.checkedAt,initial[0].source.checkedAt);
 const stale=structuredClone(initial);stale[0].source.checkedAt=require('../src/core.cjs').todayKst(new Date(Date.now()-86400000));
 const missed=await nature.query({center,asOf,initialTrails:stale,call:async()=>{n++;return null;}});assert.equal(n,3);assert.equal(missed.status,'unavailable');assert.equal(stale[0].source.checkedAt,require('../src/core.cjs').todayKst(new Date(Date.now()-86400000)));
 const mislabeled=evidence();mislabeled.trails[0].pointRole='공식 출입구';assert.equal(nature.verified(mislabeled,{center,asOf}),false);
});
test('시작 전 또는 공식 경로 읽기 중 취소하면 MCP 보완 요청 없이 중지',async()=>{
 const aborted=new AbortController();aborted.abort(new Error('사용자 취소'));let n=0;
 await assert.rejects(nature.query({center,asOf,initialTrails:evidence().trails,signal:aborted.signal,call:async()=>n++}),/사용자 취소/);assert.equal(n,0);
 const controller=new AbortController(),mock=officialReader();mock.readTrail=async()=>{controller.abort(new Error('경로 읽기 취소'));throw controller.signal.reason;};
 await assert.rejects(nature.query({center,asOf,seedNames:['가상근린 숲길'],...mock,signal:controller.signal,call:async()=>n++}),/경로 읽기 취소/);assert.equal(n,0);
});
function fullCatalogue(){const pub=require('../src/public-trails.cjs');return {version:pub.CATALOGUE_VERSION,sourceUrl:pub.CATALOGUE_URL,checkedAt:new Date().toISOString(),theme:'100715',declaredCount:2,complete:true,rows:[{theme:'100715',id:'A_008',name:'가상 숲길',category:'숲이 좋은 길',geometry},{theme:'100715',id:'C_003',name:'다른 하천길',category:'한강·하천이 좋은 길',geometry:{type:'LineString',coordinates:[[126.954,37.58],[126.960,37.58]]}}]};}
test('네이버 명칭이 없어도 공식 전체 경로를 먼저 확인하고 이전 등록 지점도 보존',async()=>{
 let calls=0;const prior=nature.placeCandidates(tools(),{center,asOf}),readTrail=async()=>{throw Error('개별 지도 불필요');};readTrail.catalogue=async()=>fullCatalogue();
 const data=await nature.query({center,asOf,readTrail,initialTrails:prior,call:async()=>{calls++;return null;}});assert.equal(calls,0);assert.ok(nature.verified(data,{center,asOf}));assert.equal(data.trails.length,3);assert.ok(data.trails.some(p=>p.id===prior[0].id));assert.equal(data.collection.catalogue.rowsRead,2);assert.deepEqual(data.collection.skippedKeywordQueries,nature.QUERIES);assert.ok(data.trails[0].catalogueProof.recordHash);
 const scores=SCORE_ITEMS.map(name=>({name})),e={center,natureAccess:data,sources:[]};nature.apply(scores,e,{input:{asOf},distanceScore});assert.equal(scores[3].score,95);assert.equal(e.natureAccess.selected.name,'가상 숲길');
 for(const change of [v=>v.trails[0].name='가짜 숲길',v=>v.trails[0].catalogueProof.recordHash='a'.repeat(64),v=>v.trails[0].catalogueProof.rowsRead=3,v=>v.trails[0].source.url='https://example.com',v=>v.trails[0].catalogueProof.checkedAt=new Date(Date.now()-86400000).toISOString()]){const v=structuredClone(data);change(v);assert.equal(nature.verified(v,{center,asOf}),false,change.toString());}
});
test('멀거나 불완전한 공식 목록은 최고 구간으로 간주하지 않고 기존 키워드 보완 유지',async()=>{
 for(const change of [v=>v.rows[0].geometry=v.rows[1].geometry,v=>v.declaredCount=3,v=>v.checkedAt=new Date(Date.now()-86400000).toISOString()]){let calls=0;const value=fullCatalogue();change(value);const readTrail=async()=>{};readTrail.catalogue=async()=>value;const result=await nature.query({center,asOf,readTrail,call:async()=>{calls++;return null;}});assert.equal(calls,3);assert.deepEqual(result.collection.skippedKeywordQueries,[]);}
});
