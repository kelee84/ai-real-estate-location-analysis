'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),path=require('node:path');
const {keyFiles,loadOwnerKey}=require('../src/issuer-store.cjs');
const pair=crypto.generateKeyPairSync('ed25519'),publicKey=pair.publicKey.export({type:'spki',format:'pem'}),privateKey=pair.privateKey.export({type:'pkcs8',format:'pem'});
const protectedBytes=Buffer.from(JSON.stringify({version:2,ciphertext:Buffer.from('encrypted-test-key').toString('base64')}));
const safeStorage={decryptString(){throw new Error('legacy not expected');}};
function ioError(code){return Object.assign(new Error(code),{code});}
test('발급 키는 실행 환경 경로와 실제 사용자 프로필을 확인하고 중복 경로를 제거',()=>{
  const profile=path.resolve('owner-profile'),localAppData=path.join(profile,'AppData','Local');
  assert.equal(keyFiles({localAppData,profile}).length,1);
  assert.equal(keyFiles({localAppData:path.resolve('temporary-profile'),profile}).length,2);
});
test('실행 환경 경로가 잘못됐거나 접근할 수 없어도 실제 사용자 키를 검증해 사용',async()=>{
  for(const code of ['ENOENT','EACCES']){
    const visited=[];
    const result=await loadOwnerKey(safeStorage,publicKey,{files:['temporary','profile'],readFile:async file=>{visited.push(file);if(file==='temporary')throw ioError(code);return protectedBytes;},decrypt:async()=>Buffer.from(privateKey)});
    assert.equal(result,privateKey);assert.deepEqual(visited,['temporary','profile']);
  }
});
test('키 없음과 접근 거부를 구분하고 복구할 수 있는 발급 오류로 반환',async()=>{
  for(const [code,expected] of [['ENOENT','KEY_MISSING'],['EACCES','KEY_ACCESS']])await assert.rejects(loadOwnerKey(safeStorage,publicKey,{files:['test'],readFile:async()=>{throw ioError(code);}}),e=>e.code===expected&&e.gate==='issuer'&&e.diagnostics.attempts[0].code===code);
});
test('다른 키나 복호화 실패는 발급 권한을 부여하지 않고 개인키를 진단에 남기지 않음',async()=>{
  const other=crypto.generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'pem'});
  for(const [decrypt,expected] of [[async()=>Buffer.from(other),'KEY_MISMATCH'],[async()=>{throw Error('DPAPI failure');},'KEY_UNREADABLE']])await assert.rejects(loadOwnerKey(safeStorage,publicKey,{files:['test'],readFile:async()=>protectedBytes,decrypt}),e=>e.code===expected&&!JSON.stringify(e.diagnostics).includes('PRIVATE KEY')&&!JSON.stringify(e.diagnostics).includes('ciphertext'));
});
test('초기 safeStorage 발급 키 호환성을 유지',async()=>{
  assert.equal(await loadOwnerKey({decryptString:()=>privateKey},publicKey,{files:['test'],readFile:async()=>Buffer.from([0,1,2,3])}),privateKey);
});
