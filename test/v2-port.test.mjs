import assert from 'node:assert/strict';
import test from 'node:test';
import { WorldAdapterV2, worldAdapterOperations } from '../src/v2-port.mjs';
import { createLuantiOperations } from '../src/v2-operations.mjs';

const valid = { contractVersion: 'world-adapter/v2', actorRef: 'player:alice',
  sessionRef: 'session:one', requestId: 'request:one', authorizationRef: 'grant:one',
  adapterId: 'hanaworlds-adapter-luanti' };

test('nine v2 operations exist and decode failure never queries provider', async () => {
  assert.equal(worldAdapterOperations.length, 9);
  let authCalls = 0;
  const port = new WorldAdapterV2({ authority: { verify() { authCalls++; return null; } } });
  const unknown = await port.call('DiscoverConnections', { ...valid, unexpectedAuthority: true });
  assert.deepEqual([unknown.result, unknown.error.code, unknown.error.phase,
    unknown.error.reason, unknown.error.mutationState],
  [null, 'UNKNOWN_REQUIRED_FIELD', 'decode', 'UNKNOWN_FIELD', 'NONE']);
  const duplicate = await port.call('DiscoverConnections',
    '{"actorRef":"A","\\u0061ctorRef":"B"}');
  assert.equal(duplicate.error.code, 'NON_CANONICAL_AMBIGUITY');
  assert.equal(duplicate.error.reason, 'DUPLICATE_DECODED_KEY');
  assert.equal(authCalls, 0);
  const invalidUtf8 = await port.call('DiscoverConnections', Uint8Array.from([0xc3, 0x28]));
  assert.equal(invalidUtf8.error.code, 'SCHEMA_INVALID');
  assert.equal(invalidUtf8.error.reason, 'INVALID_UTF8');
  assert.equal(authCalls, 0);
  const nested = await port.call('InspectWorld', {
    contractVersion: 'world-adapter/v2', actorRef: 'player:alice',
    sessionRef: 'session:one', requestId: 'request:nested', authorizationRef: 'grant:one',
    worldRef: 'luanti:test', expectedWorldRevision: 'revision:one',
    sampledBounds: { min: [0, 0, 0], max: [0, 0, 0], arbitrary: true },
  });
  assert.equal(nested.error.code, 'UNKNOWN_REQUIRED_FIELD');
  assert.equal(authCalls, 0);
});

test('current authorization precedes terminal replay and denies zero writes', async () => {
  let revoked = false;
  let writes = 0;
  const port = new WorldAdapterV2({
    authority: { verify(request) { return revoked ? { current: false } :
      { current: true, actorRef: request.actorRef, sessionRef: request.sessionRef,
        authorizationRef: request.authorizationRef, domainOwner: 'hanaworlds-canvas' }; } },
    operations: { DiscoverConnections() { writes++; return { capabilityRevision: 'one', connections: [] }; } },
  });
  const first = await port.call('DiscoverConnections', valid);
  assert.equal(first.error, null);
  assert.equal(writes, 1);
  const replay = await port.call('DiscoverConnections', valid);
  assert.deepEqual(replay, first);
  assert.equal(writes, 1);
  revoked = true;
  const denied = await port.call('DiscoverConnections', { ...valid, adapterId: 'different' });
  assert.equal(denied.error.code, 'AUTHORIZATION_REVOKED');
  assert.equal(denied.error.phase, 'authorize');
  assert.equal(writes, 1);
  revoked = false;
  const mismatch = await port.call('DiscoverConnections', { ...valid, adapterId: 'different' });
  assert.equal(mismatch.error.code, 'REPLAY_MISMATCH');
  assert.equal(writes, 1);
});

test('missing native verifier is a typed zero-write failure', async () => {
  let writes = 0;
  const port = new WorldAdapterV2({ operations: { DiscoverConnections() { writes++; return {}; } } });
  const response = await port.call('DiscoverConnections', valid);
  assert.equal(response.error.code, 'PERMISSION_DENIED');
  assert.equal(response.error.phase, 'authorize');
  assert.equal(writes, 0);
});

test('non-Canvas mutation caller is rejected before any backend query', async () => {
  let calls = 0;
  const port = new WorldAdapterV2({ authority: { verify: async request =>
    ({ current: true, actorRef: request.actorRef, sessionRef: request.sessionRef,
      authorizationRef: request.authorizationRef, domainOwner: 'wrong-plugin' }) },
  operations: { QueryTransaction() { calls++; return {}; } } });
  const request = { ...Object.fromEntries(Object.entries(valid)
    .filter(([key]) => key !== 'adapterId')),
  worldRef: 'luanti:one', transactionId: 'tx:one', transactionPayloadDigest: 'a'.repeat(64) };
  const response = await port.call('QueryTransaction', request);
  assert.equal(response.error.code, 'PERMISSION_DENIED');
  assert.equal(response.error.reason, 'OWNERSHIP_VIOLATION');
  assert.equal(calls, 0);
});

test('DSH operation wiring exposes real empty inventory and fails unsupported mutation closed', async () => {
  const runtime = createLuantiOperations({ roots: [] });
  const port = new WorldAdapterV2({ authority: { verify: async request =>
    ({ current: true, actorRef: request.actorRef, sessionRef: request.sessionRef,
      authorizationRef: request.authorizationRef, domainOwner: 'hanaworlds-canvas' }) },
  operations: runtime.operations });
  const discovered = await port.call('DiscoverConnections', valid);
  assert.deepEqual(discovered.result.connections, []);
  assert.match(discovered.result.capabilityRevision, /^[0-9a-f]{64}$/);
  const inspect = await port.call('InspectWorld', {
    ...Object.fromEntries(Object.entries(valid).filter(([key]) => key !== 'adapterId')),
    requestId: 'request:inspect', worldRef: 'luanti:test', expectedWorldRevision: 'revision:one',
    sampledBounds: { min: [0, 0, 0], max: [0, 0, 0] },
  });
  assert.equal(inspect.result, null);
  assert.equal(inspect.error.code, 'CAPABILITY_UNAVAILABLE');
  await runtime.close();
});

test('public boundary retains bare postwrite errors as UNKNOWN with their phase', async () => {
  const request = { ...Object.fromEntries(Object.entries(valid)
    .filter(([key]) => key !== 'adapterId')),
  worldRef: 'luanti:one', transactionId: 'tx:one', transactionPayloadDigest: 'a'.repeat(64) };
  for (const [code, phase] of [['RECOVERY_PENDING', 'validate'],
    ['READBACK_FAILED', 'readback'], ['RESTORE_FAILED', 'restore']]) {
    const port = new WorldAdapterV2({ authority: { verify: async value =>
      ({ current: true, actorRef: value.actorRef, sessionRef: value.sessionRef,
        authorizationRef: value.authorizationRef, domainOwner: 'hanaworlds-canvas' }) },
    operations: { QueryTransaction() { throw new Error(code); } } });
    const response = await port.call('QueryTransaction', request);
    assert.equal(response.error.code, code);
    assert.equal(response.error.phase, phase);
    assert.equal(response.error.mutationState, 'UNKNOWN');
    assert.equal(response.error.transactionRef, request.transactionId);
  }
});

test('public boundary rejects a non-conforming nested result', async () => {
  const port = new WorldAdapterV2({ authority: { verify: async request =>
    ({ current: true, actorRef: request.actorRef, sessionRef: request.sessionRef,
      authorizationRef: request.authorizationRef }) },
  operations: { DiscoverConnections() { return { capabilityRevision: 'one',
    connections: [{ arbitrary: true }] }; } } });
  const response = await port.call('DiscoverConnections', valid);
  assert.equal(response.result, null);
  assert.equal(response.error.code, 'SCHEMA_INVALID');
});

test('InspectWorld requires trusted object context and projects actual three-value engine cells', async () => {
  const request = { ...Object.fromEntries(Object.entries(valid)
    .filter(([key]) => key !== 'adapterId')),
  worldRef: 'luanti:one', expectedWorldRevision: 'world:one',
  sampledBounds: { min: [0, 0, 0], max: [1, 0, 0] } };
  const fake = { async verifyPrincipal(name) { assert.equal(name, 'alice');
    return { current: true, worldRef: request.worldRef, engineActorName: name,
      scope: 'WORLD_BUILD_WITH_ENGINE_PROTECTION', grantRef: 'native:one' }; },
    async inspect(positions) {
      assert.deepEqual(positions, [[0, 0, 0], [1, 0, 0]]);
      return { occupiedCells: [{ position: [0, 0, 0], nodeName: 'probe:stone', param2: 0 }],
        knownEmptyCells: [], unknownCells: [{ position: [1, 0, 0], reason: 'UNLOADED' }] };
    }, async close() {} };
  const runtime = createLuantiOperations({ inspectContext: { read: async () => ({
    current: true, worldRef: request.worldRef, worldRevision: request.expectedWorldRevision,
    objectRef: 'object:one', objectRevision: 'object:revision:one',
    catalogueDigest: 'a'.repeat(64), frameDigest: 'b'.repeat(64), portals: [],
    capacity: { check: async () => ({ allowed: true }) },
  }) } });
  runtime.open.set(request.worldRef, fake);
  const port = new WorldAdapterV2({ authority: { verify: async value => ({
    current: true, actorRef: value.actorRef, sessionRef: value.sessionRef,
    authorizationRef: value.authorizationRef, engineActorName: 'alice' }) },
  operations: runtime.operations });
  const result = await port.call('InspectWorld', request);
  assert.equal(result.error, null);
  assert.equal(result.result.objectRef, 'object:one');
  assert.equal(result.result.unknownCells[0].reason, 'UNLOADED');
  assert.equal(result.result.usableVolume, null);
  assert.match(result.result.coverageDigest, /^[0-9a-f]{64}$/);
  await runtime.close();
});

test('postwrite result validation cannot claim NONE, while a known prewrite fault can', async () => {
  const request = { ...Object.fromEntries(Object.entries(valid)
    .filter(([key]) => key !== 'adapterId')),
  worldRef: 'luanti:one', originTransactionId: 'tx:one',
  operationDigest: 'a'.repeat(64), beforeImageDigest: 'b'.repeat(64),
  restoreAttemptIdentity: 'restore:one', guarantee: 'RECOVERABLE_VERIFIED' };
  const authority = { verifyService: async value => ({ current: true,
    actorRef: value.actorRef, sessionRef: value.sessionRef,
    authorizationRef: value.authorizationRef }) };
  let writes = 0;
  const invalidResult = new WorldAdapterV2({ authority, operations: {
    RestoreTransaction() { writes++; return {}; },
  } });
  const uncertain = await invalidResult.call('RestoreTransaction', request);
  assert.equal(writes, 1);
  assert.deepEqual([uncertain.error.code, uncertain.error.phase,
    uncertain.error.reason, uncertain.error.mutationState,
    uncertain.error.retryability, uncertain.error.causeCode],
  ['RECOVERY_PENDING', 'restore', 'RESTORE_ERROR', 'UNKNOWN',
    'SAME_TRANSACTION_QUERY', 'SCHEMA_INVALID']);
  assert.equal(uncertain.error.transactionRef, 'tx:one');
  const prewrite = new WorldAdapterV2({ authority, operations: {
    RestoreTransaction() { throw new Error('CAPABILITY_UNAVAILABLE'); },
  } });
  const denied = await prewrite.call('RestoreTransaction', { ...request, requestId: 'prewrite' });
  assert.equal(denied.error.code, 'CAPABILITY_UNAVAILABLE');
  assert.equal(denied.error.mutationState, 'NONE');
  assert.equal(writes, 1);
});
