'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),{randomUUID}=require('node:crypto');

// Shared by summary and detailed exports; local UI preferences never enter reports or AI requests.
function createExportLocation({file,fallbackDirectory}){
 let pending=Promise.resolve();
 async function defaultPath(name){
  await pending;
  let directory=fallbackDirectory;
  try{const saved=JSON.parse(await fs.readFile(file,'utf8'));if(typeof saved.directory==='string'&&path.isAbsolute(saved.directory)&&(await fs.stat(saved.directory)).isDirectory())directory=saved.directory;}catch{}
  return path.join(directory,path.basename(name));
 }
 function remember(filePath){
  const save=async()=>{
   let temp;
   try{
    if(typeof filePath!=='string'||!path.isAbsolute(filePath))return false;
    const directory=path.dirname(filePath);if(!(await fs.stat(directory)).isDirectory())return false;
    await fs.mkdir(path.dirname(file),{recursive:true});temp=file+'.'+randomUUID()+'.tmp';
    await fs.writeFile(temp,JSON.stringify({directory},null,2));await fs.rename(temp,file);return true;
   }catch{return false;}finally{if(temp)await fs.rm(temp,{force:true}).catch(()=>{});}
  };
  pending=pending.then(save,save);return pending;
 }
 return {defaultPath,remember};
}
module.exports={createExportLocation};
