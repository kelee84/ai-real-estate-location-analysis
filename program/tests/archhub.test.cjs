'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),{EventEmitter}=require('node:events');
const api=require('../src/archhub.cjs'),{todayKst}=require('../src/core.cjs'),{fixtures}=require('./fixtures/archhub-ledger.json');
const {AnalysisService}=require('../src/service.cjs'),overview=require('../src/apartment-overview.cjs'),parking=require('../src/parking-presentation.cjs');
const day=todayKst(),fresh=n=>({...structuredClone(fixtures[n].record),checkedAt:new Date().toISOString()}),input={asset:'apartment',asOf:day},prices=n=>({buildingResolution:structuredClone(fixtures[n].identity)});
test('actual aggregate ledger preserves totals and approval without summing building rows',()=>{
 const record=api.normalize(fresh(0),{identity:fixtures[0].identity,asOf:day});assert.deepEqual(record.basic,{units:1008,parkingSpaces:789,approvalDate:'2006-03-23'});assert.equal(api.complete(record),true);
 const partial=api.normalize(fresh(2),{identity:fixtures[2].identity,asOf:day});assert.equal(partial.basic.units,1252);assert.equal(partial.basic.parkingSpaces,1988);assert.equal(partial.basic.approvalDate,undefined);assert.equal(api.complete(partial),false);
 assert.equal(api.verified(fresh(1),{identity:fixtures[1].identity,asOf:day}),null);
});
test('wrong identities, raw totals, old registers, dates, partial tables and changed columns cannot become facts',()=>{
 const r=fresh(0),i=fixtures[0].identity;
 for(const mutate of [r=>r.identityKey='other',r=>r.endpoint='https://example.com',r=>r.checkedAt='2000-01-01',r=>r.checkedAt=new Date(Date.now()+86400000).toISOString(),r=>r.raw.ledger=r.raw.ledger.replace('全','other').replace('전체 1건','전체 2건'),r=>r.raw.ledger=r.raw.ledger.replace('신대장','구대장'),r=>r.raw.ledger=r.raw.ledger.replace('천연뜨란채','다른단지명'),r=>r.raw.ledger+='...',r=>r.raw.region=r.raw.region.replace('10600','10700')]){const value=structuredClone(r);mutate(value);assert.equal(api.verified(value,{identity:i,asOf:day}),null);}
 for(const change of [{code:'wrong'},{lot:'146'},{regionCode:'11110'},{town:'다른동'}])assert.equal(api.verified(r,{identity:{...i,...change},asOf:day}),null);
});
test('persistent cache reuses raw proofs across services, areas and customers, including ambiguous results',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'archhub-test-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));let calls=0;
 for(const index of [0,1,2]){
  const record=fresh(index),client={async call(tool){calls++;return record.raw[tool==='find_region'?'region':'ledger'];}},store=new api.Store(root,{client});
  const first=await store.ensure(input,prices(index));assert.equal(calls,(index+1)*2);assert.equal(!!first,index!==1);
  const restart=new api.Store(root,{client:{call(){throw Error('Network must not be called');}}});
  assert.deepEqual(await restart.ensure({...input,area:59,customer:{memo:'PRIVATE'}},prices(index)),first);
  for(const file of await fs.readdir(path.join(root,'archhub-cache')))assert.doesNotMatch(await fs.readFile(path.join(root,'archhub-cache',file),'utf8'),/PRIVATE|customer/);
 }
});
test('same-run duplicate queries share a promise; explicit refresh and next-day records require lookup',async()=>{
 let calls=0;const r=fresh(0),client={async call(tool){calls++;return r.raw[tool==='find_region'?'region':'ledger'];}},store=new api.Store(null,{client}),p=prices(0);
 const values=await Promise.all([store.ensure(input,p),store.ensure({...input,area:84},p)]);assert.equal(calls,2);assert.deepEqual(values[0],values[1]);values[0].basic.units=1;assert.equal(values[1].basic.units,1008);
 store.begin();await store.ensure(input,p,{forceRefresh:true});assert.equal(calls,4);
 store.memory.get(api.identityKey(p.buildingResolution)).checkedAt='2000-01-01';store.begin();await store.ensure(input,p);assert.equal(calls,6);
 assert.equal(await store.ensure({...input,asOf:'2000-01-01'},p),null);assert.equal(calls,6);
});
test('transient errors never become successful or persistently empty responses',async()=>{
 let calls=0;const store=new api.Store(null,{client:{call(){calls++;throw Error('unavailable');}}});
 await assert.rejects(store.ensure(input,prices(0)));await assert.rejects(store.ensure(input,prices(0)));assert.equal(calls,1);store.begin();await assert.rejects(store.ensure(input,prices(0)));assert.equal(calls,2);assert.equal(store.memory.size,0);
});
test('client initializes MCP then reads SSE/JSON; errors and oversized results are rejected',async()=>{
 const seen=[],client=new api.Client({fetcher:async(url,options)=>{assert.equal(url,api.URL);const q=JSON.parse(options.body);seen.push(q);if(!q.id)return new Response(null,{status:202});const result=q.method==='initialize'?{protocolVersion:'2025-03-26'}:{structuredContent:{result:'test response'}};return new Response('event: message\ndata: '+JSON.stringify({jsonrpc:'2.0',id:q.id,result})+'\n\n',{headers:{'content-type':'text/event-stream'}});}});
 assert.equal(await client.call('find_region',{keyword:'test'}),'test response');assert.deepEqual(seen.map(s=>s.method),['initialize','notifications/initialized','tools/call']);assert.equal(seen.at(-1).params.name,'find_region');
 const bad=new api.Client({fetcher:async()=>new Response('unavailable',{status:503})});await assert.rejects(bad.call('find_region',{}),/503/);
});
function member(){const p=prices(0);p.archhub=api.normalize(fresh(0),{identity:p.buildingResolution,asOf:day});p.naverLand={complexNo:'11567',name:p.buildingResolution.building,addressJibun:'서울특별시 서대문구 천연동 145',sourceUrl:'https://fin.land.naver.com/complexes/11567',checkedAt:new Date().toISOString(),basic:{units:1008,parkingSpaces:1161,approvalDate:'2006-03-13'}};return {input:{...input,building:p.buildingResolution.building,target:'서울특별시 서대문구 천연동 천연뜨란채',types:['trade']},prices:p};}
test('all report formats use the same official facts and disclose conflicting Naver records',()=>{
 const m=member(),data=overview.data(m),p=parking.snapshot(m);assert.equal(p.total,789);assert.equal(p.units,1008);assert.equal(p.perUnit,789/1008);assert.match(p.sourceName,/건축HUB/);assert.equal(data.properties[0].facts.approval,'2006-03-23');assert.match(data.notes.join(' '),/주차대수 건축물대장 789대 \/ 네이버 1161대/);assert.match(data.notes.join(' '),/사용승인일 건축물대장 2006-03-23 \/ 네이버 2006-03-13/);
 const e=require('../src/scoring.cjs').collectEvidence({input:m.input,prices:m.prices});assert.equal(e.archhub.basic.units,1008);assert.equal(e.basic,null);assert.ok(e.sources.some(s=>s.id===e.archhub.sourceId));
});
test('current supplements never change a historical turnover denominator or overwrite saved contracts',()=>{
 const m=member(),record=m.prices.archhub;delete m.prices.archhub;m.input.asOf='2020-01-01';delete m.prices.naverLand;m.archhubSnapshot={version:api.VERSION,identityKey:api.identityKey(m.prices.buildingResolution),record};const facts=overview.data(m).properties[0].facts;assert.equal(facts.units,1008);assert.equal(facts.turnoverUnits,null);assert.equal(parking.snapshot(m).total,789);assert.match(overview.data(m).notes.join(' '),/2020-01-01/);
});
test('complete Archhub records avoid Naver basic downloads and never call Ipzitalk; partial data retains Naver fallback',async()=>{
 const service=new AnalysisService({bridge:new EventEmitter(),onEvent:()=>{}}),m=member();let calls=0;
 service.findNaverComplex=async()=>{calls++;return m.prices.naverLand;};service.archhubStore={ensure:async()=>m.prices.archhub};
 const p={buildingResolution:m.prices.buildingResolution};await service.reuseComplexBasics(input,p);assert.equal(calls,0);assert.equal(p.archhub.basic.units,1008);
 service.archhubStore={ensure:async()=>null};await service.reuseComplexBasics(input,{buildingResolution:m.prices.buildingResolution});assert.equal(calls,1);
});
test('a partial Naver record with counts but no approval date is completed from the actual page',async()=>{
 const service=new AnalysisService({bridge:new EventEmitter(),onEvent:()=>{}}),m=member();let calls=0;const incomplete=structuredClone(m.prices.naverLand);delete incomplete.basic.approvalDate;
 const p={buildingResolution:m.prices.buildingResolution,naverLand:incomplete};service.findNaverComplex=async()=>{calls++;return m.prices.naverLand;};await service.reuseNaverLand(input,p);assert.equal(calls,1);assert.equal(p.naverLand.basic.approvalDate,'2006-03-13');
});
test('saved-report projection binds Archhub supplements to the original bytes and exports without repeated lookups',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'archhub-report-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const {ReportStore}=require('../src/store.cjs'),store=new ReportStore(path.join(root,'reports')),m=member(),record=m.prices.archhub;delete m.prices.archhub;
 Object.assign(m,{title:'Archived report',createdAt:new Date().toISOString(),scores:[],sources:[],sections:[],highlights:[],checks:[],limitations:[],strengths:[],assessment:{version:require('../src/scoring.cjs').VERSION,evidence:{identity:m.prices.buildingResolution,sources:[]}}});
 const report=await store.save(m),file=path.join(store.path(report.id),'report.json'),before=await fs.readFile(file);let calls=0;
 const service=new AnalysisService({bridge:new EventEmitter(),store,userData:root,onEvent:()=>{}});service.archhubStore={ensure:async()=>{calls++;return record;}};
 const out=await service.presentationReport(report.id);assert.equal(calls,1);assert.equal(parking.snapshot(out).total,789);assert.deepEqual(await fs.readFile(file),before);
 const restarted=new AnalysisService({bridge:new EventEmitter(),store,userData:root,onEvent:()=>{}});restarted.archhubStore={ensure(){throw Error('Unexpected repeat');}};
 const again=await restarted.presentationReport(report.id);assert.equal(parking.snapshot(again).total,789);assert.deepEqual(again.input,report.input);assert.equal(calls,1);
 const sidecar=JSON.parse(await fs.readFile(path.join(store.path(report.id),'raw/report-basics.json'),'utf8'));assert.equal(sidecar.archhubMembers.length,1);assert.ok(sidecar.sourceReportSha256);assert.equal(sidecar.reportId,report.id);
});
