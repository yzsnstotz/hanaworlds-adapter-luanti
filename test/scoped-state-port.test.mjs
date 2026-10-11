// SOURCE/FIXTURE: real Adapter apply and official Cordis; the native engine/Host are fixtures.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Context, symbols } from '@deepseek-ai/cordis';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as C from '#contracts';
import { apply, inject } from '../src/index.mjs';
import { LocalCourier } from '../src/local-courier.mjs';
import { ENGINE_GUARDS } from '../src/safety-capabilities.mjs';
const plain = v => JSON.parse(JSON.stringify(v));
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
 const calls = [];
 const native = {closed:false,engineGuards:ENGINE_GUARDS,connectionIncarnationRef:'fixture-incarnation',
  handshake:async()=>{},close:async()=>{native.closed=true;},catalogue:async()=>plain(catalogue),
  profile:async()=>({}),regionLimits:async()=>({mapblockSize:16,mapgenLimit:31000}),
  snapshot:async positions=>{
   calls.push(plain(positions)); await afterRead();
   return {worldRef:bound.worldRef,coveredPositions:positions,records:malformed?[]:positions.map(position=>({
    position,nodeName:'air',param1:12,param2:0,metadata:{owner:'opaque-fixture'},inventory:{},timer:null}))};
  }};
 t.mock.method(LocalCourier, 'open', async world => {bound=world;return native;});
 const ctx = new Context(); let adapter, canvas;
 ctx.provide('webServer', {register:()=>()=>{}});ctx.provide('dshHomePath', (...p)=>join(root,'home',...p));
 const host = {acquire:async q=>({controlRef:'fixture-control',worldPath:q.worldPath}),
  inspect:async q=>{if(!live)throw Error('CURRENT_WORLD_MISMATCH');return {state:'CURRENT',worldPath:q.worldPath,processId:1234,operationRef:q.operationRef};},
  withStoppedWorld:async(q,cb)=>cb({state:'STOPPED',worldPath:q.worldPath,processId:1234,operationRef:q.operationRef})};
 ctx.provide('hanaworldsNativeEngineControl',host);
 const adapterFiber=ctx.plugin({name:'actual-adapter',inject,apply(c){adapter=apply(c,{localUserPath:profile,localWorldRoots:[worlds]});}});await adapterFiber.await();
 const canvasFiber=ctx.plugin({name:'renamed-legitimate-canvas',apply(c){canvas=c;c.provide('hanaworldsCanvasV5',{call(){throw Error('UNEXPECTED_CANVAS_CALL');}});}});await canvasFiber.await();
 t.after(async()=>{await adapter.close();await canvasFiber.dispose();await adapterFiber.dispose();await ctx.fiber.dispose();});
 const local=ctx.get('hanaworldsLocalWorlds');
 const created=await local.createFlatWorld({requesterRef:'fixture-host',userPath:profile,worldName:'owned'});
 const lease=await local.acquire({connectionRef:created.connectionRef,requesterRef:'fixture-host',userPath:profile,action:'BIND_RUNNING_WORLD'});
 const paired=await local.pair({connectionRef:created.connectionRef,requesterRef:'fixture-host',leaseRef:lease.leaseRef});
 return {ctx,canvas,canvasFiber,adapter,paired,native,calls,read:(positions=[[0,0,0]])=>canvas.get('hanaworldsWorldFacts').readScopedState(paired.connectionRef,positions),
  afterRead:f=>{afterRead=f;},setLive:v=>{live=v;},badImage:()=>{malformed=true;}};
}
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
 const replace=()=>f.canvas.set('hanaworldsCanvasV5',{call(){}});
 if(phase==='before')replace();else f.afterRead(replace);
 await assert.rejects(async()=>read(f.paired.connectionRef,[[0,0,0]]),refused('CAPABILITY_UNAVAILABLE'));
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
