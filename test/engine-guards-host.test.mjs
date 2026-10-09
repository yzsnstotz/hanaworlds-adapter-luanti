// SOURCE/FIXTURE: host side of the v1 engine guards (payload test/engine-guards.lua
// covers the engine). Courier and records are real; the engine is a double.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import * as C from 'hanaworlds-contracts';
import { LocalCourier } from '../src/local-courier.mjs';
import { ENGINE_GUARDS, guardFailure, WORLD_ADAPTER_SAFETY, REGION_SAFETY } from '../src/safety-capabilities.mjs';
import { protocolHandshake, worldAdapterProtocolHandshake } from '../src/region-io.mjs';
import { LocalRecords } from '../src/local-records.mjs';
import { LocalTransactions } from '../src/local-transactions.mjs';
import { PAYLOAD_VERSION } from '../src/version.mjs';

const manifest = { worldRef: 'local:w', payloadDigest: 'p'.repeat(64) };
const answer = (courier, result) => { const e = courier.queue.shift(); clearTimeout(e.timer); e.resolve(result); return e.command; };
const hello = engineGuards => ({ worldRef: manifest.worldRef, payloadVersion: PAYLOAD_VERSION, payloadMatches: true,
  loadedSourceDigest: manifest.payloadDigest, worldeditAvailable: true, engineGuards });
const declared = { restoreBodyRecheck: ['restore'],
  perCellProtection: ['prepare_check', 'apply', 'apply_state', 'restore', 'region_write'],
  playerEnclosure: ['prepare_check', 'apply', 'apply_state'] };

test('courier pairs only a payload whose engine runs every advertised guard', async () => {
  assert.deepEqual(JSON.parse(JSON.stringify(ENGINE_GUARDS)), declared);
  for (const bad of [undefined, {}, { ...declared, perCellProtection: false }, { ...declared, playerEnclosure: ['apply'] },
    { ...declared, extra: false }, { ...declared, restoreBodyRecheck: true }]) {
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

test('rc.1 safety capabilities: advertised exactly where implemented, the rest refused by name', () => {
  const ours = C.safetyCapabilities.filter(c => c.owner === 'hanaworlds-adapter-luanti').map(c => c.id).sort();
  assert.deepEqual(ours, [...WORLD_ADAPTER_SAFETY, ...REGION_SAFETY, 'world-adapter-region/v1:no-body-enclosure'].sort());
  assert.deepEqual(C.unmetSafetyCapabilities(worldAdapterProtocolHandshake, WORLD_ADAPTER_SAFETY), []);
  assert.equal(JSON.stringify(C.requireSafetyCapabilities(worldAdapterProtocolHandshake, WORLD_ADAPTER_SAFETY)), JSON.stringify(WORLD_ADAPTER_SAFETY));
  assert.deepEqual(C.unmetSafetyCapabilities(protocolHandshake, REGION_SAFETY), []);
  // Region writes have no enclosure guard: not advertised, so a consumer refuses by its name.
  const [unmet] = C.unmetSafetyCapabilities(protocolHandshake, ['world-adapter-region/v1:no-body-enclosure']);
  assert.equal(unmet.cause, 'BODY_ENCLOSURE_UNCHECKED');
  assert.throws(() => C.requireSafetyCapabilities(protocolHandshake, ['world-adapter-region/v1:no-body-enclosure']), /CAPABILITY_UNAVAILABLE/);
  assert.equal(JSON.stringify(worldAdapterProtocolHandshake.protocols), JSON.stringify([{ protocol: 'world-adapter', major: 7, minor: 0 }]));
});

test('engine guard refusals are the contract errors, never a private code', () => {
  const W = 'world-adapter/v7', R = 'world-adapter-region/v1';
  assert.deepEqual(guardFailure(W, 'PROTECTED_CELL', { transactionRef: 't' }), C.safetyCheckFailure(`${W}:cell-protection`, 't'));
  assert.deepEqual(guardFailure(W, 'PLAYER_ENCLOSED'), C.safetyCheckFailure(`${W}:no-body-enclosure`));
  assert.deepEqual(guardFailure(W, 'BODY_OCCUPIED', { restore: true, transactionRef: 't' }), C.safetyCheckFailure(`${W}:restore-body-recheck`, 't'));
  assert.deepEqual(guardFailure(R, 'PROTECTED_CELL'), C.safetyCheckFailure(`${R}:cell-protection`));
  assert.deepEqual(guardFailure(R, 'BODY_OCCUPIED', { restore: true }), C.safetyCheckFailure(`${R}:restore-body-recheck`));
  // Not a declared guard (or a write-time body overlap, the pre-existing check): no safety-capability error.
  for (const [w, d, o] of [[W, 'BODY_OCCUPIED', {}], [R, 'PLAYER_ENCLOSED', {}], [W, 'RESTORE_GUARD_UNAVAILABLE', { restore: true }], [W, undefined, {}]])
    assert.equal(guardFailure(w, d, o), null);
});

test('a guard-refused restore receipt meets the canvas/v6 RESTORE_FAILED rule', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hw-guards-'));
  try {
    const store = await LocalRecords.open(dir, manifest.worldRef);
    const tx = new LocalTransactions({ store, current: async () => {} });
    const base = { transactionId: 't1', operationDigest: 'a'.repeat(64), transactionPayloadDigest: 'b'.repeat(64),
      before: { worldRevision: 'scope-state:x' }, request: { localContext: null }, status: 'RESTORE_FAILED', failureCode: 'APPLY_FAILED' };
    const ctx = { connectionRef: 'c', connectionIncarnationRef: 'i', worldRef: manifest.worldRef, selectionRevision: 'r1' };
    for (const [detail, restoreStatus, causeCode] of [['BODY_OCCUPIED', 'FAILED', 'SAFETY_INVARIANT_FAILED'], ['PROTECTED_CELL', 'FAILED', 'SAFETY_INVARIANT_FAILED'], [null, 'UNKNOWN', 'APPLY_FAILED']]) {
      // receipt() validates ReceiptProjection, including the contract's RESTORE_FAILED rule.
      const receipt = tx.receipt({ ...base, request: { localContext: ctx }, restoreFailure: { code: 'RESTORE_FAILED', detail } });
      assert.equal(receipt.restoreStatus, restoreStatus);
      assert.equal(receipt.error.phase, 'restore');
      assert.equal(receipt.error.retryability, 'AFTER_MANUAL_RECOVERY');
      assert.equal(receipt.error.causeCode, causeCode);
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});
