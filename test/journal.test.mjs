import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { DurableJournal } from '../src/journal.mjs';

const before = {
  worldRef: 'luanti:test',
  worldRevision: 'rev-1',
  coveredPositions: [[0, 0, 0]],
  stateProfile: { profileVersion: 'state-profile/v2', nodeFields: ['nodeName', 'param1', 'param2'], metadataMode: 'exact', inventoryMode: 'exact', timerMode: 'exact', derivedLightMode: 'recompute-with-readback' },
  records: [{ position: [0, 0, 0], nodeName: 'air', param1: 0, param2: 0, metadata: {}, inventory: {}, timer: null }],
};

test('durable preparation survives restart and locks affected positions', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hw-journal-'));
  const first = await DurableJournal.open(dir);
  const record = await first.prepare({ transactionId: 'tx-1', operationDigest: 'a'.repeat(64), transactionPayloadDigest: 'b'.repeat(64), beforeImageDigest: 'c'.repeat(64), beforeImage: before });
  assert.equal(record.status, 'PREPARED');
  const restarted = await DurableJournal.open(dir);
  assert.equal(restarted.query('tx-1').status, 'PREPARED');
  await assert.rejects(() => restarted.prepare({ transactionId: 'tx-2', operationDigest: 'd'.repeat(64), transactionPayloadDigest: 'e'.repeat(64), beforeImageDigest: 'f'.repeat(64), beforeImage: before }), /TRANSACTION_CONFLICT/);
  await assert.rejects(() => restarted.prepare({ transactionId: 'tx-1', operationDigest: 'x'.repeat(64), transactionPayloadDigest: 'y'.repeat(64), beforeImageDigest: 'z'.repeat(64), beforeImage: before }), /REPLAY_MISMATCH/);
});

test('uncertain apply is reported as pending after restart, never as zero mutation', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hw-journal-crash-'));
  const journal = await DurableJournal.open(dir);
  await journal.prepare({ transactionId: 'tx-1', operationDigest: 'a'.repeat(64), transactionPayloadDigest: 'b'.repeat(64), beforeImageDigest: 'c'.repeat(64), beforeImage: before });
  await journal.transition('tx-1', 'APPLYING');
  const restarted = await DurableJournal.open(dir);
  assert.equal(restarted.query('tx-1').status, 'RECOVERY_PENDING');
  assert.equal(restarted.query('tx-1').mutationState, 'UNKNOWN');
  await assert.rejects(() => restarted.transition('tx-1', 'VERIFIED'), /INVALID_TRANSITION/);
});

test('journal rejects non-pure JSON and incomplete before-image coverage', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hw-journal-input-'));
  const journal = await DurableJournal.open(dir);
  const common = { transactionId: 'tx-1', operationDigest: 'a'.repeat(64),
    transactionPayloadDigest: 'b'.repeat(64), beforeImageDigest: 'c'.repeat(64) };
  await assert.rejects(() => journal.prepare({ ...common,
    beforeImage: { ...before, malicious: { toJSON() { return 'hidden'; } } } }), /SCHEMA_INVALID/);
  await assert.rejects(() => journal.prepare({ ...common,
    beforeImage: { ...before, records: [{ ...before.records[0], position: [1, 0, 0] }] } }), /TARGET_FACTS_INCOMPLETE/);
  assert.equal(journal.query('tx-1'), null);
  const admitted = Object.assign(Object.create(null), { ...common,
    transactionId: 'tx-admitted', beforeImage: Object.assign(Object.create(null), before) });
  await journal.prepare(admitted);
  assert.equal(journal.query('tx-admitted').status, 'PREPARED');
});
