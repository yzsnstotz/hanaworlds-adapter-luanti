import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DurableJournal } from '../src/journal.mjs';
import { V3TransactionBackend } from '../src/v3-transactions.mjs';

const profile = { profileVersion: 'state-profile/v2',
  nodeFields: ['nodeName', 'param1', 'param2'], metadataMode: 'exact',
  inventoryMode: 'exact', timerMode: 'exact', derivedLightMode: 'recompute-with-readback' };
const image = { worldRef: 'world', worldRevision: 'rev', coveredPositions: [[0, 0, 0]],
  records: [{ position: [0, 0, 0], nodeName: 'air', param1: 0, param2: 0,
    metadata: {}, inventory: {}, timer: null }], stateProfile: profile };

for (const variant of ['missing', 'corrupt']) test(`history Apply rejects ${variant} private target before any world write`, async () => {
  const journal = await DurableJournal.open(await mkdtemp(join(tmpdir(), 'hw-v3-target-')));
  const target = variant === 'missing' ? undefined : image;
  await journal.prepare({ transactionId: 'history', operationDigest: 'a'.repeat(64),
    transactionPayloadDigest: 'b'.repeat(64), beforeImageDigest: 'c'.repeat(64),
    beforeImage: image, stateProfile: profile, expectedWorldRevision: 'rev',
    adapterExecutionRevision: 'execution', authorRef: 'author',
    originKind: 'HANAWORLDS', historySourceId: 'source', historyDirection: 'UNDO',
    historyOperationDigest: 'a'.repeat(64), targetStateDigest: 'd'.repeat(64),
    ...(target === undefined ? {} : { targetImage: target }) });
  let reads = 0, writes = 0;
  const backend = new V3TransactionBackend({ journal,
    engine: { snapshot: async () => { reads++; return image; },
      applyState: async () => { writes++; return { status: 'APPLIED_PENDING_READBACK' }; } },
    stateProfile: profile,
    revisionOracle: { read: async () => 'rev', readObjects: async () => ({}) },
    verifyBinding: async () => ({ current: true, actorRef: 'actor', authorRef: 'author',
      worldRef: 'world', allowedActions: ['UNDO'] }),
    verifyService: async () => true,
    capacity: { check: async () => ({ allowed: true }) } });
  const prepared = { originTransactionId: 'source', transactionId: 'history',
    direction: 'UNDO', historyOperationDigest: 'a'.repeat(64),
    transactionPayloadDigest: 'b'.repeat(64), beforeImageDigest: 'c'.repeat(64),
    targetStateDigest: 'd'.repeat(64), protectedPositions: [[0, 0, 0]],
    stateProfile: profile, adapterExecutionRevision: 'execution',
    guarantee: 'RECOVERABLE_VERIFIED', status: 'PREPARED' };
  await assert.rejects(() => backend.applyHistory({ actorRef: 'actor', worldRef: 'world',
    originTransactionId: 'source', transactionId: 'history', direction: 'UNDO',
    historyOperationDigest: 'a'.repeat(64), expectedWorldRevision: 'rev',
    expectedObjectRevisions: {}, preparedHistoryTransaction: prepared }),
  /SAVED_RESOURCE_UNAVAILABLE/);
  assert.equal(reads, 0);
  assert.equal(writes, 0);
  assert.equal(journal.query('history').status, 'PREPARED');
});
