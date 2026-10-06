// Diagnostic only (REAL_RUNTIME): the installed Adapter plugin binds a real
// Luanti world through its own localWorldRoots + AuthorizeBinding, and the
// Workshop facade is provided only after the Adapter started. A probe mod
// presses the rendered Session button by calling the payload's own form
// callback in-engine (no human, so not REAL_UI). Host authority and the
// Workshop facade are diagnostic stand-ins.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const installed = process.env.HW_INSTALLED_PLUGIN_DIR;
const runtimeRoot = process.env.HW_RUNTIME_ROOT;
const worldEditDirectory = process.env.HW_WORLDEDIT_DIR;
if (!installed || !runtimeRoot || !worldEditDirectory)
  throw new Error('HW_INSTALLED_PLUGIN_DIR, HW_RUNTIME_ROOT, HW_WORLDEDIT_DIR required');
const plugin = await import(pathToFileURL(join(installed, 'src/index.mjs')).href);

const root = resolve(runtimeRoot, `relay-${Date.now()}`);
const profile = join(root, 'profile');
const worlds = join(profile, 'worlds');
const world = join(worlds, 'world');
const luanti = '/Applications/luanti.app/Contents/MacOS/luanti';
const results = [];
const note = (step, value) => results.push({ step, ...value });
async function freePort() {
  const socket = createServer();
  await new Promise(done => socket.listen(0, '127.0.0.1', done));
  const port = socket.address().port;
  await new Promise(done => socket.close(done));
  return port;
}
// Observability wait: names the log line awaited and the process state.
async function waitFor(path, phrase, child, tenths = 900) {
  for (let i = 0; i < tenths; i++) {
    if (child.exitCode !== null) throw new Error(`LUANTI_EXITED_BEFORE: ${phrase}`);
    if ((await readFile(path, 'utf8').catch(() => '')).includes(phrase)) return;
    await delay(100);
  }
  throw new Error(`WAITED_${tenths / 10}s_FOR_LOG_LINE: ${phrase}`);
}
async function until(check, label, tenths = 300) {
  for (let i = 0; i < tenths; i++) { if (await check()) return; await delay(100); }
  throw new Error(`WAITED_${tenths / 10}s_FOR: ${label}`);
}

await mkdir(join(world, 'worldmods'), { recursive: true });
await mkdir(join(profile, 'games', 'hw_minimal'), { recursive: true });
await mkdir(join(root, 'tmp'), { recursive: true });
await writeFile(join(profile, 'games', 'hw_minimal', 'game.conf'), 'title = HanaWorlds relay probe\n');
await writeFile(join(world, 'world.mt'), 'gameid = hw_minimal\nbackend = sqlite3\n');
await cp(worldEditDirectory, join(world, 'worldmods', 'worldedit'), { recursive: true });
const probe = join(world, 'worldmods', 'hw_relay_probe');
await mkdir(probe);
await writeFile(join(probe, 'mod.conf'), 'name = hw_relay_probe\ndepends = worldedit\n');
// The probe presses button 1 of the shown Session form when the host drops a
// numbered click file, by calling every registered form callback the way the
// engine does for a real button press.
await writeFile(join(probe, 'init.lua'), `
local done = {}
minetest.register_on_joinplayer(function(player)
  if player:get_player_name() == 'alice' then
    minetest.set_player_privs('alice', {interact = true, worldedit = true, shout = true})
    minetest.after(1, function() minetest.log('action', 'HanaWorlds relay probe: alice joined') end)
  end
end)
local function click(n, frame)
  local nonce = minetest.sha256(frame.sessionRef .. '\\n' .. frame.turnRevision .. '\\n'
    .. frame.frameRef .. '\\n' .. frame.frameRevision)
  local player = minetest.get_player_by_name('alice')
  if not player then return end
  for _, callback in ipairs(minetest.registered_on_player_receive_fields) do
    callback(player, 'hanaworlds:session', {['hw_action_' .. nonce .. '_1'] = 'continue', message = 'Hello ' .. n})
  end
  minetest.log('action', 'HanaWorlds relay probe: clicked ' .. n)
end
local timer = 0
minetest.register_globalstep(function(dtime)
  timer = timer + dtime
  if timer < 0.3 then return end
  timer = 0
  for n = 1, 3 do
    if not done[n] then
      local file = io.open(minetest.get_worldpath() .. '/hw_click_' .. n .. '.json', 'rb')
      if file then
        local frame = minetest.parse_json(file:read('*a'))
        file:close()
        done[n] = true
        click(n, frame)
      end
    end
  end
end)
minetest.after(0, function()
  local auth = minetest.get_auth_handler()
  if not auth.get_auth('operator') then auth.create_auth('operator', '') end
  minetest.set_player_privs('operator', {worldedit = true})
  if not auth.get_auth('alice') then auth.create_auth('alice', minetest.get_password_hash('alice', '')) end
  minetest.log('action', 'HanaWorlds relay probe ready; payload=' .. tostring(rawget(_G, 'hanaworlds_adapter') ~= nil))
end)
`);
const transportPort = await freePort();
const serverPort = await freePort();
const config = join(root, 'luanti.conf');
await writeFile(config, `bind_address = 127.0.0.1\nport = ${serverPort}\nserver_announce = false\n` +
  'secure.enable_security = true\nsecure.http_mods = hanaworlds_adapter\n' +
  'static_spawnpoint = 0,1,0\nenable_damage = false\ndisallow_empty_password = false\n');
const env = { ...process.env, HOME: profile, XDG_CACHE_HOME: join(profile, 'cache'),
  LUANTI_USER_PATH: profile, TMPDIR: join(root, 'tmp') };
const operatorAuthority = { verify: async input => ({ current: true, ...input, worldStopped: true }) };
const logs = [];
class DiagnosticWorkshop {
  #calls = [];
  get calls() { return this.#calls; }
  async invokeAction(request, principal) {
    this.#calls.push({ invocationId: request.invocationId, principal,
      input: request.input, sessionRef: request.sessionRef, authorizationRef: request.authorizationRef });
    return { invocationId: request.invocationId, resultRevision: `diag-${this.#calls.length}`,
      ownerRef: 'diagnostic-workshop', domainReceiptDigest: null, accepted: true };
  }
  async verifyFrameDelivery({ worldRef, engineActorName, frame, authorizationRef }) {
    return { current: true, worldRef, engineActorName, sessionRef: frame.sessionRef,
      authorizationRef, actorRef: 'actor:alice' };
  }
}
const ctx = { effect(run) { run(); }, webServer: { register() {} }, provide() {},
  hanaworldsOperatorAuthority: operatorAuthority,
  hanaworldsAuthority: { verify: async request => ({ current: true, sessionRef: request.sessionRef,
    authorizationRef: request.authorizationRef, worldRef: request.worldRef, actorRef: 'actor:alice',
    engineActorName: 'alice', authorizerRef: 'diag-operator', bindingRef: 'diag-binding',
    grantEpoch: 'diag-epoch', allowedActions: ['INSPECT'] }) } };
let server, client, service;
const frameFor = n => ({ sessionRef: 'diag-session', turnRevision: `turn-${n}`, frameRef: `frame-${n}`,
  frameRevision: `frame-rev-${n}`, content: `Diagnostic frame ${n}`, actions: [
    { actionId: 'continue', surfaceActionDigest: 'a'.repeat(64), inputKinds: ['TEXT'],
      surfaceAction: { contractVersion: 'interaction-surface/v2', sessionRef: 'diag-session',
        turnRevision: `turn-${n}`, frameRef: `frame-${n}`, frameRevision: `frame-rev-${n}`,
        actionId: 'continue', orderedTargetRefs: [], intentDigest: 'b'.repeat(64),
        operationDigest: null, analysisDigest: null, decisionRevision: null } }] });
const present = n => service.presentFrame({ worldRef: identity.worldRef, engineActorName: 'alice',
  authorizationRef: 'diag-grant', frame: frameFor(n) });
let identity;
try {
  service = plugin.apply(ctx, { localWorldRoots: [worlds], serviceName: 'operator' });
  identity = await service.provisionLocal(world, transportPort);
  const serverLog = join(root, 'server.log');
  logs.push(serverLog);
  server = spawn(luanti, ['--server', '--world', world, '--config', config, '--logfile', serverLog],
    { env, stdio: 'ignore' });
  await waitFor(serverLog, 'HanaWorlds relay probe ready; payload=true', server);
  const clientConfig = join(root, 'client.conf');
  await writeFile(clientConfig, 'enable_sound = false\nscreen_w = 320\nscreen_h = 240\n');
  logs.push(join(root, 'client.log'));
  client = spawn(luanti, ['--go', '--address', '127.0.0.1', '--port', String(serverPort),
    '--name', 'alice', '--password', '', '--config', clientConfig, '--logfile', join(root, 'client.log')],
  { env, stdio: 'ignore' });
  await waitFor(serverLog, 'HanaWorlds relay probe: alice joined', server, 1200);

  // 1. The plugin binds the real world through its own configured roots.
  const inventory = await service.worldAdapter.call('DiscoverConnections', { contractVersion: 'world-adapter/v4',
    actorRef: 'canvas', sessionRef: 'diag-session', requestId: 'discover', authorizationRef: 'diag-grant',
    adapterId: 'hanaworlds-adapter-luanti' });
  const row = inventory.result.connections.find(c => c.worldRef === identity.worldRef);
  assert.ok(row, 'configured localWorldRoots discovered the provisioned world');
  const bound = await service.worldAdapter.call('AuthorizeBinding', { contractVersion: 'world-adapter/v4',
    actorRef: 'canvas', sessionRef: 'diag-session', requestId: 'bind', authorizationRef: 'diag-grant',
    worldRef: identity.worldRef, connectionRef: row.connectionRef,
    expectedCapabilityRevision: row.capabilityRevision });
  assert.equal(bound.error, null, JSON.stringify(bound.error));
  // The courier is opened by the binding itself; the payload pairs on its next poll.
  await waitFor(serverLog, 'HanaWorlds local courier paired on loopback', server);
  note('bind-real-world', { worldRef: identity.worldRef, payloadDigest: bound.result.payloadDigest });

  // 2. Workshop not provided yet: frame delivery refused, nothing shown.
  const early = await present(1).then(() => 'DELIVERED', e => e.message);
  assert.equal(early, 'RENDERER_CAPABILITY_UNAVAILABLE');
  note('frame-before-workshop', { outcome: early });

  // 3. Workshop provided after start: frame shown in-game and the button relays once.
  const workshop = new DiagnosticWorkshop();
  ctx.hanaworldsWorkshop = workshop;
  assert.equal(await present(2), true);
  await writeFile(join(world, 'hw_click_1.json'), JSON.stringify(frameFor(2)));
  await until(() => workshop.calls.length === 1, 'Workshop invokeAction from the in-world click');
  const call = workshop.calls[0];
  assert.deepEqual(call.principal, { engineActorName: 'alice', worldRef: identity.worldRef });
  assert.equal(call.input.kind, 'TEXT');
  note('late-workshop-relay', { calls: workshop.calls.length, principal: call.principal,
    sessionRef: call.sessionRef, authorizationRef: call.authorizationRef, inputKind: call.input.kind });

  // 4. Workshop's invokeAction withdrawn after the frame was shown: the click is not relayed.
  ctx.hanaworldsWorkshop = { verifyFrameDelivery: (...a) => workshop.verifyFrameDelivery(...a) };
  assert.equal(await present(3), true);
  await writeFile(join(world, 'hw_click_2.json'), JSON.stringify(frameFor(3)));
  await waitFor(serverLog, 'HanaWorlds relay probe: clicked 2', server);
  await waitFor(serverLog, 'HanaWorlds action transport unavailable', server);
  assert.equal(workshop.calls.length, 1, 'withdrawn provider received nothing');
  note('withdrawn-workshop-relay', { calls: workshop.calls.length,
    serverLogged: 'HanaWorlds action transport unavailable' });

  // 5. Workshop withdrawn entirely: frame delivery refused again.
  delete ctx.hanaworldsWorkshop;
  const late = await present(4).then(() => 'DELIVERED', e => e.message);
  assert.equal(late, 'RENDERER_CAPABILITY_UNAVAILABLE');
  note('frame-after-withdrawal', { outcome: late });

  // Relay records were written in the engine before each delivery attempt.
  const state = JSON.parse(await readFile(join(world, 'hanaworlds_adapter_engine_state.json'), 'utf8'));
  note('engine-relay-records', { relayRecords: Object.keys(state.relays ?? {}).length,
    picks: Object.keys(state.picks ?? {}).length });
  console.log(JSON.stringify({ scenario: 'real-workshop-relay', realLuanti: '5.17.0',
    realConnectedClient: true, diagnosticAuthority: true, diagnosticWorkshop: true,
    inEngineButtonPressByProbe: true, installedPackage: installed, results, logs }, null, 1));
} finally {
  for (const child of [client, server]) {
    if (child && child.exitCode === null && child.signalCode === null) {
      const exited = new Promise(done => child.once('exit', done));
      child.kill('SIGINT');
      await exited;
    }
  }
  if (service) await service.close();
}
