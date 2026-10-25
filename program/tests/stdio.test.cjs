'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events'),{spawn}=require('node:child_process'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {install}=require('../src/stdio.cjs');
test('only broken diagnostic pipes are ignored, including synchronous writes',()=>{
 const out=new EventEmitter(),err=new EventEmitter();let writes=0;out.write=()=>{writes++;throw Object.assign(Error('broken pipe'),{code:'EPIPE'});};err.write=()=>true;
 install({stdout:out,stderr:err});install({stdout:out,stderr:err});assert.equal(out.listenerCount('error'),1);assert.equal(out.write('a'),false);assert.equal(out.write('b'),false);assert.equal(writes,1);assert.equal(err.write('still connected'),true);
 const other=Object.assign(Error('other failure'),{code:'EIO'});assert.throws(()=>err.emit('error',other),e=>e===other);
});
test('a real child survives closing both console readers and completes its work',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'re-stdio-')),result=path.join(dir,'done.json'),guard=require.resolve('../src/stdio.cjs');
 const script=`require(${JSON.stringify(guard)}).install();let broken=0;for(const s of [process.stdout,process.stderr])s.on('error',e=>{if(e.code==='EPIPE')broken++});console.log('ready');setTimeout(()=>{console.log('x'.repeat(1024*1024));console.error('y'.repeat(1024*1024));setTimeout(()=>{console.log('continues');require('fs').writeFileSync(${JSON.stringify(result)},JSON.stringify({broken,completed:true}));},100)},100);`;
 const child=spawn(process.execPath,['-e',script],{windowsHide:true,stdio:['ignore','pipe','pipe']});child.stdout.once('data',()=>{child.stdout.destroy();child.stderr.destroy();});
 const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});assert.equal(code,0);const data=JSON.parse(await fs.readFile(result,'utf8'));assert.equal(data.completed,true);assert.equal(data.broken,2);
 await fs.rm(result);await fs.rmdir(dir);
});
