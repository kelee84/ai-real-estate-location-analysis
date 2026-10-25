'use strict';
const fs=require('node:fs');const path=require('node:path');const crypto=require('node:crypto');
require('./prepare-brand.cjs')();
const root=path.resolve(__dirname,'../..'),resources=path.resolve(__dirname,'../resources');
fs.mkdirSync(resources,{recursive:true});
const dst=path.join(resources,'workspace');fs.mkdirSync(dst,{recursive:true});
for(const name of ['AGENTS.md','.agents'])fs.cpSync(path.join(root,name),path.join(dst,name),{recursive:true});
// 앱의 사용량은 표시 정보다. 제작 워크스페이스의 승인 정책은 고객 앱에 복사하지 않는다.
const appPolicy=path.join(dst,'AGENTS.md'),appInstructions=fs.readFileSync(appPolicy,'utf8').replace(/## 주간 사용량 확인[\s\S]*?(?=\n## )/,'## 프로그램 사용량 표시\n\n- 사용량은 참고 정보로 표시한다. 잔여율이나 사용량 조회 실패 때문에 승인 질문을 띄우거나 검색·분석을 중단하지 않는다.\n\n');fs.writeFileSync(appPolicy,appInstructions);
// 설정은 공개 MCP 주소만 포함한다. 사용자 홈, 계정, 사용량 승인, reports는 복사하지 않는다.
fs.mkdirSync(path.join(dst,'.codex'),{recursive:true});
for(const name of ['config.toml','PORTABILITY.md','real-estate-skills.lock.json','ui-skills.lock.json']){const p=path.join(root,'.codex',name);if(fs.existsSync(p))fs.copyFileSync(p,path.join(dst,'.codex',name));}
const nativeRoot=path.resolve(__dirname,'../node_modules/@openai/codex-win32-x64');
if(!fs.existsSync(nativeRoot))throw new Error('Windows x64 Codex 패키지가 없습니다. npm install을 실행해 주세요.');
fs.cpSync(nativeRoot,path.join(resources,'codex'),{recursive:true,filter:(src,dest)=>{if(fs.statSync(src).isDirectory()||!fs.existsSync(dest))return true;return !fs.readFileSync(src).equals(fs.readFileSync(dest));}});
const files=[];function scan(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name);if(e.isDirectory())scan(p);else if(p!==path.join(resources,'manifest.json'))files.push({path:path.relative(resources,p).replace(/\\/g,'/'),sha256:crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')});}}scan(resources);
fs.writeFileSync(path.join(resources,'manifest.json'),JSON.stringify({createdAt:new Date().toISOString(),files},null,2));
console.log(`배포 구성요소 ${files.length}개 준비. 로그인·개인 보고서는 포함하지 않았습니다.`);
