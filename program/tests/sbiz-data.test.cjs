'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),{createHash}=require('node:crypto'),JSZip=require('jszip');
const data=require('../src/sbiz-data.cjs'),{todayKst}=require('../src/core.cjs');
const day=todayKst(),date=day.replaceAll('-',''),detail='uddi:test-123',center={lat:37.56,lng:126.95};
const html='<title>소상공인시장진흥공단_상가(상권)정보_'+date+' | 공공데이터포털</title><input id="publicDataDetailPk" value="'+detail+'">';
const metadata={status:true,atchFileId:'FILE_1234567',fileDetailSn:'1',dataSetFileDetailInfo:{publicDataPk:'15083033',publicDataDetailPk:detail,dataNm:'소상공인시장진흥공단_상가(상권)정보_'+date}};
function raw(id,category='entrance',lat=center.lat){const r=Object.fromEntries(data.FIELDS.map(k=>[k,'']));return Object.assign(r,{'상가업소번호':id,'상호명':category==='entrance'?'검증입시학원':'검증슈퍼','상권업종대분류코드':category==='entrance'?'P':'G','상권업종대분류명':'검증','상권업종중분류코드':'검증','상권업종중분류명':'검증','상권업종소분류코드':category==='entrance'?'P10501':'G20404','상권업종소분류명':category==='entrance'?'입시·교과학원':'슈퍼마켓','표준산업분류코드':category==='entrance'?'P85501':'G47121','표준산업분류명':category==='entrance'?'일반 교과학원':'슈퍼마켓','시도코드':'11','시도명':'서울특별시','시군구코드':'11410','시군구명':'서대문구','법정동코드':'1141010500','법정동명':'천연동','지번주소':'서울특별시 서대문구 천연동 145','도로명주소':'서울특별시 서대문구 독립문로 10','경도':String(center.lng),'위도':String(lat)});}
function csv(rows,headers=data.FIELDS){const quoted=x=>'"'+String(x??'').replaceAll('"','""')+'"';return '\uFEFF'+[headers,...rows.map(r=>headers.map(k=>r[k]))].map(r=>r.map(quoted).join(',')).join('\r\n')+'\r\n';}
async function fixture(t,mutate=()=>{}){const root=await fs.mkdtemp(path.join(os.tmpdir(),'sbiz-test-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const zip=new JSZip();data.PROVINCES.forEach((p,i)=>{const rows=[raw('A'+i),raw('S'+i,'supermarket'),raw('D'+i,'entrance',39)];const f={name:'소상공인시장진흥공단_상가(상권)정보_'+p+'_'+date.slice(0,6)+'.csv',rows,headers:data.FIELDS};mutate(f,i);if(f.name)zip.file(f.name,csv(f.rows,f.headers));});const bytes=await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'}),file=path.join(root,'source.zip');await fs.writeFile(file,bytes);const proof={bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),downloadedAt:new Date().toISOString()},meta=data.parseMetadata(html,metadata);return {root,file,bytes,proof,meta,index:()=>data.buildIndex(file,meta,proof)};}
test('official classification does not infer subjects or a large mart from names',()=>{
 assert.equal(data.classifyRaw(raw('A')),'entrance');assert.equal(data.classifyRaw(raw('B','supermarket')),'supermarket');
 for(const name of ['동국대학교','아이학습지','방문교육','폐원예정학원']){const r=raw('A');r['상호명']=name;assert.equal(data.classifyRaw(r),null);}
 for(const name of ['씨유천연점','GS25 천연점','롯데리아길동','이마트24 천연점']){const r=raw('A','supermarket');r['상호명']=name;assert.equal(data.classifyRaw(r),null);}
 const english=raw('A');english['상권업종소분류코드']='P10615';english['상권업종소분류명']='외국어학원';english['상호명']='영어학원';assert.equal(data.classifyRaw(english),null);
 const mismatch=raw('A');mismatch['표준산업분류명']='기타 교육';assert.equal(data.classifyRaw(mismatch),null);mismatch['법정동코드']='1111010500';assert.equal(!!data.validRaw(mismatch),false);
});
test('metadata binds official dataset ID, exact date and current file identity',()=>{
 const meta=data.parseMetadata(html,metadata);assert.equal(meta.sourceUrl,data.SOURCE);assert.equal(meta.sourceDate,day);assert.match(meta.downloadUrl,/atchFileId=FILE_1234567/);
 for(const edit of [v=>v.status=false,v=>v.atchFileId='https://foreign',v=>v.dataSetFileDetailInfo.publicDataPk='1',v=>v.dataSetFileDetailInfo.publicDataDetailPk='wrong',v=>v.dataSetFileDetailInfo.dataNm='wrong']){const m=structuredClone(metadata);edit(m);assert.throws(()=>data.parseMetadata(html,m));}
 assert.equal(data.currentDate('2026-02-30',day),false);assert.equal(data.currentDate('2099-01-01',day),false);assert.equal(data.currentDate('2020-01-01',day),false);
});
test('full national stream index keeps raw records and verifies both ZIP and CSV hashes',async t=>{
 const f=await fixture(t),index=await f.index();assert.equal(index.manifest.rowsRead,48);assert.equal(index.rows.length,48);assert.equal(index.manifest.entryHashes.length,16);assert.ok(data.validIndex(index));assert.equal(index.manifest.sha256,f.proof.sha256);assert.equal(index.rows[0]['상가업소번호'],'A0');assert.deepEqual(index.manifest.requiredHeaders,data.FIELDS);
 await assert.rejects(data.buildIndex(f.file,f.meta,{...f.proof,sha256:'a'.repeat(64)}),/해시/);for(const edit of [v=>v.manifest.requiredHeaders=[],v=>v.manifest.entryHashes.pop(),v=>v.rows[0]['위도']='',v=>v.rows[0]['상가업소번호']=v.rows[1]['상가업소번호'],v=>v.sourceDate='2020-01-01',v=>v.downloadUrl='https://example.com']){const v=structuredClone(index);edit(v);assert.equal(!!data.validIndex(v),false);}
});
test('partial, malformed and duplicate-source CSV sets cannot establish a complete index',async t=>{
 const absent=await fixture(t,(f,i)=>{if(i===15)f.name=null;});await assert.rejects(absent.index(),/불완전/);
 const headers=await fixture(t,(f,i)=>{if(i===0)f.headers=data.FIELDS.filter(k=>k!=='경도');});await assert.rejects(headers.index(),/열이 불완전/);
 const duplicate=await fixture(t,(f,i)=>{if(i===1)f.rows[0]['상가업소번호']='A0';});await assert.rejects(duplicate.index(),/중복/);
});
test('saved same-day index is reused without network and snapshots are identity-bound',async t=>{
 const f=await fixture(t),index=await f.index(),store=new data.SbizStore(f.root,{fetcher:()=>{throw Error('unexpected network');}});await store.save(index);assert.equal(await store.ensure(),index);
 const persisted=new data.SbizStore(f.root,{fetcher:()=>{throw Error('unexpected network');}}),input={asset:'apartment',asOf:day},identity={code:'apt-1',regionCode:'11410',town:'천연동',lot:'145',...center},snapshot=await persisted.nearby(input,{buildingResolution:identity});
 assert.equal(snapshot.groups.entrance.rows.length,16);assert.equal(snapshot.groups.supermarket.rows.length,16);assert.equal(snapshot.groups.mart_large.rows.length,0);assert.equal(snapshot.groups.english,undefined);assert.deepEqual(snapshot.identity,identity);assert.equal(snapshot.sourceDate,day);
 snapshot.groups.entrance.rows[0]['상호명']='mutation';assert.equal((await persisted.nearby(input,{buildingResolution:identity})).groups.entrance.rows[0]['상호명'],'검증입시학원');assert.equal(await persisted.nearby({...input,asset:'land'},{buildingResolution:identity}),null);
 const file=path.join(f.root,'sbiz-cache','index.json'),saved=JSON.parse(await fs.readFile(file,'utf8'));saved.value.rows[0]['상호명']='tampered';await fs.writeFile(file,JSON.stringify(saved));assert.equal(await new data.SbizStore(f.root).read(),null);
});
test('refresh rechecks official metadata but preserves an unchanged quarterly download',async t=>{
 const f=await fixture(t),index=await f.index(),calls=[],fetcher=async(url,opts)=>{calls.push([url,opts]);return new Response(url===data.SOURCE?html:JSON.stringify(metadata));},store=new data.SbizStore(f.root,{fetcher});await store.save(index);const [a,b]=await Promise.all([store.ensure({forceRefresh:true}),store.ensure({forceRefresh:true})]);assert.equal(a,b);assert.equal(calls.length,2);assert.equal(a.downloadedAt,index.downloadedAt);assert.ok(calls.every(([url])=>!url.includes('fileDownload.do')));assert.equal(calls[1][1].body.get('publicDataPk'),'15083033');
});
test('captcha, cancellation, wrong byte count and failed downloads never save empty data',async t=>{
 const f=await fixture(t),file=path.join(f.root,'fetch.zip'),meta=f.meta;let calls=0;await assert.rejects(data.download(async()=>{calls++;return new Response(JSON.stringify({needCaptcha:true}));},meta,file),/다운로드 확인/);assert.equal(calls,1);await assert.rejects(fs.stat(file));
 const controller=new AbortController();controller.abort();await assert.rejects(new data.SbizStore(f.root,{fetcher:()=>{throw Error('must not fetch');}}).ensure({signal:controller.signal}),/중지/);
 let request=0;const fake=async()=>++request===1?new Response(JSON.stringify({needCaptcha:false})):new Response(Buffer.alloc(1500),{headers:{'content-length':'1600'}});await assert.rejects(data.download(fake,meta,file),/완전하지/);
});
