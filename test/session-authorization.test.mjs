import assert from 'node:assert/strict';
import test from 'node:test';
import { apply } from '../src/index.mjs';

const binding = {
  sessionRef: 'session:one', sessionIncarnationRef: 'incarnation:one',
  hostIssuerRef: 'host:one', worldRef: 'world:one', engineActorName: 'alice',
  expectedGrantRef: 'grant:one', authorizationRef: 'authorization:one',
  actorRef: 'actor:alice', bindingRef: 'binding:one', grantEpoch: 'grant:one',
  allowedActions: ['APPLY_RECOVERABLE', 'READ'],
};

test('versioned Host call refuses to infer a missing original Session proof', async () => {
  const provided = new Map();
  const host = {
    authenticateAdapterCaller: async () => true,
    call: async (operation, request) => {
      assert.equal(operation, 'ReadOriginalBinding');
      return { contractVersion: 'session-authorization/v1', requestId: request.requestId,
        result: { sessionRef: request.sessionRef, status: 'UNKNOWN' } };
    },
  };
  const adapter = apply({ webServer: { register() {} },
    provide: (name, service) => provided.set(name, service),
    get: name => name === 'hanaworldsSessionAuthorizationHostV1' ? host : undefined,
  }, { localWorldRoots: [] });
  try {
    const service = provided.get('hanaworldsSessionAuthorizationV1');
    assert.equal(typeof service.call, 'function');
    const response = await service.call('VerifyCurrentGrant', {
      contractVersion: 'session-authorization/v1', requestId: 'request:one', binding });
    assert.deepEqual(JSON.parse(JSON.stringify(response)), { contractVersion: 'session-authorization/v1',
      requestId: 'request:one', result: { sessionRef: 'session:one', status: 'UNKNOWN' } });
  } finally { await adapter.close(); }
});

test('unpaired local world is UNKNOWN even when Host has an original record', async () => {
  const provided = new Map();
  const host = { authenticateAdapterCaller: async () => true,
    call: async (_operation, request) => ({ contractVersion: 'session-authorization/v1',
      requestId: request.requestId,
      result: { status: 'CURRENT', sessionRef: request.sessionRef, binding } }) };
  const adapter = apply({ webServer: { register() {} },
    provide: (name, service) => provided.set(name, service),
    get: name => name === 'hanaworldsSessionAuthorizationHostV1' ? host : undefined,
  }, { localWorldRoots: [] });
  try {
    const response = await provided.get('hanaworldsSessionAuthorizationV1')
      .call('VerifyCurrentGrant', { contractVersion: 'session-authorization/v1',
        requestId: 'request:unpaired', binding });
    assert.equal(response.result.status, 'UNKNOWN');
  } finally { await adapter.close(); }
});
