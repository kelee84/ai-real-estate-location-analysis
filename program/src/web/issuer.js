'use strict';
const $=id=>document.getElementById(id),api=window.helper;
let ready=false,checking=false,issuing=false;
function sync(){
  $('issue-button').disabled=!ready||checking||issuing;
  $('issuer-retry').disabled=checking||issuing;
  $('issuer-retry').classList.toggle('hidden',ready||checking);
  $('issue-form').setAttribute('aria-busy',String(checking||issuing));
}
async function checkIssuer(){
  if(checking||issuing)return;
  checking=true;ready=false;$('issuer-status').textContent='발급 권한을 확인하고 있습니다.';sync();
  try{await api['issuer-status']();ready=true;$('issuer-status').textContent='발급할 수 있는 PC입니다.';}
  catch(e){$('issuer-status').textContent=e.message;}
  finally{checking=false;sync();}
}
$('issuer-retry').addEventListener('click',checkIssuer);
window.addEventListener('focus',()=>{if(!ready)checkIssuer();});
checkIssuer();
$('issue-form').addEventListener('submit',async e=>{
  e.preventDefault();if(!ready||checking||issuing)return;
  $('issuer-message').textContent='';issuing=true;$('issue-result').classList.add('hidden');sync();
  try{const result=await api.issue($('issue-request').value);$('issued-code').value=result.code;$('issue-result').classList.remove('hidden');$('copy-issued').textContent='인증번호 복사';}
  catch(e){$('issuer-message').textContent=e.message;if(e.gate==='issuer'){ready=false;$('issuer-status').textContent=e.message;}}
  finally{issuing=false;sync();}
});
$('issue-request').addEventListener('input',()=>$('issue-result').classList.add('hidden'));
$('copy-issued').addEventListener('click',async()=>{try{await api['copy-code']();$('copy-issued').textContent='복사했습니다';}catch(e){$('issuer-message').textContent=e.message;}});
