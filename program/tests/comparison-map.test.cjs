'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const map=require('../src/comparison-map.cjs'),capture=require('../src/map-capture.cjs'),proof=require('./fixtures/map-proof.cjs'),{todayKst}=require('../src/core.cjs');
function fixture(){
 const members=['A','B','C'].map((key,i)=>({key,input:{asset:'apartment',building:'검증단지'+key,asOf:todayKst()},scoreEvidence:{center:{lat:37.5+i*.01,lng:127},places:[{id:'shop'+i,lat:37.51+i*.01,lng:127,name:'쇼핑시설'+key,category:'shopping_large'}]},researchData:{}})),p=map.plan(members),saved={...proof.savedMap(p.targets[0]),version:capture.VERSION,markers:p.args.markers.map(({lat,lng,name})=>({lat,lng,name})),markerDetails:p.args.markers.map(({lat,lng,name,color,info})=>({lat,lng,name,color,info})),validation:{...proof.validation(p.args.markers.length),targetCount:3},capturedAtTime:new Date(Date.now()-1000).toISOString(),providedAt:new Date(Date.now()-2000).toISOString()};
 const calls=[],captures=[];let sessions=0;const service={bridge:{evidenceSession:async()=>{sessions++;return {};},evidenceTool:async(session,tool,args)=>{calls.push({tool,args});return {tool,arguments:args};}},captureMap:async(tools,dir,options)=>{captures.push({tools,options});return {...saved,capturedAtTime:new Date().toISOString()};}};
 return {members,p,saved,service,calls,captures,sessions:()=>sessions};
}
test('new comparison recaptures complete same-day map without MCP or an evidence session',async()=>{const f=fixture(),r=await map.request(f.service,f.members,{map:f.saved},'.');assert.ok(map.matches(r.map,f.p));assert.equal(f.sessions(),0);assert.equal(f.calls.length,0);assert.equal(f.captures.length,1);assert.deepEqual(f.captures[0].options.savedMap,f.saved);assert.deepEqual(r.map.markerDetails,f.saved.markerDetails);});
test('expiry, previous day, explicit refresh, missing facilities and changed colors/coordinates/info create a new map',async()=>{
 for(const change of [f=>f.saved.expiresAt=new Date(Date.now()-1).toISOString(),f=>f.saved.capturedAtTime='2020-01-01T00:00:00Z',f=>f.force=true,f=>f.saved.markerDetails.pop(),f=>f.saved.markerDetails[3].color='Red',f=>f.saved.markerDetails[3].lat+=.001,f=>f.saved.markerDetails[3].info='stale',f=>f.saved.validation.targetCount=2]){
  const f=fixture();change(f);const r=await map.request(f.service,f.members,{map:f.saved},'.',{forceRefresh:f.force});assert.equal(r.map,null);assert.equal(f.calls.length,1);assert.equal(f.captures.length,0);assert.equal(f.calls[0].tool,'get_map_embed_url');assert.equal(f.calls[0].args.markers.length,6);
 }
});
test('unavailable saved URL and invalid recapture fall back once; cancellation never makes a new request',async()=>{
 for(const result of ['throw','unavailable','missing-marker']){const f=fixture();f.service.captureMap=async()=>{if(result==='throw')throw Error('expired provider page');return result==='unavailable'?{status:'unavailable'}:{...f.saved,markerDetails:[]};};const r=await map.request(f.service,f.members,{map:f.saved},'.');assert.equal(f.calls.length,1);assert.equal(r.tools.length,1);}
 const f=fixture(),controller=new AbortController();f.service.captureMap=async()=>{controller.abort();throw Error('cancel');};await assert.rejects(map.request(f.service,f.members,{map:f.saved},'.',{signal:controller.signal}),/중지/);assert.equal(f.calls.length,0);
});

test('cancellation during provider request is observed even if the tool returns a result',async()=>{const f=fixture(),controller=new AbortController();f.service.bridge.evidenceTool=async()=>{controller.abort();return {tool:'get_map_embed_url'};};await assert.rejects(map.request(f.service,f.members,null,'.',{signal:controller.signal}),/중지/);});
