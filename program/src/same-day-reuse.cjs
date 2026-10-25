'use strict';
// Reuse a complete public evidence snapshot, never another customer's prose or
// consultation. New requests keep their own inputs and produce a new report.
const fs=require('node:fs/promises'),path=require('node:path');
const {todayKst,normalize,areaSelection,SCORE_ITEMS}=require('./core.cjs');
const list=r=>r.mode==='comparison'?r.members:[r];
function sameDay(value,day){const time=Date.parse(value);return Number.isFinite(time)&&time<=Date.now()&&todayKst(new Date(time))===day;}
function material(a,b){
 return a.asset==='apartment'&&b.asset===a.asset&&a.asOf===b.asOf&&
  JSON.stringify([...a.types].sort())===JSON.stringify([...b.types].sort())&&
  JSON.stringify(areaSelection(a))===JSON.stringify(areaSelection(b))&&
  (a.offered??null)===(b.offered??null)&&(a.priceBasisMode||'')===(b.priceBasisMode||'');
}
function identityMatches(input,member){
 const i=member.prices?.buildingResolution;
 if(!i?.code||!i.regionCode||!i.town||!i.lot||!i.building||!require('./living-access.cjs').point(i))return false;
 if(input.propertyCode)return String(input.propertyCode)===String(i.code);
 // Without an explicit selected code, require the exact previously resolved
 // regional query and building. Ambiguous matches are rejected by find().
 const query=normalize(input.target);
 return !!input.building&&!!i.region&&query.includes(normalize(i.region))&&query.includes(normalize(i.town))&&query===normalize(member.input.target)&&normalize(input.building)===normalize(member.input.building);
}
function complete(member,input,report,expected){
 const scoring=require('./scoring.cjs'),e=member.assessment?.evidence,i=member.prices?.buildingResolution;
 if(!member.input||!material(input,member.input)||!identityMatches(input,member)||!sameDay(member.dataCheckedAt||report.dataCheckedAt||report.createdAt,input.asOf))return false;
 if(member.input.propertyCode&&String(member.input.propertyCode)!==String(i.code))return false;
 if(expected&&(['code','regionCode','town','lot'].some(k=>String(expected[k])!==String(i[k]))||!require('./living-access.cjs').point(expected)||require('./living-access.cjs').distance(expected,i)>2))return false;
 if(member.assessment?.version!==scoring.VERSION||e?.asOf!==input.asOf||e.identity?.code!==i.code||e.identity?.town!==i.town||String(e.identity?.lot)!==String(i.lot)||!e.center||require('./living-access.cjs').distance(i,e.center)>2)return false;
 if(!Array.isArray(member.prices?.rows)||!member.prices.rows.length||!member.prices.coverage?.length||member.prices.coverage.some(c=>c.status!=='success'))return false;
 if(SCORE_ITEMS.some(name=>{const s=member.scores?.find(s=>s.name===name);return !Number.isInteger(s?.score)||s.score<1||s.score>100||s.status==='withheld'||!s.calculation?.length;}))return false;
 const official=require('./archhub.cjs').verified(member.prices.archhub,{identity:i,asOf:input.asOf}),naver=require('./naver-land.cjs').current(member.prices.naverLand,{identity:i,asOf:input.asOf})?member.prices.naverLand:null;
 const b=official?.basic?.units>0&&official?.basic?.parkingSpaces!=null?official.basic:naver?.basic;if(!Number.isInteger(b?.units)||b.units<=0||!Number.isInteger(b.parkingSpaces)||b.parkingSpaces<0)return false;
 if(!require('./living-access.cjs').current(e,input)||!require('./shopping.cjs').current(e,input)||!require('./shopping.cjs').dailyCurrent(e,input)||!require('./secondary-schools.cjs').current(e,input))return false;
 const nature=require('./nature-access.cjs'),n=e.natureAccess,natureScope={center:e.center,asOf:input.asOf};
 // A verified park can support the natural-environment score even when the
 // completed trail search found no eligible route. Preserve that distinction;
 // available() separately verifies every original search response in this case.
 const noRoute=nature.current(n,natureScope)&&sameDay(n.checkedAt,input.asOf)&&n.status==='unavailable'&&Array.isArray(n.trails)&&!n.trails.length&&!n.warnings?.length&&n.collection?.officialFirst===true;
 if(!(sameDay(n?.checkedAt,input.asOf)&&nature.verified(n,natureScope)||noRoute)||!require('./regional-park.cjs').verified(e.nature,natureScope))return false;
 if(input.types.includes('trade')&&!require('./price-trend.cjs').current(member.trend,input,member.prices))return false;
 try{require('./evidence-guard.cjs').assertVerifiedPrices(member.prices,input);}catch{return false;}
 return true;
}
async function regularFile(file){const stat=await fs.lstat(file);if(!stat.isFile()||stat.isSymbolicLink()||!stat.size)throw Error('Incomplete saved evidence');}
async function available(store,report,inputs,{cache}={}){
 const dir=store.path(report.id),map=report.map;
 if(!require('./map-capture.cjs').isValidatedMap(map)||map.validation.targetCount!==inputs.length)return false;
 try{
  const file=path.join(dir,'figures',path.basename(map.file));await regularFile(file);const png=await fs.readFile(file);
  if(png.length<2048||png.subarray(0,8).toString('hex')!=='89504e470d0a1a0a'||png.readUInt32BE(16)<600||png.readUInt32BE(20)<300)return false;
  for(const [index,input]of inputs.entries()){
   const member=list(report)[index],prefix=report.mode==='comparison'?member.key+'-':'';
   const e=member.assessment.evidence,usesSbiz=(e.places||[]).some(p=>p.provider==='sbiz-csv')||Object.values(e.livingAccess?.groups||{}).some(g=>g.categories?.some(c=>c.nearest?.provider==='sbiz-csv'));
   if(usesSbiz){
    const file=path.join(dir,'raw',prefix+'sbiz-snapshot.json');await regularFile(file);
    const stored=JSON.parse(await fs.readFile(file,'utf8')),snapshot=member.prices.sbizSnapshot,context={center:e.center,identity:member.prices.buildingResolution,asOf:input.asOf};
    const sbiz=require('./sbiz-evidence.cjs'),equal=require('node:util').isDeepStrictEqual;
    if(!sbiz.verified(snapshot,context)||!equal(stored,snapshot)||!equal(e.sbiz,snapshot))return false;
    for(const group of Object.values(e.livingAccess?.groups||{}))for(const category of group.categories||[])if(category.nearest?.provider==='sbiz-csv'&&(!equal(category.publicEvidence,snapshot)||!equal(category.nearest,sbiz.nearest(snapshot,category.key,context))))return false;
    for(const p of e.places||[])if(p.provider==='sbiz-csv'&&!equal(p,sbiz.nearest(snapshot,p.category,context)))return false;
    if(e.dailyShopping?.provider==='sbiz-csv'&&!equal(e.dailyShopping.nearest,sbiz.nearest(snapshot,'supermarket',context)))return false;
   }
   const hospitalCategories=e.livingAccess?.groups?.hospital?.categories||[];
   if(hospitalCategories.some(c=>c.nearest?.provider==='seoul-hospital-register')){
    const file=path.join(dir,'raw',prefix+'hospital-snapshot.json');await regularFile(file);
    const stored=JSON.parse(await fs.readFile(file,'utf8')),snapshot=member.prices.hospitalSnapshot,context={center:e.center,identity:member.prices.buildingResolution,asOf:input.asOf};
    const hospital=require('./public-hospitals.cjs'),equal=require('node:util').isDeepStrictEqual;
    if(!hospital.verified(snapshot,context)||!equal(stored,snapshot)||!equal(e.hospitalSnapshot,snapshot))return false;
    for(const category of hospitalCategories)if(category.nearest?.provider===hospital.PROVIDER&&(!equal(category.hospitalEvidence,snapshot)||!hospital.validCategory(category,context)))return false;
   }
   for(const name of ['query.json',...(input.types.includes('trade')?['RTMS-trade.csv','RTMS-trend-trade.csv','trend-query.json']:[]),...(input.types.some(t=>t==='jeonse'||t==='monthly')?['RTMS-rent.csv']:[])]){const file=path.join(dir,'raw',prefix+name);await regularFile(file);if(name.endsWith('.json')){const query=JSON.parse(await fs.readFile(file,'utf8'));if(!query||typeof query!=='object'||Array.isArray(query)||query.input?.asOf!==input.asOf)return false;}}
   if(member.assessment.evidence.natureAccess?.status==='unavailable'){
    const rules=require('./research-cache.cjs'),nature=require('./nature-access.cjs'),center=member.assessment.evidence.center,s=rules.scope(input,member.prices);
    for(const query of nature.QUERIES){const t=await cache?.get(s,'search_by_nearby_keyword',{query,center_lat:center.lat,center_lng:center.lng,radius_m:nature.RADIUS}),d=rules.data(t);if(!t||rules.toolError(t)||d?.query!==query||!Array.isArray(d.results)||!sameDay(d.metadata?.collected_at,input.asOf)||d.radius_m!==nature.RADIUS||!d.center||require('./living-access.cjs').distance(center,d.center)>2||d.metadata.truncated||d.metadata.has_more||d.pagination?.has_more)return false;}
   }
  }
  return true;
 }catch{return false;}
}
async function find(service,input,{force=false,signal,identities=[]}={}){
 if(force||input.forceRefresh||/최신|새로\s*조회|재조회/.test(input.request||''))return null;
 const inputs=input.mode==='comparison'?input.properties:[input],day=todayKst();
 if(!inputs.length||inputs.some(p=>p.reportId||p.asOf!==day||p.asset!=='apartment'))return null;
 const matches=[];
 for(const item of await service.store.list()){
  if(signal?.aborted)throw Error('분석을 중지했습니다.');
  if(item.demo||!sameDay(item.createdAt,day)||item.asOf!==day)continue;
  let report;try{
   report=await service.store.load(item.id);const members=list(report);
   if(report.demo||!sameDay(report.createdAt,day)||!Array.isArray(members)||members.length!==inputs.length||members.some((m,i)=>!complete(m,inputs[i],report,identities[i]))||!await available(service.store,report,inputs,{cache:service.researchCache}))continue;
   let changed=false;
   if(service.naverStore)for(const m of members){const current=await service.naverStore.forIdentity(m.input,m.prices);if(current&&!require('node:util').isDeepStrictEqual(require('./naver-land.cjs').normalize(current),require('./naver-land.cjs').normalize(m.prices.naverLand))){changed=true;break;}}
   if(changed)continue;
  }catch{continue;}
  matches.push(report);
 }
 if(!matches.length)return null;
 // A text-only query must not silently select one of two physical complexes.
 const signature=r=>JSON.stringify(list(r).map(m=>{const i=m.prices.buildingResolution;return [String(i.code),i.regionCode,i.town,String(i.lot),i.lat,i.lng];}));
 if(new Set(matches.map(signature)).size!==1)return null;
 return matches[0];
}
function provenance(report){return report?{sourceReportId:report.id,sourceCreatedAt:report.createdAt,asOf:report.input.asOf,kind:'verified-same-day-evidence'}:null;}
async function currentQueries(directory,prefix,input){
 // Query provenance may contain the former customer's input. Keep public
 // collection parameters, but write only the new request into the new folder.
 for(const name of ['query.json','trend-query.json']){
  const file=path.join(directory,'raw',prefix+name);let old;try{old=JSON.parse(await fs.readFile(file,'utf8'));}catch(e){if(e.code==='ENOENT')continue;throw e;}
  const keep=Object.fromEntries(['version','period','identity','coverage','forms','catalog','selectedProperty','excluded'].filter(k=>Object.hasOwn(old,k)).map(k=>[k,old[k]]));
  await fs.writeFile(file,JSON.stringify({...keep,input:require('./prompt.cjs').analysisInput(input)},null,2));
 }
}
module.exports={find,material,identityMatches,complete,available,provenance,currentQueries};
