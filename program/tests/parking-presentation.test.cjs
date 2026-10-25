'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const parking=require('../src/parking-presentation.cjs'),report=require('../src/report.cjs'),summary=require('../src/customer-summary.cjs'),{normalizeInput,aggregate}=require('../src/core.cjs');
const asOf='2026-10-18',checkedAt='2026-10-18T01:00:00Z';
function member(key='A',basic={parkingSpaces:2434,units:1834}){
 const name=key+'테스트단지',input=normalizeInput({target:'인천광역시 연수구 송도동 '+name,building:name,asOf,area:84}),identity={code:'202000'+key.charCodeAt(0),regionCode:'28185',building:name,province:'인천광역시',region:'연수구',town:'송도동',lot:String(key.charCodeAt(0)),lat:37.4,lng:126.64},naverLand={complexNo:String(123400+key.charCodeAt(0)),name,addressJibun:'인천광역시 연수구 송도동 '+identity.lot,...identity.lat!==undefined?{lat:identity.lat,lng:identity.lng,coordinateBasis:'complex'}:{},checkedAt,sourceUrl:'https://fin.land.naver.com/complexes/'+(123400+key.charCodeAt(0)),basic};
 return {id:'parking-'+key,key,input,title:name+' 분석',createdAt:checkedAt,dataCheckedAt:asOf,prices:{...aggregate([],input),buildingResolution:identity,naverLand},assessment:{evidence:{asOf,identity,naverLand}},sources:[],highlights:[],features:[],strengths:[],limitations:[],checks:[],sections:[],scores:[],map:{reason:'테스트 지도 미첨부'}};
}
function kapt(m,{ground=50,underground=100,units=100}={}){
 const i=m.prices.buildingResolution;m.assessment.evidence.nearbyContext={version:require('../src/nearby-context.cjs').VERSION,status:'checked',asOf,identityCode:i.code,center:{lat:i.lat,lng:i.lng},sources:[{id:'ev-nearby-kapt',title:'국토교통부 K-apt · 주변 단지 비교',url:'https://www.k-apt.go.kr/',checkedAt:asOf}],rows:[{kaptCode:'A10000001',name:i.building,target:true,address:[i.province,i.region,i.town,i.lot].join(' '),lat:i.lat,lng:i.lng,parkingGround:ground,parkingUnderground:underground,units,parkingPerUnit:null,checkedAt}]};return m;
}
function noNaver(m){delete m.prices.naverLand;delete m.assessment.evidence.naverLand;return m;}
function comparison(count=3){const members=[member('A'),noNaver(member('B')),member('C',{parkingSpaces:0,units:100})].slice(0,count);return {...members[0],mode:'comparison',members};}
const xml=value=>new(require('@xmldom/xmldom').DOMParser)().parseFromString(value,'application/xml');
const cells=(row,prefix)=>Array.from(row.childNodes).filter(n=>n.nodeType===1&&n.nodeName===prefix+':tc').map(n=>Array.from(n.getElementsByTagName(prefix+':t')).map(t=>t.textContent).join(''));
const tableRows=(table,prefix)=>Array.from(table.getElementsByTagName(prefix+':tr')).map(row=>cells(row,prefix));
function expectedParking(count){return ['총 2,434대 · 세대당 1.33대','미확인','총 0대 · 세대당 0.00대'].slice(0,count);}
function assertEditableOverview(rows,count){
 assert.equal(rows[0][0],'항목');assert.equal(rows[0].length,count+1);for(let i=0;i<count;i++)assert.ok(rows[0][i+1].includes('ABC'[i]+'테스트단지'),'단지 헤더 소유 순서');
 assert.equal(rows[1][0],'사용승인일 / 건축연도');assert.deepEqual(rows.find(r=>r[0]==='주차대수'),['주차대수',...expectedParking(count)]);assert.equal(rows.filter(r=>r[0]==='주차대수').length,1);assert.equal(rows.filter(r=>r[0]==='학군 · 초등학교').length,1);assert.doesNotMatch(rows.flat().join(' '),/학업성취|평가 순위|전국 순위/);
}
test('주차 합계·세대수·소수 둘째 자리 비율과 원출처를 저장자료에서 표시하고 자료·6점수를 바꾸지 않음',()=>{
 const m=member(),before=JSON.stringify(m),v=parking.snapshot(m);assert.equal(v.total,2434);assert.equal(v.units,1834);assert.equal(v.sourceName,'네이버 부동산');assert.equal(v.checkedAt,checkedAt);assert.match(parking.label(v),/총 주차대수 2,434대 · 세대당 1.33대 · 세대수 1,834세대/);assert.equal(parking.sourceLabel(v),'출처 네이버 부동산 · 조회 2026-10-18');assert.equal(JSON.stringify(m),before);
});
test('실제 주차 0대와 미확인·부분 자료를 구분하고 서로 다른 출처의 분자·분모를 섞지 않음',()=>{
 const zero=parking.snapshot(member('A',{parkingSpaces:0,units:100}));assert.equal(zero.total,0);assert.match(parking.label(zero),/주차대수 0대 · 세대당 0.00대/);
 const missing=parking.snapshot(noNaver(member()));assert.equal(missing.total,null);assert.match(parking.label(missing),/주차대수 미확인 · 세대당 미확인/);assert.doesNotMatch(parking.label(missing),/0대/);
 const onlyTotal=kapt(member('A',{units:1000}),{units:null});assert.equal(parking.snapshot(onlyTotal).total,150);assert.equal(parking.snapshot(onlyTotal).perUnit,null);assert.equal(parking.snapshot(onlyTotal).sourceName,'국토교통부 K-apt');
 const naverOnlyTotal=kapt(member('A',{parkingSpaces:300}),{ground:null,units:1000});assert.equal(parking.snapshot(naverOnlyTotal).total,300);assert.equal(parking.snapshot(naverOnlyTotal).perUnit,null);assert.equal(parking.snapshot(naverOnlyTotal).sourceName,'네이버 부동산');
 const officialZero=parking.snapshot(kapt(noNaver(member()),{ground:0,underground:0}));assert.equal(officialZero.total,0);assert.equal(officialZero.perUnit,0);
});
test('일치하는 네이버 주차 합계를 K-apt보다 우선하고 계산에는 같은 네이버 자료의 세대수만 사용함',()=>{
 const m=kapt(member()),before=JSON.stringify(m),value=parking.snapshot(m);
 assert.equal(value.total,2434);assert.equal(value.units,1834);assert.equal(value.sourceName,'네이버 부동산');assert.equal(value.sourceUrl,m.prices.naverLand.sourceUrl);assert.equal(value.perUnit,2434/1834);assert.equal(JSON.stringify(m),before);
 const onlyTotal=parking.snapshot(kapt(member('A',{parkingSpaces:300})));assert.equal(onlyTotal.total,300);assert.equal(onlyTotal.units,null);assert.equal(onlyTotal.perUnit,null);assert.equal(onlyTotal.sourceName,'네이버 부동산');
 const zero=parking.snapshot(kapt(member('A',{parkingSpaces:0,units:100})));assert.equal(zero.total,0);assert.equal(zero.perUnit,0);assert.equal(zero.sourceName,'네이버 부동산');
 const stale=kapt(member());for(const record of [stale.prices.naverLand,stale.assessment.evidence.naverLand])record.checkedAt='2026-10-17T01:00:00Z';assert.equal(parking.snapshot(stale).total,150);assert.equal(parking.snapshot(stale).sourceName,'국토교통부 K-apt');
});
test('네이버 화면에 별도 비율이 있어도 총대수와 세대수로 계산하며 출력에 계산 기준을 밝힘',()=>{
 const m=member();m.prices.naverLand.basic.parkingPerUnit=1.32;m.prices.naverLand.basic.parkingPerHousehold=1.32;
 const value=parking.snapshot(m);assert.equal(value.perUnit,2434/1834);assert.match(parking.label(value),/세대당 1\.33대/);assert.ok(parking.lines(m).includes(parking.RATIO_NOTE));assert.ok(parking.html(m).includes(parking.RATIO_NOTE));
});
test('K-apt에서 검증된 짧은 공식 단지명 별칭은 실제 법정동코드·도로명을 보존해 표시 단계에서도 다시 대조함',()=>{
 const nearby=require('../src/nearby-context.cjs');
 for(const bjdCode of ['1141010100',null]){
  const m=noNaver(member()),identity={building:'두산',code:'469',regionCode:'11410',province:'서울특별시',region:'서대문구',town:'북아현동',lot:'1009',road:'이화여대8길 62',lat:37.56,lng:126.95};
  Object.assign(m.input,{target:'서울특별시 서대문구 북아현동 두산',building:'두산'});m.prices.buildingResolution=identity;
  const data={kapt_code:'A12079501',name:'북아현두산',basic:{bjd_code:bjdCode,address_jibun:'서울특별시 서대문구 북아현동 1009 북아현두산',address_road:'서울특별시 서대문구 이화여대8길 62',total_units:100},detail:{parking_ground:50,parking_underground:100},metadata:{collected_at:checkedAt}};
  assert.equal(nearby.targetMatch(identity,data),true);
  const parsed=nearby.parseBatch({results:[{status:'success',data}]},[],{input:m.input,prices:m.prices,center:identity});
  m.assessment.evidence.nearbyContext={version:nearby.VERSION,status:'checked',asOf,identityCode:identity.code,sources:[{url:'https://www.k-apt.go.kr/'}],...parsed};
  assert.equal(parsed.rows[0].target,true);assert.equal(parsed.rows[0].bjdCode,bjdCode);assert.equal(parsed.rows[0].addressRoad,data.basic.address_road);assert.equal(parking.snapshot(m).total,150);assert.equal(parking.snapshot(m).perUnit,1.5);
  for(const change of [r=>{r.addressRoad='서울특별시 서대문구 다른길 62';},r=>{r.bjdCode='1168010100';},r=>{delete r.addressRoad;delete r.bjdCode;}]){const changed=structuredClone(m);change(changed.assessment.evidence.nearbyContext.rows[0]);assert.equal(parking.snapshot(changed).total,null);}
 }
});
test('같은 날 재저장한 네이버 자료는 예전 평가근거보다 최신 조회값을 표시하고 새 결측을 옛값으로 채우지 않음',()=>{
 const m=member();m.prices.naverLand={...structuredClone(m.prices.naverLand),checkedAt:'2026-10-18T02:00:00Z',basic:{parkingSpaces:3000,units:2000}};
 let value=parking.snapshot(m);assert.equal(value.total,3000);assert.equal(value.units,2000);assert.equal(value.perUnit,1.5);assert.equal(value.checkedAt,'2026-10-18T02:00:00Z');
 m.prices.naverLand.basic={units:2000};value=parking.snapshot(m);assert.equal(value.total,null);assert.equal(value.units,2000);assert.equal(value.perUnit,null);
});
test('공식 단지·주소·기준일이 다른 주차자료와 누락 원값은 유효 합계로 표시하지 않음',()=>{
 for(const change of [m=>{m.assessment.evidence.naverLand.addressJibun='서울특별시 송파구 송도동 65';},m=>{m.assessment.evidence.naverLand.name='A테스트2단지';},m=>{m.assessment.evidence.naverLand.checkedAt='2026-10-17T01:00:00Z';},m=>{m.assessment.evidence.naverLand.lat=38;}]){const m=member();delete m.prices.naverLand;change(m);assert.equal(parking.snapshot(m).total,null);}
 for(const change of [c=>{c.identityCode='another';},c=>{c.rows[0].target=false;},c=>{c.rows[0].address='서울특별시 송파구 송도동 65';},c=>{c.rows[0].parkingGround=null;},c=>{c.rows[0].parkingGround=false;},c=>{c.rows[0].checkedAt='2026-10-17T01:00:00Z';}]){const m=kapt(noNaver(member()));change(m.assessment.evidence.nearbyContext);assert.equal(parking.snapshot(m).total,null);}
});
test('단일·비교 HTML/PDF 본문에서 첫 개요 상단에 단지별 주차·출처·조회일이 평가보다 먼저 표시됨',()=>{
 for(const m of [member(),comparison(2),comparison()]){const before=JSON.stringify(m),html=report.html(m),overview=html.slice(html.indexOf('<section class="report-overview">'),html.indexOf('</section>')),count=m.members?.length||1;
  assert.equal((overview.match(/data-role="apartment-overview"/g)||[]).length,1);assert.doesNotMatch(overview,/data-role="parking-overview"/);assert.match(overview,/총 2,434대 · 세대당 1\.33대/);assert.match(overview,/네이버 부동산/);assert.match(overview,/조회 2026-10-18/);for(const property of m.members||[m])if(property.prices.naverLand)assert.ok(overview.includes(property.prices.naverLand.sourceUrl),'각 단지의 주차 원출처 URL 보존');assert.ok(html.indexOf('data-role="apartment-overview"')<html.indexOf('<h2>환경·가치'));
  const table=xml(overview.match(/<table\b[\s\S]*?<\/table>/)[0]),head=table.getElementsByTagName('thead')[0],header=Array.from(head.getElementsByTagName('th')).map(cell=>cell.getElementsByTagName('strong')[0]?.textContent||cell.textContent.trim()),parkingRow=Array.from(table.getElementsByTagName('tr')).find(r=>r.getAttribute('data-field')==='parking'),values=Array.from(parkingRow.childNodes).filter(n=>n.nodeType===1).map(n=>n.textContent.trim());
  assert.deepEqual(header,count===2?['A테스트단지','비교 항목','B테스트단지']:['비교 항목',...['A테스트단지','B테스트단지','C테스트단지'].slice(0,count)]);assert.deepEqual(values,count===2?[expectedParking(count)[0],'주차대수','미확인']:['주차대수',...expectedParking(count)]);assert.equal(Array.from(table.getElementsByTagName('tr')).filter(r=>r.getAttribute('data-field')==='parking').length,1);assert.doesNotMatch(overview,/학업성취|평가 순위|전국 순위/);assert.equal(JSON.stringify(m),before);
 }
});
test('고객 요약본도 처음 상단에서 같은 단지별 주차정보를 HTML·텍스트로 표시함',()=>{
 for(const m of [member(),comparison()]){const html=summary.html(m),text=summary.text(m);for(const value of [html,text]){assert.match(value,/주차대수 2,434대/);assert.match(value,/세대당 1.33대/);assert.match(value,/조회 2026-10-18/);}assert.ok(html.indexOf('data-role="parking-overview"')<html.indexOf('<section class="choice"'));assert.ok(text.indexOf('주차대수')<text.indexOf('고객 조건'));if(m.mode==='comparison'){assert.match(text,/B테스트단지 · 총 주차대수 미확인/);assert.match(text,/C테스트단지 · 총 주차대수 0대/);}}
});
test('Word·Excel·PPT 첫 표는 1·2·3단지의 주차 합계·미확인·실제0을 소유 단지 순서대로 보존',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'parking-output-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const radar=require('../src/radar.cjs'),png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l1EAAAAASUVORK5CYII=','base64');t.mock.method(radar,'raster',async()=>png);t.mock.method(radar,'addExcel',async wb=>wb.addWorksheet('육각형 평가 그래프'));
 const template=path.resolve(__dirname,'../../.agents/skills/last-ppt-template/assets/TTTM_분석프로그램_설계서_기본템플릿.pptx');
 for(const r of [member(),comparison(2),comparison()]){const count=r.members?.length||1,name=String(count),docx=path.join(root,name+'.docx'),xlsx=path.join(root,name+'.xlsx'),pptx=path.join(root,name+'.pptx'),before=JSON.stringify(r);await report.word(r,docx);await report.excel(r,xlsx);await report.powerpoint(r,pptx,null,template);
  const zip=await require('jszip').loadAsync(await fs.readFile(docx)),document=xml(await zip.file('word/document.xml').async('string')),wordRows=tableRows(document.getElementsByTagName('w:tbl')[0],'w'),wordText=Array.from(document.getElementsByTagName('w:t')).map(t=>t.textContent).join(' ');assertEditableOverview(wordRows,count);assert.ok(wordText.indexOf('총 2,434대')<wordText.indexOf('환경·가치'));assert.match(wordText,/출처 네이버 부동산[\s\S]*조회 2026-10-18/);for(const property of r.members||[r])if(property.prices.naverLand)assert.ok(wordText.includes(property.prices.naverLand.sourceUrl),'Word 단지별 원출처 보존');
  const wb=new(require('exceljs').Workbook)();await wb.xlsx.readFile(xlsx);const sheet=wb.getWorksheet(r.mode?'통합 비교':'분석 개요'),rows=Array.from({length:sheet.rowCount-2},(_,i)=>Array.from({length:count+1},(_,j)=>sheet.getCell(i+3,j+1).text)),values=sheet.getSheetValues().flat(Infinity).join(' ');assertEditableOverview(rows,count);assert.match(values,/네이버 부동산[\s\S]*조회 2026-10-18/);for(const property of r.members||[r])if(property.prices.naverLand)assert.ok(values.includes(property.prices.naverLand.sourceUrl),'Excel 단지별 원출처 보존');
  const ppt=await require('jszip').loadAsync(await fs.readFile(pptx)),tables=[],metadata=[];for(const file of Object.keys(ppt.files).filter(f=>/^ppt\/slides\/(?:slide\d+\.xml|_rels\/slide\d+\.xml\.rels)$/.test(f))){const source=await ppt.file(file).async('string');metadata.push(source);if(file.endsWith('.rels'))continue;const doc=xml(source);for(const table of Array.from(doc.getElementsByTagName('a:tbl'))){const rows=tableRows(table,'a');if(rows.some(row=>row[0]==='주차대수'))tables.push(rows);}}assert.equal(tables.length,1,'PPT 주차·가격 개요는 한 번 표시');assertEditableOverview(tables[0],count);const pptSources=metadata.join(' ');assert.match(pptSources,/네이버 부동산/);assert.match(pptSources,/2026-10-18/);for(const property of r.members||[r])if(property.prices.naverLand)assert.ok(pptSources.includes(property.prices.naverLand.sourceUrl),'PPT 단지별 기본정보 출처 링크 보존');assert.equal(JSON.stringify(r),before);
 }
});
