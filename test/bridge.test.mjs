import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { EngineBridge } from '../src/bridge.mjs';
import { DurableJournal } from '../src/journal.mjs';

const before = {
  worldRef: 'luanti:test', worldRevision: 'r1', coveredPositions: [[0, 0, 0]],
  stateProfile: { profileVersion: 'state-profile/v2', nodeFields: ['nodeName', 'param1', 'param2'], metadataMode: 'exact', inventoryMode: 'exact', timerMode: 'exact', derivedLightMode: 'recompute-with-readback' },
  records: [{ position: [0, 0, 0], nodeName: 'air', param1: 0, param2: 0, metadata: {}, inventory: {}, timer: null }],
};
const request = { transactionId: 'tx-1', worldRef: 'luanti:test', operationDigest: 'a'.repeat(64),
  transactionPayloadDigest: 'b'.repeat(64), beforeImageDigest: 'c'.repeat(64),
  effects: [{ position: [0, 0, 0], nodeName: 'test:stone', param2: 0 }],
  authorizationRef: 'auth-1' };

test('bridge refuses transaction when authoritative admission or verifier is absent', async () => {
  const journal = await DurableJournal.open(await mkdtemp(join(tmpdir(), 'hw-bridge-deny-')));
  const bridge = new EngineBridge({ journal });
  await assert.rejects(() => bridge.prepare(request), /CAPABILITY_UNAVAILABLE/);
  assert.equal(journal.query('tx-1'), null);
});

test('prepared image must belong to the authorized world', async () => {
  const journal = await DurableJournal.open(await mkdtemp(join(tmpdir(), 'hw-bridge-world-')));
  const bridge = new EngineBridge({ journal, engine: { snapshot: async () => ({ ...before, worldRef: 'luanti:other' }) },
    admit: (_, value) => value,
    verifyBinding: async () => ({ worldRef: 'luanti:test', allowedActions: ['APPLY_RECOVERABLE'], current: true }),
    digestBeforeImage: () => 'c'.repeat(64) });
  await assert.rejects(() => bridge.prepare(request), /TARGET_FACTS_INCOMPLETE/);
  assert.equal(journal.query('tx-1'), null);
});

test('admitted fixture transaction stays pending after engine apply until Canvas history', async () => {
  const journal = await DurableJournal.open(await mkdtemp(join(tmpdir(), 'hw-bridge-apply-')));
  let writes = 0;
  const engine = { snapshot: async () => before, apply: async () => { writes++; return { status: 'APPLIED_PENDING_READBACK' }; } };
  const bridge = new EngineBridge({ journal, engine,
    admit: (_, value) => value,
    verifyBinding: async () => ({ worldRef: 'luanti:test', allowedActions: ['APPLY_RECOVERABLE'], current: true }),
    digestBeforeImage: () => 'c'.repeat(64),
  });
  const prepared = await bridge.prepare(request);
  assert.equal(prepared.status, 'PREPARED');
  assert.equal(Object.hasOwn(prepared, 'beforeImage'), false, 'private before image is not a public receipt');
  assert.equal(writes, 0);
  const applied = await bridge.apply(request);
  assert.equal(applied.status, 'APPLIED_PENDING_READBACK');
  assert.equal(writes, 1);
  assert.equal(journal.query('tx-1').status, 'RECOVERY_PENDING');
});

test('query projects journal status without leaking private before-image bytes', async () => {
  const journal = await DurableJournal.open(await mkdtemp(join(tmpdir(), 'hw-bridge-query-')));
  const privateBefore = structuredClone(before);
  privateBefore.records[0].metadata = { owner: 'private' };
  const bridge = new EngineBridge({ journal, engine: { snapshot: async () => privateBefore },
    admit: (_, value) => value,
    verifyBinding: async () => ({ worldRef: 'luanti:test', allowedActions: ['APPLY_RECOVERABLE', 'HISTORY'], current: true }),
    digestBeforeImage: () => 'c'.repeat(64) });
  await bridge.prepare(request);
  const projection = await bridge.query(request);
  assert.equal(projection.status, 'PREPARED');
  assert.equal(Object.hasOwn(projection, 'beforeImage'), false);
  assert.equal(JSON.stringify(projection).includes('private'), false);
});

test('apply failure attempts independently authorized restoration and records its truth', async () => {
  const journal = await DurableJournal.open(await mkdtemp(join(tmpdir(), 'hw-bridge-restore-')));
  let restores = 0;
  const engine = { snapshot: async () => before, apply: async () => { throw new Error('private engine detail'); },
    restore: async (recovery) => { assert.equal(recovery.status, 'RESTORING'); restores++; return { status: 'ROLLED_BACK' }; } };
  const bridge = new EngineBridge({ journal, engine, admit: (_, value) => value,
    verifyBinding: async () => ({ worldRef: 'luanti:test', allowedActions: ['APPLY_RECOVERABLE'], current: true }),
    verifyService: async () => true, digestBeforeImage: () => 'c'.repeat(64) });
  await bridge.prepare(request);
  const receipt = await bridge.apply(request);
  assert.equal(receipt.status, 'ROLLED_BACK');
  assert.equal(receipt.causeCode, 'APPLY_FAILED');
  assert.equal(restores, 1);
  assert.equal(journal.query('tx-1').status, 'ROLLED_BACK');
  assert.equal(journal.query('tx-1').causeCode, 'APPLY_FAILED');
  const identity = journal.query('tx-1').restoreAttemptIdentity;
  assert.equal(typeof identity, 'string');
  const repeated = await bridge.restore({ worldRef: request.worldRef, originTransactionId: 'tx-1', operationDigest: request.operationDigest,
    beforeImageDigest: request.beforeImageDigest, restoreAttemptIdentity: identity });
  assert.equal(repeated.status, 'ROLLED_BACK');
  assert.equal(restores, 1, 'terminal restore replays receipt without world write');
  await assert.rejects(() => bridge.restore({ worldRef: request.worldRef, originTransactionId: 'tx-1', operationDigest: request.operationDigest,
    beforeImageDigest: request.beforeImageDigest, restoreAttemptIdentity: 'different' }), /REPLAY_MISMATCH/);
});

test('failed restoration retains journal and scope lock', async () => {
  const journal = await DurableJournal.open(await mkdtemp(join(tmpdir(), 'hw-bridge-restore-fail-')));
  const engine = { snapshot: async () => before, apply: async () => { throw new Error('private engine detail'); },
    restore: async () => ({ status: 'RESTORE_FAILED' }) };
  const bridge = new EngineBridge({ journal, engine, admit: (_, value) => value,
    verifyBinding: async () => ({ worldRef: 'luanti:test', allowedActions: ['APPLY_RECOVERABLE'], current: true }),
    verifyService: async () => true, digestBeforeImage: () => 'c'.repeat(64) });
  await bridge.prepare(request);
  await assert.rejects(() => bridge.apply(request), /RESTORE_FAILED/);
  assert.equal(journal.query('tx-1').status, 'RESTORE_FAILED');
  assert.equal(journal.query('tx-1').causeCode, 'APPLY_FAILED');
  await assert.rejects(() => journal.prepare({ transactionId: 'another', operationDigest: 'd'.repeat(64),
    transactionPayloadDigest: 'e'.repeat(64), beforeImageDigest: 'f'.repeat(64), beforeImage: before }), /TRANSACTION_CONFLICT/);
});

test('readback failure restores scoped before-image and retains original cause', async () => {
  const journal = await DurableJournal.open(await mkdtemp(join(tmpdir(), 'hw-bridge-readback-fail-')));
  let restores = 0;
  const engine = { snapshot: async () => before,
    apply: async () => ({ status: 'APPLIED_PENDING_READBACK' }),
    readback: async () => { throw new Error('private engine detail'); },
    restore: async () => { restores++; return { status: 'ROLLED_BACK' }; } };
  const bridge = new EngineBridge({ journal, engine, admit: (_, value) => value,
    verifyBinding: async () => ({ worldRef: 'luanti:test', allowedActions: ['APPLY_RECOVERABLE', 'READBACK'], current: true }),
    verifyService: async () => true, digestBeforeImage: () => 'c'.repeat(64),
    digestReadback: () => 'd'.repeat(64) });
  await bridge.prepare(request);
  await bridge.apply(request);
  await assert.rejects(() => bridge.readback(request), /READBACK_FAILED/);
  assert.equal(restores, 1);
  assert.equal(journal.query('tx-1').status, 'ROLLED_BACK');
  assert.equal(journal.query('tx-1').causeCode, 'READBACK_FAILED');
});

test('PREPARED restore never overwrites an external edit or releases its scope', async () => {
  const journal = await DurableJournal.open(await mkdtemp(join(tmpdir(), 'hw-bridge-prepared-external-')));
  let cell = 'A';
  let restores = 0;
  const bridge = new EngineBridge({ journal, admit: (_, value) => value,
    engine: { snapshot: async () => before, restore: async () => { restores++; cell = 'A';
      return { status: 'ROLLED_BACK' }; } },
    verifyBinding: async () => ({ worldRef: 'luanti:test',
      allowedActions: ['APPLY_RECOVERABLE'], current: true }),
    verifyService: async () => true, digestBeforeImage: () => 'c'.repeat(64) });
  await bridge.prepare(request);
  cell = 'B'; // A different engine writer changed the world, outside this Adapter chain.
  await assert.rejects(() => bridge.restore({ worldRef: request.worldRef, originTransactionId: 'tx-1',
    operationDigest: request.operationDigest, beforeImageDigest: request.beforeImageDigest,
    restoreAttemptIdentity: 'restore-prepared' }), /STALE_TRANSACTION/);
  assert.equal(cell, 'B');
  assert.equal(restores, 0);
  assert.equal(journal.query('tx-1').status, 'PREPARED');
  await assert.rejects(() => journal.prepare({ transactionId: 'tx-other',
    operationDigest: 'd'.repeat(64), transactionPayloadDigest: 'e'.repeat(64),
    beforeImageDigest: 'f'.repeat(64), beforeImage: before }), /TRANSACTION_CONFLICT/);
});

test('crash at RESTORING resumes with the same identity and terminal retry never writes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hw-bridge-restoring-restart-'));
  const journal = await DurableJournal.open(dir);
  await journal.prepare({ transactionId: request.transactionId,
    operationDigest: request.operationDigest, transactionPayloadDigest: request.transactionPayloadDigest,
    beforeImageDigest: request.beforeImageDigest, beforeImage: before });
  await journal.transition('tx-1', 'APPLYING');
  await journal.transition('tx-1', 'RESTORING', { causeCode: 'APPLY_FAILED',
    restoreAttemptIdentity: 'restore-same' });
  const reopened = await DurableJournal.open(dir);
  assert.equal(reopened.query('tx-1').status, 'RECOVERY_PENDING');
  let restores = 0;
  const bridge = new EngineBridge({ journal: reopened, admit: (_, value) => value,
    verifyService: async () => true,
    engine: { restore: async (_, image) => { restores++; assert.deepEqual(image, before);
      return { status: 'ROLLED_BACK' }; } } });
  const recovery = { worldRef: request.worldRef, originTransactionId: 'tx-1', operationDigest: request.operationDigest,
    beforeImageDigest: request.beforeImageDigest, restoreAttemptIdentity: 'restore-same' };
  const result = await bridge.restore(recovery);
  assert.equal(result.status, 'ROLLED_BACK');
  assert.equal(restores, 1);
  assert.equal(reopened.query('tx-1').status, 'ROLLED_BACK');
  assert.equal(reopened.query('tx-1').causeCode, 'APPLY_FAILED');
  const retried = await bridge.restore(recovery);
  assert.equal(retried.status, 'ROLLED_BACK');
  assert.equal(restores, 1);
  await assert.rejects(() => bridge.restore({ ...recovery,
    restoreAttemptIdentity: 'different' }), /REPLAY_MISMATCH/);
});

test('failed RESTORING restart retains UNKNOWN and affected-cell scope', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hw-bridge-restoring-failed-'));
  const journal = await DurableJournal.open(dir);
  await journal.prepare({ transactionId: request.transactionId,
    operationDigest: request.operationDigest, transactionPayloadDigest: request.transactionPayloadDigest,
    beforeImageDigest: request.beforeImageDigest, beforeImage: before });
  await journal.transition('tx-1', 'APPLYING');
  await journal.transition('tx-1', 'RESTORING', { causeCode: 'READBACK_FAILED',
    restoreAttemptIdentity: 'restore-fail' });
  const reopened = await DurableJournal.open(dir);
  const bridge = new EngineBridge({ journal: reopened, admit: (_, value) => value,
    verifyService: async () => true,
    engine: { restore: async () => { throw new Error('diagnostic restore fault'); } } });
  await assert.rejects(() => bridge.restore({ worldRef: request.worldRef, originTransactionId: 'tx-1',
    operationDigest: request.operationDigest, beforeImageDigest: request.beforeImageDigest,
    restoreAttemptIdentity: 'restore-fail' }), /RESTORE_FAILED/);
  assert.equal(reopened.query('tx-1').status, 'RESTORE_FAILED');
  assert.equal(reopened.query('tx-1').mutationState, 'UNKNOWN');
  assert.equal(reopened.query('tx-1').causeCode, 'READBACK_FAILED');
  await assert.rejects(() => reopened.prepare({ transactionId: 'tx-other',
    operationDigest: 'd'.repeat(64), transactionPayloadDigest: 'e'.repeat(64),
    beforeImageDigest: 'f'.repeat(64), beforeImage: before }), /TRANSACTION_CONFLICT/);
});
