'use strict';
// Official quarterly CSV ingestion. These records never impersonate live
// business checks, Kakao responses, or IpziTalk requests.
const fs=require('node:fs/promises'),fsSync=require('node:fs'),path=require('node:path'),{createHash,randomUUID}=require('node:crypto');
const {Readable,Transform}=require('node:stream'),{pipeline}=require('node:stream/promises');
const {parse}=require('csv-parse'),unzipper=require('unzipper');
const {todayKst}=require('./core.cjs');
const VERSION='sbiz-csv-index-v1',SNAPSHOT_VERSION='sbiz-nearby-v1';
const SOURCE='https://www.data.go.kr/data/15083033/fileData.do',ORIGIN='https://www.data.go.kr';
const FIELDS=['상가업소번호','상호명','지점명','상권업종대분류코드','상권업종대분류명','상권업종중분류코드','상권업종중분류명','상권업종소분류코드','상권업종소분류명','표준산업분류코드','표준산업분류명','시도코드','시도명','시군구코드','시군구명','법정동코드','법정동명','지번주소','도로명주소','경도','위도'];
const PROVINCES=['강원','경기','경남','경북','대구','대전','부산','서울','세종','울산','인천','전남광주','전북','제주','충남','충북'];
const MAX_ZIP=500*1024*1024,MAX_INDEX=160*1024*1024,MAX_ROWS=6000000;
const sha=b=>createHash('sha256').update(b).digest('hex');
function point(p){const lat=Number(p?.lat),lng=Number(p?.lng);return p?.lat!=null&&p?.lng!=null&&Number.isFinite(lat)&&Number.isFinite(lng)&&lat>=25&&lat<=45&&lng>=120&&lng<=135?{lat,lng}:null;}
function distance(a,b){const r=n=>n*Math.PI/180,x=r(b.lat-a.lat),y=r(b.lng-a.lng),v=Math.sin(x/2)**2+Math.cos(r(a.lat))*Math.cos(r(b.lat))*Math.sin(y/2)**2;return 6371008.8*2*Math.atan2(Math.sqrt(v),Math.sqrt(Math.max(0,1-v)));}
function abort(signal){if(signal?.aborted)throw Error('공식 상권자료 조회를 중지했습니다.');}
function currentDate(date,day=todayKst()){const t=Date.parse(date+'T00:00:00+09:00'),n=Date.parse(day+'T00:00:00+09:00');return /^\d{4}-\d{2}-\d{2}$/.test(date||'')&&Number.isFinite(t)&&new Date(t+9*3600000).toISOString().slice(0,10)===date&&t<=n&&n-t<=180*86400000;}
function classifyRaw(r){
 const code=r?.['상권업종소분류코드'],label=r?.['상권업종소분류명'],ksic=r?.['표준산업분류코드'],ksicName=r?.['표준산업분류명'],name=String(r?.['상호명']||'')+' '+String(r?.['지점명']||'');
 if(/폐업|폐점|휴업|예정|공사중/.test(name))return null;
 if(code==='P10501'&&label==='입시·교과학원'&&ksic==='P85501'&&ksicName==='일반 교과학원'&&!/대학교|대학원|초등학교|중학교|고등학교|유치원|어린이집|보육|출판|서점|교구|학습지|방문|재택|홈스쿨|고시원|독서실/.test(name))return 'entrance';
 if(code==='G20404'&&label==='슈퍼마켓'&&ksic==='G47121'&&ksicName==='슈퍼마켓'&&!/편의점|씨유|\bCU\b|GS25|세븐일레븐|이마트24|미니스톱|롯데리아|버거|맥도날드|식당|카페|커피|약국|치과|안경|미용|주차|주유|문화센터|푸드코트|세탁|전자|하이마트|신발|의류|입점|매장내/i.test(name))return 'supermarket';
 // The observed schema has no unambiguous large-mart/whole-mall class. Keep
 // this category unfilled; a supermarket or brand name cannot establish it.
 return null;
}
function validRaw(r){
 return r&&FIELDS.every(k=>typeof r[k]==='string')&&/^[A-Za-z0-9_-]{1,60}$/.test(r['상가업소번호'])&&r['상호명'].trim()&&r['상호명'].length<=160&&/^\d{5}$/.test(r['시군구코드'])&&/^\d{10}$/.test(r['법정동코드'])&&r['법정동코드'].startsWith(r['시군구코드'])&&r['지번주소'].length>5&&r['지번주소'].length<500&&point({lat:r['위도'],lng:r['경도']})&&FIELDS.every(k=>r[k].length<1000);
}
function parseMetadata(html,data){
 const title=html.match(/<title>\s*소상공인시장진흥공단_상가\(상권\)정보_(\d{8})\s*\|/),detail=html.match(/id="publicDataDetailPk"[^>]*value="([A-Za-z0-9:._-]+)"/);
 if(!title||!detail)throw Error('공식 상권자료의 파일 기준일·식별정보를 확인하지 못했습니다.');
 const d=title[1],sourceDate=d.slice(0,4)+'-'+d.slice(4,6)+'-'+d.slice(6),info=data?.dataSetFileDetailInfo;
 if(!currentDate(sourceDate)||data?.status!==true||!/^FILE_\d+$/.test(data.atchFileId||'')||!/^\d+$/.test(String(data.fileDetailSn))||info?.publicDataPk!=='15083033'||info?.publicDataDetailPk!==detail[1]||!String(info?.dataNm||info?.orginlFileNm||'').includes(d))throw Error('공식 상권자료의 날짜·파일 출처가 맞지 않습니다.');
 return {sourceDate,detailPk:detail[1],fileId:data.atchFileId,fileDetailSn:String(data.fileDetailSn),sourceUrl:SOURCE,downloadUrl:ORIGIN+'/cmm/cmm/fileDownload.do?'+new URLSearchParams({atchFileId:data.atchFileId,fileDetailSn:String(data.fileDetailSn)}),nextReleaseDate:info.nextRegistPrarnde||null};
}
async function request(fetcher,url,{signal,body,maxBytes=3*1024*1024}={}){
 abort(signal);const u=new URL(url);if(u.origin!==ORIGIN)throw Error('공식 상권자료 출처가 아닙니다.');
 const timed=AbortSignal.timeout(30000),response=await fetcher(url,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/x-www-form-urlencoded'}:{},...(body?{body:new URLSearchParams(body)}:{}),signal:signal?AbortSignal.any([signal,timed]):timed,redirect:'error'});
 if(!response.ok)throw Error('공식 상권자료 응답 오류 '+response.status);
 let size=0;const chunks=[];for await(const chunk of Readable.fromWeb(response.body)){size+=chunk.length;if(size>maxBytes)throw Error('공식 상권자료 응답 크기를 초과했습니다.');chunks.push(chunk);}abort(signal);return Buffer.concat(chunks).toString('utf8');
}
async function discover(fetcher,{signal}={}){
 const html=await request(fetcher,SOURCE,{signal}),detail=html.match(/id="publicDataDetailPk"[^>]*value="([A-Za-z0-9:._-]+)"/);if(!detail)throw Error('공식 상권자료 파일 식별정보를 확인하지 못했습니다.');
 const data=JSON.parse(await request(fetcher,ORIGIN+'/tcs/dss/selectFileDataDownload.do',{signal,body:{publicDataDetailPk:detail[1],publicDataPk:'15083033',atchFileId:'',fileDetailSn:'1',publicDataTyCode:'PR0051'}}));return parseMetadata(html,data);
}
async function download(fetcher,meta,file,{signal,onProgress=()=>{}}={}){
 if(meta?.sourceUrl!==SOURCE||!/^FILE_\d+$/.test(meta?.fileId||'')||!/^\d+$/.test(meta?.fileDetailSn||'')||meta.downloadUrl!==ORIGIN+'/cmm/cmm/fileDownload.do?'+new URLSearchParams({atchFileId:meta.fileId,fileDetailSn:meta.fileDetailSn}))throw Error('공식 상권자료 다운로드 출처가 맞지 않습니다.');
 const limit=JSON.parse(await request(fetcher,ORIGIN+'/cmm/cmm/check-limit.json',{signal,body:{atchFileId:meta.fileId,fileDetailSn:meta.fileDetailSn}}));
 if(limit.needCaptcha!==false)throw Error('공공데이터포털 다운로드 확인이 필요해 상권자료 자동 갱신을 보류했습니다.');
 abort(signal);const timed=AbortSignal.timeout(8*60*1000),response=await fetcher(meta.downloadUrl,{signal:signal?AbortSignal.any([signal,timed]):timed,redirect:'error'});
 if(!response.ok)throw Error('공식 상권자료 다운로드 오류 '+response.status);const declared=Number(response.headers.get('content-length'));
 if(!Number.isInteger(declared)||declared<1000||declared>MAX_ZIP)throw Error('공식 상권자료 다운로드 크기를 확인하지 못했습니다.');
 let bytes=0,last=0;const hash=createHash('sha256');
 await pipeline(Readable.fromWeb(response.body),new Transform({transform(chunk,encoding,cb){try{abort(signal);bytes+=chunk.length;if(bytes>MAX_ZIP)throw Error('상권 원자료 크기 제한을 초과했습니다.');hash.update(chunk);if(bytes-last>=32*1024*1024){last=bytes;onProgress('공식 상권자료 다운로드 '+Math.round(bytes/1024/1024)+'MB / '+Math.round(declared/1024/1024)+'MB');}cb(null,chunk);}catch(e){cb(e);}}}),fsSync.createWriteStream(file,{flags:'wx'}));
 if(bytes!==declared)throw Error('공식 상권자료 다운로드가 완전하지 않습니다.');return {bytes,sha256:hash.digest('hex'),downloadedAt:new Date().toISOString()};
}
function entryName(entry){return entry.isUnicode?entry.path:new TextDecoder('euc-kr',{fatal:true}).decode(entry.pathBuffer);}
async function buildIndex(zipPath,meta,proof,{signal,onProgress=()=>{}}={}){
 abort(signal);if(!/^[a-f0-9]{64}$/.test(proof?.sha256||''))throw Error('상권 원자료 해시가 없습니다.');
 const zipStat=await fs.lstat(zipPath);if(!zipStat.isFile()||zipStat.isSymbolicLink()||zipStat.size!==proof.bytes||zipStat.size>MAX_ZIP)throw Error('상권 원자료 크기가 다운로드 기록과 다릅니다.');
 const zipHash=createHash('sha256');for await(const chunk of fsSync.createReadStream(zipPath)){abort(signal);zipHash.update(chunk);}if(zipHash.digest('hex')!==proof.sha256)throw Error('상권 원자료 해시가 다운로드 기록과 다릅니다.');
 const directory=await unzipper.Open.file(zipPath),files=directory.files.filter(e=>e.type==='File'&&/\.csv$/i.test(e.path));
 if(files.length!==16||directory.files.length>32)throw Error('전국 상권자료 파일 구성이 불완전합니다.');
 const month=meta.sourceDate.replaceAll('-','').slice(0,6),names=files.map(entryName),expected=PROVINCES.map(p=>'소상공인시장진흥공단_상가(상권)정보_'+p+'_'+month+'.csv');
 if(new Set(names).size!==16||expected.some(n=>!names.includes(n))||files.some(e=>e.uncompressedSize<=1000||e.uncompressedSize>700*1024*1024)||files.reduce((n,e)=>n+e.uncompressedSize,0)>3*1024*1024*1024)throw Error('전국 상권자료 파일명·크기가 기준과 다릅니다.');
 const rows=[],entryHashes=[],seen=new Set();let rowsRead=0,rejected=0;
 for(const [index,entry]of files.entries()){
  abort(signal);onProgress('공식 상권자료 분류·좌표 정리 '+(index+1)+'/16');let count=0,bytes=0;const hash=createHash('sha256');
  const source=entry.stream(),meter=new Transform({transform(chunk,encoding,cb){bytes+=chunk.length;if(bytes>entry.uncompressedSize)return cb(Error('공식 상권자료 CSV 크기가 압축 기록과 다릅니다.'));hash.update(chunk);cb(null,chunk);}}),parser=parse({bom:true,columns:headers=>{if(new Set(headers).size!==headers.length||FIELDS.some(k=>!headers.includes(k)))throw Error('공식 상권자료 CSV 열이 불완전합니다.');return headers;},max_record_size:20000,skip_empty_lines:true});
  const onAbort=()=>source.destroy(Error('공식 상권자료 조회를 중지했습니다.'));signal?.addEventListener('abort',onAbort,{once:true});
  const piping=pipeline(source,meter,parser).catch(e=>{parser.destroy(e);throw e;});piping.catch(()=>{});
  try{for await(const raw of parser){abort(signal);count++;rowsRead++;if(rowsRead>MAX_ROWS)throw Error('전국 상권자료 행 제한을 초과했습니다.');const category=classifyRaw(raw);if(!category)continue;const r=Object.fromEntries(FIELDS.map(k=>[k,String(raw[k]??'')]));if(!validRaw(r)){rejected++;continue;}const id=r['상가업소번호'];if(seen.has(id))throw Error('전국 상권자료 업소번호가 중복됩니다.');seen.add(id);rows.push(r);}await piping;}
  finally{signal?.removeEventListener('abort',onAbort);source.destroy();parser.destroy();}
  if(bytes!==entry.uncompressedSize||!count)throw Error('전국 상권자료 CSV를 끝까지 읽지 못했습니다.');entryHashes.push({name:names[index],sha256:hash.digest('hex'),rowsRead:count,bytes});
 }
 const checkedAt=new Date().toISOString();return {version:VERSION,provider:'sbiz-csv',...meta,downloadedAt:proof.downloadedAt,checkedAt,manifest:{sha256:proof.sha256,zipBytes:proof.bytes,entryHashes,requiredHeaders:FIELDS,rowsRead,selectedRows:rows.length,rejectedRows:rejected,complete:true},rows};
}
function validIndex(v){
 if(v?.version!==VERSION||v.provider!=='sbiz-csv'||v.sourceUrl!==SOURCE||!currentDate(v.sourceDate)||!Number.isFinite(Date.parse(v.downloadedAt))||Date.parse(v.downloadedAt)>Date.now()||!Number.isFinite(Date.parse(v.checkedAt))||Date.parse(v.checkedAt)>Date.now()||!/^FILE_\d+$/.test(v.fileId||'')||!/^\d+$/.test(v.fileDetailSn||''))return false;
 const m=v.manifest,month=v.sourceDate.replaceAll('-','').slice(0,6),names=PROVINCES.map(p=>'소상공인시장진흥공단_상가(상권)정보_'+p+'_'+month+'.csv');
 return v.downloadUrl===ORIGIN+'/cmm/cmm/fileDownload.do?'+new URLSearchParams({atchFileId:v.fileId,fileDetailSn:v.fileDetailSn})&&m?.complete===true&&/^[a-f0-9]{64}$/.test(m.sha256||'')&&Number.isInteger(m.zipBytes)&&m.zipBytes>0&&m.zipBytes<=MAX_ZIP&&Array.isArray(m.requiredHeaders)&&FIELDS.every(k=>m.requiredHeaders.includes(k))&&Array.isArray(m.entryHashes)&&m.entryHashes.length===16&&new Set(m.entryHashes.map(e=>e.name)).size===16&&m.entryHashes.every(e=>names.includes(e.name)&&/^[a-f0-9]{64}$/.test(e.sha256||'')&&Number.isInteger(e.rowsRead)&&e.rowsRead>0&&Number.isInteger(e.bytes)&&e.bytes>1000)&&m.rowsRead===m.entryHashes.reduce((n,e)=>n+e.rowsRead,0)&&m.rowsRead<=MAX_ROWS&&Array.isArray(v.rows)&&v.rows.length===m.selectedRows&&new Set(v.rows.map(r=>r['상가업소번호'])).size===v.rows.length&&v.rows.every(r=>validRaw(r)&&classifyRaw(r));
}
class SbizStore{
 constructor(root,{fetcher=globalThis.fetch}={}){this.root=path.join(root,'sbiz-cache');this.fetcher=fetcher;this.loaded=null;this.pending=null;}
 async read(){if(this.loaded&&currentDate(this.loaded.sourceDate))return this.loaded;this.loaded=null;try{const file=path.join(this.root,'index.json'),stat=await fs.lstat(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>MAX_INDEX)return null;const wrapper=JSON.parse(await fs.readFile(file,'utf8'));if(wrapper.sha256!==sha(JSON.stringify(wrapper.value))||!validIndex(wrapper.value))return null;this.loaded=wrapper.value;return this.loaded;}catch{return null;}}
 async save(value){if(!validIndex(value))throw Error('공식 상권자료 저장 검증에 실패했습니다.');const data=JSON.stringify({sha256:sha(JSON.stringify(value)),value});if(Buffer.byteLength(data)>MAX_INDEX)throw Error('상권자료 저장 크기를 초과했습니다.');await fs.mkdir(this.root,{recursive:true});const tmp=path.join(this.root,randomUUID()+'.tmp');try{await fs.writeFile(tmp,data,{flag:'wx'});await fs.rename(tmp,path.join(this.root,'index.json'));this.loaded=value;}finally{await fs.rm(tmp,{force:true}).catch(()=>{});}}
 async ensure(options={}){
  abort(options.signal);if(this.pending)return this.pending;
  this.pending=this.load(options);try{return await this.pending;}finally{this.pending=null;}
 }
 async load({signal,onProgress=()=>{},forceRefresh=false}={}){
  const saved=await this.read(),day=todayKst();if(saved&&!forceRefresh&&todayKst(new Date(saved.checkedAt))===day)return saved;
  const meta=await discover(this.fetcher,{signal});abort(signal);
  if(saved&&saved.fileId===meta.fileId&&saved.sourceDate===meta.sourceDate){const updated={...saved,checkedAt:new Date().toISOString()};await this.save(updated);return updated;}
  await fs.mkdir(this.root,{recursive:true});const zip=path.join(this.root,'download-'+randomUUID()+'.zip');
  try{onProgress('공식 상권 CSV를 처음 내려받습니다. 분기 자료는 한 번 저장한 뒤 재사용합니다.');const proof=await download(this.fetcher,meta,zip,{signal,onProgress});const value=await buildIndex(zip,meta,proof,{signal,onProgress});await this.save(value);return value;}finally{await fs.rm(zip,{force:true}).catch(()=>{});}
 }
 async nearby(input,prices,options={}){
  const i=prices?.buildingResolution,center=point(i);if(input?.asset!=='apartment'||input.asOf!==todayKst()||!i?.code||!/^\d{5}$/.test(String(i.regionCode||''))||!i.town||!i.lot||!center)return null;
  const data=await this.ensure(options);abort(options.signal);const groups={entrance:{radiusM:1500,rows:[]},mart_large:{radiusM:5000,rows:[]},supermarket:{radiusM:1500,rows:[]}};
  for(const raw of data.rows){const kind=classifyRaw(raw),group=groups[kind];if(group&&distance(center,{lat:Number(raw['위도']),lng:Number(raw['경도'])})<=group.radiusM)group.rows.push(raw);}
  for(const group of Object.values(groups))group.rows.sort((a,b)=>distance(center,{lat:Number(a['위도']),lng:Number(a['경도'])})-distance(center,{lat:Number(b['위도']),lng:Number(b['경도'])})||a['상가업소번호'].localeCompare(b['상가업소번호']));
  return {version:SNAPSHOT_VERSION,provider:'sbiz-csv',asOf:input.asOf,checkedAt:new Date().toISOString(),sourceDate:data.sourceDate,downloadedAt:data.downloadedAt,sourceUrl:SOURCE,downloadUrl:data.downloadUrl,identity:structuredClone(i),center,manifest:structuredClone(data.manifest),groups:structuredClone(groups),scope:'공식 분기 CSV의 등록 업종·주소·좌표 기준입니다. 자료 기준일 이후 운영·폐업·신설이나 실제 출입구·도보 동선은 확인하지 않았습니다.'};
 }
}
module.exports={VERSION,SNAPSHOT_VERSION,SOURCE,FIELDS,PROVINCES,SbizStore,Store:SbizStore,classifyRaw,validRaw,currentDate,parseMetadata,discover,download,buildIndex,validIndex};
