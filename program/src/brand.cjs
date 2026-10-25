'use strict';
const {version:VERSION,productName:PRODUCT}=require('../package.json');
const {testVersion}=require('./release-policy.cjs');
// 사용자가 제공한 명함에서 확인한 공개 문의처. 전화번호는 포함하지 않는다.
const NAME='AI SHERPA',EMAIL='aisherpa01@gmail.com',INSTAGRAM='aisherpa_01';
// 사용자가 프로그램 홍보영상으로 지정한 공개 링크. 임의 외부 주소는 받지 않는다.
const PROMO_VIDEO_URL='https://www.instagram.com/p/Dexcr7WH2qR/';
const REPORT_CREDIT=`${NAME} ${PRODUCT}로 작성`;
function info(){return {name:NAME,product:PRODUCT,version:VERSION,testVersion,makerLine:`${NAME} 제작 · v${VERSION}`,reportCredit:REPORT_CREDIT,email:EMAIL,instagram:'@'+INSTAGRAM,instagramUrl:`https://www.instagram.com/${INSTAGRAM}/`,promoVideoUrl:PROMO_VIDEO_URL};}
function supportTarget(kind){
  if(kind==='email')return `mailto:${EMAIL}?subject=${encodeURIComponent(`${NAME} ${PRODUCT} v${VERSION} 문의`)}`;
  if(kind==='instagram')return info().instagramUrl;
  if(kind==='promo')return PROMO_VIDEO_URL;
  throw new Error('이메일·인스타그램 문의 또는 프로그램 소개 영상을 선택해 주세요.');
}
module.exports={NAME,VERSION,PRODUCT,EMAIL,INSTAGRAM,PROMO_VIDEO_URL,REPORT_CREDIT,info,supportTarget};
