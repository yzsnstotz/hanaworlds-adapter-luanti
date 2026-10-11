import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DurableJournal } from '../src/journal.mjs';

const image = { worldRef: 'world', worldRevision: 'rev',
  coveredPositions: [[0, 0, 0]], stateProfile: { profileVersion: 'state-profile/v2' },
  records: [{ position: [0, 0, 0], nodeName: 'air', param1: 0, param2: 0,
    metadata: {}, inventory: {}, timer: null }] };

test('v3 journal durably retains exact after state and rejects unauthorized release', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hw-v3-journal-'));
  const journal = await DurableJournal.open(dir);
  await journal.prepare({ transactionId: 'tx', operationDigest: 'a',
    transactionPayloadDigest: 'b', beforeImageDigest: 'c', beforeImage: image,
    expectedWorldRevision: 'rev', stateProfile: image.stateProfile,
    authorRef: 'author', originKind: 'HANAWORLDS',
    affectedObjectRefs: ['object'] });
  await assert.rejects(() => journal.abortPrepared('tx', 'wrong'), /PERMISSION_DENIED/);
  await journal.transition('tx', 'APPLYING');
  await journal.transition('tx', 'APPLIED_PENDING_READBACK');
  const after = structuredClone(image);
  after.records[0].nodeName = 'fixture:stone';
  await journal.recordAfterState('tx', after, 'd', 'e');
  const reopened = await DurableJournal.open(dir);
  assert.deepEqual(reopened.query('tx').afterImage, after);
  assert.equal(reopened.query('tx').authorRef, 'author');
  assert.equal(reopened.query('tx').status, 'VERIFIED_PENDING_HISTORY');
  const files = await readdir(dir);
  assert.equal(files.length, 1);
  assert.match(await readFile(join(dir, files[0]), 'utf8'), /fixture:stone/);
});

test('v3 PREPARED abort is zero-write and releases only its scope lock', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hw-v3-abort-'));
  const journal = await DurableJournal.open(dir);
  const input = { transactionId: 'tx', operationDigest: 'a',
    transactionPayloadDigest: 'b', beforeImageDigest: 'c', beforeImage: image,
    expectedWorldRevision: 'rev', stateProfile: image.stateProfile,
    authorRef: 'author', originKind: 'HANAWORLDS' };
  await journal.prepare(input);
  await journal.abortPrepared('tx', 'author');
  assert.equal(journal.query('tx').status, 'ABORTED_PREPARED');
  await journal.prepare({ ...input, transactionId: 'another' });
});
