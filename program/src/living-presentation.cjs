'use strict';

// One saved-evidence view is shared by every customer export. It never queries or scores.
const {escapeHtml:e,todayKst}=require('./core.cjs');
const members=report=>report.members||report.comparisonMembers||[report];
const number=n=>new Intl.NumberFormat('ko-KR',{maximumFractionDigits:0}).format(n);
const rich=value=>String(value??'').split(/(https?:\/\/[^\s<>"']+)/g).map(part=>/^https?:\/\//.test(part)?`<a href="${e(part)}">출처 열기</a>`:e(part).replace(/\n/g,'<br>')).join('');
const GROUPS=[['hospital','병원 접근성']];
function academySnapshot(){return null;}
function academyRows(report){const ev=report.assessment?.evidence||{},snapshot=require('./living-access.cjs').upgradeSnapshot(ev.livingAccess,{center:ev.center,asOf:report.input?.asOf,identity:ev.identity});return snapshot?categoryRows(snapshot.groups.academy.categories):[];}
function categoryRows(categories){return categories.map(c=>[c.label,c.nearest?.name||'미확인',Number.isFinite(c.nearest?.distanceM)?'직선 '+number(c.nearest.distanceM)+'m'+(['sbiz-csv','seoul-hospital-register'].includes(c.nearest.provider)?'\n'+c.nearest.sourceDate+' 등록자료':''):c.status==='empty'?'반경 '+number(c.radiusM)+'m 내 미확인':'조회 자료 부족',Number.isInteger(c.points)?c.points+'점':'평가 보류']);}
function publicNote(categories){const dates=[...new Set(categories.filter(c=>c.nearest?.provider==='sbiz-csv').map(c=>c.nearest.sourceDate))];return dates.length?' 입시·보습은 소상공인시장진흥공단 '+dates.join('·')+' 기준 상가정보의 입시·교과학원 분류를 반영합니다.':'';}
function accessRows(report,group){
 if(group==='academy')return academyRows(report);
 const categories=report.assessment?.evidence?.livingAccess?.groups?.[group]?.categories||[];
 return categoryRows(categories);
}
function sections(report,{kind}={}){
 const ms=members(report),out=[];
 for(const m of ms){
  if(m.input?.asset!=='apartment')continue;
  const prefix=ms.length>1?(m.key||String.fromCharCode(65+ms.indexOf(m)))+' · '+(m.input.building||m.input.target)+' · ':'';
  if(kind!=='context'){
  for(const [group,label]of GROUPS){
   const rows=accessRows(m,group);if(!rows.length)continue;
   const score=m.scores?.find(s=>s.name===(group==='hospital'?'병원 환경':'학원 환경'));
   out.push({title:prefix+label+' 세부 정보',heads:['분야','확인된 가까운 시설','거리·조회 범위','접근 점수'],widths:[18,40,27,15],rows,note:(group==='hospital'?'배점: 종합병원40%·소아과20%·정형외과20%·치과20%. ':'배점: 입시40%·국어20%·영어20%·수학20%. ')+(Number.isFinite(score?.coverage)?'확인 배점 '+score.coverage+'%. ':'')+(group==='hospital'&&(m.assessment?.evidence?.livingAccess?.groups?.hospital?.categories||[]).some(c=>c.nearest?.provider==='seoul-hospital-register')?'서울시 등록 종별·진료과목 기준(공표 3일 시차). ':'')+'직선 접근성만 평가하며 '+(group==='hospital'?'진료 수준·응급진료·실제 진료과 운영은 별도 확인합니다.':'학습 성과·수업 수준·수강 가능 여부는 별도 확인합니다.')});
  }
  const academy=academyRows(m),ev=m.assessment?.evidence,snapshot=require('./living-access.cjs').upgradeSnapshot(ev?.livingAccess,{center:ev?.center,asOf:m.input.asOf,identity:ev?.identity});
  if(snapshot&&snapshot.groups.academy.categories.some(c=>c.status!=='unavailable'))out.push({title:prefix+'학원 과목별 확인 정보',heads:['분야','확인된 가까운 시설','거리·조회 범위','접근 점수'],widths:[18,40,27,15],rows:academy,note:'배점: 입시40%·국어20%·영어20%·수학20%. 등록 시설 좌표의 직선 접근성이며 실제 통학 동선·운영·수업의 질은 별도 확인합니다.'+publicNote(snapshot.groups.academy.categories)});
  }
  if(kind!=='access'){const nearby=require('./nearby-context.cjs').section(m);if(nearby)out.push({...nearby,title:prefix+nearby.title});}
 }
 return out;
}
function html(report,options){return sections(report,options).map(s=>`<section class="living-details"><h3>${e(s.title)}</h3><table><colgroup>${s.widths.map(width=>`<col style="width:${width}%">`).join('')}</colgroup><thead><tr>${s.heads.map(h=>`<th scope="col">${e(h)}</th>`).join('')}</tr></thead><tbody>${s.rows.map(row=>`<tr>${row.map((cell,i)=>i===0?`<th scope="row">${rich(cell)}</th>`:`<td>${rich(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table><p class="note">${e(s.note)}</p></section>`).join('');}
function addExcel(wb,report){
 for(const [kind,name]of [['access','병원·학원 세부정보'],['context','주변 단지 비교']]){
 const values=sections(report,{kind});if(!values.length)continue;
 const sheet=wb.addWorksheet(name);
 for(const s of values){sheet.addRow([s.title]);sheet.addRow(s.heads);sheet.addRows(s.rows.map(row=>row.map(cell=>/^https?:\/\/\S+$/.test(String(cell))?{text:'출처 열기',hyperlink:cell}:cell)));sheet.addRow(['평가 범위',s.note]);sheet.addRow([]);}
 sheet.columns.forEach((col,i)=>{col.width=[22,38,56,28,22,22][i]||40;});
 sheet.eachRow(row=>{let lines=1;row.eachCell(cell=>{cell.font={name:'맑은 고딕',size:10};cell.alignment={vertical:'top',wrapText:true};const width=sheet.getColumn(cell.col).width-2;lines=Math.max(lines,String(cell.value??'').split('\n').reduce((n,t)=>n+Math.max(1,Math.ceil([...t].reduce((w,ch)=>w+(ch.charCodeAt(0)>255?2:1),0)/width)),0));});row.height=Math.min(409,Math.max(28,lines*16+10));});
 sheet.pageSetup={orientation:'landscape',paperSize:9,fitToPage:true,fitToWidth:1,fitToHeight:0};sheet.headerFooter={oddFooter:'&L'+require('./brand.cjs').REPORT_CREDIT+'&R&P / &N'};
 }
}
function word(report,d,{headingLevel=d.HeadingLevel.HEADING_2,kind}={}){return sections(report,{kind}).flatMap(s=>[
 new d.Paragraph({text:s.title,heading:headingLevel,keepNext:true}),
 new d.Table({width:{size:100,type:d.WidthType.PERCENTAGE},layout:d.TableLayoutType.FIXED,columnWidths:s.widths.map(w=>Math.round(10106*w/100)),rows:[s.heads,...s.rows].map((row,index)=>new d.TableRow({tableHeader:index===0,cantSplit:true,children:row.map((cell,col)=>new d.TableCell({width:{size:s.widths[col],type:d.WidthType.PERCENTAGE},children:String(cell).split('\n').map(text=>new d.Paragraph({children:[/^https?:\/\/\S+$/.test(text)?new d.ExternalHyperlink({link:text,children:[new d.TextRun({text:'출처 열기',style:'Hyperlink',size:18})]}):new d.TextRun({text,font:'맑은 고딕',size:18,bold:index===0})],spacing:{after:55,line:240},keepLines:true}))}))}))}),
 new d.Paragraph({text:s.note,spacing:{after:90},keepLines:true})
 ]);}
function powerpointRows(section){return [section.heads,...section.rows].map(row=>row.map(cell=>/^https?:\/\/\S+$/.test(String(cell))?{text:'출처 열기',options:{hyperlink:{url:cell}}}:cell));}
module.exports={accessRows,academySnapshot,academyRows,sections,html,word,powerpointRows,addExcel};
