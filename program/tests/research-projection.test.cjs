'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {projectCategory,elementarySchoolProof}=require('../src/research-projection.cjs'),{createQuery}=require('../src/research-query.cjs'),access=require('../src/living-access.cjs'),{todayKst}=require('../src/core.cjs');
const center={lat:37.56,lng:126.95},asOf=todayKst(),input={asOf},prices={},baseArgs={center_lat:center.lat,center_lng:center.lng,categories:['hospital','school'],radius_m:5000};
function place(id,offset){const c={lat:center.lat+offset,lng:center.lng};return {kakao_place_id:String(id),name:'시설 '+id,kakao_category_name:'의료,건강 > 병원 > 치과',...c,distance_m:Math.round(access.distance(center,c))};}
function source({cap=false}={}){const results={hospital:[place(1,.002),place(2,.02)],school:[]};return {server:'ipzitalk',tool:'search_by_nearby_category',arguments:{...baseArgs},result:{structuredContent:{center,radius_m:5000,results,pagination_by_category:Object.fromEntries(Object.entries(results).map(([k,rows])=>[k,{collected_count:rows.length,returned_count:rows.length,source_cap_reached:cap}])),metadata:{collected_at:new Date().toISOString(),truncated:cap}}}};}
const project=t=>projectCategory(t,{radiusM:1500,categories:['hospital','school'],asOf});
test('one verified wider response projects smaller original scopes without another network call',async()=>{
 let sent=0;const original=source(),before=JSON.stringify(original),out={tools:[],checks:[],issues:[]},bridge={async evidenceSession(){return {};},async evidenceTool(){sent++;return original;}};
 const q=createQuery(bridge,input,prices,{out});await q.call(original.tool,baseArgs,true);const small=await q.call(original.tool,{...baseArgs,categories:['hospital'],radius_m:1500},true);
 assert.equal(sent,1);assert.equal(q.metrics.networkCalls,1);assert.equal(q.metrics.derivedRecords,2);assert.equal(small.derived,true);assert.equal(small.researchNetworkAttempt,false);assert.equal(small.result.structuredContent.results.hospital.length,1);assert.deepEqual(small.sourceQuery.arguments,baseArgs);assert.equal(JSON.stringify(original),before);
 const proof=access.queryRecord(small,{category:'hospital',radiusM:1500,key:'dental'},center,asOf);assert.equal(proof.nearestProven,true);assert.equal(proof.truncated,false);assert.equal(proof.returned,1);
});
test('a capped category prefix preserves its limit and never proves a missing subtype or empty set',()=>{
 const projected=project(source({cap:true})),data=projected.result.structuredContent;assert.equal(data.pagination_by_category.hospital.source_cap_reached,true);
 const dental=access.queryRecord(projected,{category:'hospital',radiusM:1500,key:'dental'},center,asOf);assert.equal(dental.nearestProven,true);assert.equal(dental.truncated,true);
 const general=access.queryRecord(projected,{category:'hospital',radiusM:1500,key:'general'},center,asOf);assert.equal(general.nearestProven,false);assert.equal(access.usableRecord(general),false);
 const empty=access.queryRecord(projected,{category:'school',radiusM:1500,key:'general'},center,asOf);assert.equal(access.completeRecord(empty),false);
});
test('malformed pagination, wrong coordinates/day/distances or unsorted capped rows cannot be projected',()=>{
 const mutations=[t=>delete t.result.structuredContent.pagination_by_category.hospital,t=>{t.result.structuredContent.pagination_by_category.hospital.collected_count++;},t=>{t.result.structuredContent.center={lat:35,lng:129};},t=>{t.result.structuredContent.metadata.collected_at='2000-01-01T00:00:00Z';},t=>{t.result.structuredContent.results.hospital[0].distance_m=800;},t=>{t.result.structuredContent.results.hospital.reverse();}];
 for(const mutate of mutations){const t=source({cap:true});mutate(t);const p=project(t);assert.ok(!p||!p.result.structuredContent.results.hospital);}
 const failed=source();failed.result.isError=true;assert.equal(project(failed),null);
});
test('a partial response projects only categories whose own pagination is intact',()=>{
 const t=source();delete t.result.structuredContent.pagination_by_category.hospital;const p=project(t);assert.deepEqual(p.arguments.categories,['school']);assert.deepEqual(p.result.structuredContent.results,{school:[]});
});
function schoolSource(){const t=source({cap:true}),d=t.result.structuredContent;d.results.school=[{...place(20,.001),name:'검증초등학교',kakao_category_name:'교육,학문 > 학교 > 초등학교'},{...place(21,.002),name:'검증중학교',kakao_category_name:'교육,학문 > 학교 > 중학교'}];d.pagination_by_category.school={returned_count:2,collected_count:2,source_cap_reached:true};return t;}
test('strict unfiltered school prefix reuses a positive nearby primary school without accepting malformed elementary pagination',()=>{
 const t=schoolSource(),d=t.result.structuredContent;d.results.school_elementary=[d.results.school[0]];d.pagination_by_category.school_elementary={returned_count:1,collected_count:45,source_cap_reached:true};
 assert.equal(projectCategory(t,{radiusM:1500,categories:['school_elementary'],asOf}),null);
 const projected=projectCategory(t,{radiusM:3000,categories:['school'],asOf}),proof=elementarySchoolProof([projected],{center,asOf});assert.equal(proof.nearest.name,'검증초등학교');assert.equal(proof.record.nearestProven,true);assert.equal(proof.record.truncated,true);assert.equal(proof.record.category,'school');assert.equal(projected.arguments.radius_m,3000);assert.ok(!projected.arguments.categories.includes('school_elementary'));
});
test('empty, distant, closed, unsorted, malformed, wrong-day or failed school prefixes cannot suppress the primary-school lookup',()=>{
 const mutators=[t=>{t.result.structuredContent.results.school=[];t.result.structuredContent.pagination_by_category.school={returned_count:0,collected_count:0,source_cap_reached:true};},t=>{t.result.structuredContent.results.school=t.result.structuredContent.results.school.map((p,i)=>({...p,...place(20+i,.02+i*.001)}));},t=>{t.result.structuredContent.results.school[0].name='예정초등학교';},t=>{t.result.structuredContent.results.school.reverse();},t=>{t.result.structuredContent.pagination_by_category.school.collected_count=45;},t=>{t.result.structuredContent.metadata.collected_at='2000-01-01T00:00:00Z';},t=>{t.result.isError=true;}];
 for(const mutate of mutators){const t=schoolSource();mutate(t);const p=projectCategory(t,{radiusM:3000,categories:['school'],asOf});assert.equal(elementarySchoolProof(p?[p]:[],{center,asOf}),null);}
});
