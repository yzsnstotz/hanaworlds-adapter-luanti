// REAL INPUT LAYER for the Stage 1 fact supply page and the real guard gate.
// Real: Luanti 5.17 (/Applications/luanti.app) running VoxeLibre and WorldEdit from this run's
//       own Luanti user path; the World is made by the Adapter's public createFlatWorld; the
//       Adapter is loaded in the official SDK's Cordis (HanaWorlds.app) and reached only through
//       its public services (local worlds, native facts, world-adapter/v7, world-adapter-region/v2).
// Labelled FIXTURES (environment, not product): the NativeEngineControl Host (it starts and
//       stops the real own Luanti process), the Canvas caller (ReadWorldSelectionContext only),
//       and `hw_probe`, an observation/test-environment mod in the created World that answers
//       node reads, places the test player, sets an external edit, and chains a test protection
//       area into core.is_protected exactly as a protection mod does. A real Luanti client
//       ("alice", a GUI window) supplies the connected player when asked.
import { spawn } from 'node:child_process';
import { mkdir, readFile, realpath, rm, symlink, writeFile, cp } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { apply, inject } from '../../src/index.mjs';

export const LUANTI = '/Applications/luanti.app/Contents/MacOS/luanti';
export const CORDIS = '/Applications/HanaWorlds.app/Contents/Resources/hanaworlds-dsh/node_modules/@deepseek-ai/cordis/lib/index.js';
const freePort = async () => { const s = createServer(); await new Promise(y => s.listen(0, '127.0.0.1', y)); const n = s.address().port; await new Promise(y => s.close(y)); return n; };

const PROBE = `
-- hw_probe: TEST-ENVIRONMENT FIXTURE (not product). File channel in the World directory.
local path = minetest.get_worldpath()
local protected = {}
local armed = nil
local old_is_protected = minetest.is_protected
-- Chained exactly as a protection mod chains it; the area protects for every name.
function minetest.is_protected(pos, name)
  for _, b in ipairs(protected) do
    if pos.x >= b[1][1] and pos.x <= b[2][1] and pos.y >= b[1][2] and pos.y <= b[2][2]
      and pos.z >= b[1][3] and pos.z <= b[2][3] then return true end
  end
  return old_is_protected(pos, name)
end
local function alice() return minetest.get_player_by_name('alice') end
local function place(p)
  local pl = alice(); if not pl then return false end
  pl:set_pos({x = p[1], y = p[2], z = p[3]}); return true
end
-- External edit armed for one write: after the Adapter writes cell 'at', the cell is changed
-- and the test player is placed into it, before the Adapter's readback.
local old_set = worldedit.set
worldedit.set = function(p1, p2, name, ...)
  local r = old_set(p1, p2, name, ...)
  if armed and p1.x == armed.at[1] and p1.y == armed.at[2] and p1.z == armed.at[3] then
    local a = armed; armed = nil
    minetest.after(0, function()
      minetest.set_node({x = a.at[1], y = a.at[2], z = a.at[3]}, {name = a.node})
      place(a.player)
      minetest.log('action', 'HW_PROBE_EXTERNAL_EDIT_DONE')
    end)
  end
  return r
end
local function answer()
  local f = io.open(path .. '/probe-query.json', 'r')
  if f then
    local q = minetest.parse_json(f:read('*a')); f:close(); os.remove(path .. '/probe-query.json')
    local out = {nodes = {}, players = #minetest.get_connected_players()}
    for i, p in ipairs(q.read or {}) do
      local pos = {x = p[1], y = p[2], z = p[3]}; minetest.load_area(pos)
      local n = minetest.get_node_or_nil(pos); out.nodes[i] = {pos = p, name = n and n.name or 'UNLOADED'}
    end
    if q.protect then protected = q.protect; out.protected = #protected end
    if q.place then out.placed = place(q.place) end
    if q.arm then armed = q.arm; out.armed = true end
    if q.set then
      for _, s in ipairs(q.set) do minetest.set_node({x = s[1][1], y = s[1][2], z = s[1][3]}, {name = s[2]}) end
      out.set = #q.set
    end
    minetest.safe_file_write(path .. '/probe-answer.json', minetest.write_json(out))
  end
  minetest.after(0.1, answer)
end
minetest.register_on_joinplayer(function(p) minetest.log('action', 'HW_PROBE_JOIN ' .. p:get_player_name()) end)
minetest.after(0, function() answer(); minetest.log('action', 'HW_REAL_READY=' .. tostring(rawget(_G, 'hanaworlds_adapter') ~= nil)) end)
`;

/** One own-root real World behind the real Adapter public services. */
export async function openRealWorld({ runRoot, game, worldedit, log = () => {} }) {
  const root = await realpath(runRoot);
  const profile = join(root, 'profile'), worlds = join(profile, 'worlds'), home = join(root, 'dsh-home');
  for (const p of [worlds, home, join(profile, 'games'), join(profile, 'mods'), join(root, 'tmp')]) await mkdir(p, { recursive: true, mode: 0o700 });
  await symlink(await realpath(game), join(profile, 'games', 'mineclone2')).catch(e => { if (e.code !== 'EEXIST') throw e; });
  await cp(worldedit, join(profile, 'mods', 'worldedit'), { recursive: true });
  const serverPort = await freePort();
  const config = join(root, 'luanti.conf');
  await writeFile(config, `port = ${serverPort}\nbind_address = 127.0.0.1\nsecure.http_mods = hanaworlds_adapter\nserver_announce = false\n` +
    `enable_damage = false\ndisallow_empty_password = false\ndefault_privs = interact, shout\n`);
  const env = { ...process.env, HOME: profile, LUANTI_USER_PATH: profile, XDG_CACHE_HOME: join(profile, 'cache'), TMPDIR: join(root, 'tmp') };
  const processes = []; let server = null, client = null, world = null, stage = 0;
  async function waitLog(file, phrase, child, ms = 180000) {
    const until = Date.now() + ms;
    while (Date.now() < until) {
      if ((await readFile(file, 'utf8').catch(() => '')).includes(phrase)) return;
      if (child && (child.exitCode !== null || child.signalCode !== null)) throw Error(`LUANTI_EARLY_EXIT ${file}`);
      await new Promise(y => setTimeout(y, 100));
    }
    throw Error(`LUANTI_WAIT_TIMEOUT "${phrase}" in ${file}`);
  }
  const kill = async child => {
    if (!child || child.exitCode !== null || child.signalCode !== null) return null;
    const done = once(child, 'exit'); child.kill('SIGINT'); const [code, signal] = await done; return { code, signal };
  };
  let serverLog = null, hostInput = null;
  const host = { // FIXTURE NativeEngineControl driving the real own Luanti server process.
    async acquire(input) {
      hostInput = input; serverLog = join(root, `luanti-server-${++stage}.log`);
      const argv = ['--server', '--world', input.worldPath, '--config', config, '--logfile', serverLog];
      server = spawn(LUANTI, argv, { env, stdio: ['ignore', 'ignore', 'ignore'] });
      processes.push({ role: 'server', pid: server.pid, argv, startedAt: new Date().toISOString() });
      log(`luanti server pid ${server.pid} for ${input.operationRef}`);
      await waitLog(serverLog, 'HW_REAL_READY=', server).catch(async e => { if (!(await readFile(serverLog, 'utf8').catch(() => '')).includes('Server for gameid')) throw e; });
      return { controlRef: `real:${server.pid}`, worldPath: input.worldPath };
    },
    async inspect(q) {
      if (!server || q.controlRef !== `real:${server.pid}` || server.exitCode !== null) throw Error('NATIVE_GONE');
      process.kill(server.pid, 0);
      return { state: 'CURRENT', worldPath: q.worldPath, processId: server.pid, operationRef: q.operationRef };
    },
    async withStoppedWorld(q, consume) {
      const facts = await host.inspect(q); const pid = server.pid;
      await kill(client); client = null;
      const exit = await kill(server); processes.find(p => p.pid === pid).exit = exit; server = null;
      return consume({ state: 'STOPPED', worldPath: q.worldPath, processId: pid, operationRef: q.operationRef });
    },
  };
  const { Context } = await import(pathToFileURL(CORDIS));
  const ctx = new Context(); let localContext = null, history = null, canvas = null;
  ctx.provide('webServer', { register() { return () => {}; } });
  ctx.provide('dshHomePath', (...parts) => join(home, ...parts));
  ctx.provide('hanaworldsNativeEngineControl', host);
  ctx.provide('hanaworldsWorldRevisionOracle', { read: async () => 'fixture-canvas-world-head-1' });
  ctx.provide('hanaworldsCanvasFootprintRegistry', { readFootprints: async worldRef => ({ current: true, durable: true, worldRef, objects: [] }) });
  ctx.provide('hanaworldsCanvasHistoryFacts', { read: async () => history });
  const C = await import('hanaworlds-contracts');
  const adapterFiber = ctx.plugin({ name: 'hanaworlds-adapter-luanti', inject, apply(c) { apply(c, { localWorldRoots: [worlds] }); } });
  await adapterFiber.await();
  const canvasFiber = ctx.plugin({ name: 'hanaworlds-canvas', apply(c) { canvas = c; c.provide('hanaworldsCanvasV5', { call(name, r) {
    if (name !== 'ReadWorldSelectionContext') throw Error('FIXTURE_CANVAS_ONLY_READS_SELECTION');
    C.validateBoundRequest('canvas/v6', name, r);
    return C.validateBoundResponse('canvas/v6', name, r, { contractVersion: 'canvas/v6', requestId: r.requestId, error: null, result: {
      sessionRef: r.sessionRef, worldRef: r.worldRef, inventory: { capabilityRevision: 'fixture-inventory-1', connections: [] },
      selection: { status: 'BOUND', connectionRef: localContext.connectionRef, context: { currentSession: r.sessionRef, activeWorldRef: localContext.worldRef,
        orderedSelectedObjectRefs: [], sessionRevision: 'fixture-session-1', selectionRevision: localContext.selectionRevision, localContext } } } });
  } }); } });
  await canvasFiber.await();
  canvas.fiber.entry = { options: { name: 'hanaworlds-canvas' } }; // origin metadata the Host Loader supplies
  const local = ctx.get('hanaworldsLuantiLocalWorlds'), facts = ctx.get('hanaworldsLuantiNativeFacts');

  const described = await local.describeFlatWorldCreation({ requesterRef: 'real-host', userPath: profile });
  if (!described.ready) throw Object.assign(Error('FLAT_WORLD_NOT_READY'), { detail: JSON.stringify(described.missing) });
  const created = await local.createFlatWorld({ requesterRef: 'real-host', userPath: profile });
  world = created.worldPath;
  const probe = join(world, 'worldmods/hw_probe'); await mkdir(probe, { recursive: true });
  await writeFile(join(probe, 'mod.conf'), 'name = hw_probe\ndepends = worldedit\noptional_depends = hanaworlds_adapter\n');
  await writeFile(join(probe, 'init.lua'), PROBE);

  let lease = null, paired = null;
  async function connect() {
    lease = await local.acquire({ connectionRef: created.connectionRef, requesterRef: 'real-host', userPath: profile, action: 'BIND_RUNNING_WORLD' });
    paired = await local.pair({ connectionRef: created.connectionRef, requesterRef: 'real-host', leaseRef: lease.leaseRef });
    localContext = { connectionRef: paired.connectionRef, connectionIncarnationRef: paired.connectionIncarnationRef, worldRef: paired.worldRef, selectionRevision: 'fixture-selection-1' };
    return paired;
  }
  async function disconnect() {
    if (!lease) return;
    await local.stopWorld({ requesterRef: 'real-host', connectionRef: created.connectionRef, worldRef: created.worldRef });
    lease = null; paired = null; localContext = null;
  }
  async function probeQuery(query) {
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
  async function startClient() {
    const clientConfig = join(root, 'client.conf');
    await writeFile(clientConfig, 'enable_sound = false\nscreen_w = 480\nscreen_h = 320\nfullscreen = false\nmute_sound = true\n');
    client = spawn(LUANTI, ['--go', '--address', '127.0.0.1', '--port', String(serverPort), '--name', 'alice', '--password', '',
      '--config', clientConfig, '--logfile', join(root, 'luanti-client.log')], { env, stdio: ['ignore', 'ignore', 'ignore'] });
    processes.push({ role: 'client', pid: client.pid, startedAt: new Date().toISOString() });
    log(`luanti client pid ${client.pid}`);
    await waitLog(serverLog, 'HW_PROBE_JOIN alice', client, 240000);
  }
  return {
    root, profile, created, described, processes, C, canvas, local, facts,
    get worldRef() { return created.worldRef; }, get worldPath() { return world; }, get paired() { return paired; },
    get localContext() { return localContext; }, get serverLog() { return serverLog; }, get hostInput() { return hostInput; },
    setHistory(h) { history = h; },
    v7: () => canvas.get('hanaworldsWorldAdapterV6'), region: () => canvas.get('hanaworldsWorldAdapterRegionV1'),
    connect, disconnect, probe: probeQuery, startClient,
    async stopClient() { const r = await kill(client); client = null; return r; },
    async close() { await disconnect().catch(() => {}); await kill(client); await kill(server); await adapterFiber.dispose(); await canvasFiber.dispose(); },
  };
}
