// SOURCE/FIXTURE: actual Adapter lifecycle + runtime, synthetic native ownership and engine facts.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, realpath, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createLocalWorldPort } from '../src/local-world-port.mjs';
import { createLocalRuntime } from '../src/local-runtime.mjs';
import { LocalCourier } from '../src/local-courier.mjs';

const base = process.env.HW_BIND_TEST_ROOT;
if (!base) throw Error('HW_BIND_TEST_ROOT must be this card own run');
const profile = {profileVersion:'state-profile/v2',nodeFields:['nodeName','param1','param2'],metadataMode:'exact',inventoryMode:'exact',timerMode:'exact',derivedLightMode:'recompute-with-readback'};
async function setup(t) {
  await mkdir(base,{recursive:true});
  const root = await realpath(await mkdtemp(join(base,'multi-')));
  for (const d of ['worlds','home','games/fixture','mods/worldedit']) await mkdir(join(root,d),{recursive:true});
  await writeFile(join(root,'games/fixture/game.conf'),'title = Fixture\n');
  await writeFile(join(root,'mods/worldedit/mod.conf'),'name = worldedit\n');
  const records = new Map(), stopped = [], engines = new Map(), handshakeFailures = new Set(), inspectionFailuresOnLoad = new Set(), rejectedInspections = new Set();
  let local;
  t.mock.method(LocalCourier,'open', async world => {
    const engine = {connectionIncarnationRef:`incarnation:${world.worldRef}`,closed:false,
      handshake:async()=>{if(handshakeFailures.has(world.worldRef)) throw Error('PAYLOAD_VERSION_MISMATCH');},
      profile:async()=>{if(inspectionFailuresOnLoad.has(world.worldPath)) rejectedInspections.add(world.worldPath);return profile;}, close:async()=>{engine.closed=true;}};
    engines.set(world.connectionRef,engine); return engine;
  });
  const host = {
    async acquire(q) {const controlRef=`native:${records.size}`;records.set(controlRef,{...q,pid:1000+records.size,exited:false});return {controlRef,worldPath:q.worldPath};},
    async inspect(q) {const r=records.get(q.controlRef);assert.ok(r);assert.equal(r.operationRef,q.operationRef);if(r.exited||rejectedInspections.has(r.worldPath)) throw Error('CURRENT_WORLD_MISMATCH');return {state:'CURRENT',worldPath:r.worldPath,processId:r.pid,operationRef:r.operationRef};},
    async withStoppedWorld(q,consume) {const r=records.get(q.controlRef);r.exited=true;stopped.push(r.worldPath);return consume({state:'STOPPED',worldPath:r.worldPath,processId:r.pid,operationRef:r.operationRef});},
  };
  const runtime=createLocalRuntime({ctx:{},homePath:(...parts)=>join(root,'home',...parts),inspectConnection:ref=>local.inspectConnection(ref)});
  local=createLocalWorldPort({roots:[join(root,'worlds')],resolveControl:()=>host,runtime});
  t.after(async()=>{await local.close();await runtime.close();await rm(root,{recursive:true});});
  const make=name=>local.port.createFlatWorld({requesterRef:'host',userPath:root,worldName:name});
  const acquire=w=>local.port.acquire({requesterRef:'host',userPath:root,connectionRef:w.connectionRef,action:'BIND_RUNNING_WORLD'});
  const query=l=>({requesterRef:'host',connectionRef:l.connectionRef,leaseRef:l.leaseRef});
  const pair=async w=>{const lease=await acquire(w);return {lease,paired:await local.port.pair(query(lease))};};
  const inventory=()=>runtime.port.call('DiscoverConnections',{contractVersion:'world-adapter/v7',sessionRef:'fixture:S1',requestId:'inventory',adapterId:'hanaworlds-adapter-luanti'});
  return {root,local,runtime,records,stopped,engines,handshakeFailures,inspectionFailuresOnLoad,make,acquire,query,pair,inventory};
}

test('pairing B preserves A native ownership/incarnation and exposes both connections',async t=>{
  const f=await setup(t), a=await f.make('A'), b=await f.make('B');
  const pa=await f.pair(a), pb=await f.pair(b);
  assert.deepEqual(f.stopped,[],'pair B must not stop A');
  assert.equal((await f.local.port.inspect(f.query(pa.lease))).nativeProcessId,pa.lease.nativeProcessId);
  assert.equal((await f.local.port.inspect(f.query(pb.lease))).nativeProcessId,pb.lease.nativeProcessId);
  const result=await f.inventory();assert.equal(result.error,null);
  assert.deepEqual(new Set(result.result.connections.map(r=>r.connectionRef)),new Set([a.connectionRef,b.connectionRef]));
  assert.equal(result.result.connections.find(r=>r.connectionRef===a.connectionRef).connectionIncarnationRef,pa.paired.connectionIncarnationRef);
  await f.local.port.stopWorld({requesterRef:'host',connectionRef:b.connectionRef,worldRef:b.worldRef});
  assert.equal((await f.local.inspectConnection(a.connectionRef)).processId,pa.lease.nativeProcessId);
  assert.equal(f.engines.get(a.connectionRef).closed,false);assert.equal(f.engines.get(b.connectionRef).closed,true);
});

test('duplicate running-world acquisition is rejected before creating or stopping native ownership',async t=>{
  const f=await setup(t), a=await f.make('A');await f.pair(a);
  const count=f.records.size;
  await assert.rejects(f.acquire(a),/CURRENT_WORLD_MISMATCH/);
  assert.equal(f.records.size,count);assert.deepEqual(f.stopped,[]);
  assert.equal((await f.local.inspectConnection(a.connectionRef)).state,'CURRENT');
});

test('failed B handshake preserves usable A and stops only the failed B process',async t=>{
  const f=await setup(t), a=await f.make('A'), b=await f.make('B');const pa=await f.pair(a);
  f.handshakeFailures.add(b.worldRef);
  await assert.rejects(f.pair(b),/CURRENT_WORLD_MISMATCH/);
  assert.deepEqual(f.stopped,[b.worldPath]);
  assert.equal((await f.local.port.inspect(f.query(pa.lease))).nativeProcessId,pa.lease.nativeProcessId);
  assert.equal(f.engines.get(a.connectionRef).closed,false);
});

test('failed final B inspection retires only the newly opened B runtime and preserves A',async t=>{
 const f=await setup(t),a=await f.make('A'),b=await f.make('B');await f.pair(a);
 f.inspectionFailuresOnLoad.add(b.worldPath);await assert.rejects(f.pair(b),/CURRENT_WORLD_MISMATCH/);
 assert.equal(f.engines.get(b.connectionRef).closed,true,'failed pair must not leave B in runtime');
 assert.equal(f.engines.get(a.connectionRef).closed,false);assert.deepEqual(f.stopped,[b.worldPath]);
 const result=await f.inventory();assert.equal(result.error,null);assert.deepEqual(result.result.connections.map(r=>r.connectionRef),[a.connectionRef]);
});
