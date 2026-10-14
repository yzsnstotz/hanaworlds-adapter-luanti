// SOURCE/FIXTURE: actual Adapter + official Cordis. Engine/runtime peers are
// contract-shaped test providers; this file does not prove installed Host/UI gates.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Context, symbols } from '@deepseek-ai/cordis';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { syncBuiltinESMExports } from 'node:module';
import { apply, inject } from '../src/index.mjs';
import { LocalCourier } from '../src/local-courier.mjs';
import { ENGINE_GUARDS } from '../src/safety-capabilities.mjs';
import { canonicalJSON, validateType, validateBoundResponse } from '#contracts';

const RUN = fileURLToPath(new URL('../../', import.meta.url));
const WIRE = 'local-worlds/v2';
const plain = v => JSON.parse(JSON.stringify(v));
const original = v => v?.[symbols.original] ?? v;
let serial = 0;
const ask = extra => ({ contractVersion: WIRE, requestId: `source-test:${++serial}`, ...extra });
const scoped = (source, operation, payload) => ask({ source, operation, payload });
const keys = (value, expected) => assert.deepEqual(Object.keys(value).sort(), expected.sort());
function envelope(q, r) {
  keys(r, ['contractVersion', 'requestId', 'result', 'error']);
  assert.equal(r.contractVersion, WIRE);
  assert.equal(r.requestId, q.requestId);
  assert.equal((r.result === null) !== (r.error === null), true);
  if (r.error) validateType('Error', r.error);
  return plain(r);
}
function denied(q, r, code, reason = 'REQUIRED_FACT_UNKNOWN') {
  envelope(q, r);
  assert.equal(r.result, null);
  assert.deepEqual(plain(r.error), { code, phase: 'validate', retryability: 'AFTER_NEW_FACTS',
    mutationState: 'NONE', transactionRef: null, causeCode: null, reason });
}
function replace(owner, name, value) {
  const record = owner.reflect.store[owner[symbols.isolate][name]];
  assert.equal(record.fiber, owner.fiber);
  assert.equal(owner.set(name, value), true);
  assert.equal(record.value, value);
  assert.equal(original(owner.get(name)), value);
}
async function files(root) {
  const out = [];
  async function walk(dir) {
    for (const name of (await fs.readdir(dir)).sort()) {
      const path = join(dir, name), stat = await fs.lstat(path, { bigint: true });
      out.push([path, String(stat.dev), String(stat.ino), String(stat.mode), String(stat.mtimeNs),
        stat.isFile() ? createHash('sha256').update(await fs.readFile(path)).digest('hex') : null]);
      if (stat.isDirectory()) await walk(path);
    }
  }
  await walk(root); return out;
}
async function setup(t, config = {}) {
  const tmp = join(RUN, 'tmp', 'source-port');
  await fs.mkdir(tmp, { recursive: true });
  const root = await fs.realpath(await fs.mkdtemp(join(tmp, 'case-')));
  const user = join(root, 'user'), worlds = join(user, 'worlds'), home = join(root, 'home');
  await fs.mkdir(worlds, { recursive: true }); await fs.mkdir(home);
  await fs.mkdir(join(user, 'games/flatgame'), { recursive: true });
  await fs.writeFile(join(user, 'games/flatgame/game.conf'), 'title = Contract fixture\n');
  const nativeCatalogue = JSON.parse(execFileSync('lua', ['test/support/material-facts.lua', 'glass'], { encoding: 'utf8' })).catalogue;
  const actions = [], nativeReads = [];
  let bound, live = true, snapshotError, snapshotHook = () => {}, statusHook = () => {}, statusChange = {};
  let runtimeError;
  const records = new Map();
  const native = { closed: false, engineGuards: ENGINE_GUARDS, connectionIncarnationRef: 'runtime:incarnation:1',
    async handshake() { nativeReads.push('handshake'); },
    async close() { native.closed = true; },
    async catalogue() { nativeReads.push('catalogue'); return plain(nativeCatalogue); },
    async profile() { nativeReads.push('profile'); return {}; },
    async regionLimits() { nativeReads.push('regionLimits'); return { mapblockSize: 16, mapgenLimit: 31000 }; },
    async snapshot(positions) {
      nativeReads.push('snapshot');
      if (snapshotError) throw snapshotError;
      const result = { worldRef: bound.worldRef, coveredPositions: positions,
        records: positions.map(position => ({ position, nodeName: 'air', param1: 12, param2: 0,
          metadata: { owner: 'opaque-test-owner' }, inventory: {}, timer: null })) };
      await snapshotHook(); return result;
    } };
  for (const name of ['prepareCheck', 'apply', 'applyState', 'restore', 'regionWrite', 'regionEmerge'])
    native[name] = async () => { actions.push(name); throw Error('UNEXPECTED_WORLD_ACTION'); };
  t.mock.method(LocalCourier, 'open', async world => { bound = world; return native; });
  const control = {
    async acquire(q) { actions.push('native-acquire'); const controlRef = `control:${records.size}`;
      records.set(controlRef, q); return { controlRef, worldPath: q.worldPath }; },
    async inspect(q) { nativeReads.push('native-inspect');
      const record = records.get(q.controlRef);
      if (!live || !record || ['worldPath', 'requesterRef', 'operationRef'].some(k => record[k] !== q[k]))
        throw Error('CURRENT_WORLD_MISMATCH');
      return { state: 'CURRENT', worldPath: q.worldPath, processId: 1234, operationRef: q.operationRef }; },
    async withStoppedWorld(q, consume) { actions.push('native-stop');
      return consume({ ...(await control.inspect(q)), state: 'STOPPED' }); },
  };
  const ctx = new Context(), fibers = [];
  ctx.provide('webServer', { register: () => () => {} });
  ctx.provide('dshHomePath', (...p) => join(home, ...p));
  ctx.provide('hanaworldsNativeEngineControl', control);
  let adapter, owner, consumer, canvas;
  const runtimeReads = [];
  const engineRuntime = {
    async StartWorldRuntime() { actions.push('StartWorldRuntime'); throw Error('PAIR_MUST_NOT_START'); },
    async StopWorldRuntime() { actions.push('StopWorldRuntime'); throw Error('PAIR_MUST_NOT_STOP'); },
    async ReadRuntimeStatus(q) {
      keys(q, ['contractVersion', 'requestId', 'connectionRef']);
      assert.equal(q.contractVersion, 'engine-runtime/v2');
      assert.equal(typeof q.requestId, 'string'); assert.ok(q.requestId.length);
      runtimeReads.push(plain(q));
      await statusHook(); if (runtimeError) throw runtimeError;
      return { contractVersion: q.contractVersion, requestId: q.requestId,
        result: { worldRef: bound?.worldRef, connectionRef: 'runtime:connection:1',
          connectionIncarnationRef: native.connectionIncarnationRef, state: 'RUNNING', ...statusChange }, error: null };
    },
  };
  async function plugin(spec) { const fiber = ctx.plugin(spec); fibers.push(fiber); await fiber.await(); return fiber; }
  await plugin({ name: 'actual-source-under-test', inject, apply(c) {
    owner = c; adapter = apply(c, { localUserPath: user, localWorldRoots: [worlds], localCreationRoot: worlds,
      localGameId: 'flatgame', ...config });
  } });
  await plugin({ name: 'contract-runtime-peer', apply(c) { consumer = c;
    c.provide('hanaworldsEngineRuntime', engineRuntime);
    c.provide('hanaworldsWorldLifecycle', { launch() { actions.push('launch'); throw Error('NO_LAUNCH_DURING_READ'); } });
  } });
  const canvasFiber = await plugin({ name: 'current-canvas-peer', apply(c) { canvas = c;
    c.provide('hanaworldsCanvasV5', { call() { actions.push('canvas-call'); throw Error('NO_CANVAS_MUTATION'); } });
  } });
  t.after(async () => {
    await adapter.close();
    for (const fiber of fibers.reverse()) await fiber.dispose();
    await ctx.fiber.dispose(); await fs.rm(root, { recursive: true, force: true });
  });
  const local = () => consumer.get('hanaworldsLocalWorlds');
  function entry(name) { const fn = local()[name];
    assert.equal(typeof fn, 'function', `neutral public ${name} required by C-local-worlds v2 is missing`);
    return q => fn.call(local(), q);
  }
  async function descriptor() {
    const q = ask(), r = envelope(q, await entry('getRuntimeSource')(q));
    assert.equal(r.error, null); return r.result;
  }
  async function audit(action) {
    const before = await files(root), previous = [...actions];
    try { return await action(); }
    finally { assert.deepEqual(await files(root), before, 'read/refusal changed world or journal files');
      assert.deepEqual(actions, previous, 'read/refusal triggered lifecycle, write, emerge, history or session action'); }
  }
  // Existing provider ABI prepares a real local fixture world/lease, never a JSON
  // capability. It does not implement the new port under test.
  async function prepare({ pair = false } = {}) {
    const q = ask({ templateId: 'flat', displayName: 'Owned flat' });
    const r = await local().createWorld(q);
    assert.equal(r.error, null, JSON.stringify(r.error));
    const selected = (await local().discover()).find(w => w.worldRef === r.result.worldRef);
    bound = selected;
    const lease = await local().acquire({ connectionRef: selected.connectionRef, requesterRef: 'fixture-native-owner',
      userPath: user, action: 'BIND_RUNNING_WORLD' });
    if (pair) await local().pair({ leaseRef: lease.leaseRef, connectionRef: selected.connectionRef,
      requesterRef: 'fixture-native-owner' });
    return { selected, lease, created: r.result };
  }
  return { root, user, worlds, home, ctx, owner, consumer, canvas, canvasFiber, adapter, local, entry,
    descriptor, audit, prepare, native, actions, nativeReads, runtimeReads,
    setLive: v => { live = v; }, snapshotHook: fn => { snapshotHook = fn; },
    snapshotError: e => { snapshotError = e; }, statusHook: fn => { statusHook = fn; },
    statusChange: value => { statusChange = value; }, runtimeError: e => { runtimeError = e; } };
}

// Only the Canvas retirement peer is substituted. Creation, scoped dispatch,
// ownership/activity checks, filesystem removal and readback use actual Adapter code.
async function deletionFixture(t) {
  const f = await setup(t), retirement = { calls: [], sessionRefs: [], reservationRef: null };
  replace(f.canvas, 'hanaworldsCanvasV5', { async call(name, q) {
    assert.ok(['ListWorldSelections', 'ReserveWorldRetirement', 'ReleaseWorldRetirement'].includes(name),
      `unexpected Canvas action during deletion: ${name}`);
    let result;
    if (name === 'ListWorldSelections') result = { worldRef: q.worldRef, inventoryRevision: 'retirement-inventory:1',
      sessionRefs: retirement.sessionRefs, retirementReservationRef: retirement.reservationRef };
    else if (name === 'ReserveWorldRetirement') {
      assert.equal(retirement.reservationRef, null, 'cannot reserve retirement twice');
      assert.equal(q.expectedInventoryRevision, 'retirement-inventory:1');
      retirement.reservationRef = 'retirement-reservation:1';
      result = { worldRef: q.worldRef, reservationRef: retirement.reservationRef, inventoryRevision: q.expectedInventoryRevision };
    } else {
      assert.equal(q.reservationRef, retirement.reservationRef, 'release the exact held reservation');
      result = { worldRef: q.worldRef, reservationRef: q.reservationRef, outcome: q.outcome,
        inventoryRevision: 'retirement-inventory:2' };
      retirement.reservationRef = null;
    }
    retirement.calls.push({ name, request: plain(q) });
    return validateBoundResponse('canvas/v7', name, q,
      { contractVersion: 'canvas/v7', requestId: q.requestId, result, error: null });
  } });
  async function create(displayName) {
    const q = ask({ templateId: 'flat', displayName }), r = envelope(q, await f.local().createWorld(q));
    assert.equal(r.error, null); assert.equal(r.result.displayName, displayName);
    const worldPath = join(f.worlds, displayName);
    const marker = JSON.parse(await fs.readFile(join(worldPath, 'hanaworlds-created-world.json'), 'utf8'));
    assert.equal(marker.worldRef, r.result.worldRef, 'target has an independently observed real creation marker');
    const selected = (await f.local().discover()).find(w => w.worldRef === r.result.worldRef);
    assert.equal(selected.worldPath, worldPath);
    return { ...r.result, worldPath, connectionRef: selected.connectionRef };
  }
  const target = await create('Delete target'), keep = await create('Keep same-source world');
  const payload = { worldRef: target.worldRef, confirmationName: target.displayName };
  const request = source => scoped(source, 'deleteWorld', payload);
  function sequence(names, outcome) {
    assert.deepEqual(retirement.calls.map(x => x.name), names, 'only the declared retirement sequence is allowed');
    assert.ok(retirement.calls.every(x => x.request.worldRef === target.worldRef), 'never reserve or release the retained world');
    if (outcome) assert.equal(retirement.calls.at(-1).request.outcome, outcome);
    assert.equal(retirement.reservationRef, null, 'no leaked retirement reservation');
  }
  function refusal(q, r, code = 'TRANSACTION_CONFLICT') {
    const out = envelope(q, r);
    validateBoundResponse(WIRE, 'deleteWorld', { contractVersion: WIRE, requestId: q.requestId, ...q.payload }, r);
    assert.deepEqual(out.error, { code, phase: 'apply', retryability: 'AFTER_NEW_FACTS', mutationState: 'NONE',
      transactionRef: null, causeCode: null, reason: 'REQUIRED_FACT_UNKNOWN' });
    assert.equal(out.result, null);
  }
  async function isolatedRemoval(before) {
    await assert.rejects(fs.lstat(target.worldPath), e => e.code === 'ENOENT');
    assert.deepEqual(await fs.readdir(f.worlds), [keep.displayName], 'only the exact target disappears; no staging/residue');
    const after = await files(f.root);
    const expected = before.filter(row => row[0] !== target.worldPath && !row[0].startsWith(target.worldPath + '/'))
      .map(row => [...row]);
    // Removing a child changes only its parent directory timestamp. All retained
    // directory identities/modes and every other file's bytes/mtime must be exact.
    const parent = expected.find(row => row[0] === f.worlds), current = after.find(row => row[0] === f.worlds);
    assert.deepEqual(current.slice(0, 4), parent.slice(0, 4)); parent[4] = current[4];
    assert.deepEqual(after, expected, 'no extra world, journal, source or profile file changes');
  }
  return { ...f, retirement, target, keep, payload, request, sequence, refusal, isolatedRemoval };
}

test('neutral descriptor advertises exact configured source, templates and closed fields without actions', async t => {
  const f = await setup(t), d = await f.audit(f.descriptor);
  keys(d, ['source', 'contractVersions', 'discoveryInput', 'templates']);
  keys(d.source, ['sourceRef', 'instanceRef']);
  for (const value of Object.values(d.source)) assert.ok(typeof value === 'string' && value.length > 0);
  assert.deepEqual(d.contractVersions, [WIRE]); assert.deepEqual(d.discoveryInput, { worldRoot: f.worlds });
  assert.ok(d.templates.some(x => x.templateId === 'flat'));
  assert.equal(new Set(d.templates.map(x => x.templateId)).size, d.templates.length);
  for (const row of d.templates) { keys(row, ['templateId', 'displayName', 'description']);
    for (const value of Object.values(row)) assert.ok(typeof value === 'string' && value.length > 0); }
  assert.deepEqual((await f.audit(f.descriptor)).source, d.source);
});

for (const [extra, code, reason] of [[{ unexpected: true }, 'UNKNOWN_REQUIRED_FIELD', 'INVALID_SHAPE'],
  [{ contractVersion: 'local-worlds/v3' }, 'PAYLOAD_VERSION_MISMATCH', 'VERSION_UNSUPPORTED']])
  test(`descriptor admission refuses ${code} with a complete correlated envelope`, async t => {
    const f = await setup(t), q = ask(extra);
    await f.audit(async () => denied(q, await f.entry('getRuntimeSource')(q), code, reason));
  });

test('scoped create/discover/describe refer to the same newly supplied world and retain source generation', async t => {
  const f = await setup(t), d = await f.descriptor(), call = f.entry('callScoped');
  const q = scoped(d.source, 'createWorld', { templateId: 'flat', displayName: 'New flat' });
  const r = envelope(q, await call(q)); assert.equal(r.error, null);
  assert.equal(r.result.displayName, 'New flat'); assert.equal(r.result.templateId, 'flat');
  const inventoryQ = scoped(d.source, 'discover', d.discoveryInput);
  const inventory = await f.audit(() => call(inventoryQ)); envelope(inventoryQ, inventory);
  assert.equal(inventory.error, null);
  assert.deepEqual(inventory.result.worlds.map(w => [w.worldRef, w.displayName]), [[r.result.worldRef, 'New flat']]);
  const descriptionQ = scoped(d.source, 'describeSourceWorld', { worldRef: r.result.worldRef });
  const description = envelope(descriptionQ, await f.audit(() => call(descriptionQ)));
  assert.equal(description.error, null); assert.equal(description.result.worldRef, r.result.worldRef);
  assert.equal(description.result.sourceStartupFacts.availability, 'KNOWN');
  assert.deepEqual((await f.descriptor()).source, d.source);
  assert.equal(f.actions.length, 0);
});

test('scoped delete succeeds on the exact safe created world, preserves its neighbour and source generation', async t => {
  const f = await deletionFixture(t), d = await f.descriptor(), q = f.request(d.source);
  const before = await files(f.root), actions = [...f.actions];
  const r = envelope(q, await f.entry('callScoped')(q));
  validateBoundResponse(WIRE, 'deleteWorld', { contractVersion: WIRE, requestId: q.requestId, ...q.payload }, r);
  assert.equal(r.error, null);
  assert.deepEqual(r.result, { worldRef: f.target.worldRef, confirmationName: f.target.displayName, deleted: true });
  await f.isolatedRemoval(before); assert.deepEqual(f.actions, actions, 'safe deletion causes no engine/write/session actions');
  f.sequence(['ListWorldSelections', 'ReserveWorldRetirement', 'ReleaseWorldRetirement'], 'RETIRED');
  assert.deepEqual((await f.audit(f.descriptor)).source, d.source, 'deleting one world does not expire the source');
  const inventoryQ = scoped(d.source, 'discover', d.discoveryInput);
  const inventory = envelope(inventoryQ, await f.audit(() => f.entry('callScoped')(inventoryQ)));
  assert.equal(inventory.error, null);
  assert.deepEqual(inventory.result.worlds.map(w => [w.worldRef, w.displayName]), [[f.keep.worldRef, f.keep.displayName]]);
  const repeated = f.request(d.source);
  await f.audit(async () => f.refusal(repeated, await f.entry('callScoped')(repeated), 'WORLD_NOT_FOUND'));
  f.sequence(['ListWorldSelections', 'ReserveWorldRetirement', 'ReleaseWorldRetirement'], 'RETIRED');
});

test('scoped delete rejects the retained world name as confirmation without deleting either world', async t => {
  const f = await deletionFixture(t), d = await f.descriptor(), q = f.request(d.source);
  q.payload.confirmationName = f.keep.displayName;
  await f.audit(async () => f.refusal(q, await f.entry('callScoped')(q)));
  assert.deepEqual((await fs.readdir(f.worlds)).sort(), [f.target.displayName, f.keep.displayName].sort());
  f.sequence([]); assert.deepEqual((await f.descriptor()).source, d.source);
});

for (const paired of [false, true])
  test(`scoped delete refuses an ${paired ? 'active paired connection' : 'open native lease'} with no misdeletion`, async t => {
    const f = await deletionFixture(t), d = await f.descriptor();
    const lease = await f.local().acquire({ connectionRef: f.target.connectionRef, requesterRef: 'fixture-native-owner',
      userPath: f.user, action: 'BIND_RUNNING_WORLD' });
    if (paired) await f.local().pair({ leaseRef: lease.leaseRef, connectionRef: f.target.connectionRef,
      requesterRef: 'fixture-native-owner' });
    const q = f.request(d.source);
    await f.audit(async () => f.refusal(q, await f.entry('callScoped')(q)));
    assert.deepEqual((await fs.readdir(f.worlds)).sort(), [f.target.displayName, f.keep.displayName].sort());
    const inspected = await f.local().inspect({ leaseRef: lease.leaseRef, connectionRef: f.target.connectionRef,
      requesterRef: 'fixture-native-owner' });
    assert.equal(inspected.current, true, 'rejection cannot consume or stop the target lease');
    f.sequence(['ListWorldSelections', 'ReserveWorldRetirement', 'ReleaseWorldRetirement'], 'ABORTED');
    assert.deepEqual((await f.descriptor()).source, d.source);
  });

test('scoped delete keeps a world selected by a live Canvas session without acquiring retirement', async t => {
  const f = await deletionFixture(t), d = await f.descriptor(); f.retirement.sessionRefs = ['session:live-target'];
  const q = f.request(d.source);
  await f.audit(async () => f.refusal(q, await f.entry('callScoped')(q)));
  f.sequence(['ListWorldSelections']); assert.deepEqual((await f.descriptor()).source, d.source);
});

test('deletion fixture retains the direct deleteWorld ABI and executes actual filesystem safety/removal', async t => {
  const f = await deletionFixture(t), q = ask(f.payload), before = await files(f.root), actions = [...f.actions];
  const r = envelope(q, await f.local().deleteWorld(q));
  validateBoundResponse(WIRE, 'deleteWorld', q, r);
  assert.equal(r.error, null); assert.deepEqual(r.result, { ...f.payload, deleted: true });
  await f.isolatedRemoval(before); assert.deepEqual(f.actions, actions);
  f.sequence(['ListWorldSelections', 'ReserveWorldRetirement', 'ReleaseWorldRetirement'], 'RETIRED');
});

const payloads = { discover: f => ({ worldRoot: f.worlds }),
  createWorld: () => ({ templateId: 'flat', displayName: 'Must not create' }),
  pair: () => ({ worldRef: 'world:unknown' }),
  deleteWorld: () => ({ worldRef: 'world:unknown', confirmationName: 'Must not delete' }),
  describeSourceWorld: () => ({ worldRef: 'world:unknown' }) };
for (const [operation, payload] of Object.entries(payloads)) {
  for (const mode of ['cross-source', 'expired-instance', 'extra-envelope', 'extra-source', 'extra-payload', 'bad-version', 'missing-payload'])
    test(`${operation}: ${mode} returns correlated refusal before all world actions`, async t => {
      const f = await setup(t), d = await f.descriptor(), q = scoped(d.source, operation, payload(f));
      let code = 'CURRENT_WORLD_MISMATCH', reason = 'REQUIRED_FACT_UNKNOWN';
      if (mode === 'cross-source') q.source.sourceRef += ':other';
      if (mode === 'expired-instance') q.source.instanceRef += ':expired';
      if (mode.startsWith('extra-')) { code = 'UNKNOWN_REQUIRED_FIELD'; reason = 'INVALID_SHAPE';
        (mode === 'extra-envelope' ? q : mode === 'extra-source' ? q.source : q.payload).unexpected = true; }
      if (mode === 'bad-version') { q.contractVersion = 'local-worlds/v3'; code = 'PAYLOAD_VERSION_MISMATCH'; reason = 'VERSION_UNSUPPORTED'; }
      if (mode === 'missing-payload') { delete q.payload; code = 'SCHEMA_INVALID'; reason = 'INVALID_SHAPE'; }
      await f.audit(async () => denied(q, await f.entry('callScoped')(q), code, reason));
    });
}

test('unknown operation and uncorrelatable request refuse without invented request identity', async t => {
  const f = await setup(t), d = await f.descriptor(), call = f.entry('callScoped');
  const q = scoped(d.source, 'not-an-operation', {});
  await f.audit(async () => denied(q, await call(q), 'SCHEMA_INVALID', 'INVALID_SHAPE'));
  const bad = scoped(d.source, 'discover', d.discoveryInput); delete bad.requestId;
  await f.audit(() => assert.rejects(call(bad), e => {
    validateType('Error', e.publicError); assert.equal(e.publicError.code, 'SCHEMA_INVALID');
    assert.equal(e.publicError.mutationState, 'NONE'); return true;
  }));
});

test('unknown world and template return operation errors without creating substitutes', async t => {
  const f = await setup(t), d = await f.descriptor(), call = f.entry('callScoped');
  for (const [op, payload, code] of [
    ['pair', { worldRef: 'world:unknown' }, 'CONNECTION_NOT_FOUND'],
    ['describeSourceWorld', { worldRef: 'world:unknown' }, 'WORLD_NOT_FOUND'],
    ['createWorld', { templateId: 'unknown', displayName: 'No substitute' }, 'ADAPTER_UNAVAILABLE'],
  ]) {
    const q = scoped(d.source, op, payload);
    await f.audit(async () => denied(q, await call(q), code));
  }
});

test('unconfigured/ambiguous creation root refuses the descriptor instead of choosing a root', async t => {
  const f = await setup(t, { localWorldRoots: [], localCreationRoot: undefined });
  const q = ask(); await f.audit(async () => denied(q, await f.entry('getRuntimeSource')(q), 'ADAPTER_UNAVAILABLE'));
  await fs.mkdir(join(f.user, 'other-worlds'));
  await f.local().setRoots({ roots: [f.worlds, join(f.user, 'other-worlds')] });
  await f.audit(async () => denied(q, await f.entry('getRuntimeSource')(q), 'ADAPTER_UNAVAILABLE'));
});

for (const name of ['getRuntimeSource', 'callScoped'])
  test(`${name}: cross-root and copied receiver cannot borrow a current registration`, async t => {
    const f = await setup(t), d = await f.descriptor(), foreign = new Context();
    const port = f.local(), real = original(port), fn = port[name];
    const q = name === 'getRuntimeSource' ? ask() : scoped(d.source, 'discover', d.discoveryInput);
    foreign.provide('hanaworldsLocalWorlds', real);
    try {
      const foreignPort = foreign.get('hanaworldsLocalWorlds');
      await f.audit(async () => denied(q, await foreignPort[name](q), 'CURRENT_WORLD_MISMATCH'));
      for (const receiver of [{}, { ...real }, { ctx: f.consumer, [symbols.original]: real }])
        await f.audit(async () => denied(q, await fn.call(receiver, q), 'CURRENT_WORLD_MISMATCH'));
    } finally { await foreign.fiber.dispose(); }
  });

test('captured source methods reject a same-name replacement; closed instance remains unavailable', async t => {
  const f = await setup(t), d = await f.descriptor(), call = f.entry('callScoped');
  const q = scoped(d.source, 'createWorld', payloads.createWorld(f));
  replace(f.owner, 'hanaworldsLocalWorlds', { callScoped() { throw Error('DO_NOT_REDISPATCH'); } });
  await f.audit(async () => denied(q, await call(q), 'CURRENT_WORLD_MISMATCH'));
  await f.adapter.close();
  await f.audit(async () => denied(q, await call(q), 'ADAPTER_UNAVAILABLE'));
});

test('setRoots and physical root replacement expire the descriptor even with an unchanged path', async t => {
  const f = await setup(t), d = await f.descriptor(), call = f.entry('callScoped');
  const q = scoped(d.source, 'createWorld', payloads.createWorld(f));
  await fs.rename(f.worlds, join(f.user, 'old-worlds')); await fs.mkdir(f.worlds);
  await f.audit(async () => denied(q, await call(q), 'CURRENT_WORLD_MISMATCH'));
  const current = await f.descriptor(); assert.notEqual(current.source.instanceRef, d.source.instanceRef);
  await f.local().setRoots({ roots: [f.worlds] });
  const afterSet = await f.descriptor(); assert.notEqual(afterSet.source.instanceRef, current.source.instanceRef);
  const oldQ = scoped(current.source, 'discover', current.discoveryInput);
  await f.audit(async () => denied(oldQ, await call(oldQ), 'CURRENT_WORLD_MISMATCH'));
});

test('registration changed while real root stat is pending rejects before creating any files', async t => {
  const f = await setup(t), d = await f.descriptor(), call = f.entry('callScoped');
  const q = scoped(d.source, 'createWorld', payloads.createWorld(f)), before = await files(f.root), actions = [...f.actions];
  let enter, release, intercepted = false;
  const entered = new Promise(r => { enter = r; }), gate = new Promise(r => { release = r; });
  const lstat = fs.lstat;
  const patched = t.mock.method(fs, 'lstat', async (path, ...args) => {
    if (path === f.worlds && !intercepted) { intercepted = true; enter(); await gate; }
    return lstat(path, ...args);
  }); syncBuiltinESMExports();
  try {
    const pending = call(q);
    await Promise.race([entered, pending.then(() => assert.fail('scoped create must check actual current root identity'))]);
    replace(f.owner, 'hanaworldsLocalWorlds', {}); release();
    denied(q, await pending, 'CURRENT_WORLD_MISMATCH'); assert.equal(intercepted, true);
  } finally { release(); patched.mock.restore(); syncBuiltinESMExports(); }
  assert.deepEqual(await files(f.root), before); assert.deepEqual(f.actions, actions);
});

test('same configured source reload preserves namespace but revokes instance', async t => {
  const f = await setup(t), first = await f.descriptor();
  await f.adapter.close(); await f.owner.fiber.dispose();
  let current;
  const fiber = f.ctx.plugin({ name: 'reloaded-source', inject, apply(c) {
    current = apply(c, { localUserPath: f.user, localWorldRoots: [f.worlds], localCreationRoot: f.worlds, localGameId: 'flatgame' });
  } }); await fiber.await();
  try {
    const next = await f.descriptor();
    assert.equal(next.source.sourceRef, first.source.sourceRef);
    assert.notEqual(next.source.instanceRef, first.source.instanceRef);
    const q = scoped(first.source, 'discover', first.discoveryInput);
    await f.audit(async () => denied(q, await f.entry('callScoped')(q), 'CURRENT_WORLD_MISMATCH'));
  } finally { await current.close(); await fiber.dispose(); }
});

test('scoped pair reads the public runtime and returns its exact world/connection/incarnation and native capabilities', async t => {
  const f = await setup(t), prepared = await f.prepare(), d = await f.descriptor();
  const q = scoped(d.source, 'pair', { worldRef: prepared.selected.worldRef,
    connectionRef: 'runtime:connection:1', connectionIncarnationRef: f.native.connectionIncarnationRef });
  const r = envelope(q, await f.entry('callScoped')(q)); assert.equal(r.error, null);
  assert.deepEqual([r.result.worldRef, r.result.connectionRef, r.result.connectionIncarnationRef],
    [q.payload.worldRef, q.payload.connectionRef, q.payload.connectionIncarnationRef]);
  assert.equal(r.result.capabilities.worldRef, r.result.worldRef);
  assert.deepEqual(r.result.capabilities.worldGeometry.geometryProfiles, ['voxel-grid/v1']);
  assert.deepEqual(r.result.capabilities.worldGeometry.partition.edge, [16, 16, 16]);
  assert.match(r.result.payloadDigest, /^[0-9a-f]{64}$/);
  assert.ok(f.runtimeReads.length > 0); assert.ok(f.runtimeReads.every(x => x.connectionRef === q.payload.connectionRef));
  assert.deepEqual(f.actions, ['native-acquire'], 'pair cannot start/stop/install or acquire another world');
  const readQ = { contractVersion: 'world-adapter/v8', requestId: 'check-pair', sessionRef: 'fixture-session', connectionRef: r.result.connectionRef };
  const read = await f.audit(() => f.consumer.get('hanaworldsWorldAdapterV6').call('ReadLocalConnection', readQ));
  validateBoundResponse('world-adapter/v8', 'ReadLocalConnection', readQ, read);
  assert.equal(read.error, null); assert.deepEqual(plain(read.result), r.result);
});

for (const [label, change] of [['stopped', { state: 'STOPPED' }], ['cross-world', { worldRef: 'other' }],
  ['wrong-connection', { connectionRef: 'other' }], ['stale-incarnation', { connectionIncarnationRef: 'old' }]])
  test(`scoped pair: ${label} public status cannot consume the native lease`, async t => {
    const f = await setup(t), p = await f.prepare(), d = await f.descriptor(); f.statusChange(change);
    const q = scoped(d.source, 'pair', { worldRef: p.selected.worldRef,
      connectionRef: 'runtime:connection:1', connectionIncarnationRef: f.native.connectionIncarnationRef });
    await f.audit(async () => denied(q, await f.entry('callScoped')(q), 'CONNECTION_NOT_FOUND'));
    const inspected = await f.local().inspect({ leaseRef: p.lease.leaseRef, requesterRef: 'fixture-native-owner', connectionRef: p.selected.connectionRef });
    assert.equal(inspected.current, true); assert.equal(f.nativeReads.includes('handshake'), false);
  });

for (const payload of [{ worldRef: 'W', connectionRef: 'C' }, { worldRef: 'W', connectionIncarnationRef: 'I' },
  { worldRef: 'W', connectionRef: 7, connectionIncarnationRef: 'I' }])
  test(`scoped pair requires two valid runtime target references: ${JSON.stringify(payload)}`, async t => {
    const f = await setup(t), d = await f.descriptor(), q = scoped(d.source, 'pair', payload);
    await f.audit(async () => denied(q, await f.entry('callScoped')(q), 'SCHEMA_INVALID', 'INVALID_SHAPE'));
    assert.deepEqual(f.runtimeReads, []);
  });

test('source replacement while public status is pending denies before courier/binding', async t => {
  const f = await setup(t), p = await f.prepare(), d = await f.descriptor(), call = f.entry('callScoped');
  let changed = false;
  f.statusHook(() => { replace(f.owner, 'hanaworldsLocalWorlds', {}); changed = true; });
  const q = scoped(d.source, 'pair', { worldRef: p.selected.worldRef,
    connectionRef: 'runtime:connection:1', connectionIncarnationRef: f.native.connectionIncarnationRef });
  await f.audit(async () => denied(q, await call(q), 'CURRENT_WORLD_MISMATCH'));
  assert.equal(changed, true); assert.equal(f.nativeReads.includes('handshake'), false);
});

test('runtime provider replacement across ReadRuntimeStatus cannot grant a stale pairing', async t => {
  const f = await setup(t), p = await f.prepare(), d = await f.descriptor();
  let changed = false;
  f.statusHook(() => { replace(f.consumer, 'hanaworldsEngineRuntime', {}); changed = true; });
  const q = scoped(d.source, 'pair', { worldRef: p.selected.worldRef,
    connectionRef: 'runtime:connection:1', connectionIncarnationRef: f.native.connectionIncarnationRef });
  await f.audit(async () => denied(q, await f.entry('callScoped')(q), 'CURRENT_WORLD_MISMATCH'));
  assert.equal(changed, true); assert.equal(f.nativeReads.includes('handshake'), false);
});

// Explicit test-runner budget detects a call cycle; it is not a product timeout/retry.
test('ReadRuntimeStatus can reobserve its current source without a pair/read queue cycle', { timeout: 10000 }, async t => {
  const f = await setup(t), p = await f.prepare(), d = await f.descriptor();
  let observed = false;
  f.statusHook(async () => { assert.deepEqual((await f.descriptor()).source, d.source); observed = true; });
  const q = scoped(d.source, 'pair', { worldRef: p.selected.worldRef,
    connectionRef: 'runtime:connection:1', connectionIncarnationRef: f.native.connectionIncarnationRef });
  const r = envelope(q, await f.entry('callScoped')(q));
  assert.equal(observed, true); assert.equal(r.error, null);
});

test('payload byte tamper is rejected before public runtime calls or lease consumption', async t => {
  const f = await setup(t), p = await f.prepare(), d = await f.descriptor();
  await fs.appendFile(join(p.selected.worldPath, 'worldmods/hanaworlds_adapter/engine.lua'), '\n-- changed installed bytes\n');
  const q = scoped(d.source, 'pair', { worldRef: p.selected.worldRef,
    connectionRef: 'runtime:connection:1', connectionIncarnationRef: f.native.connectionIncarnationRef });
  await f.audit(async () => denied(q, await f.entry('callScoped')(q), 'PAYLOAD_VERSION_MISMATCH', 'VERSION_UNSUPPORTED'));
  assert.deepEqual(f.runtimeReads, []); assert.equal(f.nativeReads.includes('handshake'), false);
});

test('lost native currency after binding with unproven cleanup reports UNKNOWN without retrying pair/start', async t => {
  const f = await setup(t), p = await f.prepare(), d = await f.descriptor();
  t.mock.method(f.native, 'handshake', async () => { f.setLive(false); });
  t.mock.method(f.native, 'close', async () => { f.native.closed = true; throw Error('CLEANUP_UNPROVEN'); });
  const q = scoped(d.source, 'pair', { worldRef: p.selected.worldRef,
    connectionRef: 'runtime:connection:1', connectionIncarnationRef: f.native.connectionIncarnationRef });
  const r = envelope(q, await f.entry('callScoped')(q));
  assert.equal(r.result, null); assert.equal(r.error.code, 'CONNECTION_NOT_FOUND');
  assert.equal(r.error.mutationState, 'UNKNOWN', 'unproven binding cleanup cannot be advertised as NONE');
  assert.ok(!f.actions.includes('StartWorldRuntime') && !f.actions.includes('StopWorldRuntime'));
});

test('public connection check refuses an unknown connection without lifecycle or files changing', async t => {
  const f = await setup(t), q = { contractVersion: 'world-adapter/v8', requestId: 'check-unknown', sessionRef: 'fixture-session', connectionRef: 'unknown' };
  const r = await f.audit(() => f.consumer.get('hanaworldsWorldAdapterV6').call('ReadLocalConnection', q));
  validateBoundResponse('world-adapter/v8', 'ReadLocalConnection', q, r);
  assert.equal(r.error.code, 'CONNECTION_NOT_FOUND'); assert.equal(r.error.mutationState, 'NONE');
});

test('neutral scoped inspection returns the requested positions and native opaque state with no extra actions', async t => {
  const f = await setup(t), p = await f.prepare({ pair: true });
  const positions = [[-2, 9, 0], [0, 9, 3], [4, 9, -1]];
  const out = await f.audit(() => f.canvas.get('hanaworldsWorldFacts').readScopedState(p.selected.connectionRef, positions));
  assert.equal(out.worldRef, p.selected.worldRef); assert.deepEqual(plain(out.cells.map(c => c.position)), positions);
  validateType('ScopedStateFacts', out);
  // Independent digest expectation uses this native fixture's translation table.
  const materialRef = 'material:' + createHash('sha256').update(canonicalJSON({ name: 'air', bytes: Array.from({ length: 256 }, (_, i) => i) })).digest('hex');
  for (const cell of out.cells) {
    const record = { geometryProfile: 'voxel-grid/v1', position: plain(cell.position), materialRef, orientation: 0,
      state: { metadata: { owner: 'opaque-test-owner' } } };
    const expected = createHash('sha256').update('HanaWorlds|contracts@2.0.0|adapter-scoped-cell/v2\n')
      .update(canonicalJSON({ profile: plain(out.stateProfile), record })).digest('hex');
    assert.equal(cell.availability, 'KNOWN'); assert.equal(cell.stateDigest, expected);
  }
});

const materialValues = JSON.parse(await fs.readFile(new URL('./fixtures/local-source-creation-materials.json', import.meta.url), 'utf8'));
for (const [index, value] of materialValues.entries())
  test(`configured creation material ${index} is advertised and independently preserved on disk`, async t => {
    const material = { templateId: `flat-json-${index}`, displayName: `JSON material ${index}`,
      description: 'Source-owned flat creation material', creationFacts: value };
    const f = await setup(t, { localSourceCreationMaterials: [material] }), d = await f.descriptor();
    assert.deepEqual(d.templates.find(x => x.templateId === material.templateId), {
      templateId: material.templateId, displayName: material.displayName, description: material.description });
    const q = scoped(d.source, 'createWorld', { templateId: material.templateId, displayName: 'Material world' });
    const r = envelope(q, await f.entry('callScoped')(q)); assert.equal(r.error, null);
    assert.equal(r.result.templateId, material.templateId); assert.deepEqual(r.result.creationFacts, value);
    assert.deepEqual(await fs.readdir(f.worlds), ['Material world'], 'one creation, no extra worlds or stages');
    const disk = JSON.parse(await fs.readFile(join(f.worlds, 'Material world', 'hanaworlds-creation-facts.json'), 'utf8'));
    assert.deepEqual(disk, value); assert.equal(Object.prototype.polluted, undefined);
    const describeQ = scoped(d.source, 'describeSourceWorld', { worldRef: r.result.worldRef });
    const description = await f.audit(() => f.entry('callScoped')(describeQ));
    assert.equal(description.error, null); assert.equal(description.result.sourceStartupFacts.availability, 'KNOWN');
    assert.deepEqual(description.result.sourceStartupFacts.runtimeSettings.trustedMods, []);
    assert.deepEqual(f.actions, [], 'creationFacts never grants lifecycle or session actions');
  });

test('original read failure remains the exact cause with its safe logical source and zero mutation', async t => {
  const f = await setup(t), p = await f.prepare({ pair: true });
  const cause = Object.assign(Error('TARGET_FACTS_INCOMPLETE'), { code: 'TARGET_FACTS_INCOMPLETE',
    source: { owner: 'world-source', operation: 'read-state', resource: 'native-state', kind: 'IO', nativeCode: 'EIO' } });
  f.snapshotError(cause);
  await f.audit(() => assert.rejects(f.canvas.get('hanaworldsWorldFacts').readScopedState(p.selected.connectionRef, [[0, 9, 0]]), e => {
    validateType('Error', e.publicError); assert.equal(e.publicError.code, 'TARGET_FACTS_INCOMPLETE');
    assert.equal(e.publicError.mutationState, 'NONE'); assert.deepEqual(plain(e.publicError.source), cause.source);
    assert.ok(e === cause || e.cause === cause, 'original failure identity must be retained, not only its message/code'); return true;
  }));
});

test('scoped inspection rejects inactive native world and changed Canvas provider during read', async t => {
  const f = await setup(t), p = await f.prepare({ pair: true });
  const read = f.canvas.get('hanaworldsWorldFacts').readScopedState;
  let changed = false;
  f.snapshotHook(() => { replace(f.canvas, 'hanaworldsCanvasV5', { call() {} }); changed = true; });
  await f.audit(() => assert.rejects(read(p.selected.connectionRef, [[0, 9, 0]]), e => {
    assert.equal(e.publicError.code, 'CAPABILITY_UNAVAILABLE'); assert.equal(e.publicError.mutationState, 'NONE'); return true;
  }));
  assert.equal(changed, true);
  f.setLive(false);
  const q = { contractVersion: 'world-adapter/v8', requestId: 'check-inactive', sessionRef: 'S', connectionRef: p.selected.connectionRef };
  const r = await f.audit(() => f.consumer.get('hanaworldsWorldAdapterV6').call('ReadLocalConnection', q));
  assert.equal(r.error.code, 'CONNECTION_NOT_FOUND'); assert.equal(r.error.mutationState, 'NONE');
});
