'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),table=require('../src/price-table.cjs');
test('average amounts share the requested eok display and retain missing and small monthly values',()=>{
 const {averageMoney}=require('../src/core.cjs');
 for(const [n,label]of [[75000,'7.5억'],[131937.5,'13.2억'],[10000,'1억'],[0,'0만원'],[156.4,'156.4만원'],[null,'산출 불가'],[NaN,'산출 불가'],[Infinity,'산출 불가']])assert.equal(averageMoney(n),label);
 const r={prices:{summaries:[{kind:'trade',price:75000,n:2},{kind:'jeonse',deposit:50000,n:3}],unavailable:[]}};
 assert.deepEqual(table.rows(r).map(row=>row[4]),['7.5억','5억']);assert.equal(r.prices.summaries[0].price,75000);
});
test('compact averages preserve contract weights and separate monthly deposits without rounding the underlying data',()=>{
 const r={prices:{period:{start:'2026-04-17',end:'2026-10-17'},summaries:[{kind:'trade',areaMode:'type',area:84,n:28,price:73475},{kind:'monthly',areaMode:'type',area:84,n:7,depositBand:'1~3억원 미만',deposit:13198.234,monthly:156.4}],unavailable:[]}},before=structuredClone(r);
 assert.deepEqual(table.rows(r),[['매매','84타입','—','28','7.3억'],['월세','84타입','10,000~<30,000','7','보증 1.3억 / 월 156.4만원']]);assert.deepEqual(r,before);assert.match(table.periodNote(r),/2026-04-17 ~ 2026-10-17/);assert.ok(table.rows(r).every(row=>row.every(s=>!s.includes('\n'))));
});
test('missing averages remain missing and a real zero-deposit lease is not treated as absent',()=>{
 const r={prices:{summaries:[{kind:'monthly',areaMode:'type',area:59,n:1,deposit:0,monthly:120}],unavailable:[{kind:'trade',reason:'기간 내 거래 없음'}]}};
 assert.equal(table.rows(r)[0][4],'보증 0만원 / 월 120만원');assert.equal(table.rows(r)[1][4],'자료 없음');assert.match(table.missingNote(r),/매매.*기간 내 거래 없음/);
});

test('checkbox-selected decimal areas use one representative integer type without changing any amounts or contracts',()=>{
 const r={input:{selectedAreas:[84.8153,84.9572,84.993],areaMode:'set'},prices:{summaries:[{kind:'trade',areaMode:'set',area:'84.8153,84.9572,84.993',areaLabel:'선택 전용면적 84.8153㎡ · 84.9572㎡ · 84.993㎡ (개별 계약 통합 평균)',n:28,price:73475,actualAreas:[84.8153,84.9572,84.993]}],unavailable:[]}},before=structuredClone(r);
 assert.deepEqual(table.rows(r),[['매매','84타입','—','28','7.3억']]);assert.equal(table.inputArea(r.input),'84타입');assert.deepEqual(r,before);
});
test('combined areas spanning integer types show the true range and exact searches retain exact square meters',()=>{
 assert.equal(table.area({areaMode:'set',area:'84.1,90.1'}),'84~90타입');
 assert.equal(table.area({areaMode:'set',actualAreas:[59.9,59.98]}),'59타입');
 assert.equal(table.area({areaMode:'exact',area:84.8153,areaLabel:'84.8153㎡ 정확 일치'}),'84.8153㎡');
 assert.equal(table.area({areaMode:'all',area:84.81,areaLabel:'84.81㎡'}),'84.81㎡');
 assert.equal(table.area({areaMode:'set',area:'invalid'}),'선택 타입');
});
