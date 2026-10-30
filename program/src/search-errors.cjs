'use strict';
const {setTimeout:delay}=require('node:timers/promises');
function failure(code,message,stage,extra={}){return Object.assign(new Error(message),{code,stage,...extra});}
function cancelled(signal){if(signal?.aborted)throw failure('SEARCH_CANCELLED','단지 검색을 중지했습니다. 다시 검색할 수 있습니다.','cancel');}
function transient(error){return [408,500,502,503,504].includes(error.status)||['ECONNRESET','ECONNREFUSED','EAI_AGAIN','ETIMEDOUT','UND_ERR_CONNECT_TIMEOUT','UND_ERR_SOCKET'].includes(error.code||error.cause?.code)||error.name==='TimeoutError';}
async function retryRead(read,signal){
 for(let attempt=1;attempt<=2;attempt++)try{cancelled(signal);const result=await read();cancelled(signal);return result;}
 catch(error){cancelled(signal);if(attempt===2||!transient(error)){error.attempts=attempt;throw error;}await delay(200,undefined,{signal}).catch(()=>cancelled(signal));}
}
async function jsonRequest(client,route,form,signal){
 const bytes=await retryRead(()=>client.request(route,form,signal),signal);
 try{return JSON.parse(bytes.toString());}catch{throw failure('SEARCH_RESPONSE_INVALID','공식 자료의 응답 형식을 확인하지 못했습니다. 잠시 후 다시 검색해 주세요.','response');}
}
function diagnostic(error,stage){
 // Deliberately exclude raw messages, URLs, input, response bodies and credentials.
 return {stage:error.stage||stage,code:/^[A-Z][A-Z0-9_]{1,60}$/.test(error.code||'')?error.code:'SEARCH_FAILED',...(Number.isInteger(error.status)?{status:error.status}:{}),attempts:error.attempts||1};
}
function present(error,signal){
 cancelled(signal);
 if(error.code==='SEARCH_CANCELLED'||error.code?.startsWith('PROPERTY_')||error.code?.startsWith('REGION_')||error.code?.startsWith('TYPE_')||error.code?.startsWith('SEARCH_'))return error;
 if(error.status===401||error.status===403)return failure('SEARCH_ACCESS','자료 제공 서비스의 접근 권한을 확인하지 못했습니다. 연결 상태를 확인한 뒤 다시 검색해 주세요.','connection',{status:error.status});
 if(error.status===429)return failure('SEARCH_LIMIT','자료 제공 서비스의 조회 한도에 도달했습니다. 잠시 후 다시 검색해 주세요.','connection',{status:429});
 if(transient(error)||error.name==='TypeError'&&error.cause?.code||error.code==='ENOTFOUND')return failure('SEARCH_NETWORK','공식 자료 연결이 지연되거나 끊겼습니다. 인터넷 연결을 확인한 뒤 다시 검색해 주세요.','connection',{attempts:error.attempts,status:error.status});
 return error;
}
module.exports={failure,cancelled,transient,retryRead,jsonRequest,diagnostic,present};
