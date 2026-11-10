'use strict';
// 2026-11-10 로직 검토에서 확인한 결함의 회귀 검증.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const living=require('../src/living-access.cjs'),core=require('../src/core.cjs');

test('국어학원 분류는 외국어·중국어·한국어 학원을 국어로 세지 않는다',()=>{
  const place=(name,label)=>({name,kakao_category_name:label});
  assert.equal(living.eligible(place('정상어학원','교육,학문 > 학원 > 외국어학원 > 영어학원'),'korean'),false);
  assert.equal(living.eligible(place('청담어학원','교육,학문 > 학원 > 외국어학원'),'korean'),false);
  assert.equal(living.eligible(place('차이나중국어학원','교육,학문 > 학원 > 외국어학원 > 중국어학원'),'korean'),false);
  assert.equal(living.eligible(place('세종한국어학원','교육,학문 > 학원 > 외국어학원'),'korean'),false);
  // 실제 국어 학원과 영어 학원의 기존 분류는 그대로 유지한다.
  assert.equal(living.eligible(place('바른국어학원','교육,학문 > 학원 > 입시,보습학원'),'korean'),true);
  assert.equal(living.eligible(place('논술의힘','교육,학문 > 학원 > 국어학원'),'korean'),true);
  assert.equal(living.eligible(place('국어의정석 외국어관','교육,학문 > 학원 > 외국어학원'),'korean'),true);
  assert.equal(living.eligible(place('정상어학원','교육,학문 > 학원 > 외국어학원 > 영어학원'),'english'),true);
});

test('1억 바로 아래 평균도 반올림한 값과 같은 단위로 표시한다',()=>{
  assert.equal(core.averageMoney(9999.96),'1억');
  assert.equal(core.averageMoney(9999.94),'9,999.9만원');
  assert.equal(core.averageMoney(75000),'7.5억');
  assert.equal(core.averageMoney(9000),'9,000만원');
  assert.equal(core.averageMoney(NaN),'산출 불가');
});

test('고객 예산은 같은 거래 유형의 저장된 6개월 평균과만 대조한다',()=>{
  const {budgetLines}=require('../src/customer-summary.cjs');
  const member=(key,summaries)=>({key,prices:{summaries}});
  const a=member('A',[{kind:'trade',price:75300,n:12},{kind:'jeonse',deposit:42000,n:5}]);
  assert.deepEqual(budgetLines([a],{budgetManwon:70000,budgetType:'trade'}),['매매 예산 7억 대조: 최근 6개월 매매 평균 7.5억(12건)은 예산보다 5,300만원 높습니다.']);
  assert.deepEqual(budgetLines([a],{budgetManwon:45000,budgetType:'jeonse'}),['전세 보증금 예산 4.5억 대조: 최근 6개월 전세 보증금 평균 4.2억(5건)은 예산보다 3,000만원 낮습니다.']);
  assert.deepEqual(budgetLines([a],{budgetManwon:75300,budgetType:'trade'}),['매매 예산 7.5억 대조: 최근 6개월 매매 평균 7.5억(12건)은 예산과 같습니다.']);
  // 자료가 없는 유형은 다른 유형이나 0원으로 채우지 않는다.
  assert.deepEqual(budgetLines([a],{budgetManwon:5000,budgetType:'monthly'}),['월세 보증금 예산 5,000만원 대조: 최근 6개월 월세 거래 자료가 없어 대조하지 못했습니다.']);
  // 비교 보고서는 매물별로 한 줄씩 표시한다.
  const b=member('B',[{kind:'trade',price:Number.NaN,n:0}]);
  const lines=budgetLines([a,b],{budgetManwon:80000,budgetType:'trade'});
  assert.equal(lines.length,2);assert.match(lines[0],/^매매 예산 8억 대조 · A: .*4,700만원 낮습니다\.$/);assert.match(lines[1],/· B: 최근 6개월 매매 거래 자료가 없어/);
  // 예산을 적지 않았으면 아무것도 추가하지 않는다.
  assert.deepEqual(budgetLines([a],{budgetManwon:null,budgetType:'trade'}),[]);
  assert.deepEqual(budgetLines([a],{budgetManwon:0,budgetType:'trade'}),[]);
});

test('비교 보고서의 평균 차이는 1억 이상이면 억 단위로 표시한다',()=>{
  const basis=require('../src/comparison-basis.cjs');
  const member=(key,price)=>({key,input:{types:['trade'],area:'84',asset:'apartment',asOf:'2026-11-10'},prices:{effectiveArea:{areaMode:'exact',area:84},period:{start:'2026-05-10',end:'2026-11-10'},rows:[],summaries:[{kind:'trade',price,n:3}]}});
  const big=basis.notes([member('A',75000),member('B',100000)]).join('\n'),small=basis.notes([member('A',75000),member('B',78000)]).join('\n');
  if(/매매 평균/.test(big)){assert.match(big,/B가 A보다 2\.5억 높음/);assert.match(small,/B가 A보다 3,000만원 높음/);}
  else assert.fail('비교 문장을 만들지 못했습니다: '+big);
});

test('건축HUB 세션이 만료되면 한 번만 새로 연결하고 다른 오류는 재시도하지 않는다',async()=>{
  const archhub=require('../src/archhub.cjs');
  const server=({expireOnce=false,alwaysExpire=false}={})=>{
    const seen=[];let session=0,expired=false;
    const fetcher=async(url,options)=>{
      const q=JSON.parse(options.body),sid=options.headers['Mcp-Session-Id'];seen.push({method:q.method,sid});
      if(q.method==='initialize'){session++;return new Response(JSON.stringify({jsonrpc:'2.0',id:q.id,result:{protocolVersion:'2025-03-26'}}),{headers:{'content-type':'application/json','mcp-session-id':'s'+session}});}
      if(!q.id)return new Response(null,{status:202});
      if(alwaysExpire||expireOnce&&!expired&&sid==='s1'){expired=true;return new Response('session not found',{status:404});}
      return new Response(JSON.stringify({jsonrpc:'2.0',id:q.id,result:{structuredContent:{result:'ok '+sid}}}),{headers:{'content-type':'application/json'}});
    };
    return {seen,fetcher};
  };
  const calls=[],recover=server({expireOnce:true}),client=new archhub.Client({fetcher:recover.fetcher,onCall:c=>calls.push(c.tool)});
  assert.equal(await client.call('find_region',{keyword:'test'}),'ok s2');
  assert.deepEqual(recover.seen.map(s=>s.method),['initialize','notifications/initialized','tools/call','initialize','notifications/initialized','tools/call']);
  assert.equal(recover.seen[3].sid,undefined);// 만료된 세션 번호를 새 연결에 보내지 않는다.
  assert.deepEqual(calls,['find_region','find_region']);// 실제로 보낸 조회를 모두 기록한다.
  const dead=server({alwaysExpire:true}),stuck=new archhub.Client({fetcher:dead.fetcher});
  await assert.rejects(stuck.call('find_region',{}),/404/);
  assert.equal(dead.seen.filter(s=>s.method==='tools/call').length,2);
});

// 2026-11-10 사용자 결정: 역·초등학교가 1.5~3km이면 '평가 보류'가 아니라 배점표의 '초과 35점'을 적용한다.
test('1.5~3km 역은 검증된 묶음 응답에서만 받아 35점으로 평가하고 3km 밖이면 보류한다',()=>{
  const scoring=require('../src/scoring.cjs'),{projections}=require('../src/research-projection.cjs'),markers=require('../src/map-markers.cjs');
  const center={lat:37.56,lng:126.95},asOf='2026-11-10',identity={building:'가상검증단지',code:'TEST123',town:'가상동',lot:'1',...center},input={asset:'apartment',target:'가상검증단지',building:identity.building,asOf,types:['trade']},prices={buildingResolution:identity,rows:[],summaries:[],coverage:[]};
  const station=(id,name,offset)=>{const coord={lat:center.lat+offset,lng:center.lng};return {kakao_place_id:id,name,kakao_category_name:'교통,수송 > 지하철,전철 > 수도권1호선',...coord,distance_m:Math.round(living.distance(center,coord))};};
  const batch=(rows,stamp=asOf+'T01:00:00Z')=>({server:'ipzitalk',tool:'search_by_nearby_category',arguments:{center_lat:center.lat,center_lng:center.lng,categories:['subway'],radius_m:5000},result:{structuredContent:{center,radius_m:5000,results:{subway:rows},pagination_by_category:{subway:{collected_count:rows.length,returned_count:rows.length,source_cap_reached:false}},metadata:{collected_at:stamp,truncated:false}}}});
  const assess=wide=>scoring.assessScores({scores:[]},{input,prices,tools:[wide,...projections(wide,asOf)]});
  // .018도 ≈ 2,002m: 예전에는 버려져 보류였다.
  const far=assess(batch([station('961','먼역',.018)])).scores[0];
  assert.equal(far.score,35);assert.equal(far.status,'partial');assert.equal(far.coverage,40);assert.equal(far.calculation[0].value,2002);assert.match(far.observed,/먼역: 직선 약 2,002m/);
  // 가까운 역이 있으면 결과는 그대로다.
  const near=assess(batch([station('962','가까운역',.012),station('961','먼역',.018)])).scores[0];
  assert.equal(near.score,55);assert.match(near.observed,/가까운역/);assert.doesNotMatch(near.observed,/먼역/);
  // 3km 밖의 역만 있으면 점수를 만들지 않는다.
  const beyond=assess(batch([station('963','범위밖역',.03)])).scores[0];
  assert.equal(beyond.score,null);assert.equal(beyond.status,'withheld');
  // 검증을 거치지 않은 원본 5km 응답이나 다른 날짜 응답은 점수에 쓰지 않는다.
  assert.equal(scoring.assessScores({scores:[]},{input,prices,tools:[batch([station('961','먼역',.018)])]}).scores[0].score,null);
  assert.equal(assess(batch([station('961','먼역',.018)],'2026-11-09T01:00:00Z')).scores[0].score,null);
  // 지도에는 가장 가까운 역을 표시하되, 두 번째 역은 예전처럼 1.5km 안일 때만 추가한다.
  const pins=rows=>{const wide=batch(rows),evidence=scoring.collectEvidence({input,prices,tools:[wide,...projections(wide,asOf)]});return markers.buildMapMarkers({input,identity,evidence}).markers.map(m=>m.name).join(' | ');};
  const onlyFar=pins([station('961','먼역',.018),station('964','더먼역',.024)]);assert.match(onlyFar,/역 · 먼역/);assert.doesNotMatch(onlyFar,/더먼역/);
  const mixed=pins([station('962','가까운역',.012),station('961','먼역',.018)]);assert.match(mixed,/역 · 가까운역/);assert.doesNotMatch(mixed,/역 · 먼역/);
});

test('보관함 목록은 바뀐 보고서만 다시 읽고 저장·삭제를 바로 반영한다',async()=>{
  const {ReportStore}=require('../src/store.cjs'),root=await fs.mkdtemp(path.join(os.tmpdir(),'re-store-'));
  try{
    const store=new ReportStore(root),report=n=>({title:'보고서 '+n,createdAt:new Date(Date.UTC(2026,10,10,0,n)).toISOString(),status:'검토 필요',input:{target:'가상단지 '+n,asOf:'2026-11-10',area:'84',asset:'apartment',building:'가상'+n}});
    const a=await store.save(report(1)),b=await store.save(report(2));
    let list=await store.list();
    assert.deepEqual(list.map(x=>x.id),[b.id,a.id]);
    assert.deepEqual(Object.keys(list[0]).sort(),['area','asOf','asset','building','createdAt','demo','id','mode','status','target','title']);
    // 두 번째 조회는 원문을 다시 읽지 않는다.
    const load=store.load.bind(store);let loads=0;store.load=async id=>{loads++;return load(id);};
    list=await store.list();assert.equal(loads,0);assert.equal(list.length,2);
    // 프로그램 안에서 수정한 보고서는 다음 조회에 반영한다.
    await store.update(a.id,r=>({...r,title:'수정본'}));loads=0;
    list=await store.list();assert.equal(list.find(x=>x.id===a.id).title,'수정본');assert.equal(loads,1);
    // 밖에서 바뀐 파일(백업 복원 등)도 수정시각·크기로 알아챈다.
    const file=path.join(root,b.id,'report.json'),raw=JSON.parse(await fs.readFile(file,'utf8'));raw.title='외부에서 바꾼 제목입니다';
    await fs.writeFile(file,JSON.stringify(raw));await fs.utimes(file,new Date(),new Date(Date.now()+5000));
    list=await store.list();assert.equal(list.find(x=>x.id===b.id).title,'외부에서 바꾼 제목입니다');
    // 반환값을 고쳐도 내부 요약은 오염되지 않는다.
    list[0].title='오염';assert.notEqual((await store.list())[0].title,'오염');
    // 지운 폴더와 깨진 파일은 목록에서 빠진다.
    await fs.rm(path.join(root,a.id),{recursive:true});await fs.writeFile(file,'{깨진');
    assert.deepEqual(await store.list(),[]);assert.equal(store.index.size,0);
  }finally{await fs.rm(root,{recursive:true,force:true});}
});
