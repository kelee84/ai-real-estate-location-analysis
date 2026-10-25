'use strict';
require('./stdio.cjs').install();
const {app,BrowserWindow,ipcMain,protocol,net,shell,dialog,session,nativeImage,clipboard,safeStorage}=require('electron');
const fs=require('node:fs/promises'),fsSync=require('node:fs'),path=require('node:path'),os=require('node:os');
const {pathToFileURL}=require('node:url');const backupEngine=require('./backup.cjs');
const {CodexBridge,findBinary}=require('./codex.cjs');const {RtmsClient}=require('./data.cjs');
const {ReportStore}=require('./store.cjs');const {AnalysisService}=require('./service.cjs');const exportsEngine=require('./report.cjs');
const {safeName,todayKst}=require('./core.cjs');
const {issueCode}=require('./activation.cjs');const {createActivation}=require('./release-policy.cjs');const {loadOwnerKey}=require('./issuer-store.cjs');
const {publicKey}=require('./activation-public.json');
const brand=require('./brand.cjs');
const {trustedMainSender}=require('./ipc-sender.cjs');
protocol.registerSchemesAsPrivileged([{scheme:'helper',privileges:{standard:true,secure:true,supportFetchAPI:true}}]);
const smoke=process.argv.includes('--smoke-test');
const issuerMode=process.argv.includes('--issue-activation'),mainPage=issuerMode?'helper://app/issuer.html':'helper://app/index.html';
if(smoke)app.setPath('userData',path.join(os.tmpdir(),'re-helper-smoke-'+process.pid));
else if(issuerMode)app.setPath('userData',path.join(app.getPath('appData'),'real-estate-helper-issuer'));
app.setName('부동산 도우미');
let win,bridge,service,store,workspace,reportRoot,activation,detailEvidence,exportSummary,exportLocation,lastIssued='';const supportEvents=[];
if(!issuerMode&&!smoke&&!app.requestSingleInstanceLock())app.quit();
app.on('second-instance',()=>{if(win){if(win.isMinimized())win.restore();win.focus();}});
function send(data){if(win&&!win.isDestroyed())win.webContents.send('helper:event',data);}
function safeHttps(value){try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password?u.href:null;}catch{return null;}}
const captureMap=require('./map-capture.cjs').createMapCapture({BrowserWindow,nativeImage,onEvent:send});
function handle(channel,fn){ipcMain.handle('helper:'+channel,async(event,...args)=>{
  if(!trustedMainSender(event,win,mainPage))return {ok:false,error:'이 화면에서 허용되지 않는 요청입니다.'};
  try{if(!issuerMode&&!['app-info','support','copy-email','activation-status','activate','copy-request'].includes(channel))await activation.require();return {ok:true,data:await fn(...args)};}catch(e){return {ok:false,error:e.message||'작업을 완료하지 못했습니다.'};}
});}
async function exportReport(id,format,forcedPath){
  if(!['html','pdf','docx','xlsx','pptx'].includes(format))throw new Error('지원하지 않는 저장 형식입니다.');
  const r=await service.presentationReport(id),image=await exportsEngine.mapData(r,store);
  let file=forcedPath;
  if(!file){const choice=await dialog.showSaveDialog(win,{title:'보고서 저장',defaultPath:await exportLocation.defaultPath(`${safeName(r.input.selectedAreas?.length?r.title:r.input.target)}_${r.input.asOf}.${format}`),filters:[{name:format.toUpperCase()+' 파일',extensions:[format]}]});if(choice.canceled)return null;file=choice.filePath;}
  if(format==='html')await fs.writeFile(file,exportsEngine.html(r,image),'utf8');
  else if(format==='pdf'){
    const temp=path.join(store.path(id),'print.html');await fs.writeFile(temp,exportsEngine.html(r,image),'utf8');
    const printWindow=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
    try{await printWindow.loadFile(temp);await printWindow.webContents.executeJavaScript('document.fonts.ready.then(()=>true)');const printed=await require('./report-pagination.cjs').printBalanced(printWindow);await fs.writeFile(file,printed.buffer);await fs.mkdir(path.join(store.path(id),'raw'),{recursive:true});await fs.writeFile(path.join(store.path(id),'raw','pdf-pagination.json'),JSON.stringify({...printed.layout,checkedAt:new Date().toISOString()},null,2));}finally{printWindow.destroy();}
  }else if(format==='docx')await exportsEngine.word(r,file,image);
  else if(format==='xlsx')await exportsEngine.excel(r,file,image);
  else if(format==='pptx')await exportsEngine.powerpoint(r,file,image,path.join(workspace,'.agents','skills','last-ppt-template','assets','TTTM_분석프로그램_설계서_기본템플릿.pptx'));
  if(!forcedPath)await exportLocation.remember(file);
  return {file,format,note:['docx','pptx'].includes(format)?'편집용 파일을 저장했습니다. 고객에게 전달하기 전에 Word 또는 PowerPoint에서 배치를 확인해 주세요.':format==='xlsx'?'계산값과 수식을 저장했습니다. Excel에서 열 때 수식을 다시 계산합니다.':'파일을 저장했습니다.'};
}
async function backup(){const choice=await dialog.showSaveDialog(win,{title:'보고서 백업',defaultPath:path.join(app.getPath('documents'),`부동산보고서_${todayKst()}.rehbackup`),filters:[{name:'부동산 도우미 백업',extensions:['rehbackup']}]});if(choice.canceled)return null;await fs.writeFile(choice.filePath,await backupEngine.pack(store));return {file:choice.filePath,count:(await store.list()).length};}
async function restore(){const choice=await dialog.showOpenDialog(win,{title:'보고서 복원',filters:[{name:'부동산 도우미 백업',extensions:['rehbackup']}],properties:['openFile']});if(choice.canceled)return null;const stat=await fs.stat(choice.filePaths[0]);if(stat.size>100*1024*1024)throw new Error('백업 파일이 너무 큽니다.');return backupEngine.unpack(store,await fs.readFile(choice.filePaths[0]));}
async function ready(){
  const userData=app.getPath('userData');await fs.mkdir(userData,{recursive:true});
  exportLocation=require('./export-location.cjs').createExportLocation({file:path.join(userData,'export-preferences.json'),fallbackDirectory:app.getPath('documents')});
  activation=createActivation({file:path.join(userData,'activation.json'),publicKey},{issuer:issuerMode});
  workspace=app.isPackaged?path.join(process.resourcesPath,'workspace'):path.resolve(__dirname,'../resources/workspace');
  reportRoot=smoke?path.join(userData,'reports'):path.join(app.getPath('documents'),'부동산 도우미','보고서');
  store=new ReportStore(reportRoot,{afterSave:async r=>{if(!r.demo)try{send({stage:'validation',message:'상세 배점과 전체 근거 PDF를 만들고 있습니다.'});await detailEvidence.ensure(r.id);}catch(error){send({stage:'evidence-error',message:'분석 보고서는 저장했습니다. 상세 근거 PDF 생성 실패: '+error.message,reportId:r.id});}}});
  exportSummary=require('./summary-export.cjs').createSummaryExporter({BrowserWindow,store,loadReport:id=>service.presentationReport(id),onSaved:file=>exportLocation.remember(file),chooseFile:async({name,format})=>{const choice=await dialog.showSaveDialog(win,{title:'고객용 핵심 요약본 저장',defaultPath:await exportLocation.defaultPath(name),filters:[{name:format==='png'?'PNG 이미지':format.toUpperCase()+' 파일',extensions:[format]}]});return choice.canceled?null:choice.filePath;}});
  detailEvidence=require('./detail-evidence.cjs').createManager({store,BrowserWindow,openPath:smoke?async file=>{supportEvents.push({type:'evidence-open',file});return '';}:file=>shell.openPath(file)});
  const codex=new CodexBridge({binary:findBinary(process.resourcesPath,app.isPackaged),home:!app.isPackaged&&process.env.RE_HELPER_CODEX_HOME?process.env.RE_HELPER_CODEX_HOME:path.join(userData,'codex'),cwd:path.join(userData,'analysis')});
  const credentials=new (require('./ai-credentials.cjs').CredentialStore)({file:path.join(userData,'gemini-key.enc'),safeStorage});
  const claudeCredentials=new (require('./ai-credentials.cjs').CredentialStore)({file:path.join(userData,'claude-key.enc'),safeStorage,provider:'claude'});
  bridge=new (require('./ai-bridge.cjs').AiBridge)({codex,credentials,claudeCredentials,gemini:new (require('./gemini.cjs').GeminiBridge)({getApiKey:()=>credentials.readApiKey()}),claude:new (require('./claude.cjs').ClaudeBridge)({getCredentials:()=>claudeCredentials.readConnection()}),ipzitalk:new (require('./ipzitalk-bridge.cjs').IpzitalkBridge)({userData,safeStorage})});
  service=new AnalysisService({bridge,data:new RtmsClient(),store,workspace,userData,onEvent:send,captureMap});service.readTrail=require('./public-trails.cjs').createPublicTrailReader({BrowserWindow});await service.init();
  protocol.handle('helper',async request=>{
    const u=new URL(request.url);
    if(u.hostname==='grounding')try{await activation.require();const r=await store.load(u.pathname.slice(1));return new Response(require('./grounding-view.cjs').html(r),{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src https: data:; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"}});}catch{return new Response('검색 참고 정보를 열 수 없습니다.',{status:404});}
    if(['report','summary'].includes(u.hostname))try{await activation.require();const id=u.pathname.slice(1);const r=await service.presentationReport(id);const renderer=u.hostname==='summary'?require('./customer-summary.cjs'):exportsEngine;return new Response(renderer.html(r,await exportsEngine.mapData(r,store)),{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}});}catch{return new Response('보고서를 열 수 없습니다.',{status:404});}
    if(u.hostname!=='app')return new Response('Not found',{status:404});
    const relative=decodeURIComponent(u.pathname).replace(/^\//,''),base=path.resolve(__dirname,'web'),file=path.resolve(base,relative||'index.html');
    if(!file.startsWith(base+path.sep))return new Response('Not found',{status:404});
    return net.fetch(pathToFileURL(file).href);
  });
  session.defaultSession.setPermissionRequestHandler((_w,_p,callback)=>callback(false));
  const windowTitle=`${issuerMode?'인증번호 발급기 · ':''}${brand.PRODUCT} · ${brand.NAME} · v${brand.VERSION}`;
  win=new BrowserWindow({width:issuerMode?750:1380,height:issuerMode?820:920,minWidth:issuerMode?600:1000,minHeight:720,show:!smoke,title:windowTitle,icon:path.join(__dirname,'web/assets/app.png'),backgroundColor:require('./brand-theme.cjs').colors.cream,autoHideMenuBar:true,webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:!smoke}});
  win.on('page-title-updated',event=>event.preventDefault());
  win.webContents.setWindowOpenHandler(({url})=>{if(safeHttps(url))shell.openExternal(url);return {action:'deny'};});
  win.webContents.on('will-navigate',(event,url)=>{if(url!==mainPage)event.preventDefault();});
  handle('app-info',()=>brand.info());
  handle('support',async kind=>{const url=brand.supportTarget(kind);if(smoke)supportEvents.push(url);else await shell.openExternal(url);return true;});
  handle('copy-email',async()=>{await clipboard.writeText(brand.EMAIL);return true;});
  if(issuerMode){
    async function issuerKey(){
      try{return await loadOwnerKey(safeStorage,publicKey);}catch(error){
        // 경로·실패 코드만 남긴다. 개인키·암호문·발급 번호는 기록하지 않는다.
        const diagnostic={checkedAt:new Date().toISOString(),user:os.userInfo().username,...error.diagnostics};
        await fs.writeFile(path.join(userData,'issuer-diagnostic.json'),JSON.stringify(diagnostic,null,2)).catch(()=>{});throw error;
      }
    }
    handle('issuer-status',async()=>{await issuerKey();return {ready:true};});
    handle('issue',async request=>{const key=await issuerKey();lastIssued=issueCode(request,key);return {code:lastIssued};});
    handle('copy-code',async()=>{if(!lastIssued)throw new Error('먼저 인증번호를 발급해 주세요.');await clipboard.writeText(lastIssued);return true;});
    await win.loadURL(mainPage);
    if(smoke){try{await require('../tests/electron-smoke.cjs').runIssuer({win,output:process.env.RE_HELPER_TEST_OUTPUT||path.resolve(__dirname,'../../.build/issuer-smoke'),request:(await activation.status()).requestCode,publicKey});app.exit(0);}catch(e){console.error(e.stack);app.exit(1);}}
    return;
  }
  handle('activation-status',()=>activation.status());handle('activate',code=>activation.activate(code));handle('copy-request',async()=>{await clipboard.writeText((await activation.status()).requestCode);return true;});
  service.readNaverPage=require('./naver-page.cjs').createNaverPageReader({BrowserWindow});
  service.findNaverComplex=require('./naver-discovery.cjs').createNaverComplexFinder({BrowserWindow,readPage:service.readNaverPage});
  service.readNaverNearby=require('./naver-nearby.cjs').createNaverNearbyReader({BrowserWindow});
  service.readNaverWalking=require('./naver-walking.cjs').createNaverWalkingReader({BrowserWindow});
  handle('import-naver-link',url=>service.importNaverLink(url));
  handle('import-naver-land',async()=>{
    if(service.active)throw new Error('진행 중인 분석이 끝난 뒤 불러와 주세요.');
    const choice=await dialog.showOpenDialog(win,{title:'네이버 부동산 조회정보 불러오기',filters:[{name:'저장한 네이버 단지 조회정보',extensions:['json']}],properties:['openFile']});
    if(choice.canceled)return null;
    const file=choice.filePaths[0],stat=await fs.stat(file);if(stat.size>1024*1024)throw new Error('조회정보 파일은 1MB 이하만 불러올 수 있습니다.');
    let value;try{value=JSON.parse((await fs.readFile(file,'utf8')).replace(/^\uFEFF/,''));}catch{throw new Error('네이버 단지 조회 결과를 저장한 JSON 파일을 선택해 주세요.');}
    return service.importNaverLand(value);
  });
  handle('search-types',input=>bridge.evidenceBudget.run({},()=>service.searchTypes(input)));handle('select-property',input=>bridge.evidenceBudget.run({},()=>service.selectProperty(input)));handle('status',()=>service.status());handle('usage',()=>service.usage());handle('ipzitalk-usage',()=>({...service.bridge.ipzitalkUsage?.snapshot(),requestBudget:bridge.evidenceBudget.snapshot()}));handle('list',()=>store.list());handle('load',async id=>{const r=await service.presentationReport(id);if(!r.demo)detailEvidence.ensure(id).catch(error=>send({stage:'evidence-error',message:'상세 근거 PDF 생성 실패: '+error.message,reportId:id}));return r;});handle('generate',(input,options)=>service.run(input,options));handle('retry-map',id=>bridge.evidenceBudget.run({},()=>require('./map-repair.cjs').repairMap(service,id)));handle('refresh-scores',id=>bridge.evidenceBudget.run({},()=>require('./score-refresh.cjs').refreshScores(service,id)));handle('cancel',()=>service.cancel());handle('demo',()=>service.demo());
  handle('open-evidence',id=>detailEvidence.open(id));
  handle('login',async()=>{const result=await service.login(),url=safeHttps(result.authUrl);if(!url||!['auth.openai.com','chatgpt.com','chat.openai.com'].includes(new URL(url).hostname))throw new Error('공식 로그인 주소를 확인하지 못했습니다.');await shell.openExternal(url);return {started:true};});
  handle('map-usage',async()=>{const url='https://ipji-talk.com/dashboard';if(smoke)supportEvents.push(url);else await shell.openExternal(url);return true;});
  handle('map-login',async()=>{const result=await service.mapLogin(),url=safeHttps(result.authorizationUrl||result.authUrl);if(!url)throw new Error('지도 로그인 주소를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.');await shell.openExternal(url);return {started:true};});
  handle('logout',()=>{if(service.active)throw new Error('진행 중인 작업이 끝난 뒤 연결을 해제해 주세요.');return bridge.request('account/logout',{});});handle('settings',x=>service.saveSettings(x));
  handle('gemini-connect',payload=>service.configureGemini('connect',typeof payload==='string'?payload:payload?.apiKey));handle('gemini-check',()=>service.configureGemini('check'));handle('gemini-disconnect',()=>service.configureGemini('disconnect'));
  handle('claude-connect',payload=>service.configureClaude('connect',payload));handle('claude-check',()=>service.configureClaude('check'));handle('claude-disconnect',()=>service.configureClaude('disconnect'));
  handle('export',(id,format)=>exportReport(id,format));handle('folder',async id=>{const dir=id?store.path(id):reportRoot;await fs.mkdir(dir,{recursive:true});await shell.openPath(dir);return true;});
  handle('save-consultation',(id,payload)=>service.saveConsultation(id,payload));
  handle('export-summary',(id,format)=>exportSummary(id,format));
  handle('copy-summary',async id=>{const r=await service.presentationReport(id);await clipboard.writeText(require('./customer-summary.cjs').text(r));return true;});
  handle('open',async value=>{const url=safeHttps(value);if(!url)throw new Error('안전한 HTTPS 주소만 열 수 있습니다.');await shell.openExternal(url);return true;});
  handle('backup',backup);handle('restore',restore);
  bridge.on('connection-error',message=>send({stage:'connection-error',message}));
  await win.loadURL('helper://app/index.html');
  if(smoke){try{await require('../tests/electron-smoke.cjs').run({app,win,service,store,exportReport,exportSummary,supportEvents,output:process.env.RE_HELPER_TEST_OUTPUT||(app.isPackaged?path.join(app.getPath('temp'),'re-helper-packaged-test'):path.resolve(__dirname,'../../.build/smoke'))});app.exit(0);}catch(e){console.error(e.stack);app.exit(1);}}
}
app.whenReady().then(ready).catch(error=>{if(smoke){console.error(error.stack);app.exit(1);}else dialog.showErrorBox('부동산 도우미를 시작하지 못했습니다.',error.message+'\n설치 파일을 다시 실행해 주세요.');});
app.on('before-quit',()=>bridge?.stop());app.on('window-all-closed',()=>app.quit());
module.exports={safeHttps};


