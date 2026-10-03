// world-adapter/v4 port conformance against the contracts@0.3.0 package oracles.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import wireInputs from '#contracts/v4/fixtures/wire-inputs-v4' with { type: 'json' };
import closure from '#contracts/v4/fixtures/closure-oracles-v4' with { type: 'json' };
import goldens from '#contracts/v4/fixtures/production-goldens' with { type: 'json' };
import seam from '#contracts/v4/fixtures/history-seam-chain-v4' with { type: 'json' };
import { ContractError, digestValue, contractHandshake, checkContractHandshake,
  projectPreparedTransaction, validateType } from '#contracts/v4';
import { WorldAdapterV4, worldAdapterV4Operations } from '../src/v4-port.mjs';
import { V4TransactionBackend } from '../src/v4-transactions.mjs';
import { DurableJournal } from '../src/journal.mjs';

const fixture = wireInputs.requests.find(item => item.id === 'WIRE-world-adapter-v4');
const oracle = id => closure.cases.find(item => item.id === id);
const canvas = request => ({ current: true, sessionRef: request.sessionRef,
  authorizationRef: request.authorizationRef, worldRef: request.worldRef,
  domainOwner: 'hanaworlds-canvas' });

test('advertised operation set is world-adapter/v4 including InspectRegion; handshake is contracts@0.3.0', () => {
  assert.ok(worldAdapterV4Operations.includes('InspectRegion'));
  assert.ok(worldAdapterV4Operations.includes('QueryPreparedTransaction'));
  const port = new WorldAdapterV4({});
  assert.equal(JSON.stringify(port.contractHandshake), JSON.stringify(contractHandshake));
  assert.equal(checkContractHandshake(port.contractHandshake,
    { wires: ['world-adapter/v4', 'interaction-surface/v3'], factProfiles: ['target-facts/v3'] }).result,
  'HANDSHAKE_VERSION_MATCH');
  assert.throws(() => checkContractHandshake({ ...port.contractHandshake,
    wireVersions: port.contractHandshake.wireVersions.filter(w => w !== 'world-adapter/v4') },
  { wires: ['world-adapter/v4'], factProfiles: [] }), /UNSUPPORTED_VERSION/);
});

test('WA-01/WA-07/WA-09: strict decode precedes any authority or provider query', async () => {
  let authorityChecks = 0, worldWrites = 0;
  const port = new WorldAdapterV4({ authority: { verify: async () => { authorityChecks++;
    return { current: false }; } }, operations: { ApplyCompiledTransaction: async () => { worldWrites++; } } });
  const valid = await port.call(fixture.operation, fixture.request);
  assert.equal(valid.error.code, 'AUTHORIZATION_REVOKED');
  assert.equal(authorityChecks, 1);
  const expectInvalid = async (input, id) => {
    const o = oracle(id).expected;
    await assert.rejects(() => port.call(fixture.operation, input), error =>
      error instanceof ContractError && error.publicError.code === o.code &&
      error.publicError.phase === o.phase && error.publicError.reason === o.reason);
  };
  await expectInvalid({ ...fixture.request, ...oracle('WA-01-INVALID').input.requestPatch }, 'WA-01-INVALID');
  await expectInvalid(oracle('WA-07-INVALID').input.rawJson, 'WA-07-INVALID');
  await expectInvalid({ ...fixture.request, contractVersion: 'world-adapter/v2' }, 'WA-09-MIXED-INVALID');
  await expectInvalid({ ...fixture.request, contractVersion: 'world-adapter/v3' }, 'WA-09-MIXED-INVALID');
  assert.equal(authorityChecks, 1);
  assert.equal(worldWrites, 0);
});

test('WA-04: current revocation precedes replay; identical payload returns the original receipt once', async () => {
  let current = true, calls = 0;
  const port = new WorldAdapterV4({ authority: { verify: async request => ({ ...canvas(request), current }) },
    operations: { ApplyCompiledTransaction: async () => { calls++;
      return { contractVersion: 'canvas/v2', transactionId: fixture.request.transactionId,
        operationDigest: fixture.request.operationDigest,
        transactionPayloadDigest: fixture.request.preparedTransaction.transactionPayloadDigest,
        status: 'APPLIED_PENDING_READBACK', previousWorldRevision: fixture.request.expectedWorldRevision,
        observedWorldRevision: null, readbackDigest: null, restoreStatus: 'NOT_REQUIRED', error: null }; } } });
  const first = await port.call(fixture.operation, fixture.request);
  assert.equal(first.error, null, JSON.stringify(first.error));
  assert.deepEqual(await port.call(fixture.operation, fixture.request), first);
  assert.equal(calls, 1, 'reapplied: false');
  const changed = await port.call(fixture.operation, { ...fixture.request,
    expectedWorldRevision: 'other-revision' });
  assert.ok(changed.error);
  current = false;
  const revoked = await port.call(fixture.operation, fixture.request);
  const o = oracle('WA-04-INVALID').expected;
  assert.deepEqual([revoked.error.code, revoked.error.phase, revoked.error.reason],
    [o.code, o.phase, o.reason]);
  assert.equal(calls, 1);
});

test('WA-10: a non-Canvas domain owner is refused before the provider', async () => {
  let calls = 0;
  const port = new WorldAdapterV4({ authority: { verify: async request => ({ ...canvas(request),
    domainOwner: 'wrong-plugin' }) }, operations: { ApplyCompiledTransaction: async () => { calls++; } } });
  const response = await port.call(fixture.operation, fixture.request);
  const o = oracle('WA-10-INVALID').expected;
  assert.deepEqual([response.error.code, response.error.phase, response.error.reason],
    [o.code, o.phase, o.reason]);
  assert.equal(calls, 0);
});

test('V4-05: the request actorRef is never compared with the grant; session and grant are', async () => {
  let calls = 0;
  const port = new WorldAdapterV4({ authority: { verify: async request => ({ ...canvas(request),
    actorRef: 'end-user' }) }, operations: { QueryPreparedTransaction: async () => { calls++;
    throw new Error('STALE_TRANSACTION'); } } });
  const base = { contractVersion: 'world-adapter/v4', actorRef: 'canvas-service-principal',
    sessionRef: 'session', requestId: 'q', authorizationRef: 'grant', worldRef: 'world',
    transactionId: 'tx', operationDigest: 'a'.repeat(64), authorizationBindingDigest: 'b'.repeat(64) };
  assert.equal((await port.call('QueryPreparedTransaction', base)).error.code, 'STALE_TRANSACTION');
  const other = new WorldAdapterV4({ authority: { verify: async request => ({ ...canvas(request),
    authorizationRef: 'another-grant' }) }, operations: { QueryPreparedTransaction: async () => { calls++; } } });
  assert.equal((await other.call('QueryPreparedTransaction', { ...base, requestId: 'q2' })).error.code,
    'AUTHORIZATION_REVOKED');
  assert.equal(calls, 1);
});

test('WA-02: digests used by the Adapter equal the production goldens (frame, target-facts, readback, before-image)', () => {
  for (const vector of goldens.vectors)
    assert.equal(digestValue(vector.kind, vector.payload).sha256, vector.expected.sha256, vector.id);
  const o = oracle('WA-02-VALID');
  const golden = goldens.vectors.find(c => c.id === o.input.goldenRef);
  assert.ok(golden, 'golden present');
  assert.equal(digestValue('authorization-binding', golden.payload).sha256, o.expected.sha256);
});

test('WAV4-SEAM-A: Prepare saves and returns the readback digest of the same before image; Query returns it unchanged after restart', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hw-v4-seam-'));
  const saved = seam.savedBeforeImage;
  const profile = saved.stateProfile;
  const operations = { contractVersion: 'operations/v2', buildDigest: 'a'.repeat(64),
    compilerRevision: 'compiler', compilationConfigDigest: 'b'.repeat(64),
    worldRef: saved.worldRef, frameDigest: 'c'.repeat(64), catalogueDigest: 'd'.repeat(64),
    targetFactsDigest: 'e'.repeat(64),
    effects: [{ position: [0, 0, 0], nodeName: 'fixture:stone', param2: 0 }] };
  const operationDigest = digestValue('operations', operations).sha256;
  const authorizationBinding = { contractVersion: 'world-adapter/v2', authorizerRef: 'owner',
    actorRef: 'fixture-actor', grantEpoch: 'epoch', bindingRef: 'binding', worldRef: saved.worldRef,
    sessionRef: 'fixture-session', turnRevision: 'turn', intentDigest: 'f'.repeat(64),
    surfaceActionDigest: '2'.repeat(64), allowedAction: 'APPLY_RECOVERABLE', transactionId: 'fixture-tx',
    operationDigest, worldRevision: saved.worldRevision, selectionRevision: 'selection',
    analysisDigest: null, decisionRevision: null };
  const request = { contractVersion: 'world-adapter/v4', actorRef: 'canvas-service-principal',
    sessionRef: 'fixture-session', requestId: 'prepare', authorizationRef: 'grant',
    worldRef: saved.worldRef, transactionId: 'fixture-tx', operationDigest, operations,
    authorizationBinding, expectedWorldRevision: saved.worldRevision, expectedObjectRevisions: {},
    guarantee: 'RECOVERABLE_VERIFIED' };
  let worldWrites = 0;
  const make = async () => {
    const backend = new V4TransactionBackend({ journal: await DurableJournal.open(dir),
      engine: { prepareCheck: async () => ({ checked: 1 }),
        snapshot: async () => ({ worldRef: saved.worldRef, coveredPositions: saved.coveredPositions,
          records: saved.records }), apply: async () => { worldWrites++; } },
      stateProfile: profile, revisionOracle: { read: async () => saved.worldRevision, readObjects: async () => ({}) },
      verifyBinding: async r => ({ current: true, worldRef: r.worldRef, sessionRef: r.sessionRef,
        authorizationRef: r.authorizationRef, actorRef: 'fixture-actor', authorRef: 'fixture-actor',
        engineActorName: 'alice', allowedActions: ['APPLY_RECOVERABLE'] }),
      verifyService: async () => false, capacity: { check: async () => ({ allowed: true }) } });
    return new WorldAdapterV4({ authority: { verify: async r => canvas(r) },
      operations: { PrepareRecoverableTransaction: r => backend.prepare(r),
        QueryPreparedTransaction: r => backend.queryPrepared(r) } });
  };
  const prepared = await (await make()).call('PrepareRecoverableTransaction', request);
  assert.equal(prepared.error, null);
  assert.equal(prepared.result.beforeImageDigest, seam.digestGolden.beforeImageDigest);
  assert.equal(prepared.result.beforeStateReadbackDigest, seam.digestGolden.beforeStateReadbackDigest);
  assert.notEqual(prepared.result.beforeImageDigest, prepared.result.beforeStateReadbackDigest);
  validateType('PreparedTransaction', projectPreparedTransaction(prepared.result));
  // A fresh process over the same durable journal returns the same saved value.
  const queried = await (await make()).call('QueryPreparedTransaction', {
    contractVersion: 'world-adapter/v4', actorRef: 'canvas-service-principal',
    sessionRef: 'fixture-session', requestId: 'query', authorizationRef: 'grant',
    worldRef: saved.worldRef, transactionId: 'fixture-tx', operationDigest,
    authorizationBindingDigest: digestValue('authorization-binding', authorizationBinding).sha256 });
  assert.deepEqual(queried.result, prepared.result);
  assert.equal(worldWrites, 0);
  // SEAM-A-MISSING-RESPONSE-FIELD: a Prepare result without the digest is not admitted.
  const { beforeStateReadbackDigest, ...missing } = prepared.result;
  assert.throws(() => validateType('PreparedTransactionResult', missing), /SCHEMA_INVALID/);
});
