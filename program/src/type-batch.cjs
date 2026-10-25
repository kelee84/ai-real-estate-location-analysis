'use strict';
const {randomUUID}=require('node:crypto');
const {normalizeInput}=require('./core.cjs');
const {selectedAreas,areaClusters,TWO_PYEONG_SQM}=require('./type-selection.cjs');
async function runTypeBatch(service,raw,{force=false}={}){
  if(service.active)throw new Error('분석 중인 보고서가 있습니다. 완료 후 다시 시작해 주세요.');
  const selected=selectedAreas(raw.selectedAreas),groups=areaClusters(selected);
  if(!selected.length)throw new Error('분석할 타입을 하나 이상 선택해 주세요.');
  const catalog=service.validateTypeSelection(raw),controller=new AbortController(),batchId=randomUUID();service.active={controller};
  const reports=[],failures=[],futureCache=new Map();let current=0;
  try{
    const status=await service.status();if(!status.loggedIn)throw new Error(status.error||'먼저 내 ChatGPT 계정으로 로그인해 주세요.');
    const input=normalizeInput({...raw,building:catalog.building||raw.building,area:null,selectedAreas:[]});
    service.onEvent({stage:'data',message:'선택 타입의 최근 6개월 거래를 한 번 조회합니다.'});
    const evidenceSources=[];for(const areas of groups){const candidate=normalizeInput({...raw,building:catalog.building||raw.building,selectedAreas:areas,area:null});if(catalog.identity?.code)candidate.propertyCode=catalog.identity.code;evidenceSources.push(await require('./same-day-reuse.cjs').find(service,candidate,{force:force||!!raw.forceRefresh,signal:controller.signal,identities:[catalog.identity]}));}
    const collected=evidenceSources.every(Boolean)?null:await service.data.collect(input,message=>service.onEvent({stage:'data',message}),controller.signal,{catalog}),dataCheckedAt=new Date().toISOString();
    if(collected?.propertyError)throw new Error(collected.propertyError);
    for(current=0;current<groups.length;current++){
      if(controller.signal.aborted)throw new Error('분석을 중지했습니다. 이미 저장한 보고서는 보관함에 남아 있습니다.');
      service.onEvent({stage:'analysis',message:`${current+1}/${groups.length} 보고서 · ${groups[current].join(' · ')}㎡ 분석`});
      const report=await service.runSingle({...raw,building:catalog.building||raw.building,selectedAreas:groups[current],area:null},{force,batchContext:{controller,collected,evidenceSource:evidenceSources[current],dataCheckedAt,catalog,batchId,index:current+1,total:groups.length,thresholdSqm:TWO_PYEONG_SQM,futureCache}});reports.push(report);
    }
  }catch(e){if(!reports.length)throw e;failures.push({index:current+1,message:e.message});}
  finally{service.active=null;}
  return {batch:true,batchId,total:groups.length,reports,failures,complete:reports.length===groups.length};
}
module.exports={runTypeBatch};
