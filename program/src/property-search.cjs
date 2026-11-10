'use strict';
const {clean,normalizeInput,todayKst}=require('./core.cjs');
const {haversine}=require('./scoring.cjs');
const norm=s=>String(s||'').normalize('NFKC').replace(/\s/g,'');
const provinceKey=s=>norm(s).replace(/(?:특별자치시|특별자치도|특별시|광역시|시|도)$/,'');
function data(t){const r=t?.result;if(r?.structuredContent)return r.structuredContent;for(const c of r?.content||[])if(c.type==='text')try{return JSON.parse(c.text);}catch{}return null;}
function point(p){return Number.isFinite(p?.lat)&&Number.isFinite(p?.lng)&&p.lat>=25&&p.lat<=45&&p.lng>=120&&p.lng<=135;}
function hasRegion(target){return /^(?:서울|부산|대구|인천|광주|대전|울산|세종|(?:서울|부산|대구|인천|광주|대전|울산|세종)시|경기|강원|충북|충남|전북|전남|경북|경남|제주|\S+(?:특별시|광역시|특별자치시|특별자치도|도))\s/.test(String(target).trim());}
function candidates(d){
 const list=Array.isArray(d?.candidates)?d.candidates:d?.kapt_code&&d.basic?[{kapt_code:d.kapt_code,name:d.name,address:d.basic.address_jibun,address_road:d.basic.address_road}]:[];
 return [...new Map(list.filter(p=>/^[A-Za-z0-9]{5,30}$/.test(p.kapt_code||'')&&p.name&&(p.address||p.address_road)&&!/예정|모델하우스|분양홍보관/.test(p.name)).map(p=>[p.kapt_code,{id:p.kapt_code,name:clean(p.name,100),address:clean(p.address,400),road:clean(p.address_road,400),...(point(p)?{lat:p.lat,lng:p.lng}:{})}])).values()].slice(0,50);
}
function officialCandidates(raw,error){
 const region=error.region;if(!region?.code||!region.province?.name||!region.name)throw error;
 const list=(error.properties||[]).filter(p=>/^\d{1,20}$/.test(String(p.aprpnHsmpCode))&&p.aprpnHsmpNm&&p.townName).map(p=>{
  const address=[region.province.name,region.name,p.townName,p.mnnm].filter(Boolean).join(' '),coords={lat:Number(p.la),lng:Number(p.lo)};
  return {id:'rtms-'+p.aprpnHsmpCode,officialCode:String(p.aprpnHsmpCode),name:clean(p.aprpnHsmpNm,100),town:clean(p.townName,100),address,road:p.roadNm?[region.province.name,region.name,p.roadNm].join(' '):'',...(point(coords)?coords:{})};
 });
 if(!list.length)throw error;
 return {input:normalizeInput(raw),region,candidates:list,checkedAt:new Date().toISOString(),sourceName:'국토교통부 실거래가 공개시스템 단지 목록',reason:error.reason||''};
}
function officialChoice(saved,choice){
 if(!choice.officialCode||!saved.region?.province?.name||!saved.region?.name||!choice.town)throw Error('선택한 공식 단지의 지역·식별값을 확인하지 못했습니다. 다시 검색해 주세요.');
 return {target:choiceTarget(saved.region,choice.town,choice.name),building:choice.name,region:saved.region,expected:{...choice}};
}
function choiceTarget(region,town,name){return [region.province.name,region.name===region.province.name?'':region.name,town,name].filter(Boolean).join(' ');}
function completeLotAddress(address){
 const text=String(address||'').normalize('NFKC').trim();if(!hasRegion(text))return null;
 // Only an explicit legal neighborhood plus lot may replace address geocoding.
 // Road-only/partial addresses retain the established MCP resolution path.
 const match=text.match(/(?:^|\s)([가-힣0-9]+(?:동|읍|면|리))\s+((?:산\s*)?\d+(?:-\d+)?)(?:번지)?(?=\s|$)/);
 if(!match)return null;
 const prefix=text.slice(0,match.index).trim().split(/\s+/);if(prefix.length<2||!prefix.slice(1).every(s=>/^[가-힣0-9]+(?:시|군|구)$/.test(s)))return null;
 return {address:text,town:match[1],provinceText:prefix[0],regionText:prefix.slice(1).join(' ')};
}
async function savedNaver(raw,{naverStore,forceRefresh=false,signal}={}){
 const input=normalizeInput(raw);if(input.asset!=='apartment'||!naverStore||forceRefresh||raw.forceRefresh||input.asOf!==todayKst())return null;
 let saved=[];try{saved=await naverStore.list(input.asOf);}catch(error){if(signal?.aborted)throw error;}
 require('./search-errors.cjs').cancelled(signal);
 const list=require('./naver-land.cjs').candidates(input,saved);
 return list.length?{input,candidates:list,checkedAt:new Date().toISOString(),sourceName:'네이버 부동산 저장 단지정보',reason:'오늘 조회한 단지정보를 재사용했습니다. 단지를 선택하면 공식 실거래가 단지 목록에서 주소·면적을 다시 대조합니다.'}:null;
}
async function search(bridge,raw,{signal,client,naverStore,forceRefresh=false}={}){
 const input=normalizeInput(raw);if(input.asset!=='apartment')throw Error('주소 없이 단지명을 검색하는 기능은 아파트를 지원합니다. 다른 매물은 시·군·구와 주소를 입력해 주세요.');
 if(input.target.trim().length<2)throw Error('아파트명을 두 글자 이상 입력해 주세요.');
 if(signal?.aborted)throw Error('단지 검색을 중지했습니다.');
 const saved=await savedNaver(raw,{naverStore,forceRefresh,signal});if(saved)return saved;
 const session=await bridge.evidenceSession({signal}),t=await bridge.evidenceTool(session,'get_complex_info_by_query',{complex_query:input.target},{signal}),d=data(t),list=candidates(d);
 if(!list.length&&d?.error==='NOT_FOUND'&&client){
  const identity=require('./property-identity.cjs'),query=identity.requestedName(input).normalize('NFKC').trim(),withoutSuffix=query.replace(/\s*(?:아파트|apt)\s*$/i,'').trim();
  const broad=withoutSuffix.replace(/\s*\d+\s*(?:단지|차)\s*$/,'').trim();
  if(broad!==withoutSuffix&&broad.length>=3){
   const found=data(await bridge.evidenceTool(session,'get_complex_info_by_query',{complex_query:broad},{signal})),hints=candidates(found);
   if(!hints.length)throw Error(found?.message||d.message||'단지명에 시·군·구를 추가해 다시 검색해 주세요.');
   let region;const towns=new Set();
   for(const hint of hints){
    const address=hint.address||hint.road,resolved=await client.resolve(address,signal);
    if(region&&region.code!==resolved.code)throw Error('여러 지역에 비슷한 단지가 있습니다. 시·군·구를 추가해 검색해 주세요.');
    region=resolved;const town=address.match(/(?:^|\s)([가-힣0-9]+(?:동|읍|면|리))(?=\s|$)/)?.[1];if(town)towns.add(town);
   }
   // A combined K-apt complex only supplies a search area. Preserve the user's
   // phase and resolve its own official code; never reuse the parent address as identity.
   const officialInput={...input,target:[region.province.name,region.name,towns.size===1?[...towns][0]:'',query].filter(Boolean).join(' '),building:query};
   const reason='단지명이 검색 자료와 다르게 구분되어 있습니다. 공식 단지명과 주소를 확인해 선택해 주세요.';
   try{const resolved=await identity.resolveProperty(client,officialInput,signal,{region});return officialCandidates(input,{region,properties:[resolved.property],reason});}
   catch(error){if(error.code==='PROPERTY_AMBIGUOUS')return officialCandidates(input,{...error,reason});throw error;}
  }
 }
 if(!list.length)throw Error(d?.error==='DAILY_TOOL_LIMIT_EXCEEDED'?'입지 자료의 오늘 조회 한도에 도달했습니다. 내일 다시 사용 가능합니다.':d?.message||'단지명 후보를 찾지 못했습니다. 단지명에 지역명이나 차수를 추가해 검색해 주세요.');
 return {input,candidates:list,checkedAt:new Date().toISOString(),sourceName:'입지톡을 통한 K-apt 단지 검색'};
}
async function resolveChoice(bridge,client,choice,{signal}={}){
 if(choice.naverComplexNo){
  if(!/^\d{1,20}$/.test(String(choice.naverComplexNo))||choice.id!=='naver-'+choice.naverComplexNo||choice.officialCode||!choice.name||!choice.address)throw Error('선택한 네이버 단지의 식별값·주소를 확인하지 못했습니다. 다시 검색해 주세요.');
  if(signal?.aborted)throw Error('단지 검색을 중지했습니다.');
  const region=await require('./search-errors.cjs').retryRead(()=>client.resolve(choice.address,signal),signal),parts=require('./property-identity.cjs').addressParts(choice.address),town=parts.town;
  const expectedRegions=parts.regions.filter(s=>/(?:시|군|구)$/.test(s));
  if(!/^\d{5}$/.test(String(region?.code||''))||!region.province?.name||!region.name||!town||provinceKey(region.province.name)!==provinceKey(parts.province)||expectedRegions.length&&norm(region.name)!==norm(expectedRegions.join(' ')))throw Error('선택한 단지의 공식 주소·지역을 대조하지 못했습니다. 다른 후보를 선택하거나 주소를 추가해 주세요.');
  return {target:choiceTarget(region,town,choice.name),building:choice.name,region,expected:{...choice}};
 }
 const lotAddress=completeLotAddress(choice.address);
 if(lotAddress&&typeof client.resolve==='function'){
  if(signal?.aborted)throw Error('단지 검색을 중지했습니다.');
  const region=await client.resolve(lotAddress.address,signal);
  if(!/^\d{5}$/.test(String(region?.code||''))||!region.province?.name||!region.name||provinceKey(region.province.name)!==provinceKey(lotAddress.provinceText)||norm(region.name)!==norm(lotAddress.regionText))throw Error('선택한 단지의 공식 주소·지역을 대조하지 못했습니다. 다른 후보를 선택하거나 주소를 추가해 주세요.');
  // This resolves the search region only. discoverTypes/resolveProperty still
  // verifies the official name/phase, legal town, lot and available coordinates.
  return {target:[region.province.name,region.name,lotAddress.town,choice.name].join(' '),building:choice.name,region,expected:{...choice}};
 }
 const session=await bridge.evidenceSession({signal}),t=await bridge.evidenceTool(session,'get_region_code',{query:choice.road||choice.address},{signal}),d=data(t);
 if(t.result?.isError||!/^\d{5}$/.test(d?.sigungu_code||'')||!/^\d{10}$/.test(d?.full_code||'')||!point(d)||point(choice)&&haversine(choice,d)>300)throw Error('선택한 단지의 공식 주소·지역을 대조하지 못했습니다. 다른 후보를 선택하거나 주소를 추가해 주세요.');
 const provinces=await client.listProvinces(signal),province=provinces.find(p=>p.code.slice(0,2)===d.sigungu_code.slice(0,2));if(!province)throw Error('선택 단지의 시·도 코드를 공식 목록에서 찾지 못했습니다.');
 const region=(await client.listRegions(province.code,signal)).find(p=>p.code===d.sigungu_code);if(!region)throw Error('선택 단지의 시·군·구를 공식 목록에서 찾지 못했습니다.');
 const towns=JSON.parse((await client.request('/cmm/emdList.do',{code:region.code},signal)).toString()).emdList,town=towns?.find(p=>String(p.code)===d.full_code);if(!town)throw Error('선택 단지의 법정동을 공식 목록에서 찾지 못했습니다.');
 return {target:[province.name,region.name,town.codeNm,choice.name].join(' '),building:choice.name,region:{...region,province},expected:{...choice,lat:choice.lat??d.lat,lng:choice.lng??d.lng}};
}
module.exports={data,point,hasRegion,candidates,search,resolveChoice,officialCandidates,officialChoice,completeLotAddress,savedNaver};
