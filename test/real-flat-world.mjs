// Flat-world REAL_RUNTIME: own source or extracted package + Cordis 4.0.4 + real Luanti 5.17
// + the real game given by HW_GAME (VoxeLibre release directory, installed into this run's
// own Luanti user path exactly as Luanti installs games: games/<gameId>). The world is
// created only by the Adapter's public createFlatWorld; nothing in this file writes
// world.mt, map_meta.txt or the payload.
// Environment fixtures (labelled): the per-run Luanti user path with the game and WorldEdit
// installed, one pre-existing world that must stay untouched, and the Host lifecycle and
// Canvas callers as public peer fixtures. Observation fixture: `hw_probe`, added to the
// created world's worldmods after creation, records the one in-game pick a player would
// make and answers independent node reads inside the same Luanti process.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { cp, mkdir, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
const root = await realpath(process.env.HW_LOCAL_E);
const installed = process.env.HW_LOCAL_PACKAGE;
assert.ok(installed && process.env.HW_CORDIS_MODULE && process.env.HW_WORLDEDIT && process.env.HW_GAME,
  'HW_LOCAL_PACKAGE, HW_CORDIS_MODULE, HW_WORLDEDIT and HW_GAME are required');
const { apply, inject, payloadDigest } = await import(pathToFileURL(join(installed, 'src/index.mjs')));
const C = await import(pathToFileURL(join(installed, 'vendor/hanaworlds-contracts/dist/local/index.mjs')));
const { Context } = await import(pathToFileURL(process.env.HW_CORDIS_MODULE));
const D = (kind, v) => C.digestValue(kind, v).sha256;
const LUANTI = '/Applications/luanti.app/Contents/MacOS/luanti';
const profile = join(root, 'profile'), worlds = join(profile, 'worlds'), home = join(root, 'home');
for (const p of [worlds, home, join(profile, 'games'), join(profile, 'mods'), join(root, 'tmp')]) await mkdir(p, { recursive: true, mode: 0o700 });
await symlink(await realpath(process.env.HW_GAME), join(profile, 'games', 'mineclone2'));
await cp(process.env.HW_WORLDEDIT, join(profile, 'mods', 'worldedit'), { recursive: true });
await mkdir(join(worlds, 'existing-world'));
await writeFile(join(worlds, 'existing-world', 'world.mt'), 'gameid = mineclone2\nworld_name = existing-world\n');
await writeFile(join(worlds, 'existing-world', 'keep.txt'), 'pre-existing user world\n');
const sha = async p => createHash('sha256').update(await readFile(p)).digest('hex');
const existingBefore = { mt: await sha(join(worlds, 'existing-world/world.mt')), keep: await sha(join(worlds, 'existing-world/keep.txt')) };

async function freePort() { const s = createServer(); await new Promise(y => s.listen(0, '127.0.0.1', y)); const n = s.address().port; await new Promise(y => s.close(y)); return n; }
const config = join(root, 'luanti.conf');
// Per-run engine config only (as the Host's). It sets no mapgen: the world carries its own.
await writeFile(config, `port = ${await freePort()}\nbind_address = 127.0.0.1\nsecure.http_mods = hanaworlds_adapter\nserver_announce = false\nenable_damage = false\n`);
const processes = [], calls = [], events = []; let child, stage = 0, hostInput, world;
async function waitReady(log, ready) {
  const until = Date.now() + 120000;
  while (Date.now() < until) {
    const s = await readFile(log, 'utf8').catch(() => '');
    if (s.includes(ready)) return;
    if (child.exitCode !== null || child.signalCode !== null) throw Error(`LUANTI_EARLY_EXIT see ${log}`);
    await new Promise(y => setTimeout(y, 100));
  }
  throw Error(`LUANTI_READY_TIMEOUT waiting for ${ready} in ${log}`);
}
async function stop() {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const pending = once(child, 'exit'); child.kill('SIGINT'); const [code, signal] = await pending;
  processes.at(-1).exitCode = code; processes.at(-1).signal = signal; assert.equal(code, 0);
}
const host = { // Public NativeControl peer fixture controlling the real own process.
  async acquire(input) {
    C.validateType('NativeControlInput', input); assert.equal(input.worldPath, world); assert.equal(input.userPath, profile);
    const log = join(root, `luanti-${++stage}.log`), out = join(root, `luanti-${stage}-stdio.log`); let text = '';
    const argv = ['--server', '--world', world, '--config', config, '--logfile', log];
    child = spawn(LUANTI, argv, { env: { ...process.env, HOME: profile, LUANTI_USER_PATH: profile, XDG_CACHE_HOME: join(profile, 'cache'), TMPDIR: join(root, 'tmp') }, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', b => { text += b; }); child.stderr.on('data', b => { text += b; });
    child.on('exit', (code, signal) => { void writeFile(out, text); const item = processes.find(p => p.pid === child.pid); if (item) { item.exitCode = code; item.signal = signal; } });
    processes.push({ pid: child.pid, worldPath: world, operationRef: input.operationRef, argv });
    await waitReady(log, 'HW_FLAT_READY=true'); hostInput = input; return { controlRef: `real:${child.pid}`, worldPath: world };
  },
  async inspect(q) {
    assert.equal(q.controlRef, `real:${child.pid}`); assert.equal(q.operationRef, hostInput.operationRef); assert.equal(q.worldPath, world);
    process.kill(child.pid, 0); assert.equal(child.exitCode, null);
    return C.validateType('NativeControlEvidence', { state: 'CURRENT', worldPath: world, processId: child.pid, operationRef: q.operationRef });
  },
  async withStoppedWorld(q, consume) {
    await this.inspect(q); const pid = child.pid; await stop(); events.push({ event: 'STOPPED_CALLBACK', pid, worldPath: world });
    return consume(C.validateType('NativeControlEvidence', { state: 'STOPPED', worldPath: world, processId: pid, operationRef: q.operationRef }));
  },
};
const ctx = new Context(); let localContext, history;
ctx.provide('webServer', { register() { return () => {}; } });
ctx.provide('dshHomePath', (...parts) => join(home, ...parts));
ctx.provide('hanaworldsNativeEngineControl', host);
ctx.provide('hanaworldsWorldRevisionOracle', { read: async () => 'fixture-canvas-world-head-1' });
ctx.provide('hanaworldsCanvasFootprintRegistry', { readFootprints: async worldRef => ({ current: true, durable: true, worldRef, objects: [] }) });
ctx.provide('hanaworldsCanvasHistoryFacts', { read: async () => history });
let canvas;
const adapterFiber = ctx.plugin({ name: 'hanaworlds-adapter-luanti', inject, apply(c) { apply(c, { localWorldRoots: [worlds] }); } });
await adapterFiber.await();
const canvasFiber = ctx.plugin({ name: 'hanaworlds-canvas', apply(c) { canvas = c; c.provide('hanaworldsCanvasV5', { call(name, r) {
  assert.equal(name, 'ReadWorldSelectionContext'); C.validateBoundRequest('canvas/v5', name, r);
  return C.validateBoundResponse('canvas/v5', name, r, { contractVersion: 'canvas/v5', requestId: r.requestId, error: null, result: {
    sessionRef: r.sessionRef, worldRef: r.worldRef, inventory: { capabilityRevision: 'fixture-inventory-1', connections: [] },
    selection: { status: 'BOUND', connectionRef: localContext.connectionRef, context: { currentSession: r.sessionRef, activeWorldRef: localContext.worldRef,
      orderedSelectedObjectRefs: [], sessionRevision: 'fixture-session-1', selectionRevision: localContext.selectionRevision, localContext } } } });
} }); } });
await canvasFiber.await();
canvas.fiber.entry = { options: { name: 'hanaworlds-canvas' } }; // same origin metadata the Host Loader supplies
const local = ctx.get('hanaworldsLuantiLocalWorlds'), native = ctx.get('hanaworldsLuantiNativeFacts');
const check = (event, detail = {}) => { events.push({ event, ...detail }); console.log('PASS', event); };
async function engine(query) {
  await rm(join(world, 'probe-answer.json'), { force: true });
  await writeFile(join(world, 'probe-query.json'), JSON.stringify(query));
  const until = Date.now() + 20000;
  while (Date.now() < until) {
    const raw = await readFile(join(world, 'probe-answer.json'), 'utf8').catch(() => null);
    if (raw) return JSON.parse(raw);
    await new Promise(y => setTimeout(y, 100));
  }
  throw Error('PROBE_ANSWER_TIMEOUT');
}
const W = 'world-adapter-region/v1';
let seq = 0;
const req0 = () => ({ contractVersion: W, sessionRef: 'fixture-session', requestId: `req-${++seq}`, worldRef: localContext.worldRef, localContext });
async function io(name, request) {
  const port = canvas.get('hanaworldsWorldAdapterRegionV1'), started = Date.now();
  const response = await port.call(name, request);
  calls.push({ name, requestId: request.requestId, purpose: request.purpose, box: request.box, ms: Date.now() - started,
    error: response.error, chunks: response.result?.chunks?.length, facts: port.lastFacts() });
  return response;
}
const readR = async (box, purpose = 'BEFORE_IMAGE') => {
  const req = { ...req0(), box, purpose }, res = await io('ReadRegion', req);
  assert.equal(res.error, null, JSON.stringify(res.error)); C.validateRegionRead(req, res); return res.result;
};
// Node name at a world position from a KNOWN region read (VoxelArea order, X fastest).
function nodeAt(read, [x, y, z]) {
  for (const c of read.chunks) {
    const { min, max } = c.box;
    if (x < min[0] || x > max[0] || y < min[1] || y > max[1] || z < min[2] || z > max[2]) continue;
    const b = C.expandRegionBlock(c.state.block), [sx, sy] = b.size, o = c.state.block.origin;
    return b.palette[b.indices[(x - o[0]) + (y - o[1]) * sx + (z - o[2]) * sx * sy]];
  }
  throw Error(`no chunk covers ${x},${y},${z}`);
}
const v6 = async (name, input) => { const r = await canvas.get('hanaworldsWorldAdapterV6').call(name, input); calls.push({ name, requestId: input.requestId, error: r.error }); return r; };
const ok6 = async (name, input) => { const r = await v6(name, input); assert.equal(r.error, null, JSON.stringify(r.error)); return r.result; };
const results = {};
try {
  // 1. The plugin describes what it will use and what is missing, then creates the world itself.
  const userPath = profile;
  const described = await local.describeFlatWorldCreation({ requesterRef: 'fixture-host', userPath });
  assert.equal(described.ready, true, JSON.stringify(described.missing));
  results.described = described;
  const before = (await local.discover()).map(w => w.connectionRef);
  await assert.rejects(local.createFlatWorld({ requesterRef: 'fixture-host', userPath, worldName: 'existing-world' }), e => e.message === 'WORLD_EXISTS');
  assert.deepEqual((await local.discover()).map(w => w.connectionRef), before);
  const created = await local.createFlatWorld({ requesterRef: 'fixture-host', userPath });
  results.created = created; world = created.worldPath;
  assert.equal(created.game.gameId, 'mineclone2'); assert.equal(created.mapgen.mg_name, 'flat');
  assert.equal(created.payloadDigest, await payloadDigest());
  const after = await local.discover();
  assert.deepEqual(after.filter(w => !before.includes(w.connectionRef)).map(w => w.connectionRef), [created.connectionRef]);
  check('CREATED_BY_PLUGIN', { connectionRef: created.connectionRef, game: created.game, mapgen: created.mapgen, existingRejected: 'WORLD_EXISTS' });

  // Observation fixture only (see header).
  const probe = join(world, 'worldmods/hw_probe'); await mkdir(probe);
  await writeFile(join(probe, 'mod.conf'), 'name = hw_probe\noptional_depends = hanaworlds_adapter\n');
  await writeFile(join(probe, 'init.lua'), `
local path=minetest.get_worldpath()
local function answer()
  local f=io.open(path .. '/probe-query.json','r')
  if f then
    local q=minetest.parse_json(f:read('*a')); f:close(); os.remove(path .. '/probe-query.json')
    local out={mg_name=minetest.get_mapgen_setting('mg_name'),classic=minetest.get_mapgen_setting('mcl_superflat_classic'),nodes={}}
    for i,p in ipairs(q.read or {}) do
      local pos={x=p[1],y=p[2],z=p[3]}; minetest.load_area(pos)
      local n=minetest.get_node_or_nil(pos)
      out.nodes[i]={pos=p,name=n and n.name or 'UNLOADED',light=minetest.get_node_light(pos,0.5) or -1}
    end
    if q.pick then
      local a=rawget(_G,'hanaworlds_adapter')
      local m=minetest.parse_json(io.open(minetest.get_modpath('hanaworlds_adapter') .. '/payload.json','r'):read('*a'))
      minetest.load_area({x=q.pick[1]-16,y=q.pick[2]-16,z=q.pick[3]-16},{x=q.pick[1]+31,y=q.pick[2]+31,z=q.pick[3]+31})
      out.picked=a.record_pick(q.pickRef,q.sessionRef,m.worldRef,q.pick,0)
    end
    minetest.safe_file_write(path .. '/probe-answer.json',minetest.write_json(out))
  end
  minetest.after(0.1,answer)
end
minetest.after(0,function() answer(); minetest.log('action','HW_FLAT_READY=' .. tostring(rawget(_G,'hanaworlds_adapter')~=nil)) end)
`);

  // 2. Bind the created world (its connectionRef straight from the creation result) and pair.
  const opened = await local.acquire({ connectionRef: created.connectionRef, requesterRef: 'fixture-host', userPath, action: 'BIND_RUNNING_WORLD' });
  const paired = await local.pair({ connectionRef: created.connectionRef, requesterRef: 'fixture-host', leaseRef: opened.leaseRef });
  assert.equal(paired.worldRef, created.worldRef); assert.equal(paired.payloadDigest, created.payloadDigest);
  localContext = { connectionRef: paired.connectionRef, connectionIncarnationRef: paired.connectionIncarnationRef, worldRef: paired.worldRef, selectionRevision: 'fixture-selection-1' };
  const connection = await ok6('ReadLocalConnection', { contractVersion: 'world-adapter/v6', sessionRef: 'fixture-session', requestId: 'connection', connectionRef: paired.connectionRef });
  assert.equal(connection.worldRef, created.worldRef);
  check('BOUND_AND_PAIRED_CREATED_WORLD', { paired, capabilities: connection.capabilities });

  // 3. Real game identity and surface materials from the running engine.
  const catalogue = await native.readCatalogue(paired.worldRef);
  const surface = ['mcl_core:dirt_with_grass', 'mcl_core:dirt', 'mcl_core:bedrock'];
  const registered = new Set(Object.keys(catalogue.nodes));
  assert.equal(catalogue.gameId, 'mineclone2'); assert.ok(surface.every(n => registered.has(n)), 'surface nodes registered');
  results.catalogue = { gameId: catalogue.gameId, gameRevision: catalogue.gameRevision, nodes: registered.size, profileVersion: catalogue.profileVersion,
    engineProfile: catalogue.engineProfile, modRevisions: Object.keys(catalogue.modRevisions).length, surface: Object.fromEntries(surface.map(n => [n, catalogue.nodes[n]])) };
  let materials;
  try { materials = await native.readMaterialSources(paired.worldRef); results.materials = { sourceRevision: materials.snapshot?.sourceRevision,
    surface: (materials.snapshot?.materials ?? materials.materials ?? []).filter(m => surface.includes(m.nodeName)).map(m => ({ ...m, textureBytes: undefined })) }; }
  catch (error) { results.materials = { error: error.message }; } // recorded as is; not part of the flat-world claim
  // G3: hasPersistentState from the loaded registry, consumed by the public Contracts
  // static-material rule (per-cell BUILD materials and region palettes use the same rule).
  const fact = n => ({ hasPersistentState: catalogue.nodes[n].hasPersistentState, hasCallbacks: catalogue.nodes[n].hasCallbacks,
    allowedParam2: catalogue.nodes[n].allowedParam2, unknownFields: catalogue.nodes[n].unknownFields });
  const provenFalse = Object.keys(catalogue.nodes).filter(n => catalogue.nodes[n].hasPersistentState === false).sort();
  assert.ok(Object.values(catalogue.nodes).every(v => v.hasPersistentState !== true), 'never published as true');
  assert.equal(catalogue.nodes.ignore.hasPersistentState, null, 'engine placeholder is not a cell node');
  assert.equal(catalogue.nodes.air.hasPersistentState, false); assert.ok(!catalogue.nodes.air.unknownFields.includes('hasPersistentState'));
  assert.equal(catalogue.nodes['mcl_core:stone'].hasPersistentState, null); assert.ok(catalogue.nodes['mcl_core:stone'].unknownFields.includes('hasPersistentState'));
  const air = { nodeName: 'air', param2: 0 }, stone = { nodeName: 'mcl_core:stone', param2: 0 };
  const g3 = { air: fact('air'), stone: fact('mcl_core:stone'), provenFalse, provenFalseCount: provenFalse.length, nodes: registered.size };
  g3.perCellAir = (C.validateStaticMaterials({ m: air }, catalogue), 'ADMITTED');
  g3.perCellStone = (() => { try { C.validateStaticMaterials({ m: stone }, catalogue); return 'ADMITTED'; } catch (e) { return `${e.code ?? e.message}/${e.reason ?? ''}`; } })();
  assert.equal(g3.perCellStone.startsWith('UNSUPPORTED_MUTATION_SEMANTICS'), true);
  const block = palette => C.encodeRegionBlock({ origin: [0, 0, 0], size: [palette.length, 1, 1], palette, indices: Int32Array.from(palette.map((_, i) => i)) });
  g3.regionAirPalette = (C.validateRegionPalette(block([air]), catalogue), 'ADMITTED');
  g3.regionAirStonePalette = (() => { try { C.validateRegionPalette(block([air, stone]), catalogue); return 'ADMITTED'; } catch (e) { return `${e.code ?? e.message}/${e.reason ?? ''}`; } })();
  assert.equal(g3.regionAirStonePalette.startsWith('UNSUPPORTED_MUTATION_SEMANTICS'), true);
  results.g3 = g3;
  check('G3_PERSISTENT_STATE_FACTS_AND_CONTRACT_ADMISSION', { air: g3.air, stone: g3.stone, provenFalseCount: g3.provenFalseCount,
    perCellAir: g3.perCellAir, perCellStone: g3.perCellStone, regionAirPalette: g3.regionAirPalette, regionAirStonePalette: g3.regionAirStonePalette });
  check('GAME_IDENTITY_AND_SURFACE_MATERIALS', { gameId: catalogue.gameId, gameRevision: catalogue.gameRevision, materials: results.materials.error ?? 'read' });

  // 4. Load adjacent mapblocks through the Adapter and read back a flat surface.
  const box = { min: [-24, 0, -24], max: [39, 15, 39] }; // 5 x 1 x 5 mapblocks
  const r0 = await readR(box); C.requireKnownRegion(r0); assert.equal(r0.chunks.length, 25);
  const loadMethods = [...new Set(r0.chunks.map(c => c.loadMethod))];
  const tops = new Map();
  for (let x = box.min[0]; x <= box.max[0]; x++) for (let z = box.min[2]; z <= box.max[2]; z++) {
    let top = null; for (let y = box.max[1]; y >= box.min[1]; y--) { const n = nodeAt(r0, [x, y, z]); if (n.nodeName !== 'air') { top = [y, n.nodeName]; break; } }
    const key = top ? top.join(':') : 'none'; tops.set(key, (tops.get(key) ?? 0) + 1);
  }
  assert.deepEqual([...tops.keys()], ['8:mcl_core:dirt_with_grass'], JSON.stringify([...tops]));
  const column = [9, 8, 7, 6, 5].map(y => nodeAt(r0, [0, y, 0]).nodeName);
  assert.deepEqual(column, ['air', 'mcl_core:dirt_with_grass', 'mcl_core:dirt', 'mcl_core:dirt', 'mcl_core:bedrock']);
  const seen = await engine({ read: [[0, 8, 0], [37, 8, -22], [-20, 7, 30], [0, 9, 0]] });
  assert.equal(seen.mg_name, 'flat'); assert.equal(seen.classic, 'true');
  assert.deepEqual(seen.nodes.map(n => n.name), ['mcl_core:dirt_with_grass', 'mcl_core:dirt_with_grass', 'mcl_core:dirt', 'air']);
  check('FLAT_SURFACE_READBACK', { columns: 64 * 64, tops: Object.fromEntries(tops), column, loadMethods, engine: seen });

  // 5a. Normal G3 path: a carve whose air-only palette passed the public Contracts check.
  const carvePalette = [air];
  const carve = (x, y, z) => (x >= -10 && x <= -8 && z >= 20 && z <= 22 && y >= 7 && y <= 8) ? 0 : -1;
  const cw = [], ce = [];
  for (const c of r0.chunks) {
    const { min, max } = c.box, size = max.map((v, i) => v - min[i] + 1), indices = new Int32Array(size[0] * size[1] * size[2]);
    let i = 0, any = false;
    for (let z = min[2]; z <= max[2]; z++) for (let y = min[1]; y <= max[1]; y++) for (let x = min[0]; x <= max[0]; x++) { indices[i] = carve(x, y, z); any ||= indices[i] !== -1; i++; }
    if (!any) continue;
    const ops = C.validateRegionPalette(C.encodeRegionBlock({ origin: min, size, palette: carvePalette, indices }), catalogue);
    cw.push({ chunkPos: c.chunkPos, expectedCurrentDigest: c.stateDigest, ops, state: null });
    ce.push(D('region-state', C.expectedRegionState(c.state, ops)));
  }
  const creq = { ...req0(), transactionId: 'flat-carve-1', purpose: 'APPLY', writes: cw }, cres = await io('WriteRegion', creq);
  assert.equal(cres.error, null, JSON.stringify(cres.error)); assert.equal(C.validateRegionWrite(creq, cres).allWritten, true);
  cres.result.chunks.forEach((c, i) => assert.equal(c.readbackDigest, ce[i]));
  const rc = await readR(box, 'READBACK');
  assert.equal(nodeAt(rc, [-9, 8, 21]).nodeName, 'air'); assert.equal(nodeAt(rc, [-9, 6, 21]).nodeName, 'mcl_core:dirt');
  check('G3_CONTRACT_ADMITTED_AIR_CARVE', { chunks: cw.length, lighting: cres.result.lighting });

  // 5. Adapter transport regression (Contracts would reject stone today, see G3): dig a pit and raise a stone pillar.
  const palette = [{ nodeName: 'air', param2: 0 }, { nodeName: 'mcl_core:stone', param2: 0 }];
  const rule = (x, y, z) => (x >= 14 && x <= 17 && z >= 14 && z <= 17 && y >= 6 && y <= 8) ? 0 : (x === -3 && z === -3 && y >= 9 && y <= 12) ? 1 : -1;
  const writes = [], expected = [];
  for (const c of rc.chunks) { // current states after the carve
    const { min, max } = c.box, size = max.map((v, i) => v - min[i] + 1), indices = new Int32Array(size[0] * size[1] * size[2]);
    let i = 0, any = false;
    for (let z = min[2]; z <= max[2]; z++) for (let y = min[1]; y <= max[1]; y++) for (let x = min[0]; x <= max[0]; x++) { indices[i] = rule(x, y, z); any ||= indices[i] !== -1; i++; }
    if (!any) continue;
    const ops = C.encodeRegionBlock({ origin: min, size, palette, indices });
    writes.push({ chunkPos: c.chunkPos, expectedCurrentDigest: c.stateDigest, ops, state: null });
    expected.push(D('region-state', C.expectedRegionState(c.state, ops)));
  }
  const wreq = { ...req0(), transactionId: 'flat-region-1', purpose: 'APPLY', writes }, wres = await io('WriteRegion', wreq);
  assert.equal(wres.error, null, JSON.stringify(wres.error));
  const written = C.validateRegionWrite(wreq, wres); assert.equal(written.allWritten, true); assert.equal(written.committed, false);
  wres.result.chunks.forEach((c, i) => assert.equal(c.readbackDigest, expected[i]));
  const r1 = await readR(box, 'READBACK');
  assert.equal(nodeAt(r1, [15, 7, 15]).nodeName, 'air'); assert.equal(nodeAt(r1, [15, 5, 15]).nodeName, 'mcl_core:bedrock');
  assert.equal(nodeAt(r1, [-3, 12, -3]).nodeName, 'mcl_core:stone'); assert.equal(nodeAt(r1, [-3, 13, -3]).nodeName, 'air');
  const seen5 = await engine({ read: [[15, 6, 15], [-3, 11, -3], [18, 8, 18]] });
  assert.deepEqual(seen5.nodes.map(n => n.name), ['air', 'mcl_core:stone', 'mcl_core:dirt_with_grass']);
  check('REGION_EDIT_ON_FLAT_TERRAIN', { chunks: writes.length, lighting: wres.result.lighting, engine: seen5 });

  // 6. Per-cell transport regression on the same world and connection (stone: transport only, see G3).
  const picked = await engine({ pick: [0, 8, 0], pickRef: 'fixture-pick', sessionRef: 'fixture-session' });
  assert.equal(picked.picked, true);
  const base = () => ({ contractVersion: 'world-adapter/v6', sessionRef: 'fixture-session', worldRef: localContext.worldRef, localContext });
  const region = await ok6('InspectRegion', { ...base(), requestId: 'inspect', inspectionId: 'inspect-1', expectedWorldRevision: 'fixture-canvas-world-head-1',
    anchor: { kind: 'PICKED_POINT', pickRef: 'fixture-pick' }, footprint: { widthCells: 1, depthCells: 1, heightCells: 1 },
    placementSettings: { frontGapCells: 2, forwardSearchCells: 16, lateralSearchCells: 8, verticalSearchCells: 4, settingsRevision: 'fixture-settings-1' } });
  assert.equal(region.outcome, 'REGION_INSPECTED');
  const positions = [[1, 9, 1], [2, 9, 1]];
  const actual = await native.readScopedState(paired.connectionRef, positions);
  const operations = { contractVersion: 'operations/v3', buildDigest: '1'.repeat(64), compilerRevision: 'fixture-brush', compilationConfigDigest: '2'.repeat(64), worldRef: paired.worldRef,
    frameDigest: region.inspection.targetFacts.frameDigest, catalogueDigest: region.inspection.targetFacts.catalogueDigest, targetFactsDigest: region.inspection.targetFactsDigest,
    effects: positions.map(position => ({ position, nodeName: 'mcl_core:stone', param2: 0 })) };
  const operationDigest = D('operations', operations);
  const scope = { transactionId: 'cell-1', worldRef: paired.worldRef, operationDigest, stateProfile: actual.stateProfile, checkedPositions: positions, objects: [], cells: actual.cells, localContext };
  const preq = { ...base(), requestId: 'prepare-cell-1', transactionId: 'cell-1', operationDigest, operations, scope, scopeDigest: D('scoped-world', scope), guarantee: 'RECOVERABLE_VERIFIED' };
  const prepared = await ok6('PrepareRecoverableTransaction', preq);
  const receipt = await ok6('ApplyCompiledTransaction', { ...preq, requestId: 'apply-cell-1', preparedTransaction: C.projectScopedPreparedTransaction(prepared) });
  assert.equal(receipt.status, 'VERIFIED');
  const readback = await ok6('Readback', { ...base(), requestId: 'readback-cell-1', transactionId: 'cell-1', coveredPositions: positions, stateProfile: prepared.stateProfile });
  assert.ok(readback.projection.records.every(r => r.nodeName === 'mcl_core:stone')); assert.equal(readback.readbackDigest, receipt.readbackDigest);
  const rCell = await readR(box, 'READBACK'); assert.equal(nodeAt(rCell, [1, 9, 1]).nodeName, 'mcl_core:stone'); // same cell through the region transport
  const undo = { ...base(), requestId: 'prepare-undo', originTransactionId: 'cell-1', transactionId: 'undo-cell-1', direction: 'UNDO', affectedObjectRefs: [],
    originVerifiedReceiptDigest: D('receipt', receipt), originBeforeImageDigest: prepared.beforeImageDigest, originBeforeStateReadbackDigest: prepared.beforeStateReadbackDigest,
    originAfterReadbackDigest: receipt.readbackDigest, expectedHistoryRevision: 'fixture-history-1', expectedWorldRevision: 'fixture-canvas-world-head-1', expectedObjectRevisions: {},
    expectedCurrentStateDigest: receipt.readbackDigest, targetStateDigest: prepared.beforeStateReadbackDigest, guarantee: 'RECOVERABLE_VERIFIED' };
  undo.historyOperationDigest = D('history-operation', Object.fromEntries(Object.keys(C.schemaBundle.definitions.HistoryOperationProjection.properties).map(k => [k, undo[k]])));
  history = { current: true, durable: true, worldRef: paired.worldRef, originTransactionId: 'cell-1', historyRevision: undo.expectedHistoryRevision, worldRevision: undo.expectedWorldRevision,
    objectRevisions: {}, affectedObjectRefs: [], originVerifiedReceiptDigest: undo.originVerifiedReceiptDigest };
  const up = await ok6('PrepareHistoryTransaction', undo);
  const ur = await ok6('ApplyHistoryTransaction', { ...base(), requestId: 'apply-undo', originTransactionId: 'cell-1', transactionId: 'undo-cell-1', direction: 'UNDO',
    historyOperationDigest: undo.historyOperationDigest, expectedWorldRevision: undo.expectedWorldRevision, expectedObjectRevisions: {}, preparedHistoryTransaction: up });
  assert.equal(ur.status, 'VERIFIED'); assert.equal(ur.readbackDigest, undo.targetStateDigest);
  const rUndo = await readR(box, 'READBACK'); assert.equal(nodeAt(rUndo, [1, 9, 1]).nodeName, 'air');
  check('PER_CELL_SAME_CONNECTION', { stateProfile: actual.stateProfile.profileVersion, receipt: receipt.status, undo: ur.status });

  // 7. Still-unknown space is rejected before any write: the band between Luanti's last
  //    generated mapchunk and this world's mapgen_limit (31000) is never generated.
  const out = { min: [30960, 0, 30960], max: [31000, 4, 31000] };
  const u = await readR(out, 'INSPECT');
  assert.ok(u.chunks.every(c => c.availability === 'UNKNOWN'), JSON.stringify(u.chunks.map(c => [c.chunkPos, c.availability, c.unknownReason])));
  assert.throws(() => C.requireKnownRegion(u), /TARGET_FACTS_INCOMPLETE/);
  const uw = await io('WriteRegion', { ...req0(), transactionId: 'unknown-1', purpose: 'APPLY', writes: u.chunks.map(c => ({ chunkPos: c.chunkPos, expectedCurrentDigest: '0'.repeat(64),
    ops: C.encodeRegionBlock({ origin: c.box.min, size: c.box.max.map((v, i) => v - c.box.min[i] + 1), palette, indices: new Int32Array((c.box.max[0] - c.box.min[0] + 1) * (c.box.max[1] - c.box.min[1] + 1) * (c.box.max[2] - c.box.min[2] + 1)).fill(1) }), state: null })) });
  assert.equal(uw.error.code, 'TARGET_FACTS_INCOMPLETE');
  check('UNKNOWN_REJECTED', { reasons: [...new Set(u.chunks.map(c => c.unknownReason))], error: uw.error });
} finally {
  await adapterFiber.dispose(); await canvasFiber.dispose(); await stop();
  if (world) {
    results.afterStop = { mapMeta: (await readFile(join(world, 'map_meta.txt'), 'utf8').catch(() => '')).split('\n')
      .filter(l => /^(mg_name|seed|mgflat_spflags|mgflat_ground_level|mg_flags|mcl_superflat_classic|vl_world_version|water_level|chunksize|mapgen_limit) =/.test(l)),
      worldMt: await readFile(join(world, 'world.mt'), 'utf8').catch(() => null) };
  }
  results.existingWorld = { unchanged: existingBefore.mt === await sha(join(worlds, 'existing-world/world.mt')) && existingBefore.keep === await sha(join(worlds, 'existing-world/keep.txt')),
    entries: (await readdir(join(worlds, 'existing-world'))).sort() };
  results.worldsDir = (await readdir(worlds)).sort();
  await writeFile(join(root, 'results.json'), JSON.stringify(results, null, 2) + '\n');
  await writeFile(join(root, 'calls.json'), JSON.stringify(calls, null, 2) + '\n');
  await writeFile(join(root, 'processes.json'), JSON.stringify(processes, null, 2) + '\n');
  await writeFile(join(root, 'events.json'), JSON.stringify(events, null, 2) + '\n');
}
assert.equal(results.existingWorld.unchanged, true); assert.deepEqual(results.existingWorld.entries, ['keep.txt', 'world.mt']);
assert.ok(results.afterStop.mapMeta.includes('mg_name = flat') && results.afterStop.mapMeta.includes('mcl_superflat_classic = true'));
console.log('REAL_RUNTIME flat world: own package, real Luanti, real game; Host/Canvas public peer FIXTURE, hw_probe observation FIXTURE');
