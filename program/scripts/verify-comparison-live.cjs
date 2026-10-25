'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {CodexBridge,findBinary}=require('../src/codex.cjs'),{RtmsClient}=require('../src/data.cjs'),{ReportStore}=require('../src/store.cjs'),{AnalysisService}=require('../src/service.cjs'),{todayKst}=require('../src/core.cjs'),exportsEngine=require('../src/report.cjs');
async function main(){
  const output=path.resolve(__dirname,'../../.build/comparison-live'),store=new ReportStore(path.join(output,'reports'));await fs.mkdir(output,{recursive:true});
  const oldStore=new ReportStore(path.resolve(__dirname,'../../.build/flow-check/reports')),oldItems=await oldStore.list(),old=oldItems.find(x=>!x.demo&&x.mode!=='comparison');if(!old)throw Error('실제 단일 분석 검증 보고서를 먼저 준비해 주세요.');
  await fs.cp(oldStore.path(old.id),store.path(old.id),{recursive:true});
  const bridge=new CodexBridge({binary:findBinary('',false),home:path.join(os.homedir(),'.codex'),cwd:path.join(output,'analysis')});
  // This bounded live check exercises official transactions and real AI, without additional location research.
  const analyze=bridge.analyze.bind(bridge);bridge.analyze=req=>analyze({...req,externalTools:false});
  const service=new AnalysisService({bridge,data:new RtmsClient(),store,userData:output,onEvent:p=>{if(['connection','data','validation','done'].includes(p.stage))console.log(p.stage,p.message);}});await service.init();
  try{
    const report=await service.run({mode:'comparison',properties:[{reportId:old.id},{target:'서울 송파구 잠실동 잠실엘스',building:'잠실엘스',area:83},{target:'서울 송파구 잠실동 트리지움',building:'트리지움',area:58}],asOf:todayKst(),types:['trade'],request:'실제 프로그램 연결 검증입니다. 제공된 거래 자료와 비교 한계 중심으로 간결하게 작성하세요. 별도 입지·웹·지도 조회를 하지 말고 확인하지 못한 7개 평가는 모두 보류하세요. 가격 비교표는 앱이 삽입하므로 반복하지 마세요.'},{force:true});
    assert.equal(report.members.length,3);assert.equal(report.members[0].reusedEvidence,false); // force refresh intentionally verifies all three sources
    assert.ok(report.members.every(m=>m.prices.rows.length>0),'공식 거래 조회가 비어 있습니다.');assert.ok(report.members[1].prices.areaResolution,'가까운 타입 적용이 확인되지 않았습니다.');assert.ok(report.members.every(m=>m.scores.length===7));
    await fs.writeFile(path.join(output,'comparison-report.html'),exportsEngine.html(report,await exportsEngine.mapData(report,store)),'utf8');
    const result={passed:true,checkedAt:new Date().toISOString(),reportId:report.id,realAI:true,officialTransactions:true,mapResearchIncluded:false,members:report.members.map(m=>({key:m.key,target:m.input.target,contracts:m.prices.rows.length,requested:m.input.area,applied:m.prices.effectiveArea.area,coverage:m.prices.coverage,priceGroups:m.prices.summaries.length})),issues:report.issues,model:report.model};await fs.writeFile(path.join(output,'results.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
  }finally{bridge.stop();}
}
main().catch(e=>{console.error(e.stack||e);process.exitCode=1;});
