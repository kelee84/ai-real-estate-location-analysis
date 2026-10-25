'use strict';

// Shared public copy for all export formats. Private notes never enter this model.
const {publicConsultation}=require('./consultation.cjs');
const PURPOSE={live:'실거주',invest:'투자 검토',rent:'임차'};
const BUDGET={trade:'매매 예산',jeonse:'전세 보증금 예산',monthly:'월세 보증금 예산'};
function compactMoney(value){
  if(!Number.isFinite(value))return '산출 불가';
  const format=n=>new Intl.NumberFormat('ko-KR',{maximumFractionDigits:2}).format(n);
  return Math.abs(value)>=10000?(value%10000?'약 ':'')+format(value/10000)+'억원':format(value)+'만원';
}
function conditionText(customer){
  return [PURPOSE[customer.purpose],customer.budgetManwon!==null?BUDGET[customer.budgetType]+' '+compactMoney(customer.budgetManwon):'',customer.moveIn?'입주 '+customer.moveIn:'',customer.priorities.length?'중요 조건 '+customer.priorities.join(' · '):''].filter(Boolean).join(' / ');
}
function officeText(office){return [office.name,office.agent?'담당 '+office.agent:'',office.phone?'연락처 '+office.phone:'',office.address].filter(Boolean).join(' · ');}
function propertyLabel(report,key){const ms=report.members||report.comparisonMembers||[report],m=ms.find((m,i)=>(m.key||String.fromCharCode(65+i))===key);return (ms.length>1?key+' · ':'')+(m?.input?.building||m?.input?.target||'대상 매물');}
function sections(report){
  const data=publicConsultation(report),result=[],condition=conditionText(data.customer),office=officeText(data.officeProfile);
  if(condition)result.push({heading:'고객 상담 조건',body:condition,consultationSection:true});
  for(const p of data.properties){
    const body=[p.cautions?'주의사항 · '+p.cautions:'',p.publicNote?'고객 전달 메모 · '+p.publicNote:'',p.visitedAt?'현장 확인일 · '+p.visitedAt:''].filter(Boolean).join('\n');
    if(body)result.push({heading:propertyLabel(report,p.key)+' · 상담 메모',body,consultationSection:true});
  }
  if(office)result.push({heading:'부동산 업소 안내',body:office,consultationSection:true});
  return result;
}
module.exports={compactMoney,conditionText,officeText,propertyLabel,sections};
