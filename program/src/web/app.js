'use strict';
const $=id=>document.getElementById(id),api=window.helper;
// Both start controls submit the same form and share its current UI state.
function syncQuickGenerate(){const source=$('generate'),quick=$('quick-generate');quick.disabled=source.disabled;quick.querySelector('span').textContent=source.querySelector('span').textContent;}
new MutationObserver(syncQuickGenerate).observe($('generate'),{attributes:true,attributeFilter:['disabled'],childList:true,subtree:true,characterData:true});
syncQuickGenerate();
api['app-info']().then(info=>{$('product-credit').textContent=info.makerLine;$('support-version').textContent=`${info.product} v${info.version} · ${info.name} 제작`;}).catch(()=>{});
document.querySelectorAll('[data-support]').forEach(control=>control.addEventListener('click',async event=>{event.preventDefault();try{await api.support(control.dataset.support);}catch(e){toast('문의 창을 열지 못했습니다. 도움말의 이메일 주소를 복사해 이용해 주세요.',true);}}));
$('copy-email').addEventListener('click',async()=>{try{await api['copy-email']();toast('이메일 주소를 복사했습니다.');}catch(e){toast(e.message,true);}});
let state={status:null,reports:[],current:null,busy:false},timer,started,refreshing=false,refreshAgain=false,usageLoading=false,usageEventTimer,settingsSaving=false,connectionSaving=false;
const selectedProvider=()=>state.status?.provider||state.status?.settings?.provider||'gpt';
const providerInfo={gpt:{name:'GPT',automatic:'자동 · 토큰 절약'},gemini:{name:'Gemini',automatic:'자동 · Gemini Flash',issuer:'Google AI Studio',keyUrl:'https://aistudio.google.com/apikey'},claude:{name:'Claude',automatic:'자동 · Claude Sonnet',issuer:'Claude Console',keyUrl:'https://platform.claude.com/settings/keys'}};
const apiProviders=['gemini','claude'],connectionErrors={};
const providerName=provider=>(providerInfo[provider]||providerInfo.gpt).name;
function clearApiKeyInputs(){for(const provider of apiProviders)$(provider+'-api-key').value='';$('claude-workspace-id').value='';}
function fillModels(status){
  const model=status.settings?.model||'';$('model').replaceChildren(new Option((providerInfo[selectedProvider()]||providerInfo.gpt).automatic,''));
  for(const item of status.models||[])$('model').add(new Option(item.name,item.id));
  if(model&&!Array.from($('model').options).some(option=>option.value===model))$('model').add(new Option(model+' · 저장한 모델',model));
  $('model').value=model;
}
function renderProviderControls(){
  const s=state.status||{},provider=selectedProvider(),isApi=apiProviders.includes(provider),locked=state.busy||settingsSaving||connectionSaving;
  $('provider').value=provider;$('provider').disabled=locked;$('model').disabled=locked;$('save-settings').disabled=locked;
  $('settings-dialog').querySelector('[data-close="settings-dialog"]').disabled=settingsSaving||connectionSaving;
  $('gpt-settings').classList.toggle('hidden',isApi);$('logout').classList.toggle('hidden',isApi);
  $('gpt-connection-status').textContent=!isApi&&s.loggedIn?'내 ChatGPT 계정이 연결되어 있습니다.':'ChatGPT 계정으로 로그인해 주세요.';
  $('gpt-login').disabled=locked||(!isApi&&!!s.loggedIn);$('logout').disabled=locked||isApi||!s.loggedIn;
  for(const item of apiProviders){
    const active=provider===item,hasKey=!!s[item]?.hasKey,unavailable=active&&s[item]?.available===false;
    $(item+'-settings').classList.toggle('hidden',!active);
    $(item+'-api-key').disabled=locked||unavailable;$(item+'-connect').disabled=locked||unavailable;$(item+'-check').disabled=locked||!hasKey;$(item+'-disconnect').disabled=locked||!hasKey;
    const firstConnect='API 키를 먼저 입력하고 ‘키 저장하고 연결’을 누르세요.';
    $(item+'-saved-key-hint').textContent=hasKey?(connectionErrors[item]?'이전에 저장한 키는 유지됩니다. 저장한 키로 연결을 확인하거나 삭제할 수 있습니다.':'저장한 키는 다시 입력하지 않고 연결 확인·삭제할 수 있습니다.'):firstConnect+' 저장한 키가 있어야 확인·삭제할 수 있습니다.';
    for(const action of ['check','disconnect'])$(item+'-'+action).title=!hasKey?firstConnect:locked?'진행 중인 작업이 끝나면 사용할 수 있습니다.':action==='check'?'이 PC에 저장한 API 키로 연결을 확인합니다.':'이 PC에 저장한 API 키를 삭제합니다.';
    if(!connectionSaving){const error=connectionErrors[item]||'';$(item+'-connection-status').textContent=error||(unavailable?'이 PC의 보안 저장소를 사용할 수 없습니다. Windows 로그인 상태를 확인한 뒤 프로그램을 다시 열어 주세요.':hasKey?(active&&s.loggedIn?`저장한 API 키로 ${providerName(item)}가 연결되어 있습니다.`:'API 키가 저장되어 있습니다. 연결 확인을 눌러 주세요.'):`이 PC에 저장한 ${providerName(item)} API 키가 없습니다.`);$(item+'-connection-status').classList.toggle('connection-error',!!error||unavailable);}
  }
  $('claude-workspace-id').disabled=locked||(provider==='claude'&&s.claude?.available===false);
  $('model-hint').textContent=provider==='gemini'?'기본은 사용 가능한 Gemini Flash 모델입니다. 직접 선택한 모델은 Gemini 설정에 유지합니다.':provider==='claude'?'기본은 사용 가능한 Claude Sonnet 모델입니다. 직접 선택한 모델은 Claude 설정에 유지합니다.':'기본은 GPT-6 Luna 절약 모드입니다. 필수 내용이 빠진 경우에만 한 번 보완합니다. 직접 선택한 모델은 GPT 설정에 유지합니다.';
  $('provider-hint').textContent=state.busy?'보고서 작성이 끝나면 AI 연결과 모델을 바꿀 수 있습니다.':'선택하면 AI 연결이 바로 바뀝니다. 새로 만드는 보고서부터 적용됩니다.';
  $('login').textContent=isApi?`${providerName(provider)} 연결 ${s.loggedIn?'관리':'설정'}`:(s.loggedIn?'계정 연결됨':'내 계정으로 로그인');$('login').disabled=locked||(!isApi&&!!s.loggedIn);
}
function renderConnection(){
  const s=state.status||{},provider=selectedProvider();$('connection-dot').className='dot'+(!s.connected?' offline':!s.loggedIn?' pending':'');
  $('connection-label').textContent=apiProviders.includes(provider)?(s.loggedIn?`${providerName(provider)} API 연결됨`:!s[provider]?.hasKey?`${providerName(provider)} API 키를 연결해 주세요`:`${providerName(provider)} 연결을 확인해 주세요`):(!s.connected?'연결을 확인해 주세요':!s.loggedIn?'처음 한 번, 내 계정으로 로그인하세요':'내 GPT 계정 연결됨');renderProviderControls();
}
function openSettings(){ConsultationUI.fillSettings(state.status?.settings,true);fillModels(state.status||{});clearApiKeyInputs();renderProviderControls();$('settings-dialog').showModal();}
function renderGoogleGrounding(report){
  const hasEntries=[report,...(report.members||[])].some(item=>[...(item.aiGrounding?.webSearches||[]),...(item.futureDevelopments?.webSearches||[])].some(search=>typeof(search.searchEntryPoint?.renderedContent||search.groundingMetadata?.searchEntryPoint?.renderedContent)==='string'||(search.provider==='claude'&&search.sources?.length>0)));
  $('google-grounding').classList.toggle('hidden',!hasEntries);$('google-grounding').open=hasEntries;
  if(hasEntries)$('google-grounding-frame').src='helper://grounding/'+encodeURIComponent(report.id);else $('google-grounding-frame').removeAttribute('src');
}
function renderIpzitalkUsage(usage){
  const el=$('ipzitalk-usage');if(!el)return;
  el.textContent=usage?.limited?'입지톡 남은 조회: 0회 · 오늘 한도 소진':'입지톡 남은 조회: 확인 불가';
  if(usage?.sessionCalls)el.textContent+=' · 이번 실행 '+usage.sessionCalls+'회 요청';
  if(usage?.requestBudget)el.textContent+=' · 보고서 조회 '+usage.requestBudget.calls+'회 · 자체 횟수 제한 없음';
  el.classList.toggle('usage-low',!!usage?.limited);
  el.title=(usage?.limited?'입지톡에서 일일 한도 초과를 알렸습니다. 다음 날 또는 연결 계정을 확인해 주세요.':'입지톡이 잔여 횟수를 제공하지 않아 추정하지 않습니다. 요청 횟수는 이 프로그램을 실행한 뒤 실제로 보낸 조회이며 재사용은 제외합니다.')+(usage?.checkedAt?' 확인 '+new Date(usage.checkedAt).toLocaleTimeString('ko-KR'):'');
}
async function refreshIpzitalkUsage(){try{renderIpzitalkUsage(await api['ipzitalk-usage']());}catch{renderIpzitalkUsage(null);}}
function renderUsage(usage){
  const provider=selectedProvider(),isApi=apiProviders.includes(provider),name=providerName(provider);$('usage-panel').classList.toggle('hidden',!state.status?.loggedIn);$('usage-windows').replaceChildren();
  $('usage-description').textContent=isApi?`${name} API 사용량·요금`:'내 ChatGPT 계정의 Codex 사용 한도';
  $('usage-hint').textContent=isApi?`${providerInfo[provider].issuer}에서 API 한도와 결제 내역을 확인하세요. 채팅 서비스 구독과 별도로 적용됩니다.`:'분석 후와 1분마다 확인합니다. 계정의 다른 Codex 작업도 함께 반영됩니다.';
  if(isApi){$('usage-label').textContent=`${name} API · 한도는 ${provider==='gemini'?'Google':'Anthropic'}에서 확인`;$('usage-label').classList.remove('usage-low');$('usage-checked').textContent='남은 사용량 비율을 추정하지 않습니다.';return;}
  const windows=usage?.windows||[];
  $('usage-label').textContent=windows.length?'GPT 남은 사용량 · '+windows.map(w=>`${w.label} ${w.remaining}%`).join(' · '):'GPT 남은 사용량 확인 불가';
  $('usage-label').classList.toggle('usage-low',Number.isFinite(usage?.remaining)&&usage.remaining<=20);
  for(const w of windows){const p=document.createElement('p'),line=document.createElement('strong'),reset=document.createElement('small');line.textContent=`${w.label}: ${w.remaining}% 남음`;reset.textContent='초기화 '+new Intl.DateTimeFormat('ko-KR',{month:'numeric',day:'numeric',hour:'numeric',minute:'2-digit'}).format(new Date(w.resetsAt*1000));p.append(line,reset);$('usage-windows').append(p);}
  $('usage-checked').textContent=usage?.checkedAt?'확인 '+new Intl.DateTimeFormat('ko-KR',{hour:'numeric',minute:'2-digit'}).format(new Date(usage.checkedAt)):'연결 확인을 눌러 다시 확인해 주세요.';
}
async function refreshUsage(){if(usageLoading||!state.status?.loggedIn)return;if(apiProviders.includes(selectedProvider())){renderUsage(null);refreshIpzitalkUsage();return;}usageLoading=true;try{const provider=selectedProvider(),usage=await api.usage();if(provider!==selectedProvider())return;state.status.usage=usage;renderUsage(usage);}catch{renderUsage(null);}finally{usageLoading=false;refreshIpzitalkUsage();}}
function toast(message,error=false){const t=$('toast');t.textContent=message;t.className='toast'+(error?' error':'');clearTimeout(toast.timeout);toast.timeout=setTimeout(()=>t.classList.add('hidden'),error?10000:6000);}
function view(name){if(name!=='report'&&!$('view-report').classList.contains('hidden')&&!ConsultationUI.canLeave())return false;document.querySelectorAll('.view').forEach(e=>e.classList.toggle('hidden',e.id!=='view-'+name));document.querySelectorAll('.nav-button').forEach(e=>{const active=e.dataset.view===name||(name==='report'&&e.dataset.view==='history');e.classList.toggle('active',active);if(active)e.setAttribute('aria-current','page');else e.removeAttribute('aria-current');});if(name==='history')loadHistory().catch(e=>toast(e.message,true));window.scrollTo(0,0);if(typeof syncTypePickers==='function')syncTypePickers();return true;}
document.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>view(b.dataset.view)));
document.querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click',()=>{if(b.dataset.close==='settings-dialog')clearApiKeyInputs();$(b.dataset.close).close();}));
async function refresh(){
  if(refreshing){refreshAgain=true;return;}refreshing=true;
  $('refresh').disabled=true;
  try{state.status=await api.status();const s=state.status;renderConnection();renderUsage(s.usage);renderIpzitalkUsage(s.ipzitalkUsage);
    $('map-label').textContent=s.mapConnected?'지도 서비스가 연결되어 있습니다.':'처음 한 번 입지톡 로그인이 필요합니다.';$('map-login').textContent=s.mapConnected?'다시 연결':'지도 연결';
    if(!$('settings-dialog').open){fillModels(s);ConsultationUI.fillSettings(s.settings);}
    if(s.error)toast(s.error,true);
  }catch(e){toast(e.message,true);}finally{$('refresh').disabled=false;refreshing=false;if(refreshAgain){refreshAgain=false;setTimeout(refresh,100);}}
}
$('refresh').addEventListener('click',refresh);
async function refreshConnectionSettings(){while(refreshing)await new Promise(resolve=>setTimeout(resolve,25));await refresh();fillModels(state.status||{});}
async function loginGpt(){if(state.busy||connectionSaving)return;connectionSaving=true;renderProviderControls();try{await api.login();toast('공식 브라우저에서 로그인을 마쳐 주세요. 완료하면 자동으로 연결합니다.');}catch(e){toast(e.message,true);}finally{connectionSaving=false;renderProviderControls();}}
$('login').addEventListener('click',()=>{if(apiProviders.includes(selectedProvider())){openSettings();$(selectedProvider()+'-api-key').focus();}else loginGpt();});
$('gpt-login').addEventListener('click',loginGpt);
$('ipzitalk-usage-link').addEventListener('click',async()=>{try{await api['map-usage']();}catch(e){toast(e.message,true);}});
$('map-login').addEventListener('click',async()=>{try{$('map-login').disabled=true;await api['map-login']();toast('열린 브라우저에서 지도 서비스 로그인을 마쳐 주세요.');}catch(e){toast(e.message,true);}finally{$('map-login').disabled=false;}});
function input(){if(typeof typePickers!=='undefined')typePickers.get('single')?.reconcile();const data=Object.fromEntries(new FormData($('analysis-form')));data.types=[...document.querySelectorAll('[name=types]:checked')].map(e=>e.value);data.customer=ConsultationUI.readCustomer();if(data.analysisMode==='comparison'){data.mode='comparison';data.properties=comparisonInput();}else if(typeof readTypeSelection==='function')Object.assign(data,readTypeSelection('single'));return data;}
function showNaverImport(record){
  $('naver-land-status').textContent=record.name+' · '+record.address+' · 조회 '+new Date(record.checkedAt).toLocaleString('ko-KR');
  if(document.querySelector('[name=analysisMode]:checked')?.value!=='comparison'){$('target').value=record.address+' '+record.name;$('target').dispatchEvent(new Event('input',{bubbles:true}));$('building').value=record.name;$('building').dispatchEvent(new Event('input',{bubbles:true}));}
  toast('네이버 단지정보를 저장했습니다. 공식 단지와 대조한 뒤 재사용합니다.');
}
$('import-naver-link').addEventListener('click',async()=>{
  if(state.busy)return;const button=$('import-naver-link');button.disabled=true;$('generate').disabled=true;
  $('naver-land-status').textContent='네이버 단지 페이지에서 공개 정보를 읽고 있습니다…';
  try{const record=await api['import-naver-link']($('naver-land-url').value);if(record)showNaverImport(record);}
  catch(error){$('naver-land-status').textContent=error.message;toast(error.message,true);}
  finally{button.disabled=false;$('generate').disabled=state.busy;}
});
$('import-naver-land').addEventListener('click',async()=>{
  const button=$('import-naver-land');button.disabled=true;
  try{const record=await api['import-naver-land']();if(!record)return;
    showNaverImport(record);
  }catch(error){toast(error.message,true);}finally{button.disabled=false;}
});
function busy(value){state.busy=value;renderProviderControls();$('generate').disabled=value;$('guide-panel').classList.toggle('hidden',value);$('progress-panel').classList.toggle('hidden',!value);$('analysis-form').querySelectorAll('input,textarea,select,button').forEach(e=>e.disabled=value);$('ipzitalk-usage-link').disabled=false;if(!value&&typeof updateComparisonMode==='function')updateComparisonMode();if(typeof syncTypePickers==='function')syncTypePickers();if(value){started=Date.now();clearInterval(timer);timer=setInterval(()=>{const seconds=Math.floor((Date.now()-started)/1000);$('elapsed').textContent=(seconds<60?`${seconds}초`:`${Math.floor(seconds/60)}분 ${seconds%60}초`)+' 경과';},1000);}else clearInterval(timer);}
function progress(p){if(p.stage==='ipzitalk-usage'){renderIpzitalkUsage(p.usage);return;}if(p.stage==='evidence-error'){toast(p.message,true);return;}if(p.stage==='usage'){clearTimeout(usageEventTimer);usageEventTimer=setTimeout(refreshUsage,800);return;}if(p.stage==='account'){if(p.error)toast(p.message,true);refresh();return;}if(p.stage==='connection-error'){if(!state.busy){$('connection-label').textContent='연결 확인을 눌러 주세요';$('connection-dot').className='dot offline';}return;}$('progress-message').textContent=p.message;const all=[...document.querySelectorAll('#progress-steps li')],idx=all.findIndex(e=>e.dataset.stage===p.stage);if(idx>=0)all.forEach((e,i)=>{e.classList.toggle('complete',i<idx);e.classList.toggle('current',i===idx);});}
api.onEvent(progress);
async function run(data,options){
  if(state.busy)return;
  if(!state.status?.loggedIn){toast(apiProviders.includes(selectedProvider())?`상단 ‘${providerName(selectedProvider())} 연결 설정’에서 API 키를 먼저 연결해 주세요.`:'상단 ‘내 계정으로 로그인’에서 먼저 로그인해 주세요.',true);$('login').focus();return;}
  if(view('new')===false)return;busy(true);progress({stage:'connection',message:'계정 연결을 확인합니다.'});
  try{const report=await api.generate(data,options);await loadHistory();if(report.batch){await openReport(report.reports.at(-1).id);toast(report.complete?report.reports.length+'개 타입별 보고서를 보관함에 각각 저장했습니다.':report.reports.length+'/'+report.total+'개 보고서 저장. '+report.failures.map(f=>f.message).join(' '),!report.complete);return;}await openReport(report.id);toast(report.reused?'10분 이내에 만든 같은 조건 보고서를 열었습니다. AI를 다시 호출하지 않았습니다.':'분석 보고서를 저장했습니다.');}
  catch(e){toast(e.message,true);}
  finally{busy(false);refreshUsage();}
}
$('analysis-form').addEventListener('submit',event=>{event.preventDefault();let data;try{data=input();}catch(e){toast(e.message,true);return;}if(!data.types.length){toast('비교할 거래 유형을 하나 이상 선택해 주세요.',true);return;}run(data);});
$('cancel').addEventListener('click',async()=>{try{$('cancel').disabled=true;await api.cancel();progress({stage:'data',message:'진행 중인 작업을 정리하고 있습니다.'});}catch(e){toast(e.message,true);}finally{$('cancel').disabled=false;}});
document.querySelectorAll('[data-request]').forEach(b=>b.addEventListener('click',()=>{$('request').value=b.dataset.request;if(b.dataset.type)document.querySelectorAll('[name=types]').forEach(c=>c.checked=b.dataset.type==='rent'?c.value!=='trade':c.value===b.dataset.type);$('request').focus();}));
async function loadHistory(){state.reports=await api.list();$('report-count').textContent=String(state.reports.length);renderHistory();if(typeof refreshComparisonReports==='function')refreshComparisonReports();}
function renderHistory(){const list=$('history-list');list.replaceChildren();const query=$('history-search').value.toLowerCase(),items=state.reports.filter(r=>(r.target+' '+r.title).toLowerCase().includes(query));if(!items.length){const div=document.createElement('div');div.className='empty-state';const h=document.createElement('h2');h.textContent=query?'일치하는 보고서가 없습니다':'아직 보관한 보고서가 없습니다';const p=document.createElement('p');p.textContent=query?'다른 단지명이나 제목으로 찾아보세요.':'새 분석을 시작하거나 보고서 예시를 열어보세요.';div.append(h,p);list.append(div);return;}
  for(const r of items){const b=document.createElement('button');b.className='history-item';const title=document.createElement('div'),strong=document.createElement('strong'),small=document.createElement('small');strong.textContent=r.title;small.textContent=r.target;title.append(strong,small);const date=document.createElement('span');date.className='history-date';date.textContent=new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',dateStyle:'short'}).format(new Date(r.createdAt));const status=document.createElement('span');status.className='status-label';status.textContent=r.status;const arrow=document.createElement('span');arrow.textContent='→';b.append(title,date,status,arrow);b.addEventListener('click',()=>openReport(r.id).catch(e=>toast(e.message,true)));list.append(b);}
}
$('history-search').addEventListener('input',renderHistory);
async function openReport(id,options={}){if(!options.discard&&!ConsultationUI.canLeave())return;state.current=await api.load(id);const r=state.current;renderGoogleGrounding(r);ConsultationUI.showReport(r,options);syncScoreRefresh();$('report-notice').textContent=r.demo?'사용 예시입니다. 실제 매물의 가격·위치·평가를 나타내지 않습니다.':`기준일 ${r.input.asOf} · 환경·가치 6개 항목 평가`;$('revise').disabled=!!r.demo;$('open-evidence').disabled=!!r.demo;$('retry-map').disabled=!!r.demo||!(r.input.asset==='apartment'||r.members?.some(m=>m.input.asset==='apartment'));view('report');}
function syncScoreRefresh(){const r=state.current,ms=r?.mode==='comparison'?r.members:[r],eligible=!r?.demo&&ms?.every(m=>m?.input?.asset==='apartment'&&m.input.asOf===new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul'}).format(new Date())),needed=ms?.some(m=>['상권 환경','병원 환경','학원 환경'].some(name=>!m?.scores?.some(s=>s.name===name&&s.score!=null)));$('refresh-scores').classList.toggle('hidden',!eligible||!needed);$('refresh-scores').disabled=state.busy;}
$('refresh-scores').addEventListener('click',async()=>{if(!state.current||state.busy||!ConsultationUI.requireSaved())return;const button=$('refresh-scores');state.busy=true;renderProviderControls();button.disabled=true;button.textContent='환경 정보 확인 중…';$('stop-scores').classList.remove('hidden');$('stop-scores').disabled=false;try{const report=await api['refresh-scores'](state.current.id);await loadHistory();await openReport(report.id);toast('새 환경 정보를 반영한 수정본을 보관했습니다. 원본 보고서는 보존했습니다.');}catch(e){toast(e.message,true);}finally{state.busy=false;renderProviderControls();button.textContent='새 환경 정보 보완';$('stop-scores').classList.add('hidden');syncScoreRefresh();}});
$('stop-scores').addEventListener('click',async()=>{if(!state.busy)return;$('stop-scores').disabled=true;try{await api.cancel();}catch(e){toast(e.message,true);$('stop-scores').disabled=false;}});
$('retry-map').addEventListener('click',async()=>{if(!state.current||state.busy||!ConsultationUI.requireSaved())return;const button=$('retry-map');button.disabled=true;button.textContent='지도 확인 중…';try{const report=await api['retry-map'](state.current.id);await openReport(report.id);toast('지도를 확인한 수정본을 보관했습니다. 기존 보고서는 그대로 남아 있습니다.');}catch(e){toast(e.message,true);}finally{button.textContent='지도 다시 불러오기';button.disabled=!!state.current?.demo;}});
$('show-demo').addEventListener('click',async()=>{try{const r=await api.demo();await loadHistory();await openReport(r.id);}catch(e){toast(e.message,true);}});
$('report-back').addEventListener('click',()=>view('history'));
$('export-report').addEventListener('click',async()=>{if(!state.current||$('export-report').disabled||!ConsultationUI.requireSaved())return;try{$('export-report').disabled=true;$('export-report').textContent='저장 중…';const r=await api.export(state.current.id,$('export-format').value);if(r)toast(r.note);}catch(e){toast(e.message,true);}finally{$('export-report').disabled=false;$('export-report').textContent='파일로 저장';}});
$('report-folder').addEventListener('click',()=>api.folder(state.current.id).catch(e=>toast(e.message,true)));
$('folder-all').addEventListener('click',()=>api.folder().catch(e=>toast(e.message,true)));
$('revise').addEventListener('click',()=>{if(!state.current||!ConsultationUI.requireSaved())return;const text=$('revision-request').value.trim();if(!text){$('revision-request').focus();return;}run({...state.current.input,request:state.current.input.request+'\n수정 요청: '+text},{revisionId:state.current.id});});
$('backup').addEventListener('click',async()=>{try{const r=await api.backup();if(r)toast(`${r.count}개 보고서를 백업했습니다. 로그인 정보는 포함하지 않습니다.`);}catch(e){toast(e.message,true);}});
$('restore').addEventListener('click',async()=>{try{const r=await api.restore();if(r){await loadHistory();toast(`${r.count}개 보고서를 복원했습니다.`);}}catch(e){toast(e.message,true);}});
$('settings-open').addEventListener('click',openSettings);
$('settings-dialog').addEventListener('cancel',event=>{if(settingsSaving||connectionSaving)event.preventDefault();else clearApiKeyInputs();});
$('settings-dialog').addEventListener('close',clearApiKeyInputs);
$('settings-form').addEventListener('submit',async event=>{event.preventDefault();if(state.busy||settingsSaving||connectionSaving||$('save-settings').disabled)return;clearApiKeyInputs();try{const officeProfile=ConsultationUI.readOfficeProfile(),model=$('model').value;settingsSaving=true;$('settings-form').querySelectorAll('input,select,button').forEach(node=>{node.disabled=true;});await api.settings({office:officeProfile.name,officeProfile,provider:selectedProvider(),model});$('settings-dialog').close();toast('설정을 저장했습니다.');await refresh();}catch(e){toast(e.message,true);}finally{settingsSaving=false;$('settings-form').querySelectorAll('input,select,button').forEach(node=>{node.disabled=false;});renderProviderControls();}});
$('provider').addEventListener('change',async()=>{
  const provider=$('provider').value;if(state.busy||settingsSaving||connectionSaving){renderProviderControls();return;}
  connectionSaving=true;clearApiKeyInputs();renderProviderControls();
  try{await api.settings({provider});await refreshConnectionSettings();toast(providerName(provider)+'를 선택했습니다.');}
  catch(e){toast(e.message,true);}finally{connectionSaving=false;renderProviderControls();}
});
async function apiConnection(provider,action){
  if(state.busy||settingsSaving||connectionSaving||selectedProvider()!==provider)return;
  const name=providerName(provider),input=$(provider+'-api-key'),status=$(provider+'-connection-status');
  let apiKey=action==='connect'?input.value.trim():'',workspaceId=provider==='claude'?$('claude-workspace-id').value.trim():'';clearApiKeyInputs();
  connectionErrors[provider]='';
  if(action==='connect'&&!apiKey){connectionErrors[provider]=`${providerInfo[provider].issuer}에서 발급한 API 키를 입력해 주세요.`;renderProviderControls();input.focus();return;}
  connectionSaving=true;renderProviderControls();$(provider+'-settings').setAttribute('aria-busy','true');status.classList.remove('connection-error');status.textContent=action==='disconnect'?'이 PC에 저장한 API 키를 삭제하고 있습니다…':`${name} API 연결을 확인하고 있습니다…`;
  try{if(action==='connect'){const pending=api[provider+'-connect'](provider==='claude'?{apiKey,workspaceId}:{apiKey});apiKey='';workspaceId='';await pending;}else await api[provider+'-'+action]();await refreshConnectionSettings();toast(action==='disconnect'?`이 PC에 저장한 ${name} API 키를 삭제했습니다.`:`${name} API 연결을 확인했습니다.`);}
  catch(e){connectionErrors[provider]=e.message;toast(e.message,true);}
  finally{apiKey='';workspaceId='';connectionSaving=false;$(provider+'-settings').removeAttribute('aria-busy');renderProviderControls();}
}
for(const provider of apiProviders){
  for(const action of ['connect','check','disconnect'])$(provider+'-'+action).addEventListener('click',()=>apiConnection(provider,action));
  $(provider+'-api-key').addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();apiConnection(provider,'connect');}});
  $(provider+'-api-key').addEventListener('paste',event=>{const input=event.currentTarget,pasted=event.clipboardData?.getData('text');if(typeof pasted!=='string')return;const length=input.value.length-(input.selectionEnd-input.selectionStart)+pasted.length;if(length>input.maxLength){event.preventDefault();input.value='';connectionErrors[provider]=`${providerName(provider)} API 키가 입력 가능한 길이를 초과했습니다. 발급 페이지에서 키만 다시 복사해 주세요.`;renderProviderControls();input.focus();}});
  $(provider+'-key-help').addEventListener('click',async event=>{event.preventDefault();try{await api.open(providerInfo[provider].keyUrl);}catch(e){toast(e.message,true);}});
}
$('claude-workspace-id').addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();apiConnection('claude','connect');}});
$('logout').addEventListener('click',async()=>{if(state.busy||settingsSaving||connectionSaving)return;connectionSaving=true;renderProviderControls();try{await api.logout();$('settings-dialog').close();await refresh();toast('이 프로그램의 GPT 계정 연결을 해제했습니다. 보고서는 보관되어 있습니다.');}catch(e){toast(e.message,true);}finally{connectionSaving=false;renderProviderControls();}});
document.addEventListener('keydown',event=>{if(event.key==='Escape')$('toast').classList.add('hidden');});
const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());$('asOf').value=today;$('asOf').max=today;
async function begin(){await Promise.all([refresh(),loadHistory()]);}
$('activation-dialog').addEventListener('cancel',e=>e.preventDefault());
$('copy-request').addEventListener('click',async()=>{try{await api['copy-request']();$('copy-request').textContent='복사했습니다';}catch(e){$('activation-error').textContent=e.message;}});
$('activation-form').addEventListener('submit',async e=>{e.preventDefault();$('activate').disabled=true;$('activation-error').textContent='';try{await api.activate($('activation-code').value);$('activation-dialog').close();$('activation-code').value='';await begin();toast('PC 인증을 완료했습니다. GPT·Gemini·Claude 중 하나를 연결해 주세요.');}catch(e){$('activation-error').textContent=e.message;}finally{$('activate').disabled=false;}});
async function boot(){try{const a=await api['activation-status']();if(a.mode==='test'){document.getElementById('view-help').querySelector('.page-heading p').textContent='PC 인증 없이 사용합니다. GPT·Gemini·Claude 중 하나를 연결한 뒤 매물을 입력하세요.';document.getElementById('transfer-help').textContent='‘보관한 보고서 → 전체 백업’으로 저장한 파일을 새 PC에서 ‘백업 복원’으로 불러오세요. 새 PC에서는 AI 계정이나 API 키를 다시 연결하세요.';}$('pc-request').value=a.requestCode;if(a.activated)await begin();else{$('connection-label').textContent='처음 한 번 PC 인증이 필요합니다';$('activation-dialog').showModal();}}catch(e){$('activation-error').textContent=e.message;$('activation-dialog').showModal();}}
setInterval(()=>{if(!document.hidden)refreshUsage();},60000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshUsage();});
ConsultationUI.init({toast,reload:openReport,getSettings:()=>state.status?.settings||{}});
boot();


$('open-evidence').addEventListener('click',async()=>{if(!state.current||state.current.demo)return;const button=$('open-evidence');button.disabled=true;button.setAttribute('aria-busy','true');button.textContent='근거 PDF 여는 중…';try{await api['open-evidence'](state.current.id);}catch(error){toast(error.message,true);}finally{button.textContent='상세 근거 보기';button.disabled=!!state.current?.demo;button.removeAttribute('aria-busy');}});
