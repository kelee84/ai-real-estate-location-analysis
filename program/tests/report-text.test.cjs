'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {safeTextChunks}=require('../src/report.cjs');
test('PPT 문단은 날짜·단어를 끊지 않고 모든 원문과 줄바꿈을 보존한다',()=>{
  for(const text of ['주의사항을 확인합니다. '.repeat(5)+'현장 확인일 · 2026-10-18', '  첫째 줄\n둘째 줄\n\n방문 2026-10-18  ', '한글과 😀 이모지, 이름 및 연락처 02-000-0000을 보존합니다. '.repeat(4),'', '긴단어'.repeat(50)]){
    const chunks=safeTextChunks(text);
    assert.equal(chunks.join(''),text);
    if(text.includes('2026-10-18'))assert.ok(chunks.some(chunk=>chunk.includes('2026-10-18')));
    for(let i=0;i<chunks.length-1;i++)assert.ok(/\s$/.test(chunks[i])||/^\s/.test(chunks[i+1]));
  }
});
