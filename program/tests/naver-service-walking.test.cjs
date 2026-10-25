'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {AnalysisService}=require('../src/service.cjs'),{walkingFixture}=require('./naver-walking-fixture.cjs');
function setup(){
 const f=walkingFixture(),input={...f.input,target:'서울특별시 서대문구 천연동 145',building:f.identity.building},prices={buildingResolution:f.identity},calls={nearby:0,walking:0,loads:0},service=Object.create(AnalysisService.prototype);
 const fact={...f.fact,text:f.fact.name+' · '+f.fact.address};delete fact.walking;
 service.readNaverNearby=async()=>{calls.nearby++;return {status:'received',facts:[structuredClone(fact)],queryCoverage:[{complete:false,nearestProven:false,emptyProven:false}],issues:[]};};
 service.readNaverWalking=async(_i,_p,{facts})=>{calls.walking++;return {facts:facts.map(v=>({...v,walking:structuredClone(f.walking),routeStatus:'verified'})),routeCoverage:[{placeId:f.fact.placeId,status:'verified'}],issues:[]};};
 const cache={stored:null,snapshot:async(_scope,_name,load,{accept})=>{if(cache.stored&&accept(cache.stored))return structuredClone(cache.stored);calls.loads++;const value=await load();if(accept(value))cache.stored=structuredClone(value);return value;}};service.researchCache=cache;
 return {f,input,prices,calls,service,cache,evidence:{center:{lat:f.identity.lat,lng:f.identity.lng}}};
}
test('service enriches the same public facility with a verified walking route before reuse and presentation',async()=>{
 const t=setup(),r=await t.service.supplementNaver(t.input,t.prices,t.evidence);assert.equal(r.version,'naver-nearby-walk-v2');assert.equal(r.facts[0].walking.distanceM,832);assert.equal(r.queryCoverage[0].nearestProven,false);
 assert.match(require('../src/naver-supplement.cjs').sections({input:t.input,prices:t.prices})[0].body,/네이버 도보 832m · 16분/);
 await t.service.supplementNaver({...t.input,area:84},{...t.prices},t.evidence);assert.deepEqual(t.calls,{nearby:1,walking:1,loads:1});
 t.service.naverNearbyLookups=new Map();await t.service.supplementNaver(t.input,t.prices,t.evidence);assert.deepEqual(t.calls,{nearby:1,walking:1,loads:1});
});
test('legacy text-only snapshots cannot suppress the new same-place walking check',async()=>{
 const t=setup();t.cache.stored={version:'naver-nearby-v1',status:'received',identityCode:t.f.identity.code,asOf:t.input.asOf,facts:[{...t.f.fact,text:'legacy'}]};delete t.cache.stored.facts[0].walking;
 await t.service.supplementNaver(t.input,t.prices,t.evidence);assert.equal(t.calls.walking,1);assert.equal(t.cache.stored.version,'naver-nearby-walk-v2');
});
test('failed walking checks remain diagnostics and cannot become a distance or a successful walking cache',async()=>{
 const t=setup();t.service.readNaverWalking=async(_i,_p,{facts})=>({facts:facts.map(f=>({...f,routeStatus:'unavailable'})),issues:['route not verified']});await t.service.supplementNaver(t.input,t.prices,t.evidence);
 assert.equal(t.cache.stored,null);assert.deepEqual(require('../src/naver-supplement.cjs').sections({input:t.input,prices:t.prices}),[]);assert.ok(!t.prices.naverNearby.facts[0].walking);
});
test('cancelling the walking enrichment aborts the analysis rather than saving a partial success',async()=>{
 const t=setup(),controller=new AbortController();t.service.readNaverWalking=async()=>{controller.abort();throw Error('cancelled walking');};await assert.rejects(t.service.supplementNaver(t.input,t.prices,t.evidence,{signal:controller.signal}),/cancelled walking/);assert.equal(t.cache.stored,null);
});
