'use strict';
// 배포 시 고정하는 정책이다. 사용자 설정이나 실행 인자로 인증 여부를 바꾸지 않는다.
const {pcAuthentication}=require('../package.json');
const {Activation}=require('./activation.cjs');
if(!['test','licensed'].includes(pcAuthentication))throw new Error('PC 인증 배포 정책을 확인해 주세요.');
const testVersion=pcAuthentication==='test';
function createActivation(options,{issuer=false}={}){
  if(issuer||!testVersion)return new Activation(options);
  // 테스트 배포는 PC 식별값·기존 인증 파일·발급키에 접근하지 않는다.
  const status=async()=>({activated:true,required:false,mode:'test',requestCode:''});
  return {status,require:async()=>{},activate:status};
}
module.exports={testVersion,createActivation};
