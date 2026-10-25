'use strict';
const {scope,data,toolError,covers,categoryRequestCovers}=require('./research-cache.cjs');
const TERMINAL=/^(?:DAILY_TOOL_LIMIT_EXCEEDED|RATE_LIMIT_EXCEEDED|UNAUTHORIZED|AUTH_REQUIRED|TOKEN_EXPIRED)$/;
function createQuery(bridge,input,prices,{cache,forceRefresh=false,signal,out,initialTools=[],maxCalls=null,reserveMap=0}){
 const limit=typeof maxCalls==='number'&&Number.isFinite(maxCalls)?Math.max(0,Math.floor(maxCalls)):Infinity,reserved=Number.isFinite(limit)&&Number.isFinite(reserveMap)?Math.max(0,Math.floor(reserveMap)):0;
 const cacheScope=scope(input,prices),metrics={version:'2026-10-20-wide-category-reuse-v4',networkCalls:0,cacheHits:0,blockedCalls:0,batchCalls:0,keywordCalls:0,sharedHits:0,derivedRecords:0,terminalError:null,maxCalls:Number.isFinite(limit)?limit:null,reserveMap:reserved},pending=new Map();
 out.tools||=[];out.checks||=[];out.issues||=[];
 if(!forceRefresh)for(const t of initialTools)if(!out.tools.some(p=>p.tool===t.tool&&JSON.stringify(p.arguments)===JSON.stringify(t.arguments)))out.tools.push(t);
 const addProjections=t=>{for(const p of require('./research-projection.cjs').projections(t,input.asOf))if(!out.tools.some(existing=>existing.tool===p.tool&&JSON.stringify(existing.arguments)===JSON.stringify(p.arguments))){out.tools.push(p);metrics.derivedRecords++;}};
 for(const t of [...out.tools])addProjections(t);
 const initialSpent=out.tools.filter(t=>t.researchNetworkAttempt&&!t.networkSkipped&&!t.reused).length;
 out.metrics=metrics;metrics.terminalError=initialTools.map(toolError).find(code=>TERMINAL.test(String(code)))||null;let sessionPromise;
 const defer=()=>{metrics.blockedCalls++;metrics.budgetLimited=true;const note='명시된 조회 예산에 따라 추가 시설 검색을 보류했습니다.'+(reserved?' 지도 조회 '+reserved+'회는 별도로 확보했습니다.':'');if(!out.issues.includes(note))out.issues.push(note);};
 const remaining=(tool='')=>{let shared;try{shared=bridge.evidenceBudget?.snapshot();}catch{}const available=tool==='get_map_embed_url'?shared?.remaining:shared?.remainingResearch;return Math.max(0,Math.min(limit-initialSpent-metrics.networkCalls-(tool==='get_map_embed_url'?0:reserved),Number.isFinite(available)?available:Infinity));};
 const execute=async(tool,args,{cachedOnly=false}={})=>{
  if(signal?.aborted)throw new Error('분석을 중지했습니다.');
  const prior=out.tools.find(t=>covers(t,tool,args,input.asOf));if(prior)return prior;
  const cached=!forceRefresh&&await cache?.get(cacheScope,tool,args);
  if(cachedOnly&&!cached)return null;
  let t;
  if(cached){t={...structuredClone(cached),networkSkipped:true,reused:true};metrics.cacheHits++;}
  else if(metrics.terminalError){metrics.blockedCalls++;return null;}
  else {
   const load=async()=>{try{
   sessionPromise||=bridge.evidenceSession({signal});const session=await sessionPromise;out.session=session;
   if(metrics.terminalError){metrics.blockedCalls++;return null;}
   if(remaining(tool)<=0){defer();return null;}
   metrics.networkCalls++;if(tool==='search_by_nearby_category')metrics.batchCalls++;if(tool==='search_by_nearby_keyword')metrics.keywordCalls++;
   let t=await bridge.evidenceTool(session,tool,args,{signal});
   if(t?.server!=='ipzitalk'||t.tool!==tool)throw new Error('입지톡에서 반환한 조회 출처·도구명을 확인하지 못했습니다.');
   if(t.networkSkipped){metrics.networkCalls--;if(t.reused)metrics.cacheHits++;else metrics.blockedCalls++;if(tool==='search_by_nearby_category')metrics.batchCalls--;if(tool==='search_by_nearby_keyword')metrics.keywordCalls--;}
   const code=toolError(t);if(code&&TERMINAL.test(String(code)))metrics.terminalError=String(code);
   if(!code)await cache?.put(cacheScope,tool,args,t);
   return {...t,researchNetworkAttempt:!t.networkSkipped};
  }catch(e){if(signal?.aborted)throw e;const t={server:'ipzitalk',tool,arguments:args,error:e.message,result:{isError:true,content:[]},researchNetworkAttempt:metrics.networkCalls>0};if(TERMINAL.test(e.code||''))metrics.terminalError=e.code;else if(!metrics.networkCalls)metrics.terminalError='CONNECTION_UNAVAILABLE';return t;}};
   const shared=cache?.coalesce?await cache.coalesce(cacheScope,tool,args,load):{value:await load(),reused:false};t=shared.value;if(shared.reused&&t){metrics.sharedHits++;metrics.cacheHits++;t={...structuredClone(t),networkSkipped:true,reused:true};}if(!t)return null;
  }
  out.tools.push(t);addProjections(t);const error=toolError(t),d=error?null:data(t);
  out.checks.push({tool,...(args.query?{query:args.query}:{}),status:d?'received':t.error?'error':'unavailable',reused:!!cached||!!t.reused,...(error?{error:String(error)}:{})});
  if(!d)out.issues.push('입지톡 '+(metrics.terminalError?'조회 중단: '+metrics.terminalError+' · ':'조회 실패: ')+(error||tool));
  return t;
 };
 const call=async(tool,args,returnTool=false,options={})=>{const key=JSON.stringify([tool,args,!!options.cachedOnly]);for(const entry of pending.values())if(tool==='search_by_nearby_category'&&entry.tool===tool&&entry.cachedOnly===!!options.cachedOnly&&categoryRequestCovers(entry.args,args)){const value=await entry.job;if(covers(value,tool,args,input.asOf))return returnTool?value:toolError(value)?null:data(value);}let entry=pending.get(key);if(!entry){entry={tool,args,cachedOnly:!!options.cachedOnly,job:execute(tool,args,options)};pending.set(key,entry);}let t;try{t=await entry.job;}finally{if(pending.get(key)===entry)pending.delete(key);}return returnTool?t:toolError(t)?null:data(t);};
 call.remaining=remaining;call.defer=defer;return {call,metrics,cacheScope};
}
async function supplementShopping(call,tools,{center,asOf,maxQueries=Infinity}){
 const shopping=require('./shopping.cjs'),access=require('./living-access.cjs');
 // Generic mall keyword responses do not carry the official whole-venue proof
 // required by the report. Repeating four such requests cannot establish scale.
 // Preserve existing proven venues; leave the unproved subindicator withheld.
 let sent=0;for(const query of shopping.MART_QUERIES){const found=shopping.snapshot(tools,{center,asOf});if(access.usableRecord(found?.batch)||found?.queries.some(q=>q.query===query&&q.checkedAt))continue;if(sent>=maxQueries||call.remaining?.()<=0){call.defer?.();break;}const t=await call('search_by_nearby_keyword',{center_lat:center.lat,center_lng:center.lng,query,radius_m:shopping.RADIUS},true);if(t&&!tools.includes(t))tools.push(t);sent++;}
}
async function runQueries(jobs){let index=0,failed;const results=await Promise.allSettled(Array.from({length:Math.min(3,jobs.length)},async()=>{while(!failed&&index<jobs.length){try{await jobs[index++]();}catch(error){failed=error;throw error;}}}));const rejected=results.find(r=>r.status==='rejected');if(rejected)throw rejected.reason;}
module.exports={createQuery,TERMINAL,supplementShopping,runQueries};
