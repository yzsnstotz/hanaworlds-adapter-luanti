// Diagnostic only: an isolated installed DSH package and real Luanti world.
// This is not a player-visible Canvas or Workshop acceptance test.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const installed = process.env.HW_INSTALLED_PLUGIN_DIR;
if (!installed) throw new Error('HW_INSTALLED_PLUGIN_DIR_REQUIRED');
const { apply, DurableJournal, EngineBridge, LocalEngineTransport, payloadDigest } =
  await import(pathToFileURL(join(installed, 'src/index.mjs')).href);
const isolatedRoot = process.env.HW_RUNTIME_ROOT;
const worldEditDirectory = process.env.HW_WORLDEDIT_DIR;
if (!isolatedRoot || !worldEditDirectory) throw new Error('ISOLATED_RUNTIME_AND_PUBLIC_WORLDEDIT_REQUIRED');
const root = resolve(isolatedRoot, `run-${Date.now()}`);
const profile = join(root, 'profile');
const world = join(profile, 'worlds', 'world');
const game = join(profile, 'games', 'hw_minimal');
const worldmod = join(world, 'worldmods', 'hanaworlds_adapter');
const journalDir = join(root, 'journal');
const luanti = '/Applications/luanti.app/Contents/MacOS/luanti';
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const shaFile = async path => createHash('sha256').update(await readFile(path)).digest('hex');
const journalDigest = async () => {
  const hash = createHash('sha256');
  for (const name of (await readdir(journalDir)).sort()) {
    hash.update(name);
    hash.update(await readFile(join(journalDir, name)));
  }
  return hash.digest('hex');
};
async function freePort() {
  const socket = createServer();
  await new Promise(done => socket.listen(0, '127.0.0.1', done));
  const port = socket.address().port;
  await new Promise(done => socket.close(done));
  return port;
}
async function waitFor(path, phrase, child) {
  for (let i = 0; i < 600; i++) {
    if (child.exitCode !== null) throw new Error(`LUANTI_EXITED_BEFORE_${phrase}`);
    const log = await readFile(path, 'utf8').catch(() => '');
    if (log.includes(phrase)) return;
    await delay(100);
  }
  throw new Error(`LUANTI_READY_TIMEOUT_${phrase}; logPresent=${
    (await readFile(path).catch(() => null)) !== null}; exit=${child.exitCode}; signal=${child.signalCode}`);
}

await mkdir(join(world, 'worldmods'), { recursive: true });
await mkdir(game, { recursive: true });
await writeFile(join(game, 'game.conf'), 'title = HanaWorlds lifecycle probe\n');
await writeFile(join(world, 'world.mt'), 'gameid = hw_minimal\nbackend = sqlite3\n');
await cp(worldEditDirectory, join(world, 'worldmods', 'worldedit'),
  { recursive: true });
const probe = join(world, 'worldmods', 'hw_lifecycle_probe');
await mkdir(probe);
await writeFile(join(probe, 'mod.conf'), 'name = hw_lifecycle_probe\ndepends = worldedit\n');
await writeFile(join(probe, 'init.lua'), `minetest.register_node('hw_lifecycle_probe:stone',
  {description = 'Diagnostic stone', tiles = {'unknown_node.png'}})
local storage = minetest.get_mod_storage()
minetest.after(0, function()
  local auth = minetest.get_auth_handler()
  if not auth.get_auth('operator') then auth.create_auth('operator', '') end
  minetest.set_player_privs('operator', {worldedit = true})
  minetest.load_area({x=0,y=0,z=0}, {x=0,y=0,z=0})
  if storage:get_string('initialized') ~= 'yes' then
    minetest.set_node({x=0,y=0,z=0}, {name='air'})
    storage:set_string('initialized', 'yes')
  end
  minetest.log('action', 'HanaWorlds lifecycle probe ready; payload=' ..
    tostring(rawget(_G, 'hanaworlds_adapter') ~= nil))
end)
`);
const transportPort = await freePort();
const serverPort = await freePort();
const config = join(root, 'luanti.conf');
await writeFile(config, `bind_address = 127.0.0.1\nport = ${serverPort}\nserver_announce = false\nsecure.enable_security = true\nsecure.http_mods = hanaworlds_adapter\n`);
const operatorAuthority = { verify: async ({ worldPath, action }) =>
  ({ current: true, worldPath, action, worldStopped: true }) };
const service = apply({ webServer: { register() {} }, hanaworldsOperatorAuthority: operatorAuthority });
const sourcePayloadDigest = await payloadDigest();
const first = await service.provisionLocal(world, transportPort);
assert.equal(first.payloadDigest, sourcePayloadDigest);
let courier = await LocalEngineTransport.open(world, { serviceName: 'operator' });
let child;
let output = '';
const logs = [];
async function start(stage, payloadPresent) {
  const log = join(root, `luanti-${stage}.log`);
  logs.push(log);
  child = spawn(luanti, ['--server', '--world', world, '--config', config, '--logfile', log], {
    env: { ...process.env, HOME: profile, XDG_CACHE_HOME: join(profile, 'cache'),
      LUANTI_USER_PATH: profile, TMPDIR: join(root, 'tmp') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', bytes => { output += bytes.toString(); });
  child.stderr.on('data', bytes => { output += bytes.toString(); });
  await waitFor(log, `HanaWorlds lifecycle probe ready; payload=${payloadPresent}`, child);
  if (payloadPresent) await waitFor(log, 'HanaWorlds local courier paired on loopback', child);
  return log;
}
async function stop() {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise(done => child.once('exit', done));
  child.kill('SIGINT');
  await exited;
}

try {
  await mkdir(join(root, 'tmp'), { recursive: true });
  const firstLog = await start('initial', true);
  const firstLoaded = await courier.handshake();
  assert.equal(firstLoaded.worldRef, first.worldRef);
  assert.equal(firstLoaded.payloadDigest, sourcePayloadDigest);
  // A current player-confirmed native grant is required even in diagnostics.
  const principal = await courier.verifyPrincipal('operator');
  const binding = { current: true, worldRef: first.worldRef,
    engineActorName: 'operator', nativeGrantRef: principal.grantRef,
    allowedActions: ['APPLY_RECOVERABLE', 'READBACK', 'HISTORY'] };
  const positions = [[0, 0, 0]];
  const before = await courier.snapshot({ coveredPositions: positions }, binding);
  assert.equal(before.records[0].nodeName, 'air');
  const effects = [{ position: positions[0], nodeName: 'hw_lifecycle_probe:stone', param2: 0 }];
  const request = { transactionId: 'tx-lifecycle-real', worldRef: first.worldRef,
    operationDigest: digest(effects), transactionPayloadDigest: digest({ effects }),
    beforeImageDigest: digest(before), coveredPositions: positions, effects };
  const journal = await DurableJournal.open(journalDir);
  const bridge = new EngineBridge({ journal, engine: courier, admit: (_, raw) => raw,
    verifyBinding: async () => binding, verifyService: async () => true,
    digestBeforeImage: digest, digestReadback: digest });
  assert.equal((await bridge.prepare(request)).status, 'PREPARED');
  assert.equal((await bridge.apply(request)).status, 'APPLIED_PENDING_READBACK');
  assert.equal((await bridge.readback(request)).projection.records[0].nodeName,
    'hw_lifecycle_probe:stone');
  assert.equal((await bridge.restore({ worldRef: request.worldRef,
    originTransactionId: request.transactionId,
    operationDigest: request.operationDigest, beforeImageDigest: request.beforeImageDigest,
    restoreAttemptIdentity: 'restore-lifecycle-real' })).status, 'ROLLED_BACK');
  assert.equal((await courier.readback({ coveredPositions: positions }, binding))
    .records[0].nodeName, 'air');
  // A separately fsynced v3 history image retains full node state. The
  // diagnostic fixture supplies the host authority; Luanti executes the real
  // WorldEdit and metadata path under the isolated operator privilege.
  const profileState = { profileVersion: 'state-profile/v2',
    nodeFields: ['nodeName', 'param1', 'param2'], metadataMode: 'exact',
    inventoryMode: 'exact', timerMode: 'exact',
    derivedLightMode: 'recompute-with-readback' };
  const historyBefore = await courier.snapshot({ coveredPositions: positions }, binding);
  const historyTarget = { ...historyBefore, records: [{ ...historyBefore.records[0],
    nodeName: 'hw_lifecycle_probe:stone', param1: 0, param2: 0,
    metadata: { owner: 'operator' },
    inventory: { main: ['hw_lifecycle_probe:stone'] },
    timer: { timeout: 120, elapsed: 0 } }] };
  const historyId = 'tx-v3-state-real';
  const historyOperationDigest = digest(historyTarget);
  await assert.rejects(courier.verifyPrincipal('other-player'),
    /CONNECTION_UNAUTHORIZED/);
  await assert.rejects(courier.applyState({ operationDigest: historyOperationDigest },
    historyTarget, historyBefore, { ...binding, engineActorName: 'other-player' }),
  /PERMISSION_DENIED/);
  await assert.rejects(courier.applyState({ operationDigest: historyOperationDigest },
    { ...historyTarget, records: [{ ...historyTarget.records[0], metadata: { owner: 4 } }] },
    historyBefore, binding), /UNSUPPORTED_MUTATION_SEMANTICS/);
  assert.equal((await courier.readback({ coveredPositions: positions }, binding))
    .records[0].nodeName, 'air');
  await journal.prepare({ transactionId: historyId,
    operationDigest: historyOperationDigest,
    transactionPayloadDigest: digest({ historyId, historyTarget }),
    beforeImageDigest: digest(historyBefore),
    beforeImage: { ...historyBefore, worldRevision: 'world:diagnostic',
      stateProfile: profileState }, expectedWorldRevision: 'world:diagnostic',
    stateProfile: profileState, authorRef: 'operator', originKind: 'HANAWORLDS',
    targetImage: historyTarget, targetStateDigest: digest(historyTarget) });
  await journal.transition(historyId, 'APPLYING');
  assert.equal((await courier.applyState({ operationDigest: historyOperationDigest },
    historyTarget, historyBefore, binding)).status, 'APPLIED_PENDING_READBACK');
  await journal.transition(historyId, 'APPLIED_PENDING_READBACK');
  const stateReadback = await courier.readback({ coveredPositions: positions }, binding);
  assert.equal(stateReadback.records[0].nodeName, 'hw_lifecycle_probe:stone');
  assert.equal(stateReadback.records[0].metadata.owner, 'operator');
  assert.deepEqual(stateReadback.records[0].inventory.main,
    ['hw_lifecycle_probe:stone']);
  assert.equal(stateReadback.records[0].timer.timeout, 120);
  await journal.recordAfterState(historyId, { ...stateReadback,
    worldRevision: 'world:diagnostic', stateProfile: profileState },
  digest(stateReadback), digest(historyBefore));
  await stop();
  assert.match(await readFile(firstLog, 'utf8'), /payload identity matched/);

  const originalJournalDigest = await journalDigest();
  const originalManifestDigest = await shaFile(join(worldmod, 'payload.json'));
  const restartLog = await start('restart', true);
  assert.equal((await courier.handshake()).worldRef, first.worldRef);
  assert.match(await readFile(restartLog, 'utf8'), /payload identity matched/);

  const reopened = await DurableJournal.open(journalDir);
  assert.equal(reopened.query(request.transactionId).status, 'ROLLED_BACK');
  assert.equal(await journalDigest(), originalJournalDigest);
  assert.equal(await shaFile(join(worldmod, 'payload.json')), originalManifestDigest);
  const retained = await courier.readback({ coveredPositions: positions }, binding);
  assert.equal(retained.records[0].nodeName, 'hw_lifecycle_probe:stone');
  assert.equal(retained.records[0].metadata.owner, 'operator');
  assert.deepEqual(retained.records[0].inventory.main,
    ['hw_lifecycle_probe:stone']);
  assert.equal(retained.records[0].timer.timeout, 120);

  await stop();
  console.log(JSON.stringify({ scenario: 'installed-payload-lifecycle', realLuanti: true,
    diagnosticAuthority: true, currentPlayerBinding: false, sourcePayloadDigest,
    worldRef: first.worldRef, originalJournalDigest,
    journalStatus: reopened.query(request.transactionId).status,
    historyJournalStatus: reopened.query(historyId).status,
    retainedObjectNode: retained.records[0].nodeName,
    retainedMetadataOwner: retained.records[0].metadata.owner,
    retainedInventory: retained.records[0].inventory.main,
    retainedTimerTimeout: retained.records[0].timer.timeout,
    installedPackage: installed, logs }));
} finally {
  await stop();
  if (courier) await courier.close();
  await service.close();
  if (output.includes('token')) throw new Error('SECRET_IN_RUNTIME_OUTPUT');
}
