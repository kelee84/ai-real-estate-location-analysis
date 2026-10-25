'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const customer=require('../src/customer-report.cjs'),living=require('../src/living-presentation.cjs'),{normalizeInput,aggregate,SCORE_ITEMS}=require('../src/core.cjs');
function report(){
 const input=normalizeInput({target:'검증 단지',building:'검증 단지',asset:'apartment',asOf:'2026-10-18',area:59,types:['trade']});
 const groups={hospital:{categories:[{key:'general',label:'종합병원',weight:40,radiusM:5000,status:'observed',nearest:{name:'검증종합병원',distanceM:700},points:85},{key:'pediatric',label:'소아청소년과',weight:20,radiusM:1500,status:'empty',nearest:null,points:20},{key:'orthopedic',label:'정형외과',weight:20,radiusM:1500,status:'unavailable',nearest:null,points:null}]},academy:{categories:[{key:'entrance',label:'입시학원',weight:40,radiusM:1500,status:'observed',nearest:{name:'검증입시학원',distanceM:450},points:95}]}};
 return {id:'living-qa',input,title:'생활환경 검증',prices:aggregate([{id:'one',date:'2026-10-01',kind:'trade',price:75000,building:input.building,area:59.5,areaBasis:'전용면적'}],input),sources:[],highlights:[],strengths:[],limitations:[],checks:[],sections:[],features:[],scores:SCORE_ITEMS.map(name=>({name,score:85,status:'partial',scope:'직선 접근성',coverage:80,sourceIds:['test'],method:'검증 기준',reason:'접근 근거',observed:'접근성 평가',calculation:[{indicator:'거리'}]})),assessment:{version:'test',evidence:{livingAccess:{groups},places:[{name:'검증중학교',category:'school_middle',lat:37.5,lng:127,distanceM:600}]}}};
}
test('보관된 상품·가격점수를 병원·학원 숫자로 옮기지 않고 고객 기본표는 새 6개만 표시',()=>{
 const r=report();r.scores=r.scores.filter(s=>!['병원 환경','학원 환경'].includes(s.name));r.scores.push({name:'상품 경쟁력',score:99},{name:'가격 경쟁력',score:98});const before=JSON.stringify(r),view=customer.prepare(r);
 assert.deepEqual(view.scores.map(s=>s.name),SCORE_ITEMS);for(const name of ['병원 환경','학원 환경'])assert.equal(view.scores.find(s=>s.name===name).score,null);assert.equal(JSON.stringify(r),before);
});
test('의료 분야별 거리·배점은 표시하고 검색 실패와 완료한 빈 결과를 구분',()=>{
 const r=report(),before=JSON.stringify(r),rows=living.accessRows(r,'hospital');assert.deepEqual(rows[0],['종합병원','검증종합병원','직선 700m','85점']);assert.match(rows[1][2],/반경 1,500m 내 미확인/);assert.equal(rows[1][3],'20점');assert.equal(rows[2][3],'평가 보류');assert.match(rows[2][2],/조회 자료 부족/);assert.equal(JSON.stringify(r),before);
 const html=require('../src/report.cjs').html(r);assert.match(html,/병원 접근성 세부 정보/);assert.doesNotMatch(html,/학원 접근성 세부 정보|검증입시학원/);assert.match(html,/학원 환경/);assert.match(html,/실제 진료과 운영/);assert.doesNotMatch(html,/학교별 공개 학업|공식 순위 미제공|상품 경쟁력|가격 경쟁력|프리미엄 경쟁력/);assert.match(customer.keyEvidence(r.scores.find(s=>s.name==='병원 환경'),r),/소아과 1,500m 내 미확인/);assert.deepEqual(living.accessRows(r,'academy'),[]);
});
test('기존 학업정보 근거·본문·링크는 재출력에서 제외하고 학교 기본정보와 점수는 보존',()=>{
 const r=report(),source={id:'test',title:'학교알리미 · 검증중학교',url:'https://www.schoolinfo.go.kr/old',checkedAt:'2026-10-18'};
 r.assessment.evidence.schoolAchievement={schools:[{name:'검증중학교',rankText:'공식 순위 미제공',source}]};r.sources=[source];
 r.highlights=['검증초등학교 직선 150m','학교별 학업성취도 미확인'];r.scores.find(s=>s.name==='교육 환경').observed='검증초등학교 직선 150m';r.sections=[{heading:'학교별 공개 학업 정보',body:'공식 순위 미제공'},{heading:'교육',body:'검증초등학교 직선 150m. 학교알리미 자료는 보안문자 확인이 필요합니다.'}];
 r.assessment.evidence.places.push({name:'검증초등학교',category:'school_elementary',lat:37.5,lng:127,distanceM:150,sourceId:'test'});
 const before=JSON.stringify(r),html=require('../src/report.cjs').html(r),summary=require('../src/customer-summary.cjs');
 for(const text of [html,summary.html(r),summary.text(r)]){assert.ok(!/학교별 공개 학업|학업성취|학교알리미|schoolinfo\.go\.kr|공식 순위 미제공/.test(text),'학업정보 제외');assert.ok(/검증초등학교(?: 직선)? 150m/.test(text),'학교명·거리 유지');}
 assert.deepEqual(customer.prepare(r).scores,r.scores);assert.equal(JSON.stringify(r),before);
});
test('Excel 생활 상세는 병원 근거를 유지하고 학원 과목별 정보와 학교 학업정보는 제외',async()=>{
 const r=report(),before=JSON.stringify(r),Excel=require('exceljs'),wb=new Excel.Workbook();living.addExcel(wb,r);const loaded=new Excel.Workbook();await loaded.xlsx.load(await wb.xlsx.writeBuffer());const sheet=loaded.getWorksheet('병원·학원 세부정보'),text=sheet.getSheetValues().flat(2).join('\n');for(const value of ['검증종합병원','직선 700m','조회 자료 부족'])assert.ok(text.includes(value),value);assert.doesNotMatch(text,/검증입시학원|학원 접근성|학교별 공개 학업|공식 순위 미제공/);assert.equal(JSON.stringify(r),before);assert.equal(loaded.getWorksheet('주변 단지 비교'),undefined);
});
test('예전 고객 우선조건을 새 분야로 자동 치환하지 않음',()=>{const normalized=require('../src/consultation.cjs').normalizeCustomer({priorities:['상품 경쟁력','가격 경쟁력','병원 환경']});assert.deepEqual(normalized.priorities,['병원 환경']);});
test('학원 요약 근거는 점수 상태를 유지하며 과목별 최근접 거리와 배점은 표시하지 않음',()=>{
 const r=report(),s=r.scores.find(s=>s.name==='학원 환경'),before=JSON.stringify(r),text=customer.keyEvidence(s,r);assert.match(text,/입시 450m/);assert.equal(customer.scoreLabel(s),'85점*');assert.equal(JSON.stringify(r),before);assert.equal(customer.detail({...s,score:null,reason:'',needed:''}),s.observed);
});
test('기존 AI 학원 세부 섹션과 다른 본문 안의 과목별 표를 출력에서 제외하며 원자료는 보존',()=>{
 const r=report();r.sections=[{heading:'학원 접근성 세부 정보',body:'삭제대상학원 250m · 40%'},{heading:'생활시설',body:'병원 운영시간은 확인이 필요합니다.\n### 학원 접근성 세부표\n| 과목 | 시설 | 거리 | 배점 |\n| 입시 | 삭제대상학원 | 250m | 40% |\n### 확인할 사항\n버스 운행시간을 확인합니다.'}];const before=JSON.stringify(r),prepared=customer.prepare(r);assert.doesNotMatch(JSON.stringify(prepared.sections),/삭제대상학원|학원 접근성 세부|40%/);assert.match(JSON.stringify(prepared.sections),/병원 운영시간|버스 운행시간/);assert.equal(JSON.stringify(r),before);
});
test('Excel은 네이버 생활정보 시트를 제외하고 내부 도보 근거를 그대로 보존',async()=>{
 const r=report(),Excel=require('exceljs'),wb=new Excel.Workbook(),{walkingFixture}=require('./naver-walking-fixture.cjs'),f=walkingFixture();r.input={...r.input,asOf:f.input.asOf,building:f.identity.building};r.prices.buildingResolution=f.identity;r.prices.naverNearby={identityCode:f.identity.code,asOf:f.input.asOf,facts:[f.fact,{category:'shopping',name:'미산정업체',text:'긴 주소 '.repeat(350),sourceUrl:f.fact.sourceUrl,checkedAt:f.fact.checkedAt,distanceBasis:'거리 미산정'}]};const before=JSON.stringify(r);await require('../src/report-flow.cjs').addExcel(wb,customer.prepare(r));const loaded=new Excel.Workbook();await loaded.xlsx.load(await wb.xlsx.writeBuffer());assert.equal(loaded.getWorksheet('네이버 보완정보'),undefined);assert.equal(loaded.getWorksheet('네이버 출처'),undefined);assert.doesNotMatch(JSON.stringify(loaded.worksheets.map(s=>s.getSheetValues())),/가상생활마트|미산정업체|긴 주소|거리 미산정|네이버에서 확인한 생활정보/);assert.match(require('../src/naver-supplement.cjs').sections(r)[0].body,/네이버 도보 832m · 16분/);assert.equal(JSON.stringify(r),before);
});

test('Word·PPT 저장파일은 병원 상세와 학원 요약 점수를 유지하고 학원 상세를 제외',async()=>{
 const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),JSZip=require('jszip'),engine=require('../src/report.cjs'),r=report(),before=JSON.stringify(r),dir=await fs.mkdtemp(path.join(os.tmpdir(),'living-formats-'));
 try{
  const docFile=path.join(dir,'living.docx'),pptFile=path.join(dir,'living.pptx'),template=path.resolve(__dirname,'../../.agents/skills/last-ppt-template/assets/TTTM_분석프로그램_설계서_기본템플릿.pptx');await engine.word(r,docFile);await engine.powerpoint(r,pptFile,null,template);
  const doc=await JSZip.loadAsync(await fs.readFile(docFile)),ppt=await JSZip.loadAsync(await fs.readFile(pptFile)),docText=await doc.file('word/document.xml').async('string'),pptText=(await Promise.all(Object.keys(ppt.files).filter(name=>/^ppt\/slides\/slide\d+\.xml$/.test(name)).map(name=>ppt.file(name).async('string')))).join('\n');
  for(const text of [docText,pptText]){for(const value of ['검증종합병원','학원 환경','진료 수준'])assert.ok(text.includes(value),value);assert.doesNotMatch(text,/검증입시학원|학원 접근성 세부|학교별 공개 학업|공식 순위 미제공|schoolinfo\.go\.kr/);}
  assert.equal(JSON.stringify(r),before);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
function detailedReport(){
 const r=report(),center={lat:37.5,lng:127};r.input.request='주변 단지 주차 비교';
 r.prices.buildingResolution={code:'fictional-complex',building:r.input.building,province:'서울특별시',region:'서대문구',regionCode:'11410',town:'가상동',lot:'1',...center};r.assessment.evidence.center=center;r.assessment.evidence.sources=[];
 require('./fixtures/naver-smoke.cjs').presentationEvidence(r);
 r.assessment.evidence.nearbyContext={version:require('../src/nearby-context.cjs').VERSION,asOf:r.input.asOf,identityCode:r.prices.buildingResolution.code,rows:[{name:'검증 이웃 단지',parkingPerUnit:1.2,parkingPerUnitRank:1,ageYears:15,subway:'가상역',subwayDistanceM:400,subwayDistanceMRank:1}],validParking:1,validSubway:1,ageBands:[],reason:'가상 자료 분리 검증.'};
 return r;
}
test('생활 표 종류 선택은 병원·국영수와 주변단지를 분리하고 기본 전체의 표와 원자료를 보존',()=>{
 for(const count of [1,3]){
  const single=detailedReport(),r=count===1?single:{...single,mode:'comparison',members:Array.from({length:count},(_,i)=>({...structuredClone(single),key:'ABC'[i]}))},before=JSON.stringify(r),all=living.sections(r),access=living.sections(r,{kind:'access'}),context=living.sections(r,{kind:'context'});
  assert.equal(all.length,count*3);assert.equal(access.length,count*2);assert.equal(context.length,count);
  assert.deepEqual(all,Array.from({length:count},(_,i)=>[...access.slice(i*2,i*2+2),context[i]]).flat());
  for(const s of access){assert.equal(s.rows.length,4);assert.doesNotMatch(JSON.stringify(s),/검증 이웃 단지|검증중학교|학교별 공개 학업|미술학원|음악학원|체육/);}
  for(const s of context){assert.match(s.title,/주변 단지 참고 비교/);assert.match(JSON.stringify(s.rows),/검증 이웃 단지/);assert.doesNotMatch(JSON.stringify(s),/가상입시학원|가상수학학원|검증중학교/);}
  for(const kind of ['access','context']){const values=kind==='access'?access:context,html=living.html(r,{kind});assert.equal((html.match(/class="living-details"/g)||[]).length,values.length);for(const s of values)assert.equal(html.split('<h3>'+s.title+'</h3>').length-1,1);}
  assert.equal(JSON.stringify(r),before);
 }
});
test('생활 Word 선택은 요청한 표만 한 번씩 만들고 지정 제목 수준을 유지',async()=>{
 const r=detailedReport(),before=JSON.stringify(r),d=require('docx'),JSZip=require('jszip');
 for(const kind of ['access','context']){
  const doc=new d.Document({sections:[{children:living.word(r,d,{kind,headingLevel:d.HeadingLevel.HEADING_1})}]}),zip=await JSZip.loadAsync(await d.Packer.toBuffer(doc)),xml=await zip.file('word/document.xml').async('string');
  const values=living.sections(r,{kind});assert.equal((xml.match(/<w:tbl>/g)||[]).length,values.length);for(const s of values)assert.equal(xml.split(s.title).length-1,1);assert.equal((xml.match(/w:val="Heading1"/g)||[]).length,values.length);
  if(kind==='access'){assert.match(xml,/가상입시학원/);assert.doesNotMatch(xml,/검증 이웃 단지/);}else{assert.match(xml,/검증 이웃 단지/);assert.doesNotMatch(xml,/가상입시학원/);}assert.doesNotMatch(xml,/검증중학교|학교별 공개 학업/);
 }
 assert.equal(JSON.stringify(r),before);
});
test('Excel 생활 표는 별도 시트에 중복 없이 저장하고 자료가 없는 종류의 시트는 생성하지 않음',async()=>{
 const Excel=require('exceljs');
 for(const available of ['both','access','context','none']){
  const r=detailedReport();if(available==='access'||available==='none')delete r.assessment.evidence.nearbyContext;if(available==='context'||available==='none')delete r.assessment.evidence.livingAccess;
  const before=JSON.stringify(r),wb=new Excel.Workbook();living.addExcel(wb,r);if(available==='none'){assert.equal(wb.worksheets.length,0);continue;}
  const loaded=new Excel.Workbook();await loaded.xlsx.load(await wb.xlsx.writeBuffer());
  for(const [kind,name,hasData]of [['access','병원·학원 세부정보',['both','access'].includes(available)],['context','주변 단지 비교',['both','context'].includes(available)]]){
   const sheet=loaded.getWorksheet(name);assert.equal(!!sheet,hasData);if(!sheet)continue;
   const text=sheet.getSheetValues().flat(2).join('\n');for(const s of living.sections(r,{kind}))assert.equal(text.split(s.title).length-1,1);
   assert.doesNotMatch(text,/검증중학교|학교별 공개 학업/);if(kind==='access'){assert.match(text,/가상입시학원/);assert.doesNotMatch(text,/검증 이웃 단지/);}else{assert.match(text,/검증 이웃 단지/);assert.doesNotMatch(text,/가상입시학원/);}
  }
  assert.equal(loaded.getWorksheet('병원·학원·주변 단지 정보'),undefined);assert.equal(JSON.stringify(r),before);
 }
});
module.exports={report};
