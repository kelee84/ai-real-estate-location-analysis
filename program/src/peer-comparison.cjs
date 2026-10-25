'use strict';
const {normalize,validDate,todayKst}=require('./core.cjs');
const SAME_TOWN_VERSION='2026-10-17-peer-same-town-v1';
const DISTRICT_VERSION='2026-10-18-peer-district-nearby-v2';
const SAME_TOWN_SCOPE='same-town-2km',DISTRICT_SCOPE='same-district-adjacent-towns-2km';
const COMMON_CRITERIA='직선거리 2km 이내·연식 차이 5년 이내·전용면적 차이 5% 이내(최대 2평 미만)·최근 6개월·각 단지 매매 3건 이상·비교 단지 2곳 이상';
const lot=s=>String(s||'').split('-').map(n=>/^\d+$/.test(n)?String(Number(n)):n).join('-');
function addressFacts(address){
 const m=String(address||'').trim().match(/^(.+?)\s+([^\s]+(?:동|리|읍|면|가))\s+(\d+(?:-\d+)?)(?=\s|$)/);
 return m?{district:m[1],town:m[2],lot:lot(m[3]),location:m[1]+' '+m[2]}:null;
}
function districtOf(location,town){const tokens=String(location||'').trim().split(/\s+/),at=tokens.indexOf(town);return at>0?normalize(tokens.slice(0,at).join(' ')):'';}
function targetYearBasis({input,prices,basic,dataCheckedAt}={}){
 const approval=String(basic?.approvalDate||basic?.use_approval_date||'').replace(/^(\d{4})(\d{2})(\d{2})$/,'$1-$2-$3');
 if(validDate(approval)&&approval<=input.asOf&&Number(approval.slice(0,4))>=1900)return {kind:'approval-year',year:Number(approval.slice(0,4)),approvalDate:approval,note:'등록 사용승인 연도로 연식을 비교합니다.'};
 // Rebuild this reference from verified contracts. Never treat a saved year or
 // a transaction-register construction year as an exact approval date.
 const reference=prices?require('./product-transactions.cjs').snapshot({input,prices,dataCheckedAt}):null;
 if(reference?.buildingYearStatus!=='consistent'||!reference.buildingYear||reference.n<3||!validDate(reference.source?.checkedAt)||reference.source.checkedAt>input.asOf)return null;
 return {kind:'transaction-building-year',year:reference.buildingYear,n:reference.n,period:reference.period,identity:reference.identity,source:reference.source,note:'동일 단지·선택 면적의 최근 6개월 유효 매매 전체에서 일치한 건축연도를 연식 비교에만 사용합니다. 정확한 사용승인일은 미확인입니다.'};
}
function contractKey(t,peer={}){return [t.date,t.area,t.price,t.floor||'',normalize(t.location||peer.location),lot(t.lot||peer.lot),normalize(t.building||peer.name)].join('|');}
const GEO_URLS={naver:'https://maps.apigw.ntruss.com/map-geocode/v2/geocode',kakao:'https://dapi.kakao.com/v2/local/search/address.json',vworld:'https://api.vworld.kr/req/address'};
function sourceDay(value){if(validDate(value))return value;if(typeof value!=='string'||!validDate(value.slice(0,10))||!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)||!Number.isFinite(Date.parse(value)))return null;return todayKst(new Date(value));}
function validRegionProof(proof,{address,candidate,regionCode,asOf}){
 const g=proof?.response,r=g?.region,returned=addressFacts(g?.normalized_address||g?.address),day=sourceDay(proof?.checkedAt),age=day?(Date.parse(asOf)-Date.parse(day))/86400000:NaN,point=p=>Number.isFinite(p?.lat)&&Number.isFinite(p?.lng)&&p.lat>=25&&p.lat<=45&&p.lng>=120&&p.lng<=135;
 if(!address||proof?.source!=='정확 주소 지오코딩'||!GEO_URLS[proof.provider]||proof.sourceUrl!==GEO_URLS[proof.provider]||g?.matched_provider!==proof.provider||g?.confidence!=='exact'||proof.checkedAt!==g?.metadata?.collected_at||!Number.isFinite(age)||age<0||age>30||!/^\d{10}$/.test(String(g?.region_code||''))||!/^\d{5}$/.test(String(regionCode||''))||!String(g.region_code).startsWith(String(regionCode))||normalize(proof.queryAddress)!==normalize(address.location+' '+address.lot)||!returned||normalize(returned.location)!==normalize(address.location)||returned.lot!==address.lot||r?.eupmyeondong!==address.town||lot(r?.jibun)!==address.lot||normalize([r?.sido,r?.sigungu].join(' '))!==normalize(address.district)||!point(g)||!point(candidate))return false;
 const rad=n=>n*Math.PI/180,v=Math.sin(rad(g.lat-candidate.lat)/2)**2+Math.cos(rad(g.lat))*Math.cos(rad(candidate.lat))*Math.sin(rad(g.lng-candidate.lng)/2)**2,meters=6371008.8*2*Math.atan2(Math.sqrt(v),Math.sqrt(Math.max(0,1-v)));return meters<=100;
}
function regionProofFrom(geo,queryAddress){
 const provider=geo?.matched_provider;if(!GEO_URLS[provider])return null;
 return {source:'정확 주소 지오코딩',provider,sourceUrl:GEO_URLS[provider],checkedAt:geo.metadata?.collected_at,queryAddress,response:{address:geo.address,normalized_address:geo.normalized_address,lat:geo.lat,lng:geo.lng,confidence:geo.confidence,matched_provider:provider,region_code:geo.region_code,region:geo.region?structuredClone(geo.region):null,metadata:{collected_at:geo.metadata?.collected_at}},limitation:'단지 기본정보 중계의 등록 스냅샷에 법정동 코드가 없어 정확 주소 지오코딩과 별도로 대조했습니다. 공식 단건 K-apt 기본정보의 법정동 코드는 미확인입니다. 코드·법정동·지번·좌표 확인이며 등기·현재 관리 상태 확인이 아닙니다.'};
}
module.exports={SAME_TOWN_VERSION,DISTRICT_VERSION,SAME_TOWN_SCOPE,DISTRICT_SCOPE,COMMON_CRITERIA,addressFacts,districtOf,targetYearBasis,contractKey,validRegionProof,regionProofFrom,sourceDay};
