'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const walk=require('../src/naver-walking.cjs'),{todayKst}=require('../src/core.cjs');
const identity={code:'20033297',building:'천연뜨란채',regionCode:'11410',province:'서울특별시',region:'서대문구',town:'천연동',lot:'145',road:'독립문로8길 54',lat:37.567566,lng:126.9584477},input={asset:'apartment',asOf:todayKst()},prices={buildingResolution:identity};
const fact={category:'shopping',name:'극동할인마트',classification:'슈퍼,마트',address:'서울 서대문구 독립문공원길 13',placeId:'31398050',sourceUrl:'https://map.naver.com/p/entry/place/31398050',checkedAt:new Date().toISOString(),distanceBasis:'거리 미산정'};
const origin=walk.originOf(input,prices),selected={index:0,name:'천연뜨란채아파트',classification:'아파트',address:'서울특별시 서대문구 독립문로8길 54'},destination={placeId:fact.placeId,name:fact.name,address:fact.address,sourceUrl:fact.sourceUrl};
const route='https://map.naver.com/p/directions/3zgQjs,2AM6Wg,'+encodeURIComponent(selected.name)+',18736346,PLACE_POI/3zgPJG,2AMhh4,'+encodeURIComponent(fact.name)+',31398050,PLACE_POI/-/walk?c=15.00,0,0,0,dh';
const state=(changes={})=>({url:route,selectedMode:'도보',originLabel:selected.name,destinationLabel:fact.name,summaries:[{option:'추천',selected:true,scope:'route-total',distanceText:'832m',durationText:'16분'},{option:'계단회피',selected:false,scope:'route-total',distanceText:'835m',durationText:'16분'}],...changes});
const record=()=>walk.walkingFromState(state(),{origin,destination,originSelection:selected});
test('a rendered recommended walking route is bound to the exact official apartment and Naver place',()=>{
 const w=record();assert.ok(walk.validWalking(w,{input,identity,fact}));assert.equal(w.distanceM,832);assert.equal(w.durationMin,16);assert.equal(walk.displayDistance(w),'네이버 도보 832m · 16분');assert.equal(w.destination.placeId,fact.placeId);assert.equal(w.destination.lat,undefined);assert.equal(w.destination.lng,undefined);assert.equal(w.proof.coordinateBasis,'naver-route-url-opaque');assert.equal(w.origin.routeEndpoint,'3zgQjs,2AM6Wg,'+encodeURIComponent(selected.name)+',18736346,PLACE_POI');
});
test('vehicle, transit, missing walking tab and segment distances never become walking totals',()=>{
 for(const changes of [{url:route.replace('/walk?','/car?')},{url:route.replace('/walk?','/transit?')},{selectedMode:'자동차'},{summaries:[{option:'추천',selected:true,scope:'segment',distanceText:'832m',durationText:'16분'}]},{summaries:[{option:'계단회피',selected:true,scope:'route-total',distanceText:'835m',durationText:'16분'}]},{summaries:[{option:'추천',selected:true,scope:'route-total',distanceText:'832',durationText:'16분'}]},{summaries:[{option:'추천',selected:true,scope:'route-total',distanceText:'832m',durationText:''}]},{blocked:true},{originLabel:'천연뜨란채상가'},{destinationLabel:'다른마트'}])assert.equal(walk.walkingFromState(state(changes),{origin,destination,originSelection:selected}),null);
});
test('same-name or adjacent facilities and changed identity cannot reuse a verified route',()=>{
 for(const f of [{...fact,placeId:'999'},{...fact,name:'극동마트'},{...fact,address:'서울 서대문구 독립문공원길 99'},{...fact,checkedAt:'2020-01-01T00:00:00Z'},{...fact,sourceUrl:'https://evil.example/place/31398050'}])assert.equal(walk.validWalking(record(),{input,identity,fact:f}),false);
 for(const i of [{...identity,code:'999'},{...identity,lat:37.56},{...identity,lot:'146',road:''}])assert.equal(walk.validWalking(record(),{input,identity:i,fact}),false);
 const tampered=record();tampered.distanceM=600;assert.equal(walk.validWalking(tampered,{input,identity,fact}),false);tampered.distanceM=832;tampered.sourceUrl=route.replace('31398050','31398051');assert.equal(walk.validWalking(tampered,{input,identity,fact}),false);
});
test('distance and time retain public units without a straight-line multiplier or default speed',()=>{
 assert.equal(walk.distanceMetres('1.25km'),1250);assert.equal(walk.distanceMetres('1,032m'),1032);assert.equal(walk.durationMinutes('1시간 12분'),72);for(const v of ['직선 832m','832','832걸음','0m','NaN km','100001m'])assert.equal(walk.distanceMetres(v),null);for(const v of ['약 16분','16','0분','자동차 16분'])assert.equal(walk.durationMinutes(v),null);
});
test('origin selection requires a unique apartment with matching official road or lot address',()=>{
 assert.equal(walk.selectOrigin([selected,{...selected,name:'천연뜨란채',classification:'주택건설',address:'서울특별시 서대문구 천연동 120-1'}],origin),selected);assert.equal(walk.selectOrigin([selected,{...selected,index:1}],origin),null);assert.equal(walk.selectOrigin([{...selected,name:'천연뜨란채아파트상가'}],origin),null);assert.equal(walk.selectOrigin([{...selected,address:'서울특별시 서대문구 독립문로8길 540'}],origin),null);
 assert.ok(walk.sameAddress('서울특별시 서대문구 독립문공원길 13','서울 서대문구 독립문공원길 13 1층'));assert.equal(walk.sameAddress('서울 서대문구 독립문공원길 13','서울 서대문구 독립문공원길 130'),false);
});
test('only the same place iframe name and address establish the destination',()=>{
 const s={url:'https://pcmap.place.naver.com/place/31398050/home',name:fact.name,address:fact.address};assert.ok(walk.placeFromState(s,fact));for(const change of [{url:s.url.replace('31398050','31398051')},{name:'비슷한마트'},{address:'서울 서대문구 독립문공원길 130'},{blocked:true}])assert.equal(walk.placeFromState({...s,...change},fact),null);
});
function fixture({blocked=false,mismatch=false,hang=false,commitDelay=0}={}){
 const windows=[];class BrowserWindow{
  constructor(options){this.options=options;this.phase='place';this.destroyed=false;this.webContents=new EventEmitter();this.webContents.setWindowOpenHandler=fn=>{this.popup=fn;};this.webContents.session={setPermissionRequestHandler:fn=>{this.permission=fn;}};const frame={url:'https://pcmap.place.naver.com/place/31398050/home',executeJavaScript:async code=>{if(code===walk.PLACE_STATE)return {url:frame.url,name:fact.name,address:mismatch?'서울 서대문구 독립문공원길 130':fact.address,blocked};this.phase='destination';return true;}};this.webContents.mainFrame={framesInSubtree:[frame]};this.webContents.executeJavaScript=async code=>{if(hang)return new Promise(()=>{});if(code===walk.ROUTE_STATE){if(this.phase==='walk')return state();return {url:route,blocked,originLabel:selected.name,destinationLabel:fact.name,rows:this.phase==='rows'?[selected]:[]};}if(code.includes('HTMLInputElement.prototype')){this.phase='origin';return true;}if(code.includes('button.btn_departure')){this.phase='chosen';return true;}if(code.includes("text(e)==='도보'")){this.phase='walk';return true;}return {blocked};};this.webContents.sendInputEvent=()=>{this.phase='rows';};windows.push(this);
  }async loadURL(url){this.url=url;if(commitDelay){this.commitReads=0;const execute=this.webContents.executeJavaScript;this.webContents.executeJavaScript=async code=>{if(code===walk.ROUTE_STATE&&this.phase==='chosen'&&this.commitReads++<commitDelay)return {...state(),url:route.replace(/\/directions\/[^/]+\//,'/directions/-/')};if(code.includes("text(e)==='도보'")&&this.phase==='chosen'&&this.commitReads<=commitDelay)throw Error('The route UI has not committed its selected origin');return execute(code);};}}isDestroyed(){return this.destroyed;}destroy(){this.destroyed=true;}
 }return {BrowserWindow,windows};
}
test('reader merges the same-day origin/destination route and stores no customer conditions',async()=>{
 const f=fixture(),read=walk.createNaverWalkingReader({BrowserWindow:f.BrowserWindow});const a=await read(input,prices,{facts:[fact,{...fact,sourceId:'same-place-second-category'}]}),b=await read({...input,clientName:'different customer',area:99},prices,{facts:[fact]});assert.equal(a.status,'received');assert.equal(a.facts.length,2);assert.ok(walk.validWalking(a.facts[0].walking,{input,identity,fact}));assert.equal(f.windows.length,1);assert.equal(b.routeCoverage[0].reused,true);assert.equal(a.routeCoverage[1].reused,true);assert.ok(f.windows[0].destroyed);assert.equal(f.windows[0].options.webPreferences.nodeIntegration,false);assert.equal(f.windows[0].options.webPreferences.sandbox,true);assert.doesNotMatch(JSON.stringify(b),/different customer|clientName/);
 const forced=await read(input,prices,{facts:[fact],forceRefresh:true});assert.equal(forced.status,'received');assert.equal(f.windows.length,2);
});
test('walking mode waits for the origin selection to be committed by the map UI',async()=>{
 const f=fixture({commitDelay:3}),read=walk.createNaverWalkingReader({BrowserWindow:f.BrowserWindow}),r=await read(input,prices,{facts:[fact]});assert.equal(r.status,'received');assert.ok(walk.validWalking(r.facts[0].walking,{input,identity,fact}));assert.equal(f.windows[0].commitReads,4);
});
test('access check, mismatched address, missing facility id and timeout never supply a fabricated route',async()=>{
 for(const options of [{blocked:true},{mismatch:true},{hang:true}]){const f=fixture(options),read=walk.createNaverWalkingReader({BrowserWindow:f.BrowserWindow,timeoutMs:400}),r=await read(input,prices,{facts:[fact]});assert.equal(r.status,'unavailable');assert.equal(r.facts[0].walking,undefined);assert.equal(r.facts[0].routeStatus,'unavailable');assert.ok(f.windows[0].destroyed);}
 const f=fixture(),read=walk.createNaverWalkingReader({BrowserWindow:f.BrowserWindow}),r=await read(input,prices,{facts:[{...fact,placeId:undefined}]});assert.equal(r.facts[0].walking,undefined);assert.equal(f.windows.length,0);
});
test('abort and historical dates never start live route reads',async()=>{
 const f=fixture(),read=walk.createNaverWalkingReader({BrowserWindow:f.BrowserWindow}),controller=new AbortController();controller.abort();await assert.rejects(read(input,prices,{facts:[fact],signal:controller.signal}),/중지/);const r=await read({...input,asOf:'2020-01-01'},prices,{facts:[fact]});assert.equal(r.status,'unavailable');assert.equal(f.windows.length,0);
});
