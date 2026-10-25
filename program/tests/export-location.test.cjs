'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {createExportLocation}=require('../src/export-location.cjs');
async function fixture(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'re-export-location-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const fallbackDirectory=path.join(root,'documents'),first=path.join(root,'customer'),second=path.join(root,'another');for(const dir of [fallbackDirectory,first,second])await fs.mkdir(dir);const options={file:path.join(root,'preferences/export.json'),fallbackDirectory};return {root,first,second,options,location:createExportLocation(options)};}
test('요약·상세 파일명의 확장자를 유지하며 마지막 폴더를 다음 실행에서도 공유',async t=>{
 const {location,options,first,second}=await fixture(t);
 assert.equal(await location.defaultPath('요약.pdf'),path.join(options.fallbackDirectory,'요약.pdf'));
 await location.remember(path.join(first,'상세.docx'));
 assert.equal(await location.defaultPath('요약.png'),path.join(first,'요약.png'));
 const restarted=createExportLocation(options);assert.equal(await restarted.defaultPath('다른보고서.xlsx'),path.join(first,'다른보고서.xlsx'));
 await restarted.remember(path.join(second,'요약.pdf'));assert.equal(await location.defaultPath('상세.pptx'),path.join(second,'상세.pptx'));
 assert.deepEqual(JSON.parse(await fs.readFile(options.file,'utf8')),{directory:second});
});
test('없어진 폴더·잘못된 설정·상대 경로는 문서 폴더로 복귀하고 기억 실패로 저장을 방해하지 않음',async t=>{
 const {location,options,first,root}=await fixture(t);await location.remember(path.join(first,'ok.html'));await fs.rmdir(first);
 assert.equal(await location.defaultPath('상세.pdf'),path.join(options.fallbackDirectory,'상세.pdf'));
 for(const content of ['broken','null',JSON.stringify({directory:'relative'})]){await fs.writeFile(options.file,content);assert.equal(await location.defaultPath('요약.pdf'),path.join(options.fallbackDirectory,'요약.pdf'));}
 assert.equal(await location.remember('relative/report.pdf'),false);
 const blocked=path.join(root,'a-file');await fs.writeFile(blocked,'x');const bad=createExportLocation({file:path.join(blocked,'preferences.json'),fallbackDirectory:options.fallbackDirectory});assert.equal(await bad.remember(path.join(root,'valid.pdf')),false);
});
test('동시에 끝나는 저장도 설정 파일을 손상시키지 않고 마지막 완료 폴더를 기록',async t=>{
 const {location,first,second}=await fixture(t);await Promise.all([location.remember(path.join(first,'one.pdf')),location.remember(path.join(second,'two.html'))]);assert.equal(await location.defaultPath('next.pdf'),path.join(second,'next.pdf'));
});
test('실제 요약 저장이 성공한 경우만 기억하고 취소·실패·검증용 강제 저장은 이전 폴더 유지',async t=>{
 const {location,options,first,second,root}=await fixture(t);
 const report=await require('../src/service.cjs').AnalysisService.prototype.demo.call({store:{save:async value=>value}});
 let selected=path.join(first,'summary.html');const chooseFile=()=>selected;
 const save=require('../src/summary-export.cjs').createSummaryExporter({store:{load:async()=>report},chooseFile,onSaved:file=>location.remember(file)});
 await save(report.id,'html');assert.equal(await location.defaultPath('detail.pdf'),path.join(first,'detail.pdf'));
 selected=null;assert.equal(await save(report.id,'html'),null);
 selected=path.join(root,'missing/failed.html');await assert.rejects(save(report.id,'html'),{code:'ENOENT'});
 await save(report.id,'html',path.join(second,'forced.html'));
 assert.equal(await createExportLocation(options).defaultPath('detail.pdf'),path.join(first,'detail.pdf'));
});
