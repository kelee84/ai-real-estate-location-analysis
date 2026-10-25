'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const JSZip=require('jszip');
const {todayKst}=require('../src/core.cjs');
const {querySchoolZone,boundedJson}=require('../src/school-zone.cjs');
const {queryPublicKapt}=require('../src/kapt-public.cjs');
const zone=require('./fixtures/official-evidence/school-zone.json'),kapt=require('./fixtures/official-evidence/kapt.json');
const input={center:{lat:37.3989808,lng:126.6414859},identity:{code:'20297704',building:'더샵그린워크1차',town:'송도동',lot:'18-6',regionCode:'28185'},asOf:todayKst()};
const response=data=>new Response(typeof data==='string'?data:JSON.stringify(data),{status:200,headers:{'content-type':'application/json'}});
async function zoneFetch({mutate,failCsv=false}={}){
 const zip=new JSZip();zip.file('school-zone.csv','학구ID,학교ID,학교명,학교급구분,교육지원청명,데이터기준일자\r\nZ000101213,B000025210,인천연송초등학교,초등학교,인천광역시동부교육지원청,2026-09-20\r\n');const bytes=await zip.generateAsync({type:'nodebuffer'});let count=0;
 return async url=>{if(url.includes('/query?')){const d=structuredClone(zone);mutate?.(d,count++);return response(d);}if(failCsv)throw new Error('연계 파일 연결 실패');if(url.includes('publicDataList'))return response('<tr><td>한국교육시설안전원 학교-학구도 연계정보(2026.09.20.)</td><a data-nttId="2961" data-atchFileId="FILE_000000100002991" data-fileSn="0"></a></tr>');if(url.includes('publicDataFileDownload'))return new Response(bytes);throw new Error('unexpected URL');};
}
test('actual official zone and school link fixture verifies five reference points and exact relation',async()=>{
 const r=await querySchoolZone({...input,fetchImpl:await zoneFetch()});assert.equal(r.status,'verified');assert.equal(r.zoneId,'101213');assert.equal(r.regionCode,'28185');assert.deepEqual(r.schoolNames,['인천연송초등학교']);assert.equal(r.schools[0].id,'B000025210');assert.match(r.reason,/최종 확인/);assert.equal(r.currentInformation,true);
});
test('official zone rejects wrong region, ambiguous boundaries, truncated and future data',async()=>{
 for(const mutate of [(d)=>d.features[0].attributes.SD_CD='11',(d,i)=>{if(i===1)d.features[0].attributes.HAKGUDO_ID='101214';},d=>d.features.push(structuredClone(d.features[0])),d=>d.exceededTransferLimit=true,d=>d.features[0].attributes.UPDATE_DATE='20990101',d=>d.features[0].attributes.HAKGUDO_CLASS='1']){
  const r=await querySchoolZone({...input,fetchImpl:await zoneFetch({mutate})});assert.equal(r.status,'unavailable');assert.ok(r.reason);assert.equal(r.schoolNames,undefined);
 }
});
test('school-zone preserves verified geometry when school relation lookup fails',async()=>{
 const r=await querySchoolZone({...input,fetchImpl:await zoneFetch({failCsv:true})});assert.equal(r.status,'verified');assert.deepEqual(r.schoolNames,[]);assert.match(r.schoolLookupReason,/연결하지 못/);
});
test('actual K-apt fixture verifies public identifiers and whitelists physical facts',async()=>{
 const data=structuredClone(kapt);data.resultMap_kapt.kaptTel='private';data.serviceKey='secret';const r=await queryPublicKapt({...input,kaptCode:'A40673923',fetchImpl:async()=>response(data)});
 assert.equal(r.status,'verified');assert.equal(r.units,736);assert.equal(r.parkingGround,5);assert.equal(r.parkingUnderground,1178);assert.equal(r.parkingTotal,1183);assert.equal(r.elevators,17);assert.equal(r.hallType,'계단식');assert.equal(r.approvalDate,'2014-08-29');assert.doesNotMatch(JSON.stringify(r),/private|secret|kaptTel|serviceKey/);
});
test('K-apt rejects wrong mapping, code, address, phase, future approval and malformed bodies',async()=>{
 for(const mutate of [d=>d.resultMap_match.townCode=123,d=>d.resultMap_kapt.kaptCode='wrong',d=>d.resultMap_kapt_addrList[0].addr='인천광역시 연수구 송도동 18-7',d=>d.resultMap_kapt.kaptName='더샵그린워크2차',d=>d.resultMap_kapt.kaptUsedate='2099-01-01',d=>delete d.resultMap_match]){
  const data=structuredClone(kapt);mutate(data);const r=await queryPublicKapt({...input,kaptCode:'A40673923',fetchImpl:async()=>response(data)});assert.equal(r.status,'unavailable');assert.ok(r.reason);
 }
 const malformed=await queryPublicKapt({...input,kaptCode:'A40673923',fetchImpl:async()=>response('<html>error</html>')});assert.equal(malformed.status,'unavailable');assert.match(malformed.reason,/JSON/);
});
test('zero, missing and out-of-range counts do not fabricate available parking',async()=>{
 const data=structuredClone(kapt);data.resultMap_kapt.kaptdPcnt=null;data.resultMap_kapt.kaptdEcntTotal=-1;data.resultMap_kapt.kaptdaTCnt='';const r=await queryPublicKapt({...input,kaptCode:'A40673923',fetchImpl:async()=>response(data)});assert.equal(r.status,'verified');assert.equal(r.units,null);assert.equal(r.parkingTotal,null);assert.equal(r.elevators,null);
});
test('current official services do not backfill historic/future evaluation dates',async()=>{
 let calls=0;const fetchImpl=async()=>{calls++;throw new Error('should not fetch');};for(const asOf of ['2020-01-01','2099-01-01']){assert.equal((await querySchoolZone({...input,asOf,fetchImpl})).status,'unavailable');assert.equal((await queryPublicKapt({...input,asOf,kaptCode:'A40673923',fetchImpl})).status,'unavailable');}assert.equal(calls,0);
});
test('bounded official reads reject HTTP, error JSON, oversized responses and propagate cancellation',async()=>{
 await assert.rejects(boundedJson('https://example.test',{fetchImpl:async()=>new Response('{}',{status:503})}),/HTTP 503/);
 await assert.rejects(boundedJson('https://example.test',{fetchImpl:async()=>response({error:{code:500}})}),/오류 응답/);
 await assert.rejects(boundedJson('https://example.test',{fetchImpl:async()=>new Response('{}',{headers:{'content-length':3000000}})}),/허용 크기/);
 const ac=new AbortController();ac.abort();await assert.rejects(queryPublicKapt({...input,signal:ac.signal,kaptCode:'A40673923',fetchImpl:async()=>{throw new DOMException('aborted','AbortError');}}),/aborted/);
});
test('a transient connection failure retries once within the same request deadline',async()=>{
 let calls=0;const value=await boundedJson('https://example.test',{fetchImpl:async()=>{if(!calls++)throw new TypeError('fetch failed');return response({verified:true});}});assert.equal(calls,2);assert.deepEqual(value,{verified:true});
});
