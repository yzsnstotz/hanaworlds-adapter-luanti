import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { apply } from '../src/index.mjs';
import { PAYLOAD_VERSION } from '../src/version.mjs';

// SOURCE/FIXTURE: native Host is a model. The real Host/Luanti self-test is separate.
async function fixture(t, Context = null) {
  const cache = join(homedir(), '.cache/hanaworlds-runs/S1-AD-LOCAL-PROVISIONING-01');
  await mkdir(cache, { recursive: true });
  const root = await mkdtemp(join(cache, 'port-fixture-'));
  const world = join(root, 'world'); await mkdir(world);
  await writeFile(join(world, 'world.mt'), 'gameid = fixture\n');
  const provided = new Map(), services = {};
  const records = new Map(); let serial = 0;
  const model = { allowed: true, stopped: false, callbacks: 0, beforeConsume: null,
    changeFacts: facts => facts,
    async acquire(input) {
      if (!model.allowed || input.password !== 'fixture-password') throw Error('PRIVATE_PROVIDER_TEXT');
      const controlRef = `native:${++serial}`;
      records.set(controlRef, { ...input, processId: serial });
      return { controlRef, worldPath: input.worldPath };
    },
    async inspect(q) {
      const row = records.get(q.controlRef);
      if (!model.allowed || !row || ['requesterRef', 'operationRef', 'worldPath'].some(k => row[k] !== q[k]))
        throw Error('PRIVATE_PROVIDER_TEXT');
      return { state: 'CURRENT', worldPath: row.worldPath, username: row.username,
        operationRef: row.operationRef, processId: row.processId };
    },
    async withStoppedWorld(q, consume) {
      const facts = await model.inspect(q); records.delete(q.controlRef);
      model.stopped = true;
      if (model.beforeConsume) await model.beforeConsume();
      model.callbacks++;
      return consume(model.changeFacts({ ...facts, state: 'STOPPED' }));
    },
  };
  services.hanaworldsNativeEngineControl = model;
  let adapter, port, diagnostics = [];
  if (Context) {
    const ctx = new Context();
    ctx.provide('webServer', {register() {}});
    ctx.provide('hanaworldsNativeEngineControl', model);
    ctx.logger.exporter({levels:{'hanaworlds-adapter-luanti':2},export(message) {
      if(message.name === 'hanaworlds-adapter-luanti' && message.args.length === 1 &&
        /^LOCAL_/.test(message.args[0])) diagnostics.push(message.args[0]);
    }});
    let owned;
    await ctx.plugin({name:'hanaworlds-adapter-luanti', inject:['webServer'],
      apply(ctx,config) { owned = apply(ctx,config); }}, {serviceName:'fixture:operator'});
    adapter = {close: async () => {await owned.close();await ctx.fiber.dispose();}};
    port = ctx.get('hanaworldsLuantiLocalWorlds');
  } else {
    adapter = apply({ get: n => services[n], provide: (n, v) => provided.set(n, v),
      webServer: { register() {} } }, { serviceName: 'fixture:operator' });
    port = provided.get('hanaworldsLuantiLocalWorlds');
  }
  t.after(async () => { await adapter.close(); await rm(root, { recursive: true, force: true }); });
  assert.ok(port, 'public local-world service must be registered');
  await port.setRoots({ roots: [root] });
  const [found] = await port.discover();
  const input = { connectionRef: found.connectionRef, requesterRef: 'host:requester',
    userPath: root, username: 'NativeAdmin', password: 'fixture-password', action: 'PROVISION_PAYLOAD' };
  const acquire = async (change = {}) => port.acquire({ ...input, ...change });
  const query = lease => ({ leaseRef: lease.leaseRef, requesterRef: input.requesterRef,
    connectionRef: input.connectionRef });
  return { root, world, port, adapter, model, services, input, acquire, query, found, diagnostics };
}

test('public Cordis registry keeps a running lease across rejected connection queries',
  {skip: !process.env.HW_CORDIS_MODULE}, async t => {
    const {Context} = await import(process.env.HW_CORDIS_MODULE);
    const f = await fixture(t, Context), install = await f.acquire();
    await f.port.provision(f.query(install));
    const lease = await f.acquire({action:'BIND_RUNNING_WORLD'});
    await courier(t, f);
    await f.port.pair(f.query(lease));
    await assert.rejects(f.port.readCurrentGrants({...f.query(lease), connectionRef:'local:other'}), /CONNECTION_UNAUTHORIZED/);
    let current;
    try {current = await f.port.readCurrentGrants(f.query(lease));}
    catch(error) {console.error(JSON.stringify({sourceCordisBoundary:f.diagnostics}));throw error;}
    assert.equal(current.grants[0].grantRef, 'fixture:grant');
    assert.ok(f.diagnostics.includes('LOCAL_QUERY_BINDING_MISMATCH'));
  });

async function courier(t, f, { mismatch = false, onRead = () => {} } = {}) {
  const directory = join(f.world, 'worldmods/hanaworlds_adapter');
  const manifest = JSON.parse(await readFile(join(directory, 'payload.json')));
  const config = JSON.parse(await readFile(join(directory, 'transport.json')));
  const headers = { Authorization: `Bearer ${config.token}` };
  let alive = true;
  const loop = (async () => {
    while (alive) {
      const response = await fetch(`http://127.0.0.1:${config.port}/poll`, { headers }).catch(() => null);
      if (!response) { await new Promise(r => setTimeout(r, 5)); continue; }
      const command = (await response.json()).command;
      if (!command) { await new Promise(r => setTimeout(r, 5)); continue; }
      let result;
      if (command.operation === 'handshake') result = { worldRef: manifest.worldRef,
        payloadVersion: PAYLOAD_VERSION, loadedSourceDigest: mismatch ? '0'.repeat(64) : manifest.payloadDigest,
        manifestDigest: manifest.payloadDigest, payloadMatches: true, worldeditAvailable: true };
      else if (command.operation === 'list_grants') {
        onRead(); result = { grants: [{ worldRef: manifest.worldRef, engineActorName: 'NativeAdmin',
          current: true, scope: 'WORLD_BUILD_WITH_ENGINE_PROTECTION', grantRef: 'fixture:grant' }] };
      } else throw Error('Unexpected fixture operation');
      await fetch(`http://127.0.0.1:${config.port}/result`, { method: 'POST', headers,
        body: JSON.stringify({ id: command.id, worldRef: manifest.worldRef, result }) });
    }
  })();
  t.after(async () => { alive = false; await loop; });
}

test('public discovery includes missing identity before any Session or native grant', async t => {
  const f = await fixture(t);
  assert.equal(f.found.worldRef, null);
  assert.equal(f.found.payloadStatus, 'MISSING');
  assert.equal(f.found.worldPath, f.world);
  await symlink(f.root, join(f.root, 'linked'));
  await assert.rejects(f.port.setRoots({ roots: [join(f.root, 'linked')] }), /CONNECTION_NOT_FOUND/);
  assert.equal((await f.port.discover()).length, 1);
});

test('public install consumes only the native stopped callback, never supplied facts or old leases', async t => {
  const f = await fixture(t), lease = await f.acquire(), q = f.query(lease);
  const current = await f.port.inspect(q);
  assert.equal(current.action, 'PROVISION_PAYLOAD'); assert.equal(current.current, true);
  for (const change of [{ requesterRef: 'wrong' }, { connectionRef: 'wrong' }, { leaseRef: 'forged' }])
    await assert.rejects(f.port.provision({ ...q, ...change }), /CONNECTION_UNAUTHORIZED/);
  await assert.rejects(f.port.provision({ ...q, operator: { current: true, worldStopped: true } }), /SCHEMA_INVALID/);
  assert.equal(f.model.callbacks, 0);
  const installed = await f.port.provision(q);
  assert.equal(f.model.stopped, true); assert.equal(f.model.callbacks, 1);
  assert.match(installed.worldRef, /^luanti:/);
  assert.equal(JSON.parse(await readFile(join(f.world, 'worldmods/hanaworlds_adapter/payload.json'))).worldRef, installed.worldRef);
  const pairing = JSON.parse(await readFile(join(f.world, 'worldmods/hanaworlds_adapter/transport.json')));
  assert.ok(pairing.port > 0); assert.equal(pairing.worldRef, installed.worldRef);
  assert.equal(JSON.stringify(installed).includes(pairing.token), false);
  await assert.rejects(f.port.provision(q), /CONNECTION_UNAUTHORIZED/);
  await assert.rejects(f.port.inspect(q), /CONNECTION_UNAUTHORIZED/);
});

test('lost native permission and wrong callback attribution never install a payload', async t => {
  const f = await fixture(t);
  let lease = await f.acquire(); f.model.allowed = false;
  await assert.rejects(f.port.provision(f.query(lease)), /^Error: CONNECTION_UNAUTHORIZED$/);
  await assert.rejects(readFile(join(f.world, 'worldmods/hanaworlds_adapter/payload.json')), /ENOENT/);
  f.model.allowed = true; lease = await f.acquire();
  f.model.changeFacts = facts => ({ ...facts, processId: facts.processId + 1 });
  await assert.rejects(f.port.provision(f.query(lease)), /CONNECTION_UNAUTHORIZED/);
  await assert.rejects(readFile(join(f.world, 'worldmods/hanaworlds_adapter/payload.json')), /ENOENT/);
  f.model.changeFacts = facts => facts; lease = await f.acquire();
  f.model.beforeConsume = () => { delete f.services.hanaworldsNativeEngineControl; };
  await assert.rejects(f.port.provision(f.query(lease)), /CONNECTION_UNAUTHORIZED/);
  await assert.rejects(readFile(join(f.world, 'worldmods/hanaworlds_adapter/payload.json')), /ENOENT/);
});

test('acquisition snapshots trusted input and rejects missing providers, injected fields and unpaired bind', async t => {
  const f = await fixture(t);
  await assert.rejects(f.acquire({ current: true }), /SCHEMA_INVALID/);
  await assert.rejects(f.acquire({ action: 'WRITE_WORLD' }), /SCHEMA_INVALID/);
  await assert.rejects(f.acquire({ action: 'BIND_RUNNING_WORLD' }), /WORLD_NOT_BOUND/);
  await assert.rejects(f.acquire({ password: 'wrong' }), /^Error: CONNECTION_UNAUTHORIZED$/);
  delete f.services.hanaworldsNativeEngineControl;
  await assert.rejects(f.acquire(), /CONNECTION_UNAUTHORIZED/);
});

test('permission withdrawn between stopped acquisition and installation denies with no fallback', async t => {
  const f = await fixture(t), lease = await f.acquire();
  f.services.hanaworldsOperatorAuthority = { verify: async x => ({ ...x, current: true, worldStopped: true }) };
  delete f.services.hanaworldsNativeEngineControl;
  await assert.rejects(f.port.provision(f.query(lease)), /CONNECTION_UNAUTHORIZED/);
  await assert.rejects(readFile(join(f.world, 'worldmods/hanaworlds_adapter/payload.json')), /ENOENT/);
});

test('native input and callback are action snapshots; duplicate and saved consumers cannot install twice', async t => {
  const f = await fixture(t), input = { ...f.input };
  const pending = f.port.acquire(input); input.username = 'Other'; input.action = 'BIND_RUNNING_WORLD';
  const lease = await pending; assert.equal(lease.engineActorName, 'NativeAdmin');
  const stop = f.model.withStoppedWorld.bind(f.model); let saved;
  f.model.withStoppedWorld = async (q, consume) => stop(q, async facts => {
    saved = () => consume(facts);
    const first = await consume(facts);
    await assert.rejects(saved(), /CONNECTION_UNAUTHORIZED/);
    return first;
  });
  const q = f.query(lease), install = f.port.provision(q); q.requesterRef = 'Other';
  const identity = await install;
  await assert.rejects(saved(), /CONNECTION_UNAUTHORIZED/);
  assert.equal((await f.port.discover())[0].worldRef, identity.worldRef);
});

test('running pair holds one shared courier and returns only current game grants', async t => {
  const f = await fixture(t), provisioning = await f.acquire();
  await assert.rejects(f.port.pair(f.query(provisioning)), /CONNECTION_UNAUTHORIZED/);
  const identity = await f.port.provision(f.query(provisioning));
  const running = await f.acquire({ action: 'BIND_RUNNING_WORLD' });
  await assert.rejects(f.port.provision(f.query(running)), /CONNECTION_UNAUTHORIZED/);
  await courier(t, f);
  const paired = await f.port.pair(f.query(running));
  assert.equal(paired.paired, true); assert.equal(paired.worldRef, identity.worldRef);
  assert.equal(paired.action, 'BIND_RUNNING_WORLD');
  await assert.rejects(f.port.pair(f.query(running)), /CONNECTION_UNAUTHORIZED/);
  const current = await f.port.readCurrentGrants(f.query(running));
  assert.equal(current.grants[0].grantRef, 'fixture:grant');
  assert.equal(current.grants[0].worldRef, identity.worldRef);
  f.model.allowed = false;
  await assert.rejects(f.port.readCurrentGrants(f.query(running)), /CONNECTION_UNAUTHORIZED/);
});

test('loaded digest mismatch expires running pair without widening legacy authority', async t => {
  const f = await fixture(t), install = await f.acquire();
  await f.port.provision(f.query(install));
  const lease = await f.acquire({ action: 'BIND_RUNNING_WORLD' });
  await courier(t, f, { mismatch: true });
  await assert.rejects(f.port.pair(f.query(lease)), /CONNECTION_UNAUTHORIZED/);
  await assert.rejects(f.port.inspect(f.query(lease)), /CONNECTION_UNAUTHORIZED/);
  assert.equal(f.model.stopped, true);
});

test('operator revocation during asynchronous game read rejects the received grant', async t => {
  const f = await fixture(t), install = await f.acquire();
  await f.port.provision(f.query(install));
  const lease = await f.acquire({ action: 'BIND_RUNNING_WORLD' });
  await courier(t, f, { onRead: () => { f.model.allowed = false; } });
  await f.port.pair(f.query(lease));
  await assert.rejects(f.port.readCurrentGrants(f.query(lease)), /CONNECTION_UNAUTHORIZED/);
});
