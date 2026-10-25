'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
exports.run=async({fixture,output})=>{
 const {BrowserWindow}=require('electron'),report=require('../src/report.cjs'),average=require('../src/price-table.cjs');
 const single={...structuredClone(fixture),title:'면적 표 배치 검사 · 가상 자료',input:{...fixture.input,area:'84.8153,84.9572,84.993',areaMode:'set',selectedAreas:[84.8153,84.9572,84.993]},prices:{...fixture.prices,summaries:[{kind:'trade',areaMode:'set',area:'84.8153,84.9572,84.993',areaLabel:'선택 전용면적 84.8153㎡ · 84.9572㎡ · 84.993㎡ (개별 계약 통합 평균)',n:28,price:73475},{kind:'monthly',areaMode:'set',area:'84.8153,84.9572,84.993',n:3,depositBand:'5천만원~1억원 미만',deposit:5000,monthly:205}],unavailable:[]}};
 const before=JSON.stringify(single.prices),checks=[];
 for(const count of [1,2,3]){
   const r=count===1?single:{...single,mode:'comparison',members:Array.from({length:count},(_,i)=>({...single,key:'ABC'[i]}))};
   const file=path.join(output,`average-layout-${count}.html`);await fs.writeFile(file,report.html(r));
   const w=new BrowserWindow({show:false,width:794,height:1123,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
   try{await w.loadFile(file);await w.webContents.executeJavaScript('document.fonts.ready.then(()=>true)');
     const metrics=await w.webContents.executeJavaScript(`(()=>{const t=document.querySelector('.averages');return {rows:t.tBodies[0].rows.length,wrapped:[...t.querySelectorAll('td,th')].filter(c=>{const r=document.createRange();r.selectNodeContents(c);return new Set([...r.getClientRects()].map(x=>Math.round(x.top))).size>1||c.scrollWidth>c.clientWidth}).map(c=>c.textContent),overflow:document.documentElement.scrollWidth>innerWidth,areas:[...t.tBodies[0].rows].map(row=>row.cells[${count===1?1:2}].textContent)}})()`);
     assert.equal(metrics.rows,2*count);assert.deepEqual(metrics.wrapped,[]);assert.equal(metrics.overflow,false);assert.ok(metrics.areas.every(x=>x==='84타입'));checks.push({members:count,...metrics});
     await fs.writeFile(path.join(output,`average-layout-${count}.png`),(await w.webContents.capturePage()).toPNG());
   }finally{w.destroy();}
 }
 assert.equal(JSON.stringify(single.prices),before);assert.equal(average.rows(single)[0][4],'7.3억');
 await fs.writeFile(path.join(output,'average-layout-verification.json'),JSON.stringify({passed:true,pricesUnchanged:true,checks},null,2));
};
