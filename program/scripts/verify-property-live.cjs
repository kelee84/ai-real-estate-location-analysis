'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {AnalysisService}=require('../src/service.cjs'),{CodexBridge,findBinary}=require('../src/codex.cjs'),{RtmsClient}=require('../src/data.cjs'),{ReportStore}=require('../src/store.cjs'),{todayKst}=require('../src/core.cjs'),engine=require('../src/report.cjs');
async function main(){
  const output=path.resolve(__dirname,'../../.build/property-live');await fs.mkdir(output,{recursive:true});const store=new ReportStore(path.join(output,'reports'));
  const bridge=new CodexBridge({binary:findBinary('',false),home:path.join(os.homedir(),'.codex'),cwd:path.join(output,'analysis')});
  const service=new AnalysisService({bridge,data:new RtmsClient(),store,userData:output,onEvent:p=>{if(['data','analysis','validation','done'].includes(p.stage))console.log(p.stage,p.message);}});await service.init();
  try{
    const raw={target:'인천 연수구 송도동 그린워크1차',asset:'apartment',area:59,asOf:todayKst(),request:'가족의 실거주 관점에서 분석해 주세요. 공식 단지명과 실제 주소를 기준으로 확인 가능한 근거만 쓰세요. 거래가 있는데 없다고 쓰지 마세요. 거래 수치와 면적은 앱이 표로 삽입하므로 본문에서 반복하지 마세요. 학교 배정·현장·권리관계는 미확인 시 확인할 사항으로 남겨 주세요.'};
    const catalog=await service.searchTypes(raw);assert.equal(catalog.building,'더샵그린워크1차');assert.deepEqual(catalog.areas,[59.9201,72.5113,84.3408,84.8682,101.9294]);
    await fs.writeFile(path.join(output,'catalog.json'),JSON.stringify(catalog,null,2));
    const report=await service.run(raw,{force:true});assert.equal(report.input.building,catalog.building);assert.ok(report.prices.rows.length>0);assert.ok(report.prices.summaries.some(g=>g.kind==='trade'));assert.ok(report.prices.summaries.some(g=>g.kind==='jeonse'));assert.ok(report.prices.summaries.some(g=>g.kind==='monthly'));assert.ok(report.prices.rows.every(t=>t.building===catalog.building&&t.area>=59&&t.area<60));
    for(const group of report.prices.summaries){const rows=report.prices.rows.filter(t=>t.kind===group.kind&&(group.kind!=='monthly'||require('../src/core.cjs').monthlyBand(t.deposit)===group.depositBand));assert.equal(group.n,rows.length);for(const metric of group.kind==='trade'?['price']:group.kind==='jeonse'?['deposit']:['deposit','monthly'])assert.ok(Math.abs(group[metric]-rows.reduce((sum,t)=>sum+t[metric],0)/rows.length)<1e-7);}
    const result={passed:true,checkedAt:new Date().toISOString(),realOfficialCatalog:true,realOfficialContracts:true,realAI:true,reportId:report.id,building:report.input.building,areas:catalog.areas,contracts:report.prices.rows.length,groups:report.prices.summaries,issues:report.issues};
    await fs.writeFile(path.join(output,'report.html'),engine.html(report));await engine.word(report,path.join(output,'report.docx'));await engine.excel(report,path.join(output,'report.xlsx'));await engine.powerpoint(report,path.join(output,'report.pptx'),null,path.resolve(__dirname,'../../.agents/skills/last-ppt-template/assets/TTTM_분석프로그램_설계서_기본템플릿.pptx'));
    await fs.writeFile(path.join(output,'results.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
  }finally{bridge.stop();}
}
main().catch(e=>{console.error(e.stack||e);process.exitCode=1;});
