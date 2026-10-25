'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {CodexBridge}=require('../src/codex.cjs'),{AnalysisService}=require('../src/service.cjs'),{normalizeInput}=require('../src/core.cjs');
test('official confirmation preserves prior search costs without blocking the remaining necessary report lookups',async t=>{
 const region={code:'28185',name:'연수구',province:{code:'2800000000',name:'인천광역시'}},point={lat:37.4,lng:126.64};
 for(const previousCalls of [1,7,8]){
  const bridge=new CodexBridge({}),session={threadId:'fixture',tools:{get_region_code:{},search_by_nearby_keyword:{},get_map_embed_url:{}}};let actual=0;
  bridge.evidenceSession=async()=>session;bridge.request=async(method,args)=>{assert.equal(method,'mcpServer/tool/call');actual++;return {structuredContent:args.tool==='get_region_code'?{sigungu_code:region.code,full_code:'2818510600',...point}:{metadata:{collected_at:new Date().toISOString()},results:[]}};};
  for(let i=0;i<previousCalls;i++)await bridge.evidenceTool(session,'get_region_code',{query:'previous-'+i});
  const data={listProvinces:async()=>[region.province],listRegions:async()=>[{code:region.code,name:region.name}],request:async()=>Buffer.from(JSON.stringify({emdList:[{code:'2818510600',codeNm:'송도동'}]}))},service=new AnalysisService({bridge,data,onEvent:()=>{}}),input=normalizeInput({target:'테스트아파트'}),found=service.rememberPropertySearch({input,ipzitalkPreflightCalls:previousCalls,candidates:[{id:'A10000001',name:'테스트아파트',address:'인천광역시 연수구 송도동 1',...point}]});
  const catalog=require('../src/type-catalog.cjs');let discoveryCalls=0;const mock=t.mock.method(catalog,'discoverTypes',async(_client,raw)=>{if(!discoveryCalls++){const error=new Error('공식 주소 재확인');error.code='PROPERTY_AMBIGUOUS';error.region=region;error.properties=[{aprpnHsmpCode:'20200001',aprpnHsmpNm:'테스트아파트',townName:'송도동',mnnm:'2'}];throw error;}return {target:raw.target,asset:'apartment',requestedBuilding:raw.building,identity:{code:'20200001'},areas:[84]};});
  try{
   const confirm=await service.selectProperty({searchToken:found.searchToken,candidateId:found.candidates[0].id}),preflight=previousCalls+1;assert.equal(service.propertySearches.get(confirm.searchToken).ipzitalkPreflightCalls,preflight);
   const selected=await service.selectProperty({searchToken:confirm.searchToken,candidateId:confirm.candidates[0].id});assert.equal(service.typeCatalogs.get(selected.token).ipzitalkPreflightCalls,preflight);assert.equal(actual,preflight);
   service.runWithBudget=async()=>{const initial=bridge.evidenceBudget.snapshot();const facilities=await Promise.all(Array.from({length:20},(_,i)=>bridge.evidenceTool(session,'search_by_nearby_keyword',{query:'facility-'+i}))),map=await bridge.evidenceTool(session,'get_map_embed_url',{markers:[]});return {initial,facilitiesSent:facilities.filter(tool=>!tool.networkSkipped).length,mapSent:!map.networkSkipped,final:bridge.evidenceBudget.snapshot()};};
   const result=await service.run({target:selected.target,catalogToken:selected.token});assert.equal(result.initial.calls,preflight);assert.equal(result.facilitiesSent,20);assert.equal(result.mapSent,true);assert.equal(result.final.calls,preflight+21);assert.equal(actual,preflight+21);assert.equal(bridge.ipzitalkUsage.snapshot().sessionCalls,preflight+21);
  }finally{mock.mock.restore();}
 }
});
