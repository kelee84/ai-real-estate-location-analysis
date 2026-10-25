'use strict';
const crypto=require('node:crypto'),fs=require('node:fs/promises'),path=require('node:path');
const {execFile}=require('node:child_process');
const NAMESPACE='kr.local.realestatehelper:activation:v1:';
function requestCode(identity){
  const hash=crypto.createHash('sha256').update(NAMESPACE+String(identity).trim().toLowerCase()).digest('hex').slice(0,32).toUpperCase();
  const check=crypto.createHash('sha256').update(hash).digest('hex').slice(0,4).toUpperCase();
  return 'PC1-'+(hash+check).match(/.{4}/g).join('-');
}
function normalizeRequest(value){
  const raw=String(value||'').toUpperCase().replace(/[\s-]/g,'');
  if(!/^PC1[0-9A-F]{36}$/.test(raw))throw new Error('PC 요청번호를 전체 복사해 붙여넣어 주세요.');
  const hash=raw.slice(3,35),check=crypto.createHash('sha256').update(hash).digest('hex').slice(0,4).toUpperCase();
  if(raw.slice(35)!==check)throw new Error('PC 요청번호가 맞지 않습니다. 다시 복사해 주세요.');
  return 'PC1-'+raw.slice(3).match(/.{4}/g).join('-');
}
function issueCode(request,privateKey){return 'RH1.'+crypto.sign(null,Buffer.from(NAMESPACE+normalizeRequest(request)),privateKey).toString('base64url');}
function verifyCode(code,request,publicKey){try{
  const text=String(code||'').replace(/\s/g,'');if(!/^RH1\.[A-Za-z0-9_-]{86}$/.test(text))return false;
  const signature=Buffer.from(text.slice(4),'base64url');return signature.length===64&&crypto.verify(null,Buffer.from(NAMESPACE+normalizeRequest(request)),publicKey,signature);
}catch{return false;}}
async function machineIdentity(){
  if(process.platform!=='win32')throw new Error('PC 인증은 Windows에서 사용할 수 있습니다.');
  const output=await new Promise((resolve,reject)=>execFile(path.join(process.env.SystemRoot||'C:\\Windows','System32','reg.exe'),['query','HKLM\\SOFTWARE\\Microsoft\\Cryptography','/v','MachineGuid','/reg:64'],{windowsHide:true,timeout:10000,encoding:'utf8'},(e,out)=>e?reject(new Error('PC 정보를 확인하지 못했습니다. Windows를 다시 시작한 뒤 실행해 주세요.')):resolve(out)));
  const identity=output.match(/MachineGuid\s+REG_SZ\s+([a-f0-9-]{32,36})/i)?.[1];
  if(!identity)throw new Error('이 PC의 인증 요청번호를 만들지 못했습니다.');return identity;
}
class Activation {
  constructor({file,publicKey,identity=machineIdentity}){Object.assign(this,{file,publicKey,identity});this.request=null;}
  async status(){
    if(!this.request)this.request=requestCode(await this.identity());
    let code='';try{code=JSON.parse(await fs.readFile(this.file,'utf8')).code;}catch{}
    return {activated:verifyCode(code,this.request,this.publicKey),requestCode:this.request};
  }
  async activate(code){
    const current=await this.status();if(!verifyCode(code,current.requestCode,this.publicKey))throw new Error('이 PC용 인증번호가 아닙니다. 요청번호와 발급받은 인증번호를 확인해 주세요.');
    await fs.mkdir(path.dirname(this.file),{recursive:true});const tmp=this.file+'.tmp';
    await fs.writeFile(tmp,JSON.stringify({version:1,code:String(code).replace(/\s/g,''),activatedAt:new Date().toISOString()}),{mode:0o600});await fs.rename(tmp,this.file);
    return this.status();
  }
  async require(){if(!(await this.status()).activated)throw new Error('처음 한 번, 배포자에게 받은 인증번호로 이 PC를 인증해 주세요.');}
}
module.exports={requestCode,normalizeRequest,issueCode,verifyCode,machineIdentity,Activation};
