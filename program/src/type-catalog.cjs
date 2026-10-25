'use strict';
const {normalizeInput,clean}=require('./core.cjs');
const {resolveProperty}=require('./property-identity.cjs');
const {selectedAreas}=require('./type-selection.cjs');
const SOURCE='https://rt.molit.go.kr/pt/gis/gis.do';
async function discoverTypes(client,raw,signal,{region,expected}={}){
  const input=normalizeInput({...raw,area:null,selectedAreas:[],types:['trade','jeonse','monthly']}),kind={apartment:'A',villa:'B',officetel:'D'}[input.asset];
  if(!kind)throw new Error('이 매물 종류는 공식 자료에서 개별 건물의 전체 전용면적 목록을 확인할 수 없습니다. 면적을 직접 입력해 주세요.');
  const {property,identity}=await resolveProperty(client,input,signal,{region,expected}),coverage=[],records=[];
  for(const deal of ['1','2']){
    try{const result=JSON.parse((await client.request('/pt/gis/ptDtlArea.do',{srhThingSecd:kind,srhDelngSecd:deal,dtlLi:'',dtlYear:'',dtlMon:'',srhAprpnHsmpCode:String(property.aprpnHsmpCode)},signal)).toString());
      if(!Array.isArray(result.danjiList))throw new Error('면적 목록 형식이 올바르지 않습니다.');records.push(...result.danjiList);coverage.push({deal,status:'success',count:result.danjiList.length});
    }catch(e){if(signal?.aborted)throw e;coverage.push({deal,status:'error',message:e.message});}
  }
  if(coverage.some(c=>c.status==='error'))throw new Error('타입 목록의 일부 조회가 실패했습니다. 빠진 타입을 전체 목록으로 표시하지 않도록 중단했습니다. 다시 검색해 주세요.');
  const areas=selectedAreas([...new Set(records.map(r=>Number(r.prvuseAr)).filter(n=>Number.isFinite(n)&&n>0))]);
  if(!areas.length)throw new Error('공식 자료에서 확인되는 전용면적 타입이 없습니다.');
  return {target:input.target,asset:input.asset,requestedBuilding:input.building,building:clean(property.aprpnHsmpNm,100),identity,areas,source:SOURCE,sourceName:'국토교통부 실거래가 공개시스템 면적 목록',checkedAt:new Date().toISOString(),coverage,property:{code:String(property.aprpnHsmpCode),town:property.townName,lot:property.mnnm},scope:'공식 공개자료에서 조회되는 면적 전체(연도·월 제한 없이 매매·전월세 합집합). 거래 이력이 없는 타입·A/B 평면 명칭까지 확인한 목록은 아닙니다.',records};
}
module.exports={discoverTypes};
