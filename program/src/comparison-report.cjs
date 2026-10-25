'use strict';
const fs=require('node:fs/promises'),path=require('node:path');
const {escapeHtml:e,money,areaSelection,SCORE_ITEMS,displaySources,areaGroup,monthlyBand}=require('./core.cjs');
const {NAME,REPORT_CREDIT}=require('./brand.cjs');
const theme=require('./brand-theme.cjs');
const TYPES={apartment:'아파트',officetel:'오피스텔',villa:'연립·다세대','single-house':'단독·다가구',commercial:'상가'};
const KIND={trade:'매매',jeonse:'전세',monthly:'월세'};
const scoring=require('./scoring.cjs'),scoreText=s=>scoring.result(s);
const radar=require('./radar.cjs'),customer=require('./customer-report.cjs');
const average=require('./price-table.cjs');
const basis=require('./comparison-basis.cjs'),flow=require('./report-flow.cjs'),parking=require('./parking-presentation.cjs');
const scopeNote=customer.SCORE_NOTE;
const label=m=>`${m.key} · ${m.input.building||m.input.target}`;
function overview(r){return r.members.map(m=>[label(m),TYPES[m.input.asset],areaSelection(m.input).label+(m.prices.areaResolution?` → ${m.prices.areaResolution.applied}타입 적용`:''),customer.priceLabel(m),m.input.asOf,m.reusedEvidence?'기존 보고서 재사용':'새 조회']);}
function compactOverview(r){return r.members.map(m=>[label(m),TYPES[m.input.asset],m.prices.areaResolution?average.inputArea(m.input)+` → ${m.prices.areaResolution.applied}타입 적용`:basis.areaLabel(m),customer.priceLabel(m)]);}
function scoreRows(r){r=customer.prepare(r);return customer.AXES.map(name=>[name,...r.members.map(m=>{const s=m.scores.find(s=>s.name===name);return `${customer.scoreLabel(s)}\n${customer.keyEvidence(s,m)}`;})]);}
function strengthRows(r){return r.members.map(m=>[label(m),m.strengths.join('\n')]);}
function featureRows(r){return [...(r.features?.length?[['공통',r.features.join('\n')]]:[]),...r.members.filter(m=>m.features?.length).map(m=>[label(m),m.features.join('\n')])];}
function averageRows(r){return basis.orderRows(r.members.flatMap(m=>average.rows(m).map(row=>[m.key,row[0],row[1]==='—'?'—':basis.profile(m).type!==null?basis.areaLabel(m):row[1],...row.slice(2)])));}
function scoreHtml(r){return `<table class="score-comparison" data-members="${r.members.length}"><colgroup><col style="width:14%">${r.members.map(()=>`<col style="width:${86/r.members.length}%">`).join('')}</colgroup><thead><tr><th>평가 항목</th>${r.members.map((m,i)=>`<th style="color:${radar.STYLES[i].color}">${e(label(m))}</th>`).join('')}</tr></thead><tbody>${customer.AXES.map(name=>`<tr><th scope="row">${e(name)}</th>${r.members.map((m,i)=>{const s=m.scores.find(s=>s.name===name);return `<td data-score-cell data-member="${m.key}" data-axis="${e(name)}" data-score="${s?.score??''}"><strong class="score-number" style="color:${s?.score==null?theme.colors.muted:radar.STYLES[i].color}">${e(customer.scoreLabel(s))}</strong><span class="score-proof">${e(customer.keyEvidence(s,m)).replace(/\n/g,'<br>')}</span></td>`;}).join('')}</tr>`).join('')}</tbody></table>`;}
function wordScoreTable(r,d){
 const widths=[14,...r.members.map(()=>86/r.members.length)],heads=['평가 항목',...r.members.map(label)],rows=scoreRows(r);
 return new d.Table({width:{size:100,type:d.WidthType.PERCENTAGE},layout:d.TableLayoutType.FIXED,columnWidths:widths.map(w=>Math.round(10206*w/100)),rows:[heads,...rows].map((row,i)=>new d.TableRow({tableHeader:i===0,cantSplit:true,children:row.map((text,j)=>new d.TableCell({width:{size:widths[j],type:d.WidthType.PERCENTAGE},shading:i===0||j===0?{fill:theme.hex.soft}:undefined,children:String(text).split('\n').map((t,k,parts)=>new d.Paragraph({keepNext:i===0||k<parts.length-1,keepLines:true,children:[new d.TextRun({text:t,bold:i===0||j===0||k===0,size:i>0&&j>0&&k===0?26:20,color:j>0?radar.STYLES[j-1].color.replace('#',''):theme.hex.ink})],spacing:{after:k===0?40:0,line:250}}))}))}))});
}
async function mapData(r,store){
  const read=async map=>{if(!map?.file)return null;try{return 'data:image/png;base64,'+(await fs.readFile(path.join(store.path(r.id),'figures',path.basename(map.file)))).toString('base64');}catch{return null;}};
  const overview=await read(r.map);return {overview,members:overview?r.members.map(()=>null):await Promise.all(r.members.map(m=>read(m.map)))};
}
function html(r,images={}){
  r=customer.prepare(r);
  const single=require('./report.cjs'),table=(heads,rows,widths=[],className='')=>`<table class="${className}">${widths.length?'<colgroup>'+widths.map(w=>`<col style="width:${w}%">`).join('')+'</colgroup>':''}<thead><tr>${heads.map(x=>`<th>${e(x)}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${row.map(x=>`<td>${e(x).replace(/\n/g,'<br>')}</td>`).join('')}</tr>`).join('')}</tbody></table>`,list=xs=>`<ul>${(xs||[]).map(x=>`<li>${e(x)}</li>`).join('')}</ul>`;
  const figure=(map,data,title)=>data?`<figure><h3>${e(title)}</h3><img src="${data}" alt="${e(title)}"><figcaption>${e(customer.mapCaption(map))} ${map.url?`· <a href="${e(map.url)}">공유 지도</a>`:''}</figcaption></figure>`:'';
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'"><title>${e(r.title)}</title><style>
  *{box-sizing:border-box}body{margin:0;color:${theme.colors.ink};background:white;font:14px/1.7 'Malgun Gothic','맑은 고딕',sans-serif}article{max-width:960px;margin:auto;padding:36px}h1,h2,h3{color:${theme.colors.navy}}h1{font-size:27px;line-height:1.4}h2{font-size:19px;margin:28px 0 12px;break-after:avoid}h3{font-size:16px;break-after:avoid}table{width:100%;table-layout:fixed;border-collapse:collapse;font-size:12px;line-height:1.65}th,td{padding:9px;vertical-align:top;border-bottom:1px solid ${theme.colors.line};overflow-wrap:anywhere}th{background:${theme.colors.paleBlue};text-align:left}thead{display:table-header-group}tr{break-inside:avoid}p,li{overflow-wrap:anywhere}p{white-space:pre-line}figure{margin:20px 0;break-inside:avoid}img{max-width:100%;height:auto}figcaption,.note{font-size:11px;color:${theme.colors.muted}}.notice{padding:12px;background:#fff5e6;color:#70502b}.member{break-before:page}.sources{font-size:11px}a{color:${theme.colors.blueDark};overflow-wrap:anywhere}footer{font-size:11px;border-top:1px solid ${theme.colors.line};margin-top:24px;padding-top:10px}@page{size:A4;margin:15mm 13mm}@media print{article{padding:0;max-width:none}body{print-color-adjust:exact;-webkit-print-color-adjust:exact}}
  .averages td,.averages th{padding:3px 6px;line-height:1.5}.averages th{white-space:nowrap}.averages td{font-variant-numeric:tabular-nums;overflow-wrap:normal}.averages td:nth-child(-n+5){white-space:nowrap}.averages td:last-child{text-align:right}.assessment-overview{break-inside:avoid}.score-block,.score-comparison{break-inside:avoid}.score-comparison th,.score-comparison td{padding:7px 8px;line-height:1.45}.score-comparison th{font-size:12px}.score-comparison th[scope=row]{background:${theme.colors.soft}}.score-number{display:block;font-size:19px;line-height:1.3;margin-bottom:4px;font-variant-numeric:tabular-nums}.score-proof{display:block;font-size:11.5px;line-height:1.5;word-break:keep-all;overflow-wrap:anywhere}.assessment-overview .assessment-radar{max-width:600px;margin:12px auto}.assessment-overview[data-members="3"] .assessment-radar{max-width:560px}.score-comparison[data-members="3"] td,.score-comparison[data-members="3"] th{padding-top:6px;padding-bottom:6px}.assessment-radar{margin:24px 0 20px;break-inside:avoid}.assessment-radar svg{display:block;width:100%;height:auto}.assessment-radar figcaption{margin-top:8px;line-height:1.65}@media print{.assessment-radar{break-inside:avoid}}
.comparison-notes p{margin:3px 0;line-height:1.5}@media print{.assessment-overview .assessment-radar{max-width:480px}.assessment-overview[data-members="3"] .assessment-radar{max-width:440px}.score-comparison th,.score-comparison td{padding:6px 7px}.score-proof{font-size:10.5px}.score-number{font-size:18px}}
${require('./price-trend.cjs').CSS}${average.CSS}${flow.CSS}${parking.CSS}${require('./apartment-overview.cjs').CSS}.averages th,.averages td{padding:3px 6px}${theme.reportCss}${require('./report-pagination.cjs').FLOW_CSS}</style></head><body><article>${theme.reportHeader()}<p class="note">${e(r.input.office||'부동산 분석 보고서')} · 통합 비교 ${r.members.length}개 · 작성 기준일 ${e(r.input.asOf)}</p><h1>${e(r.title)}</h1>
  <section class="report-overview"><h2>비교 대상과 조건</h2>${r.members.every(m=>m.input.asset==='apartment')?require('./apartment-overview.cjs').html(r):parking.html(r)+table(['매물','전용면적','가격 기준','최근 6개월 거래 요약'],flow.overviewRows(r).map((row,i)=>[row[0],row[1],customer.priceLabel(r.members[i]),row[2]]),[25,10,23,42])}<p class="note">${e(average.periodNote(r))}</p>${flow.exactNotes(r).map(text=>`<p class="note">${e(text)}</p>`).join('')}</section>
  <section class="assessment-overview" data-members="${r.members.length}"><div class="assessment-intro"><h2>환경·가치 비교</h2>${flow.insightHtml(r)}${radar.html(r,{compact:true})}</div><div class="score-block"><h3>6개 항목의 근거와 평가 범위</h3>${scoreHtml(r)}<p class="note">${e(scopeNote)}</p><p class="note">${e(customer.parkNote(r))}</p></div></section>
  ${require('./living-presentation.cjs').html(r,{kind:'access'})}
  <h2>단지별 장단점과 선택 기준</h2>${table(['단지','장점과 근거','단점·상대적 아쉬움','선택 기준'],flow.decisionRows(r),[18,28,30,24],'report-decisions')}
  ${r.members.some(m=>m.strengths.length)?'<h3>추가 확인된 장점</h3>'+table(['매물','장점과 근거'],strengthRows(r)):''}
  ${featureRows(r).length?'<h3>확인된 단지 특성</h3>'+table(['매물','확인 사실'],featureRows(r)):''}
  <h2>지도와 주변 시설</h2>
  ${figure(r.map,images.overview,'비교 대상 입지톡 지도')}${r.members.map((m,i)=>figure(m.map,images.members?.[i],label(m)+' · 기존 입지톡 지도')).join('')}
  ${r.members.some((m,i)=>m.input.asset==='apartment'&&!images.overview&&!images.members?.[i])?'<p class="notice">일부 아파트의 입지톡 지도 미첨부 · 해당 매물의 연결과 이미지 확보가 필요합니다.</p>':''}

  ${r.highlights.length?list(r.highlights):''}${flow.sections(r,'facilities').map(s=>'<section><h3>'+e(s.heading)+'</h3><p>'+e(s.body)+'</p></section>').join('')}
  ${require('./living-presentation.cjs').html(r,{kind:'context'})}
  ${require('./future-developments.cjs').html(r)}
  <section class="transaction-summary"><h2>최근 6개월 거래 평균 비교</h2><p class="note">${e(average.periodNote(r))}</p>${table(['매물','유형','전용면적','보증금 구간','건수','평균 금액'],averageRows(r),[6,8,12,22,7,45],'averages')}<p class="note">${e(average.NOTE)}</p><div class="comparison-notes">${basis.notes(r.members).map(t=>`<p class="note">${e(t)}</p>`).join('')}</div>${average.missingNote(r)?`<p class="note">${e(average.missingNote(r))}</p>`:''}</section>

  ${require('./price-trend.cjs').html(r)}${flow.sections(r,'trade').map(s=>'<section><h3>'+e(s.heading)+'</h3><p>'+e(s.body)+'</p></section>').join('')}
  <h2>출처</h2><section class="customer-sources">${customer.sources(r).map(s=>`<p class="source" data-source-item><strong>${e(s.label)}</strong> · <a href="${e(s.url)}">${e(s.title)}</a> · ${e(s.checkedAt)}</p>`).join('')}</section><footer>${e(REPORT_CREDIT)} · ${e(r.input.asOf)} · ${e(r.id)}</footer></article></body></html>`;
}
async function word(r,file,images={}){
  r=customer.prepare(r);
  const d=require('docx'),p=(text,heading)=>new d.Paragraph({text:String(text),heading,keepNext:!!heading,spacing:{after:40,before:heading?160:0}}),head=text=>p(text,d.HeadingLevel.HEADING_1);
  const table=(heads,rows,widths=heads.map(()=>100/heads.length),compact=false)=>new d.Table({width:{size:100,type:d.WidthType.PERCENTAGE},layout:d.TableLayoutType.FIXED,columnWidths:widths.map(w=>Math.round(10206*w/100)),rows:[heads,...rows].map((row,i)=>new d.TableRow({tableHeader:i===0,cantSplit:true,children:row.map((text,j)=>new d.TableCell({width:{size:widths[j],type:d.WidthType.PERCENTAGE},shading:i===0?{fill:theme.hex.paleBlue}:undefined,children:String(text).split('\n').map(t=>compact?new d.Paragraph({text:t,spacing:{after:25,line:240}}):p(t))}))}))});
  const ov=require('./apartment-overview.cjs'),data=ov.data(r),children=[p(r.title,d.HeadingLevel.TITLE),p('작성 기준일 '+r.input.asOf),head('비교 대상과 조건'),...(r.members.every(m=>m.input.asset==='apartment')?[table(data.headers,ov.tableRows(r),[26,...r.members.map(()=>74/r.members.length)],true),...data.notes.map(text=>p(text)),...data.sources.map(s=>p('출처 '+s.title+' · 조회 '+require('./core.cjs').todayKst(new Date(s.checkedAt))+' · '+s.url))]:[...parking.lines(r).map(text=>p(text)),table(['매물','전용면적','가격 기준','최근 6개월 거래 요약'],flow.overviewRows(r).map((row,i)=>[row[0],row[1],customer.priceLabel(r.members[i]),row[2]]),[25,10,23,42])]),...flow.exactNotes(r).map(text=>p(text))];
  children.push(new d.Paragraph({text:'환경·가치 비교',heading:d.HeadingLevel.HEADING_1,keepNext:true}),...flow.insights(r).map(text=>new d.Paragraph({text,keepNext:true,spacing:{after:80,line:260}})),new d.Paragraph({alignment:d.AlignmentType.CENTER,keepNext:true,children:[new d.ImageRun({type:'png',data:await radar.raster(r,{compact:true}),transformation:{width:500,height:500*radar.COMPACT_HEIGHT/radar.WIDTH},altText:{title:'환경·가치 육각형 비교',description:radar.description(r),name:'비교 평가 그래프'}})]}),p('6개 항목의 근거와 평가 범위',d.HeadingLevel.HEADING_2),wordScoreTable(r,d),p(scopeNote),p(customer.parkNote(r)));
  children.push(...require('./living-presentation.cjs').word(r,d,{kind:'access'}));
  children.push(head('단지별 장단점과 선택 기준'),table(['단지','장점과 근거','단점·상대적 아쉬움','선택 기준'],flow.decisionRows(r),[18,28,30,24]));
  if(r.members.some(m=>m.strengths.length))children.push(head('추가 확인된 장점'),table(['매물','장점과 근거'],strengthRows(r)));
  if(featureRows(r).length)children.push(head('확인된 단지 특성'),table(['매물','확인 사실'],featureRows(r)));
  children.push(head('지도와 주변 시설'));
  const addMap=(map,data,title)=>{if(data){const buffer=Buffer.from(data.split(',')[1],'base64'),width=buffer.readUInt32BE(16),height=buffer.readUInt32BE(20),scale=Math.min(590/width,680/height);children.push(head(title),new d.Paragraph({children:[new d.ImageRun({type:'png',data:buffer,transformation:{width:width*scale,height:height*scale}})]}),p(customer.mapCaption(map)));}};
  addMap(r.map,images.overview,'입지톡 비교 지도');r.members.forEach((m,i)=>addMap(m.map,images.members?.[i],label(m)+' 지도'));
  children.push(...r.highlights.map(text=>p(text)),...flow.sections(r,'facilities').flatMap(s=>[head(s.heading),p(s.body)]),...require('./living-presentation.cjs').word(r,d,{kind:'context',headingLevel:d.HeadingLevel.HEADING_1}),...require('./future-developments.cjs').word(r,d));
  children.push(head('최근 6개월 거래 평균 비교'),p(average.periodNote(r)),table(['매물','유형','전용면적','보증금 구간','건수','평균 금액'],averageRows(r),[6,8,12,22,7,45],true),p(average.NOTE),p(basis.areaNote(r.members)),...(average.missingNote(r)?[p(average.missingNote(r))]:[]));
  children.push(new d.Paragraph({children:basis.notes(r.members).slice(1).map((text,i)=>new d.TextRun({text,break:i?1:0})),spacing:{after:100,line:260}}),...await require('./price-trend.cjs').word(r,d));
  for(const section of flow.sections(r,'trade'))children.push(head(section.heading),p(section.body));
  children.push(head('출처'),...customer.sources(r).map(s=>new d.Paragraph({text:`${s.label} · ${s.title} ${s.url} · ${s.checkedAt}`,spacing:{after:40,line:260},keepLines:true,widowControl:true})));
  const single=require('./report.cjs'),doc=new d.Document({creator:NAME,styles:single.wordStyles(20,280),sections:[{properties:{page:{size:{width:11906,height:16838},margin:{top:850,bottom:850,left:850,right:850}}},headers:{default:single.wordHeader(d,r.input.office||'부동산 분석 보고서')},footers:{default:new d.Footer({children:[p(REPORT_CREDIT)]})},children}]});
  const zip=await require('jszip').loadAsync(await d.Packer.toBuffer(doc));for(const name of Object.keys(zip.files).filter(n=>n.endsWith('.rels'))){if(!/<Relationship\s/.test(await zip.file(name).async('string')))zip.remove(name);}zip.file('word/document.xml',require('./report-pagination.cjs').balanceDocxXml(await zip.file('word/document.xml').async('string')));await fs.writeFile(file,await zip.generateAsync({type:'nodebuffer'}));
}
async function excel(r,file,image){
  r=customer.prepare(r);
  const Excel=require('exceljs'),wb=new Excel.Workbook();wb.creator=NAME;wb.calcProperties.fullCalcOnLoad=true;
  const summary=wb.addWorksheet('통합 비교'),prices=wb.addWorksheet('거래 평균'),raw=wb.addWorksheet('비교 거래'),sources=wb.addWorksheet('출처·조건');
  summary.addRows([[r.title],[`작성 기준일 ${r.input.asOf} · ${REPORT_CREDIT}`],[r.highlights.join('\n')],['매물','종류','전용면적','가격 기준'],...compactOverview(r),[],['평가 항목',...r.members.map(label)],...scoreRows(r),[],...(r.members.some(m=>m.strengths.length)?[['매물','장점과 근거'],...strengthRows(r)]:[]),[],...(featureRows(r).length?[['매물','단지 특성'],...featureRows(r)]:[]),...basis.notes(r.members).map(t=>['거래 비교',t]),...r.sections.map(s=>[s.heading,s.body]),['평가 표시',scopeNote]]);
  prices.addRow(['매물','유형','비교 면적','보증금 구간','건수','매매 평균(만원)','보증금 평균(만원)','월세 평균(만원)']);
  raw.addRow(['매물','계약일','유형','건물명','전용면적(㎡)','층','매매(만원)','보증금(만원)','월세(만원)','주소','산정 그룹']);
  const group=(m,t)=>[m.key,t.kind,areaGroup(t.area,m.prices.effectiveArea||m.input),t.areaBasis,t.kind==='monthly'?monthlyBand(t.deposit):''].join('|');
  for(const m of r.members)for(const t of m.prices.rows)raw.addRow([m.key,t.date,t.kind,t.building,t.area,t.floor,t.price,t.deposit,t.monthly,t.location,group(m,t)]);
  const end=Math.max(2,raw.rowCount);
  for(const m of r.members){for(const g of m.prices.summaries){const key=[m.key,g.kind,g.area,g.areaBasis,g.depositBand].join('|'),row=prices.addRow([m.key,KIND[g.kind],basis.areaLabel(m),average.band(g.depositBand),g.n,g.price,g.deposit,g.monthly]);for(const [col,src,value]of [[6,'G',g.price],[7,'H',g.deposit],[8,'I',g.monthly]])if(value!=null)row.getCell(col).value={formula:`AVERAGEIF('비교 거래'!$K$2:$K$${end},"${key}",'비교 거래'!$${src}$2:$${src}$${end})`,result:value};}
    for(const u of m.prices.unavailable)prices.addRow([label(m),KIND[u.kind],'자료 없음',u.reason]);}
  sources.addRows([['항목','내용'],['평가 범위',scopeNote],...r.members.map(m=>[label(m),`${m.prices.period.start} ~ ${m.prices.period.end} · 조회 ${m.dataCheckedAt} · ${m.prices.condition}`]),...customer.sources(r).map(s=>[s.label,s.title+' '+s.url+' · '+s.checkedAt])]);
  const fullWidth=new Set();summary.eachRow(row=>{if(row.number>3&&row.actualCellCount===2&&row.getCell(2).value){summary.mergeCells(`B${row.number}:D${row.number}`);fullWidth.add(row.number);}});
  for(let i=1;i<=3;i++)summary.mergeCells(`A${i}:D${i}`);
  for(const sheet of wb.worksheets){sheet.views=[{state:'frozen',ySplit:sheet===summary?4:1}];sheet.columns.forEach(c=>c.width=25);if(sheet===summary)[22,42,42,42].forEach((w,i)=>sheet.getColumn(i+1).width=w);if(sheet===prices)[8,9,12,23,7,21,21,18].forEach((w,i)=>sheet.getColumn(i+1).width=w);if(sheet===sources)sheet.getColumn(2).width=100;
    sheet.eachRow(row=>{let lines=1;row.eachCell(c=>{c.font={name:'맑은 고딕',size:11};c.alignment={vertical:'top',wrapText:true};if(typeof c.value==='number'||c.value?.formula)c.numFmt='#,##0.0';if(c.isMerged&&c.master.address!==c.address)return;const width=sheet===summary&&row.number<=3?146:sheet===summary&&fullWidth.has(row.number)&&c.col===2?122:sheet.getColumn(c.col).width-2;const text=String(c.value?.result??c.value??'');lines=Math.max(lines,text.split('\n').reduce((total,line)=>total+Math.max(1,Math.ceil([...line].reduce((n,ch)=>n+(ch.charCodeAt(0)>255?2:1),0)/width)),0));});row.height=Math.min(409,Math.max(26,lines*17+12));});
    sheet.getRow(sheet===summary?4:1).eachCell(c=>{c.font={name:'맑은 고딕',bold:true,color:{argb:'FFFFFFFF'}};c.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF'+theme.hex.navy}};});sheet.headerFooter={oddHeader:'&L&9AI SHERPA',oddFooter:'&L'+REPORT_CREDIT+'&R&P / &N'};sheet.pageSetup={orientation:'landscape',paperSize:9,fitToPage:true,fitToWidth:1,fitToHeight:0};}
  summary.getRow(1).height=36;const chart=await radar.addExcel(wb,r);chart.headerFooter={oddFooter:'&L'+REPORT_CREDIT+'&R&P / &N'};await require('./price-trend.cjs').addExcel(wb,r);require('./future-developments.cjs').addExcel(wb,r);await flow.addExcel(wb,r,image);await wb.xlsx.writeFile(file);
}
async function powerpoint(r,file,images,template){
  r=customer.prepare(r);
  const members=r.members,adapted={...r,mode:undefined,comparisonMembers:members,input:{...r.input,target:members.map(m=>`${m.key}: ${m.input.building||m.input.target}`).join(' / '),asset:'apartment'},strengths:members.flatMap(m=>m.strengths.map(s=>label(m)+' · '+s)),limitations:[],features:[...r.features,...members.flatMap(m=>m.features.map(s=>label(m)+' · '+s))],sections:[{heading:'같은 조건의 거래 비교',body:basis.notes(members).join('\n')},...r.sections],scores:[]};
  return require('./report.cjs').powerpoint(adapted,file,images,template);
}
module.exports={html,mapData,word,excel,powerpoint,scoreRows,overview,averageRows};


