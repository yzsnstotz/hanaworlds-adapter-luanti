// FIXTURE: controller consumes public Adapter ports; native processes are not simulated as REAL.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createWorldManager } from '../dev/world-manage/manager.mjs';
function setup() {
  let bound=null, deleted=[], counter=0, processes=[];
  const rows=[{connectionRef:'a',worldRef:'world-a',worldPath:'/worlds/A',worldName:'A'}, {connectionRef:'b',worldRef:'world-b',worldPath:'/worlds/B',worldName:'B'}];
  const local={discover:async()=>rows.filter(r=>!deleted.includes(r.connectionRef)),
    describeFlatWorldCreation:async()=>({ready:true}),
    createFlatWorld:async()=>{const r={connectionRef:`new-${++counter}`,worldRef:`new-world-${counter}`,worldPath:`/worlds/N${counter}`,worldName:`N${counter}`};rows.push(r);return r},
    acquire:async q=>({...q,leaseRef:'lease',nativeProcessId:123}),
    pair:async q=>{bound=q.connectionRef;return {...q,worldRef:rows.find(r=>r.connectionRef===q.connectionRef).worldRef,connectionIncarnationRef:'incarnation'}},
    stopWorld:async()=>{bound=null;return {stopped:true}}, inspect:async()=>({current:true}),
    describeWorldDeletion:async q=>({...rows.find(r=>r.connectionRef===q.connectionRef),productCreated:true,deletable:q.connectionRef!==bound,blockers:q.connectionRef===bound?[{code:'WORLD_IN_USE',reason:'ADAPTER_CONNECTION_BOUND'}]:[],dataLoss:{scope:'ENTIRE_WORLD_DIRECTORY',files:3,bytes:20}}),
    deleteWorld:async q=>{deleted.push(q.connectionRef);return {deleted:true,readback:{listed:false,pathExists:false}}}};
  const manager=createWorldManager({local,requesterRef:'host',userPath:'/profile',foreignActivity:async()=>processes,
    game:{enter:async()=>({started:true}),running:()=>false},validateContext:c=>c});
  return {manager,deleted,setProcesses:p=>{processes=p}};
}
test('same manager creates twice and switches A to B to A without recreating',async()=>{const t=setup();await t.manager.connect('a');await t.manager.connect('b');await t.manager.connect('a');assert.equal((await t.manager.state()).current.connectionRef,'a');const a=await t.manager.create();const b=await t.manager.create();assert.notEqual(a.connectionRef,b.connectionRef);assert.equal((await t.manager.state()).worlds.length,4)});
test('cancel deletes nothing and a confirmation cannot select another world',async()=>{const t=setup();const p=await t.manager.preview('b');await t.manager.cancel(p.confirmationRef);assert.deepEqual(t.deleted,[]);await assert.rejects(t.manager.confirm(p.confirmationRef),/CONFIRMATION_NOT_FOUND/);const p2=await t.manager.preview('b');await t.manager.confirm(p2.confirmationRef);assert.deepEqual(t.deleted,['b'])});
test('fixture binding introduced after preview rejects confirmation and preserves world',async()=>{const t=setup();const p=await t.manager.preview('b');await t.manager.setFixtureBinding('b',true);await assert.rejects(t.manager.confirm(p.confirmationRef),/WORLD_IN_USE/);assert.deepEqual(t.deleted,[])});
test('running foreign world rejects preview and final confirmation',async()=>{const t=setup();const p=await t.manager.preview('b');t.setProcesses([{pid:456,worldPath:'/worlds/B'}]);await assert.rejects(t.manager.confirm(p.confirmationRef),/WORLD_IN_USE/);assert.deepEqual(t.deleted,[]);const r=await t.manager.preview('b');assert.equal(r.deletable,false);assert.ok(r.blockers.some(b=>b.reason==='EXTERNAL_NATIVE_PROCESS'))});
test('unknown connection and current world are never eligible',async()=>{const t=setup();await assert.rejects(t.manager.preview('../outside'),/CONNECTION_NOT_FOUND/);await t.manager.connect('a');const p=await t.manager.preview('a');assert.equal(p.deletable,false);assert.ok(p.blockers.some(b=>b.reason==='LIVE_SESSION_BINDING'));await assert.rejects(t.manager.confirm(p.confirmationRef),/WORLD_IN_USE/);assert.deepEqual(t.deleted,[])});
test('stop retires current and fixture binding, then the same service reconnects',async()=>{const t=setup();await t.manager.connect('a');await t.manager.stop();assert.equal((await t.manager.state()).current,null);assert.equal((await t.manager.preview('a')).deletable,true);await t.manager.connect('b');assert.equal((await t.manager.state()).current.connectionRef,'b')});
