'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {readAppFile}=require('../src/app-files.cjs');
test('한글·공백 경로에서 첫 화면과 JS/CSS/폰트를 직접 제공',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'app-files-')),web=path.join(root,'한글 경로','web');
 try{
  await fs.mkdir(web,{recursive:true});
  for(const [name,content,type]of [['index.html','<h1>부동산 도우미</h1>','text/html'],['app.js','window.ready=true','text/javascript'],['style.css','body{}','text/css'],['font.ttf','font bytes','font/ttf']]){
   await fs.writeFile(path.join(web,name),content);const response=await readAppFile({url:'helper://app/'+name,method:'GET'},web);
   assert.equal(response.status,200);assert.match(response.headers.get('Content-Type'),new RegExp(type));assert.equal(await response.text(),content);assert.equal(response.headers.get('X-Content-Type-Options'),'nosniff');
  }
  assert.equal((await readAppFile({url:'helper://app/'},web)).status,200);
  const head=await readAppFile({url:'helper://app/index.html',method:'HEAD'},web);assert.equal(head.status,200);assert.equal(await head.text(),'');
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
test('외부 호스트·경로 이탈·알 수 없는 파일·비정상 요청을 차단',async()=>{
 const web=path.resolve(__dirname,'../src/web');
 for(const url of ['helper://report/index.html','https://app/index.html','helper://app:99/index.html','helper://app/..%5Cmain.cjs','helper://app/%2E%2E%5Cmain.cjs','helper://app/missing.html','helper://app/secret.cjs'])assert.equal((await readAppFile({url},web)).status,404,url);
 assert.equal((await readAppFile({url:'helper://app/%zz'},web)).status,400);
 assert.equal((await readAppFile({url:'helper://app/index.html',method:'POST'},web)).status,405);
});
