'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{randomUUID}=require('node:crypto');
const {SCORE_ITEMS,normalizeInput,aggregate,validateReport}=require('../src/core.cjs'),{reportSchema}=require('../src/schema.cjs'),scoring=require('../src/scoring.cjs'),{ReportStore}=require('../src/store.cjs');
const SIX=['교통 환경','교육 환경','상권 환경','자연환경','병원 환경','학원 환경'],LEGACY=['교통 환경','교육 환경','상권 환경','자연환경','상품 경쟁력','가격 경쟁력','프리미엄 경쟁력'];
function oldReport(overrides={}){
 const input=normalizeInput({target:'인천 연수구 송도동 가상단지',building:'가상단지',asset:'apartment',area:84,offered:150000,types:['trade'],asOf:'2026-10-17'}),prices=aggregate([{id:'saved-contract',date:'2026-10-01',kind:'trade',building:'가상단지',location:'인천 연수구 송도동',area:84.8,areaBasis:'전용면적',price:150000}],input);
 return {id:randomUUID(),title:'기존 7개 평가 보고서',conclusion:'보관된 분석 결론',input,prices,scores:LEGACY.map((name,i)=>({name,score:70+i,status:'partial',coverage:40,scope:'보관된 확인 범위',observed:name+' 보관 근거',needed:'보관된 추가 조건',reason:'보관된 판단',method:'당시 공통 기준',sourceIds:['saved-source']})).reverse(),sources:[{id:'saved-source',title:'원래 출처',url:'https://rt.molit.go.kr/pt/xls/xls.do',checkedAt:'2026-10-17'}],assessment:{version:scoring.VERSION,summary:'부분 평가 7개 · 추가 자료 필요 0개.'},sections:[{heading:'당시 분석',body:'보관 본문'}],verification:{numericCheck:{passed:true,contracts:1}},createdAt:'2026-10-17T00:00:00Z',dataCheckedAt:'2026-10-17T00:00:00Z',status:'검토 필요',...overrides};
}
test('현재 기준과 AI 응답 스키마는 병원·학원을 포함한 6개 생활환경 평가만 허용',()=>{
 assert.deepEqual(SCORE_ITEMS,SIX);assert.deepEqual(reportSchema.properties.scores.items.properties.name.enum,SIX);assert.equal(reportSchema.properties.scores.minItems,6);assert.equal(reportSchema.properties.scores.maxItems,6);
 const validated=validateReport(oldReport()).report;assert.deepEqual(validated.scores.map(s=>s.name),SIX);assert.equal(validated.scores[4].score,null);assert.equal(validated.scores[5].score,null);
});
test('최신 평가버전의 기존 7행도 6행으로 투영하며 값·가격·원래 JSON은 보존',()=>{
 const original=oldReport(),before=JSON.stringify(original),prepared=scoring.prepareReport(original);assert.deepEqual(prepared.scores.map(s=>s.name),SIX);assert.equal(prepared.scores.length,6);assert.equal(prepared.scores[4].score,null);assert.equal(prepared.scores[5].score,null);assert.deepEqual(prepared.prices,original.prices);assert.deepEqual(prepared.sources,original.sources);assert.equal(prepared.dataCheckedAt,original.dataCheckedAt);assert.equal(JSON.stringify(original),before);assert.match(prepared.assessment.summary,/부분 평가 4개/);assert.match(prepared.assessment.summary,/(?:추가 자료 필요|자료 미충족) 2개/);
});
test('구버전·사용 예시·비아파트의 보관 7행도 프리미엄 없이 6행으로 표시',()=>{
 for(const overrides of [{assessment:{version:'2026-10-16-evidence-rubric-v1'}},{demo:true},{input:{...oldReport().input,asset:'officetel'}}]){
  const original=oldReport(overrides),before=JSON.stringify(original),prepared=scoring.prepareReport(original);assert.deepEqual(prepared.scores.map(s=>s.name),SIX);assert.deepEqual(prepared.prices,original.prices);assert.equal(JSON.stringify(original),before);
 }
});
test('기존 3개 비교 보고서는 최상위와 각 매물 모두 6행이며 거래 자료·키·기준일 유지',()=>{
 const members=['A','B','C'].map(key=>({...oldReport(),key})),original=oldReport({mode:'comparison',members}),before=JSON.stringify(original),prepared=scoring.prepareReport(original);assert.deepEqual(prepared.scores.map(s=>s.name),SIX);assert.deepEqual(prepared.members.map(m=>m.key),['A','B','C']);for(let i=0;i<3;i++){assert.deepEqual(prepared.members[i].scores.map(s=>s.name),SIX);assert.deepEqual(prepared.members[i].prices,original.members[i].prices);assert.equal(prepared.members[i].input.asOf,original.members[i].input.asOf);assert.equal(prepared.members[i].dataCheckedAt,original.members[i].dataCheckedAt);}assert.equal(JSON.stringify(original),before);
});
test('기존 프리미엄·알 수 없는 행은 6개 기준 요약의 개수에 포함하지 않음',()=>{
 const all=LEGACY.map(name=>({name,score:80}));assert.match(scoring.summary(all),/부분 평가 4개/);assert.match(scoring.summary(all),/(?:추가 자료 필요|자료 미충족) 2개/);const one=SIX.map((name,i)=>({name,score:i===0?80:null}));one.push({name:'프리미엄 경쟁력',score:90},{name:'이전 사용자 정의',score:90});assert.match(scoring.summary(one),/부분 평가 1개/);assert.match(scoring.summary(one),/(?:추가 자료 필요|자료 미충족) 5개/);assert.doesNotMatch(scoring.summary(all),/(?:필요|미충족) -/);
});
test('표시용 변환과 별도 저장 후에도 기존 report.json·원자료 파일은 바이트 그대로 보관',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'six-items-')),store=new ReportStore(root),original=oldReport();try{await store.save(original);const raw=path.join(store.path(original.id),'raw');await fs.mkdir(raw);const bytes=Buffer.from('기존 CSV 원자료\r\n가격,면적\r\n150000,84.8\r\n','utf8');await fs.writeFile(path.join(raw,'RTMS-trade.csv'),bytes);const reportBytes=await fs.readFile(path.join(store.path(original.id),'report.json')),prepared=scoring.prepareReport(await store.load(original.id));await store.save({...prepared,id:randomUUID(),revisionOf:original.id});assert.equal(prepared.scores.length,6);assert.deepEqual(await fs.readFile(path.join(store.path(original.id),'report.json')),reportBytes);assert.deepEqual(await fs.readFile(path.join(raw,'RTMS-trade.csv')),bytes);assert.equal((await store.load(original.id)).scores.length,7);assert.equal((await store.list()).length,2);}finally{await fs.rm(root,{recursive:true,force:true});}
});
test('많은 원출처는 고객용 대표 출처 7개 이내로 표시하고 전체 원본 목록은 유지',()=>{
 const original=oldReport();original.sources=Array.from({length:25},(_,i)=>({id:'source-'+i,title:'검증용 출처 '+i,url:'https://source'+i+'.go.kr/facts',checkedAt:'2026-10-17'}));for(const row of original.scores)row.sourceIds=['source-'+LEGACY.indexOf(row.name)];const before=JSON.stringify(original),customer=require('../src/customer-report.cjs'),prepared=customer.prepare(original),visible=customer.sources(prepared);assert.equal(prepared.scores.length,6);assert.ok(visible.length>0&&visible.length<=7);assert.ok(visible.every(s=>s.url&&s.checkedAt));assert.equal(original.sources.length,25);assert.equal(JSON.stringify(original),before);assert.ok(!prepared.scores.some(s=>s.name.includes('프리미엄')));
});
