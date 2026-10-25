'use strict';
const {randomUUID}=require('node:crypto'),{todayKst,normalize}=require('./core.cjs'),naver=require('./naver-land.cjs'),rules=require('./property-identity.cjs');
const {createNaverPageReader,safeComplexUrl}=require('./naver-page.cjs');
const HOME='https://fin.land.naver.com/';
function officialQuery(input,prices){
 const i=prices?.buildingResolution;if(input?.asset!=='apartment'||input.asOf!==todayKst()||!i?.code||!i.building||!i.province||!i.region||!i.town||!i.lot||!/^\d{5}$/.test(String(i.regionCode||'')))throw Error('공식 단지명·시군구·법정동·지번과 오늘 기준일을 확인한 뒤 네이버에서 자동 검색할 수 있습니다.');
 const name=String(i.building).trim(),query=[i.town,name].join(' ');if(query.length<=30)return query;if(name.length<=30)return name;throw Error('공식 단지명이 네이버 공개 검색창의 입력 길이를 초과해 자동 검색하지 않았습니다.');
}
const province=value=>normalize(value).replace(/(?:특별자치|특별|광역)?시$|도$/,'');
function observedComplexUrl(value){try{const u=new URL(value,HOME),m=u.pathname.match(/^\/complexes\/([1-9]\d{0,19})(?:\/(?:tour|photos))?\/?$/);return m&&['new.land.naver.com','fin.land.naver.com'].includes(u.hostname)&&u.protocol==='https:'&&!u.username&&!u.password&&!u.port?safeComplexUrl(u.origin+'/complexes/'+m[1])?.href:null;}catch{return null;}}
function resultCandidates(state,identity){
 if(!state||!Array.isArray(state.rows))return [];
 if(Number.isInteger(state.total)&&state.total>state.rows.length)throw Error('네이버 공개 검색 결과가 일부만 표시되어 단지 자동 연결을 보류했습니다.');
 const found=state.rows.filter(r=>{
  if(!r?.name||!r.address||rules.identityConflict(identity.building,r.name)||!rules.compatibleName(identity.building,r.name))return false;
  const tokens=r.address.trim().split(/\s+/);return province(tokens[0])===province(identity.province)&&normalize(tokens.slice(1).join(' '))===normalize(identity.region+' '+identity.town);
 }).map(r=>({index:r.index,name:r.name,address:r.address,url:(r.links||[]).map(observedComplexUrl).find(Boolean)||null}));
 if(found.length>5)throw Error('같은 이름·지역의 네이버 단지 후보가 여러 개여서 자동 연결하지 않았습니다.');return found;
}
function publicNavigation(value){try{const u=new URL(value);return u.protocol==='https:'&&['fin.land.naver.com','new.land.naver.com'].includes(u.hostname)&&!u.username&&!u.password&&!u.port&&(u.pathname==='/'||/^\/map\/?$/.test(u.pathname)||!!observedComplexUrl(u.href));}catch{return false;}}
// These scripts operate the same public search controls visible to a visitor.
// Application state, request traffic, authentication and unpublished APIs are never read.
const OPEN_SEARCH=`(()=>{const input=document.querySelector('#header-search');if(input)return 'ready';const button=[...document.querySelectorAll('button')].find(e=>e.innerText.replace(/\\s+/g,'')==='단지,주소,지하철,초등학교검색');if(button){button.click();return 'opening';}return 'loading';})()`;
const FOCUS_SEARCH=`(()=>{const input=document.querySelector('#header-search');if(!input)return false;input.focus();input.select();return true;})()`;
const SEARCH_STATE=`(()=>{const input=document.querySelector('#header-search'),root=document.querySelector('[data-sentry-component="SearchResultList"].complex'),visible=e=>e&&getComputedStyle(e).display!=='none'&&getComputedStyle(e).visibility!=='hidden'&&e.getClientRects().length;const rows=root?[...root.querySelectorAll('ul>li')].filter(visible).map((li,index)=>({index,name:li.querySelector('[class*="__name"]')?.innerText?.trim()||'',address:li.querySelector('[class*="__address"]')?.innerText?.trim()||'',links:[...li.querySelectorAll('a[href]')].map(a=>a.href)})):[];return {query:input?.value||'',total:Number(root?.querySelector('h2 em')?.innerText?.replace(/\\D/g,''))||rows.length,rows,empty:/검색 결과가 없|검색결과가 없|결과를 찾을 수 없/.test(input?.closest('[role="search"]')?.innerText||''),blocked:/비정상적인 접근|자동입력 방지|접근이 제한|로봇이 아닙니다/.test(document.body.innerText)};})()`;
const DISPLAYED=`(()=>{const root=document.querySelector('#complex_detail'),ids=root?[...new Set([...root.querySelectorAll('a[href]')].map(a=>{try{const u=new URL(a.href,location.href);return ['fin.land.naver.com','new.land.naver.com'].includes(u.hostname)?u.pathname.match(/^\\/complexes\\/([1-9]\\d{0,19})(?:\\/(?:photos|tour))?\\/?$/)?.[1]:null;}catch{return null;}}).filter(Boolean))]:[];return {ids,name:root?.querySelector('h1,h2,h3')?.innerText?.replace(/\\s+VR\\s*투어$/i,'').trim()||''};})()`;
function clickCandidate(candidate){return `(()=>{const expected=${JSON.stringify(candidate)},root=document.querySelector('[data-sentry-component="SearchResultList"].complex'),li=root?.querySelectorAll('ul>li')[expected.index];if(!li||li.querySelector('[class*="__name"]')?.innerText?.trim()!==expected.name||li.querySelector('[class*="__address"]')?.innerText?.trim()!==expected.address)return false;const button=li.querySelector('button');if(!button)return false;button.click();return true;})()`;}
function createNaverComplexFinder({BrowserWindow,readPage,timeoutMs=15000}){
 const read=readPage||createNaverPageReader({BrowserWindow,timeoutMs});
 return async function findNaverComplex(input,prices,{signal}={}){
  const query=officialQuery(input,prices),identity=prices.buildingResolution;let win,timer,stopped=false,rejectAbort,navigationError;const abortPromise=new Promise((_,reject)=>{rejectAbort=reject;}),check=()=>{if(signal?.aborted)throw Error('네이버 단지 자동 검색을 중지했습니다.');if(stopped)throw Error('네이버 공개 단지 검색 시간이 초과됐습니다.');if(navigationError)throw navigationError;},abort=()=>{rejectAbort(Error('네이버 단지 자동 검색을 중지했습니다.'));if(win&&!win.isDestroyed())win.destroy();};
  try{
   check();win=new BrowserWindow({show:false,width:1200,height:900,webPreferences:{partition:'naver-search-'+randomUUID(),sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});signal?.addEventListener('abort',abort,{once:true});win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.session.setPermissionRequestHandler((_w,_p,cb)=>cb(false));
   const navigation=(event,target)=>{if(!publicNavigation(typeof target==='string'?target:target?.url)){event.preventDefault();navigationError=Error('네이버 공개 단지 검색 범위를 벗어난 이동을 중단했습니다.');}};win.webContents.on('will-navigate',navigation);win.webContents.on('will-redirect',navigation);
   const work=async()=>{
    try{await win.loadURL(HOME);}catch{check();throw Error('네이버 공개 검색 화면에 연결하지 못했습니다.');}
    const wait=async(job,limit,message)=>{const deadline=Date.now()+limit;while(Date.now()<deadline){check();const value=await job();if(value)return value;await new Promise(r=>setTimeout(r,150));}throw Error(message);};
    const search=async()=>{
     await wait(async()=>await win.webContents.executeJavaScript(OPEN_SEARCH)==='ready',timeoutMs,'네이버 공개 단지 검색창을 열지 못했습니다.');
     await win.webContents.executeJavaScript(FOCUS_SEARCH);await win.webContents.insertText(query);
     return wait(async()=>{const state=await win.webContents.executeJavaScript(SEARCH_STATE);if(state.blocked)throw Error('네이버에서 접근 확인을 요청해 자동 검색을 중단했습니다.');if(state.query!==query)return null;if(state.empty)throw Error('네이버 공개 검색에서 같은 단지 후보를 찾지 못했습니다.');return state.rows?.length?state:null;},timeoutMs,'네이버 공개 단지 검색 결과가 표시되지 않았습니다.');
    };
    const first=await search(),candidates=resultCandidates(first,identity);if(!candidates.length)throw Error('네이버 공개 검색에서 공식 단지명·지역과 일치하는 후보를 찾지 못했습니다.');
    const verified=[];let failed=false;
    for(const candidate of candidates){
     check();let url=candidate.url;
     if(!url){
      const state=await search(),current=resultCandidates(state,identity),match=current.find(r=>r.index===candidate.index&&r.name===candidate.name&&r.address===candidate.address);if(!match||!await win.webContents.executeJavaScript(clickCandidate(match)))throw Error('네이버 공개 단지 후보가 바뀌어 자동 연결하지 않았습니다.');
      url=await wait(async()=>{const shown=await win.webContents.executeJavaScript(DISPLAYED);if(shown.ids?.length!==1||!rules.compatibleName(candidate.name,shown.name))return null;return safeComplexUrl(HOME+'complexes/'+shown.ids[0])?.href;},timeoutMs,'선택한 네이버 단지의 공개 식별번호를 확인하지 못했습니다.');
     }
     try{const record=naver.normalize(await read(url,{signal}));if(naver.current(record,{identity,asOf:input.asOf}))verified.push(record);}catch(error){check();failed=true;}
    }
    const unique=[...new Map(verified.map(r=>[r.complexNo,r])).values()];if(failed||unique.length!==1)throw Error(unique.length>1?'공식 주소와 일치하는 네이버 단지가 여러 개여서 자동 연결하지 않았습니다.':'네이버 단지의 실제 주소·이름을 공식 자료와 대조하지 못했습니다.');return unique[0];
   };
   const value=await Promise.race([work(),abortPromise,new Promise((_,reject)=>{timer=setTimeout(()=>{stopped=true;reject(Error('네이버 공개 단지 검색 시간이 초과됐습니다.'));},timeoutMs*4);})]);check();return value;
  }finally{stopped=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);if(win&&!win.isDestroyed())win.destroy();}
 };
}
module.exports={officialQuery,observedComplexUrl,resultCandidates,createNaverComplexFinder};
