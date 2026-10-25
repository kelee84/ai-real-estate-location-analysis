'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{noticeArea,auditParks}=require('../src/park-notices.cjs');
test('준공 자료의 정확한 소재지·면적을 파싱하고 100배 면적 충돌은 보정 없이 제외',async()=>{
 const rule={town:'송도동',lot:'187-6'},html='<p>위치: 인천광역시 송도동 187-6 번지</p><p>면 적: 36,436.5㎡</p>';
 assert.equal(noticeArea(html,rule),36436.5);assert.throws(()=>noticeArea(html,{...rule,lot:'187-5'}),/소재지/);
 const rows=[{MANAGE_NO:'28185-00088',PARK_NM:'첨단산업클러스터단지(B) 4호 근린공원',LNMADR:'인천광역시 연수구 송도동 187-6',PARK_AR:'3643650'}],before=JSON.stringify(rows),r=await auditParks(rows,{fetchImpl:async()=>new Response(html)});
 assert.equal(r[0].status,'conflict');assert.equal(r[0].excluded,true);assert.equal(r[0].noticeAreaM2,36436.5);assert.equal(JSON.stringify(rows),before);
 const failed=await auditParks(rows,{fetchImpl:async()=>new Response('error',{status:503})});assert.equal(failed[0].excluded,true);assert.equal(failed[0].status,'unverified');
});
test('공식 보도자료의 만·천 단위 조성 면적과 지번을 함께 대조',()=>{assert.equal(noticeArea('송도동 330-1번지 공원. 총 면적 18만9천㎡ 중 14만9천㎡ 규모로 조성됐습니다.',{town:'송도동',lot:'330-1',rounded:true}),149000);});
