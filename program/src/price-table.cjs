'use strict';
const KIND={trade:'매매',jeonse:'전세',monthly:'월세'};
const {averageMoney:money}=require('./core.cjs');
const number=n=>Number.isFinite(n)?new Intl.NumberFormat('ko-KR',{maximumFractionDigits:1}).format(n):'산출 불가';
const bands={'1천만원 미만':'1,000 미만','1천~5천만원 미만':'1,000~<5,000','5천만원~1억원 미만':'5,000~<10,000','1~3억원 미만':'10,000~<30,000','3~5억원 미만':'30,000~<50,000','5~10억원 미만':'50,000~<100,000'};
function band(text){if(!text)return '—';return bands[text]||text.replace(/^보증금 /,'').replace(/만원 동일 조건$/,' 동일');}
function area(g){
  if(g.areaMode==='type')return g.area+'타입';
  if(g.areaMode==='set'){
    const values=(Array.isArray(g.selectedAreas)?g.selectedAreas:String(g.area??'').split(',').filter(x=>x.trim()).map(Number)).filter(n=>Number.isFinite(n)&&n>0);
    const types=[...new Set((values.length?values:g.actualAreas||[]).map(Math.floor))].sort((a,b)=>a-b);
    if(types.length)return (types.length===1?types[0]:types[0]+'~'+types.at(-1))+'타입';
    return '선택 타입';
  }
  return g.areaMode==='exact'?g.area+'㎡':g.areaLabel||g.area+'㎡';
}
function inputArea(input){return input.selectedAreas?.length?area({areaMode:'set',selectedAreas:input.selectedAreas}):input.areaMode==='type'?input.area+'타입':input.area==null?'면적별 분리':input.area+'㎡';}
function rows(r){const rank={trade:0,jeonse:1,monthly:2};return [...[...r.prices.summaries].sort((a,b)=>rank[a.kind]-rank[b.kind]||String(a.area).localeCompare(String(b.area),'ko',{numeric:true})||(a.deposit??0)-(b.deposit??0)).map(g=>[KIND[g.kind],area(g),band(g.depositBand),String(g.n),g.kind==='trade'?money(g.price):g.kind==='jeonse'?money(g.deposit):`보증 ${money(g.deposit)} / 월 ${money(g.monthly)}`]),...r.prices.unavailable.map(g=>[KIND[g.kind],'—','—','—','자료 없음'])];}
function missingNote(r){return (r.members||[r]).flatMap(m=>(m.prices.unavailable||[]).map(g=>(m.key?m.key+' · ':'')+KIND[g.kind]+' · '+g.reason)).join(' / ');}
function conditionNote(r){return '동일 단지 · '+(r.prices.effectiveArea?.areaMode==='set'?'선택 면적 통합 평균 · ':'')+(r.prices.areaResolution?`요청 ${r.prices.areaResolution.requested}타입 → ${r.prices.areaResolution.applied}타입 적용 · `:'')+'해제·중복 제외';}
function periodNote(r){const members=r.members||[r],periods=[...new Set(members.map(m=>m.prices.period.start+' ~ '+m.prices.period.end))];return (periods.length===1?'계약일 '+periods[0]:members.map(m=>m.key+' '+m.prices.period.start+' ~ '+m.prices.period.end).join(' · '))+' · 평균 금액: 억·만원(소수 첫째 자리 반올림) · 보증금 구간: 만원 · 전용면적 기준';}
const NOTE='개별 계약의 산술평균 · 월세는 보증금 구간별 분리 · <는 상한 미만 · 타입은 전용면적의 정수 ㎡ 기준 · 상세 면적은 상세 근거 보기';
const CSS=`.averages th,.averages td{padding:7px 8px;line-height:1.5;white-space:nowrap;overflow-wrap:normal;font-variant-numeric:tabular-nums}.averages th{font-weight:700}.averages td:nth-last-child(-n+2),.averages th:nth-last-child(-n+2){text-align:right}.averages tbody tr:nth-child(even){background:${require('./brand-theme.cjs').colors.soft}}`;
module.exports={rows,band,area,inputArea,missingNote,conditionNote,number,periodNote,NOTE,CSS};
