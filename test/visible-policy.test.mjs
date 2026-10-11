import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { discoverLocalWorlds, writePayload } from '../src/local-worlds.mjs';
import { LocalRecords } from '../src/local-records.mjs';
import { execFileSync } from 'node:child_process';
import { createServer, request as httpRequest } from 'node:http';
import { validateTransportSettings, transportPolicy } from '../src/transport-policy.mjs';
import { absentOnly } from '../src/resource-errors.mjs';
import { validateType } from '#contracts';
import { LocalCourier } from '../src/local-courier.mjs';
import { ENGINE_GUARDS } from '../src/safety-capabilities.mjs';
import { PAYLOAD_VERSION } from '../src/version.mjs';

test('handshake requires both explicit paired settings rather than filling missing defaults',async()=>{
  const manifest={worldRef:'fixture',payloadDigest:'fixture-digest'};
  const courier=new LocalCourier(manifest,{token:'a'.repeat(64)});
  for(const transportSettings of [{},{courierBodyBytes:4194304},{courierResultWaitMs:30000}]) {
    courier.dispatch=async()=>({worldRef:manifest.worldRef,payloadVersion:PAYLOAD_VERSION,payloadMatches:true,
      loadedSourceDigest:manifest.payloadDigest,engineGuards:ENGINE_GUARDS,transportSettings});
    await assert.rejects(()=>courier.handshake(),error=>error.source?.kind==='INVALID_CONFIG');
  }
  courier.dispatch=async()=>({worldRef:manifest.worldRef,payloadVersion:PAYLOAD_VERSION,payloadMatches:true,
    loadedSourceDigest:manifest.payloadDigest,engineGuards:ENGINE_GUARDS,transportSettings:{courierBodyBytes:4194304,courierResultWaitMs:30000}});
  await courier.handshake();
});

async function world(t) {
  await mkdir(process.env.HW_ADAPTER_TEST_ROOT??tmpdir(),{recursive:true});
  const root=await mkdtemp(join(process.env.HW_ADAPTER_TEST_ROOT??tmpdir(),'policy-'));
  const worldPath=join(root,'world'); await mkdir(join(worldPath,'worldmods/hanaworlds_adapter'),{recursive:true});
  await writeFile(join(worldPath,'world.mt'),'gameid = fixture\n');
  return {root,worldPath,dir:join(worldPath,'worldmods/hanaworlds_adapter')};
}
test('only truly absent identity is MISSING; corrupt and unreadable identities refuse with source', async t=>{
  const f=await world(t); assert.equal((await discoverLocalWorlds([f.root]))[0].payloadStatus,'MISSING');
  await writeFile(join(f.dir,'payload.json'),'{');
  await assert.rejects(()=>discoverLocalWorlds([f.root]),e=>e.message==='PAYLOAD_VERSION_MISMATCH' && e.source?.resource==='payload-identity' && e.source.kind==='CORRUPT');
});
test('malformed records never become an empty journal',async t=>{
  const f=await world(t); await writeFile(join(f.root,'local-world-state'),'{');
  await assert.rejects(()=>LocalRecords.open(f.root,'world'),e=>e.message==='SAVED_RESOURCE_UNAVAILABLE'&&e.source?.kind==='CORRUPT');
  await writeFile(join(f.root,'local-world-state'),JSON.stringify({version:'contracts@2.0.0',worldRef:'world'}));
  await assert.rejects(()=>LocalRecords.open(f.root,'world'),e=>e.message==='SAVED_RESOURCE_UNAVAILABLE');
});
test('oversized read and write commands are refused before queueing',async()=>{
  const c=new LocalCourier({worldRef:'luanti:fixture'},{token:'a'.repeat(64)});
  for(const op of ['region_read','region_write','snapshot','restore']) {
    await assert.rejects(()=>c.dispatch(op,{oversized:'x'.repeat(4194304)}),e=>e.message==='LIMIT_EXCEEDED'&&e.beforeNativeDispatch===true);
    assert.equal(c.queue.length,0);
  }
});

test('permission and IO are distinct from absent identity; public errors preserve only safe source',async t=>{
  const f=await world(t), path=join(f.dir,'payload.json'); await writeFile(path,'{}');await chmod(path,0);
  try { await assert.rejects(()=>discoverLocalWorlds([f.root]),e=>e.source?.kind==='PERMISSION'&&e.source.nativeCode==='EACCES'); }
  finally {await chmod(path,0o600);}
  for(const [code,kind] of [['EIO','IO'],['EPERM','PERMISSION']])
    await assert.rejects(()=>absentOnly(()=>Promise.reject(Object.assign(Error('private text'),{code})),'ADAPTER_UNAVAILABLE','discover','payload-identity'),e=>e.source.kind===kind&&e.source.nativeCode===code);
});
test('Node and independent Lua validators agree on defaults, both inclusive ranges and bad settings',()=>{
  const defaults=validateTransportSettings();
  for(const [key,min,max] of [['courierResultWaitMs',1000,120000],['courierBodyBytes',131072,4194304]]) {
    for(const value of [undefined,min-1,min,min+1,max-1,max,max+1,0,-1,NaN,Infinity,1.5,'30000',true,null]) {
      let accepted=true;try{validateTransportSettings(value===undefined?{}:{[key]:value});}catch{accepted=false;}
      const type=value===undefined?'absent':typeof value;
      const lua=execFileSync('lua',['test/support/transport-settings.lua',key,type,String(value)],{encoding:'utf8'}).trim();
      assert.equal(lua==='true',accepted,`${key} ${type} ${String(value)}`);
    }
  }
  for(const bad of [null,[],false,{unknown:1},{courierResultWaitMs:undefined}])assert.throws(()=>validateTransportSettings(bad));
  const d=transportPolicy(); assert.equal(d.settings[2].editable,false);assert.equal(d.settings[2].value,65536);
  assert.equal(defaults.courierBodyBytes,4194304);validateType('WorldSourceTransportPolicy',d);
});
async function port() {const s=createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p;}
async function opened(t,settings={}) {
  const f=await world(t), transportPort=await port();
  const identity=await writePayload(f.dir,{transportPort,transportSettings:settings});
  const c=await LocalCourier.open({...identity,worldPath:f.worldPath},settings);t.after(()=>c.close());
  // Only a freshly minted, test-owned transport secret is used. It never leaves this fixture.
  const config=JSON.parse(await readFile(join(f.dir,'transport.json'),'utf8'));
  return {...f,c,identity,url:`http://127.0.0.1:${transportPort}`,headers:{authorization:`Bearer ${config.token}`}};
}
function postSplit(url,headers,body,split) {return new Promise((resolve,reject)=>{
  const req=httpRequest(url,{method:'POST',headers},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});
  req.on('error',reject);req.write(body.subarray(0,split));setImmediate(()=>req.end(body.subarray(split)));
});}
test('real Node HTTP boundary counts bytes incl envelope, accepts exact limit and split UTF-8, rejects +1 and bad JSON',async t=>{
  const f=await opened(t,{courierBodyBytes:131072});
  const promise=f.c.dispatch('snapshot');const poll=await (await fetch(f.url+'/poll',{headers:f.headers})).json();
  const value={id:poll.command.id,worldRef:f.identity.worldRef,result:{text:'é'},padding:''};
  value.padding='x'.repeat(131072-Buffer.byteLength(JSON.stringify(value)));
  const body=Buffer.from(JSON.stringify(value)); assert.equal(body.length,131072);
  const split=body.indexOf(Buffer.from('é'))+1;
  assert.equal(await postSplit(f.url+'/result',f.headers,body,split),200);assert.deepEqual(await promise,{text:'é'});
  assert.equal((await fetch(f.url+'/result',{method:'POST',headers:f.headers,body:Buffer.concat([body,Buffer.from(' ')] )})).status,413);
  for(const bad of ['{','null','[]'])assert.equal((await fetch(f.url+'/result',{method:'POST',headers:f.headers,body:bad})).status,400);
  assert.equal((await fetch(f.url+'/poll')).status,403);
  await assert.rejects(()=>LocalCourier.open({...f.identity,worldPath:f.worldPath}),e=>e.source?.kind==='INVALID_CONFIG');
});
test('complete poll command has exact inclusive bound for both read and write; timeout never redispatches',async t=>{
  const settings={courierBodyBytes:131072,courierResultWaitMs:1000};
  const c=new LocalCourier({worldRef:'luanti:fixture'},{token:'a'.repeat(64),settings});
  t.mock.timers.enable({apis:['setTimeout']});
  for(const operation of ['snapshot','region_write']) {
    const input={padding:''};const sample={worldRef:c.manifest.worldRef,command:{...input,id:'x'.repeat(36),operation,worldRef:c.manifest.worldRef}};
    input.padding='x'.repeat(131072-Buffer.byteLength(JSON.stringify(sample)));
    const pending=c.dispatch(operation,input);const rejection=assert.rejects(pending,e=>e.message==='RECOVERY_PENDING'&&e.source.kind==='WAIT_EXPIRED');
    assert.equal(c.queue.length,1);assert.equal(Buffer.byteLength(JSON.stringify({worldRef:c.manifest.worldRef,command:c.queue[0].command})),131072);
    await assert.rejects(()=>c.dispatch(operation,{padding:input.padding+'x'}),e=>e.beforeNativeDispatch===true&&e.source.kind==='LIMIT');
    t.mock.timers.tick(999);assert.equal(c.queue.length,1);t.mock.timers.tick(1);await rejection;assert.equal(c.queue.length,0);assert.equal(c.pending.size,0);
  }
});

import { blocksPerBatch } from '../src/region-batches.mjs';
import { readJournalActivity } from '../src/native-storage.mjs';
import { createHash } from 'node:crypto';
test('valid minimum body budget admits a candidate mapblock for exact serialization',()=>{
 assert.equal(blocksPerBatch({maxBodyBytes:131072,registeredNodes:1,longestNodeName:1},{edge:[16,16,16]}),1);
});
test('journal activity and record opening reject identical corrupted/version/permission storage',async t=>{
 const f=await world(t),worldRef='world',key=createHash('sha256').update(worldRef).digest('hex');
 const directory=join(f.root,'data/hanaworlds-adapter-luanti/journal',key);await mkdir(directory,{recursive:true});
 const path=join(directory,'local-world-state'),home=(...parts)=>join(f.root,...parts);
 assert.equal((await readJournalActivity(home,worldRef)).state,'NONE');
 for(const data of [{worldRef,transactions:{}},{version:'contracts@2.0.0',worldRef,transactions:{},requests:[]},
 {version:'wrong',worldRef,transactions:{},requests:{}},null]) {
  await writeFile(path,JSON.stringify(data));await assert.rejects(()=>LocalRecords.open(directory,worldRef));
  const activity=await readJournalActivity(home,worldRef);assert.equal(activity.state,'UNKNOWN');assert.ok(['CORRUPT','VERSION'].includes(activity.source.kind));
 }
 await writeFile(path,JSON.stringify({version:'contracts@2.0.0',worldRef,transactions:{},requests:{}}));
 assert.equal((await readJournalActivity(home,worldRef)).state,'PRESENT');
 await chmod(path,0);try {assert.equal((await readJournalActivity(home,worldRef)).source.kind,'PERMISSION');}finally{await chmod(path,0o600);}
});

import { createLocalWorldPort } from '../src/local-world-port.mjs';
import { apply } from '../src/index.mjs';
test('public lifecycle errors and logs preserve concrete corrupt/permission identity source',async t=>{
 const f=await world(t);const path=join(f.dir,'payload.json');await writeFile(path,'{');
 const logs=[];const local=createLocalWorldPort({roots:[f.root],runtime:{},log:(_,line)=>logs.push(line)});t.after(()=>local.close());
 const discover={contractVersion:'local-worlds/v2',requestId:'source-discover',worldRoot:f.root};
 for(const [operation,input] of [['discover',discover],['pair',{contractVersion:'local-worlds/v2',requestId:'source-pair',worldRef:'fixture-world'}]]) {
   const request=input;
   const response=await local.port[operation](request);assert.equal(response.error.source.kind,'CORRUPT');assert.equal(response.error.source.resource,'payload-identity');
 }
 assert.ok(logs.some(line=>line.includes('payload-identity CORRUPT')));
});
test('plugin exposes current declarations and rejects bad configuration before registering services',async()=>{
 const provided=new Map();const ctx={get(){},effect(){},provide:(name,value)=>provided.set(name,value),webServer:{register:()=>()=>{}}};
 const instance=apply(ctx,{transportSettings:{courierBodyBytes:131072,courierResultWaitMs:1000}});
 try {assert.deepEqual(instance.status().transportPolicy,transportPolicy({courierBodyBytes:131072,courierResultWaitMs:1000}));}finally{await instance.close();}
 for(const bad of [null,[],{courierBodyBytes:0},{courierBodyBytes:4194305}])assert.throws(()=>apply(ctx,{transportSettings:bad}),e=>e.source.kind==='INVALID_CONFIG');
});
