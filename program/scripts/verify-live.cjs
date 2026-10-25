'use strict';
const path=require('node:path'),fs=require('node:fs/promises');
const {CodexBridge,findBinary}=require('../src/codex.cjs');
async function main(){
  // 개발 검증 전용: 현재 PC의 기존 로그인은 읽어 사용하며 배포 리소스에 복사하지 않는다.
  const bridge=new CodexBridge({binary:findBinary('',false),home:path.join(process.env.USERPROFILE,'.codex'),cwd:path.resolve(__dirname,'../../.build/live-check')});
  try{await bridge.start();const account=await bridge.request('account/read',{refreshToken:false});if(!account.account)throw new Error('현재 PC에 로그인된 계정이 없습니다.');
    const schema={type:'object',properties:{message:{type:'string'},checked:{type:'boolean'}},required:['message','checked'],additionalProperties:false};
    const response=await bridge.analyze({model:'gpt-6.1-sol',effort:'xhigh',prompt:'이것은 로컬 부동산 프로그램의 통신 검사입니다. 도구는 사용하지 말고 message에 연결 확인 완료, checked에 true를 넣어 반환하세요.',instructions:'Follow the requested JSON schema. Do not call tools or inspect files.',schema});
    const data=JSON.parse(response.text);if(!data.checked||!data.message)throw new Error('응답 확인 실패');
    const output=path.resolve(__dirname,'../../.build/live-check/result.json');await fs.mkdir(path.dirname(output),{recursive:true});await fs.writeFile(output,JSON.stringify({passed:true,checkedAt:new Date().toISOString(),model:'gpt-6.1-sol',structuredResponse:true,message:data.message},null,2));console.log('실제 계정 AI 요청 및 구조화 응답 확인 완료');
  }finally{bridge.stop();}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
