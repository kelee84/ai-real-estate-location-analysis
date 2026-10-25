'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const {dialog}=require('electron');
exports.run=async({app,service,exportReport,exportSummary,output})=>{
 const folder=path.join(output,'export-location'),first=path.join(folder,'first'),second=path.join(folder,'second');for(const dir of [first,second])await fs.mkdir(dir,{recursive:true});
 const report=await service.demo(),original=dialog.showSaveDialog,preferences=path.join(app.getPath('userData'),'export-preferences.json'),defaults=[];
 let choice;dialog.showSaveDialog=async(_win,options)=>{defaults.push(options.defaultPath);return choice;};
 try{
  choice={canceled:false,filePath:path.join(first,'detail.html')};await exportReport(report.id,'html');assert.equal(path.dirname(defaults.at(-1)),app.getPath('documents'));
  choice={canceled:false,filePath:path.join(second,'summary.html')};await exportSummary(report.id,'html');assert.equal(path.dirname(defaults.at(-1)),first);
  choice={canceled:true};assert.equal(await exportReport(report.id,'pdf'),null);assert.equal(path.dirname(defaults.at(-1)),second);
  choice={canceled:false,filePath:path.join(folder,'does-not-exist/failed.html')};await assert.rejects(exportSummary(report.id,'html'),{code:'ENOENT'});assert.equal(path.dirname(defaults.at(-1)),second);
  choice={canceled:false,filePath:path.join(second,'detail-again.html')};await exportReport(report.id,'html');assert.equal(path.dirname(defaults.at(-1)),second);
  const saved=JSON.parse(await fs.readFile(preferences,'utf8'));assert.equal(saved.directory,second);
  const restarted=require('../src/export-location.cjs').createExportLocation({file:preferences,fallbackDirectory:app.getPath('documents')});assert.equal(await restarted.defaultPath('summary.pdf'),path.join(second,'summary.pdf'));
  await fs.writeFile(path.join(folder,'verification.json'),JSON.stringify({passed:true,sharedBetweenSummaryAndDetail:true,cancelPreservesFolder:true,failedExportPreservesFolder:true,restartPreservesFolder:true,defaults},null,2));
 }finally{dialog.showSaveDialog=original;}
};
