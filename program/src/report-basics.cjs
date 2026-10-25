'use strict';
// Public complex facts are a presentation supplement, never a historical
// transaction/scoring update. Bind the sidecar to the exact saved report bytes.
const fs=require('node:fs/promises'),path=require('node:path'),{createHash,randomUUID}=require('node:crypto');
const {todayKst,validDate}=require('./core.cjs'),naver=require('./naver-land.cjs');
const identityRules=require('./property-identity.cjs'),access=require('./living-access.cjs');
const VERSION='2026-10-21-naver-basic-snapshot-v1',MAX_BYTES=1024*1024;
const members=report=>report.members||report.comparisonMembers||[report];
const digest=value=>createHash('sha256').update(value).digest('hex');
function identityKey(member){
 const i=member.prices?.buildingResolution;
 if(!i?.code||!i.building||!i.province||!i.region||!i.town||!i.lot||!/^\d{5}$/.test(String(i.regionCode||'')))return null;
 return digest(JSON.stringify([String(i.code),String(i.regionCode),i.province,i.region,i.town,String(i.lot),i.building,access.point(i)]));
}
function day(value){if(validDate(value))return value;if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value))return null;const time=Date.parse(value);return Number.isFinite(time)&&time<=Date.now()?todayKst(new Date(time)):null;}
function verified(member,value,asOf){
 try{
  if(!identityKey(member)||!validDate(asOf)||asOf>todayKst())return null;
  const record=naver.normalize(value),i=member.prices.buildingResolution;
  if(day(record.checkedAt)!==asOf||!identityRules.matchesKaptIdentity(i,{name:record.name,addressJibun:record.addressJibun,addressRoad:record.addressRoad}))return null;
  if(access.point(i)&&access.point(record)&&access.distance(i,record)>100)return null;
  // Do not persist public prose, routes, customer data, credentials, or scores.
  const {publicFacts,...basic}=record;return basic;
 }catch{return null;}
}
function snapshotRecord(member){
 const snapshot=member.basicSnapshot;
 const checked=day(snapshot?.record?.checkedAt),asOf=member.input?.asOf;
 if(snapshot?.version!==VERSION||snapshot.identityKey!==identityKey(member)||!validDate(asOf)||!checked||checked<asOf||checked>todayKst())return null;
 if(checked!==todayKst()&&snapshot.status!=='last-confirmed')return null;
 return verified(member,snapshot.record,checked);
}
function originalNaver(member){
 return [member.prices?.naverLand,member.assessment?.evidence?.naverLand].map(value=>verified(member,value,member.input?.asOf)).filter(Boolean).sort((a,b)=>Date.parse(b.checkedAt)-Date.parse(a.checkedAt))[0]||null;
}
function makeSnapshot(member,value,{allowLastConfirmed=false}={}){
 const checked=day(value?.checkedAt),asOf=member.input?.asOf;
 if(!validDate(asOf)||!checked||checked<asOf||checked>todayKst()||checked!==todayKst()&&!allowLastConfirmed)return null;
 const record=verified(member,value,checked);return record?{version:VERSION,identityKey:identityKey(member),status:checked===todayKst()?'current':'last-confirmed',record}:null;
}
function needsSupplement(member){
 if(member.demo||member.input?.asset!=='apartment'||!identityKey(member))return false;
 // A last-confirmed fallback is display-only. It never satisfies today's
 // cache/lookup check, so a later successful lookup can replace it.
 if(member.basicSnapshot?.status==='last-confirmed')member={...member,basicSnapshot:undefined};
 // Use the exact same fact validation as all five report exports.
 const facts=require('./apartment-overview.cjs').data(member).properties[0]?.facts;
 return !Number.isSafeInteger(facts?.units)||facts.units<=0||facts.parking?.total==null||!!(require('./archhub.cjs').snapshot(member)||require('./archhub.cjs').original(member))&&!facts.approval;
}
async function readSidecar(file,{reportId,sourceReportSha256}){
 try{const stat=await fs.stat(file);if(!stat.isFile()||stat.size>MAX_BYTES)return null;const value=JSON.parse(await fs.readFile(file,'utf8')),checked=day(value.checkedAt);return value.version===VERSION&&value.reportId===reportId&&value.sourceReportSha256===sourceReportSha256&&checked&&checked<=todayKst()&&Array.isArray(value.members)?value:null;}catch{return null;}
}
async function presentationReport(service,id){
 service.basicPresentations??=new Map();
 if(service.basicPresentations.has(id))return service.basicPresentations.get(id).then(structuredClone);
 const work=(async()=>{
  const directory=service.store.path(id),raw=await fs.readFile(path.join(directory,'report.json')),sourceReportSha256=digest(raw),report=structuredClone(await service.store.load(id)),file=path.join(directory,'raw','report-basics.json');
  const saved=await readSidecar(file,{reportId:id,sourceReportSha256}),targets=members(report),fallbacks=new Map(),arch=require('./archhub.cjs');
  for(const member of targets){
   // A report's existing arbitrary basicSnapshot is not trusted. Only the
   // identity- and source-hash-bound sidecar can supply this projection.
   delete member.basicSnapshot;
   delete member.archhubSnapshot;
   const a=saved?.archhubMembers?.find(v=>v.identityKey===arch.identityKey(member.prices?.buildingResolution));
   if(a&&arch.snapshot({...member,archhubSnapshot:a}))member.archhubSnapshot=a;
   const cached=saved?.members.find(value=>value.identityKey===identityKey(member));
   if(cached){const snapshot=makeSnapshot(member,cached.record,{allowLastConfirmed:true});if(snapshot?.status==='current')member.basicSnapshot=snapshot;else if(snapshot)fallbacks.set(identityKey(member),snapshot);}
  }
  await Promise.all(targets.map(async member=>{
   if(service.archhubStore&&!member.demo&&member.input?.asset==='apartment'&&identityKey(member)&&arch.day((arch.snapshot(member)||arch.original(member))?.checkedAt)!==todayKst()){
    const prices={buildingResolution:structuredClone(member.prices.buildingResolution)};
    await service.reuseArchhub({...member.input,asOf:todayKst()},prices);
    if(prices.archhub)member.archhubSnapshot={version:arch.VERSION,identityKey:arch.identityKey(prices.buildingResolution),record:prices.archhub};
   }
   if(!needsSupplement(member))return;
   const input={...member.input,asOf:todayKst()},prices={buildingResolution:structuredClone(member.prices.buildingResolution)};
   try{
    await service.reuseNaverLand(input,prices,{onProgress:message=>service.onEvent?.({stage:'naver-basics',message,reportId:id})});
    const snapshot=makeSnapshot(member,prices.naverLand);if(snapshot)member.basicSnapshot=snapshot;
   }catch{/* A failed supplemental lookup leaves every original fact intact. */}
   if(needsSupplement(member)){
    const fallback=fallbacks.get(identityKey(member));
    if(fallback){
     // A partial response must not erase a previously complete verified
     // source. Keep that source as a whole; never mix its denominator with
     // today's partial parking count, or claim it was verified today.
     const prior={...member,basicSnapshot:fallback},facts=require('./apartment-overview.cjs').data(prior).properties[0]?.facts;
     if(facts?.units>0&&facts.parking?.total!=null)member.basicSnapshot=fallback;
    }
   }
  }));
  const snapshots=targets.map(member=>member.basicSnapshot).filter(Boolean),archhubMembers=targets.map(m=>m.archhubSnapshot).filter(Boolean);
  if(snapshots.length||archhubMembers.length){
   // Do not attach a supplement to a source which changed during its lookup.
   if(digest(await fs.readFile(path.join(directory,'report.json')))!==sourceReportSha256)return presentationReportUncached(service,id);
   const sidecar={version:VERSION,reportId:id,sourceReportSha256,checkedAt:new Date().toISOString(),members:snapshots,...(archhubMembers.length?{archhubMembers}:{})};
   await fs.mkdir(path.dirname(file),{recursive:true});const temp=file+'.'+randomUUID()+'.tmp';
   try{await fs.writeFile(temp,JSON.stringify(sidecar,null,2),'utf8');await fs.rename(temp,file);}finally{await fs.rm(temp,{force:true}).catch(()=>{});}
  }
  return require('./scoring.cjs').prepareReport(report);
 })();
 service.basicPresentations.set(id,work);
 try{return structuredClone(await work);}finally{if(service.basicPresentations.get(id)===work)service.basicPresentations.delete(id);}
}
async function presentationReportUncached(service,id){return require('./scoring.cjs').prepareReport(await service.store.load(id));}
module.exports={VERSION,day,identityKey,verified,originalNaver,snapshotRecord,makeSnapshot,needsSupplement,presentationReport};
