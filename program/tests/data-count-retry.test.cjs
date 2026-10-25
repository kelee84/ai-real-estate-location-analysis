'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{RtmsClient}=require('../src/data.cjs');
// Fixed CP949 header fixtures; record values below are ASCII and entirely fictional.
const headers={NO:'4e4f','시군구':'bdc3b1bab1b8','계약년월':'b0e8bee0b3e2bff9','계약일':'b0e8bee0c0cf','거래금액(만원)':'b0c5b7a1b1ddbed728b8b8bff829','해제사유발생일':'c7d8c1a6bbe7c0afb9dfbbfdc0cf','보증금(만원)':'bab8c1f5b1dd28b8b8bff829','월세금(만원)':'bff9bcbcb1dd28b8b8bff829','단지명':'b4dcc1f6b8ed','번지':'b9f8c1f6','전용면적(㎡)':'c0fcbfebb8e9c0fb28a7b329'};
const identity={code:'fixture',building:'Test',town:'Town',lot:'1'},region={code:'11410',name:'District',province:{name:'Province',code:'11000'}},input={target:'Province District Town Test',building:'Test',asset:'apartment',asOf:'2026-10-20',types:['jeonse','monthly']};
function row(id,extra={}){return {NO:id,'시군구':'Province District Town','계약년월':'202610','계약일':id,'거래금액(만원)':'70000','해제사유발생일':'-','보증금(만원)':'40000','월세금(만원)':id===2?'50':'0','단지명':'Test','번지':'1','전용면적(㎡)':'59',...extra};}
function csv(deal,rows,{omit}={}){const cols=['NO','시군구','단지명','번지','전용면적(㎡)','계약년월','계약일',...(deal==='trade'?['거래금액(만원)','해제사유발생일']:['보증금(만원)','월세금(만원)'])].filter(name=>name!==omit);return Buffer.concat([Buffer.from(cols.map(name=>headers[name]).join('2c'),'hex'),Buffer.from('\r\n'+rows.map(r=>cols.map(name=>r[name]??'').join(',')).join('\r\n'),'ascii')]);}
function client(responses,{onRequest}={}){const c=new RtmsClient(),calls=[],at={trade:-1,rent:-1};c.resolve=async()=>structuredClone(region);c.request=async(route,form,signal)=>{calls.push({route,form:structuredClone(form)});onRequest?.({route,form,signal,calls});if(signal?.aborted)throw signal.reason;const deal=form.srhDelngSecd==='1'?'trade':'rent';if(route.endsWith('ptXlsDownDataCheck.do')){const next=responses[deal][++at[deal]];if(next.countError)throw next.countError;return Buffer.from(JSON.stringify({cnt:next.count}));}if(route.endsWith('ptXlsCSVDown.do')){const next=responses[deal][at[deal]];if(next.csvError)throw next.csvError;return csv(deal,next.rows,next);}throw Error('Unexpected mocked request '+route);};return {c,calls};}
const collect=(c,onProgress,signal,custom=input)=>c.collect(custom,onProgress,signal,{catalog:{identity}});
test('one count mismatch retries the complete identical count plus CSV pair and commits only the validated replacement',async()=>{
 const {c,calls}=client({rent:[{count:2753,rows:[row(1)]},{count:2,rows:[row(1),row(2)]}]}),progress=[],r=await collect(c,p=>progress.push(p));assert.deepEqual(calls.map(c=>c.route.split('/').at(-1)),['ptXlsDownDataCheck.do','ptXlsCSVDown.do','ptXlsDownDataCheck.do','ptXlsCSVDown.do']);assert.ok(calls.every(c=>JSON.stringify(c.form)===JSON.stringify(calls[0].form)));assert.equal(progress.filter(p=>/한 번 다시 확인/.test(p)).length,1);assert.equal(r.coverage.length,1);assert.equal(r.coverage[0].status,'success');assert.equal(r.coverage[0].attempts,2);assert.equal(r.coverage[0].count,2);assert.equal(r.coverage[0].propertyCount,2);assert.equal(r.coverage[0].source,'https://rt.molit.go.kr/pt/xls/xls.do');assert.ok(Number.isFinite(Date.parse(r.coverage[0].checkedAt)));assert.equal(r.rows.length,2);assert.equal(new Set(r.rows.map(r=>r.id)).size,2);assert.deepEqual(r.rows.map(r=>r.kind),['jeonse','monthly']);assert.equal(r.raw.length,1);assert.equal(r.raw[0].bytes,csv('rent',[row(1),row(2)]).toString('base64'));
});
test('a second count mismatch preserves the actual error and commits no partial rows or raw data',async()=>{
 const {c,calls}=client({rent:[{count:3,rows:[row(1)]},{count:4,rows:[row(1),row(2)]}]}),r=await collect(c);assert.equal(calls.length,4);assert.deepEqual(r.rows,[]);assert.deepEqual(r.raw,[]);assert.equal(r.coverage.length,1);assert.equal(r.coverage[0].status,'error');assert.equal(r.coverage[0].attempts,2);assert.match(r.coverage[0].message,/조회 건수\(4\)와 내려받은 건수\(2\)/);
});
test('ordinary success and confirmed empty responses do not trigger retries',async()=>{
 const ok=client({rent:[{count:1,rows:[row(1)]}]}),r=await collect(ok.c);assert.equal(ok.calls.length,2);assert.equal(r.coverage[0].attempts,1);const empty=client({rent:[{count:0,rows:[]}]}),e=await collect(empty.c);assert.equal(empty.calls.length,1);assert.equal(e.coverage[0].status,'empty');assert.equal(e.coverage[0].count,0);assert.deepEqual(e.raw,[]);
});
test('required header errors and unrelated request failures retain the existing error without retries',async()=>{
 for(const response of [{count:1,rows:[row(1)],omit:'월세금(만원)'},{countError:new Error('network fixed failure')}]){const {c,calls}=client({rent:[response]}),r=await collect(c);assert.equal(r.coverage[0].status,'error');assert.equal(r.coverage[0].attempts,1);assert.equal(calls.length,response.countError?1:2);assert.deepEqual(r.rows,[]);assert.deepEqual(r.raw,[]);}
});
test('cancellation between count mismatch and retry stops before another request and preserves the abort reason',async()=>{
 const controller=new AbortController(),reason=new Error('fixture cancelled'),{c,calls}=client({rent:[{count:2,rows:[row(1)]},{count:1,rows:[row(1)]}]});await assert.rejects(collect(c,p=>{if(/한 번 다시 확인/.test(p))controller.abort(reason);},controller.signal),e=>e===reason);assert.equal(calls.length,2);
});
test('cancellation during the second pair propagates rather than becoming an empty or partial result',async()=>{
 const controller=new AbortController(),reason=new Error('fixture second pair cancelled'),{c,calls}=client({rent:[{count:2,rows:[row(1)]},{count:1,rows:[row(1)]}]},{onRequest:({calls})=>{if(calls.length===4)controller.abort(reason);}});await assert.rejects(collect(c,undefined,controller.signal),e=>e===reason);assert.equal(calls.length,4);
});
test('retry is confined to its transaction type and retains original cancellation flags without duplicate commits',async()=>{
 const {c,calls}=client({trade:[{count:1,rows:[row(1,{'해제사유발생일':'20261012'})]}],rent:[{count:2,rows:[row(1)]},{count:2,rows:[row(1),row(2)]}]}),r=await collect(c,undefined,undefined,{...input,types:['trade','jeonse','monthly']});assert.equal(calls.length,6);assert.deepEqual(r.coverage.map(c=>[c.deal,c.status,c.attempts]),[['trade','success',1],['rent','success',2]]);assert.equal(r.raw.length,2);assert.equal(r.rows.length,3);assert.equal(r.rows.find(r=>r.kind==='trade').cancelled,true);assert.equal(new Set(r.rows.map(r=>r.id)).size,3);
});
test('a damaged CSV retries once and commits only the intact download',async()=>{
 const {c,calls}=client({rent:[{count:1,rows:[row(1)]},{count:1,rows:[row(1)]}]}),request=c.request.bind(c);let downloads=0;
 c.request=async(...args)=>{const bytes=await request(...args);return args[0].endsWith('ptXlsCSVDown.do')&&++downloads===1?Buffer.concat([bytes,Buffer.alloc(200000),Buffer.from('"')]):bytes;};
 const r=await collect(c);assert.equal(calls.length,4);assert.equal(r.coverage[0].attempts,2);assert.equal(r.coverage[0].status,'success');assert.equal(r.rows.length,1);assert.equal(Buffer.from(r.raw[0].bytes,'base64').includes(0),false);
});
test('persistent NUL or malformed quotes remain unavailable with bounded diagnostics and no partial records',async()=>{
 for(const bad of [Buffer.concat([Buffer.alloc(200000),Buffer.from('"')]),Buffer.from('bad"quote')]){
  const {c,calls}=client({rent:[{count:1,rows:[row(1)]},{count:1,rows:[row(1)]}]}),request=c.request.bind(c);c.request=async(...args)=>{const value=await request(...args);return args[0].endsWith('ptXlsCSVDown.do')?bad:value;};
  const r=await collect(c);assert.equal(calls.length,4);assert.equal(r.coverage[0].status,'error');assert.equal(r.coverage[0].attempts,2);assert.ok(JSON.stringify(r).length<2000);assert.ok(r.coverage[0].diagnostic.code);assert.equal(r.coverage[0].diagnostic.bytes,bad.length);assert.deepEqual(r.rows,[]);assert.deepEqual(r.raw,[]);
 }
});
