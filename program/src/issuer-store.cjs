'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {protect}=require('./owner-crypto.cjs');
function keyFile(){return path.join(process.env.LOCALAPPDATA||path.join(os.homedir(),'AppData','Local'),'RealEstateHelperOwner','activation-key.dpapi');}
function keyFiles({localAppData=process.env.LOCALAPPDATA,profile=os.userInfo().homedir}={}){
  // 실행 환경의 임시 경로와 실제 Windows 사용자 프로필이 다를 수 있다.
  const roots=[localAppData,profile&&path.join(profile,'AppData','Local')].filter(Boolean);
  return [...new Set(roots.map(root=>path.resolve(root,'RealEstateHelperOwner','activation-key.dpapi')))];
}
function issuerError(code,message,attempts){
  const error=new Error(message);error.code=code;error.gate='issuer';error.diagnostics={code,attempts};return error;
}
async function loadOwnerKey(safeStorage,publicKey,{files=keyFiles(),readFile=fs.readFile,decrypt=protect}={}){
  const attempts=[];
  for(const file of files){
    let bytes;try{bytes=await readFile(file);}catch(e){attempts.push({file,code:e.code||'READ_FAILED'});continue;}
    let privateKey;
    try{
      // 초기 safeStorage 형식과 DPAPI 형식을 구분한다. 손상된 JSON은 이전 형식으로 열지 않는다.
      if(bytes.toString('utf8').trimStart().startsWith('{')){
        const data=JSON.parse(bytes.toString('utf8'));
        if(data.version!==2||typeof data.ciphertext!=='string'||!data.ciphertext)throw new Error('INVALID_KEY_FILE');
        privateKey=(await decrypt(Buffer.from(data.ciphertext,'base64'),true)).toString('utf8');
      }else privateKey=safeStorage.decryptString(bytes);
      const actual=crypto.createPublicKey(privateKey).export({type:'spki',format:'pem'});
      if(actual!==publicKey){attempts.push({file,code:'KEY_MISMATCH'});continue;}
      return privateKey;
    }catch{attempts.push({file,code:'KEY_UNREADABLE'});}
  }
  if(attempts.some(x=>x.code==='KEY_MISMATCH'))throw issuerError('KEY_MISMATCH','현재 배포본과 발급 키가 다릅니다. 기존 발급 키와 배포본을 확인해 주세요.',attempts);
  if(attempts.some(x=>x.code==='KEY_UNREADABLE'))throw issuerError('KEY_UNREADABLE','발급 키를 열지 못했습니다. 처음 준비한 Windows 계정에서 일반 실행한 뒤 ‘발급 권한 다시 확인’을 눌러 주세요.',attempts);
  if(attempts.some(x=>!['ENOENT','ENOTDIR'].includes(x.code)))throw issuerError('KEY_ACCESS','발급 키 파일을 읽지 못했습니다. 이 Windows 계정의 파일 접근 권한을 확인한 뒤 ‘발급 권한 다시 확인’을 눌러 주세요.',attempts);
  throw issuerError('KEY_MISSING','이 Windows 계정에서 발급 키 파일을 찾지 못했습니다. 처음 발급기를 준비한 계정에서 실행한 뒤 ‘발급 권한 다시 확인’을 눌러 주세요.',attempts);
}
module.exports={keyFile,keyFiles,loadOwnerKey};
