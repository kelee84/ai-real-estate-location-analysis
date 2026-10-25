'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{EventEmitter}=require('node:events');
const consultation=require('../src/consultation.cjs'),{AnalysisService}=require('../src/service.cjs'),{ReportStore}=require('../src/store.cjs'),{normalizeInput,aggregate,SCORE_ITEMS}=require('../src/core.cjs'),{buildRequest,fingerprint}=require('../src/prompt.cjs');
const logo='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aK2kAAAAASUVORK5CYII=';
const customer={purpose:'live',budgetManwon:90000,budgetType:'trade',moveIn:'내년 봄',priorities:['교통 환경','자연환경']};
const raw={target:'가상단지',building:'가상단지',asset:'officetel',area:84,types:['trade'],asOf:'2026-10-15',request:'간단하게 설명'};
function content(){return {title:'상담 분석',conclusion:'확인한 조건을 비교합니다.',highlights:['거래 자료를 확인했습니다.'],strengths:['거래 근거 보유'],limitations:[],checks:[],sections:[{heading:'선택 기준',body:'생활 조건에 맞게 비교합니다.'}],scores:SCORE_ITEMS.map(name=>({name,score:null,reason:'평가 근거 부족',method:'',sourceIds:[]})),sources:[],methodology:'공통 평가 기준'};}
async function fixture(fn){
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'consultation-')),requests=[];let queries=0,hooks=0;
  const store=new ReportStore(path.join(dir,'reports'),{afterSave:async()=>{hooks++;}}),bridge=new EventEmitter();
  bridge.analyze=async request=>{requests.push(request);const input=JSON.parse(request.prompt);return {text:JSON.stringify({...content(),...(input.members?{members:input.members.map(m=>({key:m.key,strengths:['거래 근거 보유'],limitations:[],scores:content().scores}))}:{})}),tools:[],threadId:'test'};};
  const data={collect:async input=>{queries++;return {rows:[59,84].map(area=>({id:input.target+'-'+area,date:'2026-06-01',kind:'trade',building:input.building,area,areaBasis:'전용면적',price:area*1000})),coverage:[],raw:[{deal:'trade',bytes:Buffer.from('원본 거래 파일').toString('base64'),form:{}}]};}};
  const service=new AnalysisService({bridge,data,store,userData:dir,onEvent:()=>{}});service.status=async()=>({loggedIn:true,mapConnected:false,models:[{id:'gpt-6-luna',efforts:['low']}]});
  try{await fn({dir,store,service,requests,get queries(){return queries;},get hooks(){return hooks;}});}finally{const target=path.resolve(dir),base=path.resolve(os.tmpdir())+path.sep;assert.ok(target.startsWith(base));await fs.rm(target,{recursive:true,force:true});}
}
test('고객 조건·업소·로고·메모를 제한하고 기존 보고서에는 빈 기본값 제공',()=>{
  const old={input:{office:'기존 사무소'}};assert.equal(consultation.getConsultation(old).officeProfile.name,'기존 사무소');assert.equal(old.consultation,undefined);
  assert.deepEqual(consultation.normalizeCustomer(customer),customer);assert.equal(consultation.normalizeCustomer({budgetManwon:'90,000'}).budgetManwon,90000);
  assert.throws(()=>consultation.normalizeCustomer({budgetManwon:-1},{strict:true}),/예산/);assert.throws(()=>consultation.normalizeCustomer({priorities:SCORE_ITEMS},{strict:true}),/2개/);
  assert.throws(()=>consultation.normalizeCustomer({moveIn:'가'.repeat(41)},{strict:true}),/40자/);
  assert.equal(consultation.normalizeOfficeProfile({logoDataUrl:logo}).logoDataUrl,logo);
  for(const value of ['https://example.test/logo.png','data:image/svg+xml;base64,PHN2Zz4=','data:image/png;base64,PHN2Zz4=','data:image/png;base64,'+'A'.repeat(400000)])assert.throws(()=>consultation.normalizeOfficeProfile({logoDataUrl:value},'',{strict:true}),/PNG 또는 JPEG/);
  assert.throws(()=>consultation.updateConsultation(old,{properties:[{key:'A',visitedAt:'2026-02-30'}]}),/날짜/);
  assert.throws(()=>consultation.updateConsultation(old,{properties:[{key:'A',visitedAt:'2999-01-01'}]}),/오늘 또는 이전/);
  assert.throws(()=>consultation.updateConsultation(old,{properties:[{key:'A',cautions:'가'.repeat(601)}]}),/600자/);
  assert.throws(()=>consultation.updateConsultation(old,{properties:[{key:'A',privateNote:'가'.repeat(1001)}]}),/1000자/);
});
test('비교 매물 키를 검증하고 공개 메모에서는 내부 메모를 제거',()=>{
  const report={mode:'comparison',input:raw,members:[{key:'A'},{key:'B'}]},saved=consultation.updateConsultation(report,{properties:[{key:'B',cautions:'누수 이력 확인',publicNote:'방문 시 확인한 내용',privateNote:'내부 전용 정보'}]});
  assert.deepEqual(consultation.propertyKeys({...report,mode:undefined,comparisonMembers:report.members,members:undefined}),['A','B']);
  assert.equal(consultation.publicConsultation(saved).properties[1].publicNote,'방문 시 확인한 내용');assert.ok(!JSON.stringify(consultation.publicConsultation(saved)).includes('내부 전용'));assert.equal(saved.consultation.properties[1].privateNote,'내부 전용 정보');
  assert.throws(()=>consultation.updateConsultation(report,{properties:[{key:'C'}]}),/보고서에 있는/);assert.throws(()=>consultation.updateConsultation(report,{properties:[{key:'A'},{key:'A'}]}),/보고서에 있는/);
});
test('고객·업소는 캐시를 구분하되 AI 입력에 로고·고객조건·메모를 보내지 않음',()=>{
  const input=normalizeInput({...raw,customer,officeProfile:{name:'상담 사무소',logoDataUrl:logo}}),report={...content(),consultation:{properties:[{key:'A',privateNote:'비밀 메모'}]}};
  const prompt=buildRequest(input,aggregate([],input),{previous:report}).prompt;
  for(const secret of ['상담 사무소','base64','비밀 메모','내년 봄','budgetManwon'])assert.ok(!prompt.includes(secret));
  assert.notEqual(fingerprint(input,'model',false),fingerprint({...input,customer:{...customer,budgetManwon:100000}},'model',false));
  assert.notEqual(fingerprint(input,'model',false),fingerprint({...input,officeProfile:{name:'다른 사무소'}},'model',false));
});
test('상담 저장은 AI·거래 재조회·상세근거 재생성 없이 원자료와 분석값 보존',()=>fixture(async f=>{
  const generated=await f.service.run({...raw,customer}),report=await f.store.load(generated.id),before={calls:f.requests.length,queries:f.queries,hooks:f.hooks},rawFile=path.join(f.store.path(report.id),'raw','RTMS-trade.csv'),bytes=await fs.readFile(rawFile);
  const saved=await f.service.saveConsultation(report.id,{updatedAt:'',properties:[{key:'A',cautions:'학교 배정 미확인',privateNote:'연락 선호 시간',visitedAt:'2026-10-15'}]});
  assert.deepEqual({calls:f.requests.length,queries:f.queries,hooks:f.hooks},before);assert.deepEqual(saved.prices,report.prices);assert.deepEqual(saved.scores,report.scores);assert.deepEqual(saved.assessment,report.assessment);assert.deepEqual(saved.sections,report.sections);assert.deepEqual(await fs.readFile(rawFile),bytes);assert.equal(saved.id,report.id);assert.equal(saved.requestFingerprint,null);assert.equal(f.service.active,null);
  await assert.rejects(f.service.saveConsultation(report.id,{updatedAt:'',properties:[{key:'A',privateNote:'오래된 값'}]}),/다른 저장/);assert.equal((await f.store.load(report.id)).consultation.properties[0].privateNote,'연락 선호 시간');
  f.service.active={kind:'analysis'};await assert.rejects(f.service.saveConsultation(report.id,{}),/진행 중/);f.service.active=null;
}));
test('동시 저장은 직렬 반영하고 수정된 상담을 다른 새 상담에 재사용하지 않음',()=>fixture(async f=>{
  const report=await f.service.run({...raw,customer});
  await Promise.all([f.store.update(report.id,r=>consultation.updateConsultation(r,{properties:[{key:'A',cautions:'주의사항'}]}),{afterSave:false}),f.store.update(report.id,r=>consultation.updateConsultation(r,{properties:[{key:'A',privateNote:'내부 메모'}]}),{afterSave:false})]);
  const saved=await f.store.load(report.id);assert.equal(saved.consultation.properties[0].cautions,'주의사항');assert.equal(saved.consultation.properties[0].privateNote,'내부 메모');
  const next=await f.service.run({...raw,customer});assert.notEqual(next.id,report.id);assert.equal(next.consultation.properties[0].privateNote,'');assert.equal(next.consultation.properties[0].cautions,'');
}));
test('신규·수정·비교·타입별 보고서가 고객 조건과 당시 업소 정보를 보존',()=>fixture(async f=>{
  await f.service.saveSettings({office:'처음 사무소',officeProfile:{agent:'김담당',phone:'02-123-4567',logoDataUrl:logo}});
  const single=await f.service.run({...raw,customer}),saved=await f.service.saveConsultation(single.id,{properties:[{key:'A',privateNote:'보관 메모'}]});
  await f.service.saveSettings({office:'새 사무소'});
  const revised=await f.service.run({...saved.input,request:raw.request+'\n문장을 짧게'},{revisionId:saved.id});assert.equal(revised.consultation.officeProfile.name,'처음 사무소');assert.deepEqual(revised.consultation.customer,customer);assert.equal(revised.consultation.properties[0].privateNote,'보관 메모');assert.ok(!f.requests.at(-1).prompt.includes('보관 메모'));
  const compare=await f.service.run({mode:'comparison',properties:[{reportId:saved.id},{...raw,target:'다른단지',building:'다른단지'}],customer,types:raw.types,asOf:raw.asOf});assert.deepEqual(compare.consultation.customer,customer);assert.equal(compare.consultation.officeProfile.name,'새 사무소');assert.equal(compare.consultation.properties[0].privateNote,'');assert.ok(compare.members.every(m=>m.input.customer.budgetManwon===customer.budgetManwon));assert.ok(!f.requests.at(-1).prompt.includes('base64'));
  const compared=await f.service.saveConsultation(compare.id,{properties:[{key:'B',publicNote:'두 번째 매물 현장 내용',privateNote:'비공개 B'}]});
  await f.service.saveSettings({office:'세 번째 사무소'});
  const compareRevision=await f.service.run({...compared.input,request:'문장을 간단하게'},{revisionId:compared.id});assert.equal(compareRevision.consultation.officeProfile.name,'새 사무소');assert.equal(compareRevision.consultation.properties[1].publicNote,'두 번째 매물 현장 내용');assert.equal(compareRevision.consultation.properties[1].privateNote,'비공개 B');assert.ok(!f.requests.at(-1).prompt.includes('비공개 B'));
  f.service.typeCatalogs=new Map([['token',{target:raw.target,building:raw.building,requestedBuilding:raw.building,asset:raw.asset,areas:[59,84],time:Date.now()}]]);
  const batch=await f.service.run({...raw,customer,area:null,selectedAreas:[59,84],catalogToken:'token'});assert.equal(batch.reports.length,2);assert.ok(batch.reports.every(r=>r.consultation.officeProfile.name==='세 번째 사무소'&&r.consultation.customer.moveIn==='내년 봄'));
}));
test('기존 설정을 읽고 업소명 호환과 로고를 유지하며 재시작 뒤에도 동일',()=>fixture(async f=>{
  await fs.writeFile(path.join(f.dir,'settings.json'),JSON.stringify({office:'기존 업소',model:'chosen-model'}));await f.service.init();assert.equal(f.service.settings.officeProfile.name,'기존 업소');
  await f.service.saveSettings({officeProfile:{phone:'010-1234-5678',logoDataUrl:logo}});await f.service.init();assert.equal(f.service.settings.model,'chosen-model');assert.equal(f.service.settings.office,'기존 업소');assert.equal(f.service.settings.officeProfile.logoDataUrl,logo);
}));
