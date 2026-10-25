'use strict';
const theme=require('./brand-theme.cjs');
const fs=require('node:fs/promises'),path=require('node:path');
const {monthWindow,validDate,normalize,matchesArea,areaSelection,escapeHtml:e,averageMoney:money,todayKst}=require('./core.cjs');
const VERSION='2026-10-17-contract-trend-v1',SOURCE='https://rt.molit.go.kr/pt/xls/xls.do';
const PRESENTATION_VERSION='2026-10-21-comparison-trend-overlay-v2';
const WIDTH=960,HEIGHT=400;
const UNAVAILABLE='공식 매매 거래 자료를 확인하지 못해 추이를 표시하지 못했습니다. 자료를 다시 조회해 주세요.';
function publicReason(value){const text=String(value||'');return !text||text.length>300||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]|\\u0000|Invalid Opening Quote|CSV_|field \d|at line \d/i.test(text)?UNAVAILABLE:text;}
function build(rows,input,prices,coverage=[]){
 const period=monthWindow(input.asOf,12),selection=prices.effectiveArea||areaSelection(input),name=prices.buildingResolution?.building||input.building||require('./property-identity.cjs').requestedName(input),identity=prices.buildingResolution,seen=new Set(),kept=[],excluded={outside:0,cancelled:0,duplicate:0,condition:0,invalid:0};
 const lot=s=>String(s||'').split('-').map(n=>/^\d+$/.test(n)?String(+n):n).join('-');
 for(const t of rows){
  if(!validDate(t.date)||t.kind!=='trade'||!Number.isFinite(t.price)||t.price<=0||!Number.isFinite(t.area)||t.area<=0){excluded.invalid++;continue;}
  if(t.date<period.start||t.date>period.end){excluded.outside++;continue;}
  if(t.cancelled){excluded.cancelled++;continue;}
  if(seen.has(t.id)){excluded.duplicate++;continue;}seen.add(t.id);
  const towns=[...input.target.matchAll(/(?:^|\s)([가-힣0-9]+(?:동|리|읍|면))(?=\s|$)/g)].map(m=>m[1]);
  if(normalize(t.building)!==normalize(name)||!matchesArea(t.area,selection)||towns.some(town=>!t.location.split(/\s+/).includes(town))||identity?.town&&!t.location.split(/\s+/).includes(identity.town)||identity?.lot&&lot(t.lot)!==lot(identity.lot)||t.areaBasis!=='전용면적'){excluded.condition++;continue;}
  kept.push(t);
 }
 kept.sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id));
 const months=[];let cursor=period.start.slice(0,7);while(cursor<=period.end.slice(0,7)){months.push(cursor);const [y,m]=cursor.split('-').map(Number);cursor=new Date(Date.UTC(y,m,1)).toISOString().slice(0,7);}
 const groups=new Map();for(const t of kept){const key=selection.areaMode==='all'?String(t.area):selection.label;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(t);}
 const series=[...groups].sort((a,b)=>Number(a[0])-Number(b[0])).map(([key,contracts])=>{
  const data=months.map(month=>{const sample=contracts.filter(t=>t.date.startsWith(month));return {month,n:sample.length,mean:sample.length?sample.reduce((s,t)=>s+t.price,0)/sample.length:null,sum:sample.reduce((s,t)=>s+t.price,0),partial:month===period.start.slice(0,7)&&period.start.slice(8)!=='01'||month===period.end.slice(0,7)&&period.end!==new Date(Date.UTC(+period.end.slice(0,4),+period.end.slice(5,7),0)).toISOString().slice(0,10)};});
  for(let i=0;i<data.length;i++){const window=data.slice(i-2,i+1);data[i].movingMean=i>=2&&window.every(x=>x.n>0)?window.reduce((s,x)=>s+x.sum,0)/window.reduce((s,x)=>s+x.n,0):null;}
  const observed=data.filter(x=>x.n),first=observed[0],latest=observed.at(-1),peak=observed.length?Math.max(...observed.map(x=>x.mean)):null;
  return {areaLabel:selection.areaMode==='all'?key+'㎡':selection.label,areas:[...new Set(contracts.map(t=>t.area))].sort((a,b)=>a-b),n:contracts.length,mean:contracts.reduce((s,t)=>s+t.price,0)/contracts.length,latest:first?{month:latest.month,n:latest.n,mean:latest.mean}:null,change:first&&latest&&first.month!==latest.month?(latest.mean/first.mean-1)*100:null,peakGap:peak?(latest.mean/peak-1)*100:null,data};
 });
 return {version:VERSION,period,selection,identity,building:name,source:SOURCE,sourceName:'국토교통부 실거래가',checkedAt:new Date().toISOString(),coverage,excluded,rows:kept,series,n:kept.length,status:kept.length?'verified':'unavailable',reason:kept.length?'':coverage.some(c=>c.status==='error')?UNAVAILABLE:'최근 12개월에 동일 단지·선택 전용면적의 유효 매매 거래가 없습니다.'};
}
function current(trend,input,prices){return trend?.version===VERSION&&trend.period?.start===monthWindow(input.asOf,12).start&&trend.period?.end===input.asOf&&JSON.stringify(trend.selection)===JSON.stringify(prices.effectiveArea||areaSelection(input))&&trend.building===(prices.buildingResolution?.building||input.building||require('./property-identity.cjs').requestedName(input))&&Array.isArray(trend.rows)&&Array.isArray(trend.series)&&!trend.coverage?.some(c=>c.status==='error');}
async function ensure(data,input,prices,{previous,dir,prefix='',sourceDir,sourcePrefix='',signal,onProgress=()=>{}}={}){
 if(!input.types.includes('trade'))return null;
 if(current(previous,input,prices)){
  if(sourceDir&&dir&&path.resolve(sourceDir)!==path.resolve(dir))for(const suffix of ['RTMS-trend-trade.csv','trend-query.json'])try{await fs.copyFile(path.join(sourceDir,'raw',sourcePrefix+suffix),path.join(dir,'raw',prefix+suffix));}catch(error){if(error.code!=='ENOENT')throw error;}
  return previous;
 }
 if(typeof data.collectTrend!=='function')return null;
 onProgress('최근 12개월 매매 추이 자료를 확인하고 있습니다.');
 const collected=await data.collectTrend(input,onProgress,signal,{identity:prices.buildingResolution});
 if(signal?.aborted)throw new Error('분석을 중지했습니다.');
 const result=build(collected.rows,input,prices,collected.coverage);if(collected.propertyError)result.reason=publicReason(collected.propertyError);
 if(dir){await fs.mkdir(path.join(dir,'raw'),{recursive:true});for(const f of collected.raw)await fs.writeFile(path.join(dir,'raw',prefix+'RTMS-trend-'+f.deal+'.csv'),Buffer.from(f.bytes,'base64'));await fs.writeFile(path.join(dir,'raw',prefix+'trend-query.json'),JSON.stringify({version:VERSION,input,period:result.period,identity:collected.identity,coverage:collected.coverage,forms:collected.raw.map(f=>f.form),excluded:result.excluded},null,2));}
 return result;
}
function unavailable(report){return (report.members||report.comparisonMembers||[report]).filter(m=>m.trend?.status==='unavailable').map(m=>(m.key?m.key+' · ':'')+(m.input.building||m.input.target)+' · '+publicReason(m.trend.reason));}
function models(report){const members=report.members||report.comparisonMembers||[report];return members.flatMap((m,memberIndex)=>(m.trend?.series||[]).map((s,i)=>({...s,key:m.key||'',building:m.input.building||m.input.target,trend:m.trend,id:(m.key||'single')+'-'+i,memberIndex,areaIndex:i,style:{...require('./radar.cjs').STYLES[memberIndex%3]}})));}
function chartModels(report){
 const list=models(report),members=report.members||report.comparisonMembers||[report];if(members.length<2||!list.length)return list;
 const months=[...new Set(list.flatMap(s=>s.data.map(d=>d.month)))].sort(),counts=new Map();for(const s of list)counts.set(s.memberIndex,(counts.get(s.memberIndex)||0)+1);
 const series=list.map(s=>({...s,sampleKey:(s.key||String.fromCharCode(65+s.memberIndex))+(counts.get(s.memberIndex)>1?'·'+(s.areaIndex+1):''),style:{...s.style,dash:s.areaIndex?(s.style.dash?s.style.dash+' 2 4':'6 4')+(s.areaIndex>1?' 2 4'.repeat(s.areaIndex-1):''):s.style.dash},data:months.map(month=>{const d=s.data.find(d=>d.month===month);return d?{...d}:{month,n:0,mean:null,sum:0,movingMean:null,outsidePeriod:true};})}));
 const starts=list.map(s=>s.trend.period.start).sort(),ends=list.map(s=>s.trend.period.end).sort(),period={start:starts[0],end:ends.at(-1)};
 return [{kind:'comparison',id:'comparison-trend',series,months,period,periodsDiffer:new Set(list.map(s=>s.trend.period.start+'|'+s.trend.period.end)).size>1,bounds:scale(report)}];
}
function chartTitle(m){return m.kind==='comparison'?'단지별 월별 매매 평균 비교':(m.key?m.key+' · ':'')+m.building;}
function stats(m){const line=s=>(s.key?s.key+' · ':'')+s.building+' · '+s.areaLabel+' · 최근 '+s.latest.month+' '+money(s.latest.mean)+' ('+s.latest.n+'건) · 첫 거래월 대비 '+signed(s.change)+' · 월평균 최고 대비 '+signed(s.peakGap)+' · 기간 평균 '+money(s.mean)+' · 누적 '+s.n+'건';return m.kind==='comparison'?m.series.map(line):[`최근 거래월 ${m.latest.month} · ${money(m.latest.mean)} · ${m.latest.n}건 / 첫 거래월 대비 ${signed(m.change)} / 월평균 최고 대비 ${signed(m.peakGap)}`];}
function legendLines(value,max=54){const out=[];let line='',width=0;for(const char of String(value)){const size=char.codePointAt(0)>255?1:.55;if(width+size>max&&line){out.push(line);line='';width=0;}line+=char;width+=size;}if(line)out.push(line);return out;}
function comparisonLayout(m){const legendTop=326+m.series.length*23,legends=m.series.map(s=>({series:s,lines:legendLines(s.sampleKey+' · '+s.building+' · '+s.areaLabel+' · 총 '+s.n+'건 · 기간 평균 '+money(s.mean))}));let cursor=legendTop;for(const item of legends){item.y=cursor;cursor+=item.lines.length*18+10;}return {height:Math.max(HEIGHT,cursor+35),legendTop,legends};}
function dimensions(m){return {width:WIDTH,height:m.kind==='comparison'?comparisonLayout(m).height:HEIGHT};}
function scale(report){const values=models(report).flatMap(s=>s.data.flatMap(d=>[d.mean,d.movingMean]).filter(Number.isFinite));if(!values.length)return {min:0,max:1};const lo=Math.min(...values),hi=Math.max(...values),pad=Math.max((hi-lo)*.18,hi*.025,1),step=Math.pow(10,Math.floor(Math.log10(Math.max((hi-lo+2*pad)/4,1))));return {min:Math.max(0,Math.floor((lo-pad)/step)*step),max:Math.ceil((hi+pad)/step)*step};}
function signed(v){return Number.isFinite(v)?(v>0?'+':'')+v.toFixed(1)+'%':'—';}
const NOTE='월별 매매 계약 총액의 산술평균 · 그래프 금액 단위 억 · 3개월선은 해당 3개월 개별 계약의 가중평균 · 빈 달은 연결하지 않음 · 속 빈 점은 3건 미만';
function caption(m){if(m.kind==='comparison')return (m.periodsDiffer?'각 단지의 기준일·12개월 기간이 달라 공통 월축에 표시하며 기간 밖은 비워 둡니다.\n':'')+m.series.map(s=>(s.key?s.key+' · ':'')+s.building+' · 기준일 '+s.trend.period.end+' · '+caption(s)).join('\n');return `${m.trend.period.start} ~ ${m.trend.period.end} · ${m.areaLabel} · 총 ${m.n}건 · 국토교통부 실거래가 · 조회 ${todayKst(new Date(m.trend.checkedAt))}`;}
function singleSvg(m,bounds){
 const color=m.style?.color||require('./radar.cjs').STYLES[0].color;
 const {min,max}=bounds,left=92,right=924,top=45,bottom=285,dx=(right-left)/Math.max(1,m.data.length-1),x=i=>left+i*dx,y=v=>bottom-(v-min)/(max-min)*(bottom-top),fmt=v=>new Intl.NumberFormat('ko-KR',{maximumFractionDigits:2}).format(v/10000),t=(xx,yy,text,attrs='')=>`<text x="${xx}" y="${yy}" ${attrs}>${e(text)}</text>`;
 let out=`<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img" aria-label="${e(m.building)} 월별 매매 평균 추이"><style>text{font-family:'Malgun Gothic','맑은 고딕',sans-serif;fill:${theme.colors.muted};font-size:14px;font-variant-numeric:tabular-nums}</style><rect width="960" height="400" rx="14" fill="${theme.colors.soft}"/>`;
 for(let i=0;i<=4;i++){const value=min+(max-min)*i/4,yy=y(value);out+=`<line x1="${left}" y1="${yy}" x2="${right}" y2="${yy}" stroke="${theme.colors.line}"/>`+t(left-12,yy+5,fmt(value),'text-anchor="end"');}
 out+=t(left,25,'매매 평균 · 억','font-weight="700"');
 const averageY=y(m.mean);out+=`<line x1="${left}" y1="${averageY}" x2="${right}" y2="${averageY}" stroke="${theme.colors.muted}" stroke-dasharray="2 5"/>`;
 for(const [i,d]of m.data.entries()){
  if(i&&d.mean!==null&&m.data[i-1].mean!==null)out+=`<line data-trend-segment="mean" x1="${x(i-1)}" y1="${y(m.data[i-1].mean)}" x2="${x(i)}" y2="${y(d.mean)}" stroke="${color}" stroke-width="3.2"/>`;
  if(i&&d.movingMean!==null&&m.data[i-1].movingMean!==null)out+=`<line data-trend-segment="moving" x1="${x(i-1)}" y1="${y(m.data[i-1].movingMean)}" x2="${x(i)}" y2="${y(d.movingMean)}" stroke="${color}" stroke-opacity=".42" stroke-width="1.6"/>`;
  if(d.mean!==null)out+=`<circle data-trend-point="${d.month}" data-count="${d.n}" data-mean="${d.mean}" cx="${x(i)}" cy="${y(d.mean)}" r="5.5" fill="${d.n<3?'white':theme.colors.blueDark}" stroke="${color}" stroke-width="2.2"><title>${e(d.month+' · '+money(d.mean)+' · '+d.n+'건')}</title></circle>`;
  out+=t(x(i),bottom+26,d.month.slice(2).replace('-','.'),'text-anchor="middle"')+t(x(i),bottom+49,d.n?d.n+'건':'없음','text-anchor="middle" style="font-size:12px"');
 }
 out+=`<line x1="92" y1="360" x2="120" y2="360" stroke="${color}" stroke-width="3.2"/><line x1="270" y1="360" x2="298" y2="360" stroke="${color}" stroke-width="2.5"/><line x1="550" y1="360" x2="578" y2="360" stroke="${theme.colors.muted}" stroke-dasharray="2 5"/>`+t(130,365,'월별 평균')+t(308,365,'3개월 가중평균')+t(588,365,'기간 평균 '+money(m.mean))+t(left,389,'양 끝 달은 조회기간에 포함된 계약일만 반영 · 비교 단지의 금액 축은 동일','style="font-size:12px"');return out+'</svg>';
}
function comparisonSvg(m,bounds=m.bounds){
 const {min,max}=bounds,layout=comparisonLayout(m),left=92,right=924,top=54,bottom=270,dx=(right-left)/Math.max(1,m.months.length-1),x=i=>left+i*dx,y=v=>bottom-(v-min)/(max-min)*(bottom-top),fmt=v=>new Intl.NumberFormat('ko-KR',{maximumFractionDigits:2}).format(v/10000),t=(xx,yy,text,attrs='')=>`<text x="${xx}" y="${yy}" ${attrs}>${e(text)}</text>`,observed=d=>d.n>0&&Number.isFinite(d.mean);
 const point=(xx,yy,s,attrs='',title='')=>{const fill=attrs.includes('data-sparse="true"')?'white':s.style.color,common=`${attrs} fill="${fill}" stroke="${s.style.color}" stroke-width="2.2"`,tip=title?`<title>${e(title)}</title>`:'';return s.style.marker==='square'?`<rect ${common} x="${xx-5}" y="${yy-5}" width="10" height="10">${tip}</rect>`:s.style.marker==='diamond'?`<polygon ${common} points="${xx},${yy-6} ${xx+6},${yy} ${xx},${yy+6} ${xx-6},${yy}">${tip}</polygon>`:`<circle ${common} cx="${xx}" cy="${yy}" r="5.5">${tip}</circle>`;};
 let out=`<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${layout.height}" viewBox="0 0 ${WIDTH} ${layout.height}" role="img" aria-labelledby="comparison-trend-title comparison-trend-description"><title id="comparison-trend-title">단지별 월별 매매 평균 비교</title><desc id="comparison-trend-description">${e(caption(m)+' · '+NOTE)}</desc><style>text{font-family:'Malgun Gothic','맑은 고딕',sans-serif;fill:${theme.colors.muted};font-size:14px;font-variant-numeric:tabular-nums}</style><rect width="${WIDTH}" height="${layout.height}" rx="14" fill="${theme.colors.soft}"/>`;
 for(let i=0;i<=4;i++){const value=min+(max-min)*i/4,yy=y(value);out+=`<line x1="${left}" y1="${yy}" x2="${right}" y2="${yy}" stroke="${theme.colors.line}"/>`+t(left-12,yy+5,fmt(value),'text-anchor="end"');}
 out+=t(left,26,'단지별 매매 평균 · 억','font-weight="700"')+t(right,26,'같은 월축 · 같은 금액 축','text-anchor="end" style="font-size:12px"');
 const tickEvery=Math.max(1,Math.ceil(m.months.length/13));for(const [i,month]of m.months.entries())if(i%tickEvery===0||i===m.months.length-1)out+=t(x(i),296,month.slice(2).replace('-','.'),'text-anchor="middle" style="font-size:12px"');
 for(const [seriesIndex,s]of m.series.entries()){
  out+=`<g data-trend-series="${e(s.id)}" data-member="${e(s.key)}" data-building="${e(s.building)}" data-color="${s.style.color}">`;
  for(const [i,d]of s.data.entries()){
   const prev=s.data[i-1];if(i&&observed(d)&&observed(prev)){
    if(Number.isFinite(d.movingMean)&&Number.isFinite(prev.movingMean))out+=`<line data-trend-segment="moving" data-from="${prev.month}" data-to="${d.month}" x1="${x(i-1)}" y1="${y(prev.movingMean)}" x2="${x(i)}" y2="${y(d.movingMean)}" stroke="${s.style.color}" stroke-opacity=".42" stroke-dasharray="4 5" stroke-width="1.6"/>`;
    out+=`<line data-trend-segment="mean" data-from="${prev.month}" data-to="${d.month}" x1="${x(i-1)}" y1="${y(prev.mean)}" x2="${x(i)}" y2="${y(d.mean)}" stroke="${s.style.color}"${s.style.dash?` stroke-dasharray="${s.style.dash}"`:''} stroke-width="3.4"/>`;
   }
   if(observed(d))out+=point(x(i),y(d.mean),s,`data-trend-point="${d.month}" data-count="${d.n}" data-mean="${d.mean}" data-sparse="${d.n<3}"`,s.sampleKey+' · '+s.building+' · '+d.month+' · '+money(d.mean)+' · '+d.n+'건');
  }
  const yy=320+seriesIndex*23;out+=t(left-36,yy,s.sampleKey,'text-anchor="end" font-weight="700" style="fill:'+s.style.color+'"');for(const [i,d]of s.data.entries())out+=t(x(i),yy,d.outsidePeriod?'범위밖':d.n?d.n+'건':'없음','text-anchor="middle" style="font-size:11px;fill:'+s.style.color+'"');out+='</g>';
 }
 for(const item of layout.legends){const s=item.series,yy=item.y;out+=`<line x1="92" y1="${yy-5}" x2="120" y2="${yy-5}" stroke="${s.style.color}"${s.style.dash?` stroke-dasharray="${s.style.dash}"`:''} stroke-width="3.4"/>`+point(106,yy-5,s);item.lines.forEach((line,i)=>{out+=t(132,yy+i*18,line,'style="font-size:13px;fill:'+s.style.color+'"');});}
 out+=t(left,layout.height-13,'굵은 선: 월별 평균 · 옅은 가는 선: 3개월 계약 가중평균 · 속 빈 점: 3건 미만 · 빈 달 연결하지 않음','style="font-size:12px"');return out+'</svg>';
}
function svg(m,bounds){return m.kind==='comparison'?comparisonSvg(m,bounds||m.bounds):singleSvg(m,bounds);}
function html(report){
 const list=chartModels(report),failed=unavailable(report);if(!list.length)return failed.length?`<section class="price-trend-empty"><h2>최근 12개월 실거래 추이</h2>${failed.map(reason=>`<p>${e(reason)}</p>`).join('')}</section>`:'';
 const bounds=scale(report);return `<section class="price-trend-section"><h2>최근 12개월 실거래 추이</h2><p class="note">${e(NOTE)}</p>${list.map(m=>`<figure class="price-trend" data-trend-id="${m.id}"${m.kind==='comparison'?' data-trend-kind="comparison"':''}><h3>${e(chartTitle(m))}</h3>${m.kind==='comparison'?`<div class="trend-comparison-stats">${stats(m).map((text,i)=>`<p style="color:${m.series[i].style.color}">${e(text)}</p>`).join('')}</div>`:`<div class="trend-stats"><span>최근 거래월 <b>${e(m.latest.month)}</b><strong>${e(money(m.latest.mean))}</strong></span><span>기간 첫 거래월 대비<strong>${signed(m.change)}</strong></span><span>월평균 최고 대비<strong>${signed(m.peakGap)}</strong></span><span>누적 거래<strong>${m.n}건</strong></span></div>`}${svg(m,bounds)}<figcaption>${e(caption(m)).replace(/\n/g,'<br>')}</figcaption></figure>`).join('')}${failed.map(reason=>`<p class="note">${e(reason)}</p>`).join('')}</section>`;
}
const CSS=`.price-trend-section{break-before:page}.price-trend{break-inside:avoid;margin:20px 0 28px}.price-trend h3{margin:0 0 10px}.price-trend svg{display:block;width:100%;height:auto}.trend-stats{display:flex;gap:14px;margin-bottom:10px;padding:12px 16px;background:${theme.colors.soft};border-radius:10px}.trend-stats>span{flex:1;font-size:11px;color:${theme.colors.muted}}.trend-stats strong{display:block;color:${theme.colors.ink};font-size:18px;line-height:1.5;font-variant-numeric:tabular-nums}.trend-stats b{font-weight:400}.trend-comparison-stats{font-size:11px;line-height:1.55;margin-bottom:10px}.trend-comparison-stats p{margin:3px 0}.price-trend figcaption{white-space:pre-line}`;
async function raster(m,bounds){return require('./radar.cjs').renderSvg(svg(m,bounds));}
async function word(report,d){
 const list=chartModels(report),bounds=scale(report),out=[],failed=unavailable(report);if(!list.length&&!failed.length)return out;
 out.push(new d.Paragraph({text:'최근 12개월 실거래 추이',heading:d.HeadingLevel.HEADING_1,pageBreakBefore:true,keepNext:true}));
 for(const m of list){const size=dimensions(m),factor=Math.min(620/size.width,580/size.height);out.push(new d.Paragraph({text:chartTitle(m),heading:d.HeadingLevel.HEADING_2,keepNext:true}),...stats(m).map(text=>new d.Paragraph({text,keepNext:true,spacing:{after:80}})),new d.Paragraph({keepNext:true,children:[new d.ImageRun({type:'png',data:await raster(m,bounds),transformation:{width:size.width*factor,height:size.height*factor},altText:{name:'실거래 추이',title:chartTitle(m),description:caption(m)}})]}),...caption(m).split('\n').map(text=>new d.Paragraph({text,keepNext:false,spacing:{after:80}})));}
 if(list.length)out.push(new d.Paragraph({text:NOTE,spacing:{after:160}}));for(const reason of failed)out.push(new d.Paragraph({text:reason,spacing:{after:120}}));return out;
}
async function addExcel(wb,report){
 const list=models(report),failed=unavailable(report);if(!list.length){if(failed.length)wb.addWorksheet('12개월 실거래 추이').addRows([['조회 결과'],...failed.map(s=>[s])]);return;}
 const data=wb.addWorksheet('추이 원거래'),sheet=wb.addWorksheet('12개월 실거래 추이'),charts=wb.addWorksheet('실거래 추이 그래프');data.addRow(['매물','계약일','단지','전용면적(㎡)','층','매매(만원)','집계키']);sheet.addRow(['매물','전용면적','계약월','건수','월평균(만원)','3개월 가중평균(만원)']);
 const members=report.members||report.comparisonMembers||[report];for(const member of members)for(const row of member.trend?.rows||[]){const m=list.find(s=>s.key===(member.key||'')&&s.areas.includes(row.area));if(m)data.addRow([m.key,row.date,row.building,row.area,row.floor,row.price,m.id+'|'+row.date.slice(0,7)]);}
 const end=data.rowCount,bounds=scale(report);let chartRow=3;const titleRows=[];charts.getCell('A1').value='최근 12개월 실거래 추이';charts.getCell('A2').value=NOTE;charts.mergeCells('A1:L1');charts.mergeCells('A2:L2');
 for(const m of list){for(const point of m.data){const row=sheet.addRow([m.key,m.areaLabel,point.month,point.n,point.mean,point.movingMean]);if(point.n)row.getCell(5).value={formula:`AVERAGEIF('추이 원거래'!$G$2:$G$${end},"${m.id+'|'+point.month}",'추이 원거래'!$F$2:$F$${end})`,result:point.mean};if(point.movingMean!==null){const first=row.number-2,last=row.number;row.getCell(6).value={formula:`SUMPRODUCT(D${first}:D${last},E${first}:E${last})/SUM(D${first}:D${last})`,result:point.movingMean};}}
 }
 const chartList=chartModels(report);for(const m of chartList){
  const title=chartTitle(m)+'\n'+caption(m),size=dimensions(m),height=820*size.height/size.width,span=Math.ceil(height/15)+4;titleRows.push({row:chartRow,height:Math.max(38,title.split('\n').length*18+12)});charts.getCell('A'+chartRow).value=title;charts.mergeCells(`A${chartRow}:L${chartRow}`);const id=wb.addImage({buffer:await raster(m,bounds),extension:'png'});charts.addImage(id,{tl:{col:0,row:chartRow},ext:{width:820,height}});if(m!==chartList.at(-1))charts.getRow(chartRow+span-1).addPageBreak();chartRow+=span+1;
 }
 for(const reason of failed){charts.getCell('A'+chartRow).value=reason;charts.mergeCells(`A${chartRow}:L${chartRow}`);titleRows.push({row:chartRow,height:40});chartRow++;}
 for(const sh of [data,sheet,charts]){sh.columns.forEach(c=>c.width=20);sh.eachRow(row=>{row.height=25;row.eachCell(c=>{c.font={name:'맑은 고딕',size:11};c.alignment={wrapText:true,vertical:'top'};if(typeof c.value==='number'||c.value?.formula)c.numFmt='#,##0.0';});});sh.views=[{state:'frozen',ySplit:1}];sh.pageSetup={orientation:'landscape',paperSize:9,fitToPage:true,fitToWidth:1,fitToHeight:0};}sheet.getColumn(2).width=45;charts.columns.forEach(c=>c.width=10);for(let i=3;i<chartRow;i++)charts.getRow(i).height=15;for(const item of titleRows)charts.getRow(item.row).height=item.height;charts.getRow(2).height=30;charts.pageSetup.printArea='A1:L'+(chartRow-1);
}
module.exports={VERSION,PRESENTATION_VERSION,WIDTH,HEIGHT,NOTE,CSS,build,current,ensure,models,chartModels,chartTitle,stats,dimensions,unavailable,scale,svg,html,caption,raster,word,addExcel};
