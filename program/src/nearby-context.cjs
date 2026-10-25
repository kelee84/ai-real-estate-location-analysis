'use strict';
const access=require('./living-access.cjs'),{todayKst,validDate,normalize}=require('./core.cjs'),{matchesKaptIdentity,compatibleName,identityConflict}=require('./property-identity.cjs'),{addressFacts}=require('./peer-comparison.cjs');
const VERSION='2026-10-18-nearby-buyer-v1',RADIUS=2000,MAX_PEERS=9;
function requested(input={}){
 // A target's parking/approval facts do not require querying neighbouring
 // buildings. Fetch this optional sample only for an explicit comparison or
 // ranking request, and apply the same gate again when displaying saved data.
 const value=String(input.request||'').replace(/[ \t]+/g,'');
 return /(?:주차|노후|준공|사용승인|연식|만연차|지하철|(?:주변|인근|이웃)(?:단지|아파트)|(?:단지|아파트)(?=순위|랭킹))(?:대수|공간|여건|환경|수준|현황|상태|조건|차이|접근성|거리|연도|년도|만연차|연차|얼마나|좋은지|가까운지|세대당|단지별|상호|서로|주변|인근|이웃|단지|아파트|끼리|들|의|을|를|은|는|이|가|와|과|도|만|별|도|일){0,10}(?:비교|순위|랭킹)/.test(value);
}
const stamp=(d,day)=>Number.isFinite(Date.parse(d?.metadata?.collected_at))&&todayKst(new Date(d.metadata.collected_at))===day;
const count=n=>(typeof n==='number'||typeof n==='string'&&/^\d+$/.test(n.trim()))&&Number.isSafeInteger(Number(n))&&Number(n)>=0?Number(n):null;
function age(date,asOf){if(!validDate(date)||date>asOf)return null;return +asOf.slice(0,4)- +date.slice(0,4)-(asOf.slice(5)<date.slice(5)?1:0);}
function ranks(rows,key,descending=false){const valid=rows.filter(r=>Number.isFinite(r[key]));for(const row of rows)row[key+'Rank']=Number.isFinite(row[key])?1+valid.filter(r=>descending?r[key]>row[key]:r[key]<row[key]).length:null;return valid.length;}
function sameAddress(a,b){const x=addressFacts(a),y=addressFacts(b);return x&&y&&normalize(x.location)===normalize(y.location)&&x.lot===y.lot;}
function roadMatches(identity,address){const road=normalize(identity.road||''),full=normalize(address||'');return road.length>=6&&full.endsWith(road)&&identity.province&&identity.region&&full.startsWith(normalize(identity.province+identity.region));}
function targetMatch(identity,data){
 const b=data.basic;if(!b)return false;const candidate={name:data.name,regionCode:b.bjd_code,addressJibun:b.address_jibun,addressRoad:b.address_road};if(matchesKaptIdentity(identity,candidate))return true;
 // REF_DB may omit the legal code. Use both official addresses and the exact
 // permitted town-prefixed alias; never manufacture a returned region code.
 const a=addressFacts(b.address_jibun),n=normalize(data.name).replace(/아파트$/,''),name=normalize(identity.building).replace(/아파트$/,''),town=normalize(identity.town),alias=[name,town+name,town.replace(/(?:읍|면|동|리)$/,'')+name];
 return !b.bjd_code&&!identityConflict(identity.building,data.name)&&a?.town===identity.town&&a.lot===String(identity.lot)&&normalize(a.district)===normalize(identity.province+' '+identity.region)&&roadMatches(identity,b.address_road)&&alias.includes(n);
}
function parseBatch(data,candidates,{input,prices,center}){
 const rows=[],excluded=[],identity=prices.buildingResolution;
 for(const entry of (data?.results||[])){
  const d=entry.status==='success'?entry.data:null,b=d?.basic,c=candidates.find(c=>c.identifiers?.kapt_code===d?.kapt_code),target=!!b&&targetMatch(identity,d);
  if(!b||!stamp(d,input.asOf)||b.bjd_code!=null&&!/^\d{10}$/.test(String(b.bjd_code))||!target&&(!c||!access.point(c)||!compatibleName(c.name,d.name)||!(sameAddress(c.address,b.address_jibun)||normalize(c.address)===normalize(b.address_road)))){excluded.push({name:d?.name||c?.name||'단지',reason:'공식 단지·주소·조회일 대조 미완료'});continue;}
  if(rows.some(r=>r.kaptCode===d.kapt_code))continue;
  const units=count(b.total_units),ground=count(d.detail?.parking_ground),underground=count(d.detail?.parking_underground),rawParking=ground!=null&&underground!=null&&ground+underground>0&&units>0?(ground+underground)/units:null;
  const supplied=d.derived?.parking_per_unit,parking=rawParking!=null&&(supplied==null||Number.isFinite(supplied)&&Math.abs(supplied-rawParking)<=.02)?rawParking:null;
  const date=String(b.use_approval_date||'').replace(/^(\d{4})(\d{2})(\d{2})$/,'$1-$2-$3'),years=age(date,input.asOf),point=target?center:access.point(c);
  // Preserve the actual address proofs used by targetMatch. Display consumers
  // must be able to repeat the same check without inventing a legal code.
  rows.push({kaptCode:d.kapt_code,name:d.name,target,address:b.address_jibun,addressRoad:typeof b.address_road==='string'?b.address_road:null,bjdCode:b.bjd_code==null?null:String(b.bjd_code),...point,distanceM:Math.round(access.distance(center,point)),approvalDate:years!=null?date:null,ageYears:years,units:units>0?units:null,parkingGround:ground,parkingUnderground:underground,parkingPerUnit:parking,subwayDistanceM:null,checkedAt:d.metadata.collected_at});
 }
 return {rows,excluded};
}
function transit(rows,tools,{center,asOf}){
 const records=tools.map(t=>access.queryRecord(t,{category:'subway',radiusM:5000},center,asOf,p=>/지하철|전철/.test(p.kakao_category_name||'')&&!/예정|폐역|휴역|미개통/.test(p.name||''))).filter(Boolean),record=records[0];if(!record)return;
 const coverage=record.truncated&&record.nearestProven?Math.max(...record.places.map(p=>p.distanceM)):!record.truncated?5000:0;
 for(const row of rows){const nearest=record.places.map(p=>({p,d:access.distance(row,p)})).sort((a,b)=>a.d-b.d)[0];if(nearest&&row.distanceM+nearest.d+2<coverage){row.subwayDistanceM=Math.round(nearest.d);row.subway=nearest.p.name;row.subwaySourceId=nearest.p.sourceId;}}
}
async function collect(call,input,prices,{center,tools}){
 const out={version:VERSION,status:'unavailable',asOf:input.asOf,identityCode:prices.buildingResolution?.code,center,checkedAt:new Date().toISOString(),radiusM:RADIUS,maxPeers:MAX_PEERS,rows:[],excluded:[],sources:[],reason:''};
 if(!requested(input)||input.asOf!==todayKst())return {...out,reason:'주변 비교는 요청한 현재 기준일의 단지에서만 조회합니다.'};
 const nearby=await call('find_complexes_near_point',{center_lat:center.lat,center_lng:center.lng,radius_km:2,limit:50,sort:'distance'});
 if(!nearby||!stamp(nearby,input.asOf)||!access.point(nearby.query?.center)||access.distance(center,nearby.query.center)>2)return {...out,reason:'주변 단지 목록의 중심·조회일을 확인하지 못했습니다.'};
 const candidates=[...new Map((nearby.results||[]).filter(c=>c.status==='occupied'&&/^[A-Za-z0-9]{5,30}$/.test(c.identifiers?.kapt_code||'')&&access.point(c)&&typeof c.address==='string'&&Number.isFinite(c.distance_m)&&Math.abs(access.distance(center,c)-c.distance_m)<=Math.max(35,c.distance_m*.08)&&access.distance(center,c)<=RADIUS).map(c=>[c.identifiers.kapt_code,c])).values()].sort((a,b)=>a.distance_m-b.distance_m);
 const id=prices.buildingResolution,address=[id.province,id.region,id.town,id.lot].filter(Boolean).join(' '),targetCandidates=candidates.filter(c=>roadMatches(id,c.address)&&!identityConflict(id.building,c.name)&&[normalize(id.building),normalize(id.town).replace(/(?:읍|면|동|리)$/,'')+normalize(id.building)].includes(normalize(c.name).replace(/아파트$/,''))),target=targetCandidates.length===1?targetCandidates[0]:null;
 const chosen=candidates.filter(c=>c!==target).slice(0,MAX_PEERS),items=[target?{kapt_code:target.identifiers.kapt_code}:{complex_query:address||input.target},...chosen.map(c=>({kapt_code:c.identifiers.kapt_code}))];
 const data=await call('get_complex_info_batch',{items,detail:true});if(!data)return {...out,reason:'주변 단지의 상세 자료를 확인하지 못했습니다.'};
 Object.assign(out,parseBatch(data,candidates,{input,prices,center}));
 await call('search_by_nearby_category',{center_lat:center.lat,center_lng:center.lng,categories:['subway'],radius_m:5000});transit(out.rows,tools,{center,asOf:input.asOf});
 out.status=out.rows.length?'checked':'unavailable';out.validParking=ranks(out.rows,'parkingPerUnit',true);out.validSubway=ranks(out.rows,'subwayDistanceM');
 out.ageBands=[0,10,20,30].map((min,i)=>({label:i===3?'30년 이상':min+'~'+(min+10)+'년 미만',count:out.rows.filter(r=>r.ageYears!=null&&r.ageYears>=min&&(i===3||r.ageYears<min+10)).length}));
 out.candidateCount=nearby.pagination?.total_count??candidates.length;out.truncated=nearby.metadata?.truncated===true||nearby.pagination?.has_more===true||candidates.length>chosen.length+(target?1:0);out.reason='직선 2km 내 등록 후보 중 가까운 최대 9곳과 기준 단지의 확인된 자료를 비교했습니다. 지역 전체 순위가 아닙니다.';
 out.sources=[{id:'ev-nearby-kapt',title:'국토교통부 K-apt · 주변 단지 비교',url:'https://www.k-apt.go.kr/',checkedAt:input.asOf},{id:'ev-nearby-kakao',title:'카카오 장소정보 · 지하철 직선거리',url:'https://map.kakao.com/',checkedAt:input.asOf}];return out;
}
function section(member){if(!requested(member.input))return null;const v=member.assessment?.evidence?.nearbyContext;if(v?.version!==VERSION||v.asOf!==member.input?.asOf||String(v.identityCode)!==String(member.prices?.buildingResolution?.code))return null;
 if(!v.rows?.length)return {title:'주변 단지 참고 비교',heads:['조회 범위','결과'],widths:[30,70],rows:[['직선 2km · 가까운 최대 9곳',v.reason]],note:'조회하지 못한 주차·사용승인일·거리로 순위를 만들지 않습니다.'};
 return {title:'주변 단지 참고 비교',heads:['단지','세대당 주차','주차 순위','만 연차','지하철 직선거리'],widths:[30,16,14,12,28],rows:[...(!v.rows.some(r=>r.target)?[['기준 · '+(member.input.building||member.input.target),'미확인','보류','미확인','기준 단지 식별 자료 부족']]:[]),...v.rows.map(r=>[(r.target?'기준 · ':'')+r.name,r.parkingPerUnit!=null?r.parkingPerUnit.toFixed(2)+'대':'미확인',r.parkingPerUnitRank!=null?r.parkingPerUnitRank+'/'+v.validParking:'보류',r.ageYears!=null?r.ageYears+'년':'미확인',r.subwayDistanceM!=null?r.subway+' '+r.subwayDistanceM.toLocaleString('ko-KR')+'m · '+r.subwayDistanceMRank+'/'+v.validSubway:'조회 범위 내 최근접 미확인'])],note:v.reason+(v.excluded?.length?' 식별·자료 대조 미완료로 제외한 단지 '+v.excluded.length+'곳: '+v.excluded.slice(0,3).map(r=>r.name).join('·')+'.':'')+' 주차 양쪽 원값·세대수 결측은 순위에서 제외합니다. 실제 가용 주차·도보 동선·노후 상태는 별도 확인합니다. 사용승인 만 연차별: '+(v.ageBands||[]).map(b=>b.label+' '+b.count+'곳').join(' / ')+' · 순위는 반올림 전 값 · 출처 K-apt·카카오맵 · 조회 '+v.asOf};
}
module.exports={VERSION,RADIUS,MAX_PEERS,requested,count,age,ranks,parseBatch,transit,collect,section,targetMatch};
