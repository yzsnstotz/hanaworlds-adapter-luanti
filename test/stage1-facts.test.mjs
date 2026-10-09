import assert from 'node:assert/strict';
import test from 'node:test';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { rm } from 'node:fs/promises';
import { digestValue, validateConfigEngineFacts, requireKnownWriteBackend, publicError } from 'hanaworlds-contracts';
import { openFixtureWorld } from '../dev/stage1-supply/fixture-world.mjs';
import { configEngineFactsRevision } from '../src/stage1-facts.mjs';

// SOURCE/FIXTURE: real Adapter public path and real payload facts.lua/engine.lua; the
// native Host and the engine `core` are fixtures. Not a real Luanti, player or WorldEdit.
const runRoot = process.env.HW_STAGE1_RUN ?? join(homedir(), '.cache/hanaworlds-runs/hanaworlds-adapter-luanti-SUPPLY-01/test-fixture');
const STAND = [-0.312, 0, -0.312, 0.312, 1.8, 0.312], SNEAK = [-0.312, 0, -0.312, 0.312, 1.5, 0.312];
const base = (players, worldedit = { version_string: '1.3', version: { major: 1, minor: 3 } }, writeBackendDeclared = true) => ({
  gameId: 'fixture_game', nodes: ['air', 'fixture:stone'], modnames: worldedit ? ['fixture_core', 'worldedit'] : ['fixture_core'],
  worldedit, players, writeBackendDeclared });

async function world(t, scenario) {
  const w = await openFixtureWorld({ runRoot, scenario });
  t.after(async () => { await w.close(); await rm(w.root, { recursive: true, force: true }); });
  return w;
}

test('config engine facts: payload-declared backend KNOWN, avatar always UNAVAILABLE, no body data', async t => {
  const w = await world(t, base([{ name: 'alice', collisionbox: STAND }]));
  const paired = await w.connect();
  const f = await w.facts.readConfigEngineFacts(w.worldRef);
  assert.deepEqual(Object.keys(f).sort(), ['avatarEnvelope', 'catalogueDigest', 'connection', 'profileVersion', 'sourceRevision', 'writeBackend']);
  assert.equal(f.profileVersion, 'config-engine-facts/v1');
  assert.deepEqual({ ...f.connection }, { worldRef: w.worldRef, connectionRef: paired.connectionRef, connectionIncarnationRef: paired.connectionIncarnationRef });
  assert.deepEqual({ ...f.writeBackend }, { availability: 'KNOWN', basis: 'LOADED_PAYLOAD_DECLARATION',
    backendProfileId: 'hanaworlds-luanti-worldedit-cell-write/v1', nodeWriteSemantics: 'explicit-nodeName-param2-static-v2' });
  assert.deepEqual({ ...f.avatarEnvelope }, { availability: 'UNAVAILABLE', reason: 'NO_PUBLIC_SOURCE' });
  assert.equal(f.catalogueDigest, digestValue('catalogue', await w.facts.readCatalogue(w.worldRef)).sha256);
  const { sourceRevision, ...projection } = f;
  assert.equal(sourceRevision, configEngineFactsRevision(projection));
  for (const leak of ['alice', '0.312', '1.8', 'collision', 'dimensions', 'width', 'height']) assert.equal(JSON.stringify(f).includes(leak), false, leak);
});

test('config engine facts: player presence and pose change nothing that leaves the Adapter', async t => {
  const w = await world(t, base([{ name: 'alice', collisionbox: STAND }]));
  await w.connect();
  const first = await w.facts.readConfigEngineFacts(w.worldRef);
  for (const players of [[{ name: 'alice', collisionbox: SNEAK }], [], [{ name: 'a', collisionbox: STAND }, { name: 'b', collisionbox: STAND }]]) {
    await w.setScenario(base(players));
    assert.deepEqual(await w.facts.readConfigEngineFacts(w.worldRef), first);
  }
  assert.deepEqual(w.facts.readStage1FactLedger(w.worldRef).configEngineFacts.map(x => x.state), ['CURRENT']);
});

test('config engine facts: a payload without a declaration is UNAVAILABLE, never a substituted id', async t => {
  const w = await world(t, base([], undefined, false));
  await w.connect();
  const f = await w.facts.readConfigEngineFacts(w.worldRef);
  assert.deepEqual({ ...f.writeBackend }, { availability: 'UNAVAILABLE', reason: 'NOT_DECLARED_BY_PAYLOAD' });
  await w.setScenario(base([]));
  const g = await w.facts.readConfigEngineFacts(w.worldRef);
  assert.equal(g.writeBackend.availability, 'KNOWN');
  const ledger = w.facts.readStage1FactLedger(w.worldRef).configEngineFacts;
  assert.deepEqual(ledger.map(x => [x.state, x.reasons]), [['RETIRED', ['WRITE_BACKEND_CHANGED']], ['CURRENT', null]]);
});

test('WorldEdit: loaded runtime version, or UNKNOWN when the loaded mod exposes none', async t => {
  const w = await world(t, base([]));
  await w.connect();
  const known = await w.facts.readWorldEditFacts(w.worldRef);
  assert.equal(known.loadState, 'LOADED');
  assert.deepEqual([known.version.status, known.version.value, known.version.major, known.version.minor], ['KNOWN', '1.3', 1, 3]);
  assert.match(known.catalogue.worldeditModRevision, /^[0-9a-f]{64}$/);
  await w.setScenario(base([], { version_string: null }));
  const unknown = await w.facts.readWorldEditFacts(w.worldRef);
  assert.deepEqual(unknown.version, { status: 'UNKNOWN', reason: 'VERSION_NOT_EXPOSED_BY_LOADED_MOD' });
  assert.deepEqual(unknown.supersedes.reasons, ['WORLDEDIT_CHANGED']);
});

test('WorldEdit not loaded: the existing pairing refuses the World (no bound World without WorldEdit)', async t => {
  const w = await world(t, base([], null));
  await assert.rejects(w.connect(), /CURRENT_WORLD_MISMATCH/);
  await assert.rejects(w.facts.readWorldEditFacts(w.worldRef), /WORLD_NOT_BOUND/);
  await assert.rejects(w.facts.readConfigEngineFacts(w.worldRef), /WORLD_NOT_BOUND/);
});

test('connection lifecycle: retire withdraws all facts; a new incarnation is a new domain', async t => {
  const w = await world(t, base([]));
  await w.connect();
  const a = await w.facts.readConfigEngineFacts(w.worldRef);
  const we = await w.facts.readWorldEditFacts(w.worldRef);
  await w.disconnect();
  await assert.rejects(w.facts.readConfigEngineFacts(w.worldRef), /WORLD_NOT_BOUND/);
  const retired = w.facts.readStage1FactLedger(w.worldRef);
  assert.deepEqual(retired.configEngineFacts.map(x => [x.state, x.reasons]), [['RETIRED', ['CONNECTION_RETIRED']]]);
  assert.deepEqual(retired.worldEdit.map(x => [x.state, x.reasons]), [['RETIRED', ['CONNECTION_RETIRED']]]);
  await w.connect();
  const b = await w.facts.readConfigEngineFacts(w.worldRef);
  assert.notEqual(b.connection.connectionIncarnationRef, a.connection.connectionIncarnationRef);
  assert.notEqual(b.sourceRevision, a.sourceRevision);
  assert.notEqual((await w.facts.readWorldEditFacts(w.worldRef)).revision, we.revision);
});

test('input: unbound or invalid World is refused without reading', async t => {
  const w = await world(t, base([]));
  await assert.rejects(w.facts.readConfigEngineFacts('luanti:not-bound'), /WORLD_NOT_BOUND/);
  await assert.rejects(w.facts.readConfigEngineFacts({ worldRef: w.worldRef }), /SCHEMA_INVALID/);
  await assert.rejects(w.facts.readWorldEditFacts(''), /SCHEMA_INVALID/);
  assert.throws(() => w.facts.readStage1FactLedger(null), /SCHEMA_INVALID/);
  assert.equal(typeof w.facts.readAvatarEnvelope, 'undefined', 'no public envelope read exists');
});


test('backend not ready produces legal UNAVAILABLE and consumer public error, then retires the previous fact', async t => {
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
