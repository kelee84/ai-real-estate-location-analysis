'use strict';
const SQM_PER_PYEONG=400/121;
const TWO_PYEONG_SQM=800/121;
function selectedAreas(value){
  if(value==null)return [];
  if(!Array.isArray(value)||value.length>100)throw new Error('선택 면적은 검색된 체크박스에서 최대 100개까지 골라 주세요.');
  if(value.some(x=>typeof x!=='number'||!Number.isFinite(x)||x<=0||x>100000))throw new Error('선택 면적이 올바르지 않습니다.');
  return [...new Set(value)].sort((a,b)=>a-b);
}
function areaClusters(value){
  const groups=[];for(const n of selectedAreas(value)){const group=groups.at(-1);if(!group||(n-group[0])*121>=800-1e-8)groups.push([n]);else group.push(n);}return groups;
}
function areaListLabel(value){return selectedAreas(value).map(n=>`${n}㎡`).join(' · ');}
module.exports={selectedAreas,areaClusters,areaListLabel,SQM_PER_PYEONG,TWO_PYEONG_SQM};
