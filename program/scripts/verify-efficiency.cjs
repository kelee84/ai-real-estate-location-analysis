'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {CodexBridge,findBinary}=require('../src/codex.cjs'),{normalizeInput,aggregate,validateReport}=require('../src/core.cjs'),{buildRequest,qualityIssues}=require('../src/prompt.cjs'),{reportSchema}=require('../src/schema.cjs');
async function main(){
  const output=path.resolve(__dirname,'../../.build/efficiency-check');await fs.mkdir(output,{recursive:true});
  const root=path.resolve(__dirname,'../../.build/flow-check/reports'),id=(await fs.readdir(root))[0],baseline=JSON.parse(await fs.readFile(path.join(root,id,'report.json'),'utf8'));
  const input=normalizeInput({...baseline.input,area:'84',request:'제공된 거래 자료만 사용하는 프로그램 검증입니다. 외부 웹과 도구를 호출하지 마세요. 입지·현장·평면을 확인한 것처럼 쓰지 말고 7항목은 평가 보류로 표시하세요. 표본·면적군·제시가격 미입력의 한계와 실거주 현장 확인사항을 설명하세요.'}),prices=aggregate(baseline.prices.rows,input,baseline.prices.coverage),request=buildRequest(input,prices,{dataCheckedAt:baseline.createdAt});
  const oldRules=await fs.readFile(path.resolve(__dirname,'../../AGENTS.md'),'utf8'),oldPrompt=JSON.stringify({request:input,prices:{...prices,rows:prices.rows.slice(0,60)},dataCoverage:prices.coverage});
  const final=process.argv.includes('--final'),bridge=new CodexBridge({binary:findBinary('',false),home:path.join(os.homedir(),'.codex'),cwd:path.join(os.tmpdir(),'re-helper-token-check')});const results=[];
  try{await bridge.start();const limits=await bridge.request('account/rateLimits/read',{});await fs.writeFile(path.join(output,'quota.json'),JSON.stringify(require('../src/core.cjs').quotaState(limits),null,2));
    for(const [model,effort]of (final?[['gpt-6-luna','low']]:[['gpt-6-luna','low'],['gpt-6.1-sol','xhigh']])){
      const started=Date.now(),r=await bridge.analyze({...request,schema:reportSchema,model,effort,externalTools:false}),parsed=JSON.parse(r.text),issues=qualityIssues(parsed),validated=validateReport(parsed);
      if(issues.length||validated.report.scores.some(s=>s.score!==null)||!parsed.checks.length)throw new Error(model+' 품질 항목 실패: '+issues.join(','));
      await fs.writeFile(path.join(output,(final?'final-':'')+model+'.json'),JSON.stringify({...parsed,tokenUsage:r.tokenUsage},null,2));results.push({model,effort,elapsedMs:Date.now()-started,tokenUsage:r.tokenUsage,quality:{requiredSections:true,sevenScoresHeld:true,checks:parsed.checks.length,sourceCount:parsed.sources.length}});console.log(model+' 필수 품질 항목 통과');
    }
    const metrics={passed:true,checkedAt:new Date().toISOString(),contracts:prices.rows.length,oldAppInputCharacters:oldRules.length+oldPrompt.length,newAppInputCharacters:request.instructions.length+request.prompt.length,inputCharacterReductionPercent:Math.round((1-(request.instructions.length+request.prompt.length)/(oldRules.length+oldPrompt.length))*100),results,note:'한 건의 저장된 공식 거래 표본을 사용한 비교. 외부 입지 조회·지도 인증·모든 매물의 동등 품질을 증명하지 않음. 문자열 감소율은 실제 토큰 감소율과 다름.'};await fs.writeFile(path.join(output,final?'final-results.json':'results.json'),JSON.stringify(metrics,null,2));console.log(JSON.stringify(metrics));
  }finally{bridge.stop();}
}
main().catch(e=>{console.error(e.stack);process.exitCode=1;});
