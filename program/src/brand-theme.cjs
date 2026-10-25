'use strict';
const fs=require('node:fs'),path=require('node:path');
const palette=require('./brand-theme.json');
const colors=Object.freeze({...palette,border:palette.line,surface:palette.soft});
const hex=Object.freeze(Object.fromEntries(Object.entries(colors).map(([key,value])=>[key,value.slice(1)])));
const logoPng=()=>fs.readFileSync(path.join(__dirname,'web/assets/sherpa-logo.png'));
let dataUri;
function logoDataUri(){return dataUri||(dataUri='data:image/png;base64,'+logoPng().toString('base64'));}
function reportHeader(){return `<div class="sherpa-maker" aria-label="AI SHERPA 제작 프로그램"><img src="${logoDataUri()}" alt=""><span><b>AI</b> SHERPA</span></div>`;}
const reportCss=`.sherpa-maker{display:flex;align-items:center;gap:8px;margin:0 0 16px;padding-bottom:10px;border-bottom:1px solid ${colors.line};color:${colors.navy};font-family:'Malgun Gothic','맑은 고딕',sans-serif;font-size:12px;font-weight:700;line-height:1.3;letter-spacing:.04em;break-inside:avoid}.sherpa-maker img{width:32px;height:18px;object-fit:contain;border:0}.sherpa-maker b{color:${colors.blueDark};font-weight:700}@media print{.sherpa-maker{margin-bottom:12px;padding-bottom:8px;font-size:10px}.sherpa-maker img{width:28px;height:16px}}`;
function screenCss(){
 const names={navy:'navy',deep:'navy-deep',ink:'ink',cream:'ground',paper:'paper',blue:'blue',blueDark:'accent',lightBlue:'light-blue',coral:'coral',paleBlue:'nav-active',muted:'muted',line:'line',field:'field-border',soft:'soft',softHover:'soft-hover',selected:'selected',selectedLine:'selected-border',selectedInk:'selected-ink',coralHover:'coral-hover',coralInk:'coral-ink',focus:'focus',success:'success',successBg:'success-bg',warning:'warn',warningBg:'warn-bg',danger:'danger',dangerBg:'danger-bg'};
 const values=Object.entries(names).map(([key,name])=>`--${name}:${colors[key]}`);
 values.push(`--nav-hover:#24445F`,`--nav-active-ink:${colors.navy}`,`--secondary-border:${colors.field}`,`--secondary-hover:${colors.soft}`,'--radius:12px','--shadow:0 12px 36px #182B3D14','--ease:cubic-bezier(.16,1,.3,1)');
 return `/* Generated from brand-theme.json by prepare-brand.cjs. */\n@font-face{font-family:Manrope;src:url('assets/fonts/Manrope.ttf') format('truetype');font-weight:200 800;font-style:normal;font-display:swap}\n:root{${values.join(';')}}\n`;
}
module.exports={colors,hex,logoPng,logoDataUri,reportHeader,reportCss,screenCss};
