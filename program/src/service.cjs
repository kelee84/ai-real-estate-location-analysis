'use strict';
const fs=require('node:fs/promises');const path=require('node:path');
const {randomUUID}=require('node:crypto');
const {normalizeInput,aggregate,quotaState,validateReport,SCORE_ITEMS,todayKst}=require('./core.cjs');
const {reportSchema}=require('./schema.cjs');
const {VERSION,materialKey,fingerprint,buildRequest,qualityIssues}=require('./prompt.cjs');
const {isValidatedMap}=require('./map-capture.cjs');
const consultation=require('./consultation.cjs');
class AnalysisService {
  constructor({bridge,data,store,workspace,userData,onEvent,captureMap}){Object.assign(this,{bridge,data,store,workspace,userData,onEvent,captureMap});this.active=null;this.settings={};this.inputs=[];this.researchCache=new (require('./research-cache.cjs').ResearchCache)(userData);bridge.on('progress',p=>onEvent(p));bridge.on('notification',m=>{if(m.method==='account/rateLimits/updated')onEvent({stage:'usage'});if(['account/login/completed','account/updated','mcpServer/oauthLogin/completed'].includes(m.method))onEvent({stage:'account',message:m.params?.success===false?'로그인이 완료되지 않았습니다. 브라우저에서 다시 로그인해 주세요.':'연결 상태가 변경됐습니다.',error:m.params?.success===false});});}
  async init(){this.hospitalStore=new (require('./public-hospitals.cjs').HospitalStore)(this.userData);this.sbizStore=new (require('./sbiz-data.cjs').SbizStore)(this.userData);this.archhubStore=new (require('./archhub.cjs').Store)(this.userData);this.naverStore=new (require('./naver-land.cjs').NaverLandStore)(this.userData);try{this.settings=JSON.parse(await fs.readFile(path.join(this.userData,'settings.json'),'utf8'));}catch{}this.settings=require('./ai-settings.cjs').normalizeAiSettings(this.settings);this.settings.officeProfile=consultation.normalizeOfficeProfile(this.settings.officeProfile,this.settings.office);this.settings.office=this.settings.officeProfile.name;this.bridge.setProvider?.(this.settings.provider);}
  async importNaverLand(value){
    if(this.active)throw new Error('진행 중인 분석이 끝난 뒤 네이버 조회정보를 불러와 주세요.');
    this.naverStore??=new (require('./naver-land.cjs').NaverLandStore)(this.userData);
    const record=await this.naverStore.import(value);this.naverImportedAt=Date.now();
    return {name:record.name,address:record.addressJibun,sourceUrl:record.sourceUrl,checkedAt:record.checkedAt};
  }
  async importNaverLink(url){
    if(this.active)throw new Error('진행 중인 분석이 끝난 뒤 네이버 단지 링크를 가져와 주세요.');
    if(typeof this.readNaverPage!=='function')throw new Error('네이버 페이지 읽기를 사용할 수 없습니다. 앱을 다시 실행해 주세요.');
    const controller=new AbortController(),activity={kind:'naver-import',controller};this.active=activity;
    try{
      const record=await this.readNaverPage(url,{signal:controller.signal});
      if(controller.signal.aborted)throw new Error('네이버 정보 가져오기를 중지했습니다.');
      this.naverStore??=new (require('./naver-land.cjs').NaverLandStore)(this.userData);
      const saved=await this.naverStore.import(record);this.naverImportedAt=Date.now();
      return {name:saved.name,address:saved.addressJibun,sourceUrl:saved.sourceUrl,checkedAt:saved.checkedAt};
    }finally{if(this.active===activity)this.active=null;}
  }
  async reuseNaverLand(input,prices,{forceRefresh=false,signal,onProgress}={}){
    if(input.asset!=='apartment'||input.asOf!==todayKst())return prices.naverLand||null;
    if(forceRefresh)delete prices.naverLand;
    const saved=!forceRefresh&&await this.naverStore?.forIdentity(input,prices);
    if(saved)prices.naverLand=saved;
    else if(!require('./naver-land.cjs').current(prices.naverLand,{identity:prices.buildingResolution,asOf:input.asOf}))delete prices.naverLand;
    const archhub=require('./archhub.cjs'),official=archhub.verified(prices.archhub,{identity:prices.buildingResolution,asOf:input.asOf});
    if(typeof this.findNaverComplex==='function'&&!(archhub.complete(official)&&require('./living-access.cjs').point(prices.buildingResolution))&&(!archhub.complete(prices.naverLand)||forceRefresh)){
      this.naverLookups??=new Map();const identity=prices.buildingResolution,key=JSON.stringify([input.asOf,identity?.code,identity?.regionCode,identity?.town,identity?.lot]);
      onProgress?.('네이버 부동산에서 주차대수와 공개 단지정보를 자동으로 확인하고 있습니다.');
      if(!this.naverLookups.has(key))this.naverLookups.set(key,this.findNaverComplex(input,prices,{signal}).then(async record=>{
        if(!require('./naver-land.cjs').current(record,{identity,asOf:input.asOf}))throw new Error('네이버 단지정보가 공식 단지·주소와 일치하지 않습니다.');
        this.naverStore??=new (require('./naver-land.cjs').NaverLandStore)(this.userData);return this.naverStore.import(record);
      }));
      try{prices.naverLand=await this.naverLookups.get(key);prices.naverLookup={status:'received',checkedAt:prices.naverLand.checkedAt};}
      catch(error){if(signal?.aborted)throw error;prices.naverLookup={status:'unavailable',reason:error.message};onProgress?.('네이버 단지정보 자동 확인을 마치지 못했습니다. 확인된 자료로 분석을 계속합니다.');}
    }
    return prices.naverLand||null;
  }
  async reuseArchhub(input,prices,options={}){
    const api=require('./archhub.cjs');
    if(input.asset!=='apartment'||input.asOf!==todayKst())return null;
    // Test doubles/standalone services opt in explicitly; the installed app
    // wires this store in init(). Never add hidden network calls to exporters.
    if(!this.archhubStore)return null;
    options.onProgress?.('건축HUB 총괄표제부의 세대수·주차대수·사용승인일을 확인하고 있습니다.');
    try{const record=await this.archhubStore.ensure(input,prices,options);if(record){prices.archhub=record;prices.archhubLookup={status:'received',checkedAt:record.checkedAt};}return record;}
    catch(error){if(options.signal?.aborted)throw error;if(!api.verified(prices.archhub,{identity:prices.buildingResolution,asOf:input.asOf}))delete prices.archhub;prices.archhubLookup={status:'unavailable',reason:error.message};return null;}
  }
  async reuseSbiz(input,prices,options={}){
    if(!this.sbizStore||input.asset!=='apartment'||input.asOf!==todayKst())return null;
    const proof=require('./sbiz-evidence.cjs'),context={identity:prices.buildingResolution,center:prices.buildingResolution,asOf:input.asOf};
    if(!options.forceRefresh&&proof.verified(prices.sbizSnapshot,context))return prices.sbizSnapshot;
    try{const snapshot=await this.sbizStore.nearby(input,prices,options);if(proof.verified(snapshot,context)){prices.sbizSnapshot=snapshot;return snapshot;}prices.sbizLookup={status:'unavailable',reason:'공식 상가자료의 기준일·주소·좌표를 대조하지 못했습니다.'};}
    catch(error){if(options.signal?.aborted)throw error;prices.sbizLookup={status:'unavailable',reason:error.message};options.onProgress?.('공식 상가자료를 사용하지 못해 필요한 시설은 기존 조회로 확인합니다.');}
    return null;
  }
  async reuseHospitals(input,prices,options={}){
    if(!this.hospitalStore||input.asset!=='apartment'||input.asOf!==todayKst())return null;
    const proof=require('./public-hospitals.cjs'),context={identity:prices.buildingResolution,center:prices.buildingResolution,asOf:input.asOf};
    if(!options.forceRefresh&&proof.verified(prices.hospitalSnapshot,context))return prices.hospitalSnapshot;
    try{const snapshot=await this.hospitalStore.nearby(input,prices,options);if(proof.verified(snapshot,context)){prices.hospitalSnapshot=snapshot;return snapshot;}prices.hospitalLookup={status:'unavailable',reason:'공식 의료기관 자료의 기준일·등록 분류·좌표를 대조하지 못했습니다.'};}
    catch(error){if(options.signal?.aborted)throw error;prices.hospitalLookup={status:'unavailable',reason:error.message};options.onProgress?.('공식 의료기관 자료로 확인되지 않은 항목은 기존 조회로 보완합니다.');}
    return null;
  }
  async reuseComplexBasics(input,prices,options={}){
    // Naver fills gaps after Archhub. The two independent public datasets can
    // download alongside that chain; their stores coalesce duplicate loads.
    const results=await Promise.allSettled([
      (async()=>{await this.reuseArchhub(input,prices,options);await this.reuseNaverLand(input,prices,options);})(),
      this.reuseSbiz(input,prices,options),this.reuseHospitals(input,prices,options)
    ]);
    const failed=results.find(r=>r.status==='rejected');if(failed)throw failed.reason;
  }
  async presentationReport(id){return require('./report-basics.cjs').presentationReport(this,id);}
  async status(){
    const settings=structuredClone(this.settings);
    if(this.bridge.connectionStatus)return {...await this.bridge.connectionStatus(),settings};
    try{await this.bridge.start();const account=await this.bridge.request('account/read',{refreshToken:false});let usage=null,models=[],mapConnected=false;
      if(account.account){const results=await Promise.allSettled([this.bridge.request('account/rateLimits/read',{},7000),this.bridge.request('model/list',{}),this.bridge.request('mcpServerStatus/list',{},15000)]);
        if(results[0].status==='fulfilled')usage=results[0].value;
        if(results[1].status==='fulfilled')models=results[1].value.data||[];
        if(results[2].status==='fulfilled'){const server=results[2].value.data?.find(x=>x.name==='ipzitalk');mapConnected=!!server&&Object.keys(server.tools||{}).length>0;}
      }
      return {connected:true,loggedIn:!!account.account,account:account.account?{email:account.account.email||'',type:account.account.type,planType:account.account.planType}:null,usage:usage?quotaState(usage):null,ipzitalkUsage:{...this.bridge.ipzitalkUsage?.snapshot(),requestBudget:this.bridge.evidenceBudget?.snapshot()},models:models.map(m=>({id:m.model||m.id,name:m.displayName||m.model||m.id,isDefault:m.isDefault,efforts:m.supportedReasoningEfforts||[]})),mapConnected,settings};
    }catch(e){return {connected:false,loggedIn:false,error:e.message,settings};}
  }
  async login(){if(this.active)throw new Error('진행 중인 작업이 끝난 뒤 AI를 연결해 주세요.');if(this.bridge.login)return this.bridge.login();await this.bridge.start();return this.bridge.request('account/login/start',{type:'chatgpt'},30000);}
  async usage(){if(['gemini','claude'].includes(this.settings.provider))return null;await this.bridge.start();return quotaState(await this.bridge.request('account/rateLimits/read',{}));}
  async mapLogin(){if(this.active)throw new Error('진행 중인 작업이 끝난 뒤 지도를 연결해 주세요.');if(this.bridge.mapLogin)return this.bridge.mapLogin();await this.bridge.start();return this.bridge.request('mcpServer/oauth/login',{name:'ipzitalk',timeoutSecs:180},30000);}
  async configureGemini(action,key){return this.configureProvider('gemini',action,key);}
  async configureClaude(action,key){return this.configureProvider('claude',action,key);}
  async configureProvider(provider,action,key){
    const name={gemini:'Gemini',claude:'Claude'}[provider];if(!name)throw new Error('지원하지 않는 AI 연결입니다.');
    if(this.active)throw new Error(`진행 중인 작업이 끝난 뒤 ${name} 연결을 변경해 주세요.`);
    const activity={kind:provider+'-connection',controller:new AbortController()};this.active=activity;
    try{if(action==='connect')return await this.bridge['connect'+name](key,{signal:activity.controller.signal});if(action==='check')return await this.bridge['check'+name]({signal:activity.controller.signal});if(action==='disconnect')return await this.bridge['disconnect'+name]();throw new Error('지원하지 않는 연결 요청입니다.');}
    finally{if(this.active===activity)this.active=null;}
  }
  connectionRequired(){return {gemini:'사용 설정에서 Gemini API 키를 연결해 주세요.',claude:'사용 설정에서 Claude API 키를 연결해 주세요.'}[this.settings.provider]||'먼저 내 ChatGPT 계정으로 로그인해 주세요.';}
  async chooseModel(available){
    const id=x=>x.model||x.id,apiProvider=['gemini','claude'].includes(this.settings.provider),models=(available||(await this.bridge.request('model/list',{})).data||[]).filter(x=>!apiProvider||String(id(x)).startsWith(this.settings.provider+'-'));
    const model=this.settings.model?models.find(x=>id(x)===this.settings.model):apiProvider?models.find(x=>x.isDefault)||models[0]:['gpt-6-luna','gpt-5.6-luna','gpt-6.1-sol'].map(name=>models.find(x=>id(x)===name)).find(Boolean)||models.find(x=>x.isDefault);
    if(!model)throw new Error('사용 가능한 AI 모델을 확인하지 못했습니다. 사용 설정에서 모델을 선택해 주세요.');
    const efforts=(model.supportedReasoningEfforts||model.efforts||[]).map(x=>x.reasoningEffort||x.effort||x);
    return {model:id(model),effort:efforts.includes('low')?'low':efforts.includes('medium')?'medium':model.defaultReasoningEffort||'medium'};
  }
  repairModel(models,selected){if(['gemini','claude'].includes(this.settings.provider))return String(selected?.model).startsWith(this.settings.provider+'-')?selected:null;if(this.settings.model)return null;const fallback=models.find(m=>m.id==='gpt-6.1-sol');return fallback?{model:fallback.id,effort:'medium'}:null;}
  async recentReport(key){
    for(const item of (await this.store.list()).slice(0,20)){
      if(this.naverImportedAt&&Date.parse(item.createdAt)<this.naverImportedAt)continue;
      const age=Date.now()-Date.parse(item.createdAt);if(!Number.isFinite(age)||age<0||age>10*60*1000)continue;
      try{
        const r=await this.store.load(item.id);if(r.requestFingerprint!==key||r.consultation?.updatedAt)continue;
        const members=r.members||[r];let naverChanged=false;
        if(this.naverStore)for(const member of members){const saved=await this.naverStore.forIdentity(member.input,member.prices);if(!saved)continue;let old=null;try{old=require('./naver-land.cjs').normalize(member.prices?.naverLand||member.assessment?.evidence?.naverLand);}catch{}if(JSON.stringify(saved)!==JSON.stringify(old)){naverChanged=true;break;}}
        if(naverChanged)continue;
        const complete=r.mode==='comparison'?members.every(m=>!(m.prices.coverage||[]).some(c=>c.status==='error')&&(m.input.asset!=='apartment'||m.map?.file||r.map?.file)):!r.prices.coverage.some(c=>c.status==='error')&&(r.input.asset!=='apartment'||r.map?.file&&r.assessment?.version===require('./scoring.cjs').VERSION);
        if(r.requestFingerprint===key&&complete){
          if(members.some(m=>m.input.asset==='apartment'&&(m.assessment?.version!==require('./scoring.cjs').VERSION||m.input.asOf===todayKst()&&(!require('./nature-access.cjs').verified(m.assessment?.evidence?.natureAccess,{center:m.assessment?.evidence?.center,asOf:m.input.asOf})||!require('./living-access.cjs').current(m.assessment?.evidence,m.input)||!require('./shopping.cjs').current(m.assessment?.evidence,m.input)||!require('./shopping.cjs').dailyCurrent(m.assessment?.evidence,m.input)))))continue;
          const maps=r.mode==='comparison'?members.filter(m=>m.input.asset==='apartment').map(m=>r.map?.file?r.map:m.map):r.input.asset==='apartment'?[r.map]:[];
          for(const map of maps){if(!isValidatedMap(map))throw new Error('지도 배경 검증이 필요합니다.');await fs.access(path.join(this.store.path(r.id),'figures',path.basename(map.file)));}
          return r;
        }
      }catch{}
    }
    return null;
  }
  async saveSettings(x={}){
    if(this.active)throw new Error('진행 중인 작업이 끝난 뒤 사용 설정을 변경해 주세요.');
    const current=consultation.normalizeOfficeProfile(this.settings.officeProfile,this.settings.office),officeProfile=consultation.normalizeOfficeProfile({...current,...(x.office!==undefined?{name:x.office}:{}),...(x.officeProfile||{})},'',{strict:true});
    const settings={office:officeProfile.name,officeProfile,...require('./ai-settings.cjs').updateAiSettings(this.settings,x)};
    const file=path.join(this.userData,'settings.json'),temporary=file+'.tmp',activity={kind:'settings-save',controller:new AbortController()};this.active=activity;
    try{await fs.writeFile(temporary,JSON.stringify(settings,null,2));await fs.rename(temporary,file);this.settings=settings;this.bridge.setProvider?.(settings.provider);return settings;}
    finally{if(this.active===activity)this.active=null;}
  }
  async saveConsultation(id,payload){
    if(this.active)throw new Error('진행 중인 작업이 끝난 뒤 상담 내용을 저장해 주세요.');
    const activity={kind:'consultation-save',reportId:id,controller:new AbortController()};this.active=activity;
    try{return await this.store.update(id,report=>consultation.updateConsultation(report,payload),{afterSave:false});}
    finally{if(this.active===activity)this.active=null;}
  }
  searchTask(operation,input,work){
    const errors=require('./search-errors.cjs'),key=JSON.stringify([operation,...['target','asset','building','asOf','forceRefresh','searchToken','candidateId'].map(k=>input[k]??null)]),current=this.active;
    if(current?.kind==='property-search'){
      if(current.key===key&&!current.controller.signal.aborted){current.requestIds.add(input.searchRequestId);return current.promise;}
      current.controller.abort();
    }else if(current)return Promise.reject(errors.failure('SEARCH_BUSY','진행 중인 작업이 끝난 뒤 단지를 검색해 주세요.','input'));
    const task={kind:'property-search',key,controller:new AbortController(),requestIds:new Set([input.searchRequestId])};this.active=task;
    task.promise=Promise.resolve().then(()=>work(task.controller.signal)).catch(async error=>{
      this.lastSearchDiagnostic={...errors.diagnostic(error,operation),checkedAt:new Date().toISOString()};
      if(this.userData&&!task.controller.signal.aborted)await fs.writeFile(path.join(this.userData,'search-diagnostic.json'),JSON.stringify(this.lastSearchDiagnostic)).catch(()=>{});
      throw errors.present(error,task.controller.signal);
    }).finally(()=>{if(this.active===task)this.active=null;});return task.promise;
  }
  cancelSearch(requestId){
    const task=this.active;if(task?.kind!=='property-search'||!task.requestIds.has(requestId))return false;
    task.requestIds.delete(requestId);if(!task.requestIds.size){task.controller.abort();this.active=null;}return true;
  }
  searchTypes(raw){return this.searchTask('types',raw,signal=>this.searchTypesWithSignal(raw,signal));}
  async searchTypesWithSignal(raw,signal){
    require('./property-identity.cjs').assertPropertyInput(raw);
    const search=require('./property-search.cjs');
    // With a region, first resolve the user's address against the official
    // register. A cached alias must not add an extra candidate-selection step.
    // Name-only searches and official misses still reuse saved candidates below.
    if(!search.hasRegion(raw.target))return this.searchPropertiesWithSignal(raw,signal);
    let catalog;try{catalog=await require('./type-catalog.cjs').discoverTypes(this.data,raw,signal);}catch(error){require('./search-errors.cjs').cancelled(signal);if(error.code==='PROPERTY_AMBIGUOUS'&&error.region?.province?.name)return this.rememberPropertySearch(search.officialCandidates(raw,error));if(['PROPERTY_AMBIGUOUS','PROPERTY_NOT_FOUND','REGION_REQUIRED','REGION_AMBIGUOUS'].includes(error.code)&&(!raw.asset||raw.asset==='apartment'))return this.searchPropertiesWithSignal(raw,signal);throw error;}
    require('./search-errors.cjs').cancelled(signal);
    return this.rememberCatalog(catalog);
  }
  searchProperties(raw){return this.searchTask('properties',raw,signal=>this.searchPropertiesWithSignal(raw,signal));}
  async searchPropertiesWithSignal(raw,signal){
    const before=this.bridge.ipzitalkUsage?.snapshot().sessionCalls||0,result=await require('./saved-property-search.cjs').find(this.store,raw,{forceRefresh:!!raw.forceRefresh,signal})||await require('./property-search.cjs').search(this.bridge,raw,{client:this.data,naverStore:this.naverStore,forceRefresh:!!raw.forceRefresh,signal});
    require('./search-errors.cjs').cancelled(signal);
    result.ipzitalkPreflightCalls=Math.max(0,(this.bridge.ipzitalkUsage?.snapshot().sessionCalls||0)-before);
    return this.rememberPropertySearch(result);
  }
  rememberPropertySearch(result){
    const token=randomUUID();this.propertySearches??=new Map();
    for(const [key,value]of this.propertySearches)if(Date.now()-value.time>30*60*1000)this.propertySearches.delete(key);
    this.propertySearches.set(token,{...result,time:Date.now()});return {kind:'candidates',searchToken:token,candidates:result.candidates.map(({id,name,address,road})=>({id,name,address,road})),checkedAt:result.checkedAt,sourceName:result.sourceName,reason:result.reason||''};
  }
  selectProperty(input){return this.searchTask('select',input,signal=>this.selectPropertyWithSignal(input,signal));}
  async selectPropertyWithSignal({searchToken,candidateId},signal){
    const saved=this.propertySearches?.get(searchToken),choice=saved?.candidates.find(p=>p.id===candidateId);if(!saved||!choice||Date.now()-saved.time>30*60*1000)throw new Error('단지 검색이 만료되었거나 후보가 바뀌었습니다. 다시 검색해 주세요.');
    const before=this.bridge.ipzitalkUsage?.snapshot().sessionCalls||0;
    const search=require('./property-search.cjs'),selected=choice.officialCode?search.officialChoice(saved,choice):await search.resolveChoice(this.bridge,this.data,choice,{signal}),raw={...saved.input,target:selected.target,building:selected.building};
    let catalog;try{catalog=await require('./type-catalog.cjs').discoverTypes(this.data,raw,signal,{region:selected.region,expected:selected.expected});}catch(error){require('./search-errors.cjs').cancelled(signal);if(error.code==='PROPERTY_AMBIGUOUS')return this.rememberPropertySearch({...search.officialCandidates(raw,error),ipzitalkPreflightCalls:(saved.ipzitalkPreflightCalls||0)+Math.max(0,(this.bridge.ipzitalkUsage?.snapshot().sessionCalls||0)-before)});throw error;}
    require('./search-errors.cjs').cancelled(signal);
    catalog.ipzitalkPreflightCalls=(saved.ipzitalkPreflightCalls||0)+Math.max(0,(this.bridge.ipzitalkUsage?.snapshot().sessionCalls||0)-before);
    return this.rememberCatalog(catalog);
  }
  rememberCatalog(catalog){
    const token=randomUUID();
    this.typeCatalogs??=new Map();for(const [key,value]of this.typeCatalogs)if(Date.now()-value.time>24*60*60*1000)this.typeCatalogs.delete(key);
    this.typeCatalogs.set(token,{...catalog,time:Date.now()});return {...catalog,token,records:undefined};
  }
  validateTypeSelection(raw){
    const catalog=this.typeCatalogs?.get(raw.catalogToken),areas=require('./type-selection.cjs').selectedAreas(raw.selectedAreas);
    const buildingChanged=catalog&&(catalog.requestedBuilding!==undefined||catalog.building)&&require('./core.cjs').normalize(catalog.requestedBuilding??catalog.building)!==require('./core.cjs').normalize(raw.building||'');
    if(!catalog||Date.now()-catalog.time>24*60*60*1000||catalog.target!==String(raw.target||'').trim()||catalog.asset!==(raw.asset||'apartment')||buildingChanged||areas.some(a=>!catalog.areas.includes(a)))throw new Error('타입 검색의 조건이 바뀌었거나 기한이 지났습니다. 다시 검색하고 표시된 타입을 선택해 주세요.');
    return catalog;
  }
  async run(raw,options={}){
    if(this.active)throw new Error('진행 중인 작업이 끝난 뒤 다시 시작해 주세요.');
    this.naverLookups=new Map();
    this.archhubStore?.begin();
    this.naverNearbyLookups=new Map();
    this.academyWebLookups=new Map();
    const budget=this.bridge.evidenceBudget??=new (require('./ipzitalk-budget.cjs').IpzitalkBudget)();
    const preflights=new Set(),initialCalls=(raw.properties||[raw]).reduce((sum,p)=>{const c=this.typeCatalogs?.get(p.catalogToken);if(!c||preflights.has(p.catalogToken))return sum;preflights.add(p.catalogToken);return sum+(c.ipzitalkPreflightCalls||0);},0);
    return budget.run({initialCalls},()=>this.runWithBudget(raw,options));
  }
  async runWithBudget(raw,{revisionId,force=false}={}){
    if(raw?.mode==='comparison')return require('./comparison.cjs').runComparison(this,raw,{revisionId,force});
    if(raw?.selectedAreas?.length&&!revisionId)return require('./type-batch.cjs').runTypeBatch(this,raw,{force});
    return this.runSingle(raw,{revisionId,force});
  }
  async supplementNaver(input,prices,evidence,{signal,forceRefresh=false}={}){
    if(input.asset!=='apartment'||input.asOf!==todayKst()||typeof this.readNaverNearby!=='function')return null;
    const living=require('./living-access.cjs'),shopping=require('./shopping.cjs');
    if(living.current(evidence,input)&&shopping.current(evidence,input)&&require('./nature-access.cjs').verified(evidence?.natureAccess,{center:evidence?.center,asOf:input.asOf}))return null;
    const key=JSON.stringify([input.asOf,prices.buildingResolution?.code,prices.buildingResolution?.town,prices.buildingResolution?.lot]);this.naverNearbyLookups??=new Map();
    if(!this.naverNearbyLookups.has(key)){
      const cacheRules=require('./research-cache.cjs'),load=async()=>{
        const found=await this.readNaverNearby(input,prices,{evidence,signal,forceRefresh});
        const candidates=require('./naver-facilities.cjs').purposeFacts(found.facts),routes=typeof this.readNaverWalking==='function'?await this.readNaverWalking(input,prices,{facts:candidates,signal,forceRefresh}):{facts:candidates,issues:[]};
        const byId=new Map(routes.facts.map(f=>[String(f.placeId),f]));
        return {...found,version:'naver-nearby-walk-v2',facts:(found.facts||[]).map(f=>byId.get(String(f.placeId))||f),routeCoverage:routes.routeCoverage||[],issues:[...(found.issues||[]),...(routes.issues||[])],identityCode:prices.buildingResolution?.code,asOf:input.asOf};
      };
      const accept=v=>v?.version==='naver-nearby-walk-v2'&&['received','partial'].includes(v?.status)&&v.identityCode===prices.buildingResolution?.code&&v.asOf===input.asOf&&v.facts?.length>0&&v.facts.some(f=>require('./naver-walking.cjs').validWalking(f.walking,{input,identity:prices.buildingResolution,fact:f}))&&v.facts.every(f=>{try{const u=new URL(f.sourceUrl);return typeof f.text==='string'&&u.protocol==='https:'&&!u.username&&!u.password&&['search.naver.com','map.naver.com','pcmap.place.naver.com','m.place.naver.com'].includes(u.hostname)&&todayKst(new Date(f.checkedAt))===input.asOf&&Date.parse(f.checkedAt)<=Date.now();}catch{return false;}});
      this.naverNearbyLookups.set(key,this.researchCache?.snapshot(cacheRules.scope(input,prices),'naverNearby',load,{forceRefresh,accept})||load());
    }
    try{const found=await this.naverNearbyLookups.get(key);if(signal?.aborted)throw new Error('분석을 중지했습니다.');prices.naverNearby={...found,identityCode:prices.buildingResolution?.code,asOf:input.asOf};return prices.naverNearby;}
    catch(error){if(signal?.aborted)throw error;prices.naverNearby={status:'unavailable',identityCode:prices.buildingResolution?.code,asOf:input.asOf,facts:[],issues:[error.message]};return prices.naverNearby;}
  }
  async runSingle(raw,{revisionId,force=false,batchContext=null}={}){
    if(this.active&&!batchContext)throw new Error('분석 중인 보고서가 있습니다. 완료 후 다시 시작해 주세요.');
    require('./property-identity.cjs').assertPropertyInput(raw);
    const controller=batchContext?.controller||new AbortController();if(!batchContext)this.active={controller};
    try{
      let previous=revisionId?await this.store.load(revisionId):batchContext?.evidenceSource||null,automaticReuse=previous&&!revisionId?require('./same-day-reuse.cjs').provenance(previous):null;const snapshot=revisionId?consultation.getConsultation(previous):null;
      const input=normalizeInput({...raw,customer:raw.customer??snapshot?.customer,office:revisionId?snapshot.officeProfile.name:this.settings.office,officeProfile:revisionId?snapshot.officeProfile:this.settings.officeProfile});if(batchContext?.catalog?.identity?.code)input.propertyCode=batchContext.catalog.identity.code;
      this.onEvent({stage:'connection',message:'계정과 사용량을 확인하고 있습니다.'});
      const status=await this.status();if(controller.signal.aborted)throw new Error('분석을 중지했습니다.');if(!status.loggedIn)throw new Error(status.error||this.connectionRequired());
      const selected=await this.chooseModel(status.models),key=fingerprint(input,selected.model,status.mapConnected,this.settings.provider);
      if(!batchContext&&!revisionId&&!force&&!raw.forceRefresh){const cached=await this.recentReport(key);if(cached){this.onEvent({stage:'done',message:'방금 만든 같은 조건의 보고서를 열었습니다.',reportId:cached.id});return {...cached,reused:true};}}
      if(!previous){previous=await require('./same-day-reuse.cjs').find(this,input,{force:force||!!raw.forceRefresh,signal:controller.signal,identities:[batchContext?.catalog?.identity]});automaticReuse=require('./same-day-reuse.cjs').provenance(previous);}
      const reuse=previous&&previous.prices.rows.length>0&&(automaticReuse||materialKey(normalizeInput(previous.input))===materialKey(input))&&!force&&!raw.forceRefresh&&!/최신|새로\s*조회|재조회/.test(input.request.slice(previous.input.request.length));
      this.onEvent({stage:'data',message:reuse?'기존 거래 근거를 재사용하고 요청한 내용만 수정합니다.':batchContext?'조회한 원자료에서 이번 타입의 계약을 구분합니다.':'최근 6개월의 공식 거래 자료를 조회하고 있습니다.'});
      const collected=reuse?{coverage:previous.prices.coverage,raw:[]}:batchContext?.collected||await this.data.collect(input,message=>this.onEvent({stage:'data',message}),controller.signal);
      if(collected.propertyError)throw new Error(collected.propertyError);
      if(!reuse&&collected.coverage.length&&collected.coverage.every(c=>c.status==='error'))throw new Error('공식 거래 자료를 조회하지 못해 보고서를 만들지 않았습니다. '+collected.coverage[0].message);
      if(collected.identity)input.building=collected.identity.building;
      if(controller.signal.aborted)throw new Error('분석을 중지했습니다.');
      const prices=reuse?previous.prices:aggregate(collected.rows,input,collected.coverage),id=randomUUID(),dir=this.store.path(id),dataCheckedAt=reuse?(previous.dataCheckedAt||previous.createdAt):batchContext?.dataCheckedAt||new Date().toISOString();
      if(collected.identity){prices.buildingResolution=collected.identity;prices.condition=`공식 단지 ${collected.identity.building} (${collected.identity.town} ${collected.identity.lot||''}) / `+prices.condition;}
      await this.reuseComplexBasics(input,prices,{forceRefresh:force||!!raw.forceRefresh,signal:controller.signal,onProgress:message=>this.onEvent({stage:'research',message})});
      const numericCheck=require('./evidence-guard.cjs').assertVerifiedPrices(prices,input);
      await fs.mkdir(path.join(dir,'raw'),{recursive:true});await fs.mkdir(path.join(dir,'figures'),{recursive:true});
      if(prices.naverLand)await fs.writeFile(path.join(dir,'raw','naver-land.json'),JSON.stringify(prices.naverLand,null,2));
      if(prices.archhub)await fs.writeFile(path.join(dir,'raw','archhub.json'),JSON.stringify(prices.archhub,null,2));
      if(prices.sbizSnapshot)await fs.writeFile(path.join(dir,'raw','sbiz-snapshot.json'),JSON.stringify(prices.sbizSnapshot,null,2));
      if(prices.hospitalSnapshot)await fs.writeFile(path.join(dir,'raw','hospital-snapshot.json'),JSON.stringify(prices.hospitalSnapshot,null,2));
      if(prices.academyWeb)await fs.writeFile(path.join(dir,'raw','academy-web.json'),JSON.stringify(prices.academyWeb,null,2));
      if(reuse){for(const name of ['RTMS-trade.csv','RTMS-rent.csv','query.json'])try{await fs.copyFile(path.join(this.store.path(previous.id),'raw',name),path.join(dir,'raw',name));}catch(e){if(e.code!=='ENOENT')throw e;}}
      else{for(const rawFile of collected.raw)await fs.writeFile(path.join(dir,'raw',`RTMS-${rawFile.deal}.csv`),Buffer.from(rawFile.bytes,'base64'));await fs.writeFile(path.join(dir,'raw','query.json'),JSON.stringify({input,identity:collected.identity,coverage:collected.coverage,forms:collected.raw.map(r=>r.form),catalog:batchContext?.catalog},null,2));}
      const scoring=require('./scoring.cjs'),researchEngine=require('./research.cjs'),refreshPublic=(force||!!raw.forceRefresh)&&(!batchContext||batchContext.index===1);
      const naverEvidence=scoring.collectEvidence({input,prices,previous:reuse?previous.assessment?.evidence:undefined});
      await this.supplementNaver(input,prices,naverEvidence,{signal:controller.signal,forceRefresh:refreshPublic});
      if(prices.naverNearby)await fs.writeFile(path.join(dir,'raw','naver-nearby.json'),JSON.stringify(prices.naverNearby,null,2));
      const trend=await require('./price-trend.cjs').ensure(this.data,input,prices,{previous:reuse?previous.trend:null,sourceDir:reuse?this.store.path(previous.id):null,dir,signal:controller.signal,onProgress:message=>this.onEvent({stage:'data',message})});
      if(automaticReuse)await require('./same-day-reuse.cjs').currentQueries(dir,'',input);
      const priorReady=reuse&&[scoring.VERSION].includes(previous.assessment?.version)&&(input.asset!=='apartment'||isValidatedMap(previous.map)&&(input.asOf!==todayKst()||require('./regional-park.cjs').verified(previous.assessment.evidence.nature,{center:previous.assessment.evidence.center,asOf:input.asOf})&&require('./shopping.cjs').current(previous.assessment.evidence,input)&&require('./shopping.cjs').dailyCurrent(previous.assessment.evidence,input)&&require('./secondary-schools.cjs').current(previous.assessment.evidence,input)&&require('./living-access.cjs').current(previous.assessment.evidence,input)))&&(automaticReuse||!/교육|학교|상권|마트|병원|학원|평가|근거|지도|검색|조회/.test(input.request.slice(previous.input.request.length)));
      let research={tools:[],issues:[],checks:[]},scoreEvidence;
      if(priorReady){
        scoreEvidence=scoring.collectEvidence({input,prices,previous:previous.assessment.evidence});const raw=[];
        for(const deal of ['trade','rent'])try{raw.push({deal,bytes:(await fs.readFile(path.join(dir,'raw',`RTMS-${deal}.csv`))).toString('base64')});}catch(e){if(e.code!=='ENOENT')throw e;}
        const supplemented=await researchEngine.ensureLivingEvidence(this.bridge,input,prices,{previous:scoreEvidence,raw,signal:controller.signal,readTrail:this.readTrail,cache:this.researchCache,forceRefresh:refreshPublic,onProgress:message=>this.onEvent({stage:'research',message})});scoreEvidence=supplemented.evidence;research=supplemented.research;
      }
      else{
        let raw=collected.raw||[];
        if(reuse){raw=[];for(const deal of ['trade','rent'])try{raw.push({deal,bytes:(await fs.readFile(path.join(this.store.path(previous.id),'raw',`RTMS-${deal}.csv`))).toString('base64')});}catch{}}
        research=await researchEngine.collectResearch(this.bridge,input,prices,{raw,signal:controller.signal,readTrail:this.readTrail,cache:this.researchCache,forceRefresh:refreshPublic,onProgress:message=>this.onEvent({stage:'research',message})});
        scoreEvidence=scoring.collectEvidence({input,prices,tools:research.tools,school:research.school,livingAccess:research.livingAccess,nearbyContext:research.nearbyContext,nature:research.nature,natureAccess:research.natureAccess,peers:research.peers,listings:research.listings});
      }
      if(priorReady){const extra=await researchEngine.ensureNearbyEvidence(this.bridge,input,prices,{previous:scoreEvidence,tools:research.tools,signal:controller.signal,cache:this.researchCache});scoreEvidence=extra.evidence;researchEngine.appendResearch(research,extra.research);}
      scoreEvidence=scoring.assessScores({scores:[]},{input,prices,previousEvidence:scoreEvidence,dataCheckedAt}).assessment.evidence;
      for(const [file,field]of [['living-access.json','livingAccess'],['shopping-evidence.json','shopping'],['nearby-context.json','nearbyContext']])await fs.writeFile(path.join(dir,'raw',file),JSON.stringify(scoreEvidence[field]||{},null,2));
      await this.supplementNaver(input,prices,scoreEvidence,{signal:controller.signal,forceRefresh:refreshPublic});if(prices.naverNearby)await fs.writeFile(path.join(dir,'raw','naver-nearby.json'),JSON.stringify(prices.naverNearby,null,2));
      const future=require('./future-developments.cjs'),futureDevelopments=await require('./research-cache.cjs').publicSnapshot(this.researchCache,input,prices,'futureDevelopments',()=>future.collect(this.bridge,input,{center:scoreEvidence.center,previous:reuse?previous.futureDevelopments:null,signal:controller.signal,onProgress:message=>this.onEvent({stage:'research',message}),...selected,cache:batchContext?.futureCache}),v=>future.current(v,input,scoreEvidence.center),{forceRefresh:refreshPublic});
      scoreEvidence=future.excludeScheduled(scoreEvidence,futureDevelopments);
      await fs.writeFile(path.join(dir,'raw','future-developments.json'),JSON.stringify(futureDevelopments,null,2));
      this.onEvent({stage:'analysis',message:'확인된 사실과 6개 평가 항목을 정리하고 있습니다.'});
      const request=buildRequest(input,prices,{previous:reuse&&!automaticReuse?previous:null,dataCheckedAt,revisionRequest:reuse&&!automaticReuse?input.request.slice(previous.input.request.length).trim():''});
      const requestBody=JSON.parse(request.prompt);requestBody.verifiedResearch=researchEngine.compactResearch(scoreEvidence);requestBody.researchIssues=research.issues;requestBody.naverNearby=require('./naver-supplement.cjs').sections({input,prices,assessment:{evidence:scoreEvidence}}).map(s=>({heading:s.heading,facts:s.facts.map(f=>({text:f.text,sourceUrl:f.sourceUrl,checkedAt:f.checkedAt})),sources:s.sources}));request.prompt=JSON.stringify(requestBody);request.instructions+='\n앱이 공식 통학구역·대형마트·병원·학원·주변 시설·지도를 직접 조회했다. verifiedResearch의 실제 facts/status/source를 사용하고 외부 도구가 보이지 않는다는 이유로 확인된 사실을 보류하지 않는다. 이미 제공된 내용을 재조회하지 않는다. source는 실제 제공된 URL만 쓰고 확인되지 않은 주장을 채우지 않는다. 점수는 앱이 계산하므로 scores.score는 null로 둔다.';
      // 수정은 원래 질문을 다시 보내지 않고 이번 요청과 필요한 이전 본문만 보낸다.
      if(reuse&&!automaticReuse){const body=JSON.parse(request.prompt);body.request.request=body.revisionRequest;delete body.revisionRequest;request.prompt=JSON.stringify(body);}
      let result,parsed,lastIssue='',attempts=0;const usage=[];
      for(let attempt=0;attempt<2;attempt++){
        const repair=attempt?this.repairModel(status.models,selected):null;
        if(attempt&&!repair)break;
        const choice=attempt?repair:selected;attempts++;
        const editOnly=reuse&&!automaticReuse&&!/최신|조회|검색|지도|근거|새로운|세금|대출|규제|새\s*사실/.test(input.request.slice(previous.input.request.length));
        if(controller.signal.aborted)throw new Error('분석을 중지했습니다.');
        try{result=await this.bridge.analyze({...request,prompt:request.prompt+(attempt?'\n필수 구조 보완: '+lastIssue:''),schema:reportSchema,externalTools:/세금|대출|규제|법률|개발계획/.test(input.request)&&!editOnly,...choice,signal:controller.signal});}
        catch(error){if(controller.signal.aborted)throw new Error('분석을 중지했습니다.');if(error.code!=='AI_INVALID_RESPONSE')throw error;usage.push({model:choice.model,effort:choice.effort,tokens:error.tokenUsage||null,invalidResponse:true});lastIssue='보고서 JSON 형식을 완성해 주세요.';parsed=null;continue;}
        usage.push({model:choice.model,effort:choice.effort,tokens:result.tokenUsage||null});
        if(controller.signal.aborted)throw new Error('분석을 중지했습니다.');
        try{parsed=JSON.parse(result.text.replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,''));const problems=qualityIssues(parsed);if(problems.length)throw new Error(problems.join(', '));lastIssue='';break;}catch(e){lastIssue=String(e.message).slice(0,250);parsed=null;}
      }
      if(!parsed)throw new Error('보고서 필수 내용이 부족해 저장하지 않았습니다. 원자료는 보관했습니다. 요청을 구체화해 다시 시도해 주세요.');
      const evidence=require('./evidence-guard.cjs');
      const names=[...scoreEvidence.places,...(scoreEvidence.natureAccess?.trails||[]),...Object.values(scoreEvidence.livingAccess?.groups||{}).flatMap(g=>g.categories||[]).flatMap(c=>c.place?[c.place]:c.nearest?[c.nearest]:[])].flatMap(p=>[p.name,...(p.name.match(/[가-힣]+\d+호선/g)||[])]);
      const narrative=evidence.guardNarrative(parsed,{identifiers:[...evidence.verifiedIdentifiers(input,prices),...names]});
      narrative.report=future.sanitizeNarrative(narrative.report,futureDevelopments);
      const assessed=scoring.assessScores(narrative.report,{input,prices,previousEvidence:scoreEvidence,dataCheckedAt});
      const naverSources=require('./naver-supplement.cjs').sources({input,prices,assessment:assessed.assessment});
      const validated=validateReport({...narrative.report,scores:assessed.scores,sources:evidence.alignSourceDates([...(narrative.report.sources||[]),...assessed.sources,...naverSources],{verifiedSources:[...assessed.sources,...naverSources],dataCheckedAt})});
      await fs.writeFile(path.join(dir,'raw','score-evidence.json'),JSON.stringify(assessed.assessment,null,2));

      if(!validated.report.strengths.length)validated.report.strengths=['현재 확보한 근거로 확인된 장점이 없습니다.'];
      if(!validated.report.limitations.length)validated.report.limitations=['개별 매물의 현장 상태와 권리관계는 별도 확인이 필요합니다.'];
      this.onEvent({stage:'validation',message:'가격·평가 항목·지도 첨부 여부를 확인하고 있습니다.'});
      let map=null;if(this.captureMap&&research.tools.length)try{map=await this.captureMap([...research.tools,...(result.tools||[])],dir,{targets:scoreEvidence.center?[{name:input.building||input.target,...scoreEvidence.center}]:[],signal:controller.signal});}catch(e){if(controller.signal.aborted)throw e;map={status:'unavailable',file:null,reason:e.message};}
      if(!map?.file&&reuse&&isValidatedMap(previous.map)){try{await fs.copyFile(path.join(this.store.path(previous.id),'figures',path.basename(previous.map.file)),path.join(dir,'figures',path.basename(previous.map.file)));map=previous.map;}catch{}}
      const issues=[...validated.issues,...research.issues,...collected.coverage.filter(c=>c.status==='error').map(c=>c.message)];
      if(narrative.notice)issues.push(narrative.notice);if(narrative.rejected.some(x=>x.field==='title'))validated.report.title=(input.building||input.target)+' 분석 보고서';
      if(input.selectedAreas?.length){validated.report.title=`${input.building||input.target} · ${input.selectedAreas.map(a=>a+'㎡').join('·')} 분석`;issues.push('체크한 전용면적의 개별 계약을 합쳐 산술평균했습니다. 거래가 없는 선택 면적은 임의 대체하지 않았습니다.');for(const area of input.selectedAreas)if(!prices.rows.some(t=>Math.abs(t.area-area)<0.000001))issues.push(`${area}㎡: 선택한 거래 유형·기간에 유효 거래가 없습니다.`);}
      if(prices.areaResolution)issues.push(`요청 ${prices.areaResolution.requested}타입 → 적용 ${prices.areaResolution.applied}타입. ${prices.areaResolution.reason}`);
      if(input.asset==='apartment'&&!map?.file)issues.push('입지톡 지도 미첨부: '+(map?.reason||research.issues[0]||'공식 단지 지도 주소를 확보하지 못했습니다.')+' 지도 다시 불러오기로 재시도할 수 있습니다.');
      if(!prices.rows.length)issues.push('비교 가능한 유효 거래가 없어 가격 평균을 산출하지 못했습니다.');
      if(controller.signal.aborted)throw new Error('분석을 중지했습니다.');
      const report=await this.store.save({...validated.report,trend,futureDevelopments,assessment:assessed.assessment,research:{version:VERSION,checks:research.checks,issues:research.issues,metrics:research.metrics,requestBudget:this.bridge.evidenceBudget?.snapshot()},id,input,consultation:consultation.getConsultation({input,consultation:snapshot?{...snapshot,customer:input.customer}:undefined}),prices,map,issues,status:issues.length?'검토 필요':'초안',createdAt:new Date().toISOString(),provider:this.settings.provider||'gpt',aiGrounding:{webSearches:result.webSearches||[]},model:usage.at(-1).model,threadId:result.threadId,revisionOf:revisionId||null,...(automaticReuse?{sameDayReuse:automaticReuse}:{}),dataCheckedAt,requestFingerprint:key,mapConnected:status.mapConnected,optimization:{promptVersion:VERSION,attempts,reusedEvidence:!!reuse,inputCharacters:request.prompt.length+request.instructions.length,research:research.metrics,requestBudget:this.bridge.evidenceBudget?.snapshot(),usage},
        ...(batchContext?{typeBatch:{id:batchContext.batchId,index:batchContext.index,total:batchContext.total,thresholdSqm:batchContext.thresholdSqm,selectedAreas:input.selectedAreas},typeCatalog:{source:batchContext.catalog.source,sourceName:batchContext.catalog.sourceName,checkedAt:batchContext.catalog.checkedAt,scope:batchContext.catalog.scope}}:previous?.typeCatalog?{typeCatalog:previous.typeCatalog}:{}),verification:{numericCheck,numericClaimsRejected:narrative.rejected,data:'기간·해제·중복·면적·단지·그룹별 건수·산술평균의 독립 대조',content:'거래표 수치는 원자료와 대조했습니다. AI 본문의 미검증 정량 설명은 제외했습니다. 원자료의 신고 지연·정정 가능성과 출처·현장·권리관계는 최종 확인이 필요합니다.',exports:'PDF는 앱의 인쇄 엔진 사용. 편집용 Word·Excel·PPT의 최종 배치는 해당 앱에서 확인 필요'}});
      this.onEvent({stage:'done',message:'보고서 초안을 저장했습니다.',reportId:id});return report;
    }finally{if(!batchContext)this.active=null;}
  }
  async cancel(){this.active?.controller.abort();await this.bridge.interrupt();}
  async demo(){const input=normalizeInput({target:'사용 예시 · 가상아파트',area:84,asOf:todayKst()});const prices=aggregate([],input,[]);return this.store.save({id:randomUUID(),title:'보고서 구성 미리보기',conclusion:'주소와 요청을 입력하면 확인된 근거와 함께 상담용 보고서를 만듭니다.',highlights:['이 화면은 사용법을 보여주는 예시입니다.','실제 가격·위치·평가 점수는 포함하지 않았습니다.'],input,prices,strengths:['확인된 장점과 그 근거를 여기에 정리합니다.'],limitations:['판단을 바꿀 수 있는 제약과 미확인 사항을 함께 표시합니다.'],checks:['지도와 시설 위치','최근 거래의 면적·층·계약일','현장 상태와 권리관계'],sections:[{heading:'고객에게 설명할 선택 기준',body:'목적과 예산에 맞춰 어떤 조건을 우선 확인할지 짧게 정리합니다.'}],scores:SCORE_ITEMS.map(name=>({name,score:null,reason:'예시 화면이므로 평가하지 않았습니다.',method:'',sourceIds:[]})),sources:[],issues:['사용법 안내를 위한 가상 예시입니다. 실제 매물 보고서로 사용하지 마세요.'],map:null,status:'사용 예시',demo:true,createdAt:new Date().toISOString(),verification:{content:'가상 예시',exports:'실제 자료 없음'}});}
}
module.exports={AnalysisService};

