'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{gzipSync,gunzipSync}=require('node:zlib');
const {ReportStore}=require('../src/store.cjs'),backup=require('../src/backup.cjs');
test('백업·복원은 원자료 포함, 새 번호 사용, 계정 제외',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'re-backup-test-'));
  try{const store=new ReportStore(root),r=await store.save({title:'가상',input:{target:'가상'},prices:{period:{}},scores:[],sources:[],sections:[],createdAt:new Date().toISOString()});await fs.mkdir(path.join(store.path(r.id),'raw'));await fs.writeFile(path.join(store.path(r.id),'raw','RTMS-trade.csv'),'공식 원자료');const bytes=await backup.pack(store),packed=JSON.parse(gunzipSync(bytes));assert.equal(Object.keys(packed).includes('auth'),false);assert.ok(packed.reports[0].raw['RTMS-trade.csv']);const result=await backup.unpack(store,bytes);assert.notEqual(result.ids[0],r.id);assert.equal(await fs.readFile(path.join(store.path(result.ids[0]),'raw','RTMS-trade.csv'),'utf8'),'공식 원자료');assert.equal((await store.list()).length,2);}finally{await fs.rm(root,{recursive:true,force:true});}
});
test('악성 백업의 경로 탈출·잘못된 버전을 거절',async()=>{const report={input:{target:'가상'},prices:{period:{}},scores:[],sources:[],sections:[],createdAt:'2026-10-15'};const store={save(){throw Error('should not save')}};await assert.rejects(backup.unpack(store,gzipSync(JSON.stringify({version:1,reports:[{report,raw:{'../auth.json':'eA=='}}]}))),/원자료/);await assert.rejects(backup.unpack(store,gzipSync(JSON.stringify({version:2,reports:[]}))),/지원하지/);});
test('개별·비교 평가의 근거 스냅샷을 백업하고 복원',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'re-score-backup-'));
 try{const store=new ReportStore(root),r=await store.save({title:'평가 가상',input:{target:'가상'},prices:{period:{}},scores:[],sources:[],sections:[],createdAt:new Date().toISOString()});await fs.mkdir(path.join(store.path(r.id),'raw'));const names=['score-evidence.json','A-score-evidence.json','C-score-evidence.json'];for(const name of names)await fs.writeFile(path.join(store.path(r.id),'raw',name),JSON.stringify({version:'test',coverage:40}));const result=await backup.unpack(store,await backup.pack(store));for(const name of names)assert.deepEqual(JSON.parse(await fs.readFile(path.join(store.path(result.ids[0]),'raw',name),'utf8')),{version:'test',coverage:40});}finally{await fs.rm(root,{recursive:true,force:true});}
});
test('official public snapshots and trend proofs survive single and comparison backup byte for byte',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'re-public-proof-backup-'));
 try{
  const store=new ReportStore(root),snapshot={provider:'sbiz-csv',sourceDate:'2026-06-30',checkedAt:'2026-10-22T01:00:00Z',downloadedAt:'2026-10-22T00:00:00Z',identity:{code:'123'},rawRecord:{'상가업소번호':'MA010120220800001234'}},r=await store.save({title:'공개 근거 가상',input:{target:'가상'},prices:{period:{},sbizSnapshot:snapshot},scores:[],sources:[],sections:[],createdAt:new Date().toISOString()});
  await fs.mkdir(path.join(store.path(r.id),'raw'));
  const names=['sbiz-snapshot.json','archhub.json','naver-land.json','naver-nearby.json','nearby-context.json','research-evidence.json','living-access.json','shopping-evidence.json','RTMS-trend-trade.csv','trend-query.json'],originals=new Map();
  for(const prefix of ['','A-','B-','C-'])for(const name of names){const file=prefix+name,bytes=Buffer.from(name.endsWith('.csv')?'계약일,금액\n2026-10-01,12345\n':JSON.stringify({...snapshot,file},null,2));originals.set(file,bytes);await fs.writeFile(path.join(store.path(r.id),'raw',file),bytes);}
  // User data caches and credentials remain outside this report evidence allowlist.
  for(const name of ['auth.json','settings.json','sbiz-cache.json','D-sbiz-snapshot.json'])await fs.writeFile(path.join(store.path(r.id),'raw',name),'not report evidence');
  const packed=await backup.pack(store),decoded=JSON.parse(gunzipSync(packed)),restored=await backup.unpack(store,packed),dir=store.path(restored.ids[0]);
  for(const [file,bytes]of originals)assert.deepEqual(await fs.readFile(path.join(dir,'raw',file)),bytes,file);
  for(const name of ['auth.json','settings.json','sbiz-cache.json','D-sbiz-snapshot.json'])assert.equal(decoded.reports[0].raw[name],undefined);
  assert.deepEqual((await store.load(restored.ids[0])).prices.sbizSnapshot,snapshot);
  const attack={...decoded,reports:decoded.reports.map(item=>({...item,raw:{...item.raw,'A-../sbiz-snapshot.json':'eA=='}}))};await assert.rejects(backup.unpack(store,gzipSync(JSON.stringify(attack))),/원자료/);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
