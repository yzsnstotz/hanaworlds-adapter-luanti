// SOURCE/FIXTURE: shipped handlers and Lua facts; the native engine is a fixture.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import * as C from '#contracts';
import { LocalCourier } from '../src/local-courier.mjs';
import { createLocalRuntime } from '../src/local-runtime.mjs';
import { apply } from '../src/index.mjs';
import { ENGINE_GUARDS } from '../src/safety-capabilities.mjs';
import { NeutralEngine } from '../src/world-vocabulary.mjs';
import { readWorldSourceFact } from '../src/world-source-facts.mjs';
import * as materialSources from '../src/material-sources.mjs';
import { PNG } from 'pngjs';
import { createWorldSourceFactsMock } from '../src/world-source-facts-mock.mjs';
import examples from '../fixtures/world-source-facts.json' with {type:'json'};
const plain = v => JSON.parse(JSON.stringify(v));
async function fixture(t) {
  const base = process.env.HW_ADAPTER_TEST_ROOT ?? join(tmpdir(),'hanaworlds-adapter-facts-tests');
  await mkdir(base, { recursive:true });
  const root = await mkdtemp(join(base, 'facts-'));
  await mkdir(join(root,'textures'));
  await writeFile(join(root,'textures','fixture.png'),PNG.sync.write({width:1,height:1,data:Buffer.from([255,0,0,255])}));
  const raw = JSON.parse(execFileSync('lua', ['test/support/material-facts.lua','glass'], {encoding:'utf8'}));
  raw.catalogue.nodes['fx:placed'].displayName = 'Fixture material';
  raw.catalogue.nodes['fx:placed'].color = '#123456';
  const connection = {worldRef:'fixture-world',connectionRef:'fixture-connection',connectionIncarnationRef:'fixture-incarnation'};
  let ready = true, globals = [], drift = false, reads = 0, live = true;
  let declarationDrift=false, declarationReads=0, boundsDrift=false, boundsReads=0, invalidMethods=false;
  const native = { closed:false, engineGuards:ENGINE_GUARDS, connectionIncarnationRef:connection.connectionIncarnationRef,
    handshake:async()=>{}, profile:async()=>({}), close:async()=>{native.closed=true;},
    catalogue:async()=>{const c=plain(raw.catalogue); if(drift && ++reads>1)c.gameRevision='changed'; return c;},
    regionLimits:async()=>({mapblockSize:16,mapgenLimit:boundsDrift&&++boundsReads>1?30000:31000}),
    sourceDeclaration:async()=>({ready:declarationDrift&&++declarationReads>1?false:ready,
      writeBackend:{profileId:'fixture-native-write/v1',revision:'revision-1'},
      writeMethods:invalidMethods?['INVALID']:ready?['PER_CELL','REGION']:[],avatarEnvelope:{availability:'KNOWN',basis:'WORLD_SOURCE_DECLARATION',size:{width:1,height:2,depth:1}}}),
    writePath:async()=>({catalogue:plain(raw.catalogue),evidence:{globalWriteCallbacks:globals,
      nodes:Object.entries(raw.catalogue.nodes).map(([nodeName,n])=>({nodeName,definitionRevision:n.definitionRevision,
        definedCallbacks:n.hasCallbacks===null?null:n.hasCallbacks?['on_construct']:n.hasPersistentState===null?['on_receive_fields']:[]}))}}),
    materialMetadata:async()=>({catalogue:plain(raw.catalogue),gamePath:root,userPath:root,texturePath:'',mods:[{name:'fixture',path:root}],
      appearance:{'fx:placed':{supported:true,textureName:'fixture.png'}}}) };
  t.mock.method(LocalCourier,'open',async()=>native);
  const runtime = createLocalRuntime({ctx:{},homePath:(...p)=>join(root,...p),inspectConnection:async()=>{if(!live)throw Error('CURRENT_WORLD_MISMATCH');}});
  await runtime.pairLocal({...connection,worldPath:root,payloadVersion:'fixture',payloadDigest:'fixture'});
  t.after(()=>runtime.close());
  const read=(operation,worldRef=connection.worldRef)=>runtime.worldFacts.call(operation,{contractVersion:'world-facts/v1',requestId:operation,worldRef});
  const caps=()=>runtime.port.call('ReadWorldSourceCapabilities',{contractVersion:'world-adapter/v8',sessionRef:'fixture-session',requestId:'caps',worldRef:connection.worldRef});
  return {runtime,connection,raw,read,caps,provider:()=>readWorldSourceFact('ReadWorldSourceCapabilities',{
    ...connection,incarnation:connection.connectionIncarnationRef,engine:new NeutralEngine(native)}),
    setDeclarationDrift:()=>{declarationDrift=true;declarationReads=0;},setBoundsDrift:()=>{boundsDrift=true;boundsReads=0;},setInvalidMethods:()=>{invalidMethods=true;},
    setReady:v=>{ready=v;},setGlobals:v=>{globals=v;},setDrift:()=>{drift=true;reads=0;},setLive:v=>{live=v;}};
}
test('five named reads bind neutral vocabulary, presentation, configuration and capabilities to one world',async t=>{
  const f=await fixture(t);
  const catalogue=(await f.read('ReadCatalogue')).result;
  C.validateCatalogueFacts(catalogue,f.connection);
  assert.ok(Object.values(catalogue.presentation).some(p=>p.displayName==='Fixture material'&&p.color==='#ff0000'));
  assert.ok(catalogue.orientationIndex.length>0);
  const sources=(await f.read('ReadMaterialSources')).result;
  C.validateMaterialSourceFacts(sources,catalogue.catalogue,f.connection);
  assert.ok(sources.snapshot.materials.some(m=>m.availability==='KNOWN'));
  assert.deepEqual(Object.keys(sources.presentation).sort(),sources.snapshot.materials.map(m=>m.materialRef).sort());
  assert.deepEqual(plain(sources.presentation),plain(catalogue.presentation));
  const known=sources.snapshot.materials.find(m=>m.availability==='KNOWN');
  assert.deepEqual(plain(sources.presentation[known.materialRef]),{displayName:'Fixture material',color:'#ff0000'});
  for(const m of sources.snapshot.materials) {
    assert.ok(Object.hasOwn(sources.presentation[m.materialRef],'displayName'));
    assert.ok(Object.hasOwn(sources.presentation[m.materialRef],'color'));
    if(m.texture)assert.match(m.texture.textureName,/^asset:[a-f0-9]{64}$/);
  }
  assert.equal(JSON.stringify(sources).includes('fx:'),false);
  assert.equal(JSON.stringify(sources).includes('fixture.png'),false);
  const engine=(await f.read('ReadEngineFacts')).result;
  C.validateEngineFacts(engine,f.connection);
  assert.deepEqual(plain(engine.engineBounds),{min:[-31000,-31000,-31000],max:[31000,31000,31000]});
  assert.equal(engine.worldGeometry.postWriteLighting,'REQUIRED');
  const profile=(await f.read('ReadWriteProfile')).result;
  C.validateWriteProfile(profile,catalogue.catalogue,f.connection);
  assert.deepEqual(plain(C.requireDeclaredAvatarEnvelope(profile)),{width:1,height:2,depth:1});
  assert.deepEqual(plain(C.requireWriteProfileConfig(profile).writeBackend),plain(profile.writeBackend.writeBackend));
  assert.deepEqual(profile.writeMethods,['PER_CELL','REGION']);
  await f.provider();
  const response=await f.caps();assert.equal(response.error,null,JSON.stringify(response.error));
  const caps=response.result;
  C.validateWorldSourceCapabilities(caps,catalogue.catalogue,f.connection);
  assert.equal(caps.owner,'world-source');
  assert.deepEqual(caps.stateProfile.derivedFields,['lighting']);
  assert.deepEqual(caps.stateProfile.preservedFields,[]);
  assert.deepEqual(caps.stateProfile.clearedFields,['inventory','metadata','timer']);
  assert.deepEqual(plain(caps.writePath.path),{hasSideEffects:false,hasPersistentState:false});
  assert.equal(JSON.stringify(caps).includes('on_construct'),false);
});
test('unknown backend gives no compilation defaults or supported writes; stale registry refuses',async t=>{
  const f=await fixture(t);f.setReady(false);
  const profile=(await f.read('ReadWriteProfile')).result;
  assert.equal(profile.writeBackend.availability,'UNAVAILABLE');
  assert.equal(profile.compilationConfig,null);assert.deepEqual(profile.writeMethods,[]);
  assert.throws(()=>C.requireWriteProfileConfig(profile),/CAPABILITY_UNAVAILABLE/);
  f.setDrift();const response=await f.read('ReadWriteProfile');
  assert.equal(response.error.code,'CURRENT_WORLD_MISMATCH');assert.equal(response.result,null);
});
test('named errors, connection retirement and closed reads never return facts for another world',async t=>{
  const f=await fixture(t);
  for(const op of ['ReadCatalogue','ReadMaterialSources','ReadEngineFacts','ReadWriteProfile']) {
    const r=await f.read(op,'absent');
    assert.equal(r.result,null);
    assert.equal(r.error.code,op==='ReadCatalogue'?'WORLD_NOT_BOUND':op==='ReadMaterialSources'?'CAPABILITY_UNAVAILABLE':'ADAPTER_UNAVAILABLE');
  }
  f.setLive(false);assert.equal((await f.caps()).error.code,'CURRENT_WORLD_MISMATCH');
  await f.runtime.close();assert.equal((await f.read('ReadCatalogue')).error.code,'ADAPTER_UNAVAILABLE');
});
test('neutral services retain the exact old aliases for the transition minor',async()=>{
  const services=new Map();const instance=apply({get(){},effect(){},provide:(n,v)=>services.set(n,v),webServer:{register:()=>()=>{}}});
  try {
    assert.equal(services.get('hanaworldsWorldSourceFacts'),services.get('hanaworldsLuantiNativeFacts'));
    assert.equal(typeof services.get('hanaworldsWorldSourceFacts')?.call,'function');
    assert.equal(services.get('hanaworldsWorldFacts'),instance.worldFacts);
    assert.equal(typeof services.get('hanaworldsWorldFacts')?.call,'function');
    assert.equal(services.get('hanaworldsLocalWorlds'),services.get('hanaworldsLuantiLocalWorlds'));
  } finally {await instance.close();}
});
test('PNG source colours come from verified assets, invalid/unsupported bytes stay unknown',()=>{
  assert.equal(typeof materialSources.textureColor,'function');
  const png=PNG.sync.write({width:1,height:1,data:Buffer.from([255,0,0,255])});
  assert.equal(materialSources.textureColor({mediaType:'image/png',bytes:png}),'#ff0000');
  assert.equal(materialSources.textureColor({mediaType:'image/png',bytes:Buffer.from('bad')}),null);
  assert.equal(materialSources.textureColor({mediaType:'image/jpeg',bytes:png}),null);
});
test('global callbacks cannot be advertised as clean world source capabilities',async t=>{
  const f=await fixture(t);f.setGlobals(['register_on_mapblocks_changed']);
  const response=await f.caps();assert.equal(response.error.code,'CATALOGUE_MISMATCH');assert.equal(response.result,null);
});
test('published example mock covers all reads and every declared operation refusal',async()=>{
  const mock=createWorldSourceFactsMock();
  const codes={ReadCatalogue:['ADAPTER_UNAVAILABLE','WORLD_NOT_BOUND'],ReadMaterialSources:['CAPABILITY_UNAVAILABLE'],
    ReadEngineFacts:['ADAPTER_UNAVAILABLE'],ReadWriteProfile:['ADAPTER_UNAVAILABLE','CAPABILITY_UNAVAILABLE'],ReadWorldSourceCapabilities:['ADAPTER_UNAVAILABLE']};
  for(const x of examples.exchanges) {
    assert.deepEqual(plain(await mock.call(x.operation,x.request)),x.response);
    for(const code of codes[x.operation])assert.equal((await createWorldSourceFactsMock({[x.operation]:code}).call(x.operation,x.request)).error.code,code);
  }
  assert.throws(()=>createWorldSourceFactsMock({ReadCatalogue:'APPLY_FAILED'}),/Undeclared/);
});
test('unchanged Catalogue cannot make a changed backend declaration or engine bound current',async t=>{
  const f=await fixture(t);f.setDeclarationDrift();
  const profile=await f.read('ReadWriteProfile');
  assert.equal(profile.error?.code,'CURRENT_WORLD_MISMATCH');assert.equal(profile.result,null);
  f.setBoundsDrift();
  const engine=await f.read('ReadEngineFacts');
  assert.equal(engine.error?.code,'CURRENT_WORLD_MISMATCH');assert.equal(engine.result,null);
});
test('capabilities preserve common schema errors and closed reads return a named envelope',async t=>{
  const f=await fixture(t);f.setInvalidMethods();
  assert.equal((await f.caps()).error?.code,'SCHEMA_INVALID');
  await f.runtime.close();assert.equal((await f.caps()).error?.code,'ADAPTER_UNAVAILABLE');
});
