'use strict';
const fs=require('node:fs/promises'),path=require('node:path');
const {todayKst}=require('./core.cjs');
const VERSION='2026-10-21-max-map-bottom-list-v7';
function visualQuality(v){return !!v&&v.cellsChecked>=20&&v.texturedCells>=12&&v.textureRatio>=.70&&v.texturedColumns>=6&&v.texturedRows>=4;}
function visualEvidence(v){return {cellsChecked:v.cellsChecked,texturedCells:v.texturedCells,textureRatio:v.textureRatio,texturedColumns:v.texturedColumns,texturedRows:v.texturedRows};}
function verifiedZoom(z){return !!z&&Number.isInteger(z.before)&&z.before>=0&&z.before<=22&&z.steps===0&&z.after===z.before&&z.method==='provider-default-unchanged'&&z.proof==='rendered-naver-tile-level';}
function verifiedLayout(v){return !!v&&v.position==='bottom'&&v.source==='provider-existing-marker-list'&&v.markerListMatches===true&&v.colorsPreserved===true&&v.controlsPreserved===true&&v.allItemsVisible===true&&Number.isInteger(v.markerListCount)&&v.markerListCount>0&&Number.isInteger(v.columnCount)&&v.columnCount>=2&&Number.isFinite(v.minFontSizePx)&&v.minFontSizePx>=20&&Number.isFinite(v.mapWidthBefore)&&v.mapWidthBefore>0&&Number.isFinite(v.mapWidthAfter)&&v.mapWidthAfter>v.mapWidthBefore&&v.horizontalGainPx===v.mapWidthAfter-v.mapWidthBefore&&v.listRect?.height>0&&v.mapRect?.height>=300&&v.mapHeight===v.mapRect.height&&v.legendHeight===v.listRect.height&&v.listRect.y>=v.mapRect.y+v.mapRect.height-1&&v.listRect.x<=v.mapRect.x+1&&v.listRect.x+v.listRect.width>=v.mapRect.x+v.mapRect.width-1;}
function isValidatedMap(map){return !!map?.file&&map.version===VERSION&&visualQuality(map.validation?.basemapVisual)&&verifiedZoom(map.validation?.zoom)&&verifiedLayout(map.validation?.layout);}
const NAME=value=>String(value||'').replace(/[\s·ㆍ()（）\[\]_-]/g,'').toLowerCase();
function safeMapUrl(value){try{const u=new URL(String(value));return u.protocol==='https:'&&!u.username&&!u.password&&(u.hostname==='ipji-talk.com'||u.hostname.endsWith('.ipji-talk.com'))&&/^\/(?:map|share|s)(?:\/|$)/i.test(u.pathname)&&![...u.searchParams.keys()].some(k=>/token|auth|secret|key|password/i.test(k))?u.href:null;}catch{return null;}}
function marker(value){const lat=Number(value?.lat),lng=Number(value?.lng),name=String(value?.name||value?.building||'').trim().slice(0,160);return Number.isFinite(lat)&&Number.isFinite(lng)&&lat>=25&&lat<=45&&lng>=120&&lng<=135?{lat,lng,name}:null;}
function meters(a,b){const rad=n=>n*Math.PI/180,x=Math.sin(rad(b.lat-a.lat)/2)**2+Math.cos(rad(a.lat))*Math.cos(rad(b.lat))*Math.sin(rad(b.lng-a.lng)/2)**2;return 6371008.8*2*Math.atan2(Math.sqrt(x),Math.sqrt(1-x));}
function matchingMarker(actual,target){return (!target.name||NAME(actual.name).includes(NAME(target.name))||NAME(target.name).includes(NAME(actual.name))&&!!actual.name)&&meters(actual,target)<=200;}
function targetsFor(options={}){const values=options.targets||[options.target||options.property].filter(Boolean);return values.map(x=>marker(typeof x==='string'?{name:x}:x)).filter(Boolean);}
// Move the provider's existing list nodes, retaining their original controls,
// names and color dots. Only page layout changes; the map zoom is untouched.
const LAYOUT_BOTTOM=`(()=>{const wrap=document.querySelector('#wrap'),sidebar=document.querySelector('#sidebar'),mapwrap=document.querySelector('#mapwrap'),list=document.querySelector('#mklist');if(!wrap||!sidebar||!mapwrap||!list||sidebar.parentElement!==wrap||mapwrap.parentElement!==wrap)return false;wrap.style.flexDirection='column';mapwrap.style.flex='1 1 auto';mapwrap.style.minHeight='350px';mapwrap.style.height='0';sidebar.style.width='100%';sidebar.style.flex='0 0 auto';sidebar.style.borderRight='0';sidebar.style.borderTop='1px solid #e5e7eb';sidebar.style.padding='6px 10px';sidebar.style.overflow='visible';list.style.display='grid';list.style.gridTemplateColumns='repeat(4,minmax(0,1fr))';list.style.columnGap='8px';list.style.rowGap='0';for(const e of list.querySelectorAll('.mk-item')){e.style.padding='2px';e.style.gap='6px';e.style.minWidth='0';}for(const e of list.querySelectorAll('.mk-name')){e.style.fontSize='20px';e.style.lineHeight='1.2';}for(const e of list.querySelectorAll('.mk-dot')){e.style.width='14px';e.style.height='14px';e.style.flex='0 0 14px';}for(const e of list.querySelectorAll('input')){e.style.width='16px';e.style.height='16px';}const heading=sidebar.querySelector('h2');if(heading){heading.style.fontSize='18px';heading.style.margin='0 0 4px';}wrap.appendChild(sidebar);window.dispatchEvent(new Event('resize'));return true;})()`;
// Separate only collocated text labels. The provider's map, marker anchors,
// coordinates, names, and pin icons remain untouched.
const LAYOUT_LABELS=`(()=>{const root=document.querySelector('#map'),names=new Set((window.__MAP_DATA__?.markers||[]).map(m=>m.name)),occupied=[],changes=[];if(!root)return changes;for(const e of root.querySelectorAll('div,span')){if(e.childElementCount||!names.has(e.textContent.trim()))continue;const r=e.getBoundingClientRect();if(!r.width||!r.height)continue;let dy=0;for(const p of occupied){if(Math.abs(r.left-p.left)<24&&Math.abs(r.top-p.top)<24&&r.left<p.right&&r.right>p.left&&r.top+dy<p.bottom+3&&r.bottom+dy>p.top)dy=Math.max(dy,p.bottom+4-r.top);}if(dy>0&&dy<=60){e.style.transform='translateY('+dy+'px)';changes.push({name:e.textContent.trim(),dy});}const b=e.getBoundingClientRect();occupied.push({left:b.left,right:b.right,top:b.top,bottom:b.bottom});}return changes;})()`;
function expandedViewport(state,windowSize){
 const rect=state?.rect,boxes=(state?.markerRects||[]).filter(r=>r.width>0&&r.height>0);if(!rect)return null;
 const cx=rect.x+rect.width/2,cy=rect.y+rect.height/2,pad=35;
 const width=boxes.length?Math.ceil(2*Math.max(...boxes.map(r=>Math.max(cx-r.x,r.x+r.width-cx)))+2*pad):rect.width+300;
 const height=boxes.length?Math.ceil(2*Math.max(...boxes.map(r=>Math.max(cy-r.y,r.y+r.height-cy)))+2*pad):rect.height+600;
 const next=[Math.min(3000,windowSize[0]+Math.max(0,width-rect.width)),Math.min(2400,windowSize[1]+Math.max(0,height-rect.height))];
 return next[0]>windowSize[0]||next[1]>windowSize[1]?next:null;
}
function bottomLayoutEvidence(state,before,requested=[]){
 const list=state?.markerList,items=list?.items||[],original=before?.markerList?.items||[],expected=requested.length?requested:state?.markers||[];
 const markerListMatches=items.length===expected.length&&expected.every(p=>items.some(i=>NAME(i.name)===NAME(p.name)&&i.checked===true&&typeof i.color==='string'&&i.color.length>0));
 const colorsPreserved=items.length===original.length&&items.every(i=>original.some(p=>p.name===i.name&&p.color===i.color)),controlsPreserved=items.length===original.length&&items.every(i=>original.some(p=>p.name===i.name&&p.checked===i.checked));
 return {position:'bottom',source:'provider-existing-marker-list',markerListCount:items.length,markerListMatches,colorsPreserved,controlsPreserved,allItemsVisible:list?.visible===true&&items.every(i=>i.visible===true),columnCount:list?.columnCount||0,minFontSizePx:list?.minFontSizePx||0,mapWidthBefore:before?.width,mapWidthAfter:state?.width,horizontalGainPx:state?.width-before?.width,mapRect:state?.rect||null,listRect:list?.rect||null,mapHeight:state?.height,legendHeight:list?.rect?.height,items:items.map(i=>({name:i.name,color:i.color}))};
}
function safeSavedCandidate(map,targets=[],{now=Date.now()}={}){
 const url=safeMapUrl(map?.url),knownVersions=new Set(['2026-10-20-key-facilities-map-v4','2026-10-21-one-level-zoom-map-v5','2026-10-21-default-zoom-bottom-list-map-v6',VERSION]);
 if(!url||map?.status!=='ready'||map.provider!=='NAVER'||!knownVersions.has(map.version)||!visualQuality(map.validation?.basemapVisual)||!Number.isInteger(map.validation?.tileCount)||map.validation.tileCount<4||!Number.isFinite(map.validation?.tileCoverage)||map.validation.tileCoverage<.85||map.validation?.coordinates!=='WGS84 (EPSG:4326)'||!Number.isFinite(Date.parse(map.expiresAt))||Date.parse(map.expiresAt)<=now+60000||!Number.isFinite(Date.parse(map.capturedAtTime))||Date.parse(map.capturedAtTime)>now||Date.parse(map.capturedAtTime)>=Date.parse(map.expiresAt)||!Number.isFinite(Date.parse(map.providedAt))||Date.parse(map.providedAt)>Date.parse(map.capturedAtTime))return null;
 const source=map.markers,details=map.markerDetails;if(!Array.isArray(source)||!Array.isArray(details)||!source.length||source.length>150||source.length!==details.length||!targets.length)return null;
 const markers=source.map(marker),typed=details.map(marker);if(markers.some(m=>!m||!m.name)||typed.some(m=>!m||!m.name)||details.some(p=>typeof p.color!=='string'||!p.color.trim())||new Set(markers.map(m=>NAME(m.name))).size!==markers.length||new Set(typed.map(m=>NAME(m.name))).size!==typed.length||!typed.every(p=>markers.some(m=>NAME(m.name)===NAME(p.name)&&meters(m,p)<=5))||!targets.every(t=>markers.some(m=>matchingMarker(m,t)&&meters(m,t)<=5)))return null;
 const markerDetails=details.map((value,i)=>({...typed[i],color:String(value.color||'').slice(0,20),info:String(value.info||'').slice(0,1800)}));
 return {url,meta:{markers,markerDetails,legend:require('./map-markers.cjs').legendFromMarkers(markerDetails),tool:'saved-public-map-url',expiresAt:map.expiresAt,providedAt:map.providedAt,reuse:{kind:'saved-public-map-url',previousCaptureVersion:map.version,previousCapturedAtTime:map.capturedAtTime,...(map.validation?.layout?.mapRect?.height&&map.validation?.layout?.listRect?.height?{previousLayout:{mapHeight:map.validation.layout.mapRect.height,legendHeight:map.validation.layout.listRect.height,minFontSizePx:map.validation.layout.minFontSizePx}}:{})}}};
}
function parsed(value){if(typeof value!=='string')return value;try{return JSON.parse(value);}catch{return null;}}
function extractCandidates(tools){
 const urls=[],images=[],failures=[];
 for(const t of tools||[]){
  if(t?.server!=='ipzitalk'||!/map|지도/i.test(t.tool||''))continue;
  if(t.error||t.result?.isError){failures.push('지도 서비스가 요청을 처리하지 못했습니다. 연결 상태와 접근 권한을 다시 확인해 주세요.');continue;}
  const args=parsed(t.arguments)||{},markers=(args.markers||[]).map(marker).filter(Boolean),markerDetails=(args.markers||[]).map(value=>{const p=marker(value);return p?{...p,color:String(value.color||'').slice(0,20),info:String(value.info||'').slice(0,1800)}:null;}).filter(Boolean),meta={markers,markerDetails,legend:require('./map-markers.cjs').legendFromMarkers(markerDetails),tool:String(t.tool).slice(0,120),expiresAt:null,providedAt:null};
  const nodes=[t.result],seen=new Set();let count=0;
  while(nodes.length&&count++<2500){const v=nodes.pop();if(!v)continue;
   if(typeof v==='string'){if(v.length>2*1024*1024)continue;const p=parsed(v);if(p&&typeof p==='object')nodes.push(p);for(const raw of v.match(/https:\/\/[^\s<>"')\]\\]+/g)||[]){const url=safeMapUrl(raw.replace(/[.,;]+$/,''));if(url&&!urls.some(c=>c.url===url))urls.push({url,meta});}continue;}
   if(typeof v!=='object'||seen.has(v))continue;seen.add(v);
   if(typeof v.expires_at==='string'&&Number.isFinite(Date.parse(v.expires_at)))meta.expiresAt=new Date(v.expires_at).toISOString();
   if(typeof v.collected_at==='string'&&Number.isFinite(Date.parse(v.collected_at)))meta.providedAt=new Date(v.collected_at).toISOString();
   if(v.type==='image'&&/^image\/(?:png|jpeg|webp)$/.test(v.mimeType||'')&&typeof v.data==='string'&&v.data.length<17*1024*1024)images.push({data:v.data,meta});
   if(v.marker_count!=null&&Number.isInteger(Number(v.marker_count)))meta.markerCount=Number(v.marker_count);
   if(Array.isArray(v))nodes.push(...v);else for(const [key,value] of Object.entries(v))if(!/^(?:data|token|authorization|secret|password|apiKey|serviceKey)$/i.test(key))nodes.push(value);
  }
 }
 return {urls,images,failures};
}
function imageCheck(image){
 if(!image||image.isEmpty())return {ok:false,reason:'지도 이미지 파일을 읽지 못했습니다.'};
 const size=image.getSize();if(size.width<350||size.height<300)return {ok:false,reason:'지도 이미지의 크기가 작아 단지와 시설을 확인할 수 없습니다.'};
 const pixels=image.resize({width:80,height:60,quality:'good'}).toBitmap(),colors=new Set();let varied=0;
 for(let i=0;i<pixels.length;i+=4){const b=pixels[i],g=pixels[i+1],r=pixels[i+2],a=pixels[i+3];if(a>200){colors.add((r>>4)*256+(g>>4)*16+(b>>4));if(Math.max(r,g,b)-Math.min(r,g,b)>12||Math.min(r,g,b)<215)varied++;}}
 return {ok:colors.size>=25&&varied>=pixels.length/4*.03,colors:colors.size,varied,reason:'지도 배경이 비어 있거나 표시 내용을 확인할 수 없습니다.',size};
}
function basemapCheck(image,state={}){
 const size=image.getSize(),rect=state.rect;if(!rect||!Number.isFinite(rect.x)||!Number.isFinite(rect.y))return {ok:false,reason:'지도 배경의 표시 범위를 확인하지 못했습니다.'};
 const x=Math.max(0,Math.floor(rect.x)),y=Math.max(0,Math.floor(rect.y)),width=Math.min(Math.floor(rect.width),size.width-x),height=Math.min(Math.floor(rect.height),size.height-y);
 if(width<350||height<300)return {ok:false,reason:'지도 배경의 표시 범위가 너무 작습니다.'};
 const sample=image.crop({x,y,width,height}).resize({width:320,quality:'good'}),sampleSize=sample.getSize(),pixels=sample.toBitmap(),sx=sampleSize.width/width,sy=sampleSize.height/height,masks=(state.markerRects||[]).map(r=>({left:(r.x-x-32)*sx,top:(r.y-y-20)*sy,right:(r.x-x+r.width+12)*sx,bottom:(r.y-y+r.height+18)*sy}));
 const masked=(px,py)=>py<40*sy||py>sampleSize.height-24*sy||masks.some(r=>px>=r.left&&px<=r.right&&py>=r.top&&py<=r.bottom);
 let checked=0,textured=0;const columns=new Set(),rows=new Set();
 for(let gy=0;gy<6;gy++)for(let gx=0;gx<8;gx++){
  const colors=new Set();let count=0,edges=0;for(let py=Math.floor(gy*sampleSize.height/6);py<Math.floor((gy+1)*sampleSize.height/6);py++)for(let px=Math.floor(gx*sampleSize.width/8);px<Math.floor((gx+1)*sampleSize.width/8)-1;px++){
   if(masked(px,py))continue;const i=(py*sampleSize.width+px)*4;if(pixels[i+3]<200)continue;count++;colors.add((pixels[i]>>4)*256+(pixels[i+1]>>4)*16+(pixels[i+2]>>4));if(Math.max(Math.abs(pixels[i]-pixels[i+4]),Math.abs(pixels[i+1]-pixels[i+5]),Math.abs(pixels[i+2]-pixels[i+6]))>=12)edges++;
  }
  if(count>=180){checked++;if(colors.size>=5&&edges/count>=.035){textured++;columns.add(gx);rows.add(gy);}}
 }
 const evidence={cellsChecked:checked,texturedCells:textured,textureRatio:checked?textured/checked:0,texturedColumns:columns.size,texturedRows:rows.size};
 return {ok:visualQuality(evidence),...evidence,reason:'지도 배경에 도로·건물 등 공간 정보가 충분히 표시되지 않았습니다. 배경 지도를 다시 불러와야 합니다.'};
}
// Image download completion does not imply decoded tiles have reached the compositor.
const PAINT_READY=`(async()=>{const root=document.querySelector('#map,.leaflet-container,.maplibregl-map,.mapboxgl-map'),rect=root?.getBoundingClientRect();if(!rect)return false;const tiles=[...root.querySelectorAll('img')].filter(i=>{const r=i.getBoundingClientRect(),s=getComputedStyle(i);return /pstatic\\.net|naver\\.(?:com|net)/i.test(i.src)&&r.width>=128&&r.height>=128&&r.right>rect.left&&r.bottom>rect.top&&r.left<rect.right&&r.top<rect.bottom&&s.display!=='none'&&s.visibility!=='hidden';});if(!tiles.length)return false;const decoded=await Promise.all(tiles.map(async i=>{try{await i.decode();return i.complete&&i.naturalWidth>=128&&i.naturalHeight>=128;}catch{return false;}}));if(decoded.some(x=>!x))return false;await document.fonts.ready;await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));return true;})()`;
async function waitForPaint(contents,timeoutMs,signal){if(signal?.aborted)return false;let timer,abort;try{return await Promise.race([contents.executeJavaScript(PAINT_READY),new Promise(resolve=>{abort=()=>resolve(false);signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)return resolve(false);timer=setTimeout(()=>resolve(false),Math.max(1,timeoutMs));})]);}finally{clearTimeout(timer);if(abort)signal?.removeEventListener('abort',abort);}}
// Read only the public map payload and rendered map state. No page script, cookies, or authentication values are retained.
const PAGE_STATE=`(()=>{const root=document.querySelector('#map,.leaflet-container,.maplibregl-map,.mapboxgl-map'),rect=root?.getBoundingClientRect(),raw=window.__MAP_DATA__||{},markers=(raw.markers||[]).slice(0,150).map(x=>({name:String(x.name||'').slice(0,160),lat:Number(x.lat),lng:Number(x.lng)}));const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&r.left>=Math.max(0,rect?.left||0)&&r.top>=Math.max(0,rect?.top||0)&&r.right<=Math.min(innerWidth,rect?.right||innerWidth)&&r.bottom<=Math.min(innerHeight,rect?.bottom||innerHeight)&&s.display!=='none'&&s.visibility!=='hidden'};const imgs=root?[...root.querySelectorAll('img')]:[],tiles=imgs.filter(i=>i.complete&&i.naturalWidth>=128&&i.naturalHeight>=128&&/pstatic\\.net|naver\\.(?:com|net)/i.test(i.src)&&i.getBoundingClientRect().right>(rect?.left||0)&&i.getBoundingClientRect().bottom>(rect?.top||0)&&i.getBoundingClientRect().left<(rect?.right||0)&&i.getBoundingClientRect().top<(rect?.bottom||0)),labels=root?[...root.querySelectorAll('div,span')].filter(e=>e.childElementCount===0&&visible(e)).map(e=>e.textContent.trim()).filter(Boolean).slice(0,300):[];const tileRects=tiles.map(i=>i.getBoundingClientRect());let covered=0;if(rect)for(let y=0;y<8;y++)for(let x=0;x<12;x++){const px=rect.left+rect.width*(x+.5)/12,py=rect.top+rect.height*(y+.5)/8;if(tileRects.some(t=>px>=t.left&&px<t.right&&py>=t.top&&py<t.bottom))covered++;}const text=(root?.innerText||'').slice(0,16000),error=/인증.*실패|허용되지.*URL|마커가 없습니다|로그인이 필요|Unauthorized|Access denied/i.test(document.body.innerText);const markerRects=root?[...root.querySelectorAll('div,span')].filter(e=>e.childElementCount===0&&markers.some(m=>m.name===e.textContent.trim())).map(e=>{const r=e.getBoundingClientRect();return {name:e.textContent.trim(),x:r.x,y:r.y,width:r.width,height:r.height}}):[];const tileLevels=tiles.filter(i=>{const r=i.getBoundingClientRect();if(Math.abs(r.width-256)>2||Math.abs(r.height-256)>2)return false;for(let e=i;e&&e!==root.parentElement;e=e.parentElement){const s=getComputedStyle(e);if(s.display==='none'||s.visibility==='hidden'||Number(s.opacity)===0)return false;}return true;}).map(i=>{try{const p=new URL(i.src).pathname.split('/');return p[1]==='styles'&&p[4]?Number(p[4]):NaN;}catch{return NaN;}}).filter(n=>Number.isInteger(n)&&n>=0&&n<=22),zoom=[...new Set(tileLevels)];const side=document.querySelector('#sidebar'),list=document.querySelector('#mklist'),sr=side?.getBoundingClientRect(),box=r=>r?{x:r.x,y:r.y,width:r.width,height:r.height}:null,screenVisible=r=>r.width>0&&r.height>0&&r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight;const fontSizes=list?[...list.querySelectorAll('.mk-name')].map(e=>parseFloat(getComputedStyle(e).fontSize)).filter(Number.isFinite):[];const markerList=side&&list?{rect:box(sr),minFontSizePx:fontSizes.length?Math.min(...fontSizes):0,columnCount:getComputedStyle(list).gridTemplateColumns.split(' ').filter(Boolean).length,items:[...list.querySelectorAll('.mk-item')].slice(0,150).map(e=>{const r=e.getBoundingClientRect(),dot=e.querySelector('.mk-dot');return {name:String(e.querySelector('.mk-name')?.textContent||'').trim().slice(0,160),color:dot?getComputedStyle(dot).backgroundColor:null,checked:e.querySelector('input')?.checked===true,visible:screenVisible(r)};}),visible:screenVisible(sr)}:null;return {markerList,zoom:zoom.length===1?zoom[0]:null,rect:rect?{x:rect.x,y:rect.y,width:rect.width,height:rect.height}:null,markerRects,width:rect?.width||0,height:rect?.height||0,tiles:tiles.length,tileCoverage:covered/96,provider:/NAVER/i.test(text)?'NAVER':null,attribution:/NAVER.*Corp/i.test(text),markers,labels,error,title:document.title.slice(0,160)}})()`;
function readyState(state,targets=[],requested=[]){
 if(state?.error)return {ok:false,code:'MAP_SERVICE_ERROR',reason:'지도 서비스가 인증 또는 마커 오류를 표시했습니다. 입지톡 연결을 다시 확인해 주세요.'};
 if(!(state?.width>=350&&state?.height>=300&&state?.tiles>=4&&state?.tileCoverage>=.85&&state?.attribution&&state?.provider==='NAVER'))return {ok:false,code:'MAP_NOT_READY',reason:'지도 배경과 출처 표시가 아직 로딩되지 않았습니다. 네트워크 연결을 확인한 뒤 다시 시도해 주세요.'};
 const markers=(state.markers||[]).map(marker).filter(Boolean);if(!markers.length)return {ok:false,code:'MAP_MARKERS_MISSING',reason:'지도에 대상 단지 마커가 없어 위치를 검증하지 못했습니다.'};
 const required=targets.length?targets:markers.slice(0,1);
 for(const target of required){if(!markers.some(m=>matchingMarker(m,target)))return {ok:false,code:'MAP_TARGET_MISMATCH',reason:`지도에서 ${target.name||'대상 단지'}의 이름과 좌표를 대조하지 못했습니다.`};if(!(state.labels||[]).some(x=>NAME(x).includes(NAME(target.name))))return {ok:false,code:'MAP_TARGET_OUTSIDE',reason:`${target.name||'대상 단지'} 마커가 지도 표시 범위 안에 보이지 않습니다. 지도 범위를 조정해 다시 생성해야 합니다.`};}
 for(const p of requested){if(!markers.some(m=>NAME(m.name)===NAME(p.name)&&meters(m,p)<=5))return {ok:false,code:'MAP_FACILITY_MISMATCH',reason:'지도에서 요청한 주요 시설의 이름·좌표를 모두 대조하지 못했습니다.'};if(!(state.labels||[]).some(name=>NAME(name)===NAME(p.name)))return {ok:false,code:'MAP_FACILITY_OUTSIDE',reason:'주요 시설 이름이 지도 표시 범위 밖에 있습니다. 지도 범위를 조정해 다시 생성해야 합니다.'};}
 return {ok:true,markers,provider:state.provider,tiles:state.tiles,tileCoverage:state.tileCoverage};
}
function createMapCapture({BrowserWindow,nativeImage,onEvent=()=>{},timeoutMs=30000,maxAttempts=2,sleep=ms=>new Promise(r=>setTimeout(r,ms)),now=()=>Date.now()}){
 return async function captureMap(tools,dir,options={}){
  const check=()=>{if(options.signal?.aborted)throw new Error('지도 불러오기를 중지했습니다.');};check();
  await fs.mkdir(path.join(dir,'figures'),{recursive:true});await fs.mkdir(path.join(dir,'raw'),{recursive:true});const candidates=extractCandidates(tools),targets=targetsFor(options),attempts=[];
  const saved=safeSavedCandidate(options.savedMap,targets,{now:now()});if(saved&&!candidates.urls.some(c=>c.url===saved.url))candidates.urls.push(saved);
  const failed=(code,reason,url=null)=>({status:'unavailable',file:null,url,code,reason,capturedAt:todayKst(),version:VERSION,attempts});
  if(!candidates.urls.length&&!candidates.images.length){const result=failed('MAP_NOT_REQUESTED',candidates.failures[0]||'입지톡에서 지도 이미지나 공유 주소가 반환되지 않았습니다. 지도 자료를 다시 조회해야 합니다.');await fs.writeFile(path.join(dir,'raw','map-capture.json'),JSON.stringify(result,null,2));return result;}
  let last={code:'MAP_NOT_READY',reason:'지도 배경을 불러오지 못했습니다. 연결 상태를 확인한 뒤 다시 시도해 주세요.'};
  // A share page supplies independently inspectable marker coordinates and attribution, so prefer it over a bare image.
  for(const candidate of candidates.urls.slice(-3).reverse()){
   if(candidate.meta.expiresAt&&Date.parse(candidate.meta.expiresAt)<=now()){last={code:'MAP_URL_EXPIRED',reason:'입지톡 공유 지도의 유효기간이 지났습니다. 지도를 새로 생성해야 합니다.'};attempts.push({code:last.code});continue;}
   for(let attempt=1;attempt<=maxAttempts;attempt++){
    check();onEvent({stage:'map',message:attempt===1?'대상 단지와 지도 배경을 확인하고 있습니다.':'지도 로딩을 다시 시도하고 있습니다.'});let window;const abort=()=>{if(window&&!window.isDestroyed())window.destroy();};
    try{
     window=new BrowserWindow({show:false,width:1500,height:1050,webPreferences:{partition:'map-capture-v3',sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
     options.signal?.addEventListener('abort',abort,{once:true});check();
     const wc=window.webContents;wc.setWindowOpenHandler(()=>({action:'deny'}));wc.session.setPermissionRequestHandler((_w,_p,cb)=>cb(false));const blockExternal=(event,url)=>{if(!safeMapUrl(url))event.preventDefault();};wc.on('will-navigate',blockExternal);wc.on('will-redirect',blockExternal);
     const deadline=now()+timeoutMs;let timer;try{await Promise.race([window.loadURL(candidate.url),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Object.assign(new Error('지도 연결 시간이 초과됐습니다.'),{code:'MAP_LOAD_TIMEOUT'})),timeoutMs);})]);}finally{clearTimeout(timer);}
     let lastState,stable=0,zoom=null,baseline=null,layout=null,resizeCount=0,labelLayout=null;
     while(now()<deadline){check();const state=await wc.executeJavaScript(PAGE_STATE),ready=readyState(state,targets.length?targets:candidate.meta.markers.slice(0,3),candidate.meta.legend?candidate.meta.markers:[]);
      if(ready.ok&&!zoom){
       if(!Number.isInteger(state.zoom)){last={code:'MAP_ZOOM_UNVERIFIED',reason:'현재 지도의 실제 확대 단계를 확인하지 못했습니다.'};await sleep(750);continue;}
       baseline={width:state.width,height:state.height,rect:state.rect,markerList:state.markerList};
       if(!await wc.executeJavaScript(LAYOUT_BOTTOM)){last={code:'MAP_LAYOUT_UNAVAILABLE',reason:'공개 지도의 원본 마커 목록을 하단으로 배치하지 못했습니다.'};break;}
       zoom={before:state.zoom,after:null,steps:0,method:'provider-default-unchanged',proof:'rendered-naver-tile-level',viewportBefore:{width:state.width,height:state.height},viewportExpanded:false};lastState=null;stable=0;await sleep(750);continue;
      }
      if(zoom){
       if(state.zoom!==zoom.before){last={code:'MAP_ZOOM_UNVERIFIED',reason:'지도 배경에서 기본 제공 배율이 유지됐는지 확인하지 못했습니다.'};stable=0;await sleep(750);continue;}
       zoom.after=state.zoom;
       if(['MAP_FACILITY_OUTSIDE','MAP_TARGET_OUTSIDE'].includes(ready.code)&&resizeCount<3&&typeof window.getSize==='function'&&typeof window.setSize==='function'){
        const size=expandedViewport(state,window.getSize());if(size){window.setSize(...size);resizeCount++;zoom.viewportExpanded=true;lastState=null;stable=0;await sleep(750);continue;}
       }
       layout=bottomLayoutEvidence(state,baseline,candidate.meta.markers);
       if(!verifiedLayout(layout)){last={code:'MAP_LAYOUT_UNVERIFIED',reason:'원본 마커 목록의 하단 배치·전체 항목·지도 폭 증가를 확인하지 못했습니다.'};stable=0;await sleep(750);continue;}
       if(ready.ok&&labelLayout===null){const changed=await wc.executeJavaScript(LAYOUT_LABELS);labelLayout=Array.isArray(changed)?changed:[];lastState=null;stable=0;await sleep(750);continue;}
      }
      if(ready.ok){const key=JSON.stringify([state.tiles,state.markers,state.labels]);stable=key===lastState?stable+1:1;lastState=key;if(stable>=2){const painted=await waitForPaint(wc,deadline-now(),options.signal);check();if(!painted||now()>=deadline){last={code:'MAP_BASEMAP_NOT_PAINTED',reason:'지도 배경의 이미지와 글꼴을 그리지 못했습니다. 잠시 후 다시 시도해 주세요.'};stable=0;if(now()<deadline)await sleep(750);continue;}const image=await wc.capturePage(),imageState=imageCheck(image);if(!imageState.ok){last={code:'MAP_EMPTY_IMAGE',reason:imageState.reason};stable=0;await sleep(750);continue;}const visual=basemapCheck(image,state);if(!visual.ok){last={code:'MAP_BASEMAP_NOT_PAINTED',reason:visual.reason};stable=0;await sleep(750);continue;}
       check();const file='ipjitalk-map.png';await fs.writeFile(path.join(dir,'figures',file),image.toPNG());const map={status:'ready',file,url:candidate.url,caption:'출처: 입지톡 실제 렌더링 지도 / © NAVER Corp. 기본 제공 배율을 유지하고 마커 목록을 하단에 배치했습니다. 대상 단지와 표시 시설의 위치를 확인했습니다. 거리 기준은 직선거리이며 배정·통학 경로를 뜻하지 않습니다.',capturedAt:todayKst(),capturedAtTime:new Date(now()).toISOString(),providedAt:candidate.meta.providedAt,expiresAt:candidate.meta.expiresAt,provider:'NAVER',version:VERSION,...(candidate.meta.reuse?{sourceReuse:candidate.meta.reuse}:{}),markers:ready.markers,markerDetails:candidate.meta.markerDetails,legend:candidate.meta.legend,validation:{targetCount:(targets.length?targets:candidate.meta.markers.slice(0,3)).length,...(candidate.meta.legend?{facilityCount:candidate.meta.markers.length-1,facilityLabelsVisible:true}:{}),zoom:{...zoom,viewportAfter:{width:state.width,height:state.height}},layout,labelLayout:{method:'provider-label-css-offset',markerCoordinatesUnchanged:true,adjustments:labelLayout||[]},tileCount:ready.tiles,tileCoverage:ready.tileCoverage,basemapVisual:visualEvidence(visual),coordinates:'WGS84 (EPSG:4326)',width:imageState.size.width,height:imageState.size.height},attempts:[...attempts,{attempt,status:'ready'}]};await fs.writeFile(path.join(dir,'raw','map-capture.json'),JSON.stringify(map,null,2));return map;}}
      else{stable=0;last={code:ready.code,reason:ready.reason};if(['MAP_SERVICE_ERROR','MAP_TARGET_MISMATCH'].includes(ready.code))break;}await sleep(750);
     }
     attempts.push({attempt,code:last.code});
    }catch(e){check();last={code:e.code==='MAP_LOAD_TIMEOUT'?'MAP_LOAD_TIMEOUT':'MAP_NETWORK_ERROR',reason:e.code==='MAP_LOAD_TIMEOUT'?'지도 연결 시간이 초과됐습니다. 네트워크 상태를 확인한 뒤 다시 시도해 주세요.':'입지톡 공유 지도를 열지 못했습니다. 인터넷 연결 또는 공유 지도의 유효기간을 확인해 주세요.'};attempts.push({attempt,code:last.code,detail:String(e.message||'지도 캡처 오류').replace(/https?:\/\/\S+/g,'[지도 주소]').slice(0,240)});}
    finally{options.signal?.removeEventListener('abort',abort);if(window&&!window.isDestroyed())window.destroy();}
    if(['MAP_TARGET_MISMATCH','MAP_SERVICE_ERROR'].includes(last.code))break;
   }
  }
  if(candidates.images.length&&!candidates.urls.length)last={code:'MAP_LAYOUT_UNAVAILABLE',reason:'공유 지도 없이 반환된 이미지는 기본 배율과 하단 마커 목록 배치를 검증할 수 없습니다. 공개 지도 주소가 필요합니다.'};
  const result=failed(last.code,last.reason,candidates.urls.at(-1)?.url||null);await fs.mkdir(path.join(dir,'raw'),{recursive:true});await fs.writeFile(path.join(dir,'raw','map-capture.json'),JSON.stringify(result,null,2));return result;
 };
}
module.exports={VERSION,isValidatedMap,safeMapUrl,extractCandidates,targetsFor,matchingMarker,imageCheck,basemapCheck,readyState,PAGE_STATE,PAINT_READY,LAYOUT_BOTTOM,LAYOUT_LABELS,expandedViewport,bottomLayoutEvidence,safeSavedCandidate,waitForPaint,createMapCapture};
