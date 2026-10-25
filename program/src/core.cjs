'use strict';
const crypto = require('node:crypto');
const SCORE_ITEMS = ['교통 환경','교육 환경','상권 환경','자연환경','병원 환경','학원 환경'];
function todayKst(now = new Date()) { return new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(now); }
function validDate(s) { if(!/^\d{4}-\d{2}-\d{2}$/.test(s||'')) return false; const d=new Date(s+'T00:00:00Z');return Number.isFinite(+d)&&d.toISOString().slice(0,10)===s; }
function sixMonthWindow(asOf) {
  return monthWindow(asOf,6);
}
function monthWindow(asOf,months) {
  if(!validDate(asOf)) throw new Error('기준일을 올바르게 입력해 주세요.');
  if(!Number.isInteger(months)||months<1||months>12)throw new Error('조회 개월 수를 확인해 주세요.');
  const [y,m,d]=asOf.split('-').map(Number), first=new Date(Date.UTC(y,m-months-1,1));
  const last=new Date(Date.UTC(first.getUTCFullYear(),first.getUTCMonth()+1,0)).getUTCDate();
  first.setUTCDate(Math.min(d,last));return {start:first.toISOString().slice(0,10),end:asOf};
}
function amount(s) { if(typeof s==='number')return Number.isFinite(s)&&s>=0?s:null; const n=String(s??'').replace(/[,\s]/g,'');const value=/^\d+(?:\.\d+)?$/.test(n)?Number(n):NaN;return Number.isFinite(value)?value:null; }
function clean(s,max=2000) { return String(s??'').replace(/\u0000/g,'').trim().slice(0,max); }
function normalize(s) { return clean(s).normalize('NFKC').replace(/[\s()（）·-]/g,'').toLowerCase(); }
function safeName(s) { return clean(s,70).replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').replace(/[. ]+$/g,'') || '보고서'; }
function areaSelection(input) {
  const selected=require('./type-selection.cjs').selectedAreas(input.selectedAreas);
  if(selected.length){if(require('./type-selection.cjs').areaClusters(selected).length>1)throw new Error('2평 이상 차이나는 선택 면적은 각각의 보고서로 나누어 분석해야 합니다.');return {area:selected.join(','),areaMode:'set',selectedAreas:selected,label:`선택 전용면적 ${selected.map(a=>a+'㎡').join(' · ')} (개별 계약 통합 평균)`};}
  if(input.area===null||input.area===undefined||String(input.area).trim()==='')return {area:null,areaMode:'all',label:'면적별 분리'};
  const text=clean(input.area,40).normalize('NFKC').replace(/\s/g,''),match=text.match(/^(\d+(?:\.\d+)?)(?:타입|m2|m²|㎡)?$/i);
  if(!match)throw new Error('면적은 84 또는 84.81처럼 입력해 주세요.');
  const area=Number(match[1]);if(!(area>0&&area<=100000))throw new Error('전용면적을 0보다 큰 숫자로 입력해 주세요.');
  const areaMode=input.areaMode==='exact'?'exact':input.areaMode==='type'||/타입$/.test(text)||!match[1].includes('.')?'type':'exact';
  if(areaMode==='type'&&!Number.isInteger(area))throw new Error('타입은 84처럼 정수로 입력해 주세요. 상세 면적은 84.81처럼 입력하세요.');
  return {area,areaMode,label:areaMode==='type'?`${area}타입 (${area}.00㎡ 이상 ${area+1}.00㎡ 미만)`:`${area}㎡ 정확 일치`};
}
function matchesArea(area,selection){return selection.areaMode==='all'||(selection.areaMode==='set'?selection.selectedAreas.some(a=>Math.abs(area-a)<0.000001):selection.areaMode==='type'?area>=selection.area&&area<selection.area+1:Math.abs(area-selection.area)<0.000001);}
function areaGroup(area,input){if(input.selectedAreas?.length)return input.selectedAreas.join(',');return input.area===null||input.area===undefined?area:Number(input.area);}
function displaySources(report){return (report.sources||[]).filter(s=>{
  if(/입지\s*톡|ipzitalk|ipjitalk|ipji[- ]talk/i.test(s.title||''))return false;
  try{const host=new URL(s.url).hostname.toLowerCase();return host!=='ipji-talk.com'&&!host.endsWith('.ipji-talk.com');}catch{return true;}
});}
function normalizeInput(x={}) {
  const target=clean(x.target,400);if(target.length<2)throw new Error('단지명 또는 주소를 입력해 주세요.');
  const asset=['apartment','villa','single-house','officetel','commercial'].includes(x.asset)?x.asset:'apartment';
  let types=Array.isArray(x.types)?[...new Set(x.types)].filter(t=>['trade','jeonse','monthly'].includes(t)):['trade','jeonse','monthly'];
  const only=[...clean(x.request).matchAll(/(매매|전세|월세)\s*만/g)].map(m=>({매매:'trade',전세:'jeonse',월세:'monthly'})[m[1]]);if(only.length)types=[...new Set(only)];
  if(!types.length)throw new Error('매매·전세·월세 중 하나 이상 선택해 주세요.');
  const asOf=clean(x.asOf,10)||todayKst();sixMonthWindow(asOf);
  if(asOf>todayKst())throw new Error('기준일은 오늘 또는 이전 날짜로 입력해 주세요.');
  const {area,areaMode,selectedAreas}=areaSelection(x);
  const offered=clean(x.offered,25)===''?null:amount(x.offered);if(clean(x.offered,25)&&offered===null)throw new Error('제시가격은 만원 단위 숫자로 입력해 주세요.');
  const consultation=require('./consultation.cjs'),officeProfile=consultation.normalizeOfficeProfile(x.officeProfile,x.office,{strict:true});
  return {target,asset,types,asOf,area,areaMode,...(selectedAreas?{selectedAreas}:{}),...(x.priceBasisMode==='current-listings'?{priceBasisMode:'current-listings'}:{}),offered,building:clean(x.building,100),request:clean(x.request,3000),office:officeProfile.name,officeProfile,customer:consultation.normalizeCustomer(x.customer,{strict:true})};
}
function rowToContract(row,deal,source='RTMS') {
  const ym=clean(row['계약년월']), day=clean(row['계약일']);
  const date=/^\d{6}$/.test(ym)&&/^\d{1,2}$/.test(day)?`${ym.slice(0,4)}-${ym.slice(4)}-${day.padStart(2,'0')}`:'';
  const monthly=amount(row['월세금(만원)']);
  const kind=deal==='trade'?'trade':monthly===null?'unknown':monthly===0?'jeonse':'monthly';
  const cancel=clean(row['해제사유발생일']);
  const area=amount(row['전용면적(㎡)']??row['전용면적(제곱미터)']??row['건물면적(㎡)']??row['연면적(㎡)']);
  return {id:crypto.createHash('sha256').update(JSON.stringify([source,deal,row])).digest('hex'),date,kind,price:amount(row['거래금액(만원)']),deposit:amount(row['보증금(만원)']),monthly,area,
    areaBasis:row['전용면적(㎡)']!==undefined||row['전용면적(제곱미터)']!==undefined?'전용면적':'건물/연면적',
    building:clean(row['단지명']??row['건물명']),location:clean(row['시군구']),lot:clean(row['번지']),floor:clean(row['층']),built:clean(row['건축년도']),
    cancelled:!!cancel&&!['-','없음'].includes(cancel),dealType:clean(row['거래유형']),source,raw:row};
}
function buildingQuery(input) {
  return normalize(require('./property-identity.cjs').requestedName(input));
}
function monthlyBand(deposit){if(deposit<1000)return '1천만원 미만';if(deposit<5000)return '1천~5천만원 미만';if(deposit<10000)return '5천만원~1억원 미만';if(deposit<30000)return '1~3억원 미만';if(deposit<50000)return '3~5억원 미만';if(deposit<100000)return '5~10억원 미만';return `보증금 ${money(deposit)} 동일 조건`;}
function aggregate(contracts,input,coverage=[]) {
  const period=sixMonthWindow(input.asOf),wanted=new Set(input.types),seen=new Set(),excluded={outside:0,cancelled:0,duplicate:0,condition:0,invalid:0};
  let selection=areaSelection(input);const name=buildingQuery(input),kept=[],neighborhoods=[...input.target.matchAll(/(?:^|\s)([가-힣0-9]+(?:동|리|읍|면))(?=\s|$)/g)].map(m=>normalize(m[1]));
  let areaResolution=null;
  if(selection.areaMode==='type'&&name){
    const candidates=contracts.filter(t=>validDate(t.date)&&t.date>=period.start&&t.date<=period.end&&!t.cancelled&&wanted.has(t.kind)&&Number.isFinite(t.area)&&t.area>0&&normalize(t.building)===name&&neighborhoods.every(n=>normalize(t.location).includes(n))&&(t.kind==='trade'?t.price>0:t.deposit!==null&&t.deposit!==undefined&&t.monthly!==null&&t.monthly!==undefined));
    if(candidates.length&&!candidates.some(t=>matchesArea(t.area,selection))){
      const nearest=[...new Set(candidates.map(t=>Math.floor(t.area)))].filter(n=>n>0).sort((a,b)=>Math.abs(a-selection.area)-Math.abs(b-selection.area)||a-b)[0];
      if(nearest!==undefined){const requested=selection.area;selection=areaSelection({area:nearest,areaMode:'type'});areaResolution={requested,applied:nearest,mode:'nearest-type',reason:'최근 6개월 동일 단지·선택 거래 유형의 유효 거래에 요청 타입이 없어 가장 가까운 정수 면적군을 적용했습니다. 같은 차이면 작은 타입을 선택합니다. 단지에 해당 타입이 존재하지 않는다는 뜻은 아닙니다.'};}
    }
  }
  for(const t of contracts) {
    if(!validDate(t.date)||!['trade','jeonse','monthly'].includes(t.kind)||!Number.isFinite(t.area)||t.area<=0){excluded.invalid++;continue;}
    if(t.date<period.start||t.date>period.end){excluded.outside++;continue;}
    if(t.cancelled){excluded.cancelled++;continue;}
    if(seen.has(t.id)){excluded.duplicate++;continue;}seen.add(t.id);
    if(!wanted.has(t.kind))continue;
    // 익명화된 단독/상가 주소를 개별 매물과 동일하다고 추정하지 않는다.
    if(!name||!t.building||normalize(t.building)!==name||neighborhoods.some(n=>!normalize(t.location).includes(n))||!matchesArea(t.area,selection)) {excluded.condition++;continue;}
    if((t.kind==='trade'&&(!Number.isFinite(t.price)||!(t.price>0)))||(t.kind!=='trade'&&(!Number.isFinite(t.deposit)||!Number.isFinite(t.monthly)||t.deposit<0||t.monthly<0))){excluded.invalid++;continue;}
    kept.push(t);
  }
  const groups=new Map();
  for(const t of kept) {
    // 면적이 없으면 개별 면적별로 분리한다. 월세 보증금은 사전 고정 구간으로 나눈다.
    const areaKey=areaGroup(t.area,selection);
    const bucket=t.kind==='monthly'?monthlyBand(t.deposit):'';
    const key=[t.kind,areaKey,t.areaBasis,bucket].join('|');
    if(!groups.has(key))groups.set(key,{kind:t.kind,area:areaKey,areaMode:selection.areaMode,areaLabel:selection.areaMode==='all'?`${t.area}㎡`:selection.label,areaBasis:t.areaBasis,depositBand:bucket,rows:[]});groups.get(key).rows.push(t);
  }
  const summaries=[...groups.values()].map(g=>{const n=g.rows.length,mean=k=>g.rows.reduce((s,t)=>s+t[k],0)/n;return {...g,rows:undefined,actualAreas:[...new Set(g.rows.map(t=>t.area))].sort((a,b)=>a-b),n,price:g.kind==='trade'?mean('price'):null,deposit:g.kind!=='trade'?mean('deposit'):null,monthly:g.kind==='monthly'?mean('monthly'):null,minDate:g.rows.map(t=>t.date).sort()[0],maxDate:g.rows.map(t=>t.date).sort().at(-1)};});
  const unavailable=input.types.filter(kind=>!summaries.some(g=>g.kind===kind)).map(kind=>({kind,reason:input.asset==='commercial'&&kind!=='trade'?'공식 조회 경로에서 상가 전월세를 제공하지 않습니다.':!name?'동일 건물을 특정할 단지·건물명이 필요합니다.':coverage.some(c=>c.status==='error'&&(kind==='trade'?c.deal==='trade':c.deal==='rent'))?'자료 조회에 실패하여 평균을 산출할 수 없습니다.':'최근 6개월에 동일 건물·유사 면적의 유효 거래를 찾지 못했습니다.'}));
  return {period,areaResolution,effectiveArea:selection,condition:`동일 단지·건물명 정확 일치 / ${areaResolution?`요청 ${areaResolution.requested}타입 → 적용 ${areaResolution.applied}타입 / `:''}${selection.label} / 해제·동일 원자료 중복 제외`,summaries,unavailable,excluded,rows:kept,coverage,
    note:'개별 계약의 산술평균입니다. 평균 금액은 소수 첫째 자리까지 반올림해 표시하며 원계산값은 Excel·원자료에 보존합니다. 현재 호가나 확정 거래 가능 가격이 아닙니다. 최근 계약은 신고 지연과 추후 정정이 있을 수 있습니다. 면적·층·시점 차이를 확인하세요.'+(selection.areaMode==='type'?' 타입은 정수 면적군이며 A·B 평면 구분을 뜻하지 않습니다. 소수점 면적별 원거래를 함께 확인하세요.':'')};
}
function quotaState(data) {
  const bucket=data?.rateLimitsByLimitId?.codex??data?.rateLimits;
  const windows=[bucket?.primary,bucket?.secondary].filter(x=>x&&Number.isFinite(x.usedPercent)&&Number.isFinite(x.resetsAt));
  const week=windows.find(w=>w.windowDurationMins===10080);
  const clamp=n=>Math.max(0,Math.min(100,n));
  return {remaining:windows.length?clamp(Math.min(...windows.map(w=>100-w.usedPercent))):null,windows:windows.map(w=>({usedPercent:clamp(w.usedPercent),remaining:clamp(100-w.usedPercent),resetsAt:w.resetsAt,windowDurationMins:w.windowDurationMins,label:w.windowDurationMins===10080?'주간':w.windowDurationMins===300?'5시간':w.windowDurationMins?`${w.windowDurationMins}분`:'사용량'})),checkedAt:new Date().toISOString(),lowSignature:windows.map(w=>`${w.windowDurationMins||'unknown'}:${w.resetsAt}`).sort().join('|'),weekly:week?{remaining:clamp(100-week.usedPercent),resetsAt:week.resetsAt}:null};
}
function money(n) { if(n===null||n===undefined)return '산출 불가';return `${new Intl.NumberFormat('ko-KR',{maximumFractionDigits:1}).format(n)}만원`; }
// Display only: source amounts and formulas remain in 만원.
function averageMoney(n) { if(!Number.isFinite(n))return '산출 불가';return Math.abs(n)>=10000?new Intl.NumberFormat('ko-KR',{maximumFractionDigits:1}).format(n/10000)+'억':money(n); }
function escapeHtml(s) { return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function validateReport(report) {
  const issues=[];if(!report?.conclusion||!report?.title)throw new Error('분석 결과의 필수 항목이 빠졌습니다. 다시 분석해 주세요.');
  const sources=new Map((report.sources||[]).filter(s=>/^https:\/\//.test(s.url||'')).map(s=>[s.id,s]));
  report.scores=SCORE_ITEMS.map(name=>{
    const s=(report.scores||[]).find(x=>x.name===name);const evidence=(s?.sourceIds||[]).filter(id=>sources.has(id));
    if(!s||!Number.isInteger(s.score)||s.score<1||s.score>100||!evidence.length||!s.method||!s.reason){if(s?.score!=null)issues.push(`${name}: 근거 또는 평가 기준 부족으로 평가 보류`);return {...(s||{}),name,score:null,reason:s?.reason||'평가에 필요한 자료를 확보하지 못했습니다.',method:s?.method||'',sourceIds:evidence};}
    return {...s,sourceIds:evidence};
  });
  report.sources=[...sources.values()];return {report,issues};
}
module.exports={SCORE_ITEMS,todayKst,validDate,sixMonthWindow,monthWindow,amount,clean,normalize,safeName,normalizeInput,areaSelection,matchesArea,areaGroup,displaySources,rowToContract,buildingQuery,monthlyBand,aggregate,quotaState,money,averageMoney,escapeHtml,validateReport};
