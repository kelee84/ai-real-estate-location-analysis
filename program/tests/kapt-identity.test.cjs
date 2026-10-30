'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {compatibleName,matchesKaptIdentity}=require('../src/property-identity.cjs');
const scoring=require('../src/scoring.cjs'),{todayKst,SCORE_ITEMS}=require('../src/core.cjs');
const {queryPublicKapt,facts}=require('../src/kapt-public.cjs'),{applyProduct}=require('../src/extended-scoring.cjs');
// Public fields captured from the two official-source responses on 2026-10-18.
// Contact details, upstream credentials, and unrelated response fields are omitted.
const detail=require('./fixtures/official-evidence/kapt-bukhyeon.json');
const identity={building:'두산',code:'469',regionCode:'11410',province:'서울특별시',region:'서대문구',town:'북아현동',lot:'1009',road:'이화여대8길 62',lat:37.559159764742,lng:126.950145592526};
const candidate={name:'북아현두산',regionCode:'1141011000',addressJibun:'서울특별시 서대문구 북아현동 1009 북아현두산',addressRoad:'서울특별시 서대문구 이화여대8길 62'};
const basicData=()=>({name:candidate.name,kapt_code:'A12079501',basic:{address_jibun:candidate.addressJibun,address_road:candidate.addressRoad,bjd_code:candidate.regionCode,use_approval_date:'19990303',total_units:956,hall_type:'복도식'},metadata:{collected_at:'2026-10-18T10:00:14.214Z',data_source:'kapt_basis_info_v4'}});
const tool=d=>({server:'ipzitalk',tool:'get_complex_info_by_query',result:{structuredContent:d}});
const evidence=tools=>scoring.collectEvidence({input:{target:'서울특별시 서대문구 북아현동 두산',building:'두산',asset:'apartment',asOf:'2026-10-18'},prices:{buildingResolution:identity},tools});

test('terminal phase aliases share public facts only after the official region and lot match',()=>{
 const mokdong=require('./fixtures/naver-mokdong.cjs'),i=mokdong.identity,r=mokdong.record();
 assert.equal(compatibleName(i.building,r.name),false,'contract-name matching remains strict');
 assert.equal(matchesKaptIdentity(i,r),true);
 assert.equal(matchesKaptIdentity({...i,building:r.name},{...r,name:i.building}),true);
 for(const changed of [{name:'목동우성3차'},{name:'목동우성12차'},{name:'목동우성2차(18-1블록)'},{addressJibun:'서울시 양천구 신정동 338'},{addressJibun:'서울시 강서구 신정동 337'},{addressJibun:'부산시 양천구 신정동 337'},{addressRoad:'서울시 양천구 목동남로4길 6-25'},{officialCode:'3283'}])assert.equal(matchesKaptIdentity(i,{...r,...changed}),false,JSON.stringify(changed));
 assert.equal(matchesKaptIdentity({...i,code:undefined},r),false);
 assert.equal(matchesKaptIdentity({...i,province:undefined},r),false);
 assert.equal(matchesKaptIdentity({...i,building:'목동우성2(17-1블록)'},{...r,name:'목동우성2차(18-1블록)'}),false);
});

test('a short trade-register name remains unsafe globally and only a corroborated K-apt address alias connects it',()=>{
 assert.equal(compatibleName('두산','북아현두산'),false);
 assert.equal(matchesKaptIdentity(identity,candidate),true);
 assert.equal(matchesKaptIdentity(identity,{...candidate,officialCode:469,addressJibun:detail.resultMap_kapt_addrList[0].addr},{requireOfficialCode:true}),true);
 assert.equal(matchesKaptIdentity(identity,candidate,{requireOfficialCode:true}),false);
 for(const changed of [
  {officialCode:'470'}, {regionCode:'1168011000'}, {regionCode:'11410unverified'}, {addressJibun:candidate.addressJibun.replace('서대문구','강남구')},
  {addressJibun:candidate.addressJibun.replace('북아현동','남아현동')}, {addressJibun:candidate.addressJibun.replace('1009','1008')},
  {addressRoad:candidate.addressRoad.replace('62','64')}, {addressRoad:undefined}, {regionCode:undefined},
  {name:'다른지역두산'}, {name:'북아현두산1차'}, {name:'북아현두산(18-1블록)'},
  {addressJibun:candidate.addressJibun.replace('북아현두산','다른두산')}
 ])assert.equal(matchesKaptIdentity(identity,{...candidate,...changed}),false,JSON.stringify(changed));
 assert.equal(matchesKaptIdentity({...identity,code:undefined},candidate),false);
 assert.equal(matchesKaptIdentity({...identity,building:'두산1차'},{...candidate,name:'북아현두산2차',officialCode:'469'}),false);
 assert.equal(matchesKaptIdentity({...identity,building:'두산(17-1블록)'},{...candidate,name:'두산(18-1블록)',officialCode:'469'}),false);
});

test('actual MCP basic fields unlock one verified K-apt code while ambiguous or stale results remain withheld',()=>{
 const d=basicData(),r=evidence([tool(d)]);assert.equal(r.basic.kaptCode,'A12079501');assert.equal(r.basic.approvalDate,'1999-03-03');assert.equal(r.basic.units,956);
 assert.equal(evidence([tool(d),tool(structuredClone(d))]).basic.kaptCode,'A12079501');
 const other={...structuredClone(d),kapt_code:'A12079502'},ambiguous=evidence([tool(d),tool(other)]);assert.equal(ambiguous.basic,null);assert.match(ambiguous.warnings.join(' '),/서로 다른 K-apt/);
 for(const change of [x=>x.metadata.collected_at='2026-10-19T00:00:00Z',x=>x.metadata.collected_at='2026-08-01T00:00:00Z',x=>x.basic.address_road=x.basic.address_road.replace('62','64'),x=>x.basic.bjd_code='1168011000']){const copy=structuredClone(d);change(copy);assert.equal(evidence([tool(copy)]).basic,null);}
});

test('official code and address relation recover the actual parking-and-hall product evaluation at 42 points with 55% coverage',async()=>{
 const product=await queryPublicKapt({kaptCode:'A12079501',identity,asOf:todayKst(),fetchImpl:async()=>new Response(JSON.stringify(detail),{headers:{'content-type':'application/json'}})});
 assert.equal(product.status,'verified');assert.equal(product.parkingTotal,715);assert.equal(product.units,956);assert.equal(product.hallType,'복도식');assert.equal(product.elevators,11);
 const scores=['상품 경쟁력'].map(name=>({name,score:null,sourceIds:[]}));applyProduct(scores,{product,sources:[]},{input:{asset:'apartment',asOf:'2026-10-18'}});
 const row=scores.find(r=>r.name==='상품 경쟁력');assert.equal(row.score,42);assert.equal(row.coverage,55);assert.deepEqual(row.calculation.map(c=>c.weight),[20,25,10]);assert.equal(row.calculation[1].value,715/956);assert.match(row.needed,/실제 주차/);
});

test('official short-name relation still rejects another code, region, lot, phase, block, ambiguous address or future approval',()=>{
 const cases=[d=>d.resultMap_match.townCode=470,d=>d.resultMap_kapt_addrList[0].addr=d.resultMap_kapt_addrList[0].addr.replace('서대문구','강남구'),d=>d.resultMap_kapt_addrList[0].addr=d.resultMap_kapt_addrList[0].addr.replace('1009','1008'),d=>d.resultMap_kapt.kaptName='북아현두산2차',d=>d.resultMap_kapt.kaptName='북아현두산(18-1블록)',d=>d.resultMap_kapt_addrList.push({...d.resultMap_kapt_addrList[0],addr:'서울특별시 서대문구 북아현동 1010 두산아파트'}),d=>d.resultMap_kapt.kaptUsedate='2099-01-01'];
 for(const change of cases){const d=structuredClone(detail);change(d);assert.throws(()=>facts(d,{identity,kaptCode:'A12079501',asOf:'2026-10-18'}));}
});

test('the short-name fix does not fetch current K-apt details to fill a historic report',async()=>{
 let calls=0;const result=await queryPublicKapt({identity,kaptCode:'A12079501',asOf:'2020-01-01',fetchImpl:async()=>{calls++;throw Error('must not fetch');}});assert.equal(result.status,'unavailable');assert.equal(calls,0);assert.match(result.reason,/과거·미래 기준일/);
});
