// SOURCE/FIXTURE: real Adapter/guards/deletion + actual filesystem and Cordis.
// Only peer services and the timing of real filesystem observations are fixtures.
import test from 'node:test';
import assert from 'node:assert/strict';
import builtinFS from 'node:fs';
import { promises as fs } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { createHash } from 'node:crypto';
import { join, basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Context } from '@deepseek-ai/cordis';
import { observeNodeRenames } from './support/local-source-node-observer.mjs';

// The same public suite runs against source and a normally installed own package.
const ADAPTER_ROOT = process.env.SOURCE_RACE_ADAPTER_ROOT ?? fileURLToPath(new URL('../src/', import.meta.url));
const adapterModule = name => import(pathToFileURL(join(ADAPTER_ROOT, name)).href);
const { apply, inject } = await adapterModule('index.mjs');
const { withSourceScope, bindSourceWorld } = await adapterModule('source-scope.mjs');
const { removeWorldDirectory } = await adapterModule('local-world-deletion.mjs');

const RUN = process.env.SOURCE_RACE_RUN ?? fileURLToPath(new URL('../../', import.meta.url));
const WIRE = 'local-worlds/v2';
const request = (requestId, extra = {}) => ({ contractVersion: WIRE, requestId, ...extra });
const id = stat => [String(stat.dev), String(stat.ino)];
async function snapshot(path) {
  const entries = {};
  async function walk(p, rel) {
    const stat = await fs.lstat(p, { bigint: true });
    entries[rel] = { identity: id(stat), mode: String(stat.mode),
      digest: stat.isFile() ? createHash('sha256').update(await fs.readFile(p)).digest('hex') : null };
    if (stat.isDirectory()) for (const name of (await fs.readdir(p)).sort()) await walk(join(p, name), rel ? `${rel}/${name}` : name);
  }
  await walk(path, ''); return entries;
}
async function fixture(t, publicPort = false) {
  const base = join(RUN, 'tmp', 'source-deletion-race');
  await fs.mkdir(base, { recursive: true });
  const root = await fs.realpath(await fs.mkdtemp(join(base, 'case-')));
  const user = join(root, 'user'), worlds = join(user, 'worlds');
  await fs.mkdir(worlds, { recursive: true });
  const receipt = { level: publicPort ? 'PUBLIC_SCOPED_SOURCE_FIXTURE' : 'PRODUCTION_HELPER', root };
  const f = { root, user, worlds, receipt };
  t.after(async () => {
    receipt.finalTree = await snapshot(worlds);
    await fs.writeFile(join(base, `${t.name.replace(/[^a-zA-Z0-9]+/g, '-')}-${basename(root)}.json`), JSON.stringify(receipt, null, 2));
    await f.adapter?.close(); await f.ctx?.fiber.dispose();
    // The program owns cleanup. Keep the actual directory identities and bytes.
  });
  if (publicPort) {
    await fs.mkdir(join(user, 'games/fixture'), { recursive: true });
    await fs.writeFile(join(user, 'games/fixture/game.conf'), 'title = Race fixture\n');
    const ctx = f.ctx = new Context();
    ctx.provide('webServer', { register: () => () => {} });
    ctx.provide('dshHomePath', (...p) => join(root, 'home', ...p));
    const nativeActions = f.nativeActions = [];
    ctx.provide('hanaworldsNativeEngineControl', {
      acquire() { nativeActions.push('acquire'); throw Error('UNEXPECTED_NATIVE_ACTION'); },
      inspect() { nativeActions.push('inspect'); throw Error('UNEXPECTED_NATIVE_ACTION'); },
      withStoppedWorld() { nativeActions.push('stop'); throw Error('UNEXPECTED_NATIVE_ACTION'); },
    });
    const actions = f.actions = [];
    const peer = ctx.plugin({ name: 'race-canvas-peer', apply(c) {
      c.provide('hanaworldsCanvasV5', { async call(name, q) {
        actions.push({ name, request: { ...q } });
        let result;
        if (name === 'ListWorldSelections') result = { worldRef: q.worldRef, inventoryRevision: `i:1:${q.worldRef}`, sessionRefs: [], retirementReservationRef: null };
        else if (name === 'ReserveWorldRetirement') result = { worldRef: q.worldRef, reservationRef: `r:${q.worldRef}:${q.requestId}`, inventoryRevision: q.expectedInventoryRevision };
        else if (name === 'ReleaseWorldRetirement') result = { worldRef: q.worldRef, reservationRef: q.reservationRef, outcome: q.outcome, inventoryRevision: `i:2:${q.worldRef}` };
        else assert.fail(`Unexpected peer operation ${name}`);
        return { contractVersion: q.contractVersion, requestId: q.requestId, result, error: null };
      } });
    } }); await peer.await();
    const adapter = ctx.plugin({ name: 'actual-adapter-race', inject, apply(c) {
      f.owner = c;
      f.adapter = apply(c, { localUserPath: user, localWorldRoots: [worlds], localCreationRoot: worlds, localGameId: 'fixture' });
    } }); await adapter.await();
    const consumer = ctx.plugin({ name: 'race-consumer', apply(c) { f.consumer = c; } }); await consumer.await();
    f.port = () => f.consumer.get('hanaworldsLocalWorlds');
    f.descriptor = async () => { const r = await f.port().getRuntimeSource(request('descriptor')); assert.equal(r.error, null); return r.result; };
    f.create = async displayName => { const r = await f.port().createWorld(request(`create:${displayName}`, { templateId: 'flat', displayName }));
      assert.equal(r.error, null); return (await f.port().discover()).find(w => w.worldRef === r.result.worldRef); };
    f.target = await f.create('Target'); f.neighbour = await f.create('Neighbour');
  } else {
    const worldPath = join(worlds, 'Target'); await fs.mkdir(worldPath);
    await fs.writeFile(join(worldPath, 'world.mt'), 'gameid = fixture\n');
    await fs.writeFile(join(worldPath, 'original.txt'), 'original');
    const stat = await fs.lstat(worldPath);
    f.target = { worldPath, device: stat.dev, inode: stat.ino };
    f.neighbour = { worldPath: join(worlds, 'Neighbour') }; await fs.mkdir(f.neighbour.worldPath);
    await fs.writeFile(join(f.neighbour.worldPath, 'keep.txt'), 'keep');
  }
  receipt.before = { target: await snapshot(f.target.worldPath), neighbour: await snapshot(f.neighbour.worldPath) };
  return f;
}
async function swapTarget(f) {
  f.saved = join(f.worlds, 'Saved-original');
  await fs.rename(f.target.worldPath, f.saved);
  await fs.mkdir(f.target.worldPath); await fs.writeFile(join(f.target.worldPath, 'replacement.txt'), 'replacement');
  f.replacement = await snapshot(f.target.worldPath);
}
async function preserved(f, swapped = false) {
  assert.deepEqual(await snapshot(f.neighbour.worldPath), f.receipt.before.neighbour);
  assert.deepEqual(await snapshot(f.target.worldPath), swapped ? f.replacement : f.receipt.before.target);
  if (swapped) assert.deepEqual(await snapshot(f.saved), f.receipt.before.target);
  assert.deepEqual((await fs.readdir(f.worlds)).filter(n => n.startsWith('.hanaworlds-deleting-')), []);
}
// Timing observer only: the original Node built-in performs the real move.
// The synchronous callback never yields between that move and its timing actor.
// Actors mutate actual files or registration; production deletion is untouched.
async function observeRename(t, f, after) {
  return observeNodeRenames(t, event => {
    const from = String(event.from), to = String(event.to);
    if (from === f.target.worldPath && basename(to).startsWith('.hanaworlds-deleting-')) {
      f.receipt.renameReached = true;
      f.receipt.renameAPI = event.api;
      after(to, event.result);
    }
  });
}
function synchronousSnapshot(path) {
  const entries = {};
  function walk(p, rel) {
    const stat = builtinFS.lstatSync(p, { bigint: true });
    entries[rel] = { identity: id(stat), mode: String(stat.mode),
      digest: stat.isFile() ? createHash('sha256').update(builtinFS.readFileSync(p)).digest('hex') : null };
    if (stat.isDirectory()) for (const name of builtinFS.readdirSync(p).sort()) walk(join(p, name), rel ? `${rel}/${name}` : name);
  }
  walk(path, ''); return entries;
}

test('public scoped safe deletion executes real Node movement and preserves source generation', async t => {
  const f = await fixture(t, true), d = await f.descriptor();
  const restore = await observeRename(t, f, () => {});
  let out;
  try { out = await f.port().callScoped(request('node:delete-success', { source: d.source, operation: 'deleteWorld',
    payload: { worldRef: f.target.worldRef, confirmationName: 'Target' } })); }
  finally { restore(); }
  assert.equal(f.receipt.renameReached, true, 'normal public deletion must execute the genuine Node movement');
  assert.equal(out.error, null); assert.deepEqual(out.result,
    { worldRef: f.target.worldRef, confirmationName: 'Target', deleted: true });
  assert.equal(await fs.lstat(f.target.worldPath).catch(e => { if (e.code === 'ENOENT') return null; throw e; }), null);
  assert.deepEqual(await snapshot(f.neighbour.worldPath), f.receipt.before.neighbour);
  assert.deepEqual((await fs.readdir(f.worlds)).sort(), ['Neighbour']);
  assert.equal((await f.port().discover()).some(w => w.worldRef === f.target.worldRef), false);
  assert.deepEqual((await f.descriptor()).source, d.source); assert.deepEqual(f.nativeActions, []);
  assert.equal(f.actions.at(-1).request.outcome, 'RETIRED');
  f.receipt.response = out; f.receipt.actions = f.actions;
});

test('helper rejects replacement during final await without hiding either directory', async t => {
  const f = await fixture(t); let checks = 0;
  await assert.rejects(withSourceScope(async () => { if (++checks === 2) await swapTarget(f); }, async () => {
    bindSourceWorld(f.target); await removeWorldDirectory(f.target);
  }), e => e.message === 'CURRENT_WORLD_MISMATCH');
  assert.equal(checks >= 2, true); await preserved(f, true);
});

test('helper recovers exact moved directory when post-rename guard rejects', async t => {
  const f = await fixture(t), original = new Error('CURRENT_WORLD_MISMATCH'); let revoked = false;
  const restore = await observeRename(t, f, () => { revoked = true; });
  try {
    await assert.rejects(withSourceScope(async () => { if (revoked) throw original; }, async () => {
      bindSourceWorld(f.target); await removeWorldDirectory(f.target);
    }), e => { assert.equal(e, original); assert.equal(e.mutationState, 'UNKNOWN'); return true; });
  } finally { restore(); }
  assert.equal(f.receipt.renameReached, true); await preserved(f);
});

test('helper recovers rename completion even when the primitive rejects after moving', async t => {
  const f = await fixture(t), cause = Object.assign(new Error('ORIGINAL_IO_CAUSE'), { code: 'EIO' });
  const original = Object.assign(new Error('EIO', { cause }), { code: 'EIO' });
  const restore = await observeRename(t, f, () => { throw original; });
  try {
    await assert.rejects(withSourceScope(async () => {}, async () => {
      bindSourceWorld(f.target); await removeWorldDirectory(f.target);
    }), e => { assert.equal(e, original); assert.equal(e.mutationState, 'UNKNOWN'); return true; });
  } finally { restore(); }
  assert.equal(f.receipt.renameReached, true); assert.equal(original.cause, cause);
  assert.equal(original.code, 'EIO'); assert.equal(original.message, 'EIO'); await preserved(f);
});

test('helper retains named residue instead of overwriting a newly occupied target', async t => {
  const f = await fixture(t), original = new Error('CURRENT_WORLD_MISMATCH'); let occupied, revoked = false;
  const restore = await observeRename(t, f, () => {
    builtinFS.mkdirSync(f.target.worldPath); builtinFS.writeFileSync(join(f.target.worldPath, 'new-owner.txt'), 'new owner');
    occupied = synchronousSnapshot(f.target.worldPath);
    revoked = true;
  });
  let failure;
  try { await withSourceScope(async () => { if (revoked) throw original; }, async () => { bindSourceWorld(f.target); await removeWorldDirectory(f.target); }); }
  catch (e) { failure = e; } finally { restore(); }
  assert.equal(f.receipt.renameReached, true);
  assert.ok(failure, 'post-rename occupancy must refuse removal');
  assert.equal(failure, original, 'recovery diagnostics retain the original guard error');
  assert.equal(failure.mutationState, 'UNKNOWN');
  assert.equal(typeof failure.details?.residuePath, 'string');
  assert.equal(failure.details.recoveryReason, 'TARGET_OCCUPIED');
  assert.deepEqual(await snapshot(failure.details.residuePath), f.receipt.before.target);
  assert.deepEqual(await snapshot(f.target.worldPath), occupied);
  assert.deepEqual(await snapshot(f.neighbour.worldPath), f.receipt.before.neighbour);
});

test('helper recovery preserves an empty occupant discovered after its last awaited destination observation', async t => {
  const f = await fixture(t), original = new Error('CURRENT_WORLD_MISMATCH'); let revoked = false, occupiedIdentity;
  const restore = await observeRename(t, f, () => { revoked = true; });
  const realStat = fs.lstat;
  // Ordinary JS await currency: after recovery awaits the actual missing target
  // observation, an actor creates an empty directory before the continuation.
  // Recovery must recheck synchronously before Node rename and preserve the
  // observed occupant. This deliberately makes no claim about a malicious
  // same-account actor changing a path inside a synchronous kernel call.
  const hook = t.mock.method(fs, 'lstat', async (...args) => {
    const stack = new Error().stack;
    try { return await realStat(...args); }
    catch (error) {
      if (revoked && !occupiedIdentity && args[0] === f.target.worldPath &&
          error.code === 'ENOENT' && stack.includes('removeWorldDirectory')) {
        builtinFS.mkdirSync(f.target.worldPath);
        occupiedIdentity = id(builtinFS.lstatSync(f.target.worldPath, { bigint: true }));
        f.receipt.compensationOccupantIdentity = occupiedIdentity;
        f.receipt.occupancyTiming = 'AFTER_AWAITED_MISSING_DESTINATION_BEFORE_RECOVERY_CONTINUATION';
      }
      throw error;
    }
  }); syncBuiltinESMExports();
  let failure;
  try { await withSourceScope(async () => { if (revoked) throw original; }, async () => {
    bindSourceWorld(f.target); await removeWorldDirectory(f.target);
  }); } catch (e) { failure = e; }
  finally { hook.mock.restore(); restore(); syncBuiltinESMExports(); }
  f.receipt.refusal = { message: failure?.message, mutationState: failure?.mutationState, details: failure?.details };
  assert.equal(f.receipt.renameReached, true);
  assert.equal(failure, original);
  assert.ok(occupiedIdentity, 'actual recovery must await the destination observation before it checks and moves');
  assert.deepEqual(id(await fs.lstat(f.target.worldPath, { bigint: true })), occupiedIdentity,
    'the observed empty occupant must not be replaced by recovery');
  assert.equal(failure.mutationState, 'UNKNOWN');
  assert.equal(typeof failure.details?.residuePath, 'string');
  assert.equal(failure.details.recoveryReason, 'TARGET_OCCUPIED');
  assert.deepEqual(await snapshot(failure.details.residuePath), f.receipt.before.target);
  assert.deepEqual(await snapshot(f.neighbour.worldPath), f.receipt.before.neighbour);
});

test('public scoped deletion rejects last-await replacement and preserves discovery and neighbours', async t => {
  const f = await fixture(t, true), d = await f.descriptor();
  const realStat = fs.lstat, realPath = fs.realpath; let armed = false, switched = false;
  const statHook = t.mock.method(fs, 'lstat', async (...args) => {
    const stack = new Error().stack;
    const result = await realStat(...args);
    if (args[0] === f.target.worldPath && args[1]?.bigint && stack.includes('sourceWrite') && stack.includes('removeWorldDirectory')) armed = true;
    return result;
  });
  const pathHook = t.mock.method(fs, 'realpath', async (...args) => {
    const result = await realPath(...args);
    if (armed && !switched && args[0] === f.user) { switched = true; await swapTarget(f); }
    return result;
  }); syncBuiltinESMExports();
  let r;
  try { r = await f.port().callScoped(request('race:delete', { source: d.source, operation: 'deleteWorld',
    payload: { worldRef: f.target.worldRef, confirmationName: 'Target' } })); }
  finally { statHook.mock.restore(); pathHook.mock.restore(); syncBuiltinESMExports(); }
  assert.equal(switched, true, 'replacement reached the last awaited root observation before the production rename');
  f.receipt.response = r; f.receipt.actions = f.actions; f.receipt.nativeActions = f.nativeActions;
  assert.equal(r.result, null); assert.equal(r.error.code, 'CURRENT_WORLD_MISMATCH');
  await preserved(f, true);
  assert.equal((await f.port().discover()).some(w => w.worldRef === f.target.worldRef && w.worldPath === f.saved), true);
  assert.deepEqual((await f.descriptor()).source, d.source);
  assert.deepEqual(f.nativeActions, []);
  assert.equal(f.actions.at(-1).request.outcome, 'ABORTED');
});

test('public scoped deletion recovers after rename and a revoked source registration', async t => {
  const f = await fixture(t, true), d = await f.descriptor(), old = f.port();
  const restore = await observeRename(t, f, () => { f.owner.set('hanaworldsLocalWorlds', {}); });
  let r;
  try { r = await old.callScoped(request('race:revoked', { source: d.source, operation: 'deleteWorld',
    payload: { worldRef: f.target.worldRef, confirmationName: 'Target' } })); }
  finally { restore(); }
  f.receipt.response = r; f.receipt.actions = f.actions;
  assert.equal(f.receipt.renameReached, true); assert.equal(r.result, null);
  assert.equal(r.error.code, 'CURRENT_WORLD_MISMATCH'); assert.equal(r.error.mutationState, 'UNKNOWN');
  await preserved(f); assert.deepEqual(f.nativeActions, []);
  assert.equal(f.actions.at(-1).request.outcome, 'ABORTED');
});


// Both calls enter through the real publicly tracked service before either is
// awaited. The Canvas fixture associates receipts with each request/world and
// supplies no lock/queue or per-world exclusion; exclusion belongs to Adapter.
for (const relationship of ['same-world', 'different-worlds']) test(`concurrent public scoped deletion preserves ${relationship} ownership`, async t => {
  const f = await fixture(t, true), d = await f.descriptor();
  const second = relationship === 'same-world' ? f.target : await f.create('Third');
  const payload = world => ({ worldRef: world.worldRef, confirmationName: basename(world.worldPath) });
  const firstCall = f.port().callScoped(request(`concurrent:${relationship}:first`, {
    source: d.source, operation: 'deleteWorld', payload: payload(f.target) }));
  const secondCall = f.port().callScoped(request(`concurrent:${relationship}:second`, {
    source: d.source, operation: 'deleteWorld', payload: payload(second) }));
  const outcomes = await Promise.all([firstCall, secondCall]);
  f.receipt.responses = outcomes; f.receipt.actions = f.actions; f.receipt.nativeActions = f.nativeActions;
  for (let i = 0; i < outcomes.length; i++) {
    const out = outcomes[i], world = i === 0 ? f.target : second;
    assert.deepEqual(Object.keys(out).sort(), ['contractVersion', 'error', 'requestId', 'result']);
    assert.equal(out.contractVersion, WIRE);
    assert.equal(out.requestId, `concurrent:${relationship}:${i === 0 ? 'first' : 'second'}`);
    if (out.error === null) assert.deepEqual(out.result, {
      worldRef: world.worldRef, confirmationName: basename(world.worldPath), deleted: true });
    else {
      assert.equal(out.result, null);
      assert.deepEqual(Object.keys(out.error).sort(),
        ['causeCode', 'code', 'mutationState', 'phase', 'reason', 'retryability', 'transactionRef']);
      assert.equal(typeof out.error.code, 'string');
      assert.ok(out.error.code.length > 0, 'a competing deletion must return a named refusal');
    }
  }
  assert.equal(outcomes.filter(out => out.error === null).length, relationship === 'same-world' ? 1 : 2,
    'same-world calls cannot both report a deletion; separate worlds can both be deleted normally');
  for (const world of [f.target, second]) assert.equal(await fs.lstat(world.worldPath).catch(e => {
    if (e.code === 'ENOENT') return null; throw e;
  }), null);
  assert.deepEqual(await snapshot(f.neighbour.worldPath), f.receipt.before.neighbour);
  assert.deepEqual((await fs.readdir(f.worlds)).sort(), ['Neighbour']);
  assert.deepEqual((await f.descriptor()).source, d.source);
  assert.deepEqual(f.nativeActions, []);
  for (const worldRef of new Set([f.target.worldRef, second.worldRef])) {
    const releases = f.actions.filter(a => a.name === 'ReleaseWorldRetirement' && a.request.worldRef === worldRef);
    assert.equal(releases.filter(a => a.request.outcome === 'RETIRED').length, 1,
      'each actual world deletion produces one retirement receipt');
    assert.ok(releases.every(a => ['RETIRED', 'ABORTED'].includes(a.request.outcome)));
    assert.ok(releases.every(a => a.request.reservationRef.startsWith(`r:${worldRef}:`)));
  }
});
