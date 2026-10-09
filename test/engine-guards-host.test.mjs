// SOURCE/FIXTURE: host side of the v1 engine guards (payload test/engine-guards.lua
// covers the engine). Courier and records are real; the engine is a double.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { LocalCourier, ENGINE_GUARDS } from '../src/local-courier.mjs';
import { LocalRecords } from '../src/local-records.mjs';
import { LocalTransactions } from '../src/local-transactions.mjs';
import { PAYLOAD_VERSION } from '../src/version.mjs';

const manifest = { worldRef: 'local:w', payloadDigest: 'p'.repeat(64) };
const answer = (courier, result) => { const e = courier.queue.shift(); clearTimeout(e.timer); e.resolve(result); return e.command; };
const hello = engineGuards => ({ worldRef: manifest.worldRef, payloadVersion: PAYLOAD_VERSION, payloadMatches: true,
  loadedSourceDigest: manifest.payloadDigest, worldeditAvailable: true, engineGuards });
const declared = { restoreBodyRecheck: ['restore'], perCellProtection: false,
  playerEnclosure: ['prepare_check', 'apply', 'apply_state'] };

test('courier pairs only a payload that declares every engine guard', async () => {
  assert.deepEqual([...ENGINE_GUARDS].sort(), Object.keys(declared).sort());
  for (const bad of [undefined, {}, { ...declared, playerEnclosure: [] }, { ...declared, extra: false },
    { restoreBodyRecheck: true, perCellProtection: false, playerEnclosure: false }]) {
    const courier = new LocalCourier(manifest, { token: 'a'.repeat(64) });
    const pending = courier.handshake();
    answer(courier, hello(bad));
    await assert.rejects(pending, /PAYLOAD_VERSION_MISMATCH/);
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
