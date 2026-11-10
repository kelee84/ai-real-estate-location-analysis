'use strict';
const fs=require('node:fs/promises'),path=require('node:path');
const TYPES={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon','.ttf':'font/ttf','.woff':'font/woff','.woff2':'font/woff2'};
async function readAppFile(request,webRoot){
 let url,relative;try{url=new URL(request.url);relative=decodeURIComponent(url.pathname).replace(/^\//,'')||'index.html';}catch{return new Response('Invalid path',{status:400});}
 if(url.protocol!=='helper:'||url.hostname!=='app'||url.port||url.username||url.password)return new Response('Not found',{status:404});
 if(request.method&&!['GET','HEAD'].includes(request.method))return new Response('Method not allowed',{status:405});
 const base=path.resolve(webRoot),file=path.resolve(base,relative),type=TYPES[path.extname(file).toLowerCase()];
 if(!file.startsWith(base+path.sep)||!type)return new Response('Not found',{status:404});
 try{
  // Serve bytes directly. Chromium's separate file:// loader can reject paths
  // that the main process can read, leaving helper://app/index.html ERR_FAILED.
  const realBase=await fs.realpath(base),realFile=await fs.realpath(file);
  if(!realFile.startsWith(realBase+path.sep))return new Response('Not found',{status:404});
  const bytes=await fs.readFile(realFile);
  return new Response(request.method==='HEAD'?null:bytes,{headers:{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
 }catch(error){if(['ENOENT','ENOTDIR','EISDIR'].includes(error.code))return new Response('Not found',{status:404});throw error;}
}
module.exports={readAppFile};
