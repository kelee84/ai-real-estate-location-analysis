'use strict';
// 소유자 PC에서만 실행. 개인키는 프로젝트·설치 파일에 넣지 않는다.
const {app,safeStorage}=require('electron'),fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {keyFile,loadOwnerKey}=require('../src/issuer-store.cjs');
const {requestCode,machineIdentity,issueCode}=require('../src/activation.cjs');
const {protect}=require('../src/owner-crypto.cjs');
app.whenReady().then(async()=>{
  const publicFile=path.resolve(__dirname,'../src/activation-public.json');let published;try{published=JSON.parse(await fs.readFile(publicFile,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
  if(!published){
    try{await fs.access(keyFile());throw new Error('기존 개인키가 있습니다. 공개키를 복원한 뒤 진행하세요.');}catch(e){if(e.code!=='ENOENT')throw e;}
    if(!safeStorage.isEncryptionAvailable())throw new Error('Windows 암호화를 사용할 수 없습니다.');
    const pair=crypto.generateKeyPairSync('ed25519'),privateKey=pair.privateKey.export({type:'pkcs8',format:'pem'}),publicKey=pair.publicKey.export({type:'spki',format:'pem'});
    await fs.mkdir(path.dirname(keyFile()),{recursive:true});await fs.writeFile(keyFile(),JSON.stringify({version:2,ciphertext:(await protect(Buffer.from(privateKey))).toString('base64')}),{mode:0o600,flag:'wx'});
    published={version:1,publicKey};await fs.writeFile(publicFile,JSON.stringify(published,null,2)+'\n');
  }
  const key=await loadOwnerKey(safeStorage,published.publicKey),code=issueCode(requestCode(await machineIdentity()),key),build=path.resolve(__dirname,'../../.build');
  if(!(await fs.readFile(keyFile(),'utf8')).startsWith('{'))await fs.writeFile(keyFile(),JSON.stringify({version:2,ciphertext:(await protect(Buffer.from(key))).toString('base64')}),{mode:0o600});
  await fs.mkdir(build,{recursive:true});await fs.writeFile(path.join(build,'activation-test-code.txt'),code);
  console.log('소유자 발급 키 준비 완료. 개인키는 이 Windows 계정에 암호화해 보관했습니다.');app.exit(0);
}).catch(e=>{console.error(e.message);app.exit(1);});
