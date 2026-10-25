'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {AnalysisService}=require('../src/service.cjs');
const {ReportStore}=require('../src/store.cjs'),{SCORE_ITEMS}=require('../src/core.cjs');

async function singleFixture(t,fn,provider='claude'){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'provider-single-reliability-')),bridge=new EventEmitter(),store=new ReportStore(path.join(root,'reports')),calls=[];
  const response={title:'가상단지 분석',conclusion:'확인된 계약 자료를 살펴봤습니다.',highlights:['공식 거래 자료를 확인했습니다.'],sections:[{heading:'생활환경',body:'시설 자료가 없어 평가를 보류했습니다.'}],strengths:[],limitations:[],checks:[],sources:[],scores:SCORE_ITEMS.map(name=>({name,score:null,reason:'시설 근거 미확인',method:'',sourceIds:[]}))};
  bridge.analyze=async request=>{calls.push(request);return {text:JSON.stringify(response),tokenUsage:{totalTokens:11},tools:[],threadId:provider+'-fixture'};};bridge.interrupt=async()=>{};
  const rawText='보존할 공식 거래 원자료',data={collect:async()=>({rows:[100000,120000].map((price,i)=>({id:String(i),kind:'trade',price,date:'2026-08-01',building:'가상단지',location:'서울 송파구 가상동',lot:'1',area:84,areaBasis:'전용면적'})),coverage:[],identity:{building:'가상단지',code:'fixture-code',town:'가상동',lot:'1'},raw:[{deal:'trade',bytes:Buffer.from(rawText).toString('base64'),form:{}}]})};
  const service=new AnalysisService({bridge,data,store,userData:root,onEvent:()=>{}});service.settings={provider};service.status=async()=>({loggedIn:true,mapConnected:false,models:[{id:provider+'-fixture',isDefault:true}]});
  t.mock.method(require('../src/research.cjs'),'collectResearch',async()=>({tools:[],issues:['주변 시설 조회 자료 없음'],checks:[],metrics:{}}));
  const raw={asset:'officetel',target:'서울 송파구 가상동 가상단지',building:'가상단지',area:84,types:['trade'],asOf:'2026-10-16',request:'실거주 조건 설명'};
  try{await fn({root,bridge,service,store,calls,raw,rawText});}finally{await fs.rm(root,{recursive:true,force:true});}
}

async function assertRawPreserved(f){
  const dirs=await fs.readdir(f.store.root,{withFileTypes:true});const directory=dirs.find(item=>item.isDirectory());assert.ok(directory,'evidence directory remains');
  assert.equal(await fs.readFile(path.join(f.store.root,directory.name,'raw','RTMS-trade.csv'),'utf8'),f.rawText);
}

test('delayed connection status retains the matching provider settings snapshot',async()=>{
  const bridge=new EventEmitter();let finish;bridge.connectionStatus=()=>new Promise(resolve=>finish=resolve);
  const service=new AnalysisService({bridge,onEvent:()=>{}});service.settings={provider:'gemini',model:'gemini-fixture',modelsByProvider:{gemini:'gemini-fixture'}};
  const pending=service.status();service.settings={provider:'claude',model:'claude-fixture'};finish({provider:'gemini',loggedIn:true});
  const result=await pending;assert.equal(result.provider,'gemini');assert.equal(result.settings.provider,'gemini');assert.equal(result.settings.model,'gemini-fixture');
});

test('nonmatching recent reports skip unrelated expensive evidence checks',async()=>{
  let evidenceChecks=0,loads=0;const reports=Array.from({length:20},(_,i)=>({id:String(i),createdAt:new Date().toISOString(),requestFingerprint:i===19?'matching':'other-'+i,input:{asset:'officetel'},prices:{coverage:[]}}));
  const service=new AnalysisService({bridge:new EventEmitter(),onEvent:()=>{},store:{list:async()=>reports,load:async id=>{loads++;return reports[Number(id)];}}});
  service.naverStore={forIdentity:async()=>{evidenceChecks++;return null;}};
  assert.equal((await service.recentReport('matching')).id,'19');assert.equal(loads,20);assert.equal(evidenceChecks,1);
});

test('Claude and Gemini model selection cannot use a foreign provider even if it is marked default',async()=>{
  const service=new AnalysisService({bridge:new EventEmitter(),onEvent:()=>{}});
  for(const provider of ['gemini','claude']){
    service.settings={provider};await assert.rejects(service.chooseModel([{id:'gpt-foreign',isDefault:true}]),/사용 가능한/);
    const selected=await service.chooseModel([{id:'gpt-foreign',isDefault:true},{id:provider+'-fixture'}]);assert.equal(selected.model,provider+'-fixture');assert.equal(service.repairModel([], {model:'gpt-foreign'}),null);
  }
});

test('API provider connection wrappers hold their lock and forward cancellation',async()=>{
  const bridge=new EventEmitter(),service=new AnalysisService({bridge,onEvent:()=>{}});
  let received;bridge.connectClaude=async(key,{signal})=>{received=signal;assert.equal(key,'test-key');await assert.rejects(service.configureGemini('disconnect'),/진행 중/);return {connected:true};};
  assert.deepEqual(await service.configureClaude('connect','test-key'),{connected:true});assert.ok(received instanceof AbortSignal);assert.equal(service.active,null);
  for(const provider of ['gemini','claude']){service.settings={provider};assert.equal(await service.usage(),null);assert.match(service.connectionRequired(),new RegExp(provider==='gemini'?'Gemini':'Claude'));}
});

for(const provider of ['gemini','claude'])test(provider+' single report repairs invalid JSON once, preserves source calculations and records rejected usage',async t=>singleFixture(t,async f=>{
  let tries=0;const normal=f.bridge.analyze;f.bridge.analyze=async request=>{assert.ok(request.signal instanceof AbortSignal);if(++tries===1){const error=Error('bad output');error.code='AI_INVALID_RESPONSE';error.tokenUsage={totalTokens:7};throw error;}return normal(request);};
  const report=await f.service.run(f.raw);assert.equal(tries,2);assert.equal(report.provider,provider);assert.equal(report.model,provider+'-fixture');assert.equal(report.prices.summaries[0].price,110000);assert.deepEqual(report.scores.map(s=>s.name),SCORE_ITEMS);assert.ok(report.scores.every(s=>s.score===null));
  assert.equal(report.optimization.attempts,2);assert.deepEqual(report.optimization.usage.map(u=>u.tokens.totalTokens),[7,11]);assert.equal(report.optimization.usage[0].invalidResponse,true);assert.equal(f.service.active,null);assert.equal(await fs.readFile(path.join(f.store.path(report.id),'raw','RTMS-trade.csv'),'utf8'),f.rawText);
},provider));

test('single report with repeated invalid JSON is not saved and its original evidence remains available',async t=>singleFixture(t,async f=>{
  let calls=0;f.bridge.analyze=async()=>{calls++;const error=Error('JSON error');error.code='AI_INVALID_RESPONSE';throw error;};
  await assert.rejects(f.service.run(f.raw),/필수 내용이 부족/);assert.equal(calls,2);assert.equal(f.service.active,null);assert.equal((await f.store.list()).length,0);await assertRawPreserved(f);
}));

test('cancelling after single report text generation prevents persistence and conserves the raw evidence',async t=>singleFixture(t,async f=>{
  f.service.onEvent=event=>{if(event.stage==='validation')f.service.active.controller.abort();};
  await assert.rejects(f.service.run(f.raw),/중지/);assert.equal(f.calls.length,1);assert.equal(f.service.active,null);assert.equal((await f.store.list()).length,0);await assertRawPreserved(f);
}));

test('single report cancellation reaches the writer and does not repair or save a cancelled answer',async t=>singleFixture(t,async f=>{
  let ready,calls=0;const started=new Promise(resolve=>ready=resolve);f.bridge.analyze=async({signal})=>{calls++;ready();return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('분석을 중지했습니다.')),{once:true}));};
  const work=f.service.run(f.raw);await started;await f.service.cancel();await assert.rejects(work,/중지/);assert.equal(calls,1);assert.equal(f.service.active,null);assert.equal((await f.store.list()).length,0);await assertRawPreserved(f);
}));
