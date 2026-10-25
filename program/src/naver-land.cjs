'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {todayKst,validDate}=require('./core.cjs');
const identityRules=require('./property-identity.cjs');
const MAX_BYTES=1024*1024;
const PROVINCES={서울:'서울',서울시:'서울',서울특별시:'서울',부산:'부산',부산시:'부산',부산광역시:'부산',대구:'대구',대구시:'대구',대구광역시:'대구',인천:'인천',인천시:'인천',인천광역시:'인천',광주:'광주',광주시:'광주',광주광역시:'광주',대전:'대전',대전시:'대전',대전광역시:'대전',울산:'울산',울산시:'울산',울산광역시:'울산',세종:'세종',세종시:'세종',세종특별자치시:'세종',경기:'경기',경기도:'경기',강원:'강원',강원도:'강원',강원특별자치도:'강원',충북:'충북',충청북도:'충북',충남:'충남',충청남도:'충남',전북:'전북',전라북도:'전북',전북특별자치도:'전북',전남:'전남',전라남도:'전남',경북:'경북',경상북도:'경북',경남:'경남',경상남도:'경남',제주:'제주',제주도:'제주',제주특별자치도:'제주'};
function text(value,max){return typeof value==='string'?value.normalize('NFKC').replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,max):'';}
function point(value){return typeof value?.lat==='number'&&typeof value?.lng==='number'&&Number.isFinite(value.lat)&&Number.isFinite(value.lng)&&value.lat>=25&&value.lat<=45&&value.lng>=120&&value.lng<=135?{lat:value.lat,lng:value.lng}:null;}
function numeric(value){if(typeof value==='number')return Number.isFinite(value)?value:null;if(typeof value!=='string'||!/^\d+(?:\.\d+)?$/.test(value.trim()))return null;const n=Number(value);return Number.isFinite(n)?n:null;}
function count(value,allowZero=false){const n=typeof value==='string'?numeric(value.replace(/,/g,'')):numeric(value);return Number.isInteger(n)&&n>=(allowZero?0:1)&&n<=10000000?n:null;}
function stamp(value){
 if(typeof value!=='string')return null;
 if(validDate(value)){const time=Date.parse(value+'T00:00:00+09:00');return time<=Date.now()?{time,day:value}:null;}
 if(!validDate(value.slice(0,10))||!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value))return null;
 const time=Date.parse(value);return Number.isFinite(time)&&time<=Date.now()?{time,day:todayKst(new Date(time))}:null;
}
function addressFacts(value){
 const address=text(value,400),match=address.match(/^(.+?)\s+([^\s]+(?:동|리|읍|면|가))\s+((?:산\s*)?\d+(?:-\d+)?)(?=\s|$)/);
 if(!match)return null;const prefix=match[1].split(' '),province=PROVINCES[prefix[0]];
 if(!province||province!=='세종'&&prefix.length<2||prefix.slice(1).some(v=>!/(?:시|군|구|읍|면)$/.test(v)))return null;
 return {address,province,regions:prefix.slice(1),town:match[2]};
}
function sourceUrl(value,complexNo){
 let url;try{url=new URL(value);}catch{throw Error('네이버 단지정보의 출처 주소를 확인해 주세요.');}
 const match=url.pathname.match(/^\/complexes\/([1-9]\d{0,19})\/?$/);
 if(url.protocol!=='https:'||!['new.land.naver.com','fin.land.naver.com'].includes(url.hostname)||url.port||url.username||url.password||!match||match[1]!==complexNo)throw Error('네이버 단지번호와 단지정보 출처 주소가 일치하지 않습니다.');
 return url.origin+'/complexes/'+complexNo;
}
function normalize(value){
 if(typeof value==='string'){if(Buffer.byteLength(value)>MAX_BYTES)throw Error('네이버 단지정보 파일이 너무 큽니다.');try{value=JSON.parse(value);}catch{throw Error('네이버 단지정보 JSON을 확인해 주세요.');}}
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('네이버 공개 단지정보를 확인해 주세요.');
 const native=value.complexDetail&&typeof value.complexDetail==='object'&&!Array.isArray(value.complexDetail),detail=native?value.complexDetail:value;
 const complexNo=String(detail.complexNo??'').trim(),name=text(native?detail.complexName:detail.name,120),address=addressFacts(native?detail.address:detail.addressJibun),checkedAt=typeof value.checkedAt==='string'?value.checkedAt.trim():'',checked=stamp(checkedAt);
 if(!/^[1-9]\d{0,19}$/.test(complexNo)||name.length<2||!address||!checked)throw Error('네이버 단지번호·이름·전체 지번주소·조회일을 확인해 주세요. 미래 조회일은 사용할 수 없습니다.');
 const record={complexNo,name,addressJibun:address.address,checkedAt,sourceUrl:sourceUrl(value.sourceUrl,complexNo)},road=text(native?detail.roadAddress:detail.addressRoad,400);
 if(road)record.addressRoad=road;
 const rawLat=native?detail.latitude:detail.lat,rawLng=native?detail.longitude:detail.lng,hasLat=rawLat!==undefined&&rawLat!==null&&rawLat!=='',hasLng=rawLng!==undefined&&rawLng!==null&&rawLng!=='';
 if(hasLat||hasLng){
  const coords=point({lat:numeric(rawLat),lng:numeric(rawLng)});
  if(!coords||!native&&value.coordinateBasis!=='complex'||native&&value.coordinateBasis!==undefined&&value.coordinateBasis!=='complex')throw Error('네이버 좌표는 확인된 단지 기준점만 사용할 수 있습니다. 지도 중심·검색 좌표를 단지 위치로 대신하지 마세요.');
  Object.assign(record,coords,{coordinateBasis:'complex'});
 }
 const basicInput=native?detail:value.basic,basic={};
 if(basicInput&&typeof basicInput==='object'){
  const approval=text(native?basicInput.useApproveYmd:basicInput.approvalDate,16).replace(/^(\d{4})(\d{2})(\d{2})$/,'$1-$2-$3'),units=count(native?basicInput.totalHouseholdCount:basicInput.units),parking=count(native?basicInput.totalParkingCount:basicInput.parkingSpaces,true);
  if(validDate(approval)&&approval<=checked.day)basic.approvalDate=approval;
  if(units!==null)basic.units=units;if(parking!==null)basic.parkingSpaces=parking;
 }
 if(Object.keys(basic).length)record.basic=basic;
 const facts=[];for(const fact of Array.isArray(value.publicFacts)?value.publicFacts:[]){
  if(!fact||!['transport','education','daily'].includes(fact.category))continue;const content=text(fact.text,1200),factStamp=stamp(fact.checkedAt);let url;try{url=sourceUrl(fact.sourceUrl,complexNo);}catch{continue;}
  if(!content||!factStamp||factStamp.day!==checked.day||/학업|학급당|교사당|학생\s*수|성적|성취|순위|입시\s*실적|합격|(?:token|cookie|password|secret|api.?key)\s*[:=]|\b0\d[\d-]{7,}\b/i.test(content))continue;
  const entry={category:fact.category,text:content,sourceUrl:url,checkedAt:fact.checkedAt};const basis=text(fact.distanceBasis,200);if(basis)entry.distanceBasis=basis;if(typeof fact.sourceId==='string'&&/^[A-Za-z0-9._:-]{1,120}$/.test(fact.sourceId))entry.sourceId=fact.sourceId;
  if(!facts.some(f=>f.category===entry.category&&f.text===entry.text))facts.push(entry);if(facts.length>=12)break;
 }
 if(facts.length)record.publicFacts=facts;
 return record;
}
function distance(a,b){const rad=n=>n*Math.PI/180,v=Math.sin(rad(b.lat-a.lat)/2)**2+Math.cos(rad(a.lat))*Math.cos(rad(b.lat))*Math.sin(rad(b.lng-a.lng)/2)**2;return 6371008.8*2*Math.atan2(Math.sqrt(v),Math.sqrt(Math.max(0,1-v)));}
function current(value,{identity,asOf}={}){
 try{
  const record=normalize(value);if(asOf!==todayKst()||stamp(record.checkedAt)?.day!==asOf||!identity?.code||!identity.building||!identity.province||!identity.region||!identity.town||!identity.lot||!/^\d{5}$/.test(String(identity.regionCode||'')))return false;
  if(!identityRules.matchesKaptIdentity(identity,{name:record.name,addressJibun:record.addressJibun,addressRoad:record.addressRoad}))return false;
  const official=point(identity),coords=point(record);return !(official&&coords&&distance(official,coords)>100);
 }catch{return false;}
}
function targetRegion(input){
 const parts=text(input.target,400).split(' '),province=PROVINCES[parts[0]],regions=[];let at=province?1:0;
 while(at<parts.length&&/(?:시|군|구|동|리|읍|면|가)$/.test(parts[at]))regions.push(parts[at++]);
 return {province,regions};
}
function candidates(input,records){
 if(input?.asset&&input.asset!=='apartment'||input?.asOf&&input.asOf!==todayKst())return [];
 let name;try{name=identityRules.requestedName(input||{});}catch{return [];}
 if(!name)return [];const requested=targetRegion(input),found=new Map();
 for(const value of Array.isArray(records)?records:[])try{
  const record=normalize(value),facts=addressFacts(record.addressJibun);
  if(stamp(record.checkedAt)?.day!==todayKst()||identityRules.identityConflict(name,record.name)||!identityRules.compatibleName(name,record.name))continue;
  if(requested.province&&requested.province!==facts.province||requested.regions.some(r=>![...facts.regions,facts.town].includes(r)))continue;
  const previous=found.get(record.complexNo);if(!previous||stamp(previous.checkedAt).time<stamp(record.checkedAt).time)found.set(record.complexNo,record);
 }catch{}
 return [...found.values()].map(r=>({id:'naver-'+r.complexNo,name:r.name,address:r.addressJibun,...(r.addressRoad?{road:r.addressRoad}:{}),...(point(r)?{lat:r.lat,lng:r.lng}:{}),naverComplexNo:r.complexNo,naverSource:r.sourceUrl,naverCheckedAt:r.checkedAt}));
}
class NaverLandStore{
 constructor(root){this.root=root?path.join(path.resolve(root),'naver-land-cache'):null;this.records=new Map();}
 async import(value){
  const record=normalize(value);if(this.root){await fs.mkdir(this.root,{recursive:true});const file=path.join(this.root,record.complexNo+'.json'),temp=path.join(this.root,record.complexNo+'.'+randomUUID()+'.tmp');try{await fs.writeFile(temp,JSON.stringify(record,null,2),'utf8');await fs.rename(temp,file);}finally{await fs.rm(temp,{force:true}).catch(()=>{});}}
  this.records.set(record.complexNo,record);return structuredClone(record);
 }
 async list(asOf=todayKst()){
  if(asOf!==todayKst())return [];const found=new Map(this.records);
  if(this.root)try{for(const file of await fs.readdir(this.root)){if(!/^[1-9]\d{0,19}\.json$/.test(file))continue;try{const full=path.join(this.root,file),stat=await fs.stat(full);if(!stat.isFile()||stat.size>MAX_BYTES)continue;const record=normalize(await fs.readFile(full,'utf8'));if(file!==record.complexNo+'.json')continue;const previous=found.get(record.complexNo);if(!previous||stamp(previous.checkedAt).time<stamp(record.checkedAt).time)found.set(record.complexNo,record);}catch{}}}catch(error){if(error.code!=='ENOENT')throw error;}
  return [...found.values()].filter(r=>stamp(r.checkedAt)?.day===asOf).map(r=>structuredClone(r));
 }
 async forIdentity(input,prices){const values=(await this.list(input.asOf)).filter(r=>current(r,{identity:prices?.buildingResolution,asOf:input.asOf}));return values.length===1?values[0]:null;}
}
module.exports={normalize,current,candidates,NaverLandStore};
