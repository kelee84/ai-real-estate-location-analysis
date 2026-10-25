'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const {getConsultation}=require('../src/consultation.cjs');
const {BrowserWindow,clipboard}=require('electron');
const secret='INTERNAL_ONLY_SMOKE_050';
const publicNote='현장에서 거실 창문과 주차 동선을 함께 확인했습니다.';

async function zipText(file){const zip=await require('jszip').loadAsync(await fs.readFile(file));return (await Promise.all(Object.keys(zip.files).filter(n=>/\.xml$/.test(n)).map(n=>zip.file(n).async('string')))).join('\n');}
async function inspectHtml(file,output,name){
 const win=new BrowserWindow({show:false,width:1080,height:850,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
 try{
  await win.loadFile(file);await win.webContents.executeJavaScript('document.fonts.ready.then(()=>true)');
  const metrics=[];
  for(const width of [1080,390]){
   win.setContentSize(width,850);await win.webContents.executeJavaScript('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r(true))))');
   const value=await win.webContents.executeJavaScript('({width:innerWidth,scroll:document.documentElement.scrollWidth,text:document.body.innerText})');
   assert.ok(value.scroll<=value.width,`${name} horizontal overflow at ${width}`);assert.ok(!value.text.includes(secret));
   await fs.writeFile(path.join(output,name+'-'+width+'.png'),(await win.webContents.capturePage()).toPNG());metrics.push({width,scroll:value.scroll});
  }
  return metrics;
 }finally{win.destroy();}
}

exports.run=async({win,service,store,exportReport,exportSummary,output,fixture})=>{
 const directory=path.join(output,'consultation');await fs.mkdir(directory,{recursive:true});
 const originalAnalyze=service.bridge.analyze;let aiCalls=0;service.bridge.analyze=async()=>{aiCalls++;throw Error('상담 저장에서 AI를 호출하면 안 됩니다.');};
 const results=[];
 try{
  const uiReport=await store.save({...structuredClone(fixture),id:undefined,consultation:undefined});
  await win.webContents.executeJavaScript(`openReport(${JSON.stringify(uiReport.id)})`);
  await win.webContents.executeJavaScript(`(()=>{document.getElementById('consultation-editor').open=true;document.getElementById('note-0-publicNote').value='첫 저장 확인';document.getElementById('note-0-privateNote').value=${JSON.stringify(secret)};document.getElementById('note-0-publicNote').dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('consultation-form').requestSubmit();})()`);
  await win.webContents.executeJavaScript(`new Promise((resolve,reject)=>{const started=Date.now(),timer=setInterval(()=>{if(state.current?.consultation?.properties[0]?.publicNote==='첫 저장 확인'){clearInterval(timer);resolve(true);}else if(Date.now()-started>6000){clearInterval(timer);reject(Error(document.getElementById('toast').textContent||'첫 상담 저장 실패'));}},50);})`);
  assert.equal((await store.load(uiReport.id)).consultation.properties[0].privateNote,secret);
  await fs.writeFile(path.join(directory,'consultation-editor.png'),(await win.webContents.capturePage()).toPNG());
  await win.webContents.executeJavaScript(`view('new');document.getElementById('customer-fields').closest('details').open=true;document.getElementById('customer-purpose').value='rent';document.getElementById('customer-budgetType').value='monthly';document.getElementById('customer-budgetType').dispatchEvent(new Event('change'));document.getElementById('customer-budget').value='5000';document.getElementById('customer-priority-0').checked=true;`);
  const entered=await win.webContents.executeJavaScript('ConsultationUI.readCustomer()');assert.equal(entered.budgetManwon,5000);assert.equal(entered.budgetType,'monthly');
  for(const width of [1380,1000]){win.setSize(width,920);await win.webContents.executeJavaScript("document.getElementById('customer-fields').scrollIntoView({block:'center'});new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r(true))))");assert.ok(await win.webContents.executeJavaScript('document.documentElement.scrollWidth<=innerWidth'));await fs.writeFile(path.join(directory,'customer-input-'+width+'.png'),(await win.webContents.capturePage()).toPNG());}
  win.setSize(1380,920);
  const base=await store.save({...structuredClone(fixture),id:undefined,consultation:undefined});
  const payload={...getConsultation(base),customer:{purpose:'live',budgetManwon:160000,budgetType:'trade',moveIn:'2027년 봄',priorities:['교통 환경','교육 환경']},officeProfile:{name:'검증용 부동산',agent:'검증 담당자',phone:'02-000-0000',address:'검증용 주소',logoDataUrl:''},properties:[{key:'A',cautions:'배정 학교는 교육청에 확인해야 합니다.',publicNote,privateNote:secret,visitedAt:base.input.asOf}]};
  const beforeSave=await store.load(base.id),saved=await service.saveConsultation(base.id,payload);
  assert.deepEqual(saved.prices,beforeSave.prices);assert.deepEqual(saved.scores,beforeSave.scores);assert.equal(getConsultation(saved).properties[0].privateNote,secret);
  await assert.rejects(service.saveConsultation(base.id,payload),/다른 저장/);
  const noChanges=await store.load(base.id);assert.equal(noChanges.consultation.updatedAt,saved.consultation.updatedAt);
  for(const format of ['html','pdf','png']){
   const file=path.join(directory,'single-summary.'+format);await exportSummary(base.id,format,file);assert.ok((await fs.stat(file)).size>1000);
   if(format==='html'){const body=await fs.readFile(file,'utf8');assert.ok(body.includes(publicNote));assert.ok(!body.includes(secret));assert.ok(body.includes('검증용 부동산'));}
   if(format==='pdf'){const layout=await require('../src/report-pagination.cjs').inspectPdf(await fs.readFile(file));assert.equal(layout.shortTail,false);results.push({single:layout});}
  }
  results.push({singleViewports:await inspectHtml(path.join(directory,'single-summary.html'),directory,'single-summary')});
  for(const format of ['html','docx','xlsx','pptx']){
   const file=path.join(directory,'single-detail.'+format);await exportReport(base.id,format,file);
   const body=format==='html'?await fs.readFile(file,'utf8'):await zipText(file);
   assert.ok(!body.includes(secret),format+' leaked internal memo');assert.ok(body.includes(publicNote),format+' lost public memo');assert.ok(body.includes('검증용 부동산'),format+' lost office');
  }
  await win.webContents.executeJavaScript(`openReport(${JSON.stringify(base.id)})`);
  await win.webContents.executeJavaScript(`document.getElementById('preview-summary').click()`);
  assert.match(await win.webContents.executeJavaScript('document.getElementById("report-frame").src'),/^helper:\/\/summary\//);
  await win.webContents.executeJavaScript(`document.getElementById('preview-detail').click()`);
  assert.match(await win.webContents.executeJavaScript('document.getElementById("report-frame").src'),/^helper:\/\/report\//);
  await win.webContents.executeJavaScript(`window.helper['copy-summary'](${JSON.stringify(base.id)})`);
  const copied=await clipboard.readText();assert.ok(copied.includes(publicNote));assert.ok(!copied.includes(secret));
  const members=['A','B','C'].map((key,index)=>({...structuredClone(base),key,input:{...base.input,target:'검증용 '+key+'단지',building:'검증용 '+key+'단지'},consultation:undefined}));
  const comparison=await store.save({...structuredClone(base),id:undefined,mode:'comparison',members,comparisonMembers:members,input:{...base.input,target:'검증용 3개 단지 비교'},title:'고객 요약 기능 검증 · 실제 매물 아님',consultation:undefined});
  await service.saveConsultation(comparison.id,{customer:payload.customer,officeProfile:payload.officeProfile,properties:members.map(m=>({...payload.properties[0],key:m.key,publicNote:m.key+'단지 '+publicNote}))});
  for(const format of ['html','pdf','png']){const file=path.join(directory,'comparison-summary.'+format);await exportSummary(comparison.id,format,file);assert.ok((await fs.stat(file)).size>1000);}
  const text=await fs.readFile(path.join(directory,'comparison-summary.html'),'utf8');for(const key of ['A','B','C'])assert.ok(text.includes(key+'단지 '+publicNote));assert.ok(!text.includes(secret));
  for(const format of ['html','docx','xlsx','pptx']){
   const file=path.join(directory,'comparison-detail.'+format);await exportReport(comparison.id,format,file);
   const body=format==='html'?await fs.readFile(file,'utf8'):await zipText(file);
   assert.ok(!body.includes(secret),format+' comparison leaked internal memo');
   for(const key of ['A','B','C'])assert.ok(body.includes(key+'단지 '+publicNote),format+' comparison lost public memo');
  }
  results.push({comparisonViewports:await inspectHtml(path.join(directory,'comparison-summary.html'),directory,'comparison-summary'),comparisonPdf:await require('../src/report-pagination.cjs').inspectPdf(await fs.readFile(path.join(directory,'comparison-summary.pdf')))});
  const packed=await require('../src/backup.cjs').pack(store),restoreStore=new(require('../src/store.cjs').ReportStore)(path.join(directory,'restored'));
  await require('../src/backup.cjs').unpack(restoreStore,packed);const restored=await restoreStore.list();let found=false;for(const item of restored){const report=await restoreStore.load(item.id);if(report.consultation?.properties.some(p=>p.privateNote===secret))found=true;}assert.ok(found,'백업 복원에서 내부 메모 유실');
  assert.equal(aiCalls,0);
  await fs.writeFile(path.join(directory,'verification.json'),JSON.stringify({passed:true,aiCalls,privateMemoExcluded:true,publicMemoAllFormats:true,staleSaveRejected:true,backupPreserved:true,results},null,2));
 }finally{service.bridge.analyze=originalAnalyze;}
};
