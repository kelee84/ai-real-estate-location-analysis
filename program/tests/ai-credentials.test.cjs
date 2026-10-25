'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {CredentialStore,validApiKey,GEMINI_API_KEY_MAX_LENGTH}=require('../src/ai-credentials.cjs');
const key='AIza0123456789_TEST_API_KEY_NO_NETWORK';
function secureStorage(overrides={}){
  return {isEncryptionAvailable:()=>true,getSelectedStorageBackend:()=> 'dpapi',encryptString:value=>Buffer.from('encrypted:'+Buffer.from(value).toString('base64')),decryptString:value=>{if(!value.toString().startsWith('encrypted:'))throw new Error(key);return Buffer.from(value.toString().slice(10),'base64').toString();},...overrides};
}
async function fixture(t,safeStorage=secureStorage()){
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'re-gemini-key-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const file=path.join(dir,'private','gemini-key.json');return {dir,file,store:new CredentialStore({file,safeStorage})};
}

test('Gemini key persistence contains only an OS-encrypted envelope and public status has no secret',async t=>{
  const {store,file}=await fixture(t);assert.deepEqual(await store.status(),{configured:false,available:true});assert.equal(await store.readApiKey(),null);
  assert.deepEqual(await store.saveApiKey('  '+key+'  '),{configured:true,available:true});
  const content=await fs.readFile(file,'utf8'),record=JSON.parse(content);
  assert.equal(record.version,1);assert.equal(record.provider,'gemini');assert.doesNotMatch(content,new RegExp(key));
  assert.equal(Object.keys(record).length,3);assert.equal(await store.readApiKey(),key);
  assert.doesNotMatch(JSON.stringify(await store.status()),new RegExp(key));
  assert.deepEqual(await store.clear(),{configured:false,available:true});assert.equal(await store.readApiKey(),null);
  await store.clear();
});

test('replacing a key is atomic and old plaintext does not survive on disk',async t=>{
  const {store,file}=await fixture(t);await store.saveApiKey(key);const next='AIzaNEXT0123456789_TEST_KEY_NO_NETWORK';await store.saveApiKey(next);
  assert.equal(await store.readApiKey(),next);assert.deepEqual(await fs.readdir(path.dirname(file)),[path.basename(file)]);
  assert.doesNotMatch(await fs.readFile(file,'utf8'),/AIza/);
});

test('unavailable OS encryption and Linux basic_text fallback fail closed without writing a file',async t=>{
  for(const safeStorage of [undefined,secureStorage({isEncryptionAvailable:()=>false}),secureStorage({getSelectedStorageBackend:()=> 'basic_text'}),secureStorage({isEncryptionAvailable:()=>{throw new Error(key);}})]){
    const {store,file}=await fixture(t,safeStorage);if(!safeStorage)store.safeStorage=undefined;
    assert.deepEqual(await store.status(),{configured:false,available:false});
    await assert.rejects(store.saveApiKey(key),error=>/보안 저장 기능/.test(error.message)&&!error.message.includes(key));
    await assert.rejects(fs.access(file));await assert.rejects(store.readApiKey(),/보안 저장 기능/);
  }
});

test('OS encryption errors never expose the key and plaintext returned by a broken provider is rejected',async t=>{
  for(const encryptString of [()=>{throw new Error(key);},value=>Buffer.from(value),()=> 'not a Buffer',()=>Buffer.alloc(0)]){
    const {store,file}=await fixture(t,secureStorage({encryptString}));
    await assert.rejects(store.saveApiKey(key),error=>/보안 저장/.test(error.message)&&!error.message.includes(key));await assert.rejects(fs.access(file));
  }
});

test('corrupt, copied or plaintext credential files cannot become a valid key',async t=>{
  const {store,file}=await fixture(t);await fs.mkdir(path.dirname(file));
  const values=[key,JSON.stringify({apiKey:key}),JSON.stringify({version:1,provider:'gemini',encrypted:'not-base64'}),JSON.stringify({version:1,provider:'gpt',encrypted:Buffer.from(key).toString('base64')}),JSON.stringify({version:1,provider:'gemini',encrypted:Buffer.from(key).toString('base64')}),'x'.repeat(17000)];
  for(const value of values){await fs.writeFile(file,value);await assert.rejects(store.readApiKey(),error=>!error.message.includes(key)&&/연결정보/.test(error.message));}
  store.safeStorage=secureStorage({decryptString:()=>{throw new Error(key);}});await fs.writeFile(file,JSON.stringify({version:1,provider:'gemini',encrypted:Buffer.from('encrypted:aaa').toString('base64')}));
  await assert.rejects(store.readApiKey(),error=>!error.message.includes(key));
});

test('bad key inputs are rejected before saving and write failures are sanitized',async t=>{
  for(const input of [null,1,'','short','a'.repeat(GEMINI_API_KEY_MAX_LENGTH+1),key+'\nother',key+'\tother',key+'\0',key+' space',key+'한'])assert.throws(()=>validApiKey(input));
  const {dir}=await fixture(t);const blocked=path.join(dir,'occupied');await fs.writeFile(blocked,'occupied');
  const store=new CredentialStore({file:path.join(blocked,'key.json'),safeStorage:secureStorage()});
  await assert.rejects(store.saveApiKey(key),error=>/저장 위치/.test(error.message)&&!error.message.includes(key));
});

test('opaque Gemini authorization keys retain periods, punctuation and lengths beyond legacy limits when securely persisted',async t=>{
  const {store,file}=await fixture(t);
  for(const secret of ['AQ.'+'SYNTHETIC_ONLY_'.repeat(50)+'+/=.:!@#$%^&*()[]{}\\|;\'"<>?,`~', 'AQ.'+'X'.repeat(GEMINI_API_KEY_MAX_LENGTH-3)]){
    assert.equal(validApiKey(' \r\n'+secret+'\r\n '),secret);await store.saveApiKey(secret);
    assert.equal(await store.readApiKey(),secret);assert.ok(!(await fs.readFile(file,'utf8')).includes(secret));assert.equal((await store.status()).configured,true);
  }
  assert.throws(()=>validApiKey('AQ.'+'X'.repeat(550),'claude'),/Claude API 키/);
  assert.throws(()=>validApiKey('sk-ant-'+ 'X'.repeat(506),'claude'),/Claude API 키/);
  assert.throws(()=>validApiKey('AQ.'+'X'.repeat(50),'claude'),/Claude API 키/);
});

test('Claude keys use a separate encrypted envelope and cannot be read as Gemini credentials',async t=>{
  const {dir,store:gemini}=await fixture(t);
  const file=path.join(dir,'claude-key.enc'),claude=new CredentialStore({file,safeStorage:secureStorage(),provider:'claude'});
  const secret='sk-ant-api03-TEST_CLAUDE_KEY_NO_NETWORK';
  await gemini.saveApiKey(key);await claude.saveApiKey(secret,{workspaceId:'wrkspc_fixture123'});
  const saved=await fs.readFile(file,'utf8');assert.equal(JSON.parse(saved).provider,'claude');assert.equal(JSON.parse(saved).version,2);assert.ok(!saved.includes(secret));assert.ok(!saved.includes('wrkspc_fixture123'));
  assert.deepEqual(await claude.readConnection(),{apiKey:secret,workspaceId:'wrkspc_fixture123'});
  assert.equal(await claude.readApiKey(),secret);assert.equal(await gemini.readApiKey(),key);
  const wrongProvider=new CredentialStore({file,safeStorage:secureStorage()});
  await assert.rejects(wrongProvider.readApiKey(),/연결정보/);
  await claude.clear();assert.equal(await gemini.readApiKey(),key);
  await assert.rejects(claude.saveApiKey('bad'),/Claude API 키/);
  await assert.rejects(claude.saveApiKey(secret,{workspaceId:'wrkspc_x\r\nx-secret: value'}),/워크스페이스/);
});
