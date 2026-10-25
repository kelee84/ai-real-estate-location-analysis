'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),{randomUUID,createHash}=require('node:crypto');
const root=path.resolve(__dirname,'../../../..'),src=path.join(root,'program/src'),load=name=>require(path.join(src,name+'.cjs'));
function build(bundle){
 if(bundle.kind!=='analysis-bundle-v1')return load('scoring').prepareReport(structuredClone(bundle));
 const core=load('core'),input=core.normalizeInput(bundle.input);
 if(!Array.isArray(bundle.contracts)||!Array.isArray(bundle.coverage))throw Error('공식 수집 contracts와 coverage가 필요합니다.');
 if(bundle.identity?.building&&!input.building)input.building=bundle.identity.building;
 const prices=core.aggregate(bundle.contracts,input,bundle.coverage);prices.buildingResolution=bundle.identity||null;
 const snapshots=Object.fromEntries(['school','product','nature','natureAccess','peers','listings','livingAccess','nearbyContext'].filter(k=>bundle.snapshots?.[k]!==undefined).map(k=>[k,bundle.snapshots[k]]));
 const scoring=load('scoring'),evidence=bundle.evidence||scoring.collectEvidence({input,prices,tools:bundle.tools||[],...snapshots}),checkedAt=bundle.dataCheckedAt||null;
 const base={title:(input.building||input.target)+' 입지 분석',conclusion:'확인된 자료로 항목별 조건을 비교했습니다.',highlights:[],strengths:[],limitations:[],checks:[],sections:[],sources:[],...(bundle.narrative||{})};
 const guard=load('evidence-guard'),guarded=guard.guardNarrative(base,{identifiers:[...guard.verifiedIdentifiers(input,prices),...(evidence.places||[]).map(p=>p.name),...(evidence.natureAccess?.trails||[]).map(p=>p.name)]});
 const narrative=load('future-developments').sanitizeNarrative(guarded.report,bundle.futureDevelopments||{projects:[]}),assessed=scoring.assessScores(narrative,{input,prices,previousEvidence:evidence,dataCheckedAt:checkedAt});
 const validated=core.validateReport({...narrative,scores:assessed.scores,sources:guard.alignSourceDates([...(narrative.sources||[]),...assessed.sources],{verifiedSources:assessed.sources,dataCheckedAt:checkedAt})});
 return {...validated.report,id:randomUUID(),input,prices,assessment:assessed.assessment,createdAt:new Date().toISOString(),dataCheckedAt:checkedAt,issues:validated.issues,map:bundle.map||null,trend:bundle.trend||null,futureDevelopments:bundle.futureDevelopments||null,consultation:load('consultation').getConsultation({input,consultation:bundle.consultation}),verification:{numericClaimsRejected:guarded.rejected,scope:'프로그램 엔진으로 계산했습니다. 원자료 출처와 최종 배치는 별도 검토가 필요합니다.'}};
}
async function write({inputFile,outDir}){
 inputFile=path.resolve(inputFile);outDir=path.resolve(outDir);if(outDir===path.dirname(inputFile))throw Error('원본 보존을 위해 새 출력 폴더를 사용해 주세요.');
 const report=build(JSON.parse(await fs.readFile(inputFile,'utf8')));await fs.mkdir(outDir,{recursive:true});
 for(const name of ['report.json','report.html','customer-summary.html','method/engine.json'])try{await fs.access(path.join(outDir,name));throw Error('이미 존재하는 출력 파일입니다: '+name);}catch(e){if(e.code!=='ENOENT')throw e;}
 const render=load('report'),validMap=load('map-capture').isValidatedMap,mapView={...report,map:validMap(report.map)?report.map:null,...(report.members?{members:report.members.map(m=>({...m,map:validMap(m.map)?m.map:null}))}:{})},image=await render.mapData(mapView,{path:()=>path.dirname(inputFile)});
 const html=render.html(report,image),summary=load('customer-summary').html(report,image),hashes={};
 for(const name of ['ipzitalk-context','nearby-context','research-query','research-cache','core','scoring','living-access','shopping','living-presentation','nature-access','customer-report','report-flow','report'])hashes[name+'.cjs']=createHash('sha256').update(await fs.readFile(path.join(src,name+'.cjs'))).digest('hex');
 const members=report.members||[report],needsMap=members.some(m=>m.input?.asset==='apartment'),hasImage=value=>typeof value==='string'&&value.startsWith('data:image/'),mapAttached=report.mode==='comparison'?hasImage(image?.overview)||needsMap&&members.every((m,i)=>m.input?.asset!=='apartment'||hasImage(image?.members?.[i])):hasImage(image);
 const record={programVersion:require(path.join(root,'program/package.json')).version,rubricVersion:report.assessment?.version||members[0]?.assessment?.version,sourceInput:path.basename(inputFile),executedAt:new Date().toISOString(),networkCalls:0,aiCalls:0,mapAttached,renderReviewRequired:true,limits:needsMap&&!mapAttached?['입지톡 검증 지도 미첨부: 확보 후 최종 출력 확인 필요']:[],scores:members.map(m=>({building:m.input.building||m.input.target,items:m.scores.map(s=>({name:s.name,score:s.score,status:s.status,scope:s.scope,coverage:s.coverage,reason:s.score==null?s.reason:undefined}))})),moduleSha256:hashes};
 for(const map of [report.map,...members.map(m=>m.map)].filter(validMap)){const name=path.basename(map.file);try{await fs.mkdir(path.join(outDir,'figures'),{recursive:true});await fs.copyFile(path.join(path.dirname(inputFile),'figures',name),path.join(outDir,'figures',name));}catch(e){if(e.code!=='ENOENT')throw e;}}
 await fs.mkdir(path.join(outDir,'method'),{recursive:true});await fs.writeFile(path.join(outDir,'report.json'),JSON.stringify(report,null,2));await fs.writeFile(path.join(outDir,'report.html'),html);await fs.writeFile(path.join(outDir,'customer-summary.html'),summary);await fs.writeFile(path.join(outDir,'method/engine.json'),JSON.stringify(record,null,2));return {outDir,programVersion:record.programVersion,mapAttached,renderReviewRequired:true};
}
if(require.main===module){const args=process.argv.slice(2);if(args.length!==4||args[0]!=='--input'||args[2]!=='--out'){console.error('Usage: node run-analysis.cjs --input <JSON> --out <NEW_DIRECTORY>');process.exitCode=1;}else write({inputFile:args[1],outDir:args[3]}).then(r=>console.log(JSON.stringify(r))).catch(e=>{console.error(e.message);process.exitCode=1;});}
module.exports={build,write};
