'use strict';
function normalizeAiSettings(settings={}){
  const provider=['gemini','claude'].includes(settings.provider)?settings.provider:'gpt';
  const model=String(settings.model||'').slice(0,100);
  const modelsByProvider=Object.fromEntries(['gpt','gemini','claude'].map(name=>[name,String(settings.modelsByProvider?.[name]||'').slice(0,100)]));
  if(model)modelsByProvider[provider]=model;
  return {office:settings.office||'',officeProfile:settings.officeProfile,provider,model,modelsByProvider};
}
function updateAiSettings(current={},change={}){
  const saved=normalizeAiSettings(current),provider=change.provider??saved.provider;
  if(!['gpt','gemini','claude'].includes(provider))throw new Error('GPT, Gemini, Claude 중에서 선택해 주세요.');
  saved.modelsByProvider[saved.provider]=saved.model;
  const model=String(change.model??(provider===saved.provider?saved.model:saved.modelsByProvider[provider])??'').trim();
  if(model&&(!/^[A-Za-z0-9_.:-]+$/.test(model)||model.length>100))throw new Error('사용할 AI 모델을 목록에서 선택해 주세요.');
  saved.modelsByProvider[provider]=model;
  return {provider,model,modelsByProvider:saved.modelsByProvider};
}
module.exports={normalizeAiSettings,updateAiSettings};
