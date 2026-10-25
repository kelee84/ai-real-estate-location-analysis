'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),{EventEmitter}=require('node:events');
const {requestedName,compatibleName,resolveProperty}=require('../src/property-identity.cjs');
const {discoverTypes}=require('../src/type-catalog.cjs'),{normalizeInput}=require('../src/core.cjs');
function client(properties,{emptyKeyword=false,repeatPage=false}={}){
  const calls=[];return {calls,resolve:async()=>({code:'28185'}),request:async(route,form)=>{
    calls.push({route,form});let data;
    if(route.includes('emdList'))data={emdList:[{code:'2818510600',codeNm:'송도동'}]};
    else if(route.includes('ptDanjiList'))data={totCnt:repeatPage?properties.length+1:emptyKeyword&&form.srhBldgNm?0:properties.length,recordCnt:1,danjiList:emptyKeyword&&form.srhBldgNm?[]:properties};
    else if(route.includes('ptDtlArea'))data={danjiList:[{prvuseAr:59.9201},{prvuseAr:84.8682}]};
    else throw Error(route);return Buffer.from(JSON.stringify(data));
  }};
}
const first={aprpnHsmpCode:'1',aprpnHsmpNm:'더샵그린워크1차',mnnm:'18-6'},second={aprpnHsmpCode:'2',aprpnHsmpNm:'더샵그린워크2차',mnnm:'17-3'};
test('주소 다음의 단지명 전체와 띄어쓰기를 보존하고 도로명·번지만으로 건물을 추정하지 않음',()=>{
  assert.equal(requestedName({target:'인천 연수구 송도동 더샵 그린워크 1차'}),'더샵 그린워크 1차');
  assert.equal(requestedName({target:'인천 연수구 그린워크1차'}),'그린워크1차');
  assert.equal(requestedName({target:'인천 연수구 송도동 18-6'}),'');
  assert.equal(requestedName({target:'인천 연수구 아트센터대로97번길 30'}),'');
});
test('별칭은 지역·브랜드 접두어 차이를 연결하되 다른 차수·추가 숫자·단지로 확장하지 않음',()=>{
  assert.ok(compatibleName('그린워크1차','더샵그린워크1차'));
  assert.ok(compatibleName('송도더샵그린워크1차','더샵그린워크1차'));
  for(const name of ['더샵그린워크2차','더샵그린워크11차','그린워크1차다른단지'])assert.ok(!compatibleName('그린워크1차',name));
  assert.ok(!compatibleName('리센츠','리센츠2'));
  assert.ok(!compatibleName('그린워크3차(17-1블럭)','송도더샵그린워크3차(18-1블럭)'));
});
test('사용자가 입력한 그린워크1차를 공식 단지명·주소와 연결해 타입 목록 조회',async()=>{
  const c=client([first,second]),r=await discoverTypes(c,{target:'인천 연수구 송도동 그린워크1차',building:'그린워크1차'});
  assert.equal(r.building,'더샵그린워크1차');assert.equal(r.requestedBuilding,'그린워크1차');assert.equal(r.identity.code,'1');assert.deepEqual(r.areas,[59.9201,84.8682]);
  assert.equal(c.calls.filter(x=>x.route.includes('ptDanjiList')).length,1,'recordCnt를 페이지 크기로 오인해 중복 조회하지 않음');
});
test('공식 명칭의 공백·접두어로 키워드 결과가 없으면 해당 동 목록에서 재확인',async()=>{
  const c=client([first],{emptyKeyword:true}),r=await resolveProperty(c,normalizeInput({target:'인천 연수구 송도동 송도더샵그린워크1차'}));
  assert.equal(r.identity.building,first.aprpnHsmpNm);assert.ok(c.calls.some(x=>x.form.srhBldgNm===''));
});
test('차수는 같아도 블록이 여러 곳이면 후보를 표시하고 부분 목록은 거부',async()=>{
  const c=client([{...first,aprpnHsmpNm:'송도더샵그린워크3차(17-1블럭)'},{...second,aprpnHsmpNm:'송도더샵그린워크3차(18-1블럭)'}]);
  await assert.rejects(resolveProperty(c,normalizeInput({target:'인천 연수구 송도동 그린워크3차'})),/여러 곳.*17-1블럭.*18-1블럭/);
  await assert.rejects(resolveProperty(client([first],{repeatPage:true}),normalizeInput({target:'인천 연수구 송도동 그린워크1차'})),/끝까지/);
});
async function serviceFixture(fn){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'property-resolution-')),bridge=new EventEmitter(),{AnalysisService}=require('../src/service.cjs'),{ReportStore}=require('../src/store.cjs'),{SCORE_ITEMS}=require('../src/core.cjs');let calls=0;const inputs=[];
  bridge.analyze=async()=>{calls++;return {text:JSON.stringify({title:'단지 분석',conclusion:'검증된 거래 표본을 확인하세요.',highlights:['조건을 확인하세요.'],strengths:[],limitations:[],checks:['현장 확인'],sections:[{heading:'선택 기준',body:'예산을 확인하세요.'}],sources:[],scores:SCORE_ITEMS.map(name=>({name,score:null,reason:'근거 부족',method:'',sourceIds:[]}))}),tools:[],threadId:'test'};};
  const identity={requested:'그린워크1차',building:first.aprpnHsmpNm,code:'1',town:'송도동',lot:'18-6'},data={collect:async input=>{inputs.push(input.building);return {identity,rows:[{id:'t1',date:'2026-06-01',building:first.aprpnHsmpNm,location:'인천광역시 연수구 송도동',lot:'18-6',kind:'trade',price:68000,area:59.9201,areaBasis:'전용면적'}],coverage:[],raw:[]};}};
  const store=new ReportStore(path.join(root,'reports')),s=new AnalysisService({bridge,data,store,userData:root,onEvent:()=>{}});s.status=async()=>({loggedIn:true,mapConnected:false,models:[{id:'gpt-6-luna',efforts:['low']}]});s.gate=async()=>({required:false});
  try{await fn({s,data,identity,store,inputs,get calls(){return calls;}});}finally{assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep));await fs.rm(root,{recursive:true,force:true});}
}
const request={target:'인천 연수구 송도동 그린워크1차',building:'그린워크1차',area:59,asOf:'2026-10-16',types:['trade']};
test('different phase or block in the target and hidden building is rejected before any official query',async()=>{
 const c=client([first,second]);
 await assert.rejects(discoverTypes(c,{...request,target:'인천 연수구 송도동 그린워크3차'}),/서로 다른 차수/);assert.equal(c.calls.length,0);
 const {assertPropertyInput}=require('../src/property-identity.cjs');
 assert.throws(()=>assertPropertyInput({target:'송도더샵그린워크3차(17-1블럭)',building:'더샵그린워크3차(18-1블록)'}),/서로 다른 차수/);
 assert.doesNotThrow(()=>assertPropertyInput({target:'인천 연수구 송도동 18-6',building:'더샵그린워크1차'}));
 assert.doesNotThrow(()=>assertPropertyInput({target:'송도더샵그린워크3차(17-1블럭)',building:'더샵그린워크3차(17-1블록)'}));
});
test('일반 분석은 공식 이름으로 거래·보고서·검증 기록을 연결',()=>serviceFixture(async f=>{
  const r=await f.s.run(request);assert.equal(r.input.building,first.aprpnHsmpNm);assert.equal(r.prices.summaries[0].price,68000);assert.equal(r.verification.numericCheck.passed,true);
  const check=require('../src/evidence-guard.cjs').assertVerifiedPrices,changed=structuredClone(r.prices);changed.rows[0].lot='17-3';assert.throws(()=>check(changed,r.input),/대조/);
}));
test('stale phase is rejected in direct and comparison analysis before account or data access',()=>serviceFixture(async f=>{
 const wrong={...request,target:'인천 연수구 송도동 그린워크3차'};let account=0;f.s.status=async()=>{account++;throw Error('must not query account');};
 await assert.rejects(f.s.searchTypes(wrong),/서로 다른 차수/);
 await assert.rejects(f.s.run(wrong),/서로 다른 차수/);
 await assert.rejects(f.s.run({mode:'comparison',properties:[wrong,request],asOf:request.asOf,types:request.types}),/서로 다른 차수/);
 assert.equal(account,0);assert.equal(f.calls,0);assert.equal(f.inputs.length,0);
}));
test('별칭으로 검색한 타입을 선택해도 공식 이름과 조회 조건을 유지',()=>serviceFixture(async f=>{
  f.s.typeCatalogs=new Map([['token',{target:request.target,asset:'apartment',building:first.aprpnHsmpNm,requestedBuilding:request.building,identity:f.identity,areas:[59.9201],time:Date.now()}]]);
  const r=await f.s.run({...request,selectedAreas:[59.9201],catalogToken:'token'});assert.equal(r.reports[0].prices.rows.length,1);assert.equal(f.inputs[0],first.aprpnHsmpNm);
  await assert.rejects(f.s.run({...request,building:'다른단지',selectedAreas:[59.9201],catalogToken:'token'}),/다시 검색/);
}));
test('단지를 찾지 못했거나 공식 조회가 실패하면 AI와 빈 보고서 생성을 중단',()=>serviceFixture(async f=>{
  for(const data of [{rows:[],raw:[],coverage:[],propertyError:'단지 후보가 여러 곳입니다.'},{rows:[],raw:[],coverage:[{status:'error',message:'자료 연결 실패'}]}]){
    f.data.collect=async()=>data;await assert.rejects(f.s.run(request,{force:true}),/여러 곳|자료 연결 실패/);
  }
  assert.equal(f.calls,0);assert.equal((await f.store.list()).length,0);assert.equal(f.s.active,null);
}));
test('공식 주소·단지명·조회 타입은 유지하고 근거 없는 거리·가격 주장은 차단',()=>{
  const {guardNarrative,verifiedIdentifiers}=require('../src/evidence-guard.cjs'),input=normalizeInput(request),prices={buildingResolution:{building:first.aprpnHsmpNm,requested:'그린워크1차',town:'송도동',lot:'18-6',road:'아트센터대로97번길 30'},effectiveArea:{areaMode:'type',area:59}};
  const source={id:'s',url:'https://rt.molit.go.kr/'},text='송도동 18-6(아트센터대로97번길 30) 더샵그린워크1차의 59타입 거래가 확인됩니다.';
  const checked=guardNarrative({conclusion:text,highlights:['역까지 300m입니다.','정확한 조건을 확인하세요.'],sources:[source]},{identifiers:verifiedIdentifiers(input,prices)});
  assert.equal(checked.report.conclusion,text);assert.ok(!checked.report.highlights.join('').includes('300m'));assert.equal(checked.rejected.length,1);
});
