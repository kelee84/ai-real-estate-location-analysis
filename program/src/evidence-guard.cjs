'use strict';
const {sixMonthWindow,monthlyBand,areaSelection,matchesArea,buildingQuery,normalize,validDate,todayKst}=require('./core.cjs');
function assertVerifiedPrices(prices,input){
  const fail=()=>{throw new Error('거래 수치와 원자료 대조가 일치하지 않아 보고서 생성을 중단했습니다. 새 자료로 다시 조회해 주세요.');};
  const period=sixMonthWindow(input.asOf),selection=prices.effectiveArea||areaSelection(input),ids=new Set();
  if(prices.period.start!==period.start||prices.period.end!==period.end)fail();
  for(const t of prices.rows){if(ids.has(t.id)||t.cancelled||t.date<period.start||t.date>period.end||!matchesArea(t.area,selection)||normalize(t.building)!==buildingQuery(input))fail();
    const property=prices.buildingResolution,lot=value=>String(value||'').split('-').map(n=>/^\d+$/.test(n)?String(Number(n)):n).join('-');
    if(property&&(normalize(property.building)!==buildingQuery(input)||!t.location.split(/\s+/).includes(property.town)||property.lot&&lot(t.lot)!==lot(property.lot)))fail();ids.add(t.id);}
  let used=0;
  for(const g of prices.summaries){
    const rows=prices.rows.filter(t=>t.kind===g.kind&&t.areaBasis===g.areaBasis&&(g.kind!=='monthly'||monthlyBand(t.deposit)===g.depositBand)&&(selection.areaMode!=='all'||t.area===g.area));
    if(!rows.length||rows.length!==g.n)fail();used+=rows.length;
    if(JSON.stringify([...new Set(rows.map(t=>t.area))].sort((a,b)=>a-b))!==JSON.stringify(g.actualAreas))fail();
    for(const key of g.kind==='trade'?['price']:g.kind==='jeonse'?['deposit']:['deposit','monthly']){
      let sum=0,compensation=0;for(const t of rows){if(!Number.isFinite(t[key])||t[key]<0)fail();const next=t[key]-compensation,total=sum+next;compensation=(total-sum)-next;sum=total;}
      if(!Number.isFinite(g[key])||Math.abs(g[key]-sum/rows.length)>0.000001)fail();
    }
  }
  if(used!==prices.rows.length)fail();return {passed:true,contracts:used,groups:prices.summaries.length,checkedAt:new Date().toISOString(),method:'계약 중복·기간·단지·면적·그룹별 건수·실제 면적·금액 합계와 평균의 독립 대조'};
}
const QUANTITY=/(?:\d[\d,.]*\s*(?:조원?|억원?|만원?|천원?|원|㎡|m²|m2|평|km|m(?![A-Za-z])|미터|분|시간|세대|가구|층|년|개월|일|건|%|타입|형|호선|배|위))|(?:\b(?:19|20)\d{2}[-/.]\d{1,2}(?:[-/.]\d{1,2})?)/i;
function verifiedIdentifiers(input,prices){
  const identity=prices?.buildingResolution,selection=prices?.effectiveArea;
  return [input.target,input.building,input.asOf,input.asOf?.replace(/-/g,'.'),identity?.requested,identity?.building,identity?.road,identity?.road?.replace(/\s/g,''),identity?.lot?identity.town+' '+identity.lot:null,identity?.lot?identity.town+identity.lot:null,...(selection?.areaMode==='type'?[selection.area+'타입',selection.area+' 타입']:[]),...(input.selectedAreas||[]).flatMap(a=>[a+'㎡',a+' ㎡',a+'제곱미터'])].filter(Boolean);
}
function guardNarrative(value,{identifiers=[],qualitativeOnly=false}={}){
  const report=structuredClone(value),rejected=[];
  const hasNumber=text=>{let rest=String(text??'');for(const id of identifiers.filter(Boolean).sort((a,b)=>b.length-a.length))rest=rest.split(id).join('');return /[0-9０-９]/.test(rest);};
  const hasSources=(report.sources||[]).some(s=>{try{return new URL(s.url).protocol==='https:';}catch{return false;}});
  const qualitative=(text,field)=>{
    const original=String(text??'');let str=original,walking=false;
    // A facility/coordinate citation does not establish a walking route or its
    // safety. Keep official school-boundary facts and explicit caveats intact.
    str=str.replace(/도보권\s*(?:내(?:의)?\s*)?직선거리(?:로\s*이용\s*가능한\s*입지|에\s*형성|로|에)?/g,match=>{walking=true;return /이용\s*가능한/.test(match)?'직선거리 기준으로 비교한 입지':/형성/.test(match)?'직선거리 기준으로 분포':'직선거리 기준';});
    const caveat=(whole,offset)=>{
      const before=whole.slice(0,offset),after=whole.slice(offset),start=Math.max(before.lastIndexOf('.'),before.lastIndexOf('!'),before.lastIndexOf('?'),before.lastIndexOf('\n'))+1,end=after.search(/[.!?。\n]/);
      return /별도\s*확인|확인(?:이|을)?\s*필요|미확인|확인하지\s*못|단정할\s*수\s*없|보장하지/.test(whole.slice(start,end<0?undefined:offset+end));
    };
    str=str.replace(/(?:통학\s*(?:동선|경로|환경)|통학로|보행\s*(?:동선|경로))(?:이|가|은|는)?\s*(?:(?:비교적|매우|상대적으로|대체로)\s*)?안전(?:하고|하며|함|하다|합니다|해요)(?:\s*(?:용이(?:함|하다|합니다)|편리(?:함|하다|합니다)))?(?![가-힣])/g,(match,offset,whole)=>caveat(whole,offset)?match:'실제 통학·보행 동선의 안전성과 이용 편의는 별도 확인이 필요함');
    str=str.replace(/안전(?:한|하게)\s*(?:통학|보행)(?:이|을)?\s*(?:가능(?:함|하다|합니다)|할\s*수\s*있(?:음|다|습니다))(?![가-힣])/g,(match,offset,whole)=>caveat(whole,offset)?match:'실제 통학·보행 동선의 안전성은 별도 확인이 필요함');
    str=str.replace(/(?:가까워|인접하여|인접해|근접해)[^.!?。\n]{0,35}(?:배정(?:이|을)?\s*(?:보장|확정)|(?:진학|입학)(?:이|을)?\s*보장)[^.!?。\n]*/g,(match,offset,whole)=>caveat(whole,offset)?match:'등록 위치의 근접성만으로 학교 배정·입학 조건을 확정할 수 없음');
    str=str.replace(/(?:가까워|인접하여|인접해|근접해)[^.!?。\n]{0,35}(?:교육|학업|수업|진료|의료)(?:의\s*)?\s*(?:수준|성과|질|성취도)(?:이|가|은|는)?\s*(?:우수|높|뛰어|좋)[^.!?。\n]*/g,(match,offset,whole)=>caveat(whole,offset)?match:'등록 위치의 근접성만으로 교육·의료의 수준이나 성과를 평가할 수 없음');
    if(walking&&!/실제\s*(?:보행|도보).*?(?:확인|미확인)/.test(str))str=str.trim().replace(/[.!?。]?$/,'')+'. 실제 보행 동선·거리는 별도 확인이 필요합니다.';
    if(str!==original)rejected.push({field,text:original,kind:'qualitative',status:'거리·등록 시설 근거만으로 확인하지 않은 도보·통학 안전성·배정·품질 추론을 중립 표현으로 변경'});
    return str;
  };
  const safe=(text,field)=>{const str=qualitative(text,field);if(qualitativeOnly||!hasNumber(str))return str;rejected.push({field,text:str,kind:'quantitative',status:'원문 수치의 직접 대조 미완료로 고객 본문에서 제외'});return '정량 정보는 원자료와 대조한 거래표·면적·조회 조건을 확인하세요.';};
  function checkedScore(s,prefix){
    s={...s};for(const field of ['reason','method'])if(typeof s[field]==='string')s[field]=qualitative(s[field],prefix+'scores.'+s.name+'.'+field);
    if(qualitativeOnly)return s;
    const method=s.method||'',badReason=hasNumber(s.reason),badMethod=QUANTITY.test(method)||(hasNumber(method)&&!/(배점|평가\s*(?:기준|구간)|구간\s*기준|가중치|점수|점\s*기준)/.test(method));
    if(!badReason&&!badMethod)return s;
    rejected.push({field:prefix+'scores.'+s.name,text:[s.reason,s.method].join(' '),reason:s.reason,method:s.method,status:'수치 근거 직접 대조 미완료'});
    const needs=require('./scoring.cjs').NEEDS[s.name]||['해당 항목의 직접 근거'];
    return {...s,score:null,reason:badReason?needs.join(' / ')+'을 확인해야 평가할 수 있습니다.':s.reason,method:badMethod?'':method};
  }
  const apply=(r,prefix='')=>{for(const f of ['title','conclusion','methodology'])if(typeof r[f]==='string')r[f]=safe(r[f],prefix+f);for(const f of ['highlights','strengths','limitations','checks'])if(Array.isArray(r[f]))r[f]=r[f].map((x,i)=>safe(x,prefix+f+'.'+i));if(Array.isArray(r.sections))r.sections=r.sections.map((s,i)=>({heading:safe(s.heading,prefix+'sections.'+i+'.heading'),body:safe(s.body,prefix+'sections.'+i+'.body')}));if(Array.isArray(r.scores))r.scores=r.scores.map(s=>checkedScore(s,prefix));};
  apply(report);for(const [i,m]of (report.members||[]).entries())apply(m,'members.'+i+'.');
  for(const r of [report,...(report.members||[])])for(const field of ['highlights','strengths','limitations','checks'])if(Array.isArray(r[field]))r[field]=[...new Set(r[field])];
  if(rejected.some(x=>x.field==='methodology'&&x.kind!=='qualitative'))for(const m of report.members||[])m.scores=(m.scores||[]).map(s=>({...s,score:null,reason:'공통 평가 기준의 정량 근거를 직접 대조하지 못해 평가를 보류합니다.',method:''}));
  if(!hasSources&&!qualitativeOnly){const neutral=r=>{if(r.strengths)r.strengths=['입지 장점을 확인할 출처를 확보하지 못했습니다.'];if(r.limitations)r.limitations=['입지·교육·생활시설·현장 상태는 추가 확인이 필요합니다.'];if(r.sections)r.sections=[{heading:'선택 기준과 확인사항',body:'원자료와 대조한 거래표의 조건과 표본을 확인하세요. 현재 호가와 확정 거래 가능 가격은 다를 수 있습니다. 입지·학군·현장 상태·권리관계는 별도 자료와 현장 확인이 필요합니다.'}];};neutral(report);report.conclusion='검증된 거래 표본을 확인하고, 입지와 현장 상태를 추가 확인한 뒤 판단하세요.';report.highlights=['거래 금액·면적·건수는 원자료와 대조한 표에 표시했습니다.','입지 주장의 출처가 없어 해당 주장은 확정하지 않았습니다.'];for(const m of report.members||[])neutral(m);}
  const notices=[];
  if(rejected.some(x=>x.kind==='qualitative'))notices.push('AI 본문에서 확인되지 않은 도보·통학 안전성·학교 배정·교육 및 의료 수준 추론은 중립 표현으로 바꿨습니다. 직선거리와 실제 이동 조건은 구분합니다.');
  if(rejected.some(x=>x.kind!=='qualitative'))notices.push('AI 본문의 정량 설명 중 원자료와 직접 대조하지 못한 내용은 제외했습니다. 금액·면적·건수는 검증된 거래표를 확인하세요.');
  if(!notices.length&&!hasSources&&!qualitativeOnly)notices.push('입지 서술의 출처를 확보하지 못해 해당 주장을 확정하지 않았습니다.');
  return {report,rejected,notice:notices.join(' ')||null};
}
function alignSourceDates(sources,{verifiedSources=[],dataCheckedAt,preservedIds=[]}={}){
  const day=value=>{
    if(typeof value!=='string')return null;if(validDate(value))return value;
    if(!validDate(value.slice(0,10))||!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/i.test(value))return null;
    const parsed=Date.parse(value);if(!Number.isFinite(parsed))return null;const result=todayKst(new Date(parsed));return validDate(result)?result:null;
  };
  const parseUrl=value=>{try{const url=new URL(value);return ['http:','https:'].includes(url.protocol)?url:null;}catch{return null;}};
  const preserved=preservedIds instanceof Set?preservedIds:new Set(preservedIds||[]),verified=new Map(),rtmsDay=day(dataCheckedAt);
  for(const s of Array.isArray(verifiedSources)?verifiedSources:[]){const date=day(s?.checkedAt);if(!date||!parseUrl(s?.url))continue;if(!verified.has(s.url))verified.set(s.url,[]);verified.get(s.url).push({id:s.id,date});}
  return (Array.isArray(sources)?sources:[]).map(s=>{
    if(!s||typeof s!=='object'||preserved.has(s.id))return s;
    const url=parseUrl(s.url);if(!url)return s;let date=null;
    if(url.hostname==='rt.molit.go.kr'&&rtmsDay)date=rtmsDay;
    else{const matches=verified.get(s.url)||[],sameId=matches.filter(v=>s.id!=null&&v.id===s.id),dates=new Set((sameId.length?sameId:matches).map(v=>v.date));if(dates.size===1)date=[...dates][0];}
    return date&&date!==s.checkedAt?{...s,checkedAt:date}:s;
  });
}
module.exports={assertVerifiedPrices,verifiedIdentifiers,guardNarrative,alignSourceDates};

