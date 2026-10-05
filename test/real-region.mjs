// Diagnostic only (REAL_RUNTIME): an installed Adapter package against a real
// Luanti server in an isolated profile. Host authority, Canvas, catalogue and
// capacity are diagnostic stand-ins, and the probe mod sets terrain, a
// protection rule and the joining player's pose. It is not Canvas/Workshop,
// REAL_UI or product proof.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { cp, mkdir, readFile, rm, writeFile, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const installed = process.env.HW_INSTALLED_PLUGIN_DIR;
const previous = process.env.HW_PREVIOUS_PLUGIN_DIR; // admitted 0.1.1 package
const runtimeRoot = process.env.HW_RUNTIME_ROOT;
const worldEditDirectory = process.env.HW_WORLDEDIT_DIR;
const withClient = process.env.HW_REAL_CLIENT === '1';
if (!installed || !previous || !runtimeRoot || !worldEditDirectory)
  throw new Error('HW_INSTALLED_PLUGIN_DIR, HW_PREVIOUS_PLUGIN_DIR, HW_RUNTIME_ROOT, HW_WORLDEDIT_DIR required');
const v2 = await import(pathToFileURL(join(installed, 'src/index.mjs')).href);
const v1 = await import(pathToFileURL(join(previous, 'src/index.mjs')).href);
// The installed package's own contracts dependency (npm nests it; pnpm hoists it beside the package).
const contractsDir = [join(installed, 'vendor/hanaworlds-contracts'),
  join(installed, 'node_modules/hanaworlds-contracts'),
  join(installed, '..', 'hanaworlds-contracts')].find(dir => existsSync(join(dir, 'package.json')));
const { digestValue } = await import(pathToFileURL(join(contractsDir, 'dist/v4/index.mjs')).href);

const root = resolve(runtimeRoot, `run-${Date.now()}`);
const profile = join(root, 'profile');
const world = join(profile, 'worlds', 'world');
const game = join(profile, 'games', 'hw_minimal');
const worldmod = join(world, 'worldmods', 'hanaworlds_adapter');
const luanti = '/Applications/luanti.app/Contents/MacOS/luanti';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const results = [];
const note = (step, value) => { results.push({ step, ...value }); };

async function freePort() {
  const socket = createServer();
  await new Promise(done => socket.listen(0, '127.0.0.1', done));
  const port = socket.address().port;
  await new Promise(done => socket.close(done));
  return port;
}
// The wait is observability: it names the log line awaited and the process state.
async function waitFor(path, phrase, child, tenths = 900) {
  for (let i = 0; i < tenths; i++) {
    if (child.exitCode !== null) throw new Error(`LUANTI_EXITED_BEFORE: ${phrase}`);
    if ((await readFile(path, 'utf8').catch(() => '')).includes(phrase)) return;
    await delay(100);
  }
  throw new Error(`WAITED_${tenths / 10}s_FOR_LOG_LINE: ${phrase}; exit=${child.exitCode}`);
}

await mkdir(join(world, 'worldmods'), { recursive: true });
await mkdir(game, { recursive: true });
await mkdir(join(root, 'tmp'), { recursive: true });
await writeFile(join(game, 'game.conf'), 'title = HanaWorlds region probe\n');
await writeFile(join(world, 'world.mt'), 'gameid = hw_minimal\nbackend = sqlite3\n');
await cp(worldEditDirectory, join(world, 'worldmods', 'worldedit'), { recursive: true });
const probe = join(world, 'worldmods', 'hw_region_probe');
await mkdir(probe);
await writeFile(join(probe, 'mod.conf'), 'name = hw_region_probe\ndepends = worldedit\n');
// Terrain: y=0 stone, y=1..4 air over x -6..6, z -3..12. Cell (0,1,3) is
// protected for alice through the chained is_protected.
await writeFile(join(probe, 'init.lua'), `
minetest.register_node('hw_region_probe:stone', {description = 'Probe stone', tiles = {'unknown_node.png'}})
local old = minetest.is_protected
function minetest.is_protected(pos, name)
  if name == 'alice' and pos.x == 0 and pos.y == 1 and pos.z == 3 then return true end
  return old(pos, name)
end
minetest.register_on_joinplayer(function(player)
  if player:get_player_name() ~= 'alice' then return end
  minetest.set_player_privs('alice', {interact = true, worldedit = true, shout = true})
  player:set_pos({x = 0.2, y = 0.5, z = -0.3})
  player:set_look_horizontal(0.1)
  minetest.after(1, function() minetest.log('action', 'HanaWorlds region probe: alice placed') end)
end)
minetest.after(0, function()
  local auth = minetest.get_auth_handler()
  if not auth.get_auth('operator') then auth.create_auth('operator', '') end
  -- alice is a registered engine account (the grant's principal), online or not.
  if not auth.get_auth('alice') then auth.create_auth('alice', minetest.get_password_hash('alice', '')) end
  minetest.set_player_privs('operator', {worldedit = true})
  minetest.load_area({x = -6, y = 0, z = -3}, {x = 6, y = 4, z = 12})
  for x = -6, 6 do for z = -3, 12 do
    minetest.set_node({x = x, y = 0, z = z}, {name = 'hw_region_probe:stone'})
    for y = 1, 4 do minetest.set_node({x = x, y = y, z = z}, {name = 'air'}) end
  end end
  local adapter = rawget(_G, 'hanaworlds_adapter')
  if adapter and adapter.region and not adapter.region.picks['diag-pick-1'] then
    -- Diagnostic pick record standing in for an in-world raycast + confirm.
    adapter.region:record_pick('diag-pick-1', 'diag-session', adapter.capabilities().worldRef,
      'alice', {5, 0, 5}, 4.7)
  end
  minetest.log('action', 'HanaWorlds region probe ready; payload=' .. tostring(adapter ~= nil)
    .. '; region=' .. tostring(adapter ~= nil and adapter.region ~= nil))
end)
`);
const transportPort = await freePort();
const serverPort = await freePort();
const config = join(root, 'luanti.conf');
await writeFile(config, `bind_address = 127.0.0.1\nport = ${serverPort}\nserver_announce = false\n` +
  `secure.enable_security = true\nsecure.http_mods = hanaworlds_adapter\n` +
  `static_spawnpoint = 0,1,0\nenable_damage = false\ndisallow_empty_password = false\n`);
const operatorAuthority = { verify: async ({ worldPath, action }) =>
  ({ current: true, worldPath, action, worldStopped: true }) };
const env = { ...process.env, HOME: profile, XDG_CACHE_HOME: join(profile, 'cache'),
  LUANTI_USER_PATH: profile, TMPDIR: join(root, 'tmp') };
let server, client, output = '';
const logs = [];
async function start(stage, phrase) {
  const log = join(root, `server-${stage}.log`);
  logs.push(log);
  server = spawn(luanti, ['--server', '--world', world, '--config', config, '--logfile', log],
    { env, stdio: ['ignore', 'pipe', 'pipe'] });
  server.stdout.on('data', b => { output += b; });
  server.stderr.on('data', b => { output += b; });
  await waitFor(log, phrase, server);
  return log;
}
async function stopAll() {
  for (const child of [client, server]) {
    if (!child || child.exitCode !== null || child.signalCode !== null) continue;
    const exited = new Promise(done => child.once('exit', done));
    child.kill('SIGINT');
    await exited;
  }
  client = null;
}
async function startClient(log) {
  const clientConfig = join(root, 'client.conf');
  await writeFile(clientConfig, 'enable_sound = false\nscreen_w = 320\nscreen_h = 240\n');
  client = spawn(luanti, ['--go', '--address', '127.0.0.1', '--port', String(serverPort),
    '--name', 'alice', '--password', '', '--config', clientConfig,
    '--logfile', join(root, 'client.log')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  client.stdout.on('data', b => { output += b; });
  client.stderr.on('data', b => { output += b; });
  await waitFor(log, 'HanaWorlds region probe: alice placed', server, 1200);
}

const profileState = { profileVersion: 'state-profile/v2', nodeFields: ['nodeName', 'param1', 'param2'],
  metadataMode: 'exact', inventoryMode: 'exact', timerMode: 'exact',
  derivedLightMode: 'recompute-with-readback' };
const catalogue = { profileVersion: 'catalogue/v2', engineProfile: 'luanti-5.17.0-diagnostic',
  gameId: 'hw_minimal', gameRevision: 'diagnostic-1', modRevisions: { hw_region_probe: 'diagnostic-1' },
  nodes: {
    air: { walkable: false, collisionBoxes: [], liquidType: 'none', damagePerSecond: 0, lightSource: 0,
      param2Type: 'none', allowedParam2: [0], hasCallbacks: false, hasPersistentState: false,
      definitionRevision: 'diagnostic-1', unknownFields: [] },
    'hw_region_probe:stone': { walkable: true, collisionBoxes: [[-0.5, -0.5, -0.5, 0.5, 0.5, 0.5]],
      liquidType: 'none', damagePerSecond: 0, lightSource: 0, param2Type: 'none', allowedParam2: [0],
      hasCallbacks: false, hasPersistentState: false, definitionRevision: 'diagnostic-1', unknownFields: [] } } };
let worldRevision = 'diag-world-1';
async function adapterFor(courier, worldRef, journalDir) {
  const grant = request => ({ current: true, worldRef, sessionRef: request.sessionRef,
    authorizationRef: request.authorizationRef, actorRef: 'diag-actor', authorRef: 'diag-actor',
    engineActorName: 'alice', allowedActions: ['INSPECT', 'APPLY_RECOVERABLE', 'READBACK', 'HISTORY'] });
  const backend = new v2.V4TransactionBackend({ journal: await v2.DurableJournal.open(journalDir),
    engine: courier, stateProfile: profileState,
    revisionOracle: { read: async () => worldRevision, readObjects: async () => ({}) },
    verifyBinding: async (request, action, { requireOnline = true } = {}) => {
      const binding = grant(request);
      // Same rule as the DSH plugin entry: a principal that is not currently
      // verifiable in-engine yields no binding.
      if (requireOnline) {
        try { await courier.verifyPrincipal(binding.engineActorName); } catch { return null; }
      }
      return binding;
    },
    verifyService: async () => true, capacity: { check: async () => ({ allowed: true }) },
    catalogue: { read: async () => catalogue },
    executionRevision: `hanaworlds-adapter-luanti@0.2.5+payload.${await v2.payloadDigest()}` });
  return new v2.WorldAdapterV4({ authority: {
    verify: async request => ({ current: true, sessionRef: request.sessionRef,
      authorizationRef: request.authorizationRef, worldRef, domainOwner: 'hanaworlds-canvas' }),
    verifyService: async request => ({ current: true, sessionRef: request.sessionRef,
      authorizationRef: request.authorizationRef, worldRef, domainOwner: 'hanaworlds-canvas' }) },
  operations: { InspectRegion: r => backend.inspectRegion(r),
    PrepareRecoverableTransaction: r => backend.prepare(r),
    QueryPreparedTransaction: r => backend.queryPrepared(r),
    AbortPreparedTransaction: r => backend.abortPrepared(r) } });
}
let seq = 0;
const inspect = (worldRef, anchor, sessionRef = 'diag-session') => ({ contractVersion: 'world-adapter/v4',
  actorRef: 'canvas-service-principal', sessionRef, requestId: `diag-${++seq}`,
  authorizationRef: 'diag-grant', worldRef, expectedWorldRevision: worldRevision,
  inspectionId: `diag-inspection-${seq}`, anchor,
  footprint: { widthCells: 1, depthCells: 1, heightCells: 1 },
  placementSettings: { frontGapCells: 2, forwardSearchCells: 16, lateralSearchCells: 8,
    verticalSearchCells: 4, settingsRevision: 'diag-settings-1' } });
function prepareRequest(worldRef, transactionId, position) {
  const operations = { contractVersion: 'operations/v2', buildDigest: 'a'.repeat(64),
    compilerRevision: 'diag', compilationConfigDigest: 'b'.repeat(64), worldRef,
    frameDigest: 'c'.repeat(64), catalogueDigest: 'd'.repeat(64), targetFactsDigest: 'e'.repeat(64),
    effects: [{ position, nodeName: 'hw_region_probe:stone', param2: 0 }] };
  const operationDigest = digestValue('operations', operations).sha256;
  return { contractVersion: 'world-adapter/v4', actorRef: 'canvas-service-principal',
    sessionRef: 'diag-session', requestId: `prep-${transactionId}`, authorizationRef: 'diag-grant',
    worldRef, transactionId, operationDigest, operations,
    authorizationBinding: { contractVersion: 'world-adapter/v2', authorizerRef: 'diag-authorizer',
      actorRef: 'diag-actor', grantEpoch: 'diag-epoch', bindingRef: 'diag-binding', worldRef,
      sessionRef: 'diag-session', turnRevision: 'diag-turn', intentDigest: 'f'.repeat(64),
      surfaceActionDigest: '1'.repeat(64), allowedAction: 'APPLY_RECOVERABLE', transactionId,
      operationDigest, worldRevision, selectionRevision: 'diag-selection', analysisDigest: null,
      decisionRevision: null },
    expectedWorldRevision: worldRevision, expectedObjectRevisions: {}, guarantee: 'RECOVERABLE_VERIFIED' };
}
const publicOnly = value => {
  const text = JSON.stringify(value);
  for (const key of ['"pos"', '"yaw"', '"pickerYaw"', '"collisionbox"', 'lookHorizontal'])
    assert.equal(text.includes(key), false, `raw pose key ${key} exported`);
  return value;
};

let courier, preparedDigest;
try {
  // 1. Admitted 0.1.1 payload, provisioned and loaded by the 0.1.1 package.
  const old = await v1.apply({ webServer: { register() {} }, hanaworldsOperatorAuthority: operatorAuthority })
    .provisionLocal(world, transportPort);
  courier = await v1.LocalEngineTransport.open(world, { serviceName: 'operator' });
  await start('v011', 'HanaWorlds region probe ready; payload=true; region=false');
  const oldLoaded = await courier.handshake();
  assert.equal(oldLoaded.payloadDigest, old.payloadDigest);
  note('v011-loaded', { worldRef: old.worldRef, payloadVersion: oldLoaded.payloadVersion,
    loadedDigest: oldLoaded.payloadDigest, manifestDigest: old.payloadDigest });
  await stopAll(); await courier.close();

  // 2. Upgrade to 0.2.5 with the same world identity and pairing.
  const service = v2.apply({ webServer: { register() {} }, hanaworldsOperatorAuthority: operatorAuthority });
  const up = await service.provisionLocal(world, null);
  assert.equal(up.worldRef, old.worldRef);
  assert.equal(up.payloadVersion, '0.2.5');
  courier = await v2.LocalEngineTransport.open(world, { serviceName: 'operator' });
  const upLog = await start('v020', 'HanaWorlds region probe ready; payload=true; region=true');
  await waitFor(upLog, 'HanaWorlds local courier paired on loopback', server);
  const loaded = await courier.handshake();
  const installedDigest = await v2.payloadDigest();
  const files = {};
  for (const name of ['mod.conf', 'init.lua', 'engine.lua', 'transport.lua', 'region.lua'])
    files[name] = { installedPackage: sha(await readFile(join(installed, 'payload/hanaworlds_adapter', name))),
      worldmod: sha(await readFile(join(worldmod, name))) };
  assert.equal(loaded.payloadDigest, installedDigest);
  assert.ok(Object.values(files).every(f => f.installedPackage === f.worldmod));
  note('v020-loaded', { worldRef: up.worldRef, loadedDigest: loaded.payloadDigest, installedDigest,
    manifestDigest: up.payloadDigest, fileIdentity: files });
  assert.match(await readFile(upLog, 'utf8'), /engine state readable/);
  const journalDir = join(root, 'journal');
  let port = await adapterFor(courier, up.worldRef, journalDir);

  // 3. Shell-started turn with nobody online: typed ask, zero writes.
  const none = publicOnly(await port.call('InspectRegion', inspect(up.worldRef,
    { kind: 'DEFAULT_PLAYER', invocationId: 'shell-invocation-1' })));
  assert.deepEqual(none.result?.choice?.reasons, ['NO_ONLINE_PLAYER'], JSON.stringify(none.error));
  note('inspect-no-player', { outcome: none.result.outcome, reasons: none.result.choice.reasons,
    options: none.result.choice.options });

  // 4. Picked point (diagnostic pick record) evaluated by the real engine.
  const picked = publicOnly(await port.call('InspectRegion', inspect(up.worldRef,
    { kind: 'PICKED_POINT', pickRef: 'diag-pick-1' })));
  assert.equal(picked.error, null, JSON.stringify(picked.error));
  assert.deepEqual(picked.result.inspection.targetFacts.sampledBounds, { min: [5, 0, 5], max: [5, 1, 5] });
  assert.equal(picked.result.inspection.entranceFacing, '-X');
  note('inspect-picked-point', { sampledBounds: picked.result.inspection.targetFacts.sampledBounds,
    entranceFacing: picked.result.inspection.entranceFacing,
    occupiedCells: picked.result.inspection.targetFacts.occupiedCells,
    frameDigestMatches: picked.result.inspection.targetFacts.frameDigest ===
      digestValue('frame', picked.result.inspection.frame).sha256,
    evidence: picked.result.inspection.evidence });
  const forged = await port.call('InspectRegion', inspect(up.worldRef,
    { kind: 'PICKED_POINT', pickRef: 'diag-pick-1' }, 'other-session'));
  assert.equal(forged.error.code, 'PERMISSION_DENIED');
  note('inspect-pick-other-session', { error: forged.error });

  // 5. A real connected player (client process) when available.
  if (withClient) {
    await startClient(upLog);
    const sole = publicOnly(await port.call('InspectRegion', inspect(up.worldRef,
      { kind: 'DEFAULT_PLAYER', invocationId: 'shell-invocation-2' })));
    assert.equal(sole.error, null, JSON.stringify(sole.error));
    const insp = sole.result.inspection;
    // Feet (0,1,0), facing +Z, gap 2 -> (0,1,3) is protected for alice; v=-1 is
    // stone, v=+1 has no ground; t=+1 -> (1,1,3) on stone (1,0,3).
    assert.deepEqual(insp.targetFacts.sampledBounds, { min: [1, 0, 3], max: [1, 1, 3] });
    assert.equal(insp.entranceFacing, '-Z');
    note('inspect-real-player', { sampledBounds: insp.targetFacts.sampledBounds,
      entranceFacing: insp.entranceFacing, protectedPositions: insp.protectedPositions,
      bodyOccupiedPositions: insp.bodyOccupiedPositions });
    const body = await port.call('PrepareRecoverableTransaction', prepareRequest(up.worldRef, 'tx-body', [0, 1, 0]));
    assert.equal(body.error?.code, 'SAFETY_INVARIANT_FAILED');
    const prot = await port.call('PrepareRecoverableTransaction', prepareRequest(up.worldRef, 'tx-protected', [0, 1, 3]));
    assert.equal(prot.error?.code, 'PERMISSION_DENIED');
    const ok = await port.call('PrepareRecoverableTransaction', prepareRequest(up.worldRef, 'tx-ok', [1, 1, 3]));
    assert.equal(ok.error, null, JSON.stringify(ok.error));
    preparedDigest = ok.result.beforeStateReadbackDigest;
    note('prepare-real-recheck', { bodyCell: body.error, protectedCell: prot.error,
      prepared: { beforeImageDigest: ok.result.beforeImageDigest,
        beforeStateReadbackDigest: ok.result.beforeStateReadbackDigest } });
  }
  await stopAll();

  // 6. Restart: picks and the prepared digest survive.
  courier.close && await courier.close();
  courier = await v2.LocalEngineTransport.open(world, { serviceName: 'operator' });
  const restartLog = await start('restart', 'HanaWorlds region probe ready; payload=true; region=true');
  await waitFor(restartLog, 'HanaWorlds local courier paired on loopback', server);
  port = await adapterFor(courier, up.worldRef, journalDir);
  if (withClient) await startClient(restartLog);
  const again = await port.call('InspectRegion', inspect(up.worldRef, { kind: 'PICKED_POINT', pickRef: 'diag-pick-1' }));
  assert.deepEqual(again.result.inspection.targetFacts.sampledBounds, { min: [5, 0, 5], max: [5, 1, 5] });
  const stateFile = join(world, 'hanaworlds_adapter_engine_state.json');
  note('restart', { pickAfterRestart: again.result.outcome,
    engineStateFileBytes: (await stat(stateFile)).size });
  if (withClient) {
    const req = prepareRequest(up.worldRef, 'tx-ok', [1, 1, 3]);
    const query = await port.call('QueryPreparedTransaction', { contractVersion: 'world-adapter/v4',
      actorRef: 'canvas-service-principal', sessionRef: 'diag-session', requestId: 'query-after-restart',
      authorizationRef: 'diag-grant', worldRef: up.worldRef, transactionId: 'tx-ok',
      operationDigest: req.operationDigest,
      authorizationBindingDigest: digestValue('authorization-binding', req.authorizationBinding).sha256 });
    assert.equal(query.error, null, JSON.stringify(query.error));
    note('query-prepared-after-restart', { beforeStateReadbackDigest: query.result.beforeStateReadbackDigest,
      sameAsPrepare: query.result.beforeStateReadbackDigest === preparedDigest });
  }
  await stopAll(); await courier.close(); courier = null;

  // 7. Rollback to the admitted 0.1.1 payload, then re-upgrade.
  const rolled = await service.rollbackLocal(world, '0.1.1');
  assert.equal(rolled.payloadDigest, old.payloadDigest);
  courier = await v1.LocalEngineTransport.open(world, { serviceName: 'operator' });
  await start('rolled-back', 'HanaWorlds region probe ready; payload=true; region=false');
  const rolledLoaded = await courier.handshake();
  assert.equal(rolledLoaded.payloadDigest, old.payloadDigest);
  assert.equal(rolledLoaded.worldRef, old.worldRef);
  note('rollback-0.1.1', { loadedDigest: rolledLoaded.payloadDigest, worldRef: rolledLoaded.worldRef,
    retainedPayload: rolled.retainedPayload, engineStateRetained: (await stat(stateFile)).size > 0 });
  await stopAll(); await courier.close();
  const reup = await service.provisionLocal(world, null);
  assert.equal(reup.worldRef, old.worldRef);
  courier = await v2.LocalEngineTransport.open(world, { serviceName: 'operator' });
  await start('re-upgraded', 'HanaWorlds region probe ready; payload=true; region=true');
  assert.equal((await courier.handshake()).payloadDigest, installedDigest);
  note('re-upgrade-0.2.5', { worldRef: reup.worldRef });
  await stopAll(); await courier.close(); courier = null;

  // 8. Uninstall and reinstall the payload.
  const before = (await readdir(join(world, 'worldmods'))).sort();
  await rm(worldmod, { recursive: true });
  await start('uninstalled', 'HanaWorlds region probe ready; payload=false');
  await stopAll();
  // Saved payloads (0.1.1 backup, retained 0.2.5) still carry the old identity:
  // reinstall refuses until the operator chooses restore or a fresh identity.
  const refused = await service.provisionLocal(world, transportPort).then(() => null, e => e);
  assert.equal(refused?.message, 'RECOVERY_PENDING');
  assert.ok(refused.directories.length >= 1);
  const fresh = await service.provisionLocal(world, transportPort, { freshIdentity: true });
  courier = await v2.LocalEngineTransport.open(world, { serviceName: 'operator' });
  await start('reinstalled', 'HanaWorlds region probe ready; payload=true; region=true');
  const reinstalled = await courier.handshake();
  assert.equal(reinstalled.payloadDigest, installedDigest);
  note('uninstall-reinstall', { worldmodsBefore: before, refusedWithoutChoice: refused.message,
    refusedDirectories: refused.directories, newWorldRef: fresh.worldRef,
    loadedDigest: reinstalled.payloadDigest, engineStateRetained: (await stat(stateFile)).size > 0,
    journalRetained: (await readdir(journalDir)).length });
  await stopAll();
  await service.close();
  console.log(JSON.stringify({ scenario: 'real-region-lifecycle', realLuanti: '5.17.0',
    realConnectedPlayer: withClient, diagnosticAuthority: true, diagnosticPickRecord: true,
    installedPackage: installed, results, logs }, null, 1));
} finally {
  await stopAll();
  if (courier) await courier.close();
  if (/[0-9a-f]{64}/.test(output) && output.includes('token')) throw new Error('SECRET_IN_RUNTIME_OUTPUT');
}
