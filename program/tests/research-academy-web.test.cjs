'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const research=require('../src/research.cjs'),living=require('../src/living-access.cjs'),scoring=require('../src/scoring.cjs');
const {ResearchCache}=require('../src/research-cache.cjs'),{todayKst}=require('../src/core.cjs');
const center={lat:37.56,lng:126.95},input={asset:'apartment',target:'서울특별시 서대문구 천연동 검증단지',building:'검증단지',asOf:todayKst(),area:59,types:['trade']};
const identity={code:'20000001',building:input.building,province:'서울특별시',region:'서대문구',regionCode:'11410',town:'천연동',lot:'1',...center};
const prices={buildingResolution:identity,rows:[],summaries:[],coverage:[]};
const academicCalls=b=>b.calls.filter(c=>living.QUERIES.some(s=>s.group==='academy'&&s.query===c.args.query));
function bridge(){return {calls:[],async evidenceSession(){return {};},async evidenceTool(_session,name,args){this.calls.push({name,args});return {server:'ipzitalk',tool:name,arguments:args,result:{structuredContent:{center,radius_m:args.radius_m,results:args.categories?Object.fromEntries(args.categories.map(c=>[c,[]])):[],metadata:{collected_at:new Date().toISOString(),truncated:false},...(args.categories?{pagination_by_category:Object.fromEntries(args.categories.map(c=>[c,{collected_count:0,returned_count:0,source_cap_reached:false}]))}:{query:args.query})}}};}};}
test('academy collector requests only entrance Korean English Math keywords without unsupported academy category',async()=>{
 for(const forceRefresh of [false,true]){const b=bridge(),r=await research.collectResearch(b,input,structuredClone(prices),{onlyScores:true,forceRefresh});assert.deepEqual(academicCalls(b).map(c=>c.args.query).sort(),['입시학원','보습학원','국어학원','영어학원','수학학원'].sort());assert.ok(!b.calls.some(c=>c.args.categories?.includes('academy')));assert.ok(r.livingAccess.groups.academy.complete);assert.ok(r.livingAccess.groups.academy.categories.every(c=>c.status==='empty'&&c.points===20));}
});
test('academy proofs survive restart without new requests and explicit refresh queries again',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'academy-restored-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const first=bridge();await research.collectResearch(first,input,structuredClone(prices),{onlyScores:true,cache:new ResearchCache(root)});assert.equal(academicCalls(first).length,5);
 const second=bridge();await research.collectResearch(second,input,structuredClone(prices),{onlyScores:true,cache:new ResearchCache(root)});assert.equal(second.calls.length,0);
 const fresh=bridge();await research.collectResearch(fresh,input,structuredClone(prices),{onlyScores:true,cache:new ResearchCache(root),forceRefresh:true});assert.equal(academicCalls(fresh).length,5);
});
test('old web lists cannot complete IpziTalk academy proofs or create a distance score',()=>{
 const tools=living.QUERIES.filter(s=>s.group==='hospital').map(s=>({server:'ipzitalk',tool:'search_by_nearby_keyword',arguments:{query:s.query,center_lat:center.lat,center_lng:center.lng,radius_m:s.radiusM},result:{structuredContent:{center,radius_m:s.radiusM,query:s.query,results:[],metadata:{collected_at:new Date().toISOString(),truncated:false}}}}));
 const e=scoring.collectEvidence({input,prices,tools});e.academyWeb={status:'received',places:[{name:'불필요 웹 목록'}]};assert.equal(living.current(e,input),false);const assessed=scoring.assessScores({scores:[]},{input,prices:{...prices,academyWeb:e.academyWeb},previousEvidence:e});assert.equal(assessed.scores.find(s=>s.name==='학원 환경').score,null);assert.ok(!assessed.assessment.evidence.academyWeb);assert.ok(!research.compactResearch(e).academyWeb);
});
