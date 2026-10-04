import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:net';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { apply } from '../src/index.mjs';
import { payloadDigest, provisionLocalPayload } from '../src/local-worlds.mjs';

async function freePort() {
  const probe = createServer();
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  return port;
}

test('host grant evidence lists only native current local grants and rejects old refs', async () => {
  const cache = join(homedir(), '.cache', 'hanaworlds-runs', 'S1-AD-GRANT-01');
  await mkdir(cache, { recursive: true });
  const root = await mkdtemp(join(cache, 'evidence-fixture-'));
  const world = join(root, 'world');
  await mkdir(world);
  await writeFile(join(world, 'world.mt'), 'gameid = minimal\n');
  const port = await freePort();
  const operatorAuthority = { verify: async input => ({ current: true, ...input, worldStopped: true }) };
  const manifest = await provisionLocalPayload(world, { operatorAuthority, transportPort: port });
  const config = JSON.parse(await readFile(join(world, 'worldmods', 'hanaworlds_adapter', 'transport.json')));
  const digest = await payloadDigest();
  const services = { hanaworldsOperatorAuthority: operatorAuthority };
  const provided = new Map();
  const adapter = apply({ webServer: { register() {} }, provide: (name, value) => provided.set(name, value),
    get: name => services[name] }, { localWorldRoots: [root], serviceName: 'operator' });
  const evidence = provided.get('hanaworldsLuantiGrantEvidence');
  const facts = provided.get('hanaworldsLuantiNativeFacts');
  assert.equal(typeof evidence.listCurrentLocalGrants, 'function');
  assert.equal(typeof evidence.verifyCurrentLocalGrant, 'function');
  let grantRef = 'native:one';
  let running = true;
  let permitted = true;
  const cells = new Map([['0,0,0', 'air'], ['1,0,0', 'default:stone'],
    ['9,9,9', 'default:dirt']]);
  const commands = [];
  const headers = { Authorization: `Bearer ${config.token}` };
  const loop = (async () => {
    while (running) {
      const response = await fetch(`http://127.0.0.1:${port}/poll`, { headers }).catch(() => null);
      if (!response) { await new Promise(resolve => setTimeout(resolve, 5)); continue; }
      const command = (await response.json()).command;
      if (!command) { await new Promise(resolve => setTimeout(resolve, 5)); continue; }
      commands.push(command.operation);
      let result;
      let error = null;
      if (command.operation === 'handshake') result = { payloadVersion: '0.2.2',
        worldRef: manifest.worldRef, loadedSourceDigest: digest, manifestDigest: digest,
        payloadMatches: true, worldeditAvailable: true };
      else if (command.operation === 'list_grants') result = { grants: permitted && grantRef ? [
        { current: true, worldRef: manifest.worldRef, engineActorName: 'alice',
          scope: 'WORLD_BUILD_WITH_ENGINE_PROTECTION', grantRef }] : [] };
      else if (command.operation === 'authorize') result = { current: permitted && !!grantRef,
        worldRef: manifest.worldRef, engineActorName: command.actorName,
        scope: 'WORLD_BUILD_WITH_ENGINE_PROTECTION', grantRef,
        worldeditAvailable: true };
      else if (command.operation === 'fact_profile') result = {
        profileVersion: 'state-profile/v2', nodeFields: ['nodeName', 'param1', 'param2'],
        metadataMode: 'exact', inventoryMode: 'exact', timerMode: 'exact',
        derivedLightMode: 'recompute-with-readback' };
      else if (command.operation === 'fact_capacity') result = {
        allowed: command.cellCount <= 10, maxCells: 10,
        source: 'PAIRED_COURIER_RESPONSE_BYTES' };
      else if (command.operation === 'fact_catalogue') result = {
        profileVersion: 'catalogue/v2', engineProfile: 'luanti-runtime-registry',
        gameId: 'minimal', gameRevision: 'registry:one',
        modRevisions: { minimal: 'registry:one' }, nodes: {} };
      else if (command.operation === 'snapshot') {
        if (command.positions.some(position => !cells.has(position.join(','))))
          error = 'TARGET_FACTS_INCOMPLETE';
        else result = { worldRef: manifest.worldRef, coveredPositions: command.positions,
          records: command.positions.map(position => ({ position,
            nodeName: cells.get(position.join(',')), param1: 0, param2: 0,
            metadata: {}, inventory: {}, timer: null })) };
      }
      else if (command.operation === 'fact_world_revision' ||
        command.operation === 'fact_object_revisions') {
        await fetch(`http://127.0.0.1:${port}/result`, { method: 'POST', headers,
          body: JSON.stringify({ id: command.id, worldRef: manifest.worldRef,
            result: null, error: 'CAPABILITY_UNAVAILABLE' }) });
        continue;
      }
      else throw new Error(`Unexpected engine operation ${command.operation}`);
      await fetch(`http://127.0.0.1:${port}/result`, { method: 'POST', headers,
        body: JSON.stringify({ id: command.id, worldRef: manifest.worldRef, result, error }) });
    }
  })();
  try {
    const listed = await evidence.listCurrentLocalGrants({ engineActorName: 'mallory' });
    assert.deepEqual(listed.map(({ connectionRef, ...row }) => row), [{ current: true,
      worldRef: manifest.worldRef, engineActorName: 'alice',
      scope: 'WORLD_BUILD_WITH_ENGINE_PROTECTION', grantRef: 'native:one' }]);
    const query = expectedGrantRef => evidence.verifyCurrentLocalGrant({ worldRef: manifest.worldRef,
      engineActorName: 'alice', expectedGrantRef });
    assert.equal((await query('native:one')).current, true);
    const native = { worldRef: manifest.worldRef, engineActorName: 'alice',
      expectedGrantRef: 'native:one' };
    assert.equal((await facts.readStateProfile(native)).profileVersion, 'state-profile/v2');
    assert.equal((await facts.checkCapacity({ ...native, cellCount: 11 })).allowed, false);
    assert.equal((await facts.readCatalogue(native)).gameId, 'minimal');
    const scope = { ...native, positions: [[1, 0, 0], [0, 0, 0]] };
    const first = await facts.readScopedState(scope);
    assert.deepEqual(first.coveredPositions, [[0, 0, 0], [1, 0, 0]]);
    assert.match(first.stateDigest, /^[0-9a-f]{64}$/);
    assert.deepEqual(first.cells.map(cell => cell.position), first.coveredPositions);
    assert.ok(first.cells.every(cell => cell.availability === 'KNOWN' &&
      /^[0-9a-f]{64}$/.test(cell.stateDigest)));
    cells.set('9,9,9', 'default:gold');
    assert.equal((await facts.readScopedState(scope)).stateDigest, first.stateDigest,
      'an edit outside the bound scope does not stale it');
    assert.deepEqual((await facts.readScopedState(scope)).cells, first.cells);
    cells.set('1,0,0', 'default:gold');
    assert.notEqual((await facts.readScopedState(scope)).stateDigest, first.stateDigest,
      'an edit inside the bound scope changes the observed state');
    assert.notEqual((await facts.readScopedState(scope)).cells[1].stateDigest,
      first.cells[1].stateDigest);
    await assert.rejects(facts.readScopedState({ ...native, positions: [[0, 0, 0], [0, 0, 0]] }),
      /SCHEMA_INVALID/);
    await assert.rejects(facts.readScopedState({ ...native, positions: [[100, 0, 0]] }),
      /TARGET_FACTS_INCOMPLETE/, 'unloaded positions never become empty state');
    await assert.rejects(facts.readWorldRevision(native), /CAPABILITY_UNAVAILABLE/);
    await assert.rejects(facts.readObjectRevisions({ ...native, objectRefs: ['object:one'] }),
      /CAPABILITY_UNAVAILABLE/);
    assert.deepEqual(await query('native:wrong'), { current: false });
    grantRef = null;
    assert.deepEqual(await query('native:one'), { current: false }, 'revoked grant fails');
    grantRef = 'native:two';
    assert.deepEqual(await query('native:one'), { current: false }, 'new grant never revives old ref');
    await assert.rejects(facts.readStateProfile(native), /AUTHORIZATION_REVOKED/);
    await assert.rejects(facts.readScopedState(scope), /AUTHORIZATION_REVOKED/);
    assert.equal((await query('native:two')).current, true);
    permitted = false;
    assert.deepEqual(await query('native:two'), { current: false }, 'privilege loss fails');
    assert.ok(commands.includes('list_grants') && commands.includes('authorize'));
  } finally {
    running = false;
    await loop;
    await adapter.close();
  }
});
