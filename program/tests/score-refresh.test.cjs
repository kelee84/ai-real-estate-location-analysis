'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{randomUUID}=require('node:crypto');
const {ReportStore}=require('../src/store.cjs'),{refreshScores}=require('../src/score-refresh.cjs'),core=require('../src/core.cjs'),scoring=require('../src/scoring.cjs');
async function fixture(){
 const date=core.todayKst(),input=core.normalizeInput({target:'서울특별시 서대문구 북아현동 두산',building:'두산',asset:'apartment',area:59.96,asOf:date,types:['trade'],offered:130000}),prices=core.aggregate(Array.from({length:16},(_,i)=>({id:'sale-'+i,date,kind:'trade',building:'두산',location:'서울특별시 서대문구 북아현동',lot:'1009',area:59.96,areaBasis:'전용면적',price:131937.5,built:1999})),input,[{deal:'trade',status:'success',source:'https://rt.molit.go.kr/pt/xls/xls.do',checkedAt:date}]);
 prices.buildingResolution={building:'두산',code:'469',regionCode:'11410',town:'북아현동',lot:'1009',lat:37.559159764742,lng:126.950145592526};const assessed=scoring.assessScores({scores:[]},{input,prices,dataCheckedAt:date});
 const original={id:randomUUID(),title:'원본',input,prices,scores:assessed.scores,assessment:assessed.assessment,sources:assessed.sources,dataCheckedAt:date,createdAt:new Date().toISOString(),map:{file:'ipjitalk-map.png'},sections:[{heading:'기존 본문',body:'보존할 내용'}]};
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'score-refresh-')),store=new ReportStore(root);await store.save(original);const dir=store.path(original.id);await fs.mkdir(path.join(dir,'raw'));await fs.mkdir(path.join(dir,'figures'));await fs.writeFile(path.join(dir,'raw/RTMS-trade.csv'),'original bytes');await fs.writeFile(path.join(dir,'raw/private-key.json'),'never copy');await fs.writeFile(path.join(dir,'figures/ipjitalk-map.png'),'original map');
 const service={store,bridge:{analyze(){throw Error('AI 호출 금지');}},active:null,onEvent(){}};
 const collect=async(_bridge,_input,_prices,options)=>{assert.equal(options.onlyScores,true);assert.equal(options.includeMap,false);assert.equal(options.raw[0].bytes,Buffer.from('original bytes').toString('base64'));return {tools:livingTools(input,prices),checks:[],issues:[]};};
 return {root,store,original,service,collect,cleanup:()=>fs.rm(root,{recursive:true,force:true})};
}
function livingTools(input,prices){
 const center={lat:prices.buildingResolution.lat,lng:prices.buildingResolution.lng},metadata={collected_at:new Date().toISOString()},living=require('../src/living-access.cjs');
 const labels={general:'의료,건강 > 병원 > 종합병원',pediatrics:'의료,건강 > 병원 > 소아청소년과',orthopedics:'의료,건강 > 병원 > 정형외과',dental:'의료,건강 > 병원 > 치과',entrance:'교육,학문 > 학원 > 입시학원',korean:'교육,학문 > 학원 > 국어학원',english:'교육,학문 > 학원 > 영어학원',math:'교육,학문 > 학원 > 수학학원',art:'교육,학문 > 학원 > 미술학원',music:'교육,학문 > 학원 > 음악학원',sports:'스포츠,레저 > 스포츠시설 > 태권도장'};
 const queries=[...living.QUERIES,...require('../src/shopping.cjs').QUERIES.map(query=>({query,radiusM:5000}))];
 const tools=queries.map((q,i)=>{const lat=center.lat+(q.key==='general'?1100:220)/111195,place={name:'고정검증시설 '+(q.label||q.query),kakao_place_id:String(10000+i),kakao_category_name:labels[q.key],lat,lng:center.lng,distance_m:Math.round(scoring.haversine(center,{lat,lng:center.lng}))};return {server:'ipzitalk',tool:'search_by_nearby_keyword',arguments:{query:q.query,center_lat:center.lat,center_lng:center.lng,radius_m:q.radiusM},result:{structuredContent:{center,radius_m:q.radiusM,results:q.key?[place]:[],metadata}}};});
 tools.push({server:'ipzitalk',tool:'search_by_nearby_category',arguments:{categories:['mart_large'],center_lat:center.lat,center_lng:center.lng,radius_m:1500},result:{structuredContent:{center,radius_m:1500,results:{mart_large:[]},metadata}}});return tools;
}
test('생활환경 보완은 AI 없이 원본·거래·지도·상담을 보존하고 새 6개 항목만 저장',async()=>{
 const f=await fixture();try{const before=await f.store.load(f.original.id),bytes=await fs.readFile(path.join(f.store.path(before.id),'report.json')),out=await refreshScores(f.service,before.id,{collect:f.collect});
  assert.notEqual(out.id,before.id);assert.equal(out.revisionOf,before.id);assert.equal(out.scoreRefresh.aiCalls,0);assert.deepEqual(out.prices,before.prices);assert.deepEqual(out.map,before.map);assert.deepEqual(out.consultation,before.consultation);assert.deepEqual(out.sections,before.sections);assert.equal(out.dataCheckedAt,before.dataCheckedAt);assert.deepEqual(out.scores.map(s=>s.name),core.SCORE_ITEMS);assert.equal(out.scores.find(s=>s.name==='병원 환경').score,85);assert.equal(out.scores.find(s=>s.name==='학원 환경').score,95);assert.equal(out.scores.find(s=>s.name==='병원 환경').coverage,100);assert.ok(!out.scores.some(s=>/상품|가격/.test(s.name)));assert.deepEqual(await fs.readFile(path.join(f.store.path(before.id),'report.json')),bytes);assert.equal(await fs.readFile(path.join(f.store.path(out.id),'figures/ipjitalk-map.png'),'utf8'),'original map');await assert.rejects(fs.access(path.join(f.store.path(out.id),'raw/private-key.json')));await fs.access(path.join(f.store.path(out.id),'raw/living-access.json'));assert.equal(f.service.active,null);
 }finally{await f.cleanup();}
});
test('조회 실패·취소는 미완료 복사본을 정리하고 기존 보고서를 보존',async()=>{
 for(const cancel of [false,true]){const f=await fixture();try{await assert.rejects(refreshScores(f.service,f.original.id,{collect:async()=>{if(cancel){f.service.active.controller.abort();return {tools:[]};}throw Error('조회 오류');}}),cancel?/중지/:/조회 오류/);assert.equal((await f.store.list()).length,1);assert.equal((await fs.readdir(f.root)).length,1);assert.equal(f.service.active,null);}finally{await f.cleanup();}}
});
test('진행 작업·과거 기준일·가상 보고서는 점수 보완 조회를 실행하지 않음',async()=>{
 const f=await fixture();let calls=0;try{const options={collect:async()=>{calls++;throw Error('not called');}};f.service.active={kind:'existing'};await assert.rejects(refreshScores(f.service,f.original.id,options),/진행 중/);f.service.active=null;await f.store.update(f.original.id,r=>({...r,input:{...r.input,asOf:'2000-01-01'}}));await assert.rejects(refreshScores(f.service,f.original.id,options),/과거 기준일/);await f.store.update(f.original.id,r=>({...r,demo:true}));await assert.rejects(refreshScores(f.service,f.original.id,options),/실제 아파트/);assert.equal(calls,0);assert.equal(f.service.active,null);}finally{await f.cleanup();}
});
test('새 조회 실패 때 같은 기준일의 유효 의료·학원 점수와 근거를 함께 보존',async()=>{
 const f=await fixture();try{const first=await refreshScores(f.service,f.original.id,{collect:f.collect}),second=await refreshScores(f.service,first.id,{collect:async()=>({tools:[],checks:[],issues:['일시 조회 실패']})});for(const name of ['병원 환경','학원 환경'])assert.deepEqual(second.scores.find(s=>s.name===name),first.scores.find(s=>s.name===name));assert.deepEqual(second.assessment.evidence.livingAccess,first.assessment.evidence.livingAccess);assert.match(second.scoreRefresh.results[0].preserved.find(p=>p.name==='livingAccess').lookupIssues[0],/일시 조회 실패/);}finally{await f.cleanup();}
});
test('이전 상품·가격 점수는 새 환경 점수로 이름만 바꾸지 않고 새 근거로 다시 산출',async()=>{
 const f=await fixture();try{await f.store.update(f.original.id,r=>({...r,scores:[{name:'상품 경쟁력',score:99},{name:'가격 경쟁력',score:98}],assessment:{...r.assessment,version:'2026-10-17-regional-park-rubric-v4',evidence:{...r.assessment.evidence,version:'2026-10-17-regional-park-rubric-v4'}}}));const updated=await refreshScores(f.service,f.original.id,{collect:f.collect});assert.deepEqual(updated.scores.map(s=>s.name),core.SCORE_ITEMS);assert.equal(updated.scores.find(s=>s.name==='병원 환경').score,85);assert.equal(updated.scoreRefresh.results[0].changedRubric,true);assert.equal((await f.store.load(f.original.id)).scores[0].name,'상품 경쟁력');}finally{await f.cleanup();}
});
test('3개 비교 단지는 각 원자료를 사용하고 중간 조회 실패 시 부분 보고서를 남기지 않음',async()=>{
 const f=await fixture();try{await f.store.update(f.original.id,r=>({...r,mode:'comparison',members:'ABC'.split('').map(key=>({...structuredClone(r),key}))}));for(const key of 'ABC')await fs.writeFile(path.join(f.store.path(f.original.id),'raw',key+'-RTMS-trade.csv'),'original bytes');const out=await refreshScores(f.service,f.original.id,{collect:f.collect});assert.equal(out.members.length,3);assert.ok(out.members.every(m=>m.scores.find(s=>s.name==='병원 환경').score===85));const beforeCount=(await fs.readdir(f.root)).length;let calls=0;await assert.rejects(refreshScores(f.service,f.original.id,{collect:async(...args)=>{if(++calls===2)throw Error('두번째 단지 실패');return f.collect(...args);}}),/두번째 단지 실패/);assert.equal((await fs.readdir(f.root)).length,beforeCount);assert.equal((await f.store.load(f.original.id)).members[0].scores.find(s=>s.name==='병원 환경').score,null);}finally{await f.cleanup();}
});
test('동시 재조회는 한 번만 수집하고 두번째 요청을 거절',async()=>{
 const f=await fixture();let release;try{const pending=refreshScores(f.service,f.original.id,{collect:async(...args)=>{await new Promise(r=>{release=r;});return f.collect(...args);}});for(let i=0;i<100&&!release;i++)await new Promise(r=>setTimeout(r,5));assert.ok(release);await assert.rejects(refreshScores(f.service,f.original.id,{collect:f.collect}),/진행 중/);release();await pending;assert.equal((await f.store.list()).length,2);}finally{await f.cleanup();}
});

test('동일 조건 캐시는 새 병원·학원·대형마트 조회 근거와 현재 평가 기준을 모두 요구',async()=>{
 const f=await fixture();try{
  const {AnalysisService}=require('../src/service.cjs'),date=f.original.input.asOf,tools=livingTools(f.original.input,f.original.prices),evidence=scoring.collectEvidence({input:f.original.input,prices:f.original.prices,tools});
  evidence.natureAccess={version:require('../src/nature-access.cjs').VERSION,asOf:date,center:evidence.center,checkedAt:new Date().toISOString(),status:'verified',trails:[{id:'reuse-test-trail',name:'검증용 등록 산책로',kind:'registered-trail',pointRole:'등록 시설 기준점',...evidence.center,distanceM:0,source:{id:'reuse-test-source',url:'https://place.map.kakao.com/1',checkedAt:date}}]};
  const map={file:'ipjitalk-map.png',version:require('../src/map-capture.cjs').VERSION,validation:require("./fixtures/map-proof.cjs").validation()};
  await f.store.update(f.original.id,r=>({...r,map,requestFingerprint:'same-request',assessment:{version:scoring.VERSION,evidence}}));
  const recent=()=>AnalysisService.prototype.recentReport.call({store:f.store},'same-request');
  assert.equal((await recent()).id,f.original.id);
  const originalNature=structuredClone(evidence.natureAccess);await f.store.update(f.original.id,r=>({...r,assessment:{...r.assessment,evidence:{...r.assessment.evidence,natureAccess:{...originalNature,trails:originalNature.trails.map(p=>({...p,distanceM:1000}))}}}}));assert.equal(await recent(),null);await f.store.update(f.original.id,r=>({...r,assessment:{version:scoring.VERSION,evidence}}));
  await f.store.update(f.original.id,r=>({...r,assessment:{...r.assessment,evidence:{...r.assessment.evidence,livingAccess:null}}}));assert.equal(await recent(),null);
  await f.store.update(f.original.id,r=>({...r,assessment:{version:'2026-10-17-regional-park-rubric-v4',evidence}}));assert.equal(await recent(),null);
  await f.store.update(f.original.id,r=>({...r,assessment:{version:scoring.VERSION,evidence:{...evidence,shopping:null}}}));assert.equal(await recent(),null);
 }finally{await f.cleanup();}
});
