'use strict';
const access=require('./living-access.cjs');
const {todayKst,normalize}=require('./core.cjs');
const VERSION='2026-10-20-key-facilities-map-v1',LOCAL_RADIUS=3000;
const STYLES={
 target:{color:'Red',label:'대상 단지',short:'단지',legend:'빨강: 단지'},
 subway:{color:'Blue',label:'지하철',short:'역',legend:'파랑: 지하철'},
 school:{color:'Purple',label:'초등학교',short:'초등',legend:'보라: 초등학교'},
 mart:{color:'Orange',label:'대형마트',short:'마트',legend:'주황: 대형마트'},
 nature:{color:'Green',label:'자연공간',short:'자연',legend:'초록: 자연공간'},
 hospital:{color:'#D34587',label:'병원',short:'병원',legend:'분홍: 병원'},
 academy:{color:'#263E80',label:'입시·국영수',short:'학원',legend:'남색: 입시·국영수'}
};
const CLOSED=/예정|계획|공사\s*중|폐점|폐업|폐원|휴업|휴원|폐교|휴교|폐역|휴역|미개통/;
const sameDay=(stamp,asOf)=>Number.isFinite(Date.parse(stamp))&&todayKst(new Date(stamp))===asOf;
function legendFromMarkers(markers=[]){return Object.values(STYLES).filter(s=>markers.some(m=>m.color===s.color&&String(m.info||'').startsWith(s.label+' · '))).map(s=>s.legend).join(' / ');}
function verifiedPlace(p,center,asOf){return !!access.point(p)&&!!String(p?.name||'').trim()&&!CLOSED.test(p.name)&&!!p.sourceId&&sameDay(p.checkedAt,asOf)&&Number.isFinite(p.distanceM)&&p.distanceM>=0&&Math.abs(access.distance(center,p)-p.distanceM)<=2;}
// This view deliberately uses the already collected, validated evidence. A map
// never initiates a facility query or substitutes a park centroid for an entry.
function buildMapMarkers({input={},identity={},evidence={},center=evidence.center,nature=evidence.nature,natureAccess=evidence.natureAccess,livingAccess=evidence.livingAccess}={}){
 const origin=access.point(center),asOf=input.asOf||evidence.asOf,omitted=[];
 if(!origin)return {version:VERSION,markers:[],center:null,radiusM:null,legend:'',scope:'단지 기준 좌표 미확인',omitted};
 const selected=[],targetName=String(input.building||identity.building||evidence.building||input.target||'분석 대상').trim().slice(0,120);
 const add=(p,kind,detail,{target=false}={})=>{
  const coord=access.point(p);if(!coord||!String(p?.name||'').trim())return;
  const distanceM=target?0:Math.round(access.distance(origin,coord));
  if(!target&&distanceM>LOCAL_RADIUS){omitted.push({name:p.name,kind,distanceM,reason:'근거리 지도 범위 밖 · 본문 시설표 참조'});return;}
  const item={id:String(p.id||''),...coord,name:String(p.name).trim().slice(0,120),kind,details:[detail],distanceM};
  // One registered facility may cover several academic subjects. Exact shared
  // coordinates also share one pin, while all names/subjects stay in its info.
  const prior=selected.find(x=>item.id&&x.id===item.id||!target&&x.kind!=='target'&&x.lat===item.lat&&x.lng===item.lng);
  if(prior){if(!prior.names)prior.names=[prior.name];if(!prior.names.includes(item.name))prior.names.push(item.name);prior.details.push(detail);return;}
  selected.push(item);
 };
 add({...origin,name:targetName},'target',evidence.centerSource?'네이버 등록 단지 기준점 · 공식 주소 대조':'공식 단지 기준점',{target:true});
 const places=(evidence.places||[]).filter(p=>verifiedPlace(p,origin,asOf)).sort((a,b)=>a.distanceM-b.distanceM||String(a.id).localeCompare(String(b.id)));
 const railNames=new Set();for(const p of places.filter(p=>p.category==='subway'&&/지하철|전철/.test(p.kakao_category_name||''))){const key=normalize(p.name.replace(/\s*\d+호선.*$/,''));if(railNames.has(key))continue;railNames.add(key);add(p,'subway','등록 역 기준점 · 실제 출입구·보행 동선 미확인');if(railNames.size===2)break;}
 const schoolNames=evidence.school?.status==='verified'?evidence.school.schoolNames||[]:[],schools=places.filter(p=>p.category==='school_elementary'&&/초등학교/.test(p.kakao_category_name||''));
 const school=schools.find(p=>schoolNames.some(name=>normalize(name)===normalize(p.name)))||schools[0];
 if(school)add(school,'school',schoolNames.some(name=>normalize(name)===normalize(school.name))?'공식 통학구역 연계 학교 · 동·호수별 최종 배정·통학 동선 별도 확인':'주변 등록 초등학교 · 배정 학교 미확인');
 const mart=places.find(p=>p.category==='mart_large'&&require('./shopping.cjs').eligibleMart(p));if(mart)add(mart,'mart','등록 대형마트 · 실제 운영·출입구 별도 확인');
 const natural=[];
 if(require('./regional-park.cjs').verified(nature,{center:origin,asOf}))natural.push({...nature.selected,pointRole:'공원 등록 기준점 · 출입구 미확인'});
 if(require('./nature-access.cjs').verified(natureAccess,{center:origin,asOf}))natural.push(...natureAccess.trails);
 natural.sort((a,b)=>a.distanceM-b.distanceM||String(a.id).localeCompare(String(b.id)));
 const naturalIds=new Set();for(const p of natural){if(naturalIds.has(String(p.id)))continue;naturalIds.add(String(p.id));add(p,'nature',p.pointRole+' · 실제 진입 동선·경사·개방 별도 확인');if(naturalIds.size===2)break;}
 const living=access.upgradeSnapshot(livingAccess,{center:origin,asOf,identity:evidence.identity||identity});
 if(living){
  const hospitals=living.groups.hospital.categories.filter(c=>c.nearest).sort((a,b)=>a.nearest.distanceM-b.nearest.distanceM),general=hospitals.find(c=>c.key==='general'),clinic=hospitals.find(c=>c.key!=='general');
  for(const c of [general,clinic].filter(Boolean))add(c.nearest,'hospital',c.label+' · 진료시간·응급 대응·현재 운영 별도 확인');
  for(const key of ['entrance','korean','english','math']){const c=living.groups.academy.categories.find(c=>c.key===key);if(c?.nearest)add(c.nearest,'academy',c.label+' · 자녀별 수업·비용·운영 여부 별도 확인');}
 }
 const markers=selected.map((p,index)=>{const style=STYLES[p.kind],names=(p.names||[p.name]).join(' / '),label=index===0?p.name:style.short+' · '+names;return {lat:p.lat,lng:p.lng,name:(String(index+1).padStart(2,'0')+' '+label).slice(0,150), color:style.color,info:style.label+' · '+(p.names?names+' · ':'')+[...new Set(p.details)].join(' / ')+' · '+(index===0?'단지 기준점':'직선 '+p.distanceM.toLocaleString('ko-KR')+'m')+' · 기준일 '+asOf};});
 const farthest=Math.max(0,...selected.map(p=>p.distanceM)),radiusM=Math.min(LOCAL_RADIUS,Math.max(800,Math.ceil((farthest+250)/100)*100));
 return {version:VERSION,markers,center:origin,radiusM,legend:legendFromMarkers(markers),scope:'단지 중심 반경 '+(LOCAL_RADIUS/1000)+'km 이내 주요 시설 · 번호는 지도 목록과 대응 · WGS84 등록 좌표·직선거리 · 먼 시설은 본문 참조',omitted};
}
module.exports={VERSION,LOCAL_RADIUS,STYLES,buildMapMarkers,legendFromMarkers};
