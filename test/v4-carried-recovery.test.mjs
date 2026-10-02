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
const before = { worldRef: 'world', worldRevision: 'rev', coveredPositions: [[0, 0, 0]],
  records: [{ position: [0, 0, 0], nodeName: 'air', param1: 0, param2: 0,
    metadata: {}, inventory: {}, timer: null }], stateProfile: profile };
const target = { ...before, records: [{ ...before.records[0], nodeName: 'fixture:stone' }] };

test('v4 carried: possible history write failure restores same transaction and returns a contract-valid rolled-back receipt', async () => {
  const journal = await DurableJournal.open(await mkdtemp(join(tmpdir(), 'hw-v3-recover-')));
  const operationDigest = 'a'.repeat(64);
  const beforeImageDigest = digest('before-image', before);
  const beforeReadbackDigest = digest('readback', { worldRef: before.worldRef,
    coveredPositions: before.coveredPositions, records: before.records,
    stateProfile: before.stateProfile });
  const targetStateDigest = digest('readback', { worldRef: target.worldRef,
    coveredPositions: target.coveredPositions, records: target.records,
    stateProfile: target.stateProfile });
  await journal.prepare({ transactionId: 'source', operationDigest: 'f'.repeat(64),
    transactionPayloadDigest: 'e'.repeat(64), beforeImageDigest,
    beforeImage: before, stateProfile: profile, expectedWorldRevision: 'rev',
    authorRef: 'author', originKind: 'HANAWORLDS' });
  await journal.transition('source', 'APPLYING');
  await journal.transition('source', 'APPLIED_PENDING_READBACK');
  await journal.recordAfterState('source', before, beforeReadbackDigest,
    beforeReadbackDigest);
  await journal.prepare({ transactionId: 'history', operationDigest,
    transactionPayloadDigest: 'b'.repeat(64), beforeImageDigest, beforeImage: before,
    stateProfile: profile, expectedWorldRevision: 'rev',
    adapterExecutionRevision: 'execution', authorRef: 'author',
    originKind: 'HANAWORLDS', historySourceId: 'source', historyDirection: 'UNDO',
    historyOperationDigest: operationDigest, targetStateDigest,
    targetImage: target, affectedObjectRefs: ['object'],
    originVerifiedReceiptDigest: '1'.repeat(64), expectedHistoryRevision: 'history-rev' });
  let writes = 0;
  const backend = new V3TransactionBackend({ journal,
    engine: { prepareCheck: async () => ({ checked: 1 }), snapshot: async () => before,
      applyState: async () => { writes++; throw new Error('ENGINE_RESPONSE_UNKNOWN'); },
      restore: async () => { writes++; return { status: 'ROLLED_BACK' }; } },
    stateProfile: profile,
    revisionOracle: { read: async () => 'rev', readObjects: async () => ({}) },
    verifyBinding: async request => ({ current: true, sessionRef: request.sessionRef, authorizationRef: request.authorizationRef, engineActorName: 'alice', actorRef: 'actor', authorRef: 'author',
      worldRef: 'world', allowedActions: ['UNDO', 'HISTORY'] }),
    verifyService: async () => true,
    historyAuthority: { verifyOrigin: async () => ({ current: true,
      worldRef: 'world', authorRef: 'author', originTransactionId: 'source',
      receiptDigest: '1'.repeat(64), historyRevision: 'history-rev',
      affectedObjectRefs: ['object'] }) },
    capacity: { check: async () => ({ allowed: true }) } });
  const prepared = { originTransactionId: 'source', transactionId: 'history',
    direction: 'UNDO', historyOperationDigest: operationDigest,
    transactionPayloadDigest: 'b'.repeat(64), beforeImageDigest,
    targetStateDigest, protectedPositions: [[0, 0, 0]],
    stateProfile: profile, adapterExecutionRevision: 'execution',
    guarantee: 'RECOVERABLE_VERIFIED', status: 'PREPARED' };
  const receipt = await backend.applyHistory({ actorRef: 'actor', worldRef: 'world',
    originTransactionId: 'source', transactionId: 'history', direction: 'UNDO',
    historyOperationDigest: operationDigest, expectedWorldRevision: 'rev',
    expectedObjectRevisions: {}, preparedHistoryTransaction: prepared });
  assert.equal(writes, 2);
  assert.equal(receipt.status, 'ROLLED_BACK');
  assert.equal(receipt.error.code, 'APPLY_FAILED');
  assert.equal(receipt.error.mutationState, 'ROLLED_BACK');
  assert.equal(journal.query('history').status, 'ROLLED_BACK');
  validateType('ReceiptProjection', receipt);
  const queried = await backend.query({ actorRef: 'actor', worldRef: 'world',
    transactionId: 'history', transactionPayloadDigest: 'b'.repeat(64) });
  assert.equal(queried.status, 'ROLLED_BACK');
  assert.equal(queried.readbackDigest, receipt.readbackDigest);
  assert.equal(writes, 2);
  validateType('ReceiptProjection', queried);
});
