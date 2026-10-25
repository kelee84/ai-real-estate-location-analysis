'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),{createHash,randomUUID}=require('node:crypto');
const {todayKst}=require('./core.cjs');
const VERSION='seoul-public-hospitals-v1',PROVIDER='seoul-hospital-register',INDEX_VERSION='seoul-public-hospitals-index-v1';
const DATASETS=['OA-16479','OA-16480'],DOWNLOAD='https://datafile.seoul.go.kr/bigfile/iot/sheet/json/download.do';
const SOURCE=id=>`https://data.seoul.go.kr/dataList/${id}/S/1/datasetView.do`;
// EPSG:5174, as declared by Seoul. Seven-parameter Korean 1985 -> WGS84
// transformation; independent coordinate fixture: github.com/3liz/proj4rs.
const CRS='+proj=tmerc +lat_0=38 +lon_0=127.002890277778 +k=1 +x_0=200000 +y_0=500000 +ellps=bessel +towgs84=-145.907,505.034,685.756,-1.162,2.347,1.592,6.342 +units=m +no_defs';
const RADII={general:5000,pediatrics:1500,orthopedics:1500,dental:1500};
const HEADER={MGTNO:'관리번호',BPLCNM:'사업장명',TRDSTATEGBN:'영업상태코드',TRDSTATENM:'영업상태명',DTLSTATEGBN:'상세영업상태코드',DTLSTATENM:'상세영업상태명',DCBYMD:'폐업일자',APVCANCELYMD:'인허가취소일자',CLGSTDT:'휴업시작일자',CLGENDDT:'휴업종료일자',APVPERMYMD:'인허가일자',SITEWHLADDR:'지번주소',RDNWHLADDR:'도로명주소',UPTAENM:'업태구분명',UPDATEDT:'데이터갱신일자',X:'좌표정보(X)',Y:'좌표정보(Y)'};
const CLINIC_HEADER={METRORGASSRNM:'의료기관종별명',MEDEXTRITEMSCNNM:'진료과목내용명'};
const clean=v=>String(v??'').trim(),hash=v=>createHash('sha256').update(typeof v==='string'||Buffer.isBuffer(v)?v:JSON.stringify(v)).digest('hex');
const hex=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v),a=()=>require('./living-access.cjs');
function abort(signal){if(signal?.aborted)throw Error('공식 병원자료 조회를 중지했습니다.');}
function date(v){return typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;}
function validDate(v,asOf,maxAge=7){return date(v)&&date(asOf)&&v<=asOf&&(Date.parse(asOf)-Date.parse(v))/86400000<=maxAge;}
function stamp(v){return typeof v==='string'&&Number.isFinite(Date.parse(v));}
function identityEqual(x,y){return !!x&&!!y&&['code','regionCode','town','lot'].every(k=>clean(x[k])===clean(y[k]))&&!!clean(x.code)&&!!clean(x.town)&&!!clean(x.lot)&&/^11\d{3}$/.test(clean(x.regionCode));}
let projection;
function projected(x,y){
 if(clean(x)===''||clean(y)===''||!Number.isFinite(Number(x))||!Number.isFinite(Number(y))||Number(x)<150000||Number(x)>230000||Number(y)<400000||Number(y)>480000)return null;
 try{projection||=require('proj4')(CRS,'EPSG:4326');const [lng,lat]=projection.forward([Number(x),Number(y)]);return lat>=37.3&&lat<=37.8&&lng>=126.7&&lng<=127.3?{lat,lng}:null;}catch{return null;}
}
function fields(id){return {...HEADER,...(id==='OA-16480'?CLINIC_HEADER:{})};}
function classifyRaw(row,id){
 if(!DATASETS.includes(id)||!row||row.trdstategbn!=='01'||row.trdstatenm!=='영업/정상'||row.dtlstategbn!=='13'||row.dtlstatenm!=='영업중'||clean(row.dcbymd)||clean(row.apvcancelymd)||/폐업|휴업|공사\s*중|개원\s*예정/.test(clean(row.bplcnm)))return [];
 if(clean(row.clgstdt)&&(!date(clean(row.clgenddt))||clean(row.clgenddt)>=todayKst()))return [];
 if(id==='OA-16479')return row.uptaenm==='종합병원'?['general']:row.uptaenm==='치과병원'?['dental']:[];
 if(row.metrorgassrnm==='치과의원'&&row.uptaenm==='치과의원')return ['dental'];
 if(row.metrorgassrnm!=='의원'||row.uptaenm!=='의원'||typeof row.medextritemscnnm!=='string')return [];
 const subjects=row.medextritemscnnm.split(',').map(clean);return [subjects.includes('소아청소년과')?'pediatrics':null,subjects.includes('정형외과')?'orthopedics':null].filter(Boolean);
}
function validRaw(row,id,asOf){
 if(!row||Object.keys(fields(id)).some(k=>typeof row[k.toLowerCase()]!=='string')||!/^PHMA[A-Za-z0-9]+$/.test(row.mgtno)||!clean(row.bplcnm)||row.bplcnm.length>200||/\uFFFD/.test(row.bplcnm)||!/^서울특별시\s/.test(clean(row.rdnwhladdr)||clean(row.sitewhladdr)))return false;
 if(!date(clean(row.apvpermymd))||clean(row.apvpermymd)>asOf||!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(row.updatedt)||!stamp(row.updatedt.replace(' ','T')+'+09:00')||row.updatedt.slice(0,10)>asOf)return false;
 return !!projected(row.x,row.y)&&Object.values(row).every(v=>typeof v==='string'&&v.length<3000);
}
function metadata(html,id,asOf){
 const m=html.match(/데이터 갱신일<\/th>[\s\S]{0,160}?<span[^>]*>(\d{4})\.(\d{2})\.(\d{2})\.<\/span>/),sourceDate=m?m.slice(1).join('-'):null;
 if(!DATASETS.includes(id)||!html.includes(id)||!html.includes(id==='OA-16479'?'서울시 병원 인허가 정보':'서울시 의원 인허가 정보')||!html.includes('EPSG:5174')||!html.includes('3일전 자료')||!validDate(sourceDate,asOf))throw Error('서울시 병원자료의 갱신일·좌표계·자료 시차를 확인하지 못했습니다.');
 return {datasetId:id,sourceUrl:SOURCE(id),sourceDate,dataLagDays:3,crs:'EPSG:5174',metadataSha256:hash(html)};
}
function parseDataset(bytes,meta,checkedAt){
 const body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)),required=fields(meta.datasetId);
 if(!Array.isArray(body.DATA)||body.DATA.length<1||body.DATA.length>100000||Object.entries(required).some(([k,v])=>body.DESCRIPTION?.[k]!==v))throw Error('서울시 병원자료의 전체 파일·열을 확인하지 못했습니다.');
 const records=[],seen=new Set();let rejected=0;
 for(const row of body.DATA){const selected=Object.fromEntries(Object.keys(required).map(k=>[k.toLowerCase(),row[k.toLowerCase()]]));if(!classifyRaw(selected,meta.datasetId).length)continue;if(!validRaw(selected,meta.datasetId,meta.sourceDate)){rejected++;continue;}if(seen.has(selected.mgtno))throw Error('서울시 병원자료의 관리번호가 중복됩니다.');seen.add(selected.mgtno);records.push(selected);}
 return {...meta,downloadedAt:checkedAt,sha256:hash(bytes),bytes:bytes.length,rowsRead:body.DATA.length,selectedRows:records.length,rejectedRows:rejected,requiredHeaders:required,records,complete:true};
}
function validFile(f,asOf){
 return !!f&&DATASETS.includes(f.datasetId)&&f.sourceUrl===SOURCE(f.datasetId)&&validDate(f.sourceDate,asOf)&&f.dataLagDays===3&&f.crs==='EPSG:5174'&&hex(f.metadataSha256)&&hex(f.sha256)&&stamp(f.downloadedAt)&&Date.parse(f.downloadedAt)<=Date.now()+1000&&todayKst(new Date(f.downloadedAt))>=f.sourceDate&&Number.isInteger(f.bytes)&&f.bytes>100&&f.bytes<=64*1024*1024&&f.complete===true&&Number.isInteger(f.rowsRead)&&f.rowsRead>0&&f.rowsRead<=100000&&Number.isInteger(f.selectedRows)&&f.selectedRows>=0&&f.selectedRows<=f.rowsRead&&Number.isInteger(f.rejectedRows)&&f.rejectedRows>=0&&Object.entries(fields(f.datasetId)).every(([k,v])=>f.requiredHeaders?.[k]===v);
}
function origin(snapshot,{center,identity,asOf}={}){
 if(snapshot?.version!==VERSION||snapshot.provider!==PROVIDER||snapshot.asOf!==asOf||!date(asOf)||asOf>todayKst()||!stamp(snapshot.checkedAt)||todayKst(new Date(snapshot.checkedAt))!==asOf||Date.parse(snapshot.checkedAt)>Date.now()+1000||!a().point(center)||!a().point(snapshot.center)||a().distance(center,snapshot.center)>2||!identityEqual(snapshot.identity,identity||snapshot.identity)||!Array.isArray(snapshot.files)||snapshot.files.length!==2||new Set(snapshot.files.map(f=>f.datasetId)).size!==2||snapshot.files.some(f=>!validFile(f,asOf)||Date.parse(f.downloadedAt)>Date.parse(snapshot.checkedAt)))return false;
 if(a().point(snapshot.identity)&&a().distance(snapshot.identity,snapshot.center)>2)return false;
 return snapshot.sourceDate===snapshot.files.map(f=>f.sourceDate).sort()[0]&&snapshot.dataLagDays===3;
}
function verified(snapshot,context={}){
 if(!origin(snapshot,context))return false;
 for(const [key,radiusM]of Object.entries(RADII)){
  const group=snapshot.groups?.[key];if(!group||group.radiusM!==radiusM||!Array.isArray(group.rows)||new Set(group.rows.map(r=>r?.datasetId+':'+r?.raw?.mgtno)).size!==group.rows.length)return false;
  for(const entry of group.rows){const f=snapshot.files.find(f=>f.datasetId===entry?.datasetId);if(!f||!validRaw(entry.raw,f.datasetId,f.sourceDate)||!classifyRaw(entry.raw,f.datasetId).includes(key)||a().distance(context.center,projected(entry.raw.x,entry.raw.y))>radiusM)return false;}
 }
 return true;
}
function proofOf(s){return structuredClone(Object.fromEntries(['version','provider','asOf','identity','center','sourceDate','dataLagDays','checkedAt','files'].map(k=>[k,s[k]])));}
function normalize(entry,key,proof){
 const raw=entry.raw,f=proof.files.find(f=>f.datasetId===entry.datasetId),p=projected(raw.x,raw.y),id='seoul-health-'+raw.mgtno;
 return {id,provider:PROVIDER,category:key,name:clean(raw.bplcnm),...p,address:clean(raw.rdnwhladdr)||clean(raw.sitewhladdr),distanceM:Math.round(a().distance(proof.center,p)),distanceBasis:'단지 기준점과 공식 인허가 등록 좌표(EPSG:5174→WGS84) 사이의 직선거리',registeredType:clean(raw.metrorgassrnm)||clean(raw.uptaenm),registeredSubjects:raw.medextritemscnnm||null,sourceId:'ev-public-hospital-'+hash(f.sha256+':'+id).slice(0,16),url:f.sourceUrl,sourceDate:f.sourceDate,dataLagDays:3,checkedAt:proof.checkedAt,downloadedAt:f.downloadedAt,rowUpdatedAt:raw.updatedt,rawRecord:structuredClone(raw),datasetId:entry.datasetId,rawHash:hash(raw),hospitalProof:proof};
}
function nearest(snapshot,key,context={}){if(!Object.hasOwn(RADII,key)||!verified(snapshot,context))return null;const proof=proofOf(snapshot);return snapshot.groups[key].rows.map(e=>normalize(e,key,proof)).sort((x,y)=>x.distanceM-y.distanceM||x.id.localeCompare(y.id))[0]||null;}
function validPlace(p,context={}){
 if(p?.provider!==PROVIDER||!Object.hasOwn(RADII,p.category)||!origin(p.hospitalProof,context))return false;const f=p.hospitalProof.files.find(f=>f.datasetId===p.datasetId);
 if(!f||!validRaw(p.rawRecord,p.datasetId,f.sourceDate)||!classifyRaw(p.rawRecord,p.datasetId).includes(p.category)||p.rawHash!==hash(p.rawRecord))return false;
 const expected=normalize({datasetId:p.datasetId,raw:p.rawRecord},p.category,p.hospitalProof);return expected.distanceM<=RADII[p.category]&&Object.keys(expected).filter(k=>!['rawRecord','hospitalProof'].includes(k)).every(k=>p[k]===expected[k]);
}
function source(p){return {id:p.sourceId,title:'서울특별시 병원·의원 인허가정보 · '+p.name+' ('+p.sourceDate+' 갱신·3일 시차)',url:p.url,checkedAt:p.checkedAt,sourceDate:p.sourceDate,downloadedAt:p.downloadedAt};}
function category(snapshot,key,context={}){const p=nearest(snapshot,key,context);if(!p)return null;const spec=a().SPECS.find(s=>s.key===key);return {key,label:spec.label,weight:spec.weight,radiusM:spec.radiusM,status:'observed',complete:false,limited:false,nearest:p,points:a().points(key,p.distanceM),queries:[],places:[p],hospitalEvidence:structuredClone(snapshot),sourceDate:p.sourceDate,dataLagDays:3};}
function validCategory(c,context={}){if(!c?.hospitalEvidence||!Object.hasOwn(RADII,c.key))return false;const expected=category(c.hospitalEvidence,c.key,context);return !!expected&&['key','label','weight','radiusM','status','complete','limited','points','sourceDate','dataLagDays'].every(k=>c[k]===expected[k])&&Array.isArray(c.queries)&&c.queries.length===0&&!c.batch&&validPlace(c.nearest,context)&&hash(c.nearest)===hash(expected.nearest)&&Array.isArray(c.places)&&c.places.length===1&&hash(c.places[0])===hash(c.nearest);}
function mergeLiving(existing,snapshot,context={}){
 const living=a(),saved=living.upgradeSnapshot(existing,context);if(!verified(snapshot,context))return saved;
 const additions=Object.fromEntries(Object.keys(RADII).map(k=>[k,category(snapshot,k,context)]));if(!Object.values(additions).some(Boolean))return saved;
 const out=saved||{version:living.VERSION,asOf:context.asOf,center:{...context.center},checkedAt:snapshot.checkedAt,groups:{},scope:'등록 시설의 직선 접근성 평가. 서울시 의료기관 인허가정보는 3일 시차가 있으며 현재 진료·운영·전문의 여부는 별도 확인합니다.'};
 for(const group of ['hospital','academy']){const categories=(out.groups[group]?.categories||living.SPECS.filter(s=>s.group===group).map(living.unavailableCategory)).map(c=>additions[c.key]&&(c.status==='unavailable'||c.nearest?.provider===PROVIDER)?additions[c.key]:c);out.groups[group]={categories,complete:categories.every(c=>c.complete),queries:categories.flatMap(c=>[...c.queries,...(c.batch?[c.batch]:[])])};}
 out.checkedAt=[out.checkedAt,snapshot.checkedAt].filter(Boolean).sort().at(-1);return living.validSnapshot(out,context)?out:saved;
}
async function response(fetcher,url,{signal,body,maxBytes=64*1024*1024}={}){
 abort(signal);const timeout=AbortSignal.timeout(60000),r=await fetcher(url,{method:body?'POST':'GET',...(body?{headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(body)}:{}),redirect:'error',signal:signal?AbortSignal.any([signal,timeout]):timeout});if(!r.ok)throw Error('서울시 병원자료 응답 오류 '+r.status);
 let size=0;const chunks=[];for await(const chunk of r.body){abort(signal);size+=chunk.length;if(size>maxBytes)throw Error('서울시 병원자료 파일 크기를 초과했습니다.');chunks.push(Buffer.from(chunk));}abort(signal);return Buffer.concat(chunks);
}
class HospitalStore{
 constructor(root,{fetcher=globalThis.fetch}={}){this.root=path.join(root,'public-hospital-cache');this.fetcher=fetcher;this.pending=null;this.loaded=null;}
 validIndex(index,asOf=todayKst()){return index?.version===INDEX_VERSION&&stamp(index.checkedAt)&&todayKst(new Date(index.checkedAt))===asOf&&Date.parse(index.checkedAt)<=Date.now()+1000&&Array.isArray(index.files)&&index.files.length===2&&new Set(index.files.map(f=>f.datasetId)).size===2&&index.files.every(f=>validFile(f,asOf)&&Array.isArray(f.records)&&f.records.length===f.selectedRows&&new Set(f.records.map(r=>r.mgtno)).size===f.records.length&&f.records.every(r=>validRaw(r,f.datasetId,f.sourceDate)&&classifyRaw(r,f.datasetId).length));}
 async read(){if(this.validIndex(this.loaded))return this.loaded;try{const file=path.join(this.root,'index.json'),stat=await fs.lstat(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>40*1024*1024)return null;const wrapper=JSON.parse(await fs.readFile(file,'utf8'));if(wrapper.sha256!==hash(wrapper.value)||!this.validIndex(wrapper.value))return null;this.loaded=wrapper.value;return this.loaded;}catch{return null;}}
 async save(value){if(!this.validIndex(value))throw Error('공식 병원자료 저장 검증에 실패했습니다.');await fs.mkdir(this.root,{recursive:true});const file=path.join(this.root,randomUUID()+'.tmp');try{await fs.writeFile(file,JSON.stringify({sha256:hash(value),value}),{flag:'wx'});await fs.rename(file,path.join(this.root,'index.json'));this.loaded=value;}finally{await fs.rm(file,{force:true}).catch(()=>{});}}
 async ensure(options={}){abort(options.signal);if(this.pending)return this.pending;this.pending=this.load(options);try{return await this.pending;}finally{this.pending=null;}}
 async load({signal,onProgress=()=>{},forceRefresh=false}={}){const saved=!forceRefresh&&await this.read();if(saved)return saved;const files=[];for(const id of DATASETS){abort(signal);onProgress('서울시 '+(id==='OA-16479'?'병원':'의원')+' 인허가 등록자료를 확인하고 있습니다.');const html=(await response(this.fetcher,SOURCE(id),{signal,maxBytes:3*1024*1024})).toString('utf8'),meta=metadata(html,id,todayKst()),bytes=await response(this.fetcher,DOWNLOAD,{signal,body:{srvType:'S',infId:id,serviceKind:'1',pageNo:'1',ssUserId:'SAMPLE_VIEW',strWhere:'',strOrderby:'',filterCol:'',txtFilter:''}});files.push(parseDataset(bytes,meta,new Date().toISOString()));}abort(signal);const index={version:INDEX_VERSION,checkedAt:new Date().toISOString(),files};await this.save(index);return index;}
 async nearby(input,prices,options={}){
  const identity=prices?.buildingResolution,center=a().point(identity);if(input?.asset!=='apartment'||input.asOf!==todayKst()||!center||!identityEqual(identity,identity))return null;
  const index=await this.ensure(options);abort(options.signal);const groups=Object.fromEntries(Object.entries(RADII).map(([key,radiusM])=>[key,{radiusM,rows:[]}])) ;
  for(const f of index.files)for(const raw of f.records)for(const key of classifyRaw(raw,f.datasetId))if(a().distance(center,projected(raw.x,raw.y))<=RADII[key])groups[key].rows.push({datasetId:f.datasetId,raw:structuredClone(raw)});
  const files=index.files.map(({records,...f})=>f);return {version:VERSION,provider:PROVIDER,asOf:input.asOf,identity:structuredClone(identity),center,checkedAt:new Date().toISOString(),sourceDate:files.map(f=>f.sourceDate).sort()[0],dataLagDays:3,files,groups,scope:'서울시 병원·의원 인허가 등록자료의 종별·진료과목 및 등록 좌표를 사용합니다. 자료는 3일 시차가 있으며 실제 진료·운영·전문의 여부는 별도 확인합니다.'};
 }
}
module.exports={VERSION,PROVIDER,INDEX_VERSION,DATASETS,DOWNLOAD,SOURCE,CRS,RADII,HEADER,CLINIC_HEADER,projected,metadata,parseDataset,classifyRaw,validRaw,verified,nearest,validPlace,category,validCategory,mergeLiving,source,HospitalStore,Store:HospitalStore};
