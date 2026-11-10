'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');

// Opt-in integration check: fresh smoke profile, real public RTMS responses,
// actual renderer/IPC/selection tokens, no AI generation or report creation.
exports.run=async({win,service,output})=>{
 const saved={request:service.data.request,session:service.bridge.evidenceSession,naverStore:service.naverStore};
 const requests=[],results=[],startedAt=new Date().toISOString();
 const js=code=>win.webContents.executeJavaScript(`(async()=>{${code}})()`);
 const wait=async key=>{
  const deadline=Date.now()+120000;
  while(await js(`return typePickers.get(${JSON.stringify(key)}).selecting;`)){
   if(Date.now()>deadline)throw Error('실제 단지 조회 시간 초과: '+key);
   await new Promise(resolve=>setTimeout(resolve,50));
  }
  const state=await js(`const p=typePickers.get(${JSON.stringify(key)});return {catalog:p.catalog,choices:p.choicesData,note:p.note.textContent};`);
  assert.ok(state.catalog||state.choices,state.note);return state;
 };
 async function visibleResult(key){
  // Do not scroll here: the controller must reveal its own result after IPC.
  const result=await js(`await document.fonts.ready;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
   const p=typePickers.get(${JSON.stringify(key)}),candidates=!!p.choicesData;
   const container=candidates?p.choices:p.boxes,control=candidates?(p.choicesData.candidates.length===1?p.choices.querySelector('button'):p.choices.querySelector('input')):p.boxes.querySelector('input');
   const row=candidates?p.choices.querySelector('button'):control.closest('label'),rect=row.getBoundingClientRect();
   return {kind:candidates?'candidates':'types',focused:document.activeElement===control,enabled:!control.disabled,
    visible:rect.width>0&&rect.top>=0&&rect.bottom<=innerHeight&&rect.left>=0&&rect.right<=innerWidth,
    headingVisible:container.getBoundingClientRect().top>=0,rect:rect.toJSON(),width:innerWidth,height:innerHeight};`);
  assert.equal(result.enabled,true,JSON.stringify(result));assert.equal(result.focused,true,JSON.stringify(result));
  assert.equal(result.visible,true,JSON.stringify(result));assert.equal(result.headingVisible,true,JSON.stringify(result));
  return result;
 }
 async function capture(name){
  await js('await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));return true;');
  assert.equal(await js('return document.documentElement.scrollWidth>innerWidth;'),false);
  await fs.writeFile(path.join(output,name+'.png'),(await win.webContents.capturePage()).toPNG());
 }
 try{
  await fs.mkdir(output,{recursive:true});
  service.naverStore=null;
  service.bridge.evidenceSession=async()=>{throw Error('공식 단지 검색이 불필요한 외부 검색으로 넘어갔습니다.');};
  service.data.request=async function(route,form,...args){
   const start=Date.now(),bytes=await saved.request.call(this,route,form,...args);
   requests.push({route,form,bytes:bytes.length,elapsedMs:Date.now()-start});return bytes;
  };
  const cases=[
   {target:'서울시 양천구 신정동 337 목동우성2차',name:'목동우성2',code:'3282',areas:[84.96,113,113.91],screenshot:'mokdong-types'},
   {target:'서울시 양천구 신정동 337 목동우성2차',name:'목동우성2',code:'3282',areas:[84.96,113,113.91],compact:true,warmCacheFixture:true,screenshot:'mokdong-types-compact'},
   {target:'서울 양천구 신정동 목동우성3차',name:'목동우성3',code:'3283'},
   {target:'인천 연수구 송도동 그린워크1차 아파트',name:'더샵그린워크1차'},
   {target:'서울 송파구 잠실동 리센츠아파트',name:'리센츠'},
   {target:'서울 송파구 잠실동 트리지움 아파트',name:'트리지움'},
   {target:'서울시 양천구 신정동 337 목동우성 2차 아파트',name:'목동우성2',code:'3282',key:'property-A',compact:true,screenshot:'comparison-types'}
  ];
  for(const [index,item]of cases.entries()){
   const key=item.key||'single',before=requests.length,start=Date.now();
   win.setSize(...(item.compact?[1000,780]:[1380,920]));
   // A public-address cache fixture reproduces the user's saved alias. Official
   // identities and areas still come from the live API, never from this fixture.
   let cachedReads=0;
   service.naverStore=item.warmCacheFixture?{list:async()=>{cachedReads++;return [{complexNo:'8742',name:'목동우성2차',addressJibun:'서울시 양천구 신정동 337',addressRoad:'서울시 양천구 목동남로4길 6-23',checkedAt:new Date().toISOString(),sourceUrl:'https://fin.land.naver.com/complexes/8742'}];}}:null;
   await js(`view('new');document.querySelector('[name=analysisMode][value=${key==='single'?'single':'comparison'}]').click();
    const p=typePickers.get(${JSON.stringify(key)}),report=p.root.closest('.comparison-property')?.querySelector('[data-field=reportId]');
    if(report){report.value='';report.dispatchEvent(new Event('change'));}
    const target=p.root.querySelector(${JSON.stringify(key==='single'?'#target':'[data-field=target]')});
    target.value=${JSON.stringify(item.target)};target.dispatchEvent(new Event('input'));
    ${key==='single'?"document.getElementById('building').value='';":"p.root.querySelector('[data-field=building]').value='';"}
    document.getElementById('toast').classList.add('hidden');window.scrollTo(0,0);p.search.click();return true;`);
   let state=await wait(key);
   const visibility=[await visibleResult(key)];let candidateSelections=0;
   if(state.choices){
    assert.equal(state.choices.candidates.length,1,JSON.stringify(state.choices.candidates));
    assert.equal(state.choices.candidates[0].name,item.name);
    if(item.code)assert.equal(state.choices.candidates[0].id,'rtms-'+item.code);
    if(index===0)await capture('official-confirmation');
    await js(`typePickers.get(${JSON.stringify(key)}).choices.querySelector('[data-candidate-id]').click();return true;`);
    state=await wait(key);
    candidateSelections++;visibility.push(await visibleResult(key));
   }
   assert.equal(state.catalog?.identity.building,item.name);
   if(item.code)assert.equal(state.catalog.identity.code,item.code);
   if(item.areas)assert.deepEqual(state.catalog.areas,item.areas);
   assert.ok(state.catalog.areas.length>0);
   const input=await js(`const p=typePickers.get(${JSON.stringify(key)});p.boxes.querySelector('input').click();return {...p.getInput(),...readTypeSelection(${JSON.stringify(key)})};`);
   assert.equal(service.validateTypeSelection(input).identity.code,state.catalog.identity.code);
   assert.equal(await js(`return typePickers.get(${JSON.stringify(key)}).search.disabled;`),false);
   if(item.warmCacheFixture)assert.equal(cachedReads,0,'주소 검색이 네이버 저장 후보를 한 번 더 선택하게 합니다.');
   if(item.screenshot)await capture(item.screenshot);
   const result={target:item.target,key,identity:state.catalog.identity,areas:state.catalog.areas,visibility,candidateSelections,warmCacheFixture:!!item.warmCacheFixture,requests:requests.length-before,elapsedMs:Date.now()-start};
   results.push(result);console.log(JSON.stringify({building:result.identity.building,code:result.identity.code,types:result.areas.length,requests:result.requests}));
  }
  const result={passed:true,version:require('../package.json').version,startedAt,checkedAt:new Date().toISOString(),realOfficialResponses:true,rendererAndIpc:true,freshProfile:true,aiCalls:0,externalCandidateCalls:0,results,requests};
  await fs.writeFile(path.join(output,'search-live-results.json'),JSON.stringify(result,null,2));return result;
 }finally{service.data.request=saved.request;service.bridge.evidenceSession=saved.session;service.naverStore=saved.naverStore;}
};
