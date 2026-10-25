'use strict';
const {AsyncLocalStorage}=require('node:async_hooks');
const stable=v=>Array.isArray(v)?v.map(stable):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,k==='categories'&&Array.isArray(v[k])?[...v[k]].sort():stable(v[k])])):v;
class IpzitalkBudget{
 constructor(){this.context=new AsyncLocalStorage();this.last=null;}
 snapshot(){const s=this.context.getStore();if(!s)return this.last||{maxCalls:null,calls:0,reserveMap:0,remaining:null,remainingResearch:null,blocked:0,reused:0,byTool:{}};return {maxCalls:null,calls:s.calls,reserveMap:0,remaining:null,remainingResearch:null,blocked:0,reused:s.reused,byTool:{...s.byTool}};}
 active(){return !!this.context.getStore();}
 async run(options,work){if(this.active())return work();const initial=Number(options?.initialCalls),initialCalls=Number.isFinite(initial)?Math.max(0,Math.floor(initial)):0,s={calls:initialCalls,reused:0,byTool:initialCalls?{preflight:initialCalls}:{},requests:new Map()};return this.context.run(s,async()=>{try{return await work();}finally{this.last=this.snapshot();}});}
 take(tool){const s=this.context.getStore();if(s){s.calls++;s.byTool[tool]=(s.byTool[tool]||0)+1;}return true;}
 async reuse(tool,args,work){const s=this.context.getStore();if(!s)return work();const key=JSON.stringify([tool,stable(args)]);if(s.requests.has(key)){s.reused++;return {...structuredClone(await s.requests.get(key)),networkSkipped:true,reused:true};}const job=work();s.requests.set(key,job);return job;}
}
module.exports={IpzitalkBudget};
