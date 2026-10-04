import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { digestValue } from '#contracts/v4';
import { DurableJournal } from '../src/journal.mjs';
import { V4TransactionBackend } from '../src/v4-transactions.mjs';

const base = join(homedir(), '.cache/hanaworlds-runs/S1-AD-RECOVERY-STATE-01');
const profile = { profileVersion: 'state-profile/v2',
  nodeFields: ['nodeName', 'param1', 'param2'], metadataMode: 'exact',
  inventoryMode: 'exact', timerMode: 'exact', derivedLightMode: 'recompute-with-readback' };
const before = { worldRef: 'world:one', worldRevision: 'revision:fixture',
  coveredPositions: [[0, 0, 0]], records: [{ position: [0, 0, 0],
    nodeName: 'air', param1: 0, param2: 0, metadata: {}, inventory: {}, timer: null }],
  stateProfile: profile };
const digest = (kind, value) => digestValue(kind, value).sha256;
const beforeImageDigest = digest('before-image', before);
const readbackDigest = digest('readback', { worldRef: before.worldRef,
  coveredPositions: before.coveredPositions, records: before.records, stateProfile: profile });
const request = { worldRef: 'world:one', originTransactionId: 'build:one',
  operationDigest: 'a'.repeat(64), beforeImageDigest,
  restoreAttemptIdentity: 'b'.repeat(64) };

async function fixture() {
  await mkdir(base, { recursive: true });
  const directory = await mkdtemp(join(base, 'state-'));
  const journal = await DurableJournal.open(directory);
  await journal.prepare({ transactionId: 'build:one', operationDigest: request.operationDigest,
    transactionPayloadDigest: 'c'.repeat(64), beforeImageDigest, beforeImage: before,
    expectedWorldRevision: 'revision:fixture', authorRef: 'author:one',
    originKind: 'HANAWORLDS', beforeStateReadbackDigest: readbackDigest,
    payload: { authorizationBindingDigest: 'e'.repeat(64) } });
  let writes = 0;
  const backend = new V4TransactionBackend({ journal, stateProfile: profile,
    engine: { restore: async () => { writes++; return { status: 'ROLLED_BACK' }; } },
    revisionOracle: { read: async () => 'revision:fixture' },
    verifyService: async () => true });
  return { journal, backend, writes: () => writes, directory };
}

test('verified build cannot be restored over the world', async () => {
  const { journal, backend, writes } = await fixture();
  await journal.transition('build:one', 'APPLYING');
  await journal.transition('build:one', 'APPLIED_PENDING_READBACK');
  await journal.recordAfterState('build:one', before, readbackDigest, readbackDigest);
  await assert.rejects(() => backend.restore(request), /STALE_TRANSACTION/);
  assert.equal(journal.query('build:one').status, 'VERIFIED_PENDING_HISTORY');
  assert.equal(writes(), 0);
});

test('a pending restore is durable and same-identity replay has zero world writes', async () => {
  const { journal, backend, writes, directory } = await fixture();
  await journal.transition('build:one', 'APPLYING');
  assert.equal((await backend.restore(request)).status, 'ROLLED_BACK');
  assert.equal(writes(), 1);
  assert.equal((await backend.restore(request)).status, 'ROLLED_BACK');
  assert.equal(writes(), 1);
  assert.equal((await DurableJournal.open(directory)).query('build:one').status, 'ROLLED_BACK');
  await assert.rejects(() => backend.restore({ ...request, restoreAttemptIdentity: 'd'.repeat(64) }),
    /REPLAY_MISMATCH/);
  await assert.rejects(() => backend.restore({ ...request, worldRef: 'world:other' }),
    /REPLAY_MISMATCH/);
  assert.equal(writes(), 1);
});

test('prepared abort is idempotent and restore of a prepared transaction cannot write', async () => {
  const { journal, backend, writes } = await fixture();
  await assert.rejects(() => backend.restore(request), /STALE_TRANSACTION/);
  const abort = { worldRef: request.worldRef, transactionId: 'build:one',
    operationDigest: request.operationDigest, authorizationBindingDigest: 'e'.repeat(64) };
  await assert.rejects(() => backend.abortPrepared({ ...abort,
    authorizationBindingDigest: 'f'.repeat(64) }), /REPLAY_MISMATCH/);
  assert.equal((await backend.abortPrepared(abort)).status, 'ABORTED_PREPARED');
  assert.equal((await backend.abortPrepared(abort)).status, 'ABORTED_PREPARED');
  assert.equal(journal.query('build:one').status, 'ABORTED_PREPARED');
  assert.equal(writes(), 0);
});

test('history abort accepts only a matching prepared history record', async () => {
  const { journal, backend, writes } = await fixture();
  await journal.abortPrepared('build:one', 'author:one');
  await journal.prepare({ transactionId: 'history:one', operationDigest: 'f'.repeat(64),
    transactionPayloadDigest: 'd'.repeat(64), beforeImageDigest, beforeImage: before,
    authorRef: 'author:one', originKind: 'HANAWORLDS', historySourceId: 'build:one',
    historyDirection: 'UNDO', historyOperationDigest: 'f'.repeat(64),
    payload: { authorizationBindingDigest: 'e'.repeat(64) } });
  const abort = { worldRef: request.worldRef, transactionId: 'history:one',
    originTransactionId: 'build:one', historyOperationDigest: 'f'.repeat(64),
    authorizationBindingDigest: 'e'.repeat(64) };
  await assert.rejects(() => backend.abortPrepared({ ...abort,
    operationDigest: 'f'.repeat(64) }), /REPLAY_MISMATCH/);
  await assert.rejects(() => backend.abortPreparedHistory({ ...abort,
    worldRef: 'world:other' }), /REPLAY_MISMATCH/);
  assert.equal((await backend.abortPreparedHistory(abort)).status, 'ABORTED_PREPARED');
  assert.equal((await backend.abortPreparedHistory(abort)).status, 'ABORTED_PREPARED');
  assert.equal(journal.query('history:one').status, 'ABORTED_PREPARED');
  assert.equal(writes(), 0);
});
