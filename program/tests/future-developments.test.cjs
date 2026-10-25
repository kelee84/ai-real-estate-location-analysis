'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const future=require('../src/future-developments.cjs'),{todayKst}=require('../src/core.cjs');
const input={asset:'apartment',target:'인천 연수구 송도동 시험단지',building:'시험단지',asOf:'2026-10-17'},center={lat:37.37,lng:126.65};
const url='https://www.ice.go.kr/plans',row='(첨단1고) 인천첨단 고등학교 2027.03. 30 1 31 연수구 송도동 192-6 재정/재정 공학';
const proof={url,title:'신설학교 추진현황',publisher:'인천교육청',publishedAt:'2026-01-08',dateProof:'최근업데이트 : 2026-01-08',excerpt:row};
const c={axis:'교육 환경',name:'인천첨단 고등학교',aliases:['첨단1고'],openingPeriod:'2027-03',event:'개교',stage:'공식 설립계획',address:'연수구 송도동 192-6',proofs:[{...proof,role:'schedule'}]};
const doc={url,text:'신설학교 추진현황 개교예정일 '+row+' 최근업데이트 : 2026-01-08',rows:[row],hash:'verified-fixture-hash'};
const geo={address:c.address,normalized_address:'인천광역시 '+c.address,address_type:'jibun',confidence:'exact',lat:center.lat+.001,lng:center.lng};
const bridge={evidenceTool:async(session,tool,args)=>{assert.equal(tool,'get_geocode');assert.equal(args.address,c.address);return {result:{structuredContent:geo}};}};
const options={input,center,bridge,session:{},load:async()=>doc};
test('two-calendar-year horizon clamps leap day; imprecise years must wholly fit',()=>{
 assert.deepEqual(future.horizon('2024-02-29'),{start:'2024-02-29',end:'2026-02-28'});assert.equal(future.period('2028').end,'2028-12-31');assert.equal(future.period('2027-02').end,'2027-02-28');assert.equal(future.period('2028-13'),null);
});
test('official school table binds name, month and exact lot in one row without inventing construction',async()=>{
 const p=await future.verify(c,options);assert.equal(p.stage,'공식 설립계획');assert.equal(p.openingLabel,'2027년 3월');assert.equal(p.distanceM,111);assert.deepEqual(p.proofs.map(p=>p.role).sort(),['location','schedule','stage']);
});
test('table cannot borrow the name and lot from different school rows',async()=>{
 await assert.rejects(future.verify(c,{...options,load:async()=>({...doc,rows:[row.replace(c.address,'다른동 1'),row.replace(c.name,'다른고등학교').replace('첨단1고','다른1고')]})}),/대조 불충족/);
});
for(const [field,value,reason] of [['openingPeriod','2028','2년 밖 연말'],['openingPeriod','2026-10','이미 진행 중인 월'],['event','준공','준공을 개점으로 변환 금지'],['openingPeriod','2029-03','2년 초과']])test(reason,async()=>{
 await assert.rejects(future.verify({...c,[field]:value},options),/조건 불충족/);
});
test('nearby boundaries are independently calculated from each property',async()=>{
 await assert.rejects(future.verify(c,{...options,center:{lat:37.1,lng:126.65}}),/인근 범위 밖/);
});
test('a quoted date cannot prove publication when absent from the downloaded source',async()=>{
 await assert.rejects(future.verify(c,{...options,load:async()=>({...doc,text:doc.text.replace('최근업데이트 : 2026-01-08','')})}),/대조 불충족/);
});
test('stale or future source publication is not accepted',async()=>{
 for(const date of ['2023-01-08','2027-01-08'])await assert.rejects(future.verify({...c,proofs:[{...proof,role:'schedule',publishedAt:date,dateProof:'등록일 '+date}]},{...options,load:async()=>({...doc,text:doc.text+' 등록일 '+date})}),/대조 불충족/);
});
test('geocoding rejects echoed input, approximate match, and wrong normalized lot',()=>{
 for(const p of [{...geo,normalized_address:'연수구 송도동 192-7'},{...geo,confidence:'partial'},{...geo,address_type:'approximate'},{...geo,normalized_address:''}])assert.equal(future.geocoded({result:{structuredContent:p}},c.address),null);
});
test('non-official sites and redirects outside official domains are rejected',async()=>{
 assert.equal(future.official('https://www.ice.go.kr.evil.example/plan'),false);assert.equal(future.official('http://www.ice.go.kr/plan'),false);assert.equal(future.official('https://www.ice.go.kr/plan'),true);
 await assert.rejects(future.document('https://www.ice.go.kr/plan',{fetchImpl:async()=>new Response(null,{status:302,headers:{location:'https://blog.example/plan'}})}),/도메인 밖/);
});
test('traffic schedule requires opening, location and genuine stage evidence',async()=>{
 const name='송도시험역',address=c.address,article='등록일 2026-10-01 '+name+' '+address+' 2027년 9월 개통 예정이며 공사 중이다.';
 const p={...proof,url:'https://www.incheon.go.kr/transport',publishedAt:'2026-10-01',dateProof:'등록일 2026-10-01',excerpt:article},project={...c,name,aliases:[],axis:'교통 환경',event:'개통',stage:'공사 중',openingPeriod:'2027-09',address,proofs:['schedule','location','stage'].map(role=>({...p,role}))};
 const verified=await future.verify(project,{...options,load:async()=>({url:p.url,text:article,rows:[],hash:'fixture'})});assert.equal(verified.stage,'공사 중');
 await assert.rejects(future.verify(project,{...options,load:async()=>({url:p.url,text:article.replace('공사 중','착공 예정'),rows:[],hash:'fixture'})}),/대조 불충족/);
});
test('historical reports skip current web search; current snapshots reuse only same location and day',async()=>{
 let called=0;const b={analyze:async()=>{called++;throw Error('unexpected');}},historical={...input,asOf:'2020-10-17'};
 const r=await future.collect(b,historical,{center});assert.equal(r.status,'unavailable');assert.match(r.reason,/과거/);assert.equal(called,0);
 const currentInput={...input,asOf:todayKst()},snapshot={version:future.VERSION,status:'checked',asOf:currentInput.asOf,center,checkedAt:new Date().toISOString(),projects:[],reason:'checked'};
 assert.equal((await future.collect(b,currentInput,{center,previous:snapshot})).reused,true);assert.equal(called,0);assert.equal(future.current(snapshot,currentInput,{lat:37,lng:126.65}),false);
 const midnightKst={...snapshot,checkedAt:new Date(currentInput.asOf+'T00:00:00+09:00').toISOString()};assert.equal(future.current(midnightKst,currentInput,center),true);assert.equal((await future.collect(b,currentInput,{center,previous:midnightKst})).reused,true);assert.equal(called,0);
});
test('search errors do not block existing real transaction analysis or manufacture zero projects',async()=>{
 const r=await future.collect({analyze:async()=>{throw Error('search offline');}},{...input,asOf:todayKst()},{center});assert.equal(r.status,'unavailable');assert.match(r.reason,/search offline/);assert.deepEqual(r.projects,[]);
});

test('future research forwards cancellation to the writer and never marks a cancelled empty result checked',async()=>{
 const controller=new AbortController();let received;const b={analyze:async request=>{received=request.signal;controller.abort();return {text:JSON.stringify({projects:[],searches:[]})};}};
 await assert.rejects(future.collect(b,{...input,asOf:todayKst()},{center,signal:controller.signal}),/중지/);assert.equal(received,controller.signal);
 let calls=0;await assert.rejects(future.collect({analyze:async()=>calls++},{...input,asOf:todayKst()},{center,signal:controller.signal}),/중지/);assert.equal(calls,0);
});
test('single and three-property future tables preserve dates, stages, distances; customer sources stay capped',async()=>{
 const project=await future.verify(c,options),snapshot={version:future.VERSION,checkedAt:'2026-10-17T01:00:00Z',projects:[project],reason:'검증한 예정 사업'};
 const m={input,futureDevelopments:snapshot,scores:[],sources:[],strengths:[],sections:[]},single=future.html(m);assert.match(single,/2027년 3월 개교 예정/);assert.match(single,/공식 설립계획/);assert.match(single,/111m/);assert.ok(!single.includes('현재 운영'));
 const comparison={input,members:['A','B','C'].map(key=>({...m,key}))};assert.equal(future.rows(comparison).length,3);assert.deepEqual(future.rows(comparison).map(row=>row[0]),['A','B','C']);assert.ok(require('../src/customer-report.cjs').sources(comparison).length<=7);
});
test('future schools cannot earn present-day accessibility points or leak into the operating-facility narrative',()=>{
 const school={id:'planned',category:'school_high',name:'인천첨단고등학교'},current={id:'open',category:'school_high',name:'현재고등학교'},station={id:'station',category:'subway',name:'인천첨단고등학교역'},snapshot={projects:[c]};
 const ev=future.excludeScheduled({places:[school,current,station]},snapshot);assert.deepEqual(ev.places,[current,station]);assert.deepEqual(ev.futureExcludedPlaces,[school]);
 const prose=future.sanitizeNarrative({sections:[{heading:'교육 시설',body:'인천첨단고등학교가 인근에 있다. 현재고등학교와 중학교가 인근에 있다.'}],strengths:['인천첨단고등학교 인접','현재 학교 인접']},snapshot);assert.equal(prose.sections[0].body,'현재고등학교와 중학교가 인근에 있다.');assert.deepEqual(prose.strengths,['현재 학교 인접']);
});
