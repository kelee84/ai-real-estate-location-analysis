'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {GeminiBridge,schemaForGemini}=require('../src/gemini.cjs');
const {reportSchema}=require('../src/schema.cjs');
const key='AIza0123456789_TEST_API_KEY_NO_NETWORK',model='gemini-2.5-flash';
const simpleSchema={type:'object',properties:{conclusion:{type:'string'}},required:['conclusion'],additionalProperties:false};
const reply=(data,status=200)=>({ok:status>=200&&status<300,status,json:async()=>data});
const answer=(text='{"conclusion":"기존 자료로 작성"}',extra={})=>({candidates:[{content:{parts:[{text}]},finishReason:'STOP',...extra}],usageMetadata:{promptTokenCount:10,candidatesTokenCount:20,thoughtsTokenCount:3,totalTokenCount:33}});
const listing=(extra={})=>({models:[{name:'models/'+model,displayName:'Gemini Flash',supportedGenerationMethods:['generateContent'],inputTokenLimit:1000000,outputTokenLimit:65536}],...extra});
function client(fetchImpl,options={}){return new GeminiBridge({getApiKey:async()=>key,fetchImpl,sleepImpl:async()=>{},random:()=>0,...options});}

test('model discovery uses authenticated GET, paginates, filters non-report models and caches per key',async()=>{
  let calls=[];const bridge=client(async(url,options)=>{calls.push({url,options});return reply(calls.length===1?listing({models:[...listing().models,{name:'models/gemini-2.5-image',supportedGenerationMethods:['generateContent']},{name:'models/gemini-2.5-flash-tts',supportedGenerationMethods:['generateContent']},{name:'models/text-embedding',supportedGenerationMethods:['embedContent']},{name:'models/gemini-bad/id',supportedGenerationMethods:['generateContent']}],nextPageToken:'page token'}):listing({models:[{name:'models/gemini-3.8-flash',supportedGenerationMethods:['generateContent']}]}));});
  const models=await bridge.models();assert.deepEqual(models.map(value=>value.id),[model,'gemini-3.8-flash']);assert.equal(models[0].displayName,'Gemini Flash');
  assert.equal(calls.length,2);assert.match(calls[1].url,/pageToken=page%20token$/);
  for(const {url,options}of calls){assert.equal(options.method,'GET');assert.equal(options.headers['x-goog-api-key'],key);assert.equal(options.redirect,'error');assert.ok(!url.includes(key));assert.equal(options.body,undefined);}
  models[0].displayName='mutated';assert.equal((await bridge.models())[0].displayName,'Gemini Flash');assert.equal(calls.length,2);
  await bridge.models({apiKey:'AIzaDifferent0123456789_API_KEY_FOR_TEST'});assert.equal(calls.length,3);
});

test('connection verification is a models read without a billable generation and validates selection',async()=>{
  const calls=[];const bridge=client(async(url,options)=>{calls.push({url,options});return reply(listing());});
  const status=await bridge.verifyConnection({model});assert.equal(status.connected,true);assert.equal(status.model,model);assert.equal(calls.length,1);assert.equal(calls[0].options.method,'GET');
  await assert.rejects(bridge.verifyConnection({model:'gemini-missing'}),/다른 모델/);
  assert.equal((await bridge.verifyConnection()).model,null);
});

test('explicit model-cache invalidation forces credential changes and revoked-key checks back to the server',async()=>{
  let calls=0;const bridge=client(async()=>{calls++;return calls<3?reply(listing()):reply({error:{message:key}},403);});
  await bridge.models();await bridge.models();assert.equal(calls,1);bridge.invalidateModels();await bridge.models();assert.equal(calls,2);
  await assert.rejects(bridge.verifyConnection(),/사용 권한/);assert.equal(calls,3);
});

test('model discovery fails on missing text models or repeated pagination and never trusts reflected key fields',async()=>{
  await assert.rejects(client(async()=>reply({models:[]})).models(),/텍스트 모델/);
  await assert.rejects(client(async()=>reply(listing({nextPageToken:'again'}))).models(),/끝까지/);
  const models=await client(async()=>reply(listing({models:[{name:'models/'+model,displayName:key,description:'contains '+key,inputTokenLimit:{key},supportedGenerationMethods:['generateContent']}]}))).models();
  assert.doesNotMatch(JSON.stringify(models),new RegExp(key));assert.equal(models[0].inputTokenLimit,undefined);
});

test('ordinary reports preserve complete six-axis schema and use one structured generation with no tools',async()=>{
  const calls=[];const bridge=client(async(url,options)=>{calls.push({url,options});return reply(answer());});
  const result=await bridge.analyze({model,prompt:'기존 거래 평균과 점수',instructions:'6개 평가 항목과 양식을 유지한다.',schema:reportSchema,externalTools:false});
  assert.equal(calls.length,1);const body=JSON.parse(calls[0].options.body);
  assert.equal(body.contents[0].parts[0].text,'기존 거래 평균과 점수');assert.match(body.systemInstruction.parts[0].text,/6개 평가 항목과 양식을 유지한다/);
  assert.deepEqual(body.generationConfig.responseFormat.text,{mimeType:'APPLICATION_JSON',schema:reportSchema});assert.equal(body.tools,undefined);
  assert.equal(calls[0].url,'https://generativelanguage.googleapis.com/v1beta/models/'+model+':generateContent');assert.ok(!calls[0].url.includes(key));
  assert.deepEqual(JSON.parse(result.text),{conclusion:'기존 자료로 작성'});assert.deepEqual(result.tools,[]);assert.deepEqual(result.webSearches,[]);assert.match(result.threadId,/^gemini-/);
  assert.deepEqual(result.tokenUsage,{inputTokens:10,cachedInputTokens:0,outputTokens:23,reasoningOutputTokens:3,totalTokens:33});
});

test('schema normalization adds missing enum types without mutating bounds, required, null or source schema',()=>{
  const schema={type:'object',additionalProperties:false,properties:{axis:{enum:['교통 환경','교육 환경']},score:{type:['integer','null'],minimum:1,maximum:100},sources:{type:'array',minItems:0,maxItems:9,items:{type:'string'}}},required:['axis','score','sources']};
  const original=structuredClone(schema),normalized=schemaForGemini(schema);assert.deepEqual(schema,original);assert.equal(normalized.properties.axis.type,'string');
  delete normalized.properties.axis.type;assert.deepEqual(normalized,schema);
});

test('grounded web-only research uses Google Search, then schema synthesis retaining source citations and token totals',async()=>{
  const groundingMetadata={webSearchQueries:['서울 공식 개통계획'],groundingChunks:[{web:{uri:'https://www.seoul.go.kr/official',title:'서울시 공식 자료'}}],groundingSupports:[{segment:{startIndex:0,endIndex:8,text:'2027년 개통'},groundingChunkIndices:[0]}],searchEntryPoint:{renderedContent:'<div>Google Search Suggestions</div>'}};
  const calls=[];const bridge=client(async(url,options)=>{calls.push(JSON.parse(options.body));return reply(calls.length===1?answer('공식 자료에서 2027년 개통을 확인. https://www.seoul.go.kr/official',{groundingMetadata}):answer('{"conclusion":"2027년 개통 예정"}'));});
  const result=await bridge.analyze({model,prompt:'인근 예정 사업',instructions:'공식 원문의 날짜와 연속 구절을 보존',schema:simpleSchema,webOnly:true,externalTools:false});
  assert.equal(calls.length,2);assert.deepEqual(calls[0].tools,[{googleSearch:{}}]);assert.deepEqual(calls[0].generationConfig,{thinkingConfig:{thinkingBudget:1024}});assert.equal(calls[1].tools,undefined);assert.deepEqual(calls[1].generationConfig.responseFormat.text.schema,simpleSchema);
  assert.match(calls[1].contents[0].parts[0].text,/2027년 개통/);assert.match(calls[1].contents[0].parts[0].text,/seoul.go.kr/);assert.match(calls[0].systemInstruction.parts[0].text,/공식 원문의 날짜와 연속 구절을 보존/);
  assert.equal(result.tokenUsage.totalTokens,66);assert.equal(result.webSearches[0].provider,'gemini');assert.deepEqual(result.webSearches[0].groundingMetadata,groundingMetadata);
});

test('missing grounding sources never turn an unverified research answer into report evidence',async()=>{
  const calls=[];const bridge=client(async(url,options)=>{calls.push(JSON.parse(options.body));return reply(calls.length===1?answer('근거 없이 지어낸 개발계획',{groundingMetadata:{webSearchQueries:['공식 사업 검색']}}):answer());});
  const result=await bridge.analyze({model,prompt:'개발계획',schema:simpleSchema,externalTools:true});
  assert.equal(calls.length,2);assert.doesNotMatch(calls[1].contents[0].parts[0].text,/근거 없이 지어낸/);assert.match(calls[1].contents[0].parts[0].text,/검증 가능한 웹 출처가 반환되지/);assert.deepEqual(result.webSearches[0].queries,['공식 사업 검색']);
});

test('malformed and unsafe grounding URLs are omitted without changing valid citation indices',async()=>{
  let called=0;const bridge=client(async()=>reply(++called===1?answer('검색 근거',{groundingMetadata:{groundingChunks:[{web:{uri:'javascript:alert(1)'}},{web:{uri:'https://www.seoul.go.kr/doc',title:'공식 자료'}}],groundingSupports:[{segment:{text:'근거'},groundingChunkIndices:[0,1]}]}}):answer()));
  const result=await bridge.analyze({model,prompt:'질문',schema:simpleSchema});const metadata=result.webSearches[0].groundingMetadata;
  assert.equal(metadata.groundingChunks[0],null);assert.deepEqual(metadata.groundingSupports[0].groundingChunkIndices,[1]);assert.equal(result.webSearches[0].sources.length,1);
});

test('HTTP failures provide useful errors without reflecting server bodies, API keys or URLs',async()=>{
  for(const [status,pattern]of [[400,/모델/],[401,/API 키/],[403,/사용 권한/],[404,/모델/],[429,/한도/],[500,/서버/],[504,/시간/]]){
    const bridge=client(async()=>reply({error:{message:'SECRET '+key+' https://example.com/?key='+key}},status));
    await assert.rejects(bridge.analyze({model,prompt:'질문',externalTools:false}),error=>pattern.test(error.message)&&!error.message.includes(key)&&!error.message.includes('example.com'));
  }
  const invalidKey=client(async()=>reply({error:{details:[{reason:'API_KEY_INVALID'}]}},400));await assert.rejects(invalidKey.models(),/API 키/);
  for(const source of [async()=>{const error=new Error(key);error.geminiSafe=true;throw error;},async()=>({ok:false,status:403,json:async()=>{throw new Error(key);}})])await assert.rejects(client(source).models(),error=>!error.message.includes(key));
});

test('candidate blocks, truncation, hidden thoughts and invalid structured JSON are handled explicitly',async()=>{
  for(const [body,pattern]of [[{promptFeedback:{blockReason:'SAFETY'}},/제한/],[answer('x',{finishReason:'MAX_TOKENS'}),/출력 한도/],[answer('x',{finishReason:'SAFETY'}),/끝까지/],[answer(''),/본문/],[answer('{bad'),/JSON/]])await assert.rejects(client(async()=>reply(body)).analyze({model,prompt:'질문',schema:simpleSchema,externalTools:false}),pattern);
  const body=answer();body.candidates[0].content.parts=[{text:'secret thoughts',thought:true},{text:'```json\n{"conclusion":"결과"}\n```'}];
  assert.equal((await client(async()=>reply(body)).analyze({model,prompt:'질문',schema:simpleSchema,externalTools:false})).text,'{"conclusion":"결과"}');
});

test('API keys reflected in generated text are redacted before returning or retaining results',async()=>{
  const result=await client(async()=>reply(answer(JSON.stringify({conclusion:key})))).analyze({model,prompt:'질문',schema:simpleSchema,externalTools:false});assert.doesNotMatch(JSON.stringify(result),new RegExp(key));
});

test('opaque Gemini auth keys pass unchanged in the header and are redacted in raw, JSON, URL and HTML forms',async()=>{
  const secret='AQ.'+'SYNTHETIC_ONLY_'.repeat(45)+'+/=.:!@#$%^&*()[]{}\\|;\'"<>?,`~';let calls=0;
  const bridge=client(async(url,options)=>{
    calls++;assert.equal(options.headers['x-goog-api-key'],secret);assert.ok(!url.includes(secret));
    const html=secret.replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
    return reply(calls===1?listing({models:[{name:'models/'+model,supportedGenerationMethods:['generateContent'],displayName:JSON.stringify(secret),description:html+' '+encodeURIComponent(secret)}]}):answer(JSON.stringify({conclusion:secret,encoded:encodeURIComponent(secret),html})));
  },{getApiKey:async()=>secret});
  const models=await bridge.models();const result=await bridge.analyze({model,prompt:'질문',schema:simpleSchema,externalTools:false});
  for(const value of [JSON.stringify(models),result.text])for(const variant of [secret,JSON.stringify(secret).slice(1,-1),encodeURIComponent(secret)])assert.ok(!value.includes(variant));
  assert.equal(JSON.parse(result.text).conclusion,'[비공개]');assert.equal(JSON.parse(result.text).encoded,'[비공개]');assert.equal(JSON.parse(result.text).html,'[비공개]');
});

test('fresh malformed keys fail before HTTP with safe format guidance while storage errors cannot leak credentials',async()=>{
  let calls=0;const bridge=client(async()=>{calls++;return reply(listing());});
  for(const secret of ['AQ.'+'X'.repeat(40)+'\r\nx-secret: injected','AQ.'+'X'.repeat(9000),'AQ.'+'X'.repeat(40)+' 한글']){
    await assert.rejects(bridge.verifyConnection({apiKey:secret}),error=>/형식을 확인/.test(error.message)&&/한 줄로/.test(error.message)&&!error.message.includes(secret)&&!error.message.includes('저장한 뒤'));
  }
  assert.equal(calls,0);
  await assert.rejects(client(async()=>reply(listing()),{getApiKey:async()=>{throw new Error('PRIVATE_STORAGE_KEY '+key);}}).models(),error=>/불러오지 못했습니다/.test(error.message)&&!error.message.includes(key));
});

test('interrupt aborts an in-flight request even when a transport ignores abort and a later turn works',async()=>{
  let started,called=0;const ready=new Promise(resolve=>started=resolve);const bridge=client(async()=>{if(++called===1){started();return new Promise(()=>{});}return reply(answer());});
  const work=bridge.analyze({model,prompt:'질문',externalTools:false});await ready;
  await assert.rejects(bridge.analyze({model,prompt:'다른 질문',externalTools:false}),/진행 중/);await bridge.interrupt();await assert.rejects(work,/중지/);
  assert.equal(bridge.turn,null);assert.equal(bridge.operations.size,0);assert.equal(JSON.parse((await bridge.analyze({model,prompt:'다시',externalTools:false})).text).conclusion,'기존 자료로 작성');
});

test('caller abort, response-body timeout and model-list timeout all release pending operations',async()=>{
  const controller=new AbortController();controller.abort();const bridge=client(async()=>{throw new Error('must not call');});await assert.rejects(bridge.analyze({model,prompt:'질문',externalTools:false,signal:controller.signal}),/중지/);assert.equal(bridge.turn,null);
  const slow=client(async()=>({ok:true,status:200,json:()=>new Promise(()=>{})}),{timeoutMs:15});await assert.rejects(slow.analyze({model,prompt:'질문',externalTools:false}),/15분/);assert.equal(slow.operations.size,0);
  const models=client(()=>new Promise(()=>{}),{modelsTimeoutMs:15});await assert.rejects(models.models(),/모델 목록 응답이 늦습니다/);assert.equal(models.operations.size,0);
});

test('stop cancels pending requests and invalidates model cache, malformed model paths and missing keys never call network',async()=>{
  let resolveStart;const started=new Promise(resolve=>resolveStart=resolve);const bridge=client(()=>{resolveStart();return new Promise(()=>{});});const work=bridge.models();await started;bridge.stop();await assert.rejects(work,/중지/);
  for(const invalid of ['gemini-test?key=secret','../models/gemini-test','https://example.com',''])await assert.rejects(client(()=>{throw new Error('network must not run');}).analyze({model:invalid,prompt:'질문'}),/모델/);
  await assert.rejects(new GeminiBridge({getApiKey:async()=>{throw new Error(key);},fetchImpl:()=>{throw new Error('network must not run');}}).models(),error=>/API 키/.test(error.message)&&!error.message.includes(key));
});

test('explicit transient rejections retry at most twice, preserving request and honoring Retry-After and RetryInfo',async()=>{
  const calls=[],waits=[];const bridge=client(async(url,options)=>{calls.push({url,body:options.body});if(calls.length===1)return {...reply({error:{details:[{retryDelay:'2.5s'}]}},429),headers:{get:name=>name==='retry-after'?'1':null}};if(calls.length===2)return reply({},503);return reply(answer());},{sleepImpl:async ms=>waits.push(ms)});
  assert.equal(JSON.parse((await bridge.analyze({model,prompt:'고정 계산을 유지',schema:simpleSchema,externalTools:false})).text).conclusion,'기존 자료로 작성');
  assert.equal(calls.length,3);assert.deepEqual(waits,[2500,2000]);assert.ok(calls.every(call=>call.url===calls[0].url&&call.body===calls[0].body));
  let count=0;const bounded=client(async()=>{count++;return reply({},503);});await assert.rejects(bounded.models(),/서버/);assert.equal(count,3);assert.equal(bounded.operations.size,0);
});

test('long retry delays, authorization errors, refusals and ambiguous network failures do not repeat generation',async()=>{
  for(const source of [()=>({...reply({},429),headers:{get:()=> '120'}}),()=>reply({error:{message:key}},403),()=>reply(answer('',{finishReason:'SAFETY'})),()=>{throw new Error('request may already be billed '+key);}]){
    let calls=0,waits=0;const bridge=client(async()=>{calls++;return source();},{sleepImpl:async()=>waits++});
    await assert.rejects(bridge.analyze({model,prompt:'질문',externalTools:false}),error=>!error.message.includes(key));assert.equal(calls,1);assert.equal(waits,0);
  }
});

test('HTTP-date Retry-After is respected and cancellation interrupts a retry wait before another HTTP call',async()=>{
  let calls=0;const waits=[],deadline=new Date(Date.now()+10000).toUTCString();const bridge=client(async()=>++calls===1?{...reply({},429),headers:{get:()=>deadline}}:reply(answer()),{sleepImpl:async ms=>waits.push(ms)});
  await bridge.analyze({model,prompt:'질문',externalTools:false});assert.equal(calls,2);assert.ok(waits[0]>=8500&&waits[0]<=10000);
  let ready;const waiting=new Promise(resolve=>ready=resolve),controller=new AbortController();calls=0;
  const cancelled=client(async()=>{calls++;return reply({},503);},{sleepImpl:()=>{ready();return new Promise(()=>{});}});
  const work=cancelled.analyze({model,prompt:'질문',externalTools:false,signal:controller.signal});await waiting;controller.abort();await assert.rejects(work,/중지/);assert.equal(calls,1);assert.equal(cancelled.operations.size,0);
});

test('simultaneous model reads share one HTTP request while caller cancellation and results remain isolated',async()=>{
  let calls=0,release;const response=new Promise(resolve=>release=resolve),controller=new AbortController();const bridge=client(async()=>{calls++;return response;});
  const first=bridge.models({signal:controller.signal}),second=bridge.models();await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,1);
  controller.abort();await assert.rejects(first,/중지/);assert.equal(bridge.operations.size,1);release(reply(listing()));const result=await second;assert.equal(result[0].id,model);result[0].id='mutated';assert.equal((await bridge.models())[0].id,model);assert.equal(calls,1);assert.equal(bridge.operations.size,0);
});

test('all cancelled model subscribers abort transport and a fresh read can immediately succeed',async()=>{
  let calls=0;const bridge=client(async()=>++calls===1?new Promise(()=>{}):reply(listing())),a=new AbortController(),b=new AbortController();
  const first=bridge.models({signal:a.signal}),second=bridge.models({signal:b.signal});await new Promise(resolve=>setImmediate(resolve));a.abort();b.abort();await Promise.all([assert.rejects(first,/중지/),assert.rejects(second,/중지/)]);
  assert.equal((await bridge.models())[0].id,model);assert.equal(calls,2);assert.equal(bridge.operations.size,0);
});

test('cache invalidation cannot be undone by an older in-flight model response',async()=>{
  let calls=0,release;const old=new Promise(resolve=>release=resolve);const bridge=client(async()=>++calls===1?old:reply(listing({models:[{name:'models/gemini-3-flash',supportedGenerationMethods:['generateContent']}]})));
  const first=bridge.models();await new Promise(resolve=>setImmediate(resolve));bridge.invalidateModels();const fresh=await bridge.models();assert.equal(fresh[0].id,'gemini-3-flash');release(reply(listing()));await first;assert.equal((await bridge.models())[0].id,'gemini-3-flash');assert.equal(calls,2);
});

test('invalid JSON and empty text expose a repairable code without marking blocked or truncated replies repairable',async()=>{
  for(const text of ['', '{bad'])await assert.rejects(client(async()=>reply(answer(text))).analyze({model,prompt:'질문',schema:simpleSchema,externalTools:false}),error=>error.code==='AI_INVALID_RESPONSE'&&error.tokenUsage.totalTokens===33);
  for(const finishReason of ['MAX_TOKENS','SAFETY'])await assert.rejects(client(async()=>reply(answer('partial',{finishReason}))).analyze({model,prompt:'질문',schema:simpleSchema,externalTools:false}),error=>!error.code);
});

test('cancelling from a retry progress update leaves no orphan rejection or repeated HTTP call',async()=>{
  let calls=0;const bridge=new GeminiBridge({getApiKey:async()=>key,fetchImpl:async()=>{calls++;return reply({},503);}});
  bridge.on('progress',event=>{if(event.message.includes('다시 연결'))bridge.interrupt();});
  await assert.rejects(bridge.analyze({model,prompt:'질문',externalTools:false}),/중지/);await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,1);assert.equal(bridge.operations.size,0);
});

test('low effort maps only documented stable models to supported thinking controls while keeping the entire output schema',async()=>{
  const {comparisonSchema}=require('../src/comparison.cjs');
  const supported=[...['gemini-3.8-flash','gemini-3.6-flash','gemini-3.5-flash-lite','gemini-3.1-flash-lite','gemini-3-flash'].map(id=>[id,{thinkingLevel:'low'}]),...['gemini-2.5-pro','gemini-2.5-flash'].map(id=>[id,{thinkingBudget:1024}]),['gemini-2.5-flash-lite',{thinkingBudget:0}]];
  for(const [selected,config]of supported){
    let body;const bridge=client(async(url,options)=>{body=JSON.parse(options.body);return reply(answer());});
    await bridge.analyze({model:selected,effort:'low',prompt:'두 단지의 저장 근거만 비교',schema:comparisonSchema,externalTools:false});
    assert.deepEqual(body.generationConfig.thinkingConfig,config,selected);assert.deepEqual(body.generationConfig.responseFormat.text.schema,comparisonSchema);assert.equal(body.generationConfig.maxOutputTokens,undefined);assert.equal(body.tools,undefined);
  }
  for(const [selected,effort]of [['gemini-3.99-flash','low'],['gemini-3.8-flash-preview','low'],['gemini-3.8-flash-cyber','low'],['gemini-4-argon','low'],['gemini-2.0-flash','low'],['gemini-3.8-flash','high'],['gemini-3.8-flash','medium']]){
    let body;await client(async(url,options)=>{body=JSON.parse(options.body);return reply(answer());}).analyze({model:selected,effort,prompt:'저장 근거',schema:simpleSchema,externalTools:false});
    assert.equal(body.generationConfig.thinkingConfig,undefined,selected+'/'+effort);assert.deepEqual(body.generationConfig.responseFormat.text.schema,simpleSchema);
  }
});

test('documented low thinking applies to both grounded research and structured synthesis without changing tool or schema use',async()=>{
  const calls=[];const bridge=client(async(url,options)=>{calls.push(JSON.parse(options.body));return reply(calls.length===1?answer('공식 근거',{groundingMetadata:{groundingChunks:[{web:{uri:'https://www.seoul.go.kr/official',title:'공식 자료'}}]}}):answer());});
  await bridge.analyze({model:'gemini-3.8-flash',effort:'low',prompt:'공식 예정 사업',schema:simpleSchema,webOnly:true});
  assert.equal(calls.length,2);for(const body of calls)assert.deepEqual(body.generationConfig.thinkingConfig,{thinkingLevel:'low'});
  assert.deepEqual(calls[0].tools,[{googleSearch:{}}]);assert.equal(calls[0].generationConfig.responseFormat,undefined);assert.equal(calls[1].tools,undefined);assert.deepEqual(calls[1].generationConfig.responseFormat.text.schema,simpleSchema);
});

test('retry status explains quota, server or timeout failures safely then changes to waiting for the new response',async()=>{
  for(const [status,description]of [[429,/요청 한도/],[503,/서버에 일시 오류/],[500,/서버에 일시 오류/],[408,/응답 시간이 초과/],[504,/응답 시간이 초과/]]){
    const events=[];let calls=0;const bridge=client(async()=>++calls===1?reply({error:{message:key}},status):reply(answer()));bridge.on('progress',event=>events.push(event));
    await bridge.analyze({model:'gemini-3.8-flash',prompt:'기존 계산 유지',externalTools:false});
    const retry=events.find(event=>event.phase==='retry-wait'),waiting=events.find(event=>event.phase==='response-wait');assert.match(retry.message,description);assert.equal(retry.httpStatus,status);assert.match(waiting.message,/다시 요청하여 응답을 기다리고/);assert.ok(events.indexOf(waiting)>events.indexOf(retry));assert.ok(!JSON.stringify(events).includes(key));assert.equal(calls,2);
  }
});

test('retry wait shares the original whole-analysis deadline and cancellation from the new response-wait update sends no extra request',async()=>{
  let calls=0;const deadline=client(async()=>{calls++;return reply({},503);},{timeoutMs:15,sleepImpl:()=>new Promise(()=>{})});
  await assert.rejects(deadline.analyze({model,prompt:'질문',externalTools:false}),/15분/);assert.equal(calls,1);assert.equal(deadline.operations.size,0);
  calls=0;const cancelled=client(async()=>{calls++;return reply({},503);});cancelled.on('progress',event=>{if(event.phase==='response-wait')cancelled.interrupt();});
  await assert.rejects(cancelled.analyze({model,prompt:'질문',externalTools:false}),/중지/);assert.equal(calls,1);assert.equal(cancelled.operations.size,0);
});

test('real model-list mapping and service selection carry supported low effort through to the Gemini request',async()=>{
  const {geminiModels,claudeModels}=require('../src/ai-bridge.cjs'),{AnalysisService}=require('../src/service.cjs'),{EventEmitter}=require('node:events');
  const models=geminiModels([{id:'gemini-3.8-flash',displayName:'Gemini Flash'},{id:'gemini-2.0-flash'},{id:'gemini-3.99-flash'}]);
  assert.deepEqual(models.find(item=>item.id==='gemini-3.8-flash').efforts,['low']);assert.deepEqual(models.find(item=>item.id==='gemini-2.0-flash').efforts,[]);assert.deepEqual(models.find(item=>item.id==='gemini-3.99-flash').efforts,[]);assert.deepEqual(claudeModels([{id:'claude-sonnet-4-6'}])[0].efforts,[]);
  const service=new AnalysisService({bridge:new EventEmitter(),userData:require('node:os').tmpdir(),onEvent:()=>{}});service.settings={provider:'gemini',model:'gemini-3.8-flash'};
  const choice=await service.chooseModel(models);assert.deepEqual(choice,{model:'gemini-3.8-flash',effort:'low'});
  let body;await client(async(url,options)=>{body=JSON.parse(options.body);return reply(answer());}).analyze({prompt:'공통 평가 계산 유지',schema:simpleSchema,externalTools:false,...choice});assert.deepEqual(body.generationConfig.thinkingConfig,{thinkingLevel:'low'});
});
