// FIXTURE INPUT LAYER for the Stage 1 fact supply page and test.
// Real: Adapter public apply() → local-world port (discover/acquire/provision/pair)
//       → LocalCourier → payload facts.lua → readAvatarEnvelope / readWorldEditFacts.
// Fixture: the native Host (NativeEngineControl model) and the engine `core`
//       (players, collision boxes, loaded mods, WorldEdit global) from a scenario.
// No Luanti process, real World, player or WorldEdit is started or read.
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { apply } from '../../src/index.mjs';
import { PAYLOAD_VERSION } from '../../src/version.mjs';

const run = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const payloadDir = join(here, '../../payload/hanaworlds_adapter');

const lua = value => {
  if (value === null || value === undefined) return 'nil';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return `{${value.map(lua).join(',')}}`;
  return `{${Object.entries(value).map(([k, v]) => `[${JSON.stringify(k)}]=${lua(v)}`).join(',')}}`;
};

/** One fixture World behind the real Adapter public path. */
export async function openFixtureWorld({ runRoot, scenario }) {
  await mkdir(runRoot, { recursive: true, mode: 0o700 });
  const root = await mkdtemp(join(runRoot, 'fixture-world-'));
  const world = join(root, 'world'); await mkdir(world);
  await writeFile(join(world, 'world.mt'), 'gameid = fixture_game\n');
  const scenarioFile = join(root, 'scenario.lua');
  let current = scenario;
  const setScenario = async next => { current = next; await writeFile(scenarioFile, `return ${lua(next)}\n`); };
  await setScenario(scenario);

  const records = new Map(); let serial = 0;
  const native = { // FIXTURE NativeEngineControl: no process is started.
    async acquire(input) { const controlRef = `fixture-native:${++serial}`; records.set(controlRef, { ...input, processId: 9000 + serial }); return { controlRef, worldPath: input.worldPath }; },
    async inspect(q) {
      const row = records.get(q.controlRef);
      if (!row) throw Error('FIXTURE_NATIVE_GONE');
      return { state: 'CURRENT', worldPath: row.worldPath, username: row.username, operationRef: row.operationRef, processId: row.processId };
    },
    async withStoppedWorld(q, consume) { const f = await native.inspect(q); records.delete(q.controlRef); return consume({ ...f, state: 'STOPPED' }); },
  };
  const home = join(root, 'dsh-home'); await mkdir(home, { mode: 0o700 });
  const provided = new Map(), services = { hanaworldsNativeEngineControl: native, dshHomePath: (...segments) => join(home, ...segments) };
  const adapter = apply({ get: n => services[n], provide: (n, v) => provided.set(n, v), effect() {},
    webServer: { register() { return () => {}; } } }, { serviceName: 'fixture:stage1-supply' });
  const port = provided.get('hanaworldsLuantiLocalWorlds');
  const facts = provided.get('hanaworldsLuantiNativeFacts');
  await port.setRoots({ roots: [root] });
  const [found] = await port.discover();
  const base = { connectionRef: found.connectionRef, requesterRef: 'fixture:requester', userPath: root };
  const q = lease => ({ leaseRef: lease.leaseRef, requesterRef: base.requesterRef, connectionRef: base.connectionRef });
  const installed = await port.provision(q(await port.acquire({ ...base, action: 'PROVISION_PAYLOAD' })));

  let courier = null, lease = null;
  async function startCourier() {
    const dir = join(world, 'worldmods/hanaworlds_adapter');
    const manifest = JSON.parse(await readFile(join(dir, 'payload.json'), 'utf8'));
    const config = JSON.parse(await readFile(join(dir, 'transport.json'), 'utf8'));
    const headers = { Authorization: `Bearer ${config.token}` };
    const state = { alive: true };
    state.loop = (async () => {
      while (state.alive) {
        const response = await fetch(`http://127.0.0.1:${config.port}/poll`, { headers }).catch(() => null);
        const command = response ? (await response.json()).command : null;
        if (!command) { await new Promise(r => setTimeout(r, 5)); continue; }
        let body;
        if (command.operation === 'handshake') body = { result: { worldRef: manifest.worldRef, payloadVersion: PAYLOAD_VERSION,
          loadedSourceDigest: manifest.payloadDigest, manifestDigest: manifest.payloadDigest, payloadMatches: true,
          worldeditAvailable: !!current.worldedit, worldeditVersion: 'local-static' } };
        else {
          const args = [join(here, 'engine-fixture.lua'), payloadDir, scenarioFile, command.operation];
          if (command.salt) args.push(command.salt);
          body = JSON.parse((await run('lua', args)).stdout);
        }
        await fetch(`http://127.0.0.1:${config.port}/result`, { method: 'POST', headers,
          body: JSON.stringify({ id: command.id, worldRef: manifest.worldRef, ...body }) }).catch(() => {});
      }
    })();
    return state;
  }
  async function connect() {
    lease = await port.acquire({ ...base, action: 'BIND_RUNNING_WORLD' });
    courier = await startCourier();
    try { return await port.pair(q(lease)); }
    catch (error) { courier.alive = false; await courier.loop; courier = null; lease = null; throw error; }
  }
  async function disconnect() {
    if (!lease) return;
    await port.stopWorld({ requesterRef: base.requesterRef, connectionRef: base.connectionRef, worldRef: installed.worldRef });
    if (courier) { courier.alive = false; await courier.loop; courier = null; }
    lease = null;
  }
  return { root, worldRef: installed.worldRef, facts, port, setScenario, scenario: () => current, connect, disconnect,
    async close() { await disconnect(); await adapter.close(); } };
}
