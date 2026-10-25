'use strict';
let comparisonDraft=[{},{}];
function comparisonInput(allowEmpty=false){return [...document.querySelectorAll('.comparison-property')].map(node=>{const reportId=node.querySelector('[data-field=reportId]').value;if(reportId)return {reportId};typePickers.get('property-'+node.dataset.key)?.reconcile();return {...Object.fromEntries([...node.querySelectorAll('[data-field]')].filter(e=>e.dataset.field!=='reportId').map(e=>[e.dataset.field,e.value])),...readTypeSelection('property-'+node.dataset.key,allowEmpty)};});}
function refreshComparisonReports(){
  for(const select of document.querySelectorAll('[data-field=reportId]')){const old=select.value;select.replaceChildren(new Option('새 매물 입력',''));for(const r of state.reports.filter(r=>!r.demo&&r.mode!=='comparison'))select.add(new Option(`${r.target} · ${r.area==null?'면적 미입력':r.area+'㎡'} · 기준일 ${r.asOf||'미확인'}`,r.id));select.value=old;}
}
function updateComparisonMode(){
  const compare=document.querySelector('[name=analysisMode]:checked').value==='comparison';
  $('single-fields').classList.toggle('hidden',compare);$('comparison-fields').classList.toggle('hidden',!compare);
  for(const id of ['target','asset','area','offered','building']){const control=$(id);control.disabled=compare||state.busy;if(['offered','building'].includes(id)){control.classList.toggle('hidden',compare);for(const label of control.labels)label.classList.toggle('hidden',compare);}}
  for(const node of document.querySelectorAll('.comparison-property')){const old=!!node.querySelector('[data-field=reportId]').value;node.querySelector('.property-new').classList.toggle('hidden',old);node.querySelector('.reuse-note').classList.toggle('hidden',!old);node.querySelectorAll('[data-field]').forEach(e=>{e.disabled=!compare||state.busy||(old&&e.dataset.field!=='reportId');});}
  $('add-property').disabled=state.busy||comparisonDraft.length>=3;$('add-property').classList.toggle('hidden',comparisonDraft.length>=3);$('comparison-count').textContent=`${comparisonDraft.length}개 매물 등록 · 최대 3개`;
  $('generate').querySelector('span').textContent=compare?'통합 비교 보고서 만들기':'분석 보고서 만들기';if(typeof syncTypePickers==='function')syncTypePickers();
}
function renderComparisonProperties(){
  const host=$('comparison-properties');host.replaceChildren();
  comparisonDraft.forEach((draft,index)=>{const key=String.fromCharCode(65+index),fieldset=document.createElement('fieldset');fieldset.className='comparison-property';fieldset.dataset.key=key;
    fieldset.innerHTML=`<legend>매물 ${key}</legend><label for="property-${key}-report">분석 자료</label><select id="property-${key}-report" data-field="reportId"></select><p class="reuse-note field-hint hidden">선택한 보고서의 면적·거래 유형·기준일을 그대로 사용합니다. 공통 날짜와 다르면 보고서에 차이를 표시합니다. ‘새 자료로 다시 조회’를 선택하면 공통 날짜·거래 유형으로 갱신합니다.</p><div class="property-new"><label for="property-${key}-target">단지·건물명 또는 주소 <span class="required">필수</span></label><input id="property-${key}-target" data-field="target" required maxlength="400" placeholder="예: 베르디움더퍼스트"><div class="field-row"><div><label for="property-${key}-asset">매물 종류</label><select id="property-${key}-asset" data-field="asset"><option value="apartment">아파트</option><option value="officetel">오피스텔</option><option value="villa">연립·다세대</option><option value="single-house">단독·다가구</option><option value="commercial">상가</option></select></div><div><label for="property-${key}-area">전용면적·타입 (㎡)</label><input id="property-${key}-area" data-field="area" maxlength="30" placeholder="예: 84 또는 84.81"></div></div><p class="field-hint">정수 타입의 유효 거래가 없으면 같은 단지의 가까운 타입을 적용합니다. 소수 면적은 정확히 일치하는 거래만 조회합니다.</p><div class="field-row"><div><label for="property-${key}-offered">제시가격 (만원)</label><input id="property-${key}-offered" data-field="offered" type="number" min="0" placeholder="선택"></div><div><label for="property-${key}-building">정확한 단지·건물명</label><input id="property-${key}-building" data-field="building" maxlength="100" placeholder="선택"></div></div></div>`;
    host.append(fieldset);for(const control of fieldset.querySelectorAll('[data-field]'))if(control.dataset.field!=='reportId')control.value=draft[control.dataset.field]??(control.dataset.field==='asset'?'apartment':'');
    registerTypePicker('property-'+key,fieldset.querySelector('.property-new'),()=>({...Object.fromEntries([...fieldset.querySelectorAll('[data-field]')].map(e=>[e.dataset.field,e.value])),asOf:$('asOf').value,forceRefresh:$('force-refresh').checked}),fieldset.querySelector('[data-field=area]'),draft);
    if(index===2){const remove=document.createElement('button');remove.type='button';remove.className='text-button';remove.textContent='매물 C 제거';remove.addEventListener('click',()=>{comparisonDraft=comparisonInput(true).slice(0,2);renderComparisonProperties();});fieldset.append(remove);}
  });
  refreshComparisonReports();[...host.querySelectorAll('[data-field=reportId]')].forEach((select,i)=>{select.value=comparisonDraft[i].reportId||'';select.addEventListener('change',()=>{updateComparisonMode();});});updateComparisonMode();
}
document.querySelectorAll('[name=analysisMode]').forEach(e=>e.addEventListener('change',updateComparisonMode));
$('add-property').addEventListener('click',()=>{if(comparisonDraft.length>=3)return;comparisonDraft=comparisonInput(true);comparisonDraft.push({});renderComparisonProperties();$('property-C-report').focus();});
renderComparisonProperties();

