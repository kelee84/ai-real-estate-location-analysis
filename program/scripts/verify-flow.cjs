'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {CodexBridge,findBinary}=require('../src/codex.cjs'),{RtmsClient}=require('../src/data.cjs'),{ReportStore}=require('../src/store.cjs'),{AnalysisService}=require('../src/service.cjs');
async function main(){
  const output=path.resolve(__dirname,'../../.build/flow-check');await fs.mkdir(output,{recursive:true});
  const bridge=new CodexBridge({binary:findBinary('',false),home:path.join(os.homedir(),'.codex'),cwd:path.join(output,'analysis')});
  const store=new ReportStore(path.join(output,'reports')),service=new AnalysisService({bridge,data:new RtmsClient(),store,workspace:path.resolve(__dirname,'../resources/workspace'),userData:output,onEvent:p=>{if(p.stage!=='account')console.log(p.stage,p.message);}});await service.init();
  try{
    const report=await service.run({target:'서울 송파구 잠실동 리센츠',building:'리센츠',area:84.99,types:['trade','jeonse','monthly'],asOf:'2026-10-15',request:'프로그램의 통합 검증입니다. 제공된 거래 자료의 조건·기간·표본 한계 중심으로 간결하게 작성하세요. 외부 웹과 도구 조회를 추가로 실행하지 마세요. 확인하지 않은 입지와 7개 항목은 모두 평가 보류로 표시하고 그 이유를 설명하세요.'});
    if(report.scores.length!==7||!report.prices.summaries.length||!report.id)throw new Error('분석 결과 검증 실패');
    const info={passed:true,reportId:report.id,checkedAt:new Date().toISOString(),priceGroups:report.prices.summaries.length,contracts:report.prices.rows.length,coverage:report.prices.coverage,scores:report.scores.map(s=>({name:s.name,score:s.score})),issues:report.issues};
    await fs.writeFile(path.join(output,'result.json'),JSON.stringify(info,null,2));console.log(JSON.stringify(info,null,2));
  }finally{bridge.stop();}
}
main().catch(e=>{console.error(e.stack);process.exitCode=1;});
