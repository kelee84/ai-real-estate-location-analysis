'use strict';
const theme=require('./brand-theme.cjs');
// The plotted values are the saved assessment values. Missing values never become zero.
const {escapeHtml:e}=require('./core.cjs');
const {AXES:SCORE_ITEMS}=require('./customer-report.cjs');
const WIDTH=960,HEIGHT=740,COMPACT_HEIGHT=660;
const STYLES=[{color:theme.colors.coralInk,dash:'',marker:'circle'},{color:theme.colors.blueDark,dash:'12 7',marker:'square'},{color:theme.colors.chartThird,dash:'3 7',marker:'diamond'}];
const NOTE='각 축 0~100점 · 부분 점수는 표시한 평가 범위만 반영합니다. 보류 항목은 점·연결선 없이 비워 두며 종합점수·순위를 산출하지 않습니다.';
function value(s){return Number.isInteger(s?.score)&&s.score>=1&&s.score<=100?s.score:null;}
function model(report){
  const members=report.members||report.comparisonMembers||[report];
  return {asOf:report.input?.asOf||'',series:members.slice(0,3).map((m,i)=>({key:members.length===1?'':m.key||String.fromCharCode(65+i),label:m.input?.building||m.input?.target||m.title||'분석 대상',style:STYLES[i],scores:SCORE_ITEMS.map(name=>{const s=m.scores?.find(x=>x.name===name)||{};return {...s,name,score:value(s)};})}))};
}
const short=(s,n)=>[...String(s||'')].length>n?[...String(s)].slice(0,n-1).join('')+'…':String(s||'');
function lines(s,n,max=3){const chars=[...String(s||'').replace(/\s+/g,' ').trim()],out=[];while(chars.length&&out.length<max)out.push(chars.splice(0,n).join(''));if(chars.length)out[out.length-1]=out.at(-1).slice(0,-1)+'…';return out;}
function scoreLabel(s,key=''){return (key?key+' ':'')+(s.score===null?'보류':s.score+'점'+(s.status==='partial'?'*':''));}
function description(report){const m=model(report);return '육각형 6축 평가. '+m.series.map(s=>(s.key?s.key+' ':'')+s.label+': '+s.scores.map(row=>row.name+' '+(row.score===null?'평가 보류, '+(row.needed||row.reason||'근거 자료 미확인'):row.score+'점'+(row.status==='partial'?' 부분 평가, '+row.scope+', 확인 배점 '+row.coverage+'%':''))).join('; ')).join('. ')+'. '+NOTE;}
function svg(report,{compact=false}={}){
  const m=model(report),cx=480,cy=350,radius=198,point=(i,n=100)=>{const a=(-90+i*60)*Math.PI/180;return {x:cx+Math.cos(a)*radius*n/100,y:cy+Math.sin(a)*radius*n/100};};
  const xy=p=>p.x.toFixed(2)+','+p.y.toFixed(2),text=(x,y,t,o='')=>`<text x="${x}" y="${y}" ${o}>${e(t)}</text>`;
  const marker=(p,style,size=5)=>style.marker==='square'?`<rect x="${p.x-size}" y="${p.y-size}" width="${size*2}" height="${size*2}" fill="white" stroke="${style.color}" stroke-width="2.7"/>`:style.marker==='diamond'?`<polygon points="${p.x},${p.y-size-1} ${p.x+size+1},${p.y} ${p.x},${p.y+size+1} ${p.x-size-1},${p.y}" fill="white" stroke="${style.color}" stroke-width="2.7"/>`:`<circle cx="${p.x}" cy="${p.y}" r="${size}" fill="${style.color}" stroke="white" stroke-width="2"/>`;
  let out=`<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${compact?COMPACT_HEIGHT:HEIGHT}" viewBox="0 0 ${WIDTH} ${compact?COMPACT_HEIGHT:HEIGHT}" role="img" aria-labelledby="radar-title radar-description"><title id="radar-title">환경·가치 육각형 점수표</title><desc id="radar-description">${e(description(report))}</desc><style>text{font-family:'Malgun Gothic','맑은 고딕',sans-serif;fill:${theme.colors.ink};font-variant-numeric:tabular-nums}.axis{font-size:20px;font-weight:700}.value{font-size:18px;font-weight:700}.muted{fill:${theme.colors.muted};font-size:14px}</style><rect width="${WIDTH}" height="${HEIGHT}" fill="white"/>`;
  if(!compact)out+=text(26,35,'환경·가치 한눈에 보기','font-size="24" font-weight="700"')+text(26,60,'교통·교육·상권·자연·병원·학원'+(m.asOf?' / 기준일 '+m.asOf:''),'class="muted"');
  for(const n of [100,80,60,40,20]){out+=`<polygon points="${Array.from({length:6},(_,i)=>xy(point(i,n))).join(' ')}" fill="${n===100?theme.colors.soft:'none'}" stroke="${n===100?theme.colors.field:theme.colors.line}" stroke-width="${n===100?1.7:1}"/>`;out+=text(cx+8,cy-radius*n/100+5,String(n),'font-size="13" fill="${theme.colors.muted}" paint-order="stroke" stroke="${theme.colors.soft}" stroke-width="4"');}
  for(let i=0;i<6;i++){const p=point(i);out+=`<line x1="${cx}" y1="${cy}" x2="${p.x}" y2="${p.y}" stroke="${theme.colors.line}" stroke-width="1"/>`;}
  out+=text(cx+8,cy+17,'0','font-size="13" fill="${theme.colors.muted}"');
  // Every segment requires two adjacent observed values. Do not bridge a missing axis.
  for(const series of m.series){const scores=series.scores.slice(0,6),style=series.style,complete=scores.every(s=>s.score!==null);
    if(complete)out+=`<polygon data-role="series-area" points="${scores.map((s,i)=>xy(point(i,s.score))).join(' ')}" fill="${style.color}" fill-opacity="0.065" stroke="none"/>`;
    for(let i=0;i<6;i++){const j=(i+1)%6;if(scores[i].score===null||scores[j].score===null)continue;const a=point(i,scores[i].score),b=point(j,scores[j].score);out+=`<line data-role="series-segment" data-series="${e(series.key||'single')}" data-from="${i}" data-to="${j}" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="${style.color}" stroke-width="${m.series.indexOf(series)===0?6:3.7}"${style.dash?` stroke-dasharray="${style.dash}"`:''}/>`;}
  }
  // Draw nested marker sizes after all lines: equal scores keep their true position
  // while the outer circle, middle square and inner diamond remain identifiable.
  m.series.forEach((series,j)=>series.scores.forEach((s,i)=>{if(s.score!==null)out+=`<g data-role="score-marker" data-series="${e(series.key||'single')}" data-axis="${i}" data-value="${s.score}">${marker(point(i,s.score),series.style,[10,6,3][j])}</g>`;}));
  const labels=[[480,115,'middle'],[730,220,'start'],[730,475,'start'],[480,604,'middle'],[230,475,'end'],[230,220,'end']];
  labels.forEach(([x,y,anchor],i)=>{out+=text(x,y,SCORE_ITEMS[i],`class="axis" text-anchor="${anchor}"`);m.series.forEach((s,j)=>{const horizontal=(i===0||i===3)&&m.series.length>1,valueX=horizontal?x+(j-(m.series.length-1)/2)*110:x,valueY=y+23+(horizontal?0:j*21);out+=text(valueX,valueY,scoreLabel(s.scores[i],s.key),`class="value" text-anchor="${anchor}" style="fill:${s.scores[i].score===null?theme.colors.muted:s.style.color}"`);});});
  // Names and marker/line styles remain explicit when printed in monochrome.
  const legendY=compact?26:m.series.length===1?660:651;
  m.series.forEach((s,i)=>{const member=(report.members||report.comparisonMembers||[report])[i],type=member.input?require('./comparison-basis.cjs').areaLabel(member):'',name=(s.key?s.key+' · ':'')+short(s.label,30)+(type?' · '+type:''),x=compact?26:Math.max(26,WIDTH/2-(name.length*9+64)/2),y=legendY+i*27;out+=`<g data-role="series-legend" data-series="${e(s.key||'single')}"><line x1="${x}" y1="${y-6}" x2="${x+48}" y2="${y-6}" stroke="${s.style.color}" stroke-width="${i===0?6:3.7}"${s.style.dash?` stroke-dasharray="${s.style.dash}"`:''}/>`+marker({x:x+24,y:y-6},s.style,5)+text(x+64,y,name,`font-size="19" font-weight="700" style="fill:${s.style.color}"`)+'</g>';});
  out+='</svg>';return out;
}
function html(report,{compact=false}={}){return `<figure class="assessment-radar" aria-label="환경·가치 육각형 점수표">${svg(report,{compact})}${compact?'':`<figcaption>${e(NOTE)} * 부분 평가. 각 항목의 평가 범위와 확인 배점은 아래 표에 표시했습니다.</figcaption>`}</figure>`;}
const cache=new Map();
async function renderSvg(source){
  const width=Number(source.match(/<svg[^>]*\bwidth="(\d+)"/)?.[1])||WIDTH,height=Number(source.match(/<svg[^>]*\bheight="(\d+)"/)?.[1])||HEIGHT;
  const electron=require('electron');
  if(typeof electron==='string'){
    const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{execFile}=require('node:child_process'),dir=await fs.mkdtemp(path.join(os.tmpdir(),'re-radar-'));
    try{const input=path.join(dir,'chart.svg'),output=path.join(dir,'chart.png');await fs.writeFile(input,source);await new Promise((resolve,reject)=>{const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;execFile(electron,[__filename,'--render-radar',input,output],{windowsHide:true,env,timeout:45000},(error,_stdout,stderr)=>error?reject(new Error('평가 그래프 이미지 생성 실패: '+(stderr||error.message))):resolve());});return await fs.readFile(output);}finally{await fs.rm(dir,{recursive:true,force:true});}
  }
  const {app,BrowserWindow}=electron;await app.whenReady();
  const win=new BrowserWindow({show:false,width,height,backgroundColor:'#FFFFFF',webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
  try{
    await win.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(`<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'">`));
    await win.webContents.executeJavaScript('document.fonts.ready.then(()=>true)');
    const uri='data:image/svg+xml;base64,'+Buffer.from(source).toString('base64');
    const png=await win.webContents.executeJavaScript('new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>{try{const c=document.createElement("canvas");c.width='+width*2+';c.height='+height*2+';const ctx=c.getContext("2d",{willReadFrequently:true});ctx.fillStyle="white";ctx.fillRect(0,0,c.width,c.height);ctx.drawImage(img,0,0,c.width,c.height);resolve(c.toDataURL("image/png"));}catch(e){reject(e.message);}};img.onerror=()=>reject("SVG 그래프 이미지 해석 실패");img.src='+JSON.stringify(uri)+';})');
    const data=Buffer.from(png.split(',')[1]||'','base64');if(data.length<100||data.readUInt32BE(16)!==width*2||data.readUInt32BE(20)!==height*2)throw new Error('평가 그래프 이미지 크기를 확인하지 못했습니다.');return data;
  }finally{win.destroy();}
}
async function raster(report,{compact=false}={}){const source=svg(report,{compact}),key=require('node:crypto').createHash('sha256').update(source).digest('hex');if(!cache.has(key)){if(cache.size>=8)cache.delete(cache.keys().next().value);cache.set(key,renderSvg(source).catch(error=>{cache.delete(key);throw error;}));}return cache.get(key);}
async function addExcel(wb,report){
 const sheet=wb.addWorksheet('육각형 평가 그래프');sheet.getCell('A1').value='환경·가치 육각형 점수표';sheet.getCell('A2').value=require('./report-flow.cjs').insights(report).join('\n');sheet.mergeCells('A1:D1');sheet.mergeCells('A2:D5');sheet.getRow(1).height=32;for(let i=2;i<=5;i++)sheet.getRow(i).height=24;
 const png=await raster(report),id=wb.addImage({buffer:png,extension:'png'});sheet.addImage(id,{tl:{col:.6,row:5},ext:{width:760,height:760*HEIGHT/WIDTH}});
 const m=model(report),start=46;sheet.getRow(start).values=['평가 항목',...m.series.map(s=>(s.key?s.key+' · ':'')+s.label)];
 SCORE_ITEMS.forEach((name,i)=>{sheet.getRow(start+i+1).values=[name,...m.series.map(s=>{const row=s.scores[i];return row.score===null?'평가 보류':row.score;})];});
 const detailsSheet=report.members||report.comparisonMembers?'통합 비교':'환경·가치 평가';let last=start+8;
 sheet.getRow(last).values=['표시 기준','0~100점 공통 축 · * 부분 평가\n보류는 빈 축 · 평가 범위: '+detailsSheet+' 시트'];
 const partial=m.series.map(s=>s.scores.filter(x=>x.status==='partial'&&x.score!==null).map(x=>`${x.name}: ${x.coverage}%`).join('\n'));
 // Detailed coverage weights remain in the saved evidence, not repeated in the customer chart.
 const held=m.series.map(s=>s.scores.filter(x=>x.score===null).map(x=>x.name).join('\n'));
 if(held.some(Boolean))sheet.getRow(++last).values=['평가 보류',...held];
 sheet.getColumn(1).width=23;for(let i=2;i<=4;i++)sheet.getColumn(i).width=38;
 sheet.pageSetup={orientation:'landscape',paperSize:9,fitToPage:true,fitToWidth:1,fitToHeight:0,printArea:'A1:D'+last,margins:{top:.3,bottom:.3,left:.3,right:.3,header:.1,footer:.1}};
 for(let i=6;i<=45;i++)sheet.getRow(i).height=11;sheet.getRow(45).addPageBreak();
 sheet.eachRow(row=>row.eachCell(c=>{c.font={name:'맑은 고딕',size:11,color:{argb:'FF'+theme.hex.ink}};c.alignment={vertical:'top',wrapText:true};}));sheet.getCell('A1').font={name:'맑은 고딕',size:20,bold:true,color:{argb:'FF'+theme.hex.ink}};
 sheet.getRow(start).height=32;sheet.getRow(start).eachCell(c=>{c.font={name:'맑은 고딕',bold:true,color:{argb:'FFFFFFFF'}};c.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF'+theme.hex.navy}};});for(let i=start+1;i<=start+6;i++)sheet.getRow(i).height=27;
 // The detailed scope remains on its assessment sheet. These compact labels must all fit in print.
 for(let i=start+8;i<=last;i++){const row=sheet.getRow(i);let lines=1;row.eachCell(cell=>{const width=Math.max(1,sheet.getColumn(cell.col).width-2),count=String(cell.value||'').split('\n').reduce((sum,line)=>sum+Math.max(1,Math.ceil([...line].reduce((n,c)=>n+(c.charCodeAt(0)>255?2:1),0)/width)),0);lines=Math.max(lines,count);});row.height=Math.max(28,lines*16+12);}
 return sheet;
}
if(process.versions.electron&&process.argv.includes('--render-radar')){const {app}=require('electron'),fs=require('node:fs/promises');app.on('window-all-closed',()=>{});app.whenReady().then(async()=>{const i=process.argv.indexOf('--render-radar');await fs.writeFile(process.argv[i+2],await renderSvg(await fs.readFile(process.argv[i+1],'utf8')));app.exit(0);}).catch(error=>{console.error(error.message);app.exit(1);});}
module.exports={WIDTH,HEIGHT,COMPACT_HEIGHT,NOTE,STYLES,model,svg,html,description,raster,addExcel,renderSvg};
