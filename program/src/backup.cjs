'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),{randomUUID}=require('node:crypto'),{gzipSync,gunzipSync}=require('node:zlib');
const ALLOWED=['RTMS-trade.csv','RTMS-rent.csv','RTMS-trend-trade.csv','query.json','trend-query.json','naver-land.json','archhub.json','sbiz-snapshot.json','hospital-snapshot.json','naver-nearby.json','nearby-context.json','research-evidence.json','living-access.json','shopping-evidence.json','score-evidence.json','future-developments.json','map-capture.json','map-repair.json'];
const allowedRaw=name=>ALLOWED.includes(name)||/^[ABC]-/.test(name)&&ALLOWED.includes(name.slice(2));
const allowedFigure=name=>/^[ABC]-map\.png$/.test(name);
async function pack(store){const reports=[];for(const item of await store.list()){
  const report=await store.load(item.id),raw={};for(const name of [...ALLOWED,...['A','B','C'].flatMap(k=>ALLOWED.map(n=>k+'-'+n))])try{raw[name]=(await fs.readFile(path.join(store.path(item.id),'raw',name))).toString('base64');}catch{}
  let image=null;if(report.map?.file)try{image=(await fs.readFile(path.join(store.path(item.id),'figures',path.basename(report.map.file)))).toString('base64');}catch{}
  const figures={};if(report.mode==='comparison')for(const m of report.members){if(!m.map?.file)continue;const name=m.key+'-map.png';try{figures[name]=(await fs.readFile(path.join(store.path(item.id),'figures',path.basename(m.map.file)))).toString('base64');}catch{}}
  reports.push({report,raw,image,figures});
}return gzipSync(Buffer.from(JSON.stringify({version:1,reports})));}
async function unpack(store,bytes){
  if(bytes.length>100*1024*1024)throw new Error('백업 파일이 너무 큽니다.');
  const data=JSON.parse(gunzipSync(bytes,{maxOutputLength:200*1024*1024}).toString());
  if(data.version!==1||!Array.isArray(data.reports)||data.reports.length>500)throw new Error('지원하지 않는 백업 파일입니다.');
  for(const item of data.reports){const r=item.report;if(!r?.input?.target||!r?.prices?.period||!Array.isArray(r.scores)||!Array.isArray(r.sources)||!r.createdAt||!Array.isArray(r.sections))throw new Error('백업의 보고서 형식이 올바르지 않습니다.');if(r.mode==='comparison'&&(!Array.isArray(r.members)||r.members.length<2||r.members.length>3||r.members.some((m,i)=>m.key!==String.fromCharCode(65+i)||!m.input?.target||!m.prices?.period||!Array.isArray(m.scores))))throw new Error('비교 보고서 형식이 올바르지 않습니다.');for(const [name,value]of Object.entries(item.raw||{}))if(!allowedRaw(name)||typeof value!=='string'||!/^[a-zA-Z0-9+/=]*$/.test(value))throw new Error('백업 원자료 형식이 올바르지 않습니다.');for(const [name,value]of Object.entries(item.figures||{}))if(!allowedFigure(name)||typeof value!=='string'||!/^[a-zA-Z0-9+/=]+$/.test(value))throw new Error('백업 지도 형식이 올바르지 않습니다.');if(item.image&&(typeof item.image!=='string'||!/^[a-zA-Z0-9+/=]+$/.test(item.image)))throw new Error('백업 지도 형식이 올바르지 않습니다.');}
  const saved=[];for(const item of data.reports){const r={...item.report,id:randomUUID(),restoredAt:new Date().toISOString()};
    if(item.image){await fs.mkdir(path.join(store.path(r.id),'figures'),{recursive:true});await fs.writeFile(path.join(store.path(r.id),'figures','ipjitalk-map.png'),Buffer.from(item.image,'base64'));r.map={...r.map,file:'ipjitalk-map.png'};}else r.map=null;
    if(r.mode==='comparison')for(const m of r.members){const name=m.key+'-map.png',data=item.figures?.[name];if(data){await fs.mkdir(path.join(store.path(r.id),'figures'),{recursive:true});await fs.writeFile(path.join(store.path(r.id),'figures',name),Buffer.from(data,'base64'));m.map={...m.map,file:name};}else m.map=null;}
    if(Object.keys(item.raw||{}).length){await fs.mkdir(path.join(store.path(r.id),'raw'),{recursive:true});for(const [name,value]of Object.entries(item.raw))await fs.writeFile(path.join(store.path(r.id),'raw',name),Buffer.from(value,'base64'));}
    await store.save(r);saved.push(r.id);
  }return {count:saved.length,ids:saved};
}
module.exports={pack,unpack};
