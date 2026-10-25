'use strict';
// Presentation-only projection. Saved reports and their complete evidence are never changed.
const {SCORE_ITEMS:AXES}=require('./core.cjs');
const READY=Symbol('customer-report');
const PREMIUM=/프리미엄/;
const SCHOOL_ACADEMIC=/학업\s*(?:정보|성취|성적)|성취도|학교\s*(?:평가\s*)?순위|교과별\s*공시|학교알리미|공식\s*순위\s*미제공/;
const ACADEMY_DETAIL=/(?:(?:학원|입시|보습|국영수|예체능).*(?:세부|상세|과목별|분야별|배점|접근성)|(?:세부|상세|과목별|분야별|배점).*(?:학원|입시|보습|국영수|예체능))/;
// Keep other facts in old mixed narratives while projecting academy subjects
// onto the current scope. School classes and general recreation are untouched.
const LEGACY_ACADEMY_SUBJECTS=/((?:입시|보습|국어|영어|수학|국영수)(?:\s*[·ㆍ,/]\s*(?:입시|보습|국어|영어|수학|국영수))*)(?:\s*[·ㆍ,/]\s*|\s+및\s+)(?:예체능|미술|음악|체육|태권도)(?:\s*[·ㆍ,/]\s*(?:예체능|미술|음악|체육|태권도))*(?=\s*(?:분야\s*)?(학원|시설))/g;
function currentAcademySubjects(text){return String(text||'').replace(LEGACY_ACADEMY_SUBJECTS,(match,supported,noun,offset,whole)=>{
 if(noun==='시설'&&!/학원/.test(whole.slice(0,offset).split(/[.!?。\n]/).at(-1)))return match;
 return supported;
});}
// Older AI narratives may contain a subject-by-subject table inside another section.
function withoutAcademyDetails(text){
 const lines=String(text||'').split(/\r?\n/),out=[];let hiddenLevel=null,academyTable=false;
 for(const line of lines){
  const heading=/^\s*(#{1,6})\s+(.+)$/.exec(line);
  if(heading){if(hiddenLevel&&heading[1].length<=hiddenLevel)hiddenLevel=null;if(ACADEMY_DETAIL.test(heading[2])){hiddenLevel=heading[1].length;academyTable=false;continue;}}
  if(hiddenLevel)continue;
  if(/학원/.test(line)&&/\|/.test(line)&&/분야|과목|시설|거리|점수|배점/.test(line)){academyTable=true;continue;}
  if(academyTable){if(/^\s*\|/.test(line)||/^\s*:?-{3}/.test(line))continue;academyTable=false;}
  if(ACADEMY_DETAIL.test(line)&&/(?:\d|\||[:：])/.test(line))continue;
  if(/입시|보습|국어|영어|수학|미술|음악|체육|태권도|국영수|예체능/.test(line)&&/학원|국영수|예체능/.test(line)&&/(?:\d\s*(?:%|점|m\b|미터)|\|)/.test(line))continue;
  out.push(currentAcademySubjects(line));
 }
 return out.join('\n');
}
// Remove only content-free reminders. Subject-specific uncertainty is essential evidence.
const GENERIC_CAUTION=/^(?:현장 확인을 해야 합니다|현장 확인이 필요합니다|추가 확인이 필요합니다|별도 확인이 필요합니다|현재 거래조건을 뜻하지 않습니다|정량 정보는 원자료와 대조한 거래표·면적·조회 조건을 확인하세요)[.!。]?$/;
function sentences(text){return String(text||'').split(/(?:\r?\n)+|(?<=[.!?。])\s+(?=[가-힣A-Za-z])/u).map(s=>s.trim()).filter(Boolean);}
function facts(text){return sentences(withoutAcademyDetails(text)).filter(s=>!PREMIUM.test(s)&&!SCHOOL_ACADEMIC.test(s)&&!GENERIC_CAUTION.test(s)&&!/거리\s*미산정|도보\s*미산정/.test(s)).join(' ');}
function factList(items){return (items||[]).map(facts).filter(Boolean);}
const sectionHidden=heading=>/제출|점수\s*산정|공통\s*평가\s*기준|프리미엄|네이버에서\s*확인한\s*생활정보/.test(heading||'')||SCHOOL_ACADEMIC.test(heading||'')||ACADEMY_DETAIL.test(heading||'');
function unverifiedMallNames(r){const e=r.assessment?.evidence||{},rows=[...(e.places||[]).filter(p=>p.category==='shopping_large'),e.shopping?.shoppingMall?.nearest].filter(Boolean);return [...new Set([...(r.assessment?.commerceRejectedNames||[]),...rows.filter(p=>!require('./shopping.cjs').eligible(p,{asOf:r.input?.asOf})).map(p=>p.name)].filter(name=>typeof name==='string'&&name))];}
function sourcePool(report){return [...(report.sources||[]),...(report.members||report.comparisonMembers||[]).flatMap(m=>m.sources||[]),...(report.members||report.comparisonMembers||[report]).flatMap(m=>require('./future-developments.cjs').sources(m.futureDevelopments))].filter(s=>s&&/^https?:\/\//.test(s.url||'')&&!/입지톡|네이버 공개 학원정보/.test(s.title||'')&&!SCHOOL_ACADEMIC.test(s.title||'')&&!/schoolinfo\.go\.kr|index\.go\.kr.*idx_cd=1539/.test(s.url));}
function rtms(url){try{return new URL(url).hostname==='rt.molit.go.kr';}catch{return false;}}
function selectSources(report,members,pool){
 const result=[],source=pool.find(s=>rtms(s.url)),coverage=[report,...members].flatMap(m=>m.prices?.coverage||[]).find(c=>c.status==='success'&&rtms(c.source));
 if(!report.demo&&(source||coverage))result.push({...source,id:source?.id||'rtms-contracts',label:'거래 자료',title:source?.title||'국토교통부 실거래가',url:source?.url||coverage.source,checkedAt:source?.checkedAt||coverage?.checkedAt||'조회일 미기록',assessmentNames:[]});
 for(const [index,name] of AXES.entries()){
  const rows=members.map(m=>m.scores?.find(s=>s.name===name)).filter(Boolean);
  const ids=new Set(rows.flatMap(s=>s.sourceIds||[]));
  const futureIds=new Set(members.flatMap(m=>(m.futureDevelopments?.projects||[]).filter(p=>p.axis===name).flatMap(p=>p.proofs.map(s=>s.url))));
  const candidates=pool.filter(s=>ids.has(s.id)||futureIds.has(s.url));
  candidates.sort((a,b)=>Number(/(?:\.go\.kr|schoolzone\.emac\.kr)/.test(b.url))-Number(/(?:\.go\.kr|schoolzone\.emac\.kr)/.test(a.url)));
  const source=candidates.find(s=>futureIds.has(s.url))||candidates[0];if(source){const existing=result.find(s=>s.url===source.url);if(existing){existing.label+=' · '+name;existing.assessmentNames.push(name);}else result.push({...source,label:name,assessmentNames:[name]});}
 }
 return result.slice(0,7);
}
function projectLegacyAcademy(report){
 const members=report.members?.map(projectLegacyAcademy),comparisonMembers=report.comparisonMembers?.map(projectLegacyAcademy),ev=report.assessment?.evidence;
 let out={...report,...(members?{members}:{}),...(comparisonMembers?{comparisonMembers}:{})};
 if(ev?.livingAccess?.version!=='2026-10-18-living-access-v1')return out;
 const access=require('./living-access.cjs'),snapshot=access.upgradeSnapshot(ev.livingAccess,{center:ev.center,asOf:report.input?.asOf}),evidence={...ev,livingAccess:snapshot,sources:[...(ev.sources||[])]},scores=(report.scores||[]).map(s=>({...s,sourceIds:[...(s.sourceIds||[])]}));
 const index=scores.findIndex(s=>s.name==='학원 환경');
 if(index>=0)scores[index]={name:'학원 환경',score:null,status:'withheld',coverage:0,scope:'평가 보류',sourceIds:[],observed:'입시·국어·영어·수학 평가 근거 미확인',reason:'기존 자료에서 현재 기준에 맞는 학원 근거를 검증하지 못했습니다.'};
 if(snapshot)access.apply(scores,evidence,{input:report.input});
 return {...out,scores,sources:[...(report.sources||[]),...evidence.sources],assessment:{...report.assessment,evidence,rubric:require('./scoring.cjs').RUBRIC}};
}
function prepare(report){
 if(report?.[READY])return report;
 report=require('./comparison-basis.cjs').repair(report);
 report=projectLegacyAcademy(report);
 const pool=sourcePool(report),members=report.members||report.comparisonMembers;
 const cleanOne=r=>{
  const rejected=unverifiedMallNames(r),cleanText=text=>sentences(facts(text)).filter(s=>!rejected.some(name=>s.includes(name))).join(' '),cleanList=items=>(items||[]).map(cleanText).filter(Boolean);
  const scoring=require('./scoring.cjs');if(scoring.repairCommerce)r=scoring.repairCommerce(r);
  r=require('./future-developments.cjs').sanitizeNarrative(r,r.futureDevelopments||{projects:(r.members||r.comparisonMembers||[]).flatMap(m=>m.futureDevelopments?.projects||[])});
  const scores=AXES.map(name=>{const source=r.scores?.find(s=>s.name===name);return source?{...source,sourceIds:[...(source.sourceIds||[])]}:{name,score:null,status:'withheld',scope:'평가 보류',reason:'해당 항목의 평가 근거가 저장되어 있지 않습니다.',observed:'',needed:'해당 항목의 평가 근거가 저장되어 있지 않습니다.',sourceIds:[]};});
  const count=scores.filter(s=>s.score!==null).length;
  const highlights= cleanList(r.highlights);if(!highlights.length)for(const name of ['교육 환경','병원 환경','학원 환경','교통 환경']){const fact=cleanText(scores.find(s=>s.name===name)?.observed);if(fact&&fact.length<=220&&!highlights.includes(fact))highlights.push(fact);if(highlights.length===3)break;}
  const features=[...new Set(cleanList([...(r.features||[]),...(r.limitations||[])])).values()].filter(s=>/공식|확인(?:됐|되|했|한)|등록|공표|지정|이력|판정|실측|검증|허가|처분|위반/.test(s));
  const publicData=require('./consultation.cjs').publicConsultation(r),limitations=[...new Set(cleanList(r.limitations))].filter(s=>!features.includes(s)),checks=[...new Set(cleanList(r.checks))];
  const sections=(r.sections||[]).filter(s=>!s.consultationSection&&!sectionHidden(s.heading)).map(s=>({...s,body:cleanText(s.body)})).filter(s=>s.body);
  const reminders=[...new Set([...limitations,...checks])].filter(t=>!sections.some(s=>s.body.includes(t)));
  if(reminders.length)sections.push({heading:'선택 전에 확인할 사항',body:reminders.join('\n')});
  return {...r,input:{...r.input,office:publicData.officeProfile.name,officeProfile:publicData.officeProfile,customer:publicData.customer},consultation:publicData,conclusion:'',highlights,strengths:cleanList(r.strengths),features,limitations,checks,issues:[],scores,prices:r.prices?{...r.prices,note:r.prices.rows?.length?'평균 금액: 억·만원(소수 첫째 자리 반올림) · 개별 계약별 산술평균':''}:r.prices,sections,assessment:{...r.assessment,summary:`평가 ${count}개 · 평가 보류 ${AXES.length-count}개. 별표(*)는 표시한 세부지표의 부분 평가입니다.`},methodology:'각 항목은 동일한 1~100점 기준으로 표시합니다. 별표(*)는 표시한 범위의 부분 평가입니다.'};
 };
 const out=cleanOne(report),cleanMembers=members?.map(cleanOne);
 if(report.comparisonMembers)out.scores=[];
 if(cleanMembers){if(report.members)out.members=cleanMembers;if(report.comparisonMembers)out.comparisonMembers=cleanMembers;}
 out.sections.push(...require('./customer-consultation.cjs').sections(out));
 const selected=selectSources(report,cleanMembers||[out],pool);out.customerSources=selected;out.sources=selected;
 if(cleanMembers)for(const member of cleanMembers){member.customerSources=selected;member.sources=selected;Object.defineProperty(member,READY,{value:true});}
 Object.defineProperty(out,READY,{value:true});return out;
}
function sources(report){return prepare(report).customerSources;}
function reference(report,score){const source=sources(report).find(s=>s.assessmentNames?.includes(score?.name));return source?score.name+' 대표 출처':'';}
function academySummary(score){return score?.observed||score?.reason||score?.needed||'학원 환경 평가에 필요한 근거가 부족합니다.';}
function displayScope(score){return score?.name==='학원 환경'?'입시·국어·영어·수학 직선 접근성':score?.scope||score?.name||'';}
function detail(score){if(score?.score==null)return score?.reason||score?.needed||score?.observed||'평가 근거가 저장되어 있지 않습니다.';return score?.observed||score?.reason||'표시한 범위의 근거로 평가했습니다.';}
const SCORE_NOTE='1~100점 · * 확인된 지표의 부분 평가 · 직선거리 · 근접 신호는 별도 거리 기준 · 학원은 출처가 확인된 등록 시설 좌표의 직선 접근성 · 상세 근거: 프로그램의 ‘상세 근거 보기’';
function scoreLabel(score){return Number.isInteger(score?.score)?score.score+'점'+(score.status==='partial'?'*':''):'평가 보류';}
function parkNote(report){if((report.members||report.comparisonMembers||[report]).some(m=>m.assessment?.evidence?.natureAccess?.selected))return '자연환경: 대표 대형공원·숲길·등산로·산책로의 확인된 지점 중 가장 가까운 곳의 직선 접근성을 부분 평가합니다. 실제 출입·보행·경사·통제 상태는 별도 확인합니다.';const members=report.members||report.comparisonMembers||[report],version=require('./regional-park.cjs').VERSION;return members.every(m=>m.assessment?.evidence?.nature?.version===version)?'자연환경: 대표공원 면적 50% 이상·최소 10만㎡·주변 5km의 가장 가까운 적격 공원 기준.':'자연환경: 보고서에 저장된 공원 선정 기준과 직선거리를 적용합니다.';}
function baseKeyEvidence(score,member={}){
 if(score?.score==null)return sentences(score?.reason||score?.needed||'평가 근거가 저장되어 있지 않습니다.')[0];
 const ev=member.assessment?.evidence||{},parts=score.calculation||[],fmt=n=>new Intl.NumberFormat('ko-KR',{maximumFractionDigits:1}).format(n),place=p=>p?.name&&Number.isFinite(p.distanceM)?p.name+' · 직선 '+fmt(p.distanceM)+'m':'';
 if(score.name==='교통 환경'){const p=ev.places?.find(p=>p.category==='subway'&&score.sourceIds?.includes(p.sourceId));if(p)return place(p);}
 if(score.name==='교육 환경'){const p=['school_elementary','school_middle','school_high'].map(category=>ev.places?.find(p=>p.category===category&&parts.some(c=>c.sourceId===p.sourceId))||ev.places?.find(p=>p.category===category&&score.sourceIds?.includes(p.sourceId))).filter(Boolean);if(p.length)return p.map(p=>(p.category==='school_elementary'?'초':p.category==='school_middle'?'중(인근)':'고(인근)')+' · '+p.name+' '+fmt(p.distanceM)+'m').join('\n');}
 if(score.name==='상권 환경'){const rows=parts.filter(c=>c.indicator&&['observed','empty'].includes(c.status));if(rows.length)return rows.map(c=>c.indicator.replace(/ 접근$/,'')+' · '+(c.facility&&Number.isFinite(c.value)?c.facility+' · 직선 '+fmt(c.value)+'m':c.status==='empty'?'반경 5km 지정 검색 내 미확인':'자료 미확인')).join('\n');const p=parts.map(c=>ev.places?.find(p=>p.sourceId===c.sourceId)).filter(Boolean);if(p.length)return [...new Map(p.map(p=>[p.id||p.name+'|'+p.distanceM,p])).values()].slice(0,3).map(place).join('\n');}
 if(score.name==='자연환경'){const p=ev.natureAccess?.selected||score.regionalPark||ev.nature?.selected;if(p)return place(p)+(ev.natureAccess?.selected?'\n'+p.pointRole:'');}
 if(score.name==='병원 환경'||score.name==='학원 환경'){
  const group=ev.livingAccess?.groups?.[score.name==='병원 환경'?'hospital':'academy'];
  if(group?.categories?.length){
   const short={general:'종합병원',pediatrics:'소아과',pediatric:'소아과',orthopedics:'정형외과',orthopedic:'정형외과',dental:'치과',entrance:'입시',korean:'국어',english:'영어',math:'수학'},item=c=>(short[c.key]||c.label)+' '+(Number.isFinite(c.nearest?.distanceM)?fmt(c.nearest.distanceM)+'m':c.status==='empty'?fmt(c.radiusM)+'m 내 미확인':'자료 미확인'),cats=group.categories;
   if(score.name==='병원 환경')return [cats.slice(0,2),cats.slice(2)].filter(xs=>xs.length).map(xs=>xs.map(item).join(' · ')).join('\n');
   const grouped=(keys,label)=>{const xs=cats.filter(c=>keys.includes(c.key));if(!xs.length)return '';if(xs.length===keys.length&&xs.every(c=>Number.isFinite(c.nearest?.distanceM))){const distances=xs.map(c=>c.nearest.distanceM),min=Math.min(...distances),max=Math.max(...distances);return label+' '+fmt(min)+(min===max?'':'~'+fmt(max))+'m';}return xs.map(item).join(' · ');};
   return [grouped(['entrance'],'입시'),grouped(['korean','english','math'],'국영수')].filter(Boolean).join('\n');
  }
 }
 if(score?.score==null)return sentences(score?.reason||score?.needed||'평가 근거가 저장되어 있지 않습니다.')[0];
 return sentences(score.observed||score.reason).slice(0,1).join(' ').split(' / ').slice(0,2).join(' · ');
}
function keyEvidence(score,member={}){const label=require('./ipzitalk-context.cjs').prefix(score,member),detail=baseKeyEvidence(score,member);return label?label+'\n'+detail:detail;}
function priceLabel(report){const offered=report.input?.offered,{money,averageMoney}=require('./core.cjs');if(Number.isFinite(offered)&&offered>0)return '제시가격 '+money(offered);const groups=(report.prices?.summaries||[]).filter(g=>g.kind==='trade'&&Number.isFinite(g.price)&&g.n>0);if(groups.length===1)return '실거래 평균 참고 '+averageMoney(groups[0].price);if(groups.length>1)return '면적별 실거래 평균 · 상세표 참조';return '매매 평균 자료 없음';}
function mapCaption(map={}){let ipji=/입지톡/.test(map.caption||'');try{ipji ||=new URL(map.url).hostname==='ipji-talk.com';}catch{}const provider=map.provider==='NAVER'||/NAVER Corp\./.test(map.caption||'')?'© NAVER Corp.':map.provider||'',date=String(map.capturedAt||map.capturedAtTime||'').slice(0,10);return ['출처: '+(ipji?'입지톡':map.sourceName||'지도'),provider,date?'캡처 '+date:'','거리 기준: 직선거리',map.legend||''].filter(Boolean).join(' · ');}
module.exports={AXES,prepare,sources,reference,detail,facts,factList,withoutAcademyDetails,academySummary,displayScope,priceLabel,priceBasisText:priceLabel,mapCaption,scoreLabel,keyEvidence,SCORE_NOTE,parkNote};
