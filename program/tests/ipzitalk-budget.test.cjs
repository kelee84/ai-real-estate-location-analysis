'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {CodexBridge}=require('../src/codex.cjs'),{IpzitalkBudget}=require('../src/ipzitalk-budget.cjs');
function bridge(){const b=new CodexBridge({}),calls=[];b.request=async(method,args)=>{calls.push({method,args});await new Promise(r=>setTimeout(r,2));return {structuredContent:{metadata:{collected_at:new Date().toISOString()}}};};return {b,calls,session:{threadId:'e',tools:{search_by_nearby_keyword:{},get_geocode:{},get_map_embed_url:{}}}};}
test('actual bridge finishes more than nine necessary research calls and a map without an application cap',async()=>{
 const {b,calls,session}=bridge();await b.evidenceBudget.run({maxCalls:9,reserveMap:1},async()=>{
  const results=await Promise.all(Array.from({length:30},(_,i)=>b.evidenceTool(session,'search_by_nearby_keyword',{query:String(i)})));
  assert.equal(results.filter(t=>!t.networkSkipped).length,30);await b.evidenceTool(session,'get_map_embed_url',{markers:[]});await b.evidenceTool(session,'get_geocode',{address:'late'});
  assert.equal(b.evidenceBudget.snapshot().calls,32);assert.equal(b.evidenceBudget.snapshot().remaining,null);assert.equal(b.evidenceBudget.snapshot().maxCalls,null);
 });assert.equal(calls.length,32);assert.equal(b.ipzitalkUsage.snapshot().sessionCalls,32);
});
test('duplicate concurrent queries and nested phases reuse one request; a new report has its own limit',async()=>{
 const {b,calls,session}=bridge();await b.evidenceBudget.run({},async()=>{
  const result=await Promise.all(Array.from({length:20},()=>b.evidenceTool(session,'get_geocode',{address:'same'})));
  assert.equal(result.filter(t=>t.reused).length,19);await b.evidenceBudget.run({},()=>b.evidenceTool(session,'get_geocode',{address:'same'}));assert.equal(b.evidenceBudget.snapshot().calls,1);
 });assert.equal(calls.length,1);await b.evidenceBudget.run({},()=>b.evidenceTool(session,'get_geocode',{address:'same'}));assert.equal(calls.length,2);
});
test('timeout and in-flight abort remain counted together with prior property search costs',async()=>{
 const {b,session}=bridge();let sent=0;b.request=async()=>{sent++;throw Error('timeout');};
 await b.evidenceBudget.run({initialCalls:2},async()=>{for(let i=0;i<12;i++)await b.evidenceTool(session,'get_geocode',{address:String(i)}).catch(()=>{});assert.equal(sent,12);assert.equal(b.evidenceBudget.snapshot().calls,14);});
 assert.equal(b.ipzitalkUsage.snapshot().sessionCalls,12);
});
test('writing threads disable IpziTalk even for legal requests and cannot resume an old unrestricted thread',async()=>{
 const b=new CodexBridge({}),calls=[];b.start=async()=>{};b.request=async(method,args)=>{calls.push({method,args});if(method==='thread/start')return {thread:{id:'safe'}};if(method==='turn/start'){queueMicrotask(()=>b.receive({method:'turn/completed',params:{threadId:'safe',turn:{status:'completed'}}}));return {turn:{id:'t'}};}throw Error(method);};
 await b.analyze({prompt:'법률',instructions:'',externalTools:true,threadId:'old'});
 assert.ok(!calls.some(c=>c.method==='thread/resume'));assert.equal(calls[0].args.config['mcp_servers.ipzitalk.enabled'],false);assert.equal(calls[0].args.config.web_search,'live');
});
test('confirmed daily service limit stays latched after a late successful concurrent response',()=>{
 const usage=new (require('../src/ipzitalk-usage.cjs').IpzitalkUsage)();usage.observe({server:'ipzitalk',result:{isError:true,structuredContent:{error:'DAILY_TOOL_LIMIT_EXCEEDED'}}});usage.observe({server:'ipzitalk',result:{structuredContent:{metadata:{}}}});assert.equal(usage.snapshot().limited,true);assert.equal(usage.snapshot().remaining,0);usage.reset();assert.equal(usage.snapshot().limited,false);
});
test('old numeric limit options cannot reintroduce the removed application cap and prior costs are not clamped',async()=>{
 for(const maxCalls of [9,NaN,Infinity,'invalid',99,8.5]){const b=new IpzitalkBudget();await b.run({maxCalls,initialCalls:17},async()=>{let sent=0;for(let i=0;i<30;i++)if(b.take('get_geocode'))sent++;assert.equal(sent,30);assert.equal(b.snapshot().calls,47);assert.equal(b.snapshot().maxCalls,null);});}
});
test('academy keyword requests reach IpziTalk while unsupported category aliases are omitted',async()=>{
 const {b,session}=bridge();session.tools.search_by_nearby_keyword={};session.tools.search_by_nearby_category={};let sent=0;b.request=async()=>{sent++;return {structuredContent:{}};};
 await b.evidenceBudget.run({},async()=>{for(const query of ['입시학원','국어학원','영어학원','수학학원','미술학원','음악학원','태권도장'])await b.evidenceTool(session,'search_by_nearby_keyword',{query});assert.equal(sent,7);const unsupported=await b.evidenceTool(session,'search_by_nearby_category',{categories:['academy']});assert.equal(unsupported.networkSkipped,true);assert.equal(sent,7);assert.equal(b.evidenceBudget.snapshot().calls,7);});
});
