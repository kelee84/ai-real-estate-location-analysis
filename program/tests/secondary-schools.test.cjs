'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),scoring=require('../src/scoring.cjs'),schools=require('../src/secondary-schools.cjs'),{todayKst}=require('../src/core.cjs');
const asOf=todayKst(),center={lat:37.4,lng:126.64},input={asset:'apartment',target:'단지',building:'단지',asOf,types:['trade']},prices={buildingResolution:{building:'단지',code:'test',town:'동',lot:'1',...center},rows:[],summaries:[],coverage:[]};
const p=(id,name,type,offset)=>{const place={kakao_place_id:id,name,kakao_category_name:'교육,학문 > 학교 > '+type,lat:center.lat+offset,lng:center.lng};return {...place,distance_m:Math.round(scoring.haversine(center,place))};};
function tool(){return {server:'ipzitalk',tool:'search_by_nearby_category',arguments:{categories:['school']},result:{structuredContent:{center,radius_m:3000,metadata:{collected_at:new Date().toISOString()},results:{school:[p('1','초등학교','초등학교',.001),p('2','가까운중학교','중학교',.004),p('3','먼중학교','중학교',.01),p('4','인근고등학교','고등학교',.008),p('5','예정중학교','중학교',.0001),p('6','학원','학원',.0002)]}}}};}
test('secondary school lookup validates real school categories, excludes plans and scores one school of each level',()=>{
 const e=scoring.collectEvidence({input,prices,tools:[tool()]});assert.equal(e.places.filter(p=>p.category==='school_middle').length,2);assert.ok(!e.places.some(p=>/예정|학원/.test(p.name)));assert.ok(schools.current(e,input));
 const r=scoring.assessScores({scores:[]},{input,prices,previousEvidence:e}),education=r.scores[1];assert.equal(education.coverage,35);assert.equal(education.calculation.length,3);assert.equal(education.score,85);assert.equal(education.calculation.find(p=>p.indicator==='인근 중학교 접근').value,445);const proof=require('../src/customer-report.cjs').keyEvidence(education,{assessment:{evidence:e}});assert.match(proof,/가까운중학교/);assert.match(proof,/인근고등학교/);assert.doesNotMatch(proof,/먼중학교/);assert.match(proof,/중\(인근\)/);assert.match(education.observed,/배정 학교를 뜻하지/);
});
test('missing elementary facts do not hide verified middle and high school access',()=>{
 const t=tool();t.result.structuredContent.results.school=t.result.structuredContent.results.school.filter(p=>!/초등학교/.test(p.kakao_category_name));const e=scoring.collectEvidence({input,prices,tools:[t]}),r=scoring.assessScores({scores:[]},{input,prices,previousEvidence:e}).scores[1];assert.equal(r.coverage,20);assert.equal(r.score,78);assert.doesNotMatch(r.scope,/초등학교/);
});

test('broader school records keep verified nearby elementary facts but cannot expand its 1.5 km scoring scope',()=>{
 const t=tool();t.result.structuredContent.results.school.push(p('7','범위밖초등학교','초등학교',.02));const e=scoring.collectEvidence({input,prices,tools:[t]});assert.equal(e.places.filter(p=>p.category==='school_elementary').length,1);assert.equal(e.places.find(p=>p.category==='school_elementary').name,'초등학교');assert.ok(!e.places.some(p=>p.name==='범위밖초등학교'));
 const education=scoring.assessScores({scores:[]},{input,prices,previousEvidence:e}).scores[1];assert.equal(education.coverage,35);assert.equal(education.score,85);
});
test('comparison reuse supplements secondary school facts once and preserves the original report evidence',async()=>{
 const previous={version:scoring.VERSION,building:input.building,asOf,identity:prices.buildingResolution,center,places:[],sources:[]},before=JSON.stringify(previous);let queries=0;const bridge={evidenceSession:async()=>({}),evidenceTool:async()=>{queries++;return tool();}},research=require('../src/research.cjs');
 const first=await research.ensureSecondaryEvidence(bridge,input,prices,{previous});assert.equal(queries,1);assert.equal(JSON.stringify(previous),before);assert.ok(first.evidence.places.some(p=>p.category==='school_high'));const again=await research.ensureSecondaryEvidence(bridge,input,prices,{previous:first.evidence});assert.equal(queries,1);assert.equal(again.refreshed,false);
});
