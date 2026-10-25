'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {snapshot,context}=require('./sbiz-evidence.test.cjs');
const access=require('../src/living-access.cjs'),sbiz=require('../src/sbiz-evidence.cjs'),shopping=require('../src/shopping.cjs'),research=require('../src/research.cjs'),scoring=require('../src/scoring.cjs'),enrichment=require('../src/sbiz-enrichment.cjs');
const {center,asOf,identity}=context,input={asset:'apartment',building:'검증단지',target:'서울특별시 서대문구 천연동 검증단지',types:['trade'],asOf,area:59};
const prices=s=>({buildingResolution:{...identity,building:input.building},rows:[],summaries:[],coverage:[],...(s?{sbizSnapshot:s}:{})});
const labels={general:'의료,건강 > 병원 > 종합병원',pediatrics:'의료,건강 > 병원 > 소아청소년과',orthopedics:'의료,건강 > 병원 > 정형외과',dental:'의료,건강 > 병원 > 치과',entrance:'교육,학문 > 학원 > 입시학원',korean:'교육,학문 > 학원 > 국어학원',english:'교육,학문 > 학원 > 영어학원',math:'교육,학문 > 학원 > 수학학원'};
function place(id,name,label,offset=.004){const p={kakao_place_id:String(id),name,kakao_category_name:label,lat:center.lat+offset,lng:center.lng};return {...p,distance_m:Math.round(access.distance(center,p))};}
const facilities=Object.fromEntries(access.SPECS.map((s,i)=>[s.key,place(100+i,'검증 '+s.label,labels[s.key])])),mart=place(500,'검증 대형마트','가정,생활 > 대형마트'),ssm=place(501,'검증 생활슈퍼','가정,생활 > 슈퍼마켓');
function bridge({hospitalMalformed=false,daily=false}={}){
 const calls=[];return {calls,async evidenceSession(){return {};},async evidenceTool(_session,tool,args){
  calls.push({tool,args});const metadata={collected_at:snapshot().checkedAt,truncated:false};let data;
  if(tool==='search_by_nearby_category'){
   const groups={hospital:['general','pediatrics','orthopedics','dental'].map(k=>facilities[k]),mart_large:daily?[mart,ssm]:[mart]};
   const results=Object.fromEntries(args.categories.filter(k=>!hospitalMalformed||k!=='hospital').map(k=>[k,groups[k]||[]]));
   data={center,radius_m:args.radius_m,results,pagination_by_category:Object.fromEntries(Object.entries(results).map(([k,rows])=>[k,{returned_count:rows.length,collected_count:rows.length,source_cap_reached:false}])),metadata};
  }else if(tool==='search_by_nearby_keyword'){
   const spec=access.QUERIES.find(s=>s.query===args.query);data={center,radius_m:args.radius_m,query:args.query,results:spec?[facilities[spec.key]]:shopping.MART_QUERIES.includes(args.query)?[mart]:[],metadata};
  }else throw Error('Unexpected test call: '+tool);
  return {server:'ipzitalk',tool,arguments:args,result:{structuredContent:data}};
 }};
}
async function collect(s,options={}){const b=bridge(options),p=prices(s),r=await research.collectResearch(b,input,p,{onlyScores:true,includeMap:false,...(options.initialTools?{initialTools:options.initialTools}:{})});return {b,p,r};}
const keywordNames=b=>b.calls.filter(c=>c.tool==='search_by_nearby_keyword').map(c=>c.args.query);
test('collector omits exactly two entrance synonyms while preserving subject and hospital collection',async()=>{
 for(const hospitalMalformed of [false,true]){
  const baseline=await collect(null,{hospitalMalformed}),publicRun=await collect(snapshot(),{hospitalMalformed});
  assert.deepEqual(keywordNames(publicRun.b),keywordNames(baseline.b).filter(q=>!['입시학원','보습학원'].includes(q)));
  assert.equal(baseline.r.metrics.networkCalls-publicRun.r.metrics.networkCalls,2);
  assert.deepEqual(keywordNames(publicRun.b).filter(q=>['국어학원','영어학원','수학학원'].includes(q)),['국어학원','영어학원','수학학원']);
  assert.deepEqual(publicRun.b.calls.filter(c=>c.tool==='search_by_nearby_category'),baseline.b.calls.filter(c=>c.tool==='search_by_nearby_category'));
  assert.equal(publicRun.r.metrics.networkCalls,publicRun.b.calls.length);assert.equal(publicRun.r.metrics.sbizEntranceReused,1);
  assert.ok(publicRun.r.tools.every(t=>t.server==='ipzitalk'));assert.equal(publicRun.r.livingAccess.groups.academy.categories[0].queries.length,0);
  const assessed=scoring.assessScores({scores:[]},{input,prices:publicRun.p,tools:publicRun.r.tools});
  assert.equal(assessed.scores.find(s=>s.name==='학원 환경').coverage,100);assert.equal(assessed.scores.find(s=>s.name==='병원 환경').coverage,100);
  assert.equal(assessed.assessment.evidence.livingAccess.groups.academy.categories[0].nearest.provider,'sbiz-csv');
 }
});
test('empty, expired, invalid-source and wrong-property public data restore both entrance queries',async()=>{
 for(const change of [s=>s.groups.entrance.rows=[],s=>s.sourceDate='2025-01-01',s=>s.sourceUrl='https://example.com/data',s=>s.identity.code='other-property']){
  const s=snapshot();change(s);const {b,r}=await collect(s);
  assert.deepEqual(keywordNames(b).filter(q=>['입시학원','보습학원'].includes(q)),['입시학원','보습학원']);
  assert.notEqual(r.livingAccess.groups.academy.categories[0].nearest.provider,'sbiz-csv');assert.equal(r.metrics.sbizEntranceReused,undefined);
 }
});
test('already collected valid Ipji entrance proof remains preferred over quarterly public registration',async()=>{
 const source=bridge(),initialTools=[];
 for(const query of ['입시학원','보습학원'])initialTools.push(await source.evidenceTool({},'search_by_nearby_keyword',{center_lat:center.lat,center_lng:center.lng,query,radius_m:1500}));
 const {b,r}=await collect(snapshot(),{initialTools}),category=r.livingAccess.groups.academy.categories[0];
 assert.ok(!keywordNames(b).some(q=>['입시학원','보습학원'].includes(q)));assert.equal(category.nearest.id,facilities.entrance.kakao_place_id);assert.equal(category.nearest.provider,undefined);assert.equal(category.queries.length,2);assert.equal(category.publicEvidence,undefined);
});
test('public supermarket supplements its 35% only and cannot become a large mart',()=>{
 const p=prices(snapshot()),result=scoring.assessScores({scores:[]},{input,prices:p}),e=result.assessment.evidence,score=result.scores.find(s=>s.name==='상권 환경');
 assert.equal(e.places.filter(p=>p.provider==='sbiz-csv').length,1);assert.equal(e.places[0].category,'supermarket');assert.equal(shopping.eligibleMart(e.places[0]),false);assert.equal(score.coverage,35);assert.equal(score.calculation.length,1);assert.equal(score.calculation[0].indicator,'일상 슈퍼마켓 접근');assert.ok(shopping.dailyCurrent(e,input));
 const publicSource=result.sources.find(s=>s.id===e.places[0].sourceId);assert.equal(publicSource.sourceDate,'2026-06-30');
});
test('modified public proof cannot contribute supermarket points during saved-report reconstruction',()=>{
 const first=scoring.assessScores({scores:[]},{input,prices:prices(snapshot())}),e=structuredClone(first.assessment.evidence);
 e.places[0].rawRecord['상권업종소분류코드']='G99999';e.dailyShopping.nearest.rawRecord['상권업종소분류코드']='G99999';
 assert.equal(shopping.dailyCurrent(e,input),false);
 const result=scoring.assessScores({scores:[]},{input,prices:prices(null),previousEvidence:e});
 assert.equal(result.scores.find(s=>s.name==='상권 환경').score,null);assert.equal(result.scores.find(s=>s.name==='상권 환경').coverage,0);
 const invalid=snapshot();invalid.groups.supermarket.rows[0]['위도']='38';assert.equal(sbiz.nearest(invalid,'supermarket',context),null);const direct={center,identity,places:[],sources:[]};enrichment.attach(direct,invalid,{identity,asOf});assert.deepEqual(direct.places,[]);
});
test('valid current daily Ipji supermarket survives public supplementation unchanged',async()=>{
 const b=bridge({daily:true}),t=await b.evidenceTool({},'search_by_nearby_category',{center_lat:center.lat,center_lng:center.lng,categories:['mart_large'],radius_m:1500});
 const e=scoring.collectEvidence({input,prices:prices(null),tools:[t]}),before=structuredClone(e.places),daily=structuredClone(e.dailyShopping);
 assert.ok(shopping.dailyCurrent(e,input));enrichment.attach(e,snapshot(),{identity,asOf});
 assert.deepEqual(e.places,before);assert.deepEqual(e.dailyShopping,daily);assert.ok(e.places.some(p=>p.name===ssm.name&&p.provider!=='sbiz-csv'));assert.ok(!e.places.some(p=>p.provider==='sbiz-csv'));
});
