// Conformance of world-adapter/v4 InspectRegion and the Prepare recheck against
// the contracts@0.3.0 placement-region chain oracles (FIXTURE evidence: the
// engine is a synthetic world; the search is the shipped region.lua).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import chain from '#contracts/v4/fixtures/placement-region-chain-v4' with { type: 'json' };
import { digestValue } from '#contracts/v4';
import { WorldAdapterV4 } from '../src/v4-port.mjs';
import { V4TransactionBackend } from '../src/v4-transactions.mjs';
import { DurableJournal } from '../src/journal.mjs';
import { luaEngine } from './support/lua-world.mjs';

const EXEC = 'fixture-adapter-exec-1'; // fixture value of adapterExecutionRevision
const catalogue = chain.validCases[0].materializedChain.painterRequest.catalogue;
const profile = { profileVersion: 'state-profile/v2', nodeFields: ['nodeName', 'param1', 'param2'],
  metadataMode: 'exact', inventoryMode: 'exact', timerMode: 'exact',
  derivedLightMode: 'recompute-with-readback' };
const defaults = { frontGapCells: 2, forwardSearchCells: 16, lateralSearchCells: 8,
  verticalSearchCells: 4, settingsRevision: 'fixture-settings-1' };
const all = [...chain.validCases, ...chain.askCases, ...chain.invalidCases];
const byId = id => all.find(c => c.id === id);
const counters = () => ({ worldWrites: 0, journalPrepares: 0, engineCalls: 0 });

async function adapterFor({ world, online, principal, allowedActions, extra = {}, count }) {
  const journal = await DurableJournal.open(await mkdtemp(join(tmpdir(), 'hw-v4-region-')));
  // Every engine write path is present and counted, so worldWrites is a real measurement.
  const writes = Object.fromEntries(['apply', 'applyState', 'restore'].map(name =>
    [name, async () => { count.worldWrites++; return { status: 'APPLIED_PENDING_READBACK' }; }]));
  const engine = luaEngine(world, online, { ...writes, ...extra });
  const counted = Object.fromEntries(Object.entries(engine).map(([k, f]) =>
    [k, async (...a) => { count.engineCalls++; return f(...a); }]));
  const binding = request => ({ current: true, worldRef: request.worldRef,
    sessionRef: request.sessionRef, authorizationRef: request.authorizationRef,
    actorRef: 'fixture-actor', authorRef: 'fixture-actor', engineActorName: principal,
    allowedActions: allowedActions ?? ['INSPECT', 'APPLY_RECOVERABLE', 'READBACK', 'HISTORY'] });
  const backend = new V4TransactionBackend({ journal, engine: counted, stateProfile: profile,
    revisionOracle: { read: async () => 'fixture-world-10', readObjects: async () => ({}) },
    verifyBinding: async request => binding(request), verifyService: async () => false,
    capacity: { check: async () => ({ allowed: true }) },
    catalogue: { read: async () => structuredClone(catalogue) }, executionRevision: EXEC });
  const port = new WorldAdapterV4({
    authority: { verify: async request => ({ current: true, sessionRef: request.sessionRef,
      authorizationRef: request.authorizationRef, worldRef: request.worldRef,
      domainOwner: 'hanaworlds-canvas' }) },
    operations: { InspectRegion: r => backend.inspectRegion(r),
      PrepareRecoverableTransaction: r => backend.prepare(r),
      QueryPreparedTransaction: r => backend.queryPrepared(r) } });
  const origPrepare = journal.prepare.bind(journal);
  journal.prepare = async input => { count.journalPrepares++; return origPrepare(input); };
  return { port, journal };
}

const worldOf = c => ({ ...chain.enginePrivate, ...(c.enginePrivateOverride ?? {}) });
let sequence = 0;
function inspectRequest(c, anchor, settings) {
  sequence++;
  return { contractVersion: 'world-adapter/v4', actorRef: 'canvas-service-principal',
    sessionRef: 'fixture-session', requestId: `conformance-${sequence}`,
    authorizationRef: 'fixture-current-grant', worldRef: 'fixture-world',
    expectedWorldRevision: 'fixture-world-10', inspectionId: `conformance-inspection-${sequence}`,
    anchor, footprint: { widthCells: 1, depthCells: 1, heightCells: 1 },
    placementSettings: settings ?? defaults };
}
const bbox = boxes => ({ min: [0, 1, 2].map(i => Math.min(...boxes.map(b => b.min[i]))),
  max: [0, 1, 2].map(i => Math.max(...boxes.map(b => b.max[i]))) });

for (const c of chain.validCases) {
  test(`valid ${c.id}: Adapter InspectRegion matches the chained oracle`, async () => {
    const count = counters();
    const { port } = await adapterFor({ world: worldOf(c), online: c.onlinePlayers,
      principal: c.actingPrincipal, count });
    const request = c.materializedChain?.adapterInspectRequest ?? c.adapterInspectRequest ??
      inspectRequest(c, c.canvasInspectRequest.anchor);
    const response = await port.call('InspectRegion', request);
    const expected = c.materializedChain?.adapterInspectResponse ?? c.adapterInspectResponse;
    if (expected) assert.deepEqual(response, expected);
    assert.equal(response.error, null);
    assert.equal(response.result.outcome, 'REGION_INSPECTED');
    const insp = response.result.inspection;
    const s = c.expectedSearch;
    assert.deepEqual(insp.targetFacts.sampledBounds, bbox([s.chosenFootprint, s.supportLayer]));
    assert.equal(insp.entranceFacing, s.entranceFacing);
    assert.deepEqual(bbox(insp.targetFacts.knownEmptyCells.map(p => ({ min: p, max: p }))),
      s.chosenFootprint);
    assert.equal(insp.targetFacts.frameDigest, digestValue('frame', insp.frame).sha256);
    assert.equal(insp.evidence.sourceRevision, insp.frame.transformRevision);
    for (const key of chain.privacy.forbiddenKeys)
      assert.equal(JSON.stringify(response).includes(`"${key}"`), false, key);
    assert.equal(count.worldWrites, 0);
    assert.equal(count.journalPrepares, 0);
  });
}

for (const c of chain.askCases) {
  test(`ask ${c.id}: typed PLACEMENT_CHOICE_REQUIRED equals the relayed oracle outcome`, async () => {
    const count = counters();
    const { port } = await adapterFor({ world: worldOf(c), online: c.onlinePlayers,
      principal: c.actingPrincipal, count });
    const response = await port.call('InspectRegion', inspectRequest(c, c.anchor,
      c.canvasInspectResponse.result.choice.placementSettings));
    assert.equal(response.error, null);
    assert.deepEqual(response.result, c.canvasInspectResponse.result);
    const text = JSON.stringify(response);
    for (const key of chain.privacy.forbiddenKeys) assert.equal(text.includes(`"${key}"`), false);
    assert.equal(count.journalPrepares, 0);
  });
}

test('INV-SHELL-FORGED-PICKREF: an unissued pickRef is PERMISSION_DENIED/IDENTITY_UNVERIFIED', async () => {
  const c = byId('INV-SHELL-FORGED-PICKREF');
  const count = counters();
  const { port } = await adapterFor({ world: chain.enginePrivate, online: ['alice'],
    principal: 'alice', count });
  const response = await port.call('InspectRegion', c.materialized.message);
  assert.deepEqual(response.error, c.expected.error);
  assert.equal(response.result, null);
});

test('a pick issued for another session is not accepted', async () => {
  const count = counters();
  const world = { ...chain.enginePrivate, picks: chain.enginePrivate.picks.map(p =>
    ({ ...p, sessionRef: 'other-session' })) };
  const { port } = await adapterFor({ world, online: ['alice'], principal: 'alice', count });
  const response = await port.call('InspectRegion', inspectRequest({},
    { kind: 'PICKED_POINT', pickRef: 'adapter-pick-1' }));
  assert.equal(response.error.code, 'PERMISSION_DENIED');
  assert.equal(response.error.reason, 'IDENTITY_UNVERIFIED');
});

test('unreadable relay record is INSPECTION_FAILED, never Shell mode', async () => {
  const count = counters();
  const { port } = await adapterFor({ world: { ...chain.enginePrivate, unreadable: true },
    online: ['alice'], principal: 'alice', count });
  const response = await port.call('InspectRegion', inspectRequest({},
    { kind: 'DEFAULT_PLAYER', invocationId: 'fixture-luanti-invocation-7' }));
  assert.equal(response.error.code, 'INSPECTION_FAILED');
  assert.equal(response.error.mutationState, 'NONE');
});

test('a player without a readable collision box is never given the default box', async () => {
  const count = counters();
  const players = chain.enginePrivate.players.map(p => p.name === 'bob' ?
    { ...p, collisionbox: null } : p);
  const { port } = await adapterFor({ world: { ...chain.enginePrivate, players },
    online: ['alice', 'bob'], principal: 'alice', count });
  const response = await port.call('InspectRegion', inspectRequest({},
    { kind: 'DEFAULT_PLAYER', invocationId: 'fixture-luanti-invocation-7' }));
  assert.equal(response.error.code, 'INSPECTION_FAILED');
});

test('names are not released when the grant lacks INSPECT or is revoked before release', async () => {
  const count = counters();
  const c = byId('ASK-SHELL-MULTIPLE');
  const { port } = await adapterFor({ world: chain.enginePrivate, online: c.onlinePlayers,
    principal: 'alice', allowedActions: ['APPLY_RECOVERABLE'], count });
  const response = await port.call('InspectRegion', inspectRequest(c, c.anchor));
  assert.equal(response.result, null);
  assert.equal(response.error.phase, 'authorize');
  assert.equal(JSON.stringify(response).includes('bob'), false);
  // Revocation between the engine read and release.
  let calls = 0;
  const journal = await DurableJournal.open(await mkdtemp(join(tmpdir(), 'hw-v4-revoke-')));
  const backend = new V4TransactionBackend({ journal, engine: luaEngine(chain.enginePrivate, c.onlinePlayers),
    stateProfile: profile, revisionOracle: { read: async () => 'fixture-world-10' },
    verifyBinding: async request => ({ current: ++calls === 1, worldRef: request.worldRef,
      sessionRef: request.sessionRef, authorizationRef: request.authorizationRef,
      actorRef: 'fixture-actor', authorRef: 'fixture-actor', engineActorName: 'alice',
      allowedActions: ['INSPECT'] }),
    capacity: { check: async () => ({ allowed: true }) },
    catalogue: { read: async () => catalogue }, executionRevision: EXEC });
  await assert.rejects(() => backend.inspectRegion(inspectRequest(c, c.anchor)), /AUTHORIZATION_REVOKED/);
  assert.equal(calls, 2);
});

test('stale world revision, missing catalogue and host capacity fail before any engine read', async () => {
  for (const variant of ['stale', 'catalogue', 'limit', 'capacity-missing']) {
    const count = counters();
    let engineCalls = 0;
    const journal = await DurableJournal.open(await mkdtemp(join(tmpdir(), 'hw-v4-pre-')));
    const logs = [];
    const backend = new V4TransactionBackend({ journal, stateProfile: profile,
      log: (level, message) => logs.push({ level, message }),
      engine: { apply: async () => { count.worldWrites++; }, inspectRegion: async (args, b) => { engineCalls++;
        return luaEngine(chain.enginePrivate, ['alice']).inspectRegion(args, b); } },
      revisionOracle: { read: async () => variant === 'stale' ? 'fixture-world-11' : 'fixture-world-10' },
      verifyBinding: async request => ({ current: true, worldRef: request.worldRef,
        sessionRef: request.sessionRef, authorizationRef: request.authorizationRef,
        actorRef: 'fixture-actor', authorRef: 'fixture-actor', engineActorName: 'alice',
        allowedActions: ['INSPECT'] }),
      capacity: variant === 'capacity-missing' ? null :
        { check: async () => ({ allowed: variant !== 'limit', limit: 10 }) },
      catalogue: variant === 'catalogue' ? { read: async () => { throw new Error('catalogue host down'); } } :
        { read: async () => catalogue },
      executionRevision: EXEC });
    const port = new WorldAdapterV4({ authority: { verify: async request => ({ current: true,
      sessionRef: request.sessionRef, authorizationRef: request.authorizationRef,
      worldRef: request.worldRef, domainOwner: 'hanaworlds-canvas' }) },
    operations: { InspectRegion: r => backend.inspectRegion(r) } });
    const response = await port.call('InspectRegion', inspectRequest({},
      { kind: 'DEFAULT_PLAYER', invocationId: 'fixture-luanti-invocation-7' }));
    const expected = { stale: ['STALE_REVISION', 'REVISION_CHANGED'],
      catalogue: ['CAPABILITY_UNAVAILABLE', 'POLICY_UNAVAILABLE'],
      limit: ['LIMIT_EXCEEDED', 'LIMIT_EXCEEDED'],
      'capacity-missing': ['CAPABILITY_UNAVAILABLE', 'POLICY_UNAVAILABLE'] }[variant];
    assert.deepEqual([response.error.code, response.error.reason], expected, variant);
    // A capacity breach is reported only after anchor/facing resolution in-engine.
    assert.equal(engineCalls, variant === 'limit' ? 1 : 0, variant);
    // The failure stays attributable by a fixed label; the provider's own
    // exception text is untrusted and is never logged.
    if (variant === 'catalogue') {
      assert.ok(logs.some(l => l.message.includes('CATALOGUE_READ_FAILED') &&
        l.message.includes('InspectRegion')), 'the catalogue failure cause is logged by a fixed label');
      assert.equal(logs.some(l => l.message.includes('catalogue host down')), false,
        'provider exception text is not logged');
    }
    assert.equal(count.worldWrites, 0);
  }
});

test('InspectRegion is Canvas-only and never authorizes on the request actorRef', async () => {
  const count = counters();
  const { port } = await adapterFor({ world: chain.enginePrivate, online: ['alice'],
    principal: 'alice', count });
  const foreign = new WorldAdapterV4({ authority: { verify: async request => ({ current: true,
    sessionRef: request.sessionRef, authorizationRef: request.authorizationRef,
    worldRef: request.worldRef, domainOwner: 'hanaworlds-workshop' }) },
  operations: { InspectRegion: async () => { throw new Error('reached'); } } });
  const request = inspectRequest({}, { kind: 'DEFAULT_PLAYER', invocationId: 'fixture-luanti-invocation-7' });
  const denied = await foreign.call('InspectRegion', request);
  assert.equal(denied.error.reason, 'OWNERSHIP_VIOLATION');
  // An arbitrary request actorRef neither grants nor removes authority.
  const other = await port.call('InspectRegion', { ...request, requestId: 'actor-variant',
    actorRef: 'anyone' });
  assert.equal(other.error, null);
});

// ---------------------------------------------------------------- Prepare recheck
const prepareRequest = chain.validCases[0].materializedChain.prepareRequest;
const snapshotEngine = (counter) => ({
  snapshot: async request => { counter.snapshots = (counter.snapshots ?? 0) + 1;
    return { worldRef: 'fixture-world', coveredPositions: request.coveredPositions,
      records: request.coveredPositions.map(position => ({ position, nodeName: 'air',
        param1: 15, param2: 0, metadata: {}, inventory: {}, timer: null })) }; },
});

test('valid chain Prepare: rechecks pass, durable barrier, saved readback digest returned and queried', async () => {
  const count = counters();
  const c = chain.validCases[0];
  const { port, journal } = await adapterFor({ world: chain.enginePrivate, online: c.onlinePlayers,
    principal: 'alice', count, extra: snapshotEngine(count) });
  const response = await port.call('PrepareRecoverableTransaction', prepareRequest);
  assert.equal(response.error, null);
  const saved = journal.query('fixture-tx-first-1');
  assert.equal(saved.status, 'PREPARED');
  const view = { worldRef: saved.beforeImage.worldRef, coveredPositions: saved.beforeImage.coveredPositions,
    records: saved.beforeImage.records, stateProfile: saved.beforeImage.stateProfile };
  assert.equal(response.result.beforeStateReadbackDigest, digestValue('readback', view).sha256);
  assert.equal(saved.beforeStateReadbackDigest, response.result.beforeStateReadbackDigest);
  const query = await port.call('QueryPreparedTransaction', { contractVersion: 'world-adapter/v4',
    actorRef: 'canvas-service-principal', sessionRef: 'fixture-session', requestId: 'query-1',
    authorizationRef: 'fixture-current-grant', worldRef: 'fixture-world',
    transactionId: 'fixture-tx-first-1', operationDigest: prepareRequest.operationDigest,
    authorizationBindingDigest: digestValue('authorization-binding', prepareRequest.authorizationBinding).sha256 });
  assert.deepEqual(query.result, response.result);
  assert.equal(count.worldWrites, 0);
});

for (const id of ['INV-PROTECTED-AT-PREPARE', 'INV-BODY-AT-PREPARE']) {
  test(`${id}: Prepare recheck rejects before the durable barrier with the exact oracle error`, async () => {
    const c = byId(id);
    const count = counters();
    const at = c.enginePrivateAtPrepare;
    const world = { ...chain.enginePrivate, ...at };
    const online = at.players ? at.players.map(p => p.name) : chain.validCases[0].onlinePlayers;
    const { port, journal } = await adapterFor({ world, online, principal: 'alice', count,
      extra: snapshotEngine(count) });
    const response = await port.call('PrepareRecoverableTransaction', c.materialized.message);
    assert.deepEqual(response.error, c.expected.error);
    assert.equal(journal.query(c.materialized.message.transactionId), null, 'no durable barrier');
    assert.equal(count.journalPrepares, 0);
    assert.equal(count.snapshots ?? 0, 0);
  });
}

test('Prepare authorizes on the grant and authorizationBinding, not on the request actorRef', async () => {
  const count = counters();
  const { port } = await adapterFor({ world: chain.enginePrivate, online: ['alice'],
    principal: 'alice', count, extra: snapshotEngine(count) });
  const bound = { ...prepareRequest, requestId: 'binding-actor-mismatch',
    authorizationBinding: { ...prepareRequest.authorizationBinding, actorRef: 'mallory' } };
  const response = await port.call('PrepareRecoverableTransaction', bound);
  assert.equal(response.error?.phase, 'authorize');
  assert.equal(count.journalPrepares, 0);
});

test('QR-ADV4-05: a corrupt saved before image fails closed and logs its cause', async () => {
  const count = counters();
  const c = chain.validCases[0];
  const logs = [];
  const dir = await mkdtemp(join(tmpdir(), 'hw-v4-corrupt-'));
  const journal = await DurableJournal.open(dir);
  const backendFor = j => new V4TransactionBackend({ journal: j, stateProfile: profile,
    engine: { ...luaEngine(chain.enginePrivate, c.onlinePlayers), ...snapshotEngine(count) },
    revisionOracle: { read: async () => 'fixture-world-10', readObjects: async () => ({}) },
    verifyBinding: async r => ({ current: true, worldRef: r.worldRef, sessionRef: r.sessionRef,
      authorizationRef: r.authorizationRef, actorRef: 'fixture-actor', authorRef: 'fixture-actor',
      engineActorName: 'alice', allowedActions: ['APPLY_RECOVERABLE'] }),
    capacity: { check: async () => ({ allowed: true }) },
    log: (level, message) => logs.push({ level, message }) });
  await backendFor(journal).prepare(prepareRequest);
  // Tamper with the saved digest on disk, then reopen as after a restart.
  const { readdir, readFile, writeFile } = await import('node:fs/promises');
  const file = join(dir, (await readdir(dir)).find(n => n.endsWith('.json')));
  const record = JSON.parse(await readFile(file, 'utf8'));
  record.beforeStateReadbackDigest = '0'.repeat(64);
  await writeFile(file, JSON.stringify(record));
  const reopened = backendFor(await DurableJournal.open(dir));
  await assert.rejects(() => reopened.queryPrepared({ ...prepareRequest,
    authorizationBindingDigest: digestValue('authorization-binding', prepareRequest.authorizationBinding).sha256 }),
  /CAPABILITY_UNAVAILABLE/);
  assert.ok(logs.some(l => l.level === 'error' && l.message.includes('fixture-tx-first-1') &&
    l.message.includes('does not match')), JSON.stringify(logs));
});
