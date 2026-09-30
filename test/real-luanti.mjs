import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { DurableJournal } from '../src/journal.mjs';
import { EngineBridge } from '../src/bridge.mjs';
import { LocalEngineTransport } from '../src/local-transport.mjs';
import { provisionLocalPayload } from '../src/local-worlds.mjs';
import { V2TransactionBackend, projectionDigest } from '../src/v2-transactions.mjs';
import { WorldAdapterV2 } from '../src/v2-port.mjs';
import { createLuantiOperations } from '../src/v2-operations.mjs';

const root = resolve('.runtime/real-tests', `run-${Date.now()}`);
const luanti = '/Applications/luanti.app/Contents/MacOS/luanti';
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const probeSource = `-- Diagnostic-only isolated worldmod, generated outside the package.
minetest.register_node('hw_probe:stone', {description = 'Probe stone', tiles = {'unknown_node.png'}})
local storage = minetest.get_mod_storage()
minetest.after(0, function()
  local auth = minetest.get_auth_handler()
  if not auth.get_auth('operator') then auth.create_auth('operator', '') end
  local allowed = not minetest.settings:get_bool('hw_probe_no_priv', false)
  minetest.set_player_privs('operator', allowed and {worldedit = true} or {})
  minetest.load_area({x = 0, y = 0, z = 0}, {x = 1, y = 0, z = 0})
  if storage:get_string('initialized') ~= 'yes' then
    minetest.set_node({x = 0, y = 0, z = 0}, {name = 'air'})
    minetest.set_node({x = 1, y = 0, z = 0}, {name = 'air'})
    storage:set_string('initialized', 'yes')
  end
  minetest.log('action', 'HanaWorlds diagnostic probe ready; operator worldedit=' ..
    tostring(minetest.check_player_privs('operator', {worldedit = true})))
end)
local original_set = worldedit.set
local original_get_node = minetest.get_node_or_nil
local calls = 0
local readback_fault_armed = false
local readback_fault_used = false
minetest.get_node_or_nil = function(...)
  if readback_fault_armed then
    readback_fault_armed = false
    minetest.log('action', 'HanaWorlds diagnostic readback fault fired')
    return nil
  end
  return original_get_node(...)
end
worldedit.set = function(...)
  calls = calls + 1
  minetest.log('action', 'HanaWorlds diagnostic WorldEdit.set call ' .. calls)
  if minetest.settings:get_bool('hw_probe_fault', false) and calls == 2 then
    error('diagnostic second-cell fault')
  end
  local result = original_set(...)
  if minetest.settings:get_bool('hw_probe_readback_fault', false) and not readback_fault_used then
    readback_fault_used = true
    readback_fault_armed = true
  end
  return result
end
`;
async function freePort() {
  const probe = createServer();
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  return port;
}
async function waitLog(path, phrase, child) {
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error('LUANTI_EXITED');
    const log = await readFile(path, 'utf8').catch(() => '');
    if (log.includes(phrase)) return log;
    await delay(100);
  }
  throw new Error('LUANTI_READY_TIMEOUT');
}

async function scenario(name, { fault = false, readbackFault = false,
  noPrivilege = false, restart = false, restoringRestart = false } = {}) {
  const base = join(root, name);
  const profile = join(base, 'profile');
  const world = join(profile, 'worlds', 'world');
  const game = join(profile, 'games', 'hw_minimal');
  const logPath = join(base, 'luanti.log');
  await mkdir(join(world, 'worldmods'), { recursive: true });
  await mkdir(game, { recursive: true });
  await writeFile(join(game, 'game.conf'), 'title = HanaWorlds isolated transaction probe\n');
  await writeFile(join(world, 'world.mt'), 'gameid = hw_minimal\nbackend = sqlite3\n');
  await cp('.runtime/upstream-worldedit/worldedit', join(world, 'worldmods', 'worldedit'), { recursive: true });
  const probeDir = join(world, 'worldmods', 'hw_probe');
  await mkdir(probeDir);
  await writeFile(join(probeDir, 'mod.conf'), 'name = hw_probe\ndepends = worldedit, hanaworlds_adapter\n');
  await writeFile(join(probeDir, 'init.lua'), probeSource);
  const port = await freePort();
  const operatorAuthority = { verify: async ({ worldPath, action }) =>
    ({ current: true, worldPath, action }) };
  const identity = await provisionLocalPayload(world, { operatorAuthority, transportPort: port });
  const config = join(base, 'luanti.conf');
  await writeFile(config, `bind_address = 127.0.0.1\nport = 30173\nserver_announce = false\nsecure.enable_security = true\nsecure.http_mods = hanaworlds_adapter\nhw_probe_fault = ${fault ? 'true' : 'false'}\nhw_probe_readback_fault = ${readbackFault ? 'true' : 'false'}\nhw_probe_no_priv = ${noPrivilege ? 'true' : 'false'}\n`);
  const courier = await LocalEngineTransport.open(world, { serviceName: 'operator' });
  let child;
  let output = '';
  async function start(path) {
    child = spawn(luanti, ['--server', '--world', world, '--config', config, '--logfile', path], {
      env: { ...process.env, HOME: profile, XDG_CACHE_HOME: join(profile, 'cache'),
        LUANTI_USER_PATH: profile }, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', bytes => { output += bytes.toString(); });
    child.stderr.on('data', bytes => { output += bytes.toString(); });
    await waitLog(path, `HanaWorlds diagnostic probe ready; operator worldedit=${!noPrivilege}`, child);
    await waitLog(path, 'HanaWorlds local courier paired on loopback', child);
  }
  async function stop() {
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    const exiting = new Promise(resolve => child.once('exit', resolve));
    child.kill('SIGINT');
    await exiting;
  }
  try {
    await start(logPath);
    const loaded = await courier.handshake();
    assert.equal(loaded.worldRef, identity.worldRef);
    assert.equal(loaded.payloadDigest, identity.payloadDigest);
    await assert.rejects(() => courier.verifyPrincipal('operator'), /CONNECTION_UNAUTHORIZED/);
    const binding = { current: true, worldRef: identity.worldRef,
      engineActorName: 'operator', allowedActions: ['APPLY_RECOVERABLE', 'READBACK', 'HISTORY'] };
    const positions = fault ? [[0, 0, 0], [1, 0, 0]] : [[0, 0, 0]];
    if (noPrivilege) {
      await assert.rejects(() => courier.snapshot({ coveredPositions: positions }, binding), /PERMISSION_DENIED/);
      console.log(JSON.stringify({ scenario: name, status: 'PERMISSION_DENIED',
        realLuanti: true, loadedDigestHandshake: true, currentPlayerBinding: false, logPath }));
      return;
    }
    const before = await courier.snapshot({ coveredPositions: positions }, binding);
    assert.equal(before.worldRef, identity.worldRef);
    assert.deepEqual(before.records.map(row => row.nodeName), positions.map(() => 'air'));
    const inspectedBefore = await courier.inspect(positions, binding);
    assert.deepEqual(inspectedBefore.knownEmptyCells, positions);
    assert.deepEqual(inspectedBefore.occupiedCells, []);
    assert.deepEqual(inspectedBefore.unknownCells, []);
    const effects = positions.map(position => ({ position, nodeName: 'hw_probe:stone', param2: 3 }));
    const request = { transactionId: `tx-${name}`, worldRef: identity.worldRef,
      operationDigest: digest(effects), transactionPayloadDigest: digest({ effects, name }),
      beforeImageDigest: digest(before), coveredPositions: positions, effects };
    const journal = await DurableJournal.open(join(base, 'journal'));
    const bridgeOptions = { engine: courier,
      admit: (_, raw) => raw,
      verifyBinding: async () => binding,
      verifyService: async () => true,
      digestBeforeImage: digest, digestReadback: digest };
    const bridge = new EngineBridge({ journal, ...bridgeOptions });
    const prepared = await bridge.prepare(request);
    assert.equal(prepared.status, 'PREPARED');
    const applied = await bridge.apply(request);
    if (fault) {
      assert.equal(applied.status, 'ROLLED_BACK');
      assert.equal(applied.causeCode, 'APPLY_FAILED');
      assert.equal(journal.query(request.transactionId).status, 'ROLLED_BACK');
    } else if (readbackFault) {
      assert.equal(applied.status, 'APPLIED_PENDING_READBACK');
      await assert.rejects(() => bridge.readback(request), /READBACK_FAILED/);
      assert.equal(journal.query(request.transactionId).status, 'ROLLED_BACK');
      assert.equal(journal.query(request.transactionId).causeCode, 'READBACK_FAILED');
      assert.match(await readFile(logPath, 'utf8'), /diagnostic readback fault fired/);
    } else if (restart || restoringRestart) {
      assert.equal(applied.status, 'APPLIED_PENDING_READBACK');
      const restoreAttemptIdentity = `restore-${name}`;
      if (restoringRestart) await journal.transition(request.transactionId, 'RESTORING',
        { restoreAttemptIdentity });
      await stop();
      const reopened = await DurableJournal.open(join(base, 'journal'));
      assert.equal(reopened.query(request.transactionId).status, 'RECOVERY_PENDING');
      assert.equal(reopened.query(request.transactionId).mutationState, 'UNKNOWN');
      const restartLog = join(base, 'luanti-restart.log');
      await start(restartLog);
      const resumed = new EngineBridge({ journal: reopened, ...bridgeOptions });
      const restored = await resumed.restore({ originTransactionId: request.transactionId,
        operationDigest: request.operationDigest, beforeImageDigest: request.beforeImageDigest,
        restoreAttemptIdentity });
      assert.equal(restored.status, 'ROLLED_BACK');
      assert.equal(reopened.query(request.transactionId).status, 'ROLLED_BACK');
    } else {
      assert.equal(applied.status, 'APPLIED_PENDING_READBACK');
      const readback = await bridge.readback(request);
      assert.deepEqual(readback.projection.records.map(row => row.nodeName), ['hw_probe:stone']);
      const inspectedAfter = await courier.inspect(positions, binding);
      assert.deepEqual(inspectedAfter.occupiedCells,
        [{ position: [0, 0, 0], nodeName: 'hw_probe:stone', param2: 3 }]);
      const restored = await bridge.restore({ originTransactionId: request.transactionId,
        operationDigest: request.operationDigest, beforeImageDigest: request.beforeImageDigest,
        restoreAttemptIdentity: `restore-${name}` });
      assert.equal(restored.status, 'ROLLED_BACK');
      const writesBeforeReplay = (await readFile(logPath, 'utf8')).match(/diagnostic WorldEdit\.set call/g)?.length ?? 0;
      const repeated = await bridge.restore({ originTransactionId: request.transactionId,
        operationDigest: request.operationDigest, beforeImageDigest: request.beforeImageDigest,
        restoreAttemptIdentity: `restore-${name}` });
      assert.equal(repeated.status, 'ROLLED_BACK');
      const writesAfterReplay = (await readFile(logPath, 'utf8')).match(/diagnostic WorldEdit\.set call/g)?.length ?? 0;
      assert.equal(writesAfterReplay, writesBeforeReplay, 'terminal replay does not write world again');
      const stateProfile = { profileVersion: 'state-profile/v2',
        nodeFields: ['nodeName', 'param1', 'param2'], metadataMode: 'exact',
        inventoryMode: 'exact', timerMode: 'exact', derivedLightMode: 'recompute-with-readback' };
      const transactionBackend = new V2TransactionBackend({ journal, engine: courier,
        revisionOracle: { read: async () => 'world:diagnostic',
          readObjects: async () => ({}) }, stateProfile,
        verifyBinding: async () => binding, verifyService: async () => true,
        capacity: { check: async actual => ({ allowed: actual <= 2 }) } });
      const operationHandlers = createLuantiOperations({ transactionBackends:
        new Map([[identity.worldRef, transactionBackend]]) });
      const port = new WorldAdapterV2({ authority: {
        verify: async request => ({ current: true, actorRef: request.actorRef,
          sessionRef: request.sessionRef, authorizationRef: request.authorizationRef,
          domainOwner: 'hanaworlds-canvas' }),
        verifyService: async request => ({ current: true, actorRef: request.actorRef,
          sessionRef: request.sessionRef, authorizationRef: request.authorizationRef }),
      }, operations: operationHandlers.operations });
      const op = { contractVersion: 'operations/v2', buildDigest: 'a'.repeat(64),
        compilerRevision: 'compiler:diagnostic', compilationConfigDigest: 'b'.repeat(64),
        worldRef: identity.worldRef, frameDigest: 'c'.repeat(64),
        catalogueDigest: 'd'.repeat(64), targetFactsDigest: 'e'.repeat(64),
        effects: [{ position: [0, 0, 0], nodeName: 'hw_probe:stone', param2: 3 }] };
      const opDigest = projectionDigest('operations', op);
      const authProjection = { contractVersion: 'world-adapter/v2',
        authorizerRef: 'diagnostic', actorRef: 'diagnostic:operator',
        grantEpoch: 'diagnostic:one', bindingRef: 'diagnostic:binding',
        worldRef: identity.worldRef, sessionRef: 'diagnostic:session',
        turnRevision: 'diagnostic:turn', intentDigest: 'f'.repeat(64),
        surfaceActionDigest: '1'.repeat(64), allowedAction: 'APPLY_RECOVERABLE',
        transactionId: 'tx-v2-diagnostic', operationDigest: opDigest,
        worldRevision: 'world:diagnostic', selectionRevision: 'diagnostic:selection',
        analysisDigest: null, decisionRevision: null };
      const common = { contractVersion: 'world-adapter/v2',
        actorRef: 'diagnostic:operator', sessionRef: 'diagnostic:session',
        authorizationRef: 'diagnostic:grant', worldRef: identity.worldRef };
      const preparedV2 = await port.call('PrepareRecoverableTransaction', {
        ...common, requestId: 'diagnostic:v2:prepare', transactionId: 'tx-v2-diagnostic',
        operationDigest: opDigest, operations: op, authorizationBinding: authProjection,
        expectedWorldRevision: 'world:diagnostic', expectedObjectRevisions: {},
        guarantee: 'RECOVERABLE_VERIFIED' });
      assert.equal(preparedV2.error, null);
      const appliedV2 = await port.call('ApplyCompiledTransaction', {
        ...common, requestId: 'diagnostic:v2:apply', transactionId: 'tx-v2-diagnostic',
        expectedWorldRevision: 'world:diagnostic', preparedTransaction: preparedV2.result,
        operations: op, operationDigest: opDigest, authorizationBinding: authProjection,
        guarantee: 'RECOVERABLE_VERIFIED' });
      assert.equal(appliedV2.result?.status, 'APPLIED_PENDING_READBACK');
      const readbackV2 = await port.call('Readback', {
        ...common, requestId: 'diagnostic:v2:readback', transactionId: 'tx-v2-diagnostic',
        coveredPositions: [[0, 0, 0]], stateProfile });
      assert.equal(readbackV2.result?.projection.records[0].nodeName, 'hw_probe:stone');
      const restoredV2 = await port.call('RestoreTransaction', {
        ...common, requestId: 'diagnostic:v2:restore', originTransactionId: 'tx-v2-diagnostic',
        operationDigest: opDigest, beforeImageDigest: preparedV2.result.beforeImageDigest,
        restoreAttemptIdentity: 'diagnostic:v2:restore-identity',
        guarantee: 'RECOVERABLE_VERIFIED' });
      assert.equal(restoredV2.result?.status, 'ROLLED_BACK');
      await operationHandlers.close();
    }
    const finalState = await courier.readback({ coveredPositions: positions }, binding);
    assert.deepEqual(finalState.records.map(row => row.nodeName), positions.map(() => 'air'));
    const afterLog = await readFile(logPath, 'utf8');
    const terminal = await DurableJournal.open(join(base, 'journal'));
    console.log(JSON.stringify({ scenario: name, worldRef: identity.worldRef,
      status: terminal.query(request.transactionId).status, beforeDigest: digest(before),
      finalDigest: digest(finalState), payloadDigest: identity.payloadDigest,
      realLuanti: afterLog.includes('Server for gameid="hw_minimal" listening on 127.0.0.1:30173.'),
      sourceMatched: afterLog.includes('payload identity matched'),
      loadedDigestHandshake: true, currentPlayerBinding: false,
      logPath }));
  } finally {
    await stop();
    await courier.close();
    if (output.includes('token')) throw new Error('SECRET_IN_RUNTIME_OUTPUT');
  }
}

await scenario('normal');
await scenario('fault', { fault: true });
await scenario('readback-fault', { readbackFault: true });
await scenario('no-privilege', { noPrivilege: true });
await scenario('restart', { restart: true });
await scenario('restoring-restart', { restoringRestart: true });
