'use strict';
const {areaSelection}=require('./core.cjs');
const average=require('./price-table.cjs');
// Compare the selected population, not the spelling of the input control.
// Exact searches remain exact; this never broadens or changes saved contracts.
function profile(m){
 const s=m.prices?.effectiveArea||areaSelection(m.input),rows=m.prices?.rows||[];
 let values=s.areaMode==='set'?s.selectedAreas:s.areaMode==='exact'?[Number(s.area)]:s.areaMode==='type'?[Number(s.area),Number(s.area)+.999999]:[];
 values=(values||[]).filter(n=>Number.isFinite(n)&&n>0);
 const actual=[...new Set(rows.map(t=>t.area).filter(n=>Number.isFinite(n)&&n>0))].sort((a,b)=>a-b);
 const types=[...new Set(values.map(Math.floor))];
 return {selection:s,values,actual,type:types.length===1?types[0]:null,min:Math.min(...values),max:Math.max(...values)};
}
function compatible(members){
 if(!members.length)return false;
 const p=members.map(profile);if(p.some(x=>!x.values.length||x.selection.areaMode==='all'))return false;
 const lo=Math.min(...p.map(x=>x.min)),hi=Math.max(...p.map(x=>x.max));
 return p.every(x=>x.type!==null&&x.type===p[0].type)||(hi-lo<=1&&hi/lo<=1.02);
}
function areaLabel(m){const p=profile(m);return p.type!==null?p.type+'타입':average.inputArea(m.input);}
function areaNote(members){return members.map(m=>{const p=profile(m),a=p.actual.length?p.actual:p.values;return m.key+' 전용 '+(a.length?(a[0]===a.at(-1)?a[0]:a[0]+'~'+a.at(-1))+'㎡':'면적 미확인');}).join(' · ')+(compatible(members)?' · 유사 면적 비교, 세부 면적·층·계약 시점은 다릅니다.':' · 면적 조건이 달라 총액의 우열 비교를 보류합니다.');}
function warnings(members){
 const out=[];
 if(new Set(members.map(m=>m.input.asOf)).size>1||new Set(members.map(m=>JSON.stringify(m.prices?.period))).size>1)out.push('매물별 분석 기준일이 다릅니다. 당시 자료를 나란히 제시하며 같은 시점의 가격 비교가 아닙니다.');
 if(new Set(members.map(m=>m.input.asset)).size>1)out.push('자산 유형이 달라 동일 상품의 직접 비교와 전체 순위는 적절하지 않습니다.');
 if(!compatible(members))out.push('전용면적 조건이 다릅니다. 총액의 단순 대소로 가격 경쟁력을 판단하지 마세요.');
 if(new Set(members.map(m=>[...(m.input.types||[])].sort().join())).size>1)out.push('거래 유형이 다릅니다. 매매·전세·월세 금액을 서로 같은 가격으로 비교하지 마세요.');
 return out;
}
function notes(members){
 if(warnings(members).length)return [areaNote(members)];
 const out=[areaNote(members)],base=members[0];
 for(const other of members.slice(1))for(const kind of ['trade','jeonse']){
  const a=base.prices.summaries.filter(g=>g.kind===kind),b=other.prices.summaries.filter(g=>g.kind===kind),key=kind==='trade'?'price':'deposit';
  if(a.length!==1||b.length!==1||!Number.isFinite(a[0][key])||!Number.isFinite(b[0][key])||a[0][key]<=0)continue;
  const delta=b[0][key]-a[0][key],pct=delta/a[0][key]*100;
  out.push(`${kind==='trade'?'매매':'전세'} 평균: ${other.key}가 ${base.key}보다 ${average.number(Math.abs(delta))}만원 ${delta>0?'높음':delta<0?'낮음':'차이 없음'} (${delta>=0?'+':''}${average.number(pct)}%, ${base.key} ${a[0].n}건·${other.key} ${b[0].n}건).`);
 }
 if(members.some(m=>m.prices.summaries.some(g=>g.kind==='monthly')))out.push('월세는 같은 보증금 구간끼리 확인하세요. 같은 구간이라도 평균 보증금이 다르면 월 임대료만으로 유불리를 판단할 수 없습니다.');
 if(members.some(m=>m.prices.summaries.some(g=>g.n<3)))out.push('3건 미만인 구간은 표본이 적어 개별 계약 조건의 영향이 큽니다.');
 out.push('금액 차이는 계약 표본의 비교이며 현재 호가·적정 매수가 평가가 아닙니다.');
 return out;
}
function orderRows(rows){const kind={'매매':0,'전세':1,'월세':2},cmp=(a,b)=>String(a??'').localeCompare(String(b??''),'ko',{numeric:true});return rows.sort((a,b)=>kind[a[1]]-kind[b[1]]||cmp(a[2],b[2])||cmp(a[3],b[3])||cmp(a[0],b[0]));}
// Historical price ratings are retained only in their original stored report.
// Current score projection belongs to scoring.prepareReport; price averages
// and comparison notes above remain available independently of the six axes.
function repair(report){return report;}
module.exports={profile,compatible,areaLabel,areaNote,warnings,notes,orderRows,repair};
