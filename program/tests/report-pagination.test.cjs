'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {pageLines,inspect,balanceDocxXml}=require('../src/report-pagination.cjs');
const block=(text,y,x=1)=>({y,x,R:[{T:encodeURIComponent(text)}]});
const page=(n,footer=true)=>({Height:52.6,Texts:[...Array.from({length:n},(_,i)=>block('확인된 자료 '+i,2+i)),...(footer?[block('AI SHERP',49),block('A 부동산 도우미로 작성 · 보고서 01234567-abcd',49,5)]:[])]});
test('line count joins table fragments and split branded footer before detecting a seven-line tail',()=>{
 const tail=page(7);tail.Texts.push(block('같은 줄 다른 열',2,10));assert.equal(pageLines(tail).length,7);
 assert.equal(inspect({Pages:[page(30),tail]}).shortTail,true);assert.equal(inspect({Pages:[page(30),page(8)]}).shortTail,false);assert.equal(inspect({Pages:[page(3)]}).shortTail,false);
});
test('full-sized illustration page is not mistaken for a text orphan',()=>{
 const p={Height:52.6,Texts:[block('입지 지도',2),block('지도 출처',36)]};assert.equal(inspect({Pages:[page(30),p]}).shortTail,false);
});
test('environment chart alone on a mostly blank middle page is reported, while its title and evidence rows keep context',()=>{
 const axes=['교통 환경','교육 환경','상권 환경','자연환경','병원 환경','학원 환경'],isolated={Height:52.6,Texts:axes.map((axis,i)=>block(axis+' A 85점*',4+i*2))};
 assert.deepEqual(inspect({Pages:[page(30),isolated,page(30)]}).assessmentOrphans,[2]);
 for(const heading of ['환경·가치 비교','6개 항목의 근거와 평가 범위']){const together=structuredClone(isolated);together.Texts.unshift(block(heading,2));assert.deepEqual(inspect({Pages:[page(30),together]}).assessmentOrphans,[]);}
 const large=structuredClone(isolated);large.Texts.push(block('확인 근거와 평가 범위',38));assert.deepEqual(inspect({Pages:[page(30),large]}).assessmentOrphans,[]);
 const sources={Height:52.6,Texts:[block('출처',2),...axes.map((axis,i)=>block(axis+' · 기관 · 2026-10-21',4+i*2))]};assert.deepEqual(inspect({Pages:[page(30),sources]}).assessmentOrphans,[]);
});
test('Word ending paragraphs stay together without changing a single text or table value',()=>{
 const prefix='<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>',suffix='<w:sectPr/></w:body></w:document>',paragraphs=Array.from({length:8},(_,i)=>'<w:p><w:r><w:t>출처 '+i+' · '+('확인된 정보 '.repeat(10))+'</w:t></w:r></w:p>').join(''),xml=prefix+paragraphs+suffix;
 const out=balanceDocxXml(xml),texts=s=>[...s.matchAll(/<w:t>(.*?)<\/w:t>/g)].map(m=>m[1]);assert.deepEqual(texts(out),texts(xml));assert.ok((out.match(/w:keepNext/g)||[]).length>=3);assert.equal(balanceDocxXml(out),out);
});
test('Word 출처 묶음의 keepNext=false를 바꾸되 지도까지 연결하지 않는다',()=>{
 const ns='http://schemas.openxmlformats.org/wordprocessingml/2006/main',p=t=>'<w:p><w:pPr><w:keepNext w:val="false"/></w:pPr><w:r><w:t>'+t+'</w:t></w:r></w:p>',xml='<w:document xmlns:w="'+ns+'"><w:body>'+p('입지톡 비교 지도')+p('지도 캡션')+p('출처')+p('기관 하나')+p('기관 둘')+'<w:sectPr/></w:body></w:document>',out=balanceDocxXml(xml);
 const {DOMParser}=require('@xmldom/xmldom'),doc=new DOMParser().parseFromString(out,'application/xml'),ps=Array.from(doc.getElementsByTagNameNS(ns,'p'));assert.equal(ps[0].getElementsByTagNameNS(ns,'keepNext')[0].getAttributeNS(ns,'val'),'false');for(const node of ps.slice(1,-1))assert.equal(node.getElementsByTagNameNS(ns,'keepNext')[0].getAttributeNS(ns,'val'),'true');assert.equal(ps.at(-1).getElementsByTagNameNS(ns,'keepNext')[0].getAttributeNS(ns,'val'),'false');assert.equal(balanceDocxXml(out),out);
});
test('Word 출처 앞의 긴 본문은 끝부분 묶음에 포함하지 않는다',()=>{
 const ns='http://schemas.openxmlformats.org/wordprocessingml/2006/main',p=t=>'<w:p><w:pPr><w:keepNext w:val="false"/></w:pPr><w:r><w:t>'+t+'</w:t></w:r></w:p>',xml='<w:document xmlns:w="'+ns+'"><w:body>'+p('긴 본문'.repeat(100))+p('출처')+p('기관 하나')+p('기관 둘')+'<w:sectPr/></w:body></w:document>';
 const {DOMParser}=require('@xmldom/xmldom'),doc=new DOMParser().parseFromString(balanceDocxXml(xml),'application/xml'),ps=Array.from(doc.getElementsByTagNameNS(ns,'p'));assert.equal(ps[0].getElementsByTagNameNS(ns,'keepNext')[0].getAttributeNS(ns,'val'),'false');assert.equal(ps[1].getElementsByTagNameNS(ns,'keepNext')[0].getAttributeNS(ns,'val'),'true');
});
