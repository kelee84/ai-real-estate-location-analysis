'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const core=require('../src/core.cjs'),b=require('../src/comparison-basis.cjs'),radar=require('../src/radar.cjs');
function member(key,selection){const input=core.normalizeInput({target:'가상 단지 '+key,building:'가상 단지 '+key,asOf:'2026-10-17',...selection});return {key,input,prices:core.aggregate([],input)};}
test('84 exact, checkbox set and integer type are comparable without expanding their contracts',()=>{
 const members=[member('A',{selectedAreas:[84.8153,84.9572,84.993]}),member('B',{area:'84.3408'}),member('C',{area:84})],before=JSON.stringify(members);
 assert.equal(b.compatible(members),true);assert.deepEqual(b.warnings(members),[]);assert.deepEqual(members.map(b.areaLabel),['84타입','84타입','84타입']);assert.match(b.areaNote(members),/84.3408㎡/);assert.equal(JSON.stringify(members),before);
});
test('different sizes, mixed dates, mixed asset types and unbounded area remain blocked',()=>{
 const a=member('A',{area:84});for(const selection of [{area:59},{area:null},{selectedAreas:[84.5,90.5]}])assert.equal(b.compatible([a,member('B',selection)]),false);
 const c=member('B',{area:'84.3408'});c.input.asOf='2026-10-16';assert.match(b.warnings([a,c]).join(),/기준일/);
 c.input.asOf=a.input.asOf;c.input.asset='officetel';assert.match(b.warnings([a,c]).join(),/자산 유형/);
});
test('effective nearest fallback does not silently compare the original requested size',()=>{
 const a=member('A',{area:84}),c=member('B',{area:84});c.prices.effectiveArea=core.areaSelection({area:59});assert.equal(b.compatible([a,c]),false);assert.equal(b.areaLabel(c),'59타입');
});
test('same kind and deposit band rows are adjacent, monetary deltas use raw contract means',()=>{
 const a=member('A',{area:84}),c=member('B',{area:'84.3408'});
 a.prices.summaries=[{kind:'trade',price:73475,n:28},{kind:'jeonse',deposit:44250,n:17},{kind:'monthly',depositBand:'1~3억원 미만',n:1,deposit:10000,monthly:150}];
 c.prices.summaries=[{kind:'trade',price:81342.85714285714,n:7},{kind:'jeonse',deposit:52531.818181818184,n:11},{kind:'monthly',depositBand:'1~3억원 미만',n:2,deposit:22000,monthly:112.5}];
 const notes=b.notes([a,c]);assert.match(notes.join(),/7,867.9만원 높음/);assert.match(notes.join(),/8,281.8만원 높음/);assert.match(notes.join(),/평균 보증금이 다르면/);assert.match(notes.join(),/3건 미만/);
 a.prices.unavailable=[];c.prices.unavailable=[];const rows=require('../src/comparison-report.cjs').averageRows({members:[a,c]});assert.deepEqual(rows.map(r=>r[0]+r[1]),['A매매','B매매','A전세','B전세','A월세','B월세']);
});
test('compact radar identifies every series and preserves equal coordinates with nested marker shapes',()=>{
 const members=['A','B','C'].map(k=>({...member(k,{area:84}),scores:core.SCORE_ITEMS.map(name=>({name,score:80}))}));
 const svg=radar.svg({members},{compact:true});assert.equal((svg.match(/data-role="series-legend"/g)||[]).length,3);assert.equal((svg.match(/data-role="score-marker"/g)||[]).length,18);assert.match(svg,/r="10"/);assert.match(svg,/width="12" height="12"/);assert.match(svg,/stroke-width="6"/);assert.match(svg,/stroke-dasharray="12 7"/);assert.match(svg,/84타입/);
});

test('obsolete withheld price rows cannot become undefined or map to a new living axis',()=>{
 const members=['A','B'].map(key=>({...member(key,{area:84}),scores:[{name:'가격 경쟁력',score:null,reason:'기준일·면적·거래 유형 또는 적용 타입의 차이로 평가 보류'}],assessment:{version:'legacy',evidence:{}}})),report={members},before=JSON.stringify(report);
 const result=b.repair(report);assert.equal(result,report);assert.equal(JSON.stringify(result),before);assert.ok(result.members.every(m=>m.scores.every(Boolean)));assert.ok(result.members.every(m=>!m.scores.some(s=>/병원|학원/.test(s.name))));
});
