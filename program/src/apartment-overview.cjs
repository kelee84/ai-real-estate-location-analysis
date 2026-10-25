'use strict';
// A presentation of saved, checked facts. This module never fetches data,
// changes contracts or estimates missing values from another property.
const {escapeHtml:e,validDate,todayKst,sixMonthWindow,areaSelection,matchesArea,normalize,averageMoney}=require('./core.cjs');
const parking=require('./parking-presentation.cjs'),identityRules=require('./property-identity.cjs'),access=require('./living-access.cjs'),theme=require('./brand-theme.cjs');
const VERSION='2026-10-21-apartment-first-overview-v1',PYEONG=3.305785;
const KIND={trade:'매매',jeonse:'전세',monthly:'월세'};
const number=(value,digits=0)=>new Intl.NumberFormat('ko-KR',{maximumFractionDigits:digits,minimumFractionDigits:digits}).format(value);
const positive=value=>typeof value==='number'&&Number.isFinite(value)&&value>0;
const close=(a,b)=>Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=Math.max(.000001,Math.abs(b)*1e-10);
const mean=(rows,key)=>rows.reduce((sum,row)=>sum+row[key],0)/rows.length;
const lot=value=>String(value??'').split('-').map(part=>/^\d+$/.test(part)?String(Number(part)):part).join('-');
const members=report=>report.members||report.comparisonMembers||[report];
function day(value){if(validDate(value))return value;if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value))return null;const time=Date.parse(value);return Number.isFinite(time)&&time<=Date.now()?todayKst(new Date(time)):null;}
function url(value,hosts){try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&(!hosts||hosts.includes(u.hostname))?u.href:null;}catch{return null;}}
function source(value,hosts,asOf){return value&&url(value.url,hosts)&&day(value.checkedAt)===asOf?{title:String(value.title||'공개 자료'),url:url(value.url,hosts),checkedAt:value.checkedAt}:null;}
function monthsSince(date,asOf){
 if(!validDate(date)||!validDate(asOf)||date>asOf)return null;
 const [y,m,d]=asOf.split('-').map(Number),[by,bm,bd]=date.split('-').map(Number);
 return Math.max(0,(y-by)*12+m-bm-(d<bd?1:0));
}
function savedNaver(member){
 return require('./report-basics.cjs').originalNaver(member);
}
function basicFacts(member,checkedRows){
 const ev=member.assessment?.evidence||{},identity=member.prices?.buildingResolution,asOf=member.input?.asOf,naver=savedNaver(member),snapshot=require('./report-basics.cjs').snapshotRecord(member),p=parking.snapshot(member),originalParking=parking.snapshot({...member,basicSnapshot:undefined}),sources=[];
 const arch=require('./archhub.cjs'),originalArch=arch.original(member),archSnapshot=arch.snapshot(member),official=archSnapshot||originalArch;
 let basic=null;
 if(identity?.code&&ev.identity?.code===identity.code&&ev.identity.town===identity.town&&lot(ev.identity.lot)===lot(identity.lot)&&ev.basic?.name&&identityRules.compatibleName(identity.building,ev.basic.name)&&day(ev.basic.checkedAt)===asOf){
  const s=source((ev.sources||[]).find(s=>s.id===ev.basic.sourceId),['www.k-apt.go.kr','k-apt.go.kr'],asOf);if(s){basic=ev.basic;sources.push(s);}
 }
 if(naver)sources.push({title:'네이버 부동산 · '+naver.name,url:naver.sourceUrl,checkedAt:naver.checkedAt});
 if(snapshot)sources.push({title:'네이버 부동산 · '+snapshot.name+' 기본정보'+(member.basicSnapshot?.status==='last-confirmed'?' · 마지막 확인자료':''),url:snapshot.sourceUrl,checkedAt:snapshot.checkedAt});
 if(p?.sourceUrl)sources.push({title:p.sourceName,url:p.sourceUrl,checkedAt:p.checkedAt});
 if(official)sources.push({title:official.sourceName+' · '+official.name,url:official.sourceUrl,checkedAt:official.checkedAt});
 const count=value=>Number.isSafeInteger(value)&&value>0?value:null;
 const originalUnits=count(originalArch?.basic?.units)??count(naver?.basic?.units)??count(basic?.units)??(day(originalParking?.checkedAt)===asOf?count(originalParking?.units):null);
 const units=count(official?.basic?.units)??count(snapshot?.basic?.units)??originalUnits;
 // Current household counts must never become a historical turnover denominator.
 const turnoverUnits=(day(archSnapshot?.checkedAt)===asOf?count(archSnapshot?.basic?.units):null)??originalUnits??(day(snapshot?.checkedAt)===asOf?count(snapshot?.basic?.units):null);
 const approval=[official?.basic?.approvalDate,snapshot?.basic?.approvalDate,naver?.basic?.approvalDate,basic?.approvalDate].find(date=>validDate(date)&&date<=asOf)||null;
 const years=[...new Set(checkedRows.map(t=>String(t.built??'')))];
 const year=!approval&&years.length===1&&/^\d{4}$/.test(years[0])&&Number(years[0])>=1900&&Number(years[0])<=Number(asOf?.slice(0,4))&&checkedRows.every(t=>Number(years[0])<=Number(t.date.slice(0,4)))?Number(years[0]):null;
 const differences=[];const other=snapshot||naver;
 for(const [key,label,suffix]of [['units','세대수','세대'],['parkingSpaces','주차대수','대'],['approvalDate','사용승인일','']])if(official?.basic?.[key]!=null&&other?.basic?.[key]!=null&&official.basic[key]!==other.basic[key])differences.push(label+' 건축물대장 '+official.basic[key]+suffix+' / 네이버 '+other.basic[key]+suffix);
 return {approval,months:approval?monthsSince(approval,asOf):null,buildingYear:year,units,turnoverUnits,parking:p,basicCheckedAt:official?.checkedAt||snapshot?.checkedAt||naver?.checkedAt||basic?.checkedAt||p?.checkedAt||null,lastConfirmed:official?day(official.checkedAt)!==todayKst()&&!!archSnapshot:!!snapshot&&member.basicSnapshot?.status==='last-confirmed',differences,sources};
}
function groupSignature(group){
 if(group.areaMode==='set'){const selected=String(group.area??'').split(',').map(Number).filter(positive).sort((a,b)=>a-b);return selected.length?'set:'+selected.join(','):null;}
 return ['type','exact'].includes(group.areaMode)&&positive(Number(group.area))?group.areaMode+':'+Number(group.area):null;
}
function selectionSignature(selection){return selection.areaMode==='set'?'set:'+selection.selectedAreas.slice().sort((a,b)=>a-b).join(','):['type','exact'].includes(selection.areaMode)?selection.areaMode+':'+Number(selection.area):null;}
function contracts(member,kind){
 const input=member.input||{},prices=member.prices||{},identity=prices.buildingResolution;
 if(!(input.types?.length?input.types:Object.keys(KIND)).includes(kind))return {status:'not-requested',rows:[],groups:[]};
 try{
  if(input.asset!=='apartment'||!identity?.code||!identity.building||!identity.province||!identity.region||!identity.town||!identity.lot||input.building&&normalize(input.building)!==normalize(identity.building)||!validDate(input.asOf)||input.asOf>todayKst())throw Error('단지·기준일');
  const period=sixMonthWindow(input.asOf);if(prices.period?.start!==period.start||prices.period?.end!==period.end)throw Error('기간');
  const selection=prices.effectiveArea||areaSelection(input),rows=(prices.rows||[]).filter(t=>t.kind===kind),groups=(prices.summaries||[]).filter(g=>g.kind===kind);
  if(!rows.length||!groups.length)throw Error('자료');
  const ids=new Set();
  for(const t of rows){
   if(typeof t.id!=='string'||!t.id||ids.has(t.id)||t.cancelled||!validDate(t.date)||t.date<period.start||t.date>period.end||!positive(t.area)||t.areaBasis!=='전용면적'||!matchesArea(t.area,selection)||normalize(t.building)!==normalize(identity.building)||!identityRules.matchesKaptIdentity(identity,{name:t.building,addressJibun:t.location+' '+t.lot}))throw Error('개별 계약');
   if(kind==='trade'&&!positive(t.price)||kind==='jeonse'&&(!positive(t.deposit)||t.monthly!==0)||kind==='monthly'&&(!Number.isFinite(t.deposit)||t.deposit<0||!positive(t.monthly)))throw Error('금액');
   ids.add(t.id);
  }
  if(selection.areaMode!=='all'&&Math.max(...rows.map(t=>t.area))-Math.min(...rows.map(t=>t.area))>=6.611569)throw Error('면적');
  let total=0;const verified=[];
  for(const g of groups){
   if(g.areaBasis!=='전용면적'||selection.areaMode!=='all'&&groupSignature(g)!==selectionSignature(selection))throw Error('집계 조건');
   const part=rows.filter(t=>(selection.areaMode!=='all'||close(t.area,Number(g.area)))&&(kind!=='monthly'||require('./core.cjs').monthlyBand(t.deposit)===g.depositBand));
   const key=kind==='trade'?'price':'deposit';
   if(!part.length||g.n!==part.length||!close(g[key],mean(part,key))||kind==='monthly'&&!close(g.monthly,mean(part,'monthly')))throw Error('평균');
   total+=part.length;verified.push({...g,rows:part});
  }
  if(total!==rows.length)throw Error('건수');
  // Contracts obey the historical analysis period. Retrieval may happen later:
  // a valid current RTMS download must not be mistaken for a future contract.
  const deal=kind==='trade'?'trade':'rent',coverage=(prices.coverage||[]).filter(c=>c.deal===deal&&c.status==='success'&&url(c.source,['rt.molit.go.kr'])&&day(c.checkedAt)&&day(c.checkedAt)<=todayKst()&&day(c.checkedAt)>=rows.map(t=>t.date).sort().at(-1));
  const sources=coverage.map(c=>({title:'국토교통부 실거래가 · '+KIND[kind],url:c.source,checkedAt:c.checkedAt}));
  if(!sources.length)throw Error('출처');
  return {status:'verified',rows,groups:verified,selection,period,sources};
 }catch{return {status:'unavailable',rows:[],groups:[],reason:'동일 단지·선택 면적·기간의 유효 계약과 원출처를 대조하지 못했습니다.'};}
}
function schoolFact(member){
 const identity=member.prices?.buildingResolution,asOf=member.input?.asOf,school=member.assessment?.evidence?.school;
 if(!identity?.code||school?.status!=='verified'||day(school.checkedAt)!==asOf||school.regionCode!==String(identity.regionCode)||school.zoneClass!=='0'||!access.point(identity)||!access.point(school.referencePoint)||access.distance(identity,school.referencePoint)>10)return {text:'미확인',sources:[]};
 const sources=[source(school.source,['schoolzone.emac.kr','schoolgis.emac.kr'],asOf),source(school.schoolSource,['schoolzone.emac.kr','schoolgis.emac.kr'],asOf)];
 if(sources.some(s=>!s))return {text:'미확인',sources:[]};
 const names=[...new Set((school.schools||[]).filter(s=>/^B\d{9}$/.test(s.id||'')&&typeof s.name==='string'&&s.name.endsWith('초등학교')&&validDate(s.sourceDate)&&s.sourceDate<=asOf&&school.schoolNames?.includes(s.name)).map(s=>s.name))];
 return names.length?{text:names.join(' · ')+'\n공식 초등 통학구역',sources}:{text:'미확인',sources:[]};
}
function priceText(value,kind){
 if(value.status==='not-requested')return '조회 유형 아님';
 if(value.status!=='verified')return '자료 없음';
 if(kind==='monthly'&&value.groups.length>1){
  // An all-area report groups by area × deposit band. Count the two
  // dimensions independently instead of calling every combination a band.
  const areas=new Set(value.groups.map(g=>g.areaMode==='all'?'all:'+Number(g.area):groupSignature(g))),bands=new Set(value.groups.map(g=>g.depositBand));
  return (areas.size>1?areas.size+'개 면적 · ':'')+bands.size+'개 보증금 구간 · 상세 거래표 참조';
 }
 if(value.groups.length>1)return value.groups.length+'개 면적 조건 · 상세 거래표 참조';
 const g=value.groups[0];return (kind==='monthly'?'보증 '+averageMoney(g.deposit)+' / 월 '+averageMoney(g.monthly):averageMoney(kind==='trade'?g.price:g.deposit))+' · '+g.n+'건';
}
function areaLabel(member){
 try{const selection=member.prices?.effectiveArea||areaSelection(member.input||{});if(selection.areaMode==='all')return '전용면적별 분리';
  const values=selection.areaMode==='set'?selection.selectedAreas:[Number(selection.area)],first=Math.min(...values),last=Math.max(...values);
  const label=selection.areaMode==='type'?first+'타입 (전용 '+first+'~<'+(first+1)+'㎡)':(first===last?number(first,2):number(first,2)+'~'+number(last,2))+'㎡';
  const display=label+(selection.areaMode==='type'?'':' · 전용 '+(first===last?number(first/PYEONG,1):number(first/PYEONG,1)+'~'+number(last/PYEONG,1))+'평');
  const resolution=member.prices?.areaResolution;
  return resolution&&Number.isFinite(resolution.requested)&&Number.isFinite(resolution.applied)&&resolution.requested!==resolution.applied?'요청 '+resolution.requested+'타입 → '+resolution.applied+'타입 적용 · '+display:display;
 }catch{return '전용면적 미확인';}
}
function property(member,index){
 const kinds=member.input?.types?.length?member.input.types:Object.keys(KIND),trade=contracts(member,'trade'),jeonse=contracts(member,'jeonse'),monthly=contracts(member,'monthly'),checkedRows=[trade,jeonse,monthly].filter(value=>value.status==='verified').flatMap(value=>value.rows),basic=basicFacts(member,checkedRows),school=schoolFact(member),values={};
 values.approval=basic.approval|| (basic.buildingYear?basic.buildingYear+'년 (실거래 기록상 건축연도)':'미확인');
 values.age=basic.months!==null?Math.floor(basic.months/12)+'년 '+basic.months%12+'개월 (만 '+basic.months+'개월)':'정확한 사용승인일 미확인';
 values.units=basic.units!==null?number(basic.units)+'세대':'미확인';
 values.parking=basic.parking?.total!==null&&basic.parking?.total!==undefined?'총 '+number(basic.parking.total)+'대'+(basic.parking.perUnit!==null?' · 세대당 '+number(basic.parking.perUnit,2)+'대':' · 세대당 미확인'):'미확인';
 for(const kind of kinds)values[kind]=priceText({trade,jeonse,monthly}[kind],kind);
 const priced=trade.status==='verified'&&trade.groups.length===1?trade:null;
 values.unitPrice=priced?number(mean(priced.rows.map(t=>({unit:t.price/t.area*PYEONG})),'unit'))+'만원/평':'산출 불가';
 const comparable=priced&&jeonse.status==='verified'&&jeonse.groups.length===1&&selectionSignature(trade.selection)!==null&&selectionSignature(trade.selection)===selectionSignature(jeonse.selection)&&groupSignature(trade.groups[0])===groupSignature(jeonse.groups[0]);
 const tradeMean=priced?.groups[0]?.price,deposit=comparable?jeonse.groups[0].deposit:null;
 values.jeonseRatio=comparable?number(deposit/tradeMean*100,1)+'%':'산출 불가';
 values.gap=comparable?averageMoney(tradeMean-deposit):'산출 불가';
 values.turnover=trade.status==='verified'&&basic.turnoverUnits>0?number(trade.rows.length/basic.turnoverUnits*100,2)+'% ('+trade.rows.length+'건 ÷ '+number(basic.turnoverUnits)+'세대)':'산출 불가';
 values.school=school.text;
 const sourceList=[...basic.sources,...trade.sources||[],...jeonse.sources||[],...monthly.sources||[],...school.sources];
 return {key:member.key||String.fromCharCode(65+index),name:member.input?.building||member.input?.target||'단지 미확인',address:member.prices?.buildingResolution?[member.prices.buildingResolution.province,member.prices.buildingResolution.region,member.prices.buildingResolution.town].filter(Boolean).join(' '):'',areaLabel:areaLabel(member),color:require('./radar.cjs').STYLES[index%3].color,values,facts:{...basic,trade,jeonse,monthly},sources:sourceList};
}
function data(report){
 const ms=members(report).filter(m=>m.input?.asset==='apartment').slice(0,3),properties=ms.map(property);if(!properties.length)return {title:'',properties:[],headers:[],rows:[],notes:[],sources:[]};
 const requested=new Set(ms.flatMap(m=>m.input?.types?.length?m.input.types:Object.keys(KIND)));
 const fields=[['approval','사용승인일 / 건축연도'],['age','연식 (사용승인일 기준)'],['units','총세대수'],['parking','주차대수'],...Object.keys(KIND).filter(kind=>requested.has(kind)).map(kind=>[kind,'최근 6개월 '+KIND[kind]+' 평균']),...(requested.has('trade')?[['unitPrice','평당가격 (전용 기준)']]:[]),...(requested.has('trade')&&requested.has('jeonse')?[['jeonseRatio','전세가율'],['gap','매매·전세 갭']]:[]),...(requested.has('trade')?[['turnover','매매회전율 (선택면적·6개월)']]:[]),['school','학군 · 초등학교']];
 const notes=['계약일 '+[...new Set(ms.map(m=>m.prices?.period?.start&&m.prices?.period?.end?m.prices.period.start+' ~ '+m.prices.period.end:'기간 미확인'))].join(' / ')+' · 선택 전용면적의 개별 계약 산술평균 · 해제·중복 제외.'];
 const supplements=properties.filter((p,index)=>p.facts.basicCheckedAt&&day(p.facts.basicCheckedAt)!==ms[index].input.asOf);
 if(supplements.length)notes.push('단지 기본정보 확인일 '+supplements.map(p=>p.name+' '+day(p.facts.basicCheckedAt)).join(' · ')+' / 거래·환경평가 기준일 '+[...new Set(ms.map(m=>m.input.asOf))].join(' / ')+'. 기본정보만 보완했으며 현재 세대수를 과거 거래회전율 계산에 섞지 않았습니다.');
 const retained=properties.filter(p=>p.facts.lastConfirmed);if(retained.length)notes.push('마지막 확인자료: '+retained.map(p=>p.name+' (확인 '+day(p.facts.basicCheckedAt)+')').join(' · ')+'. 오늘 기본정보를 다시 확인하지 못해 이전에 검증한 자료를 표시했습니다.');
 for(const p of properties)if(p.facts.differences?.length)notes.push(p.name+' 자료 차이: '+p.facts.differences.join(' · ')+'. 표에는 건축물대장 기재값을 우선 표시했습니다.');
 if(requested.has('trade'))notes.push('평당가격은 개별 매매금액÷전용㎡×3.305785의 산술평균(만원 반올림). 공급면적 기준 평당가격과 다릅니다. 매매회전율은 선택면적 매매건수÷단지 전체 세대수이며 단지 전체 거래회전율이 아닙니다.');
 if(requested.has('trade')&&requested.has('jeonse'))notes.push('전세가율=같은 선택면적 전세평균÷매매평균×100, 갭=매매평균−전세평균. 같은 개별 세대의 매매·전세 가격은 아니며 호가·적정가격·수익률을 뜻하지 않습니다.');
 const sources=[...new Map(properties.flatMap(p=>p.sources).filter(s=>url(s.url)).map(s=>[s.url+'|'+day(s.checkedAt),s])).values()];
 return {version:VERSION,title:properties.length>1?'아파트 가격·기본정보 비교':'아파트 가격·기본정보',properties,headers:['항목',...properties.map(p=>(properties.length>1?p.key+' · ':'')+p.name+'\n'+p.areaLabel)],rows:fields.map(([key,label])=>({key,label,values:properties.map(p=>p.values[key]??'조회 유형 아님')})),notes,sources};
}
function tableRows(report){return data(report).rows.map(row=>[row.label,...row.values]);}
function sections(report){const m=data(report);return m.properties.length?[{heading:m.title,paragraphs:m.notes,facts:[],table:{headers:m.headers,rows:m.rows.map(row=>[row.label,...row.values])}}]:[];}
function html(report){
 const m=data(report);if(!m.properties.length)return '';const br=value=>e(value).replace(/\n/g,'<br>');
 const head=p=>`<th scope="col" class="apartment-property" style="--property-color:${p.color}"><span>${e(m.properties.length>1?'단지 '+p.key:'분석 단지')}</span><strong>${e(p.name)}</strong><small>${e(p.address)}</small><b>${e(p.areaLabel)}</b></th>`;
 const label='<th scope="col" class="apartment-field-head">비교 항목</th>',two=m.properties.length===2;
 const sourceNames=[...new Map(m.sources.map(s=>{const host=new URL(s.url).hostname,label=host.includes('naver.com')?s.title:host==='rt.molit.go.kr'?'국토교통부 실거래가':host.endsWith('emac.kr')?'한국교육시설안전원 학구도':host.endsWith('k-apt.go.kr')?'국토교통부 K-apt':s.title;return [s.url+'|'+day(s.checkedAt),{...s,label}];})).values()];
 return `<section class="apartment-overview" data-role="apartment-overview" aria-label="${e(m.title)}"><table class="apartment-facts ${two?'two-properties':'label-first'}"><thead><tr>${two?head(m.properties[0])+label+head(m.properties[1]):label+m.properties.map(head).join('')}</tr></thead><tbody>${m.rows.map(row=>`<tr data-field="${e(row.key)}">${two?`<td style="--property-color:${m.properties[0].color}">${br(row.values[0])}</td><th scope="row">${e(row.label)}</th><td style="--property-color:${m.properties[1].color}">${br(row.values[1])}</td>`:`<th scope="row">${e(row.label)}</th>${row.values.map((value,i)=>`<td style="--property-color:${m.properties[i].color}">${br(value)}</td>`).join('')}`}</tr>`).join('')}</tbody></table><div class="apartment-overview-notes">${m.notes.map(note=>`<p>${e(note)}</p>`).join('')}${sourceNames.length?`<p>출처: ${sourceNames.map(s=>`<a href="${e(s.url)}">${e(s.label)}</a> (조회 ${e(day(s.checkedAt)||'미확인')})`).join(' · ')}</p>`:''}</div></section>`;
}
const CSS=`.apartment-overview{margin:0 0 14px;break-inside:avoid}.apartment-overview h2{font-size:17px;margin:0 0 9px}.apartment-facts{width:100%;border-collapse:collapse;table-layout:fixed;font-size:12px;line-height:1.4}.apartment-facts th,.apartment-facts td{padding:6px 8px;vertical-align:middle;text-align:center;border-bottom:1px solid ${theme.colors.line};overflow-wrap:anywhere;white-space:pre-line}.apartment-facts thead th{background:${theme.colors.soft};border-top:3px solid var(--property-color,${theme.colors.navy});font-weight:500}.apartment-facts .apartment-property{color:var(--property-color);padding:9px}.apartment-property span,.apartment-property strong,.apartment-property small,.apartment-property b{display:block}.apartment-property span{font-size:10px}.apartment-property strong{font-size:16px;line-height:1.3;margin:3px 0}.apartment-property small{font-size:10px;color:${theme.colors.muted}}.apartment-property b{font-size:11px;margin-top:6px;line-height:1.4}.apartment-facts tbody th{font-weight:600;color:${theme.colors.navy};background:${theme.colors.soft};font-size:11px}.apartment-facts tbody td{color:var(--property-color,${theme.colors.ink});font-variant-numeric:tabular-nums}.apartment-facts.two-properties th:nth-child(2){width:26%}.apartment-facts.label-first th:first-child{width:32%}.apartment-facts tr{break-inside:avoid}.apartment-overview-notes{margin-top:6px;color:${theme.colors.muted};font-size:9px;line-height:1.45}.apartment-overview-notes p{margin:3px 0}.apartment-overview-notes a{color:inherit;text-decoration:underline}@media print{.apartment-overview{margin-bottom:10px}.apartment-overview h2{font-size:15px}.apartment-facts{font-size:10px;line-height:1.35}.apartment-facts th,.apartment-facts td{padding:4px 6px}.apartment-facts tbody th{font-size:9px}.apartment-property strong{font-size:13px}.apartment-property span,.apartment-property small{font-size:8px}.apartment-property b{font-size:9px}.apartment-overview-notes{font-size:7.5px}}`;
module.exports={VERSION,PYEONG,data,html,tableRows,sections,CSS,monthsSince};
