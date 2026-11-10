'use strict';
const fs=require('node:fs/promises');const path=require('node:path');const {randomUUID}=require('node:crypto');
class ReportStore {
  // index: 보관함 목록용 요약. report.json의 수정시각·크기가 같으면 큰 원문을 다시 읽지 않는다.
  constructor(root,{afterSave}={}){this.root=root;this.afterSave=afterSave;this.writes=new Map();this.index=new Map();}
  static summary(r){return {id:r.id,title:r.title,target:r.input.target,createdAt:r.createdAt,status:r.status,demo:!!r.demo,mode:r.mode||'single',asOf:r.input.asOf,area:r.input.area,asset:r.input.asset,building:r.input.building};}
  path(id){if(!/^[0-9a-f-]{36}$/.test(id||''))throw new Error('보고서 번호가 올바르지 않습니다.');return path.join(this.root,id);}
  async serial(id,work){const prior=this.writes.get(id)||Promise.resolve(),next=prior.catch(()=>{}).then(work);this.writes.set(id,next);try{return await next;}finally{if(this.writes.get(id)===next)this.writes.delete(id);}}
  async write(report,{afterSave=true}={}){const id=report.id,dir=this.path(id);await fs.mkdir(dir,{recursive:true});const out={...report,consultation:require('./consultation.cjs').getConsultation(report)},temp=path.join(dir,'report.'+randomUUID()+'.tmp');try{await fs.writeFile(temp,JSON.stringify(out,null,2));await fs.rename(temp,path.join(dir,'report.json'));this.index.delete(id);}finally{await fs.rm(temp,{force:true}).catch(()=>{});}if(afterSave&&this.afterSave)await this.afterSave(out);return out;}
  async save(report,options={}){const id=report.id||randomUUID();this.path(id);return this.serial(id,()=>this.write({...report,id},options));}
  async update(id,transform,options={}){this.path(id);return this.serial(id,async()=>{const current=await this.load(id),next=await transform(current);if(next.id!==id)throw new Error('저장할 보고서 번호가 변경되었습니다.');return this.write(next,options);});}
  async load(id){const report=JSON.parse(await fs.readFile(path.join(this.path(id),'report.json'),'utf8'));return {...report,consultation:require('./consultation.cjs').getConsultation(report)};}
  async list(){
    await fs.mkdir(this.root,{recursive:true});
    const names=(await fs.readdir(this.root,{withFileTypes:true})).filter(e=>e.isDirectory()&&/^[0-9a-f-]{36}$/.test(e.name)).map(e=>e.name),items=[];
    let next=0;
    // 읽지 못한 보고서는 목록에서 빼고 요약도 남기지 않는다(다음 조회에서 다시 확인).
    const worker=async()=>{while(next<names.length){const name=names[next++];try{
      const stat=await fs.stat(path.join(this.root,name,'report.json')),stamp=stat.mtimeMs+':'+stat.size,known=this.index.get(name);
      if(known?.stamp===stamp){items.push(known.item);continue;}
      const item=ReportStore.summary(await this.load(name));this.index.set(name,{stamp,item});items.push(item);
    }catch{this.index.delete(name);}}};
    await Promise.all(Array.from({length:Math.min(6,names.length)},worker));
    const present=new Set(names);for(const name of this.index.keys())if(!present.has(name))this.index.delete(name);
    return items.map(item=>({...item})).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||a.id.localeCompare(b.id));
  }
}
module.exports={ReportStore};
