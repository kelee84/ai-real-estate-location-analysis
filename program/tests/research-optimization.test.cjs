'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const access=require('../src/living-access.cjs'),shopping=require('../src/shopping.cjs'),research=require('../src/research.cjs'),scoring=require('../src/scoring.cjs');
const {ResearchCache,scope}=require('../src/research-cache.cjs'),{todayKst}=require('../src/core.cjs');
const center={lat:37.56,lng:126.95},asOf=todayKst(),input={asset:'apartment',building:'검증단지',target:'서울 서대문구 가상동 검증단지',types:['trade'],asOf,area:59};
const prices={buildingResolution:{building:input.building,code:'10001',regionCode:'11410',town:'가상동',lot:'1',...center},rows:[],summaries:[],coverage:[]};
const labels={general:'의료,건강 > 병원 > 종합병원',pediatrics:'의료,건강 > 병원 > 소아청소년과',orthopedics:'의료,건강 > 병원 > 정형외과',dental:'의료,건강 > 병원 > 치과',entrance:'교육,학문 > 학원 > 입시학원',korean:'교육,학문 > 학원 > 입시학원 > 국어학원',english:'교육,학문 > 학원 > 영어학원',math:'교육,학문 > 학원 > 입시학원 > 수학학원',art:'교육,학문 > 학원 > 미술학원',music:'교육,학문 > 학원 > 음악학원',sports:'스포츠,레저 > 무예 > 태권도 > 태권도장'};
function place(id,name,label,offset=.002){const p={kakao_place_id:String(id),name,kakao_category_name:label,lat:center.lat+offset,lng:center.lng};return {...p,distance_m:Math.round(access.distance(center,p))};}
const places=Object.fromEntries(access.SPECS.map((s,i)=>[s.key,place(i+100,'검증 '+s.label,labels[s.key])]));
const mart=place(500,'검증 대형마트','가정,생활 > 대형마트'),ssm=place(501,'검증 생활슈퍼','가정,생활 > 슈퍼마켓'),mall=place(502,'검증 쇼핑몰','가정,생활 > 복합쇼핑몰');
function bridge({cap=[],omit=[],pagination=true,error=null}={}){
 const calls=[];return {calls,sessions:0,async evidenceSession(){this.sessions++;return {};},async evidenceTool(_session,tool,args){
  calls.push({tool,args});let d;
  if(error)return {server:'ipzitalk',tool,arguments:args,result:{isError:true,content:[{type:'text',text:JSON.stringify({error})}]}};
  if(tool==='search_by_nearby_category'){
   const groups={hospital:Object.entries(places).filter(([k])=>['general','pediatrics','orthopedics','dental'].includes(k)).map(([,v])=>v),academy:Object.entries(places).filter(([k])=>!['general','pediatrics','orthopedics','dental','sports'].includes(k)).map(([,v])=>v),mart_large:args.radius_m===1500?[ssm,mart]:[mart]};
   const results=Object.fromEntries(args.categories.filter(k=>!omit.includes(k)).map(k=>[k,groups[k]||[]]));
   d={center,radius_m:args.radius_m,results,...(pagination?{pagination_by_category:Object.fromEntries(Object.entries(results).map(([k,v])=>[k,{collected_count:v.length,returned_count:v.length,source_cap_reached:cap.includes(k)}]))}:{}),metadata:{collected_at:new Date().toISOString(),truncated:cap.length>0}};
  }else if(tool==='search_by_nearby_keyword'){
   const spec=access.QUERIES.find(q=>q.query===args.query);d={center,radius_m:args.radius_m,query:args.query,results:spec?[places[spec.key]]:shopping.MART_QUERIES.includes(args.query)?[mart]:shopping.MALL_QUERIES.includes(args.query)?[mall]:[],metadata:{collected_at:new Date().toISOString(),truncated:false}};
  }else if(tool==='get_geocode')d={...center,confidence:'exact',region_code:'1141010100',region:{eupmyeondong:'가상동',jibun:'1'},metadata:{collected_at:new Date().toISOString()}};
  else d={metadata:{collected_at:new Date().toISOString()}};
  return {server:'ipzitalk',tool,arguments:args,result:{structuredContent:d}};
 }};
}
function mockExternal(t){for(const [name,key]of [['school-zone','querySchoolZone'],['regional-park','queryRegionalPark'],['nature-access','query']])t.mock.method(require('../src/'+name+'.cjs'),key,async()=>({status:'unavailable',reason:'외부 공식자료 고정 테스트'}));}
async function temp(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'research-cache-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));return root;}
function evidence(r){return scoring.collectEvidence({input,prices,tools:r.tools,livingAccess:r.livingAccess});}
test('complete verified batches skip covered synonyms and retain explicit batch provenance',async t=>{
 mockExternal(t);const b=bridge(),r=await research.collectResearch(b,input,structuredClone(prices),{onlyScores:true,includeMap:false});
 assert.equal(b.calls.length,6);assert.equal(r.metrics.batchCalls,1);assert.deepEqual(b.calls.filter(c=>c.args.query).map(c=>c.args.query).sort(),access.QUERIES.filter(q=>q.group==='academy').map(q=>q.query).sort());assert.ok(!b.calls.some(c=>shopping.MALL_QUERIES.includes(c.args.query)));assert.ok(b.calls.every(c=>!c.args.categories?.includes('academy')));
 const e=evidence(r);assert.equal(access.current(e,input),true);assert.ok(shopping.current(e,input));assert.equal(e.livingAccess.groups.hospital.categories[0].batch.query,'category:hospital');assert.equal(e.livingAccess.groups.hospital.categories[0].queries[0].checkedAt,undefined);assert.ok(e.livingAccess.groups.academy.categories.every(c=>c.points!=null));
 assert.ok(access.validSnapshot(e.livingAccess,{center,asOf}));assert.ok(shopping.validSnapshot(e.shopping,{center,asOf}));assert.equal(e.shopping.collectionPolicy,shopping.COLLECTION_POLICY);assert.equal(e.shopping.shoppingMall.status,'unavailable');assert.equal(e.shopping.shoppingMall.points,null);assert.equal(e.shopping.shoppingMall.complete,false);
});
test('cold full collection consolidates all supported category scopes into one request',async t=>{
 mockExternal(t);const b=bridge(),r=await research.collectResearch(b,input,structuredClone(prices),{forceRefresh:true,includeMap:false});
 const batches=b.calls.filter(c=>c.tool==='search_by_nearby_category');assert.equal(batches.length,1);assert.equal(batches[0].args.radius_m,5000);assert.deepEqual(batches[0].args.categories,['subway','school_elementary','mart_large','pharmacy','hospital','school']);
 assert.equal(r.metrics.networkCalls,b.calls.length);assert.equal(r.metrics.derivedRecords,2);assert.equal(r.metrics.cacheHits,0);assert.ok(r.tools.some(t=>t.derived&&t.arguments.radius_m===1500));assert.ok(r.tools.some(t=>t.derived&&t.arguments.radius_m===3000));
 assert.deepEqual(r.tools.filter(t=>t.derived).map(t=>t.sourceQuery.arguments),[batches[0].args,batches[0].args]);assert.ok(!b.calls.some(c=>['미술학원','음악학원','체육학원','태권도장'].includes(c.args.query)));
});
test('verified school prefix avoids an otherwise redundant primary-school request while keeping malformed source pagination unchanged',async t=>{
 mockExternal(t);const b=bridge(),send=b.evidenceTool.bind(b);b.evidenceTool=async(...args)=>{const t=await send(...args),d=t.result.structuredContent;if(t.tool==='search_by_nearby_category'&&t.arguments.radius_m===5000){d.results.school=[place(700,'검증초등학교','교육,학문 > 학교 > 초등학교',.001),place(701,'검증중학교','교육,학문 > 학교 > 중학교',.002)];d.results.school_elementary=[d.results.school[0]];d.pagination_by_category.school={returned_count:2,collected_count:2,source_cap_reached:true};d.pagination_by_category.school_elementary={returned_count:1,collected_count:45,source_cap_reached:true};}return t;};
 const r=await research.collectResearch(b,input,structuredClone(prices),{forceRefresh:true,includeMap:false}),batches=b.calls.filter(c=>c.tool==='search_by_nearby_category');assert.equal(batches.length,1);assert.equal(r.metrics.batchCalls,1);assert.ok(!r.tools.some(t=>t.derived&&t.arguments.radius_m===1500&&t.arguments.categories.includes('school_elementary')));assert.equal(r.tools[0].result.structuredContent.pagination_by_category.school_elementary.collected_count,45);const e=evidence(r);assert.equal(e.places.find(p=>p.category==='school_elementary').name,'검증초등학교');
});
test('only capped, missing or unproven category groups receive targeted supplemental queries',async t=>{
 mockExternal(t);
 for(const opts of [{omit:['hospital']},{pagination:false}]){
  const b=bridge(opts),r=await research.collectResearch(b,input,structuredClone(prices),{onlyScores:true});
  assert.ok(b.calls.some(c=>c.args.query==='소아청소년과'));assert.ok(b.calls.some(c=>c.args.query==='종합병원'));
  assert.equal(b.calls.filter(c=>access.QUERIES.some(q=>q.group==='academy'&&q.query===c.args.query)).length,5);
  assert.equal(evidence(r).livingAccess.groups.hospital.categories[0].nearest.id,places.general.kakao_place_id);
 }
 const b=bridge({cap:['academy']}),r=await research.collectResearch(b,input,structuredClone(prices),{onlyScores:true});assert.ok(b.calls.some(c=>c.args.query==='수학학원'));assert.ok(!b.calls.some(c=>c.args.query==='치과'));assert.equal(access.current(evidence(r),input),true);
});
test('same-day public evidence survives restart and another area/customer without network or private data',async t=>{
 mockExternal(t);const root=await temp(t),cache=new ResearchCache(root),firstBridge=bridge(),before=JSON.stringify(prices);
 const first=await research.collectResearch(firstBridge,input,structuredClone(prices),{onlyScores:true,cache}),next={...input,area:84,customer:{name:'CUSTOMER_SECRET',notes:'PRIVATE_SECRET'}};
 const b=bridge({error:'DAILY_TOOL_LIMIT_EXCEEDED'}),again=await research.collectResearch(b,next,structuredClone(prices),{onlyScores:true,cache:new ResearchCache(root)});
 assert.equal(first.metrics.networkCalls,6);assert.deepEqual(firstBridge.calls.filter(c=>c.args.query).map(c=>c.args.query).sort(),access.QUERIES.filter(q=>q.group==='academy').map(q=>q.query).sort());assert.equal(again.metrics.networkCalls,0);assert.equal(again.metrics.cacheHits,6);assert.equal(b.sessions,0);assert.deepEqual(again.livingAccess,first.livingAccess);assert.equal(again.shopping.shoppingMall.status,'unavailable');assert.equal(again.shopping.shoppingMall.points,null);assert.equal(JSON.stringify(prices),before);
 const files=await fs.readdir(cache.root),text=(await Promise.all(files.map(n=>fs.readFile(path.join(cache.root,n),'utf8')))).join('');assert.ok(!/CUSTOMER_SECRET|PRIVATE_SECRET/.test(text));
 const freshBridge=bridge(),refresh=await research.collectResearch(freshBridge,next,structuredClone(prices),{onlyScores:true,cache,forceRefresh:true});assert.equal(refresh.metrics.cacheHits,0);assert.equal(refresh.metrics.networkCalls,6);assert.deepEqual(freshBridge.calls.map(c=>JSON.stringify({tool:c.tool,args:c.args})).sort(),firstBridge.calls.map(c=>JSON.stringify({tool:c.tool,args:c.args})).sort());
});
test('public cache cannot mix days, coordinates, regions, lots, identities or failed responses',async t=>{
 const root=await temp(t),cache=new ResearchCache(root),b=bridge(),args={center_lat:center.lat,center_lng:center.lng,categories:['hospital'],radius_m:1500},s=scope(input,prices),tool=await b.evidenceTool({},'search_by_nearby_category',args);
 await cache.put(s,tool.tool,args,tool);assert.ok(await cache.get(s,tool.tool,args));
 for(const patch of [{day:'2000-01-01'},{code:'other'},{regionCode:'11110'},{town:'다른동'},{lot:'2'},{lat:37.7}])assert.equal(await cache.get({...s,...patch},tool.tool,args),null);
 assert.equal(scope({...input,asOf:'2000-01-01'},prices),null);assert.equal(scope(input,{buildingResolution:{...prices.buildingResolution,regionCode:null}}),null);
 const failed=await bridge({error:'DAILY_TOOL_LIMIT_EXCEEDED'}).evidenceTool({},tool.tool,args),other={...args,radius_m:5000};await cache.put(s,tool.tool,other,failed);assert.equal(await cache.get(s,tool.tool,other),null);
});
test('daily limit stops further requests and is never treated as absent facilities',async t=>{
 mockExternal(t);const b=bridge({error:'DAILY_TOOL_LIMIT_EXCEEDED'}),r=await research.collectResearch(b,input,structuredClone(prices),{onlyScores:true});
 assert.equal(b.calls.length,1);assert.equal(r.metrics.terminalError,'DAILY_TOOL_LIMIT_EXCEEDED');assert.ok(r.metrics.blockedCalls>10);assert.equal(r.livingAccess,null);assert.equal(r.shopping,null);assert.match(r.issues.join(' '),/DAILY_TOOL_LIMIT_EXCEEDED/);
 const again=await research.ensureShoppingEvidence(b,input,prices,{previous:{center,places:[],sources:[]},tools:r.tools});assert.equal(b.calls.length,1);assert.equal(again.evidence.shopping,null);
});
test('compact AI facts keep decision evidence and dates but omit raw candidates, coordinates and queries',async t=>{
 mockExternal(t);const r=await research.collectResearch(bridge(),input,structuredClone(prices),{onlyScores:true}),e=evidence(r),before=JSON.stringify(e),v=research.compactResearch(e);
 assert.ok(v.livingAccess.groups.hospital.categories[0].nearest.sourceId);assert.ok(v.sourceDates.every(s=>s.url));assert.ok(!v.shopping.queries);assert.ok(v.places.every(p=>!Object.hasOwn(p,'lat')));assert.equal(JSON.stringify(e),before);
});
test('quota display uses only observed service limit, clears across login/day, never subtracts a presumed plan',()=>{
 const {IpzitalkUsage}=require('../src/ipzitalk-usage.cjs'),v=new IpzitalkUsage();assert.equal(v.snapshot().remaining,null);
 v.observe({server:'ipzitalk',result:{isError:true,content:[{type:'text',text:'{"error":"DAILY_TOOL_LIMIT_EXCEEDED"}'}]}});assert.equal(v.snapshot().remaining,0);assert.equal(v.snapshot().sessionCalls,1);
 v.observe({server:'ipzitalk',result:{structuredContent:{metadata:{}}}});assert.equal(v.snapshot().remaining,0);assert.equal(v.snapshot().limited,true);
 v.day='2000-01-01';assert.equal(v.snapshot().sessionCalls,0);v.reset();assert.equal(v.snapshot().checkedAt,null);
});
test('all evidence users share the confirmed daily-limit guard without another server request',async()=>{
 const {CodexBridge}=require('../src/codex.cjs'),b=new CodexBridge({});let calls=0;
 b.request=async()=>{calls++;return {isError:true,content:[{type:'text',text:'{"error":"DAILY_TOOL_LIMIT_EXCEEDED"}'}]};};
 const session={threadId:'fixed',tools:{search_by_nearby_category:{},get_map_embed_url:{}}};
 await b.evidenceTool(session,'search_by_nearby_category',{});const skipped=await b.evidenceTool(session,'get_map_embed_url',{});assert.equal(calls,1);assert.equal(skipped.networkSkipped,true);assert.equal(b.ipzitalkUsage.snapshot().sessionCalls,1);
});
test('capped intact distance prefixes may prove a nearest facility, but empty or unsorted prefixes do not',async t=>{
 mockExternal(t);const b=bridge({cap:['hospital','academy','mart_large']}),r=await research.collectResearch(b,input,structuredClone(prices),{onlyScores:true});assert.equal(b.calls.length,6);assert.deepEqual(b.calls.filter(c=>c.args.query).map(c=>c.args.query).sort(),access.QUERIES.filter(q=>q.group==='academy').map(q=>q.query).sort());const e=evidence(r);assert.equal(access.current(e,input),true);assert.equal(e.livingAccess.groups.hospital.categories[0].batch.nearestProven,true);assert.equal(e.livingAccess.groups.hospital.categories[0].limited,true);assert.equal(e.livingAccess.groups.hospital.categories[0].complete,false);assert.equal(e.shopping.shoppingMall.status,'unavailable');assert.equal(e.shopping.shoppingMall.points,null);
 const t1=r.tools.find(t=>t.arguments.radius_m===5000),bad=structuredClone(t1);bad.result.structuredContent.results.hospital.reverse();bad.result.structuredContent.results.hospital[0].distance_m=900;assert.equal(access.batchRecord([bad],access.SPECS[0],center,asOf)?.nearestProven,false);
 const empty=structuredClone(t1);empty.result.structuredContent.results.hospital=[];empty.result.structuredContent.pagination_by_category.hospital={collected_count:0,returned_count:0,source_cap_reached:false};assert.equal(access.usableRecord(access.batchRecord([empty],access.SPECS[0],center,asOf)),false);
 const snap=access.snapshot([empty],{center,asOf});assert.equal(snap.groups.hospital.categories[0].status,'unavailable');assert.equal(snap.groups.hospital.categories[0].points,null);
});
test('official snapshot cache keeps successful public proof, rejects mismatched scope and honors explicit refresh',async t=>{
 const cache=new ResearchCache(await temp(t)),s=scope(input,prices);let n=0;const load=async()=>({status:'verified',checkedAt:new Date().toISOString(),value:++n});
 const a=await cache.snapshot(s,'nature',load),b=await cache.snapshot(s,'nature',load);assert.equal(a.value,b.value);assert.equal(n,1);
 await cache.snapshot({...s,lot:'different'},'nature',load);assert.equal(n,2);await cache.snapshot(s,'nature',load,{forceRefresh:true});assert.equal(n,3);
});
module.exports={bridge,input,prices,center};
test('same-day nature cache preserves every verified trail and repairs invalid distance proof before reuse',async t=>{
 mockExternal(t);const nature=require('../src/nature-access.cjs'),cache=new ResearchCache(await temp(t)),s=scope(input,prices),point={lat:center.lat+.001,lng:center.lng},checkedAt=new Date().toISOString();
 const snapshot={version:nature.VERSION,asOf,center,checkedAt,status:'verified',trails:[1,2].map((id,index)=>({id:String(id),name:'검증 산책로 '+id,kind:'registered-trail',pointRole:'등록 시설 기준점',...point,distanceM:Math.round(access.distance(center,point)),source:{id:'trail-'+id,url:'https://place.map.kakao.com/'+id,checkedAt}}))};
 assert.equal(nature.verified(snapshot,{center,asOf}),true);await cache.snapshot(s,'natureAccess',async()=>snapshot,{accept:()=>true});let reloads=0;t.mock.method(nature,'query',async()=>{reloads++;return structuredClone(snapshot);});
 const first=await research.collectResearch(bridge(),input,structuredClone(prices),{cache,includeMap:false});assert.equal(reloads,0);assert.deepEqual(first.natureAccess.trails,snapshot.trails);
 const invalid=structuredClone(snapshot);invalid.trails[0].distanceM=2999;assert.equal(nature.current(invalid,{center,asOf}),true);assert.equal(nature.verified(invalid,{center,asOf}),false);await cache.snapshot(s,'natureAccess',async()=>invalid,{forceRefresh:true,accept:()=>true});
 const repaired=await research.collectResearch(bridge(),input,structuredClone(prices),{cache:new ResearchCache(path.dirname(cache.root)),includeMap:false});assert.equal(reloads,1);assert.equal(nature.verified(repaired.natureAccess,{center,asOf}),true);assert.deepEqual(repaired.natureAccess.trails,snapshot.trails);
});
