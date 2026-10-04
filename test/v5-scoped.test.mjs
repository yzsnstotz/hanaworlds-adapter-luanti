import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canonicalJSON, checkScopedWorldHandshake, contractHandshake, digestValue,
  projectScopedPreparedTransaction, validateRequest } from '#contracts/v4';
import { validateResponse } from '#contracts/v4';
import { DurableJournal } from '../src/journal.mjs';
import { V5TransactionBackend } from '../src/v5-transactions.mjs';
import { WorldAdapterV5 } from '../src/v4-port.mjs';

const hash = (kind, value) => digestValue(kind, value).sha256;
const profile = { profileVersion: 'state-profile/v2',
  nodeFields: ['nodeName', 'param1', 'param2'], metadataMode: 'exact',
  inventoryMode: 'exact', timerMode: 'exact', derivedLightMode: 'recompute-with-readback' };
const cell = (position, nodeName = 'air') => ({ position, nodeName, param1: 0,
  param2: 0, metadata: {}, inventory: {}, timer: null });
const stateDigest = record => createHash('sha256')
  .update('HanaWorlds|adapter-scoped-cell/v1\n')
  .update(canonicalJSON({ profile, record })).digest('hex');
const positions = [[0, 0, 0], [1, 0, 0]];
const operations = { contractVersion: 'operations/v2', buildDigest: 'a'.repeat(64),
  compilerRevision: 'compiler', compilationConfigDigest: 'b'.repeat(64),
  worldRef: 'world', frameDigest: 'c'.repeat(64), catalogueDigest: 'd'.repeat(64),
  targetFactsDigest: 'e'.repeat(64),
  effects: [{ position: positions[0], nodeName: 'test:stone', param2: 0 }] };
const operationDigest = hash('operations', operations);
const authorizationBinding = { contractVersion: 'world-adapter/v2',
  authorizerRef: 'owner', actorRef: 'actor', grantEpoch: 'epoch', bindingRef: 'binding',
  worldRef: 'world', sessionRef: 'session', turnRevision: 'turn',
  intentDigest: 'f'.repeat(64), surfaceActionDigest: '2'.repeat(64),
  allowedAction: 'APPLY_RECOVERABLE', transactionId: 'tx', operationDigest,
  worldRevision: 'world-rev', selectionRevision: 'selection', analysisDigest: null,
  decisionRevision: null };
const object = { objectRef: 'object', worldRef: 'world', footprintRevision: 'r1',
  provenance: 'CANVAS_REGISTERED', positions: [positions[1]] };
const scope = { transactionId: 'tx', worldRef: 'world', operationDigest,
  authorizationBindingDigest: hash('authorization-binding', authorizationBinding),
  stateProfile: profile, checkedPositions: [positions[0]], objects: [object],
  cells: positions.map(position => ({ position, availability: 'KNOWN',
    stateDigest: stateDigest(cell(position)) })) };
const common = { contractVersion: 'world-adapter/v5', actorRef: 'canvas-service',
  sessionRef: 'session', authorizationRef: 'grant', worldRef: 'world',
  transactionId: 'tx', operationDigest, operations, authorizationBinding,
  scope, scopeDigest: hash('scoped-world', scope), guarantee: 'RECOVERABLE_VERIFIED' };

async function rig() {
  const journal = await DurableJournal.open(await mkdtemp(join(tmpdir(), 'hw-v5-')));
  const cells = new Map(positions.map(position => [position.join(','), cell(position)]));
  cells.set('9,0,0', cell([9, 0, 0]));
  let grantRef = 'grant-1', active = true, footprint = [object], writes = 0;
  const engine = {
    prepareCheck: async () => true,
    snapshot: async ({ coveredPositions }) => ({ worldRef: 'world', coveredPositions,
      records: coveredPositions.map(position => structuredClone(cells.get(position.join(',')))) }),
    readback: async ({ coveredPositions }) => ({ worldRef: 'world', coveredPositions,
      records: coveredPositions.map(position => structuredClone(cells.get(position.join(',')))) }),
    apply: async (request, prepared) => {
      // The game endpoint verifies the whole scope just before writing.
      assert.deepEqual(request.scopeBeforeImage.coveredPositions, positions);
      assert.deepEqual(prepared.beforeImage.coveredPositions, [positions[0]]);
      cells.set('0,0,0', cell(positions[0], 'test:stone')); writes++;
      return { status: 'APPLIED_PENDING_READBACK' };
    },
    restore: async (_, before) => {
      for (const record of before.records) cells.set(record.position.join(','), record);
      writes++; return { status: 'ROLLED_BACK' };
    },
  };
  const backend = new V5TransactionBackend({ journal, engine,
    revisionOracle: { read: async () => 'current-world-rev' }, stateProfile: profile,
    verifyBinding: async request => ({ current: active, worldRef: 'world',
      sessionRef: request.sessionRef, authorizationRef: request.authorizationRef,
      actorRef: 'actor', authorRef: 'author', nativeGrantRef: grantRef,
      allowedActions: ['APPLY_RECOVERABLE'] }),
    verifyService: async () => true,
    capacity: { check: async () => ({ allowed: true }) },
    registry: { readFootprints: async () => ({ current: true, durable: true,
      worldRef: 'world', objects: footprint }) },
  });
  return { backend, journal, engine, cells, get writes() { return writes; },
    revoke: () => { active = false; },
    regrant: () => { grantRef = 'grant-2'; active = true; },
    changeFootprint: () => { footprint = [{ ...object, footprintRevision: 'r2' }]; } };
}

test('v5 paired scope writes after outside edit, persists full image and returns VERIFIED only after readback', async () => {
  checkScopedWorldHandshake(contractHandshake);
  const r = await rig();
  const request = validateRequest('world-adapter/v5', 'PrepareRecoverableTransaction',
    { ...common, requestId: 'prepare' });
  const saved = await r.backend.prepare(request);
  assert.deepEqual(r.journal.query('tx').beforeImage.coveredPositions, positions);
  assert.equal((await r.backend.queryPrepared({ contractVersion: 'world-adapter/v5',
    actorRef: 'canvas-service', sessionRef: 'session', requestId: 'query',
    authorizationRef: 'grant', worldRef: 'world', transactionId: 'tx',
    operationDigest, authorizationBindingDigest: scope.authorizationBindingDigest,
    scopeDigest: common.scopeDigest })).transactionPayloadDigest,
  saved.transactionPayloadDigest);
  r.cells.set('9,0,0', cell([9, 0, 0], 'outside:edit'));
  const applied = await r.backend.apply({ ...common, requestId: 'apply',
    preparedTransaction: projectScopedPreparedTransaction(saved) });
  assert.equal(applied.status, 'VERIFIED');
  validateResponse('world-adapter/v5', 'ApplyCompiledTransaction', {
    contractVersion: 'world-adapter/v5', requestId: 'apply', result: applied, error: null });
  assert.equal(r.writes, 1);
  assert.equal(r.journal.query('tx').status, 'VERIFIED_PENDING_HISTORY');
});

test('v5 failed engine write restores through the trusted barrier and never says VERIFIED', async () => {
  const r = await rig();
  const saved = await r.backend.prepare({ ...common, requestId: 'prepare' });
  r.engine.apply = async () => {
    r.cells.set('0,0,0', cell(positions[0], 'test:stone'));
    throw new Error('APPLY_FAILED');
  };
  const result = await r.backend.apply({ ...common, requestId: 'apply',
    preparedTransaction: projectScopedPreparedTransaction(saved) });
  assert.equal(result.status, 'ROLLED_BACK');
  assert.equal(r.cells.get('0,0,0').nodeName, 'air');
  assert.equal(r.journal.query('tx').status, 'ROLLED_BACK');
  validateResponse('world-adapter/v5', 'ApplyCompiledTransaction', {
    contractVersion: 'world-adapter/v5', requestId: 'apply', result, error: null });
});

test('v5 unknown or unloaded cells and caller supplied footprints reject at admission', () => {
  for (const availability of ['UNKNOWN', 'UNLOADED']) {
    assert.throws(() => validateRequest('world-adapter/v5',
      'PrepareRecoverableTransaction', { ...common, requestId: 'invalid',
        scope: { ...scope, cells: [{ ...scope.cells[0], availability }, scope.cells[1]] } }),
    /TARGET_FACTS_INCOMPLETE/);
  }
  assert.throws(() => validateRequest('world-adapter/v5',
    'PrepareRecoverableTransaction', { ...common, requestId: 'invalid',
      scope: { ...scope, objects: [{ ...object, provenance: 'CALLER_SUPPLIED' }] } }),
  /TARGET_FACTS_INCOMPLETE/);
});

test('v5 rejects changed scoped cell or registry before write', async () => {
  for (const change of ['cell', 'registry']) {
    const r = await rig();
    const saved = await r.backend.prepare({ ...common, requestId: 'prepare' });
    if (change === 'cell') r.cells.set('1,0,0', cell(positions[1], 'foreign:edit'));
    else r.changeFootprint();
    await assert.rejects(() => r.backend.apply({ ...common, requestId: 'apply',
      preparedTransaction: projectScopedPreparedTransaction(saved) }), /STALE_REVISION/);
    assert.equal(r.writes, 0);
    assert.equal(r.journal.query('tx').status, 'PREPARED');
  }
});

test('v5 revoked and regranted native ref cannot replay prepared write', async () => {
  const r = await rig();
  const saved = await r.backend.prepare({ ...common, requestId: 'prepare' });
  r.revoke();
  await assert.rejects(() => r.backend.apply({ ...common, requestId: 'apply',
    preparedTransaction: projectScopedPreparedTransaction(saved) }), /AUTHORIZATION_REVOKED/);
  r.regrant();
  await assert.rejects(() => r.backend.apply({ ...common, requestId: 'apply',
    preparedTransaction: projectScopedPreparedTransaction(saved) }), /AUTHORIZATION_REVOKED/);
  assert.equal(r.writes, 0);
});

test('v5 public provider admits only Canvas and a current grant', async () => {
  const r = await rig();
  let owner = 'hanaworlds-canvas';
  const port = new WorldAdapterV5({ authority: { verify: async request => ({
    current: true, sessionRef: request.sessionRef,
    authorizationRef: request.authorizationRef, worldRef: request.worldRef,
    domainOwner: owner }) }, operations: {
    PrepareRecoverableTransaction: request => r.backend.prepare(request) } });
  const request = { ...common, requestId: 'prepare' };
  owner = 'other';
  assert.equal((await port.call('PrepareRecoverableTransaction', request)).error.code,
    'PERMISSION_DENIED');
  owner = 'hanaworlds-canvas';
  const response = await port.call('PrepareRecoverableTransaction', request);
  assert.equal(response.error, null, JSON.stringify(response.error));
});
