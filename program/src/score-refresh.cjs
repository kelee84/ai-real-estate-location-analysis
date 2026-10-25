'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {todayKst}=require('./core.cjs'),scoring=require('./scoring.cjs');
const {identityEvidence,copyPreserved,removeGenerated}=require('./map-repair.cjs');
const NAMES=['상권 환경','병원 환경','학원 환경'],VERSION='2026-10-18-living-score-refresh-v2';
async function refreshScores(service,reportId,{collect=require('./research.cjs').collectResearch}={}){
 if(service.active)throw new Error('진행 중인 작업이 끝난 뒤 점수를 다시 확인해 주세요.');
 const controller=new AbortController(),activity={kind:'score-refresh',reportId,controller};service.active=activity;service.academyWebLookups=new Map();let id,saved=false;
 const check=()=>{if(controller.signal.aborted)throw new Error('점수 확인을 중지했습니다.');};
 try{
  const original=await service.store.load(reportId),report=structuredClone(original);check();
  const members=report.mode==='comparison'?report.members:[report];
  if(original.id!==reportId||original.demo||!members?.length||members.length>3||members.some(m=>m.input?.asset!=='apartment'))throw new Error('보관된 실제 아파트 보고서에서 점수를 확인해 주세요.');
  if(members.some(m=>m.input.asOf!==todayKst()))throw new Error('과거 기준일에 현재 시설 정보를 적용할 수 없습니다. 오늘 날짜로 새 분석을 만들어 주세요.');
  for(const m of members)identityEvidence(m);
  id=randomUUID();const directory=service.store.path(id);await fs.mkdir(path.join(directory,'raw'),{recursive:true});await fs.mkdir(path.join(directory,'figures'),{recursive:true});
  const copied=await copyPreserved(service.store,reportId,id),results=[];
  for(const [i,m]of members.entries()){
   check();const prefix=report.mode==='comparison'?String.fromCharCode(65+i)+'-':'',raw=[];
   try{raw.push({deal:'trade',bytes:(await fs.readFile(path.join(directory,'raw',prefix+'RTMS-trade.csv'))).toString('base64')});}catch(e){if(e.code!=='ENOENT')throw e;}
   const prices=structuredClone(m.prices),previous=m.assessment?.evidence;if(!previous)throw new Error('보관된 평가 근거가 없습니다. 단지를 다시 분석해 주세요.');
   if(prices.academyWeb)await fs.writeFile(path.join(directory,'raw',prefix+'academy-web.json'),JSON.stringify(prices.academyWeb,null,2));
   service.onEvent?.({stage:'research',message:(m.key?m.key+' · ':'')+'대형마트·병원·학원 접근 자료를 확인하고 있습니다.'});
   const researchEngine=require('./research.cjs'),research=await collect(service.bridge,m.input,prices,{previous,raw,cache:service.researchCache,forceRefresh:true,signal:controller.signal,onlyScores:true,includeMap:false,onProgress:message=>service.onEvent?.({stage:'research',message})});check();
   const fresh=scoring.collectEvidence({input:m.input,prices,tools:research.tools,livingAccess:research.livingAccess}),evidence=researchEngine.mergeLivingEvidence(previous,fresh),preserved=[];
   // A transient failed lookup must not erase a complete, same-day proof. Keep
   // its whole snapshot, including the source dates and category scope.
   if(!fresh.livingAccess&&evidence.livingAccess)preserved.push({name:'livingAccess',reason:'새 의료·학원 조회 근거가 없어 같은 기준일의 검증된 자료를 유지했습니다.',lookupIssues:research.issues||[]});
   for(const group of Object.values(evidence.livingAccess?.groups||{}))for(const category of group.categories||[])if(category.lookupReason)preserved.push({name:category.label,reason:category.lookupReason,lookupIssues:research.issues||[]});
   for(const [field,moduleName]of [['shopping','shopping']]){
    const api=require('./'+moduleName+'.cjs');if(api.current(previous,m.input)&&(!fresh[field]||!api.current({...evidence,[field]:fresh[field]},m.input))){evidence[field]=structuredClone(previous[field]);preserved.push({name:field,reason:'일부 재조회 미완료로 같은 기준일의 완전한 기존 근거를 유지했습니다.',lookupIssues:research.issues||[]});if(field==='shopping')evidence.places=[...evidence.places.filter(p=>!['shopping_large','mart_large'].includes(p.category)),...(previous.places||[]).filter(p=>['shopping_large','mart_large'].includes(p.category))].sort((a,b)=>a.distanceM-b.distanceM);}
   }
   const before=structuredClone(m.scores||[]),beforeVersion=m.assessment?.version,assessed=scoring.assessScores({scores:[]},{input:m.input,prices,previousEvidence:evidence,dataCheckedAt:m.dataCheckedAt}),scores=assessed.scores;
   m.prices=prices;m.scores=scores;m.assessment=assessed.assessment;m.sources=[...new Map([...(m.sources||[]),...assessed.sources].map(s=>[s.id,s])).values()];
   const result={key:m.key||'A',before,after:scores,changedRubric:beforeVersion!==m.assessment.version,preserved,checks:research.checks||[],issues:research.issues||[],metrics:research.metrics};results.push(result);
   await fs.writeFile(path.join(directory,'raw',prefix+'score-evidence.json'),JSON.stringify(m.assessment,null,2));
   for(const [file,field]of [['living-access.json','livingAccess'],['shopping-evidence.json','shopping'],['nearby-context.json','nearbyContext']])await fs.writeFile(path.join(directory,'raw',prefix+file),JSON.stringify(m.assessment.evidence[field]||{},null,2));
   await fs.writeFile(path.join(directory,'raw',prefix+'score-refresh-research.json'),JSON.stringify({tools:research.tools,checks:result.checks,issues:result.issues},null,2));
  }
  check();const checkedAt=new Date().toISOString(),refresh={version:VERSION,sourceReportId:reportId,checkedAt,aiCalls:0,preserved:copied,results};
  Object.assign(report,{id,title:String(original.title).replace(/ · 점수 보완$/,'')+' · 점수 보완',createdAt:checkedAt,revisionOf:reportId,requestFingerprint:null,scoreRefresh:refresh});
  report.verification={...report.verification,scoreRefresh:'대형마트·병원·학원 접근 자료를 확인하고 실구매자용 6개 항목으로 평가했습니다. 원본·거래 금액·지도·상담 내용은 보존했습니다. 학교·자연공간의 기존 기준일과 조회 근거를 유지했습니다.',scoreCheckedAt:checkedAt};
  await fs.writeFile(path.join(directory,'raw','score-refresh.json'),JSON.stringify(refresh,null,2));check();
  const out=await service.store.save(report);saved=true;service.onEvent?.({stage:'done',message:'점수를 확인한 새 보고서를 보관했습니다.',reportId:id});return out;
 }finally{try{if(id&&!saved)await removeGenerated(service.store,id,reportId);}finally{if(service.active===activity)service.active=null;}}
}
module.exports={VERSION,refreshScores,NAMES};
