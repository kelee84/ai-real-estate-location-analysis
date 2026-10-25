'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {AiBridge,geminiModels,claudeModels}=require('../src/ai-bridge.cjs');
const {normalizeAiSettings,updateAiSettings}=require('../src/ai-settings.cjs');
const {AnalysisService}=require('../src/service.cjs'),{ReportStore}=require('../src/store.cjs');
const {SCORE_ITEMS,normalizeInput,aggregate}=require('../src/core.cjs');
const scoring=require('../src/scoring.cjs'),{fingerprint}=require('../src/prompt.cjs');

function bridgeFixture(){
  const calls=[],component=name=>{const x=new EventEmitter();x.start=async()=>calls.push(name+':start');x.interrupt=async()=>calls.push(name+':interrupt');x.stop=()=>calls.push(name+':stop');x.analyze=async()=>({text:'{}',tools:[]});x.evidenceSession=async()=>({tools:{get_geocode:{}}});x.evidenceTool=async()=>({server:'ipzitalk'});x.ipzitalkUsage={snapshot:()=>({sessionCalls:0})};x.evidenceBudget={snapshot:()=>({calls:0})};return x;};
  const codex=component('codex'),gemini=component('gemini'),claude=component('claude'),ipzitalk=component('ipzitalk');
  codex.request=async method=>{calls.push('codex:'+method);if(method==='account/read')return {account:{type:'chatgpt',email:'fixture@example.test'}};if(method==='model/list')return {data:[{id:'gpt-fixture',isDefault:true}]};if(method==='mcpServerStatus/list')return {data:[{name:'ipzitalk',tools:{get_geocode:{}}}]};return {};};
  let key=null,available=true;
  const credentials={status:async()=>({configured:!!key,available}),saveApiKey:async value=>{key=value;},readApiKey:async()=>key,clear:async()=>{key=null;}};
  gemini.models=async()=>[{id:'gemini-2.5-flash',displayName:'Gemini Flash'}];gemini.verifyConnection=async args=>{calls.push('gemini:verify');return {models:await gemini.models()};};gemini.invalidateModels=()=>calls.push('gemini:invalidate');
  let claudeKey=null;
  const claudeCredentials={status:async()=>({configured:!!claudeKey,available}),saveApiKey:async value=>{claudeKey=value;},readApiKey:async()=>claudeKey,clear:async()=>{claudeKey=null;}};
  claude.models=async()=>[{id:'claude-sonnet-4-6',displayName:'Claude Sonnet'}];claude.verifyConnection=async()=>{calls.push('claude:verify');return {models:await claude.models()};};claude.invalidateModels=()=>calls.push('claude:invalidate');
  ipzitalk.status=async()=>({connected:true});ipzitalk.login=async()=>({authorizationUrl:'https://ipji-talk.com/authorize'});
  return {bridge:new AiBridge({codex,gemini,claude,ipzitalk,credentials,claudeCredentials}),calls,codex,gemini,claude,ipzitalk,credentials,claudeCredentials,setAvailable:value=>{available=value;},get key(){return key;},get claudeKey(){return claudeKey;}};
}
test('legacy settings stay on GPT; switching retains separate models and rejects secret settings fields',()=>{
  const original=normalizeAiSettings({office:'부동산',model:'gpt-fixture',apiKey:'never-save-me'});assert.equal(original.provider,'gpt');assert.equal(original.apiKey,undefined);
  let next={...original,...updateAiSettings(original,{provider:'gemini'})};assert.equal(next.model,'');
  next={...next,...updateAiSettings(next,{model:'gemini-2.5-flash',apiKey:'never-save-me'})};
  next={...next,...updateAiSettings(next,{provider:'gpt'})};assert.equal(next.model,'gpt-fixture');
  assert.equal(updateAiSettings(next,{provider:'gemini'}).model,'gemini-2.5-flash');assert.ok(!JSON.stringify(next).includes('never-save-me'));
  next={...next,...updateAiSettings(next,{provider:'claude',model:'claude-sonnet-4-6'})};
  next={...next,...updateAiSettings(next,{provider:'gemini'})};assert.equal(next.model,'gemini-2.5-flash');
  assert.equal(updateAiSettings(next,{provider:'claude'}).model,'claude-sonnet-4-6');
  assert.equal(updateAiSettings(next,{provider:'gpt'}).model,'gpt-fixture');
  assert.throws(()=>updateAiSettings(next,{provider:'unknown'}));
  assert.notEqual(fingerprint({},'same',true,'gpt'),fingerprint({},'same',true,'gemini'));
  assert.notEqual(fingerprint({},'same',true,'claude'),fingerprint({},'same',true,'gemini'));
});
test('default GPT retains Codex login/status/evidence and never starts a Gemini transport',async()=>{
  const f=bridgeFixture(),s=await f.bridge.connectionStatus();assert.equal(s.provider,'gpt');assert.equal(s.loggedIn,true);assert.equal(s.mapConnected,true);assert.equal(s.models[0].id,'gpt-fixture');
  await f.bridge.login();assert.ok(f.calls.includes('codex:account/login/start'));assert.ok(!f.calls.some(x=>x.startsWith('gemini:')));
  assert.equal(f.bridge.evidence,f.codex);
});
test('Gemini connects independently, validates before encrypted save, and never contacts Codex',async()=>{
  const f=bridgeFixture();f.bridge.setProvider('gemini');assert.equal((await f.bridge.connectionStatus()).loggedIn,false);
  f.setAvailable(false);await assert.rejects(f.bridge.connectGemini('fixture-private-key'),/보안 저장/);assert.equal(f.calls.length,0);
  f.setAvailable(true);await f.bridge.connectGemini('fixture-private-key');assert.equal(f.key,'fixture-private-key');
  const status=await f.bridge.connectionStatus();assert.equal(status.provider,'gemini');assert.equal(status.loggedIn,true);assert.equal(status.usage,null);assert.equal(status.gemini.hasKey,true);assert.ok(!JSON.stringify(status).includes('fixture-private-key'));
  assert.equal(f.bridge.evidence,f.ipzitalk);await f.bridge.evidenceSession();await f.bridge.analyze({});await f.bridge.mapLogin();assert.ok(!f.calls.some(x=>x.startsWith('codex:')));
  await f.bridge.disconnectGemini();assert.equal(f.key,null);assert.equal((await f.bridge.connectionStatus()).loggedIn,false);
});
test('failed or cancelled connection never replaces a saved key; cancellation stops writer and evidence',async()=>{
  const f=bridgeFixture();await f.credentials.saveApiKey('original-fixture-key');f.bridge.setProvider('gemini');
  f.gemini.verifyConnection=async()=>{throw Error('검사용 실패');};await assert.rejects(f.bridge.connectGemini('replacement-fixture-key'));assert.equal(f.key,'original-fixture-key');
  const controller=new AbortController();f.gemini.verifyConnection=async({signal})=>{assert.equal(signal,controller.signal);controller.abort();};
  await assert.rejects(f.bridge.connectGemini('replacement-fixture-key',{signal:controller.signal}),/중지/);assert.equal(f.key,'original-fixture-key');
  await f.bridge.interrupt();assert.ok(f.calls.includes('gemini:interrupt'));assert.ok(f.calls.includes('ipzitalk:interrupt'));
});
test('automatic Gemini model chooses stable Flash; explicit model and retry stay within provider',async()=>{
  const models=geminiModels([{id:'gemini-3-pro-preview'},{id:'gemini-2.5-flash'},{id:'gemini-3-flash'}]);assert.equal(models.find(m=>m.isDefault).id,'gemini-3-flash');
  const s=new AnalysisService({bridge:new EventEmitter(),userData:os.tmpdir(),onEvent:()=>{}});s.settings={provider:'gemini'};
  const choice=await s.chooseModel(models);assert.equal(choice.model,'gemini-3-flash');assert.deepEqual(s.repairModel(models,choice),choice);
  s.settings.model='gemini-2.5-flash';assert.equal((await s.chooseModel(models)).model,'gemini-2.5-flash');await assert.rejects(s.chooseModel([{id:'gpt-fixture'}]),/사용 가능한/);
});
test('Claude connects independently and removing its key preserves Gemini and GPT connections',async()=>{
  const f=bridgeFixture();await f.credentials.saveApiKey('gemini-fixture-key');f.bridge.setProvider('claude');
  assert.equal((await f.bridge.connectionStatus()).loggedIn,false);
  await f.bridge.connectClaude('claude-fixture-key');assert.equal(f.claudeKey,'claude-fixture-key');
  const status=await f.bridge.connectionStatus();assert.equal(status.provider,'claude');assert.equal(status.loggedIn,true);assert.equal(status.usage,null);assert.equal(status.claude.hasKey,true);assert.equal(status.gemini.hasKey,true);
  assert.equal(status.models[0].id,'claude-sonnet-4-6');assert.ok(!JSON.stringify(status).includes('fixture-key'));
  assert.equal(f.bridge.writer,f.claude);assert.equal(f.bridge.evidence,f.ipzitalk);await f.bridge.mapLogin();await f.bridge.analyze({});
  await f.bridge.interrupt();assert.ok(f.calls.includes('claude:interrupt'));assert.ok(f.calls.includes('ipzitalk:interrupt'));
  await f.bridge.request('account/logout');assert.equal(f.claudeKey,null);assert.equal(f.key,'gemini-fixture-key');
  assert.ok(!f.calls.some(x=>x.startsWith('codex:')));assert.ok(!f.calls.includes('gemini:interrupt'));
});
test('Claude default selects newer stable Sonnet versions rather than old dated IDs or previews',()=>{
  const rows=claudeModels([{id:'claude-3-7-sonnet-20250219'},{id:'claude-sonnet-4-20250514'},{id:'claude-sonnet-4-6'},{id:'claude-sonnet-5-preview'},{id:'claude-opus-5'}]);
  assert.equal(rows.find(x=>x.isDefault).id,'claude-sonnet-4-6');assert.equal(rows.filter(x=>x.isDefault).length,1);
});
test('overlapping status requests share one read, start model and map checks together, and capture their provider',async()=>{
  const f=bridgeFixture();await f.claudeCredentials.saveApiKey('claude-fixture-key');f.bridge.setProvider('claude');
  let modelReads=0,mapReads=0,finishModels,finishMap;
  f.claude.models=()=>{modelReads++;return new Promise(resolve=>{finishModels=resolve;});};
  f.ipzitalk.status=()=>{mapReads++;return new Promise(resolve=>{finishMap=resolve;});};
  const first=f.bridge.connectionStatus(),second=f.bridge.connectionStatus();assert.equal(first,second);
  await new Promise(resolve=>setImmediate(resolve));assert.equal(modelReads,1);assert.equal(mapReads,1);
  f.bridge.setProvider('gpt');finishModels([{id:'claude-sonnet-4-6'}]);finishMap({connected:true});
  const status=await first;assert.equal(status.provider,'claude');assert.equal(status.models[0].id,'claude-sonnet-4-6');assert.equal(status.mapConnected,true);
  assert.equal((await f.bridge.connectionStatus()).provider,'gpt');
});
test('settings persistence excludes credentials and cannot change while analysis is active',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'re-provider-settings-'));
  try{const f=bridgeFixture(),s=new AnalysisService({bridge:f.bridge,userData:dir,onEvent:()=>{}});await s.init();await s.saveSettings({provider:'gemini',model:'gemini-2.5-flash',apiKey:'never-save-fixture-key'});assert.equal(f.bridge.provider,'gemini');
    const saved=await fs.readFile(path.join(dir,'settings.json'),'utf8');assert.ok(!saved.includes('never-save-fixture-key'));await s.saveSettings({provider:'gpt',model:'gpt-fixture'});await s.saveSettings({provider:'gemini'});assert.equal(s.settings.model,'gemini-2.5-flash');
    s.active={};await assert.rejects(s.saveSettings({provider:'gpt'}),/진행 중/);await assert.rejects(s.configureGemini('disconnect'),/진행 중/);await assert.rejects(s.configureClaude('disconnect'),/진행 중/);
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});

test('all three provider paths preserve contract averages, all six assessed scores, and report table/HTML format',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'re-provider-parity-')),center={lat:37.4,lng:126.64},metadata={collected_at:'2026-10-16T00:00:00Z',data_source:'kakao_category'};
  const tool=(name,data)=>({type:'mcpToolCall',server:'ipzitalk',tool:name,arguments:{},result:{structuredContent:data}});
  const place=(id,label,offset)=>({name:'가상 '+id,kakao_place_id:String(id),kakao_category_name:label,lat:center.lat+offset,lng:center.lng,distance_m:Math.round(scoring.haversine(center,{lat:center.lat+offset,lng:center.lng}))});
  const tools=[tool('get_geocode',{...center,confidence:'exact',region:{eupmyeondong:'가상동',jibun:'10-1'},metadata}),tool('search_by_nearby_category',{center,radius_m:1500,metadata,results:{subway:[place(1,'교통 > 지하철',.008)],school_elementary:[place(2,'교육 > 초등학교',.002)],mart_large:[place(3,'가정,생활 > 슈퍼마켓',.001)]}})];
  t.mock.method(require('../src/research.cjs'),'collectResearch',async()=>({tools:structuredClone(tools),issues:[],checks:[],metrics:{}}));
  const raw={target:'서울 송파구 가상동 가상단지',building:'가상단지',area:84,asOf:'2026-10-16',types:['trade','jeonse','monthly'],request:'실거주 여건 설명'};
  const contracts=[{id:'1',kind:'trade',price:100000},{id:'2',kind:'trade',price:120000},{id:'3',kind:'jeonse',deposit:60000,monthly:0},{id:'4',kind:'monthly',deposit:5000,monthly:100}].map(r=>({...r,date:'2026-08-01',building:'가상단지',location:'서울 송파구 가상동',lot:'10-1',area:84.9,areaBasis:'전용면적'}));
  const results=[];
  try{for(const provider of ['gpt','gemini','claude']){
    const b=new EventEmitter();b.analyze=async req=>({text:JSON.stringify({title:'가상단지 보고서',conclusion:'확인된 생활환경을 비교했습니다.',highlights:['확인한 시설을 기준으로 작성했습니다.'],sections:[{heading:'입지',body:'확인된 시설 접근성을 살펴보세요.'}],strengths:[],limitations:[],checks:[],scores:SCORE_ITEMS.map(name=>({name,score:provider==='gemini'?100:1,reason:'모델의 임의 점수',method:'',sourceIds:[]})),sources:[]}),tools:[],threadId:provider,webSearches:[]});
    const data={collect:async()=>({rows:structuredClone(contracts),identity:{building:'가상단지',code:'TEST01',town:'가상동',lot:'10-1',...center},coverage:[],raw:[]})};
    const s=new AnalysisService({bridge:b,data,store:new ReportStore(path.join(dir,provider)),userData:dir,onEvent:()=>{}});s.settings={provider};s.status=async()=>({loggedIn:true,mapConnected:false,models:[{id:{gpt:'gpt-6-luna',gemini:'gemini-2.5-flash',claude:'claude-sonnet-4-6'}[provider],isDefault:true,efforts:['low']}]});results.push(await s.run(raw));
  }
  const [gpt,gemini]=results,renderer=require('../src/report.cjs');assert.deepEqual(gpt.prices.summaries,gemini.prices.summaries);assert.equal(gpt.prices.summaries.find(x=>x.kind==='trade').price,110000);
  assert.deepEqual(gpt.scores,gemini.scores);assert.equal(gpt.scores.length,6);assert.ok(gpt.scores.some(s=>s.score!=null));assert.ok(gpt.scores.filter(s=>s.score!=null).every(s=>s.reason!=='모델의 임의 점수'));
  assert.deepEqual(renderer.priceRows(gpt),renderer.priceRows(gemini));assert.deepEqual(renderer.evaluationRows(gpt),renderer.evaluationRows(gemini));
  const canonical=r=>({...r,id:'same',model:'same',provider:'same',threadId:'same',createdAt:'2026-10-16',dataCheckedAt:'2026-10-16',requestFingerprint:'same',optimization:{},assessment:{...r.assessment,checkedAt:'2026-10-16'}});
  assert.equal(renderer.html(canonical(gpt)),renderer.html(canonical(gemini)));
  const claude=results[2];assert.deepEqual(gpt.prices.summaries,claude.prices.summaries);assert.deepEqual(gpt.scores,claude.scores);assert.deepEqual(renderer.priceRows(gpt),renderer.priceRows(claude));assert.deepEqual(renderer.evaluationRows(gpt),renderer.evaluationRows(claude));assert.equal(renderer.html(canonical(gpt)),renderer.html(canonical(claude)));
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});
