'use strict';
const {EventEmitter}=require('node:events');
const {quotaState}=require('./core.cjs');
const {supportsLowThinking}=require('./gemini.cjs');

const LABELS={gpt:'GPT',gemini:'Gemini',claude:'Claude'};
function provider(value='gpt'){
  if(!Object.hasOwn(LABELS,value))throw new Error('GPT, Gemini, Claude 중에서 선택해 주세요.');
  return value;
}
function geminiModels(models){
  const rows=models.map(m=>{const id=m.id||m.model;return {id,name:m.displayName||m.name||m.id,efforts:supportsLowThinking(id)?['low']:[],isDefault:false};});
  const stable=rows.filter(m=>!/(preview|experimental|exp-|latest)/i.test(m.id));
  const preferred=stable.filter(m=>/^gemini-\d+(?:\.\d+)?-flash$/.test(m.id)).sort((a,b)=>b.id.localeCompare(a.id,undefined,{numeric:true}))[0]||stable.find(m=>/flash/.test(m.id))||stable[0]||rows[0];
  if(preferred)preferred.isDefault=true;
  return rows;
}
function claudeModels(models){
  const rows=models.map(m=>({id:m.id||m.model,name:m.displayName||m.display_name||m.name||m.id,efforts:[],isDefault:false}));
  const stable=rows.filter(m=>!/(preview|experimental|latest)/i.test(m.id));
  const version=id=>(id.replace(/-\d{8}$/,'').match(/\d+/g)||[]).map(Number);
  const newest=list=>list.sort((a,b)=>{
    const av=version(a.id),bv=version(b.id);
    for(let i=0;i<Math.max(av.length,bv.length);i++){const difference=(bv[i]||0)-(av[i]||0);if(difference)return difference;}
    return b.id.localeCompare(a.id,undefined,{numeric:true});
  })[0];
  const preferred=newest(stable.filter(m=>/sonnet/.test(m.id)))||newest(stable.filter(m=>/haiku/.test(m.id)))||newest(stable)||rows[0];
  if(preferred)preferred.isDefault=true;
  return rows;
}
// Writers share the same deterministic analysis and report pipeline. The two
// API providers also share the independently authenticated evidence transport.
class AiBridge extends EventEmitter{
  constructor({codex,gemini,claude,ipzitalk,credentials,claudeCredentials}){
    super();Object.assign(this,{codex,gemini,claude,ipzitalk,credentials,claudeCredentials});this.provider='gpt';
    this.statusRequests=new Map();this.statusRevision=0;
    for(const source of [codex,gemini,claude,ipzitalk].filter(Boolean)){
      source.on('progress',p=>{if(source===this.writer||source===this.evidence)this.emit('progress',p);});
      source.on('notification',m=>this.emit('notification',m));
      source.on('connection-error',message=>{if(source===this.writer||source===this.evidence)this.emit('connection-error',message);});
    }
  }
  get writer(){return this[this.provider==='gpt'?'codex':this.provider];}
  get evidence(){return this.provider==='gpt'?this.codex:this.ipzitalk;}
  get ipzitalkUsage(){return this.evidence.ipzitalkUsage;}
  get evidenceBudget(){return this.evidence.evidenceBudget;}
  setProvider(value){this.provider=provider(value);}
  credentialsFor(name){return name==='claude'?this.claudeCredentials:this.credentials;}
  modelsFor(name,models){return name==='claude'?claudeModels(models):geminiModels(models);}
  async start(){if(this.provider==='gpt')await this.codex.start();}
  async request(method,params={},timeout){
    const name=this.provider;
    if(name==='gpt')return this.codex.request(method,params,timeout);
    if(method==='model/list')return {data:this.modelsFor(name,await this[name].models())};
    if(method==='account/logout')return this.disconnectProvider(name);
    if(method==='mcpServer/oauth/login')return this.ipzitalk.login();
    throw new Error('선택한 AI에서 사용할 수 없는 연결 요청입니다.');
  }
  connectionStatus(){
    const name=this.provider,key=name+':'+this.statusRevision;
    if(this.statusRequests.has(key))return this.statusRequests.get(key);
    const task=this.readConnectionStatus(name).finally(()=>{if(this.statusRequests.get(key)===task)this.statusRequests.delete(key);});
    this.statusRequests.set(key,task);return task;
  }
  async readConnectionStatus(name){
    const states=await Promise.all(['gemini','claude'].map(async p=>{
      const s=await this.credentialsFor(p)?.status();return [p,{hasKey:!!s?.configured,available:!!s?.available}];
    }));
    const keys=Object.fromEntries(states),evidence=name==='gpt'?this.codex:this.ipzitalk;
    const usage=()=>({ipzitalkUsage:{...evidence.ipzitalkUsage.snapshot(),requestBudget:evidence.evidenceBudget.snapshot()}});
    if(name!=='gpt'){
      const [modelResult,mapResult]=await Promise.allSettled([
        keys[name].hasKey?this[name].models():Promise.resolve([]),this.ipzitalk.status()
      ]);
      const models=modelResult.status==='fulfilled'?this.modelsFor(name,modelResult.value):[];
      const error=modelResult.status==='rejected'?modelResult.reason.message:null;
      const loggedIn=keys[name].hasKey&&!error&&models.length>0;
      const mapConnected=mapResult.status==='fulfilled'&&!!mapResult.value.connected;
      return {provider:name,connected:loggedIn,loggedIn,account:null,models,usage:null,mapConnected,...keys,...(error?{error}:{}),...usage()};
    }
    try{
      await this.codex.start();const account=await this.codex.request('account/read',{refreshToken:false});let limits=null,models=[],mapConnected=false;
      if(account.account){
        const results=await Promise.allSettled([this.codex.request('account/rateLimits/read',{},7000),this.codex.request('model/list',{}),this.codex.request('mcpServerStatus/list',{},15000)]);
        if(results[0].status==='fulfilled')limits=results[0].value;
        if(results[1].status==='fulfilled')models=results[1].value.data||[];
        if(results[2].status==='fulfilled'){const s=results[2].value.data?.find(x=>x.name==='ipzitalk');mapConnected=!!s&&Object.keys(s.tools||{}).length>0;}
      }
      return {provider:'gpt',connected:true,loggedIn:!!account.account,account:account.account?{email:account.account.email||'',type:account.account.type,planType:account.account.planType}:null,usage:limits?quotaState(limits):null,models:models.map(m=>({id:m.model||m.id,name:m.displayName||m.model||m.id,isDefault:m.isDefault,efforts:m.supportedReasoningEfforts||[]})),mapConnected,...keys,...usage()};
    }catch(e){return {provider:'gpt',connected:false,loggedIn:false,error:e.message,models:[],mapConnected:false,...keys};}
  }
  async connectProvider(name,apiKey,{signal,workspaceId}={}){
    if(!['gemini','claude'].includes(name))throw new Error('지원하지 않는 API 연결입니다.');
    const key=typeof apiKey==='string'?apiKey.trim():'',credentials=this.credentialsFor(name),writer=this[name];
    if(!key)throw new Error(LABELS[name]+' API 키를 입력해 주세요.');
    if(!(await credentials?.status())?.available)throw new Error('이 PC의 보안 저장 기능을 사용할 수 없습니다. 앱을 다시 실행한 뒤 연결해 주세요.');
    const context=name==='claude'?{workspaceId:require('./ai-credentials.cjs').validWorkspaceId(workspaceId)}:{};
    await writer.verifyConnection({apiKey:key,signal,...context});
    if(signal?.aborted)throw new Error('연결을 중지했습니다.');
    await credentials.saveApiKey(key,context);this.statusRevision++;
    // Verification caches are bound to the key hash, so reuse the successful
    // read instead of making another model lookup just after saving the key.
    return {connected:true,hasKey:true};
  }
  async checkProvider(name,{signal}={}){await this[name].verifyConnection({signal});this.statusRevision++;return {connected:true,hasKey:true};}
  async disconnectProvider(name){await this[name].interrupt();await this.credentialsFor(name).clear();this[name].invalidateModels?.();this.statusRevision++;return {connected:false,hasKey:false};}
  connectGemini(key,options){return this.connectProvider('gemini',key,options);}
  checkGemini(options){return this.checkProvider('gemini',options);}
  disconnectGemini(){return this.disconnectProvider('gemini');}
  connectClaude(value,options){return typeof value==='object'&&value!==null?this.connectProvider('claude',value.apiKey,{...options,workspaceId:value.workspaceId}):this.connectProvider('claude',value,options);}
  checkClaude(options){return this.checkProvider('claude',options);}
  disconnectClaude(){return this.disconnectProvider('claude');}
  async login(){if(this.provider!=='gpt')throw new Error('사용 설정에서 '+LABELS[this.provider]+' API 키를 연결해 주세요.');await this.codex.start();return this.codex.request('account/login/start',{type:'chatgpt'},30000);}
  async mapLogin(){if(this.provider!=='gpt')return this.ipzitalk.login();await this.codex.start();return this.codex.request('mcpServer/oauth/login',{name:'ipzitalk',timeoutSecs:180},30000);}
  async analyze(args){return this.writer.analyze(args);}
  async evidenceSession(args){return this.evidence.evidenceSession(args);}
  async evidenceTool(...args){return this.evidence.evidenceTool(...args);}
  async interrupt(){await Promise.allSettled([this.writer.interrupt(),...(this.writer!==this.evidence?[this.evidence.interrupt()]:[])]);}
  stop(){for(const source of [this.codex,this.gemini,this.claude,this.ipzitalk].filter(Boolean))source.stop();}
}
module.exports={AiBridge,provider,geminiModels,claudeModels};
