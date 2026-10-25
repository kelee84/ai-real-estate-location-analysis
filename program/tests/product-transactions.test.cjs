'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {normalizeInput,aggregate}=require('../src/core.cjs'),product=require('../src/product-transactions.cjs'),scoring=require('../src/scoring.cjs'),customer=require('../src/customer-report.cjs');
const SCORE_ITEMS=['교통 환경','교육 환경','상권 환경','자연환경','상품 경쟁력','가격 경쟁력'];
const input=normalizeInput({target:'서울 서대문구 북아현동 두산',building:'두산',asset:'apartment',area:59.96,asOf:'2026-10-18',types:['trade']}),checkedAt='2026-10-18';
function prices(){const p=aggregate(Array.from({length:16},(_,i)=>({id:'trade-'+i,date:'2026-08-01',kind:'trade',price:131937.5,area:59.96,areaBasis:'전용면적',building:'두산',location:'서울특별시 서대문구 북아현동',lot:'1009',built:'1999'})),input,[{deal:'trade',status:'success',source:'https://rt.molit.go.kr/pt/xls/xls.do',checkedAt}]);p.buildingResolution={building:'두산',code:'469',town:'북아현동',lot:'1009'};return p;}
function report(){const p=prices(),scores=SCORE_ITEMS.map(name=>({name,score:null,status:'withheld',sourceIds:[]})),evidence={version:'2026-10-17-regional-park-rubric-v4',building:input.building,asOf:input.asOf,identity:p.buildingResolution,center:null,places:[],sources:[]};product.apply(scores,evidence,{input,prices:p,dataCheckedAt:checkedAt});return {id:'11111111-1111-4111-8111-111111111111',input,prices:p,scores,assessment:{version:evidence.version,evidence},sources:evidence.sources,dataCheckedAt:checkedAt,createdAt:'2026-10-18T00:00:00Z',sections:[]};}
test('K-apt 미조회 시 같은 단지의 유효 매매 건수·평균·건축연도를 재사용하며 점수는 만들지 않음',()=>{
 const r=report(),row=r.scores[4],reference=r.assessment.evidence.productTransactions;
 assert.equal(row.score,null);assert.equal(row.status,'withheld');assert.equal(reference.buildingYear,1999);assert.equal(reference.n,16);assert.equal(reference.mean,131937.5);assert.equal(reference.status,'reference');assert.deepEqual(reference.actualAreas,[59.96]);assert.match(row.observed,/1999년.*59\.96㎡.*16건.*13\.2억/);assert.match(row.reason,/주차·관리·평면 미확인/);assert.match(row.reason,/사용승인일이 아닙니다/);assert.ok(r.sources.some(s=>s.id===reference.source.id));assert.match(row.observed,/1999년.*16건/);assert.equal(require('../src/research.cjs').compactResearch(r.assessment.evidence).productTransactions,undefined);
});
test('원자료의 식별·날짜·해제·중복·평균·면적·공식 출처가 맞지 않으면 상품 참고로도 사용하지 않음',()=>{
 const change=[p=>p.rows[0].building='다른두산',p=>p.rows[0].lot='1010',p=>p.rows[0].location='서울특별시 강남구 북아현밖동',p=>p.rows[0].cancelled=true,p=>p.rows[0].id=p.rows[1].id,p=>p.rows[0].date='2026-10-19',p=>p.rows[0].area=84,p=>p.rows[0].price=1,p=>p.coverage[0].source='https://example.com',p=>p.coverage[0].checkedAt='2026-07-01',p=>delete p.buildingResolution.code];
 for(const mutate of change){const p=prices();mutate(p);assert.equal(product.snapshot({input,prices:p}),null);}
 assert.equal(product.snapshot({input:{...input,types:['jeonse']},prices:prices()}),null);assert.equal(product.snapshot({input,prices:{...prices(),rows:[]}}),null);
});
test('건축연도 누락·불일치·미래 값은 연도 미확인으로 남기되 검증된 거래 평균은 표시',()=>{
 for(const value of ['', '2000','9999']){const p=prices();p.rows[0].built=value;const ref=product.snapshot({input,prices:p});assert.equal(ref.buildingYear,null);assert.equal(ref.mean,131937.5);assert.equal(ref.n,16);assert.match(ref.summary,/건축연도 (불일치|미확인)/);}
});
test('K-apt 상품 점수가 있으면 그대로 유지하고 기본 사용승인 정보도 실거래 연도로 대체하지 않음',()=>{
 const e={product:{status:'verified'},sources:[]},scores=SCORE_ITEMS.map(name=>({name,score:name==='상품 경쟁력'?84:null})),before=structuredClone(scores);assert.equal(product.apply(scores,e,{input,prices:prices()}),false);assert.deepEqual(scores,before);
 const held=SCORE_ITEMS.map(name=>({name,score:null,status:'withheld',sourceIds:[]})),basic={basic:{approvalDate:'2000-02-15',sourceId:'kapt'},sources:[]};product.apply(held,basic,{input,prices:prices()});assert.match(held[4].observed,/사용승인 2000-02-15.*실거래.*1999년/);assert.equal(held[4].score,null);
});
test('기존 상품 참고 설명은 보관하고 새 병원·학원 점수로 바꾸지 않으며 원본·가격·메모 유지',()=>{
 const r=report();delete r.scores[4].transactionReference;delete r.assessment.evidence.productTransactions;r.scores[4].reason='K-apt 단지번호 미확보';r.consultation={privateNote:'내부 보관 메모'};const before=structuredClone(r),prepared=scoring.prepareReport(r);
 assert.deepEqual(r,before);assert.deepEqual(prepared.prices,r.prices);assert.deepEqual(prepared.consultation,r.consultation);assert.equal(prepared.scores[4].name,'병원 환경');assert.equal(prepared.scores[5].name,'학원 환경');assert.equal(prepared.scores[4].score,null);assert.equal(prepared.scores[5].score,null);assert.deepEqual(scoring.prepareReport(prepared),prepared);
 const comparison={mode:'comparison',input:r.input,members:[{...r,key:'A'},{...r,key:'B'}],scores:[]};const fixed=scoring.prepareReport(comparison);assert.ok(fixed.members.every(m=>m.scores[4].score===null&&m.scores[4].name==='병원 환경'));
});
