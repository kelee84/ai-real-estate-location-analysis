'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {AnalysisService}=require('../src/service.cjs'),{CodexBridge,findBinary}=require('../src/codex.cjs'),{RtmsClient}=require('../src/data.cjs'),{ReportStore}=require('../src/store.cjs'),{todayKst}=require('../src/core.cjs'),engine=require('../src/report.cjs');
async function main(){
  const output=path.resolve(__dirname,'../../.build/type-live');await fs.mkdir(output,{recursive:true});const store=new ReportStore(path.join(output,'reports'));
  const bridge=new CodexBridge({binary:findBinary('',false),home:path.join(os.homedir(),'.codex'),cwd:path.join(output,'analysis')});
  const analyze=bridge.analyze.bind(bridge);bridge.analyze=request=>analyze({...request,externalTools:false});
  const service=new AnalysisService({bridge,data:new RtmsClient(),store,userData:output,onEvent:p=>{if(['data','validation','done'].includes(p.stage))console.log(p.stage,p.message);}});await service.init();
  try{
    const raw={target:'서울 송파구 잠실동 잠실엘스',building:'잠실엘스',asset:'apartment',types:['trade'],asOf:todayKst(),request:'실제 타입 선택과 산술평균의 연결 검증입니다. 앱의 거래표를 근거로 짧고 정성적으로 설명하세요. 입지·지도·웹을 추가 조회하지 말고 출처가 없는 입지 주장을 만들지 마세요.'};
    const catalog=await service.searchTypes(raw);assert.ok([59.96,84.8,84.88,84.97].every(a=>catalog.areas.includes(a)));await fs.writeFile(path.join(output,'catalog.json'),JSON.stringify(catalog,null,2));
    const result=await service.run({...raw,selectedAreas:[59.96,84.8,84.88,84.97],catalogToken:catalog.token});assert.equal(result.complete,true);assert.equal(result.reports.length,2);
    const details=[];for(const r of result.reports){assert.ok(r.prices.rows.length>0);assert.ok(r.verification.numericCheck.passed);assert.equal(r.prices.areaResolution,null);const mean=r.prices.rows.reduce((s,t)=>s+t.price,0)/r.prices.rows.length;assert.ok(Math.abs(mean-r.prices.summaries[0].price)<1e-7);await fs.writeFile(path.join(output,'report-'+r.typeBatch.index+'.html'),engine.html(r,await engine.mapData(r,store)));details.push({id:r.id,selected:r.input.selectedAreas,contracts:r.prices.rows.length,mean,verified:r.verification.numericCheck.passed,issues:r.issues});}
    const info={passed:true,checkedAt:new Date().toISOString(),realOfficialCatalog:true,realOfficialContracts:true,realAI:true,locationResearchIncluded:false,catalogAreas:catalog.areas,groups:details,historyEntries:(await store.list()).length};await fs.writeFile(path.join(output,'results.json'),JSON.stringify(info,null,2));console.log(JSON.stringify(info));
  }finally{bridge.stop();}
}
main().catch(e=>{console.error(e.stack||e);process.exitCode=1;});
