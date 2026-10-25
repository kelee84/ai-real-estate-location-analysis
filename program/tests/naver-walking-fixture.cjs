'use strict';
// Synthetic evidence for isolated renderer and validator tests, never a report source.
const {todayKst}=require('../src/core.cjs');
const {originOf,walkingFromState}=require('../src/naver-walking.cjs');
function walkingFixture({input,identity,fact}={}){
 input=input||{asset:'apartment',asOf:todayKst()};identity=identity||{code:'20033297',building:'가상검증단지',regionCode:'11410',province:'서울특별시',region:'서대문구',town:'천연동',lot:'145',road:'독립문로8길 54',lat:37.567566,lng:126.9584477};
 fact=fact||{category:'shopping',name:'가상생활마트',classification:'슈퍼,마트',address:'서울 서대문구 독립문공원길 13',placeId:'31398050',sourceUrl:'https://map.naver.com/p/entry/place/31398050',checkedAt:new Date().toISOString(),distanceBasis:'거리 미산정'};
 const origin=originOf(input,{buildingResolution:identity}),selected={name:identity.building+'아파트',classification:'아파트',address:identity.road?[identity.province,identity.region,identity.road].join(' '):origin.address},destination={placeId:String(fact.placeId),name:fact.name,address:fact.address,sourceUrl:fact.sourceUrl},route='https://map.naver.com/p/directions/3zgQjs,2AM6Wg,'+encodeURIComponent(selected.name)+',18736346,PLACE_POI/3zgPJG,2AMhh4,'+encodeURIComponent(fact.name)+','+fact.placeId+',PLACE_POI/-/walk',state={url:route,selectedMode:'도보',originLabel:selected.name,destinationLabel:fact.name,summaries:[{option:'추천',selected:true,scope:'route-total',distanceText:'832m',durationText:'16분'}]},walking=walkingFromState(state,{origin,destination,originSelection:selected});
 return {input,identity,fact:{...structuredClone(fact),walking,routeStatus:'verified',distanceBasis:'네이버 도보 경로'},walking};
}
module.exports={walkingFixture};
