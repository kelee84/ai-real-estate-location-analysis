'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {getEventListeners}=require('node:events');
const {CodexBridge}=require('../src/codex.cjs');
const options={prompt:'검증된 자료로 작성',instructions:'기존 계산과 보고서 양식 유지',schema:{type:'object'},model:'gpt-fixture',externalTools:false};
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(t){
  const bridge=new CodexBridge({binary:'unused-offline',home:'unused-offline',cwd:'unused-offline'}),calls=[];let starts=0;
  bridge.start=async()=>{starts++;};
  bridge.request=async(method,params)=>{calls.push({method,params});if(method==='thread/start')return {thread:{id:'thread-fixture'}};if(method==='turn/start')return {turn:{id:'turn-fixture'}};if(method==='turn/interrupt')return {};throw Error('Unexpected offline request: '+method);};
  t.after(()=>{if(bridge.turn)bridge.fail(Error('검사 종료'));});
  return {bridge,calls,get starts(){return starts;}};
}
function completed(bridge,status='completed'){
  bridge.receive({method:'turn/completed',params:{threadId:'thread-fixture',turn:{id:'turn-fixture',status}}});
}
test('an already aborted GPT request starts no process, thread, or paid turn',async t=>{
  const f=fixture(t),controller=new AbortController();controller.abort();
  await assert.rejects(f.bridge.analyze({...options,signal:controller.signal}),/중지/);
  assert.equal(f.starts,0);assert.deepEqual(f.calls,[]);assert.equal(f.bridge.turn,null);assert.equal(getEventListeners(controller.signal,'abort').length,0);
});
test('cancelling while GPT starts prevents thread creation after startup resolves',async t=>{
  const f=fixture(t),startup=deferred(),controller=new AbortController();let started=false;
  f.bridge.start=async()=>{started=true;return startup.promise;};
  const result=f.bridge.analyze({...options,signal:controller.signal}),rejection=assert.rejects(result,/중지/);
  assert.equal(started,true);controller.abort();await f.bridge.interrupt();startup.resolve();await rejection;
  assert.deepEqual(f.calls,[]);assert.equal(f.bridge.turn,null);assert.equal(getEventListeners(controller.signal,'abort').length,0);
});
test('cancelling while thread/start waits never launches a paid GPT turn',async t=>{
  const f=fixture(t),thread=deferred(),ready=deferred(),controller=new AbortController(),request=f.bridge.request;
  f.bridge.request=async(method,params)=>{if(method==='thread/start'){f.calls.push({method,params});ready.resolve();return thread.promise;}return request(method,params);};
  const result=f.bridge.analyze({...options,signal:controller.signal}),rejection=assert.rejects(result,/중지/);await ready.promise;
  controller.abort();await f.bridge.interrupt();thread.resolve({thread:{id:'thread-fixture'}});await rejection;
  assert.deepEqual(f.calls.map(c=>c.method),['thread/start']);assert.equal(f.bridge.turn,null);assert.equal(getEventListeners(controller.signal,'abort').length,0);
});
test('cancellation while turn/start waits retains its ID race and sends one interrupt when the ID arrives',async t=>{
  const f=fixture(t),turn=deferred(),ready=deferred(),controller=new AbortController(),request=f.bridge.request;
  f.bridge.request=async(method,params)=>{if(method==='turn/start'){f.calls.push({method,params});ready.resolve();return turn.promise;}return request(method,params);};
  const result=f.bridge.analyze({...options,signal:controller.signal}),rejection=assert.rejects(result,/중지/);await ready.promise;
  assert.equal(getEventListeners(controller.signal,'abort').length,1);controller.abort();await f.bridge.interrupt();
  assert.equal(f.bridge.turn.cancelRequested,true);assert.equal(f.calls.filter(c=>c.method==='turn/interrupt').length,0);
  turn.resolve({turn:{id:'turn-fixture'}});await flush();await f.bridge.interrupt();
  assert.deepEqual(f.calls.filter(c=>c.method==='turn/interrupt').map(c=>c.params),[{threadId:'thread-fixture',turnId:'turn-fixture'}]);
  completed(f.bridge,'interrupted');await rejection;assert.equal(f.bridge.turn,null);assert.equal(getEventListeners(controller.signal,'abort').length,0);
});
test('a live GPT signal cancels an active turn once and rejects even a late successful completion',async t=>{
  const f=fixture(t),controller=new AbortController(),result=f.bridge.analyze({...options,signal:controller.signal}),rejection=assert.rejects(result,/중지/);
  await flush();assert.equal(f.bridge.turn.turnId,'turn-fixture');controller.abort();await Promise.all([f.bridge.interrupt(),f.bridge.interrupt()]);
  assert.equal(f.calls.filter(c=>c.method==='turn/interrupt').length,1);completed(f.bridge);await rejection;
  assert.equal(f.bridge.turn,null);assert.equal(getEventListeners(controller.signal,'abort').length,0);
  const next=f.bridge.analyze(options);await flush();f.bridge.receive({method:'item/completed',params:{threadId:'thread-fixture',item:{type:'agentMessage',phase:'final_answer',text:'{"title":"다음 보고서"}'}}});completed(f.bridge);
  assert.equal((await next).text,'{"title":"다음 보고서"}');assert.equal(f.calls.filter(c=>c.method==='turn/interrupt').length,1);
});
test('normal GPT completion removes its signal listener and retains the existing tool/schema configuration',async t=>{
  const f=fixture(t),controller=new AbortController(),result=f.bridge.analyze({...options,signal:controller.signal});await flush();
  const thread=f.calls.find(c=>c.method==='thread/start').params,turn=f.calls.find(c=>c.method==='turn/start').params;
  assert.equal(thread.config.web_search,'disabled');assert.equal(thread.config['mcp_servers.ipzitalk.enabled'],false);assert.deepEqual(turn.outputSchema,options.schema);
  f.bridge.receive({method:'item/completed',params:{threadId:'thread-fixture',item:{type:'agentMessage',text:'검증된 결과'}}});completed(f.bridge);
  assert.equal((await result).text,'검증된 결과');assert.equal(getEventListeners(controller.signal,'abort').length,0);controller.abort();await flush();assert.equal(f.calls.filter(c=>c.method==='turn/interrupt').length,0);
});
test('failed turn startup or lost GPT connection removes cancellation listeners and releases the turn',async t=>{
  for(const failure of ['turn-start','connection']){
    const f=fixture(t),controller=new AbortController(),request=f.bridge.request;
    if(failure==='turn-start')f.bridge.request=async(method,params)=>{if(method==='turn/start')throw Error('시작 실패');return request(method,params);};
    const result=f.bridge.analyze({...options,signal:controller.signal}),rejection=assert.rejects(result,/실패|연결 종료/);await flush();
    if(failure==='connection')f.bridge.fail(Error('연결 종료'));
    await rejection;assert.equal(f.bridge.turn,null);assert.equal(getEventListeners(controller.signal,'abort').length,0);
  }
});
