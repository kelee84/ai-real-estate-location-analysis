'use strict';
// Public RTMS identity and Naver complex 8742 facts checked on 2026-10-30.
// Tests replace the observation date only to exercise present-day validation.
const identity={code:'3282',building:'목동우성2',regionCode:'11470',province:'서울특별시',region:'양천구',town:'신정동',lot:'337',road:'목동남로4길 6-23',lat:37.5077984515394,lng:126.866529011129};
const record=()=>({complexNo:'8742',name:'목동우성2차',addressJibun:'서울시 양천구 신정동 337',addressRoad:'서울시 양천구 목동남로4길 6-23',sourceUrl:'https://fin.land.naver.com/complexes/8742',checkedAt:new Date().toISOString(),basic:{approvalDate:'2000-03-18',units:1140,parkingSpaces:1376}});
module.exports={identity,record};
