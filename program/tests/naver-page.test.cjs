'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events'),vm=require('node:vm');
const {safeComplexUrl,safePageUrl,fromPage,createNaverPageReader}=require('../src/naver-page.cjs');
const url='https://fin.land.naver.com/complexes/108450';
function state(change={}){return {url,title:'송도동 베르디움더퍼스트 시세/실거래, 매물, 중개사, 살아본 후기',headings:['베르디움더퍼스트\nVR\n투어'],renderedComplexNo:'108450',bodyText:'기본 정보\n도로명\n인천시 연수구 송도문화로84번길 84\n복사\n지번\n송도동 192-8\n복사\n사용승인일\n2017. 2. 1.\n세대수\n1,834세대\n동수\n15개\n주차\n2,434대\n(세대당 1.32대)\n학교\n인천첨단초등학교\n호가\n6.5억',tables:[],...change};}
test('only public complex links are accepted and navigation queries never survive',()=>{
 assert.equal(safeComplexUrl(url+'?token=secret&ms=37,126#secret').href,url+'?tab=complex-info');
 assert.equal(safeComplexUrl('https://new.land.naver.com/complexes/108450/').href,'https://new.land.naver.com/complexes/108450?tab=complex-info');
 assert.equal(safePageUrl('https://fin.land.naver.com/map?layer=complexDetail&token=secret&ms=37,126#secret').href,'https://fin.land.naver.com/map?layer=complexDetail');assert.equal(safePageUrl('https://fin.land.naver.com/map'),null);
 for(const v of ['http://fin.land.naver.com/complexes/108450','https://fin.land.naver.com.evil.example/complexes/108450','https://user:secret@fin.land.naver.com/complexes/108450','https://fin.land.naver.com/articles/108450','https://fin.land.naver.com/map','https://fin.land.naver.com/complexes/108450/photos','file:///C:/secret','https://fin.land.naver.com/complexes/108450/extra'])assert.equal(safeComplexUrl(v),null,v);
});
test('rendered label text supplies full address and public parking while unrelated claims are omitted',()=>{
 const r=fromPage(url,state());assert.equal(r.name,'베르디움더퍼스트');assert.equal(r.addressJibun,'인천시 연수구 송도동 192-8');assert.equal(r.addressRoad,'인천시 연수구 송도문화로84번길 84');assert.deepEqual(r.basic,{approvalDate:'2017-02-01',units:1834,parkingSpaces:2434});assert.equal(r.complexNo,'108450');assert.equal(r.sourceUrl,url);assert.ok(Date.now()-Date.parse(r.checkedAt)<2000);assert.equal(r.lat,undefined);assert.doesNotMatch(JSON.stringify(r),/첨단초|6\.5억|bodyText|학교|호가/);
 const redirected=fromPage(url,state({url:'https://fin.land.naver.com/map?layer=complexDetail&ms=37,126'}));assert.equal(redirected.complexNo,'108450');assert.equal(redirected.sourceUrl,url);
 const mapInput=fromPage('https://fin.land.naver.com/map?layer=complexDetail',state({url:'https://fin.land.naver.com/map?layer=complexDetail'}));assert.equal(mapInput.sourceUrl,url);
});
test('explicit public tables, JSON-LD and native detail preserve only verified fields',()=>{
 const r=fromPage(url,state({bodyText:'',headings:['베르디움더퍼스트'],tables:[{label:'단지명',value:'베르디움더퍼스트'},{label:'지번 주소',value:'인천시 연수구 송도동 192-8'},{label:'주차대수',value:'2,434대'},{label:'세대수',value:'1,834'}]}));assert.equal(r.basic.parkingSpaces,2434);assert.equal(r.basic.units,1834);
 const ld=fromPage(url,{title:'Npay부동산',headings:[],structured:{'@type':'ApartmentComplex',name:'베르디움더퍼스트',address:{addressRegion:'인천시',addressLocality:'연수구',streetAddress:'송도동 192-8'},geo:{latitude:37,longitude:126}}});assert.equal(ld.name,r.name);assert.equal(ld.lat,undefined);
 const native=fromPage(url,{title:'Npay부동산',structured:{complexDetail:{complexNo:'108450',complexName:'베르디움더퍼스트',address:'인천시 연수구 송도동 192-8',latitude:37.369919,longitude:126.65528,totalHouseholdCount:1834,totalParkingCount:2434}}});assert.equal(native.coordinateBasis,'complex');assert.equal(native.basic.parkingSpaces,2434);
});
test('generic loading pages, missing identity, ambiguous addresses and another displayed complex are rejected',()=>{
 for(const s of [state({url:'https://fin.land.naver.com/complexes/110656'}),state({renderedComplexNo:'110656'}),state({url:'https://fin.land.naver.com/map',renderedComplexNo:null}),state({url:'https://evil.example/map'}),{title:'Npay부동산',bodyText:'loading',tables:[]},state({bodyText:'세대수\n1,834세대'}),{title:'Npay부동산',bodyText:'비정상적인 접근 자동입력 방지'},{title:'Npay부동산',structured:[{name:'단지A',address:'인천시 연수구 송도동 1'},{name:'단지B',address:'인천시 연수구 송도동 2'}]},state({structured:{complexDetail:{complexNo:'110656'}}})])assert.throws(()=>fromPage(url,s));
 assert.throws(()=>fromPage('https://example.com',state()),/단지 링크/);
});
function fakeBrowser({states=[state()],destination=url,loadError=false,hang=false}={}){
 const windows=[];class BrowserWindow{constructor(options){this.options=options;this.destroyed=false;this.calls=[];this.webContents=new EventEmitter();this.webContents.session={setPermissionRequestHandler:handler=>this.permission=handler};this.webContents.setWindowOpenHandler=handler=>this.popup=handler;this.webContents.getURL=()=>destination;this.webContents.executeJavaScript=async script=>{this.calls.push(script);if(script.includes('dataset.codexPublicRead'))return true;return states.length>1?states.shift():states[0];};windows.push(this);}async loadURL(value){this.loaded=value;if(loadError)throw Error('connection refused');if(hang)await new Promise(()=>{});}isDestroyed(){return this.destroyed;}destroy(){this.destroyed=true;}}
 return {BrowserWindow,windows};
}
test('page reader uses a temporary sandbox, waits for public content and blocks popup and unrelated navigation',async()=>{
 const f=fakeBrowser({states:[{title:'Npay부동산'},state()],destination:'https://fin.land.naver.com/map?layer=complexDetail'}),read=createNaverPageReader({BrowserWindow:f.BrowserWindow,timeoutMs:1000}),r=await read(url+'?token=secret');assert.equal(r.basic.parkingSpaces,2434);const win=f.windows[0];assert.equal(win.options.show,false);assert.equal(win.options.webPreferences.sandbox,true);assert.equal(win.options.webPreferences.nodeIntegration,false);assert.equal(win.options.webPreferences.contextIsolation,true);assert.ok(!win.options.webPreferences.partition.startsWith('persist:'));assert.equal(win.loaded,url+'?tab=complex-info');assert.equal(win.destroyed,true);assert.deepEqual(win.popup(),{action:'deny'});let permission;win.permission({},'geolocation',value=>permission=value);assert.equal(permission,false);
 let prevented=false;win.webContents.emit('will-navigate',{preventDefault:()=>prevented=true},'https://evil.example/');assert.equal(prevented,true);prevented=false;win.webContents.emit('will-redirect',{preventDefault:()=>prevented=true},'https://new.land.naver.com/complexes/108450');assert.equal(prevented,false);
});
test('page reader cancels and closes promptly, bounds loading and returns clear connection errors',async()=>{
 const timeout=fakeBrowser({hang:true});await assert.rejects(createNaverPageReader({BrowserWindow:timeout.BrowserWindow,timeoutMs:30})(url),/시간이 초과/);assert.equal(timeout.windows[0].destroyed,true);
 const error=fakeBrowser({loadError:true});await assert.rejects(createNaverPageReader({BrowserWindow:error.BrowserWindow})(url),/연결하지 못/);assert.equal(error.windows[0].destroyed,true);
 const cancelled=fakeBrowser({hang:true}),controller=new AbortController(),pending=createNaverPageReader({BrowserWindow:cancelled.BrowserWindow})(url,{signal:controller.signal});controller.abort();await assert.rejects(pending,/중지/);assert.equal(cancelled.windows[0].destroyed,true);
 const invalid=fakeBrowser();await assert.rejects(createNaverPageReader({BrowserWindow:invalid.BrowserWindow})('https://example.com'),/단지 링크/);assert.equal(invalid.windows.length,0);
 const mismatch=fakeBrowser({states:[state({renderedComplexNo:'110656'})],destination:'https://fin.land.naver.com/map'});await assert.rejects(createNaverPageReader({BrowserWindow:mismatch.BrowserWindow,timeoutMs:30})(url),/단지번호/);assert.equal(mismatch.windows[0].destroyed,true);
});
test('a copied map link binds only the single displayed complex and discards its map query from the result',async()=>{
 const f=fakeBrowser({states:[state()],destination:'https://fin.land.naver.com/map?layer=public-complex'}),r=await createNaverPageReader({BrowserWindow:f.BrowserWindow})('https://fin.land.naver.com/map?layer=public-complex&ms=37,126&token=secret');assert.equal(r.sourceUrl,url);assert.equal(r.complexNo,'108450');assert.equal(f.windows[0].loaded,'https://fin.land.naver.com/map?layer=public-complex');assert.doesNotMatch(JSON.stringify(r),/public-complex|secret|layer=|ms=/);
 const empty=fakeBrowser({states:[state({renderedComplexNo:null})],destination:'https://fin.land.naver.com/map'});await assert.rejects(createNaverPageReader({BrowserWindow:empty.BrowserWindow,timeoutMs:30})('https://fin.land.naver.com/map?layer=public-complex'),/단지번호/);
});
test('the actual captured collapsed location stays unverified until its address disclosure opens',()=>{
 const captured=state({bodyText:'기본 정보\n위치\n인천시 연수구 송도문화로84번길 84\n상세내역 보기\n사용승인일\n2017. 2. 1. (10년차)\n세대수\n1,834세대\n주차\n2,434대 (세대당 1.32대)',tables:[{label:'사용승인일',value:'2017. 2. 1. (10년차)'},{label:'세대수',value:'1,834세대'},{label:'주차',value:'2,434대 (세대당 1.32대)'}]});assert.throws(()=>fromPage(url,captured),/지번주소/);
 captured.bodyText=captured.bodyText.replace('상세내역 보기','상세내역 보기\n도로명\n인천시 연수구 송도문화로84번길 84\n복사\n지번\n송도동 192-8\n복사');const result=fromPage(url,captured);assert.equal(result.addressJibun,'인천시 연수구 송도동 192-8');assert.equal(result.basic.parkingSpaces,2434);
 captured.tables.unshift({label:'도로명',value:'인천시 연수구 송도문화로84번길 84복사'},{label:'지번',value:'송도동 192-8복사'});const copied=fromPage(url,captured);assert.equal(copied.addressJibun,result.addressJibun);assert.equal(copied.addressRoad,'인천시 연수구 송도문화로84번길 84');
});
test('address preparation tolerates line breaks, retries before hydration and leaves an opened disclosure open',async()=>{
 const f=fakeBrowser();await createNaverPageReader({BrowserWindow:f.BrowserWindow})(url);const prepare=f.windows[0].calls.find(s=>s.includes('dataset.codexPublicRead'));let clicks=0;const location={innerText:'위치\n인천시 연수구 송도문화로84번길 84'},button={innerText:'인천시 연수구 송도문화로84번길 84\n상세내역\n보기',dataset:{},getAttribute:()=>null,closest:()=>location,click:()=>{if(++clicks===2)location.innerText+='\n지번\n송도동 192-8';}},root={innerText:'기본 정보\n'+location.innerText,querySelectorAll:()=>[button]},context={document:{querySelector:()=>root}};
 vm.runInNewContext(prepare,context);vm.runInNewContext(prepare,context);vm.runInNewContext(prepare,context);assert.equal(clicks,2);
});
test('the same page supplies source-separated school, bus and public basic facts without student or teacher statistics',()=>{
 const s=state({sections:{education:'배정 초등학교\n상세내용 숨기기\n인천첨단초등학교\n분류\n공립\n학급당 학생 수\n약 24.7명\n교사당 학생 수\n약 17명\n거리\n519m도보 7분\n지도보기\n배정동\n전체동\n주소지에 따라 자동 배정',transport:'주변 대중교통\n상세내용 숨기기\n버스\n간선\n16, 4, 58, 6, 81\n지선\n4401, 순환41, 순환42, 순환43, 연수02\n급행간선\n급행99'},tables:[{label:'난방',value:'지역난방 / 열병합'},{label:'전기차 충전시설',value:'48대상세보기'}]}),r=fromPage(url,s),school=r.publicFacts.find(f=>f.category==='education'),transport=r.publicFacts.find(f=>f.category==='transport');assert.match(school.text,/인천첨단초등학교/);assert.match(school.text,/519m도보 7분/);assert.match(school.text,/교육지원청 확인/);assert.match(transport.text,/16, 4, 58, 6, 81/);assert.ok(r.publicFacts.some(f=>f.category==='daily'&&f.text.includes('지역난방')));assert.ok(r.publicFacts.every(f=>f.sourceUrl===url&&f.checkedAt===r.checkedAt&&f.sourceId));assert.doesNotMatch(JSON.stringify(r),/24\.7|학급당|교사당|약 17명|성적|순위/);
 assert.equal(fromPage(url,state({sections:{transport:'주변 대중교통\n로딩중'}})).publicFacts.some(f=>f.category==='transport'),false);
});
test('a page reader waits for displayed supplementary sections before returning the same public record',async()=>{
 const f=fakeBrowser({states:[state({sections:{transport:'로딩중'}}),state({sections:{transport:'주변 대중교통\n버스\n간선\n16,4'}})]}),r=await createNaverPageReader({BrowserWindow:f.BrowserWindow,timeoutMs:1000})(url);assert.match(r.publicFacts.find(f=>f.category==='transport').text,/16,4/);assert.doesNotMatch(JSON.stringify(r),/로딩중/);
});
test('building maxima and station walking labels are assembled only from explicit matching public fields',()=>{
 const r=fromPage(url,state({tables:[{label:'최고층',value:'2층\n(가장 낮은 동)\n18층\n(가장 높은 동)'}],sections:{transport:'주변 대중교통\n지하철\n서대문역5\n호선\n853m도보 16분\n독립문역3\n호선\n944m도보 19분\n버스\n마을\n서대문02대, 서대문02소'}}));
 assert.equal(r.publicFacts.find(f=>f.text.includes('동별 최고층')).text,'네이버 단지 표시: 동별 최고층 2~18층');assert.equal(r.publicFacts.find(f=>f.category==='transport').text,'서대문역(5호선) · 네이버 도보 853m · 16분 / 독립문역(3호선) · 네이버 도보 944m · 19분');assert.doesNotMatch(JSON.stringify(r.publicFacts),/서대문역5 · 호선|최고층 2층 \(가장/);
 const normalize=require('../src/naver-page.cjs').normalizePublicFact;for(const text of ['네이버 단지 표시: 최고층 20층 (가장 낮은 동) 18층 (가장 높은 동)','네이버 단지 표시: 최고층 2층 (가장 낮은 동) 999층 (가장 높은 동)'])assert.equal(normalize({category:'daily',text}),null);
 for(const raw of ['서대문역5 · 호선 · 853m차량 16분','서대문역5 · 호선 · 853m 16분','서대문역 · 853m도보 16분','서대문역5 · 호선 · 0m도보 16분','서대문역5 · 호선 · 853m도보 시간 미확인'])assert.equal(normalize({category:'transport',text:'네이버 주변 대중교통 표시: '+raw}),null);
});
