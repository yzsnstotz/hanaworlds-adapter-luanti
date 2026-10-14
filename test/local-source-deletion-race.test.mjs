// SOURCE/FIXTURE: real Adapter/guards/deletion + actual filesystem and Cordis.
// Only peer services and the timing of real filesystem observations are fixtures.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as builtinFS from 'node:fs';
import { promises as fs } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { createHash } from 'node:crypto';
import { join, basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Context } from '@deepseek-ai/cordis';
import { observeCommitBoundary } from './support/commit-boundary-observer.mjs';

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
    await fs.writeFile(join(base, `${t.name.replace(/[^a-zA-Z0-9]+/g, '-')}.json`), JSON.stringify(receipt, null, 2));
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
        if (name === 'ListWorldSelections') result = { worldRef: q.worldRef, inventoryRevision: 'i:1', sessionRefs: [], retirementReservationRef: null };
        else if (name === 'ReserveWorldRetirement') result = { worldRef: q.worldRef, reservationRef: 'r:1', inventoryRevision: q.expectedInventoryRevision };
        else if (name === 'ReleaseWorldRetirement') result = { worldRef: q.worldRef, reservationRef: q.reservationRef, outcome: q.outcome, inventoryRevision: 'i:2' };
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
async function atomicBinding() {
  let module, failure;
  try { module = await adapterModule('source-atomic-native.mjs'); } catch (error) { failure = error; }
  assert.equal(typeof module?.loadAtomicNative, 'function',
    `ATOMIC_NATIVE_CAPABILITY_MISSING: deletion must use trusted OWN exclusive primitive (${failure?.code === 'ERR_MODULE_NOT_FOUND' ? 'own native is not shipped' : failure?.code ?? 'missing capability'})`);
  const binding = await module.loadAtomicNative();
  assert.equal(typeof binding.moveDirectoryNoReplace, 'function', 'actual OWN atomic native movement is required');
  return binding;
}
// Timing observer only: invoke the genuine loaded native primitive and inspect
// its actual filesystem result. No success, guard, custody or history is faked.
async function observeRename(t, f, after) {
  const binding = await atomicBinding(), real = binding.moveDirectoryNoReplace;
  const patched = t.mock.method(binding, 'moveDirectoryNoReplace', async function(handle, request) {
    const result = await real.call(this, handle, request);
    if (request.fromName === basename(f.target.worldPath) && request.toName.startsWith('.hanaworlds-deleting-')) {
      f.receipt.renameReached = true; await after(join(f.worlds, request.toName), result);
    }
    return result;
  });
  return () => { patched.mock.restore(); };
}

test('public scoped safe deletion actually uses OWN exclusive movement and preserves source generation', async t => {
  const f = await fixture(t, true), d = await f.descriptor();
  const restore = await observeRename(t, f, () => {});
  let out;
  try { out = await f.port().callScoped(request('atomic:delete-success', { source: d.source, operation: 'deleteWorld',
    payload: { worldRef: f.target.worldRef, confirmationName: 'Target' } })); }
  finally { restore(); }
  assert.equal(f.receipt.renameReached, true, 'normal public deletion must execute the genuine exclusive movement');
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
  const f = await fixture(t), original = Object.assign(new Error('EIO'), { code: 'EIO' });
  const restore = await observeRename(t, f, () => { throw original; });
  try {
    await assert.rejects(withSourceScope(async () => {}, async () => {
      bindSourceWorld(f.target); await removeWorldDirectory(f.target);
    }), e => { assert.equal(e, original); assert.equal(e.mutationState, 'UNKNOWN'); return true; });
  } finally { restore(); }
  assert.equal(f.receipt.renameReached, true); await preserved(f);
});

test('helper retains named residue instead of overwriting a newly occupied target', async t => {
  const f = await fixture(t), original = new Error('CURRENT_WORLD_MISMATCH'); let occupied, revoked = false;
  const restore = await observeRename(t, f, async () => {
    await fs.mkdir(f.target.worldPath); await fs.writeFile(join(f.target.worldPath, 'new-owner.txt'), 'new owner');
    occupied = await snapshot(f.target.worldPath);
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

test('helper recovery never overwrites an empty target occupied at its rename primitive', async t => {
  const f = await fixture(t), original = new Error('CURRENT_WORLD_MISMATCH'); let revoked = false, occupiedIdentity;
  const binding = await atomicBinding(), real = binding.moveDirectoryNoReplace;
  const occupy = () => {
    builtinFS.mkdirSync(f.target.worldPath);
    occupiedIdentity = id(builtinFS.lstatSync(f.target.worldPath, { bigint: true }));
    f.receipt.compensationOccupantIdentity = occupiedIdentity;
  };
  // The external actor occupies the destination at the actual exclusive native
  // primitive, after any preceding sample. Invoke the real syscall either way.
  const hook = t.mock.method(binding, 'moveDirectoryNoReplace', async function(handle, request) {
    if (request.toName === basename(f.target.worldPath)) occupy();
    const result = await real.call(this, handle, request);
    if (request.fromName === basename(f.target.worldPath) && request.toName.startsWith('.hanaworlds-deleting-')) revoked = true;
    return result;
  });
  let failure;
  try { await withSourceScope(async () => { if (revoked) throw original; }, async () => {
    bindSourceWorld(f.target); await removeWorldDirectory(f.target);
  }); } catch (e) { failure = e; }
  finally { hook.mock.restore(); }
  f.receipt.refusal = { message: failure?.message, mutationState: failure?.mutationState, details: failure?.details };
  assert.equal(failure, original);
  assert.ok(occupiedIdentity, 'the actual compensation rename must be reached');
  assert.deepEqual(id(await fs.lstat(f.target.worldPath, { bigint: true })), occupiedIdentity,
    'a newly occupied empty directory must not be replaced by recovery');
  assert.equal(failure.mutationState, 'UNKNOWN');
  assert.equal(typeof failure.details?.residuePath, 'string');
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

// D-154: an observer inside the genuine own primitive, after its final source
// and parent identity checks and before its real movement commit. These actors
// mutate real directories synchronously and return; they neither replace the
// syscall nor throw a fabricated refusal from the native observer.
function observeVerifiedEvent(f, event, fromName) {
  assert.equal(event.phase, 'AFTER_FINAL_IDENTITY_CHECK_BEFORE_COMMIT');
  assert.equal(event.fromName, fromName);
  assert.equal(typeof event.toName, 'string');
  const source = builtinFS.lstatSync(join(f.worlds, event.fromName), { bigint: true });
  const parent = builtinFS.lstatSync(f.worlds, { bigint: true });
  assert.deepEqual(event.verifiedDirectory, { device: String(source.dev), inode: String(source.ino) });
  assert.deepEqual(event.verifiedParent, { device: String(parent.dev), inode: String(parent.ino) });
  f.receipt.commitBoundary = { ...event };
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
function captureActor(f, run) {
  try { run(); f.receipt.actorCompleted = true; }
  catch (error) {
    // A real mandatory binding may deny the actor's attempt. Record the native
    // OS refusal, then still let the genuine original primitive continue.
    f.receipt.actorRefusal = { code: error.code, message: error.message };
    try {
      f.receipt.actorRefusalVerifiedSource = synchronousSnapshot(join(f.worlds, f.receipt.commitBoundary.fromName));
      f.receipt.actorRefusalTarget = synchronousSnapshot(f.target.worldPath);
      f.receipt.actorRefusalNeighbour = synchronousSnapshot(f.neighbour.worldPath);
    } catch (observation) { f.receipt.actorRefusalObservation = observation.code; }
  }
}
async function scopedDelete(f, source, requestId) {
  return f.port().callScoped(request(requestId, { source, operation: 'deleteWorld',
    payload: { worldRef: f.target.worldRef, confirmationName: 'Target' } }));
}
function publicRefusal(f, out, code) {
  f.receipt.response = out; f.receipt.actions = f.actions; f.receipt.nativeActions = f.nativeActions;
  assert.equal(out.result, null); assert.equal(out.error.code, code);
  assert.equal(out.error.mutationState, 'UNKNOWN');
  assert.deepEqual(Object.keys(out.error).sort(),
    ['causeCode', 'code', 'mutationState', 'phase', 'reason', 'retryability', 'transactionRef']);
  assert.equal(out.error.causeCode, null);
  assert.deepEqual(f.nativeActions, []);
  assert.equal(f.actions.at(-1).name, 'ReleaseWorldRetirement');
  assert.equal(f.actions.at(-1).request.outcome, 'ABORTED');
}
async function blockedActorSucceededNormally(f, out) {
  assert.ok(['EACCES', 'EPERM', 'EBUSY', 'ETXTBSY'].includes(f.receipt.actorRefusal?.code),
    'a mandatory binding must produce an actual OS denial, not a test-hook refusal');
  assert.deepEqual(f.receipt.actorRefusalTarget, f.receipt.before.target, 'kernel denial must precede any actor directory replacement');
  assert.deepEqual(f.receipt.actorRefusalNeighbour, f.receipt.before.neighbour);
  assert.equal(out.error, null); assert.deepEqual(out.result,
    { worldRef: f.target.worldRef, confirmationName: 'Target', deleted: true });
  assert.equal(await fs.lstat(f.target.worldPath).catch(e => { if (e.code === 'ENOENT') return null; throw e; }), null);
  assert.deepEqual(await snapshot(f.neighbour.worldPath), f.receipt.before.neighbour);
  assert.deepEqual(f.nativeActions, []);
  assert.equal(f.actions.at(-1).request.outcome, 'RETIRED');
}

for (const actor of ['source', 'parent']) test(`D-154 public scoped forward deletion binds ${actor} through native final-check to real commit`, async t => {
  const f = await fixture(t, true), d = await f.descriptor(), binding = await atomicBinding();
  let reached = false;
  const originalParent = join(f.user, 'Captured-worlds');
  const originalDirectory = join(f.worlds, 'Captured-original');
  const stop = await observeCommitBoundary(binding, event => {
    if (reached || event.fromName !== basename(f.target.worldPath) || !event.toName.startsWith('.hanaworlds-deleting-')) return;
    reached = true; observeVerifiedEvent(f, event, basename(f.target.worldPath));
    captureActor(f, () => {
      if (actor === 'source') {
        builtinFS.renameSync(f.target.worldPath, originalDirectory);
        builtinFS.mkdirSync(f.target.worldPath);
        builtinFS.writeFileSync(join(f.target.worldPath, 'replacement.txt'), 'replacement must not move');
      } else {
        builtinFS.renameSync(f.worlds, originalParent);
        builtinFS.mkdirSync(f.worlds);
        builtinFS.mkdirSync(f.target.worldPath);
        builtinFS.writeFileSync(join(f.target.worldPath, 'occupant.txt'), 'new parent occupant');
        builtinFS.mkdirSync(f.neighbour.worldPath);
        builtinFS.writeFileSync(join(f.neighbour.worldPath, 'unrelated.txt'), 'new parent neighbour');
      }
      f.receipt.actorTarget = synchronousSnapshot(f.target.worldPath);
      f.receipt.actorNeighbour = synchronousSnapshot(f.neighbour.worldPath);
      f.receipt.actorWorlds = synchronousSnapshot(f.worlds);
    });
  });
  let out;
  try { out = await scopedDelete(f, d.source, `d154:forward:${actor}`); }
  finally { stop(); }
  assert.equal(reached, true, 'actor reached the last actual native identity check before real commit');
  if (!f.receipt.actorCompleted) { await blockedActorSucceededNormally(f, out); return; }
  publicRefusal(f, out, 'CURRENT_WORLD_MISMATCH');
  assert.deepEqual(await snapshot(f.target.worldPath), f.receipt.actorTarget, 'the replacement directory identity and all bytes remain unchanged');
  assert.deepEqual(await snapshot(f.neighbour.worldPath), f.receipt.actorNeighbour);
  assert.deepEqual(await snapshot(f.worlds), f.receipt.actorWorlds);
  if (actor === 'source') {
    assert.deepEqual(await snapshot(originalDirectory), f.receipt.before.target);
    assert.deepEqual(Object.keys(await snapshot(f.target.worldPath)).sort(), ['', 'replacement.txt']);
    assert.equal(await fs.readFile(join(f.target.worldPath, 'replacement.txt'), 'utf8'), 'replacement must not move');
    assert.deepEqual(await snapshot(f.neighbour.worldPath), f.receipt.before.neighbour);
    assert.deepEqual((await fs.readdir(f.worlds)).sort(), ['Captured-original', 'Neighbour', 'Target']);
    assert.deepEqual((await f.descriptor()).source, d.source, 'world-name replacement must not retire the same root source generation');
  } else {
    assert.deepEqual(await snapshot(join(originalParent, 'Target')), f.receipt.before.target);
    assert.deepEqual(await snapshot(join(originalParent, 'Neighbour')), f.receipt.before.neighbour);
    assert.deepEqual((await fs.readdir(originalParent)).sort(), ['Neighbour', 'Target']);
    assert.deepEqual(Object.keys(await snapshot(f.target.worldPath)).sort(), ['', 'occupant.txt']);
    assert.equal(await fs.readFile(join(f.target.worldPath, 'occupant.txt'), 'utf8'), 'new parent occupant');
    assert.deepEqual(Object.keys(await snapshot(f.neighbour.worldPath)).sort(), ['', 'unrelated.txt']);
    assert.equal(await fs.readFile(join(f.neighbour.worldPath, 'unrelated.txt'), 'utf8'), 'new parent neighbour');
    assert.deepEqual((await fs.readdir(f.worlds)).sort(), ['Neighbour', 'Target']);
  }
});

for (const actor of ['source', 'parent', 'parent-and-occupant']) test(`D-154 public scoped compensation binds ${actor} through native final-check to real commit`, async t => {
  const f = await fixture(t, true), d = await f.descriptor(), binding = await atomicBinding();
  const cause = Object.assign(new Error('D154_ORIGINAL_IO_CAUSE'), { code: 'EIO' });
  const original = Object.assign(new Error('EIO', { cause }), { code: 'EIO' });
  const originalParent = join(f.user, 'Captured-worlds');
  const preservedName = '.hanaworlds-preserved-original';
  let reached = false, stagingName, replacementTree, occupantTree, freshParentTree;
  // Fault timing only: the original primitive completes the real forward move
  // before this EIO is delivered. The production deletion and recovery run.
  const restoreForward = await observeRename(t, f, (staging) => {
    stagingName = basename(staging); throw original;
  });
  const stop = await observeCommitBoundary(binding, event => {
    if (reached || event.fromName !== stagingName || event.toName !== basename(f.target.worldPath)) return;
    reached = true; observeVerifiedEvent(f, event, stagingName);
    captureActor(f, () => {
      if (actor === 'source') {
        builtinFS.renameSync(join(f.worlds, stagingName), join(f.worlds, preservedName));
        builtinFS.mkdirSync(join(f.worlds, stagingName));
        builtinFS.writeFileSync(join(f.worlds, stagingName, 'replacement.txt'), 'compensation replacement must not move');
      } else {
        builtinFS.renameSync(f.worlds, originalParent);
        builtinFS.mkdirSync(f.worlds);
        builtinFS.mkdirSync(f.target.worldPath);
        builtinFS.writeFileSync(join(f.target.worldPath, 'fresh-owner.txt'), 'fresh parent owner');
        builtinFS.mkdirSync(f.neighbour.worldPath);
        builtinFS.writeFileSync(join(f.neighbour.worldPath, 'fresh-neighbour.txt'), 'fresh parent neighbour');
        // Also occupy the real captured parent's recovery destination. A stale
        // path check and a held fd alone must neither overwrite this occupant
        // nor modify the unrelated new parent.
        if (actor === 'parent-and-occupant') {
          builtinFS.mkdirSync(join(originalParent, 'Target'));
          builtinFS.writeFileSync(join(originalParent, 'Target', 'new-owner.txt'), 'captured parent new owner');
        }
      }
      if (actor === 'source') {
        f.receipt.actorReplacement = synchronousSnapshot(join(f.worlds, stagingName));
        f.receipt.actorNeighbour = synchronousSnapshot(f.neighbour.worldPath);
        f.receipt.actorWorlds = synchronousSnapshot(f.worlds);
      } else {
        if (actor === 'parent-and-occupant') f.receipt.actorOccupant = synchronousSnapshot(join(originalParent, 'Target'));
        f.receipt.actorWorlds = synchronousSnapshot(f.worlds);
        f.receipt.actorHeldParent = synchronousSnapshot(originalParent);
      }
    });
  });
  let out;
  try { out = await scopedDelete(f, d.source, `d154:compensation:${actor}`); }
  finally { stop(); restoreForward(); }
  assert.equal(f.receipt.renameReached, true, 'the genuine forward movement completed before the original error');
  assert.equal(reached, true, 'the real compensation reached its final native check before commit');
  publicRefusal(f, out, 'TRANSACTION_CONFLICT');
  assert.equal(original.cause, cause, 'recovery retains the exact original cause object');
  assert.equal(original.code, 'EIO'); assert.equal(original.message, 'EIO');
  assert.equal(original.mutationState, 'UNKNOWN');
  f.receipt.originalFailure = { message: original.message, code: original.code, causeCode: original.cause.code,
    causeMessage: original.cause.message, mutationState: original.mutationState, details: original.details };
  if (!f.receipt.actorCompleted) {
    assert.ok(['EACCES', 'EPERM', 'EBUSY', 'ETXTBSY'].includes(f.receipt.actorRefusal?.code));
    assert.deepEqual(f.receipt.actorRefusalVerifiedSource, f.receipt.before.target, 'kernel refusal must precede any actor source replacement');
    assert.deepEqual(f.receipt.actorRefusalNeighbour, f.receipt.before.neighbour);
    await preserved(f); return;
  }
  assert.equal(typeof original.details?.residuePath, 'string', 'blocked safe compensation names actual original custody');
  assert.deepEqual(await snapshot(original.details.residuePath), f.receipt.before.target,
    'the diagnostic must name the actual captured directory, not a replacement at its old spelling');
  if (actor === 'source') {
    assert.equal(original.details.residuePath, join(f.worlds, preservedName));
    assert.deepEqual(await snapshot(join(f.worlds, preservedName)), f.receipt.before.target);
    replacementTree = await snapshot(join(f.worlds, stagingName));
    assert.deepEqual(replacementTree, f.receipt.actorReplacement);
    assert.deepEqual(await snapshot(f.neighbour.worldPath), f.receipt.actorNeighbour);
    assert.deepEqual(await snapshot(f.worlds), f.receipt.actorWorlds);
    assert.deepEqual(Object.keys(replacementTree).sort(), ['', 'replacement.txt']);
    assert.equal(await fs.readFile(join(f.worlds, stagingName, 'replacement.txt'), 'utf8'), 'compensation replacement must not move');
    assert.equal(await fs.lstat(f.target.worldPath).catch(e => { if (e.code === 'ENOENT') return null; throw e; }), null);
    assert.deepEqual(await snapshot(f.neighbour.worldPath), f.receipt.before.neighbour);
    assert.deepEqual((await fs.readdir(f.worlds)).sort(), [preservedName, stagingName, 'Neighbour'].sort());
  } else {
    assert.equal(original.details.residuePath, join(originalParent, stagingName));
    assert.deepEqual(await snapshot(join(originalParent, stagingName)), f.receipt.before.target);
    assert.deepEqual(await snapshot(join(originalParent, 'Neighbour')), f.receipt.before.neighbour);
    if (actor === 'parent-and-occupant') {
      occupantTree = await snapshot(join(originalParent, 'Target'));
      assert.deepEqual(occupantTree, f.receipt.actorOccupant);
      assert.deepEqual(Object.keys(occupantTree).sort(), ['', 'new-owner.txt']);
      assert.equal(await fs.readFile(join(originalParent, 'Target', 'new-owner.txt'), 'utf8'), 'captured parent new owner');
    } else {
      assert.equal(await fs.lstat(join(originalParent, 'Target')).catch(error => { if (error.code === 'ENOENT') return null; throw error; }), null,
        'parent-only replacement must not recover into the stale captured parent merely because its destination is empty');
    }
    assert.deepEqual(await snapshot(originalParent), f.receipt.actorHeldParent);
    freshParentTree = await snapshot(f.worlds);
    assert.deepEqual(freshParentTree, f.receipt.actorWorlds);
    assert.deepEqual(Object.keys(freshParentTree).sort(), ['', 'Neighbour', 'Neighbour/fresh-neighbour.txt', 'Target', 'Target/fresh-owner.txt']);
    assert.equal(await fs.readFile(join(f.target.worldPath, 'fresh-owner.txt'), 'utf8'), 'fresh parent owner');
    assert.equal(await fs.readFile(join(f.neighbour.worldPath, 'fresh-neighbour.txt'), 'utf8'), 'fresh parent neighbour');
    assert.deepEqual((await fs.readdir(originalParent)).sort(),
      [stagingName, 'Neighbour', ...(actor === 'parent-and-occupant' ? ['Target'] : [])].sort());
  }
  f.receipt.preservedReplacement = replacementTree;
  f.receipt.preservedOccupant = occupantTree;
  f.receipt.preservedFreshParent = freshParentTree;
});
