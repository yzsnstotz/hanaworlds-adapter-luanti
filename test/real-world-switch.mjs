// REAL_RUNTIME: two isolated real Luanti/VoxeLibre processes. The public Host
// peer is a fixture retaining actual child/exit ownership records, not Desktop.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, cp, symlink, realpath, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer, connect } from 'node:net';
import { once } from 'node:events';
const root = await realpath(process.env.HW_LOCAL_E), installed = process.env.HW_LOCAL_PACKAGE;
const { apply, inject } = await import(pathToFileURL(join(installed, 'src/index.mjs')));
const C = await import(pathToFileURL(join(installed, 'vendor/hanaworlds-contracts/dist/local/index.mjs')));
const { Context } = await import(pathToFileURL(process.env.HW_CORDIS_MODULE));
const profile = join(root, 'profile'), worlds = join(profile, 'worlds'), home = join(root, 'home');
for (const p of [worlds, home, join(profile, 'games'), join(profile, 'mods'), join(root, 'tmp')]) await mkdir(p, { recursive: true, mode: 0o700 });
await symlink(await realpath(process.env.HW_GAME), join(profile, 'games/mineclone2'));
await cp(process.env.HW_WORLDEDIT, join(profile, 'mods/worldedit'), { recursive: true });
async function freePort() { const s = createServer(); await new Promise(y => s.listen(0, '127.0.0.1', y)); const p = s.address().port; await new Promise(y => s.close(y)); return p; }
const controls = new Map(), processes = [], events = []; let mode = 'exact', sequence = 0;
const check = (event, detail = {}) => { events.push({ event, ...detail }); console.log('PASS', event); };
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
    if (r.stopped && mode === 'unknown') throw Error('FIXTURE_UNKNOWN_OWNERSHIP');
    await stop(r);
    const facts = { state: 'STOPPED', worldPath: r.input.worldPath, processId: r.child.pid, operationRef: r.input.operationRef };
    if (mode === 'wrong-pid') facts.processId++;
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
const local = ctx.get('hanaworldsLuantiLocalWorlds'), v6 = ctx.get('hanaworldsWorldAdapterV6'), native = ctx.get('hanaworldsLuantiNativeFacts');
const req = (extra = {}) => ({ requesterRef: 'owned-test-host', userPath: profile, ...extra });
const query = lease => ({ leaseRef: lease.leaseRef, requesterRef: 'owned-test-host', connectionRef: lease.connectionRef });
const acquire = world => local.acquire(req({ connectionRef: world.connectionRef, action: 'BIND_RUNNING_WORLD' }));
let calls = 0;
const inventory = () => v6.call('DiscoverConnections', { contractVersion: 'world-adapter/v6', sessionRef: 'test', requestId: `inventory-${++calls}`, adapterId: 'hanaworlds-adapter-luanti' });
const closedPort = port => new Promise((yes, no) => { const s = connect({ host: '127.0.0.1', port }); s.once('connect', () => { s.destroy(); no(Error('OLD_COURIER_STILL_OPEN')); }); s.once('error', e => e.code === 'ECONNREFUSED' ? yes() : no(e)); });
try {
  const a = await local.createFlatWorld(req({ gameId: 'mineclone2', worldName: 'A' }));
  const la = await acquire(a), pa = await local.pair(query(la));
  assert.equal(pa.paired, true);
  assert.equal((await inventory()).result.connections[0].connectionRef, a.connectionRef);
  check('A_REAL_PAIR', { creation: a, lease: la, paired: pa });
  await stop([...controls.values()][0]);
  await assert.rejects(local.inspect(query(la)), /CURRENT_WORLD_MISMATCH/);
  assert.ok((await inventory()).error, 'stopped A cannot be advertised READY');
  await assert.rejects(native.readCatalogue(a.worldRef), /WORLD_NOT_BOUND|CURRENT_WORLD_MISMATCH/);
  check('HOST_OWNED_A_STOP_OLD_CURRENT_REJECTED', { pid: processes[0].pid, exitCode: processes[0].exitCode });
  const b = await local.createFlatWorld(req({ gameId: 'mineclone2', worldName: 'B' }));
  assert.notEqual(a.worldRef, b.worldRef); assert.notEqual(a.connectionRef, b.connectionRef);
  mode = 'unknown'; const unknown = await acquire(b);
  await assert.rejects(local.pair(query(unknown)), /CURRENT_WORLD_MISMATCH/);
  await assert.rejects(native.readCatalogue(b.worldRef), /WORLD_NOT_BOUND/);
  check('UNKNOWN_STOP_FACTS_REJECTED', { fixtureFault: mode });
  mode = 'wrong-pid'; const mismatch = await acquire(b);
  await assert.rejects(local.pair(query(mismatch)), /CURRENT_WORLD_MISMATCH/);
  await assert.rejects(native.readCatalogue(b.worldRef), /WORLD_NOT_BOUND/);
  check('MISMATCHED_STOP_PID_REJECTED', { fixtureFault: mode });
  mode = 'exact'; const lb = await acquire(b), pb = await local.pair(query(lb));
  assert.equal(pb.paired, true); assert.equal(pb.connectionRef, b.connectionRef); assert.equal(pb.worldRef, b.worldRef);
  assert.notEqual(pb.connectionIncarnationRef, pa.connectionIncarnationRef);
  assert.equal((await local.inspect(query(lb))).current, true);
  await assert.rejects(local.inspect(query(la)), /CURRENT_WORLD_MISMATCH/);
  await assert.rejects(local.pair(query(la)), /CURRENT_WORLD_MISMATCH/);
  await assert.rejects(native.readScopedState(a.connectionRef, []), /WORLD_NOT_BOUND/);
  await assert.rejects(native.readCatalogue(a.worldRef), /WORLD_NOT_BOUND/);
  const inv = await inventory(); assert.equal(inv.error, null); assert.deepEqual(inv.result.connections.map(x => x.connectionRef), [b.connectionRef]);
  const oldTransport = JSON.parse(await readFile(join(a.worldPath, 'worldmods/hanaworlds_adapter/transport.json'), 'utf8'));
  await closedPort(oldTransport.port);
  check('SAME_SERVICE_B_REAL_PAIR_OLD_LEASE_CONNECTION_AND_COURIER_RETIRED', { creation: b, lease: lb, paired: pb, inventory: inv });
  // Loaded B registry travels over B's real courier, independently of Canvas.
  const catalogue = await native.readCatalogue(b.worldRef);
  assert.ok(catalogue.nodes['air']); assert.ok(catalogue.nodes['mcl_core:stone']);
  check('B_REAL_TRANSPORT_READ', { worldRef: b.worldRef, gameRevision: catalogue.gameRevision, nodes: Object.keys(catalogue.nodes).length });
  await service.close();
  assert.ok(processes.every(p => p.exitCode === 0));
  check('OWN_CHILDREN_CLOSED', { processes: processes.length, leftRunning: 0 });
  await writeFile(join(root, 'results.json'), JSON.stringify({ evidence: 'REAL_RUNTIME_WITH_HOST_FIXTURE', productUI: 'NOT_RUN', events, processes }, null, 2));
} finally {
  mode = 'exact'; await service.close();
  for (const r of controls.values()) await stop(r);
  await writeFile(join(root, 'processes.json'), JSON.stringify(processes, null, 2));
}
