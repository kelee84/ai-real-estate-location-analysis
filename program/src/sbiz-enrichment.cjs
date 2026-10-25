'use strict';
// Public registry records supplement missing observations. They never replace a
// valid, newer observation, nor establish a current absence or operating status.
function attach(evidence,snapshot,{identity,asOf}={}){
 const sbiz=require('./sbiz-evidence.cjs'),shopping=require('./shopping.cjs'),context={center:evidence?.center,identity,asOf};
 if(!evidence||!sbiz.verified(snapshot,context))return evidence;
 evidence.sbiz=structuredClone(snapshot);
 evidence.livingAccess=sbiz.mergeLiving(evidence.livingAccess,snapshot,context);
 evidence.places||=[];evidence.sources||=[];
 const entrance=evidence.livingAccess?.groups?.academy?.categories.find(c=>c.key==='entrance')?.nearest;
 if(entrance?.provider==='sbiz-csv'&&sbiz.validPlace(entrance,context))evidence.sources.push(sbiz.source(entrance));
 const daily=shopping.dailyCurrent(evidence,{asOf}),existing=evidence.places.some(p=>p.category==='supermarket'&&p.distanceM<=1500&&shopping.supermarket(p)&&p.provider!=='sbiz-csv');
 if(!daily&&!existing){
  const p=sbiz.nearest(snapshot,'supermarket',context);
  if(p){
   evidence.places=evidence.places.filter(p=>p.provider!=='sbiz-csv'||p.category!=='supermarket');
   evidence.places.push(p);evidence.places.sort((a,b)=>a.distanceM-b.distanceM);
   evidence.sources.push(sbiz.source(p));
   evidence.dailyShopping={version:'sbiz-daily-shopping-v1',provider:'sbiz-csv',asOf,center:{...evidence.center},radiusM:1500,status:'received',returned:1,complete:false,nearestProven:false,checkedAt:p.checkedAt,sourceDate:p.sourceDate,nearest:p,scope:'분기 상가정보에 등록된 슈퍼마켓의 직선 접근성. 현재 운영과 실제 보행 동선은 별도 확인합니다.'};
  }
 }
 evidence.sources=[...new Map(evidence.sources.map(s=>[s.id,s])).values()];return evidence;
}
module.exports={attach};
