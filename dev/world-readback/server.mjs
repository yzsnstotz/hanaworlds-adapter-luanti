// F-AD-WORLD-READBACK-01 · Adapter development page (http://127.0.0.1:47606/).
// Development only, not part of the package. It loads this origin's Adapter plugin into its
// own Cordis root and only calls the Adapter's public ports:
//   hanaworldsLuantiLocalWorlds  describeFlatWorldCreation / discover / createFlatWorld / acquire / pair
//   hanaworldsLuantiNativeFacts  readRegionState (read-only) / readCatalogue
// The sample world is a clearly marked FIXTURE: created by the public createFlatWorld in this
// service's own isolated Luanti user path and run by the labelled development Host below
// (a real headless Luanti child). The owner's real worlds are never listed, read or started here:
// they belong to the HanaWorlds.app Host, whose public connection supply is an integration input.
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createServer as netServer } from 'node:net';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { readSurface } from './surface.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const env = name => { const v = process.env[name]; if (!v) throw Error(`${name} is required`); return v; };
const STATE = env('HW_READBACK_STATE');          // service state: profile, worlds, home, logs
const CORDIS = env('HW_CORDIS_MODULE');
const LUANTI = process.env.HW_LUANTI ?? '/Applications/luanti.app/Contents/MacOS/luanti';
const PORT = Number(process.env.HW_READBACK_PORT ?? 47606);
const SAMPLE = 'hanaworlds-readback-SAMPLE-fixture';
const REQUESTER = 'dev-readback-host';
const RADIUS = 24;

const adapter = await import(new URL('../../src/index.mjs', import.meta.url));
const C = await import(new URL('../../vendor/hanaworlds-contracts/dist/local/index.mjs', import.meta.url));
const { Context } = await import(pathToFileURL(CORDIS));
const profile = join(STATE, 'profile'), worlds = join(profile, 'worlds'), home = join(STATE, 'home');
for (const p of [worlds, home, join(profile, 'games'), join(profile, 'mods'), join(STATE, 'logs'), join(STATE, 'tmp')]) await mkdir(p, { recursive: true, mode: 0o700 });
const log = (...a) => console.log(new Date().toISOString(), ...a);

async function freePort() { const s = netServer(); await new Promise(y => s.listen(0, '127.0.0.1', y)); const n = s.address().port; await new Promise(y => s.close(y)); return n; }

// ---- Development Host (labelled): owns exactly the real Luanti child it starts for the sample world.
const children = new Map();
const devHost = {
  async acquire(input) {
    C.validateType('NativeControlInput', input);
    if (input.userPath !== profile || !input.worldPath.startsWith(worlds + '/')) throw Error('DEV_HOST_SAMPLE_ONLY');
    const id = Date.now(), logfile = join(STATE, 'logs', `luanti-${id}.log`), config = join(STATE, 'logs', `luanti-${id}.conf`);
    // Engine config of this dev Host only. No static_spawnpoint is set (see spawn note on the page).
    await writeFile(config, `port = ${await freePort()}\nbind_address = 127.0.0.1\nsecure.http_mods = hanaworlds_adapter\nserver_announce = false\n`);
    const argv = ['--server', '--world', input.worldPath, '--config', config, '--logfile', logfile];
    const child = spawn(LUANTI, argv, { env: { ...process.env, HOME: profile, LUANTI_USER_PATH: profile,
      XDG_CACHE_HOME: join(profile, 'cache'), TMPDIR: join(STATE, 'tmp') }, stdio: 'ignore' });
    const record = { input, child, logfile, config, argv, startedAt: new Date().toISOString(), exit: null };
    child.on('exit', (code, signal) => { record.exit = { code, signal }; log('luanti exit', child.pid, code, signal); });
    const controlRef = `dev-host:${child.pid}`; children.set(controlRef, record);
    log('luanti start', child.pid, argv.join(' '));
    // Ready when the engine reports its listening server for the world (not a guessed delay).
    for (;;) {
      const text = await readFile(logfile, 'utf8').catch(() => '');
      if (text.includes(' listening on ')) break;
      if (record.exit) throw Error(`LUANTI_EARLY_EXIT see ${logfile}`);
      await new Promise(y => setTimeout(y, 100));
    }
    return { controlRef, worldPath: input.worldPath };
  },
  record(q) {
    C.validateType('NativeControlQuery', q); const r = children.get(q.controlRef);
    if (!r || ['worldPath', 'requesterRef', 'operationRef'].some(k => q[k] !== r.input[k])) throw Error('DEV_HOST_UNKNOWN_CONTROL');
    return r;
  },
  async inspect(q) {
    const r = this.record(q);
    if (r.exit) throw Error('DEV_HOST_PROCESS_EXITED');
    process.kill(r.child.pid, 0);
    return C.validateType('NativeControlEvidence', { state: 'CURRENT', worldPath: r.input.worldPath, processId: r.child.pid, operationRef: r.input.operationRef });
  },
  async withStoppedWorld(q, consume) {
    const r = this.record(q), pid = r.child.pid;
    if (!r.exit) { const done = once(r.child, 'exit'); r.child.kill('SIGINT'); await done; }
    return consume(C.validateType('NativeControlEvidence', { state: 'STOPPED', worldPath: r.input.worldPath, processId: pid, operationRef: r.input.operationRef }));
  },
};

// ---- Cordis root with the Adapter plugin (no Canvas peer: this page makes no transaction or selection).
const routes = [];
const ctx = new Context();
ctx.provide('webServer', { register(route) { routes.push(route); return () => routes.splice(routes.indexOf(route), 1); } });
ctx.provide('dshHomePath', (...parts) => join(home, ...parts));
ctx.provide('hanaworldsNativeEngineControl', devHost);
const fiber = ctx.plugin({ name: 'hanaworlds-adapter-luanti', inject: adapter.inject, apply(c) { adapter.apply(c, { localWorldRoots: [worlds] }); } });
await fiber.await();
const local = ctx.get('hanaworldsLuantiLocalWorlds'), native = ctx.get('hanaworldsLuantiNativeFacts');

// ---- Sample world lifecycle, serialized.
let chain = Promise.resolve(), sample = null, lastReadback = null, lastError = null;
const serial = run => { const w = chain.then(run); chain = w.catch(() => {}); return w; };
const saved = join(STATE, 'last-readback.json');
lastReadback = JSON.parse(await readFile(saved, 'utf8').catch(() => 'null'));

async function ensureSample() {
  // Paired once per service: same-connection re-pair is unsupported by the Adapter, so a dead
  // engine shows up as the read's own CURRENT_WORLD_MISMATCH instead of being papered over.
  if (sample?.paired) return sample;
  const describe = await local.describeFlatWorldCreation({ requesterRef: REQUESTER, userPath: profile });
  let row = (await local.discover()).find(w => w.worldPath === join(worlds, SAMPLE));
  let created = null;
  if (!row) {
    if (!describe.ready) { const e = Error('SAMPLE_PREREQUISITE_MISSING'); e.details = describe.missing; throw e; }
    created = await local.createFlatWorld({ requesterRef: REQUESTER, userPath: profile, worldName: SAMPLE });
    row = (await local.discover()).find(w => w.connectionRef === created.connectionRef);
    log('sample created', created.worldPath);
  }
  const lease = await local.acquire({ connectionRef: row.connectionRef, requesterRef: REQUESTER, userPath: profile, action: 'BIND_RUNNING_WORLD' });
  const paired = await local.pair({ connectionRef: row.connectionRef, requesterRef: REQUESTER, leaseRef: lease.leaseRef });
  const rec = [...children.values()].at(-1);
  sample = { paired: true, worldPath: row.worldPath, worldName: SAMPLE, connectionRef: paired.connectionRef, worldRef: paired.worldRef,
    connectionIncarnationRef: paired.connectionIncarnationRef, payloadVersion: paired.payloadVersion, payloadDigest: paired.payloadDigest,
    nativeProcessId: lease.nativeProcessId, luantiLog: rec?.logfile, game: created?.game ?? null, mapgen: created?.mapgen ?? null };
  return sample;
}

async function readback() {
  const s = await ensureSample();
  const started = Date.now();
  const { read, surface, windows } = await readSurface((w, b) => native.readRegionState(w, b), s.worldRef,
    { cx: 0, cz: 0, radius: RADIUS }, C.expandRegionBlock);
  const result = {
    readbackId: `rb-${new Date().toISOString()}`, at: new Date().toISOString(), ms: Date.now() - started,
    world: { kind: 'SAMPLE_FIXTURE', ...s },
    spawn: { x: 0, z: 0, basis: '开发 Host 的 Luanti 配置未设 static_spawnpoint，这个新建示例世界也从未执行 /setworldspawn；此时 VoxeLibre mcl_spawn 把出生交给引擎，引擎在 x=0,z=0 附近找出生位置（随机偏移几格，在读取半径内）。' },
    port: 'hanaworldsLuantiNativeFacts.readRegionState', box: read.box,
    chunks: read.chunks.map(c => ({ chunkPos: c.chunkPos, availability: c.availability, loadMethod: c.loadMethod, unknownReason: c.unknownReason, stateDigest: c.stateDigest })),
    windows, facts: read.facts, surface,
  };
  const tmp = saved + '.tmp'; await writeFile(tmp, JSON.stringify(result)); await rename(tmp, saved);
  lastReadback = result; lastError = null;
  return result;
}

async function state() {
  const describe = await local.describeFlatWorldCreation({ requesterRef: REQUESTER, userPath: profile }).catch(e => ({ error: e.message }));
  const exists = (await local.discover()).some(w => w.worldPath === join(worlds, SAMPLE));
  const rec = [...children.values()].at(-1);
  return {
    service: { adapter: adapter.name, status: routes.length ? 'registered' : 'none', pid: process.pid, stateDir: STATE },
    worlds: [
      { id: 'sample', kind: 'SAMPLE_FIXTURE', label: '示例世界（本卡隔离 fixture，不是 owner 世界）', exists, worldPath: join(worlds, SAMPLE),
        running: !!(rec && !rec.exit), luantiPid: rec && !rec.exit ? rec.child.pid : null, paired: sample?.paired === true, prerequisites: describe },
      { id: 'owner', kind: 'REAL_OWNER_WORLD', label: '真实 owner 世界（HanaWorlds.app）', available: false,
        reason: '本开发网页没有真实世界的连接供给：owner 世界由 HanaWorlds.app 的 Host 启动并提供 hanaworldsNativeEngineControl，本网页不扫描、不启动、不读取 owner 的世界目录或 profile。接入真实世界属于整合前置（I-K3-REGION-01），需要 Desktop 公开的连接供给。' },
    ],
    lastReadback, lastError,
  };
}

// ---- HTTP: loopback only (127.0.0.1 and ::1 so both 127.0.0.1 and localhost open), routed by pathname.
const page = await readFile(join(here, 'page.html'));
const json = (res, code, v) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(v)); };
async function handle(req, res) {
  const pathname = new URL(req.url, 'http://loopback').pathname;
  try {
    if (pathname.startsWith('/api-hanaworlds-luanti/')) {
      const route = routes.find(r => pathname.startsWith(r.path)); if (route) return route.handler(Object.assign(req, { url: pathname }), res);
    }
    if (pathname === '/api/state' && req.method === 'GET') return json(res, 200, await serial(state));
    if (pathname === '/api/readback' && req.method === 'POST') {
      try { return json(res, 200, { ok: true, readback: await serial(readback) }); }
      catch (e) { lastError = { code: e.message, details: e.details ?? null, at: new Date().toISOString() }; log('readback failed', e.stack); return json(res, 200, { ok: false, error: lastError }); }
    }
    if (pathname.startsWith('/api/')) return json(res, 404, { error: 'NOT_FOUND', pathname });
    if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'METHOD_NOT_ALLOWED' });
    // Any other path (/, /index.html, /world/sample, trailing junk, query strings) recovers to the page.
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }); res.end(req.method === 'HEAD' ? undefined : page);
  } catch (e) { log('request failed', pathname, e.stack); json(res, 500, { error: e.message }); }
}
const servers = [];
for (const host of ['127.0.0.1', '::1']) {
  const s = createServer(handle);
  await new Promise((y, n) => { s.once('error', n); s.listen(PORT, host, y); });
  servers.push(s); log('listening', host, PORT);
}
async function shutdown(signal) {
  log('shutdown', signal);
  for (const s of servers) s.close();
  for (const r of children.values()) if (!r.exit) { r.child.kill('SIGINT'); await once(r.child, 'exit'); }
  process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT')); process.on('SIGTERM', () => shutdown('SIGTERM'));
