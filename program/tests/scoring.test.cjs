'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {SCORE_ITEMS,normalizeInput,aggregate,validateReport}=require('../src/core.cjs'),scoring=require('../src/scoring.cjs'),{guardNarrative}=require('../src/evidence-guard.cjs');
const input=normalizeInput({target:'서울 송파구 가상동 가상단지',building:'가상단지',area:84,asOf:'2026-10-16',types:['trade']}),center={lat:37.4,lng:126.64},identity={building:'가상단지',code:'TEST01',town:'가상동',lot:'10-1',...center};
const metadata={collected_at:'2026-10-16T00:00:00Z',data_source:'kakao_category'};
function place(id,category,label,offset){return {name:'가상 '+category,kakao_place_id:String(id),kakao_category_name:label,lat:center.lat+offset,lng:center.lng,distance_m:Math.round(scoring.haversine(center,{lat:center.lat+offset,lng:center.lng}))};}
function tool(name,data,args={}){return {type:'mcpToolCall',server:'ipzitalk',tool:name,arguments:args,result:{structuredContent:data}};}
function tools(){return [tool('get_complex_info_by_query',{kapt_code:'TEST01',name:'가상단지',basic:{address_jibun:'서울 송파구 가상동 10-1 가상단지',use_approval_date:'20140829',total_units:736},metadata}),tool('get_geocode',{...center,confidence:'exact',region:{eupmyeondong:'가상동',jibun:'10-1'},metadata}),tool('search_by_nearby_category',{center,radius_m:1500,metadata,results:{subway:[place(1,'역','교통 > 지하철',.008)],school_elementary:[place(2,'학교','교육 > 초등학교',.002)],mart_large:[place(3,'마트','가정,생활 > 슈퍼마켓',.001)],hospital:[place(4,'의원','의료 > 병원',.003)],pharmacy:[place(5,'약국','의료 > 약국',.0032)]}}),tool('search_by_nearby_keyword',{center,radius_m:1500,query:'공원',metadata,results:[place(6,'공원','여행 > 공원',.0033)]})];}
function prices(n=5,amounts){const out=aggregate(Array.from({length:n},(_,i)=>({id:'t'+i,date:'2026-08-01',kind:'trade',price:amounts?.[i]||100000,building:'가상단지',location:'서울 송파구 가상동',lot:'10-1',area:84.9,areaBasis:'전용면적'})),input,[{deal:'trade',status:'success',source:'https://rt.molit.go.kr/pt/xls/xls.do',checkedAt:'2026-10-16'}]);out.buildingResolution=identity;return out;}
function report(){return {title:'가상 분석',conclusion:'확인 필요',sources:[],scores:SCORE_ITEMS.map(name=>({name,score:null,reason:name+'의 현장 자료가 필요합니다.',method:'',sourceIds:[]}))};}
test('실제 도구 반환의 좌표·카테고리·주소를 대조해 확인한 접근성 지표만 부분 점수 산출',()=>{
 const a=scoring.assessScores(report(),{input,prices:prices(),tools:tools()});assert.deepEqual(a.scores.filter(s=>s.score!=null).map(s=>s.name),['교통 환경','교육 환경','상권 환경']);
 assert.equal(a.scores[0].score,70);assert.equal(a.scores[0].coverage,40);assert.equal(a.scores[2].coverage,35);assert.equal(a.scores[3].score,null);assert.equal(a.scores[1].coverage,15);assert.equal(a.scores[4].score,null);assert.equal(a.scores[5].score,null);assert.match(a.scores[1].observed,/배정 학교/);assert.equal(a.assessment.evidence.basic.approvalDate,'2014-08-29');assert.equal(a.scores[4].name,'병원 환경');
 const validated=validateReport({...report(),scores:a.scores,sources:a.sources}).report;assert.equal(validated.scores[0].status,'partial');assert.equal(validated.scores[0].coverage,40);assert.ok(validated.scores.every(s=>s.needed));
});
test('다른 단지 중심·조회일 이후 자료·허위 거리·잘못된 공원 분류·부적합 주소는 사용하지 않음',()=>{
 const wrongCenter=tools();for(const t of wrongCenter)if(t.result.structuredContent.center)t.result.structuredContent.center={lat:38,lng:127};assert.equal(scoring.assessScores(report(),{input,prices:prices(),tools:wrongCenter}).scores.filter(s=>s.score!=null).length,0);
 const future=tools();for(const t of future)t.result.structuredContent.metadata={...metadata,collected_at:'2026-10-17T00:00:00Z'};assert.equal(scoring.assessScores(report(),{input,prices:prices(),tools:future}).scores.filter(s=>s.score!=null).length,0);
 const bad=tools();bad[2].result.structuredContent.results.subway[0].distance_m=1;bad[3].result.structuredContent.results[0].kakao_category_name='음식점 > 공원카페';bad[0].result.structuredContent.basic.address_jibun='서울 송파구 가상동 10-11 다른단지';const result=scoring.assessScores(report(),{input,prices:prices(),tools:bad});assert.equal(result.scores[0].score,null);assert.equal(result.scores[3].score,null);assert.equal(result.assessment.evidence.basic,null);
});
test('조회 상한과 부분 평가를 표시하고 확인하지 않은 항목을 0점·중간 점수로 채우지 않음',()=>{
 const limited=tools();limited[2].result.structuredContent.metadata={...metadata,truncated:true};const a=scoring.assessScores(report(),{input,prices:prices(),tools:limited});assert.match(a.scores[2].reason,/제공 건수에 제한/);assert.match(scoring.result(a.scores[2]),/부분 평가.*\n.*\n확인 배점 35%/);assert.match(a.assessment.summary,/부분 평가 3개/);
 const empty=scoring.assessScores(report(),{input,prices:prices(),tools:[]});assert.ok(empty.scores.every(s=>s.score===null));assert.equal(new Set(empty.scores.map(s=>s.needed)).size,6);
});
test('제시가격과 거래 표본을 제공해도 새 병원·학원 점수로 대체하지 않으며 원가격은 유지',()=>{
 const p=prices(),before=structuredClone(p),a=scoring.assessScores(report(),{input:{...input,offered:100000},prices:p,tools:[]});assert.equal(a.scores[4].score,null);assert.equal(a.scores[5].score,null);assert.ok(!a.scores.some(s=>s.name==='가격 경쟁력'||s.name==='상품 경쟁력'));assert.deepEqual(p,before);
});
test('점수 구간·배점 숫자를 사실 수치와 구분하고 항목별 원래 보류 이유 유지',()=>{
 const r=guardNarrative({sources:[{id:'s',url:'https://example.go.kr'}],scores:[{name:'교육 환경',score:null,reason:'배정 학교 자료가 없어 보류합니다.',method:'구간 기준: 1~20 매우 취약, 21~40 취약, 41~60 보통, 61~80 우수, 81~100 매우 우수.',sourceIds:['s']}]});assert.equal(r.report.scores[0].reason,'배정 학교 자료가 없어 보류합니다.');assert.equal(r.rejected.length,0);
 const unknown=guardNarrative({sources:[],scores:[{name:'교통 환경',score:90,reason:'실제 보행 동선은 확인이 필요합니다.',method:'역까지 300m이므로 90점',sourceIds:[]}]});assert.equal(unknown.report.scores[0].score,null);assert.equal(unknown.report.scores[0].reason,'실제 보행 동선은 확인이 필요합니다.');
});
test('기존의 동일 보류 문구를 화면에서 항목별로 복원하되 미검증 숫자는 되살리지 않음',()=>{
 const r={...report(),input,prices:prices(),scores:SCORE_ITEMS.map(name=>({name,score:null,reason:'평가에 사용된 정량 근거를 직접 대조하지 못해 평가 보류합니다.',method:'',sourceIds:[]})),verification:{numericClaimsRejected:[{field:'scores.교통 환경',text:'역까지 300m입니다. 지역: 가상동'},{field:'scores.교육 환경',text:'배정 학교가 확인되지 않았습니다. 지역: 가상동'}]}};
 const changed=scoring.prepareReport(r);assert.notEqual(changed,r);assert.match(changed.scores[1].needed,/배정/);assert.ok(!JSON.stringify(changed.scores).includes('300m'));assert.ok(r.scores.every(s=>s.reason.includes('정량 근거')));
});
test('평가 근거 스냅샷을 같은 단지·기준일에서 재사용하며 원자료 참조를 중복 생성하지 않음',()=>{
 const a=scoring.assessScores(report(),{input,prices:prices(),tools:tools()}),b=scoring.assessScores(report(),{input,prices:prices(),previousEvidence:a.assessment.evidence});assert.deepEqual(b.scores,a.scores);assert.equal(b.sources.length,a.sources.length);
});
test('이전 설치본의 검증된 위치 근거는 당시 기준일 그대로 새 공통 배점에서 재사용',()=>{
 const a=scoring.assessScores(report(),{input,prices:prices(),tools:tools()}),old=structuredClone(a.assessment.evidence);old.version='2026-10-16-evidence-rubric-v1';
 const b=scoring.assessScores(report(),{input,prices:prices(),previousEvidence:old});assert.equal(b.scores[0].score,a.scores[0].score);assert.equal(b.scores[2].score,a.scores[2].score);assert.equal(b.scores[3].score,a.scores[3].score);assert.equal(b.assessment.evidence.version,scoring.VERSION);assert.match(b.assessment.evidence.warnings.join(' '),/당시/);assert.equal(old.version,'2026-10-16-evidence-rubric-v1');
});
