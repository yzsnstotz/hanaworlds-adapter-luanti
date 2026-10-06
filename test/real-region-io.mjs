// Region I/O REAL_RUNTIME: own source or extracted package + Cordis 4.0.4 + real Luanti 5.17.
// The game `hw_region_fixture` is an explicit COMPONENT FIXTURE, never the product game.
// Host lifecycle and the Canvas caller are public peer fixtures; the Canvas fixture only
// calls the public hanaworldsLuantiRegionIO service and makes no transaction decision here.
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
const V = await import(pathToFileURL(join(installed, 'src/region-voxels.mjs')));
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
        light=minetest.get_node_light(pos,0.5) or -1,owner=minetest.get_meta(pos):get_string('owner')}
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
    raw_set({x=40,y=2,z=40},{name='base:chest'})
    minetest.get_meta({x=40,y=2,z=40}):set_string('owner','fixture')
    raw_set({x=41,y=2,z=40},{name='base:timer'})
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
let canvas;
const adapterFiber = ctx.plugin({ name: 'hanaworlds-adapter-luanti', inject, apply(c) { apply(c, { localWorldRoots: [join(profile, 'worlds')] }); } });
await adapterFiber.await();
const canvasFiber = ctx.plugin({ name: 'hanaworlds-canvas', apply(c) { canvas = c; } });
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
const P = { name: 'hanaworlds-region-io', version: '1.4.2', requiredCapabilities: ['region-voxels-v1', 'air-dig', 'mapblock-batches', 'load-before-read', 'light-complete-fact'] };
const summary = r => r && ({ status: r.status, written: r.written, failure: r.failure, regionDigest: r.regionDigest,
  batches: r.batches?.map(b => ({ status: b.status, changedCells: b.changedCells, light: b.light, min: b.min, max: b.max, blocks: b.blocks })),
  blocks: r.blocks?.length, emerge: r.blocks && [...new Set(r.blocks.map(b => b.emerge))], currentAfter: r.currentAfter });
let binding;
async function io(name, input, caller = canvas) {
  const started = Date.now();
  try {
    const result = await caller.get('hanaworldsLuantiRegionIO')[name]({ ...binding, protocol: P, ...input });
    calls.push({ name, input: { ...input, voxels: input.voxels && { ...input.voxels, runs: `${input.voxels.runs.length} runs` } }, ms: Date.now() - started, result: summary(result) });
    return result;
  } catch (error) {
    calls.push({ name, input: { min: input.min, max: input.max, protocol: input.protocol }, ms: Date.now() - started, error: error.message });
    throw error;
  }
}
// Region R: 7 x 2 x 7 = 98 mapblocks, not block aligned on the low side.
const R = { min: [-48, -8, -48], max: [63, 7, 63] };
const size = R.max.map((v, i) => v - R.min[i] + 1);
function voxels(rule, min = R.min, sz = size) {
  const palette = [{ nodeName: 'base:stone', param2: 0 }, { nodeName: 'air', param2: 0 }, { nodeName: 'base:rotated', param2: 7 }];
  const cells = new Int32Array(sz[0] * sz[1] * sz[2]); let i = 0;
  for (let z = min[2]; z < min[2] + sz[2]; z++) for (let y = min[1]; y < min[1] + sz[1]; y++) for (let x = min[0]; x < min[0] + sz[0]; x++) cells[i++] = rule(x, y, z);
  return V.encodeVoxels(min, sz, palette, cells);
}
const expect = r => r.blocks.map(b => ({ blockPos: b.blockPos, digest: b.digest }));
const check = (event, detail = {}) => { events.push({ event, ...detail }); console.log('PASS', event); };
try {
  const [found] = await local.discover();
  const acquire = await local.acquire({ connectionRef: found.connectionRef, requesterRef: 'fixture-host', userPath: profile, action: 'PROVISION_PAYLOAD' });
  const query = x => ({ connectionRef: found.connectionRef, requesterRef: 'fixture-host', leaseRef: x.leaseRef });
  const provision = await local.provision(query(acquire)); assert.equal(provision.payloadDigest, await payloadDigest());
  const opened = await local.acquire({ connectionRef: found.connectionRef, requesterRef: 'fixture-host', userPath: profile, action: 'BIND_RUNNING_WORLD' });
  const paired = await local.pair(query(opened));
  binding = { worldRef: paired.worldRef, connectionRef: paired.connectionRef, connectionIncarnationRef: paired.connectionIncarnationRef };
  const described = canvas.get('hanaworldsLuantiRegionIO').describe();
  assert.equal(described.atomic, false); assert.equal(described.transactionOwner, 'hanaworlds-canvas');
  check('SELF_DESCRIPTION', { purpose: described.purpose, preconditions: described.preconditions, version: described.version });
  const c0 = await counts(); assert.equal(c0.vm_hook, 'installed');

  // 1. Wrong major / wrong binding / non-Canvas caller: rejected before any engine dispatch.
  await assert.rejects(io('writeRegion', { protocol: { ...P, version: '2.0.0' }, voxels: voxels(() => 0), expectedBlocks: [] }), /PROTOCOL_MAJOR_MISMATCH/);
  await assert.rejects(io('readRegion', { protocol: { ...P, version: '0.9.0' }, ...R }), /PROTOCOL_MAJOR_MISMATCH/);
  await assert.rejects(io('readRegion', { ...R, protocol: { ...P, requiredCapabilities: ['teleport'] } }), /CAPABILITY_UNAVAILABLE/);
  await assert.rejects(io('readRegion', { ...R, worldRef: 'luanti:00000000-0000-0000-0000-000000000000' }), /CURRENT_WORLD_MISMATCH/);
  await assert.rejects(io('readRegion', { ...R, connectionIncarnationRef: 'stale-incarnation' }), /CURRENT_WORLD_MISMATCH/);
  await assert.rejects(io('readRegion', { ...R, connectionRef: 'local:unknown' }), /WORLD_NOT_BOUND/);
  await assert.rejects(io('readRegion', R, ctx), /CAPABILITY_UNAVAILABLE/);
  assert.deepEqual(await counts(), c0);
  check('PRE_DISPATCH_REJECTIONS', { cases: ['major 2.0.0', '0.9.0', 'missing capability', 'wrong world', 'stale incarnation', 'unknown connection', 'non-Canvas caller'], writes: c0 });

  // 2. Cross-block read (same major, different minor/patch accepted), then fill.
  const r0 = await io('readRegion', R);
  assert.equal(r0.status, 'KNOWN'); assert.equal(r0.blocks.length, 98); assert.ok(r0.batches.length > 1, 'multi-batch');
  assert.ok(r0.blocks.every(b => b.availability === 'KNOWN'));
  const fill = await io('writeRegion', { voxels: voxels((x, y) => y < 0 ? 0 : -1), expectedBlocks: expect(r0) });
  assert.equal(fill.status, 'COMPLETE', JSON.stringify(fill.failure)); assert.equal(fill.atomic, false);
  assert.ok(fill.batches.every(b => b.status === 'WRITTEN_VERIFIED' && b.light.complete === true));
  const c1 = await counts();
  assert.equal(c1.vm_write - c0.vm_write, fill.batches.length); assert.equal(c1.set_node, c0.set_node); assert.equal(c1.worldedit_set, c0.worldedit_set);
  const r1 = await io('readRegion', R);
  assert.equal(r1.regionDigest, fill.regionDigest);
  check('FILL_MULTI_BATCH_VOXELMANIP', { batches: fill.batches.length, vmWrites: c1.vm_write - c0.vm_write, perNodeWrites: c1.set_node - c0.set_node, regionDigest: fill.regionDigest });

  // 3. Explicit air dig across block boundaries + roof fill; unspecified cells kept; light completes.
  const pit = (x, y, z) => x >= -2 && x <= 2 && z >= -2 && z <= 2 && y >= -4 && y <= -1;
  const roof = (x, y, z) => y === 5 && x >= -30 && x <= 30 && z >= -30 && z <= 30;
  const dig = await io('writeRegion', { voxels: voxels((x, y, z) => pit(x, y, z) ? 1 : roof(x, y, z) ? 0 : (x === 10 && y === 0 && z === 10) ? 2 : -1), expectedBlocks: expect(r1) });
  assert.equal(dig.status, 'COMPLETE', JSON.stringify(dig.failure));
  assert.ok(dig.batches.every(b => b.status === 'NOT_NEEDED' || (b.readbackMatches && b.unspecifiedKept && b.light.complete)));
  const seen = await engineRead([[0, -1, 0], [-1, -4, -1], [0, -5, 0], [0, 5, 0], [0, 4, 0], [0, 6, 0], [50, 0, 50], [10, 0, 10], [40, 2, 40], [55, -3, 55]]);
  const at = p => seen.find(s => s.pos.join() === p.join());
  assert.equal(at([0, -1, 0]).name, 'air'); assert.equal(at([-1, -4, -1]).name, 'air'); assert.equal(at([0, -5, 0]).name, 'base:stone');
  assert.equal(at([0, 5, 0]).name, 'base:stone'); assert.equal(at([10, 0, 10]).name, 'base:rotated'); assert.equal(at([10, 0, 10]).param2, 7);
  assert.equal(at([40, 2, 40]).name, 'base:chest'); assert.equal(at([40, 2, 40]).owner, 'fixture'); assert.equal(at([55, -3, 55]).name, 'base:stone');
  assert.equal(at([0, 6, 0]).light, 15); assert.equal(at([50, 0, 50]).light, 15);
  assert.ok(at([0, 4, 0]).light < 15, `light under roof centre ${at([0, 4, 0]).light}`);
  assert.ok(at([0, -1, 0]).light < 15, `light in the covered pit ${at([0, -1, 0]).light}`);
  const r2 = await io('readRegion', R); assert.equal(r2.regionDigest, dig.regionDigest);
  check('DIG_AIR_CROSS_BLOCK_PARAM2_LIGHT', { engine: seen });

  // 4. Stateful / non-static cells: precheck rejects, zero writes.
  const c2 = await counts();
  const meta = await io('writeRegion', { voxels: voxels((x, y, z) => (x === 40 && y === 2 && z === 40) ? 1 : -1), expectedBlocks: expect(r2) });
  assert.equal(meta.status, 'REJECTED'); assert.equal(meta.failure.code, 'UNSUPPORTED_MUTATION_SEMANTICS'); assert.equal(meta.written, false);
  const timer = await io('writeRegion', { voxels: voxels((x, y, z) => (x === 41 && y === 2 && z === 40) ? 1 : -1), expectedBlocks: expect(r2) });
  assert.equal(timer.status, 'REJECTED'); assert.equal(timer.failure.code, 'UNSUPPORTED_MUTATION_SEMANTICS');
  assert.deepEqual(await counts(), c2);
  check('STATEFUL_REJECTED_ZERO_WRITE', { meta: meta.failure, timer: timer.failure });

  // 5. Stale expected digests (caller read is outdated): REJECTED, zero writes.
  const stale = await io('writeRegion', { voxels: voxels((x, y) => y === 6 ? 0 : -1), expectedBlocks: expect(r1) });
  assert.equal(stale.status, 'REJECTED'); assert.equal(stale.failure.code, 'TRANSACTION_CONFLICT'); assert.deepEqual(await counts(), c2);
  check('STALE_DIGEST_REJECTED_ZERO_WRITE', { failure: stale.failure });

  // 6. Unloaded never-generated region: emerged (GENERATED) and read back KNOWN.
  const far = { min: [1000, 0, 1000], max: [1040, 20, 1040] };
  const before = await engineRead([[1000, 0, 1000]]);
  const g = await io('readRegion', far);
  assert.equal(g.status, 'KNOWN'); assert.ok(g.blocks.some(b => b.emerge === 'GENERATED'), JSON.stringify(g.blocks.map(b => b.emerge)));
  const again = await io('readRegion', far);
  assert.ok(again.blocks.every(b => b.emerge === 'FROM_MEMORY' || b.emerge === 'FROM_DISK')); assert.equal(again.regionDigest, g.regionDigest);
  check('UNLOADED_LOADED_THEN_KNOWN', { probeBefore: before[0], first: [...new Set(g.blocks.map(b => b.emerge))], second: [...new Set(again.blocks.map(b => b.emerge))] });

  // 7. Outside mapgen_limit: the engine cannot load it -> UNKNOWN; write rejected, zero writes.
  const out = { min: [1600, 0, 1600], max: [1610, 4, 1610] };
  const u = await io('readRegion', out);
  assert.equal(u.status, 'UNKNOWN'); assert.equal(u.voxels, null);
  const fake = V.subBoxes(out.min, out.max).map(b => ({ blockPos: b.block, digest: '0'.repeat(64) }));
  const c3 = await counts();
  const uw = await io('writeRegion', { voxels: voxels(() => 0, out.min, out.max.map((v, i) => v - out.min[i] + 1)), expectedBlocks: fake });
  assert.equal(uw.status, 'REJECTED'); assert.equal(uw.failure.code, 'TARGET_FACTS_INCOMPLETE'); assert.deepEqual(await counts(), c3);
  check('UNKNOWN_REJECTED_ZERO_WRITE', { read: [...new Set(u.blocks.map(b => b.emerge))], failure: uw.failure });

  // 8. A concurrent engine change after batch 1: PARTIAL (never atomic), facts per batch,
  //    then the caller's own snapshot is restored through writeRegion.
  const snapshot = await io('readRegion', R);
  await writeFile(join(world, 'probe-conflict'), JSON.stringify([60, 6, 60])); // lies in the last batch
  const partial = await io('writeRegion', { voxels: voxels((x, y) => y === 6 ? 0 : -1), expectedBlocks: expect(snapshot) });
  assert.equal(partial.status, 'PARTIAL'); assert.equal(partial.atomic, false); assert.equal(partial.written, true);
  assert.equal(partial.batches[0].status, 'WRITTEN_VERIFIED'); assert.equal(partial.batches.at(-1).status, 'NOT_WRITTEN');
  assert.equal(partial.failure.code, 'TRANSACTION_CONFLICT');
  const now = await io('readRegion', R); assert.notEqual(now.regionDigest, snapshot.regionDigest);
  const restore = await io('writeRegion', { voxels: snapshot.voxels, expectedBlocks: expect(now) });
  assert.equal(restore.status, 'COMPLETE', JSON.stringify(restore.failure));
  const back = await io('readRegion', R); assert.equal(back.regionDigest, snapshot.regionDigest);
  const kept = await engineRead([[40, 2, 40], [41, 2, 40], [60, 6, 60]]);
  assert.equal(kept[0].name, 'base:chest'); assert.equal(kept[0].owner, 'fixture'); assert.equal(kept[1].name, 'base:timer'); assert.equal(kept[2].name, 'air');
  check('PARTIAL_FACTS_THEN_SNAPSHOT_RESTORE', { partial: summary(partial), restoredDigest: back.regionDigest });

  check('PASS', { counts: await counts() });
} finally {
  await adapterFiber.dispose(); await canvasFiber.dispose(); await stop();
  await writeFile(join(root, 'calls.json'), JSON.stringify(calls, null, 2) + '\n');
  await writeFile(join(root, 'processes.json'), JSON.stringify(processes, null, 2) + '\n');
  await writeFile(join(root, 'events.json'), JSON.stringify(events, null, 2) + '\n');
}
console.log('REAL_RUNTIME region-io own package/Cordis/Luanti PASS; game, Host and Canvas are explicit FIXTURES');
