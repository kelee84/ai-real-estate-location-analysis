'use strict';
const path=require('node:path'),fs=require('node:fs/promises'),os=require('node:os');
if(!process.versions.electron){console.error('확인된 Electron 실행파일로 실행해 주세요.');process.exitCode=1;}
else{
 const {app,BrowserWindow}=require('electron'),root=path.resolve(__dirname,'../../../..'),args=process.argv.slice(2);
 app.setPath('userData',path.join(os.tmpdir(),'sherpa-report-export-'+process.pid));
 app.whenReady().then(async()=>{
  if(args.length!==2)throw Error('Usage: electron render-pdf.cjs <INPUT.html> <NEW_OUTPUT.pdf>');
  const input=path.resolve(args[0]),output=path.resolve(args[1]);await fs.access(input);
  try{await fs.access(output);throw Error('이미 존재하는 PDF입니다. 새 파일명을 사용해 주세요.');}catch(e){if(e.code!=='ENOENT')throw e;}
  const win=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
  try{await win.loadFile(input);await win.webContents.executeJavaScript('document.fonts.ready.then(()=>true)');const result=await require(path.join(root,'program/src/report-pagination.cjs')).printBalanced(win);await fs.writeFile(output,result.buffer);await fs.writeFile(output+'.layout.json',JSON.stringify(result.layout,null,2));console.log(JSON.stringify({file:output,visualReviewRequired:true}));}finally{win.destroy();}
 }).then(()=>app.exit(0)).catch(e=>{console.error(e.message);app.exit(1);});
}
