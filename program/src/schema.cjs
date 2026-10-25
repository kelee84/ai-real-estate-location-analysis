'use strict';
const string={type:'string'},strings={type:'array',items:string};
const {SCORE_ITEMS}=require('./core.cjs');
const object=properties=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
const reportSchema=object({
  title:string,conclusion:string,highlights:strings,
  sections:{type:'array',items:object({heading:string,body:string})},
  strengths:strings,limitations:strings,checks:strings,
  scores:{type:'array',minItems:SCORE_ITEMS.length,maxItems:SCORE_ITEMS.length,items:object({name:{type:'string',enum:SCORE_ITEMS},score:{type:['integer','null']},reason:string,method:string,sourceIds:strings})},
  sources:{type:'array',items:object({id:string,title:string,url:string,checkedAt:string})}
});
module.exports={reportSchema};
