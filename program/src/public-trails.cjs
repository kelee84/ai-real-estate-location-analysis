'use strict';
const {todayKst}=require('./core.cjs');
const CATALOGUE_URL='https://map.seoul.go.kr/smgis2/short/6OR2Z',CATALOGUE_VERSION='seoul-theme-routes-v1';
function safeUrl(value){try{const u=new URL(value);return u.protocol==='https:'&&u.hostname==='map.seoul.go.kr'&&u.pathname==='/smgis2/poiViewMap'&&/^\d{1,12}$/.test(u.searchParams.get('ti'))&&/^[A-Za-z0-9_-]{1,40}$/.test(u.searchParams.get('pi'))&&!u.username&&!u.password?u:null;}catch{return null;}}
// Read the geometry already rendered by the public city map. Page keys, cookies,
// scripts and authentication state never leave the isolated page.
const STATE=`(()=>{try{if(!content_body||!geojsonLayer)return null;return {name:String(content_body.cot_conts_name||'').slice(0,120),theme:String(content_body.cot_theme_id||''),id:String(content_body.cot_conts_id||''),updatedAt:String(content_body.cot_update_date||'').slice(0,40),geometry:geojsonLayer.toGeoJSON()}}catch{return null}})()`;
// The public whole-theme map already downloads these geometries for display.
// Read only route fields from that state; never copy or replay page API keys.
const CATALOGUE_STATE=`(()=>{try{const t=themeData?.['100715'],b=theme_bodys?.find(x=>String(x.thm_theme_id)==='100715');if(!Array.isArray(t?.features)||!b)return null;return {theme:'100715',declaredCount:Number(b.thm_contents_count),rows:t.features.slice(0,501).map(f=>{const p=f.properties||{},g=typeof p.cot_coord_data==='string'?JSON.parse(p.cot_coord_data):p.cot_coord_data;return {name:String(p.cot_conts_name||'').slice(0,120),theme:String(p.cot_theme_id||''),id:String(p.cot_conts_id||''),category:String(p.sub_cate_name||'').slice(0,80),geometry:g,updatedAt:String(p.cot_update_date||'').slice(0,40)}})}}catch{return null}})()`;
function validCatalogue(v,{asOf=todayKst()}={}){
 if(v?.version!==CATALOGUE_VERSION||v.sourceUrl!==CATALOGUE_URL||v.theme!=='100715'||v.complete!==true||!Number.isFinite(Date.parse(v.checkedAt))||Date.parse(v.checkedAt)>Date.now()||todayKst(new Date(v.checkedAt))!==asOf||!Number.isInteger(v.declaredCount)||v.declaredCount<1||v.declaredCount>500||!Array.isArray(v.rows)||v.rows.length!==v.declaredCount)return false;
 const geometry=g=>{if(!['LineString','MultiLineString'].includes(g?.type)||!Array.isArray(g.coordinates))return false;const paths=g.type==='LineString'?[g.coordinates]:g.coordinates;return paths.length>0&&paths.length<=100&&paths.every(p=>Array.isArray(p)&&p.length>=2)&&paths.reduce((n,p)=>n+p.length,0)<=50000&&paths.every(p=>p.every(c=>Array.isArray(c)&&Number.isFinite(c[0])&&Number.isFinite(c[1])&&c[0]>=120&&c[0]<=135&&c[1]>=25&&c[1]<=45));};
 return new Set(v.rows.map(r=>r.id)).size===v.rows.length&&v.rows.every(r=>r.theme==='100715'&&/^[A-Za-z0-9_-]{1,40}$/.test(r.id)&&typeof r.name==='string'&&r.name.trim()&&r.name.length<=120&&geometry(r.geometry));
}
function createPublicTrailReader({BrowserWindow,timeoutMs=12000}){
 const cache=new Map();let cataloguePending;
 const readTrail=async function readTrail(url,{signal}={}){
  const safe=safeUrl(url);if(!safe)throw Error('공식 산책로 지도 주소를 확인하지 못했습니다.');
  const key=todayKst()+':'+safe.href;if(cache.has(key))return structuredClone(cache.get(key));
  let win,timer;const check=()=>{if(signal?.aborted)throw Error('숲길 조회를 중지했습니다.');},abort=()=>win&&!win.isDestroyed()&&win.destroy();
  try{
   check();win=new BrowserWindow({show:false,width:1100,height:800,webPreferences:{partition:'public-trails-v1',sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});signal?.addEventListener('abort',abort,{once:true});
   win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.session.setPermissionRequestHandler((_w,_p,cb)=>cb(false));
   const deadline=Date.now()+timeoutMs;
   const load=(async()=>{await win.loadURL(safe.href);while(Date.now()<deadline){check();const value=await win.webContents.executeJavaScript(STATE);if(value?.geometry&&value.theme===safe.searchParams.get('ti')&&value.id===safe.searchParams.get('pi'))return value;await new Promise(r=>setTimeout(r,200));}throw Error('공식 산책로 경로를 불러오는 시간이 초과됐습니다.');})();
   const value=await Promise.race([load,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('공식 산책로 지도 연결 시간이 초과됐습니다.')),timeoutMs);})]);check();
   if(JSON.stringify(value).length>3*1024*1024)throw Error('공식 산책로 경로가 처리 범위를 초과했습니다.');cache.set(key,value);return structuredClone(value);
  }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);if(win&&!win.isDestroyed())win.destroy();}
 };
 readTrail.catalogue=async function catalogue({signal}={}){
  if(signal?.aborted)throw Error('숲길 조회를 중지했습니다.');
  const key=todayKst()+':catalogue',saved=cache.get(key);if(saved&&validCatalogue(saved))return structuredClone(saved);
  if(cataloguePending){const value=await cataloguePending;if(signal?.aborted)throw Error('숲길 조회를 중지했습니다.');return structuredClone(value);}
  cataloguePending=(async()=>{let win,timer;const abort=()=>win&&!win.isDestroyed()&&win.destroy();try{
   win=new BrowserWindow({show:false,width:1100,height:800,webPreferences:{partition:'public-trails-v1',sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});signal?.addEventListener('abort',abort,{once:true});win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.session.setPermissionRequestHandler((_w,_p,cb)=>cb(false));
   const deadline=Date.now()+timeoutMs,load=(async()=>{await win.loadURL(CATALOGUE_URL);while(Date.now()<deadline){if(signal?.aborted)throw Error('숲길 조회를 중지했습니다.');const raw=await win.webContents.executeJavaScript(CATALOGUE_STATE);if(raw){if(JSON.stringify(raw).length>5*1024*1024)throw Error('공식 산책로 목록이 처리 범위를 초과했습니다.');const value={...raw,version:CATALOGUE_VERSION,sourceUrl:CATALOGUE_URL,checkedAt:new Date().toISOString(),sourceDate:null,complete:true};if(validCatalogue(value)){cache.set(key,value);return value;}}await new Promise(r=>setTimeout(r,200));}throw Error('공식 산책로 전체 목록을 확인하지 못했습니다.');})();
   return await Promise.race([load,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('공식 산책로 목록 연결 시간이 초과됐습니다.')),timeoutMs);})]);
  }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);if(win&&!win.isDestroyed())win.destroy();}})();
  try{return structuredClone(await cataloguePending);}finally{cataloguePending=null;}
 };
 return readTrail;
}
module.exports={safeUrl,createPublicTrailReader,CATALOGUE_URL,CATALOGUE_VERSION,validCatalogue};
