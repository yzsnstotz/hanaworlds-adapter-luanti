/** Isolated fixture setup; public fixed Host RPC/HTTP lifecycle, no App or game UI. */
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const [appArg, tarArg, evidenceArg] = process.argv.slice(2);
if (!appArg || !tarArg || !evidenceArg) throw new Error('Expected fixed App, Adapter tar and fresh evidence directory');
const app = resolve(appArg), tar = resolve(tarArg), evidence = resolve(evidenceArg);
mkdirSync(evidence);
const root = mkdtempSync(join(dirname(dirname(evidence)), 'host-profile-'));
const home = join(root, 'home'), profile = join(home, 'profiles/desktop');
const resources = join(app, 'Contents/Resources'), runtime = join(resources, 'hanaworlds-dsh');
const node = join(resources, 'runtime/hanaworlds-runtime/node/bin/node');
for (const path of [join(home, 'profiles'), join(root, 'cache'), join(root, 'tmp')]) mkdirSync(path, { recursive: true });
execFileSync('/bin/cp', ['-cR', join(resources, 'runtime/hanaworlds-runtime/profile-seed'), profile]);
const adapterDir = join(profile, 'node_modules/hanaworlds-adapter-luanti');
rmSync(adapterDir, { recursive: true }); mkdirSync(adapterDir);
execFileSync('/usr/bin/tar', ['-xzf', tar, '--strip-components=1', '-C', adapterDir]);
const version = JSON.parse(readFileSync(join(adapterDir, 'package.json'), 'utf8')).version;
const manifestPath = join(profile, 'package.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
manifest.dependencies['hanaworlds-adapter-luanti'] = `file:${tar}`;
manifest.dsh.profile.bundles = manifest.dsh.profile.bundles.filter(name => name !== 'hanaworlds-adapter-luanti');
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
const argv = ['--expose-internals', join(runtime, 'node_modules/@deepseek-ai/dsh-desktop-host/lib/index.js'),
  runtime, profile, join(resources, 'runtime/primary-runtime'), join(resources, 'runtime/pnpm/bin/pnpm.mjs'), join(resources, 'runtime/bin')];
const env = { HOME: home, DSH_HOME: home, PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
  TMPDIR: join(root, 'tmp'), XDG_CACHE_HOME: join(root, 'cache'), npm_config_cache: join(root, 'cache/npm'),
  ELECTRON_RUN_AS_NODE: '1', DSH_TELEMETRY_DISABLED: '1', DSH_TELEMETRY_MODE: 'DISABLED' };
const child = spawn(node, argv, { cwd: profile, env, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
const exited = once(child, 'exit');
const result = { setupClass: 'SOURCE/FIXTURE', runtimeClass: 'REAL_RUNTIME (isolated public Host lifecycle only)',
  fixtureSetup: 'Fixed seed copied, exact tar extracted into own disabled disposable profile; no pnpm/Add/UI/formal-profile action',
  root, argv: [node, ...argv], hostPid: child.pid, version,
  tarSha256: createHash('sha256').update(readFileSync(tar)).digest('hex'), steps: [], routes: [] };
const save = () => writeFileSync(join(evidence, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
let output = '';
const capture = chunk => {
  output += String(chunk).replace(/([?&]token=)[^\s"<>]+/gu, '$1[REDACTED]');
  writeFileSync(join(evidence, 'host.log'), output);
};
child.stdout.on('data', capture); child.stderr.on('data', capture); save();
try {
  const url = await new Promise((ready, reject) => {
    const timer = setTimeout(() => reject(new Error('HOST_READY_TIMEOUT')), 30_000);
    child.on('message', message => {
      if (message.type === 'ready') { clearTimeout(timer); ready(message.url); }
      if (message.type === 'fatal') { clearTimeout(timer); reject(new Error(message.message)); }
    });
    child.once('exit', () => { clearTimeout(timer); reject(new Error('HOST_EARLY_EXIT')); });
  });
  const auth = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(15_000) });
  const cookie = auth.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
  await auth.body?.cancel(); assert.ok(cookie);
  const origin = new URL(url).origin;
  const remote = async (method, args) => {
    const rpcId = randomUUID(), start = Date.now();
    const response = await fetch(new URL(`/api/${method}`, origin), {
      method: 'POST', headers: { cookie, origin, 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId, method, payload: { args } }), signal: AbortSignal.timeout(30_000),
    });
    const envelope = await response.json();
    result.steps.push({ method, args, status: response.status, envelope, elapsedMs: Date.now() - start }); save();
    assert.equal(response.status, 200); assert.equal(envelope.rpcId, rpcId); assert.equal(envelope.result.ok, true);
    return envelope.result.value;
  };
  for (const enabled of [true, false, true, false, true, false]) {
    const changed = await remote('pluginManager/setBundleEnabled', { name: 'hanaworlds-adapter-luanti', enabled });
    assert.equal(changed.application, 'applied', JSON.stringify(changed)); assert.equal(changed.changed, true);
    const plugins = await remote('pluginManager/listPlugins', {});
    const current = plugins.filter(plugin => plugin.moduleName === 'hanaworlds-adapter-luanti');
    if (enabled) { assert.equal(current.length, 1); assert.equal(current[0].enabled, true); assert.equal(current[0].fiberPhase, 'active'); }
    else assert.deepEqual(current, []);
    const response = await fetch(new URL('/api-hanaworlds-luanti/status', origin), { headers: { cookie }, signal: AbortSignal.timeout(15_000) });
    const body = await response.text(); result.routes.push({ enabled, status: response.status, body }); save();
    if (enabled) { assert.equal(response.status, 200); assert.equal(JSON.parse(body).version, version); }
    // Defer absence assertions so the baseline records the precise re-enable failure too.
  }
  for (const route of result.routes.filter(route => !route.enabled)) assert.equal(route.status, 404, route.body);
  const protectedChange = await remote('pluginManager/setBundleEnabled', { name: '@deepseek-ai/dsh-base', enabled: false });
  assert.equal(protectedChange.application, 'failed'); assert.equal(protectedChange.error.code, 'management-required');
  result.completed = true;
} catch (error) {
  result.failure = String(error); process.exitCode = 1;
} finally {
  if (child.connected) child.send({ type: 'shutdown' }, () => {});
  const timer = setTimeout(() => { result.forcedShutdown = true; child.kill('SIGTERM'); }, 15_000);
  const [code, signal] = await exited; clearTimeout(timer);
  result.hostExit = { code, signal };
  if (code !== 0 || signal !== null || result.forcedShutdown) process.exitCode = 1;
  save();
}
console.log(JSON.stringify({ version, completed: result.completed ?? false, hostPid: result.hostPid, hostExit: result.hostExit,
  operationCount: result.steps.length, routeStatuses: result.routes.map(row => ({ enabled: row.enabled, status: row.status })) }));
