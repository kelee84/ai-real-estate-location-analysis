'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
// Minimal event/DOM adapter: runs the shipped controller, including real async
// handlers. It does not claim browser layout or Electron rendering coverage.
class Element{
 constructor(tag='div'){Object.assign(this,{tag,children:[],listeners:{},attrs:{},value:'',className:'',disabled:false,isConnected:true,dataset:{}});this.classList={contains:c=>this.className.split(' ').includes(c),add:c=>this.classList.toggle(c,true),remove:c=>this.classList.toggle(c,false),toggle:(c,on)=>{const s=new Set(this.className.split(' ').filter(Boolean));if(on??!s.has(c))s.add(c);else s.delete(c);this.className=[...s].join(' ');}};}
 append(...items){for(const e of items){this.children.push(e);e.parent=this;}}
 replaceChildren(...items){this.children=[];this.append(...items);}
 setAttribute(k,v){this.attrs[k]=v;}removeAttribute(k){delete this.attrs[k];}
 contains(e){return this===e||this.children.some(c=>c.contains(e));}
 closest(selector){return this.classList.contains(selector.slice(1))?this:this.parent?.closest(selector)||null;}
 addEventListener(n,fn){(this.listeners[n]??=[]).push(fn);}
 async emit(n){for(const fn of this.listeners[n]||[])await fn({preventDefault(){},key:'Enter'});}
 querySelectorAll(selector){const matches=e=>selector.split(',').some(s=>s==='input:checked'?e.tag==='input'&&e.checked:s.startsWith('[data-field=')?e.dataset.field===s.slice(12,-1):e.tag===s);const result=[];for(const c of this.children){if(matches(c))result.push(c);result.push(...c.querySelectorAll(selector));}return result;}
 querySelector(s){return this.querySelectorAll(s)[0]||null;}
 focus(options){if(!this.disabled){this.focused=true;this.focusOptions=options;}}
 scrollIntoView(options){this.scrolled=options;}
}
const catalog={target:'인천 연수구 송도동 가상단지',building:'가상단지',requestedBuilding:'',asset:'apartment',areas:[59.9201,84.8682],token:'catalog',checkedAt:new Date().toISOString(),sourceName:'공식 면적',scope:'검증용'};
function mount(api){
 const fields=new Map(),root=new Element();for(const id of ['target','asset','building','asOf','force-refresh','area']){const e=new Element(id==='asset'?'select':'input');fields.set(id,e);root.append(e);}fields.set('single-fields',root);fields.get('target').value=catalog.target;fields.get('asset').value='apartment';fields.get('asOf').value='2026-10-30';
 const notices=[],context=vm.createContext({document:{createElement:t=>new Element(t)},$:id=>fields.get(id),state:{busy:false},api,toast:(...x)=>notices.push(x),Intl,Date});
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/web/type-picker.js'),'utf8'),context);
 return {p:vm.runInContext("typePickers.get('single')",context),fields,notices};
}
test('검색 오류 후 입력을 보존하고 재검색/면적 직접 입력을 복구',async()=>{
 let calls=0;const ui=mount({'search-types':async()=>{if(++calls===1)throw Error('면적 조회 실패');return catalog;}});
 await ui.p.search.emit('click');assert.equal(ui.p.search.disabled,false);assert.equal(ui.p.manual.classList.contains('hidden'),false);assert.equal(ui.fields.get('target').value,catalog.target);assert.equal(ui.fields.get('area').disabled,false);
 await ui.p.search.emit('click');assert.equal(ui.p.boxes.querySelectorAll('input').length,2);assert.equal(ui.fields.get('area').disabled,true);assert.equal(ui.p.selecting,false);
 await ui.p.manual.emit('click');assert.equal(ui.fields.get('area').disabled,false);assert.equal(ui.p.catalog,null);
});
test('연속 클릭 요청은 한 번만 보내고 조건 변경 후 늦은 결과를 표시하지 않음',async()=>{
 let resolve,calls=0;const cancelled=[];const ui=mount({'search-types':()=>{calls++;return new Promise(r=>resolve=r);},'cancel-search':async id=>cancelled.push(id)});
 const pending=ui.p.search.emit('click');await ui.p.search.emit('click');assert.equal(calls,1);assert.equal(ui.p.cancel.classList.contains('hidden'),false);
 ui.fields.get('target').value='새 단지';await ui.fields.get('target').emit('input');resolve(catalog);await pending;
 assert.equal(cancelled.length,1);assert.equal(ui.p.catalog,null);assert.equal(ui.p.boxes.querySelectorAll('input').length,0);assert.equal(ui.p.search.disabled,false);
});
test('중지 버튼은 해당 요청만 취소하고 다음 검색이 가능',async()=>{
 let resolve;const ids=[],ui=mount({'search-types':()=>new Promise(r=>resolve=r),'cancel-search':async id=>ids.push(id)});
 const pending=ui.p.search.emit('click');await ui.p.cancel.emit('click');assert.equal(ids.length,1);assert.equal(ui.p.selecting,false);assert.equal(ui.p.search.disabled,false);assert.match(ui.p.note.textContent,/중지/);
 resolve(catalog);await pending;assert.equal(ui.p.catalog,null);
});
test('기준일/새 조회 조건 변경도 기존 타입을 무효화',async()=>{
 const ui=mount({'search-types':async()=>catalog});await ui.p.search.emit('click');ui.fields.get('asOf').value='2026-10-29';await ui.fields.get('asOf').emit('change');assert.equal(ui.p.catalog,null);assert.equal(ui.p.invalidated,true);
});

test('검색 완료 후 면적 선택을 활성화한 뒤 초점을 주고 결과 위치를 표시',async()=>{
 const ui=mount({'search-types':async()=>catalog});
 await ui.p.search.emit('click');
 const checkbox=ui.p.boxes.querySelector('input');
 assert.equal(checkbox.disabled,false);assert.equal(checkbox.focused,true);
 assert.equal(ui.p.boxes.scrolled?.block,'start');
 assert.equal(ui.p.search.textContent,'단지·타입 검색');
});

test('단일 후보 검색과 공식 재확인에서도 후보 버튼을 활성화한 뒤 화면에 표시',async()=>{
 const candidate={id:'naver-123',name:'가상단지',address:'인천 연수구 송도동 1',road:'가상로 2'};
 const found={kind:'candidates',searchToken:'search',candidates:[candidate]};
 let selects=0;
 const ui=mount({'search-types':async()=>found,'select-property':async()=>++selects===1?{...found,searchToken:'official',candidates:[{...candidate,id:'rtms-123'}]}:catalog});
 await ui.p.search.emit('click');
 assert.equal(ui.p.choices.querySelector('input').classList.contains('hidden'),true);
 let button=ui.p.choices.querySelector('button');
 assert.equal(button.disabled,false);assert.equal(button.focused,true);assert.equal(ui.p.choices.scrolled?.block,'start');
 await button.emit('click');button=ui.p.choices.querySelector('button');
 assert.equal(button.dataset.candidateId,'rtms-123');assert.equal(button.focused,true);assert.equal(button.disabled,false);
 await button.emit('click');assert.equal(ui.p.boxes.querySelector('input').focused,true);
});

test('복수 후보는 필터를 유지하며 검색 중 진행 상태가 보이고 취소 후 늦은 결과는 초점을 옮기지 않음',async()=>{
 let done;const ui=mount({'search-types':()=>new Promise(resolve=>done=resolve),'cancel-search':async()=>{}});
 const pending=ui.p.search.emit('click');assert.match(ui.p.search.textContent,/조회 중/);
 await ui.p.cancel.emit('click');done(catalog);await pending;
 assert.equal(ui.p.boxes.scrolled,undefined);assert.equal(ui.p.choices.scrolled,undefined);
 assert.equal(ui.p.search.focused,true);assert.equal(ui.p.search.textContent,'단지·타입 검색');
 const candidates=[{id:'a',name:'가상단지',address:'서울 1',road:''},{id:'b',name:'가상단지',address:'인천 2',road:''}];
 const multiple=mount({'search-types':async()=>({kind:'candidates',searchToken:'s',candidates})});
 await multiple.p.search.emit('click');const filter=multiple.p.choices.querySelector('input');
 assert.equal(filter.classList.contains('hidden'),false);assert.equal(filter.disabled,false);assert.equal(filter.focused,true);
});
