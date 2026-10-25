'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{spawn}=require('node:child_process');
const pkg=require('../package.json');
const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function guideHtml(){
  const version=escape(pkg.version),activation=pkg.pcAuthentication==='test'?'이 배포본은 PC 인증번호 없이 실행됩니다.':'처음 실행할 때 안내에 따라 PC 인증을 완료하세요.';
  return `<!doctype html><html lang="ko"><meta charset="utf-8"><title>부동산 도우미 ${version} - 처음 사용하기</title>
  <style>
  @page{size:A4;margin:15mm 17mm}*{box-sizing:border-box}body{margin:0;color:#20354b;font:14px/1.5 "Malgun Gothic","맑은 고딕",sans-serif;word-break:keep-all}header{display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid #20354b;padding-bottom:9px;font-size:12px;letter-spacing:.4px}.brand{font-weight:800}h1{font-size:30px;line-height:1.25;margin:18px 0 6px}p{margin:4px 0}.lead{color:#607286;margin-bottom:15px}h2{font-size:16px;margin:14px 0 5px;display:flex;align-items:center;gap:8px}.number{background:#20354b;color:white;border-radius:50%;width:23px;height:23px;display:inline-flex;justify-content:center;align-items:center;font-size:12px;flex:none}.step{break-inside:avoid}strong{font-weight:700}table{width:100%;border-collapse:collapse;margin:7px 0;font-size:13px}th,td{padding:7px 10px;border-bottom:1px solid #d8e0e8;text-align:left;vertical-align:top}th{background:#edf2f7;font-weight:700}td:first-child{width:85px;font-weight:700}small,.note{font-size:11.5px;color:#607286}.note{margin-top:5px}.callout{background:#fbf3e6;border-left:3px solid #ed785e;padding:8px 11px;margin-top:12px;font-size:12px}.help{background:#f1f5f8;border-radius:8px;padding:10px 13px;margin-top:15px}.help h2{margin:0 0 5px;font-size:14px}.help p{font-size:12px;margin:4px 0}footer{margin-top:14px;border-top:1px solid #d8e0e8;padding-top:7px;font-size:10.5px;color:#607286;display:flex;justify-content:space-between}
  h1{margin-top:14px}h2{margin-top:10px}.callout{margin-top:10px}.help{margin-top:11px}footer{margin-top:9px}
  </style><body>
  <header><span class="brand">AI SHERPA · 부동산 도우미</span><span>v${version} · Windows PC</span></header>
  <h1>처음 사용하기</h1><p class="lead">설치부터 보고서 저장까지, 아래 순서대로 시작하세요.</p>
  <section class="step"><h2><span class="number">1</span>설치하고 실행하기</h2><p><strong>RealEstateHelper-Setup-${version}-x64.exe</strong>를 실행한 뒤<br>바탕화면의 <strong>‘부동산 도우미’</strong>를 엽니다.</p><p class="note">${activation}</p></section>
  <section class="step"><h2><span class="number">2</span>사용할 AI 선택하기</h2><p>왼쪽 아래 <strong>‘사용 설정’ → ‘연결할 AI’</strong>에서 하나를 선택합니다.</p>
  <table><thead><tr><th>AI</th><th>연결 방법</th></tr></thead><tbody><tr><td>GPT</td><td>본인 ChatGPT 계정으로 로그인</td></tr><tr><td>Gemini</td><td>Google AI Studio에서 발급한 API 키 입력 → ‘키 저장하고 연결’</td></tr><tr><td>Claude</td><td>Claude Console에서 발급한 API 키 입력 → ‘키 저장하고 연결’</td></tr></tbody></table>
  <p class="note">API 키는 프로그램에 직접 입력하세요. Gemini·Claude API 비용과 한도는 채팅 구독과 별도입니다.<br>저장된 키는 다시 입력할 필요가 없습니다. 키 입력창은 연결 시 보안을 위해 비워집니다.</p></section>
  <section class="step"><h2><span class="number">3</span>지도 연결하기</h2><p>오른쪽 <strong>‘지도 연결’</strong>을 눌러 본인 입지톡 계정으로 로그인합니다.<br><strong>‘지도 서비스가 연결되어 있습니다’</strong> 문구를 확인하세요.</p><p class="note">AI와 지도 서비스의 연결은 별도입니다. Gemini·Claude는 같은 지도 연결을 사용합니다.</p></section>
  <section class="step"><h2><span class="number">4</span>분석 보고서 만들기</h2><p><strong>매물 1개:</strong> 단지명 입력 → ‘단지·타입 검색’ → 대상·전용면적 선택 → 분석 시작<br><strong>매물 비교:</strong> ‘매물 비교’를 선택하고 최대 3개 매물을 입력하거나 보관한 보고서를 선택합니다.</p><p class="note">궁금한 점이나 고객 조건은 필요한 만큼 입력하세요. 분석 중에는 AI·모델을 바꿀 수 없습니다.</p></section>
  <section class="step"><h2><span class="number">5</span>확인하고 파일로 저장하기</h2><p>완성된 보고서에서 <strong>‘파일로 저장’</strong>을 눌러 PDF 등 원하는 형식으로 저장합니다.<br><strong>‘상세 근거 보기’</strong>에서 출처를 확인하고, <strong>‘보관한 보고서’</strong>에서 다시 열 수 있습니다.</p></section>
  <div class="callout"><strong>보고서 읽기</strong> · 교통·교육·상권·자연·병원·학원 6개 항목을 확인하세요.<br>자료가 부족하면 ‘평가 보류’로 표시합니다. 부분 평가·기준일·선택 면적을 함께 확인하고, 직선거리를 실제 도보거리로 해석하지 마세요.</div>
  <section class="help"><h2>막힐 때는 이렇게 확인하세요</h2><p><strong>AI 연결이 안 될 때</strong> · 사용 설정의 연결 확인 후 계정·키의 권한과 사용 한도를 확인하세요.</p><p><strong>지도가 안 보일 때</strong> · 지도 연결 상태를 확인하고, 보고서의 ‘지도 다시 불러오기’를 누르세요.</p><p><strong>분석이 오래 걸릴 때</strong> · 진행 문구의 서버 지연·재시도·한도 안내를 확인하세요. 필요하면 ‘분석 중지’를 누르세요.</p></section>
  <footer><span>AI SHERPA · 간단 사용 설명서</span><span>v${version}</span></footer>
  </body></html>`;
}
async function render(pdf){
  const {app,BrowserWindow,session}=require('electron');
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'re-helper-quickstart-'));
  await fs.mkdir(path.join(temp,'profile'));app.setPath('userData',path.join(temp,'profile'));app.commandLine.appendSwitch('disable-background-networking');
  await app.whenReady();
  const isolated=session.fromPartition('quickstart-'+Date.now());
  isolated.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_request,callback)=>callback({cancel:true}));
  const html=path.join(temp,'guide.html');await fs.writeFile(html,guideHtml());
  const win=new BrowserWindow({show:false,webPreferences:{session:isolated,sandbox:true,contextIsolation:true,nodeIntegration:false}});
  try{await win.loadFile(html);await win.webContents.executeJavaScript('document.fonts.ready.then(()=>true)');
    const data=await win.webContents.printToPDF({printBackground:true,preferCSSPageSize:true});
    const tempPdf=pdf+'.tmp';await fs.mkdir(path.dirname(pdf),{recursive:true});await fs.writeFile(tempPdf,data);await fs.rename(tempPdf,pdf);
    console.log(JSON.stringify({guide:pdf,version:pkg.version}));
  }finally{win.destroy();}
}
function buildGuide(outputDirectory){
  const pdf=path.join(path.resolve(outputDirectory),'처음사용하기.pdf');
  return new Promise((resolve,reject)=>{const child=spawn(require('electron'),[__filename,'--render',pdf],{windowsHide:true,stdio:'inherit'});
    const timer=setTimeout(()=>{child.kill();reject(new Error('PDF 간단 설명서 생성 시간 초과'));},120000);
    child.once('error',error=>{clearTimeout(timer);reject(error);});child.once('exit',code=>{clearTimeout(timer);code===0?resolve(pdf):reject(new Error('PDF 간단 설명서 생성 실패: '+code));});});
}
module.exports={buildGuide,guideHtml};
if(process.versions.electron&&process.argv.includes('--render')){const pdf=process.argv[process.argv.indexOf('--render')+1];render(path.resolve(pdf)).then(()=>require('electron').app.exit(0)).catch(error=>{console.error(error.message);require('electron').app.exit(1);});}
else if(require.main===module)buildGuide(process.argv[2]||path.resolve(__dirname,'../../release',pkg.version)).catch(error=>{console.error(error.message);process.exitCode=1;});
