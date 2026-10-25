'use strict';
// A desktop app can outlive the terminal that launched it. Only a disconnected
// diagnostic pipe is ignored; other stream errors keep their normal behavior.
const installed=new WeakSet();
function protect(stream){
 if(!stream||installed.has(stream))return;installed.add(stream);
 const write=stream.write;let disconnected=false;
 const ignore=error=>{if(error?.code!=='EPIPE')throw error;disconnected=true;};
 stream.on('error',ignore);
 stream.write=function(...args){
  const done=()=>{const callback=args.at(-1);if(typeof callback==='function')queueMicrotask(()=>callback());return false;};
  if(disconnected)return done();
  try{return write.apply(this,args);}catch(error){ignore(error);return done();}
 };
}
function install(proc=process){protect(proc.stdout);protect(proc.stderr);}
module.exports={install};
