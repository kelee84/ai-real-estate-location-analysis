'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');

// Offline UI verification: these fixtures never use or save a real credential.
exports.run=async({win,service,output})=>{
  const originals={status:service.status,saveSettings:service.saveSettings,configureGemini:service.configureGemini,configureClaude:service.configureClaude,mapLogin:service.mapLogin};
  const initialSize=win.getSize(),calls=[],fixture={provider:'gpt',model:'gpt-fixture',modelsByProvider:{gpt:'gpt-fixture',gemini:'gemini-fixture',claude:'claude-fixture'},office:'기존 사무소',officeProfile:{name:'기존 사무소'}};
  const models=Object.fromEntries(['gpt','gemini','claude'].map(provider=>[provider,[{id:provider+'-fixture',name:provider+' 검사 모델'},{id:provider+'-alternate',name:provider+' 별도 검사 모델'}]]));
  const hasKey={gemini:false,claude:false},available={gemini:true,claude:true};
  const fixtureKeys={gemini:'AQ.'+'offline.synthetic.segment.'.repeat(60)+'end',claude:'offline-fixture-key'};
  const js=source=>win.webContents.executeJavaScript(source);
  const settle=()=>js(`new Promise((resolve,reject)=>{const deadline=Date.now()+5000,t=setInterval(()=>{if(!connectionSaving&&!settingsSaving&&!refreshing){clearInterval(t);resolve(true)}else if(Date.now()>deadline){clearInterval(t);reject(Error('provider UI timeout'))}},25)})`);
  const capture=async name=>{await js('document.fonts.ready.then(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))');await fs.writeFile(path.join(output,name+'.png'),(await win.webContents.capturePage()).toPNG());};
  const select=async provider=>{await js(`document.getElementById('provider').value=${JSON.stringify(provider)};document.getElementById('provider').dispatchEvent(new Event('change',{bubbles:true}))`);await settle();assert.equal(fixture.provider,provider);};
  service.status=async()=>({provider:fixture.provider,connected:true,loggedIn:fixture.provider==='gpt'||hasKey[fixture.provider],gemini:{hasKey:hasKey.gemini,available:available.gemini},claude:{hasKey:hasKey.claude,available:available.claude},settings:structuredClone(fixture),models:models[fixture.provider],mapConnected:true,usage:fixture.provider==='gpt'?{remaining:65,windows:[{label:'주간',remaining:65,resetsAt:1793200000}]}:null});
  service.saveSettings=async patch=>{calls.push({kind:'settings',patch:structuredClone(patch)});if(patch.provider&&patch.provider!==fixture.provider){fixture.modelsByProvider[fixture.provider]=fixture.model;fixture.provider=patch.provider;fixture.model=fixture.modelsByProvider[fixture.provider]||'';}if(patch.model!==undefined){fixture.model=patch.model;fixture.modelsByProvider[fixture.provider]=patch.model;}if(patch.office!==undefined)fixture.office=patch.office;if(patch.officeProfile)fixture.officeProfile=patch.officeProfile;return structuredClone(fixture);};
  const configure=provider=>async(action,value)=>{const key=provider==='claude'?value?.apiKey:value,workspaceId=provider==='claude'?value?.workspaceId:undefined;calls.push({kind:'connection',provider,action,receivedKey:!!key,receivedKeyLength:key?.length||0,receivedWorkspace:!!workspaceId});await new Promise(resolve=>setTimeout(resolve,80));if(action==='connect'){if(key==='invalid-fixture-key')throw new Error('검사용 연결 실패입니다. API 키를 다시 확인해 주세요.');assert.equal(key,fixtureKeys[provider]);if(provider==='claude')assert.equal(workspaceId,'wrkspc_offlinefixture');hasKey[provider]=true;}if(action==='disconnect')hasKey[provider]=false;return {hasKey:hasKey[provider]};};
  service.configureGemini=configure('gemini');service.configureClaude=configure('claude');
  try{
    await js(`(async()=>{state.busy=false;await refreshConnectionSettings();view('new');document.getElementById('settings-open').click();document.getElementById('office').value='저장 전 사무소';})()`);
    assert.deepEqual(await js(`Array.from(document.getElementById('provider').options,option=>option.value)`),['gpt','gemini','claude']);
    assert.equal(await js(`document.getElementById('provider').value`),'gpt');
    assert.equal(await js(`document.getElementById('model').value`),'gpt-fixture');
    await capture('provider-gpt-settings');
    for(const provider of ['gemini','claude']){
      const name=provider==='gemini'?'Gemini':'Claude';
      await select(provider);
      assert.equal(await js(`document.getElementById('model').value`),provider+'-fixture');
      assert.equal(await js(`document.getElementById('office').value`),'저장 전 사무소');
      assert.equal(await js(`document.getElementById('${provider}-settings').classList.contains('hidden')`),false);
      assert.equal(await js(`document.getElementById('${provider}-api-key').type`),'password');
      assert.equal(await js(`document.getElementById('${provider}-api-key').maxLength`),provider==='gemini'?8192:512);
      assert.equal(await js(`document.getElementById('${provider}-check').disabled`),true);
      assert.match(await js(`document.getElementById('${provider}-connection-status').textContent`),/저장한.*API 키가 없습니다/);
      assert.match(await js(`document.getElementById('${provider}-key-hint').textContent`),/연결을 시도하면.*입력창을 비웁니다/);
      for(const action of ['check','disconnect']){
        assert.equal(await js(`document.getElementById('${provider}-${action}').disabled`),true);
        assert.match(await js(`document.getElementById('${provider}-${action}').title`),/API 키를 먼저 입력.*키 저장하고 연결/);
        assert.equal(await js(`document.getElementById('${provider}-${action}').getAttribute('aria-describedby')`),provider+'-saved-key-hint');
      }
      assert.match(await js(`document.getElementById('${provider}-saved-key-hint').textContent`),/저장한 키가 있어야/);
      assert.equal(await js(`document.getElementById('logout').classList.contains('hidden')`),true);
      await js(`document.getElementById('${provider}-connect').click()`);
      assert.match(await js(`document.getElementById('${provider}-connection-status').textContent`),/API 키를 입력/);
      assert.equal(await js('document.activeElement.id'),provider+'-api-key');
      assert.equal(await js(`(()=>{const input=document.getElementById('${provider}-api-key'),data=new DataTransfer();data.setData('text','x'.repeat(input.maxLength+1));return input.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));})()`),false);
      assert.equal(await js(`document.getElementById('${provider}-api-key').value`),'');
      assert.match(await js(`document.getElementById('${provider}-connection-status').textContent`),/길이를 초과/);
      if(provider==='claude')await js(`document.getElementById('claude-workspace-id').value='wrkspc_offlinefixture'`);
      await js(`document.getElementById('${provider}-api-key').focus()`);
      await win.webContents.insertText(fixtureKeys[provider]);
      assert.equal(await js(`document.getElementById('${provider}-api-key').value`),fixtureKeys[provider]);
      assert.equal(await js(`document.getElementById('${provider}-api-key').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));document.getElementById('${provider}-api-key').value`),'');
      assert.equal(await js(`document.getElementById('provider').disabled`),true);
      assert.equal(await js(`document.getElementById('settings-dialog').dispatchEvent(new Event('cancel',{cancelable:true}))`),false);
      await settle();
      if(provider==='claude')assert.equal(await js(`document.getElementById('claude-workspace-id').value`),'');
      assert.equal(hasKey[provider],true);assert.equal(await js(`document.getElementById('connection-label').textContent`),name+' API 연결됨');
      assert.match(await js(`document.getElementById('${provider}-saved-key-hint').textContent`),/다시 입력하지 않고/);
      assert.doesNotMatch(await js(`document.getElementById('usage-label').textContent`),/GPT|%/);
      assert.equal(await js(`document.getElementById('usage-windows').children.length`),0);
      assert.equal(await js(`document.body.innerText.includes('offline-fixture-key')`),false);
      assert.equal(await js(`document.body.innerText.includes(${JSON.stringify(fixtureKeys[provider])})`),false);
      assert.equal(calls.some(call=>call.kind==='settings'&&Object.keys(call.patch).some(key=>/api.?key/i.test(key))),false);
      await js(`document.getElementById('${provider}-check').click()`);await settle();
      for(const [width,height] of [[1380,920],[1000,780],[1000,620]]){
        win.setSize(width,height);await js(`document.getElementById('${provider}-settings').scrollIntoView({block:'center'});new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
        assert.equal(await js(`document.documentElement.scrollWidth<=innerWidth&&document.getElementById('settings-dialog').scrollWidth<=document.getElementById('settings-dialog').clientWidth`),true);
        await capture('provider-'+provider+'-settings-'+width+'x'+height);
      }
      if(provider==='claude'){
        await js(`document.getElementById('claude-workspace-options').open=true;document.getElementById('claude-workspace-options').scrollIntoView({block:'center'})`);
        assert.equal(await js(`document.getElementById('settings-dialog').scrollWidth<=document.getElementById('settings-dialog').clientWidth`),true);
        await capture('provider-claude-workspace');
        await js(`document.getElementById('claude-workspace-options').open=false`);
      }
      await js(`document.getElementById('${provider}-api-key').value='invalid-fixture-key';document.getElementById('${provider}-connect').click()`);await settle();
      assert.match(await js(`document.getElementById('${provider}-connection-status').textContent`),/검사용 연결 실패/);
      assert.equal(await js(`document.getElementById('${provider}-api-key').value`),'');
      assert.equal(hasKey[provider],true,'a failed key replacement keeps the prior connection');
      assert.match(await js(`document.getElementById('${provider}-saved-key-hint').textContent`),/이전에 저장한 키는 유지/);
      await js('renderProviderControls()');
      assert.match(await js(`document.getElementById('${provider}-connection-status').textContent`),/검사용 연결 실패/);
      await capture('provider-'+provider+'-error');
      await js(`state.busy=true;renderProviderControls()`);
      assert.equal(await js(`['provider','model','${provider}-connect','${provider}-check','${provider}-disconnect','save-settings','login'].every(id=>document.getElementById(id).disabled)`),true);
      await js(`state.busy=false;renderProviderControls();document.getElementById('${provider}-api-key').value='unsaved-fixture-key';document.getElementById('claude-workspace-id').value='wrkspc_unsavedfixture'`);
      await select('gpt');
      assert.equal(await js(`document.getElementById('${provider}-api-key').value`),'');
      assert.equal(await js(`document.getElementById('claude-workspace-id').value`),'');
      assert.equal(await js(`document.getElementById('model').value`),'gpt-fixture');
      assert.match(await js(`document.getElementById('usage-label').textContent`),/GPT.*65%/);
    }
    // Both encrypted-key accounts can coexist; deleting one leaves the other available.
    for(const provider of ['gemini','claude']){
      await select(provider);
      assert.equal(await js(`document.getElementById('model').value`),provider+'-fixture');
      await js(`document.getElementById('${provider}-check').click()`);await settle();
      assert.doesNotMatch(await js(`document.getElementById('${provider}-connection-status').textContent`),/검사용 연결 실패/);
      await js(`document.getElementById('model').value='${provider}-alternate';document.getElementById('settings-form').requestSubmit()`);await settle();
      assert.equal(fixture.model,provider+'-alternate');
      await js(`document.getElementById('login').click()`);
      assert.equal(await js('document.activeElement.id'),provider+'-api-key');
      await js(`document.getElementById('${provider}-api-key').value='unsaved-fixture-key';document.getElementById('claude-workspace-id').value='wrkspc_unsavedfixture';document.querySelector('[data-close="settings-dialog"]').click()`);
      assert.equal(await js(`document.getElementById('${provider}-api-key').value`),'');
      assert.equal(await js(`document.getElementById('claude-workspace-id').value`),'');
      await js(`document.getElementById('settings-open').click()`);
    }
    for(const provider of ['gemini','claude']){
      await select(provider);
      assert.equal(await js(`document.getElementById('model').value`),provider+'-alternate');
      await js(`document.getElementById('${provider}-disconnect').click()`);await settle();assert.equal(hasKey[provider],false);
      if(provider==='gemini')assert.equal(hasKey.claude,true);
      available[provider]=false;await js(`refreshConnectionSettings()`);
      assert.equal(await js(`document.getElementById('${provider}-api-key').disabled&&document.getElementById('${provider}-connect').disabled`),true);
      assert.match(await js(`document.getElementById('${provider}-connection-status').textContent`),/보안 저장소/);
      available[provider]=true;
    }
    await select('gpt');
    await js(`document.getElementById('settings-form').requestSubmit()`);await settle();
    assert.equal(fixture.office,'저장 전 사무소');assert.equal(await js(`document.getElementById('settings-dialog').open`),false);
    for(const provider of ['gemini','claude'])for(const action of ['connect','check','disconnect'])assert.ok(calls.some(call=>call.kind==='connection'&&call.provider===provider&&call.action===action));
    assert.ok(calls.some(call=>call.provider==='claude'&&call.action==='connect'&&call.receivedWorkspace));
    assert.ok(calls.some(call=>call.provider==='gemini'&&call.action==='connect'&&call.receivedKeyLength===fixtureKeys.gemini.length&&call.receivedKeyLength>512));
    // Real in-page links append a fragment. They must not revoke IPC access to
    // this same trusted main document. Stop before any real OAuth/browser call.
    let mapRequests=0;
    service.mapLogin=async()=>{mapRequests++;throw new Error('지도 연결 경로 검사 완료');};
    for(const [selector,fragment] of [['.brand','#new'],['.skip-link','#workspace-main']]){
      await js(`document.querySelector(${JSON.stringify(selector)}).click()`);
      assert.equal(await js('location.hash'),fragment);
      assert.equal((await js(`window.helper['app-info']()`)).version,require('../src/brand.cjs').VERSION);
      await js(`document.getElementById('map-login').click();new Promise((resolve,reject)=>{const deadline=Date.now()+3000,t=setInterval(()=>{if(!document.getElementById('map-login').disabled){clearInterval(t);resolve(true)}else if(Date.now()>deadline){clearInterval(t);reject(Error('map IPC timeout'))}},20)})`);
      assert.match(await js(`document.getElementById('toast').textContent`),/지도 연결 경로 검사 완료/);
    }
    assert.equal(mapRequests,2);
    await js(`history.replaceState(null,'',location.pathname)`);
    const results={passed:true,offlineFixtures:true,liveGeminiRequest:false,liveClaudeRequest:false,providers:['gpt','gemini','claude'],providerSwitch:true,modelPerProvider:true,officeDraftPreserved:true,keyInputCleared:true,keyClearedOnSwitchAndClose:true,secretNotInSettings:true,connectCheckDelete:true,independentCredentials:true,inlineError:true,errorSurvivesRefresh:true,noCodexQuotaForApiProviders:true,analysisLocks:true,keyboardConnect:true,focusOnConnection:true,storageUnavailable:true,workspaceContext:true,workspaceInputCleared:true,longGoogleAuthKeyUnchanged:true,keyMaxLengths:{gemini:8192,claude:512},oversizedPasteRejected:true,disabledActionsExplained:true,keyClearingExplained:true,viewports:['1380x920','1000x780','1000x620']};
    results.mapIpcAfterInPageLinks=true;
    await fs.writeFile(path.join(output,'provider-ui-results.json'),JSON.stringify(results,null,2));
    console.log(JSON.stringify(results));
  }finally{Object.assign(service,originals);win.setSize(...initialSize);await js(`(async()=>{state.busy=false;document.getElementById('settings-dialog').close();await refresh()})()`);}
};
