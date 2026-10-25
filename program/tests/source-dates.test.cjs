'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {alignSourceDates}=require('../src/evidence-guard.cjs');
const molit='https://rt.molit.go.kr/pt/xls/xls.do',school='https://schoolzone.emac.kr/gis/gis.do';
test('source dates use verified matching URLs and keep source IDs, URLs and prose intact',()=>{
 const source={id:'ai-school',title:'원문 출처명',url:school,checkedAt:'2026-10-16',description:'변경하지 않는 원문'},verified={id:'official-school',url:school,checkedAt:'2026-10-17'};
 const [actual]=alignSourceDates([source],{verifiedSources:[verified]});assert.deepEqual(actual,{...source,checkedAt:'2026-10-17'});assert.equal(source.checkedAt,'2026-10-16');assert.equal(verified.checkedAt,'2026-10-17');
});
test('explicit timestamps are converted to Korean dates rather than taking the UTC prefix',()=>{
 const [a,b]=alignSourceDates([{id:'a',url:school},{id:'b',url:molit}],{verifiedSources:[{id:'official',url:school,checkedAt:'2026-10-16T15:39:37.348Z'}],dataCheckedAt:'2026-10-16T15:39:30.805Z'});assert.equal(a.checkedAt,'2026-10-17');assert.equal(b.checkedAt,'2026-10-17');
 const [offset]=alignSourceDates([{id:'offset',url:school}],{verifiedSources:[{url:school,checkedAt:'2026-10-17T00:30:00+09:00'}]});assert.equal(offset.checkedAt,'2026-10-17');
});
test('single-query RTMS date takes precedence over a conflicting verified date',()=>{
 const [r]=alignSourceDates([{id:'rtms-ai',url:molit,checkedAt:'2026-10-15'}],{verifiedSources:[{id:'rtms-ai',url:molit,checkedAt:'2026-10-16'}],dataCheckedAt:'2026-10-16T15:39:30.805Z'});assert.equal(r.checkedAt,'2026-10-17');
});
test('preserved source IDs take precedence over every date alignment rule',()=>{
 const sources=[{id:'old-rtms',url:molit,checkedAt:'2025-01-01'},{id:'old-school',url:school,checkedAt:'2025-02-02'}];const before=structuredClone(sources);Object.freeze(sources[0]);Object.freeze(sources[1]);Object.freeze(sources);
 const aligned=alignSourceDates(sources,{verifiedSources:[{url:school,checkedAt:'2026-10-17'}],dataCheckedAt:'2026-10-17',preservedIds:new Set(sources.map(s=>s.id))});assert.deepEqual(aligned,before);assert.deepEqual(sources,before);
});
test('mixed historic dates sharing a URL are not selected without a matching verified ID',()=>{
 const sources=[{id:'ambiguous',url:school,checkedAt:'2026-10-01'},{id:'second',url:school,checkedAt:'2026-10-01'}],verifiedSources=[{id:'first',url:school,checkedAt:'2026-10-16'},{id:'second',url:school,checkedAt:'2026-10-17'}];const r=alignSourceDates(sources,{verifiedSources});assert.equal(r[0].checkedAt,'2026-10-01');assert.equal(r[1].checkedAt,'2026-10-17');
});
test('conflicting duplicate verified IDs remain ambiguous and unrelated URLs never borrow dates',()=>{
 const sources=[{id:'same',url:school,checkedAt:'2026-10-01'},{id:'same',url:'https://other.test/',checkedAt:'2026-10-02'}],verifiedSources=[{id:'same',url:school,checkedAt:'2026-10-16'},{id:'same',url:school,checkedAt:'2026-10-17'}];assert.deepEqual(alignSourceDates(sources,{verifiedSources}),sources);
});
test('invalid calendar dates, ambiguous local timestamps and malformed URLs are ignored',()=>{
 for(const bad of ['2026-02-30','2026-02-30T15:00:00Z','2026-10-17T24:00:00Z','2026-10-17T00:00:00','2026-10-17 00:00:00','not a date',null]){
  const sources=[{id:'school',url:school,checkedAt:'2026-10-01'},{id:'rtms',url:molit,checkedAt:'2026-10-01'}];assert.deepEqual(alignSourceDates(sources,{verifiedSources:[{url:school,checkedAt:bad}],dataCheckedAt:bad}),sources);
 }
 const source={id:'bad-url',url:'invalid URL',checkedAt:'2026-10-01'};assert.deepEqual(alignSourceDates([source],{verifiedSources:[{url:source.url,checkedAt:'2026-10-17'}]}),[source]);
});
test('RTMS hostname matching does not affect lookalike domains and valid fallback still works',()=>{
 const sources=[{id:'lookalike',url:'https://rt.molit.go.kr.other.test/path',checkedAt:'2026-10-01'},{id:'rtms',url:molit,checkedAt:'2026-10-01'}];const r=alignSourceDates(sources,{dataCheckedAt:'2026-02-30',verifiedSources:[{url:molit,checkedAt:'2026-10-17'}]});assert.equal(r[0].checkedAt,'2026-10-01');assert.equal(r[1].checkedAt,'2026-10-17');
});
