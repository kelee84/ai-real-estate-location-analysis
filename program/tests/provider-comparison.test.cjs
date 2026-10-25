'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {AiBridge}=require('../src/ai-bridge.cjs'),{AnalysisService}=require('../src/service.cjs'),{ReportStore}=require('../src/store.cjs');
const {SCORE_ITEMS}=require('../src/core.cjs'),scoring=require('../src/scoring.cjs'),renderer=require('../src/report.cjs');
const asOf='2026-10-16',model={gpt:'gpt-6-luna',gemini:'gemini-2.5-flash',claude:'claude-sonnet-4-6'};
function body(provider,members){
  const scores=SCORE_ITEMS.map(name=>({name,score:provider==='gpt'?1:100,reason:'모델이 만든 임의 점수',method:'임의 배점',sourceIds:[]}));
  return {title:'생활환경 비교 보고서',conclusion:'확인된 시설과 거래 조건을 비교했습니다.',highlights:['확인된 등록 시설을 기준으로 비교했습니다.'],sections:[{heading:'선택 기준',body:'생활환경 접근성과 거래 조건을 함께 살펴보세요.'}],strengths:[],limitations:[],checks:[],scores,methodology:'모든 단지에 공통 기준을 적용합니다.',members:members.map(m=>({key:m.key,strengths:['공통 기준으로 거래 자료를 확인했습니다.'],limitations:[],scores})),sources:[]};
}
function research(input,prices){
  const center={lat:prices.buildingResolution.lat,lng:prices.buildingResolution.lng},index=Number(prices.buildingResolution.code.at(-1));
  const metadata={collected_at:asOf+'T00:00:00Z',data_source:'kakao_category'};
  const point={lat:center.lat+(.002+index*.004),lng:center.lng},station={name:'시험역'+index,kakao_place_id:String(90001+index),kakao_category_name:'교통 > 지하철',...point,distance_m:Math.round(scoring.haversine(center,point))};
  const tool=(name,data)=>({type:'mcpToolCall',server:'ipzitalk',tool:name,arguments:{},result:{structuredContent:data}});
  return {tools:[tool('get_geocode',{...center,confidence:'exact',region:{eupmyeondong:'가상동',jibun:String(index+1)},metadata}),tool('search_by_nearby_category',{center,radius_m:1500,metadata,results:{subway:[station]}})],issues:[],checks:[],metrics:{}};
}
async function fixture(t,fn,{asset='apartment',count=2}={}){
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'re-provider-comparison-')),calls=[],queries=[],store=new ReportStore(path.join(dir,'reports'));
  const component=name=>{const x=new EventEmitter();x.interrupt=async()=>calls.push({provider:name,interrupt:true});x.stop=()=>{};x.ipzitalkUsage={snapshot:()=>({})};x.evidenceBudget={snapshot:()=>({}),run:async(_options,work)=>work()};return x;};
  const codex=component('gpt'),gemini=component('gemini'),claude=component('claude'),ipzitalk=component('ipzitalk');
  for(const [provider,writer]of [['gpt',codex],['gemini',gemini],['claude',claude]])writer.analyze=async request=>{calls.push({provider,...request});return {text:JSON.stringify(body(provider,JSON.parse(request.prompt.split('\n필수 구조')[0]).members)),tools:[],threadId:provider};};
  // No request method is installed: an accidental Codex/Google account or
  // transport call fails instead of reaching a real account in this fixture.
  const bridge=new AiBridge({codex,gemini,claude,ipzitalk,credentials:{status:async()=>({configured:true,available:true})},claudeCredentials:{status:async()=>({configured:true,available:true})}});
  const data={collect:async input=>{
    const index=input.building.charCodeAt(input.building.length-1)-65;queries.push(input.target);
    const common={date:'2026-08-01',building:input.building,location:'서울 송파구 가상동',lot:String(index+1),area:84.9,areaBasis:'전용면적'};
    const base=(index+1)*100000,contract=(id,values)=>({...common,id:input.building+'-'+id,...values});
    const rows=[contract('t1',{kind:'trade',price:base}),contract('t2',{kind:'trade',price:base+20000}),contract('j1',{kind:'jeonse',deposit:60000+index*10000,monthly:0}),contract('j2',{kind:'jeonse',deposit:80000+index*10000,monthly:0}),contract('m1',{kind:'monthly',deposit:5000,monthly:100+index*10}),contract('m2',{kind:'monthly',deposit:5000,monthly:120+index*10})];
    rows.push({...rows[0]},contract('old',{kind:'trade',price:999999,date:'2026-04-15'}),contract('future',{kind:'trade',price:999999,date:'2026-10-17'}),contract('cancelled',{kind:'trade',price:999999,cancelled:true}));
    return {rows,identity:{building:input.building,code:'building-'+index,town:'가상동',lot:String(index+1),lat:37.4+index*.02,lng:126.64},coverage:[],raw:[{deal:'trade',bytes:Buffer.from('검증용 공식 원자료 '+input.building).toString('base64'),form:{}}]};
  }};
  const service=new AnalysisService({bridge,data,store,userData:dir,onEvent:()=>{}});await service.init();
  service.status=async()=>({provider:bridge.provider,loggedIn:true,mapConnected:false,models:[{id:model[bridge.provider],isDefault:true,efforts:['low']}]});
  t.mock.method(require('../src/research.cjs'),'collectResearch',async(_bridge,input,prices)=>research(input,prices));
  const raw={mode:'comparison',properties:Array.from({length:count},(_,i)=>({target:'서울 송파구 가상동 가상단지'+String.fromCharCode(65+i),building:'가상단지'+String.fromCharCode(65+i),area:84,asset})),types:['trade','jeonse','monthly'],asOf,request:'실거주 생활환경과 거래 조건 비교'};
  const select=async provider=>service.saveSettings({provider,model:model[provider]});
  try{await fn({dir,store,service,bridge,codex,gemini,claude,ipzitalk,calls,queries,raw,select});}finally{await fs.rm(dir,{recursive:true,force:true});}
}
// Report metadata legitimately differs per generation. Normalize only those
// timestamps/identifiers; all customer-visible content and tables remain exact.
function canonical(report){
  const visit=value=>Array.isArray(value)?value.map(visit):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([k,v])=>[k,['createdAt','dataCheckedAt','checkedAt'].includes(k)?asOf:visit(v)])):value;
  return {...visit(report),id:'same-report',provider:'same-provider',model:'same-model'};
}
for(const count of [2,3])test(count+'-property GPT/Gemini/Claude comparison preserves independent contract filters, six scores, and exact HTML layout',async t=>fixture(t,async f=>{
  const reports=[];
  for(const provider of ['gpt','gemini','claude']){await f.select(provider);reports.push(await f.service.run(f.raw));}
  const [gpt,gemini,claude]=reports;assert.equal(gpt.members.length,count);assert.equal(gemini.members.length,count);assert.equal(claude.members.length,count);
  assert.deepEqual(gpt.members.map(m=>m.prices),gemini.members.map(m=>m.prices));
  assert.deepEqual(gpt.members.map(m=>m.scores),gemini.members.map(m=>m.scores));
  for(const [index,member]of gemini.members.entries()){
    assert.deepEqual(member.prices.period,{start:'2026-04-16',end:asOf});
    assert.deepEqual(member.prices.summaries.map(s=>[s.kind,s.n,s.price,s.deposit,s.monthly]),[['trade',2,(index+1)*100000+10000,null,null],['jeonse',2,null,70000+index*10000,null],['monthly',2,null,5000,110+index*10]]);
    assert.deepEqual(member.prices.excluded,{outside:2,cancelled:1,duplicate:1,condition:0,invalid:0});
    assert.deepEqual(member.scores.map(s=>s.name),SCORE_ITEMS);assert.ok(member.scores.some(s=>s.score!=null));
    assert.equal(member.scores.find(s=>s.name==='교통 환경').score,[95,70,55][index]);
    assert.ok(member.scores.filter(s=>s.score!=null).every(s=>s.reason!=='모델이 만든 임의 점수'));
    assert.deepEqual(renderer.priceRows(gpt.members[index]),renderer.priceRows(member));
    assert.deepEqual(renderer.evaluationRows(gpt.members[index]),renderer.evaluationRows(member));
  }
  assert.equal(renderer.html(canonical(gpt)),renderer.html(canonical(gemini)));
  assert.deepEqual(claude.members.map(m=>m.prices),gemini.members.map(m=>m.prices));assert.deepEqual(claude.members.map(m=>m.scores),gemini.members.map(m=>m.scores));assert.equal(renderer.html(canonical(gpt)),renderer.html(canonical(claude)));
  assert.deepEqual(f.calls.filter(c=>c.prompt).map(c=>[c.provider,c.model]),[['gpt',model.gpt],['gemini',model.gemini],['claude',model.claude]]);
},{count}));

for(const provider of ['gemini','claude'])test(provider+' cannot return another provider cached comparison or its previous customer prose',async t=>fixture(t,async f=>{
  await f.select('gpt');const old=await f.service.run(f.raw),secret='이전고객전용기밀문장';old.sections=[{heading:'개인 상담',body:secret}];old.strengths=[secret];for(const m of old.members){m.sections=[{heading:'개인 상담',body:secret}];m.strengths=[secret];}await f.store.save(old);
  const cached=await f.service.run(f.raw);assert.equal(cached.id,old.id);assert.equal(cached.reused,true);assert.equal(f.calls.length,1);
  // Force the verified-evidence reuse branch independently of live-day checks.
  // It must still write new content instead of forwarding old AI prose.
  t.mock.method(require('../src/same-day-reuse.cjs'),'find',async()=>structuredClone(old));
  await f.select(provider);const fresh=await f.service.run(f.raw);
  assert.notEqual(fresh.id,old.id);assert.notEqual(fresh.requestFingerprint,old.requestFingerprint);assert.equal(fresh.provider,provider);assert.equal(fresh.model,model[provider]);assert.equal(fresh.sameDayReuse.sourceReportId,old.id);
  const request=f.calls.at(-1);assert.equal(request.provider,provider);assert.ok(!request.prompt.includes(secret));assert.ok(!JSON.stringify(fresh).includes(secret));assert.equal(f.queries.length,2);
  const again=await f.service.run(f.raw);assert.equal(again.id,fresh.id);assert.equal(again.reused,true);assert.equal(f.calls.length,2);
},{asset:'officetel'}));

for(const provider of ['gemini','claude'])test(provider+' saved comparison revision preserves each property calculation and raw evidence',async t=>fixture(t,async f=>{
  await f.select('gpt');const old=await f.service.run(f.raw),original=await fs.readFile(path.join(f.store.path(old.id),'report.json'),'utf8');
  await f.select(provider);const revised=await f.service.run({...old.input,request:'문장을 짧게 정리'},{revisionId:old.id});
  assert.equal(revised.provider,provider);assert.equal(revised.model,model[provider]);assert.equal(revised.revisionOf,old.id);assert.equal(f.calls.at(-1).provider,provider);assert.equal(f.queries.length,3);
  const storedOld=JSON.parse(original);assert.deepEqual(revised.members.map(m=>m.prices),storedOld.members.map(m=>m.prices));assert.deepEqual(revised.members.map(m=>m.scores),storedOld.members.map(m=>m.scores));
  for(const member of revised.members)assert.equal(await fs.readFile(path.join(f.store.path(revised.id),'raw',member.key+'-RTMS-trade.csv'),'utf8'),'검증용 공식 원자료 '+member.input.building);
  assert.equal(await fs.readFile(path.join(f.store.path(old.id),'report.json'),'utf8'),original);
},{count:3}));

for(const provider of ['gemini','claude'])test(provider+' malformed-comparison repair never switches provider or saves a partial report',async t=>fixture(t,async f=>{
  await f.select(provider);f[provider].analyze=async request=>{f.calls.push({provider,...request});return {text:'{"title":"불완전한 보고서"}',tools:[]};};
  await assert.rejects(f.service.run(f.raw),/필수 항목이 부족/);assert.equal(f.service.active,null);assert.equal((await f.store.list()).length,0);
  assert.deepEqual(f.calls.filter(c=>c.prompt).map(c=>[c.provider,c.model]),[[provider,model[provider]],[provider,model[provider]]]);
}));

for(const provider of ['gemini','claude'])test(provider+' repairs one invalid JSON response with the same model, records both attempts and preserves scores',async t=>fixture(t,async f=>{
  await f.select(provider);let tries=0;const normal=f[provider].analyze;
  f[provider].analyze=async request=>{assert.ok(request.signal instanceof AbortSignal);if(++tries===1){f.calls.push({provider,...request});const error=new Error('원문을 노출하지 않는 JSON 오류');error.code='AI_INVALID_RESPONSE';error.tokenUsage={totalTokens:7};throw error;}return normal(request);};
  const report=await f.service.run(f.raw);assert.equal(report.provider,provider);assert.equal(report.model,model[provider]);assert.equal(report.optimization.attempts,2);assert.equal(report.optimization.usage[0].invalidResponse,true);assert.equal(report.optimization.usage[0].tokens.totalTokens,7);
  assert.deepEqual(f.calls.filter(c=>c.prompt).map(c=>[c.provider,c.model]),[[provider,model[provider]],[provider,model[provider]]]);assert.equal(report.members[0].scores.find(s=>s.name==='교통 환경').score,95);
}));

test('Claude repeated invalid response never saves a partial comparison and releases its active lock',async t=>fixture(t,async f=>{
  await f.select('claude');let tries=0;f.claude.analyze=async()=>{tries++;const error=new Error('JSON 형식 오류');error.code='AI_INVALID_RESPONSE';throw error;};
  await assert.rejects(f.service.run(f.raw),/필수 항목이 부족/);assert.equal(tries,2);assert.equal((await f.store.list()).length,0);assert.equal(f.service.active,null);
}));

test('comparison cancellation reaches the selected writer and never starts a repair or saves a report',async t=>fixture(t,async f=>{
  await f.select('claude');let ready,tries=0;const started=new Promise(resolve=>ready=resolve);
  f.claude.analyze=async({signal})=>{tries++;ready();return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('분석을 중지했습니다.')),{once:true}));};
  const work=f.service.run(f.raw);await started;f.service.active.controller.abort();await assert.rejects(work,/중지/);assert.equal(tries,1);assert.equal((await f.store.list()).length,0);assert.equal(f.service.active,null);
}));

test('cancellation after comparison text generation still prevents persistence',async t=>fixture(t,async f=>{
  await f.select('claude');f.service.onEvent=event=>{if(event.stage==='validation')f.service.active.controller.abort();};
  await assert.rejects(f.service.run(f.raw),/중지/);assert.equal(f.calls.filter(c=>c.prompt).length,1);assert.equal((await f.store.list()).length,0);assert.equal(f.service.active,null);
}));
