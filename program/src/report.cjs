'use strict';
const fs=require('node:fs/promises');const path=require('node:path');
const {escapeHtml:e,money,monthlyBand,areaGroup,areaSelection,displaySources}=require('./core.cjs');
const customer=require('./customer-report.cjs'),average=require('./price-table.cjs');
function sourceReferences(r,s){return customer.reference(r,s);}
function catalogNote(r){return r.typeCatalog?`${r.typeCatalog.sourceName||'공식 면적 목록'} · 조회 ${r.typeCatalog.checkedAt||'미확인'} · ${r.typeCatalog.scope||'조회 범위 미확인'} · ${r.typeCatalog.source||'출처 미확인'}`:'';}
const {NAME,REPORT_CREDIT}=require('./brand.cjs');
const theme=require('./brand-theme.cjs');
const KIND={trade:'매매',jeonse:'전세',monthly:'월세'};
const scoring=require('./scoring.cjs');
const radar=require('./radar.cjs'),flow=require('./report-flow.cjs'),parking=require('./parking-presentation.cjs'),overview=require('./apartment-overview.cjs');
function wordHeader(d,office=''){
  return new d.Header({children:[new d.Paragraph({children:[new d.ImageRun({type:'png',data:theme.logoPng(),transformation:{width:28,height:28*230/420},altText:{title:'AI SHERPA',description:'제작사 AI SHERPA',name:'AI SHERPA'}}),new d.TextRun({text:'  AI SHERPA'+(office?' · '+office:''),font:'맑은 고딕',size:18,bold:true,color:theme.hex.navy})],spacing:{after:80}})]});
}
function wordStyles(size,line){return {default:{document:{run:{font:'맑은 고딕',size,color:theme.hex.ink},paragraph:{spacing:{line}}},title:{run:{color:theme.hex.navy}},heading1:{run:{color:theme.hex.navy}},heading2:{run:{color:theme.hex.navy}}}};}
function safeTextChunks(value,limit=90){
  const text=String(value),chunks=[];let current='';
  // Keep dates, names and other words whole. The limit is a preferred boundary.
  for(const token of text.match(/\s+|\S+/gu)||[]){
    if(current&&token.trim()&&current.length+token.length>limit){chunks.push(current);current='';}
    current+=token;
  }
  if(current||!chunks.length)chunks.push(current);
  return chunks;
}
function evaluationRows(r){r=customer.prepare(r);return r.scores.map(s=>[s.name,customer.scoreLabel(s),customer.keyEvidence(s,r)]);}
const evaluationNote=r=>customer.SCORE_NOTE;
function priceRows(r){if(r.comparisonMembers)return r.comparisonMembers.flatMap(m=>priceRows(m).map(row=>[m.key+' · '+row[0],...row.slice(1)]));return require('./price-table.cjs').rows(r);}
async function mapData(r,store){if(r.mode==='comparison')return require('./comparison-report.cjs').mapData(r,store);if(!r.map?.file)return null;const f=path.join(store.path(r.id),'figures',path.basename(r.map.file));try{return 'data:image/png;base64,'+(await fs.readFile(f)).toString('base64');}catch{return null;}}
function html(r,image=null){
  r=customer.prepare(r);
  if(r.mode==='comparison')return require('./comparison-report.cjs').html(r,image||{});
  const table=(headers,rows,widths=[],className='')=>`<div class="table-wrap"><table class="${className}">${widths.length?'<colgroup>'+widths.map(w=>`<col style="width:${w}%">`).join('')+'</colgroup>':''}<thead><tr>${headers.map(x=>`<th>${e(x)}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${row.map(x=>`<td>${e(x).replace(/\n/g,'<br>')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  const list=items=>`<ul>${(items||[]).map(x=>`<li>${e(x)}</li>`).join('')}</ul>`;
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'"><title>${e(flow.title(r))}</title><style>
  *{box-sizing:border-box}body{margin:0;background:#fff;color:${theme.colors.ink};font:15px/1.75 'Malgun Gothic','맑은 고딕',sans-serif}article{max-width:900px;margin:auto;padding:42px 44px}h1,h2,h3{color:${theme.colors.navy}}h1{font-size:29px;line-height:1.4;letter-spacing:-.025em;margin:10px 0 20px}h2{font-size:20px;margin:34px 0 12px;break-after:avoid}h3{font-size:16px;margin:22px 0 8px;break-after:avoid}p,ul{margin:10px 0;overflow-wrap:anywhere}li{margin:6px 0}.meta,.note{font-size:12px;color:${theme.colors.muted}}.notice{background:#fff5e6;padding:14px 18px;color:#70502b}.demo{font-weight:700;background:#fff0d8;padding:12px}table{width:100%;border-collapse:collapse;font-size:13px;line-height:1.55;table-layout:fixed}th{background:${theme.colors.paleBlue};text-align:left}td,th{padding:10px;border-bottom:1px solid ${theme.colors.line};vertical-align:top;overflow-wrap:anywhere}tr{break-inside:avoid}thead{display:table-header-group}.table-wrap{max-width:100%}figure{margin:24px 0;break-inside:avoid}figure img{display:block;max-width:100%;height:auto;border:1px solid ${theme.colors.line}}figcaption{font-size:12px;color:${theme.colors.muted}}a{color:${theme.colors.blueDark};overflow-wrap:anywhere}.split{display:grid;grid-template-columns:1fr 1fr;gap:28px}.source{font-size:12px;line-height:1.65}footer{margin-top:36px;padding-top:12px;border-top:1px solid ${theme.colors.line};font-size:11px;color:${theme.colors.muted}}@page{size:A4;margin:15mm 13mm}@media print{article{padding:0;max-width:none}h1{font-size:24px}.split{display:block}h2{margin-top:24px}a{color:inherit}body{print-color-adjust:exact;-webkit-print-color-adjust:exact}}
  .assessment-radar{margin:24px 0 20px;break-inside:avoid}.assessment-radar svg{display:block;width:100%;height:auto}.assessment-radar figcaption{margin-top:8px;line-height:1.65}@media print{.assessment-radar{break-inside:avoid}}
${require('./price-trend.cjs').CSS}${average.CSS}${flow.CSS}${parking.CSS}${overview.CSS}${theme.reportCss}${require('./report-pagination.cjs').FLOW_CSS}</style></head><body><article>${theme.reportHeader()}${r.demo?'<p class="demo">사용 예시 · 실제 매물의 분석 결과가 아닙니다.</p>':''}<p class="meta">${e(r.input.office||'부동산 분석 보고서')} · 기준일 ${e(r.input.asOf)}</p><h1>${e(flow.title(r))}</h1>
  <section class="report-overview"><h2>물건과 비교 조건</h2>${r.input.asset==='apartment'?overview.html(r):parking.html(r)+table(['대상','전용면적','최근 6개월 거래 요약'],flow.overviewRows(r),[32,14,54])}<p class="note">${e(customer.priceLabel(r))} · ${e(average.periodNote(r))}</p>${flow.exactNotes(r).map(text=>`<p class="note">${e(text)}</p>`).join('')}</section>
  ${r.input.asset==='apartment'?`<section class="assessment-overview" data-members="1"><div class="assessment-intro"><h2>환경·가치 평가</h2>${flow.insightHtml(r)}${radar.html(r,{compact:true})}</div><div class="score-block"><p class="note">${e(evaluationNote(r))}</p><h3>6개 항목의 근거와 평가 범위</h3>${table(['평가 항목','평가 결과','확인 근거'],evaluationRows(r),[16,25,59])}<p class="note">1~100점 분석 평가입니다. 공인 등급·수익률·가격 상승 확률이 아닙니다. 1~20 매우 취약 / 21~40 취약 / 41~60 보통 / 61~80 우수 / 81~100 매우 우수. 미확인을 중간점수로 채우거나 종합점수·순위를 만들지 않았습니다.</p></div></section>`:''}

  ${require('./living-presentation.cjs').html(r,{kind:'access'})}
  <h2>단지별 장단점과 선택 기준</h2>${table(['단지','장점과 근거','단점·상대적 아쉬움','선택 기준'],flow.decisionRows(r),[18,28,30,24],'report-decisions')}
  ${r.strengths.length?'<section class="compact-facts"><h3>추가 확인된 장점</h3>'+list(r.strengths)+'</section>':''}
  ${r.features.length?'<section class="compact-facts"><h3>확인된 단지 특성</h3>'+list(r.features)+'</section>':''}
  <h2>지도와 주변 시설</h2>
  ${image?`<figure><img src="${image}" alt="입지톡에서 제공한 대상 아파트와 주변 시설 지도"><figcaption>${e(customer.mapCaption(r.map))}${r.map.url?` <a href="${e(r.map.url)}">공유 지도</a>`:''}</figcaption></figure>`:r.input.asset==='apartment'?`<p class="notice">입지톡 지도 미첨부 · ${e(r.map?.reason||'지도 연결 또는 이미지 확보가 필요합니다.')}</p>`:''}

  ${r.highlights.length?'<section class="compact-facts"><h3>확인된 주요 정보</h3>'+list(r.highlights)+'</section>':''}
  ${flow.sections(r,'facilities').map(s=>'<section><h3>'+e(s.heading)+'</h3><p>'+e(s.body).replace(/\n/g,'<br>')+'</p></section>').join('')}
  ${require('./living-presentation.cjs').html(r,{kind:'context'})}
  ${require('./future-developments.cjs').html(r)}
  ${r.typeCatalog?`<p class="note">${e(catalogNote(r))}</p>`:''}<section class="transaction-summary"><h2>최근 6개월 거래 평균</h2><p class="note">${e(average.periodNote(r))} · ${e(average.conditionNote(r))}</p>${table(['거래 유형','전용면적','보증금 구간','건수','평균 금액'],priceRows(r),[10,16,24,7,43],'averages')}<p class="note">${e(average.NOTE)}</p>${average.missingNote(r)?`<p class="note">${e(average.missingNote(r))}</p>`:''}</section>

  ${require('./price-trend.cjs').html(r)}
  ${flow.sections(r,'trade').map(s=>'<section><h3>'+e(s.heading)+'</h3><p>'+e(s.body).replace(/\n/g,'<br>')+'</p></section>').join('')}
  <h2>출처</h2><section class="customer-sources">${customer.sources(r).map(s=>`<p class="source" data-source-item><strong>${e(s.label)}</strong> · <a href="${e(s.url)}">${e(s.title)}</a> · ${e(s.checkedAt)}</p>`).join('')}</section><footer>${e(REPORT_CREDIT)} · ${e(r.input.asOf)} · 보고서 ${e(r.id)}</footer></article></body></html>`;
}
async function word(r,file,image){
  r=customer.prepare(r);
  if(r.mode==='comparison')return require('./comparison-report.cjs').word(r,file,image||{});
  const d=require('docx');const p=(text,heading)=>new d.Paragraph({text:String(text),heading,spacing:{after:80},keepNext:!!heading,keepLines:true,widowControl:true});
  const table=(heads,rows,widths=[],compact=false)=>new d.Table({...(widths.length?{layout:d.TableLayoutType.FIXED,columnWidths:widths.map(w=>Math.round(10106*w/100))}:{}),width:{size:100,type:d.WidthType.PERCENTAGE},rows:[heads,...rows].map((row,i)=>new d.TableRow({tableHeader:i===0,cantSplit:true,children:row.map((text,j)=>new d.TableCell({...(widths[j]?{width:{size:widths[j],type:d.WidthType.PERCENTAGE}}:{}),shading:i===0?{fill:theme.hex.paleBlue}:undefined,children:String(text).split('\n').map(t=>compact?new d.Paragraph({children:[new d.TextRun({text:t,font:'맑은 고딕',size:20,bold:i===0})],spacing:{after:65,line:260},keepLines:true}):p(t))}))}))});
  const ov=overview.data(r),children=[p(flow.title(r),d.HeadingLevel.TITLE),p('기준일 '+r.input.asOf),p('물건과 비교 조건',d.HeadingLevel.HEADING_1),...(r.input.asset==='apartment'?[table(ov.headers,overview.tableRows(r),[34,66],true),...ov.notes.map(text=>p(text)),...ov.sources.map(s=>p('출처 '+s.title+' · 조회 '+require('./core.cjs').todayKst(new Date(s.checkedAt))+' · '+s.url))]:[...parking.lines(r).map(text=>p(text)),table(['대상','전용면적','최근 6개월 거래 요약'],flow.overviewRows(r),[32,14,54])]),p(customer.priceLabel(r)),p(average.periodNote(r)),...flow.exactNotes(r).map(text=>p(text))];
  if(r.input.asset==='apartment')children.push(new d.Paragraph({text:'환경·가치 평가',heading:d.HeadingLevel.HEADING_1,keepNext:true}),...flow.insights(r).map(text=>new d.Paragraph({text,keepNext:true,spacing:{after:80,line:260}})),new d.Paragraph({children:[new d.ImageRun({type:'png',data:await radar.raster(r,{compact:true}),transformation:{width:500,height:500*radar.COMPACT_HEIGHT/radar.WIDTH},altText:{title:'환경·가치 육각형 점수표',description:radar.description(r),name:'육각형 평가'}})]}),p(radar.NOTE),p(evaluationNote(r)),p('6개 항목의 근거와 평가 범위',d.HeadingLevel.HEADING_2),table(['평가 항목','평가 결과','확인 근거'],evaluationRows(r),[16,25,59]),p('1~100점 분석 평가이며 공인 등급·수익률·가격 상승 확률이 아닙니다. 부분 평가는 표시한 세부지표의 평가입니다.'));

  children.push(...require('./living-presentation.cjs').word(r,d,{kind:'access'}));
  children.push(p('단지별 장단점과 선택 기준',d.HeadingLevel.HEADING_1),table(['단지','장점과 근거','단점·상대적 아쉬움','선택 기준'],flow.decisionRows(r),[18,28,30,24]));
  if(r.strengths.length)children.push(p('추가 확인된 장점',d.HeadingLevel.HEADING_2),...r.strengths.map(text=>p(text)));
  if(r.features.length)children.push(p('확인된 단지 특성',d.HeadingLevel.HEADING_2),...r.features.map(text=>p(text)));
  children.push(p('지도와 주변 시설',d.HeadingLevel.HEADING_1));
  if(image){const buffer=Buffer.from(image.split(',')[1],'base64'),width=buffer.readUInt32BE(16),height=buffer.readUInt32BE(20),scale=Math.min(620/width,680/height);children.push(p('입지톡 지도',d.HeadingLevel.HEADING_1),new d.Paragraph({children:[new d.ImageRun({type:'png',data:buffer,transformation:{width:width*scale,height:height*scale}})]}),p(customer.mapCaption(r.map)));}
  if(r.input.asset==='apartment'&&!image)children.push(p('입지톡 지도 미첨부 · '+(r.map?.reason||'연결 및 이미지 확보 필요')));

  children.push(...r.highlights.map(text=>p(text)),...flow.sections(r,'facilities').flatMap(s=>[p(s.heading,d.HeadingLevel.HEADING_2),p(s.body)]),...require('./living-presentation.cjs').word(r,d,{kind:'context'}),...require('./future-developments.cjs').word(r,d));
  children.push(p('최근 6개월 거래 평균',d.HeadingLevel.HEADING_1),p(average.periodNote(r)),table(['유형','전용면적','보증금 구간','건수','평균 금액'],priceRows(r),[10,16,24,7,43],true),p(average.NOTE),...(average.missingNote(r)?[p(average.missingNote(r))]:[]));
  if(r.typeCatalog)children.push(p('선택 타입과 집계 조건',d.HeadingLevel.HEADING_1),p(r.prices.condition),p(catalogNote(r)));

  children.push(...await require('./price-trend.cjs').word(r,d));
  for(const section of flow.sections(r,'trade'))children.push(p(section.heading,d.HeadingLevel.HEADING_2),p(section.body));
  children.push(p('출처',d.HeadingLevel.HEADING_1),...customer.sources(r).map(s=>new d.Paragraph({text:`${s.label} · ${s.title} ${s.url} · ${s.checkedAt}`,spacing:{after:40,line:260},keepLines:true,widowControl:true})));
  const doc=new d.Document({creator:NAME,lastModifiedBy:NAME,styles:wordStyles(21,330),sections:[{properties:{page:{size:{width:11906,height:16838},margin:{top:850,bottom:850,left:900,right:900}}},headers:{default:wordHeader(d,r.input.office||'부동산 분석 보고서')},footers:{default:new d.Footer({children:[new d.Paragraph({children:[new d.TextRun({text:REPORT_CREDIT+' · ',size:18,color:theme.hex.muted}),new d.TextRun({children:[d.PageNumber.CURRENT],size:18,color:theme.hex.muted})]})]})},children}]});
  const JSZip=require('jszip'),zip=await JSZip.loadAsync(await d.Packer.toBuffer(doc));
  // 관계가 없는 부속 .rels는 필수가 아니므로 제거한다. 비어 있는 부속 관계가
  // 폴더 단위 검증기의 document.xml 관계표를 덮어쓰는 문제도 방지한다.
  for(const name of Object.keys(zip.files).filter(n=>n.endsWith('.rels'))){const xml=await zip.file(name).async('string');if(!/<Relationship\s/.test(xml))zip.remove(name);}
  zip.file('word/document.xml',require('./report-pagination.cjs').balanceDocxXml(await zip.file('word/document.xml').async('string')));
  await fs.writeFile(file,await zip.generateAsync({type:'nodebuffer'}));
}
async function excel(r,file,image){
  r=customer.prepare(r);
  if(r.mode==='comparison')return require('./comparison-report.cjs').excel(r,file,image);
  const Excel=require('exceljs'),wb=new Excel.Workbook();wb.creator=NAME;wb.calcProperties.fullCalcOnLoad=true;
  const summary=wb.addWorksheet('거래 평균'),raw=wb.addWorksheet('비교 거래'),evidence=wb.addWorksheet('출처·조건');
  const scores=wb.addWorksheet('환경·가치 평가');scores.addRows([['평가 항목','평가 결과','확인 근거'],...evaluationRows(r)]);if(r.features.length)scores.addRows([[],['단지 특성'],...r.features.map(x=>['확인 사실',x])]);
  summary.addRow([r.title]);summary.addRow([`계약일 ${r.prices.period.start} ~ ${r.prices.period.end} · 금액 만원, 면적 ㎡ · ${REPORT_CREDIT}`]);summary.addRow([r.prices.condition+' / '+customer.priceLabel(r)]);summary.addRow(['유형','면적','면적 기준','월세 보증금 구간','건수','매매 평균','보증금 평균','월세 평균']);
  raw.addRow(['계약일','유형','건물명','면적','층','매매(만원)','보증금(만원)','월세(만원)','주소','산정 그룹']);
  const groupKey=t=>[t.kind,areaGroup(t.area,r.prices.effectiveArea||r.input),t.areaBasis,t.kind==='monthly'?monthlyBand(t.deposit):''].join('|');
  for(const t of r.prices.rows)raw.addRow([t.date,t.kind,t.building,t.area,t.floor,t.price,t.deposit,t.monthly,t.location,groupKey(t)]);
  const end=raw.rowCount;
  for(const g of r.prices.summaries){const key=[g.kind,g.area,g.areaBasis,g.depositBand].join('|'),row=summary.addRow([KIND[g.kind],average.area(g),g.areaBasis,g.depositBand,g.n,g.price,g.deposit,g.monthly]);
    for(const [col,sourceCol,value]of [[6,'F',g.price],[7,'G',g.deposit],[8,'H',g.monthly]])if(value!==null)row.getCell(col).value={formula:`AVERAGEIF('비교 거래'!$J$2:$J$${end},"${key}",'비교 거래'!$${sourceCol}$2:$${sourceCol}$${end})`,result:value};
  }
  for(const u of r.prices.unavailable)summary.addRow([KIND[u.kind],'자료 없음',u.reason]);
  evidence.addRows([['항목','내용'],['기준일',r.input.asOf],['대상',r.input.target],['조회일',r.dataCheckedAt||r.createdAt],['계약 기간',r.prices.period.start+' ~ '+r.prices.period.end],...customer.sources(r).map(s=>[s.label,s.title+' '+s.url+' · '+s.checkedAt])]);
  for(const sheet of wb.worksheets){sheet.views=[{state:'frozen',ySplit:sheet===summary?4:1}];sheet.columns.forEach(c=>c.width=22);sheet.getRow(sheet===summary?4:1).eachCell(c=>{c.font={bold:true,color:{argb:'FFFFFFFF'},name:'맑은 고딕'};c.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF'+theme.hex.navy}};});sheet.eachRow(row=>{row.height=32;row.eachCell(c=>{c.font={...c.font,name:'맑은 고딕'};c.alignment={vertical:'middle',wrapText:true};if(typeof c.value==='number'||c.value?.formula)c.numFmt='#,##0.0;[Red](#,##0.0);"—"';});});sheet.pageSetup={orientation:'landscape',paperSize:9,fitToPage:true,fitToWidth:1,fitToHeight:0};}
  for(const sheet of wb.worksheets)sheet.headerFooter={oddHeader:'&L&9AI SHERPA',oddFooter:'&L&9'+REPORT_CREDIT+'&R&P / &N',evenFooter:'&L&9'+REPORT_CREDIT+'&R&P / &N'};
  for(const row of [1,2,3])summary.mergeCells(`A${row}:H${row}`);summary.getRow(1).height=36;summary.getRow(2).height=32;summary.getRow(3).height=42;summary.getCell('A2').font={name:'맑은 고딕',size:10,color:{argb:'FF'+theme.hex.muted}};
  [18,32,100].forEach((width,i)=>scores.getColumn(i+1).width=width);
  evidence.getColumn(2).width=100;summary.getColumn(3).width=30;raw.getColumn(9).width=36;
  for(const sheet of wb.worksheets)sheet.eachRow(row=>{let lines=1;row.eachCell(c=>{if(c.isMerged&&c.master.address!==c.address)return;const width=sheet===summary&&row.number<=3?170:(sheet.getColumn(c.col).width||22)-2;const text=String(c.value?.result??c.value??'');lines=Math.max(lines,text.split('\n').reduce((n,s)=>n+Math.max(1,Math.ceil([...s].reduce((v,ch)=>v+(ch.charCodeAt(0)>255?2:1),0)/width)),0));});row.height=Math.min(409,Math.max(28,lines*16+12));});if(r.input.asset==='apartment'){const chart=await radar.addExcel(wb,r);chart.headerFooter={oddFooter:'&L&9'+REPORT_CREDIT+'&R&P / &N'};}await require('./price-trend.cjs').addExcel(wb,r);require('./future-developments.cjs').addExcel(wb,r);await flow.addExcel(wb,r,image);await wb.xlsx.writeFile(file);
}
async function powerpoint(r,file,image,template){
  r=customer.prepare(r);
  if(r.mode==='comparison')return require('./comparison-report.cjs').powerpoint(r,file,image||{},template);
  const fsSync=require('node:fs'),os=require('node:os'),JSZip=require('jszip'),{DOMParser,XMLSerializer}=require('@xmldom/xmldom'),{default:Automizer,modify}=require('pptx-automizer');
  const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'re-helper-ppt-'));
  try{
    // 원본의 마스터·로고·이미지·주황 구분선·배너를 보존한 빈 본문 슬라이드를 만든다.
    const zip=await JSZip.loadAsync(await fs.readFile(template)),slidePath='ppt/slides/slide2.xml',doc=new DOMParser().parseFromString(await zip.file(slidePath).async('string'),'application/xml');
    const coverPath='ppt/slides/slide1.xml',cover=new DOMParser().parseFromString(await zip.file(coverPath).async('string'),'application/xml');
    for(const t of Array.from(cover.getElementsByTagName('a:t'))){const text=t.textContent||'';if(text.includes('TTTM'))t.textContent=r.comparisonMembers?'고객 상담용 통합 비교 보고서':r.demo?'보고서 구성 미리보기':'부동산 분석 보고서';else if(text.includes('OPAL'))t.textContent=r.comparisonMembers?`${r.comparisonMembers.length}개 매물 비교`:(r.input.building||r.input.target);else if(text.includes('2026/09/22'))t.textContent=r.input.asOf.replace(/-/g,'/');}
    zip.file(coverPath,new XMLSerializer().serializeToString(cover));
    const tree=doc.getElementsByTagName('p:spTree')[0];for(const node of [...Array.from(tree.childNodes)]){if(node.nodeType!==1)continue;if(node.getElementsByTagName('a:t').length)tree.removeChild(node);}
    zip.file(slidePath,new XMLSerializer().serializeToString(doc));await fs.writeFile(path.join(tmp,'template.pptx'),await zip.generateAsync({type:'nodebuffer'}));
    const pres=new Automizer({templateDir:tmp,outputDir:path.dirname(file),removeExistingSlides:true,autoImportSlideMasters:true,cleanup:true,verbosity:0}).loadRoot('template.pptx').load('template.pptx','template');
    const makerData=theme.logoDataUri();
    const addMaker=s=>{s.addImage({data:makerData,x:.65,y:7.02,w:.25,h:.25*230/420});s.addText(REPORT_CREDIT,{x:1.02,y:7.0,w:8.43,h:.2,fontFace:'맑은 고딕',fontSize:8,color:theme.hex.muted,margin:0});};
    if(r.input.asset!=='apartment')pres.addSlide('template',1,async slide=>{slide.generate(addMaker);for(const id of await slide.getAllTextElementIds()){slide.modifyElement(id,(el)=>{const ts=el.getElementsByTagName('a:t');for(let i=0;i<ts.length;i++){const text=ts[i].textContent||'';if(text.includes('TTTM'))ts[i].textContent=r.demo?'보고서 구성 미리보기':'부동산 분석 보고서';if(text.includes('OPAL'))ts[i].textContent=r.comparisonMembers?`${r.comparisonMembers.length}개 매물 비교`:(r.input.building||r.input.target);if(text.includes('2026/09/22'))ts[i].textContent=r.input.asOf.replace(/-/g,'/');}}); }});
    let count=r.input.asset==='apartment'?0:1;
    function add(title,draw){const page=++count;pres.addSlide('template',2,slide=>slide.generate(s=>{s.addText(`■ ${page-(r.input.asset==='apartment'?0:1)}. ${title}`,{x:.35,y:.05,w:11.8,h:.45,fontFace:'맑은 고딕',fontSize:23,bold:true,color:theme.hex.navy,margin:0,breakLine:false});s.addText(r.input.target,{x:.6,y:1.02,w:11.8,h:.4,fontFace:'맑은 고딕',fontSize:15,color:theme.hex.navy,margin:0});addMaker(s);s.addText(String(page),{x:11.4,y:7.0,w:.5,h:.2,fontSize:10,fontFace:'맑은 고딕',color:theme.hex.muted});draw(s);}));}
    function textPages(title,items){const paragraphs=(items||[]).flatMap(x=>safeTextChunks(x));for(let i=0;i<paragraphs.length;i+=3)add(i?`${title} (계속)`:title,s=>s.addText(paragraphs.slice(i,i+3).join('\n\n'),{x:.65,y:1.65,w:11.9,h:4.7,fontFace:'맑은 고딕',fontSize:19,margin:0,breakLine:false,paraSpaceAfterPt:14,color:theme.hex.ink,valign:'top'}));}
    add(r.comparisonMembers?'비교 개요':'물건과 비교 조건',s=>{if(r.input.asset==='apartment'){const data=overview.data(r);s.addText(data.sources.map(source=>({text:source.title+' · '+require('./core.cjs').todayKst(new Date(source.checkedAt))+'  ',options:{hyperlink:{url:source.url}}})),{x:.65,y:6.52,w:11.9,h:.42,fontFace:'맑은 고딕',fontSize:7,color:theme.hex.muted,margin:0,breakLine:false});s.addTable([data.headers,...overview.tableRows(r)],{x:.65,y:1.55,w:11.9,fontFace:'맑은 고딕',fontSize:11,border:{pt:.5,color:theme.hex.line},margin:.035,colW:[3.1,...data.properties.map(()=>8.8/data.properties.length)],rowH:.29,autoPage:false});s.addText(average.periodNote(r),{x:.65,y:6.22,w:11.9,h:.24,fontFace:'맑은 고딕',fontSize:8,color:theme.hex.muted,margin:0});}else{const parkingLines=parking.lines(r);if(parkingLines.length)s.addText(parkingLines.join('\n'),{x:.65,y:1.5,w:11.9,h:1.15,fontFace:'맑은 고딕',fontSize:10,margin:0,color:theme.hex.ink,breakLine:false});s.addTable([['대상','전용면적','최근 6개월 거래 요약'],...flow.overviewRows(r)],{x:.65,y:parkingLines.length?2.8:1.7,w:11.9,fontFace:'맑은 고딕',fontSize:14,border:{pt:.5,color:theme.hex.line},margin:.12,colW:[3.4,1.5,7],rowH:.8,autoPage:false});s.addText(average.periodNote(r),{x:.65,y:6.3,w:11.9,h:.4,fontFace:'맑은 고딕',fontSize:10,color:theme.hex.muted});}});
    if(r.input.asset==='apartment'){const chart='data:image/png;base64,'+(await radar.raster(r,{compact:true})).toString('base64');add('환경·가치 육각형 점수표',s=>{s.addText(flow.insights(r).slice(0,2).map(t=>t.split(' (')[0]).join('\n'),{x:.65,y:1.5,w:11.9,h:.72,fontFace:'맑은 고딕',fontSize:13,margin:0,color:theme.hex.ink,breakLine:false});s.addImage({data:chart,x:3.6,y:2.32,w:6.1,h:6.1*radar.COMPACT_HEIGHT/radar.WIDTH});s.addText('각 축 0~100점 · * 부분 평가 · 항목별 평가 범위와 근거는 이어지는 표 참고',{x:.65,y:6.64,w:12,h:.22,fontFace:'맑은 고딕',fontSize:10,color:theme.hex.muted,margin:0});});}
    if(r.comparisonMembers)add('환경·가치 평가 비교',s=>{s.addTable([['평가 항목',...r.comparisonMembers.map(m=>m.key+' · '+(m.input.building||m.input.target))],...require('./comparison-report.cjs').scoreRows({...r,members:r.comparisonMembers})],{x:.65,y:1.8,w:11.9,fontFace:'맑은 고딕',fontSize:12,border:{pt:.5,color:theme.hex.line},margin:.08,colW:[1.4,...r.comparisonMembers.map(()=>10.5/r.comparisonMembers.length)],rowH:.6,autoPage:false});s.addText(customer.SCORE_NOTE,{x:.65,y:6.55,w:11.9,h:.3,fontFace:'맑은 고딕',fontSize:10,color:theme.hex.muted});});
    if(r.input.asset==='apartment')for(let i=0;i<r.scores.length;i+=2)add('환경·가치 평가',s=>s.addTable([['항목','평가 결과','확인 근거'],...evaluationRows(r).slice(i,i+2)],{x:.65,y:1.8,w:11.9,fontFace:'맑은 고딕',fontSize:13,border:{pt:.5,color:theme.hex.line},margin:.12,colW:[1.5,2.6,7.8],rowH:1.5,autoPage:false}));
    const addLiving=kind=>{for(const sec of require('./living-presentation.cjs').sections(r,{kind}))for(let i=0;i<sec.rows.length;i+=4)add(sec.title+(i?' (계속)':''),s=>{s.addTable(require('./living-presentation.cjs').powerpointRows({...sec,rows:sec.rows.slice(i,i+4)}),{x:.65,y:1.65,w:11.9,fontFace:'맑은 고딕',fontSize:11,border:{pt:.5,color:theme.hex.line},margin:.08,colW:sec.widths.map(w=>w*11.9/100),rowH:.72,autoPage:false});s.addText(sec.note,{x:.65,y:6.05,w:11.9,h:.85,fontFace:'맑은 고딕',fontSize:10,color:theme.hex.muted,margin:0});});};
    addLiving('access');
    for(const row of flow.decisionRows(r))add(row[0]+' · 장단점과 선택 기준',s=>s.addTable([['장점과 근거','단점·상대적 아쉬움','선택 기준'],row.slice(1)],{x:.65,y:1.7,w:11.9,fontFace:'맑은 고딕',fontSize:14,border:{pt:.5,color:theme.hex.line},margin:.15,colW:[4,4.2,3.7],rowH:.7,autoPage:false}));
    textPages('장점과 근거',r.strengths);textPages('단지 특성',r.features);
    const mapItems=r.comparisonMembers?[{map:r.map,data:image?.overview},...r.comparisonMembers.map((m,i)=>({map:m.map,data:image?.members?.[i]}))]:[{map:r.map,data:image}];
    for(const item of mapItems)if(item.data)add('입지톡 지도',s=>{const buffer=Buffer.from(item.data.split(',')[1],'base64'),width=buffer.readUInt32BE(16),height=buffer.readUInt32BE(20),scale=Math.min(11.9/width,4.7/height),w=width*scale,h=height*scale;s.addImage({data:item.data,x:.65+(11.9-w)/2,y:1.65+(4.7-h)/2,w,h});s.addText(customer.mapCaption(item.map),{x:.65,y:6.45,w:12,h:.3,fontSize:11,fontFace:'맑은 고딕'});});
    if((r.comparisonMembers?r.comparisonMembers.some(m=>m.input.asset==='apartment'):r.input.asset==='apartment')&&!mapItems.some(item=>item.data))textPages('지도 확인 상태',[r.map?.reason||'입지톡 지도 이미지를 확보하지 못했습니다. 지도 연결과 이미지 저장 상태를 확인하세요.']);
    textPages('확인된 주요 정보',r.highlights);
    for(const sec of flow.sections(r,'facilities'))textPages(sec.heading,[sec.body]);
    addLiving('context');
    const future=require('./future-developments.cjs'),futureRows=future.rows(r);for(let i=0;i<futureRows.length;i+=5)add('2년 이내 예정 사업',s=>{const comparison=!!r.comparisonMembers;s.addTable([future.heads(r),...futureRows.slice(i,i+5)],{x:.65,y:1.8,w:11.9,fontFace:'맑은 고딕',fontSize:12,border:{pt:.5,color:theme.hex.line},margin:.08,colW:comparison?[.6,1,3.3,3,1.8,2.2]:[1.1,3.5,3.1,2,2.2],rowH:.65,autoPage:false});s.addText(future.NOTE,{x:.65,y:6.55,w:11.9,h:.3,fontFace:'맑은 고딕',fontSize:10,color:theme.hex.muted});});if(!futureRows.length)textPages('2년 이내 예정 사업',future.stateRows(r).map(s=>s.join(' · ')));
    if(r.typeCatalog)textPages('선택 타입과 집계 조건',[r.prices.condition,catalogNote(r)]);
    for(const m of r.comparisonMembers||[r])if(m.input.selectedAreas?.length>1)textPages((m.key?m.key+' · ':'')+'분석 전용면적',[m.input.selectedAreas.map(a=>a+'㎡').join(' · ')]);
    const rows=priceRows(r);for(let i=0;i<rows.length;i+=4)add('최근 6개월 거래 평균',s=>{s.addText(`${r.prices.period.start} ~ ${r.prices.period.end} / 평균 금액 억·만원 / ${customer.priceLabel(r)}`,{x:.65,y:1.65,w:12,h:.45,fontFace:'맑은 고딕',fontSize:13});s.addTable([['유형','면적','보증금 구간','건수','평균 또는 사유'],...rows.slice(i,i+4)],{x:.65,y:2.2,w:11.9,fontFace:'맑은 고딕',fontSize:14,border:{pt:.5,color:theme.hex.line},fill:'FFFFFF',color:theme.hex.ink,margin:.1,rowH:.52,colW:[1.2,1.3,2.3,.7,6.4],autoPage:false,autoPageRepeatHeader:true});});
    const trends=require('./price-trend.cjs'),trendBounds=trends.scale(r);for(const m of trends.chartModels(r)){const png='data:image/png;base64,'+(await trends.raster(m,trendBounds)).toString('base64'),size=trends.dimensions(m);add('최근 12개월 실거래 추이',s=>{s.addText(trends.chartTitle(m),{x:.65,y:1.55,w:11.9,h:.35,fontFace:'맑은 고딕',fontSize:15,bold:true});const scale=Math.min(11.9/size.width,4.25/size.height),w=size.width*scale,h=size.height*scale;s.addImage({data:png,x:.65+(11.9-w)/2,y:2.0+(4.25-h)/2,w,h});s.addText(trends.caption(m),{x:.65,y:6.35,w:11.9,h:.38,fontFace:'맑은 고딕',fontSize:7.5,margin:0});s.addText(trends.NOTE,{x:.65,y:6.78,w:11.9,h:.16,fontFace:'맑은 고딕',fontSize:7,margin:0});});}
    textPages('최근 12개월 실거래 추이',trends.unavailable(r));
    for(const sec of flow.sections(r,'trade'))textPages(sec.heading,[sec.body]);
    const sourceRows=customer.sources(r);for(let i=0;i<sourceRows.length;i+=7)add('출처',s=>s.addTable([['평가 항목','대표 출처','조회일'],...sourceRows.slice(i,i+7).map(x=>[x.label,x.title+'\n'+x.url,x.checkedAt])],{x:.65,y:1.8,w:11.9,fontFace:'맑은 고딕',fontSize:11,border:{pt:.5,color:theme.hex.line},margin:.06,colW:[2,7.8,2.1],rowH:.55,autoPage:false}));
    await pres.write(path.basename(file));
  }finally{await fs.rm(tmp,{recursive:true,force:true});}
}
module.exports={html,mapData,word,excel,powerpoint,priceRows,evaluationRows,evaluationNote,wordHeader,wordStyles,safeTextChunks};
