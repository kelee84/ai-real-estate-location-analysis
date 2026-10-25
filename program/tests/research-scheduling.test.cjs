'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {AnalysisService}=require('../src/service.cjs'),{runQueries}=require('../src/research-query.cjs');
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
test('public downloads overlap while Naver waits for Archhub and preserves all results',async()=>{
 const service=Object.create(AnalysisService.prototype),gates=Array.from({length:3},deferred),started=[],prices={};
 service.reuseArchhub=async()=>{started.push('arch');await gates[0].promise;prices.archhub='official';};
 service.reuseNaverLand=async()=>{assert.equal(prices.archhub,'official');started.push('naver');prices.naverLand='fallback';};
 service.reuseSbiz=async()=>{started.push('sbiz');await gates[1].promise;prices.sbizSnapshot='quarterly';};
 service.reuseHospitals=async()=>{started.push('hospital');await gates[2].promise;prices.hospitalSnapshot='daily';};
 const job=service.reuseComplexBasics({},prices);assert.deepEqual(started,['arch','sbiz','hospital']);gates[1].resolve();gates[2].resolve();await Promise.resolve();assert.ok(!started.includes('naver'));gates[0].resolve();await job;
 assert.deepEqual(prices,{sbizSnapshot:'quarterly',hospitalSnapshot:'daily',archhub:'official',naverLand:'fallback'});
});
test('a failed provider waits for already-running jobs before leaving the report phase',async()=>{
 const service=Object.create(AnalysisService.prototype),gate=deferred(),error=Error('cancelled');let finished=false,left=false;
 service.reuseArchhub=async()=>{throw error;};service.reuseNaverLand=async()=>assert.fail('dependent fallback must not start');service.reuseSbiz=async()=>{await gate.promise;finished=true;};service.reuseHospitals=async()=>{};
 const job=service.reuseComplexBasics({},{});job.catch(()=>{left=true;});await new Promise(r=>setImmediate(r));assert.equal(left,false);gate.resolve();await assert.rejects(job,e=>e===error);assert.equal(finished,true);
});
test('facility queue overlaps at most three tasks and stops scheduling after failure',async()=>{
 const gates=Array.from({length:5},deferred),started=[],finished=[];
 const job=runQueries(gates.map((g,i)=>async()=>{started.push(i);await g.promise;finished.push(i);}));assert.deepEqual(started,[0,1,2]);gates[0].reject(Error('cancel'));await new Promise(r=>setImmediate(r));assert.deepEqual(started,[0,1,2]);gates[1].resolve();gates[2].resolve();await assert.rejects(job,/cancel/);assert.deepEqual(finished,[1,2]);
});
