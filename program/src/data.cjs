'use strict';
const {parse}=require('csv-parse/sync');
const {sixMonthWindow,rowToContract,normalize,clean}=require('./core.cjs');
const BASE='https://rt.molit.go.kr';
function parseDownload(bytes){
  try{
    // Reject damaged/binary responses before the CSV parser can embed a huge
    // field value in its error. Never strip bytes or accept partial contracts.
    if(bytes.includes(0))throw Object.assign(new Error('NUL byte'),{code:'NUL_BYTE'});
    return parse(new TextDecoder('euc-kr',{fatal:true}).decode(bytes),{relax_column_count:true,skip_empty_lines:true,max_record_size:64*1024});
  }catch(error){throw Object.assign(new Error('내려받은 공식 거래파일의 형식이 손상되어 내용을 확인할 수 없습니다.'),{code:'RTMS_INVALID_FILE',diagnostic:{code:/^[A-Z0-9_]{1,80}$/.test(error.code||'')?error.code:'DECODE_OR_PARSE_ERROR',line:Number.isInteger(error.lines)?error.lines:null,bytes:bytes.length}});}
}
class RtmsClient {
  constructor(){this.cookies=new Map();this.provinces=null;this.regions=new Map();}
  async request(route,form,signal,limit=20*1024*1024) {
    const r=await fetch(BASE+route,{method:form?'POST':'GET',headers:{'User-Agent':'RealEstateHelper/0.1','Referer':BASE+'/pt/xls/xls.do',...(form?{'Content-Type':'application/x-www-form-urlencoded'}:{}),...(this.cookies.size?{Cookie:[...this.cookies].map(([k,v])=>`${k}=${v}`).join('; ')}:{})},body:form?new URLSearchParams(form):undefined,signal:AbortSignal.any([signal||new AbortController().signal,AbortSignal.timeout(45000)])});
    for(const c of r.headers.getSetCookie()){const [kv]=c.split(';');const at=kv.indexOf('=');this.cookies.set(kv.slice(0,at),kv.slice(at+1));}
    if(!r.ok)throw new Error(`국토교통부 자료 연결 오류 (${r.status})`);
    if(Number(r.headers.get('content-length'))>limit)throw new Error('조회 자료가 너무 큽니다. 지역 또는 기간을 좁혀 주세요.');
    const reader=r.body.getReader(),chunks=[];let length=0;
    try{while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>limit)throw new Error('자료 크기 제한을 초과했습니다.');chunks.push(Buffer.from(value));}}catch(e){await reader.cancel().catch(()=>{});throw e;}
    return Buffer.concat(chunks);
  }
  async listProvinces(signal){
    if(this.provinces)return this.provinces;
    await this.request('/pt/xls/xls.do',null,signal);
    const rows=JSON.parse((await this.request('/data/sido.do',{},signal)).toString());
    if(!Array.isArray(rows)||!rows.length)throw new Error('시·도 목록을 확인할 수 없습니다.');
    return this.provinces=rows.map(r=>({code:String(r.signguCode),name:r.ctprvnNm}));
  }
  async listRegions(code,signal){
    if(this.regions.has(code))return this.regions.get(code);
    const rows=JSON.parse((await this.request('/data/sgg.do',{signguCode:code.slice(0,2)},signal)).toString());
    if(!Array.isArray(rows))throw new Error('시·군·구 목록을 확인할 수 없습니다.');
    const result=rows.map(r=>({code:String(r.signguCode),name:r.signguNm}));this.regions.set(code,result);return result;
  }
  async resolve(target,signal){
    const provinces=await this.listProvinces(signal),aliases={'서울':'서울특별시','부산':'부산광역시','대구':'대구광역시','인천':'인천광역시','광주':'광주광역시','대전':'대전광역시','울산':'울산광역시','세종':'세종특별자치시','경기':'경기도','강원':'강원특별자치도','충북':'충청북도','충남':'충청남도','전북':'전북특별자치도','전남':'전라남도','경북':'경상북도','경남':'경상남도','제주':'제주특별자치도'};
    for(const [short,full]of Object.entries({...aliases}))if(/시$/.test(full))aliases[short+'시']=full;
    const first=target.split(/\s/)[0],province=provinces.find(p=>p.name===first||p.name===aliases[first]);
    if(!province)throw Object.assign(new Error('시·도를 포함해 입력해 주세요. 예: 서울 송파구 잠실동 리센츠'),{code:'REGION_REQUIRED'});
    const regions=await this.listRegions(province.code,signal),n=normalize(target);
    const matches=regions.filter(r=>n.includes(normalize(r.name)));
    if(matches.length!==1)throw Object.assign(new Error('시·군·구를 명확히 입력해 주세요. 예: 경기 성남시 분당구 정자동 …'),{code:'REGION_AMBIGUOUS'});
    return {...matches[0],province};
  }
  form(input,region,deal,period){
    const p=period||sixMonthWindow(input.asOf),asset={apartment:'A',villa:'B','single-house':'C',officetel:'D',commercial:'E'}[input.asset];
    return {srhThingNo:asset,srhDelngSecd:deal==='trade'?'1':'2',srhAddrGbn:'1',srhLfstsSecd:'1',sidoNm:region.province.name,sggNm:region.name,emdNm:'전체',loadNm:'전체',areaNm:'전체',hsmpNm:'전체',mobileAt:'',srhFromDt:p.start,srhToDt:p.end,srhNewRonSecd:'',srhSidoCd:region.province.code.slice(0,2),srhSggCd:region.code,srhEmdCd:'',srhLoadCd:'',srhHsmpCd:'',srhRoadNm:'',srhArea:'',srhLrArea:'',srhFromAmount:'',srhToAmount:''};
  }
  async collect(input,onProgress=()=>{},signal,{catalog,period}={}){
    let region,identity;const rows=[],coverage=[],raw=[];
    try{region=await this.resolve(input.target,signal);}catch(e){if(signal?.aborted)throw e;return {rows,raw,propertyError:e.message,coverage:[{deal:'trade',status:'error',message:e.message},{deal:'rent',status:'error',message:e.message}]};}
    if(['apartment','villa','officetel'].includes(input.asset)){
      try{identity=catalog?.identity||(await require('./property-identity.cjs').resolveProperty(this,input,signal,{region})).identity;onProgress(`확인한 공식 단지: ${identity.building} · ${identity.town} ${identity.lot||''}`);}
      catch(e){if(signal?.aborted)throw e;return {rows,raw,region,propertyError:e.message,coverage:[{deal:'trade',status:'error',message:e.message},{deal:'rent',status:'error',message:e.message}]};}
    }
    const deals=[...(input.types.includes('trade')?['trade']:[]),...(input.types.some(x=>x!=='trade')?['rent']:[])];
    for(const deal of deals){
      if(input.asset==='commercial'){coverage.push({deal,status:'error',message:'상가 공개 자료의 건물 식별·면적 기준은 개별 확인이 필요합니다. 자료 파일을 첨부해 주세요.'});continue;}
      onProgress(`${region.province.name} ${region.name} ${deal==='trade'?'매매':'전월세'} 자료 확인 중`);
      const form=this.form(input,region,deal,period);
      for(let attempt=0;attempt<2;attempt++){
      if(signal?.aborted)throw signal.reason||new Error('분석을 중지했습니다.');
      try{
        const countData=JSON.parse((await this.request('/pt/xls/ptXlsDownDataCheck.do',form,signal)).toString());
        const count=Number(countData.cnt);if(!Number.isInteger(count)||count<0||count>100000)throw new Error('공식 자료의 건수를 확인할 수 없습니다.');
        if(!count){coverage.push({deal,status:'empty',count:0,attempts:attempt+1});break;}
        const bytes=await this.request('/pt/xls/ptXlsCSVDown.do',form,signal);
        const lines=parseDownload(bytes),headIndex=lines.findIndex(r=>r[0]?.replace(/^\uFEFF/,'').trim()==='NO');
        if(headIndex<0)throw new Error('공식 거래 자료의 표 머리글을 찾지 못했습니다.');
        const head=lines[headIndex].map(x=>x.trim()),body=lines.slice(headIndex+1);
        if(body.length!==count)throw Object.assign(new Error(`조회 건수(${count})와 내려받은 건수(${body.length})가 달라 계산을 중단했습니다.`),{code:'RTMS_COUNT_MISMATCH'});
        const required=['시군구','계약년월','계약일',...(deal==='trade'?['거래금액(만원)','해제사유발생일']:['보증금(만원)','월세금(만원)'])];
        if(!required.every(k=>head.includes(k)))throw new Error('거래 자료의 필수 항목이 없어 가격·해제 여부를 검증할 수 없습니다.');
        const contracts=body.map(r=>{if(r.length!==head.length)throw new Error('거래 자료의 열 수가 맞지 않습니다.');return rowToContract(Object.fromEntries(head.map((k,i)=>[k,clean(r[i])])),deal);});
        if(contracts.some(t=>!normalize(t.location).includes(normalize(region.name))))throw new Error('지역 조건과 다른 자료가 포함되어 평균 산출을 중단했습니다.');
        const lot=value=>String(value||'').split('-').map(n=>/^\d+$/.test(n)?String(Number(n)):n).join('-');
        const matched=identity?contracts.filter(t=>normalize(t.building)===normalize(identity.building)&&t.location.split(/\s+/).includes(identity.town)&&(!identity.lot||lot(t.lot)===lot(identity.lot))):contracts;
        rows.push(...matched);raw.push({deal,bytes:bytes.toString('base64'),form});coverage.push({deal,status:'success',count,propertyCount:matched.length,source:BASE+'/pt/xls/xls.do',checkedAt:new Date().toISOString(),attempts:attempt+1});break;
      }catch(e){if(signal?.aborted)throw e;if(['RTMS_COUNT_MISMATCH','RTMS_INVALID_FILE'].includes(e.code)&&attempt===0){onProgress(`${deal==='trade'?'매매':'전월세'} ${e.code==='RTMS_INVALID_FILE'?'거래파일을 정상적으로 읽지 못해':'조회 건수와 파일 건수가 달라'} 같은 조건의 공식 자료를 한 번 다시 확인하고 있습니다.`);continue;}coverage.push({deal,status:'error',message:e.message,attempts:attempt+1,...(e.diagnostic?{diagnostic:e.diagnostic}:{})});break;}
      }
    }
    return {rows,raw,coverage,region,identity};
  }
  async collectTrend(input,onProgress,signal,{identity}={}){
    this.trendCache??=new Map();const key=JSON.stringify([input.target,input.asset,input.asOf,identity?.code,identity?.lot]);
    const saved=this.trendCache.get(key);if(saved&&Date.now()-saved.time<10*60*1000)return saved.result;
    const result=await this.collect({...input,types:['trade']},onProgress,signal,{catalog:identity?{identity}:undefined,period:require('./core.cjs').monthWindow(input.asOf,12)});
    if(!result.propertyError&&!result.coverage.some(c=>c.status==='error')){if(this.trendCache.size>=12)this.trendCache.delete(this.trendCache.keys().next().value);this.trendCache.set(key,{time:Date.now(),result});}return result;
  }
}
module.exports={RtmsClient};
