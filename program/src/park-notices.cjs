'use strict';
// Known contradictory inventory entries are checked against their official
// completion notices. Conflicts are quarantined, never silently rescaled.
const {boundedBytes}=require('./school-zone.cjs'),{todayKst}=require('./core.cjs');
const NOTICES=[
 {region:'28185',town:'송도동',lot:'10-35',name:/소리공원/,url:'https://www.ifez.go.kr/main/pst/view.do?pst_id=noti02&pst_sn=212181'},
 {region:'28185',town:'송도동',lot:'187-6',name:/첨단산업클러스터단지.*4호/,url:'https://www.ifez.go.kr/main/pst/view.do?pst_id=noti02&pst_sn=212177'},
 {region:'28185',town:'송도동',lot:'330-1',name:/랜드마크시티1호체육공원/,rounded:true,url:'https://www.ifez.go.kr/main/pst/view.do?pst_id=noti03&pst_sn=269365'}
];
function noticeArea(html,rule){
 const text=html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;|&#160;/gi,' ').replace(/\s+/g,' '),at=text.indexOf(rule.town+' '+rule.lot);
 if(at<0)throw Error('공식 준공 고시의 공원 소재지를 대조하지 못했습니다.');
 const tail=text.slice(at,at+700),match=tail.match(/면\s*적\s*[:：]\s*([\d,]+(?:\.\d+)?)\s*(?:㎡|m²|m2)/u),rounded=rule.rounded&&tail.match(/(\d+)만\s*(\d+)천㎡\s*규모로\s*조성/),area=rounded?Number(rounded[1])*10000+Number(rounded[2])*1000:Number(match?.[1]?.replaceAll(',',''));
 if(!Number.isFinite(area)||area<=0)throw Error('공식 준공 고시의 면적 항목을 읽지 못했습니다.');return area;
}
async function auditParks(rows,{signal,fetchImpl=fetch}={}){
 const out=[];
 for(const rule of NOTICES){const matched=rows.filter(r=>String(r.MANAGE_NO).startsWith(rule.region+'-')&&rule.name.test(String(r.PARK_NM).replace(/\s+/g,''))&&new RegExp(rule.town+'\\s+'+rule.lot+'(?=\\s|$)').test(String(r.LNMADR||'')));if(!matched.length)continue;
  let area,error;try{area=noticeArea((await boundedBytes(rule.url,{signal,fetchImpl,maxBytes:1024*1024})).toString('utf8'),rule);}catch(e){if(signal?.aborted)throw e;error=e.message;}
  for(const r of matched){const raw=Number(r.PARK_AR),conflict=area!=null&&Math.abs(raw-area)>Math.max(1,area*.05);out.push({id:String(r.MANAGE_NO),name:String(r.PARK_NM),inventoryAreaM2:raw,noticeAreaM2:area??null,status:error?'unverified':conflict?'conflict':'consistent',excluded:!!error||conflict,reason:error|| (conflict?'공개 목록과 공식 준공 고시의 면적이 달라 규모 비교에서 제외했습니다.':'공개 목록과 공식 준공 고시의 면적을 대조했습니다.'),source:{title:'인천경제자유구역청 · 공원 준공 고시',url:rule.url,checkedAt:todayKst()}});}
 }
 return out;
}
module.exports={auditParks,noticeArea};
