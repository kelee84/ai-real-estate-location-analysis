'use strict';
const norm=s=>String(s??'').normalize('NFKC').replace(/[\s()（）·-]/g,'').toLowerCase();
const BLOCK=/D?\s*(\d+)\s*[-－–]\s*(\d+)\s*(?:BLOCK|BL|블럭|블록)(?![a-z0-9])/gi;
const blocks=s=>[...String(s??'').normalize('NFKC').matchAll(BLOCK)].map(m=>Number(m[1])+'_'+Number(m[2]));
const nameKey=s=>norm(String(s??'').normalize('NFKC').replace(BLOCK,(_m,a,b)=>'block'+Number(a)+'_'+Number(b)));
const phases=s=>[...norm(s).matchAll(/(\d+)(차|단지)/g)].map(m=>Number(m[1])+m[2]);
function confirmationNameParts(value){
 const name=nameKey(value).replace(/(?:아파트|apt)$/,'').replace(/제(?=\d+(?:차|단지))/g,''),phase=phases(name);
 return {name,phase,stem:name.replace(/\d+(?:차|단지)/g,''),terminal:phase.length?null:name.match(/^(.*\D)(\d+)$/)};
}
function terminalPhaseMatch(x,y){
 for(const [explicit,implicit]of [[x,y],[y,x]])if(explicit.phase.length===1&&implicit.terminal&&Number(explicit.phase[0].match(/^\d+/)[0])===Number(implicit.terminal[2])&&compatibleName(explicit.stem,implicit.terminal[1]))return true;
 return false;
}
function identityConflict(a,b){
 if([phases,blocks].some(pick=>{const x=[...new Set(pick(a))].sort(),y=[...new Set(pick(b))].sort();return x.length&&y.length&&JSON.stringify(x)!==JSON.stringify(y);}))return true;
 // Official names may omit 차/단지. A matching address must not turn 3차
 // into the register's terminal 2, including the coordinate fallback.
 const x=confirmationNameParts(a),y=confirmationNameParts(b);
 for(const [explicit,implicit]of [[x,y],[y,x]])if(explicit.phase.length===1&&implicit.terminal&&compatibleName(explicit.stem,implicit.terminal[1])&&Number(explicit.phase[0].match(/^\d+/)[0])!==Number(implicit.terminal[2]))return true;
 return false;
}
// Formatting aliases propose a candidate for address confirmation; they do
// not relax the general name matcher used to filter transaction contracts.
function confirmationNameMatch(a,b){
 if(identityConflict(a,b))return false;
 const x=confirmationNameParts(a),y=confirmationNameParts(b);
 if(compatibleName(x.name,y.name))return true;
 if(x.phase.length===1&&y.phase.length===1)return x.phase[0]===y.phase[0]&&compatibleName(x.stem,y.stem);
 return terminalPhaseMatch(x,y);
}
function roadKey(s){const m=String(s||'').normalize('NFKC').match(/(?:^|\s)([가-힣a-zA-Z0-9·.]+(?:대로|로|길))\s*(\d+(?:-\d+)?)(?=\s|$|[,（(])/);return m?norm(m[1])+' '+m[2].split('-').map(n=>String(Number(n))).join('-'):'';}
const PROVINCE=/^(?:서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주|.+(?:특별시|광역시|특별자치시|특별자치도|도))$/;
const {failure,jsonRequest,retryRead}=require('./search-errors.cjs');
function addressParts(target){
 const text=String(target||'').normalize('NFKC').replace(/[(),]/g,' ').trim().replace(/\s+/g,' '),parts=text.split(' ');
 const province=PROVINCE.test(parts[0])||/^(?:서울|부산|대구|인천|광주|대전|울산|세종)시$/.test(parts[0])?parts.shift():'';
 const regions=[];while(parts.length&&/^[가-힣0-9]+(?:시|군|구|동|읍|면|리|가)$/.test(parts[0]))regions.push(parts.shift());
 const town=[...regions].reverse().find(s=>/(?:동|읍|면|리|가)$/.test(s))||'';
 let lot='',road='';
 if(town&&/^(?:산)?\d+(?:-\d+)?(?:번지)?$/.test(parts[0]||''))lot=lotKey(parts.shift());
 else if(town&&parts[0]==='산'&&/^\d+(?:-\d+)?$/.test(parts[1]||'')){parts.shift();lot='산'+lotKey(parts.shift());}
 else {const m=parts.join(' ').match(/^([가-힣a-zA-Z0-9·.]+(?:대로|로|길))\s*(\d+(?:-\d+)?)(?=\s|$)/);if(m){road=roadKey(m[0]);parts.splice(0,parts.join(' ').slice(0,m[0].length).trim().split(' ').length);}}
 return {province,regions,town,lot,road,name:parts.join(' ')};
}
function requestedName(input){
  assertPropertyInput(input);
  if(String(input.building||'').trim())return String(input.building).trim();
  return addressParts(input.target).name;
}
function assertPropertyInput(input){
  const target=norm(input.target),building=norm(input.building);
  if(!target||!building)return;
  if(identityConflict(input.target,input.building)){const error=new Error('입력한 단지·주소와 추가 입력의 정확한 단지명이 서로 다른 차수·블록입니다. 정확한 단지명을 지우거나 같은 단지로 수정한 뒤 다시 검색해 주세요.');error.code='PROPERTY_INPUT_CONFLICT';throw error;}
}
function compatibleName(query,name){
  const q=nameKey(query),n=nameKey(name);if(q===n)return true;
  if(Math.min(q.length,n.length)<3)return false;
  const short=q.length<=n.length?q:n,long=q.length<=n.length?n:q,index=long.indexOf(short);
  if(index<0)return false;
  const tail=long.slice(index+short.length),rawLong=q.length<=n.length?String(name):String(query);
  const annotation=rawLong.match(/[（(]([^（）()]*)[）)]\s*$/);
  if(tail&&!/^(?:아파트|apt)$/.test(tail)&&!/^\d+(?:차|단지)(?:아파트|apt)?$/.test(tail)&&!/^block\d+_\d+(?:아파트|apt)?$/.test(tail)&&(!annotation||nameKey(annotation[1])!==tail))return false;
  // 1차를 11차로, 17-1블록을 18-1블록으로 잘못 연결하지 않는다.
  if(/^\d/.test(short)&&/\d/.test(long[index-1]||''))return false;
  if(/\d$/.test(short)&&/\d/.test(long[index+short.length]||''))return false;
  const phases=s=>[...s.matchAll(/(\d+)(?:차|단지)/g)].map(m=>m[0]);
  const a=phases(q),b=phases(n);if(a.length&&b.length&&JSON.stringify(a)!==JSON.stringify(b))return false;
  return true;
}
const escapeRegex=s=>String(s).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const lotKey=s=>String(s||'').replace(/번지|\s/g,'').replace(/\d+/g,n=>String(Number(n)));
const provinceKey=s=>norm(s).replace(/(?:특별자치|특별|광역)?시$|도$/,'');
function lotAddress(address,town){
  const text=String(address||'').normalize('NFKC'),m=text.match(new RegExp('(?:^|\\s)'+escapeRegex(town)+'\\s+((?:산\\s*)?\\d+(?:-\\d+)?)(?:번지)?(?=\\s|$)\\s*(.*)$'));
  return m?{lot:lotKey(m[1]),alias:m[2],prefix:text.slice(0,m.index).trim()}:null;
}
// The trade register sometimes keeps a two-letter name while K-apt prefixes the
// legal neighborhood. That exception belongs to this address-checked boundary,
// never to the general name matcher used for candidate and transaction search.
function matchesKaptIdentity(identity,candidate,{requireOfficialCode=false}={}){
  if(!identity?.building||!identity.town||!identity.lot||!candidate?.name)return false;
  const mapped=candidate.officialCode!=null&&String(candidate.officialCode).trim()!=='';
  if((requireOfficialCode&&!mapped)||(mapped&&(!identity.code||String(candidate.officialCode)!==String(identity.code))))return false;
  if(identityConflict(identity.building,candidate.name))return false;
  const address=lotAddress(candidate.addressJibun,identity.town);
  if(!address||address.lot!==lotKey(identity.lot))return false;
  const rawRegion=String(candidate.regionCode||'');if(rawRegion&&!/^\d{5}(?:\d{5})?$/.test(rawRegion))return false;
  const sourceRegion=rawRegion.slice(0,5),expectedRegion=String(identity.regionCode||'');
  if(expectedRegion&&sourceRegion&&expectedRegion!==sourceRegion)return false;
  const prefix=address.prefix.split(/\s+/),knownRegion=!!(identity.province&&identity.region),addressRegion=knownRegion&&provinceKey(prefix[0])===provinceKey(identity.province)&&norm(prefix.slice(1).join(' '))===norm(identity.region);
  if(knownRegion&&!addressRegion)return false;
  if(compatibleName(identity.building,candidate.name))return true;
  // 목동우성2 (trade register) and 목동우성2차 (public complex page)
  // can share facts only after the full legal region and lot match above.
  if(identity.code&&addressRegion&&terminalPhaseMatch(confirmationNameParts(identity.building),confirmationNameParts(candidate.name))){
    const expectedBlocks=blocks(identity.building),sourceBlocks=blocks(candidate.name);
    if(expectedBlocks.length!==sourceBlocks.length||expectedBlocks.some(block=>!sourceBlocks.includes(block)))return false;
    const road=roadKey(identity.road),sourceRoad=roadKey(candidate.addressRoad);
    return !road||!sourceRoad||road===sourceRoad;
  }
  const bare=s=>nameKey(s).replace(/(?:아파트|apt)$/,''),official=bare(identity.building),name=bare(candidate.name),alias=bare(address.alias),town=nameKey(identity.town),stem=town.replace(/(?:읍|면|동|리)$/,'');
  if(official.length!==2||!identity.code||!stem||![stem+official,town+official].includes(name))return false;
  if(![official,stem+official,town+official].includes(alias))return false;
  if(!addressRegion&&!(expectedRegion&&sourceRegion===expectedRegion))return false;
  const road=roadKey(identity.road),sourceRoad=roadKey(candidate.addressRoad);
  if(road&&sourceRoad&&road!==sourceRoad)return false;
  // Without the official trade-code relation, independently corroborate the
  // K-apt address alias with both the legal region code and full road number.
  if(!mapped&&(!expectedRegion||sourceRegion!==expectedRegion||!road||road!==sourceRoad))return false;
  return true;
}
function selectProperties(properties,query){
  const unique=[...new Map(properties.map(p=>[String(p.aprpnHsmpCode),p])).values()];
  const exact=unique.filter(p=>nameKey(p.aprpnHsmpNm)===nameKey(query));
  return exact.length?exact:unique.filter(p=>compatibleName(query,p.aprpnHsmpNm));
}
async function resolveProperty(client,input,signal,{region:knownRegion,expected}={}){
  const kind={apartment:'A',villa:'B',officetel:'D'}[input.asset];
  if(!kind)throw new Error('이 매물 종류는 공식 단지 목록에서 건물을 특정할 수 없습니다.');
  const query=requestedName(input),address=addressParts(input.target);
  if(!query&&!address.lot&&!address.road)throw failure('PROPERTY_INPUT_REQUIRED','단지명 또는 시·군·구를 포함한 정확한 지번·도로명주소를 입력해 주세요.','input');
  const region=knownRegion||await retryRead(()=>client.resolve(input.target,signal),signal);
  const townData=await jsonRequest(client,'/cmm/emdList.do',{code:region.code},signal);
  if(!Array.isArray(townData?.emdList))throw failure('SEARCH_RESPONSE_INVALID','법정동 목록을 확인하지 못했습니다. 다시 검색해 주세요.','region');
  // 읍·면·리가 함께 있는 주소는 마지막 법정동 단위로 한정한다.
  const neighborhoods=address.town?[norm(address.town)]:[];
  const towns=townData.emdList.filter(t=>!neighborhoods.length||neighborhoods.includes(norm(t.codeNm)));
  if(!towns.length)throw failure('REGION_NOT_FOUND','입력한 읍면동을 확인하지 못했습니다. 주소를 확인해 주세요.','region');
  const year=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',year:'numeric'}).format(new Date());
  const allProperties=new Map();let completeNeighborhood=false;
  const atAddress=p=>(!address.lot||lotKey(p.mnnm)===address.lot)&&(!address.road||roadKey(p.roadNm)===address.road);
  const choose=properties=>(expected?.officialCode?properties.filter(p=>String(p.aprpnHsmpCode)===String(expected.officialCode)):query?selectProperties(properties,query):properties).filter(atAddress);
  async function search(keyword){
    if(!keyword&&completeNeighborhood)return choose([...allProperties.values()]);
    const matches=[];
    for(let i=0;i<towns.length;i+=4){
      const pages=await Promise.all(towns.slice(i,i+4).map(async town=>{
        const found=new Map();let expectedTotal;
        for(let page=1;page<=50;page++){
          const result=await jsonRequest(client,'/pt/gis/ptDanjiList.do',{srhThingSecd:kind,srhYear:year,srhLadSecd:'1',srhLedCd:String(town.code),srhBldgNm:keyword,pageIndex:String(page),mobileAt:''},signal);
          const total=Number(result?.totCnt);
          if(!Array.isArray(result?.danjiList)||!['number','string'].includes(typeof result.totCnt)||!/^\d+$/.test(String(result.totCnt))||!Number.isInteger(total)||total<0||result.danjiList.some(p=>!p||!String(p.aprpnHsmpCode||'').trim()||!p.aprpnHsmpNm))throw failure('SEARCH_RESPONSE_INVALID','공식 단지 검색 결과를 확인하지 못했습니다. 다시 검색해 주세요.','property');
          if(expectedTotal!==undefined&&expectedTotal!==total)throw failure('SEARCH_RESPONSE_INCOMPLETE','조회 중 공식 단지 목록의 건수가 바뀌었습니다. 다시 검색해 주세요.','property');expectedTotal=total;
          const before=found.size;for(const p of result.danjiList)found.set(String(p.aprpnHsmpCode),{...p,townName:town.codeNm});
          if(found.size>total)throw failure('SEARCH_RESPONSE_INCOMPLETE','공식 단지 목록의 건수가 응답과 일치하지 않습니다. 다시 검색해 주세요.','property');
          if(found.size===total)break;
          if(!result.danjiList.length||before===found.size||page===50)throw failure('SEARCH_RESPONSE_INCOMPLETE','공식 단지 목록을 끝까지 확인하지 못했습니다. 읍면동을 추가하거나 다시 검색해 주세요.','property');
        }
        return [...found.values()];
      }));matches.push(...pages.flat());
    }
    for(const p of matches)allProperties.set(String(p.aprpnHsmpCode),p);
    if(!keyword)completeNeighborhood=true;
    return choose(matches);
  }
  let matches=[],addressMatched=false,confirmation='';
  const alias=confirmationNameParts(query);
  // Try punctuation/suffix/phase variants within the resolved region before
  // fetching every neighborhood page or repeating an external complex lookup.
  // Even one alias candidate needs confirmation of its official name/address.
  const keywords=[norm(query.replace(BLOCK,'')),alias.name,...(alias.phase.length===1&&alias.stem.length>=3?[alias.stem]:[]),''];
  for(const keyword of new Set(keywords)){
    matches=await search(keyword);
    if(!matches.length&&!expected&&query){
      matches=[...allProperties.values()].filter(p=>atAddress(p)&&confirmationNameMatch(query,p.aprpnHsmpNm));
      if(matches.length)confirmation='입력한 명칭과 공식 자료의 표기가 다릅니다. 검색한 지역의 공식 단지 이름과 주소를 확인해 주세요.';
    }
    if(matches.length)break;
  }
  if(expected){
    const lot=String(expected.address||'').normalize('NFKC').match(/(?:동|읍|면|리)\s+((?:산\s*)?\d+(?:-\d+)?)(?=\s|$|번지)/)?.[1];
    const lotKey=s=>String(s||'').replace(/번지|\s/g,'').replace(/\d+/g,n=>String(Number(n)));
    const hasPoint=Number.isFinite(expected.lat)&&Number.isFinite(expected.lng);
    const consistent=p=>(!lot||lotKey(p.mnnm)===lotKey(lot))&&(!hasPoint||Number.isFinite(Number(p.la))&&Number.isFinite(Number(p.lo))&&require('./scoring.cjs').haversine(expected,{lat:Number(p.la),lng:Number(p.lo)})<=300);
    matches=matches.filter(consistent);
    // 이름이 바뀐 단지는 동일 법정동·지번·좌표가 모두 확인될 때만 연결한다.
    // 차수·블록 충돌과 이미 선택한 공식 코드의 변경은 주소로 우회하지 않는다.
    if(!matches.length&&!expected.officialCode&&lot&&hasPoint){
      await search('');
      matches=[...allProperties.values()].filter(p=>consistent(p)&&!identityConflict(query,p.aprpnHsmpNm));
      addressMatched=matches.length>0;
    }
    // K-apt의 이전 지번이나 대단지 대표 좌표 차이는 같은 도로명·건물번호와
    // 단지명이 대조된 공식 후보로 확인받는다. 가까운 다른 단지로 자동 연결하지 않는다.
    const road=roadKey(expected.road);
    if(!matches.length&&!expected.officialCode&&lot&&road){
      // Without coordinates, formatting aliases still require BOTH exact lot
      // and full road number, followed by official name/code confirmation.
      const expectedTown=addressParts(expected.address).town;
      await search('');
      matches=[...allProperties.values()].filter(p=>expectedTown&&norm(p.townName)===norm(expectedTown)&&consistent(p)&&lotKey(p.mnnm)===lotKey(lot)&&roadKey(p.roadNm)===road&&confirmationNameMatch(query,p.aprpnHsmpNm));
      if(matches.length)confirmation='검색 자료와 공식 자료의 명칭이 다릅니다. 지번·도로명주소가 일치하는 공식 단지의 이름과 주소를 확인해 주세요.';
    }
    if(!matches.length&&!expected.officialCode&&road){
      await search('');
      matches=[...allProperties.values()].filter(p=>roadKey(p.roadNm)===road&&compatibleName(query,p.aprpnHsmpNm)&&!identityConflict(query,p.aprpnHsmpNm));
      if(matches.length)confirmation='검색 자료와 공식 자료의 지번·단지 구분이 달라 현재 공식 이름과 주소를 확인해 주세요.';
    }
  }
  if(matches.length!==1||confirmation||!query&&!expected?.officialCode){
    if(matches.length){const error=new Error((confirmation||'단지 후보가 여러 곳입니다. 목록에서 분석할 단지를 선택해 주세요: ')+matches.slice(0,6).map(p=>`${p.aprpnHsmpNm} (${p.townName} ${p.mnnm||''})`).join(' / '));error.code='PROPERTY_AMBIGUOUS';error.properties=matches;error.region=region;error.reason=confirmation;throw error;}
    throw failure(expected?'PROPERTY_IDENTITY_MISMATCH':'PROPERTY_NOT_FOUND','입력한 지역의 공식 단지 목록에서 일치하는 단지를 찾지 못했습니다. 단지명·차수·읍면동을 확인해 주세요.','property');
  }
  const property=matches[0];return {region,property,identity:{requested:query,building:property.aprpnHsmpNm,code:String(property.aprpnHsmpCode),regionCode:region.code,province:region.province?.name||'',region:region.name||'',town:property.townName,lot:property.mnnm,road:property.roadNm||'',...(Number.isFinite(Number(property.la))&&Number.isFinite(Number(property.lo))?{lat:Number(property.la),lng:Number(property.lo)}:{}),match:expected?.officialCode?'selected-code':addressMatched?'address-coordinate':norm(query)===norm(property.aprpnHsmpNm)?'exact':'unique-name',source:'https://rt.molit.go.kr/pt/gis/gis.do',checkedAt:new Date().toISOString()}};
}
module.exports={requestedName,compatibleName,confirmationNameMatch,matchesKaptIdentity,selectProperties,resolveProperty,assertPropertyInput,nameKey,blocks,roadKey,identityConflict,addressParts};
