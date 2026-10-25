'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const GEMINI_API_KEY_MAX_LENGTH=8192;

function validApiKey(value,provider='gemini'){
  const label=provider==='claude'?'Claude':'Gemini';
  if(typeof value!=='string')throw new Error(label+' API 키를 입력해 주세요.');
  const key=value.trim();
  // Google authorization keys are opaque credentials, including newer AQ.
  // strings. Only enforce the single-line HTTP-header boundary locally;
  // Google's models endpoint determines whether the credential is valid.
  const maxLength=provider==='gemini'?GEMINI_API_KEY_MAX_LENGTH:512;
  const safeCharacters=provider==='gemini'?/^[\x21-\x7e]+$/:/^[A-Za-z0-9_-]+$/;
  if(key.length<20||key.length>maxLength||!safeCharacters.test(key))throw new Error(label+' API 키 형식을 확인해 주세요.'+(provider==='gemini'?' Google AI Studio에서 키 전체를 한 줄로 다시 복사해 입력해 주세요.':''));
  return key;
}
function validWorkspaceId(value){
  if(value==null||value==='')return '';
  if(typeof value!=='string'||!/^wrkspc_[A-Za-z0-9]{1,100}$/.test(value.trim()))throw new Error('Claude 워크스페이스 ID 형식을 확인해 주세요.');
  return value.trim();
}

// Only Electron's OS-backed safeStorage is accepted. In particular, Linux's
// basic_text fallback must never silently turn this file into a plaintext key.
class CredentialStore {
  constructor({file,safeStorage,provider='gemini'}={}){
    if(typeof file!=='string'||!file)throw new Error('AI 연결정보 저장 위치가 필요합니다.');
    if(!['gemini','claude'].includes(provider))throw new Error('지원하지 않는 AI 연결입니다.');
    this.file=path.resolve(file);this.safeStorage=safeStorage;this.provider=provider;this.label=provider==='claude'?'Claude':'Gemini';
  }
  available(){
    try{return !!this.safeStorage?.isEncryptionAvailable?.()&&this.safeStorage?.getSelectedStorageBackend?.()!=='basic_text';}catch{return false;}
  }
  assertAvailable(){if(!this.available())throw new Error('이 PC의 보안 저장 기능을 사용할 수 없습니다. 앱을 다시 실행한 뒤 '+this.label+' API 키를 저장해 주세요.');}
  async status(){
    let configured=false;
    try{configured=(await fs.stat(this.file)).isFile();}catch{}
    return {configured,available:this.available()};
  }
  async saveApiKey(value,{workspaceId}={}){
    const key=validApiKey(value,this.provider);this.assertAvailable();
    const plaintext=this.provider==='claude'?JSON.stringify({apiKey:key,workspaceId:validWorkspaceId(workspaceId)}):key;
    let encrypted;
    try{encrypted=this.safeStorage.encryptString(plaintext);}catch{throw new Error(this.label+' API 키를 보안 저장하지 못했습니다.');}
    if(!Buffer.isBuffer(encrypted)||!encrypted.length||encrypted.equals(Buffer.from(plaintext)))throw new Error(this.label+' API 키를 보안 저장하지 못했습니다.');
    const record=JSON.stringify({version:this.provider==='claude'?2:1,provider:this.provider,encrypted:encrypted.toString('base64')});
    const temporary=path.join(path.dirname(this.file),`.${path.basename(this.file)}.${randomUUID()}.tmp`);
    try{
      await fs.mkdir(path.dirname(this.file),{recursive:true,mode:0o700});
      await fs.writeFile(temporary,record,{mode:0o600,flag:'wx'});
      await fs.rename(temporary,this.file);
    }catch{throw new Error(this.label+' API 키를 보안 저장하지 못했습니다. 저장 위치를 확인해 주세요.');}
    finally{await fs.unlink(temporary).catch(()=>{});}
    return this.status();
  }
  async readApiKey(){return (await this.readConnection())?.apiKey??null;}
  async readConnection(){
    this.assertAvailable();let text;
    try{const stat=await fs.stat(this.file);if(!stat.isFile()||stat.size>16384)throw new Error();text=await fs.readFile(this.file,'utf8');}
    catch(error){if(error?.code==='ENOENT')return null;throw new Error('저장된 '+this.label+' 연결정보를 읽지 못했습니다. API 키를 다시 저장해 주세요.');}
    try{
      const record=JSON.parse(text);
      if(!(record.version===1||record.version===2&&this.provider==='claude')||record.provider!==this.provider||typeof record.encrypted!=='string'||!record.encrypted.length||!/^[A-Za-z0-9+/]+={0,2}$/.test(record.encrypted))throw new Error();
      const encrypted=Buffer.from(record.encrypted,'base64');
      if(!encrypted.length||encrypted.toString('base64')!==record.encrypted)throw new Error();
      const decrypted=this.safeStorage.decryptString(encrypted),value=record.version===2?JSON.parse(decrypted):{apiKey:decrypted};
      return {apiKey:validApiKey(value.apiKey,this.provider),workspaceId:validWorkspaceId(value.workspaceId)};
    }catch{throw new Error('저장된 '+this.label+' 연결정보를 복호화하지 못했습니다. 이 PC에서 API 키를 다시 저장해 주세요.');}
  }
  async clear(){
    try{await fs.unlink(this.file);}catch(error){if(error?.code!=='ENOENT')throw new Error(this.label+' 연결정보를 삭제하지 못했습니다.');}
    return this.status();
  }
}
module.exports={CredentialStore,validApiKey,validWorkspaceId,GEMINI_API_KEY_MAX_LENGTH};
