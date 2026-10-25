'use strict';
// Inspect the actual printed pages; never delete content to remove a short last page.
process.env.PDF2JSON_DISABLE_LOGS='1';
const PDFParser=require('pdf2json');
const {DOMParser,XMLSerializer}=require('@xmldom/xmldom');
const NS='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
// Keep a short introduction with its chart, not an entire multi-page matrix.
// Tables may flow between whole rows, and their headers repeat on continuation.
const FLOW_CSS=`.assessment-intro{break-inside:avoid;break-after:avoid}.assessment-overview,.score-block,.score-comparison{break-inside:auto}.assessment-intro .assessment-radar{margin-bottom:10px}.score-block>h3{break-after:avoid}.transaction-summary{break-inside:avoid}.future-developments>h2+.note{break-after:avoid;page-break-after:avoid}.price-trend-section{break-before:auto;break-inside:avoid}.price-trend{margin:12px 0 14px}.customer-sources .source{font-size:11px;margin:4px 0;line-height:1.55}@media print{h2,h3{break-after:avoid;page-break-after:avoid}p,li{orphans:3;widows:3}.assessment-intro{break-inside:avoid;page-break-inside:avoid}.score-block,.score-comparison,.living-details,.compact-facts,.naver-public-section{break-inside:auto!important;page-break-inside:auto!important}.score-comparison tr,.living-details tr{break-inside:avoid;page-break-inside:avoid}.score-comparison thead,.living-details thead{display:table-header-group}}`;
const PROFILES=[
 '',
 '@media print{h2{margin-top:20px!important;margin-bottom:10px!important}h3{margin-top:18px!important}p,ul{margin-top:8px!important;margin-bottom:8px!important}table:not(.averages):not(.score-comparison):not(.apartment-facts) td,table:not(.averages):not(.score-comparison):not(.apartment-facts) th{padding:8px 9px!important}.source{margin:6px 0!important}footer{margin-top:18px!important;padding-top:8px!important}}',
 '@media print{h2{margin-top:18px!important;margin-bottom:8px!important}h3{margin-top:16px!important}p,ul{margin-top:6px!important;margin-bottom:6px!important}li{margin-top:4px!important;margin-bottom:4px!important}table:not(.averages):not(.score-comparison):not(.apartment-facts) td,table:not(.averages):not(.score-comparison):not(.apartment-facts) th{padding:7px 8px!important}.source{margin:4px 0!important}footer{margin-top:14px!important;padding-top:8px!important}}'
];
let parsing=Promise.resolve();
function parsePdf(buffer){
 const work=()=>new Promise((resolve,reject)=>{
  const parser=new PDFParser(),timer=setTimeout(()=>{parser.destroy();reject(Error('보고서 페이지 검사 시간이 초과됐습니다.'));},20000);
  parser.once('pdfParser_dataError',error=>{clearTimeout(timer);parser.destroy();reject(Error('보고서 페이지 구성 검사 실패: '+String(error.parserError?.message||error.parserError||error)));});
  parser.once('pdfParser_dataReady',data=>{clearTimeout(timer);parser.destroy();resolve(data);});
  try{parser.parseBuffer(buffer);}catch(e){clearTimeout(timer);parser.destroy();reject(e);}
 });
 const result=parsing.then(work,work);parsing=result.catch(()=>{});return result;
}
function pageLines(page){
 const lines=[];
 for(const block of [...(page.Texts||[])].sort((a,b)=>a.y-b.y||a.x-b.x)){
  const text=(block.R||[]).map(r=>{try{return decodeURIComponent(r.T||'');}catch{return r.T||'';}}).join('');if(!text.trim())continue;
  let line=lines.find(l=>Math.abs(l.y-block.y)<.14);if(!line){line={y:block.y,parts:[]};lines.push(line);}line.parts.push({x:block.x,text});
 }
 return lines.map(l=>({y:l.y,text:l.parts.sort((a,b)=>a.x-b.x).map(p=>p.text).join(' ')})).filter(l=>!/(?:AI\s*SHERP\s*A?\s*부동산|부동산\s*도우미로\s*작성|보고서\s+[0-9a-f]{8}-|상세\s*배점과\s*근거\s*·)/i.test(l.text));
}
function inspect(data){
 if(!Array.isArray(data?.Pages)||!data.Pages.length)throw Error('보고서 페이지 정보를 읽지 못했습니다.');
 const pages=data.Pages.map(p=>{const lines=pageLines(p),text=lines.map(l=>l.text).join(' '),firstY=lines[0]?.y??0,lastY=lines.at(-1)?.y??0,height=p.Height;
  const axes=['교통 환경','교육 환경','상권 환경','자연환경','병원 환경','학원 환경'],containsAssessment=axes.every(axis=>text.replace(/\s/g,'').includes(axis.replace(/\s/g,'')))&&/(?:\d{1,3}\s*점|평가\s*보류)/.test(text),assessmentOrphan=containsAssessment&&lastY<height*.52&&!/환경·가치\s*(?:평가|비교)|6개\s*항목의\s*근거와/.test(text);
  return {lines:lines.length,firstY,lastY,height,containsAssessment,assessmentOrphan};}),tail=pages.at(-1);
 // A page dominated by a full-size map is not a short text tail.
 const visualPage=tail.lastY>tail.height*.45&&tail.lastY-tail.firstY>tail.height*.3;
 return {pages:pages.length,lastPageLines:tail.lines,shortTail:pages.length>1&&tail.lines<=7&&!visualPage,pageLines:pages.map(p=>p.lines),assessmentOrphans:pages.flatMap((p,i)=>p.assessmentOrphan?[i+1]:[]),pageMetrics:pages};
}
async function inspectPdf(buffer){return inspect(await parsePdf(buffer));}
async function printBalanced(win,{printOptions={}}={}){
 const print=async()=>{const buffer=await win.webContents.printToPDF({printBackground:true,preferCSSPageSize:true,displayHeaderFooter:false,...printOptions});return {buffer,layout:await inspectPdf(buffer)};};
 const setProfile=async(index,rebalance=0)=>win.webContents.executeJavaScript(`(()=>{
  let s=document.getElementById('report-pagination');if(!s){s=document.createElement('style');s.id='report-pagination';document.head.append(s);}s.textContent=${JSON.stringify(PROFILES[index])};
  for(const ending of document.querySelectorAll('[data-report-ending]')){ending.before(...ending.childNodes);ending.remove();}
  for(const node of document.querySelectorAll('[data-report-rebalanced]')){node.style.breakBefore='';node.removeAttribute('data-report-rebalanced');}
  if(${rebalance}){const blocks=[...document.querySelectorAll('article > h2,article > section:not(.customer-sources),article > figure,article > section.price-trend-section > figure')];const target=blocks[blocks.length-1-${rebalance}];if(target){target.style.breakBefore='page';target.setAttribute('data-report-rebalanced','true');}}
  return new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))));
 })()`);
 let attempts=1,current=await print(),initial={...current.layout};
 // Compare both bounded spacing profiles even when the final page is valid:
 // an otherwise valid report can still strand a short table on its own page.
 const usable=layout=>!layout.shortTail&&!layout.assessmentOrphans.length;
 let best=usable(current.layout)?{...current,profile:0}:null;
 for(let profile=1;profile<PROFILES.length;profile++){
  await setProfile(profile);current=await print();attempts++;
  if(usable(current.layout)&&current.layout.pages<=initial.pages&&(!best||current.layout.pages<best.layout.pages))best={...current,profile};
 }
 if(best){await setProfile(best.profile);return {buffer:best.buffer,layout:{...best.layout,initial,attempts,adjustment:best.profile?'spacing-'+best.profile:'none',resolved:true}};}
 // Only an actual orphan triggers grouping the bounded text ending. Ordinary
 // reports retain their original flow; charts, tables and font sizes stay intact.
 await setProfile(0);await win.webContents.executeJavaScript(`(()=>{
  const sources=document.querySelector('article > section.customer-sources');
  const heading=sources?.previousElementSibling;
  if(!heading||heading.tagName!=='H2'||heading.textContent.trim()!=='출처')return;
  const previous=heading.previousElementSibling;
  const bounded=previous&&['P','SECTION'].includes(previous.tagName)&&previous.textContent.trim().length>0&&previous.textContent.length<=1600&&!previous.querySelector('img,svg,table,figure');
  const start=bounded?previous:heading,ending=document.createElement('section');
  ending.setAttribute('data-report-ending','true');ending.style.breakInside='avoid';start.before(ending);
  for(let node=start;node;){const next=node.nextSibling;ending.append(node);node=next;}
  return new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))));
 })()`);current=await print();attempts++;
 if(usable(current.layout))return {...current,layout:{...current.layout,initial,attempts,adjustment:'keep-text-ending',resolved:true}};
 for(let block=1;block<=4;block++){
  await setProfile(0,block);current=await print();attempts++;
  if(usable(current.layout))return {...current,layout:{...current.layout,initial,attempts,adjustment:'rebalance-ending-'+block,resolved:true}};
 }
 // When a long withheld-reason matrix fills its page, carry the matrix with
 // the short ending instead of forcing that ending onto a nearly empty page.
 await setProfile(0);await win.webContents.executeJavaScript(`(()=>{const s=document.getElementById('report-pagination');s.textContent+='@media print{.assessment-overview{break-inside:auto!important}.assessment-overview .score-block{break-before:page!important}}';})()`);current=await print();attempts++;
 if(usable(current.layout))return {...current,layout:{...current.layout,initial,attempts,adjustment:'matrix-with-ending',resolved:true}};
 throw Error('마지막 페이지의 짧은 내용을 재배치하지 못했습니다. 보고서 내용을 줄이지 않고 다시 저장할 수 있도록 구성을 확인해 주세요.');
}
function balanceDocxXml(xml){
 const doc=new DOMParser().parseFromString(xml,'application/xml'),body=doc.getElementsByTagNameNS(NS,'body')[0];if(!body)return xml;
 const nodes=[...Array.from(body.childNodes)].filter(n=>n.nodeType===1);let count=0,selected=[];
 for(let i=nodes.length-1;i>=0;i--){const p=nodes[i];if(p.localName==='sectPr')continue;if(p.localName!=='p')break;
  const text=Array.from(p.getElementsByTagNameNS(NS,'t')).map(n=>n.textContent).join('');if(!text.trim())continue;
  const units=[...text].reduce((n,c)=>n+(c.charCodeAt(0)>255?2:1),0);count+=Math.max(1,Math.ceil(units/92));selected.unshift(p);if(count>=11)break;
 }
 const content=p=>Array.from(p.getElementsByTagNameNS(NS,'t')).map(n=>n.textContent).join('').trim();
 const sourceAt=nodes.findLastIndex(p=>p.localName==='p'&&content(p)==='출처');
 if(sourceAt>=0){let start=sourceAt;const previous=nodes[sourceAt-1];
  // A whole map and the sources can exceed a page; keep only the bounded text ending together.
  if(previous?.localName==='p'&&content(previous).length>0&&content(previous).length<=300&&!previous.getElementsByTagNameNS(NS,'drawing').length)start--;
  selected=nodes.slice(start).filter(p=>p.localName==='p');
 }
 for(const [index,p] of selected.entries()){
  let props=Array.from(p.childNodes).find(n=>n.nodeType===1&&n.localName==='pPr');if(!props){props=doc.createElementNS(NS,'w:pPr');p.insertBefore(props,p.firstChild);}
  for(const name of ['keepLines',...(index<selected.length-1?['keepNext']:[])]){let flag=props.getElementsByTagNameNS(NS,name)[0];if(!flag){flag=doc.createElementNS(NS,'w:'+name);props.appendChild(flag);}flag.setAttributeNS(NS,'w:val','true');}
 }
 return new XMLSerializer().serializeToString(doc);
}
module.exports={FLOW_CSS,PROFILES,pageLines,inspect,inspectPdf,printBalanced,balanceDocxXml};
