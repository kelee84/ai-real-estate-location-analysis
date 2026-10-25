'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {guardNarrative}=require('../src/evidence-guard.cjs'),{SCORE_ITEMS}=require('../src/core.cjs');
const unsafeSchool='인천첨단초등학교가 단지와 인접한 공식 통학구역으로 지정되어 통학 동선이 비교적 안전하고 용이함';
const unsafeWalk='인천1호선 지식정보단지역 및 테크노파크역을 도보권 직선거리로 이용 가능한 입지';
const identifiers=['인천1호선','인천첨단초등학교','지식정보단지역','테크노파크역'];
const source={id:'school',title:'교육청 공식 통학구역',url:'https://example.go.kr/school',checkedAt:'2026-10-23'};
function sample(){return {title:'생활환경 보고서',conclusion:'확인된 시설 접근성을 비교했습니다.',strengths:[unsafeSchool,unsafeWalk],highlights:[],limitations:[],checks:[],sections:[{heading:'등록 시설',body:'생활시설이 단지 인근 도보권 직선거리에 형성되어 있습니다.'}],sources:[source],scores:SCORE_ITEMS.map(name=>({name,score:85,reason:'등록 시설의 직선거리 기준 부분 평가',method:'공통 배점 기준',sourceIds:['school']}))};}

test('school-boundary source never turns an inferred safe route into a verified fact',()=>{
  const report=sample(),before=structuredClone(report),result=guardNarrative(report,{identifiers});
  assert.ok(result.report.strengths[0].includes('인천첨단초등학교가 단지와 인접한 공식 통학구역으로 지정되어'));
  assert.ok(!result.report.strengths[0].includes('안전하고 용이함'));assert.match(result.report.strengths[0],/실제 통학·보행 동선의 안전성과 이용 편의는 별도 확인/);
  assert.deepEqual(result.report.sources,before.sources);assert.deepEqual(result.report.scores,before.scores);assert.deepEqual(report,before);
  assert.ok(result.rejected.some(r=>r.field==='strengths.0'&&r.kind==='qualitative'&&r.status.includes('추론')));assert.match(result.notice,/확인되지 않은 도보·통학 안전성/);assert.ok(!result.notice.includes('정량 설명'));
});
test('walking/straight-distance conflation is neutralized while verified line and station names survive',()=>{
  const result=guardNarrative(sample(),{identifiers});
  assert.ok(!JSON.stringify(result.report).includes('도보권 직선거리'));assert.ok(result.report.strengths[1].includes('인천1호선 지식정보단지역 및 테크노파크역'));
  assert.match(result.report.strengths[1],/직선거리 기준/);assert.match(result.report.strengths[1],/실제 보행 동선·거리는 별도 확인/);assert.match(result.report.sections[0].body,/실제 보행 동선·거리는 별도 확인/);
  assert.ok(result.rejected.some(r=>r.field==='sections.0.body'&&r.kind==='qualitative'));
});
test('explicit route and assignment caveats, confirmed school boundary and ordinary accessibility facts are preserved',()=>{
  const report=sample();report.strengths=['인천첨단초등학교는 공식 통학구역에 포함됩니다.','등록 시설과 단지 기준점 사이의 직선 접근성을 확인했습니다.'];report.sections=[{heading:'확인 사항',body:'실제 통학 안전·도보거리는 별도 확인이 필요합니다. 통학 동선이 안전한지는 확인하지 못했습니다. 학교와 가까워 배정이 보장된다고 단정할 수 없습니다.'}];
  const result=guardNarrative(report,{identifiers});assert.deepEqual(result.report,report);assert.deepEqual(result.rejected,[]);assert.equal(result.notice,null);
});
test('a proximity-based assignment guarantee is neutralized without changing an independent official boundary fact',()=>{
  const report=sample();report.strengths=['인천첨단초등학교의 공식 통학구역입니다. 학교와 가까워 배정이 보장됩니다.'];report.sections=[];
  const result=guardNarrative(report,{identifiers});assert.ok(result.report.strengths[0].startsWith('인천첨단초등학교의 공식 통학구역입니다.'));assert.ok(!result.report.strengths[0].includes('배정이 보장'));assert.match(result.report.strengths[0],/근접성만으로 학교 배정·입학 조건을 확정할 수 없음/);
});
test('proximity does not prove school or hospital quality while explicit limitations remain intact',()=>{
  const report=sample();report.strengths=['학교와 인접해 교육 수준이 우수합니다.','병원과 가까워 의료의 질이 높습니다.'];report.sections=[{heading:'구분',body:'학교와 가까워 교육 수준이 우수하다고 단정할 수 없습니다.'}];
  const result=guardNarrative(report,{identifiers});assert.ok(result.report.strengths.every(s=>s.includes('근접성만으로 교육·의료의 수준이나 성과를 평가할 수 없음')));assert.deepEqual(result.report.sections,report.sections);
});
for(const members of [1,2,3])test(members+' member path guards only narrative and preserves saved contract data, six scores and verified numbers in repair mode',()=>{
  const single=sample();single.prices={rows:Array.from({length:37},(_,i)=>({id:'contract-'+i,price:100000+i})),summaries:[{kind:'trade',n:37,price:100018}]};single.scores[0]={...single.scores[0],reason:'등록 역 직선 700m',method:'역 접근 40% 부분 평가'};single.highlights=['유효 거래는 37건이며 평균은 10.0억입니다.'];
  const report=members===1?single:{...sample(),members:Array.from({length:members},(_,i)=>({...structuredClone(single),key:String.fromCharCode(65+i)}))},before=structuredClone(report);
  const result=guardNarrative(report,{identifiers,qualitativeOnly:true}),items=result.report.members||[result.report],old=before.members||[before];
  for(const [i,item]of items.entries()){assert.deepEqual(item.prices,old[i].prices);assert.deepEqual(item.scores,old[i].scores);assert.deepEqual(item.highlights,old[i].highlights);assert.ok(!item.strengths.join(' ').includes('안전하고 용이함'));}
  if(members>1)assert.ok(result.rejected.some(r=>r.field==='members.'+(members-1)+'.strengths.0'));
  assert.ok(result.rejected.every(r=>r.kind==='qualitative'));assert.deepEqual(report,before);
});
test('qualitative and quantitative rejections remain distinguishable and a mere URL cannot bypass either check',()=>{
  const report=sample();report.highlights=['유효 거래가 999건입니다.'];const result=guardNarrative(report,{identifiers});
  assert.ok(result.rejected.some(r=>r.kind==='qualitative'));assert.ok(result.rejected.some(r=>r.kind==='quantitative'));assert.match(result.notice,/정량 설명/);assert.match(result.notice,/확인되지 않은 도보·통학 안전성/);
  assert.ok(!result.report.highlights[0].includes('999'));assert.ok(!result.report.strengths[0].includes('안전하고 용이함'));
});
test('repair mode leaves missing sources and score objects unchanged and qualitative methodology never resets member scores',()=>{
  const report={...sample(),sources:[],methodology:'통학 동선이 비교적 안전하고 용이함',members:[sample(),sample()]};const before=structuredClone(report),result=guardNarrative(report,{qualitativeOnly:true,identifiers});
  assert.deepEqual(result.report.sources,[]);assert.deepEqual(result.report.scores,before.scores);assert.deepEqual(result.report.members.map(m=>m.scores),before.members.map(m=>m.scores));assert.ok(result.report.strengths[0].includes('공식 통학구역'));
});
