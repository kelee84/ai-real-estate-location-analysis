'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
exports.run=async({win,service,output})=>{
 const saved={resolve:service.data.resolve,request:service.data.request},calls=[];let held=null,waiting=0;
 const js=code=>win.webContents.executeJavaScript(`(async()=>{${code}})()`);
 const wait=async condition=>{const end=Date.now()+10000;while(!await condition()){if(Date.now()>end)throw Error('property-switch test timeout');await new Promise(r=>setTimeout(r,25));}};
 const catalog=key=>js(`return typePickers.get(${JSON.stringify(key)}).catalog?.building||'';`);
 const target=n=>'인천광역시 연수구 송도동 송도더샵그린워크'+n+'차';
 const start=(key,n,building=true)=>js(`view('new');document.querySelector('[name=analysisMode][value=${key==='single'?'single':'comparison'}]').click();const p=typePickers.get(${JSON.stringify(key)}),root=p.root,t=root.querySelector(${JSON.stringify(key==='single'?'#target':'[data-field=target]')}),b=${key==='single'?"document.getElementById('building')":"root.querySelector('[data-field=building]')"};t.value=${JSON.stringify(target(n))};t.dispatchEvent(new Event('input'));b.value=${JSON.stringify(building?'더샵그린워크'+n+'차':'')};b.dispatchEvent(new Event('input'));p.search.click();`);
 try{
  service.data.resolve=async()=>({code:'28185'});
  service.data.request=async(route,form)=>{
   calls.push({route,form});let value;
   if(route.includes('emdList'))value={emdList:[{code:'2818510600',codeNm:'송도동'}]};
   else if(route.includes('ptDanjiList')){const n=form.srhBldgNm.includes('3차')?3:1;value={totCnt:1,danjiList:[{aprpnHsmpCode:String(n),aprpnHsmpNm:'더샵그린워크'+n+'차',mnnm:n===1?'18-6':'17-1'}]};}
   else if(route.includes('ptDtlArea')){if(form.srhAprpnHsmpCode==='1'&&held){waiting++;await held.promise;}value={danjiList:(form.srhAprpnHsmpCode==='1'?[59.9201,84.3408]:[59.7,84.9,99.8]).map(prvuseAr=>({prvuseAr}))};}
   else throw Error('unexpected route '+route);return Buffer.from(JSON.stringify(value));
  };
  for(const key of ['single','property-A']){
   if(key!=='single')await js(`document.querySelector('[name=analysisMode][value=comparison]').click();const r=document.querySelector('.comparison-property [data-field=reportId]');r.value='';r.dispatchEvent(new Event('change'));`);
   await start(key,1);await wait(async()=>await catalog(key)==='더샵그린워크1차');
   const before=await js(`const p=typePickers.get(${JSON.stringify(key)});p.boxes.querySelector('input').checked=true;return readTypeSelection(${JSON.stringify(key)});`);
   const reset=await js(`const p=typePickers.get(${JSON.stringify(key)}),t=p.root.querySelector(${JSON.stringify(key==='single'?'#target':'[data-field=target]')});t.value=${JSON.stringify(target(3))};t.dispatchEvent(new Event('input'));let blocked=false;try{readTypeSelection(${JSON.stringify(key)});}catch{blocked=true;}return {building:p.getInput().building,catalog:p.catalog,boxes:p.boxes.querySelectorAll('input').length,blocked};`);
   assert.deepEqual(reset,{building:'',catalog:null,boxes:0,blocked:true});
   await js(`typePickers.get(${JSON.stringify(key)}).search.click();`);await wait(async()=>await catalog(key)==='더샵그린워크3차');
   const selection=await js(`const p=typePickers.get(${JSON.stringify(key)});p.boxes.querySelector('input').checked=true;return {...p.getInput(),...readTypeSelection(${JSON.stringify(key)})};`);
   assert.deepEqual(selection.selectedAreas,[59.7]);assert.equal(service.validateTypeSelection(selection).identity.code,'3');
   assert.throws(()=>service.validateTypeSelection({...selection,catalogToken:before.catalogToken}),/다시 검색/);
  }
  // An old response must not overwrite a newer search, even when it finishes last.
  let release;held={promise:new Promise(r=>release=r)};await start('single',1);await wait(()=>waiting>0);
  await start('single',3,false);await wait(async()=>await catalog('single')==='더샵그린워크3차');release();held=null;
  await new Promise(r=>setTimeout(r,100));assert.equal(await catalog('single'),'더샵그린워크3차');
  // Programmatic field changes are checked again before submit/search.
  await start('single',1);await wait(async()=>await catalog('single')==='더샵그린워크1차');
  const blocked=await js(`document.getElementById('target').value=${JSON.stringify(target(3))};try{input();return false;}catch{return document.getElementById('building').value==='';}`);assert.equal(blocked,true);
  await js("typePickers.get('single').search.click()");await wait(async()=>await catalog('single')==='더샵그린워크3차');
  await js("typePickers.get('single').host.scrollIntoView({block:'center'});document.getElementById('toast').classList.add('hidden');");
  await fs.writeFile(path.join(output,'property-switch-3rd.png'),(await win.webContents.capturePage()).toPNG());
  await fs.writeFile(path.join(output,'property-switch-results.json'),JSON.stringify({passed:true,syntheticUiFixture:true,singleAndComparison:true,staleBuildingCleared:true,oldSelectionBlocked:true,lateResponseIgnored:true,programmaticChangeRechecked:true,newIdentityCode:'3',newAreas:[59.7,84.9,99.8],calls},null,2));
 }finally{Object.assign(service.data,saved);await js("document.querySelector('[name=analysisMode][value=single]').click();typePickers.get('single').invalidated=false;typePickers.get('single').clear();").catch(()=>{});}
};
