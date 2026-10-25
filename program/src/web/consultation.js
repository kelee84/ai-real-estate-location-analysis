'use strict';

// Local-only consultation editing. Shared customer fields keep new and saved reports consistent.
window.ConsultationUI=(()=>{
  const get=id=>document.getElementById(id);
  const priorities=['교통 환경','교육 환경','상권 환경','자연환경','병원 환경','학원 환경'];
  let context,report=null,baseline='',officeDraft={},logoDataUrl='',logoRead=0,logoPending=false,saving=false,preview='detail';

  function customerFields(host,prefix){
    host.innerHTML=`<div class="field-row"><div><label for="${prefix}-purpose">상담 목적</label><select id="${prefix}-purpose"><option value="">아직 정하지 않음</option><option value="live">실거주 매수</option><option value="invest">투자 검토</option><option value="rent">전·월세 입주</option></select></div><div><label for="${prefix}-moveIn">입주 시기</label><input id="${prefix}-moveIn" maxlength="40" placeholder="예: 내년 3월 / 협의 가능"></div></div><div class="field-row"><div><label for="${prefix}-budgetType">예산 기준</label><select id="${prefix}-budgetType"><option value="trade">매매가격</option><option value="jeonse">전세보증금</option><option value="monthly">월세보증금</option></select></div><div><label id="${prefix}-budget-label" for="${prefix}-budget">예산 상한 (만원)</label><input id="${prefix}-budget" type="number" inputmode="decimal" min="0.01" max="1000000000" step="0.01" placeholder="예: 70000" aria-describedby="${prefix}-budget-hint"></div></div><p id="${prefix}-budget-hint" class="field-hint">매매가격 기준입니다. 모르면 비워 두세요.</p><fieldset class="customer-priorities"><legend>중요한 조건 <span class="optional">최대 2개</span></legend><div class="priority-options"></div></fieldset>`;
    const choices=host.querySelector('.priority-options');
    priorities.forEach((name,index)=>{
      const label=document.createElement('label'),box=document.createElement('input');
      box.type='checkbox';box.value=name;box.id=`${prefix}-priority-${index}`;
      label.append(box,document.createTextNode(name));choices.append(label);
      box.addEventListener('change',()=>{
        if(choices.querySelectorAll('input:checked').length>2){box.checked=false;context.toast('중요한 조건은 2개까지 선택해 주세요.',true);}
      });
    });
    get(`${prefix}-budgetType`).addEventListener('change',()=>budgetHint(prefix));
  }

  function budgetHint(prefix){
    const type=get(`${prefix}-budgetType`).value;
    get(`${prefix}-budget-label`).textContent=type==='monthly'?'보증금 예산 상한 (만원)':'예산 상한 (만원)';
    get(`${prefix}-budget-hint`).textContent=type==='monthly'?'월세는 보증금 예산입니다. 월 임대료는 별도로 확인합니다.':type==='jeonse'?'전세보증금 기준입니다. 모르면 비워 두세요.':'매매가격 기준입니다. 모르면 비워 두세요.';
  }

  function readCustomer(prefix='customer'){
    const value=get(`${prefix}-budget`).value;
    return {purpose:get(`${prefix}-purpose`).value,budgetManwon:value===''?null:Number(value),budgetType:get(`${prefix}-budgetType`).value,moveIn:get(`${prefix}-moveIn`).value.trim(),priorities:priorities.filter((_,i)=>get(`${prefix}-priority-${i}`).checked)};
  }

  function fillCustomer(value={},prefix='consultation'){
    get(`${prefix}-purpose`).value=value.purpose||'';
    get(`${prefix}-budget`).value=value.budgetManwon??'';
    get(`${prefix}-budgetType`).value=value.budgetType||'trade';
    get(`${prefix}-moveIn`).value=value.moveIn||'';
    priorities.forEach((name,i)=>{get(`${prefix}-priority-${i}`).checked=(value.priorities||[]).includes(name);});
    budgetHint(prefix);
  }

  function officeFrom(settings={}){
    const profile=settings.officeProfile||{};
    return {name:profile.name??settings.office??'',agent:profile.agent||'',phone:profile.phone||'',address:profile.address||'',logoDataUrl:profile.logoDataUrl||''};
  }

  function readOfficeProfile(){
    if(logoPending)throw Error('로고를 확인하고 있습니다. 잠시 뒤 설정을 저장해 주세요.');
    return {name:get('office').value.trim(),agent:get('office-agent').value.trim(),phone:get('office-phone').value.trim(),address:get('office-address').value.trim(),logoDataUrl};
  }

  function showLogo(){
    const safe=/^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/]+=*$/.test(logoDataUrl);
    get('office-logo-preview-row').classList.toggle('hidden',!safe);
    if(safe)get('office-logo-preview').src=logoDataUrl;else get('office-logo-preview').removeAttribute('src');
  }

  function fillSettings(settings={},force=false){
    if(get('settings-dialog').open&&!force)return;
    const profile=officeFrom(settings);
    for(const [key,id] of [['name','office'],['agent','office-agent'],['phone','office-phone'],['address','office-address']])get(id).value=profile[key];
    logoDataUrl=profile.logoDataUrl;logoRead++;logoPending=false;get('office-logo').value='';get('save-settings').disabled=false;showLogo();
  }

  async function chooseLogo(){
    const file=get('office-logo').files?.[0],read=++logoRead;
    if(!file)return;
    logoPending=true;get('save-settings').disabled=true;
    try{
      if(!['image/png','image/jpeg'].includes(file.type))throw Error('PNG 또는 JPEG 사진 파일을 선택해 주세요.');
      if(file.size>256*1024)throw Error('로고는 256KB 이하로 선택해 주세요.');
      const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(Error('파일을 읽지 못했습니다. 다른 사진을 선택해 주세요.'));reader.readAsDataURL(file);});
      await new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve();img.onerror=()=>reject(Error('사진을 열지 못했습니다. 올바른 PNG·JPEG 파일을 선택해 주세요.'));img.src=data;});
      if(read===logoRead){logoDataUrl=data;showLogo();}
    }catch(error){if(read===logoRead){get('office-logo').value='';context.toast(error.message,true);}}
    finally{if(read===logoRead){logoPending=false;get('save-settings').disabled=false;}}
  }

  function members(){
    const values=Array.isArray(report?.members)?report.members:report?.comparisonMembers;
    if(!Array.isArray(values))return [{key:'A',input:report?.input||{}}];
    const seen=new Set();return values.map((member,index)=>({...member,key:member?.key||String.fromCharCode(65+index)})).filter(member=>{if(!['A','B','C'].includes(member.key)||seen.has(member.key))return false;seen.add(member.key);return true;});
  }

  function readDraft(){
    return {customer:readCustomer('consultation'),officeProfile:{...officeDraft},properties:members().map((member,index)=>{
      const key=member.key||String.fromCharCode(65+index),node=get('consultation-property-'+index),value={key};
      for(const field of ['cautions','publicNote','privateNote','visitedAt'])value[field]=node.querySelector(`[data-note="${field}"]`).value.trim();
      return value;
    }),updatedAt:report?.consultation?.updatedAt??''};
  }

  function isDirty(){return !!report&&JSON.stringify(readDraft())!==baseline;}

  function updateDirty(){
    const dirty=isDirty();
    get('consultation-save-state').textContent=dirty?'저장 전':'';
    get('save-consultation').disabled=saving||!dirty;
    get('consultation-reset').disabled=saving||!dirty;
    get('consultation-status').textContent=dirty?'수정한 내용이 아직 저장되지 않았습니다.':'저장된 상담 내용입니다.';
  }

  function showOffice(){
    get('consultation-office-label').textContent=[officeDraft.name,officeDraft.agent,officeDraft.phone].filter(Boolean).join(' · ')||'업소정보 없음 · 사용 설정에서 등록할 수 있습니다.';
  }

  function showReport(next,{preservePreview=false}={}){
    report=next;
    const consultation=next.consultation||{};
    fillCustomer(consultation.customer||next.input.customer||{});
    officeDraft=officeFrom({office:next.input.office,officeProfile:consultation.officeProfile||next.input.officeProfile});
    showOffice();
    const host=get('consultation-properties');host.replaceChildren();
    members().forEach((member,index)=>{
      const key=member.key||String.fromCharCode(65+index),value=consultation.properties?.find(item=>item.key===key)||{},section=document.createElement('fieldset');
      section.id='consultation-property-'+index;section.className='consultation-property';
      const legend=document.createElement('legend');legend.textContent=`${key} · ${member.input?.building||member.input?.target||member.target||'매물'}`;section.append(legend);
      for(const [field,label,max,placeholder] of [
        ['cautions','고객에게 안내할 주의사항',600,'예: 통학구역은 교육청 확인 후 안내 예정'],
        ['publicNote','고객에게 전달할 현장 메모',1000,'직접 확인한 내용과 확인이 필요한 내용을 구분해 주세요.'],
      ]){
        const title=document.createElement('label'),area=document.createElement('textarea');area.id=`note-${index}-${field}`;title.htmlFor=area.id;title.textContent=label;
        area.dataset.note=field;area.maxLength=max;area.rows=2;area.placeholder=placeholder;area.value=value[field]||'';section.append(title,area);
      }
      const dateLabel=document.createElement('label'),date=document.createElement('input');date.id=`note-${index}-visitedAt`;date.type='date';date.dataset.note='visitedAt';date.max=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());date.value=value.visitedAt||'';dateLabel.htmlFor=date.id;dateLabel.textContent='현장 확인일';section.append(dateLabel,date);
      const privateDetails=document.createElement('details');privateDetails.className='private-notes';
      const summary=document.createElement('summary'),privateLabel=document.createElement('label'),privateArea=document.createElement('textarea'),hint=document.createElement('p');
      summary.textContent='내부 메모 · 고객용 파일에 포함 안 함';privateArea.id=`note-${index}-privateNote`;privateLabel.htmlFor=privateArea.id;privateLabel.textContent='내부 상담 메모';privateArea.dataset.note='privateNote';privateArea.maxLength=1000;privateArea.rows=2;privateArea.value=value.privateNote||'';privateArea.placeholder='사무소에서만 참고할 내용';hint.className='field-hint';hint.textContent='이 PC의 보고서와 전체 백업에 보관하며, 고객용 파일·전달문구·AI 분석에는 포함하지 않습니다.';privateDetails.append(summary,privateLabel,privateArea,hint);section.append(privateDetails);host.append(section);
    });
    baseline=JSON.stringify(readDraft());updateDirty();
    if(!preservePreview)preview='detail';
    setPreview(preview);
  }

  function canLeave(){
    if(saving){context.toast('상담 내용을 저장하고 있습니다. 잠시 기다려 주세요.');return false;}
    if(!isDirty())return true;
    if(!window.confirm('저장하지 않은 상담 내용이 있습니다. 변경 내용을 취소하고 이동할까요?'))return false;
    showReport(report,{preservePreview:true});return true;
  }

  function requireSaved(){
    if(!isDirty()&&!saving)return true;
    get('consultation-editor').open=true;
    context.toast(saving?'상담 내용을 저장하고 있습니다. 잠시 기다려 주세요.':'수정한 상담 내용을 먼저 저장해 주세요.',true);
    if(!saving)get('save-consultation').focus();return false;
  }

  function setPreview(mode){
    preview=mode==='summary'?'summary':'detail';
    for(const name of ['summary','detail']){
      get('preview-'+name).setAttribute('aria-pressed',String(preview===name));
      get(name+'-export-options').classList.toggle('hidden',preview!==name);
    }
    if(report){get('report-frame').src=`helper://${preview==='summary'?'summary':'report'}/${report.id}`;get('report-frame').title=preview==='summary'?'고객 요약 미리보기':'분석 보고서 미리보기';}
  }

  async function save(event){
    event.preventDefault();if(!report||saving||!isDirty())return;
    if(!get('consultation-form').reportValidity())return;
    const payload=readDraft(),id=report.id;saving=true;
    get('consultation-form').querySelectorAll('input,textarea,select,button').forEach(node=>{node.disabled=true;});
    get('save-consultation').textContent='저장 중…';
    try{await window.helper['save-consultation'](id,payload);await context.reload(id,{discard:true,preservePreview:true});context.toast('상담 내용을 저장했습니다. AI는 쓰지 않았습니다.');}
    catch(error){context.toast(error.message,true);}
    finally{saving=false;get('consultation-form').querySelectorAll('input,textarea,select,button').forEach(node=>{node.disabled=false;});get('save-consultation').textContent='상담 내용 저장';updateDirty();}
  }

  async function summaryAction(buttonId,action){
    const button=get(buttonId);if(!report||button.disabled||!requireSaved())return;
    button.disabled=true;button.setAttribute('aria-busy','true');
    try{const result=await action(report.id);if(result!==null)context.toast(result?.note||'전달문구를 복사했습니다.');}
    catch(error){context.toast(error.message,true);}
    finally{button.disabled=false;button.removeAttribute('aria-busy');}
  }

  function init(options){
    context=options;customerFields(get('customer-fields'),'customer');customerFields(get('consultation-customer-fields'),'consultation');
    for(const id of ['analysis-form','consultation-form','settings-form'])get(id).addEventListener('invalid',event=>{const details=event.target.closest('details');if(details)details.open=true;},true);
    get('consultation-form').addEventListener('input',updateDirty);get('consultation-form').addEventListener('change',updateDirty);get('consultation-form').addEventListener('submit',save);
    get('consultation-reset').addEventListener('click',()=>{if(!saving&&canLeave())context.toast('저장된 상담 내용으로 되돌렸습니다.');});
    get('apply-office').addEventListener('click',()=>{officeDraft=officeFrom(context.getSettings());showOffice();updateDirty();});
    get('office-logo').addEventListener('change',chooseLogo);
    get('remove-office-logo').addEventListener('click',()=>{logoRead++;logoPending=false;logoDataUrl='';get('office-logo').value='';get('save-settings').disabled=false;showLogo();});
    get('preview-summary').addEventListener('click',()=>{if(requireSaved())setPreview('summary');});get('preview-detail').addEventListener('click',()=>{if(requireSaved())setPreview('detail');});
    get('export-summary').addEventListener('click',()=>summaryAction('export-summary',id=>window.helper['export-summary'](id,get('summary-format').value)));
    get('copy-summary').addEventListener('click',()=>summaryAction('copy-summary',id=>window.helper['copy-summary'](id)));
    window.addEventListener('beforeunload',event=>{if(!isDirty()&&!saving)return;if(!saving&&window.confirm('저장하지 않은 상담 내용이 있습니다. 변경 내용을 취소하고 닫을까요?'))return;event.preventDefault();event.returnValue='';});
  }

  return {init,readCustomer,readOfficeProfile,fillSettings,showReport,canLeave,requireSaved,isDirty};
})();
