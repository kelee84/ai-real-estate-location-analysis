'use strict';
const fs=require('node:fs/promises');const path=require('node:path');const {randomUUID}=require('node:crypto');
class ReportStore {
  constructor(root,{afterSave}={}){this.root=root;this.afterSave=afterSave;this.writes=new Map();}
  path(id){if(!/^[0-9a-f-]{36}$/.test(id||''))throw new Error('보고서 번호가 올바르지 않습니다.');return path.join(this.root,id);}
  async serial(id,work){const prior=this.writes.get(id)||Promise.resolve(),next=prior.catch(()=>{}).then(work);this.writes.set(id,next);try{return await next;}finally{if(this.writes.get(id)===next)this.writes.delete(id);}}
  async write(report,{afterSave=true}={}){const id=report.id,dir=this.path(id);await fs.mkdir(dir,{recursive:true});const out={...report,consultation:require('./consultation.cjs').getConsultation(report)},temp=path.join(dir,'report.'+randomUUID()+'.tmp');try{await fs.writeFile(temp,JSON.stringify(out,null,2));await fs.rename(temp,path.join(dir,'report.json'));}finally{await fs.rm(temp,{force:true}).catch(()=>{});}if(afterSave&&this.afterSave)await this.afterSave(out);return out;}
  async save(report,options={}){const id=report.id||randomUUID();this.path(id);return this.serial(id,()=>this.write({...report,id},options));}
  async update(id,transform,options={}){this.path(id);return this.serial(id,async()=>{const current=await this.load(id),next=await transform(current);if(next.id!==id)throw new Error('저장할 보고서 번호가 변경되었습니다.');return this.write(next,options);});}
  async load(id){const report=JSON.parse(await fs.readFile(path.join(this.path(id),'report.json'),'utf8'));return {...report,consultation:require('./consultation.cjs').getConsultation(report)};}
  async list(){await fs.mkdir(this.root,{recursive:true});const entries=await fs.readdir(this.root,{withFileTypes:true}),items=[];for(const e of entries){if(!e.isDirectory()||!/^[0-9a-f-]{36}$/.test(e.name))continue;try{const r=await this.load(e.name);items.push({id:r.id,title:r.title,target:r.input.target,createdAt:r.createdAt,status:r.status,demo:!!r.demo,mode:r.mode||'single',asOf:r.input.asOf,area:r.input.area});}catch{}}return items.sort((a,b)=>b.createdAt.localeCompare(a.createdAt));}
}
module.exports={ReportStore};
