'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const http=require('node:http');
const {createHash}=require('node:crypto');
const {once}=require('node:events');
const {IpzitalkBridge,ENDPOINT,listenLoopback}=require('../src/ipzitalk-bridge.cjs');
const issuer='https://auth.ipji-talk.com',metadata={issuer,authorization_endpoint:issuer+'/authorize',token_endpoint:issuer+'/token',registration_endpoint:issuer+'/register',code_challenge_methods_supported:['S256'],token_endpoint_auth_methods_supported:['none']};
const storage={isEncryptionAvailable:()=>true,encryptString:value=>Buffer.from('encrypted:'+value).reverse(),decryptString:value=>Buffer.from(value).reverse().toString().slice(10)};
const json=(value,status=200,headers={})=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json',...headers}});
function credentials(extra={}){return {resource:ENDPOINT,accessToken:'access-one',refreshToken:'refresh-one',expiresAt:Date.now()+3600000,clientId:'native-client',issuer,metadata,...extra};}
function connected(fetcher){const bridge=new IpzitalkBridge({fetcher});bridge.tokens=credentials();bridge.loaded=Promise.resolve();return bridge;}
function server({result={content:[{type:'text',text:'{}'}]},sse=false,onCall=()=>{}}={}){
 const calls=[];
 const fetcher=async(url,options)=>{
  assert.equal(url,ENDPOINT);const p=JSON.parse(options.body);calls.push({p,options});
  if(p.method==='initialize')return json({jsonrpc:'2.0',id:p.id,result:{protocolVersion:'2025-06-18',capabilities:{tools:{}}}},200,{'mcp-session-id':'session-a'});
  if(p.method==='notifications/initialized')return new Response(null,{status:202});
  if(p.method==='tools/list')return json({jsonrpc:'2.0',id:p.id,result:{tools:[{name:'get_geocode',inputSchema:{type:'object'}},{name:'get_map_embed_url'},{name:'search_by_nearby_keyword'},{name:'search_by_nearby_category'},{name:'dangerous_account_write'}]}});
  if(p.method==='tools/call'){
   onCall(p);if(!sse)return json({jsonrpc:'2.0',id:p.id,result});
   const data=JSON.stringify({jsonrpc:'2.0',id:p.id,result});
   const split=data.indexOf(',')+1,chunks=[': keepalive\r\n\r\ndata: '+JSON.stringify({jsonrpc:'2.0',method:'notifications/message',params:{}})+'\r\n\r\n','event: message\r\ndata: '+data.slice(0,split),'\r\ndata: '+data.slice(split)+'\r\n\r\n'];
   return new Response(new ReadableStream({start(controller){for(const chunk of chunks)controller.enqueue(new TextEncoder().encode(chunk));controller.close();}}),{headers:{'content-type':'text/event-stream'}});
  }
  throw Error('Unexpected '+p.method);
 };
 return {fetcher,calls};
}
async function temporary(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'re-ipzitalk-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));return root;}

test('OAuth callback listener uses browser-safe high ports and deterministically retries an occupied port',async t=>{
 const busy=http.createServer(),reservation=http.createServer(),listener=http.createServer(),originalListening=listener.listeners('listening');
 t.after(()=>{for(const server of [busy,reservation,listener]){server.close();server.closeAllConnections();}});
 const occupied=(await listenLoopback(busy)).port,available=(await listenLoopback(reservation)).port;
 await new Promise(resolve=>reservation.close(resolve));
 const selected=[];const address=await listenLoopback(listener,{choosePort:()=>{const port=selected.length?available:occupied;selected.push(port);return port;}});
 assert.deepEqual(selected,[occupied,available]);assert.equal(address.port,available);assert.equal(address.address,'127.0.0.1');assert.ok(selected.every(port=>port>=49152&&port<=65535));
 assert.equal(listener.listenerCount('error'),0);assert.deepEqual(listener.listeners('listening'),originalListening);
 const exhausted=http.createServer();let attempts=0;await assert.rejects(listenLoopback(exhausted,{choosePort:()=>{attempts++;return occupied;},maxAttempts:3}),/포트가 사용 중/);
 assert.equal(attempts,3);assert.equal(exhausted.listening,false);assert.equal(exhausted.listenerCount('error'),0);
});

test('callback listener cancellation and unsafe port rejection leave no socket or temporary listeners',async()=>{
 for(const immediate of [true,false]){
  const listener=http.createServer(),controller=new AbortController(),originalListening=listener.listeners('listening');if(immediate)controller.abort();
  const pending=listenLoopback(listener,{signal:controller.signal});if(!immediate)controller.abort();
  await assert.rejects(pending,error=>error.code==='ABORT_ERR');await new Promise(resolve=>setImmediate(resolve));assert.equal(listener.listening,false);assert.equal(listener.listenerCount('error'),0);assert.deepEqual(listener.listeners('listening'),originalListening);assert.equal(listener.listenerCount('close'),0);
 }
 const listener=http.createServer();await assert.rejects(listenLoopback(listener,{choosePort:()=>6000}),/포트를 확인/);assert.equal(listener.listening,false);
});

test('unconfigured status is local and never starts OAuth or reads Codex credentials',async()=>{
 let calls=0;const bridge=new IpzitalkBridge({fetcher:async()=>{calls++;throw Error('network');}});
 assert.deepEqual(await bridge.status(),{connected:false,loggedIn:false,tools:{}});assert.equal(calls,0);
 await assert.rejects(bridge.evidenceSession(),/입지톡 로그인이 필요/);assert.equal(calls,0);
});

test('direct MCP keeps the existing item shape, allowlist, headers, and usage without an AI account',async()=>{
 const remote=server(),bridge=connected(remote.fetcher),session=await bridge.evidenceSession();
 assert.equal(session.tools.dangerous_account_write,undefined);
 await assert.rejects(bridge.evidenceTool(session,'dangerous_account_write',{}),/허용된 자료/);
 const item=await bridge.evidenceTool(session,'get_geocode',{address:'서울'});
 assert.equal(item.type,'mcpToolCall');assert.equal(item.server,'ipzitalk');assert.equal(item.status,'completed');assert.deepEqual(item.arguments,{address:'서울'});
 assert.equal(bridge.ipzitalkUsage.snapshot().sessionCalls,1);
 assert.equal(remote.calls[0].options.headers.Authorization,'Bearer access-one');
 assert.equal(remote.calls.at(-1).options.headers['Mcp-Session-Id'],'session-a');assert.equal(remote.calls.at(-1).options.headers['MCP-Protocol-Version'],'2025-06-18');
});

test('SSE accepts chunked and multiline data and ignores server notifications',async()=>{
 const result={content:[{type:'text',text:'시설 자료'}],structuredContent:{metadata:{}}},remote=server({sse:true,result}),bridge=connected(remote.fetcher);
 const item=await bridge.evidenceTool(await bridge.evidenceSession(),'get_geocode',{});assert.deepEqual(item.result,result);
});

test('SSE handles CR-only delimiters and body-read cancellation uses the standard cancel error',async()=>{
 const bridge=new IpzitalkBridge();
 const data=JSON.stringify({jsonrpc:'2.0',id:7,result:{content:[]}});
 const response=new Response(new ReadableStream({start(controller){for(const chunk of ['event: message\r','data: '+data+'\r','\r'])controller.enqueue(new TextEncoder().encode(chunk));controller.close();}}),{headers:{'content-type':'text/event-stream'}});
 assert.deepEqual(await bridge.read(response,{id:7}),{content:[]});
 const aborted=new Response(new ReadableStream({start(controller){controller.error(new DOMException('body aborted','AbortError'));}}));
 await assert.rejects(bridge.read(aborted),error=>error.code==='ABORT_ERR'&&/분석을 중지/.test(error.message));
});

test('HTTP authentication errors discard secret error bodies and always release request controllers',async()=>{
 const bridge=connected(async()=>new Response(new ReadableStream({cancel(){throw Error('server-private-detail');}}),{status:401}));bridge.tokens.refreshToken=null;
 await assert.rejects(bridge.rpc('tools/call',{}),/입지톡 로그인이 필요/);assert.equal(bridge.controllers.size,0);
 const denied=connected(async()=>new Response('server-private-detail',{status:403}));
 await assert.rejects(denied.rpc('tools/call',{}),error=>/입지톡 조회 권한/.test(error.message)&&!error.message.includes('private'));assert.equal(denied.controllers.size,0);
});

test('shared budget reuses concurrent queries and unsupported academy categories do not hit the server',async()=>{
 const remote=server(),bridge=connected(remote.fetcher),session=await bridge.evidenceSession();
 await bridge.evidenceBudget.run({},async()=>{
  const results=await Promise.all(Array.from({length:15},()=>bridge.evidenceTool(session,'get_geocode',{address:'same'})));
  assert.equal(results.filter(r=>r.reused).length,14);assert.equal(bridge.evidenceBudget.snapshot().calls,1);
  const unsupported=await bridge.evidenceTool(session,'search_by_nearby_category',{categories:['academy']});assert.equal(unsupported.networkSkipped,true);
  await bridge.evidenceTool(session,'search_by_nearby_category',{categories:['academy','mart']});
  assert.deepEqual(remote.calls.at(-1).p.params.arguments.categories,['mart']);assert.equal(bridge.evidenceBudget.snapshot().calls,2);
 });
 assert.equal(bridge.ipzitalkUsage.snapshot().sessionCalls,2);
});

test('confirmed daily limits remain latched and suppress later requests without counting them',async()=>{
 const remote=server({result:{isError:true,structuredContent:{error:'DAILY_TOOL_LIMIT_EXCEEDED'},content:[]}}),bridge=connected(remote.fetcher),session=await bridge.evidenceSession();
 const first=await bridge.evidenceTool(session,'get_geocode',{});assert.equal(first.status,'failed');
 const second=await bridge.evidenceTool(session,'get_map_embed_url',{});assert.equal(second.networkSkipped,true);assert.equal(bridge.ipzitalkUsage.snapshot().sessionCalls,1);assert.equal(bridge.ipzitalkUsage.snapshot().limited,true);
});

test('abort after a sent request is counted and interrupt aborts its transport',async()=>{
 const remote=server(),bridge=connected(async(url,options)=>{
  const p=JSON.parse(options.body);if(p.method!=='tools/call')return remote.fetcher(url,options);
  return new Promise((resolve,reject)=>{options.signal.addEventListener('abort',()=>reject(Object.assign(Error('aborted'),{name:'AbortError'})),{once:true});});
 }),session=await bridge.evidenceSession();
 const work=bridge.evidenceTool(session,'get_geocode',{});await new Promise(resolve=>setImmediate(resolve));await bridge.interrupt();await assert.rejects(work,/분석을 중지/);assert.equal(bridge.ipzitalkUsage.snapshot().sessionCalls,1);assert.equal(bridge.controllers.size,0);
});

test('mismatched JSON-RPC ids and malformed results are rejected',async()=>{
 for(const result of [{jsonrpc:'2.0',id:999,result:{}},{jsonrpc:'2.0',id:1,error:{code:-32603,message:'do not expose server detail'}}]){
  const bridge=connected(async()=>json(result));await assert.rejects(bridge.rpc('tools/call',{}),/입지톡/);
 }
});

function oauthServer({tokenError=false,onToken=()=>{},resource={},metadataOverride={}}={}){
 const calls=[];
 return {calls,fetcher:async(url,options={})=>{
  calls.push({url,options});
  if(url===ENDPOINT)return new Response(null,{status:401,headers:{'www-authenticate':'Bearer resource_metadata="https://ipji-talk.com/.well-known/oauth-protected-resource/mcp"'}});
  if(url==='https://ipji-talk.com/.well-known/oauth-protected-resource/mcp')return json({resource:ENDPOINT,authorization_servers:[issuer],scopes_supported:['mcp:tools'],...resource});
  if(url===issuer+'/.well-known/oauth-authorization-server')return json({...metadata,...metadataOverride});
  if(url===metadata.registration_endpoint){const registration=JSON.parse(options.body);return json({client_id:'native-client',token_endpoint_auth_method:'none',redirect_uris:registration.redirect_uris});}
  if(url===metadata.token_endpoint){onToken(new URLSearchParams(options.body));return tokenError?json({error:'invalid_grant',error_description:'private server details'},400):json({access_token:'oauth-secret-access',refresh_token:'oauth-secret-refresh',token_type:'Bearer',expires_in:3600});}
  throw Error('Unexpected fake OAuth request '+url);
 }};
}

test('OAuth uses discovery, dynamic registration, PKCE, resource binding and an encrypted independent store',async t=>{
 const root=await temporary(t);let tokenParams;const remote=oauthServer({onToken:value=>{tokenParams=value;}}),bridge=new IpzitalkBridge({userData:root,safeStorage:storage,fetcher:remote.fetcher});t.after(()=>bridge.stop());
 const result=await bridge.login(),authorization=new URL(result.authorizationUrl),redirect=authorization.searchParams.get('redirect_uri');
 assert.equal(authorization.origin,issuer);assert.equal(authorization.searchParams.get('code_challenge_method'),'S256');assert.equal(authorization.searchParams.get('resource'),ENDPOINT);assert.equal(authorization.searchParams.get('scope'),'mcp:tools');assert.equal(new URL(redirect).hostname,'127.0.0.1');assert.ok(Number(new URL(redirect).port)>=49152&&Number(new URL(redirect).port)<=65535);
 const bad=new URL(redirect);bad.searchParams.set('state','wrong');bad.searchParams.set('code','some-code');assert.equal((await fetch(bad)).status,400);assert.equal(tokenParams,undefined);
 const callback=new URL(redirect);callback.searchParams.set('state',authorization.searchParams.get('state'));callback.searchParams.set('code','test-code');
 const complete=once(bridge,'notification');const response=await fetch(callback);assert.equal(response.status,200);assert.match(await response.text(),/연결이 완료/);const [event]=await complete;assert.equal(event.params.success,true);
 assert.equal(tokenParams.get('resource'),ENDPOINT);assert.equal(tokenParams.get('code'),'test-code');assert.equal(tokenParams.get('redirect_uri'),redirect);assert.equal(createHash('sha256').update(tokenParams.get('code_verifier')).digest('base64url'),authorization.searchParams.get('code_challenge'));
 assert.equal(tokenParams.get('client_secret'),null);assert.equal(bridge.pendingLogin,null);assert.equal(bridge.controllers.size,0);
 const file=await fs.readFile(path.join(root,'ipzitalk-credentials.json'),'utf8');assert.ok(!file.includes('oauth-secret'));assert.ok(!file.includes('test-code'));assert.ok(!file.includes(tokenParams.get('code_verifier')));
 const next=new IpzitalkBridge({userData:root,safeStorage:storage,fetcher:server().fetcher});await next.load();assert.equal(next.tokens.accessToken,'oauth-secret-access');assert.equal(next.tokens.refreshToken,'oauth-secret-refresh');
});

test('OAuth failure emits a safe completion event and closes the loopback listener',async t=>{
 const root=await temporary(t),remote=oauthServer({tokenError:true}),bridge=new IpzitalkBridge({userData:root,safeStorage:storage,fetcher:remote.fetcher});t.after(()=>bridge.stop());
 const url=new URL((await bridge.login()).authorizationUrl),callback=new URL(url.searchParams.get('redirect_uri'));callback.searchParams.set('state',url.searchParams.get('state'));callback.searchParams.set('code','secret-code');
 const complete=once(bridge,'notification');assert.equal((await fetch(callback)).status,400);const [event]=await complete;assert.equal(event.params.success,false);assert.ok(!JSON.stringify(event).includes('private'));assert.ok(!JSON.stringify(event).includes('secret-code'));assert.equal(bridge.pendingLogin,null);assert.equal(bridge.tokens,null);
});

test('login requires secure OS storage and rejects resource, issuer, and non-HTTPS endpoint mismatches',async t=>{
 const root=await temporary(t);let calls=0;const unavailable=new IpzitalkBridge({userData:root,fetcher:async()=>{calls++;}});await assert.rejects(unavailable.login(),/안전한 인증정보/);assert.equal(calls,0);
 for(const options of [{resource:{resource:'https://other.example/mcp'}},{metadataOverride:{issuer:'https://other.example'}},{metadataOverride:{token_endpoint:'http://127.0.0.1/token'}},{metadataOverride:{code_challenge_methods_supported:['plain']}},{metadataOverride:{registration_endpoint:undefined}}]){
  const remote=oauthServer(options),bridge=new IpzitalkBridge({userData:root,safeStorage:storage,fetcher:remote.fetcher});await assert.rejects(bridge.login(),/입지톡/);assert.equal(bridge.pendingLogin,null);assert.equal(bridge.controllers.size,0);
 }
});

test('refresh rotates and encrypts credentials once for concurrent requests and includes the bound resource',async t=>{
 const root=await temporary(t);let refresh=0;const remote=server(),bridge=new IpzitalkBridge({userData:root,safeStorage:storage,fetcher:async(url,options)=>{
  if(url!==metadata.token_endpoint)return remote.fetcher(url,options);refresh++;const form=new URLSearchParams(options.body);assert.equal(form.get('resource'),ENDPOINT);assert.equal(form.get('refresh_token'),'refresh-one');return json({access_token:'access-two',refresh_token:'refresh-two',token_type:'Bearer',expires_in:3600});
 }});await bridge.save(credentials({expiresAt:Date.now()-1000}));bridge.loaded=Promise.resolve();
 const [a,b]=await Promise.all([bridge.accessToken(),bridge.accessToken()]);assert.equal(a,'access-two');assert.equal(b,'access-two');assert.equal(refresh,1);assert.equal(bridge.tokens.refreshToken,'refresh-two');
 const next=new IpzitalkBridge({userData:root,safeStorage:storage});await next.load();assert.equal(next.tokens.refreshToken,'refresh-two');
});

test('an invalid refresh clears credentials and requires a new independent map login',async t=>{
 const root=await temporary(t),bridge=new IpzitalkBridge({userData:root,safeStorage:storage,fetcher:async()=>json({error:'invalid_grant'},400)});await bridge.save(credentials({expiresAt:Date.now()-1}));bridge.loaded=Promise.resolve();
 await assert.rejects(bridge.accessToken(),/다시 로그인/);assert.equal(bridge.tokens,null);await assert.rejects(fs.stat(bridge.credentialFile),{code:'ENOENT'});assert.deepEqual(await bridge.status(),{connected:false,loggedIn:false,tools:{}});
});

test('an expired server-side token refreshes once, retries authorization and stops on another 401',async t=>{
 const root=await temporary(t);let refresh=0,mcp=0;
 const bridge=new IpzitalkBridge({userData:root,safeStorage:storage,fetcher:async(url,options)=>{
  if(url===metadata.token_endpoint){refresh++;return json({access_token:'access-two',token_type:'Bearer',expires_in:3600});}
  assert.equal(url,ENDPOINT);mcp++;assert.equal(options.headers.Authorization,mcp===1?'Bearer access-one':'Bearer access-two');return new Response(null,{status:401});
 }});await bridge.save(credentials());bridge.loaded=Promise.resolve();
 await assert.rejects(bridge.rpc('tools/call',{name:'get_geocode',arguments:{}}),/입지톡 로그인이 필요/);assert.equal(refresh,1);assert.equal(mcp,2);assert.equal(bridge.authRequired,true);
});

test('paged inventories keep allowed tools and reject a looping continuation cursor',async()=>{
 const remote=server();let pages=0;
 const bridge=connected(async(url,options)=>{
  const p=JSON.parse(options.body);if(p.method!=='tools/list')return remote.fetcher(url,options);pages++;
  return json({jsonrpc:'2.0',id:p.id,result:{tools:[{name:pages===1?'get_geocode':'get_map_embed_url'}],...(pages===1?{nextCursor:'second-page'}:{})}});
 });
 const session=await bridge.evidenceSession();assert.ok(session.tools.get_geocode);assert.ok(session.tools.get_map_embed_url);assert.equal(pages,2);
 const looping=connected(async(url,options)=>{const p=JSON.parse(options.body);return p.method==='tools/list'?json({jsonrpc:'2.0',id:p.id,result:{tools:[],nextCursor:'loop'}}):remote.fetcher(url,options);});
 await assert.rejects(looping.evidenceSession(),/목록 조회를 완료/);
});

test('stop cancels explicit login, emits failure, and leaves no callback server or pending controllers',async t=>{
 const root=await temporary(t),bridge=new IpzitalkBridge({userData:root,safeStorage:storage,fetcher:oauthServer().fetcher});await bridge.login();const attempt=bridge.pendingLogin,event=once(bridge,'notification');bridge.stop();const [message]=await event;assert.equal(message.params.success,false);assert.equal(bridge.pendingLogin,null);assert.equal(bridge.controllers.size,0);assert.equal(attempt.server.listening,false);
});
