import assert from 'node:assert/strict';
import test from 'node:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createConnection } from 'node:net';
import { mkdir, mkdtemp, readFile, realpath, rename, symlink, writeFile } from 'node:fs/promises';
import { describeSourceWorld, digestValue, validateConfigEngineFacts, requireKnownWriteBackend, publicError } from 'hanaworlds-contracts';
import { openFixtureWorld } from '../dev/stage1-supply/fixture-world.mjs';
import { configEngineFactsRevision } from '../src/stage1-facts.mjs';

// SOURCE/FIXTURE: real Adapter public path and real payload facts.lua/engine.lua; the
// native Host and the engine `core` are fixtures. Not a real Luanti, player or WorldEdit.
const runRoot = process.env.HW_STAGE1_RUN ?? join(tmpdir(), 'hanaworlds-adapter-stage1-tests');
const STAND = [-0.312, 0, -0.312, 0.312, 1.8, 0.312], SNEAK = [-0.312, 0, -0.312, 0.312, 1.5, 0.312];
const base = (players, worldedit = { version_string: '1.3', version: { major: 1, minor: 3 } }, writeBackendDeclared = true) => ({
  gameId: 'fixture_game', nodes: ['air', 'fixture:stone'], modnames: worldedit ? ['fixture_core', 'worldedit'] : ['fixture_core'],
  worldedit, players, writeBackendDeclared });

for (const preparation of ['default-temp', 'canonical', 'symlink-alias']) {
  async function world(t, scenario) {
    let preparedRoot = runRoot, parent;
    if (preparation !== 'default-temp') {
      await mkdir(runRoot, { recursive: true });
      parent = await realpath(await mkdtemp(join(runRoot, 'fixture-preparation-')));
      const owned = join(parent, 'owned');
      await mkdir(owned);
      await writeFile(join(parent, 'caller-marker'), 'preserve caller parent');
      preparedRoot = owned;
      if (preparation === 'symlink-alias') {
        preparedRoot = join(parent, 'owned-alias');
        await symlink(owned, preparedRoot, 'dir');
      }
      t.diagnostic(`fixture-preparation ${JSON.stringify({ preparation, parent })}`);
    }
    const w = await openFixtureWorld({ runRoot: preparedRoot, scenario });
    t.diagnostic(`fixture-owned ${JSON.stringify({ preparation, root: w.root })}`);
    t.after(async () => {
      await w.close();
      if (parent) assert.equal(await readFile(join(parent, 'caller-marker'), 'utf8'), 'preserve caller parent');
      t.diagnostic(`fixture-closed ${JSON.stringify({ root: w.root })}`);
    });
    assert.equal(w.root, await realpath(w.root));
    const description = await describeSourceWorld(w.port, { contractVersion: 'local-worlds/v2',
      requestId: 'fixture-canonical-description', worldRef: w.worldRef });
    assert.equal(description.error, null);
    assert.equal(description.result.sourceLocator.worldRoot, w.root);
    assert.equal(description.result.sourceLocator.worldPath, join(w.root, 'world'));
    assert.equal(description.result.sourceStartupFacts.availability, 'KNOWN');
    return w;
  }

  test(`[${preparation}] config engine facts: payload-declared backend KNOWN, avatar always UNAVAILABLE, no body data`, async t => {
    const w = await world(t, base([{ name: 'alice', collisionbox: STAND }]));
    const paired = await w.connect();
    const f = await w.facts.readConfigEngineFacts(w.worldRef);
    assert.deepEqual(Object.keys(f).sort(), ['avatarEnvelope', 'catalogueDigest', 'connection', 'profileVersion', 'sourceRevision', 'writeBackend']);
    assert.equal(f.profileVersion, 'config-engine-facts/v2');
    assert.deepEqual({ ...f.connection }, { worldRef: w.worldRef, connectionRef: paired.connectionRef, connectionIncarnationRef: paired.connectionIncarnationRef });
    assert.deepEqual(JSON.parse(JSON.stringify(f.writeBackend)), { availability: 'KNOWN', basis: 'LOADED_PAYLOAD_DECLARATION',
      writeBackend: {profileId:'hanaworlds-luanti-native-cell-write/v2',revision:'native-cell-write/3'} });
    assert.deepEqual({ ...f.avatarEnvelope }, { availability: 'UNAVAILABLE', reason: 'NO_PUBLIC_SOURCE' });
    assert.equal(f.catalogueDigest, digestValue('catalogue', await w.facts.readCatalogue(w.worldRef)).sha256);
    const { sourceRevision, ...projection } = f;
    assert.equal(sourceRevision, configEngineFactsRevision(projection));
    for (const leak of ['alice', '0.312', '1.8', 'collision', 'dimensions', 'width', 'height']) assert.equal(JSON.stringify(f).includes(leak), false, leak);
  });

  test(`[${preparation}] config engine facts: player presence and pose change nothing that leaves the Adapter`, async t => {
    const w = await world(t, base([{ name: 'alice', collisionbox: STAND }]));
    await w.connect();
    const first = await w.facts.readConfigEngineFacts(w.worldRef);
    for (const players of [[{ name: 'alice', collisionbox: SNEAK }], [], [{ name: 'a', collisionbox: STAND }, { name: 'b', collisionbox: STAND }]]) {
      await w.setScenario(base(players));
      assert.deepEqual(await w.facts.readConfigEngineFacts(w.worldRef), first);
    }
    assert.deepEqual(w.facts.readStage1FactLedger(w.worldRef).configEngineFacts.map(x => x.state), ['CURRENT']);
  });

  test(`[${preparation}] config engine facts: a payload without a declaration is UNAVAILABLE, never a substituted id`, async t => {
    const w = await world(t, base([], undefined, false));
    await w.connect();
    const f = await w.facts.readConfigEngineFacts(w.worldRef);
    assert.deepEqual(JSON.parse(JSON.stringify(f.writeBackend)), { availability: 'UNAVAILABLE', reason: 'NOT_DECLARED_BY_PAYLOAD' });
    await w.setScenario(base([]));
    const g = await w.facts.readConfigEngineFacts(w.worldRef);
    assert.equal(g.writeBackend.availability, 'KNOWN');
    const ledger = w.facts.readStage1FactLedger(w.worldRef).configEngineFacts;
    assert.deepEqual(ledger.map(x => [x.state, x.reasons]), [['RETIRED', ['WRITE_BACKEND_CHANGED']], ['CURRENT', null]]);
  });

  test(`[${preparation}] retired WorldEdit diagnostics always refuse while native facts work with and without the mod`, async t => {
    for(const loaded of [null,{version_string:'1.3'}]) {
      const w=await world(t,base([],loaded));await w.connect();
      await assert.rejects(w.facts.readWorldEditFacts(w.worldRef),e=>e.code==='CAPABILITY_UNAVAILABLE' && e.detail==='WORLDEDIT_FACTS_RETIRED_D15');
      assert.equal((await w.facts.readConfigEngineFacts(w.worldRef)).writeBackend.availability,'KNOWN');
      assert.deepEqual(w.facts.readStage1FactLedger(w.worldRef).worldEdit,[]);
    }
  });

  test(`[${preparation}] connection lifecycle: retire withdraws all facts; a new incarnation is a new domain`, async t => {
    const w = await world(t, base([]));
    await w.connect();
    const a = await w.facts.readConfigEngineFacts(w.worldRef);
    await assert.rejects(w.facts.readWorldEditFacts(w.worldRef), /CAPABILITY_UNAVAILABLE/);
    await w.disconnect();
    await assert.rejects(w.facts.readConfigEngineFacts(w.worldRef), /WORLD_NOT_BOUND/);
    const retired = w.facts.readStage1FactLedger(w.worldRef);
    assert.deepEqual(retired.configEngineFacts.map(x => [x.state, x.reasons]), [['RETIRED', ['CONNECTION_RETIRED']]]);
    assert.deepEqual(retired.worldEdit, []);
    await w.connect();
    const b = await w.facts.readConfigEngineFacts(w.worldRef);
    assert.notEqual(b.connection.connectionIncarnationRef, a.connection.connectionIncarnationRef);
    assert.notEqual(b.sourceRevision, a.sourceRevision);
    await assert.rejects(w.facts.readWorldEditFacts(w.worldRef), /CAPABILITY_UNAVAILABLE/);
  });

  test(`[${preparation}] input: unbound or invalid World is refused without reading`, async t => {
    const w = await world(t, base([]));
    await assert.rejects(w.facts.readConfigEngineFacts('luanti:not-bound'), /WORLD_NOT_BOUND/);
    await assert.rejects(w.facts.readConfigEngineFacts({ worldRef: w.worldRef }), /SCHEMA_INVALID/);
    await assert.rejects(w.facts.readWorldEditFacts(''), /SCHEMA_INVALID/);
    assert.throws(() => w.facts.readStage1FactLedger(null), /SCHEMA_INVALID/);
    assert.equal(typeof w.facts.readAvatarEnvelope, 'undefined', 'no public envelope read exists');
  });


  test(`[${preparation}] backend not ready produces legal UNAVAILABLE and consumer public error, then retires the previous fact`, async t => {
    const w = await world(t, base([]));
    await w.connect();
    const known = await w.facts.readConfigEngineFacts(w.worldRef);
    await w.setScenario({ ...base([]), writeBackendReady: false });
    const unavailable = await w.facts.readConfigEngineFacts(w.worldRef);
    assert.deepEqual({ ...unavailable.writeBackend }, { availability: 'UNAVAILABLE', reason: 'ENGINE_FACT_UNREADABLE' });
    validateConfigEngineFacts(unavailable, await w.facts.readCatalogue(w.worldRef), unavailable.connection);
    assert.throws(() => requireKnownWriteBackend(unavailable), error => {
      const e = publicError(error);
      assert.deepEqual([e.code, e.phase, e.reason], ['CAPABILITY_UNAVAILABLE', 'validate', 'REQUIRED_FACT_UNKNOWN']);
      return true;
    });
    assert.notEqual(known.sourceRevision, unavailable.sourceRevision);
    assert.deepEqual(w.facts.readStage1FactLedger(w.worldRef).configEngineFacts.map(x => x.state), ['RETIRED', 'CURRENT']);
  });
}

test('production setRoots still refuses final and ancestor symlink roots without losing the current fixture', async t => {
  const w = await openFixtureWorld({ runRoot, scenario: base([]) });
  t.diagnostic(`fixture-owned ${JSON.stringify({ preparation: "production-rejection", root: w.root })}`);
  t.after(async () => { await w.close(); t.diagnostic(`fixture-closed ${JSON.stringify({ root: w.root })}`); });
  const alias = join(w.root, "root-alias");
  await symlink(w.root, alias, "dir");
  for (const root of [alias, join(alias, "world")]) {
    await assert.rejects(w.port.setRoots({ roots: [root] }), /CONNECTION_NOT_FOUND/);
  }
  await w.connect();
  assert.equal((await w.facts.readConfigEngineFacts(w.worldRef)).writeBackend.availability, "KNOWN");
});


test('fixture close stops its own courier after an identity failure and leaves a peer fixture current', async t => {
  const fixtures = [];
  t.after(async () => { for (const w of fixtures) { await w.close(); t.diagnostic(`fixture-closed ${JSON.stringify({ root: w.root })}`); } });
  for (let i = 0; i < 2; i++) {
    const w = await openFixtureWorld({ runRoot, scenario: base([]) });
    fixtures.push(w);
    t.diagnostic(`fixture-owned ${JSON.stringify({ preparation: 'close-failure', root: w.root })}`);
    await w.connect();
  }
  const [failed, peer] = fixtures;
  const transport = JSON.parse(await readFile(join(failed.root, 'world/worldmods/hanaworlds_adapter/transport.json'), 'utf8'));
  const connect = () => new Promise((resolve, reject) => {
    const socket = createConnection({ host: '127.0.0.1', port: transport.port });
    socket.once('connect', () => { socket.destroy(); resolve(); });
    socket.once('error', reject);
  });
  await connect();
  await rename(join(failed.root, 'world'), join(failed.root, 'world-moved'));
  await assert.rejects(failed.close(), /CONNECTION_NOT_FOUND/);
  await assert.rejects(connect(), e => e.code === 'ECONNREFUSED');
  await assert.rejects(failed.port.discover(), /ADAPTER_UNAVAILABLE/);
  assert.equal((await peer.facts.readConfigEngineFacts(peer.worldRef)).writeBackend.availability, 'KNOWN');
});
