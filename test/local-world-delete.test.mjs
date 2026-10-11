// FIXTURE: Host-owned lifecycle records, runtime activity and Luanti user path are stand-ins.
// Real engine/process evidence is test/real-world-delete.mjs.
import assert from 'node:assert/strict';
import test from 'node:test';
import { chmod, cp, lstat, mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLocalWorldPort } from '../src/local-world-port.mjs';
import { validateBoundResponse, ContractError } from '#contracts';
import { CREATED_MARKER } from '../src/local-world-deletion.mjs';

async function tree(path) {
  const out = {};
  const walk = async (dir, rel) => {
    for (const e of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name < b.name ? -1 : 1)) {
      const p = join(dir, e.name), r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) await walk(p, r); else out[r] = createHash('sha256').update(await readFile(p)).digest('hex');
    }
  };
  await walk(path, '');
  return out;
}

async function setup() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'hw-delete-')));
  const worlds = join(root, 'worlds'), other = join(root, 'other');
  await mkdir(worlds); await mkdir(other);
  await mkdir(join(root, 'games/fixture'), { recursive: true });
  await writeFile(join(root, 'games/fixture/game.conf'), 'title = Fixture\n');
  // A user's own world: never created by this Adapter.
  await mkdir(join(worlds, 'mine')); await writeFile(join(worlds, 'mine/world.mt'), 'gameid = fixture\n');
  const records = new Map(), calls = [], logs = [];
  const state = { mode: 'exact', bound: undefined, activity: {} };
  const host = {
    async acquire(q) { const controlRef = `host:${records.size}`; records.set(controlRef, { ...q, pid: 4000 + records.size, stopped: false }); return { controlRef, worldPath: q.worldPath }; },
    async inspect(q) {
      const r = records.get(q.controlRef); if (!r || r.stopped) throw Error('NOT_CURRENT');
      return { state: 'CURRENT', worldPath: r.worldPath, processId: r.pid, operationRef: r.operationRef };
    },
    async withStoppedWorld(q, callback) {
      const r = records.get(q.controlRef);
      if (state.mode === 'unknown') throw Error('UNKNOWN');
      r.stopped = true;
      const facts = { state: 'STOPPED', worldPath: r.worldPath, processId: r.pid, operationRef: r.operationRef };
      if (state.mode === 'wrong-pid') facts.processId++;
      calls.push(q.worldPath);
      return callback(facts);
    },
  };
  const runtime = {
    setLocalRoots() {},
    async pairLocal(w) { if (state.bound) throw Error('CURRENT_WORLD_MISMATCH'); state.bound = w; return { connectionIncarnationRef: w.worldRef }; },
    async retireLocal(ref) { assert.equal(ref, state.bound.connectionRef); state.bound = undefined; },
    async localWorldActivity({ connectionRef, worldRef }) {
      return { bound: state.bound?.connectionRef === connectionRef, journal: state.activity[worldRef] ?? { state: 'NONE' } };
    },
  };
  const canvas = { async call(name, q) {
    const result = name === 'ListWorldSelections' ? { worldRef: q.worldRef, inventoryRevision: 'i:1', sessionRefs: state.sessions ?? [], retirementReservationRef: null }
      : name === 'ReserveWorldRetirement' ? { worldRef: q.worldRef, reservationRef: 'r:1', inventoryRevision: q.expectedInventoryRevision }
      : { worldRef: q.worldRef, reservationRef: q.reservationRef, outcome: q.outcome, inventoryRevision: 'i:2' };
    if (state.releaseFailure && name === 'ReleaseWorldRetirement') throw new ContractError('TRANSACTION_CONFLICT', 'validate', 'REVISION_CHANGED');
    if (state.reserveFailure && name === 'ReserveWorldRetirement') throw Error('TRANSACTION_CONFLICT');
    calls.push(name);
    return validateBoundResponse('canvas/v7', name, q, { contractVersion: 'canvas/v7', requestId: q.requestId, result, error: null });
  } };
  const local = createLocalWorldPort({ roots: [worlds], userPath: root, resolveCanvas: () => state.noCanvas ? null : canvas, resolveControl: () => host, runtime, log: (...x) => logs.push(x.join(' ')) });
  const port = local.port, req = (extra = {}) => ({ requesterRef: 'host', userPath: root, ...extra });
  const create = name => port.createFlatWorld(req({ worldName: name }));
  const ref = w => ({ requesterRef: 'host', connectionRef: w.connectionRef, worldRef: w.worldRef });
  const bind = async w => { const l = await port.acquire(req({ connectionRef: w.connectionRef, action: 'BIND_RUNNING_WORLD' }));
    await port.pair({ leaseRef: l.leaseRef, requesterRef: 'host', connectionRef: w.connectionRef }); return l; };
  const deletion = (w, extra = {}) => ({ contractVersion: 'local-worlds/v2', requestId: 'delete:fixture', worldRef: w.worldRef, confirmationName: w.worldName, ...extra });
  const remove = async (w, extra = {}) => { const q = deletion(w, extra); return validateBoundResponse('local-worlds/v2', 'deleteWorld', q, await port.deleteWorld(q)); };
  return { root, worlds, other, port, state, calls, logs, create, ref, bind, req, deletion, remove };
}


test('describe reads exact world, ownership and data loss without mutation', async () => {
  const t = await setup(), a = await t.create('Alpha');
  const marker = JSON.parse(await readFile(join(a.worldPath, CREATED_MARKER)));
  assert.equal(marker.worldRef, a.worldRef);
  const before = await tree(t.worlds), d = await t.port.describeWorldDeletion(t.ref(a));
  assert.equal(d.deletable, true); assert.equal(d.worldName, 'Alpha');
  assert.ok(d.dataLoss.files >= 10); assert.deepEqual(await tree(t.worlds), before);
});
test('v2 confirms name, deletes exact world, releases reservation and reads absence', async () => {
  const t = await setup(), a = await t.create('Alpha'), b = await t.create('Beta');
  const before = await tree(t.worlds);
  assert.equal((await t.remove(a, { confirmationName: 'Beta' })).error.code, 'TRANSACTION_CONFLICT');
  assert.deepEqual(await tree(t.worlds), before);
  const keep = await tree(b.worldPath), mine = await tree(join(t.worlds, 'mine'));
  const out = await t.remove(a);
  assert.equal(out.error, null); assert.deepEqual({ ...out.result }, { worldRef: a.worldRef, confirmationName: 'Alpha', deleted: true });
  assert.equal(await lstat(a.worldPath).catch(() => null), null);
  assert.deepEqual((await readdir(t.worlds)).sort(), ['Beta', 'mine']);
  assert.deepEqual(await tree(b.worldPath), keep); assert.deepEqual(await tree(join(t.worlds, 'mine')), mine);
  assert.equal(t.calls.at(-1), 'ReleaseWorldRetirement');
  assert.equal((await t.remove(a)).error.code, 'WORLD_NOT_FOUND');
});
test('v2 missing world, unknown ownership, duplicate identities and injected selectors refuse deletion', async () => {
  const t = await setup(), a = await t.create('Alpha');
  assert.equal((await t.remove(a, { worldRef: 'world:unknown' })).error.code, 'WORLD_NOT_FOUND');
  await assert.rejects(t.port.deleteWorld({ ...t.deletion(a), worldPath: a.worldPath }), ContractError);
  await assert.rejects(t.port.deleteWorld({ ...t.deletion(a), confirmationName: undefined }), ContractError);
  await cp(a.worldPath, join(t.worlds, 'Alpha copy'), { recursive: true });
  const before = await tree(t.worlds);
  assert.equal((await t.remove(a)).error.code, 'TRANSACTION_CONFLICT');
  assert.deepEqual(await tree(t.worlds), before);
  const other = await t.create('Other');
  await writeFile(join(other.worldPath, CREATED_MARKER), '{}');
  assert.equal((await t.remove(other)).error.code, 'TRANSACTION_CONFLICT');
});
test('v2 lease, runtime binding, unsettled journal and unknown activity keep world', async () => {
  const t = await setup(), a = await t.create('Alpha'), b = await t.create('Beta');
  const before = await tree(t.worlds);
  await t.bind(a);
  assert.equal((await t.remove(a)).error.code, 'TRANSACTION_CONFLICT');
  t.state.activity[b.worldRef] = { state: 'PRESENT', unsettled: [{ transactionId: 'tx1', status: 'RECOVERY_PENDING' }] };
  assert.equal((await t.remove(b)).error.code, 'TRANSACTION_CONFLICT');
  t.state.activity[b.worldRef] = { state: 'UNKNOWN', reason: 'fixture' };
  assert.equal((await t.remove(b)).error.code, 'TRANSACTION_CONFLICT');
  assert.deepEqual(await tree(t.worlds), before);
});
test('v2 live Canvas selection, stale reservation and missing Canvas prevent mutation', async () => {
  const t = await setup(), a = await t.create('Alpha'), before = await tree(t.worlds);
  t.state.sessions = ['session:A'];
  assert.equal((await t.remove(a)).error.code, 'TRANSACTION_CONFLICT');
  t.state.sessions = []; t.state.reserveFailure = true;
  assert.equal((await t.remove(a)).error.code, 'TRANSACTION_CONFLICT');
  t.state.reserveFailure = false; t.state.noCanvas = true;
  assert.equal((await t.remove(a)).error.code, 'TRANSACTION_CONFLICT');
  assert.deepEqual(await tree(t.worlds), before);
});
test('launched world is deleted only with exact Host stopped callback', async () => {
  const t = await setup(), a = await t.create('Alpha');
  await t.bind(a); await t.port.stopWorld(t.ref(a));
  const before = await tree(a.worldPath);
  for (const mode of ['unknown', 'wrong-pid']) {
    t.state.mode = mode;
    assert.equal((await t.remove(a)).error.code, 'TRANSACTION_CONFLICT');
    assert.deepEqual(await tree(a.worldPath), before);
  }
  t.state.mode = 'exact';
  assert.equal((await t.remove(a)).result.deleted, true);
  assert.ok(t.calls.includes(a.worldPath));
});
test('partial removal returns v2 conflict with PARTIAL mutation rather than success', async () => {
  const t = await setup(), a = await t.create('Alpha');
  const locked = join(a.worldPath, 'worldmods/hanaworlds_adapter');
  await chmod(locked, 0o500);
  try {
    const r = await t.remove(a);
    assert.equal(r.result, null); assert.equal(r.error.code, 'TRANSACTION_CONFLICT'); assert.equal(r.error.mutationState, 'PARTIAL');
    assert.equal((await t.port.discover()).some(w => w.worldRef === a.worldRef), false);
  } finally {
    for (const name of await readdir(t.worlds)) if (name.startsWith('.hanaworlds-deleting-')) await chmod(join(t.worlds, name, 'worldmods/hanaworlds_adapter'), 0o700);
  }
});

test('release failure after removal reports UNKNOWN mutation without claiming deleted receipt', async () => {
  const t = await setup(), a = await t.create('Alpha');
  t.state.releaseFailure = true;
  const r = await t.remove(a);
  assert.equal(r.result, null); assert.equal(r.error.code, 'TRANSACTION_CONFLICT');
  assert.equal(r.error.mutationState, 'UNKNOWN');
  assert.equal(await lstat(a.worldPath).catch(() => null), null);
});
