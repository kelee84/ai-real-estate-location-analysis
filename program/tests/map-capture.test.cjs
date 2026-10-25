'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {VERSION,isValidatedMap,safeMapUrl,extractCandidates,readyState,imageCheck,basemapCheck,PAINT_READY,LAYOUT_BOTTOM,LAYOUT_LABELS,expandedViewport,bottomLayoutEvidence,safeSavedCandidate,waitForPaint,createMapCapture}=require('../src/map-capture.cjs');
const target={name:'가상단지1차',lat:37.4,lng:126.64},url='https://ipji-talk.com/map?d=test-public-id';
const tool=(data,args={markers:[target]})=>({server:'ipzitalk',tool:'get_map_embed_url',arguments:args,result:data});
const zoomProof={before:15,after:15,steps:0,method:'provider-default-unchanged',proof:'rendered-naver-tile-level'};
const layoutProof={position:'bottom',source:'provider-existing-marker-list',markerListCount:1,markerListMatches:true,colorsPreserved:true,controlsPreserved:true,allItemsVisible:true,columnCount:4,minFontSizePx:20,mapWidthBefore:1100,mapWidthAfter:1380,horizontalGainPx:280,mapRect:{x:0,y:0,width:1380,height:750},listRect:{x:0,y:750,width:1380,height:150},mapHeight:750,legendHeight:150};
const ready={zoom:15,rect:{x:280,y:0,width:1100,height:900},markerRects:[],width:1100,height:900,tiles:18,tileCoverage:1,provider:'NAVER',attribution:true,markers:[target],labels:[target.name],error:false};
function mapJs(code,state=ready){if(code===LAYOUT_LABELS)return [];if(code===LAYOUT_BOTTOM){this.bottom=true;return true;}if(code===PAINT_READY)return true;const items=state.markers.map(m=>({name:m.name,color:'rgb(255, 99, 85)',checked:true,visible:true}));return this.bottom?{...state,width:1380,height:750,rect:{x:0,y:0,width:1380,height:750},markerList:{rect:{x:0,y:750,width:1380,height:150},columnCount:4,minFontSizePx:20,visible:true,items}}:{...state,markerList:{rect:{x:0,y:0,width:280,height:900},columnCount:1,visible:true,items}};}
function image(blank=false){return {isEmpty:()=>false,getSize:()=>({width:1500,height:1000}),crop(){return this;},resize(){return {...this,getSize:()=>({width:320,height:240})};},toBitmap:()=>Buffer.from(Array.from({length:320*240*4},(_,i)=>i%4===3?255:blank?255:((Math.floor(i/4)>>(i%4*3))*17)%256)),toPNG:()=>Buffer.from('test-image')};}
test('시각 검증을 통과한 최신 지도는 재사용 허용',()=>{assert.equal(isValidatedMap({status:'ready',file:'ipjitalk-map.png',version:VERSION,validation:{zoom:zoomProof,layout:layoutProof,basemapVisual:{cellsChecked:48,texturedCells:43,textureRatio:43/48,texturedColumns:8,texturedRows:6}}}),true);});
test('이전 버전 또는 시각 검증 기록이 없는 지도는 재사용 거절',()=>{const map={file:'ipjitalk-map.png',version:'2026-10-17-validated-map-v2',validation:{tileCount:20,tileCoverage:1,basemapVisual:{cellsChecked:48,texturedCells:48,textureRatio:1,texturedColumns:8,texturedRows:6}}};assert.equal(isValidatedMap(map),false);assert.equal(isValidatedMap({...map,version:VERSION,validation:{tileCount:20,tileCoverage:1}}),false);assert.equal(isValidatedMap(null),false);});
test('단색 배경·불충분한 검사·이미지 파일 누락은 재사용 거절',()=>{const map={file:'ipjitalk-map.png',version:VERSION,validation:{zoom:zoomProof,layout:layoutProof,basemapVisual:{cellsChecked:48,texturedCells:4,textureRatio:4/48}}};assert.equal(isValidatedMap(map),false);assert.equal(isValidatedMap({...map,validation:{zoom:zoomProof,layout:layoutProof,basemapVisual:{cellsChecked:12,texturedCells:12,textureRatio:1}}}),false);assert.equal(isValidatedMap({...map,file:null,validation:{zoom:zoomProof,layout:layoutProof,basemapVisual:{cellsChecked:48,texturedCells:43,textureRatio:43/48}}}),false);});
test('지도 공식 도메인과 공유 경로만 허용하고 인증 URL·다른 출처 제외',()=>{
 assert.equal(safeMapUrl(url),url);for(const bad of ['http://ipji-talk.com/map?d=a','https://ipji-talk.com.evil.test/map?d=a','https://ipji-talk.com/map?token=secret','https://u:p@ipji-talk.com/map?d=a','https://ipji-talk.com/account'])assert.equal(safeMapUrl(bad),null);
 const found=extractCandidates([tool({result:{structuredContent:{url,expires_at:'2027-01-01T00:00:00Z',metadata:{collected_at:'2026-10-17T00:00:00Z'}}}}),{...tool({structuredContent:{url:'https://example.com/map'}}),server:'other'}]);assert.equal(found.urls.length,1);assert.equal(found.urls[0].url,url);assert.equal(found.urls[0].meta.expiresAt,'2027-01-01T00:00:00.000Z');assert.deepEqual(found.urls[0].meta.markers,[target]);
});
test('텍스트 내 JSON·중첩 MCP 결과에서 지도 주소 찾고 오류 도구는 제외',()=>{
 const xs=extractCandidates([tool({content:[{type:'text',text:JSON.stringify({url,marker_count:1})}]}),{...tool({isError:true,content:[{type:'text',text:url}]})}]);assert.equal(xs.urls.length,1);assert.equal(xs.failures.length,1);assert.equal(xs.urls[0].meta.markerCount,1);
});
test('번호·색상·거리 안내와 범례를 공개 지도 근거에 보존하고 주요 시설 표시를 모두 검증한다',()=>{
 const markers=[{...target,name:'01 '+target.name,color:'Red',info:'대상 단지 · 공식 기준점'},{name:'02 역 · 가상역',lat:37.401,lng:126.64,color:'Blue',info:'지하철 · 직선 111m'}],meta=extractCandidates([tool({structuredContent:{url}},{markers})]).urls[0].meta,state={...ready,markers,labels:markers.map(p=>p.name)};
 assert.deepEqual(meta.markerDetails,markers);assert.match(meta.legend,/빨강: 단지/);assert.match(meta.legend,/파랑: 지하철/);assert.equal(readyState(state,[target],meta.markers).ok,true);assert.equal(readyState({...state,labels:[markers[0].name]},[target],meta.markers).code,'MAP_FACILITY_OUTSIDE');assert.equal(readyState({...state,markers:[markers[0]]},[target],meta.markers).code,'MAP_FACILITY_MISMATCH');assert.equal(readyState({...state,markers:[markers[0],{...markers[1],lat:37.402}]},[target],meta.markers).code,'MAP_FACILITY_MISMATCH');
});
test('컨테이너 존재만으로 완료 판정하지 않고 배경·출처·좌표·보이는 단지명 검사',()=>{
 assert.equal(readyState(ready,[target]).ok,true);for(const change of [{tiles:0},{tileCoverage:.4},{attribution:false},{labels:[]},{markers:[{...target,lat:38}]},{markers:[{...target,name:'가상단지2차'}]}])assert.equal(readyState({...ready,...change},[target]).ok,false);assert.equal(readyState({...ready,error:true},[target]).code,'MAP_SERVICE_ERROR');assert.equal(imageCheck(image()).ok,true);assert.equal(imageCheck(image(true)).ok,false);
});
test('공유 지도가 안정적으로 렌더링된 뒤 캡처하고 근거 메타데이터 보관',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'map-ready-'));let closed=0,captures=0;
 class Window{constructor(){this.webContents={setWindowOpenHandler(){},session:{setPermissionRequestHandler(){}},on(){},async executeJavaScript(code){return mapJs.call(this,code);},async capturePage(){captures++;return image();}};}async loadURL(value){assert.equal(value,url);}isDestroyed(){return false;}destroy(){closed++;}}
 try{const capture=createMapCapture({BrowserWindow:Window,nativeImage:{},sleep:async()=>{},now:()=>Date.parse('2026-10-17T00:00:00Z')}),r=await capture([tool({structuredContent:{url,expires_at:'2027-01-01T00:00:00Z'}})],dir,{targets:[target]});assert.equal(r.status,'ready');assert.equal(r.provider,'NAVER');assert.equal(r.validation.targetCount,1);assert.equal(r.validation.basemapVisual.texturedColumns,8);assert.equal(r.validation.basemapVisual.texturedRows,6);assert.equal(captures,1);assert.equal(closed,1);assert.equal((await fs.readFile(path.join(dir,'figures',r.file),'utf8')),'test-image');assert.equal(JSON.parse(await fs.readFile(path.join(dir,'raw','map-capture.json'),'utf8')).status,'ready');assert.equal(isValidatedMap(r),true);}
 finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('새 주요 시설 지도는 모든 시설의 보이는 라벨과 색상 범례를 최종 캡처 기록에 보존한다',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'map-facilities-')),markers=[{...target,name:'01 '+target.name,color:'Red',info:'대상 단지 · 공식 기준점'},{name:'02 역 · 가상역',lat:37.401,lng:126.64,color:'Blue',info:'지하철 · 직선 111m'}],state={...ready,markers,labels:markers.map(p=>p.name)};
 class Window{constructor(){this.webContents={setWindowOpenHandler(){},session:{setPermissionRequestHandler(){}},on(){},async executeJavaScript(code){return mapJs.call(this,code,state);},async capturePage(){return image();}};}async loadURL(){}isDestroyed(){return false;}destroy(){}}
 try{const capture=createMapCapture({BrowserWindow:Window,nativeImage:{},sleep:async()=>{},now:()=>Date.parse('2026-10-20T02:00:00Z')}),r=await capture([tool({structuredContent:{url}},{markers})],dir,{targets:[target]});assert.equal(r.status,'ready');assert.deepEqual(r.markerDetails,markers);assert.match(r.legend,/파랑: 지하철/);assert.equal(r.validation.facilityCount,1);assert.equal(r.validation.facilityLabelsVisible,true);}
 finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('지도 요청 누락·만료·다른 단지인 경우 빈 캡처 없이 구체적인 실패 사유 반환',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'map-missing-'));let captured=0,opened=0;
 class Window{constructor(){opened++;this.webContents={setWindowOpenHandler(){},session:{setPermissionRequestHandler(){}},on(){},async executeJavaScript(){return {...ready,markers:[{...target,name:'다른단지'}]};},async capturePage(){captured++;return image();}};}async loadURL(){}isDestroyed(){return false;}destroy(){}}
 try{const capture=createMapCapture({BrowserWindow:Window,nativeImage:{},sleep:async()=>{},now:()=>Date.parse('2026-10-17T00:00:00Z')});const missing=await capture([],dir,{targets:[target]});assert.equal(missing.code,'MAP_NOT_REQUESTED');assert.ok(missing.reason);const expired=await capture([tool({structuredContent:{url,expires_at:'2020-01-01T00:00:00Z'}})],dir);assert.equal(expired.code,'MAP_URL_EXPIRED');assert.equal(opened,0);const wrong=await capture([tool({structuredContent:{url}})],dir,{targets:[target]});assert.equal(wrong.code,'MAP_TARGET_MISMATCH');assert.equal(opened,1);assert.equal(captured,0);assert.equal(wrong.file,null);}
 finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('지도 작업 취소 시 숨은 지도 창을 닫고 이미지를 저장하지 않음',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'map-abort-')),controller=new AbortController();let closed=0,captured=0;
 class Window{constructor(){this.closed=false;this.webContents={setWindowOpenHandler(){},session:{setPermissionRequestHandler(){}},on(){},async capturePage(){captured++;return image();}};}async loadURL(){controller.abort();}isDestroyed(){return this.closed;}destroy(){this.closed=true;closed++;}}
 try{const capture=createMapCapture({BrowserWindow:Window,nativeImage:{}});await assert.rejects(capture([tool({structuredContent:{url}})],dir,{targets:[target],signal:controller.signal}),/중지/);assert.equal(closed,1);assert.equal(captured,0);await assert.rejects(fs.stat(path.join(dir,'figures','ipjitalk-map.png')),{code:'ENOENT'});}
 finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('사이드바·마커만 있는 단색 배경은 지도 공간 정보로 인정하지 않음',()=>{
 const make=(cropped=false)=>({isEmpty:()=>false,getSize:()=>({width:1500,height:1000}),crop(){return make(true);},resize(){const pixels=Buffer.alloc(320*240*4);for(let y=0;y<240;y++)for(let x=0;x<320;x++){const i=(y*320+x)*4,overlay=!cropped&&x<60||x>210&&x<245&&y>45&&y<52;pixels[i]=overlay?(x*13+y*7)%256:244;pixels[i+1]=overlay?(x*17+y*11)%256:232;pixels[i+2]=overlay?(x*19+y*23)%256:223;pixels[i+3]=255;}return {getSize:()=>({width:320,height:240}),toBitmap:()=>pixels};}});
 const misleading=make();assert.equal(imageCheck(misleading).ok,true);const actual=basemapCheck(misleading,{rect:{x:280,y:0,width:1100,height:900},markerRects:[{x:1000,y:160,width:120,height:20}]});assert.equal(actual.ok,false);assert.ok(actual.texturedCells<12);assert.match(actual.reason,/도로·건물/);
});
function paintedImage(shape='full'){
 const pixels=Buffer.alloc(320*240*4);for(let y=0;y<240;y++)for(let x=0;x<320;x++){
  const textured=shape==='full'||shape==='vertical'&&x>=120&&x<200||shape==='horizontal'&&y>=80&&y<160,i=(y*320+x)*4;
  pixels[i]=textured?(x*13+y*7)%256:247;pixels[i+1]=textured?(x*17+y*11)%256:248;pixels[i+2]=textured?(x*19+y*23)%256:249;pixels[i+3]=255;
 }
 return {isEmpty:()=>false,getSize:()=>({width:1500,height:1000}),crop(){return this;},resize(){return {getSize:()=>({width:320,height:240}),toBitmap:()=>pixels};},toPNG:()=>Buffer.from(shape)};
}
test('DOM 타일 범위가 100%여도 세로·가로 띠만 그려진 지도는 저장·재사용 거절',()=>{
 assert.equal(readyState(ready,[target]).ok,true);assert.equal(ready.tileCoverage,1);
 for(const shape of ['vertical','horizontal']){
  const visual=basemapCheck(paintedImage(shape),ready);assert.equal(visual.ok,false);assert.equal(isValidatedMap({file:'ipjitalk-map.png',version:VERSION,validation:{zoom:zoomProof,layout:layoutProof,basemapVisual:visual}}),false);
  assert.ok(shape==='vertical'?visual.texturedColumns<6:visual.texturedRows<4);
 }
 const full=basemapCheck(paintedImage(),ready);assert.equal(full.ok,true);assert.equal(full.texturedColumns,8);assert.equal(full.texturedRows,6);assert.equal(full.textureRatio,1);
 for(const change of [{textureRatio:.699},{texturedColumns:5},{texturedRows:3}])assert.equal(isValidatedMap({file:'ipjitalk-map.png',version:VERSION,validation:{zoom:zoomProof,layout:layoutProof,basemapVisual:{...full,...change}}}),false);
 // The user's v2 image had 18/48 textured cells, despite 30 loaded tiles and full DOM coverage.
 assert.equal(isValidatedMap({file:'ipjitalk-map.png',version:VERSION,validation:{zoom:zoomProof,layout:layoutProof,basemapVisual:{cellsChecked:48,texturedCells:18,textureRatio:.375,texturedColumns:3,texturedRows:6}}}),false);
});
test('보이는 타일 해독과 글꼴 완료 뒤 두 프레임을 기다림',async()=>{
 const vm=require('node:vm'),frames=[];let decodeDone,fontDone,decoded=0;
 const rect={left:0,top:0,right:800,bottom:600,width:800,height:600},tile={src:'https://map.pstatic.net/tile.png',complete:true,naturalWidth:256,naturalHeight:256,getBoundingClientRect:()=>rect,decode(){decoded++;return new Promise(resolve=>{decodeDone=resolve;});}},outside={...tile,getBoundingClientRect:()=>({...rect,left:900,right:1156}),decode(){throw new Error('화면 밖 타일을 기다리면 안 됩니다.');}};
 const logo={...tile,src:'https://ssl.pstatic.net/static/maps/mantle/1x/new-naver-logo-normal.png',naturalWidth:46,naturalHeight:11,getBoundingClientRect:()=>({...rect,right:46,bottom:11,width:46,height:11}),decode(){throw new Error('네이버 로고를 배경 타일로 해독하면 안 됩니다.');}};
 const context={document:{querySelector:()=>({getBoundingClientRect:()=>rect,querySelectorAll:()=>[tile,outside,logo]}),fonts:{ready:new Promise(resolve=>{fontDone=resolve;})}},getComputedStyle:()=>({display:'block',visibility:'visible'}),requestAnimationFrame:callback=>frames.push(callback)};
 const pending=vm.runInNewContext(PAINT_READY,context);assert.equal(decoded,1);assert.equal(frames.length,0);decodeDone();await new Promise(setImmediate);assert.equal(frames.length,0);fontDone();await new Promise(setImmediate);assert.equal(frames.length,1);frames.shift()();assert.equal(frames.length,1);frames.shift()();assert.equal(await pending,true);
 tile.decode=async()=>{throw new Error('해독 실패');};assert.equal(await vm.runInNewContext(PAINT_READY,context),false);
});
test('타일 해독 대기는 남은 시간과 취소 신호로 끝나며 타이머를 남기지 않음',async()=>{
 const contents={executeJavaScript:()=>new Promise(()=>{})};assert.equal(await waitForPaint(contents,5),false);
 const controller=new AbortController(),pending=waitForPaint(contents,30000,controller.signal);controller.abort();assert.equal(await pending,false);assert.equal(await waitForPaint(contents,30000,controller.signal),false);
 assert.equal(await waitForPaint({executeJavaScript:async()=>true},30000),true);
});
test('기본 배율 유지 근거가 없거나 한 단계라도 바뀌면 최신 지도도 재사용 거절',()=>{
 const map={file:'map.png',version:VERSION,validation:{zoom:zoomProof,layout:layoutProof,basemapVisual:{cellsChecked:48,texturedCells:48,textureRatio:1,texturedColumns:8,texturedRows:6}}};assert.equal(isValidatedMap(map),true);
 for(const zoom of [null,{...zoomProof,after:16},{...zoomProof,after:14},{...zoomProof,steps:1},{...zoomProof,proof:'estimated'},{...zoomProof,method:'pixel-scale'}])assert.equal(isValidatedMap({...map,validation:{...map.validation,zoom}}),false);
});
test('하단 목록의 위치·폭·색상·모든 항목 증거가 부족하면 최신 지도도 거절',()=>{
 const map={file:'map.png',version:VERSION,validation:{zoom:zoomProof,layout:layoutProof,basemapVisual:{cellsChecked:48,texturedCells:48,textureRatio:1,texturedColumns:8,texturedRows:6}}};assert.equal(isValidatedMap(map),true);
 for(const change of [{position:'left'},{markerListMatches:false},{colorsPreserved:false},{controlsPreserved:false},{allItemsVisible:false},{horizontalGainPx:0},{mapWidthAfter:1100},{columnCount:1},{minFontSizePx:19.99},{mapHeight:749},{legendHeight:149},{listRect:{...layoutProof.listRect,y:0}}])assert.equal(isValidatedMap({...map,validation:{...map.validation,layout:{...layoutProof,...change}}}),false);
 assert.equal(isValidatedMap({...map,version:'2026-10-21-one-level-zoom-map-v5'}),false);
 assert.equal(isValidatedMap({...map,version:'2026-10-21-default-zoom-bottom-list-map-v6'}),false);
 const before=mapJs.call({},'read'),after=mapJs.call({bottom:true},'read');assert.equal(bottomLayoutEvidence(after,before,[target]).colorsPreserved,true);after.markerList.items[0].color='rgb(0, 0, 0)';assert.equal(bottomLayoutEvidence(after,before,[target]).colorsPreserved,false);after.markerList.items=[];assert.equal(bottomLayoutEvidence(after,before,[target]).markerListMatches,false);
});
function savedMapFixture(){return {status:'ready',file:'old-map.png',url,version:'2026-10-21-one-level-zoom-map-v5',provider:'NAVER',expiresAt:'2026-10-27T00:00:00Z',providedAt:'2026-10-20T00:00:00Z',capturedAtTime:'2026-10-20T00:01:00Z',markers:[target],markerDetails:[{...target,color:'Red',info:'대상 단지'}],validation:{tileCount:18,tileCoverage:1,coordinates:'WGS84 (EPSG:4326)',basemapVisual:{cellsChecked:48,texturedCells:48,textureRatio:1,texturedColumns:8,texturedRows:6}}};}
test('보관된 실제 v4·v5·v6·v7 공유 URL만 만료·대상·전체 마커를 검증해 재캡처 후보로 허용',()=>{
 const saved=savedMapFixture(),now=Date.parse('2026-10-21T00:00:00Z');for(const version of ['2026-10-20-key-facilities-map-v4',saved.version,'2026-10-21-default-zoom-bottom-list-map-v6',VERSION]){const c=safeSavedCandidate({...saved,version},[target],{now});assert.equal(c.url,url);assert.equal(c.meta.reuse.previousCaptureVersion,version);assert.equal(c.meta.markerDetails.length,1);}
 for(const patch of [{url:'https://evil.test/map'},{expiresAt:new Date(now+60000).toISOString()},{provider:'OTHER'},{version:'unverified'},{capturedAtTime:new Date(now+1).toISOString()},{markers:[]},{markerDetails:[{...target,color:'Red',lat:37.41}]},{markerDetails:[]},{validation:{...saved.validation,tileCount:null}}])assert.equal(safeSavedCandidate({...saved,...patch},[target],{now}),null);
 assert.equal(safeSavedCandidate(saved,[],{now}),null);assert.equal(safeSavedCandidate(saved,[{...target,lat:37.401}],{now}),null);
});
test('기존24px 지도 URL을 재사용해도 전후 지도·목록 높이 근거는 보존한다',()=>{
 const saved=savedMapFixture();saved.version='2026-10-21-default-zoom-bottom-list-map-v6';saved.validation.layout={...layoutProof,minFontSizePx:24,mapRect:{x:0,y:0,width:1484,height:702.875},listRect:{x:0,y:702.875,width:1484,height:282.125}};
 const c=safeSavedCandidate(saved,[target],{now:Date.parse('2026-10-21T00:00:00Z')});assert.deepEqual(c.meta.reuse.previousLayout,{mapHeight:702.875,legendHeight:282.125,minFontSizePx:24});assert.equal(isValidatedMap(saved),false);
});
test('유효한 보관 지도 URL은 새 도구 응답 없이 실제 페이지를 다시 렌더링한다',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'map-saved-public-'));let opened=0;
 class Window{constructor(){this.webContents={setWindowOpenHandler(){},session:{setPermissionRequestHandler(){}},on(){},async executeJavaScript(code){return mapJs.call(this,code);},async capturePage(){return image();}};}async loadURL(value){opened++;assert.equal(value,url);}isDestroyed(){return false;}destroy(){}}
 try{const capture=createMapCapture({BrowserWindow:Window,nativeImage:{},sleep:async()=>{},now:()=>Date.parse('2026-10-21T00:00:00Z')}),r=await capture([],dir,{targets:[target],savedMap:savedMapFixture()});assert.equal(r.status,'ready');assert.equal(opened,1);assert.equal(r.sourceReuse.kind,'saved-public-map-url');assert.equal(r.sourceReuse.previousCaptureVersion,'2026-10-21-one-level-zoom-map-v5');assert.equal(r.validation.zoom.after,r.validation.zoom.before);assert.equal(r.validation.layout.position,'bottom');assert.equal(isValidatedMap(r),true);}
 finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('화면 밖 시설 라벨에 맞춰 캡처 창을 키우며 좌표·마커는 변경하지 않음',()=>{
 const state={...ready,markerRects:[{x:700,y:-100,width:150,height:16},{x:900,y:1100,width:240,height:16}]};
 const size=expandedViewport(state,[1500,1050]);assert.ok(size[1]>1050);assert.ok(size[1]<=2400);assert.ok(size[0]>=1500);assert.deepEqual(state.markers,[target]);assert.equal(expandedViewport({...ready,markerRects:[{x:700,y:400,width:100,height:16}]},[1500,1050]),null);
});
test('원본 목록 노드를 하단으로 옮기고 겹친 지도 라벨만 분리한다',()=>{
 const vm=require('node:vm'),events=[],rows=[{style:{}}],names=[{style:{}}],list={style:{},querySelectorAll:q=>q==='.mk-item'?rows:names},side={style:{},querySelector:()=>null},mapwrap={style:{}},wrap={style:{},appendChild(e){this.moved=e;}},elements={'#wrap':wrap,'#sidebar':side,'#mapwrap':mapwrap,'#mklist':list};side.parentElement=wrap;mapwrap.parentElement=wrap;
 const result=vm.runInNewContext(LAYOUT_BOTTOM,{document:{querySelector:q=>elements[q]},window:{dispatchEvent:e=>events.push(e)},Event:class {constructor(type){this.type=type;}}});assert.equal(result,true);assert.equal(wrap.moved,side);assert.equal(wrap.style.flexDirection,'column');assert.equal(list.style.display,'grid');assert.equal(events.length,1);assert.equal(events[0].type,'resize');
 const labels=['12 영어','13 수학'].map((name,i)=>({childElementCount:0,textContent:name,style:{},getBoundingClientRect(){const dy=Number(this.style.transform?.match(/\d+/)?.[0]||0);return {left:700+i,right:880+i,top:400+i+dy,bottom:416+i+dy,width:180,height:16};}}));const mapMarkers=labels.map((e,i)=>({name:e.textContent,lat:37.4+i*.00001,lng:126.64})),before=JSON.stringify(mapMarkers);
 const changed=vm.runInNewContext(LAYOUT_LABELS,{window:{__MAP_DATA__:{markers:mapMarkers}},document:{querySelector:()=>({querySelectorAll:()=>labels})}});assert.equal(changed.length,1);assert.equal(changed[0].name,'13 수학');assert.ok(changed[0].dy>0);assert.equal(JSON.stringify(mapMarkers),before);assert.equal(labels[0].style.transform,undefined);
});
test('공개 공유 주소 없이 반환된 이미지는 픽셀 확대로 대체하지 않음',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'map-image-only-'));let opened=0;
 try{const capture=createMapCapture({BrowserWindow:class {constructor(){opened++;}},nativeImage:{createFromBuffer(){throw new Error('이미지를 가공하면 안 됩니다.');}}}),result=await capture([tool({content:[{type:'image',mimeType:'image/png',data:'YQ=='}]})],dir,{targets:[target]});assert.equal(result.code,'MAP_LAYOUT_UNAVAILABLE');assert.equal(result.file,null);assert.equal(opened,0);}
 finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('목록 재배치 후 실제 배율이 바뀌면 캡처하지 않음',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'map-zoom-unverified-'));let tick=0,captured=0;
 class Window{constructor(){this.webContents={setWindowOpenHandler(){},session:{setPermissionRequestHandler(){}},on(){},async executeJavaScript(code){if(code===LAYOUT_BOTTOM){this.bottom=true;return true;}return code===PAINT_READY?true:{...ready,zoom:this.bottom?16:15};},async capturePage(){captured++;return image();}};}async loadURL(){}isDestroyed(){return false;}destroy(){}}
 try{const capture=createMapCapture({BrowserWindow:Window,nativeImage:{},timeoutMs:2500,maxAttempts:1,sleep:async ms=>{tick+=ms;},now:()=>tick}),result=await capture([tool({structuredContent:{url}})],dir,{targets:[target]});assert.equal(result.code,'MAP_ZOOM_UNVERIFIED');assert.equal(result.file,null);assert.equal(captured,0);}
 finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('부분적으로 그려진 첫 캡처를 버리고 제한 시간 안의 완성된 지도만 저장',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'map-paint-retry-'));let tick=0,captures=0,closed=0,paintWaits=0;
 class Window{constructor(){this.webContents={setWindowOpenHandler(){},session:{setPermissionRequestHandler(){}},on(){},async executeJavaScript(code){if(code===PAINT_READY){paintWaits++;return true;}return mapJs.call(this,code);},async capturePage(){captures++;return paintedImage(captures===1?'vertical':'full');}};}async loadURL(){}isDestroyed(){return false;}destroy(){closed++;}}
 try{const capture=createMapCapture({BrowserWindow:Window,nativeImage:{},timeoutMs:6000,maxAttempts:1,sleep:async ms=>{tick+=ms;},now:()=>tick}),result=await capture([tool({structuredContent:{url}})],dir,{targets:[target]});assert.equal(result.status,'ready');assert.equal(captures,2);assert.equal(paintWaits,2);assert.equal(closed,1);assert.equal(await fs.readFile(path.join(dir,'figures',result.file),'utf8'),'full');assert.equal(result.validation.basemapVisual.textureRatio,1);}
 finally{await fs.rm(dir,{recursive:true,force:true});}
});
