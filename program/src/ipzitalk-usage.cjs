'use strict';
const {todayKst}=require('./core.cjs');
const {data,toolError}=require('./research-cache.cjs');
// No assumed plan size or local subtraction: other apps can spend this quota.
class IpzitalkUsage{
 constructor(){this.reset();}
 reset(){this.day=todayKst();this.calls=0;this.remaining=null;this.checkedAt=null;this.limited=false;}
 snapshot(){if(this.day!==todayKst())this.reset();return {day:this.day,remaining:this.remaining,checkedAt:this.checkedAt,limited:this.limited,sessionCalls:this.calls,source:this.limited?'service-limit-response':'not-provided'};}
 requestStarted(){if(this.day!==todayKst())this.reset();this.calls++;this.checkedAt=new Date().toISOString();return this.snapshot();}
 observe(tool,{count=true}={}){
  if(tool?.server!=='ipzitalk')return this.snapshot();if(this.day!==todayKst())this.reset();
  if(count)this.calls++;this.checkedAt=new Date().toISOString();
  if(toolError(tool)==='DAILY_TOOL_LIMIT_EXCEEDED'){this.remaining=0;this.limited=true;}
  else if(!this.limited&&!toolError(tool)&&data(tool)){this.remaining=null;}
  return this.snapshot();
 }
}
module.exports={IpzitalkUsage};
