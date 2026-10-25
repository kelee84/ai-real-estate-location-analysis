'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {compactComparisonInput,compactPreviousScore}=require('../src/comparison.cjs'),{sections}=require('../src/naver-supplement.cjs'),{SCORE_ITEMS}=require('../src/core.cjs');
const {walkingFixture}=require('./naver-walking-fixture.cjs');
const bytes=value=>Buffer.byteLength(JSON.stringify(value));
function fixture(count){
  const members=Array.from({length:count},(_,i)=>{
    const f=walkingFixture(),key=String.fromCharCode(65+i),input={...f.input,building:f.identity.building};
    const nearby={identityCode:f.identity.code,asOf:input.asOf,checkedAt:f.fact.checkedAt,status:'received',issues:['진료시간과 실제 운영은 미확인'],facts:[f.fact,...Array.from({length:40},()=>({...structuredClone(f.fact),rawLookupPage:'같은 공개 페이지의 반복 표시 메타데이터 '.repeat(200)}))],rawLookupHtml:'확인 화면의 중복 원시 메타데이터 '.repeat(16000),routeCandidates:Array.from({length:25},()=>({raw:'후보 응답 메타데이터 '.repeat(100)}))};
    return {key,input,prices:{buildingResolution:f.identity,naverNearby:nearby},scoreEvidence:{}};
  });
  const body={request:'같은 기준으로 비교',comparisonAsOf:members[0].input.asOf,warnings:['실제 학교 배정과 보행 안전은 별도 확인'],members:members.map((m,i)=>({key:m.key,input:m.input,prices:{unit:'만원·㎡',period:{start:'2026-04-23',end:m.input.asOf},groups:[{kind:'trade',n:37,price:100000+i*10000}],excluded:{outside:2,cancelled:1}},verifiedResearch:{school:{status:'verified',schoolNames:['공식 배정학교 '+m.key],remark:'공식 통학구역 조건 유지',source:'https://example.go.kr/school/'+m.key},nature:{status:'verified',selected:{name:'대표공원 '+m.key,areaM2:300000,distanceM:500},source:{url:'https://example.go.kr/park/'+m.key}},livingAccess:{status:'partial',medical:['종합병원','소아청소년과','정형외과','치과'],academy:['입시','국어','영어','수학'],notes:['실제 운영 미확인']},sixScores:SCORE_ITEMS.map(name=>({name,score:85,reason:m.key+'의 고정 접근 근거'})),sourceDates:[{id:m.key+'-s',url:'https://example.go.kr/'+m.key,checkedAt:m.input.asOf}],warnings:['검색 범위 내 등록 자료의 부분 평가']},researchIssues:['경로가 확인되지 않은 시설은 보행 설명에서 제외'],naverNearby:m.prices.naverNearby,dataCheckedAt:m.prices.naverNearby.checkedAt,reusedEvidence:true,previousReport:{conclusion:m.key+' 이전 결론',strengths:[m.key+'의 확인된 장점'],limitations:[m.key+'의 조건 차이'],sections:[{heading:'이전 상세 설명',body:'기존 본문의 고유 사실과 선택 조건을 그대로 보존합니다. '.repeat(50)}],scores:SCORE_ITEMS.map(name=>({name,score:85,reason:'종전 근거',sourceIds:[m.key+'-s']})),sources:[{id:m.key+'-s',url:'https://example.go.kr/'+m.key}]}})),previousComparison:{conclusion:'이전 비교 결론',sections:[{heading:'이전 비교 본문',body:'비교의 이전 선택 조건과 고유한 설명도 보존합니다.'}]}};
  return {body,members};
}
for(const count of [2,3])test(count+'-property prompt removes raw Naver duplication while preserving every established fact and previous report verbatim',t=>{
  const {body,members}=fixture(count),original=structuredClone(body),memberOriginal=structuredClone(members),result=compactComparisonInput(body,members),before=bytes(body),after=bytes(result);
  assert.ok(after<before*.1,'The large raw-metadata fixture must shrink materially');
  t.diagnostic(JSON.stringify({properties:count,beforeBytes:before,afterBytes:after,reductionPercent:Number((100*(1-after/before)).toFixed(2))}));
  for(let i=0;i<count;i++){
    const old=body.members[i],next=result.members[i],expected=sections({input:members[i].input,prices:members[i].prices,assessment:{evidence:members[i].scoreEvidence}});
    assert.equal(expected.length,1);assert.equal(next.naverNearby[0].facts[0].text,'가상생활마트 · 네이버 도보 832m · 16분');
    assert.deepEqual(next.naverNearby,expected.map(s=>({heading:s.heading,facts:s.facts.map(f=>({text:f.text,sourceUrl:f.sourceUrl,checkedAt:f.checkedAt})),sources:s.sources})));
    for(const key of ['input','prices','verifiedResearch','researchIssues','dataCheckedAt','reusedEvidence','previousReport'])assert.deepEqual(next[key],old[key],key+' must be retained');
    assert.deepEqual(next.naverNearbyState,{status:'received',checkedAt:old.naverNearby.checkedAt,asOf:old.naverNearby.asOf,issues:['진료시간과 실제 운영은 미확인']});
    assert.ok(!JSON.stringify(next.naverNearby).includes('rawLookup'));assert.equal(next.previousReport.sections[0].body,old.previousReport.sections[0].body);
  }
  assert.deepEqual(result.previousComparison,body.previousComparison);assert.deepEqual(result.warnings,body.warnings);assert.equal(result.previousSectionTexts,undefined);assert.ok(!JSON.stringify(result).includes('bodyRef'));
  assert.deepEqual(body,original);assert.deepEqual(members,memberOriginal);
});
test('failed or mismatched Naver evidence remains an empty fact list with its failure conditions preserved',()=>{
  const {body,members}=fixture(2);
  members[0].prices.naverNearby={status:'unavailable',reason:'공식 단지와 경로를 대조하지 못했습니다.',asOf:members[0].input.asOf,issues:['외부 조회 실패'],facts:[]};
  members[1].prices.naverNearby.identityCode='different-property';
  const result=compactComparisonInput(body,members);assert.deepEqual(result.members[0].naverNearby,[]);assert.deepEqual(result.members[1].naverNearby,[]);
  assert.deepEqual(result.members[0].naverNearbyState,{status:'unavailable',asOf:members[0].input.asOf,reason:'공식 단지와 경로를 대조하지 못했습니다.',issues:['외부 조회 실패']});
  assert.deepEqual(result.members.map(m=>m.verifiedResearch),body.members.map(m=>m.verifiedResearch));assert.ok(!JSON.stringify(result.members[0].naverNearby).includes('0m'));
});
for(const count of [2,3])test(count+'-property previous score projection retains calculation, selection and missing-data conditions without copying the public register',t=>{
  const {body}=fixture(count);
  for(const [i,member]of body.members.entries()){
    member.previousReport.scores=member.previousReport.scores.map(score=>{
      const out={...score,status:'partial',scope:'등록 시설 직선 접근',coverage:60,observed:'선택 시설의 등록 좌표 확인',needed:'실제 운영·진료·수업은 미확인',method:'공통 가중평균·반올림',calculation:[{indicator:'등록 시설',weight:40,value:700,unit:'m (직선)',points:70,sourceId:member.key+'-s'}]};
      if(score.name==='자연환경')Object.assign(out,{regionalPark:{name:'평가 공원',areaM2:300000,distanceM:700},landmarkPark:{name:'대표 공원',areaM2:500000},parkSizeRatio:.6});
      if(score.name==='학원 환경')out.accessCategories=[{
        key:'entrance',label:'입시·보습',weight:40,radiusM:5000,status:'observed',complete:false,limited:true,points:70,sourceDate:'2026-10-01',queries:[{query:'입시학원',status:'received',truncated:true,returned:15,rejected:2}],
        nearest:{id:'selected-'+i,name:'확인 학원',lat:37.5,lng:126.9,distanceM:700,distanceBasis:'직선',sourceId:member.key+'-s',url:'https://example.go.kr/facility/'+i,checkedAt:'2026-10-23',rawRecord:{stored:'원자료행'},rawHash:'검증해시',sbizProof:{scope:'저장용 검증'}},
        publicEvidence:{version:1,provider:'sbiz-csv',asOf:'2026-10-23',sourceDate:'2026-10-01',sourceUrl:'https://example.go.kr/source',identity:{code:'source-'+i},center:{lat:37.5,lng:126.9},scope:{radiusM:5000},manifest:{rawMetadata:'저장 검증 메타 '.repeat(1000)},groups:{entrance:Array.from({length:80},(_,n)=>({name:'선택하지 않은 시설'+n,rawRecord:'원자료 전체 목록 '.repeat(100)}))}}
      }];
      return out;
    });
  }
  const original=structuredClone(body),result=structuredClone(body);
  for(const member of result.members)member.previousReport.scores=member.previousReport.scores.map(compactPreviousScore);
  const beforeScores=bytes(body.members.map(m=>m.previousReport.scores)),afterScores=bytes(result.members.map(m=>m.previousReport.scores));assert.ok(afterScores<beforeScores*.2);t.diagnostic(JSON.stringify({properties:count,beforePriorScoreBytes:beforeScores,afterPriorScoreBytes:afterScores}));
  for(const [i,member]of result.members.entries()){
    const old=body.members[i];assert.deepEqual(member.prices,old.prices);assert.deepEqual(member.verifiedResearch,old.verifiedResearch);
    for(const field of ['conclusion','strengths','limitations','sections','sources'])assert.deepEqual(member.previousReport[field],old.previousReport[field]);
    for(const [j,score]of member.previousReport.scores.entries()){
      const oldScore=old.previousReport.scores[j];for(const field of ['name','score','status','scope','coverage','observed','needed','reason','method','sourceIds','calculation','regionalPark','landmarkPark','parkSizeRatio'])assert.deepEqual(score[field],oldScore[field]);
      if(!score.accessCategories)continue;const c=score.accessCategories[0],oldCategory=oldScore.accessCategories[0];
      for(const field of ['key','label','weight','radiusM','status','complete','limited','points','sourceDate','queries'])assert.deepEqual(c[field],oldCategory[field]);
      const {rawRecord,rawHash,sbizProof,...selected}=oldCategory.nearest;assert.deepEqual(c.nearest,selected);
      const {groups,manifest,...provenance}=oldCategory.publicEvidence;assert.deepEqual(c.publicEvidence,provenance);
    }
  }
  assert.deepEqual(body,original);
});
