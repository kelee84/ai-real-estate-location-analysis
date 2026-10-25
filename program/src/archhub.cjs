'use strict';
// Read-only MCP client. No account credentials or customer inputs are sent.
const fs=require('node:fs/promises'),path=require('node:path'),{createHash,randomUUID}=require('node:crypto');
const {todayKst,validDate}=require('./core.cjs');
const URL='https://mcp.gomdori.app/archhub',VERSION='archhub-complex-ledger-v1',MAX=2*1024*1024;
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const day=v=>{const n=Date.parse(v);return Number.isFinite(n)&&n<=Date.now()?todayKst(new Date(n)):null;};
const lot=v=>String(v||'').split('-').map(n=>/^\d+$/.test(n)?String(Number(n)):n).join('-');
function identityKey(i){return i?.code&&/^\d{5}$/.test(i.regionCode||'')&&i.province&&i.region&&i.town&&/^\d{1,4}(?:-\d{1,4})?$/.test(i.lot||'')&&i.building?hash([String(i.code),i.regionCode,i.province,i.region,i.town,lot(i.lot),i.building]):null;}
function text(result){
 if(result?.isError||result?.error)throw Error('건축HUB 조회 오류');
 const value=result?.structuredContent?.result??result?.content?.filter(c=>c.type==='text').map(c=>c.text).join('\n');
 if(typeof value!=='string'||Buffer.byteLength(value)>MAX||/\[(?:ERROR|NOT_FOUND)\]/.test(value))throw Error('건축HUB 자료 없음 또는 조회 오류');
 return value;
}
// Archhub currently returns pandas fixed-width text. Read explicit column
// boundaries, not whitespace-separated values (addresses contain spaces).
function table(value){
 if(typeof value!=='string'||value.includes('...')||value.includes('…')||!value.includes('출처: 국토교통부 건축HUB'))throw Error('건축HUB 표 형식을 확인하지 못했습니다.');
 const lines=value.split(/\r?\n/),at=lines.findIndex(l=>/\bsigungu_code\s+bdong_code\b/.test(l)||l.includes('관리건축물대장PK')&&l.includes('대지위치'));
 if(at<0)throw Error('건축HUB 원자료 열을 확인하지 못했습니다.');
 const header=[...lines[at].matchAll(/\S+/g)].map(m=>({name:m[0],end:m.index+m[0].length}));
 if(new Set(header.map(c=>c.name)).size!==header.length)throw Error('건축HUB 중복 열');
 const rows=[];
 for(const line of lines.slice(at+1)){
  if(!line.trim())break;
  if(line.length>lines[at].length)throw Error('건축HUB 표 너비가 변경됐습니다.');
  let start=0;const row={};
  for(const c of header){if(start&&line[start-1]!==' ')throw Error('건축HUB 열 경계 오류');row[c.name]=line.slice(start,c.end).trim();start=c.end+1;}
  rows.push(row);
 }
 const shown=value.match(/^총 (\d+)건/m);if(!shown||Number(shown[1])!==rows.length)throw Error('건축HUB 표 일부가 누락됐습니다.');
 return rows;
}
function region(value,i){
 const rows=table(value).filter(r=>r['시도명']===i.province&&r['시군구명']===i.region&&[r['읍면동명'],r['동리명']].includes(i.town)&&r.sigungu_code===i.regionCode&&/^\d{5}$/.test(r.bdong_code)&&r.bdong_code!=='00000');
 if(rows.length!==1)throw Error('건축HUB 법정동이 공식 단지 주소와 일치하지 않습니다.');
 return {sigungu_code:rows[0].sigungu_code,bdong_code:rows[0].bdong_code};
}
function ledger(value,i,codes){
 const rows=table(value),total=value.match(/유형=총괄표제부 · 전체 (\d+)건 · page=1/);
 if(!total||Number(total[1])!==1||rows.length!==1)throw Error('한 단지의 총괄표제부를 단일하게 확인하지 못했습니다.');
 const row=rows[0],match=(row['대지위치']||'').match(/^(.*)\s+(\d+(?:-\d+)?)번지$/);
 if(!match||match[1]!==[i.province,i.region,i.town].join(' ')||lot(match[2])!==lot(i.lot)||lot(row['번']+'-'+row['지']).replace(/-0$/,'')!==lot(i.lot).replace(/-0$/,'')||row['대장종류코드명']!=='총괄표제부'||row['신구대장구분코드명']!=='신대장'||!/^\d{1,40}$/.test(row['관리건축물대장PK']||'')||row['대지구분코드']!=='0'||row['주용도코드명']!=='공동주택'||!require('./property-identity.cjs').matchesKaptIdentity(i,{name:row['건물명'],addressJibun:row['대지위치'].replace(/번지$/,''),addressRoad:row['도로명대지위치']}))throw Error('건축HUB 총괄대장의 단지·지번·용도를 확인하지 못했습니다.');
 const count=v=>/^\d+$/.test(v||'')&&Number.isSafeInteger(Number(v))&&Number(v)<=10000000?Number(v):null;
 const basic={},units=count(row['세대수']),parking=count(row['총주차수']),approval=(row['사용승인일']||'').replace(/^(\d{4})(\d{2})(\d{2})$/,'$1-$2-$3');
 if(units>0)basic.units=units;
 // Zero in the building ledger can mean an unfilled parking field. Do not
 // turn this into a claim that an apartment has no parking.
 if(parking>0)basic.parkingSpaces=parking;
 if(validDate(approval)&&approval<=todayKst())basic.approvalDate=approval;
 if(!Object.keys(basic).length)throw Error('건축HUB 기본정보 미기재');
 return {name:row['건물명'],addressJibun:row['대지위치'].replace(/번지$/,''),registerPk:row['관리건축물대장PK'],basic,registryCreated:row['생성일자']||null,codes};
}
function normalize(value,{identity,asOf,allowHistorical=false}={}){
 if(!value||value.version!==VERSION||value.endpoint!==URL||value.identityKey!==identityKey(identity)||!day(value.checkedAt)||(!allowHistorical&&asOf!==todayKst())||day(value.checkedAt)!==asOf)throw Error('건축HUB 자료의 공식 단지·조회일을 확인하지 못했습니다.');
 const codes=region(value.raw.region,identity),data=ledger(value.raw.ledger,identity,codes);
 if(value.codes&&(value.codes.sigungu_code!==codes.sigungu_code||value.codes.bdong_code!==codes.bdong_code))throw Error('건축HUB 법정동 응답과 저장 코드가 다릅니다.');
 if(data.basic.approvalDate>asOf)delete data.basic.approvalDate;
 return {version:VERSION,endpoint:URL,identityKey:identityKey(identity),checkedAt:value.checkedAt,sourceUrl:'https://cloud.eais.go.kr/',sourceName:'국토교통부 건축HUB · 총괄표제부',...data,raw:{region:value.raw.region,ledger:value.raw.ledger}};
}
function verified(value,context){try{return normalize(value,context);}catch{return null;}}
const complete=r=>!!r&&Number.isInteger(r.basic?.units)&&r.basic.units>0&&Number.isInteger(r.basic.parkingSpaces)&&validDate(r.basic.approvalDate);
class Client{
 constructor({fetcher=globalThis.fetch,onCall=()=>{}}={}){this.fetcher=fetcher;this.onCall=onCall;this.seq=0;this.headers={Accept:'application/json, text/event-stream','Content-Type':'application/json'};}
 async rpc(method,params,{signal,notification=false}={}){
  const id=++this.seq,payload={jsonrpc:'2.0',...(!notification?{id}:{}),method,...(params?{params}:{})},timeout=AbortSignal.timeout(25000),abort=signal?AbortSignal.any([signal,timeout]):timeout;
  const response=await this.fetcher(URL,{method:'POST',headers:this.headers,body:JSON.stringify(payload),signal:abort,redirect:'error'});
  if(!response.ok)throw Error('건축HUB HTTP '+response.status);
  const sid=response.headers.get('mcp-session-id');if(sid)this.headers['Mcp-Session-Id']=sid;
  if(response.status===202){await response.body?.cancel();return null;}
  const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='',bytes=0;
  try{while(true){const {value,done}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>MAX)throw Error('건축HUB 응답 용량 초과');buffer+=decoder.decode(value,{stream:true});if(response.headers.get('content-type')?.includes('text/event-stream')){const lines=buffer.split(/\r?\n/);buffer=lines.pop();for(const line of lines)if(line.startsWith('data:')){const item=JSON.parse(line.slice(5));if(item.id===id){if(item.error)throw Error('건축HUB MCP 오류');return item.result;}}}}
   if(notification)return null;const item=JSON.parse(buffer);if(item.error)throw Error('건축HUB MCP 오류');return item.result;
  }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
 }
 async call(name,args,{signal}={}){
  if(!this.ready)this.ready=this.rpc('initialize',{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'real-estate-helper',version:require('../package.json').version}},{signal}).then(async r=>{this.headers['MCP-Protocol-Version']=r.protocolVersion;await this.rpc('notifications/initialized',null,{signal,notification:true});}).catch(e=>{this.ready=null;throw e;});
  await this.ready;this.onCall({server:'archhub',tool:name,arguments:args});return text(await this.rpc('tools/call',{name,arguments:args},{signal}));
 }
}
class Store{
 constructor(root,{client=new Client()}={}){this.root=root?path.join(path.resolve(root),'archhub-cache'):null;this.client=client;this.pending=new Map();this.regions=new Map();this.memory=new Map();}
 async read(identity){const key=identityKey(identity);if(!key)return null;let v=this.memory.get(key);if(!v&&this.root)try{const file=path.join(this.root,key+'.json'),stat=await fs.lstat(file);if(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<=MAX)v=JSON.parse(await fs.readFile(file,'utf8'));}catch{}return v;}
 async saved(input,prices){return verified(await this.read(prices.buildingResolution),{identity:prices.buildingResolution,asOf:input.asOf});}
 rejected(v,input,i){try{if(v?.status!=='unavailable'||v.version!==VERSION||v.endpoint!==URL||v.identityKey!==identityKey(i)||day(v.checkedAt)!==input.asOf)return false;region(v.raw.region,i);const rows=table(v.raw.ledger),m=v.raw.ledger.match(/유형=총괄표제부 · 전체 (\d+)건 · page=1/);return !!m&&Number(m[1])===rows.length&&!verified(v,{identity:i,asOf:input.asOf});}catch{return false;}}
 async save(key,record){if(this.root){await fs.mkdir(this.root,{recursive:true});const file=path.join(this.root,key+'.json'),temp=file+'.'+randomUUID()+'.tmp';try{await fs.writeFile(temp,JSON.stringify(record,null,2));await fs.rename(temp,file);}finally{await fs.rm(temp,{force:true}).catch(()=>{});}}this.memory.set(key,record);}
 async ensure(input,prices,{forceRefresh=false,signal}={}){
  if(input.asset!=='apartment'||input.asOf!==todayKst())return null;
  const identity=prices.buildingResolution,key=identityKey(identity);if(!key)return null;
  const scope=input.asOf+':'+key;
  if(!forceRefresh){const v=await this.read(identity),found=verified(v,{identity,asOf:input.asOf})||verified(prices.archhub,{identity,asOf:input.asOf});if(found)return found;if(this.rejected(v,input,identity))return null;}
  if(!this.pending.has(scope))this.pending.set(scope,(async()=>{
   const regionKey=JSON.stringify([input.asOf,identity.regionCode,identity.province,identity.region,identity.town]);
   if(!this.regions.has(regionKey))this.regions.set(regionKey,this.client.call('find_region',{keyword:[identity.province,identity.region,identity.town].join(' '),limit:20},{signal}));
   const rawRegion=await this.regions.get(regionKey),codes=region(rawRegion,identity),[bun,ji='0']=lot(identity.lot).split('-');
   const rawLedger=await this.client.call('building_data',{kind:'ledger',type_name:'총괄표제부',...codes,bun,ji,max_rows:100,page:1},{signal});
   const collected={version:VERSION,endpoint:URL,identityKey:key,checkedAt:new Date().toISOString(),raw:{region:rawRegion,ledger:rawLedger}};let record;
   try{record=normalize(collected,{identity,asOf:input.asOf});}catch(error){const rejected={...collected,status:'unavailable',reason:error.message};if(!this.rejected(rejected,input,identity))throw error;record=rejected;}
   if(signal?.aborted)throw Error('분석을 중지했습니다.');
   await this.save(key,record);return record.status==='unavailable'?null:record;
  })());
  return structuredClone(await this.pending.get(scope));
 }
 begin(){this.pending.clear();this.regions.clear();}
}
function original(member){return [member.prices?.archhub,member.assessment?.evidence?.archhub].map(r=>verified(r,{identity:member.prices?.buildingResolution,asOf:member.input?.asOf,allowHistorical:true})).find(Boolean)||null;}
function snapshot(member){const s=member.archhubSnapshot,r=s?.record,d=day(r?.checkedAt);return s?.version===VERSION&&d&&d>=member.input?.asOf&&d<=todayKst()&&s.identityKey===identityKey(member.prices?.buildingResolution)?verified(r,{identity:member.prices.buildingResolution,asOf:d,allowHistorical:true}):null;}
function attach(evidence,record){if(!record)return evidence;const sourceId='ev-archhub-'+record.identityKey.slice(0,12);evidence.archhub={...structuredClone(record),sourceId};evidence.sources=[...(evidence.sources||[]).filter(s=>s.id!==sourceId),{id:sourceId,title:record.sourceName+' · '+record.name,url:record.sourceUrl,checkedAt:day(record.checkedAt)}];return evidence;}
module.exports={URL,VERSION,Client,Store,table,region,ledger,normalize,verified,identityKey,day,complete,original,snapshot,attach};
