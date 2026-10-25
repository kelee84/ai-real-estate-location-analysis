'use strict';
const path=require('node:path'),{spawn}=require('node:child_process');
// Windows 사용자 계정에 직접 묶는다. Electron 프로필을 바꿔도 같은 소유자가 복호화할 수 있다.
function protect(bytes,decrypt=false){return new Promise((resolve,reject)=>{
  if(process.platform!=='win32')return reject(new Error('발급 키는 Windows에서만 사용할 수 있습니다.'));
  const method=decrypt?'Unprotect':'Protect',script=`$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Security; $taskBytes=[Convert]::FromBase64String([Console]::In.ReadToEnd()); $taskResult=[Security.Cryptography.ProtectedData]::${method}($taskBytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($taskResult))`;
  const p=spawn(path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe'),['-NoProfile','-NonInteractive','-WindowStyle','Hidden','-Command',script],{windowsHide:true,stdio:['pipe','pipe','pipe']});
  let output='',tooLarge=false;const timer=setTimeout(()=>p.kill(),15000);p.stdout.on('data',chunk=>{output+=chunk;if(output.length>65536){tooLarge=true;p.kill();}});p.stderr.resume();p.stdin.on('error',()=>{});
  p.on('error',()=>{clearTimeout(timer);reject(new Error('Windows 발급 키 암호화를 시작하지 못했습니다.'));});p.on('exit',code=>{clearTimeout(timer);if(code!==0||tooLarge||!output.trim())reject(new Error('발급 키를 열지 못했습니다. 발급기를 준비한 Windows 계정에서 실행해 주세요.'));else resolve(Buffer.from(output.trim(),'base64'));});p.stdin.end(Buffer.from(bytes).toString('base64'));
});}
module.exports={protect};
