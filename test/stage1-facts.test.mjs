import assert from 'node:assert/strict';
import test from 'node:test';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { rm } from 'node:fs/promises';
import { openFixtureWorld } from '../dev/stage1-supply/fixture-world.mjs';

// SOURCE/FIXTURE: real Adapter public path and real payload facts.lua; the native
// Host and the engine `core` are fixtures. Not a real Luanti, player or WorldEdit.
const runRoot = process.env.HW_STAGE1_RUN ?? join(homedir(), '.cache/hanaworlds-runs/hanaworlds-adapter-luanti-SUPPLY-01/test-fixture');
const STAND = [-0.312, 0, -0.312, 0.312, 1.8, 0.312], SNEAK = [-0.312, 0, -0.312, 0.312, 1.5, 0.312];
const base = (players, worldedit = { version_string: '1.3', version: { major: 1, minor: 3 } }) => ({
  gameId: 'fixture_game', nodes: ['air', 'fixture:stone'], modnames: worldedit ? ['fixture_core', 'worldedit'] : ['fixture_core'],
  worldedit, players });
const named = detail => error => error.message === 'CAPABILITY_UNAVAILABLE' && error.reason === 'REQUIRED_FACT_UNKNOWN' && error.detail === detail;

async function world(t, scenario) {
  const w = await openFixtureWorld({ runRoot, scenario });
  t.after(async () => { await w.close(); await rm(w.root, { recursive: true, force: true }); });
  return w;
}

test('envelope: extents of the single connected player, no position/yaw/name/box offsets', async t => {
  const w = await world(t, base([{ name: 'alice', collisionbox: STAND }]));
  await w.connect();
  const e = await w.facts.readAvatarEnvelope(w.worldRef);
  assert.deepEqual({ ...e.avatarDimensions }, { width: 0.624, height: 1.8, depth: 0.624, unit: 'luanti-node' });
  assert.equal(e.domain.worldRef, w.worldRef);
  assert.equal(e.source.kind, 'ENGINE_FACT');
  assert.match(e.revision, /^avatar-envelope-[0-9a-f]{64}$/);
  const text = JSON.stringify(e);
  for (const leak of ['alice', '-0.312', 'pos', 'yaw', 'collisionbox"']) assert.equal(text.includes(`"${leak}`) || text.includes(leak + '"'), false, leak);
  assert.equal(JSON.stringify(await w.facts.readAvatarEnvelope(w.worldRef)).includes('alice'), false);
  assert.equal((await w.facts.readAvatarEnvelope(w.worldRef)).revision, e.revision, 'same facts, same revision');
});

test('envelope: change of box or player retires the previous fact with reasons', async t => {
  const w = await world(t, base([{ name: 'alice', collisionbox: STAND }]));
  await w.connect();
  const first = await w.facts.readAvatarEnvelope(w.worldRef);
  await w.setScenario(base([{ name: 'alice', collisionbox: SNEAK }]));
  const sneak = await w.facts.readAvatarEnvelope(w.worldRef);
  assert.equal(sneak.avatarDimensions.height, 1.5);
  assert.deepEqual(sneak.supersedes, { revision: first.revision, reasons: ['ENVELOPE_CHANGED'] });
  await w.setScenario(base([{ name: 'bob', collisionbox: SNEAK }]));
  const bob = await w.facts.readAvatarEnvelope(w.worldRef);
  assert.deepEqual(bob.supersedes.reasons, ['PLAYER_CHANGED']);
  assert.notEqual(bob.playerRef, sneak.playerRef);
  const ledger = w.facts.readStage1FactLedger(w.worldRef).avatarEnvelope;
  assert.deepEqual(ledger.map(x => x.state), ['RETIRED', 'RETIRED', 'CURRENT']);
  assert.equal(ledger[0].retiredBy, sneak.revision);
});

test('envelope: no player, several players or unreadable box are named refusals that withdraw the current fact', async t => {
  const w = await world(t, base([{ name: 'alice', collisionbox: STAND }]));
  await w.connect();
  await w.facts.readAvatarEnvelope(w.worldRef);
  await w.setScenario(base([]));
  await assert.rejects(w.facts.readAvatarEnvelope(w.worldRef), named('PLAYER_NOT_CONNECTED'));
  const after = w.facts.readStage1FactLedger(w.worldRef).avatarEnvelope;
  assert.deepEqual(after.map(x => [x.state, x.reasons]), [['RETIRED', ['PLAYER_NOT_CONNECTED']]]);
  await w.setScenario(base([{ name: 'alice', collisionbox: STAND }, { name: 'bob', collisionbox: STAND }]));
  await assert.rejects(w.facts.readAvatarEnvelope(w.worldRef), named('PLAYER_NOT_SINGULAR'));
  await w.setScenario(base([{ name: 'alice', collisionbox: [0, 0, 0, 0, 1.8, 0.3] }]));
  await assert.rejects(w.facts.readAvatarEnvelope(w.worldRef), named('COLLISIONBOX_UNREADABLE'));
  await w.setScenario(base([{ name: 'alice', collisionbox: [-0.3, 0, -0.3, 0.3] }]));
  await assert.rejects(w.facts.readAvatarEnvelope(w.worldRef), named('COLLISIONBOX_UNREADABLE'));
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
});

test('connection lifecycle: retire withdraws all facts; a new incarnation is a new domain', async t => {
  const w = await world(t, base([{ name: 'alice', collisionbox: STAND }]));
  await w.connect();
  const a = await w.facts.readAvatarEnvelope(w.worldRef);
  const we = await w.facts.readWorldEditFacts(w.worldRef);
  await w.disconnect();
  await assert.rejects(w.facts.readAvatarEnvelope(w.worldRef), /WORLD_NOT_BOUND/);
  const retired = w.facts.readStage1FactLedger(w.worldRef);
  assert.deepEqual(retired.avatarEnvelope.map(x => [x.state, x.reasons]), [['RETIRED', ['CONNECTION_RETIRED']]]);
  assert.deepEqual(retired.worldEdit.map(x => [x.state, x.reasons]), [['RETIRED', ['CONNECTION_RETIRED']]]);
  await w.connect();
  const b = await w.facts.readAvatarEnvelope(w.worldRef);
  assert.notEqual(b.domain.connectionIncarnationRef, a.domain.connectionIncarnationRef);
  assert.notEqual(b.revision, a.revision);
  assert.equal(b.supersedes, null, 'nothing current survived the retirement');
  assert.equal((await w.facts.readWorldEditFacts(w.worldRef)).revision === we.revision, false);
});

test('input: unbound or invalid World is refused without reading', async t => {
  const w = await world(t, base([{ name: 'alice', collisionbox: STAND }]));
  await assert.rejects(w.facts.readAvatarEnvelope('luanti:not-bound'), /WORLD_NOT_BOUND/);
  await assert.rejects(w.facts.readAvatarEnvelope({ worldRef: w.worldRef }), /SCHEMA_INVALID/);
  await assert.rejects(w.facts.readWorldEditFacts(''), /SCHEMA_INVALID/);
  assert.throws(() => w.facts.readStage1FactLedger(null), /SCHEMA_INVALID/);
});
