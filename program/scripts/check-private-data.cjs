'use strict';
// Inspect Git blobs, never print a matched credential or personal value.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto');
const JSZip=require('jszip');
const LIMIT=128*1024*1024;
function git(root,args,input){return cp.execFileSync('git',args,{cwd:root,input,maxBuffer:LIMIT,windowsHide:true,stdio:['pipe','pipe','pipe']});}
const digest=value=>crypto.createHash('sha256').update(value).digest('hex');
const rules=[
 ['provider-key',/\b(?:sk-(?:proj-|svcacct-|ant-)?[A-Za-z0-9_-]{20,}|AIza[A-Za-z0-9_-]{30,}|AQ\.[A-Za-z0-9_-]{30,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|(?:AKIA|ASIA)[A-Z0-9]{16}|xox[baprs]-[A-Za-z0-9-]{20,})\b/g],
 ['private-key',/-----BEGIN (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----[\s\S]{30,}?-----END (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/g],
 ['jwt',/\beyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\b/g],
 ['secret-assignment',/\b(?:api[_-]?key|service[_-]?key|client[_-]?secret|access[_-]?token|refresh[_-]?token|password|passwd|secret)\b\s*["']?\s*[:=]\s*["']([^"'\r\n]{16,})["']/gi],
 ['url-credentials',/https?:\/\/[^\s/:"'<>]+:[^\s/@"'<>]+@[^\s/"'<>]+/gi],
 ['authorization-literal',/\b(?:Bearer|Basic)\s+([A-Za-z0-9+/_=-]{20,})/g],
 ['url-secret',/[?&](?:api[_-]?key|servicekey|token|access_token|secret|password)=([^&#\s"'<>]{12,})/gi],
 ['email',/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi],
 ['mobile-phone',/(?<![A-Za-z0-9_.-])01[016789][ -]?\d{3,4}[ -]?\d{4}(?![A-Za-z0-9_.-])/g],
 ['resident-id',/(?<!\d)\d{6}[ -][1-8]\d{6}(?!\d)/g],
 ['personal-path',/(?:[A-Z]:[\\/]+Users[\\/]+[^\\/\s"'<>]+|[A-Z]:[\\/]+AI교육자료(?:[\\/][^\s"'<>]*)?|(?<![A-Za-z0-9:/])\/(?:Users|home)\/(?!user\b|runner\b|oai\b)[^/\s"'<>]+)/gi],
 ['cloud-link',/https?:\/\/(?:drive\.google\.com|docs\.google\.com|1drv\.ms|(?:www\.)?dropbox\.com)\/[^\s"'<>]+/gi],
 ['activation-code',/\b(?:RH1\.[A-Za-z0-9_-]{86}|PC1-(?:[A-F0-9]{4}-){8}[A-F0-9]{4})\b/g],
 ['document-author',/<(?:dc:creator|cp:lastModifiedBy|Company|Manager)\b[^>]*>([^<]+)<\/(?:dc:creator|cp:lastModifiedBy|Company|Manager)>/g]
];
function scanText(text,file,findings,literals=[]){
 for(const [rule,re] of rules){
  re.lastIndex=0;
  for(const match of text.matchAll(re)){
   const value=match[1]||match[0];if(!value.trim())continue;
   findings.push({file,rule,line:text.slice(0,match.index).split('\n').length,sha256:digest(value)});
  }
 }
 for(const literal of literals){
  if(typeof literal!=='string'||!literal)continue;
  let index=text.indexOf(literal);
  while(index!==-1){findings.push({file,rule:'local-personal-identifier',line:text.slice(0,index).split('\n').length,sha256:digest(literal)});index=text.indexOf(literal,index+literal.length);}
 }
}
async function scanBuffer(bytes,file,findings,literals,stats){
 if(/\.(?:pptx|docx|xlsx|zip)$/i.test(file)){
  let zip;try{zip=await JSZip.loadAsync(bytes);}catch{findings.push({file,rule:'unreadable-archive',line:0,sha256:digest(bytes)});return;}
  for(const entry of Object.values(zip.files)){
   if(entry.dir)continue;
   if(entry._data?.uncompressedSize>32*1024*1024)throw new Error('Archive entry exceeds scan size limit: '+file);
   if(/\.(?:xml|rels|txt|json)$/i.test(entry.name)){stats.archiveEntries++;scanText(await entry.async('string'),file+'!'+entry.name,findings,literals);}
  }
 }else if(!bytes.includes(0))scanText(bytes.toString('utf8'),file,findings,literals);
 else if(/\.(?:png|jpe?g|ico|webp|gif|pdf)$/i.test(file))scanText(bytes.toString('latin1'),file,findings,literals);
}
function readBlobs(root,ids){
 if(!ids.length)return new Map();
 const output=git(root,['cat-file','--batch'],ids.join('\n')+'\n');
 const blobs=new Map();let offset=0;
 for(const id of ids){
  const end=output.indexOf(10,offset);if(end<0)throw new Error('Incomplete Git object response.');
  const header=output.subarray(offset,end).toString('utf8').split(' '),size=Number(header[2]);
  if(header[1]==='missing'||!Number.isSafeInteger(size))throw new Error('Missing Git object: '+id);
  offset=end+1;if(offset+size>=output.length)throw new Error('Truncated Git object.');
  if(header[1]==='blob')blobs.set(id,output.subarray(offset,offset+size));
  offset+=size+1;
 }
 return blobs;
}
function indexedFile(root,file){try{return git(root,['show',':'+file]);}catch{return null;}}
async function audit({root=path.resolve(__dirname,'../..'),history=true,working=false}={}){
 const entries=git(root,['ls-files','--stage','-z']).toString('utf8').split('\0').filter(Boolean).map(record=>{
  const tab=record.indexOf('\t'),[mode,id,stage]=record.slice(0,tab).split(' ');
  if(stage!=='0')throw new Error('Resolve Git conflicts before privacy review.');
  return {id,file:record.slice(tab+1),mode};
 });
 const stats={indexFiles:entries.length,historyBlobs:0,workingFiles:0,archiveEntries:0};
 const historyEntries=[];
 if(history){
  const commits=git(root,['rev-list','--all']).toString('utf8').trim();
  if(commits){for(const line of git(root,['-c','core.quotepath=false','rev-list','--objects','--all']).toString('utf8').trim().split('\n')){
   const space=line.indexOf(' ');if(space>0)historyEntries.push({id:line.slice(0,space),file:line.slice(space+1)});
  }}
 }
 const blobs=readBlobs(root,[...new Set([...entries,...historyEntries].map(e=>e.id))]);
 const allowFile='program/security-reviewed-findings.json',allowBytes=indexedFile(root,allowFile);
 const allow=allowBytes?JSON.parse(allowBytes.toString('utf8')).findings||[]:[];
 const allowed=new Map(allow.filter(a=>a.file&&a.rule&&a.sha256&&a.reason).map(a=>[[a.file,a.rule,a.sha256].join('\0'),a.reason]));
 let literals=[];const literalFile=path.join(root,'.private/security-review/identifiers.local.json');
 if(fs.existsSync(literalFile))literals=JSON.parse(fs.readFileSync(literalFile,'utf8')).literals||[];
 const findings=[],seen=new Set();
 for(const entry of [...entries,...historyEntries]){
  if(!blobs.has(entry.id))continue;
  const identity=entry.id+'\0'+entry.file;if(seen.has(identity))continue;seen.add(identity);
  if(historyEntries.includes(entry))stats.historyBlobs++;
  const start=findings.length;
  await scanBuffer(blobs.get(entry.id),entry.file,findings,literals,stats);
  for(const item of findings.slice(start))item.blob=entry.id;
 }
 const ignored=git(root,['ls-files','-ci','--exclude-standard','-z']).toString('utf8').split('\0').filter(Boolean);
 for(const file of ignored)findings.push({file,rule:'ignored-file-in-index',line:0,sha256:''});
 if(working){
  const paths=git(root,['ls-files','--cached','--others','--exclude-standard','-z']).toString('utf8').split('\0').filter(Boolean);
  for(const file of new Set(paths)){
   const target=path.join(root,file);if(!fs.existsSync(target)||!fs.lstatSync(target).isFile())continue;
   const bytes=fs.readFileSync(target),indexed=entries.find(e=>e.file===file);
   if(indexed){const registered=blobs.get(indexed.id);if(registered?.equals(bytes)||!bytes.includes(0)&&registered?.equals(Buffer.from(bytes.toString('utf8').replace(/\r\n/g,'\n'))))continue;}
   stats.workingFiles++;await scanBuffer(bytes,file,findings,literals,stats);
  }
 }
 const reviewed=[],blocked=[];
 for(const item of findings){const reason=allowed.get([item.file,item.rule,item.sha256].join('\0'));(reason?reviewed:blocked).push(reason?{...item,reason}:item);}
 return {checkedAt:new Date().toISOString(),...stats,reviewedCount:reviewed.length,blockedCount:blocked.length,blocked,reviewed};
}
if(require.main===module){
 const args=process.argv.slice(2);let report;
 const reportIndex=args.indexOf('--report');if(reportIndex!==-1)report=args[reportIndex+1];
 audit({working:args.includes('--worktree')}).then(result=>{
  if(report){
   const root=path.resolve(__dirname,'../..'),target=path.resolve(root,report),privateRoot=path.join(root,'.private')+path.sep;
   if(!target.startsWith(privateRoot))throw new Error('Review reports must be saved under ignored .private/.');
   fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,JSON.stringify(result,null,2)+'\n');
  }
  console.log(JSON.stringify({checkedAt:result.checkedAt,indexFiles:result.indexFiles,historyBlobs:result.historyBlobs,workingFiles:result.workingFiles,archiveEntries:result.archiveEntries,reviewedCount:result.reviewedCount,blockedCount:result.blockedCount,blocked:result.blocked},null,2));
  if(result.blockedCount)process.exitCode=1;
 }).catch(error=>{console.error('Privacy check failed: '+error.message);process.exitCode=1;});
}
module.exports={audit,scanText,digest};
