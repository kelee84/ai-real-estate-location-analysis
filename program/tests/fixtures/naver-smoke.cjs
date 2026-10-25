'use strict';
// Deliberately fictional records for packaging/export checks. No page reader or
// discovery function from the real browser is called by these fixtures.
const {NaverLandStore,normalize}=require('../../src/naver-land.cjs');
const PUBLIC_TEXT='네이버 보완 시험문구: 간선 16번 · 실제 시설정보 아님.';
const ACADEMY_DETAIL_TEXT='학원세부검증전용표식',HOSPITAL_DETAIL_TEXT='병원세부검증용가상의원';
const ACADEMY_NAME='가상입시학원',ACADEMY_MATH_NAME='가상수학학원';
function academyRecord(identity,asOf,checkedAt=new Date().toISOString()){
 const {createHash}=require('node:crypto'),{SUBJECTS}=require('../../src/academy-web.cjs'),{searchUrl}=require('../../src/naver-nearby.cjs');
 const proof=Object.fromEntries(['code','building','province','region','regionCode','town','lot'].map(key=>[key,String(identity[key])])),identityKey=createHash('sha256').update(['code','regionCode','province','region','town','lot'].map(key=>String(identity[key]).normalize('NFKC').trim()).join('|')).digest('hex').slice(0,24);
 const queries=SUBJECTS.map(subject=>{const query=[identity.province,identity.region,identity.town,subject.query].join(' ');return {key:subject.key,query,status:['entrance','math'].includes(subject.key)?'received':'unavailable',sourceUrl:searchUrl(query),checkedAt,scope:'town',issues:[],reused:false,complete:false,nearestProven:false,emptyProven:false};});
 const places=[['entrance',ACADEMY_NAME,'입시,보습학원','990000011'],['math',ACADEMY_MATH_NAME,'수학학원','990000012']].map(([key,name,classification,placeId])=>({id:'academy-naver-'+placeId,sourceId:'academy-naver-'+placeId,placeId,name,subjectKeys:[key],classification,address:identity.province+' '+identity.region+' '+identity.town+' 1',sourceUrl:'https://map.naver.com/p/entry/place/'+placeId,searchUrls:[queries.find(q=>q.key===key).sourceUrl],checkedAt}));
 return {version:1,provider:'naver-public-search',identityCode:String(identity.code),identity:proof,identityKey,asOf,status:'partial',places,queries,complete:false,nearestProven:false,emptyProven:false,coordinateVerified:false,scope:'가상 학원 공개정보 출력 검증 · 실제 시설이 아닙니다.',issues:[]};
}
function presentationEvidence(report){
 const legacy=academyRecord(report.prices.buildingResolution,report.input.asOf);report.prices.academyWeb=legacy;report.assessment.evidence.academyWeb=structuredClone(legacy);
 const living=require('../../src/living-access.cjs'),center=report.assessment.evidence.center||{lat:37.5,lng:127};report.assessment.evidence.center=center;
 const stamp=report.input.asOf+'T01:00:00Z';
 const tools=living.QUERIES.map(spec=>{const name=spec.key==='entrance'?ACADEMY_NAME:spec.key==='math'?ACADEMY_MATH_NAME:spec.key==='dental'?HOSPITAL_DETAIL_TEXT:null,lat=center.lat+.002,lng=center.lng,category=spec.key==='entrance'?'교육,학문 > 학원 > 입시학원':spec.key==='math'?'교육,학문 > 학원 > 수학학원':'의료,건강 > 병원 > 치과',p={name,kakao_place_id:spec.key==='entrance'?'990000011':spec.key==='math'?'990000012':'990000013',lat,lng,kakao_category_name:category,distance_m:Math.round(living.distance(center,{lat,lng}))};return {server:'ipzitalk',tool:'search_by_nearby_keyword',arguments:{query:spec.query,center_lat:center.lat,center_lng:center.lng,radius_m:spec.radiusM},result:{structuredContent:{query:spec.query,center,radius_m:spec.radiusM,results:name?[p]:[],metadata:{collected_at:stamp,truncated:false}}}};});
 report.assessment.evidence.livingAccess=living.snapshot(tools,{center,asOf:report.input.asOf});living.apply(report.scores,report.assessment.evidence,{input:report.input});
 report.sections.push({heading:'학원 접근성 세부 정보',body:ACADEMY_DETAIL_TEXT+' 입시학원 | 250m | 40%'});return report;
}
function record(identity,checkedAt=new Date().toISOString()){
 const complexNo='990000001',sourceUrl='https://fin.land.naver.com/complexes/'+complexNo;
 return normalize({complexNo,name:identity.building,addressJibun:[identity.province,identity.region,identity.town,identity.lot].join(' '),...(identity.road?{addressRoad:[identity.province,identity.region,identity.road].join(' ')}:{}),checkedAt,sourceUrl,basic:{approvalDate:'2017-02-01',units:1834,parkingSpaces:2434},publicFacts:[{category:'transport',text:PUBLIC_TEXT,sourceUrl,checkedAt,sourceId:'naver-smoke-public-fact',distanceBasis:'가상 검증용 표시이며 실제 노선 확인 자료가 아닙니다.'}]});
}
function install(service){
 const keys=['findNaverComplex','readNaverNearby','readNaverPage','readAcademyWeb','naverStore','naverLookups','naverNearbyLookups','academyWebLookups'],saved=new Map(keys.map(key=>[key,{present:Object.hasOwn(service,key),value:service[key]}])),calls={find:0,nearby:0,page:0,academy:0,external:0};
 service.findNaverComplex=async()=>{calls.find++;throw Error('가상 배포 검증에서는 네이버 단지를 실제 검색하지 않습니다.');};
 service.readNaverNearby=async()=>{calls.nearby++;return {status:'unavailable',facts:[],issues:['가상 배포 검증에서는 네이버 주변시설을 실제 검색하지 않습니다.']};};
 service.readNaverPage=async()=>{calls.page++;throw Error('가상 배포 검증에서는 네이버 공개 페이지를 실제 열지 않습니다.');};
 service.readAcademyWeb=async()=>{calls.academy++;return {status:'unavailable',places:[],queries:[],issues:['가상 배포 검증에서는 학원 공개 페이지를 실제 검색하지 않습니다.']};};
 service.naverStore=new NaverLandStore();service.naverLookups=new Map();service.naverNearbyLookups=new Map();
 return {calls,restore(){for(const [key,s]of saved)if(s.present)service[key]=s.value;else delete service[key];}};
}
module.exports={PUBLIC_TEXT,ACADEMY_DETAIL_TEXT,ACADEMY_NAME,ACADEMY_MATH_NAME,HOSPITAL_DETAIL_TEXT,academyRecord,presentationEvidence,record,install};
