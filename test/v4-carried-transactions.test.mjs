// AD-V3 behavior carried unchanged onto the advertised world-adapter/v4 backend.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { digestValue, validateType } from 'hanaworlds-contracts/v4';
import { DurableJournal } from '../src/journal.mjs';
import { V4TransactionBackend as V3TransactionBackend } from '../src/v4-transactions.mjs';

const digest = (kind, value) => digestValue(kind, value).sha256;
const profile = { profileVersion: 'state-profile/v2',
  nodeFields: ['nodeName', 'param1', 'param2'], metadataMode: 'exact',
  inventoryMode: 'exact', timerMode: 'exact', derivedLightMode: 'recompute-with-readback' };
const record = nodeName => ({ position: [0, 0, 0], nodeName, param1: 0, param2: 0,
  metadata: {}, inventory: {}, timer: null });
const projection = nodeName => ({ worldRef: 'world', coveredPositions: [[0, 0, 0]],
  records: [record(nodeName)], stateProfile: profile });

test('v4 carried: v3 retains verified before/after and performs author scoped history with a full state target', async () => {
  const journal = await DurableJournal.open(await mkdtemp(join(tmpdir(), 'hw-v3-tx-')));
  let nodeName = 'air';
  let writes = 0;
  let originCurrent = true;
  const engine = {
    prepareCheck: async () => ({ checked: 1 }), snapshot: async () => { const { stateProfile, ...rest } = projection(nodeName); return rest; },
    readback: async () => { const { stateProfile, ...rest } = projection(nodeName); return rest; },
    apply: async () => { nodeName = 'fixture:stone'; writes++; return { status: 'APPLIED_PENDING_READBACK' }; },
    applyState: async (_, target) => { nodeName = target.records[0].nodeName; writes++;
      return { status: 'APPLIED_PENDING_READBACK' }; },
    restore: async (_, before) => { nodeName = before.records[0].nodeName; writes++;
      return { status: 'ROLLED_BACK' }; },
  };
  const binding = { current: true, worldRef: 'world', actorRef: 'actor',
    authorRef: 'author', allowedActions: ['APPLY_RECOVERABLE', 'READBACK', 'HISTORY', 'UNDO'] };
  const backend = new V3TransactionBackend({ journal, engine, stateProfile: profile,
    revisionOracle: { read: async () => 'world-rev', readObjects: async () => ({}) },
    verifyBinding: async request => ({ ...binding, sessionRef: request.sessionRef, authorizationRef: request.authorizationRef, engineActorName: 'alice' }), verifyService: async () => true,
    capacity: { check: async () => ({ allowed: true }) },
    historyAuthority: { verifyOrigin: async () => ({ current: originCurrent, worldRef: 'world',
      authorRef: 'author', originTransactionId: 'origin', affectedObjectRefs: ['object'],
      receiptDigest: '1'.repeat(64), historyRevision: 'history-rev' }) } });
  const operations = { contractVersion: 'operations/v2', buildDigest: 'a'.repeat(64),
    compilerRevision: 'compiler', compilationConfigDigest: 'b'.repeat(64),
    worldRef: 'world', frameDigest: 'c'.repeat(64), catalogueDigest: 'd'.repeat(64),
    targetFactsDigest: 'e'.repeat(64),
    effects: [{ position: [0, 0, 0], nodeName: 'fixture:stone', param2: 0 }] };
  const operationDigest = digest('operations', operations);
  const authorizationBinding = { contractVersion: 'world-adapter/v2',
    authorizerRef: 'owner', actorRef: 'actor', grantEpoch: 'epoch', bindingRef: 'binding',
    worldRef: 'world', sessionRef: 'session', turnRevision: 'turn',
    intentDigest: 'f'.repeat(64), surfaceActionDigest: '2'.repeat(64),
    allowedAction: 'APPLY_RECOVERABLE', transactionId: 'origin', operationDigest,
    worldRevision: 'world-rev', selectionRevision: 'selection', analysisDigest: null,
    decisionRevision: null };
  const common = { actorRef: 'actor', sessionRef: 'session', worldRef: 'world',
    transactionId: 'origin', expectedWorldRevision: 'world-rev', expectedObjectRevisions: {} };
  const prepareRequest = { ...common, operationDigest, operations, authorizationBinding,
    guarantee: 'RECOVERABLE_VERIFIED' };
  const prepared = await backend.prepare(prepareRequest);
  assert.equal(journal.query('origin').authorRef, 'author');
  // Seam A: the saved before image's readback digest is returned at Prepare.
  assert.equal(prepared.beforeStateReadbackDigest, digest('readback', projection('air')));
  validateType('PreparedTransactionResult', prepared);
  const { beforeStateReadbackDigest: _seamA, ...sevenFields } = prepared;
  await backend.apply({ ...prepareRequest, preparedTransaction: sevenFields });
  const after = await backend.readback({ ...common, coveredPositions: [[0, 0, 0]],
    stateProfile: profile });
  assert.equal(after.readbackDigest, digest('readback', projection('fixture:stone')));
  assert.equal(journal.query('origin').status, 'VERIFIED_PENDING_HISTORY');

  const historyRequest = { ...common, originTransactionId: 'origin', transactionId: 'undo',
    direction: 'UNDO', affectedObjectRefs: ['object'],
    originVerifiedReceiptDigest: '1'.repeat(64),
    originBeforeImageDigest: prepared.beforeImageDigest,
    originBeforeStateReadbackDigest: digest('readback', projection('air')),
    originAfterReadbackDigest: after.readbackDigest, expectedHistoryRevision: 'history-rev',
    expectedCurrentStateDigest: after.readbackDigest,
    targetStateDigest: digest('readback', projection('air')),
    authorizationBinding: { ...authorizationBinding, transactionId: 'undo',
      allowedAction: 'UNDO', operationDigest: '0'.repeat(64) },
    guarantee: 'RECOVERABLE_VERIFIED' };
  const fields = ['contractVersion','worldRef','originTransactionId','transactionId','direction',
    'affectedObjectRefs','originVerifiedReceiptDigest','originBeforeImageDigest',
    'originBeforeStateReadbackDigest','originAfterReadbackDigest','expectedCurrentStateDigest',
    'targetStateDigest','expectedHistoryRevision','expectedWorldRevision',
    'expectedObjectRevisions','guarantee'];
  historyRequest.contractVersion = 'world-adapter/v4';
  historyRequest.historyOperationDigest = digest('history-operation',
    Object.fromEntries(fields.map(key => [key, historyRequest[key]])));
  historyRequest.authorizationBinding.operationDigest = historyRequest.historyOperationDigest;
  const historyPrepared = await backend.prepareHistory(historyRequest);
  validateType('PreparedHistoryTransaction', historyPrepared);
  assert.equal(historyPrepared.status, 'PREPARED');
  assert.equal(writes, 1);
  originCurrent = false;
  await assert.rejects(() => backend.applyHistory({ ...historyRequest,
    preparedHistoryTransaction: historyPrepared }), /PERMISSION_DENIED/);
  assert.equal(writes, 1);
  assert.equal(journal.query('undo').status, 'PREPARED');
  originCurrent = true;
  nodeName = 'fixture:external';
  await assert.rejects(() => backend.applyHistory({ ...historyRequest,
    preparedHistoryTransaction: historyPrepared }), /UNDO_CONFLICT/);
  assert.equal(writes, 1);
  assert.equal(journal.query('undo').status, 'PREPARED');
  nodeName = 'fixture:stone';
  const receipt = await backend.applyHistory({ ...historyRequest,
    preparedHistoryTransaction: historyPrepared });
  assert.equal(receipt.status, 'APPLIED_PENDING_READBACK');
  validateType('ReceiptProjection', receipt);
  const historyReadback = await backend.readback({ ...historyRequest,
    coveredPositions: [[0, 0, 0]], stateProfile: profile });
  assert.equal(historyReadback.readbackDigest, digest('readback', projection('air')));
  assert.equal(nodeName, 'air');
  assert.equal(writes, 2);
});

test('v4 carried: v3 history without trusted origin proof rejects before world writes', async () => {
  const journal = await DurableJournal.open(await mkdtemp(join(tmpdir(), 'hw-v3-deny-')));
  const backend = new V3TransactionBackend({ journal, engine: {}, stateProfile: profile,
    verifyBinding: async () => null, verifyService: async () => false });
  await assert.rejects(() => backend.prepareHistory({ worldRef: 'world' }),
    /CAPABILITY_UNAVAILABLE|AUTHORIZATION_REVOKED/);
});

test('v4 carried: foreign author is denied before private saved-state availability is disclosed', async () => {
  const journal = await DurableJournal.open(await mkdtemp(join(tmpdir(), 'hw-v3-foreign-')));
  await journal.prepare({ transactionId: 'foreign-origin',
    operationDigest: 'a'.repeat(64), transactionPayloadDigest: 'b'.repeat(64),
    beforeImageDigest: 'c'.repeat(64), beforeImage: {
      ...projection('air'), worldRevision: 'world-rev' },
    expectedWorldRevision: 'world-rev', stateProfile: profile,
    authorRef: 'other-author', originKind: 'HANAWORLDS' });
  let reads = 0, writes = 0;
  const backend = new V3TransactionBackend({ journal, stateProfile: profile,
    engine: { prepareCheck: async () => ({ checked: 1 }), snapshot: async () => { reads++; },
      applyState: async () => { writes++; } },
    revisionOracle: { read: async () => 'world-rev', readObjects: async () => ({}) },
    verifyBinding: async request => ({ current: true, sessionRef: request.sessionRef, authorizationRef: request.authorizationRef, engineActorName: 'alice', worldRef: 'world', actorRef: 'actor',
      authorRef: 'author', allowedActions: ['UNDO'] }),
    verifyService: async () => true,
    historyAuthority: { verifyOrigin: async () => { throw new Error('SHOULD_NOT_QUERY'); } },
    capacity: { check: async () => ({ allowed: true }) } });
  await assert.rejects(() => backend.prepareHistory({ actorRef: 'actor',
    worldRef: 'world', originTransactionId: 'foreign-origin', direction: 'UNDO',
    expectedWorldRevision: 'world-rev', expectedObjectRevisions: {} }),
  /PERMISSION_DENIED/);
  assert.equal(reads, 0);
  assert.equal(writes, 0);
});
