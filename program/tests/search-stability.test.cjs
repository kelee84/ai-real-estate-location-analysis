'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {AnalysisService}=require('../src/service.cjs'),{normalizeInput,todayKst}=require('../src/core.cjs');
const {discoverTypes}=require('../src/type-catalog.cjs');
const region={code:'28185',name:'연수구',province:{code:'2800000000',name:'인천광역시'}};
const record={complexNo:'12345',name:'새이름아파트',addressJibun:'인천광역시 연수구 송도동 18-6',addressRoad:'인천광역시 연수구 예시로 20',lat:37.4,lng:126.64,coordinateBasis:'complex',checkedAt:new Date().toISOString(),sourceUrl:'https://fin.land.naver.com/complexes/12345'};
function fixture({name='옛이름아파트',properties,areas}={}){
 const calls=[],bridge=new EventEmitter();bridge.evidenceSession=async()=>{throw Error('저장 단지에 외부 단지 검색을 요청하면 안 됩니다.');};
 const data={resolve:async()=>region,request:async(route,form)=>{
  calls.push({route,form});let out;
  if(route.includes('emdList'))out={emdList:[{code:'2818510600',codeNm:'송도동'}]};
  else if(route.includes('ptDanjiList')){const list=properties||[{aprpnHsmpCode:'20100001',aprpnHsmpNm:name,mnnm:'18-6',roadNm:'예시로 20',la:37.4,lo:126.64}];out={totCnt:list.length,danjiList:list};}
  else out={danjiList:(areas||[59.9201,84.8682]).map(prvuseAr=>({prvuseAr}))};
  return Buffer.from(JSON.stringify(out));
 }};
 const service=new AnalysisService({bridge,data,onEvent:()=>{}});service.naverStore={list:async()=>[record]};return {service,data,calls};
}
test('지역 포함/생략, 지번/도로명 검색 모두 당일 네이버 식별정보로 같은 공식 타입에 연결',async()=>{
 for(const target of ['새이름아파트','인천 연수구 송도동 새이름아파트','인천 연수구 송도동 18-6','인천 연수구 예시로 20','인천 연수구 송도동 18-6 새이름아파트']){
  const f=fixture(),found=await f.service.searchTypes({target});assert.equal(found.kind,'candidates',target);
  const selected=await f.service.selectProperty({searchToken:found.searchToken,candidateId:found.candidates[0].id});
  assert.equal(selected.identity.code,'20100001');assert.deepEqual(selected.areas,[59.9201,84.8682]);
  f.service.validateTypeSelection({target:selected.target,building:selected.requestedBuilding,asset:'apartment',selectedAreas:[84.8682],catalogToken:selected.token});
 }
});
test('주소에 단지명을 함께 입력해도 지번/건물번호를 이름으로 쓰지 않음',async()=>{
 for(const target of ['인천 연수구 송도동 18-6 옛이름아파트','인천 연수구 예시로 20 옛이름아파트']){
  const f=fixture(),c=await discoverTypes(f.data,{target});assert.equal(c.identity.code,'20100001');
 }
});
test('주소만 검색한 공식 동명/같은 주소 후보는 사용자 확인을 거침',async()=>{
 const f=fixture({name:'확인단지'});f.service.naverStore=null;
 const found=await f.service.searchTypes({target:'인천 연수구 송도동 18-6'});
 assert.equal(found.kind,'candidates');assert.equal(found.candidates[0].id,'rtms-20100001');
 const selected=await f.service.selectProperty({searchToken:found.searchToken,candidateId:found.candidates[0].id});assert.equal(selected.identity.code,'20100001');
});
test('다른 지번·부번·지역의 네이버 저장 단지는 반환하지 않음',()=>{
 const api=require('../src/naver-land.cjs');
 for(const target of ['인천 연수구 송도동 18-7','서울 송파구 송도동 18-6','인천 연수구 예시로 2','인천 연수구 송도동 18-7 새이름아파트'])assert.deepEqual(api.candidates(normalizeInput({target}),[record]),[]);
});
test('세종·읍면리 지번 후보는 법정동과 시군구를 정확히 선택',async()=>{
 const search=require('../src/property-search.cjs');
 for(const [address,r,town]of [['세종특별자치시 나성동 1',{code:'36110',name:'세종특별자치시',province:{name:'세종특별자치시'}},'나성동'],['강원특별자치도 정선군 북평면 나전리 1',{code:'42770',name:'정선군',province:{name:'강원특별자치도'}},'나전리']]){
  const selected=await search.resolveChoice({}, {resolve:async()=>r}, {id:'naver-12345',naverComplexNo:'12345',name:'가상아파트',address});
  assert.equal(selected.region.code,r.code);assert.match(selected.target,new RegExp(town));assert.equal(selected.target.includes('북평면 나성동'),false);
 }
});
test('잘못된 면적값을 부분 목록으로 표시하지 않으며 빈 목록과 조회 실패를 구분',async()=>{
 const invalid=fixture({name:'옛이름아파트',areas:[84.1,'bad']}),empty=fixture({name:'옛이름아파트',areas:[]});
 await assert.rejects(discoverTypes(invalid.data,{target:'인천 연수구 송도동 옛이름아파트'}),e=>e.code==='TYPE_RESPONSE_INVALID');
 await assert.rejects(discoverTypes(empty.data,{target:'인천 연수구 송도동 옛이름아파트'}),e=>e.code==='TYPE_EMPTY');
});
test('공식 타입 목록이 100개를 넘어도 선택 개수 제한으로 검색 전체를 실패시키지 않음',async()=>{
 const areas=Array.from({length:120},(_,i)=>50+i/1000),f=fixture({areas});
 const catalog=await discoverTypes(f.data,{target:'인천 연수구 송도동 옛이름아파트'});assert.deepEqual(catalog.areas,areas);assert.equal(catalog.records.length,240);
});
test('면적 조회의 일시적 오류만 한 번 재시도하고 인증·형식 오류는 반복하지 않음',async()=>{
 for(const [error,expected]of [[Object.assign(Error('temporary'),{status:503}),2],[Object.assign(Error('denied'),{status:403}),1],[new SyntaxError('JSON'),1]]){
  const f=fixture(),request=f.data.request;let n=0;f.data.request=async(route,form,signal)=>{if(route.includes('ptDtlArea')&&form.srhDelngSecd==='1'&&++n===1)throw error;return request(route,form,signal);};
  const work=discoverTypes(f.data,{target:'인천 연수구 송도동 옛이름아파트'});
  if(expected===2)await work;else await assert.rejects(work);assert.equal(n,expected);
 }
});
test('동일 검색은 진행 중 요청을 공유하고 취소한 검색은 결과/토큰을 저장하지 않음',async()=>{
 const f=fixture({name:'옛이름아파트'});f.service.naverStore=null;const request=f.data.request;let release;
 f.data.request=async(...args)=>{if(args[0].includes('emdList'))await new Promise(r=>release=r);return request(...args);};
 const raw={target:'인천 연수구 송도동 옛이름아파트',searchRequestId:'test-cancel'},a=f.service.searchTypes(raw),b=f.service.searchTypes(raw);
 await new Promise(r=>setImmediate(r));assert.equal(typeof release,'function');
 assert.equal(f.service.cancelSearch('test-cancel'),true);release();
 for(const p of [a,b])await assert.rejects(p,e=>e.code==='SEARCH_CANCELLED');
 assert.equal(f.service.typeCatalogs?.size||0,0);assert.equal(f.service.active,null);
 f.data.request=request;
 const result=await f.service.searchTypes({...raw,searchRequestId:'next'});assert.deepEqual(result.areas,[59.9201,84.8682]);
});
test('당일 외 날짜와 강제 새 조회는 네이버 저장 후보를 사용하지 않음',async()=>{
 for(const raw of [{forceRefresh:true},{asOf:todayKst(new Date(Date.now()-86400000))}]){
  const f=fixture({name:'옛이름아파트'});f.service.naverStore.list=async()=>{throw Error('캐시를 조회하면 안 됩니다.');};
  const c=await f.service.searchTypes({target:'인천 연수구 송도동 옛이름아파트',...raw});assert.deepEqual(c.areas,[59.9201,84.8682]);
 }
});
test('비정상 단지 목록·잘린 페이지는 단지 없음으로 처리하거나 면적을 조회하지 않음',async()=>{
 for(const value of [null,{danjiList:[],totCnt:null},{danjiList:[],totCnt:1}]){
  const f=fixture(),request=f.data.request;f.data.request=async(route,...args)=>route.includes('ptDanjiList')?Buffer.from(JSON.stringify(value)):request(route,...args);
  await assert.rejects(discoverTypes(f.data,{target:'인천 연수구 송도동 옛이름아파트'}),e=>['SEARCH_RESPONSE_INVALID','SEARCH_RESPONSE_INCOMPLETE'].includes(e.code));assert.equal(f.calls.some(c=>c.route.includes('ptDtlArea')),false);
 }
});
test('다른 검색으로 전환하면 이전 결과를 저장하지 않고 새 검색만 완료',async()=>{
 const f=fixture();f.service.naverStore=null;const request=f.data.request;let release;
 f.data.request=async(...args)=>{if(args[0].includes('emdList')&&!release)await new Promise(r=>release=r);return request(...args);};
 const first=f.service.searchTypes({target:'인천 연수구 송도동 옛이름아파트',searchRequestId:'old'});await new Promise(r=>setImmediate(r));
 const next=await f.service.searchTypes({target:'인천 연수구 송도동 옛이름아파트',asOf:'2026-10-01',searchRequestId:'new'});release();await assert.rejects(first,e=>e.code==='SEARCH_CANCELLED');
 assert.equal(f.service.typeCatalogs.size,1);assert.ok(f.service.typeCatalogs.has(next.token));
});
test('검색 오류 진단은 단계/코드/시도 횟수만 남기고 입력·응답·인증정보를 포함하지 않음',()=>{
 const {diagnostic}=require('../src/search-errors.cjs'),raw={code:'SECRET',status:503,attempts:2,message:'token=private customer=hidden',body:{cookie:'secret'},input:{customer:'hidden'}};
 assert.deepEqual(diagnostic(raw,'types'),{stage:'types',code:'SECRET',status:503,attempts:2});
});

// Public RTMS response checked on 2026-10-30. K-apt candidates do not always
// contain coordinates; the lot AND full road number must independently agree.
const mokdongRows=[
 {aprpnHsmpCode:'20033344',aprpnHsmpNm:'목동2차우성(1단지)',mnnm:'337-2',roadNm:'목동남로4길 6-46',la:37.5064290557614,lo:126.865185120705},
 {aprpnHsmpCode:'3282',aprpnHsmpNm:'목동우성2',mnnm:'337',roadNm:'목동남로4길 6-23',la:37.5077984515394,lo:126.866529011129},
 {aprpnHsmpCode:'3283',aprpnHsmpNm:'목동우성3',mnnm:'338',roadNm:'목동남로4길 20',la:37.5083359369745,lo:126.865540870781}
];
function mokdongFixture({rows=mokdongRows,choice={}}={}){
 const b=new EventEmitter(),calls=[];
 b.evidenceSession=async()=>({});b.evidenceTool=async()=>({result:{structuredContent:{candidates:[{kapt_code:'A15800001',name:'목동우성2차',address:'서울시 양천구 신정동 337',address_road:'서울시 양천구 목동남로4길 6-23',...choice}]}}});
 const r={code:'11470',name:'양천구',province:{code:'11000',name:'서울특별시'}};
 const data={resolve:async()=>r,request:async(route,form)=>{
  calls.push({route,form});let value;
  if(route.includes('emdList'))value={emdList:[{code:'1147010100',codeNm:'신정동'}]};
  else if(route.includes('ptDanjiList')){const found=form.srhBldgNm?rows.filter(p=>p.aprpnHsmpNm.replace(/\s/g,'').includes(form.srhBldgNm)):rows;value={totCnt:found.length,danjiList:found};}
  else {assert.equal(form.srhAprpnHsmpCode,'3282');value={danjiList:[{prvuseAr:'84.96'},{prvuseAr:'113'},{prvuseAr:'113.91'}]};}
  return Buffer.from(JSON.stringify(value));
 }};
 return {service:new AnalysisService({bridge:b,data,onEvent:()=>{}}),calls};
}
test('좌표 없는 목동우성2차 후보는 같은 지번·도로명의 공식 목동우성2를 재확인한 뒤 타입 조회',async()=>{
 const f=mokdongFixture(),found=await f.service.searchTypes({target:'목동우성2차'});
 const mapped=await f.service.selectProperty({searchToken:found.searchToken,candidateId:found.candidates[0].id});
 assert.equal(mapped.kind,'candidates');assert.match(mapped.reason,/공식.*이름|명칭/);
 assert.deepEqual(mapped.candidates.map(c=>c.id),['rtms-3282']);
 assert.equal(f.calls.some(c=>c.route.includes('ptDtlArea')),false,'공식 후보 확인 전에는 면적을 조회하지 않음');
 const catalog=await f.service.selectProperty({searchToken:mapped.searchToken,candidateId:'rtms-3282'});
 assert.equal(catalog.building,'목동우성2');assert.equal(catalog.identity.lot,'337');assert.deepEqual(catalog.areas,[84.96,113,113.91]);
 f.service.validateTypeSelection({target:catalog.target,building:catalog.requestedBuilding,selectedAreas:[84.96],catalogToken:catalog.token});
});
test('차 접미사 별칭도 지번·부번·도로명·건물번호·좌표·차수가 다르면 연결하지 않음',async()=>{
 for(const choice of [{address:'서울시 양천구 신정동 337-2'},{address_road:'서울시 양천구 목동남로4길 6-2'},{lat:37.7,lng:126.9},{name:'목동우성11차'},{name:'목동우성3차'},{address_road:''}]){
  const f=mokdongFixture({choice}),found=await f.service.searchTypes({target:choice.name||'목동우성2차'});
  await assert.rejects(f.service.selectProperty({searchToken:found.searchToken,candidateId:found.candidates[0].id}),e=>e.code==='PROPERTY_IDENTITY_MISMATCH');
  assert.equal(f.calls.some(c=>c.route.includes('ptDtlArea')),false);
 }
});
test('지역 포함 별칭도 후보 검색으로 이어지고 주소 검색은 짧은 공식 코드를 보존',async()=>{
 const regional=mokdongFixture();
 const result=await regional.service.searchTypes({target:'서울 양천구 신정동 목동우성2차'});
 assert.equal(result.kind,'candidates');assert.equal(result.candidates[0].name,'목동우성2');assert.equal(result.candidates[0].id,'rtms-3282');
 for(const target of ['서울 양천구 신정동 337','서울 양천구 목동남로4길 6-23']){
  const f=mokdongFixture(),found=await f.service.searchTypes({target});
  assert.equal(found.kind,'candidates');assert.deepEqual(found.candidates.map(c=>c.id),['rtms-3282']);
 }
});

test('일반 단지의 접미사·차수 위치·제 표기·전각·블록 표기 차이는 공식 후보 확인으로 처리',async()=>{
 const cases=[
  ['하늘마을2차아파트','하늘마을2'],['한빛제2차','한빛2차'],['한빛2차아파트','2차한빛'],
  ['푸른마을3단지아파트','푸른3단지마을'],['그린워크1차아파트','더샵그린워크1차'],
  ['한빛２차（아파트）','한빛2'],['한빛 02 차','한빛2'],
  ['푸른 마을 3차 D17-1BL 아파트','도시푸른마을3차(17-1블럭)']
 ];
 for(const [query,name]of cases)for(const viaCandidate of [false,true]){
  const row={...mokdongRows[1],aprpnHsmpNm:name},f=mokdongFixture({rows:[row],choice:{name:query}});
  const found=await f.service.searchTypes({target:viaCandidate?query:'서울시 양천구 신정동 337 '+query});
  const confirmed=viaCandidate?await f.service.selectProperty({searchToken:found.searchToken,candidateId:found.candidates[0].id}):found;
  assert.equal(confirmed.kind,'candidates',query+' / '+name);assert.deepEqual(confirmed.candidates.map(c=>c.id),['rtms-3282']);
  assert.equal(f.calls.some(c=>c.route.includes('ptDtlArea')),false,'표기 차이는 공식 후보 확인 전 타입을 조회하지 않음');
  const catalog=await f.service.selectProperty({searchToken:confirmed.searchToken,candidateId:'rtms-3282'});
  assert.equal(catalog.identity.building,name);assert.deepEqual(catalog.areas,[84.96,113,113.91]);
 }
});

test('다른 단지·차수·블록은 이름 정리와 좌표 확인으로도 우회 연결하지 않음',async()=>{
 const {resolveProperty}=require('../src/property-identity.cjs');
 for(const [query,name]of [['한빛3차','한빛2'],['한빛2차','한빛11'],['한빛제2차','한빛3차'],['푸른마을3단지','푸른마을13단지'],['한빛2차','별개2'],['푸른마을3차 D17-1BL','푸른마을3차(18-1블럭)']]){
  const row={...mokdongRows[1],aprpnHsmpNm:name},f=mokdongFixture({rows:[row]});
  await assert.rejects(resolveProperty(f.service.data,normalizeInput({target:'서울 양천구 신정동 337 '+query})),e=>e.code==='PROPERTY_NOT_FOUND');
  if(query!=='한빛2차'||name!=='별개2')await assert.rejects(resolveProperty(f.service.data,normalizeInput({target:'서울 양천구 신정동 '+query}),undefined,{expected:{name:query,address:'서울 양천구 신정동 337',lat:row.la,lng:row.lo}}),e=>e.code==='PROPERTY_IDENTITY_MISMATCH');
 }
});

test('동일 이름·동일 주소의 공식 후보가 여럿이면 모두 확인하고 선택한 코드만 조회',async()=>{
 const rows=[{...mokdongRows[1],aprpnHsmpNm:'한빛2'},{...mokdongRows[1],aprpnHsmpCode:'9999',aprpnHsmpNm:'한빛2'}],f=mokdongFixture({rows});
 const found=await f.service.searchTypes({target:'서울 양천구 신정동 337 한빛2차'});
 assert.deepEqual(found.candidates.map(c=>c.id),['rtms-3282','rtms-9999']);
 assert.equal(f.calls.some(c=>c.route.includes('ptDtlArea')),false);
 const catalog=await f.service.selectProperty({searchToken:found.searchToken,candidateId:'rtms-3282'});assert.equal(catalog.identity.code,'3282');
});

test('전체 주소와 차 접미사 별칭을 함께 입력하면 외부 검색 없이 공식 확인 후보를 반환',async()=>{
 for(const target of ['서울시 양천구 신정동 337 목동우성2차','서울특별시 양천구 신정동 337 목동우성 2차 아파트','서울 양천구 목동남로4길 6-23 목동우성2차']){
  const f=mokdongFixture();
  f.service.bridge.evidenceSession=async()=>{throw Error('정확한 주소의 공식 후보를 외부 검색으로 우회했습니다.');};
  const found=await f.service.searchTypes({target});
  assert.equal(found.kind,'candidates');assert.deepEqual(found.candidates.map(c=>c.id),['rtms-3282']);
  assert.match(found.reason,/공식.*이름|명칭/);
  assert.equal(f.calls.some(c=>c.route.includes('ptDtlArea')),false);
  const catalog=await f.service.selectProperty({searchToken:found.searchToken,candidateId:'rtms-3282'});
  assert.equal(catalog.identity.code,'3282');assert.deepEqual(catalog.areas,[84.96,113,113.91]);
  f.service.validateTypeSelection({target:catalog.target,building:catalog.requestedBuilding,selectedAreas:[84.96],catalogToken:catalog.token});
 }
});

test('주소가 있는 검색은 네이버 저장 별칭 때문에 중간 후보를 한 번 더 선택하게 하지 않음',async()=>{
 const f=mokdongFixture();let cachedReads=0;
 f.service.naverStore={list:async()=>{cachedReads++;return [{complexNo:'8742',name:'목동우성2차',addressJibun:'서울시 양천구 신정동 337',addressRoad:'서울시 양천구 목동남로4길 6-23',checkedAt:new Date().toISOString(),sourceUrl:'https://fin.land.naver.com/complexes/8742'}];}};
 const found=await f.service.searchTypes({target:'서울시 양천구 신정동 337 목동우성2차'});
 assert.deepEqual(found.candidates.map(c=>c.id),['rtms-3282']);assert.equal(cachedReads,0);
 const catalog=await f.service.selectProperty({searchToken:found.searchToken,candidateId:'rtms-3282'});
 assert.deepEqual(catalog.areas,[84.96,113,113.91]);
});

test('주소가 있는 차 접미사 별칭도 다른 차수·부번·도로명 건물번호로 연결하지 않음',async()=>{
 const {resolveProperty}=require('../src/property-identity.cjs');
 for(const target of ['서울 양천구 신정동 337-2 목동우성2차','서울 양천구 신정동 337 목동우성3차','서울 양천구 신정동 337 목동우성11차','서울 양천구 목동남로4길 6-2 목동우성2차']){
  const f=mokdongFixture();
  await assert.rejects(resolveProperty(f.service.data,normalizeInput({target})),e=>e.code==='PROPERTY_NOT_FOUND');
  assert.equal(f.calls.some(c=>c.route.includes('ptDtlArea')),false);
 }
 assert.equal(require('../src/property-identity.cjs').compatibleName('목동우성2차','목동우성2'),false,'거래 필터에 쓰는 일반 이름 비교는 완화하지 않음');
});
