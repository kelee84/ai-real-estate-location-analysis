'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {createActivation,testVersion}=require('../src/release-policy.cjs');
test('테스트 배포는 PC 식별값이나 인증 파일 없이 실행하며 기존 인증 파일을 변경하지 않음',async()=>{
  assert.equal(testVersion,true);
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'re-trial-')),file=path.join(dir,'activation.json');
  try{const activation=createActivation({file,identity:async()=>{throw Error('PC 식별 접근 금지');}});
    assert.deepEqual(await activation.status(),{activated:true,required:false,mode:'test',requestCode:''});await activation.require();await activation.activate('');await assert.rejects(fs.stat(file),{code:'ENOENT'});
    await fs.writeFile(file,'preserve-original-activation');await activation.require();assert.equal(await fs.readFile(file,'utf8'),'preserve-original-activation');
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('테스트 배포에서도 발급기는 원래 PC 서명 인증 구현을 유지',async()=>{
  const {Activation}=require('../src/activation.cjs'),publicKey=crypto.generateKeyPairSync('ed25519').publicKey;
  const activation=createActivation({file:path.join(os.tmpdir(),crypto.randomUUID()+'.json'),publicKey,identity:async()=>'issuer-test'},{issuer:true});
  assert.ok(activation instanceof Activation);assert.equal((await activation.status()).activated,false);await assert.rejects(activation.require(),/인증/);
});
test('인증 모드는 패키지 정책이며 환경 변수나 실행 인자로 변경되지 않음',()=>{
  process.env.RE_HELPER_PC_AUTH='licensed';try{assert.equal(createActivation({}).constructor,Object);}finally{delete process.env.RE_HELPER_PC_AUTH;}
});
test('licensed 정책으로 재배포하면 기존 PC 서명 인증이 다시 필수가 됨',async()=>{
  const vm=require('node:vm'),{Activation}=require('../src/activation.cjs'),sandbox={module:{exports:{}},require:name=>name==='../package.json'?{pcAuthentication:'licensed'}:require('../src/activation.cjs')};
  vm.runInNewContext(await fs.readFile(path.join(__dirname,'../src/release-policy.cjs'),'utf8'),sandbox);
  assert.equal(sandbox.module.exports.testVersion,false);
  const activation=sandbox.module.exports.createActivation({file:path.join(os.tmpdir(),crypto.randomUUID()+'.json'),publicKey:crypto.generateKeyPairSync('ed25519').publicKey,identity:async()=>'restore-test'});
  assert.ok(activation instanceof Activation);await assert.rejects(activation.require(),/인증/);
});
