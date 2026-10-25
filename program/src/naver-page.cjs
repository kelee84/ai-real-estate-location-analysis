'use strict';
const {normalize}=require('./naver-land.cjs');
function safeComplexUrl(value){
 try{const u=new URL(value);if(u.protocol!=='https:'||!['new.land.naver.com','fin.land.naver.com'].includes(u.hostname)||u.port||u.username||u.password||!/^\/complexes\/[1-9]\d{0,19}\/?$/.test(u.pathname))return null;u.pathname=u.pathname.replace(/\/$/,'');u.search='';u.hash='';u.searchParams.set('tab','complex-info');return u;}catch{return null;}
}
const clean=value=>typeof value==='string'?value.replace(/\u0000/g,'').replace(/[ \t]+/g,' ').trim():'';
const id=url=>url.pathname.split('/').at(-1);
function mapUrl(value){try{const u=new URL(value);return u.protocol==='https:'&&['new.land.naver.com','fin.land.naver.com'].includes(u.hostname)&&!u.port&&!u.username&&!u.password&&/^\/map\/?$/.test(u.pathname)?u:null;}catch{return null;}}
function safePageUrl(value){const complex=safeComplexUrl(value);if(complex)return complex;const map=mapUrl(value),layer=map?.searchParams.get('layer');if(!map||!layer||layer.length>16000)return null;map.pathname='/map';map.search='';map.hash='';map.searchParams.set('layer',layer);return map;}
function name(value){let v=clean(value).replace(/\s+/g,' ').replace(/\s*(?:[:|｜]|\s+-\s+)\s*(?:네이버(?:페이)?\s*부동산|Npay\s*부동산).*$/i,'').replace(/^(?:네이버(?:페이)?\s*부동산|Npay\s*부동산)\s*[:|｜-]\s*/i,'').replace(/\s+VR\s*투어$/i,'').trim();if(/\s시세\/실거래/.test(v))v=v.replace(/\s+시세\/실거래.*$/,'').replace(/^\S+(?:동|리|읍|면)\s+/,'');return v.length>=2&&v.length<=120&&!/^(?:Npay\s*부동산|네이버(?:페이)?\s*부동산|기본\s*정보|단지\s*정보|부동산|면적\s*정보)$/i.test(v)?v:null;}
function postal(value){if(typeof value==='string')return clean(value);if(!value||typeof value!=='object')return '';return clean([value.addressRegion,value.addressLocality,value.streetAddress].filter(v=>typeof v==='string').join(' '));}
function structuredValues(value){if(Array.isArray(value))return value.flatMap(structuredValues);if(!value||typeof value!=='object')return [];return [value,...(Array.isArray(value['@graph'])?value['@graph'].flatMap(structuredValues):[])];}
function floorDisplay(value){const v=clean(value).replace(/\s+/g,' '),range=v.match(/^(\d+)층\s*\(가장 낮은 동\)\s*(\d+)층\s*\(가장 높은 동\)$/);if(range){const low=Number(range[1]),high=Number(range[2]);return low>=1&&high>=low&&high<=200?'동별 최고층 '+low+(low===high?'':'~'+high)+'층':null;}return /^\d{1,3}층$/.test(v)&&Number(v.slice(0,-1))>=1&&Number(v.slice(0,-1))<=200?'최고층 '+v:null;}
function transportDisplay(value){
 const tokens=String(value||'').replace(/^네이버 주변 대중교통 표시:\s*/,'').split(/\s*·\s*|\r?\n/).map(clean).filter(Boolean),stations=[];
 for(let index=0;index<tokens.length;index++){
  const token=tokens[index],station=token.match(/^([가-힣A-Za-z0-9() -]{1,60}역)\s*\(?([1-9])\s*호선\)?$/)||token.match(/^([가-힣A-Za-z0-9() -]{1,60}역)\s*([1-9])$/);if(!station)continue;
  let next=index+1;if(tokens[next]==='호선')next++;let distance=tokens[next]||'';if(/^\d+분$/.test(tokens[next+1]||''))distance+=' '+tokens[next+1];
  const match=distance.match(/^(?:네이버\s*도보\s*)?((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)\s*(km|m)\s*(?:도보\s*)?(\d+)\s*분$/i);if(!match||!/도보/.test(distance))continue;
  const metres=Number(match[1].replace(/,/g,''))*(match[2].toLowerCase()==='km'?1000:1),minutes=Number(match[3]);if(!(metres>0&&metres<=50000&&minutes>0&&minutes<=1440))continue;
  stations.push(station[1].trim()+'('+station[2]+'호선) · 네이버 도보 '+match[1]+match[2].toLowerCase()+' · '+minutes+'분');
 }
 if(stations.length)return [...new Set(stations)].join(' / ');
 const busAt=tokens.indexOf('버스');if(busAt<0)return null;const buses=[];for(let i=busAt+1;i<tokens.length-1;i++){if(!/^(?:간선|지선|마을|광역|직행좌석|좌석|일반|급행간선|급행)$/.test(tokens[i])||!/[0-9]/.test(tokens[i+1])||!/^[가-힣A-Za-z0-9, ()-]{1,140}$/.test(tokens[i+1]))continue;buses.push(tokens[i]+' '+tokens[++i]);}return buses.length?'네이버 버스 표시: '+buses.join(' · '):null;
}
// Reused by the output projection so previously saved public facts receive the
// same strict formatting repair without changing their source records.
function normalizePublicFact(fact){if(!fact||typeof fact.text!=='string')return null;let text=fact.text;if(/^네이버 단지 표시:\s*최고층\s/.test(text)){const display=floorDisplay(text.replace(/^네이버 단지 표시:\s*최고층\s*/,''));if(!display)return null;text='네이버 단지 표시: '+display;}if(fact.category==='transport'&&/^네이버 주변 대중교통 표시:/.test(text)){text=transportDisplay(text);if(!text)return null;}return {...fact,text};}
function withPublicFacts(record,state){
 const facts=[],body=typeof state.bodyText==='string'?state.bodyText:'',tables=Array.isArray(state.tables)?state.tables:[],flat=v=>clean(v).replace(/\s+/g,' '),add=(category,content,distanceBasis)=>{const text=flat(content);if(!text)return;facts.push({category,text,sourceUrl:record.sourceUrl,checkedAt:record.checkedAt,sourceId:'naver-'+require('node:crypto').createHash('sha256').update(record.sourceUrl+category+text).digest('hex').slice(0,16),...(distanceBasis?{distanceBasis}:{})});};
 const basic=[];if(record.basic?.units)basic.push(record.basic.units.toLocaleString('ko-KR')+'세대');if(record.basic?.parkingSpaces!==undefined)basic.push('주차 '+record.basic.parkingSpaces.toLocaleString('ko-KR')+'대');if(basic.length)add('daily','네이버 단지 표시: '+basic.join(' · '));
 for(const label of ['동수','최고층','난방','전기차 충전시설','용적률/건폐율','건설사']){const value=tables.find(t=>flat(t?.label).replace(/\s/g,'')===label)?.value;if(!value)continue;const content=label==='최고층'?floorDisplay(value):label+' '+flat(value);if(content)add('daily','네이버 단지 표시: '+content);}
 const education=state.sections?.education||body.match(/배정\s*초등학교([\s\S]*?)(?=\n(?:개발예정|단지 내부시설|주변 분양|주변 대중교통|우리동네|로그인)|$)/)?.[1]||'',schoolNames=[...new Set(education.split('\n').map(clean).filter(line=>/^[가-힣A-Za-z0-9·() -]{2,80}초등학교$/.test(line)&&!/배정|성적|순위/.test(line)))].slice(0,3),distance=education.match(/(?:^|\n)거리\s*\n([^\n]+)/)?.[1],zone=education.match(/(?:^|\n)배정동\s*\n([^\n]+)/)?.[1],condition=education.split('\n').map(clean).find(line=>/주소지에 따라.{0,30}배정|공동.{0,20}학구|선택.{0,20}배정/.test(line));
 if(schoolNames.length)add('education','네이버 배정 표시: '+schoolNames.join('·')+(distance?' · '+flat(distance):'')+(zone?' · 배정동 '+flat(zone):'')+(condition?' · '+condition:'')+'. 실제 배정은 교육지원청 확인이 필요합니다.',distance?'네이버 표시 거리·도보 안내이며 실제 통학 동선·시간은 미확인':undefined);
 const transport=state.sections?.transport||body.match(/주변\s*대중교통([\s\S]*?)(?=\n(?:우리동네|주변 분양|로그인)|$)/)?.[1]||'',lines=transport.split('\n').map(clean).filter(line=>line&&!/^주변\s*대중교통$|^상세내용|^지도보기$|^접기$|로딩\s*중|불러오는\s*중|loading/i.test(line)),display=transportDisplay(lines.join(' · '));if(display)add('transport',display,'네이버 공개 노선·도보 표시이며 실제 운행·현장 동선은 별도 확인');
 return normalize({...record,publicFacts:facts});
}
function fromPage(url,state){
 let safe=safeComplexUrl(url);if(!safe){const map=mapUrl(url),rendered=String(state?.renderedComplexNo||'');if(!map||!/^([1-9]\d{0,19})$/.test(rendered))throw Error('네이버 단지 링크와 실제 열린 단지번호를 확인하지 못했습니다. 단지 정보가 열린 상태에서 다시 시도해 주세요.');safe=safeComplexUrl(map.origin+'/complexes/'+rendered);}
 if(!state||typeof state!=='object')throw Error('네이버 단지 페이지의 공개 내용을 읽지 못했습니다.');
 if(state.renderedComplexNo&&String(state.renderedComplexNo)!==id(safe))throw Error('네이버 링크와 표시된 단지번호가 다릅니다.');
 if(state.url){const actual=safeComplexUrl(state.url);if(actual?id(actual)!==id(safe):!mapUrl(state.url)||String(state.renderedComplexNo)!==id(safe))throw Error('네이버에서 다른 단지나 페이지로 이동하여 가져오기를 중단했습니다.');}
 const values=structuredValues(state.structured),direct=values.filter(v=>v.complexDetail&&typeof v.complexDetail==='object');
 if(direct.length>1)throw Error('공개 페이지에 단지 기본정보가 여러 개 있어 자동 연결하지 않았습니다.');
 if(direct.some(v=>String(v.complexDetail.complexNo)!==id(safe)))throw Error('네이버 링크와 표시된 단지번호가 다릅니다.');
 const tables=Array.isArray(state.tables)?state.tables:[],body=typeof state.bodyText==='string'?state.bodyText.slice(0,120000):'';
 const valueFor=labels=>{
  const found=tables.find(t=>labels.includes(clean(t?.label).replace(/\s/g,''))&&clean(t?.value));if(found)return clean(found.value);
  for(const label of labels){const match=body.match(new RegExp('(?:^|\\n)\\s*'+label+'\\s*[:：]?\\s*([^\\n]+)'));if(match)return clean(match[1]);}return '';
 };
 const tableName=name(valueFor(['단지명'])),headings=(Array.isArray(state.headings)?state.headings:[]).map(name).filter(Boolean),headingName=headings.length===1?headings[0]:null,titleName=name(state.title),pageName=tableName||headingName||titleName;
 if(direct.length===1){const d=direct[0].complexDetail;if(pageName&&name(d.complexName)&&pageName!==name(d.complexName))throw Error('페이지 제목과 공개 단지정보의 이름이 달라 확인이 필요합니다.');return withPublicFacts(normalize({complexDetail:d,sourceUrl:safe.href,checkedAt:new Date().toISOString()}),state);}
 const ld=values.filter(v=>!v.complexDetail&&typeof v.name==='string'&&v.address&&(!v['@type']||['ApartmentComplex','Apartment','Residence','HousingComplex','Place'].some(t=>(Array.isArray(v['@type'])?v['@type']:[v['@type']]).includes(t))));
 const addresses=[...new Set(ld.map(v=>postal(v.address)).filter(Boolean))],names=[...new Set(ld.map(v=>name(v.name)).filter(Boolean))];
 if(addresses.length>1||names.length>1)throw Error('공개 페이지에 서로 다른 단지 이름이나 주소가 있어 자동 연결하지 않았습니다.');
 const ldName=names[0],resolvedName=pageName||ldName;if(pageName&&ldName&&pageName!==ldName)throw Error('페이지 제목과 공개 단지정보의 이름이 달라 확인이 필요합니다.');
 const addressText=value=>value.replace(/\s*복사\s*$/,'').trim(),road=addressText(valueFor(['도로명주소','도로명'])),jibun=addressText(valueFor(['지번주소','지번','주소']));let address=jibun||addresses[0];
 if(jibun&&/^[^\s]+(?:동|리|읍|면|가)\s+(?:산\s*)?\d+(?:-\d+)?(?:\s|$)/.test(jibun)){const prefix=road.match(/^(.+?)\s+[^\s]+(?:대로|로|길)\s+\d+(?:-\d+)?(?:\s|$)/)?.[1];if(prefix)address=prefix+' '+jibun;}
 const approval=valueFor(['사용승인일','사용검사일']),units=valueFor(['세대수']),parking=valueFor(['주차대수','주차']);
 if(!resolvedName||!address){if(/비정상적인 접근|자동입력 방지|접근이 제한|보안 확인|로봇이 아닙니다|로그인이 필요/.test(body))throw Error('네이버에서 접근 확인을 요청했습니다. 페이지에서 확인한 뒤 다시 가져와 주세요.');throw Error('네이버 페이지에서 단지명과 전체 지번주소를 확인하지 못했습니다. 기본 정보의 주소 상세가 표시된 상태에서 다시 시도해 주세요.');}
 const date=approval.match(/(\d{4})\s*[.년/-]\s*(\d{1,2})\s*[.월/-]\s*(\d{1,2})/),number=(value,unit)=>{const m=value.match(new RegExp('(?:^|\\s)([\\d,]+)\\s*'+unit))||value.match(/^([\d,]+)$/);return m?Number(m[1].replace(/,/g,'')):null;};
 const basic={};if(date)basic.approvalDate=date[1]+'-'+date[2].padStart(2,'0')+'-'+date[3].padStart(2,'0');const unitCount=number(units,'세대'),parkingCount=number(parking,'대');if(unitCount!==null)basic.units=unitCount;if(parkingCount!==null)basic.parkingSpaces=parkingCount;
 return withPublicFacts(normalize({complexNo:id(safe),name:resolvedName,addressJibun:address,...(road?{addressRoad:road}:{}),checkedAt:new Date().toISOString(),sourceUrl:safe.href,basic}),state);
}
// Read only visible public fields and public JSON-LD. No request interception,
// cookies, account state, private endpoints or application hydration data.
const STATE=`(()=>{
 const clean=v=>String(v||'').replace(/\\u0000/g,'').trim(),labels=new Set(['단지명','지번주소','지번 주소','지번','주소','도로명주소','도로명 주소','도로명','사용승인일','사용검사일','세대수','주차대수','주차','동수','최고층','난방','전기차 충전시설','용적률/건폐율','건설사']);
 const visible=e=>{const s=getComputedStyle(e);return s.display!=='none'&&s.visibility!=='hidden'&&!!e.getClientRects().length;};
 const root=document.querySelector('#complex_detail')||document.body,tables=[];
 for(const row of root.querySelectorAll('tr')){if(!visible(row))continue;const cells=[...row.querySelectorAll('th,td')].filter(visible);if(cells.length>=2)tables.push({label:clean(cells[0].innerText),value:clean(cells.slice(1).map(c=>c.innerText).join(' '))});}
 for(const e of [...root.querySelectorAll('dt,th,span,div,strong')].slice(0,12000)){if(!visible(e))continue;const label=clean(e.innerText);if(!labels.has(label))continue;const next=e.nextElementSibling;let value=next&&visible(next)?clean(next.innerText):'';if(!value&&e.parentElement&&e.parentElement.innerText.length<500)value=clean(e.parentElement.innerText).replace(label,'').trim();if(value&&value.length<500)tables.push({label,value});}
 const structured=[];for(const s of document.querySelectorAll('script[type="application/ld+json"]')){if(s.textContent.length>200000)continue;try{const data=JSON.parse(s.textContent),walk=v=>{if(Array.isArray(v)){v.forEach(walk);return;}if(!v||typeof v!=='object')return;if(v.name&&v.address)structured.push({'@type':v['@type'],name:v.name,address:typeof v.address==='string'?v.address:{addressRegion:v.address.addressRegion,addressLocality:v.address.addressLocality,streetAddress:v.address.streetAddress}});if(v['@graph'])walk(v['@graph']);};walk(data);}catch{}}
 const ids=[...new Set([...root.querySelectorAll('a[href]')].map(a=>{try{const u=new URL(a.href,location.href);return ['fin.land.naver.com','new.land.naver.com'].includes(u.hostname)?u.pathname.match(/^\\/complexes\\/([1-9]\\d{0,19})(?:\\/(?:photos|tour))?\\/?$/)?.[1]:null;}catch{return null;}}).filter(Boolean))],heading=[...root.querySelectorAll('h1,h2,h3')].find(visible);
 return {url:location.href,renderedComplexNo:ids.length===1?ids[0]:null,title:document.title,headings:heading?[clean(heading.innerText)]:[],bodyText:root.innerText.slice(0,120000),tables:tables.slice(0,100),structured,sections:{education:root.querySelector('[data-sentry-component="ComplexSchool"]')?.innerText?.slice(0,5000)||'',transport:root.querySelector('[data-sentry-component="TransportInfo"]')?.innerText?.slice(0,5000)||''}};
})()`;
const PREPARE=`(()=>{const root=document.querySelector('#complex_detail')||document.body,tabs=[...root.querySelectorAll('button,[role="tab"]')],flat=e=>String(e.innerText||e.textContent||'').replace(/\\s+/g,'');const basic=tabs.find(e=>/^(?:단지정보|기본정보)$/.test(flat(e))&&e.getAttribute('aria-selected')!=='true'&&!e.dataset.codexPublicRead);if(basic&&!/기본\\s*정보/.test(root.innerText)){basic.dataset.codexPublicRead='1';basic.click();}const address=tabs.find(e=>/상세내역보기/.test(flat(e))&&/(?:시|도|구).+(?:로|길)/.test(flat(e)));if(address&&!/지번/.test(address.closest('li')?.innerText||root.innerText))address.click();return true;})()`;
function createNaverPageReader({BrowserWindow,timeoutMs=15000}){
 return async function readNaverPage(url,{signal}={}){
  const safe=safePageUrl(url),expected=safeComplexUrl(url);if(!safe)throw Error('네이버 단지 링크를 확인해 주세요. 단지 정보가 열린 네이버 페이지 주소를 입력해 주세요.');
  let win,timer,aborted=false,stopped=false,lastError,navigationError,rejectAbort,publicWaitStarted;const abortedPromise=new Promise((_,reject)=>{rejectAbort=reject;}),check=()=>{if(signal?.aborted||aborted)throw Error('네이버 단지정보 가져오기를 중지했습니다.');if(stopped)throw Error('네이버 페이지 연결 시간이 초과됐습니다. 잠시 후 다시 시도해 주세요.');},abort=()=>{aborted=true;rejectAbort(Error('네이버 단지정보 가져오기를 중지했습니다.'));if(win&&!win.isDestroyed())win.destroy();};
  try{
   check();win=new BrowserWindow({show:false,width:1200,height:900,webPreferences:{partition:'naver-public-'+require('node:crypto').randomUUID(),sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});signal?.addEventListener('abort',abort,{once:true});win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.session.setPermissionRequestHandler((_w,_p,cb)=>cb(false));
   const navigation=(event,target)=>{const targetUrl=typeof target==='string'?target:target?.url,next=safeComplexUrl(targetUrl);if(!(next&&(!expected||id(next)===id(expected)))&&!mapUrl(targetUrl)){event.preventDefault();navigationError=Error('네이버에서 다른 단지나 페이지로 이동하여 가져오기를 중단했습니다.');}};win.webContents.on('will-navigate',navigation);win.webContents.on('will-redirect',navigation);
   const deadline=Date.now()+timeoutMs,load=(async()=>{try{await win.loadURL(safe.href);}catch(error){check();if(navigationError)throw navigationError;throw Error('네이버 단지 페이지에 연결하지 못했습니다. 링크와 네트워크 상태를 확인해 주세요.');}while(Date.now()<deadline){check();if(navigationError)throw navigationError;const actualUrl=win.webContents.getURL(),actual=safeComplexUrl(actualUrl);if(!(actual&&(!expected||id(actual)===id(expected)))&&!mapUrl(actualUrl))throw Error('네이버에서 다른 단지나 페이지로 이동하여 가져오기를 중단했습니다.');await win.webContents.executeJavaScript(PREPARE);check();const state=await win.webContents.executeJavaScript(STATE);try{const record=fromPage(safe.href,{...state,url:actualUrl}),loading=Object.values(state?.sections||{}).some(v=>typeof v==='string'&&/로딩\s*중|불러오는\s*중|loading/i.test(v));publicWaitStarted??=Date.now();if(!loading||Date.now()-publicWaitStarted>=4000)return record;}catch(error){lastError=error;}await new Promise(resolve=>setTimeout(resolve,Math.min(200,Math.max(0,deadline-Date.now()))));}throw lastError||Error('네이버 단지 내용이 아직 표시되지 않았습니다. 잠시 후 다시 시도해 주세요.');})();
   const value=await Promise.race([load,abortedPromise,new Promise((_,reject)=>{timer=setTimeout(()=>{stopped=true;reject(lastError||Error('네이버 페이지 연결 시간이 초과됐습니다. 잠시 후 다시 시도해 주세요.'));},timeoutMs);})]);check();return value;
  }finally{stopped=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);if(win&&!win.isDestroyed())win.destroy();}
 };
}
module.exports={safeComplexUrl,safePageUrl,fromPage,createNaverPageReader,normalizePublicFact};
