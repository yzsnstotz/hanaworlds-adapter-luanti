// SOURCE/FIXTURE: real Adapter apply and official Cordis; the native engine/Host are fixtures.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Context, symbols } from '@deepseek-ai/cordis';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, realpath, writeFile, readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as C from '#contracts';
import { apply, inject } from '../src/index.mjs';
import { LocalCourier } from '../src/local-courier.mjs';
import { ENGINE_GUARDS } from '../src/safety-capabilities.mjs';
const plain = v => JSON.parse(JSON.stringify(v));
const original = v => v?.[symbols.original] ?? v;
// Use the context captured at actual apply, never fabricate a fiber or bypass
// Cordis. Assertions prove an official owner mutation really took effect.
function replaceOwnedService(owner,name,replacement) {
 const key=owner[symbols.isolate][name],registered=owner.reflect.store[key];
 assert.equal(registered.fiber,owner.fiber,'replacement context must own the service');
 const before=original(owner.get(name));assert.notEqual(before,replacement);
 assert.equal(owner.set(name,replacement),true);
 assert.equal(owner.reflect.store[key],registered);assert.equal(registered.value,replacement);
 assert.equal(original(owner.get(name)),replacement);assert.notEqual(original(owner.get(name)),before);
}
const refused = code => e => {
 C.validateType('Error',e.publicError);
 return e.publicError.code === code && e.publicError.mutationState === 'NONE';
};
async function setup(t) {
 const base = process.env.HW_ADAPTER_TEST_ROOT ?? join(tmpdir(), 'hw-scoped-state');
 await mkdir(base, {recursive:true}); const root = await realpath(await mkdtemp(join(base, 'scoped-')));
 const profile = join(root, 'profile'), worlds = join(profile, 'worlds');
 await mkdir(worlds, {recursive:true}); await mkdir(join(root,'home')); await mkdir(join(profile, 'games/flatgame'), {recursive:true});
 await writeFile(join(profile, 'games/flatgame/game.conf'), 'title = Fixture\n');
 const catalogue = JSON.parse(execFileSync('lua', ['test/support/material-facts.lua', 'glass'], {encoding:'utf8'})).catalogue;
 let bound, live = true, afterRead = () => {}, malformed = false;
 let declaration = canvasDeclaration(), afterDeclaration = () => {}, declarationReads = 0;
 const mutations = [], lifecycle = [];
 const calls = [];
 const native = {closed:false,engineGuards:ENGINE_GUARDS,connectionIncarnationRef:'fixture-incarnation',
  handshake:async()=>{},close:async()=>{native.closed=true;},catalogue:async()=>plain(catalogue),
  profile:async()=>({}),regionLimits:async()=>({mapblockSize:16,mapgenLimit:31000}),
  sourceDeclaration:async()=>{declarationReads++;const out=plain(declaration);await afterDeclaration();return {canvasFacts:out};},
  snapshot:async positions=>{
   calls.push(plain(positions)); await afterRead();
   return {worldRef:bound.worldRef,coveredPositions:positions,records:malformed?[]:positions.map(position=>({
    position,nodeName:'air',param1:12,param2:0,metadata:{owner:'opaque-fixture'},inventory:{},timer:null}))};
  }};
 for(const name of ['prepareCheck','apply','applyState','restore','regionWrite','regionEmerge'])
  native[name]=async()=>{mutations.push(name);throw Error('FACT_READ_MUST_NOT_MUTATE');};
 t.mock.method(LocalCourier, 'open', async world => {bound=world;return native;});
 const ctx = new Context(); let adapter, adapterOwner, canvas;
 ctx.provide('webServer', {register:()=>()=>{}});ctx.provide('dshHomePath', (...p)=>join(root,'home',...p));
 for(const name of ['hanaworldsCanvasHistoryFacts','hanaworldsCanvasFootprintRegistry'])ctx.provide(name,{
  call:async()=>{mutations.push(name);throw Error('FACT_READ_MUST_NOT_CHANGE_HISTORY_OR_REGISTRY');}
 });
 const host = {acquire:async q=>{lifecycle.push('acquire');return {controlRef:'fixture-control',worldPath:q.worldPath};},
  inspect:async q=>{if(!live)throw Error('CURRENT_WORLD_MISMATCH');return {state:'CURRENT',worldPath:q.worldPath,processId:1234,operationRef:q.operationRef};},
  withStoppedWorld:async(q,cb)=>{lifecycle.push('withStoppedWorld');return cb({state:'STOPPED',worldPath:q.worldPath,processId:1234,operationRef:q.operationRef});}};
 ctx.provide('hanaworldsNativeEngineControl',host);
 const adapterFiber=ctx.plugin({name:'actual-adapter',inject,apply(c){adapterOwner=c;adapter=apply(c,{localUserPath:profile,localWorldRoots:[worlds]});}});await adapterFiber.await();
 const canvasFiber=ctx.plugin({name:'renamed-legitimate-canvas',apply(c){canvas=c;c.provide('hanaworldsCanvasV5',{call(){throw Error('UNEXPECTED_CANVAS_CALL');}});}});await canvasFiber.await();
 t.after(async()=>{await adapter.close();await canvasFiber.dispose();await adapterFiber.dispose();await ctx.fiber.dispose();});
 const local=ctx.get('hanaworldsLocalWorlds');
 const created=await local.createFlatWorld({requesterRef:'fixture-host',userPath:profile,worldName:'owned'});
 const lease=await local.acquire({connectionRef:created.connectionRef,requesterRef:'fixture-host',userPath:profile,action:'BIND_RUNNING_WORLD'});
 const paired=await local.pair({connectionRef:created.connectionRef,requesterRef:'fixture-host',leaseRef:lease.leaseRef});
 const scope={worldRef:paired.worldRef,connectionRef:paired.connectionRef,connectionIncarnationRef:paired.connectionIncarnationRef};
 const canvasRead=()=>{
  const read=canvas.get('hanaworldsWorldFacts').readCanvasFacts;
  assert.equal(typeof read,'function','neutral public readCanvasFacts is missing');return read;
 };
 const files=async()=>{
  const result={};
  async function walk(dir){for(const e of await readdir(dir,{withFileTypes:true})){
   const path=join(dir,e.name);if(e.isDirectory())await walk(path);else if(e.isFile())result[path]=createHash('sha256').update(await readFile(path)).digest('hex');
  }}
  await walk(root);return result;
 };
 const audit=async action=>{
  const before=await files(),life=[...lifecycle],writes=[...mutations];
  try{return await action();}finally{
   assert.deepEqual(await files(),before,'facts read mutated world, binding or transaction/history files');
   assert.deepEqual(lifecycle,life,'facts read acquired/stopped/rebound a world');
   assert.deepEqual(mutations,writes,'facts read prepared, wrote or emerged');
  }
 };
 return {ctx,canvas,canvasFiber,adapter,adapterOwner,paired,native,calls,scope,canvasRead,audit,
  declaration:()=>declaration,changeDeclaration:fn=>fn(declaration),setDeclaration:v=>{declaration=v;},
  afterDeclaration:fn=>{afterDeclaration=fn;},declarationReads:()=>declarationReads,
  read:(positions=[[0,0,0]])=>canvas.get('hanaworldsWorldFacts').readScopedState(paired.connectionRef,positions),
  afterRead:f=>{afterRead=f;},setLive:v=>{live=v;},badImage:()=>{malformed=true;}};
}

// Contract example values deliberately differ from existing fixed Frame/unit values.
// These are loaded-native fixtures; this suite does NOT establish real world provenance.
function canvasDeclaration() {
 const source=factRef=>({kind:'LOADED_WORLD_DECLARATION',factRef,revision:'fixture-source-r17'});
 const unit={name:'fixture-grid-unit',metersPerGridUnit:2.5};
 return {
  tools:[{toolRef:'tool:fixture-fill',purpose:{value:'Fixture declared regional filling',source:source('purpose:fill')},
   typicalScale:{value:{size:[7,5,9],unit:unit.name},source:source('scale:fill')}},
   {toolRef:'tool:fixture-line',purpose:{value:'Fixture declared line construction',source:source('purpose:line')},
   typicalScale:{value:{size:[31,1,1],unit:unit.name},source:source('scale:line')}}],
  unit:{value:unit,source:source('unit:loaded-world')},
  frame:{value:{profileVersion:'frame/v2',frameId:'fixture-frame:world',origin:[13,-7,22],axes:['+Z','+Y','-X'],
   handedness:'right',gridUnit:{...unit},transformRevision:'fixture-transform-r23'},source:source('frame:loaded-world')},
  partition:{value:{edge:[16,16,16]},source:{kind:'NATIVE_OBSERVATION',factRef:'partition:native',revision:'fixture-native-r29'}}
 };
}

test('Canvas facts carry every loaded value and individual source with actual scope and provider identity',async t=>{
 const f=await setup(t),read=f.canvasRead();
 const out=await f.audit(()=>read(f.scope));
 assert.equal(out.profileVersion,'canvas-source-facts/v1');assert.deepEqual(plain(out.connection),f.scope);
 for(const field of ['tools','unit','frame','partition'])assert.deepEqual(plain(out[field]),f.declaration()[field],field);
 assert.deepEqual(Object.keys(out).sort(),['profileVersion','connection','provider','tools','unit','frame','partition','sourceRevision'].sort());
 assert.deepEqual(Object.keys(out.provider).sort(),['providerRef','providerRevision']);
 for(const value of Object.values(out.provider))assert.equal(typeof value==='string'&&value.length>0,true);
 const {sourceRevision,...body}=out;
 assert.equal(sourceRevision,createHash('sha256').update(C.canonicalJSON(body)).digest('hex'));
 const again=await f.audit(()=>read(f.scope));assert.deepEqual(plain(again),plain(out));
 assert.ok(f.declarationReads()>=4,'source declarations must be checked before and after each read');
});

test('new source observations change all five facts and revision without fixed-value fallback',async t=>{
 const f=await setup(t),read=f.canvasRead(),first=await f.audit(()=>read(f.scope));
 f.changeDeclaration(d=>{
  d.tools[0].purpose.value='Changed declared purpose';d.tools[0].typicalScale.value.size=[19,3,11];
  d.unit.value={name:'new-fixture-unit',metersPerGridUnit:null};
  for(const tool of d.tools)tool.typicalScale.value.unit=d.unit.value.name;
  d.frame.value={...d.frame.value,origin:[-9,4,2],axes:['+X','+Y','+Z'],handedness:'left',gridUnit:d.unit.value,transformRevision:'r24'};
  for(const item of [d.unit,d.frame,d.partition,...d.tools.flatMap(x=>[x.purpose,x.typicalScale])])item.source.revision='changed-r31';
 });
 const second=await f.audit(()=>read(f.scope));
 for(const field of ['tools','unit','frame','partition'])assert.deepEqual(plain(second[field]),f.declaration()[field]);
 assert.notEqual(second.sourceRevision,first.sourceRevision);assert.deepEqual(plain(second.provider),plain(first.provider));
});

test('Canvas facts validate every scope field and refuse caller-provided authority before native reads',async t=>{
 const f=await setup(t),read=f.canvasRead();
 for(const input of [undefined,null,{},...Object.keys(f.scope).map(key=>({...f.scope,[key]:''})),
  ...Object.keys(f.scope).map(key=>({...f.scope,[key]:17}))])
  await f.audit(()=>assert.rejects(read(input),refused('SCHEMA_INVALID')));
 await f.audit(()=>assert.rejects(read({...f.scope,providerRef:'forged'}),refused('UNKNOWN_REQUIRED_FIELD')));
 await f.audit(()=>assert.rejects(read({...f.scope,connectionRef:'absent'}),refused('WORLD_NOT_BOUND')));
 for(const field of ['worldRef','connectionIncarnationRef'])
  await f.audit(()=>assert.rejects(read({...f.scope,[field]:'wrong'}),refused('CURRENT_WORLD_MISMATCH')));
 assert.equal(f.declarationReads(),0);
});

for(const field of ['tools','unit','frame','partition','tools.0.purpose','tools.0.typicalScale',
 'tools.0.purpose.source','tools.0.typicalScale.source','unit.source','frame.source','partition.source',
 'tools.0.purpose.source.revision','unit.value.name','frame.value.origin','partition.value.edge'])
 test('Canvas facts missing '+field+' blocks without defaults and succeeds once real facts recover',async t=>{
  const f=await setup(t),read=f.canvasRead(),complete=plain(f.declaration());
  f.changeDeclaration(d=>{const path=field.split('.'),key=path.pop();delete path.reduce((v,p)=>v[p],d)[key];});
  await f.audit(()=>assert.rejects(read(f.scope),e=>{
   assert.equal(e.publicError?.retryability,'AFTER_NEW_FACTS');return refused('TARGET_FACTS_INCOMPLETE')(e);
  }));
  f.setDeclaration(complete);const out=await f.audit(()=>read(f.scope));assert.deepEqual(plain(out.tools),complete.tools);
 });

for(const [name,change,code] of [
 ['duplicate tool',d=>d.tools.push(plain(d.tools[0])),'SCHEMA_INVALID'],
 ['empty tools',d=>{d.tools=[];},'TARGET_FACTS_INCOMPLETE'],
 ['unsorted tool list',d=>d.tools.reverse(),'SCHEMA_INVALID'],
 ['invalid size',d=>{d.tools[0].typicalScale.value.size=[0,5,9];},'SCHEMA_INVALID'],
 ['size unit mismatch',d=>{d.tools[0].typicalScale.value.unit='other';},'SCHEMA_INVALID'],
 ['frame unit mismatch',d=>{d.frame.value.gridUnit.name='other';},'SCHEMA_INVALID'],
 ['extra native field',d=>{d.privateEngineName='must-not-leak';},'UNKNOWN_REQUIRED_FIELD'],
 ['extra source field',d=>{d.unit.source.path='/private/world';},'UNKNOWN_REQUIRED_FIELD'],
 ['partition declared instead of observed',d=>{d.partition.source.kind='LOADED_WORLD_DECLARATION';},'SCHEMA_INVALID'],
 ['partition differs from native',d=>{d.partition.value.edge=[8,8,8];},'CURRENT_WORLD_MISMATCH'],
 ])test('Canvas facts refuse '+name+' with a named zero-mutation error',async t=>{
  const f=await setup(t),read=f.canvasRead();f.changeDeclaration(change);
  await f.audit(()=>assert.rejects(read(f.scope),refused(code)));
 });

for(const target of ['hanaworldsCanvasV5','hanaworldsWorldFacts'])for(const phase of ['before','during'])
 test('Canvas facts captured method refuses '+target+' replacement '+phase+' read',async t=>{
  const f=await setup(t),read=f.canvasRead();
  const owner=target==='hanaworldsCanvasV5'?f.canvas:f.adapterOwner;
  const replacement={call(){throw Error('REPLACEMENT_MUST_NOT_BE_CALLED');}};
  let hookCompleted=false;
  const replace=()=>{replaceOwnedService(owner,target,replacement);hookCompleted=true;};
  if(phase==='before')replace();else f.afterDeclaration(replace);
  await f.audit(()=>assert.rejects(read(f.scope),refused('CAPABILITY_UNAVAILABLE')));
  assert.equal(hookCompleted,true,'a setup exception must not count as provider refusal');
  assert.equal(original(owner.get(target)),replacement,'the provider really must be replaced');
  if(phase==='before')assert.equal(f.declarationReads(),0);
 });

test('Canvas facts root, foreign root and forged receiver lack authority',async t=>{
 const f=await setup(t),foreign=new Context(),port=f.ctx.get('hanaworldsWorldFacts'),original=port[symbols.original];
 f.canvasRead();foreign.provide('hanaworldsCanvasV5',{call(){}});foreign.provide('hanaworldsWorldFacts',original);
 try{
  const descriptor=Object.getOwnPropertyDescriptor(original,'readCanvasFacts');
  assert.equal(typeof descriptor?.get,'function','read must capture tracked Cordis caller');
  for(const read of [port.readCanvasFacts,foreign.get('hanaworldsWorldFacts').readCanvasFacts,
   descriptor.get.call({[symbols.original]:original,ctx:f.canvas})])
   await f.audit(()=>assert.rejects(read(f.scope),refused('CAPABILITY_UNAVAILABLE')));
  assert.equal(f.declarationReads(),0);
 }finally{await foreign.fiber.dispose();}
});

test('Canvas facts never use historical supplier aliases',async t=>{
 const f=await setup(t),read=f.canvasRead();
 const polluted=new Map();
 for(const name of ['hanaworldsLuantiNativeFacts','hanaworldsWorldSourceFacts']){
  const replacement={call(){throw Error('LEGACY_ALIAS_FORBIDDEN');},readCanvasFacts(){throw Error('LEGACY_ALIAS_FORBIDDEN');}};
  replaceOwnedService(f.adapterOwner,name,replacement);polluted.set(name,replacement);
 }
 const out=await f.audit(()=>read(f.scope));assert.deepEqual(plain(out.tools),f.declaration().tools);
 for(const [name,value] of polluted)assert.equal(original(f.adapterOwner.get(name)),value);
});

test('absent declaration blocks temporarily and source-provider instance replacement changes identity',async t=>{
 const f=await setup(t),read=f.canvasRead();f.setDeclaration(null);
 await f.audit(()=>assert.rejects(read(f.scope),refused('TARGET_FACTS_INCOMPLETE')));
 f.setDeclaration(canvasDeclaration());const first=await f.audit(()=>read(f.scope));
 const g=await setup(t),second=await g.audit(()=>g.canvasRead()(g.scope));
 assert.notDeepEqual(plain(first.provider),plain(second.provider),'different world-source instances need different identities');
});

test('Canvas facts refuse source drift, lost connection, disposed caller and closed adapter',async t=>{
 const f=await setup(t),read=f.canvasRead();
 f.afterDeclaration(()=>f.changeDeclaration(d=>{d.tools[0].purpose.source.revision+='-changed';}));
 await f.audit(()=>assert.rejects(read(f.scope),refused('CURRENT_WORLD_MISMATCH')));
 f.afterDeclaration(()=>{});f.setLive(false);
 await f.audit(()=>assert.rejects(read(f.scope),refused('CURRENT_WORLD_MISMATCH')));
 f.setLive(true);f.afterDeclaration(()=>f.setLive(false));
 await f.audit(()=>assert.rejects(read(f.scope),refused('CURRENT_WORLD_MISMATCH')));
 f.setLive(true);f.afterDeclaration(()=>{});await f.canvasFiber.dispose();
 await f.audit(()=>assert.rejects(read(f.scope),refused('CAPABILITY_UNAVAILABLE')));
 await f.adapter.close();await assert.rejects(read(f.scope),refused('ADAPTER_UNAVAILABLE'));
});

test('Canvas facts retain independently constructed native public refusal and logical provenance',async t=>{
 const f=await setup(t),read=f.canvasRead();
 const source={owner:'world-source',operation:'sourceDeclaration',resource:'world-facts',kind:'CORRUPT',nativeCode:null};
 f.afterDeclaration(()=>{throw {publicError:{code:'PAYLOAD_VERSION_MISMATCH',phase:'validate',retryability:'AFTER_NEW_FACTS',
  mutationState:'NONE',transactionRef:null,causeCode:null,reason:'REQUIRED_FACT_UNKNOWN',source}};});
 await f.audit(()=>assert.rejects(read(f.scope),e=>{
  assert.deepEqual(plain(e.publicError.source),source);return refused('PAYLOAD_VERSION_MISMATCH')(e);
 }));
});

test('Canvas facts refuse unreadable native partition instead of using the fixed geometry constant',async t=>{
 const f=await setup(t),read=f.canvasRead();
 t.mock.method(f.native,'regionLimits',async()=>{throw Error('CAPABILITY_UNAVAILABLE');});
 await f.audit(()=>assert.rejects(read(f.scope),refused('CAPABILITY_UNAVAILABLE')));
});

test('Canvas facts refuse changed native partition observations',async t=>{
 const f=await setup(t),read=f.canvasRead();let observations=0;
 t.mock.method(f.native,'regionLimits',async()=>({mapblockSize:++observations===1?16:32,mapgenLimit:31000}));
 await f.audit(()=>assert.rejects(read(f.scope),refused('CURRENT_WORLD_MISMATCH')));
 assert.ok(observations>=2,'partition requires before/after native observations');
});
test('registered renamed Canvas reads exact native scoped hashes through the neutral public service',async t=>{
 const f=await setup(t),positions=[[-1,0,0],[0,0,0],[1,0,0]];
 const facts=await f.read(positions);
 C.validateType('StateProfile',facts.stateProfile);C.validateType('ScopedCells',facts.cells);
 assert.equal(facts.worldRef,f.paired.worldRef);assert.deepEqual(facts.cells.map(c=>plain(c.position)),positions);
 const legacy=await f.ctx.get('hanaworldsLuantiNativeFacts').readScopedState(f.paired.connectionRef,positions);
 assert.deepEqual(plain(facts),plain(legacy));assert.deepEqual(f.calls,[positions,positions]);
 assert.equal(f.ctx.get('hanaworldsWorldFacts').contractVersion,'world-facts/v1');
});
test('missing, malformed, unsorted, duplicate and empty positions refuse before native reading',async t=>{
 const f=await setup(t);
 for(const positions of [undefined,[],[[0,0]],[[0,0,0],[0,0,0]],[[1,0,0],[0,0,0]]])
  await assert.rejects(async()=>f.read(positions===undefined?null:positions),refused('SCHEMA_INVALID'));
 await assert.rejects(async()=>f.canvas.get('hanaworldsWorldFacts').readScopedState('',[[0,0,0]]),refused('SCHEMA_INVALID'));
 await assert.rejects(async()=>f.canvas.get('hanaworldsWorldFacts').readScopedState('absent',[[0,0,0]]),refused('WORLD_NOT_BOUND'));
 assert.deepEqual(f.calls,[]);
});
test('root caller, foreign root and forged receiver cannot read using a public provider name',async t=>{
 const f=await setup(t),foreign=new Context();
 const port=f.ctx.get('hanaworldsWorldFacts'),original=port[symbols.original];
 foreign.provide('hanaworldsCanvasV5',{call(){}});foreign.provide('hanaworldsWorldFacts',original);
 try {
  for(const read of [port.readScopedState,foreign.get('hanaworldsWorldFacts').readScopedState,
   Object.getOwnPropertyDescriptor(original,'readScopedState').get.call({[symbols.original]:original,ctx:f.canvas})])
   await assert.rejects(async()=>read(f.paired.connectionRef,[[0,0,0]]),refused('CAPABILITY_UNAVAILABLE'));
  assert.deepEqual(f.calls,[]);
 }finally{await foreign.fiber.dispose();}
});
for(const phase of ['before','during'])test('same-name provider replacement '+phase+' read invalidates captured authority',async t=>{
 const f=await setup(t),read=f.canvas.get('hanaworldsWorldFacts').readScopedState;
 let hookCompleted=false;const replacement={call(){}};
 const replace=()=>{replaceOwnedService(f.canvas,'hanaworldsCanvasV5',replacement);hookCompleted=true;};
 if(phase==='before')replace();else f.afterRead(replace);
 await assert.rejects(async()=>read(f.paired.connectionRef,[[0,0,0]]),refused('CAPABILITY_UNAVAILABLE'));
 assert.equal(hookCompleted,true,'provider replacement hook must complete');
 assert.equal(original(f.canvas.get('hanaworldsCanvasV5')),replacement);
 assert.equal(f.calls.length,phase==='before'?0:1);
});
test('lost connection never returns state',async t=>{
 const f=await setup(t);f.setLive(false);await assert.rejects(async()=>f.read(),refused('CURRENT_WORLD_MISMATCH'));assert.deepEqual(f.calls,[]);
});
test('corrupt payload and inactive fiber never return state',async t=>{
 const f=await setup(t);f.badImage();await assert.rejects(async()=>f.read(),refused('SCHEMA_INVALID'));
 const captured=f.canvas.get('hanaworldsWorldFacts').readScopedState;await f.canvasFiber.dispose();
 await assert.rejects(async()=>captured(f.paired.connectionRef,[[0,0,0]]),refused('CAPABILITY_UNAVAILABLE'));
 await f.adapter.close();
});
test('closed Adapter refuses a retained authorized method',async t=>{
 const f=await setup(t),read=f.canvas.get('hanaworldsWorldFacts').readScopedState;await f.adapter.close();
 await assert.rejects(async()=>read(f.paired.connectionRef,[[0,0,0]]),refused('ADAPTER_UNAVAILABLE'));
});

test('neutral read retains a named public refusal from an independent native exception constructor',async t=>{
 const f=await setup(t);
 class NativeReadError extends Error {constructor(){super('private constructor detail');this.publicError={code:'TARGET_FACTS_INCOMPLETE',phase:'validate',retryability:'AFTER_NEW_FACTS',mutationState:'NONE',transactionRef:null,causeCode:null,reason:'REQUIRED_FACT_UNKNOWN'};}}
 f.afterRead(()=>{throw new NativeReadError();});
 await assert.rejects(f.read(),refused('TARGET_FACTS_INCOMPLETE'));
 assert.equal(f.calls.length,1);
 f.afterRead(()=>{throw {publicError:{code:'TARGET_FACTS_INCOMPLETE',extra:true}};});
 await assert.rejects(f.read(),refused('UNKNOWN_REQUIRED_FIELD'));
});


// The merged source's optional failure provenance survives neutral reads across
// independently constructed exceptions, using protocol fields rather than instanceof.
test('neutral scoped errors retain merged source provenance and reject malformed source',async t=>{
 const f=await setup(t);
 const source={owner:'world-source',operation:'snapshot',resource:'courier-result-body',kind:'LIMIT',nativeCode:null};
 for(const failure of [
  Object.assign(new Error('LIMIT_EXCEEDED'),{source}),
  {publicError:{code:'LIMIT_EXCEEDED',phase:'validate',retryability:'AFTER_NEW_FACTS',mutationState:'NONE',transactionRef:null,causeCode:null,reason:'REQUIRED_FACT_UNKNOWN',source}},
 ]) {
  f.afterRead(()=>{throw failure;});
  await assert.rejects(f.read(),e=>{assert.deepEqual(plain(e.publicError.source),source);return refused('LIMIT_EXCEEDED')(e);});
 }
 f.afterRead(()=>{throw Object.assign(new Error('LIMIT_EXCEEDED'),{source:{...source,privatePath:'/invented'}});});
 await assert.rejects(f.read(),refused('UNKNOWN_REQUIRED_FIELD'));
});
