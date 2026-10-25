'use strict';

// Quarterly official registrations are positive facility evidence, never evidence
// that a facility is absent or that a listed business is still operating today.
const {createHash}=require('node:crypto');
const {todayKst}=require('./core.cjs');
const VERSION='sbiz-nearby-v1',PROVIDER='sbiz-csv';
const SOURCE='https://www.data.go.kr/data/15083033/fileData.do';
const RADII={entrance:1500,mart_large:5000,supermarket:1500};
const HEADERS=['상가업소번호','상호명','지점명','상권업종소분류코드','상권업종소분류명','표준산업분류코드','표준산업분류명','시군구코드','법정동코드','지번주소','도로명주소','경도','위도'];
const access=()=>require('./living-access.cjs');
const clean=v=>String(v??'').trim();
const hash=v=>createHash('sha256').update(typeof v==='string'?v:JSON.stringify(v)).digest('hex');
const validHash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/i.test(v);
function classifyRaw(row){return require('./sbiz-data.cjs').classifyRaw(row);}
function date(value){return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;}
function identityEqual(a,b){return !!a&&!!b&&['code','regionCode','town','lot'].every(k=>clean(a[k])===clean(b[k]))&&!!clean(a.code)&&!!clean(a.town)&&!!clean(a.lot);}
function validManifest(m){
 return !!m&&m.complete===true&&validHash(m.sha256)&&Number.isInteger(m.rowsRead)&&m.rowsRead>0&&Array.isArray(m.entryHashes)&&m.entryHashes.length===16&&new Set(m.entryHashes.map(e=>e?.name)).size===16&&m.entryHashes.every(e=>typeof e.name==='string'&&/\.csv$/i.test(e.name)&&validHash(e.sha256)&&Number.isInteger(e.rowsRead)&&e.rowsRead>0)&&m.entryHashes.reduce((n,e)=>n+e.rowsRead,0)===m.rowsRead&&Array.isArray(m.requiredHeaders)&&HEADERS.every(h=>m.requiredHeaders.includes(h));
}
function validOrigin(proof,{center,asOf,identity}={}){
 if(proof?.version!==VERSION||proof.provider!==PROVIDER||proof.sourceUrl!==SOURCE||!date(asOf)||proof.asOf!==asOf||!date(proof.sourceDate)||proof.sourceDate>asOf||asOf>todayKst())return false;
 const age=(Date.parse(asOf)-Date.parse(proof.sourceDate))/86400000,download=Date.parse(proof.downloadedAt),checked=Date.parse(proof.checkedAt);
 if(age>180||!Number.isFinite(download)||!Number.isFinite(checked)||download>checked||download<Date.parse(proof.sourceDate+'T00:00:00+09:00')||checked>Date.now()+300000||todayKst(new Date(checked))!==asOf)return false;
 const p=access().point(center),origin=access().point(proof.center),idPoint=access().point(proof.identity);
 if(!p||!origin||!idPoint||access().distance(p,origin)>2||access().distance(origin,idPoint)>2||!identityEqual(proof.identity,identity||proof.identity))return false;
 return validManifest(proof.manifest);
}
function validRow(raw,key,center){
 if(!require('./sbiz-data.cjs').validRaw(raw)||classifyRaw(raw)!==key)return false;
 const p=access().point({lat:raw['위도'],lng:raw['경도']});
 return !!p&&clean(raw['위도'])!==''&&clean(raw['경도'])!==''&&access().distance(center,p)<=RADII[key];
}
function verified(snapshot,context={}){
 if(!validOrigin(snapshot,context))return false;
 for(const [key,radiusM] of Object.entries(RADII)){
  const g=snapshot.groups?.[key];
  if(!g||g.radiusM!==radiusM||!Array.isArray(g.rows)||g.rows.some(r=>!validRow(r,key,context.center))||new Set(g.rows.map(r=>clean(r['상가업소번호']))).size!==g.rows.length)return false;
 }
 return true;
}
function proofOf(snapshot){return structuredClone(Object.fromEntries(['version','provider','asOf','checkedAt','sourceDate','downloadedAt','sourceUrl','identity','center','manifest'].map(k=>[k,snapshot[k]])));}
function normalize(raw,key,proof){
 const lat=Number(raw['위도']),lng=Number(raw['경도']),id='sbiz-'+clean(raw['상가업소번호']),branch=clean(raw['지점명']),name=clean(raw['상호명'])+(branch?' '+branch:'');
 return {id,provider:PROVIDER,category:key,name,lat,lng,address:clean(raw['도로명주소'])||clean(raw['지번주소']),distanceM:Math.round(access().distance(proof.center,{lat,lng})),distanceBasis:'단지 기준점과 공식 등록 시설 좌표 사이의 직선거리',sourceId:'ev-sbiz-'+hash(proof.sourceDate+':'+proof.manifest.sha256+':'+id).slice(0,16),url:SOURCE,sourceDate:proof.sourceDate,checkedAt:proof.checkedAt,downloadedAt:proof.downloadedAt,rawRecord:structuredClone(raw),rawHash:hash(raw),sbizProof:proof};
}
function nearest(snapshot,key,context={}){
 if(!Object.hasOwn(RADII,key)||!verified(snapshot,context))return null;
 const proof=proofOf(snapshot),places=snapshot.groups[key].rows.map(r=>normalize(r,key,proof));
 return places.sort((a,b)=>a.distanceM-b.distanceM||a.id.localeCompare(b.id))[0]||null;
}
function validPlace(p,context={}){
 if(p?.provider!==PROVIDER||!Object.hasOwn(RADII,p.category)||!validOrigin(p.sbizProof,context)||!validRow(p.rawRecord,p.category,context.center)||p.rawHash!==hash(p.rawRecord))return false;
 const expected=normalize(p.rawRecord,p.category,p.sbizProof);
 return ['id','provider','category','name','lat','lng','address','distanceM','distanceBasis','sourceId','url','sourceDate','checkedAt','downloadedAt'].every(k=>p[k]===expected[k]);
}
function source(p){return {id:p.sourceId,title:'소상공인시장진흥공단 상가정보 · '+p.name+' ('+p.sourceDate+' 기준)',url:SOURCE,checkedAt:p.checkedAt,sourceDate:p.sourceDate,downloadedAt:p.downloadedAt};}
function entrance(snapshot,context={}){
 const p=nearest(snapshot,'entrance',context);if(!p)return null;
 const spec=access().SPECS.find(s=>s.key==='entrance');
 return {key:spec.key,label:spec.label,weight:spec.weight,radiusM:spec.radiusM,status:'observed',complete:false,limited:false,nearest:p,points:access().points(spec.key,p.distanceM),queries:[],places:[p],publicEvidence:structuredClone(snapshot),sourceDate:p.sourceDate};
}
function validEntranceCategory(c,context={}){
 if(c?.key!=='entrance'||!c.publicEvidence)return false;
 const expected=entrance(c.publicEvidence,context);
 return !!expected&&['key','label','weight','radiusM','status','complete','limited','points','sourceDate'].every(k=>c[k]===expected[k])&&Array.isArray(c.queries)&&c.queries.length===0&&!c.batch&&validPlace(c.nearest,context)&&c.nearest.id===expected.nearest.id&&c.nearest.distanceM===expected.nearest.distanceM&&c.nearest.rawHash===expected.nearest.rawHash&&hash(c.nearest.sbizProof)===hash(expected.nearest.sbizProof)&&Array.isArray(c.places)&&c.places.length===1&&hash(c.places[0])===hash(c.nearest);
}
function mergeLiving(existing,snapshot,context={}){
 const a=access(),saved=a.upgradeSnapshot(existing,context),publicCategory=entrance(snapshot,context);
 if(!publicCategory)return saved;
 const old=saved?.groups?.academy?.categories.find(c=>c.key==='entrance');
 // Valid same-day existing observations (including complete empty Ipji results)
 // are more current than a quarterly registry and must win over it.
 if(old&&old.status!=='unavailable'&&old.nearest?.provider!==PROVIDER)return saved;
 const out=saved||{version:a.VERSION,asOf:context.asOf,center:{...context.center},checkedAt:snapshot.checkedAt,groups:{},scope:'등록 시설 좌표의 직선 접근성 평가. 분기 상가정보는 자료 기준일의 등록 시설이며 현재 운영·보행 동선·수업의 질은 별도 확인합니다.'};
 for(const group of ['hospital','academy']){
  const categories=(out.groups[group]?.categories||a.SPECS.filter(s=>s.group===group).map(a.unavailableCategory)).map(c=>c.key==='entrance'?publicCategory:c);
  out.groups[group]={categories,complete:categories.every(c=>c.complete),queries:categories.flatMap(c=>[...c.queries,...(c.batch?[c.batch]:[])])};
 }
 out.checkedAt=[out.checkedAt,snapshot.checkedAt].filter(Boolean).sort().at(-1);
 return a.validSnapshot(out,context)?out:saved;
}
module.exports={VERSION,PROVIDER,SOURCE,HEADERS,RADII,classifyRaw,verified,nearest,validPlace,entrance,validEntranceCategory,mergeLiving,source};
