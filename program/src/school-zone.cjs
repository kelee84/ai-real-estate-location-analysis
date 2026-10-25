'use strict';
const {createHash}=require('node:crypto');
const {todayKst,validDate}=require('./core.cjs');
const JSZip=require('jszip');
const {parse}=require('csv-parse/sync');
const GIS='https://schoolgis.emac.kr/arcgis/rest/services/SCHZONE/EDU_LAYER_SCHOOLZONE_QUERY/MapServer/0/query';
const HOME='https://schoolzone.emac.kr';
let linkCache=null;
function source(key,title,url){return {id:'ev-'+createHash('sha256').update(key).digest('hex').slice(0,12),title,url,checkedAt:todayKst()};}
async function boundedBytes(url,{signal,fetchImpl=fetch,maxBytes=2*1024*1024,headers={}}={}){
 const combined=AbortSignal.any([signal||new AbortController().signal,AbortSignal.timeout(20000)]);let response;
 for(let attempt=0;attempt<2;attempt++)try{response=await fetchImpl(url,{headers:{Accept:'application/json,text/html,*/*',...headers},signal:combined});break;}catch(e){if(signal?.aborted)throw e;if(combined.aborted)throw new Error('공식 자료 서버 응답이 20초를 넘어 조회를 중단했습니다.');if(attempt)throw new Error('공식 자료 서버와 연결하지 못했습니다. 네트워크 또는 서버 응답을 확인해야 합니다.');}
 if(!response.ok)throw new Error('공식 자료 연결 오류 (HTTP '+response.status+')');
 if(Number(response.headers.get('content-length'))>maxBytes)throw new Error('공식 자료가 허용 크기를 초과했습니다.');
 const reader=response.body?.getReader();if(!reader)throw new Error('공식 자료의 응답 본문이 없습니다.');
 let size=0;const chunks=[];try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>maxBytes)throw new Error('공식 자료가 허용 크기를 초과했습니다.');chunks.push(Buffer.from(value));}}catch(e){await reader.cancel().catch(()=>{});throw e;}
 return Buffer.concat(chunks);
}
async function boundedJson(url,options){const bytes=await boundedBytes(url,options);let data;try{data=JSON.parse(bytes.toString('utf8'));}catch{throw new Error('공식 자료의 JSON 형식을 확인하지 못했습니다.');}if(!data||typeof data!=='object'||Array.isArray(data)||data.error)throw new Error('공식 자료가 오류 응답을 반환했습니다.');return data;}
const dataDate=value=>{const s=String(value||'').replace(/[.]/g,'-').replace(/^(\d{4})(\d{2})(\d{2})$/,'$1-$2-$3');return validDate(s)?s:null;};
function attributes(data){
 if(data.exceededTransferLimit||data.has_more||data.truncated)throw new Error('통학구역 결과가 일부만 반환되어 경계를 확인할 수 없습니다.');
 if(!Array.isArray(data.features))throw new Error('공식 통학구역의 필수 항목이 없습니다.');
 if(data.features.length!==1)throw new Error(data.features.length?'단지 기준점 주변이 여러 통학구역 경계에 걸려 있습니다. 동·출입구별 배정을 확인해야 합니다.':'단지 기준점을 포함하는 공식 초등 통학구역을 찾지 못했습니다.');
 const a=data.features[0]?.attributes;if(!a||!/^\d{6}$/.test(String(a.HAKGUDO_ID))||!a.HAKGUDO_NAME||!a.EDU_NM)throw new Error('공식 통학구역의 식별 정보가 없습니다.');return a;
}
function validateZone(a,regionCode,asOf){
 const observed=String(a.SD_CD||'')+String(a.SGG_CD||'').padStart(3,'0');
 if(observed!==regionCode)throw new Error('공식 통학구역의 시군구 코드가 대상 단지와 다릅니다.');
 const updated=dataDate(a.UPDATE_DATE);if(!updated)throw new Error('공식 통학구역의 갱신일을 확인하지 못했습니다.');if(updated>asOf)throw new Error('조회된 통학구역은 분석 기준일 이후 갱신 자료여서 당시 배정 근거로 사용할 수 없습니다.');
 if(String(a.HAKGUDO_CLASS)!=='0')throw new Error('공동·선택 통학구역으로 확인되어 학교별 적용 조건을 확인해야 합니다.');
 return updated;
}
async function schoolLinks(zoneId,{asOf,signal,fetchImpl}){
 const day=todayKst();if(linkCache?.day===day&&linkCache.fetchImpl===fetchImpl&&linkCache.date<=asOf)return linkCache;
 const html=(await boundedBytes(HOME+'/publicData/publicDataList.do',{signal,fetchImpl})).toString('utf8');
 const rows=[...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(m=>m[1]).filter(s=>/학교-학구도\s*연계정보/.test(s));
 const candidate=rows.map(row=>{const date=row.match(/\((\d{4}\.\d{2}\.\d{2})\.?\)/)?.[1],attr=name=>row.match(new RegExp('data-'+name+'=["\u0027]([^"\u0027]+)["\u0027]','i'))?.[1];return {date:dataDate(date),nttId:attr('nttId'),file:attr('atchFileId'),sn:attr('fileSn')};}).filter(c=>c.date&&c.date<=asOf&&/^\d+$/.test(c.nttId||'')&&/^FILE_[A-Za-z0-9_]+$/.test(c.file||'')&&/^\d+$/.test(c.sn||'')).sort((a,b)=>b.date.localeCompare(a.date))[0];
 if(!candidate)throw new Error('분석 기준일에 적용 가능한 공식 학교·학구 연계 파일을 찾지 못했습니다.');
 const params=new URLSearchParams({nttId:candidate.nttId,atchFileId:candidate.file,fileSn:candidate.sn}),url=HOME+'/publicData/publicDataFileDownload.do?'+params;
 const zip=await JSZip.loadAsync(await boundedBytes(url,{signal,fetchImpl}));
 const entries=Object.values(zip.files).filter(f=>!f.dir&&/\.csv$/i.test(f.name));if(entries.length!==1||entries[0]._data?.uncompressedSize>10*1024*1024)throw new Error('공식 학교·학구 연계 파일 형식을 확인하지 못했습니다.');
 const bytes=await entries[0].async('nodebuffer');if(bytes.length>10*1024*1024)throw new Error('공식 학교·학구 연계 파일이 허용 크기를 초과했습니다.');
 let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{text=new TextDecoder('euc-kr',{fatal:true}).decode(bytes);}
 const records=parse(text,{columns:true,bom:true,skip_empty_lines:true});if(!records.length||!['학구ID','학교ID','학교명','학교급구분','데이터기준일자'].every(k=>Object.hasOwn(records[0],k)))throw new Error('공식 학교·학구 연계 파일의 필수 항목이 없습니다.');
 linkCache={day,fetchImpl,date:candidate.date,url,records};return linkCache;
}
async function querySchoolZone({center,identity,asOf,signal,fetchImpl=fetch}={}){
 const checkedAt=new Date().toISOString(),ref=source('official-school-zone:'+identity?.code,'한국교육시설안전원 학구도 · 초등 통학구역',HOME+'/gis/gis.do');
 const base={status:'unavailable',reason:'',source:ref,checkedAt,currentInformation:true};
 try{
  if(!validDate(asOf))throw new Error('분석 기준일이 올바르지 않습니다.');
  if(asOf!==todayKst())throw new Error('공식 학구도는 현재 조회 정보입니다. 과거·미래 기준일의 통학구역을 현재 정보로 대신 평가할 수 없습니다.');
  const lat=Number(center?.lat),lng=Number(center?.lng);if(!Number.isFinite(lat)||!Number.isFinite(lng)||lat<25||lat>45||lng<120||lng>135)throw new Error('대상 단지의 정확한 좌표가 없어 통학구역을 조회할 수 없습니다.');
  const regionCode=String(identity?.regionCode||identity?.sigunguCode||identity?.bjdCode||'').slice(0,5);if(!/^\d{5}$/.test(regionCode))throw new Error('대상 단지의 시군구 코드가 없어 공식 통학구역과 대조할 수 없습니다.');
  const dy=5/111195,dx=dy/Math.cos(lat*Math.PI/180),points=[[lng,lat],[lng+dx,lat],[lng-dx,lat],[lng,lat+dy],[lng,lat-dy]];
  const responses=await Promise.all(points.map(async([x,y])=>{const p=new URLSearchParams({f:'json',geometry:x+','+y,geometryType:'esriGeometryPoint',inSR:'4326',spatialRel:'esriSpatialRelIntersects',outFields:'HAKGUDO_ID,HAKGUDO_NAME,HAKGUDO_CLASS,EDU_NM,SD_CD,SGG_CD,UPDATE_DATE,REMARK,ACPTNC_SE',returnGeometry:'false'});return attributes(await boundedJson(GIS+'?'+p,{signal,fetchImpl}));}));
  const a=responses[0],updatedAt=validateZone(a,regionCode,asOf);for(const other of responses){validateZone(other,regionCode,asOf);if(other.HAKGUDO_ID!==a.HAKGUDO_ID)throw new Error('단지 기준점의 5m 주변에서 통학구역이 달라 동·출입구별 배정 확인이 필요합니다.');}
  const result={...base,status:'verified',reason:'단지 기준점과 동서남북 5m 지점이 같은 공식 초등 통학구역에 포함됩니다. 실제 입학 배정·공동학구 조건은 관할 교육지원청에 최종 확인해야 합니다.',zoneId:String(a.HAKGUDO_ID),name:String(a.HAKGUDO_NAME).slice(0,300),updatedAt,educationOffice:String(a.EDU_NM).slice(0,120),zoneClass:String(a.HAKGUDO_CLASS),regionCode,referencePoint:{lat,lng},schoolNames:[],schools:[],remark:a.REMARK?String(a.REMARK).slice(0,500):null};
  try{const links=await schoolLinks(result.zoneId,{asOf,signal,fetchImpl});const schools=links.records.filter(r=>r['학구ID']==='Z000'+result.zoneId&&r['학교급구분']==='초등학교'&&/^B\d{9}$/.test(r['학교ID'])&&dataDate(r['데이터기준일자'])&&r['데이터기준일자']<=asOf).map(r=>({id:r['학교ID'],name:r['학교명'],sourceDate:r['데이터기준일자']}));result.schools=[...new Map(schools.map(s=>[s.id,s])).values()];result.schoolNames=result.schools.map(s=>s.name);result.schoolSource=source('school-zone-link:'+links.date,'한국교육시설안전원 학교·학구 연계정보 · '+links.date,links.url);if(!result.schools.length)result.schoolLookupReason='공식 학교·학구 연계 파일에서 해당 학구의 초등학교를 확인하지 못했습니다.';}catch(e){if(signal?.aborted)throw e;result.schoolLookupReason=e.message;}
  return result;
 }catch(e){if(signal?.aborted)throw e;return {...base,reason:e.message};}
}
module.exports={querySchoolZone,boundedBytes,boundedJson,dataDate,attributes,validateZone};
