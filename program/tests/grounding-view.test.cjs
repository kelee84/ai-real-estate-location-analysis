'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),grounding=require('../src/grounding-view.cjs');
test('Google attributions are collected without duplication from report and comparison research',()=>{const search={groundingMetadata:{searchEntryPoint:{renderedContent:'<div>Google 검색 참고</div>'}}};const r={aiGrounding:{webSearches:[search]},members:[{futureDevelopments:{webSearches:[search]}}]};assert.equal(grounding.entries(r).length,1);assert.ok(grounding.html(r).includes('<div>Google 검색 참고</div>'));});
test('attribution frame has a separate restrictive CSP and excludes unrelated model body',()=>{const r={sections:[{body:'Never inject into search frame'}],aiGrounding:{webSearches:[{groundingMetadata:{searchEntryPoint:{renderedContent:'<script>window.attack=true</script>'}}}]}};const html=grounding.html(r);assert.ok(html.includes("script-src 'none'"));assert.ok(html.includes("form-action 'none'"));assert.ok(html.includes("frame-src 'none'"));assert.ok(!html.includes('Never inject into search frame'));});
test('Claude citations appear as escaped source links outside the unchanged report template',()=>{
  const source={url:'https://example.gov/page?q=one&x=two',title:'공식 <자료>'},search={provider:'claude',sources:[source,{url:'javascript:alert(1)',title:'bad'}],citations:[source,{url:'https://user:pass@example.test',title:'bad'}]};
  const report={aiGrounding:{webSearches:[search]},members:[{futureDevelopments:{webSearches:[search]}}]};
  assert.equal(grounding.claudeSources(report).length,1);const html=grounding.html(report);
  assert.match(html,/Claude 검색 참고/);assert.match(html,/공식 &lt;자료&gt;/);assert.match(html,/q=one&amp;x=two/);assert.ok(!html.includes('javascript:'));assert.ok(!html.includes('user:pass'));
});
