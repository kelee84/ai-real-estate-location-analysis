'use strict';
const {escapeHtml}=require('./core.cjs');
function entries(report){
  const candidates=[];
  for(const r of [report,...(report.members||[])]){
    for(const search of [...(r.aiGrounding?.webSearches||[]),...(r.futureDevelopments?.webSearches||[])]){
      const value=search.searchEntryPoint?.renderedContent||search.groundingMetadata?.searchEntryPoint?.renderedContent;
      if(typeof value==='string'&&value.length<=200000)candidates.push(value);
    }
  }
  return [...new Set(candidates)].slice(0,12);
}
function claudeSources(report){
  const sources=new Map();
  for(const item of [report,...(report.members||[])])for(const search of [...(item.aiGrounding?.webSearches||[]),...(item.futureDevelopments?.webSearches||[])]){
    if(search.provider!=='claude')continue;
    for(const source of [...(search.sources||[]),...(search.citations||[])])try{
      const url=new URL(source.url);if(url.protocol!=='https:'||url.username||url.password)continue;
      if(!sources.has(url.href))sources.set(url.href,{url:url.href,title:String(source.title||url.hostname).slice(0,300)});
    }catch{}
  }
  return [...sources.values()];
}
function html(report){
  // Google supplies these attribution snippets. Render only inside a sandboxed
  // helper frame with its own strict CSP, never inside report/export markup.
  const sources=claudeSources(report),claude=sources.length?'<section><h2>Claude 검색 참고</h2><ul>'+sources.map(s=>'<li><a target="_blank" rel="noopener noreferrer" href="'+escapeHtml(s.url)+'">'+escapeHtml(s.title)+'</a></li>').join('')+'</ul></section>':'';
  return '<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'none\'; style-src \'unsafe-inline\'; img-src https: data:; frame-src \'none\'; object-src \'none\'; base-uri \'none\'; form-action \'none\'"><style>body{font:14px/1.6 \'Malgun Gothic\',sans-serif;margin:12px;background:white;color:#182b3d}section{margin-bottom:14px}h2{font-size:15px}a{overflow-wrap:anywhere}</style></head><body>'+entries(report).map(value=>'<section>'+value+'</section>').join('')+claude+'</body></html>';
}
module.exports={entries,claudeSources,html};
