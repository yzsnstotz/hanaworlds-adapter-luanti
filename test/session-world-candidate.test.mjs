// Minimal consumption of this exact published candidate's normative fixture; not provider/runtime proof.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as C from '#contracts';
import fixture from 'hanaworlds-contracts/fixtures/session-world' with {type:'json'};
test('candidate exact handshake accepts itself and rejects old exact package',()=>{
 assert.equal(C.contractHandshake.contracts,'hanaworlds-contracts@0.5.4-rc.1');
 assert.equal(C.checkContractHandshake(C.contractHandshake).result,'HANDSHAKE_VERSION_MATCH');
 assert.throws(()=>C.checkContractHandshake({...C.contractHandshake,contracts:'hanaworlds-contracts@0.5.3'}));
});
test('all fifteen public Session/world sequence envelopes and trusted Session directory validate',()=>{
 for(const row of fixture.ownerAScenario)C.validateBoundResponse(row.wire,row.operation,row.request,row.response);
 for(const [name,key] of [['ListSessions','list'],['ReadSessionIdentity','read']]){const r=fixture.sessionDirectory[key];C.validateBoundResponse('session/v3',name,r.request,r.response);}
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
