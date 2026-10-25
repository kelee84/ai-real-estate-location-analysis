'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {trustedMainSender}=require('../src/ipc-sender.cjs');
const mainPage='helper://app/index.html';
function fixture(url=mainPage){const frame={url},win={webContents:{mainFrame:frame}};return {win,event:{sender:win.webContents,senderFrame:frame}};}

test('같은 앱 본문의 로고·키보드 바로가기 이동 후에도 요청을 허용',()=>{
  for(const suffix of ['', '#new','#workspace-main','#','##','#[%23]']){
    const {event,win}=fixture(mainPage+suffix);assert.equal(trustedMainSender(event,win,mainPage),true,suffix);
  }
});
test('같은 창에서도 외부·보고서·다른 경로·쿼리 URL은 허용하지 않음',()=>{
  for(const url of ['https://app/index.html','helper://other/index.html','helper://app/issuer.html','helper://report/example','helper://app/index.html?mode=test','helper://app/index.html?mode=test#new','helper://app/index.html/extra#new','helper://app/index.html.evil#new','helper://user@app/index.html#new','file:///index.html','about:blank','',null,undefined]){
    const {event,win}=fixture();event.senderFrame.url=url;assert.equal(trustedMainSender(event,win,mainPage),false,String(url));
  }
});
test('URL이 같아도 다른 창·하위 프레임·사라진 발신 프레임은 거부',()=>{
  const {event,win}=fixture(mainPage+'#new');
  assert.equal(trustedMainSender({...event,sender:{}},win,mainPage),false);
  assert.equal(trustedMainSender({...event,senderFrame:{url:mainPage+'#new'}},win,mainPage),false);
  assert.equal(trustedMainSender({...event,senderFrame:null},win,mainPage),false);
  assert.equal(trustedMainSender(event,null,mainPage),false);
  assert.equal(trustedMainSender(null,win,mainPage),false);
});
test('인증 발급기 요청도 발급기 본문만 허용',()=>{
  const issuer='helper://app/issuer.html',{event,win}=fixture(issuer+'#form');
  assert.equal(trustedMainSender(event,win,issuer),true);
  assert.equal(trustedMainSender(event,win,mainPage),false);
  event.senderFrame.url=mainPage+'#new';assert.equal(trustedMainSender(event,win,issuer),false);
});
