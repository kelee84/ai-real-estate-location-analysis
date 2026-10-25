'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const summary=require('../src/customer-summary.cjs'),customer=require('../src/customer-report.cjs'),{normalizeInput,aggregate}=require('../src/core.cjs');
function member(key='A',types=['trade','jeonse','monthly']){
 const input=normalizeInput({target:key+' 테스트단지',building:key+' 테스트단지',asOf:'2026-10-18',area:84,types});
 const transactions=[{id:key+'1',date:'2026-10-01',kind:'trade',price:73475},{id:key+'2',date:'2026-10-02',kind:'jeonse',deposit:45000,monthly:0},{id:key+'3',date:'2026-10-03',kind:'monthly',deposit:5000,monthly:90},{id:key+'4',date:'2026-10-04',kind:'monthly',deposit:20000,monthly:40}].map(t=>({...t,building:input.building,area:84.3,areaBasis:'전용면적',cancelled:false}));
 return {id:'summary-test-'+key,key,input,title:key+' 단지 분석',createdAt:'2026-10-18T00:00:00Z',dataCheckedAt:'2026-10-18',highlights:[],strengths:[],limitations:['실제 배정 학교는 별도 확인이 필요합니다.'],checks:[],sections:[],features:[],sources:[{id:'source',title:'공식 자료',url:'https://rt.molit.go.kr/',checkedAt:'2026-10-18'}],prices:aggregate(transactions,input),scores:customer.AXES.map((name,i)=>({name,score:70+i,status:'partial',scope:name+' 확인된 지표',coverage:40,observed:name+' 저장 근거',reason:'저장 근거',sourceIds:['source'],method:'검증된 산식',calculation:[{indicator:name+' 지표'}]})),assessment:{version:'test-v1'},map:{reason:'검증용 미첨부'}};
}
function report(count=1){
 const members=Array.from({length:count},(_,i)=>member(String.fromCharCode(65+i))),r=count===1?members[0]:{...member(),mode:'comparison',members};
 r.consultation={customer:{purpose:'live',budgetType:'trade',budgetManwon:80000,moveIn:'2027년 2월',priorities:['교통 환경','교육 환경']},officeProfile:{name:'한눈에 부동산',agent:'김담당',phone:'02-1234-5678',address:'서울 테스트로 1'},properties:members.map(m=>({key:m.key,cautions:m.key+' 누수 확인 필요',publicNote:m.key+' 방문 때 창호를 확인했습니다.',privateNote:m.key+' 절대공개금지 내부 협상메모',visitedAt:'2026-10-17'}))};return r;
}
test('단일·2·3개 요약은 저장값을 보존하고 고객조건·6항목·업소정보·공개메모만 표시',()=>{
 for(const count of [1,2,3]){const r=report(count),before=JSON.stringify(r),html=summary.html(r),text=summary.text(r),model=summary.model(r);assert.equal(JSON.stringify(r),before);assert.equal(model.properties.length,count);for(const output of [html,text]){assert.match(output,/매매 예산 8억원/);assert.match(output,/한눈에 부동산/);assert.match(output,/02-1234-5678/);assert.match(output,/누수 확인 필요/);assert.match(output,/방문 때 창호/);assert.match(output,/실제 배정 학교는 별도 확인이 필요/);assert.doesNotMatch(output,/절대공개금지|privateNote|프리미엄 경쟁력/);assert.match(output,/7.3억/);assert.match(output,/2026-04-18 ~ 2026-10-18/);assert.match(output,/지도.*미첨부/);}assert.equal(model.properties[0].scores.length,6);assert.deepEqual(model.properties[0].prices.filter(t=>t.startsWith('월세')).length,2);}
});
test('요청한 거래 유형만 출력하고 보증금 구간을 통합하지 않음',()=>{
 const r=member('A',['trade']);assert.equal(summary.model(r).properties[0].prices.length,1);assert.match(summary.model(r).properties[0].prices[0],/^매매/);const monthly=summary.model(member('A',['monthly'])).properties[0].prices;assert.equal(monthly.length,2);assert.ok(monthly.some(t=>t.includes('월 90만원')));assert.ok(monthly.some(t=>t.includes('월 40만원')));assert.ok(monthly.every(t=>t.includes('보증금')));
});
test('월세 고객 예산은 월 임대료가 아닌 보증금 예산으로 안내',()=>{
 const r=report();r.consultation.customer.budgetType='monthly';r.consultation.customer.budgetManwon=5000;for(const output of [summary.html(r),summary.text(r)]){assert.match(output,/월세 보증금 예산 5,000만원/);assert.doesNotMatch(output,/월 임대료 예산/);}
});
test('단일·비교 제목은 주택과 상가에 모두 쓸 수 있는 매물 표현을 사용',()=>{
 const single=report();single.input.asset='commercial';assert.equal(summary.model(single).title,'우리 조건에 맞는 매물 살펴보기');assert.equal(summary.model(report(2)).title,'우리 조건에 맞는 매물 비교');assert.doesNotMatch(summary.html(single),/맞는 집/);
});
test('같은 범위 점수로만 고객 우선조건의 선택문구를 만들고 미확인을 평균점수로 채우지 않음',()=>{
 const r=report(2);r.members[1].scores[0].score=90;let m=summary.model(r);assert.match(m.selection[0],/B의 평가 점수가 높습니다/);r.members[1].scores[0].scope='다른 평가 범위';m=summary.model(r);assert.match(m.selection[0],/우열 판단을 보류/);r.members[0].scores[1].score=null;m=summary.model(r);assert.equal(m.properties[0].scores[1].label,'평가 보류');assert.doesNotMatch(m.selection.join(' '),/100점|0점/);
});
test('사용자 입력을 HTML로 실행하지 않고 원문 문자열과 줄바꿈을 보존',()=>{
 const r=report();r.consultation.officeProfile.name='<script>alert(1)</script>';r.consultation.officeProfile.logoDataUrl='data:image/svg+xml,<svg onload="alert(1)">';r.consultation.properties[0].publicNote='<img src=x onerror="alert(1)">\n둘째 줄';const html=summary.html(r,'" onerror="alert(1)');assert.doesNotMatch(html,/<script>|<img src=x|image\/svg|src="" onerror/);assert.match(html,/&lt;script&gt;/);assert.match(html,/&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;<br>둘째 줄/);
});
test('오래된 보고서는 빈 상담정보로 열리고 3개 비교 공개투영과 PPT 변환에서도 비공개메모 제외',()=>{
 const old=member();old.input.office='기존 부동산';delete old.input.officeProfile;assert.match(summary.html(old),/기존 부동산/);assert.match(summary.html(old),/고객 조건 미입력/);const r=report(3),view=customer.prepare(r),adapted={...view,mode:undefined,comparisonMembers:view.members};delete adapted.members;const again=customer.prepare(adapted);for(const p of again.consultation.properties)assert.ok(!('privateNote' in p));assert.equal(again.consultation.properties.length,3);for(const key of ['A','B','C'])assert.ok(again.sections.some(s=>s.body.includes(key+' 누수 확인 필요')));assert.doesNotMatch(JSON.stringify(view),/절대공개금지/);
});
test('긴 고객 전달 메모는 생략하지 않고 과거 프리미엄 점수는 기본 6개 표에서 제외',()=>{
 const r=report(),message='현장에서 확인한 메모입니다.\n'.repeat(45);r.consultation.properties[0].publicNote=message;r.scores.push({...r.scores[0],name:'프리미엄 경쟁력',score:65,scope:'검증된 상대가격 차이'});const m=summary.model(r);assert.equal(m.properties[0].scores.length,6);assert.ok(!m.properties[0].scores.some(s=>s.name==='프리미엄 경쟁력'));assert.ok(summary.text(r).includes(message.trim()));assert.equal((summary.html(r).match(/현장에서 확인한 메모입니다/g)||[]).length,45);
});
test('점수 주석은 표 앞에 유지하고 지도 다음에 학업정보 없이 출처와 업소 정보 표시',()=>{
 const r=report();r.assessment.evidence={places:[{name:'검증중학교',category:'school_middle',lat:37.5,lng:127,distanceM:600}]};const html=summary.html(r),table=html.indexOf('<table class="scores">'),map=html.indexOf('<section class="summary-map">'),sources=html.indexOf('<div class="sources">');assert.ok(html.indexOf('1~100점 분석 평가')<table);assert.ok(table<map&&map<sources);assert.doesNotMatch(html,/학교별 공개 학업|공식 순위 미제공/);
});
module.exports={report,member};
