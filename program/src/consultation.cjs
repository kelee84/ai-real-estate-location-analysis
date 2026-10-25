'use strict';

const LIMITS=Object.freeze({moveIn:40,priorities:2,cautions:600,note:1000,officeName:100,agent:60,phone:40,address:200,logoBytes:256*1024});
const {SCORE_ITEMS:PRIORITIES}=require('./core.cjs');
const object=value=>value&&typeof value==='object'&&!Array.isArray(value)?value:{};
const own=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
function text(value,max,label,strict=false){
  const result=typeof value==='string'?value.replace(/\u0000/g,'').trim():'';
  if(strict&&result.length>max)throw new Error(`${label}은 ${max}자 이내로 입력해 주세요.`);
  return result.slice(0,max);
}
function normalizeCustomer(value={}, {strict=false}={}){
  const x=object(value),purpose=['live','invest','rent'].includes(x.purpose)?x.purpose:'',budgetType=['trade','jeonse','monthly'].includes(x.budgetType)?x.budgetType:'trade';
  const raw=x.budgetManwon,empty=raw===null||raw===undefined||raw==='',number=typeof raw==='number'?raw:typeof raw==='string'&&/^\d+(?:\.\d{1,2})?$/.test(raw.replace(/,/g,''))?Number(raw.replace(/,/g,'')):NaN;
  const valid=Number.isFinite(number)&&number>0&&number<=1000000000;
  if(strict&&!empty&&!valid)throw new Error('예산은 만원 단위의 0보다 큰 숫자로 입력해 주세요.');
  const priorities=[...new Set((Array.isArray(x.priorities)?x.priorities:[]).filter(p=>PRIORITIES.includes(p)))];
  if(strict&&priorities.length>LIMITS.priorities)throw new Error('중요한 조건은 2개까지 선택해 주세요.');
  return {purpose,budgetManwon:valid?number:null,budgetType,moveIn:text(x.moveIn,LIMITS.moveIn,'입주 시기',strict),priorities:priorities.slice(0,LIMITS.priorities)};
}
function logo(value,strict){
  if(!value)return '';
  const fail=()=>{if(strict)throw new Error('로고는 256KB 이하의 PNG 또는 JPEG 이미지로 선택해 주세요.');return '';};
  if(typeof value!=='string'||value.length>Math.ceil(LIMITS.logoBytes/3)*4+40)return fail();
  const match=value.match(/^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/);if(!match||match[2].length%4)return fail();
  const bytes=Buffer.from(match[2],'base64');
  if(bytes.length>LIMITS.logoBytes||bytes.toString('base64')!==match[2])return fail();
  const valid=match[1]==='png'?bytes.length>=24&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))&&bytes.toString('ascii',12,16)==='IHDR':bytes.length>=4&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255&&bytes.at(-2)===255&&bytes.at(-1)===217;
  return valid?value:fail();
}
function normalizeOfficeProfile(value={},legacyOffice='',{strict=false}={}){
  const x=object(value);
  return {name:text(own(x,'name')?x.name:legacyOffice,LIMITS.officeName,'사무소명',strict),agent:text(x.agent,LIMITS.agent,'담당자',strict),phone:text(x.phone,LIMITS.phone,'연락처',strict),address:text(x.address,LIMITS.address,'업소 주소',strict),logoDataUrl:logo(x.logoDataUrl,strict)};
}
function propertyKeys(report){
  const members=Array.isArray(report?.members)?report.members:report?.comparisonMembers;
  if(report?.mode!=='comparison'&&!Array.isArray(members))return ['A'];
  return [...new Set((Array.isArray(members)?members:[]).map((m,i)=>m?.key||String.fromCharCode(65+i)).filter(k=>['A','B','C'].includes(k)))];
}
function normalizeProperty(value,key,{strict=false}={}){
  const x=object(value),date=text(x.visitedAt,10,'현장 확인일',strict);
  const valid=!date||/^\d{4}-\d{2}-\d{2}$/.test(date)&&Number.isFinite(Date.parse(date+'T00:00:00Z'))&&new Date(date+'T00:00:00Z').toISOString().slice(0,10)===date&&date<=require('./core.cjs').todayKst();
  if(strict&&!valid)throw new Error('현장 확인일은 오늘 또는 이전의 올바른 날짜로 입력해 주세요.');
  return {key,cautions:text(x.cautions,LIMITS.cautions,'주의사항',strict),publicNote:text(x.publicNote,LIMITS.note,'고객 전달 메모',strict),privateNote:text(x.privateNote,LIMITS.note,'내부 메모',strict),visitedAt:valid?date:''};
}
function getConsultation(report){
  const saved=object(report?.consultation),input=object(report?.input),properties=Array.isArray(saved.properties)?saved.properties:[];
  return {customer:normalizeCustomer(saved.customer??input.customer),officeProfile:normalizeOfficeProfile(saved.officeProfile??input.officeProfile,input.office),properties:propertyKeys(report).map(key=>normalizeProperty(properties.find(p=>p?.key===key),key)),updatedAt:text(saved.updatedAt,40,'수정 시각')};
}
function publicConsultation(report){
  const value=getConsultation(report);return {...value,properties:value.properties.map(({privateNote,...property})=>property)};
}
function updateConsultation(report,payload={}){
  const x=object(payload),current=getConsultation(report),allowed=new Set(propertyKeys(report));
  if(own(x,'updatedAt')&&x.updatedAt!==current.updatedAt)throw new Error('다른 저장 내용이 있습니다. 보고서를 다시 열고 수정해 주세요.');
  if(own(x,'properties')&&!Array.isArray(x.properties))throw new Error('매물별 메모를 확인해 주세요.');
  const patches=x.properties||[],seen=new Set();
  for(const p of patches){if(!p||!allowed.has(p.key)||seen.has(p.key))throw new Error('보고서에 있는 매물의 메모만 저장할 수 있습니다.');seen.add(p.key);}
  const customer=own(x,'customer')?normalizeCustomer({...current.customer,...object(x.customer)},{strict:true}):current.customer;
  const officeProfile=own(x,'officeProfile')?normalizeOfficeProfile({...current.officeProfile,...object(x.officeProfile)},'',{strict:true}):current.officeProfile;
  const properties=current.properties.map(p=>normalizeProperty({...p,...object(patches.find(patch=>patch.key===p.key))},p.key,{strict:true}));
  const priorTime=Date.parse(current.updatedAt),updatedAt=new Date(Math.max(Date.now(),Number.isFinite(priorTime)?priorTime+1:0)).toISOString();
  return {...report,input:{...report.input,customer,office:officeProfile.name,officeProfile},consultation:{customer,officeProfile,properties,updatedAt},requestFingerprint:null};
}
module.exports={LIMITS,PRIORITIES,normalizeCustomer,normalizeOfficeProfile,propertyKeys,getConsultation,publicConsultation,updateConsultation};
