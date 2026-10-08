// FIXTURE: Host-owned lifecycle records, runtime activity and Luanti user path are stand-ins.
// Real engine/process evidence is test/real-world-delete.mjs.
import assert from 'node:assert/strict';
import test from 'node:test';
import { chmod, cp, lstat, mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLocalWorldPort } from '../src/local-world-port.mjs';
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
  await mkdir(join(root, 'mods/worldedit'), { recursive: true });
  await writeFile(join(root, 'mods/worldedit/mod.conf'), 'name = worldedit\n');
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
  const local = createLocalWorldPort({ roots: [worlds], resolveControl: () => host, runtime, log: (...x) => logs.push(x.join(' ')) });
  const port = local.port, req = (extra = {}) => ({ requesterRef: 'host', userPath: root, ...extra });
  const create = name => port.createFlatWorld(req({ worldName: name }));
  const ref = w => ({ requesterRef: 'host', connectionRef: w.connectionRef, worldRef: w.worldRef });
  const bind = async w => { const l = await port.acquire(req({ connectionRef: w.connectionRef, action: 'BIND_RUNNING_WORLD' }));
    await port.pair({ leaseRef: l.leaseRef, requesterRef: 'host', connectionRef: w.connectionRef }); return l; };
  return { root, worlds, other, port, state, calls, logs, create, ref, bind, req };
}

test('describe names the exact world and data loss; changes nothing', async () => {
  const t = await setup(), a = await t.create('Alpha');
  const marker = JSON.parse(await readFile(join(a.worldPath, CREATED_MARKER), 'utf8'));
  assert.equal(marker.worldRef, a.worldRef); assert.equal(marker.worldName, 'Alpha'); assert.equal(marker.root, t.worlds);
  const before = await tree(t.worlds);
  const d = await t.port.describeWorldDeletion(t.ref(a));
  assert.equal(d.worldName, 'Alpha'); assert.equal(d.productCreated, true); assert.equal(d.deletable, true);
  assert.deepEqual(d.blockers, []); assert.equal(d.nativeStop, 'NOT_LAUNCHED_BY_THIS_SERVICE');
  assert.equal(d.dataLoss.scope, 'ENTIRE_WORLD_DIRECTORY'); assert.ok(d.dataLoss.files >= 10 && d.dataLoss.bytes > 0);
  assert.deepEqual(d.callerMustVerify, ['NO_LIVE_SESSION_BINDING']);
  assert.deepEqual(await tree(t.worlds), before);
});

test('deletes an exact never-launched product world and reads back its absence; others untouched', async () => {
  const t = await setup(), a = await t.create('Alpha'), b = await t.create('Beta');
  const keepB = await tree(b.worldPath), keepMine = await tree(join(t.worlds, 'mine'));
  const out = await t.port.deleteWorld(t.ref(a));
  assert.equal(out.deleted, true); assert.equal(out.worldName, 'Alpha'); assert.deepEqual(out.readback, { listed: false, pathExists: false });
  assert.equal(await lstat(a.worldPath).catch(() => null), null);
  assert.deepEqual((await t.port.discover()).map(w => w.worldPath).sort(), [b.worldPath, join(t.worlds, 'mine')].sort());
  assert.deepEqual((await readdir(t.worlds)).sort(), ['Beta', 'mine']); // no staging residue
  assert.deepEqual(await tree(b.worldPath), keepB); assert.deepEqual(await tree(join(t.worlds, 'mine')), keepMine);
  await assert.rejects(t.port.deleteWorld(t.ref(a)), /CONNECTION_NOT_FOUND/); // a second delete is not a success
});

test('rejects identity mismatch, unknown ownership, copies, out-of-root and bad input; keeps every world', async () => {
  const t = await setup(), a = await t.create('Alpha'), b = await t.create('Beta');
  await cp(a.worldPath, join(t.worlds, 'Alpha copy'), { recursive: true });
  const copy = (await t.port.discover()).find(w => w.worldPath === join(t.worlds, 'Alpha copy'));
  const mine = (await t.port.discover()).find(w => w.worldPath === join(t.worlds, 'mine'));
  const before = await tree(t.worlds);
  await assert.rejects(t.port.deleteWorld({ ...t.ref(a), worldRef: b.worldRef }), /CURRENT_WORLD_MISMATCH/);
  await assert.rejects(t.port.deleteWorld({ ...t.ref(a), connectionRef: 'local:unknown' }), /CONNECTION_NOT_FOUND/);
  await assert.rejects(t.port.deleteWorld({ requesterRef: 'host', connectionRef: mine.connectionRef, worldRef: 'luanti:none' }), /CURRENT_WORLD_MISMATCH/);
  await assert.rejects(t.port.deleteWorld(t.ref(copy)), e => e.message === 'WORLD_OWNERSHIP_UNKNOWN' && e.details.blockers[0].reason === 'CREATION_MARKER_LOCATION_MISMATCH');
  await assert.rejects(t.port.deleteWorld({ ...t.ref(a), worldPath: a.worldPath }), /SCHEMA_INVALID/);
  await assert.rejects(t.port.deleteWorld({ requesterRef: 'host', connectionRef: a.connectionRef }), /SCHEMA_INVALID/);
  // A world that is outside the configured roots is not reachable at all.
  await t.port.setRoots({ roots: [t.worlds, t.other] });
  const d = await t.port.createFlatWorld(t.req({ root: t.other, worldName: 'Delta' }));
  await t.port.setRoots({ roots: [t.worlds] });
  await assert.rejects(t.port.deleteWorld(t.ref(d)), /CONNECTION_NOT_FOUND/);
  assert.ok(await lstat(d.worldPath));
  assert.deepEqual(await tree(t.worlds), before);
});

test('current, leased or mid-transaction worlds are named in use and kept', async () => {
  const t = await setup(), a = await t.create('Alpha'), b = await t.create('Beta'), c = await t.create('Gamma');
  const before = await tree(t.worlds);
  await t.bind(a);
  let d = await t.port.describeWorldDeletion(t.ref(a));
  assert.equal(d.deletable, false); assert.deepEqual(d.blockers.map(x => x.reason), ['LIFECYCLE_LEASE_OPEN', 'ADAPTER_CONNECTION_BOUND', 'RUNTIME_CONNECTION_OPEN']);
  await assert.rejects(t.port.deleteWorld(t.ref(a)), e => e.message === 'WORLD_IN_USE');
  await t.port.acquire(t.req({ connectionRef: b.connectionRef, action: 'BIND_RUNNING_WORLD' })); // open, not yet paired
  await assert.rejects(t.port.deleteWorld(t.ref(b)), e => e.message === 'WORLD_IN_USE' && e.details.blockers[0].reason === 'LIFECYCLE_LEASE_OPEN');
  t.state.activity[c.worldRef] = { state: 'PRESENT', unsettled: [{ transactionId: 'tx1', status: 'RECOVERY_PENDING' }] };
  await assert.rejects(t.port.deleteWorld(t.ref(c)), e => e.message === 'WORLD_IN_USE' && e.details.blockers[0].reason === 'TRANSACTION_IN_FLIGHT');
  t.state.activity[c.worldRef] = { state: 'UNKNOWN', reason: 'fixture' };
  await assert.rejects(t.port.deleteWorld(t.ref(c)), e => e.message === 'REQUIRED_FACT_UNKNOWN');
  assert.deepEqual(await tree(t.worlds), before);
  assert.ok(t.logs.some(l => l.includes('LOCAL_DELETE_REJECTED')));
});

test('a world this service launched is deleted only inside the exact Host stopped callback', async () => {
  const t = await setup(), a = await t.create('Alpha'), b = await t.create('Beta');
  const la = await t.bind(a);
  await t.bind(b); // switch: A retired inside Host STOPPED callback
  const keep = await tree(a.worldPath);
  assert.equal((await t.port.describeWorldDeletion(t.ref(a))).nativeStop, 'HOST_STOPPED_CALLBACK');
  t.state.mode = 'unknown';
  await assert.rejects(t.port.deleteWorld(t.ref(a)), /CURRENT_WORLD_MISMATCH/);
  t.state.mode = 'wrong-pid';
  await assert.rejects(t.port.deleteWorld(t.ref(a)), /CURRENT_WORLD_MISMATCH/);
  assert.deepEqual(await tree(a.worldPath), keep); // failures keep the world exactly
  t.state.mode = 'exact'; const n = t.calls.length;
  const out = await t.port.deleteWorld(t.ref(a));
  assert.equal(out.nativeStop, 'HOST_STOPPED_CALLBACK'); assert.equal(t.calls.length, n + 1); assert.equal(t.calls.at(-1), a.worldPath);
  assert.equal(await lstat(a.worldPath).catch(() => null), null);
  await assert.rejects(t.port.inspect({ leaseRef: la.leaseRef, requesterRef: 'host', connectionRef: a.connectionRef }), /CURRENT_WORLD_MISMATCH/);
  assert.equal((await t.port.describeWorldDeletion(t.ref(b))).deletable, false); // B stays current
});

test('a removal that fails after the rename is named with its residue, never reported deleted', async () => {
  const t = await setup(), a = await t.create('Alpha');
  const locked = join(a.worldPath, 'worldmods/hanaworlds_adapter');
  await chmod(locked, 0o500);
  try {
    await assert.rejects(t.port.deleteWorld(t.ref(a)), e => e.message === 'DELETE_INCOMPLETE' && e.details.residuePath.includes('/.hanaworlds-deleting-'));
    assert.equal((await t.port.discover()).some(w => w.connectionRef === a.connectionRef), false);
  } finally {
    for (const name of await readdir(t.worlds)) if (name.startsWith('.hanaworlds-deleting-')) {
      await chmod(join(t.worlds, name, 'worldmods/hanaworlds_adapter'), 0o700); await rm(join(t.worlds, name), { recursive: true });
    }
  }
});
