'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),{EventEmitter}=require('node:events');
const {randomUUID,createHash}=require('node:crypto'),{normalizeInput,aggregate,todayKst}=require('../src/core.cjs');
const {AnalysisService}=require('../src/service.cjs'),{ReportStore}=require('../src/store.cjs'),{NaverLandStore}=require('../src/naver-land.cjs');
const basics=require('../src/report-basics.cjs'),overview=require('../src/apartment-overview.cjs'),parking=require('../src/parking-presentation.cjs'),scoring=require('../src/scoring.cjs');
const today=todayKst(),past=new Date(Date.parse(today+'T00:00:00+09:00')-3*86400000).toLocaleDateString('en-CA',{timeZone:'Asia/Seoul'});
function member(key='A',asOf=past){
 const name=key+'검증아파트',input=normalizeInput({target:'인천광역시 연수구 송도동 '+name,building:name,asOf,area:84,types:['trade']});
 const identity={code:'official-'+key,regionCode:'28185',building:name,province:'인천광역시',region:'연수구',town:'송도동',lot:String(key.charCodeAt(0)),lat:37.4,lng:126.64};
 const row={id:key+'-contract',kind:'trade',date:asOf,area:84.1,areaBasis:'전용면적',building:name,location:'인천광역시 연수구 송도동',lot:identity.lot,built:'2010',cancelled:false,price:100000};
 return {id:randomUUID(),key,input,title:'검증 보고서',createdAt:new Date().toISOString(),prices:{...aggregate([row],input,[{deal:'trade',status:'success',source:'https://rt.molit.go.kr/pt/xls/xls.do',checkedAt:asOf}]),buildingResolution:identity},scores:[],assessment:{version:scoring.VERSION,evidence:{identity,sources:[]}},map:{reason:'검증용 지도 없음'},sources:[],sections:[],strengths:[],limitations:[],checks:[],highlights:[],features:[]};
}
function record(member,change={}){const i=member.prices.buildingResolution,n=String(1100+i.building.charCodeAt(0));return {complexNo:n,name:i.building,addressJibun:[i.province,i.region,i.town,i.lot].join(' '),lat:i.lat,lng:i.lng,coordinateBasis:'complex',sourceUrl:'https://fin.land.naver.com/complexes/'+n,checkedAt:new Date().toISOString(),basic:{units:1000,parkingSpaces:1200,approvalDate:'2010-01-01'},...change};}
const values=r=>Object.fromEntries(overview.data(r).rows.map(row=>[row.key,row.values[0]]));
async function fixture(t,report=member()){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'report-basics-')),store=new ReportStore(path.join(root,'reports'));await store.save(report,{afterSave:false});
 t.after(async()=>{assert.equal(path.dirname(root),path.resolve(os.tmpdir()));await fs.rm(root,{recursive:true,force:true});});
 const bridge=new EventEmitter();bridge.evidenceSession=bridge.evidenceTool=bridge.analyze=()=>{throw Error('입지톡·AI 호출 금지');};
 const service=new AnalysisService({bridge,store,userData:root,onEvent:()=>{}});service.naverStore=new NaverLandStore(root);
 return {root,store,service,file:path.join(store.path(report.id),'report.json'),sidecar:path.join(store.path(report.id),'raw','report-basics.json')};
}

test('과거 보고서의 네이버 세대·주차만 보완하고 거래·평가·지도·기준일과 원본 바이트를 보존함',async t=>{
 const original=member(),f=await fixture(t,original),raw=await fs.readFile(f.file),r=record(original,{publicFacts:[{category:'daily',text:'표시에 필요하지 않은 생활정보',sourceUrl:record(original).sourceUrl,checkedAt:new Date().toISOString()}],memo:'PRIVATE_MEMO'});let calls=0;
 f.service.findNaverComplex=async(input,prices)=>{calls++;assert.equal(input.asOf,today);assert.deepEqual(prices.buildingResolution,original.prices.buildingResolution);return r;};
 const out=await f.service.presentationReport(original.id),v=values(out),expected=scoring.prepareReport(await f.store.load(original.id));
 assert.equal(calls,1);assert.equal(v.units,'1,000세대');assert.equal(v.parking,'총 1,200대 · 세대당 1.20대');assert.equal(v.turnover,'산출 불가');assert.equal(v.trade,'10억 · 1건');
 for(const key of ['input','prices','scores','assessment','map'])assert.deepEqual(out[key],expected[key],key);
 assert.deepEqual(await fs.readFile(f.file),raw);assert.match(overview.data(out).notes.join(' '),new RegExp('기본정보 확인일 .*'+today));assert.match(overview.data(out).notes.join(' '),new RegExp('거래·환경평가 기준일 '+past));
 const sidecar=JSON.parse(await fs.readFile(f.sidecar,'utf8'));assert.equal(sidecar.sourceReportSha256,createHash('sha256').update(raw).digest('hex'));assert.equal(sidecar.reportId,original.id);assert.doesNotMatch(JSON.stringify(sidecar),/PRIVATE|publicFacts|scores|contracts/);
});
test('같은 날 sidecar는 앱 재시작 후 재사용하고 서로 다른 면적·보고서의 같은 단지는 캐시와 중복 promise를 공유함',async t=>{
 const original=member(),f=await fixture(t,original);let calls=0;f.service.findNaverComplex=async()=>{calls++;await new Promise(resolve=>setTimeout(resolve,5));return record(original);};
 const parallel=await Promise.all([f.service.presentationReport(original.id),f.service.presentationReport(original.id)]);assert.equal(calls,1);parallel[0].basicSnapshot.record.basic.units=3;assert.equal(values(parallel[1]).units,'1,000세대');
 const secondService=new AnalysisService({bridge:new EventEmitter(),store:f.store,userData:f.root,onEvent:()=>{}});secondService.naverStore=new NaverLandStore();secondService.findNaverComplex=()=>{throw Error('재조회하면 안 됨');};assert.equal(values(await secondService.presentationReport(original.id)).units,'1,000세대');
 const other=member();other.input.area=59;await f.store.save(other,{afterSave:false});assert.equal(values(await f.service.presentationReport(other.id)).units,'1,000세대');assert.equal(calls,1);
});
test('원래 정상 세대·주차자료가 있으면 조회하지 않으며 현재 스냅샷을 과거 회전율 분모로 섞지 않음',async t=>{
 const original=member();original.prices.naverLand=record(original,{checkedAt:past,basic:{units:800,parkingSpaces:900}});const f=await fixture(t,original);let calls=0;f.service.findNaverComplex=async()=>{calls++;return record(original);};
 assert.equal(values(await f.service.presentationReport(original.id)).units,'800세대');assert.equal(calls,0);
 const view=structuredClone(original);view.basicSnapshot=basics.makeSnapshot(view,record(view));const v=values(view);assert.equal(v.units,'1,000세대');assert.equal(v.turnover,'0.13% (1건 ÷ 800세대)');assert.equal(v.parking,'총 1,200대 · 세대당 1.20대');
 const current=member('A',today);current.basicSnapshot=basics.makeSnapshot(current,record(current));assert.equal(values(current).turnover,'0.10% (1건 ÷ 1,000세대)');
});
test('신규 수집은 주차가 있어도 총세대수가 빠졌으면 네이버에서 한 번 보완함',async()=>{
 const m=member('A',today),service=new AnalysisService({bridge:new EventEmitter(),onEvent:()=>{}}),p={buildingResolution:m.prices.buildingResolution,naverLand:record(m,{basic:{parkingSpaces:1200}})};let calls=0;
 service.findNaverComplex=async()=>{calls++;return record(m);};await service.reuseNaverLand(m.input,p);assert.equal(calls,1);assert.equal(p.naverLand.basic.units,1000);assert.equal(p.naverLand.basic.parkingSpaces,1200);
});

test('saved reports with a terminal phase alias recover Naver household and parking without changing original bytes',async t=>{
 const mokdong=require('./fixtures/naver-mokdong.cjs'),m=member(),r=mokdong.record();
 m.input.building=mokdong.identity.building;m.prices.buildingResolution={...mokdong.identity};
 m.prices.naverLand={...r,checkedAt:past,basic:{units:1140}};
 const f=await fixture(t,m),raw=await fs.readFile(f.file);let searches=0;
 f.service.findNaverComplex=async()=>{searches++;return r;};
 const out=await f.service.presentationReport(m.id),v=values(out);
 assert.equal(searches,1);assert.equal(v.units,'1,140세대');assert.equal(v.parking,'총 1,376대 · 세대당 1.21대');
 assert.equal(out.input.asOf,past);assert.deepEqual(out.prices.naverLand,m.prices.naverLand);assert.deepEqual(await fs.readFile(f.file),raw);
 assert.equal(out.basicSnapshot.record.sourceUrl,r.sourceUrl);
});
test('다른 지번·차수·100m 초과 좌표·미래·오래된 자료는 sidecar나 주차·세대 표에 들어가지 않음',async t=>{
 for(const change of [{addressJibun:'인천광역시 연수구 송도동 999'},{name:'A검증2차아파트'},{lat:37.42},{checkedAt:new Date(Date.now()+3600000).toISOString()},{checkedAt:past}]){
  const m=member(),f=await fixture(t,m);f.service.findNaverComplex=async()=>record(m,change);const out=await f.service.presentationReport(m.id);assert.equal(values(out).units,'미확인',JSON.stringify(change));assert.equal(values(out).parking,'미확인');assert.equal(out.basicSnapshot,undefined);await assert.rejects(fs.stat(f.sidecar),{code:'ENOENT'});
 }
});
test('보완 조회 실패·불완전 자료는 원래 확인값을 유지하고 미확인을 0으로 만들지 않음',async t=>{
 for(const fail of [true,false]){const m=member();m.prices.naverLand=record(m,{checkedAt:past,basic:{units:800}});const f=await fixture(t,m);f.service.findNaverComplex=async()=>{if(fail)throw Error('접속 실패');return record(m,{basic:{}});};const out=await f.service.presentationReport(m.id);assert.equal(values(out).units,'800세대');assert.equal(values(out).parking,'미확인');assert.equal(parking.snapshot(out).perUnit,null);}
});
test('sidecar의 원본 SHA·identity가 다르면 재사용하지 않고 보고서 JSON의 임의 snapshot도 신뢰하지 않음',async t=>{
 const m=member();m.basicSnapshot=basics.makeSnapshot(m,record(m));const f=await fixture(t,m);
 const fake={version:basics.VERSION,reportId:m.id,sourceReportSha256:'0'.repeat(64),checkedAt:new Date().toISOString(),members:[m.basicSnapshot]};await fs.mkdir(path.dirname(f.sidecar),{recursive:true});await fs.writeFile(f.sidecar,JSON.stringify(fake));
 f.service.findNaverComplex=async()=>{throw Error('조회 불가');};let out=await f.service.presentationReport(m.id);assert.equal(values(out).units,'미확인');
 fake.sourceReportSha256=createHash('sha256').update(await fs.readFile(f.file)).digest('hex');fake.members[0].identityKey='wrong';await fs.writeFile(f.sidecar,JSON.stringify(fake));out=await f.service.presentationReport(m.id);assert.equal(values(out).units,'미확인');
});
test('3단지 보완은 각각 공식 identity로 분리하고 동일 공통 표에서 세대·주차를 표시함',async t=>{
 const ms=['A','B','C'].map(key=>member(key)),report={...ms[0],id:randomUUID(),mode:'comparison',members:ms},f=await fixture(t,report);let calls=0;
 f.service.findNaverComplex=async(input,prices)=>{calls++;const target=ms.find(m=>m.prices.buildingResolution.code===prices.buildingResolution.code);return record(target,{basic:{units:1000+target.key.charCodeAt(0),parkingSpaces:1200+target.key.charCodeAt(0)}});};
 const out=await f.service.presentationReport(report.id),data=overview.data(out);assert.equal(calls,3);assert.equal(data.properties.length,3);assert.deepEqual(data.rows.find(r=>r.key==='units').values,['1,065세대','1,066세대','1,067세대']);assert.ok(data.rows.find(r=>r.key==='parking').values.every(v=>/총 1,26\d대/.test(v)));assert.deepEqual(out.members.map(m=>m.input.asOf),[past,past,past]);
});
test('고객 요약 내보내기 optional loadReport 훅이 공통 보완 보고서를 사용함',async t=>{
 const m=member(),f=await fixture(t,m);let loads=0;const file=path.join(f.root,'summary.html');const exporter=require('../src/summary-export.cjs').createSummaryExporter({store:f.store,loadReport:async id=>{loads++;assert.equal(id,m.id);return scoring.prepareReport({...m,title:'공통 보완 경로 확인'});}});
 const result=await exporter(m.id,'html',file);assert.equal(loads,1);assert.equal(result.file,file);assert.ok((await fs.stat(file)).size>0);
});
test('한국 자정이 지나면 재확인을 시도하고 실패할 때만 전날 자료를 실제 확인일과 함께 유지함',async t=>{
 t.mock.timers.enable({apis:['Date'],now:Date.parse(today+'T23:59:58+09:00')});
 const m=member(),f=await fixture(t,m),raw=await fs.readFile(f.file);let calls=0,fail=false;
 f.service.findNaverComplex=async()=>{calls++;if(fail)throw Error('오늘 네이버 접속 실패');return record(m);};
 const first=await f.service.presentationReport(m.id);assert.equal(first.basicSnapshot.status,'current');assert.equal(calls,1);assert.equal(basics.day(first.basicSnapshot.record.checkedAt),today);
 fail=true;t.mock.timers.tick(5000);const nextDay=todayKst();assert.notEqual(nextDay,today);
 const out=await f.service.presentationReport(m.id);assert.equal(calls,2,'전날 자료는 오늘 캐시로 재사용하지 않고 실제 새 조회를 시도함');assert.equal(out.basicSnapshot.status,'last-confirmed');assert.equal(basics.needsSupplement(out),true);
 assert.equal(values(out).units,'1,000세대');assert.equal(values(out).parking,'총 1,200대 · 세대당 1.20대');assert.equal(values(out).turnover,'산출 불가');assert.equal(basics.day(out.basicSnapshot.record.checkedAt),today);
 assert.match(parking.sourceLabel(parking.snapshot(out)),new RegExp('마지막 확인자료.*'+today));assert.match(overview.data(out).notes.join(' '),new RegExp('마지막 확인자료:.*확인 '+today));assert.match(overview.data(out).notes.join(' '),/오늘 기본정보를 다시 확인하지 못해/);
 const saved=JSON.parse(await fs.readFile(f.sidecar,'utf8'));assert.equal(basics.day(saved.checkedAt),nextDay);assert.equal(basics.day(saved.members[0].record.checkedAt),today);assert.deepEqual(await fs.readFile(f.file),raw);
 // A later verified response replaces the display-only fallback and its label.
 f.service.naverLookups=new Map();fail=false;f.service.findNaverComplex=async()=>{calls++;return record(m,{basic:{units:1100,parkingSpaces:1300}});};
 const fresh=await f.service.presentationReport(m.id);assert.equal(fresh.basicSnapshot.status,'current');assert.equal(values(fresh).units,'1,100세대');assert.equal(values(fresh).parking,'총 1,300대 · 세대당 1.18대');assert.doesNotMatch(overview.data(fresh).notes.join(' '),/마지막 확인자료/);assert.equal(values(fresh).turnover,'산출 불가');
});
test('오늘 부분 응답이 이전 정상 주차·세대를 지우지 않으며 서로 다른 날짜의 분자와 분모를 혼합하지 않음',async t=>{
 const m=member(),f=await fixture(t,m),yesterday=new Date(Date.parse(today+'T00:00:00+09:00')-86400000).toLocaleDateString('en-CA',{timeZone:'Asia/Seoul'}),old=basics.makeSnapshot(m,record(m,{checkedAt:yesterday}),{allowLastConfirmed:true});
 await fs.mkdir(path.dirname(f.sidecar),{recursive:true});await fs.writeFile(f.sidecar,JSON.stringify({version:basics.VERSION,reportId:m.id,sourceReportSha256:createHash('sha256').update(await fs.readFile(f.file)).digest('hex'),checkedAt:yesterday,members:[old]}));
 f.service.findNaverComplex=async()=>record(m,{basic:{units:1400}});const out=await f.service.presentationReport(m.id);
 assert.equal(out.basicSnapshot.status,'last-confirmed');assert.equal(values(out).units,'1,000세대');assert.equal(values(out).parking,'총 1,200대 · 세대당 1.20대');assert.equal(parking.snapshot(out).sourceDate,yesterday);assert.doesNotMatch(values(out).parking,/0\.86/);
});
test('마지막 확인 후보도 보고서 기준일보다 과거·미래·다른 단지·다른 원본 SHA이면 반려함',async t=>{
 const m=member(),beforeAsOf=new Date(Date.parse(past+'T00:00:00+09:00')-86400000).toLocaleDateString('en-CA',{timeZone:'Asia/Seoul'}),future=new Date(Date.parse(today+'T00:00:00+09:00')+86400000).toLocaleDateString('en-CA',{timeZone:'Asia/Seoul'});
 for(const changed of [{record:record(m,{checkedAt:beforeAsOf})},{record:record(m,{checkedAt:future})},{record:record(m,{checkedAt:past,addressJibun:'인천광역시 연수구 송도동 999'})},{hash:'wrong'}]){
  const f=await fixture(t,m),snapshot={version:basics.VERSION,identityKey:basics.identityKey(m),status:'last-confirmed',record:changed.record||record(m,{checkedAt:past})};
  await fs.mkdir(path.dirname(f.sidecar),{recursive:true});await fs.writeFile(f.sidecar,JSON.stringify({version:basics.VERSION,reportId:m.id,sourceReportSha256:changed.hash||createHash('sha256').update(await fs.readFile(f.file)).digest('hex'),checkedAt:past,members:[snapshot]}));f.service.findNaverComplex=async()=>{throw Error('조회 불가');};const out=await f.service.presentationReport(m.id);assert.equal(out.basicSnapshot,undefined);assert.equal(values(out).units,'미확인');assert.equal(values(out).parking,'미확인');
 }
});
