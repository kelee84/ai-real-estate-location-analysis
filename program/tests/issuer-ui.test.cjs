'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const script=fs.readFileSync(path.join(__dirname,'../src/web/issuer.js'),'utf8');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function mount(api){
  const elements=new Map();
  for(const id of ['issuer-status','issue-button','issuer-retry','issue-form','issuer-message','issued-code','issue-result','copy-issued','issue-request']){
    const classes=new Set(['hidden']),listeners={};
    elements.set(id,{value:'request',disabled:false,textContent:'',listeners,setAttribute(){},addEventListener:(name,fn)=>{listeners[name]=fn;},classList:{add:x=>classes.add(x),remove:x=>classes.delete(x),contains:x=>classes.has(x),toggle:(x,on)=>{if(on)classes.add(x);else classes.delete(x);}}});
  }
  const windowEvents={};vm.runInNewContext(script,{document:{getElementById:id=>elements.get(id)},window:{helper:api,addEventListener:(name,fn)=>{windowEvents[name]=fn;}}});
  return {get:id=>elements.get(id),submit:()=>elements.get('issue-form').listeners.submit({preventDefault(){}}),retry:()=>elements.get('issuer-retry').listeners.click(),focus:()=>windowEvents.focus()};
}
test('최초 확인 실패 후에도 입력을 유지하고 재확인으로 발급 버튼 활성화',async()=>{
  let calls=0,issued=0;const ui=mount({'issuer-status':async()=>{if(++calls===1)throw Error('key missing');},issue:async()=>{issued++;return {code:'signed'};}});
  await flush();assert.equal(ui.get('issue-button').disabled,true);assert.equal(ui.get('issuer-retry').classList.contains('hidden'),false);
  await ui.submit();assert.equal(issued,0);
  await ui.retry();assert.equal(ui.get('issue-button').disabled,false);assert.equal(ui.get('issue-request').value,'request');
  await ui.submit();assert.equal(ui.get('issued-code').value,'signed');assert.equal(issued,1);
});
test('발급 중 권한을 잃으면 비활성 상태를 유지하고 창 복귀 시 재확인',async()=>{
  const ui=mount({'issuer-status':async()=>{},issue:async()=>{throw Object.assign(Error('key unreadable'),{gate:'issuer'});}});
  await flush();await ui.submit();assert.equal(ui.get('issue-button').disabled,true);assert.equal(ui.get('issue-result').classList.contains('hidden'),true);
  ui.focus();await flush();assert.equal(ui.get('issue-button').disabled,false);
});
test('입력 오류에는 권한을 유지하고 이중 발급 요청 방지',async()=>{
  let rejectIssue,calls=0;const ui=mount({'issuer-status':async()=>{},issue:()=>{calls++;return new Promise((_resolve,reject)=>{rejectIssue=reject;});}});
  await flush();const pending=ui.submit();await ui.submit();assert.equal(calls,1);rejectIssue(Error('invalid request'));await pending;
  assert.equal(ui.get('issue-button').disabled,false);assert.equal(ui.get('issuer-message').textContent,'invalid request');
});
