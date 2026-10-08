// REAL_RUNTIME: isolated real Luanti/VoxeLibre processes and real world directories.
// The public Host peer is a fixture retaining actual child/exit ownership records, not Desktop.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, lstat, mkdir, readdir, readFile, realpath, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:net';
import { once } from 'node:events';
const root = await realpath(process.env.HW_LOCAL_E), installed = process.env.HW_LOCAL_PACKAGE;
const { apply, inject } = await import(pathToFileURL(join(installed, 'src/index.mjs')));
const C = await import(pathToFileURL(join(installed, 'node_modules/hanaworlds-contracts/dist/local/index.mjs')));
const { Context } = await import(pathToFileURL(process.env.HW_CORDIS_MODULE));
const profile = join(root, 'profile'), worlds = join(profile, 'worlds'), outside = join(profile, 'outside-root'), home = join(root, 'home');
for (const p of [worlds, outside, home, join(profile, 'games'), join(profile, 'mods'), join(root, 'tmp')]) await mkdir(p, { recursive: true, mode: 0o700 });
await symlink(await realpath(process.env.HW_GAME), join(profile, 'games/mineclone2'));
await cp(process.env.HW_WORLDEDIT, join(profile, 'mods/worldedit'), { recursive: true });
async function freePort() { const s = createServer(); await new Promise(y => s.listen(0, '127.0.0.1', y)); const p = s.address().port; await new Promise(y => s.close(y)); return p; }
const controls = new Map(), processes = [], events = []; let mode = 'exact', sequence = 0;
const check = (event, detail = {}) => { events.push({ event, ...detail }); console.log('PASS', event); };
async function tree(path) {
  const out = {};
  const walk = async (dir, rel) => {
    for (const e of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name < b.name ? -1 : 1)) {
      const p = join(dir, e.name), r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) await walk(p, r); else if (e.isFile()) out[r] = createHash('sha256').update(await readFile(p)).digest('hex');
    }
  };
  await walk(path, '');
  return createHash('sha256').update(JSON.stringify(out)).digest('hex');
}
async function stop(record) {
  if (record.stopped) return;
  assert.equal(record.child.exitCode, null); assert.equal(record.child.signalCode, null);
  const exit = once(record.child, 'exit'); assert.equal(record.child.kill('SIGINT'), true);
  const [code, signal] = await exit;
  record.stopped = true; record.evidence.exitCode = code; record.evidence.signal = signal;
  assert.equal(code, 0); assert.equal(signal, null);
}
const host = {
  async acquire(input) {
    C.validateType('NativeControlInput', input); assert.equal(input.userPath, profile);
    const id = ++sequence, log = join(root, `luanti-${id}.log`), config = join(root, `luanti-${id}.conf`);
    await writeFile(config, `port = ${await freePort()}\nbind_address = 127.0.0.1\nsecure.http_mods = hanaworlds_adapter\nserver_announce = false\n`);
    const argv = ['--server', '--world', input.worldPath, '--config', config, '--logfile', log];
    const child = spawn('/Applications/luanti.app/Contents/MacOS/luanti', argv, {
      env: { ...process.env, HOME: profile, LUANTI_USER_PATH: profile, XDG_CACHE_HOME: join(profile, 'cache'), TMPDIR: join(root, 'tmp') }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdio = ''; child.stdout.on('data', b => { stdio += b; }); child.stderr.on('data', b => { stdio += b; });
    const evidence = { pid: child.pid, input, argv, log }, record = { input, child, evidence, stopped: false };
    child.on('exit', () => { void writeFile(join(root, `luanti-${id}-stdio.log`), stdio); });
    const controlRef = `owned:${child.pid}`; controls.set(controlRef, record); processes.push(evidence);
    const until = Date.now() + 120000;
    while (!(await readFile(log, 'utf8').catch(() => '')).includes('Server for gameid="mineclone2" listening')) {
      if (child.exitCode !== null || child.signalCode !== null) throw Error(`LUANTI_EARLY_EXIT ${log}`);
      if (Date.now() > until) throw Error(`LUANTI_READY_TIMEOUT ${log}`);
      await new Promise(y => setTimeout(y, 100));
    }
    return { controlRef, worldPath: input.worldPath };
  },
  query(q) {
    C.validateType('NativeControlQuery', q); const r = controls.get(q.controlRef); assert.ok(r);
    for (const k of ['worldPath', 'requesterRef', 'operationRef']) assert.equal(q[k], r.input[k]);
    return r;
  },
  async inspect(q) {
    const r = this.query(q); assert.equal(r.stopped, false); assert.equal(r.child.exitCode, null); process.kill(r.child.pid, 0);
    return C.validateType('NativeControlEvidence', { state: 'CURRENT', worldPath: r.input.worldPath, processId: r.child.pid, operationRef: r.input.operationRef });
  },
  async withStoppedWorld(q, consume) {
    const r = this.query(q);
    if (mode === 'unknown') throw Error('FIXTURE_UNKNOWN_OWNERSHIP');
    await stop(r);
    const facts = { state: 'STOPPED', worldPath: r.input.worldPath, processId: r.child.pid, operationRef: r.input.operationRef };
    if (mode === 'wrong-pid') facts.processId++;
    // The exact owned process has exited before the callback runs.
    assert.throws(() => process.kill(r.child.pid, 0));
    events.push({ event: 'HOST_STOPPED_CALLBACK', query: q, facts, fixtureMode: mode });
    return consume(C.validateType('NativeControlEvidence', facts));
  },
};
const ctx = new Context();
ctx.provide('webServer', { register() { return () => {}; } });
ctx.provide('dshHomePath', (...p) => join(home, ...p));
ctx.provide('hanaworldsNativeEngineControl', host);
let service;
const fiber = ctx.plugin({ name: 'hanaworlds-adapter-luanti', inject, apply(c) { service = apply(c, { localWorldRoots: [worlds] }); } });
await fiber.await();
const local = ctx.get('hanaworldsLuantiLocalWorlds'), native = ctx.get('hanaworldsLuantiNativeFacts');
const req = (extra = {}) => ({ requesterRef: 'owned-test-host', userPath: profile, ...extra });
const query = lease => ({ leaseRef: lease.leaseRef, requesterRef: 'owned-test-host', connectionRef: lease.connectionRef });
const ref = w => ({ requesterRef: 'owned-test-host', connectionRef: w.connectionRef, worldRef: w.worldRef });
const acquire = world => local.acquire(req({ connectionRef: world.connectionRef, action: 'BIND_RUNNING_WORLD' }));
const listed = async w => (await local.discover()).some(x => x.connectionRef === w.connectionRef);
const rejects = async (promise, code, reason) => {
  const error = await promise.then(() => null, e => e);
  assert.ok(error, `expected ${code}`); assert.equal(error.message, code);
  if (reason) assert.equal(error.details.blockers[0].reason, reason);
  return { code: error.message, blockers: error.details?.blockers ?? null };
};
try {
  const a = await local.createFlatWorld(req({ gameId: 'mineclone2', worldName: 'A' }));
  const la = await acquire(a), pa = await local.pair(query(la));
  assert.equal(pa.paired, true);
  const keepA = await tree(a.worldPath);
  const dA = await local.describeWorldDeletion(ref(a));
  assert.equal(dA.deletable, false); assert.equal(dA.productCreated, true);
  const inUse = await rejects(local.deleteWorld(ref(a)), 'WORLD_IN_USE');
  assert.ok(await listed(a)); assert.equal(await tree(a.worldPath), keepA);
  assert.ok((await native.readCatalogue(a.worldRef)).nodes['mcl_core:stone']);
  check('CURRENT_RUNNING_A_REJECTED_KEPT_AND_STILL_READABLE', { creation: a, describe: dA, rejection: inUse });

  // Host-owned stop of A, then switch to B on the same service (0.7.1 sequence).
  await stop([...controls.values()][0]);
  const b = await local.createFlatWorld(req({ gameId: 'mineclone2', worldName: 'B' }));
  const lb = await acquire(b), pb = await local.pair(query(lb));
  assert.equal(pb.paired, true); assert.equal(pb.worldRef, b.worldRef);
  const keepA2 = await tree(a.worldPath);
  const dA2 = await local.describeWorldDeletion(ref(a));
  assert.equal(dA2.deletable, true); assert.equal(dA2.nativeStop, 'HOST_STOPPED_CALLBACK'); assert.equal(dA2.worldName, 'A');
  check('SWITCHED_A_DESCRIBED_DELETABLE', { describe: dA2 });

  mode = 'unknown';
  const unknown = await rejects(local.deleteWorld(ref(a)), 'CURRENT_WORLD_MISMATCH');
  mode = 'wrong-pid';
  const wrongPid = await rejects(local.deleteWorld(ref(a)), 'CURRENT_WORLD_MISMATCH');
  mode = 'exact';
  const wrongRef = await rejects(local.deleteWorld({ ...ref(a), worldRef: b.worldRef }), 'CURRENT_WORLD_MISMATCH');
  assert.ok(await listed(a)); assert.equal(await tree(a.worldPath), keepA2);
  check('FAILED_HOST_STOP_AND_WRONG_IDENTITY_KEEP_A_EXACTLY', { unknown, wrongPid, wrongRef });

  const keepB = await tree(b.worldPath);
  const bCurrent = await rejects(local.deleteWorld(ref(b)), 'WORLD_IN_USE', 'LIFECYCLE_LEASE_OPEN');
  check('CURRENT_B_REJECTED', { rejection: bCurrent });

  // Not created by this Adapter: a user's own real Luanti world and a copy of A.
  const own = join(worlds, 'users-own');
  await mkdir(own); await writeFile(join(own, 'world.mt'), 'gameid = mineclone2\nworld_name = users-own\n');
  await cp(a.worldPath, join(worlds, 'A copy'), { recursive: true });
  const found = await local.discover();
  const ownRow = found.find(x => x.worldPath === own), copyRow = found.find(x => x.worldPath === join(worlds, 'A copy'));
  const keepCopy = await tree(copyRow.worldPath);
  const ownRej = await rejects(local.deleteWorld({ requesterRef: 'owned-test-host', connectionRef: ownRow.connectionRef, worldRef: 'luanti:00000000-0000-0000-0000-000000000000' }), 'CURRENT_WORLD_MISMATCH');
  const copyRej = await rejects(local.deleteWorld(ref(copyRow)), 'WORLD_OWNERSHIP_UNKNOWN', 'CREATION_MARKER_LOCATION_MISMATCH');
  assert.equal(await tree(copyRow.worldPath), keepCopy); assert.ok(await lstat(join(own, 'world.mt')));

  // Product-created world in a root that is not configured any more.
  await local.setRoots({ roots: [worlds, outside] });
  const d = await local.createFlatWorld(req({ gameId: 'mineclone2', worldName: 'D', root: outside }));
  await local.setRoots({ roots: [worlds] });
  const outRej = await rejects(local.deleteWorld(ref(d)), 'CONNECTION_NOT_FOUND');
  assert.ok(await lstat(join(d.worldPath, 'world.mt')));
  check('UNKNOWN_OWNERSHIP_COPY_AND_OUT_OF_ROOT_REJECTED_KEPT', { own: ownRej, copy: copyRej, outOfRoot: outRej });

  // Never-launched product world C with an unsettled transaction in its real Adapter journal.
  const c = await local.createFlatWorld(req({ gameId: 'mineclone2', worldName: 'C' }));
  const journal = join(home, 'data/hanaworlds-adapter-luanti/journal', createHash('sha256').update(c.worldRef).digest('hex'));
  await mkdir(journal, { recursive: true, mode: 0o700 });
  const state = status => writeFile(join(journal, 'local-world-state'), JSON.stringify({ version: '0.4.0', worldRef: c.worldRef,
    transactions: { tx1: { transactionId: 'tx1', status } }, requests: {} }));
  await state('RECOVERY_PENDING');
  const keepC = await tree(c.worldPath);
  const pendingRej = await rejects(local.deleteWorld(ref(c)), 'WORLD_IN_USE', 'TRANSACTION_IN_FLIGHT');
  assert.equal(await tree(c.worldPath), keepC);
  await state('VERIFIED');
  const dC = await local.describeWorldDeletion(ref(c));
  assert.equal(dC.deletable, true); assert.equal(dC.nativeStop, 'NOT_LAUNCHED_BY_THIS_SERVICE');
  const delC = await local.deleteWorld(ref(c));
  assert.equal(delC.deleted, true); assert.equal(await listed(c), false); assert.equal(await lstat(c.worldPath).catch(() => null), null);
  assert.ok(await lstat(join(journal, 'local-world-state'))); // Adapter journal is kept, never cleaned by deletion
  check('IN_FLIGHT_TRANSACTION_REJECTED_THEN_SETTLED_NEVER_LAUNCHED_C_DELETED', { rejection: pendingRej, describe: dC, deletion: delC });

  // Exact deletion of switched-away A inside its Host stopped callback.
  const callbacks = events.filter(e => e.event === 'HOST_STOPPED_CALLBACK').length;
  const delA = await local.deleteWorld(ref(a));
  assert.equal(delA.deleted, true); assert.equal(delA.nativeStop, 'HOST_STOPPED_CALLBACK');
  assert.equal(events.filter(e => e.event === 'HOST_STOPPED_CALLBACK').length, callbacks + 1);
  assert.equal(await listed(a), false); assert.equal(await lstat(a.worldPath).catch(() => null), null);
  await rejects(local.deleteWorld(ref(a)), 'CONNECTION_NOT_FOUND');
  const remaining = (await readdir(worlds)).sort();
  assert.deepEqual(remaining, ['A copy', 'B', 'users-own']);
  assert.equal(await tree(b.worldPath) !== null, true);
  assert.equal((await local.inspect(query(lb))).current, true);
  assert.ok((await native.readCatalogue(b.worldRef)).nodes['mcl_core:stone']);
  assert.equal(await tree(copyRow.worldPath), keepCopy);
  check('SWITCHED_A_DELETED_IN_HOST_STOPPED_CALLBACK_READBACK_GONE_B_STILL_CURRENT', { deletion: delA, remaining, keepBBefore: keepB });

  await service.close();
  assert.ok(processes.every(p => p.exitCode === 0));
  check('OWN_CHILDREN_CLOSED', { processes: processes.length, leftRunning: 0 });
  await writeFile(join(root, 'results.json'), JSON.stringify({ evidence: 'REAL_RUNTIME_WITH_HOST_FIXTURE', productUI: 'NOT_RUN', events, processes }, null, 2));
} finally {
  mode = 'exact'; await service.close();
  for (const r of controls.values()) await stop(r);
  await writeFile(join(root, 'processes.json'), JSON.stringify(processes, null, 2));
}
