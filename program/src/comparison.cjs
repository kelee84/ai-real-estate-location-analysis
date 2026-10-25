'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {normalizeInput,normalize,aggregate,validateReport,SCORE_ITEMS,clean}=require('./core.cjs');
const {INSTRUCTIONS,compactPrices,fingerprint,analysisInput,qualityIssues}=require('./prompt.cjs');
const consultation=require('./consultation.cjs');
const {reportSchema}=require('./schema.cjs');
const {isValidatedMap}=require('./map-capture.cjs');
const comparisonSchema={...reportSchema,properties:{...reportSchema.properties,methodology:{type:'string'},members:{type:'array',minItems:2,maxItems:3,items:{type:'object',additionalProperties:false,properties:{key:{type:'string'},strengths:{type:'array',items:{type:'string'}},limitations:{type:'array',items:{type:'string'}},scores:reportSchema.properties.scores},required:['key','strengths','limitations','scores']}}},required:[...reportSchema.required,'methodology','members']};
function normalizeComparison(raw){
  if(!Array.isArray(raw.properties)||raw.properties.length<2||raw.properties.length>3)throw new Error('비교할 매물은 2개 또는 3개를 등록해 주세요.');
  const shared=normalizeInput({target:'비교 분석',types:raw.types,asOf:raw.asOf,request:raw.request,office:raw.office,officeProfile:raw.officeProfile,customer:raw.customer});
  const properties=raw.properties.map(p=>{
    if(!p||typeof p!=='object')throw new Error('비교 매물 입력을 확인해 주세요.');
    if(p.reportId){if(!/^[0-9a-f-]{36}$/.test(p.reportId))throw new Error('기존 보고서를 다시 선택해 주세요.');return {reportId:p.reportId};}
    require('./property-identity.cjs').assertPropertyInput(p);
    return normalizeInput({...p,types:shared.types,asOf:shared.asOf,request:shared.request,office:shared.office,officeProfile:shared.officeProfile,customer:shared.customer});
  });
  return {mode:'comparison',properties,request:shared.request,office:shared.office,officeProfile:shared.officeProfile,customer:shared.customer,asOf:shared.asOf,types:shared.types};
}
function comparisonWarnings(members){
  return require('./comparison-basis.cjs').warnings(members);
}
async function copyEvidence(service,from,to,prefix){
  const copied=[];
  for(const name of ['RTMS-trade.csv','RTMS-rent.csv','query.json','naver-land.json','score-evidence.json','living-access.json','shopping-evidence.json','school-achievement.json'])try{await fs.copyFile(path.join(from,'raw',name),path.join(to,'raw',prefix+name));copied.push(prefix+name);}catch(e){if(e.code!=='ENOENT')throw e;}
  return copied;
}
function compactPreviousScore(score){
  const pick=(value,keys)=>Object.fromEntries(keys.filter(key=>value&&Object.hasOwn(value,key)).map(key=>[key,structuredClone(value[key])]));
  const out=pick(score,['name','score','reason','method','sourceIds','status','scope','coverage','observed','needed','calculation','regionalPark','landmarkPark','parkSizeRatio','warnings','missing','limitations','asOf','checkedAt']);
  if(Array.isArray(score.accessCategories))out.accessCategories=score.accessCategories.map(category=>{
    const item=pick(category,['key','label','weight','radiusM','status','complete','limited','points','reason','needed','queries','batch','sourceDate']);
    if(category.nearest)item.nearest=pick(category.nearest,['id','provider','category','name','kakao_category_name','lat','lng','address','distanceM','distanceBasis','sourceId','url','sourceDate','checkedAt','downloadedAt']);
    // Full public-register groups, manifests and raw row proofs remain in the
    // saved evidence. The prompt needs the selected facility and provenance,
    // not another copy of every facility in the underlying register.
    if(category.publicEvidence)item.publicEvidence=pick(category.publicEvidence,['version','provider','asOf','checkedAt','sourceDate','downloadedAt','sourceUrl','downloadUrl','identity','center','scope']);
    return item;
  });
  return out;
}
function compactComparisonInput(body,members){
  const out=structuredClone(body);
  for(const [i,m]of members.entries()){
    // Match the single-report prompt: send validated facts and their citations,
    // not raw lookup candidates, route payloads and duplicate HTML metadata.
    out.members[i].naverNearby=require('./naver-supplement.cjs').sections({input:m.input,prices:m.prices,assessment:{evidence:m.scoreEvidence}}).map(s=>({heading:s.heading,facts:s.facts.map(f=>({text:f.text,sourceUrl:f.sourceUrl,checkedAt:f.checkedAt})),sources:s.sources}));
    const nearby=m.prices.naverNearby;
    if(nearby)out.members[i].naverNearbyState=Object.fromEntries(['status','checkedAt','asOf','reason','issues'].filter(key=>Object.hasOwn(nearby,key)).map(key=>[key,structuredClone(nearby[key])]));
  }
  return out;
}
async function runComparison(service,raw,{revisionId,force=false}={}){
  if(service.active)throw new Error('분석 중인 보고서가 있습니다. 완료 후 다시 시작해 주세요.');
  const catalogs=new Map();
  if(!revisionId)for(const [i,p]of (raw.properties||[]).entries())if(p.selectedAreas?.length){catalogs.set(i,service.validateTypeSelection(p));if(require('./type-selection.cjs').areaClusters(p.selectedAreas).length>1)throw new Error('비교 대상의 선택 타입 차이가 2평 이상입니다. 먼저 매물 1개 분석에서 타입별 보고서를 만든 뒤 보관한 보고서로 비교해 주세요.');}
  const controller=new AbortController();service.active={controller};
  const check=()=>{if(controller.signal.aborted)throw new Error('분석을 중지했습니다.');};
  try{
    let previous=revisionId?await service.store.load(revisionId):null,automaticReuse=null;
    if(previous&&previous.mode!=='comparison')throw new Error('통합 비교 보고서를 선택해 주세요.');
    const snapshot=previous?consultation.getConsultation(previous):null;
    const input=normalizeComparison({...raw,customer:raw.customer??snapshot?.customer,office:previous?snapshot.officeProfile.name:service.settings.office,officeProfile:previous?snapshot.officeProfile:service.settings.officeProfile});
    for(const [i,catalog]of catalogs){input.properties[i].building=catalog.building||input.properties[i].building;if(catalog.identity?.code)input.properties[i].propertyCode=catalog.identity.code;}
    service.onEvent({stage:'connection',message:'비교 대상과 사용량을 확인하고 있습니다.'});
    const status=await service.status();check();if(!status.loggedIn)throw new Error(status.error||service.connectionRequired());
    const selected=await service.chooseModel(status.models),key=fingerprint(input,selected.model,status.mapConnected,service.settings.provider);
    if(!revisionId&&!force&&!raw.forceRefresh){const cached=await service.recentReport(key);if(cached)return {...cached,reused:true};}
    if(!previous){previous=await require('./same-day-reuse.cjs').find(service,input,{force:force||!!raw.forceRefresh,signal:controller.signal,identities:input.properties.map((p,i)=>catalogs.get(i)?.identity)});automaticReuse=require('./same-day-reuse.cjs').provenance(previous);if(automaticReuse)service.onEvent({stage:'data',message:'오늘 확인한 같은 단지·면적의 저장자료를 재사용해 새 비교 보고서를 만듭니다.'});}
    // A revision or verified same-day match uses the self-contained snapshot.
    const members=[];
    for(let i=0;i<input.properties.length;i++){
      const p=input.properties[i],old=previous?.members?.[i];let source=null;
      if(old&&!force&&!raw.forceRefresh)source=old;
      else if(p.reportId&&!force&&!raw.forceRefresh){source=await service.store.load(p.reportId);if(source.demo||source.mode==='comparison')throw new Error('사용 예시와 통합 비교 보고서는 비교 대상으로 선택할 수 없습니다.');}
      const original=source&&!automaticReuse?source.input:p.reportId?(old?.input||(await service.store.load(p.reportId)).input):p;
      const itemInput=normalizeInput({...original,...(!source||automaticReuse?{asOf:input.asOf,types:input.types,request:input.request}:{} ),customer:input.customer,office:input.office,officeProfile:input.officeProfile});
      if(members.some((m,j)=>normalize(m.input.target)===normalize(itemInput.target)&&m.input.asset===itemInput.asset&&m.input.area===itemInput.area&&m.input.areaMode===itemInput.areaMode&&m.input.offered===itemInput.offered&&(!catalogs.get(i)?.identity?.code||!catalogs.get(j)?.identity?.code||catalogs.get(i).identity.code===catalogs.get(j).identity.code)))throw new Error('동일한 매물이 중복되었습니다. 주소·면적·제시가격을 확인해 주세요.');
      members.push({key:String.fromCharCode(65+i),input:itemInput,source,sourceReportId:automaticReuse?previous.id:old?.sourceReportId||p.reportId||null,sourceDir:old?service.store.path(previous.id):source?service.store.path(source.id):null});
    }
    const id=randomUUID(),dir=service.store.path(id);await fs.mkdir(path.join(dir,'raw'),{recursive:true});await fs.mkdir(path.join(dir,'figures'),{recursive:true});
    for(const member of members){
      check();const {key:label,source}=member;
      service.onEvent({stage:'data',message:`${label} · ${member.input.target}: ${source?'기존 보고서 근거 재사용':'최근 6개월 거래 조회'}`});
      if(source){member.prices=source.prices;member.dataCheckedAt=source.dataCheckedAt||source.createdAt;member.reusedEvidence=true;member.sourceCreatedAt=source.sourceCreatedAt||source.createdAt;
        member.evidenceFiles=await copyEvidence(service,member.sourceDir,dir,label+'-');
        // In a comparison revision, the raw files already have the member prefix.
        if(previous)for(const name of source.evidenceFiles||[])try{const safe=path.basename(name);await fs.copyFile(path.join(member.sourceDir,'raw',safe),path.join(dir,'raw',safe));if(!member.evidenceFiles.includes(safe))member.evidenceFiles.push(safe);}catch(e){if(e.code!=='ENOENT')throw e;}
        if(source.map?.file)try{const name=label+'-map.png';await fs.copyFile(path.join(member.sourceDir,'figures',path.basename(source.map.file)),path.join(dir,'figures',name));member.map={...source.map,file:name};}catch{}
      }else{
        const catalog=catalogs.get(label.charCodeAt(0)-65),data=await service.data.collect(member.input,message=>service.onEvent({stage:'data',message:`${label} · ${message}`}),controller.signal,{catalog});check();member.researchRaw=data.raw;
        if(data.propertyError)throw new Error(label+' · '+data.propertyError);
        if(data.coverage.length&&data.coverage.every(c=>c.status==='error'))throw new Error(label+' · 공식 거래 자료 조회 실패: '+data.coverage[0].message);
        if(data.identity)member.input.building=data.identity.building;
        member.prices=aggregate(data.rows,member.input,data.coverage);member.dataCheckedAt=new Date().toISOString();member.reusedEvidence=false;member.evidenceFiles=[];
        if(data.identity){member.prices.buildingResolution=data.identity;member.prices.condition=`공식 단지 ${data.identity.building} (${data.identity.town} ${data.identity.lot||''}) / `+member.prices.condition;}
        for(const f of data.raw){const name=label+'-RTMS-'+f.deal+'.csv';await fs.writeFile(path.join(dir,'raw',name),Buffer.from(f.bytes,'base64'));member.evidenceFiles.push(name);}
        const name=label+'-query.json';await fs.writeFile(path.join(dir,'raw',name),JSON.stringify({input:member.input,identity:data.identity,coverage:data.coverage,forms:data.raw.map(f=>f.form),...(catalog?{selectedProperty:catalog.identity}:{} )},null,2));member.evidenceFiles.push(name);
      }
    }
    for(const m of members){
      await (service.reuseComplexBasics||service.reuseNaverLand)?.call(service,m.input,m.prices,{forceRefresh:force||!!raw.forceRefresh,signal:controller.signal,onProgress:message=>service.onEvent({stage:'research',message:m.key+' · '+message})});
      if(m.prices.academyWeb){const name=m.key+'-academy-web.json';await fs.writeFile(path.join(dir,'raw',name),JSON.stringify(m.prices.academyWeb,null,2));m.evidenceFiles.push(name);}
      await service.supplementNaver?.(m.input,m.prices,require('./scoring.cjs').collectEvidence({input:m.input,prices:m.prices,previous:m.source?.assessment?.evidence}),{signal:controller.signal,forceRefresh:force||!!raw.forceRefresh});
      if(m.prices.naverLand){const name=m.key+'-naver-land.json';await fs.writeFile(path.join(dir,'raw',name),JSON.stringify(m.prices.naverLand,null,2));m.evidenceFiles.push(name);}
      if(m.prices.archhub){const name=m.key+'-archhub.json';await fs.writeFile(path.join(dir,'raw',name),JSON.stringify(m.prices.archhub,null,2));m.evidenceFiles.push(name);}
      if(m.prices.sbizSnapshot){const name=m.key+'-sbiz-snapshot.json';await fs.writeFile(path.join(dir,'raw',name),JSON.stringify(m.prices.sbizSnapshot,null,2));m.evidenceFiles.push(name);}
      if(m.prices.hospitalSnapshot){const name=m.key+'-hospital-snapshot.json';await fs.writeFile(path.join(dir,'raw',name),JSON.stringify(m.prices.hospitalSnapshot,null,2));m.evidenceFiles.push(name);}
      m.trend=await require('./price-trend.cjs').ensure(service.data,m.input,m.prices,{previous:m.source?.trend,sourceDir:m.sourceDir,sourcePrefix:previous?m.key+'-':'',dir,prefix:m.key+'-',signal:controller.signal,onProgress:message=>service.onEvent({stage:'data',message:m.key+' · '+message})});if(automaticReuse)await require('./same-day-reuse.cjs').currentQueries(dir,m.key+'-',m.input);if(m.trend)for(const suffix of ['RTMS-trend-trade.csv','trend-query.json']){const name=m.key+'-'+suffix;if(!m.evidenceFiles.includes(name))m.evidenceFiles.push(name);}
    }
    const resolved=new Set();for(const member of members){const identity=member.prices.buildingResolution;if(!identity)continue;const same=JSON.stringify([identity.code,member.input.asset,member.input.area,member.input.areaMode,member.input.selectedAreas,member.input.offered]);if(resolved.has(same))throw new Error('입력한 이름은 다르지만 같은 공식 단지·면적의 매물이 중복되었습니다. 비교 대상을 확인해 주세요.');resolved.add(same);}
    check();const warnings=comparisonWarnings(members);
    for(const m of members)m.numericCheck=require('./evidence-guard.cjs').assertVerifiedPrices(m.prices,m.input);
    for(const m of members)if(m.prices.areaResolution)warnings.push(`${m.key} · 요청 ${m.prices.areaResolution.requested}타입 → 적용 ${m.prices.areaResolution.applied}타입. ${m.prices.areaResolution.reason}`);
    const scoring=require('./scoring.cjs'),researchEngine=require('./research.cjs');
    for(const m of members){
      if(m.reusedEvidence){
        m.researchData={tools:[],issues:[],checks:[]};m.scoreEvidence=scoring.collectEvidence({input:m.input,prices:m.prices,previous:m.source?.assessment?.evidence});
        const refreshed=await require('./regional-park.cjs').ensureEvidence(m.scoreEvidence,{input:m.input,signal:controller.signal});m.scoreEvidence=refreshed.evidence;
        if(refreshed.refreshed){m.parkEvidenceRefreshed=true;m.researchData.checks.push({tool:'national_regional_park',status:refreshed.status==='verified'?'received':'unavailable',checkedAt:refreshed.checkedAt});}
        const raw=[];for(const deal of ['trade','rent']){const file=m.key+'-RTMS-'+deal+'.csv';if(m.evidenceFiles.includes(file))raw.push({deal,bytes:(await fs.readFile(path.join(dir,'raw',file))).toString('base64')});}
        const living=await researchEngine.ensureLivingEvidence(service.bridge,m.input,m.prices,{previous:m.scoreEvidence,raw,signal:controller.signal,readTrail:service.readTrail,cache:service.researchCache,forceRefresh:force||!!raw.forceRefresh,onProgress:message=>service.onEvent({stage:'research',message:m.key+' · '+message})});
        m.scoreEvidence=living.evidence;if(living.refreshed){m.livingEvidenceRefreshed=true;m.researchData.tools.push(...living.research.tools);m.researchData.checks.push(...living.research.checks);m.researchData.issues.push(...living.research.issues);}
      }
      else{m.researchData=await researchEngine.collectResearch(service.bridge,m.input,m.prices,{raw:m.researchRaw,signal:controller.signal,includeMap:false,readTrail:service.readTrail,cache:service.researchCache,forceRefresh:force||!!raw.forceRefresh,onProgress:message=>service.onEvent({stage:'research',message:m.key+' · '+message})});m.scoreEvidence=scoring.collectEvidence({input:m.input,prices:m.prices,tools:m.researchData.tools,school:m.researchData.school,nature:m.researchData.nature,natureAccess:m.researchData.natureAccess,livingAccess:m.researchData.livingAccess,nearbyContext:m.researchData.nearbyContext});}check();
    }
    for(const m of members){const shopping=await researchEngine.ensureShoppingEvidence(service.bridge,m.input,m.prices,{previous:m.scoreEvidence,tools:m.researchData.tools,signal:controller.signal,cache:service.researchCache});m.scoreEvidence=shopping.evidence;m.researchData.tools.push(...shopping.research.tools);m.researchData.checks.push(...shopping.research.checks);m.researchData.issues.push(...shopping.research.issues);const secondary=await researchEngine.ensureSecondaryEvidence(service.bridge,m.input,m.prices,{previous:m.scoreEvidence,tools:m.researchData.tools,signal:controller.signal,cache:service.researchCache});m.scoreEvidence=secondary.evidence;m.researchData.tools.push(...secondary.research.tools);m.researchData.checks.push(...secondary.research.checks);m.researchData.issues.push(...secondary.research.issues);m.scoreEvidence=scoring.assessScores({scores:[]},{input:m.input,prices:m.prices,previousEvidence:m.scoreEvidence,dataCheckedAt:m.dataCheckedAt}).assessment.evidence;}
    for(const m of members)if(m.reusedEvidence){const extra=await researchEngine.ensureNearbyEvidence(service.bridge,{...m.input,request:input.request},m.prices,{previous:m.scoreEvidence,tools:m.researchData.tools,signal:controller.signal,cache:service.researchCache});m.scoreEvidence=extra.evidence;researchEngine.appendResearch(m.researchData,extra.research);}
    for(const m of members){await service.supplementNaver?.(m.input,m.prices,m.scoreEvidence,{signal:controller.signal,forceRefresh:force||!!raw.forceRefresh});if(m.prices.naverNearby)await fs.writeFile(path.join(dir,'raw',m.key+'-naver-nearby.json'),JSON.stringify(m.prices.naverNearby,null,2));}
    const future=require('./future-developments.cjs'),futureCache=new Map();
    for(const m of members){m.futureDevelopments=await require('./research-cache.cjs').publicSnapshot(service.researchCache,m.input,m.prices,'futureDevelopments',()=>future.collect(service.bridge,m.input,{center:m.scoreEvidence.center,previous:m.source?.futureDevelopments,signal:controller.signal,...selected,cache:futureCache,onProgress:message=>service.onEvent({stage:'research',message:m.key+' · '+message})}),v=>future.current(v,m.input,m.scoreEvidence.center),{forceRefresh:force||!!raw.forceRefresh});const file=m.key+'-future-developments.json';await fs.writeFile(path.join(dir,'raw',file),JSON.stringify(m.futureDevelopments,null,2));m.evidenceFiles.push(file);}
    for(const m of members)m.scoreEvidence=future.excludeScheduled(m.scoreEvidence,m.futureDevelopments);
    const mapRequest=await require('./comparison-map.cjs').request(service,members,previous,dir,{forceRefresh:force||!!raw.forceRefresh,signal:controller.signal,onWarning:message=>warnings.push(message)}),{tools:mapTools,targets}=mapRequest;
    // Namespace reused source IDs so two reports using "s1" never share a citation by accident.
    const sourceId=(m,id)=>previous?id:`${m.key}-${id}`;
    const priorEvidence=m=>m.source&&!automaticReuse?{conclusion:m.source.conclusion,strengths:m.source.strengths,limitations:m.source.limitations,sections:m.source.sections,scores:m.source.scores.filter(s=>SCORE_ITEMS.includes(s.name)).map(s=>({...compactPreviousScore(s),sourceIds:(s.sourceIds||[]).map(id=>sourceId(m,id))})),sources:m.source.sources.map(s=>({...s,id:sourceId(m,s.id)}))}:undefined;
    const prompt=JSON.stringify(compactComparisonInput({request:input.request,comparisonAsOf:input.asOf,warnings,members:members.map(m=>({key:m.key,input:analysisInput(m.input),prices:compactPrices(m.prices),verifiedResearch:researchEngine.compactResearch(m.scoreEvidence),researchIssues:m.researchData.issues,dataCheckedAt:m.dataCheckedAt,reusedEvidence:m.reusedEvidence,previousReport:priorEvidence(m)})),previousComparison:previous&&!automaticReuse?{conclusion:previous.conclusion,sections:previous.sections}:undefined},members));
    const instructions=INSTRUCTIONS+'\nlimitations와 checks는 빈 배열로 둔다. 일반 확인요청과 제출전확인 섹션은 쓰지 않고 확인된 사실만 설명한다. 프리미엄 항목은 제외한다. 2~3개 매물의 고객용 통합 비교 보고서다. members에는 입력 key를 순서대로 정확히 한 번씩 넣고 매물별 확인된 장점·점수 6행을 모두 작성한다. 각 매물 사실의 근거를 다른 매물에 옮기지 않는다. 기존 거래·입력 조건과 당시 거래 조회일은 보존한다. 앱이 보완한 지역 대표 대형공원은 verifiedResearch.nature의 별도 조회일·자료 기준일을 사용한다. 자연환경은 검증된 대형공원·숲길·등산로·산책로의 저장 근거로 설명하며 경로 최근접점을 실제 출입구나 도보거리로 바꾸지 않는다. 새 대상만 필요한 외부 거래 근거를 확인한다. methodology에 모든 매물에 동일하게 적용할 세부 지표·배점·구간을 먼저 정하고 각 score.method에 그 기준의 적용과 감점을 기록한다. 기존 점수는 그대로 복사하지 말고 공통 기준으로 다시 검토하며 자료 부족은 null이다. sources는 공통 출처 ID를 쓰고 이전 출처를 보존한다. 최상위 scores는 6행 모두 null로 두고 개별 평가는 members에 쓴다. sections에는 고객 목적·예산·출퇴근 등 조건별 선택 이유를 쓴다. 서로 다른 기준일·유형·면적·거래종류를 섞어 가격 우열을 단정하지 않는다. 가격과 거래 표는 앱이 삽입한다. 새 아파트가 있으면 대상 A/B/C와 단지명을 구분한 입지톡 비교 지도 하나를 요청한다. 통합 순위나 종합점수는 만들지 않는다.';
    service.onEvent({stage:'analysis',message:'같은 평가 기준으로 장단점과 고객별 선택 기준을 비교하고 있습니다.'});
    let result,parsed;const usage=[];
    for(let attempt=0;attempt<2;attempt++){
      const repair=attempt?service.repairModel(status.models,selected):null;if(attempt&&!repair)break;
      const choice=attempt?repair:selected;
      check();try{result=await service.bridge.analyze({instructions:instructions+'\n앱이 verifiedResearch와 지도를 직접 조회했습니다. 제공된 근거로 작성하고 AI에 도구가 보이지 않는다는 사유로 확인 사실을 누락하지 마세요. 새 점수는 앱이 산출합니다.',prompt:prompt+(attempt?'\n필수 구조와 대상별 6개 평가 행을 빠짐없이 보완한다.':''),schema:comparisonSchema,externalTools:/세금|대출|규제|법률|개발계획/.test(input.request)&&members.some(m=>!m.reusedEvidence),...choice,signal:controller.signal});}
      catch(error){check();if(error.code!=='AI_INVALID_RESPONSE')throw error;usage.push({model:choice.model,effort:choice.effort,tokens:error.tokenUsage||null,invalidResponse:true});continue;}
      check();usage.push({model:choice.model,effort:choice.effort,tokens:result.tokenUsage||null});
      try{const value=JSON.parse(result.text.replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,''));
        if(qualityIssues(value).length||!value.methodology?.trim()||value.members?.length!==members.length)continue;
        if(members.some((m,i)=>value.members[i].key!==m.key||!Array.isArray(value.members[i].strengths)||!Array.isArray(value.members[i].limitations)||SCORE_ITEMS.some(name=>!value.members[i].scores?.some(s=>s.name===name&&s.reason?.trim()))))continue;
        parsed=value;break;
      }catch{}
    }
    if(!parsed)throw new Error('통합 비교 보고서의 필수 항목이 부족해 저장하지 않았습니다. 다시 시도해 주세요.');
    service.onEvent({stage:'validation',message:'매물별 거래·평가 기준·지도·재사용 날짜를 확인하고 있습니다.'});
    const evidence=require('./evidence-guard.cjs'),narrative=evidence.guardNarrative(parsed,{identifiers:[...members.flatMap(m=>evidence.verifiedIdentifiers(m.input,m.prices)),...members.flatMap(m=>m.scoreEvidence.places.map(p=>p.name)),members.length+'개 매물']});parsed=future.sanitizeNarrative(narrative.report,{projects:members.flatMap(m=>m.futureDevelopments.projects)});if(narrative.rejected.some(x=>x.field==='title'))parsed.title=members.length+'개 매물 통합 비교 보고서';
    const issues=[...warnings,...(narrative.notice?[narrative.notice]:[])];let map=mapRequest.map;
    if(mapTools.length&&service.captureMap)try{map=await service.captureMap(mapTools,dir,{targets,signal:controller.signal});}catch(e){if(controller.signal.aborted)throw e;map={file:null,status:'unavailable',reason:e.message};}
    if(!map?.file&&!force&&!raw.forceRefresh&&require('./comparison-map.cjs').matches(previous?.map,mapRequest)&&!members.some(m=>m.parkEvidenceRefreshed))try{const name='comparison-map.png';await fs.copyFile(path.join(service.store.path(previous.id),'figures',path.basename(previous.map.file)),path.join(dir,'figures',name));map={...previous.map,file:name};}catch{}
    const preserved=members.flatMap(m=>priorEvidence(m)?.sources||[]),sourceMap=new Map((parsed.sources||[]).map(s=>[s.id,s]));for(const s of preserved)sourceMap.set(s.id,s);
    const sourceOnly=validateReport({...parsed,sources:[...sourceMap.values()],scores:[]}).report.sources;
    for(let i=0;i<members.length;i++){
      const m=members[i];m.scoreEvidence=future.excludeScheduled(m.scoreEvidence,m.futureDevelopments);const assessed=scoring.assessScores({...parsed,...parsed.members[i]},{input:m.input,prices:m.prices,previousEvidence:m.scoreEvidence,dataCheckedAt:m.dataCheckedAt});
      for(const s of assessed.sources)if(!sourceOnly.some(old=>old.id===s.id))sourceOnly.push(s);
      const v=validateReport({...parsed,...parsed.members[i],scores:assessed.scores,sources:sourceOnly});m.assessment=assessed.assessment;m.strengths=v.report.strengths.length?v.report.strengths:['확인된 장점 근거가 부족합니다.'];m.limitations=v.report.limitations.length?v.report.limitations:['현장 상태·권리관계는 별도 확인이 필요합니다.'];m.scores=v.report.scores;m.sources=sourceOnly;m.sections=automaticReuse?[]:m.source?.sections||[];m.conclusion=automaticReuse?'':m.source?.conclusion||'';
      m.assessment.summary=scoring.summary(m.scores);
      const scoreFile=m.key+'-score-evidence.json';await fs.writeFile(path.join(dir,'raw',scoreFile),JSON.stringify(m.assessment,null,2));if(!m.evidenceFiles.includes(scoreFile))m.evidenceFiles.push(scoreFile);
      for(const [field,suffix]of [['livingAccess','living-access.json'],['shopping','shopping-evidence.json'],['nearbyContext','nearby-context.json']])if(m.assessment.evidence[field]){const file=m.key+'-'+suffix;await fs.writeFile(path.join(dir,'raw',file),JSON.stringify(m.assessment.evidence[field],null,2));if(!m.evidenceFiles.includes(file))m.evidenceFiles.push(file);}
      if(m.assessment.evidence.nature){const parkFile=m.key+'-regional-park.json';await fs.writeFile(path.join(dir,'raw',parkFile),JSON.stringify(m.assessment.evidence.nature,null,2));if(!m.evidenceFiles.includes(parkFile))m.evidenceFiles.push(parkFile);}
      if(m.assessment.evidence.product){const file=m.key+'-product-evidence.json';await fs.writeFile(path.join(dir,'raw',file),JSON.stringify({product:m.assessment.evidence.product,peers:m.assessment.evidence.peers,checks:m.researchData.checks},null,2));if(!m.evidenceFiles.includes(file))m.evidenceFiles.push(file);}
      issues.push(...v.issues.map(x=>m.key+' · '+x),...(m.prices.coverage||[]).filter(c=>c.status==='error').map(c=>m.key+' · '+c.message));
      if(!m.prices.rows.length)issues.push(m.key+' · 비교 가능한 거래가 없어 평균을 산출하지 못했습니다.');
      if(m.reusedEvidence)issues.push(`${m.key} · 기존 거래 근거 재사용: 기준일 ${m.input.asOf}, 자료 조회 ${m.dataCheckedAt}.`+(m.parkEvidenceRefreshed?' 지역 대표 대형공원 근거는 별도 공원 조회일로 보완했습니다.':' 거래 자료를 다시 조회하지 않았습니다.'));
      issues.push(...m.researchData.issues.map(reason=>m.key+' · '+reason));m.research={checks:m.researchData.checks,issues:m.researchData.issues,metrics:m.researchData.metrics};
      if(m.input.asset==='apartment'&&!m.map?.file&&!map?.file)issues.push(m.key+' · 입지톡 지도 미첨부: '+(map?.reason||'대상 단지 지도 주소를 확보하지 못했습니다.')+' 지도 다시 불러오기로 재시도하세요.');
      delete m.source;delete m.sourceDir;delete m.researchRaw;delete m.researchData;delete m.scoreEvidence;
    }
    const naverSources=require('./naver-supplement.cjs').sources({members});
    sourceOnly.splice(0,sourceOnly.length,...evidence.alignSourceDates([...sourceOnly,...naverSources],{verifiedSources:[...members.flatMap(m=>m.assessment.evidence.sources||[]),...naverSources],preservedIds:preserved.map(s=>s.id)}));
    input.target=members.map(m=>m.input.target).join(' / ');input.asset=members.every(m=>m.input.asset==='apartment')?'apartment':'comparison';
    const prices=aggregate([],normalizeInput({target:'통합 비교',asOf:input.asOf,types:input.types}));
    check();
    const report=await service.store.save({...parsed,methodology:require('./scoring.cjs').RUBRIC,mode:'comparison',members,id,input,consultation:consultation.getConsultation({input,mode:'comparison',members,consultation:snapshot?{...snapshot,customer:input.customer}:undefined}),prices,map,issues,sources:sourceOnly,scores:SCORE_ITEMS.map(name=>({name,score:null,reason:'매물별 공통 기준 평가표를 확인하세요.',method:'',sourceIds:[]})),status:issues.length?'검토 필요':'초안',createdAt:new Date().toISOString(),dataCheckedAt:new Date().toISOString(),requestFingerprint:key,revisionOf:revisionId||null,...(automaticReuse?{sameDayReuse:automaticReuse}:{}),mapConnected:status.mapConnected,provider:service.settings.provider||'gpt',aiGrounding:{webSearches:result.webSearches||[]},model:usage.at(-1).model,research:{requestBudget:service.bridge.evidenceBudget?.snapshot()},optimization:{attempts:usage.length,usage,requestBudget:service.bridge.evidenceBudget?.snapshot()},verification:{numericChecks:members.map(m=>({key:m.key,...m.numericCheck})),numericClaimsRejected:narrative.rejected,content:'공통 기준의 AI 비교 초안입니다. 기존 보고서 재사용은 최신 재조회가 아니며 출처·현장·권리관계는 최종 확인이 필요합니다.'}});
    service.onEvent({stage:'done',message:'통합 비교 보고서를 저장했습니다.',reportId:id});return report;
  }finally{service.active=null;}
}
module.exports={runComparison,normalizeComparison,comparisonWarnings,comparisonSchema,compactComparisonInput,compactPreviousScore};


