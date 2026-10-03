import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { DurableJournal } from '../src/journal.mjs';
import { V2TransactionBackend, projectionDigest } from '../src/v2-transactions.mjs';
import { WorldAdapterV2 } from '../src/v2-port.mjs';

test('v2 transaction projection uses durable bridge and never declares product VERIFIED', async () => {
  const journal = await DurableJournal.open(await mkdtemp(join(tmpdir(), 'hw-v2-tx-')));
  const stateProfile = { profileVersion: 'state-profile/v2',
    nodeFields: ['nodeName', 'param1', 'param2'], metadataMode: 'exact',
    inventoryMode: 'exact', timerMode: 'exact', derivedLightMode: 'recompute-with-readback' };
  const before = { worldRef: 'luanti:fixture', coveredPositions: [[0, 0, 0]],
    records: [{ position: [0, 0, 0], nodeName: 'air', param1: 0, param2: 0,
      metadata: {}, inventory: {}, timer: null }] };
  const after = { ...before, records: [{ ...before.records[0], nodeName: 'fixture:stone' }] };
  let writes = 0;
  let readbackFault = false;
  let applyFault = false;
  let serviceAllowed = true;
  let bindingAllowed = true;
  const engine = {
    snapshot: async () => before,
    apply: async () => { writes++; if (applyFault) throw new Error('ENGINE_RESPONSE_UNKNOWN');
      return { status: 'APPLIED_PENDING_READBACK' }; },
    readback: async () => { if (readbackFault) throw new Error('private fault'); return after; },
    restore: async () => { writes++; return { status: 'ROLLED_BACK' }; },
  };
  const binding = { current: true, worldRef: before.worldRef,
    allowedActions: ['APPLY_RECOVERABLE', 'READBACK', 'HISTORY'] };
  const backend = new V2TransactionBackend({ journal, engine, stateProfile,
    revisionOracle: { read: async () => 'world:one', readObjects: async () => ({}) },
    verifyBinding: async () => bindingAllowed ? binding : null,
    verifyService: async () => serviceAllowed,
    capacity: { check: async actual => ({ allowed: actual <= 2 }) } });
  const operations = { contractVersion: 'operations/v2', buildDigest: 'a'.repeat(64),
    compilerRevision: 'compiler:one', compilationConfigDigest: 'b'.repeat(64),
    worldRef: before.worldRef, frameDigest: 'c'.repeat(64),
    catalogueDigest: 'd'.repeat(64), targetFactsDigest: 'e'.repeat(64),
    effects: [{ position: [0, 0, 0], nodeName: 'fixture:stone', param2: 0 }] };
  const operationDigest = projectionDigest('operations', operations);
  const common = { contractVersion: 'world-adapter/v2', actorRef: 'actor:one',
    sessionRef: 'session:one', requestId: 'request:prepare', authorizationRef: 'grant:one',
    worldRef: before.worldRef };
  const authorizationBinding = { contractVersion: 'world-adapter/v2',
    authorizerRef: 'owner:one', actorRef: common.actorRef, grantEpoch: 'epoch:one',
    bindingRef: 'binding:one', worldRef: before.worldRef, sessionRef: common.sessionRef,
    turnRevision: 'turn:one', intentDigest: 'f'.repeat(64),
    surfaceActionDigest: '1'.repeat(64), allowedAction: 'APPLY_RECOVERABLE',
    transactionId: 'tx:one', operationDigest, worldRevision: 'world:one',
    selectionRevision: 'selection:one', analysisDigest: null, decisionRevision: null };
  const port = new WorldAdapterV2({ authority: {
    verify: async request => ({ current: true, actorRef: request.actorRef,
      sessionRef: request.sessionRef, authorizationRef: request.authorizationRef,
      domainOwner: 'hanaworlds-canvas' }),
    verifyService: async request => ({ current: true, actorRef: request.actorRef,
      sessionRef: request.sessionRef, authorizationRef: request.authorizationRef }),
  }, operations: {
    PrepareRecoverableTransaction: request => backend.prepare(request),
    ApplyCompiledTransaction: request => backend.apply(request),
    Readback: request => backend.readback(request),
    QueryTransaction: request => backend.query(request),
    RestoreTransaction: request => backend.restore(request),
  } });
  const preparedResponse = await port.call('PrepareRecoverableTransaction', {
    ...common, transactionId: 'tx:one', operationDigest, operations,
    authorizationBinding, expectedWorldRevision: 'world:one',
    expectedObjectRevisions: {}, guarantee: 'RECOVERABLE_VERIFIED' });
  assert.equal(preparedResponse.error, null);
  const prepared = preparedResponse.result;
  assert.equal(journal.query('tx:one').status, 'PREPARED');
  assert.equal(prepared.transactionPayloadDigest,
    projectionDigest('transaction-payload', prepared.payload));
  const preparedRestore = await port.call('RestoreTransaction', {
    ...common, requestId: 'request:restore:prepared', originTransactionId: 'tx:one',
    operationDigest, beforeImageDigest: prepared.beforeImageDigest,
    restoreAttemptIdentity: 'restore:prepared', guarantee: 'RECOVERABLE_VERIFIED' });
  assert.equal(preparedRestore.result, null);
  assert.equal(preparedRestore.error.code, 'STALE_TRANSACTION');
  assert.equal(preparedRestore.error.phase, 'validate');
  assert.equal(preparedRestore.error.mutationState, 'NONE');
  assert.equal(writes, 0);
  assert.equal(journal.query('tx:one').status, 'PREPARED');
  const barePort = new WorldAdapterV2({ authority: { verify: async request => ({
    current: true, actorRef: request.actorRef, sessionRef: request.sessionRef,
    authorizationRef: request.authorizationRef, domainOwner: 'hanaworlds-canvas' }) },
  operations: { ApplyCompiledTransaction() { throw new Error('RECOVERY_PENDING'); } } });
  const barePending = await barePort.call('ApplyCompiledTransaction', {
    ...common, requestId: 'request:bare-pending', transactionId: 'tx:one',
    expectedWorldRevision: 'world:one', preparedTransaction: prepared,
    operations, operationDigest, authorizationBinding, guarantee: 'RECOVERABLE_VERIFIED' });
  assert.deepEqual([barePending.error.code, barePending.error.phase,
    barePending.error.reason, barePending.error.mutationState,
    barePending.error.retryability], ['RECOVERY_PENDING', 'apply',
    'TRANSPORT_OUTCOME_UNKNOWN', 'UNKNOWN', 'SAME_TRANSACTION_QUERY']);
  const applied = await port.call('ApplyCompiledTransaction', {
    ...common, requestId: 'request:apply', transactionId: 'tx:one',
    expectedWorldRevision: 'world:one', preparedTransaction: prepared,
    operations, operationDigest, authorizationBinding, guarantee: 'RECOVERABLE_VERIFIED' });
  assert.equal(applied.error, null);
  assert.equal(applied.result.status, 'APPLIED_PENDING_READBACK');
  assert.equal(writes, 1);
  const readback = await port.call('Readback', {
    ...common, requestId: 'request:readback', transactionId: 'tx:one',
    coveredPositions: [[0, 0, 0]], stateProfile });
  assert.equal(readback.error, null);
  assert.equal(readback.result.projection.records[0].nodeName, 'fixture:stone');
  assert.equal(readback.result.readbackDigest,
    projectionDigest('readback', readback.result.projection));
  const restored = await port.call('RestoreTransaction', {
    ...common, requestId: 'request:restore', originTransactionId: 'tx:one',
    operationDigest, beforeImageDigest: prepared.beforeImageDigest,
    restoreAttemptIdentity: 'restore:one', guarantee: 'RECOVERABLE_VERIFIED' });
  assert.equal(restored.error, null);
  assert.equal(restored.result.status, 'ROLLED_BACK');
  assert.equal(writes, 2);
  const queried = await port.call('QueryTransaction', {
    ...common, requestId: 'request:query', transactionId: 'tx:one',
    transactionPayloadDigest: prepared.transactionPayloadDigest });
  assert.equal(queried.result.status, 'ROLLED_BACK');
  assert.equal(queried.result.readbackDigest, null);
  readbackFault = true;
  const secondAuth = { ...authorizationBinding, transactionId: 'tx:two' };
  const secondPrepared = await port.call('PrepareRecoverableTransaction', {
    ...common, requestId: 'request:prepare:two', transactionId: 'tx:two',
    operationDigest, operations, authorizationBinding: secondAuth,
    expectedWorldRevision: 'world:one', expectedObjectRevisions: {},
    guarantee: 'RECOVERABLE_VERIFIED' });
  assert.equal(secondPrepared.error, null);
  const secondApplied = await port.call('ApplyCompiledTransaction', {
    ...common, requestId: 'request:apply:two', transactionId: 'tx:two',
    expectedWorldRevision: 'world:one', preparedTransaction: secondPrepared.result,
    operations, operationDigest, authorizationBinding: secondAuth,
    guarantee: 'RECOVERABLE_VERIFIED' });
  assert.equal(secondApplied.result.status, 'APPLIED_PENDING_READBACK');
  const failedReadback = await port.call('Readback', {
    ...common, requestId: 'request:readback:two', transactionId: 'tx:two',
    coveredPositions: [[0, 0, 0]], stateProfile });
  assert.equal(failedReadback.result, null);
  assert.equal(failedReadback.error.code, 'READBACK_FAILED');
  assert.equal(failedReadback.error.mutationState, 'ROLLED_BACK');
  assert.equal(journal.query('tx:two').causeCode, 'READBACK_FAILED');
  assert.equal(journal.query('tx:two').status, 'ROLLED_BACK');
  applyFault = true;
  serviceAllowed = false;
  const thirdAuth = { ...authorizationBinding, transactionId: 'tx:uncertain' };
  const thirdPrepared = await port.call('PrepareRecoverableTransaction', {
    ...common, requestId: 'request:prepare:uncertain', transactionId: 'tx:uncertain',
    operationDigest, operations, authorizationBinding: thirdAuth,
    expectedWorldRevision: 'world:one', expectedObjectRevisions: {},
    guarantee: 'RECOVERABLE_VERIFIED' });
  assert.equal(thirdPrepared.error, null);
  bindingAllowed = false;
  const beforePrewrite = writes;
  const prewriteDenied = await port.call('ApplyCompiledTransaction', {
    ...common, requestId: 'request:apply:prewrite-denied', transactionId: 'tx:uncertain',
    expectedWorldRevision: 'world:one', preparedTransaction: thirdPrepared.result,
    operations, operationDigest, authorizationBinding: thirdAuth,
    guarantee: 'RECOVERABLE_VERIFIED' });
  assert.equal(prewriteDenied.error.code, 'AUTHORIZATION_REVOKED');
  assert.equal(prewriteDenied.error.phase, 'authorize');
  assert.equal(prewriteDenied.error.mutationState, 'NONE');
  assert.equal(writes, beforePrewrite);
  assert.equal(journal.query('tx:uncertain').status, 'PREPARED');
  bindingAllowed = true;
  const uncertain = await port.call('ApplyCompiledTransaction', {
    ...common, requestId: 'request:apply:uncertain', transactionId: 'tx:uncertain',
    expectedWorldRevision: 'world:one', preparedTransaction: thirdPrepared.result,
    operations, operationDigest, authorizationBinding: thirdAuth,
    guarantee: 'RECOVERABLE_VERIFIED' });
  assert.equal(uncertain.result, null);
  assert.deepEqual([uncertain.error.code, uncertain.error.phase, uncertain.error.reason,
    uncertain.error.mutationState, uncertain.error.retryability],
  ['RECOVERY_PENDING', 'apply', 'TRANSPORT_OUTCOME_UNKNOWN', 'UNKNOWN',
    'SAME_TRANSACTION_QUERY']);
  assert.equal(uncertain.error.transactionRef, 'tx:uncertain');
  assert.equal(journal.query('tx:uncertain').status, 'RECOVERY_PENDING');
  assert.equal(journal.query('tx:uncertain').mutationState, 'UNKNOWN');
  const pendingQuery = await port.call('QueryTransaction', {
    ...common, requestId: 'request:query:uncertain', transactionId: 'tx:uncertain',
    transactionPayloadDigest: thirdPrepared.result.transactionPayloadDigest });
  assert.equal(pendingQuery.error, null);
  assert.equal(pendingQuery.result.status, 'RECOVERY_PENDING');
  assert.equal(pendingQuery.result.error.phase, 'apply');
  assert.equal(pendingQuery.result.error.retryability, 'SAME_TRANSACTION_QUERY');
});
