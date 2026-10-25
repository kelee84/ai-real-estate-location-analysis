'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),{createHash,randomUUID}=require('node:crypto');
const {todayKst}=require('./core.cjs');
const access=require('./living-access.cjs');
const VERSION='2026-10-18-public-research-v1';
const ALLOWED=new Set(['get_complex_info_by_query','get_complex_info_batch','find_complexes_near_point','get_geocode','search_by_nearby_category','search_by_nearby_keyword','get_map_embed_url']);
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function scope(input,prices){
 const i=prices?.buildingResolution,naver=require('./naver-land.cjs').current(prices?.naverLand,{identity:i,asOf:input.asOf})?prices.naverLand:null,c=access.point(i)||access.point(naver);
 // Area, customer conditions and notes never identify public complex evidence.
 if(!i?.code||!i.town||!i.lot||!/^\d{5}$/.test(String(i.regionCode||''))||!c||input.asOf!==todayKst())return null;
 return {version:VERSION,day:input.asOf,code:String(i.code),regionCode:String(i.regionCode),town:String(i.town),lot:String(i.lot),lat:c.lat,lng:c.lng};
}
function data(t){const r=t?.result;if(r?.structuredContent)return r.structuredContent;for(const c of r?.content||[])if(c.type==='text')try{return JSON.parse(c.text);}catch{}return null;}
function toolError(t){const d=data(t);return d?.error||t?.error||(t?.result?.isError?'TOOL_ERROR':null);}
function categoryRequestCovers(available,requested){return Number(available?.center_lat)===Number(requested?.center_lat)&&Number(available?.center_lng)===Number(requested?.center_lng)&&Number(available?.radius_m)===Number(requested?.radius_m)&&JSON.stringify(available?.subcategory_filter??null)===JSON.stringify(requested?.subcategory_filter??null)&&Array.isArray(available?.categories)&&Array.isArray(requested?.categories)&&requested.categories.length>0&&requested.categories.every(c=>available.categories.includes(c));}
function covers(t,tool,args,day){
 if(t?.tool!==tool)return false;
 if(JSON.stringify(t.arguments)===JSON.stringify(args))return true;
 if(tool!=='search_by_nearby_category'||!reusable(t,day))return false;
 const d=data(t),returned=Object.keys(d.results||{}).filter(c=>Array.isArray(d.results[c])),available={...t.arguments,categories:[...new Set([...(t.arguments?.categories||[]),...returned])]},center=access.point({lat:args.center_lat,lng:args.center_lng});return categoryRequestCovers(available,args)&&center&&access.point(d.center)&&access.distance(center,d.center)<=2&&Number(d.radius_m)===Number(args.radius_m)&&args.categories.every(c=>Array.isArray(d.results?.[c]));
}
function reusable(t,day){
 if(t?.server!=='ipzitalk'||!ALLOWED.has(t.tool)||toolError(t))return false;
 const d=data(t);if(!d||typeof d!=='object')return false;
 if(t.tool==='get_complex_info_batch')return Array.isArray(d.results)&&d.results.length>0&&d.results.every(r=>r.status==='success'&&Number.isFinite(Date.parse(r.data?.metadata?.collected_at))&&todayKst(new Date(r.data.metadata.collected_at))===day);
 if(t.tool==='get_map_embed_url'){
  const expires=d.expires_at||d.expire_at||d.metadata?.expires_at;
  // Links without a verifiable expiry are cheap to recreate and never cached.
  return !!expires&&Date.parse(expires)>Date.now()+60000;
 }
 const stamp=d.metadata?.collected_at;
 return Number.isFinite(Date.parse(stamp))&&todayKst(new Date(stamp))===day;
}
class ResearchCache{
 constructor(root){this.root=root?path.join(root,'public-research-cache'):null;this.categoryRecords=new Map();this.categoryLoads=new Map();this.pending=new Map();}
 key(scopeValue,tool,args){return scopeValue&&ALLOWED.has(tool)?hash({scope:scopeValue,tool,args}):null;}
 async get(s,tool,args){
  const key=this.key(s,tool,args);if(!this.root||!key)return null;
  try{const file=path.join(this.root,key+'.json'),stat=await fs.stat(file);if(stat.size<=4*1024*1024){const v=JSON.parse(await fs.readFile(file,'utf8'));if(v.version===VERSION&&JSON.stringify(v.scope)===JSON.stringify(s)&&v.tool===tool&&JSON.stringify(v.arguments)===JSON.stringify(args)&&reusable(v.value,s.day))return v.value;}}catch{}
  if(tool!=='search_by_nearby_category')return null;
  const scopeKey=hash(s);if(!this.categoryLoads.has(scopeKey))this.categoryLoads.set(scopeKey,(async()=>{const values=this.categoryRecords.get(scopeKey)||[];try{for(const name of (await fs.readdir(this.root)).filter(n=>/^[a-f0-9]{64}\.json$/.test(n)).slice(0,512))try{const file=path.join(this.root,name),stat=await fs.stat(file);if(stat.size>4*1024*1024)continue;const v=JSON.parse(await fs.readFile(file,'utf8'));if(v.version===VERSION&&JSON.stringify(v.scope)===JSON.stringify(s)&&v.tool==='search_by_nearby_category'&&reusable(v.value,s.day))values.push(v.value);}catch{}}catch{}this.categoryRecords.set(scopeKey,values);})());
  await this.categoryLoads.get(scopeKey);return (this.categoryRecords.get(scopeKey)||[]).find(t=>covers(t,tool,args,s.day))||null;
 }
 async put(s,tool,args,value){
  const key=this.key(s,tool,args);if(!this.root||!key||!reusable(value,s.day))return;
  if(tool==='search_by_nearby_category'){const scopeKey=hash(s),values=this.categoryRecords.get(scopeKey)||[];values.push(structuredClone(value));this.categoryRecords.set(scopeKey,values);}
  const content=JSON.stringify({version:VERSION,scope:s,tool,arguments:args,value});if(Buffer.byteLength(content)>4*1024*1024)return;
  const temp=path.join(this.root,key+'.'+randomUUID()+'.tmp');
  try{await fs.mkdir(this.root,{recursive:true});await fs.writeFile(temp,content);await fs.rename(temp,path.join(this.root,key+'.json'));}catch{}finally{await fs.rm(temp,{force:true}).catch(()=>{});}
 }
 async coalesce(s,tool,args,load){
  if(!s)return {value:await load(),reused:false};
  const key=this.key(s,tool,args),same=JSON.stringify(s);
  for(const entry of this.pending.values())if(entry.scope===same&&entry.tool===tool&&(JSON.stringify(entry.args)===JSON.stringify(args)||tool==='search_by_nearby_category'&&categoryRequestCovers(entry.args,args))){const value=await entry.promise;if(covers(value,tool,args,s.day))return {value,reused:true};}
  const promise=Promise.resolve().then(load);this.pending.set(key,{scope:same,tool,args,promise});try{return {value:await promise,reused:false};}finally{if(this.pending.get(key)?.promise===promise)this.pending.delete(key);}
 }
 async snapshot(s,name,load,{forceRefresh=false,accept=v=>v?.status==='verified'}={}){
  if(!['school','nature','natureAccess','futureDevelopments','nearbyContext','naverNearby','academyWeb'].includes(name))throw new Error('지원하지 않는 공공자료입니다.');
  const file=this.root&&s?path.join(this.root,hash({scope:s,name})+'.json'):null;
  if(file&&!forceRefresh)try{const stat=await fs.stat(file);if(stat.size<4*1024*1024){const v=JSON.parse(await fs.readFile(file,'utf8'));if(v.version===VERSION&&JSON.stringify(v.scope)===JSON.stringify(s)&&v.name===name&&accept(v.value))return v.value;}}catch{}
  const value=await load();if(!file||!accept(value))return value;
  const text=JSON.stringify({version:VERSION,scope:s,name,value});if(Buffer.byteLength(text)>4*1024*1024)return value;
  const temp=file+'.'+randomUUID()+'.tmp';try{await fs.mkdir(this.root,{recursive:true});await fs.writeFile(temp,text);await fs.rename(temp,file);}catch{}finally{await fs.rm(temp,{force:true}).catch(()=>{});}return value;
 }
 async prune(){
  if(!this.root)return;try{const names=(await fs.readdir(this.root)).filter(n=>/^[a-f0-9]{64}\.json$/.test(n));const files=await Promise.all(names.map(async name=>({name,stat:await fs.stat(path.join(this.root,name)).catch(()=>null)})));files.sort((a,b)=>(b.stat?.mtimeMs||0)-(a.stat?.mtimeMs||0));await Promise.all(files.filter((f,i)=>i>=512||Date.now()-(f.stat?.mtimeMs||0)>2*86400000).map(f=>fs.rm(path.join(this.root,f.name),{force:true})));}catch{}
 }
}
function publicSnapshot(cache,input,prices,name,load,accept,options={}){return cache?cache.snapshot(scope(input,prices),name,load,{accept,...options}):load();}
module.exports={VERSION,ResearchCache,scope,data,toolError,reusable,publicSnapshot,covers,categoryRequestCovers};
