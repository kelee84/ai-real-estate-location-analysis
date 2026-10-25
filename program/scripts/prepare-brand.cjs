'use strict';
const fs=require('node:fs'),path=require('node:path');
function prepare(){const file=path.resolve(__dirname,'../src/web/brand.css'),css=require('../src/brand-theme.cjs').screenCss();if(!fs.existsSync(file)||fs.readFileSync(file,'utf8')!==css)fs.writeFileSync(file,css);}
if(require.main===module)prepare();
module.exports=prepare;
