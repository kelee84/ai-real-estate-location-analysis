'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {requestCode,normalizeRequest,issueCode,verifyCode,Activation}=require('../src/activation.cjs');
test('서명 인증번호는 지정 PC에서만 유효하고 위변조·오타를 거부',()=>{
  const {publicKey,privateKey}=crypto.generateKeyPairSync('ed25519'),a=requestCode('PC-A'),b=requestCode('PC-B'),code=issueCode(a,privateKey);
  assert.equal(normalizeRequest(a.toLowerCase().replaceAll('-',' ')),a);assert.ok(verifyCode(code,a,publicKey));assert.ok(!verifyCode(code,b,publicKey));
  assert.ok(!verifyCode(code.slice(0,12)+(code[12]==='X'?'Y':'X')+code.slice(13),a,publicKey));assert.ok(!verifyCode('123456',a,publicKey));assert.throws(()=>issueCode(a.slice(0,-1)+(a.endsWith('0')?'1':'0'),privateKey));
  assert.ok(!verifyCode(code,a,crypto.generateKeyPairSync('ed25519').publicKey));
});
test('인증은 재실행 후 유지되고 복사한 인증 파일은 다른 PC에서 거부',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'re-activation-')),file=path.join(dir,'activation.json'),{publicKey,privateKey}=crypto.generateKeyPairSync('ed25519');
  try{const a=new Activation({file,publicKey,identity:async()=>'PC-A'});assert.equal((await a.status()).activated,false);await assert.rejects(a.require(),/인증/);await assert.rejects(a.activate('wrong'),/이 PC용/);
    await a.activate(issueCode((await a.status()).requestCode,privateKey));await a.require();
    assert.equal((await new Activation({file,publicKey,identity:async()=>'PC-A'}).status()).activated,true);
    const b=new Activation({file,publicKey,identity:async()=>'PC-B'});assert.equal((await b.status()).activated,false);await assert.rejects(b.require(),/인증/);
    await fs.writeFile(file,'{broken');assert.equal((await a.status()).activated,false);
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});
