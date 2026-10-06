// Region I/O REAL_RUNTIME: own source or extracted package + Cordis 4.0.4 + real Luanti 5.17.
// The game `hw_region_fixture` is an explicit COMPONENT FIXTURE, never the product game.
// Host lifecycle and the Canvas caller are public peer fixtures; the Canvas fixture only
// answers ReadWorldSelectionContext and calls the public world-adapter-region/v1 port
// (hanaworldsWorldAdapterRegionV1). Expected after-states are computed with the public
// contract helper expectedRegionState, exactly as the Canvas side would.
// Independent engine attestation comes from the hw_probe mod (node/light reads and write
// counters taken inside the same Luanti process, outside the Adapter payload).
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, writeFile, readFile, cp, realpath, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:net';
import { once } from 'node:events';
const root = await realpath(process.env.HW_LOCAL_E);
const installed = process.env.HW_LOCAL_PACKAGE;
assert.ok(installed && process.env.HW_CORDIS_MODULE && process.env.HW_WORLDEDIT, 'HW_LOCAL_PACKAGE, HW_CORDIS_MODULE and HW_WORLDEDIT are required');
const { apply, inject, payloadDigest } = await import(pathToFileURL(join(installed, 'src/index.mjs')));
const C = await import(pathToFileURL(join(installed, 'vendor/hanaworlds-contracts/dist/local/index.mjs')));
const { Context } = await import(pathToFileURL(process.env.HW_CORDIS_MODULE));
const LUANTI = '/Applications/luanti.app/Contents/MacOS/luanti';
const profile = join(root, 'profile'), world = join(profile, 'worlds', 'current'), home = join(root, 'home');
const game = join(profile, 'games', 'hw_region_fixture'), base = join(game, 'mods', 'base');
for (const p of [world, home, base, join(root, 'tmp')]) await mkdir(p, { recursive: true, mode: 0o700 });
await writeFile(join(game, 'game.conf'), 'title = HanaWorlds region-io COMPONENT FIXTURE (not a product game)\n');
await writeFile(join(base, 'mod.conf'), 'name = base\n');
await writeFile(join(base, 'init.lua'), [
  "core.register_node('base:stone',{tiles={'unknown_node.png'}})",
  "core.register_node('base:dirt',{tiles={'unknown_node.png'}})",
  "core.register_node('base:rotated',{paramtype2='facedir',tiles={'unknown_node.png'}})",
  "core.register_node('base:chest',{tiles={'unknown_node.png'}})",
  "core.register_node('base:timer',{tiles={'unknown_node.png'},on_timer=function() return false end})",
  '',
].join('\n'));
await writeFile(join(world, 'world.mt'), 'gameid = hw_region_fixture\nbackend = sqlite3\nplayer_backend = sqlite3\nauth_backend = sqlite3\nmod_storage_backend = sqlite3\n');
await mkdir(join(world, 'worldmods'), { recursive: true });
await cp(process.env.HW_WORLDEDIT, join(world, 'worldmods/worldedit'), { recursive: true });
const probe = join(world, 'worldmods/hw_probe'); await mkdir(probe);
await writeFile(join(probe, 'mod.conf'), 'name = hw_probe\ndepends = worldedit, base\noptional_depends = hanaworlds_adapter\n');
await writeFile(join(probe, 'init.lua'), `
local path=minetest.get_worldpath()
local counts={vm_write=0,fix_light=0,set_node=0,worldedit_set=0}
local function save() minetest.safe_file_write(path .. '/probe-counts.json',minetest.write_json(counts)) end
-- VoxelManip writes, counted on the engine's own method table (a VoxelManip
-- cannot be created during mod init, so the hook is installed on the first step).
local function hook_vm()
  -- Luanti exposes the method table itself through __metatable.
  local mt=getmetatable(minetest.get_voxel_manip())
  local index=type(mt)=='table' and (type(mt.write_to_map)=='function' and mt or mt.__index)
  if type(index)=='table' and type(index.write_to_map)=='function' then
    local original=index.write_to_map
    index.write_to_map=function(...) counts.vm_write=counts.vm_write+1; save(); return original(...) end
    counts.vm_hook='installed'
  else counts.vm_hook='unavailable' end
end
for _,n in ipairs({'set_node','swap_node','bulk_set_node','add_node','remove_node'}) do
  local old=minetest[n]
  minetest[n]=function(...) counts.set_node=counts.set_node+1; save(); return old(...) end
end
local we=worldedit.set
worldedit.set=function(...) counts.worldedit_set=counts.worldedit_set+1; save(); return we(...) end
-- fix_light wrapper; a pending probe-conflict file makes one concurrent engine
-- change right after a region write, as another mod or player would.
local old_light=minetest.fix_light
local raw_set=minetest.set_node
minetest.fix_light=function(p,q)
  counts.fix_light=counts.fix_light+1; save()
  local r=old_light(p,q)
  local f=io.open(path .. '/probe-conflict','r')
  if f then local t=minetest.parse_json(f:read('*a')); f:close(); os.remove(path .. '/probe-conflict')
    raw_set({x=t[1],y=t[2],z=t[3]},{name='base:dirt'})
    counts.set_node=counts.set_node-1
    minetest.log('action','HW_PROBE_CONFLICT_INJECTED') end
  return r
end
-- Independent engine reads requested by the harness.
local function answer()
  local f=io.open(path .. '/probe-query.json','r')
  if f then
    local q=minetest.parse_json(f:read('*a')); f:close(); os.remove(path .. '/probe-query.json')
    local out={}
    for i,p in ipairs(q) do
      local pos={x=p[1],y=p[2],z=p[3]}
      local n=minetest.get_node_or_nil(pos)
      out[i]={pos=p,name=n and n.name or 'UNLOADED',param2=n and n.param2 or -1,
        light=minetest.get_node_light(pos,0.5) or -1,param1=n and n.param1 or -1,
        owner=minetest.get_meta(pos):get_string('owner'),timer=minetest.get_node_timer(pos):get_timeout()}
    end
    minetest.safe_file_write(path .. '/probe-answer.json',minetest.write_json(out))
  end
  minetest.after(0.1,answer)
end
minetest.after(0,function()
  hook_vm()
  save()
  minetest.emerge_area({x=-64,y=-16,z=-64},{x=79,y=15,z=79},function(_,_,remaining)
    if remaining~=0 then return end
    minetest.emerge_area({x=192,y=0,z=192},{x=207,y=15,z=207},function(_,_,left)
      if left~=0 then return end
      raw_set({x=200,y=0,z=200},{name='base:timer'})
      minetest.get_node_timer({x=200,y=0,z=200}):start(100000)
    end)
    raw_set({x=40,y=2,z=40},{name='base:chest'})
    minetest.get_meta({x=40,y=2,z=40}):set_string('owner','fixture')
    raw_set({x=41,y=2,z=40},{name='base:timer'})
    raw_set({x=-40,y=2,z=-40},{name='base:chest'})
    minetest.get_meta({x=-40,y=2,z=-40}):set_string('owner','fixture-restore')
    answer()
    minetest.log('action','HW_LOCAL_READY=' .. tostring(rawget(_G,'hanaworlds_adapter')~=nil))
  end)
end)
`);
async function port() { const s = createServer(); await new Promise(y => s.listen(0, '127.0.0.1', y)); const n = s.address().port; await new Promise(y => s.close(y)); return n; }
const serverPort = await port(), config = join(root, 'luanti.conf');
await writeFile(config, `port = ${serverPort}\nbind_address = 127.0.0.1\nsecure.http_mods = hanaworlds_adapter\nserver_announce = false\nmg_name = singlenode\nmapgen_limit = 1500\nenable_damage = false\n`);
const processes = [], calls = [], events = []; let child, stage = 0, hostInput;
async function waitReady(log, ready) {
  const until = Date.now() + 30000;
  while (Date.now() < until) {
    const s = await readFile(log, 'utf8').catch(() => '');
    if (s.includes(ready)) return;
    if (child.exitCode !== null || child.signalCode !== null) throw Error('LUANTI_EARLY_EXIT');
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
    await waitReady(log, `HW_LOCAL_READY=${stage > 1}`); hostInput = input; return { controlRef: `real:${child.pid}`, worldPath: world };
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
const ctx = new Context();
ctx.provide('webServer', { register() { return () => {}; } });
ctx.provide('dshHomePath', (...parts) => join(home, ...parts));
ctx.provide('hanaworldsNativeEngineControl', host);
let canvas, localContext;
const adapterFiber = ctx.plugin({ name: 'hanaworlds-adapter-luanti', inject, apply(c) { apply(c, { localWorldRoots: [join(profile, 'worlds')] }); } });
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
const local = ctx.get('hanaworldsLuantiLocalWorlds');
const counts = async () => JSON.parse(await readFile(join(world, 'probe-counts.json'), 'utf8'));
async function engineRead(positions) {
  await rm(join(world, 'probe-answer.json'), { force: true });
  await writeFile(join(world, 'probe-query.json'), JSON.stringify(positions));
  const until = Date.now() + 10000;
  while (Date.now() < until) {
    const raw = await readFile(join(world, 'probe-answer.json'), 'utf8').catch(() => null);
    if (raw) return JSON.parse(raw);
    await new Promise(y => setTimeout(y, 100));
  }
  throw Error('PROBE_ANSWER_TIMEOUT');
}
const W = 'world-adapter-region/v1';
const CAPS = ['world-adapter-region/v1:chunked-read', 'world-adapter-region/v1:chunked-write', 'world-adapter-region/v1:lighting-complete',
  'world-adapter-region/v1:load-then-know', 'world-adapter-region/v1:restore-state'];
let seq = 0;
const req0 = () => ({ contractVersion: W, sessionRef: 'fixture-session', requestId: `req-${++seq}`, worldRef: localContext.worldRef, localContext });
const summarize = r => r.result ? { chunks: r.result.chunks.length,
  status: [...new Set(r.result.chunks.map(c => c.availability ?? c.status))], loadMethod: [...new Set(r.result.chunks.map(c => c.loadMethod).filter(Boolean))],
  unknownReason: [...new Set(r.result.chunks.map(c => c.unknownReason).filter(Boolean))], lighting: r.result.lighting } : { error: r.error };
async function io(name, request, caller = canvas) {
  const started = Date.now(), port = caller.get('hanaworldsWorldAdapterRegionV1');
  try {
    const response = await port.call(name, request);
    calls.push({ name, requestId: request.requestId, purpose: request.purpose, box: request.box, ms: Date.now() - started,
      response: summarize(response), facts: port.lastFacts() });
    return response;
  } catch (error) {
    calls.push({ name, requestId: request?.requestId, ms: Date.now() - started, thrown: error.message });
    throw error;
  }
}
const readR = async (box, purpose = 'BEFORE_IMAGE') => {
  const req = { ...req0(), box, purpose }, res = await io('ReadRegion', req);
  assert.equal(res.error, null, JSON.stringify(res.error)); C.validateRegionRead(req, res); return res.result;
};
async function writeR(purpose, writes, caller) {
  const req = { ...req0(), transactionId: `tx-${seq}`, purpose, writes }, res = await io('WriteRegion', req, caller);
  return { req, res, ...(res.error ? {} : C.validateRegionWrite(req, res)) };
}
function ops(chunk, rule) {
  const { min, max } = chunk.box, size = max.map((v, i) => v - min[i] + 1);
  const palette = [{ nodeName: 'base:stone', param2: 0 }, { nodeName: 'air', param2: 0 }, { nodeName: 'base:rotated', param2: 7 }];
  const indices = new Int32Array(size[0] * size[1] * size[2]); let i = 0, any = false;
  for (let z = min[2]; z <= max[2]; z++) for (let y = min[1]; y <= max[1]; y++) for (let x = min[0]; x <= max[0]; x++) { indices[i] = rule(x, y, z); any ||= indices[i] !== -1; i++; }
  return any ? C.encodeRegionBlock({ origin: min, size, palette, indices }) : null;
}
// APPLY writes for every chunk the rule touches; also the Canvas-side expected after-states.
function apply_(read, rule) {
  const writes = [], expected = [];
  for (const c of read.chunks) {
    const block = ops(c, rule); if (!block) continue;
    writes.push({ chunkPos: c.chunkPos, expectedCurrentDigest: c.stateDigest, ops: block, state: null });
    expected.push(C.digestValue('region-state', C.expectedRegionState(c.state, block)).sha256);
  }
  return { writes, expected };
}
const R = { min: [-48, -8, -48], max: [63, 7, 63] }; // 7 x 2 x 7 = 98 mapblocks, low side not aligned
const check = (event, detail = {}) => { events.push({ event, ...detail }); console.log('PASS', event); };
const sameDigests = (res, read, expected) => res.result.chunks.forEach((c, i) => {
  assert.equal(c.status, 'WRITTEN'); assert.equal(c.readbackDigest, expected[i]);
  assert.equal(read.chunks.find(r => r.chunkPos.join() === c.chunkPos.join()).stateDigest, expected[i]);
});
try {
  const [found] = await local.discover();
  const acquire = await local.acquire({ connectionRef: found.connectionRef, requesterRef: 'fixture-host', userPath: profile, action: 'PROVISION_PAYLOAD' });
  const query = x => ({ connectionRef: found.connectionRef, requesterRef: 'fixture-host', leaseRef: x.leaseRef });
  const provision = await local.provision(query(acquire)); assert.equal(provision.payloadDigest, await payloadDigest());
  const opened = await local.acquire({ connectionRef: found.connectionRef, requesterRef: 'fixture-host', userPath: profile, action: 'BIND_RUNNING_WORLD' });
  const paired = await local.pair(query(opened));
  localContext = { connectionRef: paired.connectionRef, connectionIncarnationRef: paired.connectionIncarnationRef, worldRef: paired.worldRef, selectionRevision: 'fixture-selection-1' };
  const port = canvas.get('hanaworldsWorldAdapterRegionV1');
  // 1. Protocol major + capabilities (consumer side) and pre-dispatch rejections.
  assert.equal(C.checkProtocolCompatibility(port.protocolHandshake, [C.protocolRequirement(W, CAPS)]).result, 'PROTOCOL_COMPATIBLE');
  assert.throws(() => C.checkProtocolCompatibility(port.protocolHandshake, [C.protocolRequirement('world-adapter-region/v2', CAPS)]), /UNSUPPORTED_VERSION/);
  const c0 = await counts(); assert.equal(c0.vm_hook, 'installed');
  assert.throws(() => port.call('ReadRegion', { ...req0(), contractVersion: 'world-adapter-region/v2', box: R, purpose: 'INSPECT' }), /UNSUPPORTED_VERSION/);
  assert.throws(() => port.call('ReadRegion', { ...req0(), worldRef: 'luanti:other', box: R, purpose: 'INSPECT' }), /CURRENT_WORLD_MISMATCH/);
  const stale = await io('ReadRegion', { ...req0(), localContext: { ...localContext, connectionIncarnationRef: 'stale' }, box: R, purpose: 'INSPECT' });
  assert.equal(stale.error.code, 'CURRENT_WORLD_MISMATCH');
  const outsider = await io('ReadRegion', { ...req0(), box: R, purpose: 'INSPECT' }, ctx);
  assert.equal(outsider.error.code, 'CAPABILITY_UNAVAILABLE');
  assert.deepEqual(await counts(), c0);
  check('PROTOCOL_AND_PRE_DISPATCH_REJECTIONS', { handshake: port.protocolHandshake, cases: ['v2 requirement', 'v2 wire', 'wrong world', 'stale incarnation', 'non-Canvas caller'], counts: c0 });

  // 2. Cross-chunk BEFORE_IMAGE read and multi-batch fill.
  const r0 = await readR(R);
  C.requireKnownRegion(r0); assert.equal(r0.chunks.length, 98);
  assert.ok(port.lastFacts().batches > 1, 'multi-batch read');
  const fill = apply_(r0, (x, y) => y < 0 ? 0 : -1);
  const w1 = await writeR('APPLY', fill.writes);
  assert.equal(w1.allWritten, true, JSON.stringify(w1.res.error ?? w1.res.result.lighting)); assert.equal(w1.committed, false);
  const f1 = port.lastFacts(); assert.ok(f1.batches.length > 1);
  const c1 = await counts();
  assert.equal(c1.vm_write - c0.vm_write, f1.batches.length); assert.equal(c1.set_node, c0.set_node); assert.equal(c1.worldedit_set, c0.worldedit_set);
  const r1 = await readR(R, 'READBACK'); sameDigests(w1.res, r1, fill.expected);
  check('FILL_MULTI_BATCH_VOXELMANIP', { chunks: fill.writes.length, batches: f1.batches.length, vmWrites: c1.vm_write - c0.vm_write, perNodeWrites: c1.set_node - c0.set_node, lighting: w1.res.result.lighting });

  // 3. Explicit air dig across block boundaries, roof fill, param2, and an overwritten
  //    metadata cell (chest at 40,2,40 -> air). Unspecified cells and the timer node keep.
  const pit = (x, y, z) => x >= -2 && x <= 2 && z >= -2 && z <= 2 && y >= -4 && y <= -1;
  const roof = (x, y, z) => y === 5 && x >= -30 && x <= 30 && z >= -30 && z <= 30;
  const rule3 = (x, y, z) => pit(x, y, z) ? 1 : roof(x, y, z) ? 0 : (x === 10 && y === 0 && z === 10) ? 2 : (x === 40 && y === 2 && z === 40) ? 1 : -1;
  const before3 = await engineRead([[40, 2, 40]]);
  const dig = apply_(r1, rule3);
  const chestChunk = r1.chunks.find(c => c.chunkPos.join() === '2,0,2');
  assert.ok(chestChunk.state.extras.some(e => e.position.join() === '40,2,40' && e.metadata.owner === 'fixture'));
  const w2 = await writeR('APPLY', dig.writes);
  assert.equal(w2.allWritten, true, JSON.stringify(w2.res.error));
  const r2 = await readR(R, 'READBACK'); sameDigests(w2.res, r2, dig.expected);
  assert.equal(r2.chunks.find(c => c.chunkPos.join() === '2,0,2').state.extras.some(e => e.position.join() === '40,2,40'), false);
  const seen = await engineRead([[0, -1, 0], [-1, -4, -1], [0, -5, 0], [0, 5, 0], [0, 4, 0], [0, 6, 0], [50, 0, 50], [10, 0, 10], [40, 2, 40], [41, 2, 40], [55, -3, 55], [-40, 2, -40]]);
  const at = p => seen.find(s => s.pos.join() === p.join());
  assert.equal(at([0, -1, 0]).name, 'air'); assert.equal(at([-1, -4, -1]).name, 'air'); assert.equal(at([0, -5, 0]).name, 'base:stone');
  assert.equal(at([0, 5, 0]).name, 'base:stone'); assert.equal(at([10, 0, 10]).name, 'base:rotated'); assert.equal(at([10, 0, 10]).param2, 7);
  assert.equal(at([40, 2, 40]).name, 'air'); assert.equal(at([40, 2, 40]).owner, ''); // overwritten cell: old metadata cleared
  assert.equal(at([41, 2, 40]).name, 'base:timer'); assert.equal(at([55, -3, 55]).name, 'base:stone'); assert.equal(at([-40, 2, -40]).owner, 'fixture-restore');
  assert.equal(at([0, 6, 0]).light, 15); assert.equal(at([50, 0, 50]).light, 15);
  assert.ok(at([0, 4, 0]).light < 15, `light under roof centre ${at([0, 4, 0]).light}`);
  // param1 of air is the engine light byte (day + 16*night): derived, not node data.
  check('DIG_AIR_PARAM2_METADATA_CLEAR_LIGHT', { chestBefore: before3[0], engine: seen, lighting: w2.res.result.lighting });

  // 4. Stale expectedCurrentDigest (caller read is outdated): rejected, zero writes.
  const c2 = await counts();
  const staleW = await writeR('APPLY', apply_(r1, (x, y) => y === 6 ? 0 : -1).writes);
  assert.equal(staleW.res.error.code, 'TRANSACTION_CONFLICT'); assert.equal(staleW.res.error.mutationState, 'NONE');
  assert.deepEqual(await counts(), c2);
  check('STALE_DIGEST_REJECTED_ZERO_WRITE', { error: staleW.res.error });

  // 5. Never-generated region: loaded by emerge, then KNOWN; second read ALREADY_LOADED.
  const far = { min: [1000, 0, 1000], max: [1040, 20, 1040] };
  const farBefore = await engineRead([[1000, 0, 1000]]);
  const g1 = await readR(far, 'INSPECT'); C.requireKnownRegion(g1);
  assert.ok(g1.chunks.every(c => c.loadMethod === 'LOADED_BY_EMERGE'));
  const g1Facts = port.lastFacts();
  const g2 = await readR(far, 'INSPECT'); assert.ok(g2.chunks.every(c => c.loadMethod === 'ALREADY_LOADED'));
  assert.deepEqual(g2.chunks.map(c => c.stateDigest), g1.chunks.map(c => c.stateDigest));
  check('UNLOADED_LOADED_THEN_KNOWN', { probeBefore: farBefore[0], emergeActions: [...new Set(g1Facts.emerge)] });

  // 6. Outside mapgen_limit: still UNKNOWN after the load attempt; a write is rejected before any write.
  const out = { min: [1600, 0, 1600], max: [1610, 4, 1610] };
  const u = await readR(out, 'INSPECT');
  assert.ok(u.chunks.every(c => c.availability === 'UNKNOWN' && c.unknownReason === 'OUTSIDE_WORLD_LIMITS'));
  assert.throws(() => C.requireKnownRegion(u), /TARGET_FACTS_INCOMPLETE/);
  const c3 = await counts();
  const uw = await writeR('APPLY', u.chunks.map(c => ({ chunkPos: c.chunkPos, expectedCurrentDigest: '0'.repeat(64), ops: ops(c, () => 0), state: null })));
  assert.equal(uw.res.error.code, 'TARGET_FACTS_INCOMPLETE'); assert.deepEqual(await counts(), c3);
  check('UNKNOWN_REJECTED_ZERO_WRITE', { reasons: [...new Set(u.chunks.map(c => c.unknownReason))], error: uw.res.error });

  // 7. Concurrent engine change after batch 1: per-chunk WRITTEN/NOT_WRITTEN, never
  //    committed; the caller's own BEFORE_IMAGE states are restored with RESTORE (extras included).
  const snap = await readR(R);
  await writeFile(join(world, 'probe-conflict'), JSON.stringify([60, 6, 60])); // lies in the last batch
  const w7 = await writeR('APPLY', apply_(snap, (x, y, z) => y === 6 || (x === -40 && y === 2 && z === -40) ? (y === 6 ? 0 : 1) : -1).writes);
  assert.equal(w7.res.error, null); assert.equal(w7.allWritten, false); assert.equal(w7.committed, false);
  const st = new Set(w7.res.result.chunks.map(c => c.status)); assert.ok(st.has('WRITTEN') && st.has('NOT_WRITTEN'));
  const mid = await engineRead([[-40, 2, -40]]); assert.equal(mid[0].name, 'air'); assert.equal(mid[0].owner, '');
  const now = await readR(R, 'READBACK');
  const restore = await writeR('RESTORE', snap.chunks.map((c, i) => ({ chunkPos: c.chunkPos, expectedCurrentDigest: now.chunks[i].stateDigest, ops: null, state: c.state })));
  assert.equal(restore.allWritten, true, JSON.stringify(restore.res.error));
  const back = await readR(R, 'READBACK');
  assert.deepEqual(back.chunks.map(c => c.stateDigest), snap.chunks.map(c => c.stateDigest));
  const kept = await engineRead([[-40, 2, -40], [41, 2, 40], [60, 6, 60]]);
  assert.equal(kept[0].name, 'base:chest'); assert.equal(kept[0].owner, 'fixture-restore'); assert.equal(kept[2].name, 'air');
  check('PARTIAL_FACTS_THEN_RESTORE_WITH_EXTRAS', { partial: w7.res.result.chunks.reduce((m, c) => ({ ...m, [c.status]: (m[c.status] ?? 0) + 1 }), {}),
    restoreLighting: restore.res.result.lighting, engine: kept });

  // 8. Observation only: a chunk holding a running node timer, read twice.
  const tbox = { min: [192, 0, 192], max: [207, 15, 207] };
  const t1 = await readR(tbox, 'INSPECT'); await new Promise(y => setTimeout(y, 1500)); const t2 = await readR(tbox, 'INSPECT');
  const te = (r) => r.chunks[0].state?.extras.find(e => e.position.join() === '200,0,200')?.timer ?? null;
  events.push({ event: 'OBSERVED_RUNNING_TIMER_DIGEST', firstTimer: te(t1), secondTimer: te(t2), digestChanged: t1.chunks[0].stateDigest !== t2.chunks[0].stateDigest });

  check('PASS', { counts: await counts() });
} finally {
  await adapterFiber.dispose(); await canvasFiber.dispose(); await stop();
  await writeFile(join(root, 'calls.json'), JSON.stringify(calls, null, 2) + '\n');
  await writeFile(join(root, 'processes.json'), JSON.stringify(processes, null, 2) + '\n');
  await writeFile(join(root, 'events.json'), JSON.stringify(events, null, 2) + '\n');
}
console.log('REAL_RUNTIME world-adapter-region/v1 own package/Cordis/Luanti PASS; game, Host and Canvas are explicit FIXTURES');
