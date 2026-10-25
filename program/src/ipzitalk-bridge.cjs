'use strict';
// IpziTalk is an independent data connection. These credentials never come
// from Codex, ChatGPT, or the selected report-writing model.
const fs=require('node:fs/promises'),path=require('node:path'),http=require('node:http');
const {EventEmitter}=require('node:events');
const {randomBytes,randomUUID,randomInt,createHash,timingSafeEqual}=require('node:crypto');
const {IpzitalkUsage}=require('./ipzitalk-usage.cjs');
const {IpzitalkBudget}=require('./ipzitalk-budget.cjs');
const ENDPOINT='https://ipji-talk.com/mcp',PROTOCOL='2025-06-18',MAX_BYTES=12*1024*1024,AUTH_BYTES=256*1024;
const ALLOWED=new Set(['get_geocode','get_address','get_region_code','get_complex_info_by_query','get_complex_info_batch','search_by_nearby_category','search_by_nearby_keyword','find_complexes_near_point','get_map_embed_url']);
const cancelled=()=>Object.assign(new Error('분석을 중지했습니다.'),{code:'ABORT_ERR'});
const loginRequired=()=>Object.assign(new Error('입지톡 로그인이 필요합니다. 지도 연결에서 로그인한 뒤 다시 시도해 주세요.'),{code:'IPZITALK_AUTH_REQUIRED'});
function secureUrl(value){
 let u;try{u=new URL(value);}catch{throw new Error('입지톡 인증 주소를 확인하지 못했습니다.');}
 const host=u.hostname.toLowerCase();
 if(u.protocol!=='https:'||u.username||u.password||u.hash||!host.includes('.')||host==='localhost'||host.endsWith('.localhost')||host.endsWith('.local')||/^[\d.]+$/.test(host)||host.includes(':'))throw new Error('입지톡 인증 주소를 확인하지 못했습니다.');
 return u.href;
}
const canonical=value=>{const u=new URL(value);return u.href.replace(/\/$/,'');};
const sameSecret=(a,b)=>typeof a==='string'&&typeof b==='string'&&Buffer.byteLength(a)===Buffer.byteLength(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
const metadataUrls=(issuer,kind)=>{
 const u=new URL(issuer),p=u.pathname.replace(/\/$/,'');
 return [...new Set([`${u.origin}/.well-known/${kind}${p}`,`${u.origin}${p}/.well-known/${kind}`,`${u.origin}/.well-known/${kind}`])];
};
async function listenLoopback(server,{signal,choosePort=()=>randomInt(49152,65536),maxAttempts=8}={}){
 // OS-selected ports can include browser-blocked service ports. OAuth runs in
 // the browser, so bind only the high dynamic range and retry occupied ports.
 for(let attempt=0;attempt<maxAttempts;attempt++){
  if(signal?.aborted)throw cancelled();
  const port=choosePort();if(!Number.isInteger(port)||port<49152||port>65535)throw new Error('입지톡 로그인 연결 포트를 확인하지 못했습니다.');
  try{
   await new Promise((resolve,reject)=>{
    const finish=error=>{server.off('error',onError);server.off('listening',onListening);server.off('close',onClose);error?reject(error):resolve();};
    const onError=error=>finish(signal?.aborted?cancelled():error),onListening=()=>finish(signal?.aborted?cancelled():null),onClose=()=>finish(signal?.aborted?cancelled():new Error('입지톡 로그인 연결이 종료됐습니다.'));
    server.once('error',onError);server.once('listening',onListening);server.once('close',onClose);
    // Native listen cancellation also closes a socket aborted before its
    // listening event; the close event settles this promise without leaks.
    try{server.listen({port,host:'127.0.0.1',...(signal?{signal}:{})});}catch(error){finish(error);}
   });
   if(signal?.aborted){server.close();throw cancelled();}return server.address();
  }catch(error){
   if(error.code==='EADDRINUSE'&&attempt+1<maxAttempts&&!signal?.aborted)continue;
   server.close();server.closeAllConnections?.();if(signal?.aborted)throw cancelled();
   if(error.code==='EADDRINUSE')throw new Error('입지톡 로그인 연결 포트가 사용 중입니다. 잠시 후 다시 시도해 주세요.');throw error;
  }
 }
 throw new Error('입지톡 로그인 연결 포트를 확인하지 못했습니다.');
}
class IpzitalkBridge extends EventEmitter{
 constructor({userData,safeStorage,fetcher,fetch:fetchOption}={}){
  super();this.userData=userData;this.safeStorage=safeStorage;this.fetcher=fetcher||fetchOption||globalThis.fetch;
  this.seq=0;this.controllers=new Set();this.tokens=null;this.loaded=null;this.ready=null;this.sessionId=null;this.protocol=PROTOCOL;this.tools=null;this.pendingLogin=null;this.loggingIn=null;this.refreshing=null;this.authRequired=false;
  this.ipzitalkUsage=new IpzitalkUsage();this.evidenceBudget=new IpzitalkBudget();
 }
 get credentialFile(){if(!this.userData)throw new Error('입지톡 인증 저장 폴더를 확인하지 못했습니다.');return path.join(this.userData,'ipzitalk-credentials.json');}
 encryptedStorageAvailable(){return !!this.safeStorage?.isEncryptionAvailable?.()&&this.safeStorage.getSelectedStorageBackend?.()!=='basic_text';}
 async load(){
  if(!this.loaded)this.loaded=(async()=>{
   if(!this.userData||!this.encryptedStorageAvailable())return;
   try{
    const stat=await fs.lstat(this.credentialFile);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>AUTH_BYTES)return;
    const saved=JSON.parse(await fs.readFile(this.credentialFile,'utf8'));
    if(saved.version!==1||typeof saved.encrypted!=='string')return;
    const t=JSON.parse(this.safeStorage.decryptString(Buffer.from(saved.encrypted,'base64')));
    if(t.resource!==ENDPOINT||typeof t.accessToken!=='string'||!t.accessToken||!Number.isFinite(t.expiresAt)||typeof t.clientId!=='string'||!t.clientId||!t.metadata||canonical(t.metadata.issuer)!==canonical(t.issuer))return;
    secureUrl(t.metadata.token_endpoint);secureUrl(t.issuer);this.tokens=t;
   }catch{} // An unreadable or another-PC credential requires a fresh login.
  })();
  return this.loaded;
 }
 async save(tokens){
  if(!this.encryptedStorageAvailable())throw new Error('이 PC의 안전한 인증정보 저장 기능을 사용할 수 없습니다. Windows 사용자 계정 상태를 확인해 주세요.');
  const file=this.credentialFile,temp=file+'.'+randomUUID()+'.tmp';
  const encrypted=this.safeStorage.encryptString(JSON.stringify(tokens)).toString('base64');
  await fs.mkdir(this.userData,{recursive:true});
  try{await fs.writeFile(temp,JSON.stringify({version:1,encrypted}),{mode:0o600,flag:'wx'});await fs.rename(temp,file);}finally{await fs.rm(temp,{force:true}).catch(()=>{});}
  this.tokens=tokens;this.authRequired=false;
 }
 resetSession(){this.ready=null;this.sessionId=null;this.protocol=PROTOCOL;this.tools=null;}
 async request(url,options={},signal,timeout=30000){
  if(signal?.aborted)throw cancelled();
  const controller=new AbortController();this.controllers.add(controller);
  const signals=[controller.signal,AbortSignal.timeout(timeout)];if(signal)signals.push(signal);
  // Keep the controller until the body is consumed, including long SSE bodies.
  const cleanup=()=>this.controllers.delete(controller);
  try{return {response:await this.fetcher(url,{...options,redirect:'error',signal:AbortSignal.any(signals)}),cleanup};}
  catch(error){cleanup();if(signal?.aborted||controller.signal.aborted)throw cancelled();throw new Error(error?.name==='TimeoutError'?'입지톡 연결 응답이 늦습니다. 잠시 후 다시 시도해 주세요.':'입지톡 서버에 연결하지 못했습니다. 인터넷 연결을 확인해 주세요.');}
 }
 async read(response,{limit=MAX_BYTES,id,notification=false}={}){
  if(!response.body){if(notification)return null;throw new Error('입지톡 응답 본문이 없습니다.');}
  const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='',bytes=0,eventData=[];
  const sse=(response.headers.get('content-type')||'').toLowerCase().includes('text/event-stream');
  const parse=value=>{let item;try{item=JSON.parse(value);}catch{throw new Error('입지톡 응답 형식을 확인하지 못했습니다.');}return item;};
  const result=item=>{
   if(!item||item.jsonrpc!=='2.0'||item.id!==id||item.method)return {matched:false};
   if(item.error)throw new Error('입지톡 자료 조회를 완료하지 못했습니다. (MCP '+String(item.error.code||'오류')+')');
   if(!Object.hasOwn(item,'result'))throw new Error('입지톡 응답 결과가 없습니다.');
   return {matched:true,value:item.result};
  };
  const event=()=>{if(!eventData.length)return {matched:false};const value=eventData.join('\n');eventData=[];return result(parse(value));};
  const line=value=>{if(value==='')return event();if(value.startsWith('data:'))eventData.push(value.slice(5).replace(/^ /,''));return {matched:false};};
  try{
   while(true){
    const chunk=await reader.read();if(chunk.done)break;bytes+=chunk.value.byteLength;if(bytes>limit)throw new Error('입지톡 응답 크기 제한을 넘었습니다.');buffer+=decoder.decode(chunk.value,{stream:true});
    if(sse){let newline;while((newline=buffer.search(/[\r\n]/))>=0){if(buffer[newline]==='\r'&&newline===buffer.length-1)break;const value=buffer.slice(0,newline),width=buffer[newline]==='\r'&&buffer[newline+1]==='\n'?2:1;buffer=buffer.slice(newline+width);const found=line(value);if(found.matched)return found.value;}}
   }
   buffer+=decoder.decode();if(notification)return null;
   if(sse){for(const value of buffer.split(/\r\n|\r|\n/)){const found=line(value);if(found.matched)return found.value;}const found=event();if(found.matched)return found.value;throw new Error('입지톡 응답에 요청 결과가 없습니다.');}
   const item=parse(buffer);if(id===undefined)return item;const found=result(item);if(!found.matched)throw new Error('입지톡 응답의 요청 번호가 다릅니다.');return found.value;
  }catch(error){if(error?.name==='AbortError')throw cancelled();if(error?.name==='TimeoutError')throw new Error('입지톡 연결 응답이 늦습니다. 잠시 후 다시 시도해 주세요.');throw error;}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
 }
 async json(url,options={},signal){
  const {response,cleanup}=await this.request(secureUrl(url),options,signal);
  try{if(!response.ok){await response.body?.cancel();const e=new Error('입지톡 인증 서버 응답 오류 ('+response.status+')');e.status=response.status;throw e;}return await this.read(response,{limit:AUTH_BYTES});}finally{cleanup();}
 }
 async discover(signal){
  // RFC 9728 resource metadata, including the server's WWW-Authenticate hint.
  let hinted;
  const {response,cleanup}=await this.request(ENDPOINT,{method:'POST',headers:{Accept:'application/json, text/event-stream','Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:++this.seq,method:'initialize',params:{protocolVersion:PROTOCOL,capabilities:{},clientInfo:{name:'real-estate-helper',version:require('../package.json').version}}})},signal);
  try{const challenge=response.headers.get('www-authenticate')||'';hinted=challenge.match(/\bresource_metadata\s*=\s*"([^"]+)"/i)?.[1];await response.body?.cancel();}finally{cleanup();}
  const candidates=[...(hinted?[secureUrl(hinted)]:[]),...metadataUrls(ENDPOINT,'oauth-protected-resource')];let resource;
  for(const url of [...new Set(candidates)]){
   try{resource=await this.json(url,{headers:{Accept:'application/json'}},signal);break;}catch(error){if(signal?.aborted)throw cancelled();if(error.status!==404&&error.status!==405)throw error;}
  }
  if(!resource||canonical(resource.resource)!==canonical(ENDPOINT)||!Array.isArray(resource.authorization_servers)||!resource.authorization_servers.length)throw new Error('입지톡의 공식 인증 서버 정보를 확인하지 못했습니다.');
  const issuer=secureUrl(resource.authorization_servers[0]);let metadata;
  const candidatesAS=[...metadataUrls(issuer,'oauth-authorization-server'),...metadataUrls(issuer,'openid-configuration')];
  for(const url of [...new Set(candidatesAS)]){
   try{metadata=await this.json(url,{headers:{Accept:'application/json'}},signal);break;}catch(error){if(signal?.aborted)throw cancelled();if(error.status!==404&&error.status!==405)throw error;}
  }
  if(!metadata||canonical(metadata.issuer)!==canonical(issuer))throw new Error('입지톡 인증 서버의 발급자 정보가 일치하지 않습니다.');
  for(const field of ['authorization_endpoint','token_endpoint','registration_endpoint'])if(metadata[field])secureUrl(metadata[field]);
  if(!metadata.authorization_endpoint||!metadata.token_endpoint||!metadata.registration_endpoint)throw new Error('입지톡 인증 서버가 이 앱의 독립 로그인을 지원하지 않습니다. 입지톡에 앱 연결 지원을 확인해 주세요.');
  if(metadata.code_challenge_methods_supported&&!metadata.code_challenge_methods_supported.includes('S256'))throw new Error('입지톡 인증 서버가 안전한 로그인 방식을 지원하지 않습니다.');
  if(metadata.token_endpoint_auth_methods_supported&&!metadata.token_endpoint_auth_methods_supported.includes('none'))throw new Error('입지톡 인증 서버가 PC 앱의 로그인을 지원하지 않습니다.');
  return {resource,issuer,metadata};
 }
 async login(){
  if(this.pendingLogin)return {authorizationUrl:this.pendingLogin.authorizationUrl};
  if(this.loggingIn)return this.loggingIn;
  this.loggingIn=this.beginLogin().finally(()=>{this.loggingIn=null;});return this.loggingIn;
 }
 async beginLogin(){
  if(!this.encryptedStorageAvailable())throw new Error('이 PC의 안전한 인증정보 저장 기능을 사용할 수 없습니다. Windows 사용자 계정 상태를 확인해 주세요.');
  const controller=new AbortController();this.controllers.add(controller);let attempt;
  try{
   const discovered=await this.discover(controller.signal),verifier=randomBytes(48).toString('base64url'),state=randomBytes(32).toString('base64url');
   const server=http.createServer((req,res)=>this.callback(attempt,req,res).catch(()=>{if(!res.writableEnded)res.end();this.finishLogin(attempt,false,'입지톡 로그인을 완료하지 못했습니다. 다시 시도해 주세요.');}));server.headersTimeout=5000;server.requestTimeout=10000;server.maxHeadersCount=30;
   await listenLoopback(server,{signal:controller.signal});
   attempt={server,controller,verifier,state,discovered,finished:false,exchanging:false,redirectUri:`http://127.0.0.1:${server.address().port}/oauth/callback`};
   server.on('error',()=>this.finishLogin(attempt,false,'입지톡 로그인 연결이 종료됐습니다. 지도 연결에서 다시 시도해 주세요.'));
   // Dynamic registration is scoped to this loopback listener. No embedded
   // secret or another application's OAuth client registration is reused.
   const registration=await this.json(discovered.metadata.registration_endpoint,{method:'POST',headers:{Accept:'application/json','Content-Type':'application/json'},body:JSON.stringify({client_name:'AI SHERPA 부동산 도우미',redirect_uris:[attempt.redirectUri],token_endpoint_auth_method:'none',grant_types:['authorization_code','refresh_token'],response_types:['code'],application_type:'native'})},controller.signal);
   if(typeof registration.client_id!=='string'||!registration.client_id||registration.client_id.length>4096||registration.token_endpoint_auth_method&&registration.token_endpoint_auth_method!=='none'||registration.redirect_uris&&(!Array.isArray(registration.redirect_uris)||!registration.redirect_uris.includes(attempt.redirectUri)))throw new Error('입지톡 앱 인증 등록을 확인하지 못했습니다.');
   attempt.clientId=registration.client_id;
   const url=new URL(discovered.metadata.authorization_endpoint);
   for(const [k,v] of Object.entries({response_type:'code',client_id:attempt.clientId,redirect_uri:attempt.redirectUri,state,code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256',resource:ENDPOINT}))url.searchParams.set(k,v);
   if(Array.isArray(discovered.resource.scopes_supported)&&discovered.resource.scopes_supported.length)url.searchParams.set('scope',discovered.resource.scopes_supported.join(' '));
   attempt.authorizationUrl=url.href;this.pendingLogin=attempt;
   attempt.timer=setTimeout(()=>this.finishLogin(attempt,false,'입지톡 로그인 시간이 만료됐습니다. 지도 연결에서 다시 시도해 주세요.'),180000);attempt.timer.unref?.();
   return {authorizationUrl:attempt.authorizationUrl};
  }catch(error){if(attempt){attempt.server.close();attempt.server.closeAllConnections?.();}this.controllers.delete(controller);if(controller.signal.aborted)throw cancelled();throw error;}
 }
 finishLogin(attempt,success,error){
  if(!attempt||attempt.finished)return;attempt.finished=true;clearTimeout(attempt.timer);attempt.controller.abort();attempt.server.close();attempt.server.closeAllConnections?.();this.controllers.delete(attempt.controller);if(this.pendingLogin===attempt)this.pendingLogin=null;
  if(success){this.resetSession();this.ipzitalkUsage.reset();this.emit('progress',{stage:'ipzitalk-usage',usage:this.ipzitalkUsage.snapshot()});}
  this.emit('notification',{method:'mcpServer/oauthLogin/completed',params:{name:'ipzitalk',success,...(error?{error}: {})}});
 }
 async callback(attempt,req,res){
  const reply=(status,message)=>{res.writeHead(status,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'",'X-Content-Type-Options':'nosniff'});res.end('<!doctype html><html lang="ko"><meta charset="utf-8"><title>입지톡 연결</title><body><p>'+message+'</p></body></html>');};
  if(!attempt||attempt.finished){reply(410,'로그인 연결이 만료됐습니다. 프로그램에서 다시 시도해 주세요.');return;}
  let url;try{url=new URL(req.url,attempt.redirectUri);}catch{reply(400,'로그인 요청을 확인하지 못했습니다.');return;}
  if(req.method!=='GET'||url.pathname!=='/oauth/callback'){reply(404,'로그인 확인 페이지가 아닙니다.');return;}
  if(req.headers.host!==new URL(attempt.redirectUri).host||!sameSecret(url.searchParams.get('state'),attempt.state)){reply(400,'로그인 확인 정보가 일치하지 않습니다.');return;}
  if(url.searchParams.has('iss')){let matches=false;try{matches=canonical(url.searchParams.get('iss'))===canonical(attempt.discovered.issuer);}catch{}if(!matches){reply(400,'로그인 인증 서버가 일치하지 않습니다.');return;}}
  if(attempt.exchanging){reply(409,'로그인을 확인하고 있습니다. 프로그램으로 돌아가 주세요.');return;}
  if(url.searchParams.has('error')){reply(400,'입지톡 로그인이 취소됐습니다. 프로그램에서 다시 시도해 주세요.');setImmediate(()=>this.finishLogin(attempt,false,'입지톡 로그인이 취소됐습니다.'));return;}
  const code=url.searchParams.get('code');if(!code||code.length>8192){reply(400,'로그인 승인 정보를 확인하지 못했습니다.');return;}
  attempt.exchanging=true;
  try{
   const response=await this.tokenRequest(attempt.discovered.metadata,{grant_type:'authorization_code',code,redirect_uri:attempt.redirectUri,client_id:attempt.clientId,code_verifier:attempt.verifier,resource:ENDPOINT},attempt.controller.signal);
   const tokens=this.tokenRecord(response,{clientId:attempt.clientId,issuer:attempt.discovered.issuer,metadata:attempt.discovered.metadata});
   if(attempt.finished||attempt.controller.signal.aborted)throw cancelled();await this.save(tokens);this.loaded=Promise.resolve();
   reply(200,'입지톡 연결이 완료됐습니다. 이 창을 닫고 부동산 도우미로 돌아가 주세요.');setImmediate(()=>this.finishLogin(attempt,true));
  }catch{reply(400,'입지톡 인증을 완료하지 못했습니다. 프로그램에서 다시 로그인해 주세요.');setImmediate(()=>this.finishLogin(attempt,false,'입지톡 인증을 완료하지 못했습니다. 다시 로그인해 주세요.'));}
 }
 async tokenRequest(metadata,params,signal){
  const {response,cleanup}=await this.request(secureUrl(metadata.token_endpoint),{method:'POST',headers:{Accept:'application/json','Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(params).toString()},signal);
  try{
   const result=await this.read(response,{limit:AUTH_BYTES});
   if(!response.ok||result?.error){const error=new Error('입지톡 인증이 만료됐습니다. 지도 연결에서 다시 로그인해 주세요.');error.code=result?.error==='invalid_grant'?'IPZITALK_AUTH_REQUIRED':'IPZITALK_TOKEN_FAILED';throw error;}
   return result;
  }finally{cleanup();}
 }
 tokenRecord(response,previous){
  if(!response||typeof response.access_token!=='string'||!response.access_token||response.access_token.length>32768||String(response.token_type||'').toLowerCase()!=='bearer'||response.refresh_token!==undefined&&(typeof response.refresh_token!=='string'||response.refresh_token.length>32768))throw new Error('입지톡 인증 응답을 확인하지 못했습니다.');
  const seconds=Number(response.expires_in);
  // Without expires_in, try the issued token; a 401 triggers refresh/login.
  return {...previous,resource:ENDPOINT,accessToken:response.access_token,refreshToken:response.refresh_token||previous.refreshToken||null,expiresAt:Number.isFinite(seconds)&&seconds>0?Date.now()+Math.min(seconds,31536000)*1000:Number.MAX_SAFE_INTEGER};
 }
 async accessToken(signal,{force=false}={}){
  await this.load();if(!this.tokens)return null;
  if(!force&&this.tokens.expiresAt>Date.now()+30000)return this.tokens.accessToken;
  if(!this.tokens.refreshToken){if(!force&&this.tokens.expiresAt>Date.now())return this.tokens.accessToken;this.authRequired=true;throw loginRequired();}
  if(!this.refreshing)this.refreshing=(async()=>{
   const old=this.tokens;
   try{const result=await this.tokenRequest(old.metadata,{grant_type:'refresh_token',refresh_token:old.refreshToken,client_id:old.clientId,resource:ENDPOINT},signal);if(this.tokens!==old)return this.tokens?.accessToken||null;const fresh=this.tokenRecord(result,old);await this.save(fresh);return fresh.accessToken;}
   catch(error){if(this.tokens!==old&&this.tokens)return this.tokens.accessToken;if(error.code==='IPZITALK_AUTH_REQUIRED'){this.tokens=null;this.authRequired=true;this.resetSession();await fs.rm(this.credentialFile,{force:true}).catch(()=>{});}throw error;}
  })().finally(()=>{this.refreshing=null;});
  return this.refreshing;
 }
 async rpc(method,params,{signal,notification=false,retryAuth=true}={}){
  if(signal?.aborted)throw cancelled();
  const id=++this.seq,token=await this.accessToken(signal),headers={Accept:'application/json, text/event-stream','Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{}),...(this.sessionId?{'Mcp-Session-Id':this.sessionId}:{}),...(method!=='initialize'?{'MCP-Protocol-Version':this.protocol}:{})};
  const {response,cleanup}=await this.request(ENDPOINT,{method:'POST',headers,body:JSON.stringify({jsonrpc:'2.0',...(!notification?{id}:{}),method,...(params?{params}:{})})},signal,45000);
  if(response.status===401){
   try{await response.body?.cancel();}catch{}finally{cleanup();}
   if(token&&retryAuth&&this.tokens?.refreshToken){if(this.tokens.accessToken===token)await this.accessToken(signal,{force:true});return this.rpc(method,params,{signal,notification,retryAuth:false});}
   this.authRequired=true;this.resetSession();throw loginRequired();
  }
  try{
   if(!response.ok){await response.body?.cancel();if(response.status===403)throw new Error('입지톡 조회 권한이 없습니다. 입지톡 이용 권한을 확인해 주세요.');if(response.status===404&&this.sessionId){this.resetSession();throw new Error('입지톡 연결이 만료됐습니다. 연결 확인 후 다시 시도해 주세요.');}throw new Error('입지톡 서버 응답 오류 ('+response.status+')');}
   const sid=response.headers.get('mcp-session-id');if(sid){if(sid.length>2048||/[\r\n]/.test(sid))throw new Error('입지톡 연결 정보를 확인하지 못했습니다.');this.sessionId=sid;}
   if(response.status===202&&notification){await response.body?.cancel();return null;}
   return await this.read(response,{id,notification});
  }catch(error){if(signal?.aborted||error?.name==='AbortError')throw cancelled();if(error?.name==='TimeoutError')throw new Error('입지톡 연결 응답이 늦습니다. 잠시 후 다시 시도해 주세요.');throw error;}finally{cleanup();}
 }
 async ensure(signal){
  if(signal?.aborted)throw cancelled();
  await this.load();if(!this.tokens)throw loginRequired();
  if(!this.ready)this.ready=(async()=>{
   const initialized=await this.rpc('initialize',{protocolVersion:PROTOCOL,capabilities:{},clientInfo:{name:'real-estate-helper',version:require('../package.json').version}},{signal});
   if(!['2024-11-05','2025-03-26','2025-06-18','2025-11-25'].includes(initialized?.protocolVersion))throw new Error('입지톡 통신 버전을 확인하지 못했습니다.');
   this.protocol=initialized.protocolVersion;await this.rpc('notifications/initialized',null,{signal,notification:true});
   const tools={};let cursor;const seen=new Set();
   do{
    const inventory=await this.rpc('tools/list',cursor?{cursor}:undefined,{signal});if(!Array.isArray(inventory?.tools)||inventory.tools.length>500)throw new Error('입지톡 자료 조회 도구 정보를 확인하지 못했습니다.');
    for(const tool of inventory.tools)if(ALLOWED.has(tool?.name))tools[tool.name]=tool;
    cursor=inventory.nextCursor;if(cursor){if(typeof cursor!=='string'||cursor.length>4096||seen.has(cursor)||seen.size>=20)throw new Error('입지톡 도구 목록 조회를 완료하지 못했습니다.');seen.add(cursor);}
   }while(cursor);
   if(!Object.keys(tools).length)throw new Error('입지톡 자료 조회 도구가 준비되지 않았습니다.');
   this.tools=tools;this.authRequired=false;return tools;
  })().catch(error=>{this.resetSession();throw error;});
  return this.ready;
 }
 async status(){
  await this.load();if(!this.tokens)return {connected:false,loggedIn:false,tools:{}};
  try{const tools=await this.ensure();return {connected:true,loggedIn:!!this.tokens,tools};}
  catch(error){return {connected:false,loggedIn:!!this.tokens&&!this.authRequired,tools:{},error:error.message};}
 }
 async evidenceSession({signal}={}){return {tools:await this.ensure(signal)};}
 async evidenceTool(session,tool,args,{signal}={}){
  if(!ALLOWED.has(tool)||!session?.tools?.[tool])throw new Error('허용된 자료 조회 도구를 사용할 수 없습니다: '+tool);
  if(signal?.aborted)throw cancelled();
  if(tool==='search_by_nearby_category'&&Array.isArray(args.categories))args={...args,categories:args.categories.filter(c=>c!=='academy')};
  const skipped=(error,message)=>({type:'mcpToolCall',server:'ipzitalk',tool,arguments:args,networkSkipped:true,result:{isError:true,content:[{type:'text',text:JSON.stringify({error,message})}]},status:'failed'});
  if(tool==='search_by_nearby_category'&&Array.isArray(args.categories)&&!args.categories.length)return skipped('UNSUPPORTED_CATEGORY','학원 분류 묶음은 지원하지 않아 과목별 주변 키워드 조회를 사용합니다.');
  if(this.ipzitalkUsage.snapshot().limited)return skipped('DAILY_TOOL_LIMIT_EXCEEDED','같은 날 확인된 조회 한도로 추가 요청을 생략했습니다.');
  return this.evidenceBudget.reuse(tool,args,async()=>{
   await this.ensure(signal);if(signal?.aborted)throw cancelled();this.evidenceBudget.take(tool);
   this.emit('progress',{stage:'ipzitalk-usage',usage:{...this.ipzitalkUsage.requestStarted(),requestBudget:this.evidenceBudget.snapshot()}});
   const result=await this.rpc('tools/call',{name:tool,arguments:args},{signal});
   if(!result||typeof result!=='object'||!Array.isArray(result.content)&&!result.structuredContent)throw new Error('입지톡 자료 응답을 확인하지 못했습니다.');
   const item={type:'mcpToolCall',server:'ipzitalk',tool,arguments:args,result,status:result.isError?'failed':'completed'};
   this.emit('progress',{stage:'ipzitalk-usage',usage:{...this.ipzitalkUsage.observe(item,{count:false}),requestBudget:this.evidenceBudget.snapshot()}});
   if(signal?.aborted)throw cancelled();return item;
  });
 }
 async interrupt(){for(const controller of this.controllers)controller.abort();if(this.pendingLogin)this.finishLogin(this.pendingLogin,false,'입지톡 로그인을 중지했습니다.');this.resetSession();}
 stop(){this.interrupt().catch(()=>{});}
}
module.exports={IpzitalkBridge,ENDPOINT,listenLoopback};
