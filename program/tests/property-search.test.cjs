'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events'),{AnalysisService}=require('../src/service.cjs'),search=require('../src/property-search.cjs');
const center={lat:37.4,lng:126.64},choices=[{kapt_code:'A10000001',name:'테스트아파트',address:'인천광역시 연수구 송도동 1 테스트아파트',address_road:'인천광역시 연수구 예시로 1',...center},{kapt_code:'A10000002',name:'테스트아파트',address:'서울특별시 송파구 잠실동 2',address_road:'서울특별시 송파구 예시로 2',lat:37.5,lng:127.1}];
function fixture(){let officialCalls=0,bridgeCalls=0;const b=new EventEmitter();b.evidenceSession=async()=>({});b.evidenceTool=async(_s,tool)=>{bridgeCalls++;return {result:tool==='get_complex_info_by_query'?{isError:true,content:[{type:'text',text:JSON.stringify({error:'AMBIGUOUS',candidates:choices})}]}:{structuredContent:{sigungu_code:'28185',full_code:'2818510600',...center}}};};
 const data={listProvinces:async()=>[{code:'2800000000',name:'인천광역시'}],listRegions:async()=>[{code:'28185',name:'연수구'}],request:async route=>{officialCalls++;return Buffer.from(JSON.stringify(route.includes('emdList')?{emdList:[{code:'2818510600',codeNm:'송도동'}]}:route.includes('ptDanjiList')?{totCnt:2,danjiList:[{aprpnHsmpCode:'rtms01',aprpnHsmpNm:'테스트아파트',mnnm:'1',la:center.lat,lo:center.lng},{aprpnHsmpCode:'rtms02',aprpnHsmpNm:'테스트아파트',mnnm:'2',la:center.lat+.02,lo:center.lng}]}:{danjiList:[{prvuseAr:59},{prvuseAr:84}]}));}};
 const service=new AnalysisService({bridge:b,data,onEvent:()=>{}});return {service,b,counts:()=>({officialCalls,bridgeCalls})};}
test('apartment-name-only lookup returns selectable candidates before querying any official types',async()=>{const f=fixture(),result=await f.service.searchTypes({target:'테스트아파트',asset:'apartment'});assert.equal(result.kind,'candidates');assert.equal(result.candidates.length,2);assert.equal(f.counts().officialCalls,0);assert.ok(result.candidates.every(p=>p.address&&p.road&&!Object.hasOwn(p,'lat')));});
test('selecting one ambiguous name resolves its official region and property before type lookup',async()=>{const f=fixture(),found=await f.service.searchTypes({target:'테스트아파트',asset:'apartment'}),selected=await f.service.selectProperty({searchToken:found.searchToken,candidateId:found.candidates[0].id});assert.deepEqual(selected.areas,[59,84]);assert.equal(selected.identity.code,'rtms01');assert.equal(selected.target,'인천광역시 연수구 송도동 테스트아파트');assert.equal(selected.asset,'apartment');f.service.validateTypeSelection({target:selected.target,asset:selected.asset,building:selected.requestedBuilding,selectedAreas:[84],catalogToken:selected.token});});
test('expired or altered candidate identifiers never issue a selection lookup',async()=>{const f=fixture(),found=await f.service.searchTypes({target:'테스트아파트',asset:'apartment'}),before=f.counts().bridgeCalls;await assert.rejects(()=>f.service.selectProperty({searchToken:found.searchToken,candidateId:'forged'}),/만료|후보/);f.service.propertySearches.get(found.searchToken).time-=31*60*1000;await assert.rejects(()=>f.service.selectProperty({searchToken:found.searchToken,candidateId:choices[0].kapt_code}),/만료/);assert.equal(f.counts().bridgeCalls,before);});
test('region and coordinate mismatches do not silently select another physical apartment',async()=>{const f=fixture();f.b.evidenceTool=async()=>({result:{structuredContent:{sigungu_code:'28185',full_code:'2818510600',lat:38,lng:127}}});await assert.rejects(()=>search.resolveChoice(f.b,{},choices[0]),/주소·지역/);assert.equal(search.hasRegion('베르디움더퍼스트'),false);assert.equal(search.hasRegion('인천광역시 연수구 송도동 베르디움'),true);assert.equal(search.candidates({candidates:[...choices,choices[0],{kapt_code:'fake',name:'예정아파트'}]}).length,2);});

function combinedFixture({missingNine=false,limited=false,multiRegion=false}={}){
 const calls=[],region={code:'28185',name:'연수구',province:{code:'2800000000',name:'인천광역시'}},b=new EventEmitter();
 b.evidenceSession=async()=>({});b.evidenceTool=async(_s,tool,args)=>{calls.push({tool,args});assert.equal(tool,'get_complex_info_by_query');return {result:{structuredContent:limited?{error:'DAILY_TOOL_LIMIT_EXCEEDED',message:'오늘 조회 한도'}:args.complex_query==='송도더샵엑스포'?{candidates:[{kapt_code:'A40673901',name:'송도더샵엑스포아파트',address:'인천광역시 연수구 송도동 15-2'},...(multiRegion?[{kapt_code:'A10000099',name:'다른지역 엑스포',address:'서울특별시 송파구 잠실동 1'}]:[])]}:{error:'NOT_FOUND',message:'찾지 못함'}}};};
 const data={resolve:async address=>address.startsWith('서울')?{code:'11710',name:'송파구',province:{name:'서울특별시'}}:region,request:async(route,form)=>{calls.push({route,form});let result;
  if(route.includes('emdList'))result={emdList:[{code:'2818510600',codeNm:'송도동'}]};
  else if(route.includes('ptDanjiList'))result={totCnt:missingNine?1:2,danjiList:[{aprpnHsmpCode:'20123846',aprpnHsmpNm:'더샵엑스포8단지',mnnm:'15-2'},...(!missingNine?[{aprpnHsmpCode:'20123847',aprpnHsmpNm:'더샵엑스포9단지',mnnm:'16-6'}]:[])]};
  else{assert.equal(form.srhAprpnHsmpCode,'20123847');result={danjiList:[84.9871,99.3121,170.7698].map(prvuseAr=>({prvuseAr}))};}
  return Buffer.from(JSON.stringify(result));}};
 return {service:new AnalysisService({bridge:b,data,onEvent:()=>{}}),calls};
}
test('통합 K-apt 명칭에서도 원래 9단지를 보존해 공식 9단지 주소·타입으로 연결',async()=>{
 for(const name of ['송도더샵엑스포9단지아파트','송도더샵엑스포9단지']){
  const f=combinedFixture(),found=await f.service.searchTypes({target:name,asset:'apartment'});
  assert.equal(found.candidates.length,1);assert.equal(found.candidates[0].name,'더샵엑스포9단지');assert.match(found.candidates[0].address,/16-6/);assert.doesNotMatch(found.candidates[0].address,/15-2/);
  assert.equal(f.calls.filter(x=>x.tool).length,2);assert.equal(f.calls.some(x=>x.route?.includes('ptDtlArea')),false);
  const selected=await f.service.selectProperty({searchToken:found.searchToken,candidateId:found.candidates[0].id});assert.equal(selected.identity.code,'20123847');assert.deepEqual(selected.areas,[84.9871,99.3121,170.7698]);
 }
});
test('공식 9단지가 없거나 여러 지역이면 통합 단지·8단지의 타입으로 대체하지 않음',async()=>{
 for(const options of [{missingNine:true},{multiRegion:true}]){const f=combinedFixture(options);await assert.rejects(f.service.searchTypes({target:'송도더샵엑스포9단지아파트'}),/일치하는 단지|여러 지역/);assert.equal(f.calls.some(x=>x.route?.includes('ptDtlArea')),false);}
});
test('조회 한도 오류에는 이름을 바꿔 재요청하지 않음',async()=>{const f=combinedFixture({limited:true});await assert.rejects(f.service.searchTypes({target:'송도더샵엑스포9단지아파트'}),/한도/);assert.equal(f.calls.length,1);});

function naverRecord(overrides={}){return {complexNo:'123456',name:'테스트아파트',addressJibun:'인천광역시 연수구 송도동 1 테스트아파트',addressRoad:'인천광역시 연수구 예시로 1',...center,coordinateBasis:'complex',checkedAt:new Date().toISOString(),sourceUrl:'https://fin.land.naver.com/complexes/123456',...overrides};}
function savedNaver(records){const reads=[];return {reads,list:async asOf=>{reads.push(asOf);return records;}};}
test('당일 네이버 저장 후보는 입지톡 세션·도구 요청 없이 반환하고 식별번호를 구분',async()=>{
 const f=fixture(),store=savedNaver([naverRecord()]);let sessions=0;f.b.evidenceSession=async()=>{sessions++;return {};};
 const found=await search.search(f.b,{target:'테스트아파트'},{client:f.service.data,naverStore:store});
 assert.equal(found.candidates.length,1);assert.equal(found.candidates[0].id,'naver-123456');assert.equal(found.candidates[0].naverComplexNo,'123456');assert.equal(found.candidates[0].officialCode,undefined);assert.equal(sessions,0);assert.equal(f.counts().bridgeCalls,0);assert.deepEqual(store.reads,[found.input.asOf]);assert.match(found.sourceName,/네이버/);assert.match(found.reason,/공식.*주소·면적/);
});
test('네이버 동명 단지는 후보를 유지하고 지역·차수가 다른 저장자료는 재사용하지 않음',async()=>{
 const records=[naverRecord(),naverRecord({complexNo:'654321',addressJibun:'서울특별시 송파구 잠실동 2',sourceUrl:'https://fin.land.naver.com/complexes/654321',lat:37.5,lng:127.1})],f=fixture();
 const found=await search.search(f.b,{target:'테스트아파트'},{naverStore:savedNaver(records)});assert.equal(found.candidates.length,2);assert.equal(f.counts().bridgeCalls,0);
 const region=await search.search(f.b,{target:'서울 송파구 잠실동 테스트아파트'},{naverStore:savedNaver(records)});assert.deepEqual(region.candidates.map(p=>p.naverComplexNo),['654321']);assert.equal(f.counts().bridgeCalls,0);
 const phase=await search.search(f.b,{target:'테스트9단지아파트'},{naverStore:savedNaver([naverRecord({name:'테스트8단지아파트'})])});assert.match(phase.sourceName,/입지톡/);assert.equal(f.counts().bridgeCalls,1);
});
test('오래된 네이버 자료와 명시적 새 조회는 기존 입지톡 검색을 이용',async()=>{
 const {todayKst}=require('../src/core.cjs'),oldDay=todayKst(new Date(Date.now()-86400000)),f=fixture(),old=savedNaver([naverRecord({checkedAt:oldDay+'T01:00:00+09:00'})]);
 const found=await search.search(f.b,{target:'테스트아파트'},{naverStore:old});assert.match(found.sourceName,/입지톡/);assert.equal(f.counts().bridgeCalls,1);
 for(const [raw,options]of [[{target:'테스트아파트'},{forceRefresh:true}],[{target:'테스트아파트',forceRefresh:true},{}]]){const fresh=savedNaver([naverRecord()]);await search.search(f.b,raw,{naverStore:fresh,...options});assert.equal(fresh.reads.length,0);}
 assert.equal(f.counts().bridgeCalls,3);
 const historical=savedNaver([naverRecord()]);await search.search(f.b,{target:'테스트아파트',asOf:oldDay},{naverStore:historical});assert.equal(historical.reads.length,0);assert.equal(f.counts().bridgeCalls,4);
});
test('네이버 후보 선택은 입지톡 없이 공식 지역·단지·타입을 대조하며 네이버 번호를 공식 코드로 쓰지 않음',async()=>{
 const f=fixture(),region={code:'28185',name:'연수구',province:{code:'2800000000',name:'인천광역시'}},resolved=[];
 f.service.data.resolve=async(address,signal)=>{resolved.push({address,signal});return region;};f.b.evidenceSession=async()=>{throw Error('네이버 후보에 입지톡 세션을 만들면 안 됩니다.');};
 const found=await search.search(f.b,{target:'테스트아파트'},{naverStore:savedNaver([naverRecord()])}),choice=found.candidates[0],controller=new AbortController(),selected=await search.resolveChoice(f.b,f.service.data,choice,{signal:controller.signal});
 assert.deepEqual(resolved,[{address:choice.address,signal:controller.signal}]);assert.equal(selected.target,'인천광역시 연수구 송도동 테스트아파트');assert.deepEqual(selected.expected,choice);assert.equal(selected.expected.officialCode,undefined);
 const catalog=await require('../src/type-catalog.cjs').discoverTypes(f.service.data,{...found.input,target:selected.target,building:selected.building},undefined,{region:selected.region,expected:selected.expected});
 assert.equal(catalog.identity.code,'rtms01');assert.notEqual(catalog.identity.code,choice.naverComplexNo);assert.equal(catalog.identity.source,'https://rt.molit.go.kr/pt/gis/gis.do');assert.deepEqual(catalog.areas,[59,84]);assert.ok(f.counts().officialCalls>=3);assert.equal(f.counts().bridgeCalls,0);
 for(const altered of [{...choice,id:choice.naverComplexNo},{...choice,officialCode:choice.naverComplexNo}])await assert.rejects(()=>search.resolveChoice(f.b,f.service.data,altered),/식별값·주소/);
});
test('네이버 주소·좌표와 공식 단지가 다르면 저장 번호로 타입 조회를 우회하지 않음',async()=>{
 const f=fixture(),region={code:'28185',name:'연수구',province:{code:'2800000000',name:'인천광역시'}};f.service.data.resolve=async()=>region;
 const found=await search.search(f.b,{target:'테스트아파트'},{naverStore:savedNaver([naverRecord({addressJibun:'인천광역시 연수구 송도동 99',lat:37.7})])}),selected=await search.resolveChoice(f.b,f.service.data,found.candidates[0]);
 await assert.rejects(()=>require('../src/type-catalog.cjs').discoverTypes(f.service.data,{...found.input,target:selected.target,building:selected.building},undefined,{region:selected.region,expected:selected.expected}),/공식 단지 목록.*일치/);assert.equal(f.counts().bridgeCalls,0);
});

test('완전 지번 K-apt 후보는 공식 지역 해석으로 추가 입지톡1회를 절감하고 단지·타입 검증을 유지',async()=>{
 const f=fixture(),region={code:'28185',name:'연수구',province:{code:'2800000000',name:'인천광역시'}},calls=[];
 f.service.data.resolve=async(address,signal)=>{calls.push({address,signal});return region;};
 const found=await f.service.searchTypes({target:'테스트아파트',asset:'apartment'});assert.equal(f.counts().bridgeCalls,1);
 const selected=await f.service.selectProperty({searchToken:found.searchToken,candidateId:found.candidates[0].id});
 assert.deepEqual(calls.map(c=>c.address),[choices[0].address]);assert.equal(f.counts().bridgeCalls,1);assert.equal(selected.identity.code,'rtms01');assert.notEqual(selected.identity.code,choices[0].kapt_code);assert.deepEqual(selected.areas,[59,84]);assert.equal(selected.identity.town,'송도동');assert.equal(selected.identity.lot,'1');
});
test('지번 후보의 공식 지역 코드·시도·구 불일치는 입지톡으로 우회하지 않고 중단',async()=>{
 const choice=search.candidates({candidates:[choices[0]]})[0],bridge={async evidenceSession(){throw Error('공식 주소 오류를 MCP로 우회하면 안 됩니다.');}};
 for(const region of [{code:'2818',name:'연수구',province:{name:'인천광역시'}},{code:'28185',name:'송파구',province:{name:'인천광역시'}},{code:'28185',name:'연수구',province:{name:'서울특별시'}},{code:'28185',name:'연수구'}])await assert.rejects(()=>search.resolveChoice(bridge,{resolve:async()=>region},choice),/주소·지역/);
});
test('도로명·부분 주소·읍리 계층 주소는 기존 입지톡 지역 확인을 유지',async()=>{
 for(const address of ['인천광역시 연수구 예시로 1','송도동 1','인천광역시 송도동 1','강원특별자치도 정선군 북평면 나전리 1','인천광역시 연수구 예시로 1 101동 1']){
  assert.equal(search.completeLotAddress(address),null);const f=fixture();f.service.data.resolve=async()=>{throw Error('불완전 지번주소를 공식지역 바로해석에 쓰면 안 됩니다.');};
  const selected=await search.resolveChoice(f.b,f.service.data,{name:'테스트아파트',address,road:'인천광역시 연수구 예시로 1',...center});assert.equal(f.counts().bridgeCalls,1);assert.equal(selected.region.code,'28185');
 }
});
test('MCP를 생략해도 다른 공식 지번·좌표·차수 단지의 타입으로 연결하지 않음',async()=>{
 for(const change of [{address:'인천광역시 연수구 송도동 99'},{lat:37.7},{name:'테스트9단지아파트'}]){
  const f=fixture(),region={code:'28185',name:'연수구',province:{code:'2800000000',name:'인천광역시'}};f.service.data.resolve=async()=>region;
  if(change.name){const request=f.service.data.request;f.service.data.request=async(route,args,signal)=>{const bytes=await request(route,args,signal);if(!route.includes('ptDanjiList'))return bytes;const value=JSON.parse(bytes);value.danjiList=value.danjiList.map(p=>({...p,aprpnHsmpNm:'테스트8단지아파트'}));return Buffer.from(JSON.stringify(value));};}
  const choice={...search.candidates({candidates:[choices[0]]})[0],...change},selected=await search.resolveChoice(f.b,f.service.data,choice);
  await assert.rejects(()=>require('../src/type-catalog.cjs').discoverTypes(f.service.data,{target:selected.target,asset:'apartment',building:selected.building},undefined,{region:selected.region,expected:selected.expected}),/공식 단지 목록.*일치/);assert.equal(f.counts().bridgeCalls,0);
 }
});
test('지번이 달라도 도로명이 같은 공식 후보는 자동 연결하지 않고 확인 후보로 반환',async()=>{
 const f=fixture(),region={code:'28185',name:'연수구',province:{code:'2800000000',name:'인천광역시'}};f.service.data.resolve=async()=>region;
 const request=f.service.data.request;f.service.data.request=async(route,args,signal)=>{if(route.includes('ptDanjiList'))return Buffer.from(JSON.stringify({totCnt:1,danjiList:[{aprpnHsmpCode:'20100001',aprpnHsmpNm:'테스트아파트',mnnm:'99',roadNm:'예시로 1',la:center.lat,lo:center.lng}]}));return request(route,args,signal);};
 const found=await f.service.searchTypes({target:'테스트아파트'}),selected=await f.service.selectProperty({searchToken:found.searchToken,candidateId:found.candidates[0].id});
 assert.equal(selected.kind,'candidates');assert.match(selected.reason,/지번·단지 구분/);assert.equal(selected.candidates[0].id,'rtms-20100001');assert.equal(f.counts().bridgeCalls,1);
});
