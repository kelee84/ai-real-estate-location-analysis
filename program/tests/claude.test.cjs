'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {ClaudeBridge,schemaForClaude,schemaIssue}=require('../src/claude.cjs');
const {reportSchema}=require('../src/schema.cjs');
const key='sk-ant-API_KEY_FOR_TEST_0123456789',model='claude-sonnet-5-5';
const schema={type:'object',properties:{conclusion:{type:'string'}},required:['conclusion'],additionalProperties:false};
const reply=(data,status=200,headers={})=>({ok:status>=200&&status<300,status,headers:{get:name=>headers[name]??null},json:async()=>data});
const modelRecord=(extra={})=>({id:model,type:'model',display_name:'Claude Sonnet',created_at:'2026-10-01T00:00:00Z',lifecycle:'active',max_input_tokens:1000000,max_tokens:64000,capabilities:{structured_outputs:{supported:true},server_tools:{web_search:{supported:true}},thinking:{types:{between_tools:{supported:true}}}},...extra});
const listing=(extra={})=>({data:[modelRecord()],has_more:false,last_id:model,first_id:model,...extra});
const answer=(text='{"conclusion":"기존 자료로 작성"}',extra={})=>({id:'msg_test',type:'message',role:'assistant',content:[{type:'text',text}],stop_reason:'end_turn',usage:{input_tokens:10,output_tokens:20,cache_read_input_tokens:3,cache_creation_input_tokens:2},...extra});
const client=(fetchImpl,options={})=>new ClaudeBridge({getApiKey:async()=>key,fetchImpl,retryBaseMs:1,...options});
const withModels=handler=>async(url,options)=>url.includes('/models?')?reply(listing()):handler(url,options);

test('models use authenticated GET, fresh version, bounded pagination, capabilities and key-scoped cache',async()=>{
  const calls=[];const bridge=client(async(url,options)=>{calls.push({url,options});return reply(calls.length===1?listing({data:[modelRecord(),modelRecord({id:'claude-sonnet-4-0',capabilities:{structured_outputs:{supported:false}}}),modelRecord({id:'claude-old',lifecycle:'retired'}),modelRecord({id:'../bad'}),modelRecord({id:'claude-3-7-sonnet',capabilities:null}),modelRecord({id:'claude-haiku-4-5',capabilities:null})],has_more:true,last_id:'model cursor'}):listing({data:[modelRecord({id:'claude-opus-5-5'})]}));});
  const models=await bridge.models();assert.deepEqual(models.map(item=>item.id),[model,'claude-haiku-4-5','claude-opus-5-5']);assert.equal(models[0].outputTokenLimit,64000);assert.equal(models[0].capabilities.thinkingBetweenTools,true);
  assert.equal(calls.length,2);assert.match(calls[1].url,/after_id=model%20cursor$/);
  for(const {url,options}of calls){assert.equal(options.method,'GET');assert.equal(options.headers['x-api-key'],key);assert.equal(options.headers['anthropic-version'],'2026-10-21');assert.equal(options.redirect,'error');assert.ok(!url.includes(key));assert.equal(options.body,undefined);}
  models[0].displayName='changed';assert.equal((await bridge.models())[0].displayName,'Claude Sonnet');assert.equal(calls.length,2);
  await bridge.models({apiKey:'sk-ant-DIFFERENT_API_KEY_0123456789'});assert.equal(calls.length,3);
  bridge.invalidateModels();await bridge.models();assert.equal(calls.length,4);
});

test('model verification reads only the live model list and rejects unavailable selections',async()=>{
  const calls=[];const bridge=client(async(url,options)=>{calls.push({url,options});return reply(listing());});
  assert.equal((await bridge.verifyConnection({model})).connected,true);assert.equal(calls[0].options.method,'GET');
  await assert.rejects(bridge.verifyConnection({model:'claude-missing'}),/다른 모델/);assert.equal(calls.length,2);
  assert.equal((await bridge.verifyConnection()).model,null);
});

test('saved key and workspace are read atomically and applied to discovery, search and synthesis',async()=>{
  const workspaceId='wrkspc_01JwQvzr7rXLA5AGx3HKfFUJ',calls=[];let reads=0;
  const bridge=new ClaudeBridge({getCredentials:async()=>{reads++;return {apiKey:key,workspaceId};},getApiKey:async()=>{throw new Error('legacy getter must not run');},fetchImpl:async(url,options)=>{calls.push({url,options});return reply(url.includes('/models?')?listing():answer());}});
  const result=await bridge.analyze({model,prompt:'자료',schema,externalTools:true});assert.equal(reads,1);assert.equal(calls.length,3);
  for(const call of calls){assert.equal(call.options.headers['anthropic-workspace-id'],workspaceId);assert.equal(call.options.headers['x-api-key'],key);assert.ok(!call.url.includes(workspaceId));assert.ok(!call.options.body?.includes(workspaceId));}
  assert.ok(!JSON.stringify(result).includes(workspaceId));assert.ok(!JSON.stringify(bridge.modelCache).includes(workspaceId));
});

test('explicit credentials never inherit saved workspace and cache is isolated by key plus workspace',async()=>{
  const first='wrkspc_First123',second='wrkspc_Second456',calls=[];let reads=0;
  const bridge=new ClaudeBridge({getCredentials:async()=>{reads++;return {apiKey:key,workspaceId:first};},fetchImpl:async(url,options)=>{calls.push(options);return reply(listing());}});
  await bridge.models();await bridge.models();assert.equal(calls.length,1);assert.equal(reads,2);
  await bridge.models({apiKey:key,workspaceId:second});assert.equal(calls.length,2);assert.equal(calls[1].headers['anthropic-workspace-id'],second);assert.equal(reads,2);
  await bridge.models({apiKey:key,workspaceId:second});assert.equal(calls.length,2);
  await bridge.models({apiKey:key});assert.equal(calls.length,3);assert.equal(calls[2].headers['anthropic-workspace-id'],undefined);assert.equal(reads,2);
  await bridge.verifyConnection({apiKey:key,workspaceId:first});assert.equal(calls.length,4);assert.equal(calls[3].headers['anthropic-workspace-id'],first);assert.equal(reads,2);
  await bridge.models({apiKey:'sk-ant-SECOND_KEY_0123456789',workspaceId:first});assert.equal(calls.length,5);
});

test('invalid workspace IDs fail before network and workspace API errors give safe actionable guidance',async()=>{
  for(const workspaceId of ['wrkspc_','wrkspc_bad-id','wrkspc_A\r\nx-api-key:evil',' workspace','wrkspc_'+ 'a'.repeat(101),42,{}]){
    const bridge=client(()=>{throw new Error('network must not run');});await assert.rejects(bridge.verifyConnection({apiKey:key,workspaceId}),/워크스페이스 ID 형식/);
  }
  const saved=new ClaudeBridge({getCredentials:async()=>({apiKey:key,workspaceId:'wrong'}),fetchImpl:()=>{throw new Error('network must not run');}});await assert.rejects(saved.models(),/워크스페이스 ID 형식/);
  const id='wrkspc_ExamplePrivate';let calls=0;
  const invalid=client(async()=>{calls++;return reply({error:{type:'invalid_request_error',message:'anthropic-workspace-id is required '+id+' '+key}},400);});
  await assert.rejects(invalid.models(),error=>/선택 항목/.test(error.message)&&!error.message.includes(key)&&!error.message.includes(id));assert.equal(calls,1);
  const echoed=await client(async()=>reply(listing({data:[modelRecord({display_name:id})]}))).models();assert.ok(!JSON.stringify(echoed).includes(id));
});

test('concurrent model discovery coalesces within key and workspace while cancellation stays independent',async()=>{
  let resolveResponse,start;const ready=new Promise(resolve=>start=resolve);let calls=0;
  const bridge=client(async()=>{calls++;start();return new Promise(resolve=>resolveResponse=resolve);});
  const cancelled=new AbortController(),one=bridge.models({apiKey:key,workspaceId:'wrkspc_Shared',signal:cancelled.signal}),two=bridge.models({apiKey:key,workspaceId:'wrkspc_Shared'});
  await ready;cancelled.abort();await assert.rejects(one,/중지/);assert.equal(calls,1);assert.equal(bridge.operations.size,1);
  resolveResponse(reply(listing()));const result=await two;assert.equal(result[0].id,model);assert.equal(bridge.operations.size,0);assert.equal(bridge.modelFlights.size,0);
  result[0].displayName='mutated';assert.equal((await bridge.models({apiKey:key,workspaceId:'wrkspc_Shared'}))[0].displayName,'Claude Sonnet');
});

test('last model subscriber cancellation aborts transport and separate workspaces never share a flight',async()=>{
  const waiting=[];const bridge=client(async(url,options)=>new Promise(resolve=>waiting.push({options,resolve})));
  const firstAbort=new AbortController(),secondAbort=new AbortController();
  const one=bridge.models({apiKey:key,workspaceId:'wrkspc_A',signal:firstAbort.signal}),two=bridge.models({apiKey:key,workspaceId:'wrkspc_A',signal:secondAbort.signal}),separate=bridge.models({apiKey:key,workspaceId:'wrkspc_B'});
  await new Promise(resolve=>setImmediate(resolve));assert.equal(waiting.length,2);
  firstAbort.abort();await assert.rejects(one,/중지/);assert.equal(waiting[0].options.signal.aborted,false);
  secondAbort.abort();await assert.rejects(two,/중지/);assert.equal(waiting[0].options.signal.aborted,true);assert.equal(waiting[1].options.signal.aborted,false);
  waiting[1].resolve(reply(listing()));await separate;assert.equal(bridge.operations.size,0);assert.equal(bridge.modelFlights.size,0);
});

test('cache invalidation isolates a new flight and late old results cannot repopulate the cache',async()=>{
  const waiting=[];const bridge=client(async()=>new Promise(resolve=>waiting.push(resolve)));
  const old=bridge.models();await new Promise(resolve=>setImmediate(resolve));bridge.invalidateModels();const fresh=bridge.models();await new Promise(resolve=>setImmediate(resolve));assert.equal(waiting.length,2);
  waiting[0](reply(listing({data:[modelRecord({display_name:'old'})]})));assert.equal((await old)[0].displayName,'old');assert.equal(bridge.modelCache,null);assert.equal(bridge.modelFlights.size,1);
  waiting[1](reply(listing({data:[modelRecord({display_name:'fresh'})]})));assert.equal((await fresh)[0].displayName,'fresh');assert.equal((await bridge.models())[0].displayName,'fresh');assert.equal(waiting.length,2);
});

test('model list rejects loops, missing cursors, unsupported models and strips credential echoes',async()=>{
  for(const body of [listing({has_more:true,last_id:''}),listing({has_more:true,last_id:'repeat'})])await assert.rejects(client(async()=>reply(body)).models(),/끝까지/);
  await assert.rejects(client(async()=>reply({data:[],has_more:false})).models(),/구조화 출력 모델/);
  const result=await client(async()=>reply(listing({data:[modelRecord({display_name:key,created_at:key,max_tokens:{secret:key}})]}))).models();assert.ok(!JSON.stringify(result).includes(key));assert.equal(result[0].outputTokenLimit,undefined);
  const cancelled=new AbortController();cancelled.abort();const bridge=client(async()=>reply(listing()));await bridge.models();await assert.rejects(bridge.models({signal:cancelled.signal}),/중지/);
});

test('single structured synthesis uses Messages, preserves facts, validates output and obeys model token cap',async()=>{
  const calls=[];const bridge=client(async(url,options)=>{calls.push({url,options});return url.includes('/models?')?reply(listing({data:[modelRecord({max_tokens:12000})]})):reply(answer());});
  const result=await bridge.analyze({model,prompt:'기존 거래 평균과 점수',instructions:'6개 평가 항목과 양식을 유지한다.',schema,externalTools:false});
  const call=calls[1],body=JSON.parse(call.options.body);assert.equal(call.url,'https://api.anthropic.com/v1/messages');assert.equal(body.max_tokens,12000);assert.deepEqual(body.thinking,{type:'between_tools'});
  assert.equal(body.messages[0].content,'기존 거래 평균과 점수');assert.match(body.system,/6개 평가 항목과 양식을 유지/);assert.deepEqual(body.output_config.format,{type:'json_schema',schema});assert.equal(body.tools,undefined);assert.equal(body.temperature,undefined);
  assert.equal(result.text,'{"conclusion":"기존 자료로 작성"}');assert.deepEqual(result.webSearches,[]);assert.deepEqual(result.tools,[]);assert.match(result.threadId,/^claude-/);assert.deepEqual(result.tokenUsage,{inputTokens:15,cachedInputTokens:3,outputTokens:20,reasoningOutputTokens:0,totalTokens:35});
  await bridge.analyze({model,prompt:'두 번째',schema,externalTools:false});assert.equal(calls.filter(call=>call.url.includes('/models?')).length,1);
});

test('six-row contract stays intact locally while API schema moves unsupported bounds to descriptions',()=>{
  const original=structuredClone(reportSchema),normalized=schemaForClaude(reportSchema);assert.deepEqual(reportSchema,original);
  assert.equal(normalized.properties.scores.minItems,undefined);assert.equal(normalized.properties.scores.maxItems,undefined);assert.match(normalized.properties.scores.description,/"minItems":6/);assert.match(normalized.properties.scores.description,/"maxItems":6/);
  assert.deepEqual(normalized.properties.scores.items.properties,reportSchema.properties.scores.items.properties);
  const body={title:'입지 분석',conclusion:'결론',highlights:[],sections:[],strengths:[],limitations:[],checks:[],scores:reportSchema.properties.scores.items.properties.name.enum.map(name=>({name,score:null,reason:'근거',method:'프로그램 산식',sourceIds:[]})),sources:[]};
  assert.equal(schemaIssue(body,reportSchema),'');body.scores.pop();assert.match(schemaIssue(body,reportSchema),/항목 수/);
  const bounded={type:'object',properties:{number:{type:'integer',minimum:1,maximum:100},label:{enum:['A','B']},items:{type:'array',minItems:1,maxItems:3,items:{type:'string',minLength:2,maxLength:8,pattern:'^a'}}},required:['number','label','items'],additionalProperties:false};
  const adjusted=schemaForClaude(bounded);assert.equal(adjusted.properties.label.type,'string');assert.equal(adjusted.properties.items.minItems,1);assert.equal(adjusted.properties.number.minimum,undefined);
  assert.equal(schemaIssue({number:50,label:'A',items:['ab']},bounded),'');assert.match(schemaIssue({number:101,label:'A',items:['ab']},bounded),/수치 범위/);assert.match(schemaIssue({number:50,label:'A',items:['bb']},bounded),/문자열 형식/);
  assert.throws(()=>schemaForClaude({type:'object',properties:{}}),/고정된 필드/);
});

test('search and structured output use separate requests, preserve citations and continue pause_turn unchanged',async()=>{
  const paused=answer('',{stop_reason:'pause_turn',content:[{type:'thinking',thinking:'',signature:'signed'},{type:'server_tool_use',id:'srv_1',name:'web_search',input:{query:'서울 공식 개통계획'}},{type:'web_search_tool_result',tool_use_id:'srv_1',content:[{type:'web_search_result',url:'https://www.seoul.go.kr/official',title:'서울시 공식 자료',page_age:'2026-10-01',encrypted_content:'do-not-change'}]}]});
  const research=answer('2027년 개통 예정',{content:[{type:'text',text:'2027년 개통 예정',citations:[{type:'web_search_result_location',url:'https://www.seoul.go.kr/official',title:'서울시',cited_text:'2027년 개통',encrypted_index:'encrypted-index'}]}]});
  const calls=[];const bridge=client(withModels(async(url,options)=>{calls.push(JSON.parse(options.body));return reply([paused,research,answer()][calls.length-1]);}));
  const result=await bridge.analyze({model,prompt:'인근 예정 사업',schema,webOnly:true,externalTools:false});
  assert.equal(calls.length,3);assert.deepEqual(calls[0].tools,[{type:'web_search_20250305',name:'web_search',max_uses:5}]);assert.equal(calls[0].output_config,undefined);
  assert.deepEqual(calls[1].messages[1],{role:'assistant',content:paused.content});assert.equal(calls[2].tools,undefined);assert.deepEqual(calls[2].output_config.format.schema,schema);assert.match(calls[2].messages[0].content,/2027년 개통/);assert.match(calls[2].messages[0].content,/seoul.go.kr/);
  const grounding=result.webSearches[0];assert.equal(grounding.provider,'claude');assert.deepEqual(grounding.queries,['서울 공식 개통계획']);assert.equal(grounding.sources.length,1);assert.equal(grounding.citations[0].citedText,'2027년 개통');assert.ok(!JSON.stringify(grounding).includes('encrypted'));assert.equal(result.tokenUsage.totalTokens,105);
});

test('uncited search with unsafe URLs/errors never promotes invented research into verified evidence',async()=>{
  const calls=[];const bridge=client(withModels(async(url,options)=>{calls.push(JSON.parse(options.body));return reply(calls.length===1?answer('지어낸 개발계획',{content:[{type:'text',text:'지어낸 개발계획'},{type:'web_search_tool_result',content:[{type:'web_search_result',url:'javascript:alert(1)'},{type:'web_search_result',url:'https://user:password@example.com/'}]},{type:'web_search_tool_result',content:{type:'web_search_tool_result_error',error_code:'unavailable'}}]}):answer());}));
  const result=await bridge.analyze({model,prompt:'개발계획',schema});assert.doesNotMatch(calls[1].messages[0].content,/지어낸 개발계획/);assert.match(calls[1].messages[0].content,/검증 가능한 웹 출처가 반환되지/);assert.deepEqual(result.webSearches[0].sources,[]);assert.deepEqual(result.webSearches[0].errors,['unavailable']);
});

test('server search pause is bounded and unsupported web search fails before generation',async()=>{
  let calls=0;const bridge=client(withModels(async()=>{calls++;return reply(answer('',{stop_reason:'pause_turn',content:[{type:'server_tool_use',id:'one',name:'web_search',input:{query:'반복'}}]}));}),{maxSearchContinuations:1});
  await assert.rejects(bridge.analyze({model,prompt:'질문',schema}),/검색이 제한된 횟수/);assert.equal(calls,2);
  const noSearch=client(async url=>{assert.match(url,/models/);return reply(listing({data:[modelRecord({capabilities:{structured_outputs:{supported:true},server_tools:{web_search:{supported:false}}}})]}));});await assert.rejects(noSearch.analyze({model,prompt:'질문',schema}),/검색을 지원하지/);
});

test('only transient HTTP failures are retried with bounded attempts and Retry-After respected',async()=>{
  for(const status of [408,500,502,529]){
    let calls=0;const bridge=client(withModels(async()=>reply(++calls===1?{error:{message:key}}:answer(),calls===1?status:200)));assert.equal(JSON.parse((await bridge.analyze({model,prompt:'질문',schema,externalTools:false})).text).conclusion,'기존 자료로 작성');assert.equal(calls,2);
  }
  let limitedCalls=0;const rateLimited=client(withModels(async()=>{limitedCalls++;return limitedCalls===1?reply({},429,{'retry-after':'0.025'}):reply(answer());}));const start=Date.now();await rateLimited.analyze({model,prompt:'질문',externalTools:false});assert.ok(Date.now()-start>=20);assert.equal(limitedCalls,2);
  for(const headers of [{},{'retry-after':'120'}]){let calls=0;const bridge=client(withModels(async()=>{calls++;return reply({error:{message:key}},429,headers);}));await assert.rejects(bridge.analyze({model,prompt:'질문',externalTools:false}),/한도/);assert.equal(calls,1);}
  let calls=0;const permanent=client(withModels(async()=>{calls++;return reply({error:{message:key}},529);}));await assert.rejects(permanent.analyze({model,prompt:'질문',externalTools:false}),/서버/);assert.equal(calls,3);
});

test('credential/billing/model/request errors do not retry or echo server content',async()=>{
  for(const [status,pattern]of [[400,/요청 형식/],[401,/API 키/],[402,/결제/],[403,/사용 권한/],[404,/모델/],[413,/너무 큽니다/],[422,/요청 형식/]]){
    let calls=0;const bridge=client(withModels(async()=>{calls++;return reply({error:{message:key+' https://private.example/?key='+key}},status);}));
    await assert.rejects(bridge.analyze({model,prompt:'질문',externalTools:false}),error=>pattern.test(error.message)&&!error.message.includes(key)&&!error.message.includes('private.example'));assert.equal(calls,1);
  }
  let calls=0;const offline=client(withModels(async()=>{calls++;throw new Error(key);}));await assert.rejects(offline.analyze({model,prompt:'질문',externalTools:false}),error=>/연결하지/.test(error.message)&&!error.message.includes(key));assert.equal(calls,1);
});

test('ambiguous network POST is never replayed, while model-list GET can retry transient network failure',async()=>{
  let gets=0,posts=0;const bridge=client(async(url)=>{if(url.includes('/models?')){if(++gets===1)throw new Error('temporary socket failure');return reply(listing());}posts++;throw new Error('socket closed after request sent');});
  await assert.rejects(bridge.analyze({model,prompt:'질문',schema,externalTools:false}),/연결하지/);assert.equal(gets,2);assert.equal(posts,1);assert.equal(bridge.operations.size,0);
});

test('JSON/schema problems carry the shared repair code; refusals and truncations never do',async()=>{
  for(const body of [answer('{bad'),answer('{"other":"wrong"}'),answer(''),answer('{"conclusion":5}')]){
    let calls=0;const bridge=client(withModels(async()=>{calls++;return reply(body);}));await assert.rejects(bridge.analyze({model,prompt:'질문',schema,externalTools:false}),error=>error.code==='AI_INVALID_RESPONSE');assert.equal(calls,1);
  }
  for(const [stop,pattern]of [['refusal',/제한/],['max_tokens',/출력 한도/],['tool_use',/끝까지/],['stop_sequence',/끝까지/]]){
    await assert.rejects(client(withModels(async()=>reply(answer('partial',{stop_reason:stop})))).analyze({model,prompt:'질문',schema,externalTools:false}),error=>pattern.test(error.message)&&error.code!=='AI_INVALID_RESPONSE');
  }
  const hidden=answer('',{content:[{type:'thinking',thinking:'private'},{type:'text',text:'```json\n{"conclusion":"결과"}\n```'}]});assert.equal((await client(withModels(async()=>reply(hidden))).analyze({model,prompt:'질문',schema,externalTools:false})).text,'{"conclusion":"결과"}');
  const result=await client(withModels(async()=>reply(answer(JSON.stringify({conclusion:key}))))).analyze({model,prompt:'질문',schema,externalTools:false});assert.ok(!JSON.stringify(result).includes(key));
});

test('interrupt releases in-flight transport and a later analysis works; concurrent turns are rejected',async()=>{
  let start,calls=0;const ready=new Promise(resolve=>start=resolve);const bridge=client(withModels(async()=>{if(++calls===1){start();return new Promise(()=>{});}return reply(answer());}));
  const work=bridge.analyze({model,prompt:'질문',schema,externalTools:false});await ready;await assert.rejects(bridge.analyze({model,prompt:'다른 질문'}),/진행 중/);await bridge.interrupt();await assert.rejects(work,/중지/);assert.equal(bridge.turn,null);assert.equal(bridge.operations.size,0);
  assert.equal((await bridge.analyze({model,prompt:'다시',schema,externalTools:false})).text,'{"conclusion":"기존 자료로 작성"}');
});

test('synchronous cancellation during transport creation consumes the rejected transport promise',async()=>{
  let bridge;bridge=client(withModels(()=>{bridge.interrupt();return Promise.reject(new Error('transport rejected after cancellation'));}));
  await assert.rejects(bridge.analyze({model,prompt:'질문',externalTools:false}),/중지/);await new Promise(resolve=>setImmediate(resolve));assert.equal(bridge.operations.size,0);assert.equal(bridge.turn,null);
});

test('caller abort and timeout during response body/model discovery/retry delay clear all operations',async()=>{
  const controller=new AbortController();controller.abort();const bridge=client(()=>{throw new Error('must not call');});await assert.rejects(bridge.analyze({model,prompt:'질문',signal:controller.signal}),/중지/);assert.equal(bridge.operations.size,0);
  const slow=client(withModels(async()=>({ok:true,status:200,json:()=>new Promise(()=>{})})),{timeoutMs:15});await assert.rejects(slow.analyze({model,prompt:'질문',externalTools:false}),/분석 시간이 제한/);assert.equal(slow.turn,null);assert.equal(slow.operations.size,0);
  const slowModels=client(()=>new Promise(()=>{}),{modelsTimeoutMs:15});await assert.rejects(slowModels.models(),/모델 목록 응답이 늦습니다/);assert.equal(slowModels.operations.size,0);
  const slowRetry=client(withModels(async()=>reply({},529,{'retry-after':'10'})),{timeoutMs:15});await assert.rejects(slowRetry.analyze({model,prompt:'질문',externalTools:false}),/분석 시간이 제한/);assert.equal(slowRetry.operations.size,0);
});

test('stop aborts discovery and bad model paths or missing keys never reach network',async()=>{
  let start;const ready=new Promise(resolve=>start=resolve);const bridge=client(()=>{start();return new Promise(()=>{});});const work=bridge.models();await ready;bridge.stop();await assert.rejects(work,/중지/);assert.equal(bridge.modelCache,null);
  for(const id of ['claude-test?key=secret','../claude-test','https://example.com',''])await assert.rejects(client(()=>{throw new Error('must not call');}).analyze({model:id,prompt:'질문'}),/모델/);
  await assert.rejects(new ClaudeBridge({getApiKey:async()=>{throw new Error(key);}}).models(),error=>/API 키/.test(error.message)&&!error.message.includes(key));
});
