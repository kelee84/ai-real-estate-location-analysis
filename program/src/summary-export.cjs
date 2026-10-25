'use strict';
const fs=require('node:fs/promises'),path=require('node:path');
const {randomUUID}=require('node:crypto');
const {safeName}=require('./core.cjs');
const summary=require('./customer-summary.cjs');
const reports=require('./report.cjs');

// All customer summary formats use the same public projection and saved evidence.
function createSummaryExporter({BrowserWindow,store,loadReport,chooseFile,onSaved}){
  return async function exportSummary(id,format,forcedPath){
    if(!['html','pdf','png'].includes(format))throw new Error('요약본은 PDF·이미지·HTML로 저장할 수 있습니다.');
    const report=loadReport?await loadReport(id):require('./scoring.cjs').prepareReport(await store.load(id));
    const image=await reports.mapData(report,store);
    const content=summary.html(report,image);
    const file=forcedPath||await chooseFile({name:safeName(report.input.target)+'_고객요약_'+report.input.asOf+'.'+format,format});
    if(!file)return null;
    if(format==='html')await fs.writeFile(file,content,'utf8');
    else{
      const temp=path.join(store.path(id),'summary-print-'+randomUUID()+'.html');
      let win;
      try{
        await fs.writeFile(temp,content,'utf8');
        win=new BrowserWindow({show:false,width:1080,height:800,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
        win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
        await win.loadFile(temp);
        await win.webContents.executeJavaScript('Promise.all([document.fonts.ready,...Array.from(document.images,image=>image.decode().catch(()=>{}))]).then(()=>true)');
        if(format==='pdf'){
          const printed=await require('./report-pagination.cjs').printBalanced(win);
          await fs.writeFile(file,printed.buffer);
        }else{
          const size=await win.webContents.executeJavaScript('({width:document.documentElement.scrollWidth,height:Math.ceil(Math.max(document.documentElement.scrollHeight,document.body.scrollHeight))})');
          if(size.width>1100||size.height>16000)throw new Error('내용이 길어 한 장 이미지로 저장하기 어렵습니다. PDF로 저장해 주세요.');
          win.setContentSize(1080,Math.max(800,size.height));
          await win.webContents.executeJavaScript('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))');
          const actual=await win.webContents.executeJavaScript('({width:document.documentElement.scrollWidth,height:Math.ceil(Math.max(document.documentElement.scrollHeight,document.body.scrollHeight))})');
          if(actual.width>1100||actual.height>16000)throw new Error('내용이 길어 한 장 이미지로 저장하기 어렵습니다. PDF로 저장해 주세요.');
          const capture=await win.webContents.capturePage({x:0,y:0,width:1080,height:actual.height});
          if(capture.isEmpty())throw new Error('요약 이미지를 만들지 못했습니다. 다시 저장해 주세요.');
          await fs.writeFile(file,capture.toPNG());
        }
      }finally{
        if(win&&!win.isDestroyed())win.destroy();
        await fs.rm(temp,{force:true}).catch(()=>{});
      }
    }
    if(!forcedPath)await onSaved?.(file);
    return {file,format,note:'고객용 핵심 요약본을 저장했습니다.'};
  };
}
module.exports={createSummaryExporter};
