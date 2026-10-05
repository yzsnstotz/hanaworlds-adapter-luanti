// Repeatable component gate. Run from the hana-world-mvp project root with
// Node 24: node plugins/hanaworlds-adapter-luanti/scripts/real-scoped-gate.mjs
// Each invocation creates a new Luanti world, DSH profile, grant and journal.
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:net';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile, open } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import { provisionLocalPayload, payloadDigest } from '../src/local-worlds.mjs';
import { gateRequests } from './scoped-gate-requests.mjs';

const origin = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const project = resolve(origin, '../..');
assert.equal(resolve(process.cwd()), project, 'Run from the hana-world-mvp project root');
assert.match(process.version, /^v24\./, 'Node 24 is required');
const authGate = process.env.HW_SESSION_AUTH_GATE === '1';
const base = join(process.env.HOME, '.cache', 'hanaworlds-runs', authGate
  ? 'S1-AD-DESKTOP-AUTH-01' : 'S1-AD-SCOPED-COMMIT-01');
const worldedit = process.env.HW_WORLDEDIT_DIR ||
  join(base, 'real/profile/worlds/Native Facts World/worldmods/worldedit');
const dshEntry = process.env.HW_DSH_ENTRY ||
  join(process.env.HOME, '.cache/hanaworlds-runs/S1-DESKTOP-CONFIRM-01',
    '.desktop-build/targets/mac-arm64/dsh/node_modules/@deepseek-ai/dsh/lib/bin.js');
const luanti = process.env.HW_LUANTI_BIN || '/Applications/luanti.app/Contents/MacOS/luanti';
const nodeBin = dirname(process.execPath);
const envPath = `${nodeBin}:${process.env.PATH}`;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const exec = promisify(execFile);
const port = async () => {
  const server = createServer();
  await new Promise((ok, fail) => server.once('error', fail).listen(0, '127.0.0.1', ok));
  const value = server.address().port;
  await new Promise(ok => server.close(ok));
  return value;
};
async function command(cmd, args, cwd, log, environment = {}) {
  const handle = await open(log, 'w', 0o600);
  try {
    const child = spawn(cmd, args, { cwd, env: { ...process.env, PATH: envPath, ...environment },
      stdio: ['ignore', handle.fd, handle.fd] });
    const code = await new Promise((ok, fail) => {
      child.once('error', fail); child.once('exit', ok);
    });
    if (code !== 0) throw new Error(`${basename(cmd)} exited ${code}; see ${log}`);
    return (await readFile(log, 'utf8')).trim();
  } finally { await handle.close(); }
}
async function start(cmd, args, cwd, log, environment) {
  const handle = await open(log, 'w', 0o600);
  const child = spawn(cmd, args, { cwd, env: { ...process.env, PATH: envPath, ...environment },
    stdio: ['ignore', handle.fd, handle.fd] });
  await handle.close();
  return child;
}
async function waitUntil(label, child, probe) {
  for (let i = 0; i < 1200; i++) {
    if (child.exitCode !== null || child.signalCode !== null)
      throw new Error(`${label} exited before ready: ${child.exitCode}/${child.signalCode}`);
    if (await probe()) return;
    await delay(100);
  }
  throw new Error(`${label} did not become ready; inspect its run log`);
}
async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const done = new Promise(ok => child.once('exit', ok));
  child.kill('SIGINT');
  await Promise.race([done, delay(10000).then(() => { child.kill('SIGKILL'); return done; })]);
}
async function record(run, name, value) {
  await writeFile(join(run, `${name}.json`), JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
}
async function main() {
  await mkdir(base, { recursive: true });
  if (authGate) {
    const evidence = join(base, '_evidence');
    await mkdir(evidence, { recursive: true });
    for (const name of await readdir(base)) {
      if (!name.startsWith('run-')) continue;
      const old = join(base, name);
      const processes = await exec('/bin/ps', ['-axo', 'pid=,command=']);
      if (processes.stdout.split('\n').some(line => line.includes(old) &&
          (line.includes('/luanti ') || line.includes('/dsh/') ||
            line.includes('/usr/bin/open -n -W'))))
        throw new Error(`ACTIVE_PRIOR_RUN:${name}`);
      const archive = join(evidence, `archive-${name}`);
      await mkdir(archive, { recursive: true });
      for (const file of ['summary.json', 'host.log', 'server.log', 'client.log'])
        await cp(join(old, file), join(archive, file)).catch(error => {
          if (error.code !== 'ENOENT') throw error;
        });
      await rm(old, { recursive: true });
    }
  }
  const probePath = join(base, `permission-probe-${process.pid}-${Date.now()}`);
  const probeValue = `scoped-gate-${process.pid}`;
  await writeFile(probePath, probeValue, { flag: 'wx', mode: 0o600 });
  assert.equal(await readFile(probePath, 'utf8'), probeValue);
  await rm(probePath);
  const run = await mkdtemp(join(base, 'run-'));
  const world = join(run, 'luanti/profile/worlds/Scoped Gate World');
  const profile = join(run, 'luanti/profile');
  const control = join(world, 'hw_gate_control');
  const dshHome = join(run, 'home');
  const dshProfile = join(dshHome, 'profiles', 'scoped-gate');
  const fixture = join(origin, 'test/scoped-gate/fixture-plugin');
  const worldmod = join(origin, 'test/scoped-gate/worldmod');
  const metadata = { status: 'RUNNING', run, productBaseline: '0e2ee67cb6e18dd2bbe6bf210e96598e6c530da7',
    evidence: 'DSH_HOST_ADAPTER_REAL_LUANTI; CANVAS_IDENTITY_REGISTRY_FIXTURE',
    permissionProbe: 'create/read/delete PASS',
    runtime: { luanti, dshEntry, worldedit }, cases: {} };
  await record(run, 'summary', metadata);
  let server, client, host;
  try {
    for (const required of [worldedit, dshEntry, luanti])
      await readFile(required === worldedit ? join(required, 'mod.conf') : required);
    const dshPackage = JSON.parse(await readFile(resolve(dirname(dshEntry), '..', 'package.json')));
    assert.equal(dshPackage.version, '0.2.0-rc.2');
    metadata.dshVersion = dshPackage.version;
    const luantiVersion = await command(luanti, ['--version'], project,
      join(run, 'luanti-version.log'));
    assert.match(luantiVersion, /5\.17\.0/);
    metadata.luantiVersion = luantiVersion;
    await mkdir(join(world, 'worldmods'), { recursive: true });
    await mkdir(join(profile, 'games', 'hw_scoped_minimal'), { recursive: true });
    await mkdir(join(run, 'client-profile'), { recursive: true });
    await mkdir(control);
    await mkdir(dshProfile, { recursive: true });
    await mkdir(join(run, 'xdg-cache'), { recursive: true });
    await mkdir(join(run, 'xdg-config'), { recursive: true });
    await mkdir(join(run, 'shell-home'), { recursive: true });
    await writeFile(join(profile, 'games/hw_scoped_minimal/game.conf'),
      'title = HanaWorlds scoped gate temporary world\n');
    await writeFile(join(world, 'world.mt'),
      'gameid = hw_scoped_minimal\nbackend = sqlite3\nplayer_backend = files\nauth_backend = files\n');
    await cp(worldedit, join(world, 'worldmods/worldedit'), { recursive: true });
    await cp(worldmod, join(world, 'worldmods/hw_scoped_gate'), { recursive: true });
    const courierPort = await port();
    const serverPort = await port();
    const hostPort = await port();
    const operatorAuthority = { verify: async ({ worldPath, action }) =>
      ({ current: worldPath === world && action === 'PROVISION_PAYLOAD',
        worldPath, action, worldStopped: true }) };
    const identity = await provisionLocalPayload(world, { operatorAuthority,
      transportPort: courierPort });
    assert.equal(identity.payloadDigest, await payloadDigest());
    metadata.worldRef = identity.worldRef;
    metadata.payloadDigest = identity.payloadDigest;
    metadata.ports = { courierPort, serverPort, hostPort };
    const config = join(run, 'luanti.conf');
    await writeFile(config, `bind_address = 127.0.0.1\nport = ${serverPort}\nserver_announce = false\nsecure.enable_security = true\nsecure.http_mods = hanaworlds_adapter\nsecure.trusted_mods = hw_scoped_gate\nhw_gate_control_dir = ${control}\n`);
    const clientConfig = join(run, 'client.conf');
    await writeFile(clientConfig,
      'name = hw_gate_tester\nenable_sound = false\nscreen_w = 800\nscreen_h = 600\n');

    // The packed Adapter is the only Adapter loaded by the DSH host.
    const packEnv = { npm_config_cache: join(run, 'npm-cache') };
    const adapterPack = await command('npm', ['pack', '--silent', '--pack-destination', run],
      origin, join(run, 'pack-adapter.log'), packEnv);
    const fixturePack = await command('npm', ['pack', '--silent', '--pack-destination', run],
      fixture, join(run, 'pack-fixture.log'), packEnv);
    const adapterTgz = join(run, adapterPack.split('\n').at(-1));
    const fixtureTgz = join(run, fixturePack.split('\n').at(-1));
    metadata.adapterPackSha256 = sha(await readFile(adapterTgz));
    metadata.fixturePackSha256 = sha(await readFile(fixtureTgz));
    await writeFile(join(dshProfile, 'package.json'), JSON.stringify({
      name: 'dsh-profile-scoped-gate', private: true,
      dependencies: { '@deepseek-ai/dsh-base': '0.2.0-rc.2',
        '@deepseek-ai/dsh-web-app': '0.2.0-rc.2',
        'hanaworlds-ad-scoped-gate-fixture': `file:${fixtureTgz}`,
        'hanaworlds-adapter-luanti': `file:${adapterTgz}` },
      dsh: { profile: { bundles: ['@deepseek-ai/dsh-base',
        '@deepseek-ai/dsh-web-app', 'hanaworlds-ad-scoped-gate-fixture',
        'hanaworlds-adapter-luanti'] } },
    }, null, 2));
    await writeFile(join(dshProfile, 'cordis.yml'), '[]\n');
    await writeFile(join(dshProfile, 'pnpm-workspace.yaml'), 'packages: []\n');
    await writeFile(join(dshProfile, 'cordis.patch.yml'),
      `- id: hanaworlds-luanti-adapter\n  config:\n    localWorldRoots:\n      - ${join(profile, 'worlds')}\n    serviceName: scoped-gate\n`);
    const dshEnv = { DSH_HOME: dshHome, XDG_CACHE_HOME: join(run, 'xdg-cache'),
      XDG_CONFIG_HOME: join(run, 'xdg-config'), HOME: join(run, 'shell-home'),
      DSH_TELEMETRY_MODE: 'DISABLED', HW_GATE_WORLD_PATH: world,
      ...(authGate ? { HW_GATE_AUTH_RECORD: join(run, 'original-binding.json') } : {}),
      npm_config_cache: join(run, 'npm-cache'),
      PNPM_HOME: join(run, 'pnpm-home') };
    await command('pnpm', ['install', '--ignore-scripts', '--no-frozen-lockfile'],
      dshProfile, join(run, 'install.log'), dshEnv);
    const installed = join(dshProfile, 'node_modules/hanaworlds-adapter-luanti');
    for (const name of ['src/v5-transactions.mjs', 'payload/hanaworlds_adapter/engine.lua']) {
      assert.equal(sha(await readFile(join(installed, name))), sha(await readFile(join(origin, name))));
    }
    metadata.installedAdapterMatchesSource = true;
    await record(run, 'summary', metadata);

    const luantiEnv = { LUANTI_USER_PATH: profile, HOME: profile,
      XDG_CACHE_HOME: join(run, 'luanti-cache') };
    server = await start(luanti, ['--server', '--world', world, '--config', config,
      '--logfile', join(run, 'server.log')], project, join(run, 'server-stdio.log'), luantiEnv);
    await waitUntil('Luanti server', server, async () =>
      (await readFile(join(run, 'server.log'), 'utf8').catch(() => '')).includes('HanaWorlds scoped gate world seeded'));
    client = await start('/usr/bin/open', ['-n', '-W', '--env',
      `LUANTI_USER_PATH=${join(run, 'client-profile')}`, '-a', '/Applications/luanti.app',
      '--args', '--address', '127.0.0.1', '--port', String(serverPort),
      '--config', clientConfig, '--go', '--logfile', join(run, 'client.log')], project,
      join(run, 'client-stdio.log'), {});
    await waitUntil('Luanti test client', client, async () =>
      (await readFile(join(run, 'server.log'), 'utf8').catch(() => '')).includes('hw_gate_tester') &&
      (await readFile(join(run, 'server.log'), 'utf8').catch(() => '')).includes('joins game'));
    host = await start(process.execPath, [dshEntry, 'scoped-gate', '--host', '127.0.0.1',
      '--port', String(hostPort), '--no-open'], project, join(run, 'host.log'), dshEnv);
    const gate = gateRequests(run, hostPort);
    await waitUntil('DSH host', host, async () =>
      (await gate.status().catch(() => null))?.adapterMounted === true);
    const mounted = await gate.status();
    assert.equal(mounted.v5Contract, true);
    metadata.mounted = mounted;
    await record(run, 'summary', metadata);

    let sequence = 0;
    async function admin(action) {
      const id = String(++sequence);
      await writeFile(join(control, 'command'), `${id} ${action}\n`);
      await waitUntil(`admin ${action}`, server, async () =>
        (await readFile(join(control, 'ack'), 'utf8').catch(() => '')).startsWith(`${id} ${action} `));
      const result = (await readFile(join(control, 'ack'), 'utf8')).trim().split(' ').at(-1);
      if (!['OK', 'air_TO_hw_scoped_gate:stone', 'air'].includes(result))
        throw new Error(`ADMIN_${action}_${result}`);
      return result;
    }
    await admin('grant');
    assert.equal((await gate.status()).currentGrantCount, 1);
    const worldRef = await gate.discover();
    assert.equal(worldRef, identity.worldRef);
    metadata.granted = true;

    if (authGate) {
      const original = { sessionRef: 'fixture:session',
        sessionIncarnationRef: 'fixture:incarnation', hostIssuerRef: 'fixture:host',
        worldRef, engineActorName: 'hw_gate_tester', expectedGrantRef: 'missing:grant',
        authorizationRef: 'fixture:authorization', actorRef: 'fixture:actor',
        bindingRef: 'fixture:binding', grantEpoch: 'missing:grant',
        allowedActions: ['APPLY_RECOVERABLE', 'READ'] };
      const status = async binding => (await gate.verifyCurrentGrant(binding)).result.status;
      assert.equal(await status(original), 'UNKNOWN');
      const first = await gate.issueFixtureOriginal(worldRef);
      assert.equal(await status(first), 'CURRENT');
      assert.equal(await status({ ...first, worldRef: 'other:world' }), 'MISMATCH');
      assert.equal(await status({ ...first, engineActorName: 'other-player' }), 'MISMATCH');
      assert.equal(await status({ ...first, bindingRef: 'other:binding' }), 'MISMATCH');
      assert.equal(await status({ ...first, grantEpoch: 'other:epoch' }), 'MISMATCH');
      assert.equal(await status({ ...first, allowedActions: ['READ'] }), 'MISMATCH');
      await stop(host);
      host = await start(process.execPath, [dshEntry, 'scoped-gate', '--host', '127.0.0.1',
        '--port', String(hostPort), '--no-open'], project, join(run, 'host-restart.log'), dshEnv);
      await waitUntil('DSH host restart', host, async () =>
        (await gate.status().catch(() => null))?.adapterMounted === true);
      assert.equal(await status(first), 'CURRENT');
      await admin('revoke');
      assert.equal(await status(first), 'REVOKED');
      await admin('grant');
      assert.equal(await status(first), 'REVOKED', 'new game grant cannot revive the old record');
      const second = await gate.issueFixtureOriginal(worldRef);
      assert.notEqual(first.expectedGrantRef, second.expectedGrantRef);
      assert.equal(await status(second), 'CURRENT');
      await admin('drop_worldedit');
      assert.equal(await status(second), 'REVOKED');
      await admin('restore_worldedit');
      await admin('grant');
      const third = await gate.issueFixtureOriginal(worldRef);
      assert.equal(await status(third), 'CURRENT');
      await admin('kick');
      assert.equal(await status(third), 'REVOKED');
      metadata.cases.auth = { missingOriginal: 'UNKNOWN', live: 'CURRENT',
        mismatchedOriginal: 'MISMATCH', restart: 'CURRENT', revoked: 'REVOKED',
        regrantOld: 'REVOKED', regrantNew: 'CURRENT', permissionLost: 'REVOKED',
        playerOffline: 'REVOKED', fixtureHost: true, pairedGame: true };
      await record(run, 'auth', metadata.cases.auth);
      metadata.status = 'PASS';
      return;
    }

    const outsideBefore = await gate.read(worldRef, [[9, 1, 0]]);
    const targetBefore = await gate.read(worldRef, [[4, 1, 0]]);
    const outside = await gate.prepare('outside', worldRef);
    assert.equal(outside.error, null);
    assert.equal(outside.journal.status, 'PREPARED');
    const outsideQuery = await gate.query(outside);
    assert.equal(outsideQuery.error, null);
    assert.equal(outsideQuery.result?.scopeDigest, outside.prepared?.scopeDigest);
    assert.equal(outsideQuery.result?.beforeImageDigest, outside.prepared?.beforeImageDigest);
    await admin('outside');
    const outsideAfter = await gate.read(worldRef, [[9, 1, 0]]);
    assert.notEqual(outsideBefore.cells[0].stateDigest, outsideAfter.cells[0].stateDigest,
      'outside mutation must change real world state');
    const outsideApply = await gate.apply(outside);
    await record(run, 'outside-attempt', { error: outsideApply.error,
      result: outsideApply.result, journal: outsideApply.journal });
    assert.equal(outsideApply.error, null);
    assert.equal(outsideApply.result?.status, 'VERIFIED');
    assert.equal(outsideApply.journal.status, 'VERIFIED_PENDING_HISTORY');
    const appliedCell = await gate.read(worldRef, [[4, 1, 0]]);
    assert.notEqual(outside.request.scope.cells[0].stateDigest,
      appliedCell.cells[0].stateDigest, 'verified effect must change target state');
    metadata.cases.outside = { status: outsideApply.result.status,
      journal: outsideApply.journal.status, query: outsideQuery.result,
      outsideStateBefore: outsideBefore.cells[0].stateDigest,
      outsideStateAfter: outsideAfter.cells[0].stateDigest,
      targetStateBefore: targetBefore.cells[0].stateDigest,
      targetStateAfter: appliedCell.cells[0].stateDigest };
    await record(run, 'outside', metadata.cases.outside);

    const insideBefore = await gate.read(worldRef, [[5, 1, 0]]);
    const inside = await gate.prepare('inside', worldRef);
    assert.equal(inside.error, null);
    await admin('inside');
    const insideAfter = await gate.read(worldRef, [[5, 1, 0]]);
    assert.notEqual(insideBefore.cells[0].stateDigest, insideAfter.cells[0].stateDigest,
      'inside mutation must change real world state');
    const insideApply = await gate.apply(inside);
    assert.equal(insideApply.error, 'STALE_REVISION');
    assert.equal(insideApply.journal.status, 'PREPARED');
    metadata.cases.inside = { error: insideApply.error,
      journal: insideApply.journal.status,
      insideStateBefore: insideBefore.cells[0].stateDigest,
      insideStateAfter: insideAfter.cells[0].stateDigest };
    await record(run, 'inside', metadata.cases.inside);

    const protectedBefore = await admin('inspect_protected');
    const protectedCase = await gate.prepare('protected', worldRef);
    assert.equal(protectedCase.error, 'PERMISSION_DENIED');
    const protectedAfter = await admin('inspect_protected');
    assert.equal(protectedBefore, protectedAfter);
    metadata.cases.protected = { error: protectedCase.error,
      stateBefore: protectedBefore, stateAfter: protectedAfter };
    await record(run, 'protected', metadata.cases.protected);

    const revokeBefore = await gate.read(worldRef, [[7, 1, 0]]);
    const revokeNodeBefore = await admin('inspect_revoke');
    const newWriteBefore = await admin('inspect_new');
    const revoke = await gate.prepare('revoke', worldRef);
    assert.equal(revoke.error, null);
    const newWriteRequest = await gate.buildPrepare('new-after-revoke', worldRef);
    await admin('revoke');
    assert.equal((await gate.status()).currentGrantCount, 0);
    const revokeApply = await gate.apply(revoke);
    assert.equal(revokeApply.error, 'AUTHORIZATION_REVOKED');
    assert.equal(revokeApply.journal.status, 'PREPARED');
    const revokeNodeAfter = await admin('inspect_revoke');
    const newWrite = await gate.submitPrepare(newWriteRequest);
    assert.equal(newWrite.error, 'AUTHORIZATION_REVOKED');
    const newWriteAfter = await admin('inspect_new');
    assert.equal(revokeNodeBefore, revokeNodeAfter);
    assert.equal(newWriteBefore, newWriteAfter);
    metadata.cases.revoke = { error: revokeApply.error,
      journal: revokeApply.journal.status, grantCountAfter: 0,
      beforeStateDigest: revokeBefore.cells[0].stateDigest,
      stateBefore: revokeNodeBefore, stateAfter: revokeNodeAfter,
      newWriteError: newWrite.error, newWriteStateBefore: newWriteBefore,
      newWriteStateAfter: newWriteAfter };
    await record(run, 'revoke', metadata.cases.revoke);
    metadata.status = 'PASS';
  } catch (error) {
    metadata.status = 'FAIL';
    metadata.failure = { message: error?.message, stack: error?.stack };
    throw error;
  } finally {
    if (!authGate && server && metadata.granted && metadata.cases.revoke === undefined) {
      // Best effort only on failure; no other world/profile is ever targeted.
      const id = String(Date.now());
      await writeFile(join(control, 'command'), `${id} revoke\n`).catch(() => {});
      await delay(300);
    }
    await stop(host);
    // open -W is only a launcher; stop the exact client process tied to this
    // run's unique config before asking the launcher to exit.
    const clientPids = async () => {
      const processes = await exec('/bin/ps', ['-axo', 'pid=,command='])
        .catch(() => ({ stdout: '' }));
      return processes.stdout.split('\n').filter(line =>
        line.includes('/Applications/luanti.app/Contents/MacOS/luanti') &&
        line.includes(`--config ${join(run, 'client.conf')}`))
        .map(line => Number(line.trim().split(/\s+/, 1)[0]))
        .filter(pid => Number.isInteger(pid) && pid > 0);
    };
    const signalClients = async signal => {
      const pids = await clientPids();
      for (const pid of pids) {
        try { process.kill(pid, signal); } catch (error) {
          if (error.code !== 'ESRCH') throw error;
        }
      }
      for (let i = 0; i < 40; i++) {
        if ((await clientPids()).length === 0) return true;
        await delay(250);
      }
      return false;
    };
    if (!await signalClients('SIGINT')) {
      metadata.clientStopEscalation = 'SIGTERM';
      if (!await signalClients('SIGTERM')) {
        metadata.clientStopEscalation = 'SIGKILL';
        await signalClients('SIGKILL');
      }
    }
    await stop(client);
    await stop(server);
    const remaining = await exec('/bin/ps', ['-axo', 'pid=,command=']).catch(() => ({ stdout: '' }));
    metadata.runProcessesRemaining = remaining.stdout.split('\n').filter(line =>
      line.includes(run) && (line.includes('/luanti ') || line.includes('/dsh/') ||
        line.includes('/usr/bin/open -n -W')));
    metadata.processesStopped = [host, client, server].every(child =>
      !child || child.exitCode !== null || child.signalCode !== null) &&
      metadata.runProcessesRemaining.length === 0;
    if (!metadata.processesStopped) {
      metadata.status = 'FAIL';
      metadata.failure ??= { message: 'RUN_PROCESSES_REMAIN' };
    }
    await record(run, 'summary', metadata);
    process.stdout.write(JSON.stringify({ run, status: metadata.status,
      cases: metadata.cases, failure: metadata.failure ?? null }) + '\n');
    if (metadata.status !== 'PASS') process.exitCode = 1;
  }
}

await main();
