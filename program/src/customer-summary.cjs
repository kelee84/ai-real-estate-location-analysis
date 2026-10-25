'use strict';

// This is a saved-evidence view: no model call, lookup, scoring or price estimation.
const {escapeHtml:e,averageMoney}=require('./core.cjs');
const customer=require('./customer-report.cjs'),flow=require('./report-flow.cjs'),basis=require('./comparison-basis.cjs'),average=require('./price-table.cjs');
const {publicConsultation}=require('./consultation.cjs'),copy=require('./customer-consultation.cjs');
const {REPORT_CREDIT}=require('./brand.cjs');
const theme=require('./brand-theme.cjs'),parking=require('./parking-presentation.cjs');
const AXES=customer.AXES;
const KIND={trade:'매매',jeonse:'전세',monthly:'월세'};
const list=xs=>[...new Set(xs.filter(Boolean))];
const safeUrl=url=>{try{const u=new URL(url);return ['https:','http:'].includes(u.protocol)?u.href:'';}catch{return '';}};
const safeImage=data=>typeof data==='string'&&/^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/.test(data)?data:'';
function score(m,name){const s=m.scores?.find(s=>s.name===name);return s&&flow.comparable([m],name)?s:{name,score:null,status:'withheld',reason:s?.reason||s?.needed||'평가 근거가 저장되어 있지 않습니다.'};}
function priceLines(m){
  const kinds=m.input?.types?.length?m.input.types:Object.keys(KIND);
  return kinds.flatMap(kind=>{
    const groups=(m.prices?.summaries||[]).filter(g=>g.kind===kind);
    if(!groups.length){const missing=m.prices?.unavailable?.find(x=>x.kind===kind);return [KIND[kind]+' 자료 없음'+(missing?.reason?' · '+missing.reason:'')];}
    return groups.map(g=>KIND[kind]+' '+(kind==='monthly'?'보증금 '+averageMoney(g.deposit)+' / 월 '+averageMoney(g.monthly):averageMoney(kind==='trade'?g.price:g.deposit))+' · '+g.n+'건'+(groups.length>1?' · '+average.area(g):'')+(kind==='monthly'&&g.depositBand?' · 보증금 '+g.depositBand:''));
  });
}
function selection(r,preferences){
  const ms=flow.members(r);
  if(!preferences.length)return flow.insights(r).slice(0,2);
  return preferences.map(name=>{
    if(!flow.comparable(ms,name))return name+'은 평가 범위 또는 근거가 달라 우열 판단을 보류합니다.';
    const results=ms.map(m=>score(m,name)),scope=results[0].status==='partial'?' · '+results[0].scope+' 부분 평가':'';
    if(ms.length===1)return name+' '+customer.scoreLabel(results[0])+' · '+customer.keyEvidence(results[0],ms[0])+scope;
    const max=Math.max(...results.map(s=>s.score)),top=ms.filter((m,i)=>results[i].score===max).map(m=>m.key).join('·');
    return name+': '+ms.map((m,i)=>m.key+' '+customer.scoreLabel(results[i])).join(' / ')+'. '+(results.every(s=>s.score===max)?'동일 점수입니다.':top+'의 평가 점수가 높습니다.')+scope;
  });
}
function model(report){
  const r=customer.prepare(report),data=publicConsultation(report),rawMembers=flow.members(report),preparedMembers=flow.members(r);
  const ms=preparedMembers.map((m,i)=>({...m,key:m.key||String.fromCharCode(65+i)}));
  const view={...r,...(ms.length>1?{members:ms}:{scores:ms[0].scores})},decisions=flow.decisionRows(r);
  const properties=ms.map((m,i)=>{
    const note=data.properties.find(p=>p.key===m.key)||{},period=m.prices?.period;
    const cautions=list([...(m.limitations||[]),...(m.checks||[])]);
    return {key:m.key,name:m.input.building||m.input.target,area:basis.areaLabel(m),period:period?.start&&period?.end?period.start+' ~ '+period.end:'분석 기간 미확인',checkedAt:m.dataCheckedAt||m.createdAt||'조회일 미기록',condition:m.prices?.condition||'비교 조건 미확인',prices:priceLines(m),strengths:decisions[i]?.[1]||'강점 근거 미확인',weaknesses:decisions[i]?.[2]||'평가 가능한 지표가 없습니다.',cautions,note,scores:AXES.map(name=>{const s=score(m,name);return {name,label:customer.scoreLabel(s),evidence:customer.keyEvidence(s,m),scope:s.status==='partial'?customer.displayScope(s):''};})};
  });
  return {title:ms.length>1?'우리 조건에 맞는 매물 비교':'우리 조건에 맞는 매물 살펴보기',report:r,data,properties,selection:selection(view,data.customer.priorities),sources:customer.sources(r),demo:report.demo||rawMembers.some(m=>m.demo)};
}
function text(report){
  const m=model(report),lines=[m.title,'기준일 '+(report.input?.asOf||'미확인'),...parking.lines(m.report)];
  if(m.demo)lines.push('사용 예시 · 실제 매물의 분석 결과가 아닙니다.');
  lines.push(copy.conditionText(m.data.customer)||'고객 조건 미입력',...m.selection);
  for(const p of m.properties){lines.push('',p.key+' · '+p.name+' / '+p.area,'최근 6개월 개별 계약 산술평균 · '+p.period,...p.prices,'장점 · '+p.strengths,'단점·평가 한계 · '+p.weaknesses,...p.scores.map(s=>s.name+' '+s.label+' · '+s.evidence),...p.cautions.map(t=>'확인할 사항 · '+t));if(p.note.cautions)lines.push('중개사 입력 주의사항 · '+p.note.cautions);if(p.note.publicNote)lines.push('고객 전달 메모 · '+p.note.publicNote);if(p.note.visitedAt)lines.push('현장 확인일 · '+p.note.visitedAt);}
  if(!rHasMap(report))lines.push('지도 미첨부 · 상세 보고서의 지도 확보 상태를 확인해 주세요.');
  lines.push('','거래 평균은 현재 호가·확정 거래 가능 가격이 아닙니다. * 부분 평가의 범위·상세 거래·자료 출처는 첨부 보고서를 확인해 주세요.',copy.officeText(m.data.officeProfile));
  return lines.filter(line=>line!==undefined&&line!==null).join('\n').trim();
}
function rHasMap(report){return !!report.map?.file||(report.members||report.comparisonMembers||[]).every(m=>!!m.map?.file)&&!!(report.members||report.comparisonMembers)?.length;}
function html(report,image){
  const m=model(report),r=m.report,office=m.data.officeProfile,condition=copy.conditionText(m.data.customer),br=value=>e(value).replace(/\n/g,'<br>');
  const table=(heads,rows,className='')=>`<table class="${className}"><thead><tr>${heads.map(h=>`<th scope="col">${e(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${row.map((cell,i)=>i===0?`<th scope="row">${br(cell)}</th>`:`<td>${br(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  const figures=m.properties.length>1?(image?.overview?[{map:r.map,data:image.overview,title:'비교 대상 입지톡 지도'}]:m.properties.map((p,i)=>({map:flow.members(r)[i].map,data:image?.members?.[i],title:p.key+' · '+p.name+' 지도'}))):[{map:r.map,data:image,title:m.properties[0].name+' 지도'}];
  const mapHtml=figures.map(f=>safeImage(f.data)?`<figure><img src="${e(safeImage(f.data))}" alt="${e(f.title)}"><figcaption>${e(f.title)} · ${e(customer.mapCaption(f.map))}${safeUrl(f.map?.url)?` · <a href="${e(safeUrl(f.map.url))}">공유 지도</a>`:''}</figcaption></figure>`:`<p class="notice">${e(f.title)} 미첨부 · ${e(f.map?.reason||'지도 이미지가 저장되어 있지 않습니다.')}</p>`).join('');
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'"><title>${e(m.title)}</title><style>
*{box-sizing:border-box}body{margin:0;background:${theme.colors.cream};color:${theme.colors.ink};font:15px/1.65 'Malgun Gothic','맑은 고딕',sans-serif}article{max-width:900px;margin:auto;padding:32px 38px;background:#fff}h1,h2,h3{color:${theme.colors.navy}}h1{font-size:28px;line-height:1.3;margin:0 0 8px;letter-spacing:-.02em}h2{font-size:18px;margin:22px 0 8px;break-after:avoid}h3{font-size:16px;margin:0 0 8px;break-after:avoid}p{margin:7px 0;overflow-wrap:anywhere;white-space:pre-line}.meta,.note,figcaption{font-size:12px;color:${theme.colors.muted}}.conditions{margin:16px 0 12px;font-weight:700}.choice{padding:12px 16px;background:${theme.colors.paleBlue}}.choice p{margin:2px 0}.property{border-top:1px solid ${theme.colors.line};padding:12px 0;break-inside:auto}.property-head{display:flex;gap:12px;align-items:baseline;flex-wrap:wrap}.property-head h3{margin:0}.price{font-weight:700}.trade-note{margin-bottom:10px}.pros-cons{display:grid;grid-template-columns:1fr 1fr;gap:18px}.pros-cons p{margin:3px 0}.label{font-size:12px;color:${theme.colors.muted}}.memo{margin-top:8px;padding-top:8px;border-top:1px solid ${theme.colors.line};white-space:pre-line;overflow-wrap:anywhere}.memo p{margin:4px 0}.notice{color:#70502b;background:#fff5e6;padding:10px 12px}table{width:100%;border-collapse:collapse;table-layout:fixed;font-size:12px;line-height:1.55}th,td{padding:7px;border-bottom:1px solid ${theme.colors.line};vertical-align:top;overflow-wrap:anywhere;white-space:pre-line}thead th{background:${theme.colors.paleBlue};text-align:left}tbody th{text-align:left;font-weight:500;width:17%}tr{break-inside:avoid}thead{display:table-header-group}.scores th:first-child{width:18%}figure{margin:12px 0;break-inside:avoid}figure img{display:block;max-width:100%;width:100%;height:auto;border:1px solid ${theme.colors.line}}figcaption{margin-top:5px}a{color:${theme.colors.blueDark};text-underline-offset:3px;overflow-wrap:anywhere}a:focus-visible{outline:2px solid ${theme.colors.focus};outline-offset:3px}.sources p{font-size:11px;margin:3px 0}.office{display:flex;align-items:center;gap:14px;border-top:1px solid ${theme.colors.line};margin-top:20px;padding-top:14px;break-inside:avoid}.office img{max-width:110px;max-height:60px;object-fit:contain}.office p{margin:2px 0}.office strong{font-size:16px}footer{font-size:11px;color:${theme.colors.muted};margin-top:14px}::selection{background:${theme.colors.selected};color:${theme.colors.ink}}@page{size:A4;margin:13mm 13mm}@media(max-width:600px){article{padding:24px 18px}h1{font-size:25px}.pros-cons{grid-template-columns:1fr;gap:8px}table{font-size:11px}th,td{padding:6px 4px}.scores th:first-child{width:21%}.office{align-items:flex-start}}@media print{body{background:#fff;font-size:11px;line-height:1.5;print-color-adjust:exact;-webkit-print-color-adjust:exact}article{padding:0;max-width:none}h1{font-size:23px}h2{font-size:16px;margin-top:16px}h3{font-size:14px}.meta,.note,figcaption,.label{font-size:9px}.conditions{margin:10px 0}.choice{padding:9px 12px}.property{padding:9px 0}.scores{font-size:9px}.scores th,.scores td{padding:5px 6px}.sources p{font-size:8px}.office strong{font-size:13px}footer{font-size:8px}figure img{max-height:100mm;object-fit:contain}.summary-map{break-before:page}}
${parking.CSS}${theme.reportCss}</style></head><body><article>${theme.reportHeader()}${m.demo?'<p class="notice">사용 예시 · 실제 매물의 분석 결과가 아닙니다.</p>':''}<h1>${e(m.title)}</h1><p class="meta">${e(office.name||'부동산 상담 자료')} · 기준일 ${e(r.input?.asOf||'미확인')}</p>${parking.html(r)}<p class="conditions">${e(condition||'고객 조건 미입력 · 대상 매물의 확인된 정보를 정리했습니다.')}</p><section class="choice" aria-label="고객 조건에 따른 선택 기준">${m.selection.map(t=>`<p>${br(t)}</p>`).join('')}</section>
<h2>대상과 최근 6개월 거래</h2>${m.properties.map(p=>`<section class="property"><div class="property-head"><h3>${e(p.key+' · '+p.name)}</h3><span class="note">전용면적 ${e(p.area)}</span></div>${p.prices.map(t=>`<p class="price">${e(t)}</p>`).join('')}<p class="note trade-note">개별 계약 산술평균 · ${e(p.period)}<br>${e(p.condition)} · 자료 조회 ${e(String(p.checkedAt).slice(0,10))}</p><div class="pros-cons"><div><span class="label">장점과 근거</span><p>${br(p.strengths)}</p></div><div><span class="label">단점·평가 한계</span><p>${br(p.weaknesses)}</p></div></div>${p.cautions.length?`<p class="note">확인할 사항 · ${br(p.cautions.join('\n'))}</p>`:''}${p.note.cautions||p.note.publicNote||p.note.visitedAt?`<div class="memo">${p.note.cautions?`<p><strong>중개사 입력 주의사항</strong><br>${br(p.note.cautions)}</p>`:''}${p.note.publicNote?`<p><strong>고객 전달 메모</strong><br>${br(p.note.publicNote)}</p>`:''}${p.note.visitedAt?`<p class="note">현장 확인일 ${e(p.note.visitedAt)}</p>`:''}</div>`:''}</section>`).join('')}<p class="note">거래 평균은 현재 호가·확정 거래 가능 가격이 아닙니다. 최근 계약은 신고 지연·정정이 있을 수 있습니다. 월세는 보증금 조건별로 비교합니다.</p>
<h2>환경·가치 평가</h2><p class="note">1~100점 분석 평가 · * 부분 평가. 공인 등급·수익률·가격 상승 확률이 아닙니다. 평가 범위가 다른 항목은 점수만으로 비교하지 않습니다. 상세 배점은 원보고서의 근거를 확인해 주세요.</p>${table(['평가 항목',...m.properties.map(p=>p.key+' · '+p.name)],AXES.map((name,i)=>[name,...m.properties.map(p=>{const s=p.scores[i];return s.label+' · '+s.evidence.replace(/\n/g,' · ')+(s.scope?'\n부분 평가: '+s.scope:'');})]),'scores')}
<section class="summary-map"><h2>위치와 주변 시설</h2>${mapHtml}<p class="note">${e(m.properties.map(p=>p.key+' · '+p.name).join(' / '))} · 지도에 표시된 위치·거리 기준을 확인해 주세요.</p><div class="sources"><h2>자료 출처</h2>${m.sources.length?m.sources.map(s=>`<p>${e(s.label)} · ${safeUrl(s.url)?`<a href="${e(safeUrl(s.url))}">${e(s.title)}</a>`:e(s.title)} · 조회 ${e(s.checkedAt||'미기록')}</p>`).join(''):'<p>확인 가능한 대표 출처가 저장되어 있지 않습니다. 상세 근거를 확인해 주세요.</p>'}</div><section class="office" aria-label="상담 부동산 업소">${safeImage(office.logoDataUrl)?`<img src="${e(office.logoDataUrl)}" alt="${e(office.name||'부동산 업소')} 로고">`:''}<div><strong>${e(office.name||'상담 부동산')}</strong>${office.agent||office.phone?`<p>${e([office.agent?'담당 '+office.agent:'',office.phone].filter(Boolean).join(' · '))}</p>`:''}${office.address?`<p class="note">${e(office.address)}</p>`:''}</div></section><footer>${e(REPORT_CREDIT)} · 보고서 ${e(r.id||'')} · 상세 거래와 전체 근거는 원보고서 참조</footer></section></article></body></html>`;
}
module.exports={html,text,model,AXES};
