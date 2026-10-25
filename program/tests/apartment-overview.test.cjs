'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const overview=require('../src/apartment-overview.cjs'),{normalizeInput,aggregate}=require('../src/core.cjs');
const asOf='2026-10-18',checkedAt=asOf+'T01:00:00Z';
function member(key='A',options={}){
 const name=key+'테스트아파트',input=normalizeInput({target:'인천광역시 연수구 송도동 '+name,building:name,asOf,selectedAreas:[84.1,84.9],...options});
 const identity={code:'202012'+key.charCodeAt(0),regionCode:'28185',building:name,province:'인천광역시',region:'연수구',town:'송도동',lot:String(key.charCodeAt(0)),lat:37.4,lng:126.64};
 const contract=(id,kind,area,values)=>({id:key+id,kind,date:'2026-09-10',area,areaBasis:'전용면적',building:name,location:'인천광역시 연수구 송도동',lot:identity.lot,floor:id,built:'2010',cancelled:false,price:null,deposit:null,monthly:null,...values});
 const rows=[contract('1','trade',84.1,{price:100000}),contract('2','trade',84.9,{price:120000}),contract('3','jeonse',84.1,{deposit:60000,monthly:0}),contract('4','jeonse',84.9,{deposit:80000,monthly:0}),contract('5','monthly',84.1,{deposit:3000,monthly:200}),contract('6','monthly',84.9,{deposit:20000,monthly:100})];
 const prices={...aggregate(rows,input,[{deal:'trade',status:'success',source:'https://rt.molit.go.kr/pt/xls/xls.do',checkedAt},{deal:'rent',status:'success',source:'https://rt.molit.go.kr/pt/xls/xls.do',checkedAt}]),buildingResolution:identity};
 const complexNo=String(1100+key.charCodeAt(0));prices.naverLand={complexNo,name,addressJibun:'인천광역시 연수구 송도동 '+identity.lot,sourceUrl:'https://fin.land.naver.com/complexes/'+complexNo,checkedAt,basic:{approvalDate:'2010-10-19',units:1000,parkingSpaces:1200}};
 const school={status:'verified',checkedAt,zoneClass:'0',regionCode:'28185',referencePoint:{lat:37.4,lng:126.64},schoolNames:['송도테스트초등학교'],schools:[{id:'B000000001',name:'송도테스트초등학교',sourceDate:'2026-09-20'}],source:{title:'공식 학구도',url:'https://schoolzone.emac.kr/gis/gis.do',checkedAt},schoolSource:{title:'학교·학구 연계정보',url:'https://schoolzone.emac.kr/publicData/test.do',checkedAt}};
 return {key,input,prices,assessment:{evidence:{identity,school,sources:[]}}};
}
const values=r=>Object.fromEntries(overview.data(r).rows.map(row=>[row.key,row.values[0]]));

test('근접 타입 거래를 적용하면 단일·비교 첫 표에 요청 타입과 실제 적용 타입을 함께 보존함',()=>{
 const r=member('A',{selectedAreas:[],area:86});r.prices.areaResolution={requested:86,applied:84};r.prices.effectiveArea={areaMode:'type',area:84};
 const before=JSON.stringify(r),single=overview.data(r),comparison=overview.data({members:[r,member('B')]});
 for(const data of [single,comparison]){assert.match(data.properties[0].areaLabel,/요청 86타입 → 84타입 적용/);assert.match(data.properties[0].areaLabel,/전용 84~<85㎡/);}
 assert.match(overview.html(r),/요청 86타입 → 84타입 적용/);assert.equal(JSON.stringify(r),before);
});
test('단일 단지 상단표는 저장된 실제 사용승인·총세대·주차·선택 전용면적을 표시하고 원본을 변경하지 않음',()=>{
 const r=member(),before=JSON.stringify(r),data=overview.data(r),v=values(r);
 assert.equal(v.approval,'2010-10-19');assert.equal(v.age,'15년 11개월 (만 191개월)');assert.equal(v.units,'1,000세대');assert.equal(v.parking,'총 1,200대 · 세대당 1.20대');assert.match(data.properties[0].areaLabel,/84\.10~84\.90㎡ · 전용 25\.4~25\.7평/);assert.equal(v.school,'송도테스트초등학교\n공식 초등 통학구역');assert.equal(JSON.stringify(r),before);
 assert.deepEqual(overview.tableRows(r),data.rows.map(row=>[row.label,...row.values]));assert.equal(data.headers[0],'항목');assert.equal(overview.sections(r)[0].table.rows.length,data.rows.length);
});
test('평당가격은 계약별 금액÷전용면적 평균이고 전세가율·갭·선택면적 회전율을 재검산함',()=>{
 const r=member(),v=values(r),unit=(100000/84.1+120000/84.9)/2*overview.PYEONG;
 assert.equal(v.trade,'11억 · 2건');assert.equal(v.jeonse,'7억 · 2건');assert.equal(v.unitPrice,new Intl.NumberFormat('ko-KR',{maximumFractionDigits:0}).format(unit)+'만원/평');assert.equal(v.jeonseRatio,'63.6%');assert.equal(v.gap,'4억');assert.equal(v.turnover,'0.20% (2건 ÷ 1,000세대)');assert.match(overview.data(r).notes.join(' '),/공급면적 기준 평당가격과 다릅니다/);assert.match(overview.data(r).notes.join(' '),/선택면적 매매건수÷단지 전체 세대수/);
});
test('월세는 보증금 구간을 합치지 않고 상세표로 안내하며 단일 구간은 보증금과 월임대료를 함께 표시함',()=>{
 const r=member();assert.equal(values(r).monthly,'2개 보증금 구간 · 상세 거래표 참조');
 const contracts=r.prices.rows.filter(t=>t.kind!=='monthly'||t.id==='A5');r.prices={...r.prices,...aggregate(contracts,r.input,r.prices.coverage)};assert.equal(values(r).monthly,'보증 3,000만원 / 월 200만원 · 1건');
});
test('전체 면적 월세의 면적×보증금 조합 수를 실제 보증금 구간 수로 오표시하지 않음',()=>{
 const r=member('A',{selectedAreas:[],area:null}),contracts=structuredClone(r.prices.rows),monthly=contracts.filter(t=>t.kind==='monthly');
 contracts.push({...monthly[0],id:'A7',area:84.9,monthly:230},{...monthly[1],id:'A8',area:84.1,monthly:110});
 r.prices={...r.prices,...aggregate(contracts,r.input,r.prices.coverage)};
 assert.equal(r.prices.summaries.filter(g=>g.kind==='monthly').length,4);
 assert.equal(values(r).monthly,'2개 면적 · 2개 보증금 구간 · 상세 거래표 참조');
 assert.doesNotMatch(values(r).monthly,/4개 보증금/);
 const sameBand=contracts.map(t=>t.kind==='monthly'?{...t,deposit:3000}:t);
 r.prices={...r.prices,...aggregate(sameBand,r.input,r.prices.coverage)};
 assert.equal(values(r).monthly,'2개 면적 · 1개 보증금 구간 · 상세 거래표 참조');
});
test('만 연식은 해당 일자가 지나야 월수를 더하고 미래·잘못된 날짜를 음수 연식으로 표시하지 않음',()=>{
 assert.equal(overview.monthsSince('2025-10-19','2026-10-18'),11);assert.equal(overview.monthsSince('2025-10-18','2026-10-18'),12);assert.equal(overview.monthsSince(asOf,asOf),0);assert.equal(overview.monthsSince('2026-10-19',asOf),null);assert.equal(overview.monthsSince('2024-02-30',asOf),null);
 const r=member();r.prices.naverLand.basic.approvalDate='2028-01-01';const v=values(r);assert.equal(v.approval,'2010년 (실거래 기록상 건축연도)');assert.equal(v.age,'정확한 사용승인일 미확인');assert.doesNotMatch(v.age,/-\d/);
});
test('정확한 사용승인일이 없으면 일치한 실거래 건축연도만 사용하고 서로 다른 연도·미래연도는 제외함',()=>{
 for(const built of ['2028','잘못된 연도']){const r=member();delete r.prices.naverLand.basic.approvalDate;r.prices.rows.filter(t=>t.kind==='trade').forEach(t=>t.built=built);assert.equal(values(r).approval,'미확인');}
 const r=member();delete r.prices.naverLand.basic.approvalDate;r.prices.rows.find(t=>t.kind==='trade').built='2011';assert.equal(values(r).approval,'미확인');
});
test('전세·월세만 요청했거나 매매가 없어도 검증된 요청 거래의 일치 건축연도를 참고하고 승인일은 추정하지 않음',()=>{
 for(const types of [['jeonse'],['monthly']]){
  const r=member('A',{types});delete r.prices.naverLand.basic.approvalDate;
  assert.equal(values(r).approval,'2010년 (실거래 기록상 건축연도)');assert.equal(values(r).age,'정확한 사용승인일 미확인');
 }
 const noTrade=member();delete noTrade.prices.naverLand.basic.approvalDate;
 noTrade.prices={...noTrade.prices,...aggregate(noTrade.prices.rows.filter(t=>t.kind!=='trade'),noTrade.input,noTrade.prices.coverage)};
 assert.equal(values(noTrade).approval,'2010년 (실거래 기록상 건축연도)');assert.equal(values(noTrade).trade,'자료 없음');
});
test('요청 유형별 건축연도가 충돌하거나 미확인이면 참고연도를 만들지 않고 검증 실패 유형은 제외함',()=>{
 const r=member('A',{types:['jeonse','monthly']});delete r.prices.naverLand.basic.approvalDate;
 r.prices.rows.find(t=>t.kind==='monthly').built='2011';assert.equal(values(r).approval,'미확인');
 r.prices.rows.find(t=>t.kind==='monthly').built='';assert.equal(values(r).approval,'미확인');
 r.prices.summaries.find(g=>g.kind==='monthly').deposit++;assert.equal(values(r).approval,'2010년 (실거래 기록상 건축연도)');
});
test('매매·전세 평균이나 면적 집계 조건이 원계약과 다르면 전세가율·갭을 만들지 않음',()=>{
 for(const change of [r=>r.prices.summaries.find(g=>g.kind==='jeonse').deposit++,r=>r.prices.summaries.find(g=>g.kind==='jeonse').area='85.1',r=>r.prices.rows.find(t=>t.kind==='jeonse').area=85.1,r=>r.prices.rows.find(t=>t.kind==='jeonse').monthly=null]){
  const r=member();change(r);assert.equal(values(r).jeonseRatio,'산출 불가');assert.equal(values(r).gap,'산출 불가');
 }
});
test('다른 단지·주소·기간·해제·중복·원출처 없는 거래로 평당가격이나 회전율을 채우지 않음',()=>{
 for(const change of [r=>r.prices.rows.find(t=>t.kind==='trade').cancelled=true,r=>r.prices.rows.find(t=>t.kind==='trade').lot='999',r=>r.prices.rows.find(t=>t.kind==='trade').location='서울특별시 서초구 송도동',r=>r.prices.rows.find(t=>t.kind==='trade').date='2026-04-17',r=>r.prices.period.start='2026-05-01',r=>r.prices.rows.filter(t=>t.kind==='trade')[1].id='A1',r=>r.prices.coverage.find(c=>c.deal==='trade').source='https://example.org/fake',r=>r.prices.summaries.find(g=>g.kind==='trade').price++]){
  const r=member();change(r);assert.equal(values(r).unitPrice,'산출 불가');assert.equal(values(r).turnover,'산출 불가');assert.equal(values(r).trade,'자료 없음');
 }
});
test('과거 기준일의 거래를 나중에 정상 조회해도 계약일 필터를 유지하고 금액·비율을 표시함',()=>{
 const r=member(),expected=values(r),today=require('../src/core.cjs').todayKst();
 for(const entry of r.prices.coverage)entry.checkedAt=today;
 assert.deepEqual(values(r),expected);
 assert.equal(r.prices.period.end,asOf);assert.ok(r.prices.rows.every(t=>t.date<=asOf));
 const laterContract=structuredClone(r);laterContract.prices.rows.find(t=>t.kind==='trade').date='2026-10-19';
 assert.equal(values(laterContract).trade,'자료 없음');assert.equal(values(laterContract).unitPrice,'산출 불가');
});
test('미래·유효하지 않은 조회일과 계약보다 이른 다운로드로 거래 수치를 채우지 않음',()=>{
 const today=require('../src/core.cjs').todayKst(),future=new Date(Date.parse(today+'T00:00:00Z')+86400000).toISOString().slice(0,10);
 for(const checked of [future,'2026-02-30','날짜 없음','2026-09-10T01:00:00','2026-09-09']){
  const r=member();for(const entry of r.prices.coverage)entry.checkedAt=checked;
  const v=values(r);assert.equal(v.trade,'자료 없음');assert.equal(v.jeonse,'자료 없음');assert.equal(v.monthly,'자료 없음');assert.equal(v.unitPrice,'산출 불가');assert.equal(v.turnover,'산출 불가');assert.equal(v.jeonseRatio,'산출 불가');assert.doesNotMatch(v.turnover,/0\.00%/);
 }
});
test('주차자료의 단지·주소·당일 조건을 확인하며 실제 0대와 결측을 구분함',()=>{
 const zero=member();zero.prices.naverLand.basic.parkingSpaces=0;assert.equal(values(zero).parking,'총 0대 · 세대당 0.00대');
 for(const change of [r=>r.prices.naverLand.name='다른아파트',r=>r.prices.naverLand.addressJibun='인천광역시 연수구 송도동 999',r=>r.prices.naverLand.checkedAt='2026-10-17T01:00:00Z']){const r=member();change(r);assert.equal(values(r).parking,'미확인');assert.equal(values(r).units,'미확인');assert.equal(values(r).turnover,'산출 불가');}
});
test('매매만 요청하면 전세·월세·전세가율·갭을 표시하거나 추가 계산하지 않음',()=>{
 const r=member('A',{types:['trade']}),keys=overview.data(r).rows.map(row=>row.key);assert.ok(keys.includes('trade'));for(const key of ['jeonse','monthly','jeonseRatio','gap'])assert.ok(!keys.includes(key));assert.equal(overview.data(r).properties[0].facts.jeonse.status,'not-requested');
});
test('여러 면적을 분리한 전체 조회는 총액·면적을 임의로 합쳐 전세가율과 평당가격을 만들지 않음',()=>{
 const r=member('A',{selectedAreas:[],area:null});assert.match(values(r).trade,/2개 면적 조건/);assert.equal(values(r).jeonseRatio,'산출 불가');assert.equal(values(r).unitPrice,'산출 불가');
});
test('학교는 공식 통학구역에 연계된 기본 학교명만 쓰고 학업성취·진학률·순위를 표시하지 않음',()=>{
 const r=member();r.assessment.evidence.school.ranking=1;r.assessment.evidence.school.achievement='99%';assert.doesNotMatch(overview.html(r),/99%|학업성취|진학률|순위/);
 for(const change of [r=>r.assessment.evidence.school.regionCode='11110',r=>r.assessment.evidence.school.referencePoint.lat=38,r=>r.assessment.evidence.school.schoolSource.url='javascript:alert(1)',r=>r.assessment.evidence.school.checkedAt='2026-10-17T01:00:00Z']){const r=member();change(r);assert.equal(values(r).school,'미확인');}
});
test('단일·2단지·3단지에 같은 항목이 제공되고 2단지는 사진처럼 양옆 값과 중앙 항목표로 구성됨',()=>{
 const a=member('A'),b=member('B'),c=member('C'),one=overview.data(a),two={members:[a,b]},three={members:[a,b,c]};
 assert.deepEqual(overview.data(two).rows.map(r=>r.key),one.rows.map(r=>r.key));assert.deepEqual(overview.data(three).rows.map(r=>r.key),one.rows.map(r=>r.key));assert.match(overview.html(a),/label-first/);assert.match(overview.html(two),/two-properties/);assert.match(overview.html(three),/label-first/);assert.equal(overview.data(two).rows.every(r=>r.values.length===2),true);assert.equal(overview.data(three).rows.every(r=>r.values.length===3),true);assert.doesNotMatch(overview.html(two),/<h2>/);assert.match(overview.html(two),/A테스트아파트/);assert.match(overview.html(two),/B테스트아파트/);
 const unrelated={input:{asset:'commercial'}};assert.equal(overview.html(unrelated),'');assert.deepEqual(overview.tableRows(unrelated),[]);
});
