'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
test('가격점수 없이 선택 면적의 실거래 평균과 거래 출처를 보존',()=>{
 const sources=[{id:'trade',title:'국토교통부 실거래가',url:'https://rt.molit.go.kr/pt/xls/xls.do',checkedAt:'2026-10-17'},{id:'asking',title:'검증용 허가 호가 자료',url:'https://provider.example.test/listings',checkedAt:'2026-10-17'}];
 const report={input:{asOf:'2026-10-17'},prices:{summaries:[{kind:'trade',price:105000,n:4}]},sources,scores:[{name:'가격 경쟁력',score:65,sourceIds:['asking','trade'],priceBasis:{kind:'current-listing-average',sourceId:'asking',amount:110000}}]};
 const before=JSON.stringify(report),customer=require('../src/customer-report.cjs'),selected=customer.sources(report);
 assert.equal(customer.priceLabel(report),'실거래 평균 참고 10.5억');assert.ok(selected.some(s=>s.id==='trade'));assert.ok(!selected.some(s=>s.assessmentNames.includes('가격 경쟁력')));assert.equal(JSON.stringify(report),before);
});

test('첫 페이지에서 호가와 실거래의 차이는 보존하고 내부 계산 안내만 단위·집계 설명으로 정리',()=>{
 const r={input:{asOf:'2026-10-17'},sources:[],scores:[],highlights:['단지 기본정보가 등록돼 있습니다.','매매 비교값은 현재 매물 호가가 아닌 최근 실거래 평균입니다.'],prices:{rows:[{id:'verified'}],note:'개별 계약의 산술평균입니다. 평균 금액은 소수 첫째 자리까지 반올림해 표시하며 원계산값은 Excel 원자료에 보존합니다. 현재 호가나 확정 거래 가능 가격이 아닙니다. 최근 계약은 신고 지연과 추후 정정이 있을 수 있습니다.'}};
 const before=JSON.stringify(r),out=require('../src/customer-report.cjs').prepare(r);
 assert.deepEqual(out.highlights,r.highlights);assert.equal(out.prices.note,'평균 금액: 억·만원(소수 첫째 자리 반올림) · 개별 계약별 산술평균');assert.equal(JSON.stringify(r),before);
});
