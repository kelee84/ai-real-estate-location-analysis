'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const {normalizeInput,aggregate,todayKst}=require('../src/core.cjs'),{NaverLandStore}=require('../src/naver-land.cjs');
// Opt-in only: real public Naver and RTMS reads, fresh smoke profile, no AI or
// facility collection. The report contains no simulated contracts or scores.
exports.run=async({win,service,store,output})=>{
 await fs.mkdir(output,{recursive:true});
 const url='https://fin.land.naver.com/complexes/8742',calls=[],read=service.readNaverPage,find=service.findNaverComplex;
 service.readNaverPage=async(...args)=>{calls.push('link');return read(...args);};
 service.findNaverComplex=async(...args)=>{calls.push('search');return find(...args);};
 service.archhubStore=null;
 service.bridge.evidenceSession=service.bridge.analyze=async()=>{throw Error('기본정보 검증에서 입지톡·AI를 호출하면 안 됩니다.');};
 const js=code=>win.webContents.executeJavaScript(`(async()=>{${code}})()`);
 const imported=await js(`const r=await window.helper['import-naver-link'](${JSON.stringify(url)});showNaverImport(r);return r;`);
 assert.equal(imported.name,'목동우성2차');
 const raw={asset:'apartment',target:imported.address+' '+imported.name,asOf:todayKst(),types:['trade']};
 let catalog=await service.searchTypes(raw);
 if(catalog.kind==='candidates'){
  assert.equal(catalog.candidates.length,1);
  catalog=await service.selectProperty({searchToken:catalog.searchToken,candidateId:catalog.candidates[0].id});
 }
 assert.equal(catalog.identity.code,'3282');assert.equal(catalog.identity.building,'목동우성2');
 const input=normalizeInput({...raw,building:catalog.identity.building,area:84.96}),prices={...aggregate([],input,[]),buildingResolution:catalog.identity};
 await service.reuseNaverLand(input,prices);assert.deepEqual(calls,['link']);
 const overview=require('../src/apartment-overview.cjs'),report={input,prices,title:'네이버 기본정보 연결 검증 · 거래·평가 미실행',conclusion:'네이버 단지 기본정보의 연결·표시만 검증합니다.',createdAt:new Date().toISOString(),scores:[],sources:[],sections:[],strengths:[],limitations:[],checks:[],highlights:[],features:[],issues:[],map:{reason:'기본정보 연결만 검증하며 지도는 수집하지 않았습니다.'}};
 const facts=overview.data(report).properties[0].facts;
 assert.equal(facts.units,1140);assert.equal(facts.parking.total,1376);assert.equal(facts.approval,'2000-03-18');
 require('../src/report.cjs').html(report);
 const saved=await store.save(report,{afterSave:false}),file=path.join(store.path(saved.id),'report.json'),original=await fs.readFile(file);
 await js(`await openReport(${JSON.stringify(saved.id)});return true;`);
 const deadline=Date.now()+15000;let text='';
 while(Date.now()<deadline){
  const frame=win.webContents.mainFrame.frames.find(f=>f.url.startsWith('helper://report/'));
  if(frame){text=await frame.executeJavaScript('document.body?.innerText||""');if(text.includes('1,376'))break;}
  await new Promise(resolve=>setTimeout(resolve,100));
 }
 assert.match(text,/1,140세대/);assert.match(text,/총 1,376대 · 세대당 1\.21대/);
 assert.equal(await js("return document.getElementById('view-report').classList.contains('hidden');"),false);
 await js("await document.fonts.ready;document.getElementById('toast').classList.add('hidden');window.scrollTo(0,0);await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));return true;");
 await new Promise(resolve=>setTimeout(resolve,250));
 await fs.writeFile(path.join(output,'mokdong-report.png'),(await win.webContents.capturePage()).toPNG());
 assert.deepEqual(await fs.readFile(file),original);
 // Empty public cache exercises the requested automatic search fallback.
 service.naverStore=new NaverLandStore();service.naverLookups=new Map();
 const fallback={buildingResolution:catalog.identity};await service.reuseNaverLand(input,fallback);
 assert.equal(fallback.naverLand?.complexNo,'8742');assert.equal(fallback.naverLand.basic.units,1140);assert.equal(fallback.naverLand.basic.parkingSpaces,1376);
 assert.deepEqual(calls,['link','search']);
 const result={passed:true,checkedAt:new Date().toISOString(),official:catalog.identity,sourceUrl:url,importedName:imported.name,basic:fallback.naverLand.basic,renderedParking:'총 1,376대 · 세대당 1.21대',calls,originalReportPreserved:true};
 await fs.writeFile(path.join(output,'naver-basics-results.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));return result;
};
