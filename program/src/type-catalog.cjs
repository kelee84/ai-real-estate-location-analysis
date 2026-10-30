'use strict';
const {normalizeInput,clean}=require('./core.cjs');
const {resolveProperty}=require('./property-identity.cjs');
const SOURCE='https://rt.molit.go.kr/pt/gis/gis.do';
const {failure,jsonRequest,cancelled}=require('./search-errors.cjs');
async function discoverTypes(client,raw,signal,{region,expected}={}){
  const input=normalizeInput({...raw,area:null,selectedAreas:[],types:['trade','jeonse','monthly']}),kind={apartment:'A',villa:'B',officetel:'D'}[input.asset];
  if(!kind)throw new Error('이 매물 종류는 공식 자료에서 개별 건물의 전체 전용면적 목록을 확인할 수 없습니다. 면적을 직접 입력해 주세요.');
  const {property,identity}=await resolveProperty(client,input,signal,{region,expected}),coverage=[],records=[];
  for(const deal of ['1','2']){
    try{const result=await jsonRequest(client,'/pt/gis/ptDtlArea.do',{srhThingSecd:kind,srhDelngSecd:deal,dtlLi:'',dtlYear:'',dtlMon:'',srhAprpnHsmpCode:String(property.aprpnHsmpCode)},signal);
      if(!Array.isArray(result?.danjiList)||result.danjiList.some(r=>!r||!['number','string'].includes(typeof r.prvuseAr)||!/^\d+(?:\.\d+)?$/.test(String(r.prvuseAr))||!Number.isFinite(Number(r.prvuseAr))||Number(r.prvuseAr)<=0||Number(r.prvuseAr)>100000))throw failure('TYPE_RESPONSE_INVALID','면적 목록 형식이 올바르지 않습니다. 빠진 타입을 표시하지 않도록 중단했습니다. 다시 검색해 주세요.','types');records.push(...result.danjiList);coverage.push({deal,status:'success',count:result.danjiList.length});
    }catch(e){cancelled(signal);if([401,403,429].includes(e.status))throw require('./search-errors.cjs').present(e,signal);if(e.code==='SEARCH_RESPONSE_INVALID')throw failure('TYPE_RESPONSE_INVALID',e.message,'types');if(e.code==='TYPE_RESPONSE_INVALID')throw e;coverage.push({deal,status:'error',message:e.message,code:e.code,statusCode:e.status,attempts:e.attempts||1});}
  }
  if(coverage.some(c=>c.status==='error'))throw failure('TYPE_LOOKUP_FAILED','타입 목록의 일부 조회가 실패했습니다. 빠진 타입을 전체 목록으로 표시하지 않도록 중단했습니다. 다시 검색하거나 면적을 직접 입력해 주세요.','types',{coverage});
  // The 100-item selection limit is for a user's analysis, not the source list.
  const areas=[...new Set(records.map(r=>Number(r.prvuseAr)))].sort((a,b)=>a-b);
  if(!areas.length)throw failure('TYPE_EMPTY','단지는 확인했지만 공식 자료에서 확인되는 전용면적 타입이 없습니다. 면적을 직접 입력해 주세요.','types');
  return {target:input.target,asset:input.asset,requestedBuilding:input.building,building:clean(property.aprpnHsmpNm,100),identity,areas,source:SOURCE,sourceName:'국토교통부 실거래가 공개시스템 면적 목록',checkedAt:new Date().toISOString(),coverage,property:{code:String(property.aprpnHsmpCode),town:property.townName,lot:property.mnnm},scope:'공식 공개자료에서 조회되는 면적 전체(연도·월 제한 없이 매매·전월세 합집합). 거래 이력이 없는 타입·A/B 평면 명칭까지 확인한 목록은 아닙니다.',records};
}
module.exports={discoverTypes};
