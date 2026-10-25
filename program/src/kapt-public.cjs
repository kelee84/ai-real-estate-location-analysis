'use strict';
const {createHash}=require('node:crypto');
const {todayKst,validDate}=require('./core.cjs');
const {boundedJson,dataDate}=require('./school-zone.cjs');
const {matchesKaptIdentity}=require('./property-identity.cjs');
function count(value,{max=100000,zero=true}={}){if(value==null||String(value).trim()==='')return null;const n=Number(value);return Number.isInteger(n)&&n>=(zero?0:1)&&n<=max?n:null;}
function facts(data,{kaptCode,identity,asOf}){
 const k=data.resultMap_kapt,match=data.resultMap_match,addresses=data.resultMap_kapt_addrList;
 if(!k||!match||!Array.isArray(addresses))throw new Error('K-apt 공개 상세정보의 필수 항목을 확인하지 못했습니다.');
 if(k.kaptCode!==kaptCode||match.kaptCode!==kaptCode||String(match.townCode)!==String(identity?.code))throw new Error('K-apt 상세정보의 단지 식별번호가 공식 실거래 단지와 다릅니다.');
 if(!identity?.town||!identity?.lot)throw new Error('대상 단지의 법정동·지번이 없어 K-apt 상세정보와 대조할 수 없습니다.');
 const byType=type=>[...new Set(addresses.filter(a=>a.addrGbn===type&&a.kaptCode===kaptCode).map(a=>a.addr).filter(a=>typeof a==='string'&&a.trim()))],jibun=byType('B'),roads=byType('R');
 if(jibun.length!==1||roads.length>1)throw new Error('K-apt 상세정보의 주소 후보가 없거나 여러 곳이어서 대상 단지를 특정할 수 없습니다.');
 const address=jibun[0];
 if(!matchesKaptIdentity(identity,{name:k.kaptName,officialCode:match.townCode,addressJibun:address,addressRoad:roads[0]},{requireOfficialCode:true}))throw new Error('K-apt 상세정보의 단지명·지역·법정동·지번이 분석 대상과 다릅니다.');
 const approvalDate=dataDate(k.kaptUsedate);if(!approvalDate||approvalDate>asOf)throw new Error('K-apt 사용승인일이 없거나 분석 기준일 이후여서 상품 조건을 검증할 수 없습니다.');
 const units=count(k.kaptdaTCnt,{zero:false}),parkingGround=count(k.kaptdPcnt),parkingUnderground=count(k.kaptdPcntu),parkingTotal=parkingGround!=null&&parkingUnderground!=null?parkingGround+parkingUnderground:null;
 return {kaptCode,name:String(k.kaptName).slice(0,160),address:String(address).slice(0,250),approvalDate,units,hallType:['계단식','복도식','혼합식'].includes(k.codeHall)?k.codeHall:null,structure:typeof k.codeStr==='string'?k.codeStr.slice(0,80):null,parkingGround,parkingUnderground,parkingTotal:parkingTotal>0?parkingTotal:null,elevators:count(k.kaptdEcntTotal,{max:2000}),cctv:count(k.kaptdCccnt,{max:20000}),managementType:typeof k.codeMgr==='string'?k.codeMgr.slice(0,80):null};
}
async function queryPublicKapt({kaptCode,identity,asOf,signal,fetchImpl=fetch}={}){
 const url='https://www.k-apt.go.kr/kaptinfo/getKaptInfo_detail.do?kaptCode='+encodeURIComponent(kaptCode||''),source={id:'ev-'+createHash('sha256').update('kapt-public:'+kaptCode).digest('hex').slice(0,12),title:'국토교통부 K-apt · 공개 관리시설정보',url,checkedAt:todayKst()},base={status:'unavailable',reason:'',source,checkedAt:new Date().toISOString(),currentInformation:true};
 try{
  if(!/^[A-Za-z0-9]{5,30}$/.test(kaptCode||''))throw new Error('K-apt 단지코드를 확인하지 못했습니다.');
  if(!validDate(asOf))throw new Error('분석 기준일이 올바르지 않습니다.');if(asOf!==todayKst())throw new Error('K-apt 관리시설은 현재 조회 정보입니다. 과거·미래 기준일의 주차·상품 조건을 현재 정보로 대신 평가할 수 없습니다.');
  const data=await boundedJson(url,{signal,fetchImpl,headers:{Referer:'https://www.k-apt.go.kr/kaptinfo/openKaptMng.do'}});
  return {...base,status:'verified',reason:'공식 실거래 단지번호·K-apt 코드·단지명·법정동·지번을 대조한 현재 공개 등록 정보입니다. 실제 가용 주차·평면·향·관리 상태는 별도 확인이 필요합니다.',...facts(data,{kaptCode,identity,asOf})};
 }catch(e){if(signal?.aborted)throw e;return {...base,reason:e.message};}
}
module.exports={queryPublicKapt,facts,count};
