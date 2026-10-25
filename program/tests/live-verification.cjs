'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
exports.run=async({store,exportReport,output})=>{
 const {CodexBridge,findBinary}=require('../src/codex.cjs'),{RtmsClient}=require('../src/data.cjs'),{AnalysisService}=require('../src/service.cjs'),{app,BrowserWindow,nativeImage}=require('electron');
 const root=path.join(output,'native-live');await fs.mkdir(root,{recursive:true});
 const input=JSON.parse(await fs.readFile(process.env.RE_HELPER_LIVE_INPUT,'utf8'));
 const bridge=new CodexBridge({binary:findBinary(process.resourcesPath,app.isPackaged),home:path.join(os.homedir(),'AppData/Roaming/부동산 도우미/codex'),cwd:path.join(root,'analysis')});
 try{
  let r,reusedSnapshot=false;
  if(process.env.RE_HELPER_LIVE_REUSE_REPORT){
   const sourceFile=path.resolve(process.env.RE_HELPER_LIVE_REUSE_REPORT),source=JSON.parse(await fs.readFile(sourceFile,'utf8'));
   assert.ok(source.verification?.numericCheck?.passed,'검증된 실제 거래 스냅샷이 필요합니다.');
   for(const field of ['target','building','asset','asOf','area'])assert.equal(source.input[field],input[field],'재출력 대상 조건 불일치: '+field);
   const numericCheck=require('../src/evidence-guard.cjs').assertVerifiedPrices(source.prices,source.input);
   if(process.env.RE_HELPER_REFRESH_NATURE==='1'){
    const nature=await require('../src/regional-park.cjs').queryRegionalPark({center:source.assessment.evidence.center,identity:source.prices.buildingResolution,asOf:source.input.asOf});assert.equal(nature.status,'verified',nature.reason);source.assessment.evidence.nature=nature;source.assessment.evidence.sources.push(nature.source);source.sources.push(nature.source);source.assessment.version='presentation-refresh';
   }
   r={...require('../src/scoring.cjs').prepareReport(source),id:require('node:crypto').randomUUID(),createdAt:new Date().toISOString(),verification:{...source.verification,numericCheck,presentationRevisionOf:source.id}};
   await fs.cp(path.dirname(sourceFile),store.path(r.id),{recursive:true,errorOnExist:true,force:false});
   if(process.env.RE_HELPER_REFRESH_NATURE==='1'){
    const ev=r.assessment.evidence,p=ev.nature.selected,session=await bridge.evidenceSession(),markers=[{...ev.center,name:r.input.building||r.input.target,color:'Red',info:'분석 대상 · 공식 단지 기준점'},{lat:p.lat,lng:p.lng,name:p.name,color:'Green',info:'지역 대표 대형공원 · 공식 면적 '+p.areaM2.toLocaleString('ko-KR')+'㎡'}];
    for(const category of ['school_elementary','subway','mart_large']){const place=ev.places.find(p=>p.category===category);if(place)markers.push({lat:place.lat,lng:place.lng,name:place.name,color:category==='school_elementary'?'Purple':'Blue'});}
    const tool=await bridge.evidenceTool(session,'get_map_embed_url',{markers,center:ev.center,maptype:'normal',title:(r.input.building||r.input.target)+' 지역 대표 공원 입지 분석'});
    r.map=await require('../src/map-capture.cjs').createMapCapture({BrowserWindow,nativeImage})([tool],store.path(r.id),{targets:[{...ev.center,name:r.input.building||r.input.target}]});assert.ok(r.map?.file,'지역 대표 공원 지도 누락');
    r.research.checks.push({tool:'national_regional_park',status:'received'});await fs.writeFile(path.join(store.path(r.id),'raw','regional-park.json'),JSON.stringify(ev.nature,null,2));await fs.writeFile(path.join(store.path(r.id),'raw','regional-park-map.json'),JSON.stringify(tool,null,2));await fs.writeFile(path.join(store.path(r.id),'raw','score-evidence.json'),JSON.stringify(r.assessment,null,2));
   }
   await store.save(r);reusedSnapshot=true;
  }else{
   const service=new AnalysisService({bridge,data:new RtmsClient(),store,userData:root,onEvent:p=>{if(p.message)console.log('LIVE',p.stage,p.message);},captureMap:require('../src/map-capture.cjs').createMapCapture({BrowserWindow,nativeImage})});await service.init();
   r=await service.run({...input,forceRefresh:true},{force:true});
  }
  assert.ok(r.map?.file,'설치본 실제 지도 누락');assert.notEqual(r.scores.find(s=>s.name==='교육 환경').score,null,'설치본 교육 근거 미평가');assert.notEqual(r.scores.find(s=>s.name==='상품 경쟁력').score,null,'설치본 상품 근거 미평가');assert.ok(r.research.checks.some(c=>c.tool==='get_map_embed_url'&&c.status==='received'));
  assert.ok(require('../src/map-capture.cjs').isValidatedMap(r.map),'설치본 지도 배경 시각검증 누락');
  assert.equal(r.scores.length,6,'설치본 6개 평가 항목');assert.ok(!r.scores.some(s=>s.name==='프리미엄 경쟁력'));
  const price=r.scores.find(s=>s.name==='가격 경쟁력');assert.notEqual(price.score,null,'평균가격 기준 자동 평가 누락');assert.equal(r.input.offered,null,'원래 제시가격을 변경하면 안 됩니다.');
  assert.equal(price.priceBasis.kind,'transaction-average');assert.equal(price.priceBasis.requestedKind,'current-listings');assert.equal(price.priceBasis.fallback,true);
  for(const ext of ['html','pdf','docx','xlsx','pptx'])await exportReport(r.id,ext,path.join(root,'report.'+ext));
  const html=await fs.readFile(path.join(root,'report.html'),'utf8');assert.doesNotMatch(html,/프리미엄\s*경쟁력|제출\s*전\s*확인|제약·미확인|신고\s*지연|현재\s*매물\s*호가가\s*아닌|확정\s*거래\s*가능\s*가격/);assert.ok((html.match(/data-source-item/g)||[]).length<=7,'대표 출처 상한');
  await fs.cp(store.path(r.id),path.join(root,'reports',r.id),{recursive:true});
  const pagination=JSON.parse(await fs.readFile(path.join(store.path(r.id),'raw','pdf-pagination.json'),'utf8'));assert.equal(pagination.shortTail,false,'마지막 페이지 7줄 이하 짧은 꼬리');assert.equal(pagination.resolved,true);
  const nature=r.scores.find(s=>s.name==='자연환경');assert.notEqual(nature.score,null,'지역 대표 공원 평가 누락');assert.ok(nature.regionalPark?.areaM2>=100000);assert.ok(html.includes(nature.regionalPark.name));
  const result={passed:true,version:app.getVersion(),windowsNative:true,reusedSnapshot,reportId:r.id,mapValidated:r.map.validation,nature:nature.regionalPark,pagination,scores:r.scores.map(s=>({name:s.name,score:s.score,scope:s.scope,coverage:s.coverage,reason:s.score===null?s.reason:undefined})),research:r.research,numericCheck:r.verification.numericCheck,reportDir:path.join(root,'reports',r.id),exports:['html','pdf','docx','xlsx','pptx']};await fs.writeFile(path.join(root,'verification.json'),JSON.stringify(result,null,2));console.log('NATIVE LIVE PASSED',r.id);return result;
 }finally{bridge.stop();}
};
