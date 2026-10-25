'use strict';
// Supplementary public facts only. These records never enter distance scores.
const {randomUUID,createHash}=require('node:crypto');
const {todayKst}=require('./core.cjs');
const GROUPS=[{category:'medical',query:'소아청소년과',group:'hospital'},{category:'shopping',query:'대형마트'},{category:'nature',query:'공원'},{category:'nature',query:'숲길'}];
const PROVINCES=[['서울','서울시','서울특별시'],['부산','부산시','부산광역시'],['대구','대구시','대구광역시'],['인천','인천시','인천광역시'],['광주','광주시','광주광역시'],['대전','대전시','대전광역시'],['울산','울산시','울산광역시'],['세종','세종시','세종특별자치시'],['경기','경기도'],['강원','강원도','강원특별자치도'],['충북','충청북도'],['충남','충청남도'],['전북','전라북도','전북특별자치도'],['전남','전라남도'],['경북','경상북도'],['경남','경상남도'],['제주','제주도','제주특별자치도']];
const clean=(v,max=400)=>typeof v==='string'?v.normalize('NFKC').replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,max):'';
const provinceKey=v=>PROVINCES.findIndex(values=>values.includes(v));
function identityOf(input,prices){
 const i=prices?.buildingResolution;
 return input?.asset==='apartment'&&(!input.asOf||input.asOf===todayKst())&&i?.code&&clean(i.building)&&/^\d{5}$/.test(String(i.regionCode||''))&&provinceKey(i.province)>=0&&clean(i.region)&&clean(i.town)&&clean(i.lot)?i:null;
}
function needed(e,input){
 const access=require('./living-access.cjs'),living=e?.livingAccess,valid=access.validSnapshot(living,{center:e?.center,asOf:input.asOf||todayKst()});
 return GROUPS.filter(g=>{
  if(g.category==='academy'&&require('./academy-web.cjs').validSnapshot(e?.academyWeb,{input,identity:e?.identity}))return false;
  if(g.group)return !valid||living.groups[g.group].categories.some(c=>!access.usableRecord(c.batch)&&!c.queries.every(q=>q.checkedAt));
  if(g.category==='shopping')return !require('./shopping.cjs').current(e,input)||!require('./shopping.cjs').dailyCurrent(e,input);
  return !require('./nature-access.cjs').verified(e?.natureAccess,{center:e?.center,asOf:input.asOf||todayKst()})&&!require('./regional-park.cjs').verified(e?.nature,{center:e?.center,asOf:input.asOf||todayKst()});
 });
}
function searchUrl(query){const u=new URL('https://search.naver.com/search.naver');u.searchParams.set('query',query);return u.href;}
function sameSearch(value,query){try{const u=new URL(value);return u.protocol==='https:'&&u.hostname==='search.naver.com'&&!u.port&&!u.username&&!u.password&&u.pathname==='/search.naver'&&u.searchParams.get('query')===query;}catch{return false;}}
function regionPrefix(value,identity){
 const parts=clean(value).split(' '),regions=clean(identity.region).split(' ');
 if(provinceKey(parts[0])!==provinceKey(identity.province)||regions.some((p,index)=>parts[index+1]!==p))return null;
 return parts.slice(0,regions.length+1).join(' ');
}
function addressOf(value,regionLabel,identity){
 let address=clean(value).replace(/^(?:도로명|지번)\s*/,'').replace(/\s*복사\s*$/,'');
 if(provinceKey(address.split(' ')[0])<0){const prefix=regionPrefix(regionLabel,identity);if(!prefix)return null;address=prefix+' '+address;}
 const prefix=regionPrefix(address,identity);if(!prefix)return null;
 const suffix=address.slice(prefix.length).trim();
 return /(?:^|\s)(?:[^\s]+(?:대로|로|길)\s+\d+(?:-\d+)?|[^\s]+(?:동|리|읍|면|가)\s+(?:산\s*)?\d+(?:-\d+)?)(?=\s|$|[,()])/.test(suffix)?address:null;
}
function eligible(category,label){
 const v=clean(label,100);if(!v||/폐업|폐원|휴업|예정|광고/.test(v))return false;
 if(category==='medical')return /소아(?:청소년)?과/.test(v)&&!/한의|동물/.test(v);
 if(category==='academy')return /입시|보습/.test(v)&&/학원|교육/.test(v);
 if(category==='shopping')return /마트|슈퍼|복합쇼핑|백화점|쇼핑센터|쇼핑몰/.test(v)&&!/편의점|입점|판매점/.test(v);
 return category==='nature'&&/공원|수목원|산책로|숲길|등산로|도보여행/.test(v)&&!/아파트|주차|부동산/.test(v);
}
function placeSource(value){
 try{const u=new URL(value);if(u.protocol!=='https:'||u.port||u.username||u.password)return null;let match;
  if(u.hostname==='map.naver.com')match=u.pathname.match(/^\/(?:p|v5)\/(?:entry\/place|search\/.+\/place)\/([1-9]\d{0,19})\/?$/);
  else if(['pcmap.place.naver.com','m.place.naver.com'].includes(u.hostname))match=u.pathname.match(/^\/[a-z-]+\/([1-9]\d{0,19})(?:\/(?:home|location|information))?\/?$/);
  return match?{placeId:match[1],sourceUrl:'https://map.naver.com/p/entry/place/'+match[1]}:null;
 }catch{return null;}
}
function factsFromState(state,{identity,category,query,checkedAt=new Date().toISOString(),qualify=eligible}){
 const time=Date.parse(checkedAt);if(!sameSearch(state?.url,query)||state?.blocked||!Number.isFinite(time)||time>Date.now()||todayKst(new Date(time))!==todayKst()||!identityOf({asset:'apartment',asOf:todayKst()},{buildingResolution:identity}))return [];
 const facts=[],seen=new Set();
 for(const row of Array.isArray(state.rows)?state.rows:[]){
  const name=clean(row?.name,120),label=clean(row?.classification,100);
  if(name.length<2||/폐업|폐원|휴업|예정/.test(name)||!qualify(category,label,name))continue;
  const addresses=[row.address,...(Array.isArray(row.addresses)?row.addresses:[])].map(v=>addressOf(v,row.regionLabel,identity)).filter(Boolean),address=addresses[0];if(!address)continue;
  const key=name+'|'+address;if(seen.has(key))continue;seen.add(key);
  const links=[row.url,...(Array.isArray(row.links)?row.links:[])].map(placeSource).filter(Boolean),ids=[...new Set(links.map(v=>v.placeId))],source=ids.length===1&&(!row.placeId||String(row.placeId)===ids[0])?links[0]:null,sourceUrl=source?.sourceUrl||searchUrl(query);
  facts.push({category,text:name+' · '+label+' · '+address,sourceUrl,checkedAt,distanceBasis:'거리 미산정',sourceId:'naver-place-'+createHash('sha256').update(sourceUrl+'|'+key).digest('hex').slice(0,16),name,classification:label,address,...(source?{placeId:source.placeId}:{}),searchUrl:searchUrl(query)});
 }
 return facts;
}
// Only visible place-card labels and address disclosures are inspected. No
// hydration state, account data, network interception or private API is used.
const STATE=`(()=>{
 const visible=e=>{const s=getComputedStyle(e);return s.display!=='none'&&s.visibility!=='hidden'&&!!e.getClientRects().length;},text=e=>e&&visible(e)?e.innerText.trim():'';
 const cards=[...new Set([...document.querySelectorAll('a.uD1F4,a.U70Fj,a.V_jd4,a.place_bluelink')].filter(visible).map(a=>a.closest('li')).filter(Boolean))],rows=[];
 for(const row of cards){const n=row.querySelector('.q2LdB,.YwYLL,.t3s7S'),c=row.querySelector('.lHBM6,.YzBgS,.wNotu'),lines=text(row).split(/\\n/).map(v=>v.trim()).filter(Boolean),addresses=[];for(let i=0;i<lines.length-1;i++)if(/^(?:도로명|지번)$/.test(lines[i]))addresses.push(lines[i+1]);for(const line of lines)if(/^(?:서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주)[^ ]* .+\\d/.test(line))addresses.push(line);rows.push({name:text(n),classification:text(c),regionLabel:text(row.querySelector('.suKMR'))||lines.find(v=>/^(?:서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주)[^ ]* [^ ]+(?:시|군|구)/.test(v))||'',addresses,placeId:row.getAttribute('data-loc_plc-doc-id')||'',links:[...row.querySelectorAll('a[href]')].filter(visible).map(a=>a.href)});}
 const body=document.body.innerText.slice(0,20000);return {url:location.href,rows,rowCount:cards.length,noResults:/검색 결과가 없습니다|검색결과가 없습니다|조건에 맞는 업체가 없습니다/.test(body),blocked:/비정상적인 접근|자동입력 방지|접근이 제한|보안 확인이 필요|로봇이 아닙니다/.test(body)};
})()`;
function prepare(index){return `(()=>{const visible=e=>{const s=getComputedStyle(e);return s.display!=='none'&&s.visibility!=='hidden'&&!!e.getClientRects().length;},cards=[...new Set([...document.querySelectorAll('a.uD1F4,a.U70Fj,a.V_jd4,a.place_bluelink')].filter(visible).map(a=>a.closest('li')).filter(Boolean))],row=cards[${index}];if(!row)return false;const a=[...row.querySelectorAll('a[role="button"],button')].find(e=>visible(e)&&/상세주소\\s*열기/.test(e.innerText)&&e.getAttribute('aria-expanded')!=='true');if(a){a.click();return true;}return false;})()`;}
function createNaverPublicQueryReader({BrowserWindow,timeoutMs=12000}={}){
 return async function readQuery(query,options){
  const {identity,category,signal,parseFacts=factsFromState}=options,found=new Map();let win,timer,stopped=false,rejectAbort,navigationError;
  const check=()=>{if(signal?.aborted)throw Error('네이버 주변 정보 읽기를 중지했습니다.');if(stopped)throw Error('네이버 주변 정보 페이지 연결 시간이 초과됐습니다.');};
  const aborted=new Promise((_,reject)=>{rejectAbort=reject;}),abort=()=>{rejectAbort(Error('네이버 주변 정보 읽기를 중지했습니다.'));if(win&&!win.isDestroyed())win.destroy();};
  try{
   check();win=new BrowserWindow({show:false,width:1400,height:1100,webPreferences:{partition:'naver-nearby-'+randomUUID(),sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});signal?.addEventListener('abort',abort,{once:true});win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.session.setPermissionRequestHandler((_w,_p,cb)=>cb(false));
   const navigation=(event,target)=>{if(!sameSearch(typeof target==='string'?target:target?.url,query)){event.preventDefault();navigationError=Error('네이버 검색이 다른 페이지로 이동해 주변 정보 읽기를 중단했습니다.');}};win.webContents.on('will-navigate',navigation);win.webContents.on('will-redirect',navigation);
   const deadline=Date.now()+timeoutMs,work=(async()=>{
    try{const ready=new Promise(resolve=>win.webContents.once('dom-ready',resolve));await Promise.race([win.loadURL(searchUrl(query)),ready]);}catch(error){check();throw navigationError||Error('네이버 공개 검색 페이지에 연결하지 못했습니다.');}
    let next=0;
    while(Date.now()<deadline){check();if(navigationError)throw navigationError;const state=await win.webContents.executeJavaScript(STATE);if(!sameSearch(state?.url,query))throw Error('네이버 검색 주소를 확인하지 못했습니다.');if(state.blocked)throw Error('네이버 공개 검색이 접근 확인을 요청해 주변 정보를 읽지 못했습니다.');
     for(const f of parseFacts(state,{identity,category,query}))found.set(f.text,f);
     if(state.noResults||state.rowCount&&next>=state.rowCount)return {facts:[...found.values()],pageLoaded:true,queryStatus:state.noResults?'empty':found.size?'received':'unavailable',issues:found.size?[]:['네이버 '+query+' 검색에서 같은 장소 행의 명칭·분류·전체주소를 확인하지 못했습니다.']};
     if(state.rowCount)await win.webContents.executeJavaScript(prepare(next++));await new Promise(resolve=>setTimeout(resolve,150));
    }
    return {facts:[...found.values()],issues:['네이버 '+query+' 검색의 공개 주소 확인 시간이 초과됐습니다.']};
   })();
   return await Promise.race([work,aborted,new Promise((resolve,reject)=>{timer=setTimeout(()=>{stopped=true;if(found.size)resolve({facts:[...found.values()],queryStatus:'received',pageLoaded:true,issues:['네이버 공개 검색의 표시 목록 일부를 확인했으나 주소 확인 시간이 초과됐습니다.']});else reject(Error('네이버 주변 정보 페이지 연결 시간이 초과됐습니다.'));},timeoutMs);})]);
  }finally{stopped=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);if(win&&!win.isDestroyed())win.destroy();}
 };
}
function createNaverNearbyReader({BrowserWindow,timeoutMs=12000}={}){
 const memo=new Map(),readQuery=createNaverPublicQueryReader({BrowserWindow,timeoutMs});
 return async function read(input,prices,{evidence,signal,forceRefresh=false}={}){
  const identity=identityOf(input,prices);if(!identity)return {status:'unavailable',facts:[],issues:['현재 기준일의 공식 단지·시도·시군구·법정동을 확인하지 못해 네이버 주변 정보를 보완하지 않았습니다.']};
  const groups=needed(evidence,input),facts=[],issues=[],queryCoverage=[];let received=0;
  for(const group of groups){if(signal?.aborted)throw Error('네이버 주변 정보 읽기를 중지했습니다.');const query=[identity.province,identity.region,identity.town,group.query].map(v=>clean(v,120)).join(' '),key=todayKst()+'|'+query;
   try{if(forceRefresh)memo.delete(key);const reused=memo.has(key);if(!reused){const job=readQuery(query,{identity,category:group.category,signal}).catch(error=>{if(signal?.aborted){if(memo.get(key)===job)memo.delete(key);throw error;}return {facts:[],issues:['네이버 '+group.query+': '+error.message]};});memo.set(key,job);}const result=await memo.get(key);facts.push(...result.facts);issues.push(...result.issues);queryCoverage.push({query,category:group.category,returned:result.facts.length,reused,status:result.queryStatus||(result.facts.length?'received':'unavailable'),complete:false,nearestProven:false,emptyProven:false,scope:'현재 표시된 공개 검색 장소행, 전체 페이지·반경 전수·최근접은 미검증'});if(result.facts.length)received++;}
   catch(error){if(signal?.aborted)throw error;issues.push('네이버 '+group.query+': '+error.message);}
  }
  while(memo.size>128)memo.delete(memo.keys().next().value);
  return {status:!groups.length||received===groups.length?'received':facts.length?'partial':'unavailable',facts:structuredClone([...new Map(facts.map(f=>[f.text,f])).values()]),queryCoverage,complete:false,nearestProven:false,emptyProven:false,issues:[...new Set(issues)]};
 };
}
module.exports={createNaverNearbyReader,createNaverPublicQueryReader,factsFromState,addressOf,eligible,needed,searchUrl,placeSource};
