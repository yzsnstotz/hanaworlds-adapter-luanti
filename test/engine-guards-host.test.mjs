// SOURCE/FIXTURE: host side of the v1 engine guards (payload test/engine-guards.lua
// covers the engine). Courier and records are real; the engine is a double.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import * as C from 'hanaworlds-contracts';
import { LocalCourier } from '../src/local-courier.mjs';
import { ENGINE_GUARDS, ENGINE_GUARD_DECLARATION, engineGuardDeclaration, refusalDetail } from '../src/safety-capabilities.mjs';
import { protocolHandshake, worldAdapterProtocolHandshake } from '../src/region-io.mjs';
import { LocalRecords } from '../src/local-records.mjs';
import { LocalTransactions } from '../src/local-transactions.mjs';
import { PAYLOAD_VERSION } from '../src/version.mjs';

const manifest = { worldRef: 'local:w', payloadDigest: 'p'.repeat(64) };
const answer = (courier, result) => { const e = courier.queue.shift(); clearTimeout(e.timer); e.resolve(result); return e.command; };
const hello = engineGuards => ({ worldRef: manifest.worldRef, payloadVersion: PAYLOAD_VERSION, payloadMatches: true,
  loadedSourceDigest: manifest.payloadDigest, worldeditAvailable: true, engineGuards });
const declared = { bodyClearance: ['prepare_check', 'apply', 'apply_state', 'restore', 'region_write'],
  perCellProtection: ['prepare_check', 'apply', 'apply_state', 'restore', 'region_write'],
  playerEnclosure: ['prepare_check', 'apply', 'apply_state'] };

test('courier pairs only a payload whose engine runs every advertised guard', async () => {
  assert.deepEqual(JSON.parse(JSON.stringify(ENGINE_GUARDS)), declared);
  for (const bad of [undefined, {}, { ...declared, perCellProtection: false }, { ...declared, playerEnclosure: ['apply'] },
    { ...declared, extra: false }, { ...declared, bodyClearance: ['restore'] }]) {
    const courier = new LocalCourier(manifest, { token: 'a'.repeat(64) });
    const pending = courier.handshake();
    answer(courier, hello(bad));
    await assert.rejects(pending, /CAPABILITY_UNAVAILABLE/);
  }
  const courier = new LocalCourier(manifest, { token: 'a'.repeat(64) });
  const pending = courier.handshake();
  answer(courier, hello(declared));
  await pending;
  assert.deepEqual(courier.engineGuards, declared);
});

test('prepare check carries effects so the engine can run the enclosure guard', async () => {
  const courier = new LocalCourier(manifest, { token: 'a'.repeat(64) });
  const effects = [{ position: [0, 1, 0], nodeName: 'test:stone' }];
  const pending = courier.prepareCheck([[0, 1, 0]], effects);
  const command = answer(courier, { checked: 1 });
  await pending;
  assert.equal(command.operation, 'prepare_check');
  assert.deepEqual(command.positions, [[0, 1, 0]]);
  assert.deepEqual(command.effects, effects);
  const bare = courier.prepareCheck([[0, 1, 0]]);
  assert.equal('effects' in answer(courier, { checked: 1 }), false);
  await bare;
});

test('a blocked restore stays RESTORE_FAILED with its cause and keeps its cells reserved', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hw-guards-'));
  try {
    const store = await LocalRecords.open(dir, manifest.worldRef);
    const before = { worldRef: manifest.worldRef, coveredPositions: [[0, 1, 0]], records: [] };
    const blocked = Object.assign(new Error('RESTORE_FAILED'), { detail: 'BODY_OCCUPIED' });
    let writes = 0;
    const tx = new LocalTransactions({ store, current: async () => {},
      engine: { restore: async () => { throw blocked; }, snapshot: async () => { writes++; } } });
    const saved = { transactionId: 't1', before, status: 'APPLYING', request: { localContext: {} } };
    await assert.rejects(tx.rollback(saved), /RESTORE_FAILED/);
    const record = store.get('t1');
    assert.equal(record.status, 'RESTORE_FAILED');
    assert.deepEqual(record.restoreFailure, { code: 'RESTORE_FAILED', detail: 'BODY_OCCUPIED' });
    assert.equal(writes, 0, 'nothing read back as restored');
    // A new transaction over the same cell is refused while recovery is pending.
    tx.scopeNow = async () => before;
    await assert.rejects(tx.prepare({ transactionId: 't2' }), /TRANSACTION_CONFLICT/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('rc.2 engineGuards: declared per guard and stage exactly as the payload runs them', () => {
  const D = ENGINE_GUARD_DECLARATION;
  assert.equal(JSON.stringify(D), JSON.stringify(engineGuardDeclaration(declared)));
  const P = ['PREPARE_RECOVERABLE', 'APPLY_COMPILED', 'APPLY_HISTORY'];
  assert.equal(JSON.stringify(D.coverage), JSON.stringify([
    { guard: 'BODY_CLEARANCE', stages: [...P, 'RESTORE', 'REGION_APPLY'], protectionPrincipal: null },
    { guard: 'CELL_PROTECTION', stages: [...P, 'RESTORE', 'REGION_APPLY'], protectionPrincipal: 'ANONYMOUS' },
    { guard: 'PLAYER_ENCLOSURE', stages: P, protectionPrincipal: null }]));
  const covered = D.coverage.flatMap(c => c.stages.map(stage => ({ guard: c.guard, stage })));
  assert.deepEqual(C.unmetEngineGuards(D, covered), []);
  // Not covered, so refused by name before any write: no G3 on restores or region writes, nothing at
  // inspection or history Prepare, no region restore claim, and ANONYMOUS is not acting-principal protection.
  const uncovered = [['PLAYER_ENCLOSURE', 'RESTORE'], ['PLAYER_ENCLOSURE', 'REGION_APPLY'], ['PLAYER_ENCLOSURE', 'REGION_RESTORE'],
    ['BODY_CLEARANCE', 'REGION_RESTORE'], ['CELL_PROTECTION', 'REGION_RESTORE'], ['CELL_PROTECTION', 'INSPECT_REGION'],
    ['BODY_CLEARANCE', 'PREPARE_HISTORY']].map(([guard, stage]) => ({ guard, stage }));
  assert.equal(C.unmetEngineGuards(D, uncovered).length, uncovered.length);
  assert.ok(C.unmetEngineGuards(D, uncovered).every(x => x.finding === 'GUARD_UNAVAILABLE'));
  assert.deepEqual(C.unmetEngineGuards(D, [{ guard: 'CELL_PROTECTION', stage: 'APPLY_COMPILED', protectionPrincipal: 'ACTING_PRINCIPAL' }]),
    [{ guard: 'CELL_PROTECTION', stage: 'APPLY_COMPILED', finding: 'GUARD_UNAVAILABLE' }]);
  assert.throws(() => C.requireEngineGuards(D, [{ guard: 'PLAYER_ENCLOSURE', stage: 'REGION_APPLY' }]), /CAPABILITY_UNAVAILABLE/);
  // rc.1 capability ids are gone from both handshakes; protocol majors follow rc.2.
  for (const h of [worldAdapterProtocolHandshake, protocolHandshake])
    assert.ok(!h.capabilities.some(c => /body|protection|enclosure/.test(c)));
  assert.equal(JSON.stringify(worldAdapterProtocolHandshake.protocols), JSON.stringify([{ protocol: 'world-adapter', major: 7, minor: 0 }]));
  assert.equal(JSON.stringify(protocolHandshake.protocols), JSON.stringify([{ protocol: 'world-adapter-region', major: 2, minor: 0 }]));
});

test('guard refusals are public GuardRefusal plus the exact contract error; undeclared stages claim nothing', () => {
  for (const [stage, detail, guard] of [['PREPARE_RECOVERABLE', 'PROTECTED_CELL', 'CELL_PROTECTION'], ['APPLY_COMPILED', 'PLAYER_ENCLOSED', 'PLAYER_ENCLOSURE'],
    ['APPLY_HISTORY', 'BODY_OCCUPIED', 'BODY_CLEARANCE'], ['REGION_APPLY', 'PROTECTED_CELL', 'CELL_PROTECTION']]) {
    const r = refusalDetail(stage, detail, { transactionRef: 't' });
    assert.deepEqual(r.guardRefusal, { guard, stage, finding: detail });
    assert.deepEqual(r.error, C.guardRefusalError(r.guardRefusal, { transactionRef: 't' }));
    C.validateType('FailureDetail', r);
  }
  const restore = refusalDetail('RESTORE', 'BODY_OCCUPIED', { transactionRef: 't', cause: 'READBACK_MISMATCH' });
  assert.equal(restore.error.code, 'RESTORE_FAILED'); assert.equal(restore.error.causeCode, 'READBACK_MISMATCH');
  assert.deepEqual(refusalDetail('RESTORE', 'RESTORE_GUARD_UNAVAILABLE', { cause: 'APPLY_FAILED' }).guardRefusal,
    { guard: 'BODY_CLEARANCE', stage: 'RESTORE', finding: 'GUARD_UNAVAILABLE' });
  for (const [stage, detail] of [['REGION_RESTORE', 'BODY_OCCUPIED'], ['REGION_APPLY', 'PLAYER_ENCLOSED'], ['RESTORE', 'PLAYER_ENCLOSED'], ['APPLY_COMPILED', undefined]])
    assert.equal(refusalDetail(stage, detail, { cause: 'APPLY_FAILED' }), null);
});

test('receipts: RESTORE_FAILED keeps both causes (applyFailure), a guard-refused write rolls back with its refusal', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hw-guards-'));
  try {
    const store = await LocalRecords.open(dir, manifest.worldRef);
    const tx = new LocalTransactions({ store, current: async () => {} });
    const ctx = { connectionRef: 'c', connectionIncarnationRef: 'i', worldRef: manifest.worldRef, selectionRevision: 'r1' };
    const base = { transactionId: 't1', operationDigest: 'a'.repeat(64), transactionPayloadDigest: 'b'.repeat(64),
      before: { worldRevision: 'scope-state:x' }, request: { localContext: ctx } };
    // receipt() validates ReceiptProjection with the contract's domain rules.
    for (const [failure, restore, restoreStatus] of [
      [{ failureCode: 'SAFETY_INVARIANT_FAILED', failureStage: 'APPLY_COMPILED', failureDetail: 'PLAYER_ENCLOSED' }, 'BODY_OCCUPIED', 'FAILED'],
      [{ failureCode: 'READBACK_MISMATCH', failureStage: 'APPLY_HISTORY' }, 'PROTECTED_CELL', 'FAILED'],
      [{ failureCode: 'APPLY_FAILED', failureStage: 'APPLY_COMPILED' }, 'RESTORE_GUARD_UNAVAILABLE', 'FAILED'],
      [{ failureCode: 'APPLY_FAILED', failureStage: 'APPLY_COMPILED' }, null, 'UNKNOWN']]) {
      const receipt = tx.receipt({ ...base, ...failure, status: 'RESTORE_FAILED', restoreFailure: { code: 'RESTORE_FAILED', detail: restore } });
      assert.equal(receipt.status, 'RESTORE_FAILED'); assert.equal(receipt.restoreStatus, restoreStatus);
      assert.equal(receipt.error.causeCode, receipt.applyFailure.error.code);
      assert.equal(receipt.error.retryability, 'AFTER_MANUAL_RECOVERY');
      assert.equal(receipt.applyFailure.guardRefusal?.finding ?? null, failure.failureDetail ?? null);
      assert.equal(receipt.guardRefusal?.stage ?? null, restore ? 'RESTORE' : null);
    }
    const stateProfile = { profileVersion: 'state-profile/v2', nodeFields: ['nodeName', 'param1', 'param2'], metadataMode: 'exact',
      inventoryMode: 'exact', timerMode: 'exact', derivedLightMode: 'recompute-with-readback' };
    const after = { worldRef: manifest.worldRef, coveredPositions: [[0, 1, 0]], stateProfile, records: [{ position: [0, 1, 0],
      nodeName: 'air', param1: 0, param2: 0, metadata: {}, inventory: {}, timer: null }] };
    const rolled = tx.receipt({ ...base, status: 'ROLLED_BACK', failureCode: 'SAFETY_INVARIANT_FAILED', failureStage: 'APPLY_COMPILED',
      failureDetail: 'PROTECTED_CELL', after: { ...after, worldRevision: 'scope-state:y' } });
    assert.equal(JSON.stringify(rolled.guardRefusal), JSON.stringify({ guard: 'CELL_PROTECTION', stage: 'APPLY_COMPILED', finding: 'PROTECTED_CELL' }));
    assert.equal(rolled.status, 'ROLLED_BACK'); assert.equal(rolled.error.mutationState, 'NONE');
    assert.equal(rolled.error.reason, 'SCOPE_DENIED'); assert.equal(rolled.applyFailure, null);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
