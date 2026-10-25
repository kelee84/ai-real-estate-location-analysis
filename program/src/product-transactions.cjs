'use strict';
const {createHash}=require('node:crypto');
const {averageMoney:money,validDate}=require('./core.cjs');
const {ownFacts,checkedDate}=require('./price-scoring.cjs');
const VERSION='2026-10-18-product-transactions-v1';
function snapshot({input,prices,dataCheckedAt}={}){
 if(input?.asset!=='apartment'||!input.types?.includes('trade'))return null;
 const identity=prices?.buildingResolution;if(!identity?.code||!identity.town||!identity.lot)return null;
 try{
  const facts=ownFacts(input,prices),checkedAt=checkedDate(prices,{},dataCheckedAt,facts.lastContract);if(!checkedAt)return null;
  const years=facts.rows.map(t=>String(t.built??'').trim()),unique=[...new Set(years)],year=unique.length===1&&/^\d{4}$/.test(unique[0])?Number(unique[0]):null;
  const built=Number.isInteger(year)&&year>=1900&&year<=Number(input.asOf.slice(0,4))&&facts.rows.every(t=>year<=Number(t.date.slice(0,4)))?year:null;
  const areas=[...new Set(facts.rows.map(t=>t.area))].sort((a,b)=>a-b),areaText=areas.map(n=>n+'㎡').join('·'),yearText=built?'실거래 기록상 건축 '+built+'년':'실거래 기록의 건축연도 '+(unique.length>1?'불일치':'미확인');
  const source={id:'ev-product-trades-'+createHash('sha256').update([identity.code,identity.town,identity.lot,input.asOf,...areas].join('|')).digest('hex').slice(0,12),title:'국토교통부 실거래가 · 건축연도·선택 면적 거래 참고',url:'https://rt.molit.go.kr/pt/xls/xls.do',checkedAt};
  return {version:VERSION,status:'reference',identity:{code:identity.code,town:identity.town,lot:identity.lot},period:facts.period,buildingYear:built,buildingYearStatus:built?'consistent':unique.length>1?'conflicting':'unavailable',n:facts.rows.length,mean:facts.mean,actualAreas:areas,source,summary:`${yearText} · 전용 ${areaText} · 매매 ${facts.rows.length}건 · 평균 ${money(facts.mean)}`,note:'같은 단지·선택 면적의 최근 6개월 유효 매매 계약을 재대조했습니다. 건축연도는 실거래 기록의 연도이며 정확한 사용승인일이 아닙니다. 거래 건수·금액으로 주차·관리·평면이나 상품 우수성을 추정하지 않습니다.'};
 }catch{return null;}
}
function apply(scores,e,options){
 const row=scores.find(s=>s.name==='상품 경쟁력');if(!row||row.score!=null||e.product?.status==='verified')return false;
 const reference=snapshot(options);if(!reference)return false;
 e.productTransactions=reference;if(!Array.isArray(e.sources))e.sources=[];if(!e.sources.some(s=>s.id===reference.source.id))e.sources.push(reference.source);
 const basic=e.basic,approval=validDate(basic?.approvalDate)&&basic.approvalDate<=options.input.asOf?'사용승인 '+basic.approvalDate:null;
 row.transactionReference=reference;row.observed=[approval,'실거래 자료 참고: '+reference.summary].filter(Boolean).join(' / ');
 row.needed='등록 주차·공용복도 구성 / 해당 세대 평면·향·수선·관리 상태';
 row.reason=row.observed+' / 주차·관리·평면 미확인으로 상품 점수는 보류합니다. '+reference.note;
 row.method=reference.note+' '+VERSION;row.sourceIds=[...new Set([...(row.sourceIds||[]),reference.source.id])];
 return true;
}
module.exports={VERSION,snapshot,apply};
