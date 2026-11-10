'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {todayKst}=require('../src/core.cjs'),scoring=require('../src/scoring.cjs'),research=require('../src/research.cjs');
const {AnalysisService}=require('../src/service.cjs'),{scope}=require('../src/research-cache.cjs');
const day=todayKst(),input={asset:'apartment',target:'인천광역시 연수구 송도동 대상아파트',building:'대상아파트',types:['trade'],asOf:day,request:''};
const identity={code:'20200001',building:'대상아파트',province:'인천광역시',region:'연수구',regionCode:'28185',town:'송도동',lot:'1-1'};
const center={lat:37.4,lng:126.64};
const saved=()=>({complexNo:'12345',name:identity.building,addressJibun:'인천광역시 연수구 송도동 1-1',...center,coordinateBasis:'complex',checkedAt:new Date().toISOString(),sourceUrl:'https://new.land.naver.com/complexes/12345',basic:{units:500,approvalDate:'2014-08-29'}});
const prices=()=>({buildingResolution:{...identity},rows:[],naverLand:saved()});
function bridge(){return {calls:[],async evidenceSession(){return {};},async evidenceTool(session,tool,args){this.calls.push({tool,args});let data={center,radius_m:args.radius_m,results:{},metadata:{collected_at:new Date().toISOString()}};if(tool==='get_geocode')data={...center,confidence:'exact',address:'인천광역시 연수구 송도동 1-1',region_code:'2818510600',region:{sido:'인천광역시',sigungu:'연수구',eupmyeondong:'송도동',jibun:'1-1'},metadata:data.metadata};return {server:'ipzitalk',tool,arguments:args,result:{structuredContent:data}};}};}
test('matched Naver center prevents redundant geocode and K-apt lookup without fabricating facility proof',async()=>{
 const b=bridge(),p=prices(),result=await research.collectResearch(b,input,p,{onlyScores:true,includeMap:false});
 assert.equal(b.calls.filter(c=>/get_geocode|get_complex_info_by_query/.test(c.tool)).length,0);
 assert.equal(result.metrics.naverReused,1);assert.equal(result.metrics.networkCalls,b.calls.length);
 assert.ok(b.calls.some(c=>c.tool==='search_by_nearby_category'));
 const proof=scoring.collectEvidence({input,prices:p,tools:result.tools});assert.deepEqual(proof.center,center);assert.equal(proof.centerSource.provider,'네이버 부동산');
 assert.equal(proof.basic,null);assert.equal(proof.naverLand.basic.units,500);assert.ok(proof.sources.some(s=>s.title.startsWith('네이버 부동산')&&s.url===p.naverLand.sourceUrl));
 assert.equal(proof.livingAccess,null);assert.deepEqual(proof.places,[]);
 assert.ok(scope(input,p));assert.equal(scope(input,{...p,naverLand:{...p.naverLand,addressJibun:'인천광역시 연수구 송도동 2-1'}}),null);
});
test('explicit refresh and wrong-address snapshots use actual geocode fallback',async()=>{
 for(const options of [{forceRefresh:true},{wrong:true}]){
  const b=bridge(),p=prices();if(options.wrong)p.naverLand.addressJibun='인천광역시 연수구 송도동 2-1';
  const result=await research.collectResearch(b,input,p,{onlyScores:true,includeMap:false,forceRefresh:!!options.forceRefresh});
  assert.equal(b.calls.filter(c=>c.tool==='get_geocode').length,1);assert.equal(result.metrics.naverReused,undefined);
 }
});
test('official location remains primary and Naver IDs never become official/K-apt codes',()=>{
 const p=prices();p.buildingResolution={...identity,lat:center.lat+0.0001,lng:center.lng};
 const e=scoring.collectEvidence({input,prices:p});assert.equal(e.center.lat,p.buildingResolution.lat);assert.equal(e.identity.code,identity.code);assert.equal(e.naverLand.complexNo,'12345');assert.equal(e.basic,null);assert.equal(e.centerSource,undefined);
});
test('service connects imports to searches and per-area evidence; forced refresh removes imported snapshot',async()=>{
 const service=new AnalysisService({bridge:new EventEmitter(),onEvent:()=>{}}),record=saved();record.customer={notes:'PRIVATE_SECRET'};
 const imported=await service.importNaverLand(record);assert.equal(imported.address,record.addressJibun);
 const result=await service.searchProperties({...input,target:'대상아파트',building:''});assert.equal(result.candidates[0].id,'naver-12345');assert.match(result.sourceName,/네이버/);
 const p={buildingResolution:{...identity}};await service.reuseNaverLand(input,p);assert.equal(p.naverLand.complexNo,'12345');assert.ok(!JSON.stringify(p.naverLand).includes('PRIVATE_SECRET'));
 await service.reuseNaverLand({...input,area:84,customer:{notes:'OTHER'}},p);assert.equal(p.naverLand.complexNo,'12345');
 await service.reuseNaverLand(input,p,{forceRefresh:true});assert.equal(p.naverLand,undefined);
});
test('living evidence refresh forwards forceRefresh and does not reuse score-only mode',async()=>{
 let received;const previous=scoring.collectEvidence({input,prices:prices()});
 const result=await research.ensureLivingEvidence({},input,prices(),{previous,forceRefresh:true,collect:async(b,i,p,opts)=>{received=opts;return {tools:[],checks:[],issues:[]};}});
 assert.equal(received.forceRefresh,true);assert.equal(received.onlyScores,false);assert.equal(result.refreshed,true);
});
test('link import reads the actual page once and leaves the service idle after failure or success',async()=>{
 const service=new AnalysisService({bridge:new EventEmitter(),onEvent:()=>{}});let n=0;
 service.readNaverPage=async(url,{signal})=>{n++;assert.equal(url,saved().sourceUrl);assert.equal(signal.aborted,false);return saved();};
 const record=await service.importNaverLink(saved().sourceUrl);assert.equal(record.name,identity.building);assert.equal(n,1);assert.equal(service.active,null);
 assert.equal((await service.naverStore.list(day)).length,1);
 service.readNaverPage=async()=>{throw new Error('페이지 내용을 읽지 못했습니다.');};
 await assert.rejects(service.importNaverLink(saved().sourceUrl),/페이지/);assert.equal(service.active,null);
});
test('reimported same-day facts update reused evidence and coordinate changes invalidate old facility proof',()=>{
 const p=prices();p.naverLand.basic.parkingSpaces=100;const previous=scoring.collectEvidence({input,prices:p});
 p.naverLand.basic.parkingSpaces=200;
 const fresh=scoring.collectEvidence({input,prices:p,previous});assert.equal(fresh.naverLand.basic.parkingSpaces,200);assert.equal(previous.naverLand.basic.parkingSpaces,100);
 previous.places=[{id:'old',category:'subway',lat:center.lat,lng:center.lng}];p.naverLand.lat+=0.01;
 const moved=scoring.collectEvidence({input,prices:p,previous});assert.equal(moved.center.lat,p.naverLand.lat);assert.deepEqual(moved.places,[]);assert.equal(moved.centerSource.provider,'네이버 부동산');
 const official={...p,naverLand:null,buildingResolution:{...identity,lat:37.42,lng:center.lng}};
 const officialProof=scoring.collectEvidence({input,prices:official,previous});assert.equal(officialProof.center.lat,37.42);assert.equal(officialProof.centerSource,undefined);assert.deepEqual(officialProof.places,[]);
 const same={...official,buildingResolution:{...identity,...center}},sameProof=scoring.collectEvidence({input,prices:same,previous});assert.equal(sameProof.centerSource,undefined);
});
test('recent-report reuse checks persisted Naver changes after restart',async()=>{
 const p=prices(),report={id:'old',input:{...input,asset:'officetel'},prices:{...p,coverage:[]},createdAt:new Date().toISOString(),requestFingerprint:'key'};
 const service=new AnalysisService({bridge:new EventEmitter(),onEvent:()=>{},store:{list:async()=>[{id:report.id,createdAt:report.createdAt}],load:async()=>report}});
 service.naverStore=new (require('../src/naver-land.cjs').NaverLandStore)();await service.naverStore.import(p.naverLand);
 assert.equal((await service.recentReport('key')).id,'old');
 await service.naverStore.import({...p.naverLand,basic:{...p.naverLand.basic,parkingSpaces:200}});
 assert.equal(await service.recentReport('key'),null);
});
test('Naver short province names proceed into the official region resolver',async()=>{
 const {RtmsClient}=require('../src/data.cjs'),client=new RtmsClient();
 client.listProvinces=async()=>[{name:'인천광역시',code:'28000'}];client.listRegions=async()=>[{name:'연수구',code:'28185'}];
 const address='인천시 연수구 송도동 192-8 베르디움더퍼스트';
 assert.equal(require('../src/property-search.cjs').hasRegion(address),true);
 const region=await client.resolve(address);assert.equal(region.province.name,'인천광역시');assert.equal(region.code,'28185');
});
test('ordinary analysis automatically fills missing parking without manual link import and reuses it across areas',async()=>{
 const service=new AnalysisService({bridge:new EventEmitter(),onEvent:()=>{}});let calls=0;
 service.findNaverComplex=async()=>{calls++;return {...saved(),basic:{units:500,parkingSpaces:700}};};
 const p={buildingResolution:{...identity}};await service.reuseNaverLand(input,p);assert.equal(p.naverLand.basic.parkingSpaces,700);assert.equal(calls,1);
 const second={buildingResolution:{...identity}};await service.reuseNaverLand({...input,area:84},second);assert.equal(second.naverLand.basic.parkingSpaces,700);assert.equal(calls,1);
 const row=require('../src/parking-presentation.cjs').snapshot({input,prices:second});assert.equal(row.total,700);assert.equal(row.perUnit,1.4);assert.equal(row.sourceName,'네이버 부동산');
 service.naverLookups=new Map();await service.reuseNaverLand(input,second,{forceRefresh:true});assert.equal(calls,2);
});

test('an imported phase alias reaches household and parking fields without another lookup',async()=>{
 const mokdong=require('./fixtures/naver-mokdong.cjs'),r=mokdong.record(),service=new AnalysisService({bridge:new EventEmitter(),onEvent:()=>{}});
 await service.importNaverLand(r);service.readNaverPage=service.findNaverComplex=async()=>{throw Error('complete import must be reused');};
 const p={buildingResolution:mokdong.identity};await service.reuseNaverLand(input,p);
 const report={input:{...input,building:mokdong.identity.building},prices:p},facts=require('../src/apartment-overview.cjs').data(report).properties[0].facts;
 assert.equal(facts.units,1140);assert.equal(facts.parking.total,1376);assert.equal(facts.parking.perUnit,1376/1140);assert.equal(facts.approval,'2000-03-18');
 assert.equal(p.naverLookup,undefined);
});

test('partial imports reread their verified link once and share the complete result across areas',async()=>{
 const service=new AnalysisService({bridge:new EventEmitter(),onEvent:()=>{}}),r={...saved(),basic:{units:500,parkingSpaces:700,approvalDate:'2014-08-29'}};let reads=0,searches=0;
 await service.importNaverLand({...r,basic:{units:500}});
 service.readNaverPage=async url=>{reads++;assert.equal(url,r.sourceUrl);return r;};service.findNaverComplex=async()=>{searches++;throw Error('unnecessary search');};
 const a={buildingResolution:identity},b={buildingResolution:identity};await Promise.all([service.reuseNaverLand(input,a),service.reuseNaverLand({...input,area:84},b)]);
 assert.equal(reads,1);assert.equal(searches,0);assert.equal(a.naverLand.basic.parkingSpaces,700);assert.equal(b.naverLand.basic.parkingSpaces,700);
 await service.reuseNaverLand(input,a,{forceRefresh:true});assert.equal(reads,2);
});

test('a failed or incomplete known page falls back to verified public search',async()=>{
 for(const kind of ['failed','partial','wrong-lot']){
  const service=new AnalysisService({bridge:new EventEmitter(),onEvent:()=>{}}),r=saved(),calls=[];
  service.readNaverPage=async()=>{calls.push('link');if(kind==='failed')throw Error('network');return kind==='wrong-lot'?{...r,addressJibun:'인천광역시 연수구 송도동 2-1'}:r;};
  service.findNaverComplex=async()=>{calls.push('search');return {...r,basic:{...r.basic,parkingSpaces:700}};};
  const p={buildingResolution:identity,naverLand:r};await service.reuseNaverLand(input,p);assert.deepEqual(calls,['link','search']);assert.equal(p.naverLand.basic.parkingSpaces,700);
 }
});

test('lookup errors can recover on retry and do not erase confirmed counts',async()=>{
 const service=new AnalysisService({bridge:new EventEmitter(),onEvent:()=>{}}),p={buildingResolution:identity,naverLand:saved()};let calls=0;
 service.findNaverComplex=async()=>{if(++calls===1)throw Error('temporary failure');return {...saved(),basic:{units:500,parkingSpaces:700,approvalDate:'2014-08-29'}};};
 await service.reuseNaverLand(input,p);assert.equal(p.naverLookup.status,'unavailable');assert.equal(p.naverLand.basic.units,500);
 await service.reuseNaverLand(input,p);assert.equal(calls,2);assert.equal(p.naverLand.basic.parkingSpaces,700);
});

test('cancellation and a mismatched link never persist an unverified replacement',async()=>{
 const service=new AnalysisService({bridge:new EventEmitter(),onEvent:()=>{}}),controller=new AbortController(),p={buildingResolution:identity,naverLand:saved()};let searches=0;
 service.readNaverPage=async()=>{controller.abort();return {...saved(),basic:{units:500,parkingSpaces:700,approvalDate:'2014-08-29'}};};service.findNaverComplex=async()=>{searches++;return saved();};
 await assert.rejects(service.reuseNaverLand(input,p,{signal:controller.signal}),/중지/);assert.equal(searches,0);assert.equal(p.naverLand.basic.parkingSpaces,undefined);
 service.readNaverPage=async()=>({...saved(),addressJibun:'인천광역시 연수구 송도동 2-1'});service.findNaverComplex=undefined;
 await service.reuseNaverLand(input,p);assert.equal(p.naverLookup.status,'unavailable');assert.equal(p.naverLand.basic.units,500);assert.equal(service.naverStore,undefined);
});
