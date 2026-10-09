import assert from 'node:assert/strict';
import test from 'node:test';
import * as C from '#contracts';
const mod=await import('../src/world-retirement.mjs').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return null;throw e;});
function fixture({sessions=[],reserveFailure=false}={}) {
 const calls=[];const provider={async call(name,q){C.validateBoundRequest('canvas/v6',name,q);calls.push({name,q});
 if(name==='ReserveWorldRetirement'&&reserveFailure)throw Error('STALE_REVISION');
 const result=name==='ListWorldSelections'?{worldRef:q.worldRef,inventoryRevision:'inventory:1',sessionRefs:sessions,retirementReservationRef:null}:
 name==='ReserveWorldRetirement'?{worldRef:q.worldRef,reservationRef:'reservation:1',inventoryRevision:q.expectedInventoryRevision}:
 {worldRef:q.worldRef,reservationRef:q.reservationRef,outcome:q.outcome,inventoryRevision:'inventory:3'};
 return C.validateBoundResponse('canvas/v6',name,q,{contractVersion:'canvas/v6',requestId:q.requestId,result,error:null});}};
 assert.ok(mod,'retirement consumer is missing');return {provider,calls,run:remove=>mod.withWorldRetirement(()=>provider,'world:A',remove)};
}
test('any Canvas Session binding blocks Adapter removal before reservation',async()=>{const f=fixture({sessions:['S2']});let removed=false;await assert.rejects(f.run(async()=>{removed=true;}),/TRANSACTION_CONFLICT/);assert.equal(removed,false);assert.deepEqual(f.calls.map(c=>c.name),['ListWorldSelections']);});
test('successful removal remains in Canvas reservation until RETIRED release',async()=>{const f=fixture();await f.run(async()=>{assert.equal(f.calls.at(-1).name,'ReserveWorldRetirement');return {deleted:true};});assert.deepEqual(f.calls.map(c=>c.name),['ListWorldSelections','ReserveWorldRetirement','ReleaseWorldRetirement']);assert.equal(f.calls.at(-1).q.outcome,'RETIRED');});
test('stale reservation refuses file mutation and complete pre-mutation failure releases ABORTED',async()=>{let removed=false;const stale=fixture({reserveFailure:true});await assert.rejects(stale.run(async()=>{removed=true;}),/STALE_REVISION/);assert.equal(removed,false);const f=fixture();await assert.rejects(f.run(async()=>{throw Error('WORLD_IN_USE');}),/WORLD_IN_USE/);assert.equal(f.calls.at(-1).q.outcome,'ABORTED');});
test('incomplete removal aborts Canvas retirement and reports actual partial removal rather than declaring success',async()=>{const f=fixture();await assert.rejects(f.run(async()=>{throw Error('DELETE_INCOMPLETE');}),e=>e.message==='DELETE_INCOMPLETE'&&e.details.retirementReservationRef==='reservation:1');assert.equal(f.calls.at(-1).name,'ReleaseWorldRetirement');assert.equal(f.calls.at(-1).q.outcome,'ABORTED');});
