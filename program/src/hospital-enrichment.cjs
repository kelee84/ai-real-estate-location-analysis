'use strict';
// Official registration proof is retained independently of the report prose.
function attach(evidence,snapshot,{identity,asOf}={}){
 const hospital=require('./public-hospitals.cjs'),context={center:evidence?.center,identity,asOf};
 if(!evidence||!hospital.verified(snapshot,context))return evidence;
 evidence.hospitalSnapshot=structuredClone(snapshot);
 evidence.livingAccess=hospital.mergeLiving(evidence.livingAccess,snapshot,context);
 evidence.sources||=[];
 for(const c of evidence.livingAccess?.groups?.hospital?.categories||[])if(c.nearest?.provider===hospital.PROVIDER&&hospital.validCategory(c,context))evidence.sources.push(hospital.source(c.nearest));
 evidence.sources=[...new Map(evidence.sources.map(s=>[s.id,s])).values()];return evidence;
}
module.exports={attach};
