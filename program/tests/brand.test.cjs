'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const brand=require('../src/brand.cjs');
const fs=require('node:fs'),path=require('node:path'),theme=require('../src/brand-theme.cjs');
test('AI SHERPA 영상의 브랜드 색·로고와 GUI 테마가 배포 원본에 일치함',()=>{
 assert.equal(theme.colors.navy,'#182B3D');assert.equal(theme.colors.cream,'#F7F1E1');assert.equal(theme.colors.coral,'#F4715B');
 assert.equal(fs.readFileSync(path.join(__dirname,'../src/web/brand.css'),'utf8'),theme.screenCss());
 assert.equal(theme.logoPng().subarray(0,8).toString('hex'),'89504e470d0a1a0a');
 assert.match(theme.reportHeader(),/data:image\/png;base64,/);
 const screen=fs.readFileSync(path.join(__dirname,'../src/web/index.html'),'utf8');assert.match(screen,/brand\.css/);assert.match(screen,/sherpa-logo\.svg/);
});
test('주요 버튼·본문·안내·선택과 키보드 포커스가 읽을 수 있는 대비를 유지함',()=>{
 const luminance=hex=>hex.slice(1).match(/../g).map(x=>parseInt(x,16)/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4).reduce((a,x,i)=>a+x*[.2126,.7152,.0722][i],0);
 const contrast=(a,b)=>{const pair=[luminance(a),luminance(b)].sort((a,b)=>b-a);return (pair[0]+.05)/(pair[1]+.05);};
 for(const [fg,bg]of [['navy','coral'],['navy','coralHover'],['ink','paper'],['muted','paper'],['muted','cream'],['navy','paleBlue'],['blueDark','paper'],['lightBlue','navy'],['danger','dangerBg'],['warning','warningBg']])assert.ok(contrast(theme.colors[fg],theme.colors[bg])>=4.5,fg+' on '+bg);
 assert.ok(contrast(theme.colors.focus,theme.colors.paper)>=3);
});
test('문의와 홍보영상은 지정한 공개 링크만 허용하고 임의 주소·전화번호는 받지 않음',()=>{
  const email=new URL(brand.supportTarget('email'));assert.equal(email.protocol,'mailto:');assert.equal(email.pathname,'aisherpa01@gmail.com');assert.ok(email.searchParams.get('subject').includes('v'+brand.VERSION));
  assert.equal(brand.supportTarget('instagram'),'https://www.instagram.com/aisherpa_01/');
  assert.equal(brand.supportTarget('promo'),'https://www.instagram.com/p/Dexcr7WH2qR/');
  assert.equal(brand.info().promoVideoUrl,brand.supportTarget('promo'));
  assert.equal(brand.PROMO_VIDEO_URL,brand.supportTarget('promo'));
  for(const x of ['phone','https://other.example/','email?to=other@example.com',null])assert.throws(()=>brand.supportTarget(x));
  assert.equal(brand.info().name,'AI SHERPA');assert.equal(brand.info().version,require('../package.json').version);assert.equal(Object.keys(brand.info()).some(k=>/phone|tel/i.test(k)),false);
});
test('기본 제작·보고서 표기는 개인 이름 없이 AI SHERPA를 사용함',()=>{
 const info=brand.info();
 assert.equal(info.makerLine,`AI SHERPA 제작 · v${brand.VERSION}`);
 assert.equal(info.reportCredit,`AI SHERPA ${brand.PRODUCT}로 작성`);
 assert.equal(require('../package.json').author,'AI SHERPA');
 const provenance=JSON.parse(fs.readFileSync(path.join(__dirname,'../assets/brand-provenance.json'),'utf8'));
 assert.equal(provenance.publicAttribution.maker,'AI SHERPA');
 assert.equal(provenance.promoVideoUrl,brand.PROMO_VIDEO_URL);
});
test('customer branding, window, help and current installation guide omit test-version labels',()=>{
 const fs=require('node:fs'),path=require('node:path'),root=path.resolve(__dirname,'../..');
 assert.doesNotMatch(brand.info().makerLine,/테스트\s*버전/);
 for(const file of ['program/src/main.cjs','program/src/web/app.js','사용법.txt'])assert.doesNotMatch(fs.readFileSync(path.join(root,file),'utf8'),/테스트\s*버전|테스트\s*배포/);
 assert.match(fs.readFileSync(path.join(root,'사용법.txt'),'utf8'),new RegExp(brand.VERSION.replaceAll('.','\\.')));
});
