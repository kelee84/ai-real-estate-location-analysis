'use strict';
// Public, displayed academy listings. Search order is never a distance rank.
const {createHash}=require('node:crypto');
const {todayKst}=require('./core.cjs');
const {createNaverPublicQueryReader,factsFromState,addressOf,searchUrl,placeSource}=require('./naver-nearby.cjs');
const SUBJECTS=Object.freeze([
 {key:'entrance',label:'입시·보습',query:'입시학원'},
 {key:'korean',label:'국어',query:'국어학원'},
 {key:'english',label:'영어',query:'영어학원'},
 {key:'math',label:'수학',query:'수학학원'},
 {key:'art',label:'미술',query:'미술학원'},
 {key:'music',label:'음악',query:'음악학원'},
 {key:'sports',label:'체육',query:'태권도장'}
].map(Object.freeze));
const KEYS=SUBJECTS.map(s=>s.key),SCOPE='네이버 공개 검색에 현재 표시된 학원·교육시설. 전체 시설·반경 전수·최근접·실제 거리·현재 운영·수업의 질·실적은 확인하지 않았습니다.';
const clean=(value,max=400)=>typeof value==='string'?value.normalize('NFKC').replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,max):'';
const hash=value=>createHash('sha256').update(value).digest('hex').slice(0,24);
function identityOf(input,identity,{live=true}={}){
 const day=input?.asOf||todayKst(),date=/^\d{4}-\d{2}-\d{2}$/.test(day)?new Date(day+'T00:00:00Z'):null;
 if(input?.asset!=='apartment'||!date||!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==day||day>todayKst()||live&&day!==todayKst()||!identity?.code||!/^\d{5}$/.test(String(identity.regionCode||'')))return null;
 if(['building','province','region','town','lot'].some(k=>!clean(identity[k],120)))return null;
 if(!addressOf(identity.province+' '+identity.region+' '+identity.town+' '+identity.lot,'',identity))return null;
 return identity;
}
function identityKey(identity){return hash(['code','regionCode','province','region','town','lot'].map(k=>clean(String(identity[k]||''),120)).join('|'));}
function queryFor(identity,subject,scope='town'){return [identity.province,identity.region,...(scope==='town'?[identity.town]:[]),subject.query].map(v=>clean(v,120)).join(' ');}
function subjectsFor(name,classification){
 const n=clean(name,120),c=clean(classification,100),text=c+' '+n;
 if(!n||!c||/폐업|폐원|휴업|예정|광고|판매|용품|부동산|대학교|직업전문|운전학원|성인회화|독서실|스터디카페/.test(text))return [];
 const educational=/학원|교습|교육|입시|보습/.test(c),subjects=text.replace(/학원|교습소|교육원/g,' '),out=[];
 if(educational&&/입시|보습/.test(subjects))out.push('entrance');
 for(const [key,pattern]of [['korean',/국어/],['english',/영어/],['math',/수학/],['art',/미술/],['music',/음악|피아노|바이올린|실용음악|첼로|기타교습/]])if(educational&&pattern.test(subjects))out.push(key);
 if(/(?:체육|스포츠|태권도|검도|유도|합기도)/.test(text)&&/학원|교육|교습|체육|스포츠|태권도|검도|유도|합기도/.test(c))out.push('sports');
 return out;
}
function placesFromState(state,{identity,query,subject,checkedAt}){
 if(!SUBJECTS.some(s=>s.key===subject))return [];
 const facts=factsFromState(state,{identity,category:'academy',query,checkedAt,qualify:(_category,label,name)=>subjectsFor(name,label).length>0});
 return facts.map(f=>{
  const id='academy-naver-'+(f.placeId||hash(f.name+'|'+f.address));
  return {id,sourceId:id,name:f.name,subjectKeys:subjectsFor(f.name,f.classification),classification:f.classification,address:f.address,sourceUrl:f.sourceUrl,searchUrls:[searchUrl(query)],checkedAt:f.checkedAt,...(f.placeId?{placeId:f.placeId}:{}),text:f.text};
 });
}
function currentTime(value,asOf){const time=typeof value==='string'?Date.parse(value):NaN;return Number.isFinite(time)&&time<=Date.now()&&todayKst(new Date(time))===asOf;}
function validSnapshot(value,{input,identity}={}){
 const i=identityOf(input,value?.identity,{live:false}),asOf=input?.asOf||todayKst();
 if(!identity||['code','building','regionCode','town','lot'].some(k=>!clean(String(identity[k]||''),120)||clean(String(identity[k]),120)!==clean(String(i?.[k]||''),120))||['province','region'].some(k=>identity[k]&&clean(identity[k],120)!==clean(i?.[k],120)))return false;
 if(!i||!value||value.version!==1||value.provider!=='naver-public-search'||value.identityCode!==String(i.code)||value.identityKey!==identityKey(i)||value.asOf!==asOf||value.complete!==false||value.nearestProven!==false||value.emptyProven!==false||value.coordinateVerified!==false||!Array.isArray(value.places)||!Array.isArray(value.queries)||!['received','partial','unavailable'].includes(value.status))return false;
 const queries=new Map();
 for(const q of value.queries){
  const subject=SUBJECTS.find(s=>s.key===q?.key);
  if(!subject||!['town','district'].includes(q.scope)||q.query!==queryFor(i,subject,q.scope)||q.sourceUrl!==searchUrl(q.query)||!currentTime(q.checkedAt,asOf)||!['received','empty','unavailable'].includes(q.status)||!Array.isArray(q.issues)||q.complete!==false||q.nearestProven!==false||q.emptyProven!==false||queries.has(q.query))return false;
  queries.set(q.query,q);
 }
 if(SUBJECTS.some(s=>!value.queries.some(q=>q.key===s.key&&q.scope==='town')))return false;
 const ids=new Set();
 for(const p of value.places){
  if(!p||p.name!==clean(p.name,120)||p.classification!==clean(p.classification,100)||p.address!==addressOf(p.address,'',i)||!currentTime(p.checkedAt,asOf)||!Array.isArray(p.subjectKeys)||!p.subjectKeys.length||p.subjectKeys.some(k=>!KEYS.includes(k)||!subjectsFor(p.name,p.classification).includes(k))||new Set(p.subjectKeys).size!==p.subjectKeys.length||'lat'in p||'lng'in p||'distanceM'in p)return false;
  const source=placeSource(p.sourceUrl),query=[...queries.values()].find(q=>q.sourceUrl===p.sourceUrl);
  if(source){if(source.sourceUrl!==p.sourceUrl||p.placeId!==source.placeId||p.id!=='academy-naver-'+source.placeId)return false;}
  else if(!query||query.status!=='received'||p.placeId||p.id!=='academy-naver-'+hash(p.name+'|'+p.address))return false;
  if(p.sourceId!==p.id||ids.has(p.id)||!Array.isArray(p.searchUrls)||!p.searchUrls.length||p.searchUrls.some(url=>![...queries.values()].some(q=>q.sourceUrl===url&&q.status==='received')))return false;
  ids.add(p.id);
 }
 return true;
}
function createAcademyWebReader({BrowserWindow,timeoutMs=12000}={}){
 const memo=new Map(),readQuery=createNaverPublicQueryReader({BrowserWindow,timeoutMs});
 return async function read(input,prices,{signal,forceRefresh=false}={}){
  const identity=identityOf(input,prices?.buildingResolution),asOf=input?.asOf||todayKst(),proof=identity?Object.fromEntries(['code','building','province','region','regionCode','town','lot'].map(k=>[k,clean(String(identity[k]),120)])):null,base={version:1,provider:'naver-public-search',identityCode:String(identity?.code||''),identityKey:identity?identityKey(identity):'',identity:proof,asOf,status:'unavailable',places:[],queries:[],complete:false,nearestProven:false,emptyProven:false,coordinateVerified:false,scope:SCOPE,issues:[]};
  if(!identity)return {...base,issues:['현재 기준일의 공식 단지·시도·시군구·법정동·지번이 없어 학원 공개 검색을 진행하지 못했습니다.']};
  const found=new Map();
  for(const subject of SUBJECTS){
   let confirmed=false;
   for(const scope of ['town','district']){
    if(confirmed)break;if(signal?.aborted)throw Error('학원 공개 정보 읽기를 중지했습니다.');
    const query=queryFor(identity,subject,scope),key=asOf+'|'+query;
    if(forceRefresh)memo.delete(key);const reused=memo.has(key);
    if(!reused){
     const job=readQuery(query,{identity,category:'academy',signal,parseFacts:(state,options)=>placesFromState(state,{...options,subject:subject.key})}).catch(error=>{if(signal?.aborted){if(memo.get(key)===job)memo.delete(key);throw error;}return {facts:[],queryStatus:'unavailable',issues:[error.message]};}).then(result=>({...result,checkedAt:new Date().toISOString()}));memo.set(key,job);
    }
    const result=await memo.get(key),checkedAt=result.checkedAt,status=result.queryStatus||(result.facts.length?'received':'unavailable'),issues=[...new Set(result.issues?.length?result.issues:result.facts.length?[]:[subject.label+' 분야의 명칭·분류·전체주소를 함께 확인하지 못했습니다.'])];
    base.queries.push({key:subject.key,query,status,sourceUrl:searchUrl(query),checkedAt,scope,reused,issues,complete:false,nearestProven:false,emptyProven:false});
    for(const {text,...p}of result.facts){
     const existing=found.get(p.id);if(existing){existing.classification=clean([...new Set([existing.classification,p.classification])].join(' · '),100);existing.subjectKeys=KEYS.filter(k=>(existing.subjectKeys.includes(k)||p.subjectKeys.includes(k))&&subjectsFor(existing.name,existing.classification).includes(k));existing.searchUrls=[...new Set([...existing.searchUrls,...p.searchUrls])];}else found.set(p.id,structuredClone(p));
    }
    confirmed=result.facts.some(p=>p.subjectKeys.includes(subject.key));
    // A verification/captcha or connection failure is not a reason to try more
    // pages for the same subject. Only a normally loaded result may broaden.
    if(status==='unavailable'&&!result.pageLoaded)break;
   }
  }
  while(memo.size>128)memo.delete(memo.keys().next().value);
  // The same visible listing can explicitly confirm more than one subject.
  // Its observed source searches stay attached even if another search fails.
  base.places=[...found.values()].filter(p=>p.subjectKeys.length);
  const all=SUBJECTS.every(s=>base.places.some(p=>p.subjectKeys.includes(s.key)));base.status=all?'received':base.places.length?'partial':'unavailable';
  base.issues=SUBJECTS.filter(s=>!base.places.some(p=>p.subjectKeys.includes(s.key))).map(s=>s.label+': 공개 검색에서 분류와 전체주소를 함께 확인하지 못해 판단을 보류했습니다.');
  return structuredClone(base);
 };
}
module.exports={SUBJECTS,createAcademyWebReader,placesFromState,subjectsFor,validSnapshot};
