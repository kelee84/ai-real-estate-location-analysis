'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {SCORE_ITEMS:CURRENT_ITEMS}=require('../src/core.cjs');
const SCORE_ITEMS=['교통 환경','교육 환경','상권 환경','자연환경','상품 경쟁력','가격 경쟁력'];
const {applyEducation,applyProduct}=require('../src/extended-scoring.cjs');
const input={building:'테스트대상아파트',asOf:'2026-10-17'},source={id:'official-product',url:'https://www.k-apt.go.kr/'};
const rows=()=>SCORE_ITEMS.map(name=>({name,score:null,status:'withheld',coverage:0,reason:'자료 없음',sourceIds:[]}));
const distanceScore=d=>d<=300?95:d<=600?85:d<=1000?70:55;
function evidence(){return {places:[{id:'near',name:'가까운초등학교',category:'school_elementary',distanceM:100,sourceId:'near-school'},{id:'linked',name:'배정연계초등학교',category:'school_elementary',distanceM:500,sourceId:'linked-school'}],sources:[],school:{status:'verified',name:'배정연계초통학구역',zoneId:'101213',updatedAt:'2026-03-01',schoolNames:['배정연계초등학교'],source:{id:'official-zone'},schoolSource:{id:'official-link'}},product:{status:'verified',source,approvalDate:'2014-08-29',units:736,parkingTotal:1183,hallType:'계단식',elevators:17,structure:'철골콘크리트구조'}};}
test('education scores the officially linked school rather than the nearest unrelated school',()=>{
 const scores=rows(),e=evidence();applyEducation(scores,e,{input,distanceScore});const r=scores.find(r=>r.name==='교육 환경');assert.equal(r.score,85);assert.equal(r.coverage,45);assert.match(r.observed,/배정연계초등학교/);assert.doesNotMatch(r.observed,/가까운초등학교/);assert.ok(r.sourceIds.includes('official-link'));assert.match(r.needed,/최종 배정/);assert.match(r.method,/학업 성과 미평가/);
});
test('education unlinked proximity stays a 15% partial observation and discloses missing assignment',()=>{
 const scores=rows(),e=evidence();e.school={status:'unavailable',reason:'학교군 경계 확인 필요'};applyEducation(scores,e,{input,distanceScore});const r=scores[1];assert.equal(r.score,95);assert.equal(r.coverage,15);assert.match(r.scope,/주변 등록/);assert.match(r.observed,/경계 확인 필요/);assert.match(r.needed,/공식 통학구역/);const held=rows();e.places=[];applyEducation(held,e,{input,distanceScore});assert.equal(held[1].score,null);
});
test('product uses verified parking denominator and fixed disclosed weights, not equipment count as a score',()=>{
 const scores=rows(),e=evidence();applyProduct(scores,e,{input});const r=scores[4];assert.equal(r.score,84);assert.equal(r.coverage,55);assert.equal(r.calculation.find(x=>x.indicator==='등록 세대당 주차').value,1183/736);assert.match(r.observed,/1,183대/);assert.match(r.observed,/736세대/);assert.match(r.observed,/승강기 17대 \(점수 미반영\)/);assert.match(r.needed,/평면/);
});
test('age alone is withheld and unknown/invalid denominators never become zero parking',()=>{
 const scores=rows(),e=evidence();e.product={status:'unavailable',reason:'주차 미확인'};e.basic={approvalDate:'2014-08-29',units:736,sourceId:'basic'};applyProduct(scores,e,{input});assert.equal(scores[4].score,null);assert.match(scores[4].reason,/연령 하나만/);
 for(const units of [null,0,-1,NaN]){const s=rows(),x=evidence();x.product.units=units;x.product.hallType=null;applyProduct(s,x,{input});assert.equal(s[4].score,null);assert.equal(s[4].calculation,undefined);}
 const noParking=rows(),x=evidence();x.product.parkingTotal=null;applyProduct(noParking,x,{input});assert.equal(noParking[4].coverage,30);assert.ok(noParking[4].calculation.every(c=>c.indicator!=='등록 세대당 주차'));
});
test('확인된 비교 가격 자료가 있어도 새 점수표는 프리미엄 없이 6개 항목만 산출',()=>{
 const scoring=require('../src/scoring.cjs'),e=evidence(),peers={status:'verified',gapPercent:8,target:{n:3},peers:[{name:'비교하나',n:3},{name:'비교둘',n:4}],peerContracts:7,criteria:'동일 기간·유사 면적'};
 const assessed=scoring.assessScores({scores:rows()},{input:{...input,asset:'apartment',target:'인천 연수구 테스트대상아파트',types:['trade'],offered:null},prices:{rows:[],coverage:[],summaries:[]},school:e.school,product:e.product,peers});
 assert.equal(assessed.scores.length,6);assert.deepEqual(assessed.scores.map(s=>s.name),CURRENT_ITEMS);assert.ok(!assessed.scores.some(s=>/프리미엄|상품 경쟁력|가격 경쟁력/.test(s.name)));assert.ok(!assessed.sources.some(s=>s.id.startsWith('ev-peer-')));
});
test('가격 비교 자료의 유무와 관계없이 교육·상품 확장은 6개 항목의 순서와 값 유지',()=>{
 const baseline=rows(),baselineEvidence=evidence();applyEducation(baseline,baselineEvidence,{input,distanceScore});applyProduct(baseline,baselineEvidence,{input});
 for(const peers of [{status:'verified',gapPercent:8,target:{n:3},peers:[{n:3},{n:4}]},{status:'unavailable',reason:'비교 계약 부족'}]){const scores=rows(),e={...evidence(),peers};applyEducation(scores,e,{input,distanceScore});applyProduct(scores,e,{input});assert.equal(scores.length,6);assert.deepEqual(scores,baseline);assert.equal(scores.find(s=>s.name==='가격 경쟁력').score,null);}
});
