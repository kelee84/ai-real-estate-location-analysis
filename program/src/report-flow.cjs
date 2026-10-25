'use strict';
const theme=require('./brand-theme.cjs');
// Derive presentation text from saved assessments; never alter prices or scores.
const customer=require('./customer-report.cjs'),basis=require('./comparison-basis.cjs'),average=require('./price-table.cjs'),{escapeHtml:e,averageMoney}=require('./core.cjs');
const members=r=>r.members||r.comparisonMembers||[r];
const score=(m,name)=>m.scores?.find(s=>s.name===name);
const valid=s=>Number.isInteger(s?.score)&&s.score>=1&&s.score<=100&&s.status!=='withheld'&&(s.status!=='partial'||!!s.scope)&&!!(s.calculation?.length||s.method&&s.sourceIds?.length);
const key=(m,i)=>m.key||String.fromCharCode(65+i);
const scope=s=>s.status==='partial'?customer.displayScope(s):s.name;
function comparable(ms,name){
 const rows=ms.map(m=>score(m,name));if(!rows.every(valid))return false;
 if(new Set(ms.map(m=>m.input?.asOf||'')).size!==1||new Set(ms.map(m=>m.assessment?.version||'')).size!==1)return false;
 const signature=s=>JSON.stringify([s.status==='partial',s.scope||s.name,s.coverage??100,(s.calculation||[]).map(c=>c.indicator).sort()]);
 return new Set(rows.map(signature)).size===1;
}
function comparisons(r){const ms=members(r);return customer.AXES.filter(name=>comparable(ms,name)).map(name=>{const values=ms.map(m=>score(m,name).score);return {name,values,spread:Math.max(...values)-Math.min(...values)};});}
const brief=s=>{const t=String(s||'').replace(/\s+/g,' ').trim();return [...t].length>75?[...t].slice(0,74).join('')+'…':t;};
function insights(report){
 const r=customer.prepare(report),ms=members(r);
 if(ms.length===1){const rows=customer.AXES.map(n=>score(ms[0],n)).filter(valid).sort((a,b)=>b.score-a.score),selected=rows.slice(0,2);const low=rows.at(-1);if(low?.score<=60&&!selected.includes(low))selected.push(low);
  return selected.length?selected.map(s=>`${s.name} ${customer.scoreLabel(s)} · ${brief(customer.keyEvidence(s,ms[0]))}${s.status==='partial'?' ('+customer.displayScope(s)+')':''}`):['환경·가치 항목은 평가 보류입니다. 항목별 근거와 평가 범위를 아래 표에 표시했습니다.'];
 }
 const rows=comparisons(r),byGap=[...rows].sort((a,b)=>b.spread-a.spread),chosen=[];
 for(const names of [customer.AXES.slice(0,4),customer.AXES.slice(4)]){const row=byGap.find(x=>names.includes(x.name)&&x.spread>0);if(row)chosen.push(row);}
 const close=rows.find(x=>x.spread<=3&&!chosen.includes(x));if(close)chosen.push(close);
 if(!chosen.length&&rows.length)chosen.push(rows[0]);
 return chosen.length?chosen.slice(0,3).map(row=>{const s=score(ms[0],row.name),values=ms.map((m,i)=>key(m,i)+' '+customer.scoreLabel(score(m,row.name))).join(' · '),top=ms.filter((m,i)=>row.values[i]===Math.max(...row.values)).map(m=>key(m,ms.indexOf(m))).join('·');return `${s.name}: ${values}. ${row.spread===0?'같은 점수입니다':row.spread<=3?'최대 차이는 '+row.spread+'점입니다':top+'의 평가 점수가 높습니다'}${s.status==='partial'?' ('+scope(s)+')':''}.`;}):['평가 범위·기준일 또는 근거가 달라 점수의 우열을 요약하지 않았습니다. 아래 항목별 결과를 확인해 주세요.'];
}
function prices(m){return (m.input.types?.length?m.input.types:['trade','jeonse','monthly']).map(kind=>{const rows=(m.prices?.summaries||[]).filter(g=>g.kind===kind),label={trade:'매매',jeonse:'전세',monthly:'월세'}[kind];if(!rows.length)return label+' 자료 없음';if(rows.length>1)return label+' '+rows.length+'개 '+(kind==='monthly'?'보증금 구간':'면적 조건')+'별 집계 · 상세표 참조';const g=rows[0];return label+' '+(kind==='monthly'?'보증 '+averageMoney(g.deposit)+' / 월 '+averageMoney(g.monthly):averageMoney(kind==='trade'?g.price:g.deposit))+' ('+g.n+'건)';}).join(' · ');}
function overviewRows(r){return members(r).map((m,i)=>[(members(r).length>1?key(m,i)+' · ':'')+(m.input.building||m.input.target),m.prices?.areaResolution?average.inputArea(m.input)+' → '+m.prices.areaResolution.applied+'타입 적용':basis.areaLabel(m),prices(m)]);}
// A data gap is not a property disadvantage. Use only saved, source-linked
// distance measurements and the program's existing access bands; never copy
// AI-written limitations, missing fields, or score/coverage differences here.
function measuredAccess(m){
 const ev=m.assessment?.evidence||{},placeRows=ev.places||[],shopping=ev.shopping||{},living=ev.livingAccess?.groups||{},out=[],access=require('./living-access.cjs');
 if(!access.point(ev.center))return out;
 const sourced=p=>{const source=(ev.sources||[]).find(s=>s.id===p.sourceId);if(!source)return false;try{const url=new URL(source.url);return url.protocol==='https:'&&!!url.hostname&&!url.username&&!url.password&&(!p.url||p.url===source.url);}catch{return false;}};
 const standard=d=>require('./living-access.cjs').BANDS.find(([limit])=>d<=limit)?.[1]??35;
 for(const s of customer.AXES.map(name=>score(m,name)).filter(valid))for(const c of s.calculation||[]){
  if(!Number.isFinite(c.value)||c.value<0||c.unit!=='m (직선)'||!Number.isInteger(c.points)||!c.sourceId||!s.sourceIds?.includes(c.sourceId)||c.status&&c.status!=='observed')continue;
  let candidates=[],expected,label=String(c.indicator||'').replace(/ 접근$/,'');
  if(s.name==='교통 환경'&&c.indicator==='등록 역 접근'){candidates=placeRows.filter(p=>p.category==='subway');label='지하철 접근';expected=standard(c.value);}
  else if(s.name==='교육 환경'&&/^(공식 통학구역 연계 초등학교|인근 초등학교|인근 중학교|인근 고등학교) 접근$/.test(c.indicator)){const category=/초등학교/.test(c.indicator)?'school_elementary':/중학교/.test(c.indicator)?'school_middle':'school_high';candidates=placeRows.filter(p=>p.category===category);expected=standard(c.value);}
  else if(s.name==='상권 환경'&&['대형마트 접근','대형 쇼핑시설 접근','일상 슈퍼마켓 접근'].includes(c.indicator)){const group=c.indicator==='대형마트 접근'?shopping.largeMart:c.indicator==='대형 쇼핑시설 접근'?shopping.shoppingMall:null,category=c.indicator==='대형마트 접근'?'mart_large':c.indicator==='대형 쇼핑시설 접근'?'shopping_large':'supermarket';candidates=[...(group?.places||[]),group?.nearest,...placeRows.filter(p=>p.category===category)].filter(Boolean);expected=category==='supermarket'?standard(c.value):require('./shopping.cjs').points(c.value);}
  else if(s.name==='병원 환경'||s.name==='학원 환경'){const group=living[s.name==='병원 환경'?'hospital':'academy'],category=group?.categories?.find(p=>p.label===c.indicator&&p.status==='observed');if(!category)continue;candidates=[category.nearest];expected=require('./living-access.cjs').points(category.key,c.value);}
  else continue;
  if(c.points!==expected)continue;
  const p=candidates.find(p=>p?.sourceId===c.sourceId&&p.name&&access.point(p)&&Number.isFinite(p.distanceM)&&Math.abs(p.distanceM-c.value)<=1&&Math.abs(access.distance(ev.center,p)-c.value)<=2&&sourced(p)&&(!c.facility||p.name===c.facility));
  if(!p)continue;
  out.push({axis:s.name,indicator:c.indicator,unit:c.unit,label,name:p.name,distance:c.value,points:c.points,weight:Number.isFinite(c.weight)?c.weight:0});
 }
 return out;
}
function objectiveWeaknesses(ms,index){
 const m=ms[index],measurements=measuredAccess(m),fmt=n=>new Intl.NumberFormat('ko-KR',{maximumFractionDigits:1}).format(n),rows=[];
 for(const fact of measurements){
  let peer=null;
  if(ms.length>1&&comparable(ms,fact.axis)){
   const peers=ms.flatMap((other,i)=>i===index?[]:measuredAccess(other).filter(p=>p.axis===fact.axis&&p.indicator===fact.indicator&&p.unit===fact.unit&&p.points>fact.points&&p.distance<fact.distance).map(p=>({...p,index:i})));
   peer=peers.sort((a,b)=>a.distance-b.distance)[0];
  }
  // The first two fixed access bands are 95/85. A lower observed band is
  // a concrete access trade-off; an unknown/empty result never qualifies.
  if(fact.points>70&&!peer)continue;
  const comparison=peer?' ('+key(ms[peer.index],peer.index)+' 조회 시설 '+fmt(peer.distance)+'m보다 '+fmt(fact.distance-peer.distance)+'m 멂)':'';
  rows.push({...fact,relative:!!peer,text:fact.label+' · 조회된 '+fact.name+' 직선 '+fmt(fact.distance)+'m'+comparison});
 }
 rows.sort((a,b)=>Number(b.relative)-Number(a.relative)||a.points-b.points||b.weight-a.weight||customer.AXES.indexOf(a.axis)-customer.AXES.indexOf(b.axis));
 const chosen=[],axes=new Set();for(const row of rows){if(axes.has(row.axis))continue;axes.add(row.axis);chosen.push(row.text);if(chosen.length===2)break;}
 return chosen.join('\n')||'—';
}
function decisionRows(report){
 const r=customer.prepare(report),ms=members(r),rows=ms.length>1?comparisons(r):[];
 return ms.map((m,i)=>{const rated=customer.AXES.map(n=>score(m,n)).filter(valid),better=rows.filter(x=>x.spread>0&&x.values[i]===Math.max(...x.values)).sort((a,b)=>b.spread-a.spread);
  const strong=better.length?better.slice(0,2).map(x=>score(m,x.name)):rated.filter(s=>s.score>=61).sort((a,b)=>b.score-a.score).slice(0,2);
  const describe=s=>s.name+' '+customer.scoreLabel(s)+' · '+brief(customer.keyEvidence(s,m));
  const strengths=strong.map(describe).join('\n')||customer.factList(m.strengths).slice(0,2).join('\n')||'평가 가능한 강점 근거 없음';
  const weaknesses=objectiveWeaknesses(ms,i);
  const choice=strong.length?scope(strong[0])+' 중심으로 검토.': '평가 근거 확보 후 조건별 선택 가능.';
  return [(ms.length>1?key(m,i)+' · ':'')+(m.input.building||m.input.target),strengths,weaknesses,choice];
 });
}
function insightHtml(r){return `<div class="assessment-takeaways" data-role="assessment-takeaways" aria-label="${members(r).length>1?'핵심 차이':'핵심 특징'}">${insights(r).map(t=>`<p>${e(t)}</p>`).join('')}</div>`;}
const CSS=`.assessment-overview{break-inside:auto}.assessment-takeaways{margin:12px 0 16px;padding:12px 16px;background:${theme.colors.soft};break-inside:avoid;line-height:1.6}.assessment-takeaways p{margin:3px 0;font-size:13px;color:${theme.colors.ink}}.report-overview{break-inside:avoid}.report-overview td{font-size:12px}.assessment-radar{max-width:640px;margin:12px auto 18px}.report-decisions td{font-size:12px;line-height:1.6}@media print{.assessment-takeaways p{font-size:11.5px}.report-decisions td{font-size:11px}.assessment-radar{max-width:500px}}`;
// Public Naver evidence remains available to collection and basic-information
// tables, but its standalone living-information section is not customer output.
function sections(r,kind){return (r.sections||[]).filter(s=>!/네이버에서\s*확인한\s*생활정보/.test(s.heading)&&/가격|거래|실거래|추이/.test(s.heading)===(kind==='trade'));}
function title(r){return String(r.title||'').replace(/\d+(?:\.\d+)?\s*(?:㎡|m²)(?:\s*·\s*\d+(?:\.\d+)?\s*(?:㎡|m²))+/g,text=>{const values=text.match(/\d+(?:\.\d+)?/g)?.map(Number)||[];return r.input.selectedAreas?.length===values.length&&values.every(n=>r.input.selectedAreas.includes(n))?basis.areaLabel(r):text;});}
function exactNotes(r){return members(r).flatMap((m,i)=>{const values=m.input.selectedAreas?.length?m.input.selectedAreas:m.input.areaMode==='exact'?[m.input.area]:[];return values.length?[(members(r).length>1?key(m,i)+' · ':'')+'선택 전용면적 '+values.map(n=>n+'㎡').join(' · ')]:[];});}
async function addExcel(wb,r,image){
 require('./living-presentation.cjs').addExcel(wb,r);
 const {REPORT_CREDIT}=require('./brand.cjs'),ms=members(r),existing=wb.getWorksheet('통합 비교');
 // ExcelJS spliceRows does not remove all existing rows when deleting a whole sheet.
 // No calculation points at the presentation summary, so replace that sheet cleanly.
 if(existing)wb.removeWorksheet(existing.id);
 const summary=wb.addWorksheet(ms.length>1?'통합 비교':'분석 개요'),apartment=ms.every(m=>m.input.asset==='apartment'),ov=require('./apartment-overview.cjs'),model=apartment?ov.data(r):null,summaryColumns=apartment?ms.length+1:3,lastColumn=String.fromCharCode(64+summaryColumns);
 summary.addRows([[title(r)],['기준일 '+r.input.asOf+' · '+REPORT_CREDIT],...(apartment?[model.headers,...ov.tableRows(r)]:[['대상','전용면적','최근 6개월 거래 요약'],...overviewRows(r)])]);
 if(apartment){for(const text of model.notes){const row=summary.addRow(['산정 기준',text]);if(summaryColumns>2)summary.mergeCells('B'+row.number+':'+lastColumn+row.number);}for(const source of model.sources){const row=summary.addRow(['출처',source.title+' · 조회 '+require('./core.cjs').todayKst(new Date(source.checkedAt))+' · '+source.url]);if(summaryColumns>2)summary.mergeCells('B'+row.number+':'+lastColumn+row.number);}}
 else for(const row of require('./parking-presentation.cjs').rows(r))summary.addRow([row.name+' 주차','',row.text+'\n'+row.sourceText]);
 for(const note of exactNotes(r)){const row=summary.addRow(apartment?['선택 면적',note]:['선택 면적','',note]);if(apartment&&summaryColumns>2)summary.mergeCells('B'+row.number+':'+lastColumn+row.number);}
 const assessment=ms.length>1?wb.addWorksheet('환경·가치 평가'):null;
 if(assessment){assessment.addRows([['평가 항목',...ms.map((m,i)=>key(m,i)+' · '+(m.input.building||m.input.target))],...customer.AXES.map(name=>[name,...ms.map(m=>customer.scoreLabel(score(m,name))+'\n'+customer.keyEvidence(score(m,name),m))])]);const seen=new Set();for(const [label,facts]of [['공통',r.features||[]],...ms.map((m,i)=>[key(m,i),m.features||[]])])for(const fact of facts)if(!seen.has(fact)){seen.add(fact);assessment.addRow([label+' · 확인된 단지 특성',fact]);}}
 const choices=wb.addWorksheet('장단점·선택 기준');choices.addRows([['단지','장점과 근거','단점·상대적 아쉬움','선택 기준'],...decisionRows(r)]);
 for(const m of ms)if(m.strengths?.length)choices.addRows([[],[(m.key?m.key+' · ':'')+'추가 확인된 장점',m.strengths.join('\n')]]);
 const maps=wb.addWorksheet('지도·주변 시설');maps.addRows([['지도·주변 시설'],...(r.highlights||[]).map(t=>['확인된 주요 정보',t]),...sections(r,'facilities').map(s=>[s.heading,s.body])]);
 const images=ms.length>1?[{map:r.map,data:image?.overview},...ms.map((m,i)=>({map:m.map,data:image?.members?.[i]}))]:[{map:r.map,data:image}];let start=Math.max(4,maps.rowCount+2);
 for(const item of images)if(item.data){const buffer=Buffer.from(item.data.split(',')[1],'base64'),width=buffer.readUInt32BE(16),height=buffer.readUInt32BE(20),scale=Math.min(850/width,580/height),id=wb.addImage({buffer,extension:'png'});maps.getRow(start).values=[customer.mapCaption(item.map)];maps.addImage(id,{tl:{col:0,row:start},ext:{width:width*scale,height:height*scale}});for(let i=start+1;i<=start+35;i++)maps.getRow(i).height=14;start+=38;}
 if(!images.some(x=>x.data))maps.addRow(['지도 미첨부',r.map?.reason||'지도 이미지가 저장되어 있지 않습니다.']);
 for(const sheet of [summary,choices,maps,assessment].filter(Boolean)){sheet.columns.forEach(c=>c.width=36);if(sheet===summary)[34,16,110].forEach((w,i)=>sheet.getColumn(i+1).width=w);if(sheet===choices)[30,56,56,45].forEach((w,i)=>sheet.getColumn(i+1).width=w);if(sheet===assessment)for(let i=2;i<=ms.length+1;i++)sheet.getColumn(i).width=55;if(sheet===maps)sheet.getColumn(2).width=110;sheet.eachRow(row=>{let lines=1;row.eachCell(c=>{c.font={name:'맑은 고딕',size:11,color:{argb:'FF'+theme.hex.ink}};c.alignment={vertical:'top',wrapText:true};if(c.isMerged&&c.master.address!==c.address)return;const text=String(c.value||''),width=(sheet===summary&&row.number<=2?140:sheet.getColumn(c.col).width)-3;lines=Math.max(lines,text.split('\n').reduce((n,t)=>n+Math.max(1,Math.ceil([...t].reduce((n,ch)=>n+(ch.charCodeAt(0)>255?2:1),0)/width)),0));});if(row.actualCellCount)row.height=Math.min(409,Math.max(28,lines*17+12));});sheet.headerFooter={oddFooter:'&L'+REPORT_CREDIT+'&R&P / &N'};sheet.pageSetup={orientation:'landscape',paperSize:9,fitToPage:true,fitToWidth:1,fitToHeight:0};}
 const trade=wb.getWorksheet('거래 평균');if(trade){trade.addRow([]);for(const values of [...(ms.length>1?basis.notes(ms).map(t=>['거래 비교',t]):[]),...sections(r,'trade').map(s=>[s.heading,s.body])]){const row=trade.addRow(values);trade.mergeCells('B'+row.number+':H'+row.number);row.height=Math.max(35,Math.ceil([...values[1]].length/75)*17+12);row.eachCell(c=>{c.font={name:'맑은 고딕',size:11};c.alignment={wrapText:true,vertical:'top'};});}}
 maps.pageSetup.printArea='A1:B'+Math.max(maps.rowCount,start-1);
 if(images.filter(x=>x.data).length<=1)maps.pageSetup.fitToHeight=1;
 summary.mergeCells('A1:'+lastColumn+'1');summary.mergeCells('A2:'+lastColumn+'2');summary.getRow(1).height=36;summary.pageSetup.printArea='A1:'+lastColumn+summary.rowCount;summary.pageSetup.fitToHeight=1;summary.getColumn(1).width=34;if(apartment)for(let i=2;i<=summaryColumns;i++)summary.getColumn(i).width=ms.length===1?100:52;else {summary.getColumn(2).width=16;summary.getColumn(3).width=110;}
 summary.eachRow(row=>{let lines=1;row.eachCell(c=>{if(c.isMerged&&c.master.address!==c.address)return;const width=c.isMerged&&c.col===2?(summaryColumns-1)*52:sheetWidth(c.col);lines=Math.max(lines,String(c.value||'').split('\n').reduce((n,text)=>n+Math.max(1,Math.ceil([...text].reduce((n,ch)=>n+(ch.charCodeAt(0)>255?2:1),0)/(width-3))),0));});row.height=Math.min(409,Math.max(28,lines*17+12));});
 function sheetWidth(col){return summary.getColumn(col).width||34;}
 const priority=name=>name==='분석 개요'||name==='통합 비교'?0:name==='육각형 평가 그래프'?1:name==='환경·가치 평가'?2:name==='병원·학원 세부정보'?2.5:name==='장단점·선택 기준'?3:name==='지도·주변 시설'?4:name==='주변 단지 비교'?4.5:/예정/.test(name)?5:name==='거래 평균'?6:/원거래/.test(name)?8:/추이/.test(name)?7:name==='비교 거래'?8:9;
 [...wb.worksheets].sort((a,b)=>priority(a.name)-priority(b.name)).forEach((s,i)=>s.orderNo=i+1);
}
module.exports={members,comparable,comparisons,insights,overviewRows,decisionRows,insightHtml,sections,addExcel,title,exactNotes,CSS};
