// SOURCE/FIXTURE: actual adapter lifecycle/runtime; native Host and engine are fixtures.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, realpath, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { validateBoundResponse, validateType } from '#contracts';
import { createLocalWorldPort } from '../src/local-world-port.mjs';
import { createLocalRuntime } from '../src/local-runtime.mjs';
import { LocalCourier } from '../src/local-courier.mjs';
import { ENGINE_GUARDS } from '../src/safety-capabilities.mjs';
import { WORLD_GEOMETRY, STATE_PROFILE } from '../src/world-vocabulary.mjs';

const catalogue = JSON.parse(execFileSync('lua', ['test/support/material-facts.lua', 'glass'], { encoding: 'utf8' })).catalogue;
async function setup(t) {
  const base = process.env.HW_ADAPTER_TEST_ROOT ?? join(tmpdir(), 'hanaworlds-adapter-tests');
  await mkdir(base, { recursive: true });
  const root = await realpath(await mkdtemp(join(base, 'switch-')));
  for (const d of ['worlds', 'home', 'games/fixture']) await mkdir(join(root, d), { recursive: true });
  await writeFile(join(root, 'games/fixture/game.conf'), 'title = Fixture\n');
  const records = new Map(), engines = [], handshakeFailures = new Set();
  let mode = 'exact', exitCountdown = 0, local;
  t.mock.method(LocalCourier, 'open', async world => {
    const engine = { closed: false, engineGuards: ENGINE_GUARDS,
      connectionIncarnationRef: `incarnation:${engines.length}`,
      handshake: async () => { if (handshakeFailures.has(world.worldRef)) throw Error('PAYLOAD_VERSION_MISMATCH'); },
      catalogue: async () => catalogue, profile: async () => ({ profileVersion: 'state-profile/v2' }),
      regionLimits: async () => ({ mapblockSize: 16, mapgenLimit: 31000 }),
      close: async () => { engine.closed = true; } };
    engines.push(engine); return engine;
  });
  const host = {
    async acquire(q) {
      const controlRef = `host:${records.size}`;
      records.set(controlRef, { ...q, pid: 1234 + records.size, stopped: false });
      return { controlRef, worldPath: q.worldPath };
    },
    async inspect(q) {
      const r = records.get(q.controlRef);
      if (exitCountdown && --exitCountdown === 0) r.stopped = true;
      if (!r || r.stopped) throw Error('NOT_CURRENT');
      return { state: 'CURRENT', worldPath: r.worldPath, processId: r.pid, operationRef: r.operationRef };
    },
    async withStoppedWorld(q, consume) {
      const r = records.get(q.controlRef);
      if (mode === 'unknown') throw Error('UNKNOWN');
      r.stopped = true;
      const facts = { state: 'STOPPED', worldPath: r.worldPath, processId: r.pid, operationRef: r.operationRef };
      if (mode === 'wrong-pid') facts.processId++;
      return consume(facts);
    },
  };
  const runtime = createLocalRuntime({ ctx: {}, homePath: (...p) => join(root, 'home', ...p),
    inspectConnection: ref => local.inspectConnection(ref) });
  local = createLocalWorldPort({ roots: [join(root, 'worlds')], resolveControl: () => host, runtime });
  t.after(async () => { await local.close(); await runtime.close(); await rm(root, { recursive: true }); });
  let sequence = 0;
  const make = worldName => local.port.createFlatWorld({ requesterRef: 'host', userPath: root, worldName });
  const acquire = w => local.port.acquire({ requesterRef: 'host', userPath: root, connectionRef: w.connectionRef, action: 'BIND_RUNNING_WORLD' });
  const pair = async worldRef => {
    const q = { contractVersion: 'local-worlds/v2', requestId: `pair:${++sequence}`, worldRef };
    return validateBoundResponse('local-worlds/v2', 'pair', q, await local.port.pair(q));
  };
  const read = async connectionRef => {
    const q = { contractVersion: 'world-adapter/v8', requestId: `read:${++sequence}`, sessionRef: 'fixture-session', connectionRef };
    return validateBoundResponse('world-adapter/v8', 'ReadLocalConnection', q, await runtime.port.call('ReadLocalConnection', q));
  };
  const stop = w => local.port.stopWorld({ requesterRef: 'host', connectionRef: w.connectionRef, worldRef: w.worldRef });
  return { local, runtime, records, engines, handshakeFailures, make, acquire, pair, read, stop,
    setMode: v => { mode = v; }, exitAfterInspections: n => { exitCountdown = n; } };
}
function checkReadback(r, world) {
  assert.equal(r.error, null);
  const value = validateType('LocalConnectionReadback', r.result);
  assert.equal(value.worldRef, world.worldRef);
  assert.equal(value.connectionRef, world.connectionRef);
  assert.equal(value.payloadVersion, world.payloadVersion);
  assert.equal(value.payloadDigest, world.payloadDigest);
  assert.equal(value.capabilities.worldRef, world.worldRef);
  assert.deepEqual(value.capabilities.worldGeometry, WORLD_GEOMETRY);
  assert.deepEqual(value.capabilities.stateProfile, STATE_PROFILE);
  assert.deepEqual(JSON.parse(JSON.stringify(value.capabilities.engineBounds)),
    { min: [-31000, -31000, -31000], max: [31000, 31000, 31000] });
  return value;
}

test('v2 pair and ReadLocalConnection read the exact current world across A → B → A', async t => {
  const f = await setup(t), a = await f.make('A'), b = await f.make('B');
  const receipts = [];
  for (const world of [a, b, a]) {
    await f.acquire(world);
    const paired = checkReadback(await f.pair(world.worldRef), world);
    receipts.push(paired);
    assert.deepEqual(checkReadback(await f.read(world.connectionRef), world), paired);
    const acquisitions = f.records.size;
    assert.deepEqual(checkReadback(await f.pair(world.worldRef), world), paired);
    assert.equal(f.records.size, acquisitions, 'read existing pair without starting another process');
    assert.equal((await f.stop(world)).stopped, true);
    const stale = await f.read(world.connectionRef);
    assert.equal(stale.result, null); assert.equal(stale.error.code, 'CONNECTION_NOT_FOUND');
    assert.equal((await f.pair(world.worldRef)).error.code, 'CONNECTION_NOT_FOUND');
  }
  assert.notEqual(receipts[0].connectionIncarnationRef, receipts[2].connectionIncarnationRef);
  assert.equal(receipts[0].worldRef, receipts[2].worldRef);
  assert.ok(f.engines.every(e => e.closed));
});

test('v2 pairing B preserves A until its explicit exact stopped-world callback', async t => {
  const f = await setup(t), a = await f.make('A'), b = await f.make('B');
  await f.acquire(a); const pa = checkReadback(await f.pair(a.worldRef), a);
  await f.acquire(b); checkReadback(await f.pair(b.worldRef), b);
  assert.deepEqual(checkReadback(await f.read(a.connectionRef), a), pa);
  assert.equal(f.engines[0].closed, false);
  for (const mode of ['unknown', 'wrong-pid']) {
    f.setMode(mode); await assert.rejects(f.stop(a), mode === 'unknown' ? /UNKNOWN/ : /CURRENT_WORLD_MISMATCH/);
    assert.equal(f.engines[0].closed, false, 'unproven stop cannot retire A');
  }
  f.setMode('exact'); await f.stop(a);
  assert.equal(f.engines[0].closed, true);
  checkReadback(await f.read(b.connectionRef), b);
});

test('v2 pair refuses missing/unstarted worlds and preserves the payload mismatch error', async t => {
  const f = await setup(t), a = await f.make('A'), b = await f.make('B');
  assert.equal((await f.pair('missing-world')).error.code, 'CONNECTION_NOT_FOUND');
  assert.equal((await f.pair(a.worldRef)).error.code, 'CONNECTION_NOT_FOUND');
  await f.acquire(a); const pa = checkReadback(await f.pair(a.worldRef), a);
  f.handshakeFailures.add(b.worldRef); await f.acquire(b);
  const failed = await f.pair(b.worldRef);
  assert.equal(failed.result, null); assert.equal(failed.error.code, 'PAYLOAD_VERSION_MISMATCH');
  assert.equal(f.engines[1].closed, true);
  assert.deepEqual(checkReadback(await f.read(a.connectionRef), a), pa);
  assert.equal((await f.read(b.connectionRef)).error.code, 'CONNECTION_NOT_FOUND');
});

test('ReadLocalConnection refuses native exit instead of reporting cached identity', async t => {
  const f = await setup(t), a = await f.make('A');
  await f.acquire(a); checkReadback(await f.pair(a.worldRef), a);
  f.records.values().next().value.stopped = true;
  const stale = await f.read(a.connectionRef);
  assert.equal(stale.result, null); assert.equal(stale.error.code, 'CONNECTION_NOT_FOUND');
  assert.equal((await f.pair(a.worldRef)).error.code, 'CONNECTION_NOT_FOUND');
});

test('ReadLocalConnection rejects a native exit between its two current checks', async t => {
  const f = await setup(t), a = await f.make('A');
  await f.acquire(a); checkReadback(await f.pair(a.worldRef), a);
  f.exitAfterInspections(2);
  const stale = await f.read(a.connectionRef);
  assert.equal(stale.result, null); assert.equal(stale.error.code, 'CONNECTION_NOT_FOUND');
});

test('v2 pair admits a snapshot and rejects malformed selectors before engine work', async t => {
  const f = await setup(t), a = await f.make('A'); await f.acquire(a);
  const q = { contractVersion: 'local-worlds/v2', requestId: 'snapshot', worldRef: a.worldRef };
  const work = f.local.port.pair(q); q.worldRef = 'changed';
  checkReadback(await work, a);
  const count = f.engines.length;
  for (const request of [
    { ...q, contractVersion: 'local-worlds/v1' },
    { ...q, connectionRef: a.connectionRef },
    { contractVersion: 'local-worlds/v2', requestId: 'missing-selector' },
  ]) await assert.rejects(f.local.port.pair(request));
  assert.equal(f.engines.length, count);
});
