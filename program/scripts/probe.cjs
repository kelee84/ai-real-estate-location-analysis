'use strict';
async function main() {
  const r = await fetch('https://ipji-talk.com/mcp', { method: 'POST', headers: { 'Content-Type':'application/json', Accept:'application/json, text/event-stream' }, body: JSON.stringify({jsonrpc:'2.0', id:1, method:'initialize', params:{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'real-estate-helper',version:'0.1.0'}}}), signal:AbortSignal.timeout(20000) });
  const session = r.headers.get('mcp-session-id');
  console.log('initialize', r.status, (await r.text()).slice(0,600));
  const headers = {'Content-Type':'application/json',Accept:'application/json, text/event-stream',...(session?{'mcp-session-id':session}:{})};
  await fetch('https://ipji-talk.com/mcp',{method:'POST',headers,body:JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'}),signal:AbortSignal.timeout(15000)});
  const list = await fetch('https://ipji-talk.com/mcp',{method:'POST',headers,body:JSON.stringify({jsonrpc:'2.0',id:2,method:'tools/list',params:{}}),signal:AbortSignal.timeout(20000)});
  const raw=await list.text(); require('node:fs').mkdirSync('../.build',{recursive:true});require('node:fs').writeFileSync('../.build/ipjitalk-tools.txt',raw);
  let data;try { data=JSON.parse(raw); } catch { data=JSON.parse(raw.split('\n').find(l=>l.startsWith('data:'))?.slice(5)||'{}'); }
  console.log(JSON.stringify(data.result?.tools?.map(t=>({name:t.name,description:t.description?.slice(0,140),input:t.inputSchema})),null,2));
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
