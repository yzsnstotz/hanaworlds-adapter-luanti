// Minimal consumption of the installed contracts' normative fixture; not provider/runtime proof.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as C from '#contracts';
import fixture from 'hanaworlds-contracts/fixtures/session-world' with {type:'json'};
test('handshake accepts itself and the same contracts major, rejects another major',()=>{
 assert.equal(C.contractHandshake.contracts,`hanaworlds-contracts@${C.version}`);C.checkContractsVersion(C.contractHandshake.contracts);
 assert.equal(C.checkContractHandshake(C.contractHandshake).result,'HANDSHAKE_VERSION_MATCH');
 // contracts 1.x: same major 1 is accepted; the 0.x line and major 2 are refused.
 assert.equal(C.checkContractHandshake({...C.contractHandshake,contracts:'hanaworlds-contracts@1.0.0'}).result,'HANDSHAKE_VERSION_MATCH');
 for(const other of ['0.5.6','2.0.0']) assert.throws(()=>C.checkContractHandshake({...C.contractHandshake,contracts:`hanaworlds-contracts@${other}`}),e=>e.code==='UNSUPPORTED_VERSION');
});
test('all fifteen public Session/world sequence envelopes and trusted Session directory validate',()=>{
 for(const row of fixture.ownerAScenario)C.validateBoundResponse(row.wire,row.operation,row.request,row.response);
 for(const [name,key] of [['ListSessions','list'],['ReadSessionIdentity','read']]){const r=fixture.sessionDirectory[key];C.validateBoundResponse('session/v4',name,r.request,r.response);}
});
test('selected disconnected context retains last incarnation and unsupported Session delete cannot authorize retirement',()=>{
 const selected=fixture.connectionState.boundS2A;
 assert.equal(C.describeSelectionConnection(selected,fixture.adapterInventory.A).status,'CONNECTED');
 assert.equal(C.describeSelectionConnection(selected,fixture.adapterInventory.AStopped).status,'SELECTED_NOT_CONNECTED');
 assert.equal(C.describeSelectionConnection(selected,fixture.adapterInventory.AReopened).status,'SELECTED_NOT_CONNECTED');
 assert.ok(selected.context.localContext);
 assert.throws(()=>C.requireSessionDeleteSupported(fixture.sessionDeletion.unsupportedCapabilities),/SESSION_DELETE_UNSUPPORTED/);
 assert.equal(fixture.sessionDeletion.unsupported.retireCalled,false);
});
