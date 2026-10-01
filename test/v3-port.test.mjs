import test from 'node:test';
import assert from 'node:assert/strict';
import wireInputs from 'hanaworlds-contracts/v3/fixtures/wire-inputs-v3' with { type: 'json' };
import closureOracles from 'hanaworlds-contracts/v3/fixtures/closure-oracles-v3' with { type: 'json' };
import { ContractError } from 'hanaworlds-contracts/v3';
import { WorldAdapterV3 } from '../src/v3-port.mjs';

const request = { contractVersion: 'world-adapter/v3', actorRef: 'author',
  sessionRef: 'session', requestId: 'request', authorizationRef: 'grant',
  adapterId: 'hanaworlds-adapter-luanti' };

test('v3 admits public schema before authority, verifies current proof, and rejects foreign owner', async () => {
  let checked = 0;
  let called = 0;
  const authority = { verify: async () => {
    checked++;
    return { current: true, actorRef: 'author', sessionRef: 'session',
      authorizationRef: 'grant', worldRef: 'world', domainOwner: 'foreign' };
  } };
  const port = new WorldAdapterV3({ authority, operations: {
    DiscoverConnections: async () => { called++; return { capabilityRevision: 'rev', connections: [] }; },
  } });
  await assert.rejects(() => port.call('DiscoverConnections',
    { ...request, surprise: true }), error => error instanceof ContractError &&
      error.publicError.code === 'UNKNOWN_REQUIRED_FIELD');
  assert.equal(checked, 0);
  const valid = await port.call('DiscoverConnections', request);
  assert.equal(valid.error, null);
  assert.equal(valid.contractVersion, 'world-adapter/v3');
  assert.equal(called, 1);
  const foreign = await port.call('QueryPreparedTransaction', {
    contractVersion: 'world-adapter/v3', actorRef: 'author', sessionRef: 'session',
    requestId: 'foreign', authorizationRef: 'grant', worldRef: 'world',
    transactionId: 'tx', operationDigest: 'a'.repeat(64),
    authorizationBindingDigest: 'b'.repeat(64),
  });
  assert.equal(foreign.error.code, 'PERMISSION_DENIED');
});

test('v3 current revocation precedes replay', async () => {
  let current = true;
  let calls = 0;
  const port = new WorldAdapterV3({ authority: { verify: async () => ({ current,
    actorRef: 'author', sessionRef: 'session', authorizationRef: 'grant',
    domainOwner: 'hanaworlds-canvas' }) }, operations: {
    DiscoverConnections: async () => { calls++; return { capabilityRevision: 'rev', connections: [] }; },
  } });
  assert.equal((await port.call('DiscoverConnections', request)).error, null);
  current = false;
  assert.equal((await port.call('DiscoverConnections', request)).error.code, 'AUTHORIZATION_REVOKED');
  assert.equal(calls, 1);
});

test('current world proof must match before a Canvas operation reaches the backend', async () => {
  let calls = 0;
  const port = new WorldAdapterV3({ authority: { verify: async request => ({
    current: true, actorRef: request.actorRef, sessionRef: request.sessionRef,
    authorizationRef: request.authorizationRef, worldRef: 'other-world',
    domainOwner: 'hanaworlds-canvas',
  }) }, operations: { QueryPreparedTransaction: async () => { calls++; } } });
  const response = await port.call('QueryPreparedTransaction', {
    contractVersion: 'world-adapter/v3', actorRef: 'author', sessionRef: 'session',
    requestId: 'wrong-world', authorizationRef: 'grant', worldRef: 'world',
    transactionId: 'tx', operationDigest: 'a'.repeat(64),
    authorizationBindingDigest: 'b'.repeat(64),
  });
  assert.equal(response.error.code, 'AUTHORIZATION_REVOKED');
  assert.equal(calls, 0);
});

test('postwrite result validation stays UNKNOWN and never claims zero mutation', async () => {
  const port = new WorldAdapterV3({ authority: { verify: async request => ({
    current: true, actorRef: request.actorRef, sessionRef: request.sessionRef,
    authorizationRef: request.authorizationRef, worldRef: request.worldRef,
    domainOwner: 'hanaworlds-canvas',
  }) }, operations: { Readback: async () => ({ invalid: true }) } });
  const result = await port.call('Readback', { contractVersion: 'world-adapter/v3',
    actorRef: 'author', sessionRef: 'session', requestId: 'readback',
    authorizationRef: 'grant', worldRef: 'world', transactionId: 'tx',
    coveredPositions: [[0, 0, 0]], stateProfile: { profileVersion: 'state-profile/v2',
      nodeFields: ['nodeName', 'param1', 'param2'], metadataMode: 'exact',
      inventoryMode: 'exact', timerMode: 'exact',
      derivedLightMode: 'recompute-with-readback' } });
  assert.equal(result.error.code, 'RECOVERY_PENDING');
  assert.equal(result.error.mutationState, 'UNKNOWN');
  assert.equal(result.error.phase, 'readback');
});

test('published v3 wire fixture and ambiguity oracles reach the strict public decoder', async () => {
  const fixture = wireInputs.requests.find(item => item.id === 'WIRE-world-adapter-v3');
  const oracle = id => closureOracles.cases.find(item => item.id === id);
  assert.ok(fixture);
  let authorityChecks = 0;
  let worldWrites = 0;
  const port = new WorldAdapterV3({ authority: { verify: async () => {
    authorityChecks++;
    return { current: false };
  } }, operations: { ApplyCompiledTransaction: async () => { worldWrites++; } } });
  const valid = await port.call(fixture.operation, fixture.request);
  assert.equal(valid.error.code, 'AUTHORIZATION_REVOKED');
  assert.equal(authorityChecks, 1);
  assert.equal(worldWrites, oracle('WA-01-VALID').expected.worldWrites);
  await assert.rejects(() => port.call(fixture.operation,
    { ...fixture.request, unknownRequiredField: true }), error =>
    error instanceof ContractError &&
    error.publicError.code === oracle('WA-01-INVALID').expected.code);
  assert.equal(authorityChecks, 1);
  await assert.rejects(() => port.call(fixture.operation,
    oracle('WA-07-INVALID').input.rawJson), error =>
    error instanceof ContractError &&
    error.publicError.code === oracle('WA-07-INVALID').expected.code &&
    error.publicError.phase === oracle('WA-07-INVALID').expected.phase &&
    error.publicError.reason === oracle('WA-07-INVALID').expected.reason);
  assert.equal(authorityChecks, 1);
  await assert.rejects(() => port.call(fixture.operation,
    { ...fixture.request, contractVersion: 'world-adapter/v2' }), error =>
    error instanceof ContractError &&
    error.publicError.code === oracle('WA-09-MIXED-INVALID').expected.code);
  assert.equal(authorityChecks, 1);
  assert.equal(worldWrites, 0);
});

test('revocation wins over a bound digest mismatch before provider execution', async () => {
  const fixture = wireInputs.requests.find(item => item.id === 'WIRE-world-adapter-v3');
  const bad = { ...fixture.request, requestId: 'revoked-bad-digest',
    operationDigest: 'f'.repeat(64) };
  let authorityChecks = 0;
  let worldWrites = 0;
  const port = new WorldAdapterV3({ authority: { verify: async request => {
    authorityChecks++;
    return { current: false, actorRef: request.actorRef,
      sessionRef: request.sessionRef, authorizationRef: request.authorizationRef,
      domainOwner: 'hanaworlds-canvas' };
  } }, operations: { ApplyCompiledTransaction: async () => { worldWrites++; } } });
  const response = await port.call(fixture.operation, bad);
  assert.equal(response.error.code, 'AUTHORIZATION_REVOKED');
  assert.equal(response.error.phase, 'authorize');
  assert.equal(authorityChecks, 1);
  assert.equal(worldWrites, 0);
});

test('authorized bound digest mismatch retains the published typed code', async () => {
  const fixture = wireInputs.requests.find(item => item.id === 'WIRE-world-adapter-v3');
  const bad = { ...fixture.request, requestId: 'authorized-bad-digest',
    operationDigest: 'f'.repeat(64) };
  let worldWrites = 0;
  const port = new WorldAdapterV3({ authority: { verify: async request => ({
    current: true, actorRef: request.actorRef, sessionRef: request.sessionRef,
    authorizationRef: request.authorizationRef, worldRef: request.worldRef,
    domainOwner: 'hanaworlds-canvas',
  }) }, operations: { ApplyCompiledTransaction: async () => { worldWrites++; } } });
  const response = await port.call(fixture.operation, bad);
  assert.equal(response.error.code, 'NON_CANONICAL_AMBIGUITY');
  assert.equal(worldWrites, 0);
});
