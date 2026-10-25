'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const sbiz=require('../src/sbiz-evidence.cjs'),access=require('../src/living-access.cjs'),presentation=require('../src/living-presentation.cjs'),{FIELDS}=require('../src/sbiz-data.cjs');
const center={lat:37.56,lng:126.95},asOf='2026-10-22',checkedAt='2026-10-22T01:00:00Z';
const identity={code:'apt-123',regionCode:'11410',town:'천연동',lot:'145',...center},context={center,asOf,identity};
function raw(category='entrance',offset=.002,id='MA01012022123456'){
 const r=Object.fromEntries(FIELDS.map(k=>[k,'']));
 return Object.assign(r,{'상가업소번호':id,'상호명':category==='entrance'?'검증입시학원':'검증슈퍼','상권업종소분류코드':category==='entrance'?'P10501':'G20404','상권업종소분류명':category==='entrance'?'입시·교과학원':'슈퍼마켓','표준산업분류코드':category==='entrance'?'P85501':'G47121','표준산업분류명':category==='entrance'?'일반 교과학원':'슈퍼마켓','시군구코드':'11410','법정동코드':'1141010500','지번주소':'서울특별시 서대문구 천연동 145','도로명주소':'서울특별시 서대문구 독립문로 10','경도':String(center.lng),'위도':String(center.lat+offset)});
}
function snapshot(){return {version:sbiz.VERSION,provider:sbiz.PROVIDER,asOf,checkedAt,sourceDate:'2026-06-30',downloadedAt:'2026-10-22T00:00:00Z',sourceUrl:sbiz.SOURCE,identity:{...identity},center:{...center},manifest:{sha256:'a'.repeat(64),entryHashes:Array.from({length:16},(_,i)=>({name:'지역'+i+'.csv',sha256:'b'.repeat(64),rowsRead:100})),rowsRead:1600,requiredHeaders:FIELDS,complete:true},groups:{entrance:{radiusM:1500,rows:[raw()]},mart_large:{radiusM:5000,rows:[]},supermarket:{radiusM:1500,rows:[raw('supermarket',.003,'MA01012022999999')]}}};}
function query(spec,empty=false){const labels={general:'의료,건강 > 병원 > 종합병원',pediatrics:'의료,건강 > 병원 > 소아청소년과',orthopedics:'의료,건강 > 병원 > 정형외과',dental:'의료,건강 > 병원 > 치과',entrance:'교육,학문 > 학원 > 입시학원',korean:'교육,학문 > 학원 > 국어학원',english:'교육,학문 > 학원 > 영어학원',math:'교육,학문 > 학원 > 수학학원'},p={name:'검증'+spec.key,kakao_place_id:String(100+access.SPECS.findIndex(s=>s.key===spec.key)),kakao_category_name:labels[spec.key],lat:center.lat+.004,lng:center.lng};p.distance_m=Math.round(access.distance(center,p));return {server:'ipzitalk',tool:'search_by_nearby_keyword',arguments:{query:spec.query,center_lat:center.lat,center_lng:center.lng,radius_m:spec.radiusM},result:{structuredContent:{center,radius_m:spec.radiusM,query:spec.query,results:empty?[]:[p],metadata:{collected_at:checkedAt,truncated:false}}}};}
test('official positive registrations have separate provider proof, source period and recalculated bands',()=>{
 const s=snapshot(),p=sbiz.nearest(s,'entrance',context),c=sbiz.entrance(s,context);
 assert.ok(sbiz.verified(s,context));assert.ok(sbiz.validPlace(p,context));assert.ok(sbiz.validEntranceCategory(c,context));
 assert.match(p.id,/^sbiz-MA/);assert.equal(p.sourceDate,'2026-06-30');assert.equal(p.distanceM,222);assert.equal(c.points,95);assert.equal(c.complete,false);assert.deepEqual(c.queries,[]);assert.equal(p.kakao_place_id,undefined);assert.equal(p.url,sbiz.SOURCE);
 assert.equal(sbiz.nearest(s,'mart_large',context),null);assert.equal(sbiz.nearest(s,'korean',context),null);assert.equal(sbiz.source(p).sourceDate,s.sourceDate);
});
test('dates, complete CSV proof, identity, raw classification and coordinates are required',()=>{
 const changes=[s=>s.sourceDate='2025-01-01',s=>s.sourceDate='2026-10-23',s=>s.downloadedAt='2026-10-23T00:00:00Z',s=>s.checkedAt='2026-10-21T01:00:00Z',s=>s.identity.code='other',s=>s.center.lat+=.01,s=>s.sourceUrl='https://example.com',s=>s.manifest.complete=false,s=>s.manifest.entryHashes.pop(),s=>s.manifest.rowsRead++,s=>s.manifest.requiredHeaders=[],s=>s.groups.entrance.rows[0]['상권업종소분류코드']='P10502',s=>s.groups.entrance.rows[0]['표준산업분류명']='기타',s=>s.groups.entrance.rows[0]['상호명']='동국대학교',s=>s.groups.entrance.rows[0]['위도']='',s=>s.groups.entrance.rows[0]['위도']='38',s=>s.groups.entrance.rows[0]['시군구코드']='11110',s=>s.groups.entrance.rows.push(structuredClone(s.groups.entrance.rows[0]))];
 for(const change of changes){const s=snapshot();change(s);assert.equal(sbiz.verified(s,context),false,change.toString());assert.equal(sbiz.entrance(s,context),null);}
 for(const change of [p=>p.name='변경',p=>p.distanceM=1,p=>p.sourceDate=asOf,p=>p.rawRecord['위도']='38',p=>p.rawRecord['상호명']='변조',p=>p.sbizProof.identity.code='other',p=>p.id='123']){const p=sbiz.nearest(snapshot(),'entrance',context);change(p);assert.equal(sbiz.validPlace(p,context),false,change.toString());}
 const c=sbiz.entrance(snapshot(),context);c.places[0].name='변조';assert.equal(sbiz.validEntranceCategory(c,context),false);
});
test('an empty or old quarterly file is never absence evidence and does not replace valid same-day results',()=>{
 const s=snapshot();s.groups.entrance.rows=[];assert.equal(sbiz.entrance(s,context),null);assert.equal(sbiz.mergeLiving(null,s,context),null);
 for(const empty of [false,true]){const old=access.snapshot(access.QUERIES.map(spec=>query(spec,empty)),context),before=JSON.stringify(old),merged=sbiz.mergeLiving(old,snapshot(),context);assert.deepEqual(merged,old);assert.equal(JSON.stringify(old),before);}
 const old=access.snapshot(access.QUERIES.map(spec=>query(spec)),context),stale=snapshot();stale.sourceDate='2025-01-01';assert.deepEqual(sbiz.mergeLiving(old,stale,context),old);
});
test('one public entrance category fills only its fixed 40% and keeps actual Ipji subject queries intact',()=>{
 const tools=access.QUERIES.filter(s=>s.key!=='entrance').map(spec=>query(spec)),before=JSON.stringify(tools),old=access.snapshot(tools,context),merged=sbiz.mergeLiving(old,snapshot(),context);
 assert.ok(access.validSnapshot(merged,context));assert.ok(access.current({center,identity,livingAccess:merged},{asOf}));assert.equal(JSON.stringify(tools),before);
 const categories=merged.groups.academy.categories;assert.deepEqual(categories.map(c=>c.key),['entrance','korean','english','math']);assert.equal(categories[0].queries.length,0);assert.ok(categories.slice(1).every(c=>c.nearest.id.match(/^\d+$/)&&c.queries[0].checkedAt===checkedAt));
 const freshOnly=sbiz.mergeLiving(null,snapshot(),context);assert.ok(access.validSnapshot(freshOnly,context));assert.equal(access.current({center,identity,livingAccess:freshOnly},{asOf}),false);assert.ok(freshOnly.groups.academy.categories.slice(1).every(c=>c.points===null));
 const scores=[{name:'학원 환경',score:null}],ev={center,identity,livingAccess:merged,sources:[]};access.apply(scores,ev,{input:{asOf}});assert.equal(scores[0].coverage,100);assert.equal(scores[0].score,89);assert.match(scores[0].observed,/2026-06-30 등록자료/);assert.ok(ev.sources.some(s=>s.title.startsWith('소상공인시장진흥공단')&&s.sourceDate==='2026-06-30'));assert.equal(access.compact(merged).groups.academy.categories[0].nearest.sourceDate,'2026-06-30');
 const report={input:{asset:'apartment',building:'검증단지',asOf},assessment:{evidence:ev},scores},section=presentation.sections(report,{kind:'access'}).find(s=>s.title.includes('학원 과목별'));assert.match(section.rows[0][2],/2026-06-30 등록자료/);assert.match(section.note,/소상공인시장진흥공단 2026-06-30/);
});
test('supermarket classification never infers a large mart or accepts an obviously different business',()=>{
 for(const name of ['씨유 천연점','롯데리아 길동','이마트24 천연점']){const r=raw('supermarket');r['상호명']=name;assert.equal(sbiz.classifyRaw(r),null);}
 const s=snapshot(),p=sbiz.nearest(s,'supermarket',context);assert.equal(p.category,'supermarket');assert.ok(sbiz.validPlace(p,context));assert.equal(sbiz.nearest(s,'mart_large',context),null);
});
module.exports={snapshot,raw,context};
