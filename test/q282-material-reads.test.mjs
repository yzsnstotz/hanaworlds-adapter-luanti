// SOURCE/FIXTURE: official Cordis registration + public Adapter apply. Native
// courier observations are peer fixtures; no REAL_HOST/Luanti/UI claim.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, realpath, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
const packageRoot=process.env.HW_Q282_PACKAGE_ROOT?await realpath(process.env.HW_Q282_PACKAGE_ROOT):undefined;
const load=path=>import(packageRoot?pathToFileURL(join(packageRoot,'dist/runtime',path)):new URL('../src/'+path,import.meta.url));
const C=packageRoot?await load('contracts.mjs'):await import('#contracts');
const { apply, inject }=packageRoot?await import('hanaworlds-adapter-luanti'):await load('index.mjs');
const { LocalCourier }=await load('local-courier.mjs');
const { ENGINE_GUARDS }=await load('safety-capabilities.mjs');
const { Context, symbols }=await import('@deepseek-ai/cordis');
const { PNG }=packageRoot?createRequire(pathToFileURL(join(packageRoot,'package.json')))('pngjs'):await import('pngjs');
const plain=v=>JSON.parse(JSON.stringify(v));
const sha=b=>createHash('sha256').update(b).digest('hex');
const original=v=>v?.[symbols.original]??v;
const fixture=JSON.parse(await readFile(new URL('./fixtures/q282-native-catalogue.json',import.meta.url)));
const refusal=code=>error=>{
 assert.equal(error.publicError?.code,code);
 assert.equal(error.publicError.mutationState,'NONE');
 assert.equal(error.publicError.transactionRef,null);
 C.validateType('Error',error.publicError);return true;
};
async function setup(t,config={}) {
 const base=process.env.HW_ADAPTER_TEST_ROOT??fileURLToPath(new URL('../../tmp/q282-worlds/',import.meta.url));
 await mkdir(base,{recursive:true});const root=await realpath(await mkdtemp(join(base,'world-')));
 const profile=join(root,'profile'),worlds=join(profile,'worlds'),game=join(profile,'games','flatgame');
 await mkdir(worlds,{recursive:true});await mkdir(join(root,'home'));await mkdir(join(game,'textures'),{recursive:true});
 await writeFile(join(game,'game.conf'),'title = Q282 native fixture\n');
 const texture=join(game,'textures','private.png');
 const png=color=>PNG.sync.write({width:1,height:1,data:Buffer.from(color)});
 const red=png([255,0,0,255]),blue=png([0,0,255,255]);await writeFile(texture,red);
 let raw=plain(fixture),bound,live=true,afterMetadata=async()=>{},metadataReads=0;
 const mutations=[],life=[];
 const native={closed:false,engineGuards:ENGINE_GUARDS,connectionIncarnationRef:'q282:incarnation',
  handshake:async()=>{},profile:async()=>({}),regionLimits:async()=>({mapblockSize:16,mapgenLimit:31000}),
  catalogue:async()=>plain(raw),close:async()=>{native.closed=true;},
  materialMetadata:async()=>{metadataReads++;const result={catalogue:plain(raw),gamePath:game,userPath:profile,
   texturePath:'',mods:[],appearance:{'fx:placed':{supported:true,textureName:'private.png'}}};
   await afterMetadata();return result;}};
 for(const name of ['prepareCheck','apply','applyState','restore','regionWrite','regionEmerge'])
  native[name]=async()=>{mutations.push(name);throw Error('READ_MUST_NOT_MUTATE');};
 t.mock.method(LocalCourier,'open',async world=>{bound=world;return native;});
 const ctx=new Context();let adapter,owner,canvas,bridge,bridgeOwner;
 ctx.provide('webServer',{register:()=>()=>{}});ctx.provide('dshHomePath',(...p)=>join(root,'home',...p));
 ctx.provide('hanaworldsNativeEngineControl',{
  acquire:async q=>{life.push('acquire');return {controlRef:'q282:control',worldPath:q.worldPath};},
  inspect:async q=>{if(!live)throw Error('CURRENT_WORLD_MISMATCH');return {state:'CURRENT',worldPath:q.worldPath,processId:1234,operationRef:q.operationRef};},
  withStoppedWorld:async(q,cb)=>{life.push('stop');return cb({state:'STOPPED',worldPath:q.worldPath,processId:1234,operationRef:q.operationRef});}});
 const adapterFiber=ctx.plugin({name:'q282-source',inject,apply(c){owner=c;adapter=apply(c,{localUserPath:profile,localWorldRoots:[worlds],...config});}});await adapterFiber.await();
 const canvasFiber=ctx.plugin({name:'arbitrary-canvas-name',apply(c){canvas=c;c.provide('hanaworldsCanvasV5',{call(){throw Error('UNEXPECTED_CANVAS_CALL');}});}});await canvasFiber.await();
 const bridgeFiber=ctx.plugin({name:'arbitrary-bridge-name',apply(c){bridge=c;bridgeOwner=c;c.provide('hanaworldsWorldInspectionContext',{ReadInspectionContext(){throw Error('UNEXPECTED_INSPECTION_CALL');}});}});await bridgeFiber.await();
 t.after(async()=>{await adapter.close();await bridgeFiber.dispose();await canvasFiber.dispose();await adapterFiber.dispose();await ctx.fiber.dispose();await rm(root,{recursive:true,force:true});});
 const local=ctx.get('hanaworldsLocalWorlds');
 const created=await local.createFlatWorld({requesterRef:'fixture-host',userPath:profile,worldName:'q282'});
 const lease=await local.acquire({connectionRef:created.connectionRef,requesterRef:'fixture-host',userPath:profile,action:'BIND_RUNNING_WORLD'});
 const paired=await local.pair({connectionRef:created.connectionRef,requesterRef:'fixture-host',leaseRef:lease.leaseRef});
 const scope={worldRef:paired.worldRef,connectionRef:paired.connectionRef,connectionIncarnationRef:paired.connectionIncarnationRef};
 const files=async()=>{const out={};async function walk(dir){for(const e of await readdir(dir,{withFileTypes:true})){
  const p=join(dir,e.name);if(e.isDirectory())await walk(p);else if(e.isFile())out[p]=sha(await readFile(p));}}await walk(root);return out;};
 const audit=async action=>{const before=await files(),writes=[...mutations],lifecycle=[...life];try{return await action();}finally{
  assert.deepEqual(await files(),before,'read changed world/history/lease files');assert.deepEqual(mutations,writes);assert.deepEqual(life,lifecycle);}};
 const host=(role,name)=>{const value=role.get('hanaworldsWorldFacts')[name];assert.equal(typeof value,'function',`Q282 missing public ${name}`);return value;};
 const call=(role,operation)=>role.get('hanaworldsWorldFacts').call(operation,{contractVersion:'world-facts/v1',requestId:'q282:'+operation,worldRef:scope.worldRef});
 return {ctx,canvas,bridge,bridgeOwner,owner,adapter,canvasFiber,bridgeFiber,scope,native,host,call,audit,texture,red,blue,
  metadataReads:()=>metadataReads,afterMetadata:f=>{afterMetadata=f;},setLive:v=>{live=v;},changeRegistry:()=>{raw.gameRevision=sha('registry changed');},bound:()=>bound};
}

test('Q282 original roles read complete wire facts and typed texture bytes through the neutral Host port',async t=>{
 const f=await setup(t);
 const catalogue=await f.audit(()=>f.call(f.canvas,'ReadCatalogue'));
 const material=await f.audit(()=>f.call(f.bridge,'ReadMaterialSources'));
 assert.equal(catalogue.error,null);assert.equal(material.error,null);
 const readCatalogue=f.host(f.canvas,'readCatalogue'),readSources=f.host(f.bridge,'readMaterialSources');
 const cat=await f.audit(()=>readCatalogue(f.scope)),sources=await f.audit(()=>readSources(f.scope));
 assert.deepEqual(plain(cat.facts),plain(catalogue.result));assert.deepEqual(plain(sources.facts),plain(material.result));
 assert.deepEqual(plain(cat.provider),plain(sources.provider));
 assert.deepEqual(Object.keys(cat).sort(),['facts','provider']);assert.deepEqual(Object.keys(sources).sort(),['facts','provider','textures']);
 C.validateCatalogueFacts(cat.facts,f.scope);C.validateMaterialSources({snapshot:sources.facts.snapshot,textures:sources.textures},cat.facts.catalogue,f.scope);
 const known=sources.facts.snapshot.materials.find(row=>row.availability==='KNOWN');assert.ok(known,'normal native material must be usable');
 const blob=sources.textures.find(row=>row.bytesDigest===known.texture.bytesDigest);
 assert.ok(blob.bytes instanceof Uint8Array);assert.deepEqual(Buffer.from(blob.bytes),f.red);
 assert.equal(known.texture.byteLength,f.red.length);assert.equal(sha(blob.bytes),known.texture.bytesDigest);
 assert.equal(JSON.stringify(sources.facts).includes('private.png'),false);assert.equal(JSON.stringify(cat.facts).includes('fx:'),false);
 // Caller-owned bytes cannot poison the next fresh read.
 blob.bytes.fill(0);assert.deepEqual(Buffer.from((await readSources(f.scope)).textures[0].bytes),f.red);
});

for(const [role,operation] of [['bridge','ReadCatalogue'],['canvas','ReadMaterialSources'],['ctx','ReadCatalogue'],['ctx','ReadMaterialSources']])
 test(`Q282 ${role} cannot claim the original ${operation} reading role`,async t=>{
  const f=await setup(t),before=f.metadataReads();
  const result=await f.audit(()=>f.call(f[role],operation));
  assert.equal(result.result,null);assert.equal(result.error?.code,operation==='ReadCatalogue'?'ADAPTER_UNAVAILABLE':'CAPABILITY_UNAVAILABLE');
  assert.equal(result.error.mutationState,'NONE');assert.equal(f.metadataReads(),before,'unauthorized read touched native material facts');
 });

test('Q282 scoped bytes reject stale worlds/connections/incarnations and malformed scopes',async t=>{
 const f=await setup(t),read=f.host(f.bridge,'readMaterialSources');
 for(const field of ['worldRef','connectionIncarnationRef'])await f.audit(()=>assert.rejects(read({...f.scope,[field]:'stale'}),refusal('CURRENT_WORLD_MISMATCH')));
 await f.audit(()=>assert.rejects(read({...f.scope,connectionRef:'unknown'}),refusal('WORLD_NOT_BOUND')));
 await f.audit(()=>assert.rejects(read({worldRef:f.scope.worldRef}),refusal('SCHEMA_INVALID')));
 await f.audit(()=>assert.rejects(read({...f.scope,providerRef:'forged'}),refusal('UNKNOWN_REQUIRED_FIELD')));
 await f.audit(()=>assert.rejects(f.host(f.canvas,'readMaterialSources')(f.scope),refusal('CAPABILITY_UNAVAILABLE')));
 await f.audit(()=>assert.rejects(f.host(f.bridge,'readCatalogue')(f.scope),refusal('CAPABILITY_UNAVAILABLE')));
});

test('Q282 changed bytes and missing textures stay explicit and recover on the same provider',async t=>{
 const f=await setup(t),read=f.host(f.bridge,'readMaterialSources'),first=await f.audit(()=>read(f.scope));
 await writeFile(f.texture,f.blue);const changed=await f.audit(()=>read(f.scope));
 assert.notEqual(changed.facts.snapshot.sourceRevision,first.facts.snapshot.sourceRevision);
 assert.deepEqual(plain(changed.facts.snapshot.engineRevisions),plain(first.facts.snapshot.engineRevisions));
 assert.deepEqual(plain(changed.provider),plain(first.provider));assert.deepEqual(Buffer.from(changed.textures[0].bytes),f.blue);
 await rm(f.texture);const missing=await f.audit(()=>read(f.scope));
 assert.ok(missing.facts.snapshot.materials.some(row=>row.reason==='MISSING_TEXTURE'&&row.texture===null));assert.equal(missing.textures.length,0);
 await writeFile(f.texture,f.red);const recovered=await f.audit(()=>read(f.scope));
 assert.deepEqual(plain(recovered.provider),plain(first.provider));assert.deepEqual(Buffer.from(recovered.textures[0].bytes),f.red);
});

test('Q282 malformed PNG bytes remain actual bytes with an unknown colour and no synthetic replacement',async t=>{
 const f=await setup(t),read=f.host(f.bridge,'readMaterialSources');await writeFile(f.texture,Buffer.from('broken png'));
 const out=await f.audit(()=>read(f.scope)),known=out.facts.snapshot.materials.find(row=>row.availability==='KNOWN');
 assert.ok(known);assert.deepEqual(Buffer.from(out.textures[0].bytes),Buffer.from('broken png'));
 assert.equal(out.facts.presentation[known.materialRef].color,null);
});

test('Q282 registry drift during an await rejects then a stable new registry recovers',async t=>{
 const f=await setup(t),read=f.host(f.bridge,'readMaterialSources');const first=await f.audit(()=>read(f.scope));
 let changed=false;f.afterMetadata(async()=>{if(!changed){changed=true;f.changeRegistry();}});
 await f.audit(()=>assert.rejects(read(f.scope),refusal('CURRENT_WORLD_MISMATCH')));
 f.afterMetadata(async()=>{});const next=await f.audit(()=>read(f.scope));
 assert.notDeepEqual(plain(next.facts.snapshot.engineRevisions),plain(first.facts.snapshot.engineRevisions));assert.deepEqual(plain(next.provider),plain(first.provider));
});

test('Q282 captured methods lose provider authority on same-name replacement during native read',async t=>{
 const f=await setup(t),read=f.host(f.bridge,'readMaterialSources');
 let changed=false;f.afterMetadata(async()=>{if(!changed){changed=true;const replacement={ReadInspectionContext(){throw Error('DO_NOT_CALL');}};
  assert.equal(f.bridgeOwner.set('hanaworldsWorldInspectionContext',replacement),true);
  assert.equal(original(f.bridgeOwner.get('hanaworldsWorldInspectionContext')),replacement);}});
 await f.audit(()=>assert.rejects(read(f.scope),refusal('CAPABILITY_UNAVAILABLE')));
});

test('Q282 forged and foreign-root receivers cannot reuse captured material read authority',async t=>{
 const f=await setup(t),port=f.bridge.get('hanaworldsWorldFacts');
 assert.equal(typeof port.readMaterialSources,'function','Q282 missing material reader');
 const descriptor=Object.getOwnPropertyDescriptor(original(port),'readMaterialSources');
 assert.equal(typeof descriptor?.get,'function','tracked caller must be captured at method access');
 const forged=descriptor.get.call({ctx:f.bridge,[symbols.original]:original(port)});
 await f.audit(()=>assert.rejects(forged(f.scope),refusal('CAPABILITY_UNAVAILABLE')));
 const other=new Context();t.after(()=>other.fiber.dispose());other.provide('hanaworldsWorldFacts',original(port));
 await f.audit(()=>assert.rejects(other.get('hanaworldsWorldFacts').readMaterialSources(f.scope),refusal('CAPABILITY_UNAVAILABLE')));
});

test('Q282 loss of native currency and Adapter close never return old bytes',async t=>{
 const f=await setup(t),read=f.host(f.bridge,'readMaterialSources');await f.audit(()=>read(f.scope));
 f.setLive(false);await f.audit(()=>assert.rejects(read(f.scope),refusal('CURRENT_WORLD_MISMATCH')));
 f.setLive(true);assert.ok((await f.audit(()=>read(f.scope))).textures.length);
 await f.adapter.close();await assert.rejects(read(f.scope),refusal('ADAPTER_UNAVAILABLE'));
});

test('Q282 source provider replacement revokes an already captured Catalogue read',async t=>{
 const f=await setup(t),read=f.host(f.canvas,'readCatalogue');
 let replaced=false;f.afterMetadata(async()=>{if(!replaced){replaced=true;
  assert.equal(f.owner.set('hanaworldsWorldFacts',{call(){throw Error('DO_NOT_FORWARD');}}),true);}});
 await f.audit(()=>assert.rejects(read(f.scope),refusal('CAPABILITY_UNAVAILABLE')));
});

test('Q282 original failure object, cause and UNKNOWN diagnosis survive material reads',async t=>{
 const f=await setup(t),read=f.host(f.bridge,'readMaterialSources');
 const cause=Error('original-cause'),failure=Object.assign(Error('native read failed',{cause}),{publicError:{
  code:'CAPABILITY_UNAVAILABLE',phase:'readback',retryability:'NEVER',mutationState:'UNKNOWN',
  transactionRef:'original:uncertain',causeCode:'PAYLOAD_VERSION_MISMATCH',reason:'REQUIRED_FACT_UNKNOWN'}});
 C.validateType('Error',failure.publicError);const expected=plain(failure.publicError);
 f.afterMetadata(async()=>{throw failure;});
 await f.audit(()=>assert.rejects(read(f.scope),error=>{
  assert.equal(error,failure);assert.equal(error.cause,cause);assert.deepEqual(error.publicError,expected);return true;}));
 f.afterMetadata(async()=>{});assert.ok((await f.audit(()=>read(f.scope))).textures.length);
});

test('Q282 material byte and colour budgets are named, visible and configurable',async t=>{
 const settings={maxTextureBytes:32,maxColorPixels:1};const f=await setup(t,{materialSourceSettings:settings});
 assert.deepEqual(plain(f.adapter.status().materialSourcePolicy),{...settings,engineMediaMaxBytes:16700000});
 const out=await f.audit(()=>f.host(f.bridge,'readMaterialSources')(f.scope));
 assert.equal(out.textures.length,0);
 assert.ok(out.facts.snapshot.materials.some(row=>row.reason==='UNRESOLVED_SOURCE'&&row.texture===null));
});

test('Q282 texture byte drift during the read rejects without changing binding or retrying',async t=>{
 const f=await setup(t),read=f.host(f.bridge,'readMaterialSources');let reads=0;
 f.afterMetadata(async()=>{if(++reads===2)await writeFile(f.texture,f.blue);});
 // This deliberate external edit is the only allowed file change, so the
 // ordinary no-file-change audit applies to the stable recovery call below.
 await assert.rejects(read(f.scope),refusal('CURRENT_WORLD_MISMATCH'));
 assert.equal(reads,2,'do not retry changed facts');f.afterMetadata(async()=>{});
 assert.deepEqual(Buffer.from((await f.audit(()=>read(f.scope))).textures[0].bytes),f.blue);
});

test('Q282 invalid or unknown material budgets refuse Adapter loading',async()=>{
 for(const materialSourceSettings of [{maxTextureBytes:0},{maxColorPixels:-1},{maxTextureBytes:1.5},{maxColorPixels:NaN},{extra:1}]){
  let adapter;
  try{
   assert.throws(()=>{adapter=apply({get(){},provide(){},effect(){},webServer:{register:()=>()=>{}}},{materialSourceSettings});},/SCHEMA_INVALID|UNKNOWN_REQUIRED_FIELD/);
  }finally{await adapter?.close();}
 }
});
