'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
// Independent fixed CP949 character fixtures avoid adding a production dependency.
const eucChars={"㎡":"a7b3","개":"b0b3","거":"b0c5","건":"b0c7","결":"b0e1","경":"b0e6","계":"b0e8","공":"b0f8","광":"b1a4","교":"b1b3","구":"b1b8","군":"b1ba","금":"b1dd","나":"b3aa","년":"b3e2","단":"b4dc","답":"b4e4","대":"b4eb","도":"b5b5","동":"b5bf","두":"b5ce","래":"b7a1","료":"b7e1","만":"b8b8","면":"b8e9","명":"b8ed","발":"b9df","번":"b9f8","별":"bab0","비":"baf1","사":"bbe7","상":"bbf3","생":"bbfd","서":"bcad","성":"bcba","세":"bcbc","송":"bcdb","수":"bcf6","스":"bdba","시":"bdc3","식":"bdc4","실":"bdc7","아":"bec6","액":"bed7","약":"bee0","역":"bfaa","연":"bfac","옥":"bfc1","요":"bfe4","용":"bfeb","울":"bfef","원":"bff8","월":"bff9","유":"c0af","응":"c0c0","인":"c0ce","일":"c0cf","입":"c0d4","자":"c0da","적":"c0fb","전":"c0fc","제":"c1a6","조":"c1b6","주":"c1d6","중":"c1df","증":"c1f5","지":"c1f6","차":"c2f7","천":"c3b5","축":"c3e0","층":"c3fe","테":"c5d7","톡":"c5e5","트":"c6ae","특":"c6af","파":"c6c4","패":"c6d0","필":"c7ca","하":"c7cf","학":"c7d0","해":"c7d8","형":"c7fc","확":"c8ae","회":"c8b8"};
const iconv={encode:text=>Buffer.concat([...text].map(c=>{if(c.charCodeAt(0)<128)return Buffer.from(c);if(!eucChars[c])throw new Error('Missing fixed CP949 test character: '+c);return Buffer.from(eucChars[c],'hex');}))};
const {collectResearch,peerEvidence}=require('../src/research.cjs');
const {haversine}=require('../src/scoring.cjs');
const input={target:'인천 연수구 송도동 테스트대상아파트',building:'테스트대상아파트',asset:'apartment',types:['trade'],asOf:'2026-10-17',area:84,areaMode:'type',offered:null};
const center={lat:37.4,lng:126.64},identity={code:'20200001',building:input.building,town:'송도동',lot:'1-1',regionCode:'28185',lat:center.lat,lng:center.lng};
const metadata={collected_at:'2026-10-17T01:00:00Z'},basic={kaptCode:'Atarget01',approvalDate:'2014-08-29'};
function prices(){return {buildingResolution:{...identity},rows:[0,1,2].map(i=>({id:'target-'+i,kind:'trade',date:'2026-06-0'+(i+1),price:85000+i*100,area:84,areaBasis:'전용면적',location:'인천광역시 연수구 송도동',building:input.building,lot:'1-1'}))};}
function nearby(){return {query:{center:{...center}},metadata:{...metadata},results:[{name:'비교하나아파트',lat:37.401,lng:126.64,move_in:'2014-01-01',status:'occupied',identifiers:{kapt_code:'Apeer0001'}},{name:'비교두개아파트',lat:37.399,lng:126.64,move_in:'2016-01-01',status:'occupied',identifiers:{kapt_code:'Apeer0002'}}].map(c=>({...c,distance_m:Math.round(haversine(center,c))}))};}
function batch(){return {results:[1,2].map(i=>({status:'success',data:{kapt_code:'Apeer000'+i,name:i===1?'비교하나아파트':'비교두개아파트',metadata:{...metadata},basic:{address_jibun:'인천광역시 연수구 송도동 '+(i+1)+'-1',bjd_code:'2818510600',use_approval_date:i===1?'20140101':'20160101'}}}))};}
function records(){return [1,2].flatMap(i=>[1,2,3].map(j=>({NO:i*10+j,시군구:'인천광역시 연수구 송도동',번지:(i+1)+'-1',단지명:i===1?'비교하나아파트':'비교두개아파트','전용면적(㎡)':84,계약년월:'202606',계약일:j,'거래금액(만원)':81000+i*100+j*10,층:10+j,건축년도:2014,해제사유발생일:'-',거래유형:'중개거래'})));}
function raw(rows=records()){const header=Object.keys(records()[0]);return [{deal:'trade',bytes:iconv.encode([header.join(','),...rows.map(r=>header.map(k=>r[k]??'').join(','))].join('\r\n'),'euc-kr').toString('base64')}];}
function fixture(){return {input,prices:prices(),raw:raw(),nearby:nearby(),batch:batch(),basic,center};}
function adjacentFixture(){
 const f=fixture();for(let i=0;i<2;i++){const town=i?'송수동':'연수동';f.batch.results[i].data.basic.address_jibun=f.batch.results[i].data.basic.address_jibun.replace('송도동',town);f.batch.results[i].data.basic.bjd_code='2818510'+(i+1)+'00';}
 f.raw=raw(records().map(r=>({...r,시군구:r.NO<20?'인천광역시 연수구 연수동':'인천광역시 연수구 송수동'})));return f;
}
test('peer proof uses two distinct physical buildings and contract-level unit price arithmetic',()=>{
 const r=peerEvidence(fixture());assert.equal(r.status,'verified');assert.equal(r.peers.length,2);assert.equal(r.peerContracts,6);assert.equal(new Set(r.peers.flatMap(p=>p.contracts.map(c=>c.id))).size,6);const expectedTarget=(85000+85100+85200)/3/84,expectedPeer=records().reduce((s,r)=>s+r['거래금액(만원)']/84,0)/6;assert.ok(Math.abs(r.target.unitMean-expectedTarget)<1e-9);assert.ok(Math.abs(r.gapPercent-(expectedTarget/expectedPeer-1)*100)<1e-9);
});
test('duplicate physical peer aliases cannot turn one building into two or count contracts twice',()=>{
 const f=fixture();f.nearby.results[1]={...f.nearby.results[0],identifiers:{kapt_code:'Apeer0002'}};f.batch.results[1].data={...structuredClone(f.batch.results[0].data),kapt_code:'Apeer0002'};const r=peerEvidence(f);assert.equal(r.status,'unavailable');assert.equal(r.peers.length,1);assert.equal(new Set(r.peers.flatMap(p=>p.contracts.map(c=>c.id))).size,r.peers.reduce((s,p)=>s+p.n,0));
});
test('target physical property cannot re-enter its own peer set under a different K-apt code',()=>{
 const f=fixture(),source=records().map(r=>({...r,단지명:input.building,번지:'1-1'}));f.raw=raw(source);for(const x of f.batch.results){x.data.name=input.building;x.data.basic.address_jibun='인천광역시 연수구 송도동 1-1';}const r=peerEvidence(f);assert.equal(r.status,'unavailable');assert.equal(r.peers.length,0);
});
test('peer proof rejects future/stale metadata, invalid contract dates, wrong area, year, region and coordinates',()=>{
 const cases=[f=>f.nearby.metadata.collected_at='2099-01-01T00:00:00Z',f=>f.nearby.metadata.collected_at='2026-08-01T00:00:00Z',f=>{for(const x of f.batch.results)x.data.metadata.collected_at='2099-01-01T00:00:00Z';},f=>f.raw=raw(records().map(r=>({...r,계약년월:'202604',계약일:'32'}))),f=>f.raw=raw(records().map(r=>({...r,'전용면적(㎡)':59}))),f=>{for(const x of f.batch.results)x.data.basic.use_approval_date='19900101';},f=>f.raw=raw(records().map(r=>({...r,시군구:'서울특별시 성동구 옥수동'}))),f=>{for(const c of f.nearby.results){c.lat=37.9;c.distance_m=100;}},f=>{for(const c of f.nearby.results)c.distance_m=-1;}];
 for(const mutate of cases){const f=fixture();mutate(f);assert.equal(peerEvidence(f).status,'unavailable');}
});
test('insufficient target or peer samples do not fabricate premium proof',()=>{
 const f=fixture();f.prices.rows=f.prices.rows.slice(0,2);assert.equal(peerEvidence(f).status,'unavailable');const p=fixture();p.raw=raw(records().filter(r=>r.NO!==13));assert.equal(peerEvidence(p).status,'unavailable');const a=fixture();a.prices.areaResolution={mode:'nearest-type'};assert.equal(peerEvidence(a).status,'unavailable');
});
test('peer basic identity cannot borrow another region with the same town, lot and building names',()=>{
 const f=fixture();for(const r of f.batch.results){r.data.basic.bjd_code='1168010600';r.data.basic.address_jibun=r.data.basic.address_jibun.replace('인천광역시 연수구','서울특별시 강남구');}assert.equal(peerEvidence(f).status,'unavailable');
});

test('insufficient same-town peers expands only to registered same-district towns within actual 2km',()=>{
 const f=adjacentFixture(),r=peerEvidence(f);assert.equal(r.status,'verified');assert.equal(r.version,'2026-10-18-peer-district-nearby-v2');assert.equal(r.scope,'same-district-adjacent-towns-2km');assert.equal(r.expansion.sameTownPeerCount,0);assert.deepEqual(r.expansion.towns,['송수동','연수동']);assert.match(r.reason,/같은 법정동.*0곳.*같은 구/);assert.ok(r.peers.every(p=>p.regionCode==='28185'&&p.distanceM===111&&p.contracts.every(t=>t.areaBasis==='전용면적'&&t.location===p.location)));
});

test('two qualifying same-town buildings keep the original scope and exclude adjacent towns',()=>{
 const f=fixture(),adjacent=adjacentFixture();f.nearby.results.push({...adjacent.nearby.results[0],identifiers:{kapt_code:'Apeer0003'}});f.batch.results.push({...adjacent.batch.results[0],data:{...adjacent.batch.results[0].data,kapt_code:'Apeer0003'}});f.raw=raw([...records(),...records().filter(r=>r.NO<20).map(r=>({...r,시군구:'인천광역시 연수구 연수동'}))]);
 const r=peerEvidence(f);assert.equal(r.status,'verified');assert.equal(r.scope,'same-town-2km');assert.equal(r.version,'2026-10-17-peer-same-town-v1');assert.equal(r.expansion,undefined);assert.equal(r.peers.length,2);assert.ok(r.peers.every(p=>p.town==='송도동'));
});

test('adjacent-town expansion rejects another district, missing or mismatching address codes, false radius and duplicate contracts',()=>{
 for(const mutate of [f=>{for(const e of f.batch.results)e.data.basic.bjd_code='1141010100';},f=>{for(const e of f.batch.results)delete e.data.basic.bjd_code;},f=>{for(const e of f.batch.results)e.data.basic.address_jibun=e.data.basic.address_jibun.replace('연수구','중구');},f=>{for(const c of f.nearby.results){c.lat=37.43;c.distance_m=111;}},f=>{for(const c of f.nearby.results){c.lat=37.43;c.distance_m=Math.round(haversine(center,c));}},f=>{const r=records();f.raw=raw(r.filter(x=>x.NO!==13).flatMap(x=>[x,{...x,NO:x.NO+100}]).map(x=>({...x,시군구:x.NO%100<20?'인천광역시 연수구 연수동':'인천광역시 연수구 송수동'})));}]){const f=adjacentFixture();mutate(f);assert.equal(peerEvidence(f).status,'unavailable');}
});

test('verified transaction construction year can guide age filtering but never creates an approval date',()=>{
 const {aggregate}=require('../src/core.cjs'),f=adjacentFixture(),p=aggregate(f.prices.rows.map(t=>({...t,built:'2014'})),input,[{deal:'trade',status:'success',source:'https://rt.molit.go.kr/pt/xls/xls.do',checkedAt:metadata.collected_at}]);p.buildingResolution=f.prices.buildingResolution;f.prices=p;f.basic={kaptCode:basic.kaptCode,approvalDate:null};
 const r=peerEvidence(f);assert.equal(r.status,'verified');assert.equal(r.targetAge.kind,'transaction-building-year');assert.equal(r.targetAge.year,2014);assert.equal(r.targetAge.approvalDate,undefined);assert.match(r.targetAge.note,/정확한 사용승인일은 미확인/);
 for(const change of [x=>x.rows[0].built='2013',x=>x.rows[0].built='',x=>x.coverage=[],x=>x.coverage[0].checkedAt='2099-01-01']){const bad=structuredClone(f);change(bad.prices);assert.equal(peerEvidence(bad).status,'unavailable');}
});

test('collected same-town and expanded proofs both pass the independent price validator without mutating offers',()=>{
 const {aggregate,SCORE_ITEMS}=require('../src/core.cjs'),{applyPrice}=require('../src/price-scoring.cjs');
 for(const create of [fixture,adjacentFixture]){const f=create(),p=aggregate(f.prices.rows,input,[{deal:'trade',status:'success',source:'https://rt.molit.go.kr/pt/xls/xls.do',checkedAt:metadata.collected_at}]);p.buildingResolution=f.prices.buildingResolution;f.prices=p;f.checkedAt=metadata.collected_at;const peers=peerEvidence(f),e={sources:[],center,basic,peers},scores=[{name:'가격 경쟁력',score:null}],r=applyPrice(scores,e,{input,prices:p});assert.equal(r.row.score,65);assert.equal(r.priceBasis.comparison.version,peers.version);assert.equal(r.priceBasis.comparison.scope,peers.scope);assert.equal(input.offered,null);}
});

function evidenceBridge({failQuery,basicByAddress=false}={}){
 const calls=[];return {calls,evidenceSession:async()=>({threadId:'readonly-test'}),analyze(){throw new Error('AI must not choose evidence tools');},async evidenceTool(session,tool,args){
  calls.push({tool,args});if(failQuery&&args.query===failQuery)throw new Error('시설 연결 일시 실패');let data;
  if(tool==='get_complex_info_by_query')data=basicByAddress&&args.complex_query===input.building?null:{name:input.building,kapt_code:basic.kaptCode,basic:{address_jibun:'인천광역시 연수구 송도동 1-1',bjd_code:'2818510600',use_approval_date:'20140829'},metadata};
  else if(tool==='get_geocode')data={...center,confidence:'exact',region_code:'2818510600',region:{sido:'인천광역시',sigungu:'연수구',eupmyeondong:'송도동',jibun:'1-1'},metadata};
  else if(tool==='search_by_nearby_keyword')data={center,radius_m:args.radius_m,results:[],metadata};
  else if(tool==='search_by_nearby_category')data={center,radius_m:args.radius_m,results:Object.fromEntries(args.categories.map(c=>[c,[]])),metadata};
  else if(tool==='get_map_embed_url')data={embed_url:'https://ipji-talk.com/map?d=readonly-test',metadata};
  else throw new Error('Unexpected or obsolete lookup: '+tool);
  return {server:'ipzitalk',tool,arguments:args,result:{structuredContent:data}};
 }};
}
function mockExternal(t){
 for(const [moduleName,method]of [['school-zone','querySchoolZone'],['regional-park','queryRegionalPark'],['nature-access','query']])t.mock.method(require('../src/'+moduleName+'.cjs'),method,async()=>({status:'unavailable',reason:'고정 조회 범위의 테스트 자료'}));
}
test('score-only collection completes hospital academy and mart keywords while withholding unproved malls without product/map calls',async t=>{
 mockExternal(t);const bridge=evidenceBridge(),result=await collectResearch(bridge,input,prices(),{onlyScores:true});
 const shopping=require('../src/shopping.cjs'),expected=[...shopping.MART_QUERIES,...require('../src/living-access.cjs').QUERIES.map(q=>q.query)];
  const queried=bridge.calls.filter(c=>c.args.query).map(c=>c.args.query);assert.deepEqual(queried.sort(),expected.sort());assert.equal(new Set(queried).size,queried.length);assert.ok(!queried.some(q=>shopping.MALL_QUERIES.includes(q)));assert.equal(bridge.calls.length,19);assert.equal(result.metrics.maxCalls,null);assert.ok(!result.metrics.budgetLimited);
 assert.ok(bridge.calls.every(c=>['get_complex_info_by_query','get_geocode','search_by_nearby_keyword','search_by_nearby_category'].includes(c.tool)));
 assert.deepEqual(bridge.calls.filter(c=>c.tool==='search_by_nearby_category').map(c=>c.args.categories),[['mart_large','hospital'],['mart_large','hospital']]);
  assert.equal(result.issues.length,0);assert.equal(result.shopping.complete,false);assert.equal(result.shopping.collectionPolicy,shopping.COLLECTION_POLICY);assert.equal(result.shopping.largeMart.status,'empty');assert.equal(result.shopping.largeMart.complete,true);assert.equal(result.shopping.largeMart.points,20);assert.equal(result.shopping.shoppingMall.status,'unavailable');assert.equal(result.shopping.shoppingMall.points,null);assert.equal(result.shopping.shoppingMall.complete,false);assert.ok(result.livingAccess);assert.equal(result.product,undefined);assert.equal(result.peers,undefined);assert.equal(result.school,null);assert.equal(result.nature,null);
 assert.ok(result.tools.every(t=>t.server==='ipzitalk'));
});
test('a failed category is retained as a failed lookup, distinct from successful empty results',async t=>{
 mockExternal(t);const query=require('../src/living-access.cjs').QUERIES[0].query,bridge=evidenceBridge({failQuery:query}),result=await collectResearch(bridge,input,prices(),{onlyScores:true});
 assert.ok(result.tools.some(t=>t.arguments.query===query&&t.result.isError&&t.error.includes('일시 실패')));
 assert.ok(result.tools.some(t=>t.arguments.query!==query&&t.result.structuredContent?.results?.length===0));
 assert.ok(result.checks.some(c=>c.query===query&&c.status==='error'));assert.ok(result.issues.some(s=>s.includes('일시 실패')));assert.ok(result.livingAccess);
});
test('fresh analysis invokes concrete read-only evidence and produces a map, without obsolete K-apt details or price peer lookup',async t=>{
 mockExternal(t);const bridge=evidenceBridge(),result=await collectResearch(bridge,input,prices(),{});
 for(const tool of ['search_by_nearby_category','search_by_nearby_keyword','get_map_embed_url'])assert.ok(bridge.calls.some(c=>c.tool===tool),tool);
 assert.ok(!bridge.calls.some(c=>['get_complex_info_batch','find_complexes_near_point'].includes(c.tool)));assert.equal(result.school.reason,'고정 조회 범위의 테스트 자료');assert.equal(result.schoolAchievement,undefined);
});
test('missing direct evidence connection leaves a concrete diagnosis',async()=>{
 const r=await collectResearch({},input,prices());assert.match(r.issues[0],/자동 자료 조회/);const fail=await collectResearch({evidenceSession:async()=>{throw new Error('입지톡 인증 확인 필요');}},input,prices());assert.ok(fail.issues.some(i=>i.includes('인증 확인 필요')));
});
test('verified transaction center avoids unnecessary K-apt and geocoding calls',async t=>{
 mockExternal(t);const bridge=evidenceBridge({basicByAddress:true}),result=await collectResearch(bridge,input,prices(),{onlyScores:true});
 assert.deepEqual(bridge.calls.filter(c=>c.tool==='get_complex_info_by_query').map(c=>c.args.complex_query),[]);assert.ok(!bridge.calls.some(c=>c.tool==='get_geocode'));assert.ok(result.livingAccess);assert.ok(!bridge.calls.some(c=>c.tool==='get_complex_info_batch'));
});
test('saved living supplementation leaves source transactions intact and never refreshes a historical report',async t=>{
 mockExternal(t);const {ensureLivingEvidence}=require('../src/research.cjs'),p=prices(),before=structuredClone(p),previous={version:require('../src/scoring.cjs').VERSION,building:input.building,asOf:require('../src/core.cjs').todayKst(),identity:p.buildingResolution,center,places:[],sources:[],natureAccess:null};let calls=0;
 const collect=async()=>{calls++;return {tools:[],checks:[],issues:[]};},currentInput={...input,asOf:require('../src/core.cjs').todayKst()};
 const result=await ensureLivingEvidence({},currentInput,p,{previous,collect});assert.equal(result.refreshed,true);assert.deepEqual(p,before);assert.notEqual(result.evidence,previous);
 await ensureLivingEvidence({}, {...input,asOf:'2000-01-01'},p,{previous,collect});assert.equal(calls,1);
});
test('daily grocery scope distinguishes verified empty, failed and wrong-center results and preserves only same-day proof',()=>{
 const {dailyShoppingSnapshot,mergeLivingEvidence}=require('../src/research.cjs'),args={categories:['mart_large'],center_lat:center.lat,center_lng:center.lng,radius_m:1500};
 const ok={server:'ipzitalk',tool:'search_by_nearby_category',arguments:args,result:{structuredContent:{center,radius_m:1500,results:{mart_large:[]},metadata}}},options={center,asOf:input.asOf},empty=dailyShoppingSnapshot([ok],options);
 assert.equal(empty.status,'received');assert.equal(empty.returned,0);
 const failed=dailyShoppingSnapshot([{...ok,error:'일시 오류',result:{isError:true}}],options);assert.equal(failed.status,'unavailable');assert.equal(failed.returned,null);
 const wrong=structuredClone(ok);wrong.result.structuredContent.center={lat:35,lng:129};assert.equal(dailyShoppingSnapshot([wrong],options).status,'unavailable');
 const previous={version:require('../src/scoring.cjs').VERSION,asOf:input.asOf,center,places:[{id:'42',name:'검증용 슈퍼',category:'supermarket',distanceM:100}],sources:[],dailyShopping:{...empty,returned:1}};
 const keep=mergeLivingEvidence(previous,{center,places:[],sources:[],dailyShopping:failed});assert.equal(keep.places.length,1);assert.match(keep.dailyShopping.lookupReason,/재조회가 미완료/);
 const remove=mergeLivingEvidence(previous,{center,places:[],sources:[],dailyShopping:empty});assert.equal(remove.places.length,0);
 const stale=mergeLivingEvidence({...previous,dailyShopping:{...previous.dailyShopping,asOf:'2000-01-01'}},{center,places:[],sources:[],dailyShopping:failed});assert.equal(stale.places.length,0);
});

