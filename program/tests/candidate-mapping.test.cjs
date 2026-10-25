'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {AnalysisService}=require('../src/service.cjs'),{compatibleName,resolveProperty,assertPropertyInput}=require('../src/property-identity.cjs'),{normalizeInput}=require('../src/core.cjs');
const region={code:'28185',name:'연수구',province:{code:'2800000000',name:'인천광역시'}},center={lat:37.4,lng:126.64};
const properties=[{aprpnHsmpCode:'20326862',aprpnHsmpNm:'도시푸른마을3차(17-1블럭)',mnnm:'18-5',la:center.lat,lo:center.lng},{aprpnHsmpCode:'20326863',aprpnHsmpNm:'도시푸른마을3차(18-1블럭)',mnnm:'19-3',la:center.lat-.001,lo:center.lng}];
const choices=properties.map((p,i)=>({kapt_code:'A1000000'+i,name:i?'푸른 마을3차 18-1BL':'푸른마을 3차 D17-1BL',address:'인천광역시 연수구 송도동 '+p.mnnm,address_road:'',lat:Number(p.la),lng:Number(p.lo)}));
function fixture(list=structuredClone(properties),candidates=structuredClone(choices)){
 const calls=[],b=new EventEmitter();b.evidenceSession=async()=>({});b.evidenceTool=async(_s,tool,args)=>{calls.push({tool,args});return {result:{structuredContent:tool==='get_complex_info_by_query'?{candidates}:{sigungu_code:'28185',full_code:'2818510600',...center}}};};
 const key=s=>s.replace(/[\s()·-]/g,'').toLowerCase();
 const data={resolve:async()=>region,listProvinces:async()=>[region.province],listRegions:async()=>[region],request:async(route,form)=>{calls.push({route,form});let result;
  if(route.includes('emdList'))result={emdList:[{code:'2818510600',codeNm:'송도동'}]};
  else if(route.includes('ptDanjiList')){const found=list.filter(p=>key(p.aprpnHsmpNm).includes(key(form.srhBldgNm)));result={totCnt:found.length,danjiList:found};}
  else if(route.includes('ptDtlArea'))result={danjiList:(form.srhAprpnHsmpCode===properties[0].aprpnHsmpCode?[69.91,84.72]:[84.89,99.6,115.14]).map(prvuseAr=>({prvuseAr}))};
  else throw Error(route);return Buffer.from(JSON.stringify(result));}};
 return {service:new AnalysisService({bridge:b,data,onEvent:()=>{}}),data,calls,list};
}
for(const [a,b]of [['푸른마을3차 D17-1BL','도시푸른마을3차(17-1블럭)'],['푸른 마을 3차 17-1 bl','푸른마을3차(17-1블록)'],['푸른마을3차 D017-01BLOCK','푸른마을3차 17-1블럭'],['푸른마을3차','도시푸른마을3차 17-1BL']])test('일반 블록 표기 연결: '+a,()=>assert.ok(compatibleName(a,b)));
for(const b of ['도시푸른마을3차(18-1블럭)','도시푸른마을13차(17-1블럭)','도시푸른마을3차(1-71블럭)','도시푸른마을3차(17-1블럭)별개단지'])test('다른 차수·블록·추가 이름 거부: '+b,()=>assert.equal(compatibleName('푸른마을3차 D17-1BL',b),false));
test('숨겨진 건물명과 주소의 BL/블록 충돌을 조회 전에 검사',()=>{assert.throws(()=>assertPropertyInput({target:'푸른마을3차 D17-1BL',building:'푸른마을3차(18-1블럭)'}),/서로 다른/);assert.doesNotThrow(()=>assertPropertyInput({target:'푸른마을3차 D17-1BL',building:'도시푸른마을3차(17-1블록)'}));});
test('지역 검색의 공식 후보를 외부 검색 없이 선택하고 각 단지별 타입·토큰을 유지',async()=>{
 const f=fixture(),found=await f.service.searchTypes({target:'인천 연수구 송도동 푸른마을3차'});assert.equal(found.kind,'candidates');assert.equal(found.candidates.length,2);
 const codes=[];for(const choice of found.candidates){const c=await f.service.selectProperty({searchToken:found.searchToken,candidateId:choice.id});codes.push(c.identity.code);assert.equal(c.identity.match,'selected-code');assert.deepEqual(c.areas,c.identity.code==='20326862'?[69.91,84.72]:[84.89,99.6,115.14]);assert.equal(f.service.validateTypeSelection({...c,building:c.requestedBuilding,selectedAreas:[c.areas[0]],catalogToken:c.token}).identity.code,c.identity.code);}
 assert.deepEqual(codes,['20326862','20326863']);assert.equal(f.calls.filter(c=>c.tool).length,0);
});
test('이름만 검색한 외부 후보의 BL 이름을 공식 블럭 단지와 각각 연결',async()=>{
 const f=fixture(),found=await f.service.searchTypes({target:'푸른마을3차'});
 for(let i=0;i<2;i++){const c=await f.service.selectProperty({searchToken:found.searchToken,candidateId:found.candidates[i].id});assert.equal(c.identity.code,properties[i].aprpnHsmpCode);assert.equal(c.building,properties[i].aprpnHsmpNm);}
});
test('선택 후 공식 단지 코드가 없어져도 옆 블록으로 대체하지 않음',async()=>{
 const f=fixture(),found=await f.service.searchTypes({target:'인천 연수구 송도동 푸른마을3차'});f.list.splice(0,1);
 await assert.rejects(()=>f.service.selectProperty({searchToken:found.searchToken,candidateId:found.candidates[0].id}),/찾지 못/);
 assert.equal(f.calls.filter(c=>c.route?.includes('ptDtlArea')).length,0);
});
test('공식 이름이 같아도 선택한 고유 코드와 연결하며 조작된 후보를 거부',async()=>{
 const f=fixture(properties.map(p=>({...p,aprpnHsmpNm:'같은이름아파트'}))),found=await f.service.searchTypes({target:'인천 연수구 송도동 같은이름아파트'});
 await assert.rejects(()=>f.service.selectProperty({searchToken:found.searchToken,candidateId:'rtms-99999999'}),/만료|후보/);
 const c=await f.service.selectProperty({searchToken:found.searchToken,candidateId:found.candidates[1].id});assert.equal(c.identity.code,'20326863');
});
async function resolve(list,expected,query='새브랜드푸른마을'){const f=fixture(list);return resolveProperty(f.data,normalizeInput({target:'인천 연수구 송도동 '+query}),undefined,{region,expected});}
test('이름 변경은 같은 법정동·정확한 지번·근접 좌표로 대조한 경우에만 연결',async()=>{
 const r=await resolve([properties[0]],{address:'인천 연수구 송도동 018-05',...center});assert.equal(r.identity.code,'20326862');assert.equal(r.identity.match,'address-coordinate');
 for(const expected of [{...center},{address:'인천 연수구 송도동 19-3',...center},{address:'인천 연수구 송도동 18-5'},{address:'인천 연수구 송도동 18-5',lat:38,lng:127}])await assert.rejects(()=>resolve([properties[0]],expected),/찾지 못/);
});
test('지번이 맞아도 다른 차수·블록은 주소로 우회 연결하지 않음',async()=>{
 for(const query of ['새브랜드푸른마을1차','새브랜드푸른마을3차 18-1BL'])await assert.rejects(()=>resolve([properties[0]],{address:'인천 연수구 송도동 18-5',...center},query),/찾지 못/);
});
test('이름이 일치해도 지번 또는 좌표가 다른 선택은 거부',async()=>{
 for(const expected of [{address:'인천 연수구 송도동 19-3',...center},{address:'인천 연수구 송도동 18-5',lat:38,lng:127}])await assert.rejects(()=>resolve([properties[0]],expected,properties[0].aprpnHsmpNm),/찾지 못/);
});
test('외부 후보의 주소에 공식 단지가 여러 개면 공식 후보 선택으로 이어감',async()=>{
 const list=properties.map(p=>({...p,mnnm:'18-5',la:center.lat,lo:center.lng})),f=fixture(list,[{...choices[0],name:'새브랜드푸른마을'}]),found=await f.service.searchTypes({target:'새브랜드푸른마을'}),next=await f.service.selectProperty({searchToken:found.searchToken,candidateId:found.candidates[0].id});
 assert.equal(next.kind,'candidates');assert.equal(next.candidates.length,2);const c=await f.service.selectProperty({searchToken:next.searchToken,candidateId:next.candidates[1].id});assert.equal(c.identity.code,'20326863');
});
test('공식 조회 실패를 후보 불일치로 감추거나 다른 데이터로 바꾸지 않음',async()=>{
 const f=fixture();f.data.request=async()=>{throw Error('공식 자료 연결 실패');};await assert.rejects(()=>f.service.searchTypes({target:'인천 연수구 송도동 푸른마을3차'}),/공식 자료 연결 실패/);assert.equal(f.calls.length,0);
});
test('같은 아파트가 공식 목록에서 여러 단지로 나뉜 경우 누락 없이 후보 표시',async()=>{
 const f=fixture(properties.map((p,i)=>({...p,aprpnHsmpNm:'도시푸른마을'+(i+1)+'단지'}))),found=await f.service.searchTypes({target:'인천 연수구 송도동 도시푸른마을'});assert.equal(found.candidates.length,2);
 const c=await f.service.selectProperty({searchToken:found.searchToken,candidateId:found.candidates[1].id});assert.equal(c.identity.code,'20326863');assert.equal(compatibleName('도시푸른마을1단지','도시푸른마을11단지'),false);
});
test('예전 지번은 이름과 정확한 도로명·건물번호가 같은 공식 주소로 확인받음',async()=>{
 const f=fixture(properties.map(p=>({...p,roadNm:'가상대로97번길 20'})),[{...choices[0],name:'푸른마을3차',address:'인천 연수구 송도동 999',address_road:'인천광역시 연수구 가상대로97번길 20'}]);
 const found=await f.service.searchTypes({target:'푸른마을3차'}),next=await f.service.selectProperty({searchToken:found.searchToken,candidateId:found.candidates[0].id});assert.equal(next.kind,'candidates');assert.equal(next.candidates.length,2);assert.match(next.reason,/공식 이름과 주소/);
 const c=await f.service.selectProperty({searchToken:next.searchToken,candidateId:next.candidates[1].id});assert.equal(c.identity.code,'20326863');assert.equal(c.identity.lot,'19-3');
});
test('도로명은 같아도 건물번호·명칭·차수·블록이 다르면 연결 거부',async()=>{
 for(const [road,query]of [['가상로 21','푸른마을3차'],['가상로 20','별개아파트'],['가상로 20','푸른마을1차'],['가상로 20','푸른마을3차 18-1BL']])await assert.rejects(()=>resolve([{...properties[0],roadNm:'가상로 20'}],{address:'인천 연수구 송도동 999',road,...center},query),/찾지 못/);
});
test('큰 단지의 대표 좌표 차이도 동일 도로명·단지명 확인으로 처리하며 멀다는 이유로 누락하지 않음',async()=>{
 await assert.rejects(()=>resolve([{...properties[0],roadNm:'가상로 20',la:center.lat+.004}],{address:'인천 연수구 송도동 18-5',road:'인천 연수구 가상로 20',...center},properties[0].aprpnHsmpNm),e=>e.code==='PROPERTY_AMBIGUOUS'&&e.properties.length===1&&!!e.reason);
});
test('도로명 대조는 지역 접두어·공백만 정리하고 서로 다른 부번을 구분',()=>{
 const {roadKey}=require('../src/property-identity.cjs');assert.equal(roadKey('서울특별시 강동구 가상로 0333 (가상동)'),roadKey('가상로333'));assert.notEqual(roadKey('가상로 1-20'),roadKey('가상로 12-0'));assert.equal(roadKey('주소 없음'),'');
});
