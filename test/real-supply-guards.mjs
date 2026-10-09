// REAL_RUNTIME gate for hanaworlds-adapter-luanti-SUPPLY-01: Stage 1 facts and their lifecycle,
// and the engine guards G1 (restore body recheck), G2 (per-cell protection), G3 (no enclosure),
// on own source + official SDK Cordis + real Luanti 5.17 + VoxeLibre 0.92.3 + WorldEdit, with a
// real connected Luanti client player "alice". Layers are named in dev/stage1-supply/real-world.mjs.
// usage: HW_REAL_E=<fresh own evidence dir> HW_GAME=<VoxeLibre dir> HW_WORLDEDIT=<worldedit mod dir> node test/real-supply-guards.mjs
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { openRealWorld } from '../dev/stage1-supply/real-world.mjs';

const E = process.env.HW_REAL_E;
assert.ok(E && process.env.HW_GAME && process.env.HW_WORLDEDIT, 'HW_REAL_E, HW_GAME, HW_WORLDEDIT required');
const w = await openRealWorld({ runRoot: E, game: process.env.HW_GAME, worldedit: process.env.HW_WORLDEDIT, log: m => console.log('LOG', m) });
const C = w.C, D = (k, v) => C.digestValue(k, v).sha256;
const results = { layers: { real: 'Luanti 5.17 + VoxeLibre 0.92.3 + WorldEdit 62ffafe3 + Adapter own source in official SDK Cordis; real client player alice',
  fixture: 'NativeEngineControl host, Canvas ReadWorldSelectionContext caller, hw_probe test-environment mod (reads, player placement, external edit, test protection area)' }, steps: [] };
const step = (name, detail) => { results.steps.push({ name, ...detail }); console.log('PASS', name); };
const W7 = 'world-adapter/v7', WR = 'world-adapter-region/v2';
let seq = 0;
const base = () => ({ contractVersion: W7, sessionRef: 'real-session', worldRef: w.worldRef, localContext: w.localContext });
const call = async (name, input) => w.v7().call(name, { ...base(), requestId: `${name}-${++seq}`, ...input });
const ok = async (name, input) => { const r = await call(name, input); assert.equal(r.error, null, `${name} ${JSON.stringify(r.error)} ${JSON.stringify(r.guardRefusal)}`); return r.result; };
const rcall = async (name, input) => w.region().call(name, { contractVersion: WR, sessionRef: 'real-session', requestId: `${name}-${++seq}`, worldRef: w.worldRef, localContext: w.localContext, ...input });
const readR = async (box, purpose = 'BEFORE_IMAGE') => { const q = { box, purpose }; const r = await rcall('ReadRegion', q); assert.equal(r.error, null, JSON.stringify(r.error)); C.requireKnownRegion(r.result); return r.result; };
function nodeAt(read, [x, y, z]) {
  for (const c of read.chunks) {
    const { min, max } = c.box;
    if (x < min[0] || x > max[0] || y < min[1] || y > max[1] || z < min[2] || z > max[2]) continue;
    const b = C.expandRegionBlock(c.state.block), [sx, sy] = b.size, o = c.state.block.origin;
    return b.palette[b.indices[(x - o[0]) + (y - o[1]) * sx + (z - o[2]) * sx * sy]].nodeName;
  }
  throw Error(`no chunk covers ${x},${y},${z}`);
}
const noGeometry = v => { const s = JSON.stringify(v); for (const k of ['bodyOccupied', 'collisionbox', 'collisionBox"', 'yaw', '"pose"', 'avatarDimensions']) assert.ok(!s.includes(k), `no ${k} leaves the Adapter`); };

try {
  // 1. Facts on the real World, then lifecycle: retire on stop, new domain on reconnect.
  const first = await w.connect();
  const cfg1 = await w.facts.readConfigEngineFacts(w.worldRef), we1 = await w.facts.readWorldEditFacts(w.worldRef);
  C.validateType('ConfigEngineFacts', cfg1);
  assert.equal(cfg1.avatarEnvelope.availability, 'UNAVAILABLE'); assert.equal(cfg1.writeBackend.availability, 'KNOWN');
  assert.equal(we1.loadState, 'LOADED'); assert.equal(we1.version.status, 'KNOWN');
  const connR = await w.v7().call('ReadLocalConnection', { contractVersion: W7, sessionRef: 'real-session', requestId: 'connection-1', connectionRef: first.connectionRef });
  assert.equal(connR.error, null, JSON.stringify(connR.error)); const conn1 = connR.result;
  assert.equal(JSON.stringify(conn1.capabilities.engineGuards.coverage.map(c => c.guard)), JSON.stringify(['BODY_CLEARANCE', 'CELL_PROTECTION', 'PLAYER_ENCLOSURE']));
  noGeometry([cfg1, we1, conn1]);
  step('REAL_FACTS', { connection: first.connectionIncarnationRef, game: w.created.game, mapgen: w.created.mapgen.mg_name,
    config: { avatar: cfg1.avatarEnvelope, writeBackend: cfg1.writeBackend, sourceRevision: cfg1.sourceRevision, catalogueDigest: cfg1.catalogueDigest },
    worldedit: { loadState: we1.loadState, version: we1.version, revision: we1.revision }, engineGuards: conn1.capabilities.engineGuards });
  await w.disconnect();
  const retired = await w.facts.readConfigEngineFacts(w.worldRef).then(() => null, e => e.message);
  assert.ok(retired, 'no facts while the World is stopped');
  let ledger; try { ledger = await w.facts.readStage1FactLedger(w.worldRef); } catch (e) { ledger = { error: e.message }; }
  const second = await w.connect();
  assert.notEqual(second.connectionIncarnationRef, first.connectionIncarnationRef);
  const cfg2 = await w.facts.readConfigEngineFacts(w.worldRef);
  assert.equal(cfg2.connection.connectionIncarnationRef, second.connectionIncarnationRef);
  step('REAL_FACTS_LIFECYCLE', { stoppedRead: retired, ledgerAfterStop: ledger, newIncarnation: second.connectionIncarnationRef,
    sameCatalogue: cfg2.catalogueDigest === cfg1.catalogueDigest, newSourceRevision: cfg2.sourceRevision });

  // 2. Real connected player (Luanti client) on the flat surface (grass top at y=8).
  await w.startClient();
  assert.equal((await w.probe({ place: [0, 8.5, 0] })).placed, true);
  const box = { min: [-16, 0, -16], max: [15, 15, 15] };
  const r0 = await readR(box);
  assert.equal(nodeAt(r0, [0, 8, 0]), 'mcl_core:dirt_with_grass'); assert.equal(nodeAt(r0, [0, 9, 0]), 'air');
  const catalogue = await w.facts.readCatalogue(w.worldRef);
  const insp = await ok('InspectRegion', { inspectionId: 'inspect-1', expectedWorldRevision: 'fixture-canvas-world-head-1',
    anchor: { kind: 'CURRENT_VIEW', invocationId: 'inv-1' }, footprint: { widthCells: 1, depthCells: 1, heightCells: 1 },
    placementSettings: { frontGapCells: 2, forwardSearchCells: 4, lateralSearchCells: 2, verticalSearchCells: 2, settingsRevision: 'real-settings-1' } });
  noGeometry(insp);
  step('REAL_INSPECTION_NO_BODY', { outcome: insp.outcome, keys: insp.inspection ? Object.keys(insp.inspection) : null });
  const facts = insp.inspection.targetFacts;
  const ops = (positions, nodeName) => ({ contractVersion: 'operations/v3', buildDigest: '1'.repeat(64), compilerRevision: 'real-gate', compilationConfigDigest: '2'.repeat(64),
    worldRef: w.worldRef, frameDigest: facts.frameDigest, catalogueDigest: facts.catalogueDigest, targetFactsDigest: insp.inspection.targetFactsDigest,
    effects: positions.map(p => ({ position: p.position ?? p, nodeName: p.nodeName ?? nodeName, param2: 0 })) });
  const prepareReq = async (id, effects) => {
    const positions = effects.map(e => e.position).sort(C.comparePosition);
    const actual = await w.facts.readScopedState(w.paired.connectionRef, positions);
    const operations = ops(effects.slice().sort((a, b) => C.comparePosition(a.position, b.position)));
    const operationDigest = D('operations', operations);
    const scope = { transactionId: id, worldRef: w.worldRef, operationDigest, stateProfile: actual.stateProfile, checkedPositions: positions, objects: [], cells: actual.cells, localContext: w.localContext };
    return { transactionId: id, operationDigest, operations, scope, scopeDigest: D('scoped-world', scope), guarantee: 'RECOVERABLE_VERIFIED' };
  };
  const cell = (p, n = 'mcl_core:stone') => ({ position: p, nodeName: n });
  C.validateStaticMaterials({ s: { nodeName: 'mcl_core:stone', param2: 0 }, a: { nodeName: 'air', param2: 0 } }, catalogue);

  // 3. Body clearance at Prepare: a solid write into the real player's body cell.
  const body = await call('PrepareRecoverableTransaction', await prepareReq('body-1', [cell([0, 9, 0])]));
  assert.equal(JSON.stringify(body.guardRefusal), JSON.stringify({ guard: 'BODY_CLEARANCE', stage: 'PREPARE_RECOVERABLE', finding: 'BODY_OCCUPIED' }));
  assert.deepEqual(body.error, C.guardRefusalError(body.guardRefusal, { transactionRef: 'body-1' }));
  step('REAL_BODY_CLEARANCE_PREPARE', { error: body.error, guardRefusal: body.guardRefusal });

  // 4. G3: a 3-high ring around the player is refused; with one gap it is admitted (then aborted).
  const ring = gap => { const out = []; for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) {
    if ((x === 0 && z === 0) || (gap && x === 1 && z === 0)) continue; for (let y = 9; y <= 11; y++) out.push(cell([x, y, z])); } return out; };
  const sealed = await call('PrepareRecoverableTransaction', await prepareReq('ring-sealed', ring(false)));
  assert.equal(JSON.stringify(sealed.guardRefusal), JSON.stringify({ guard: 'PLAYER_ENCLOSURE', stage: 'PREPARE_RECOVERABLE', finding: 'PLAYER_ENCLOSED' }));
  assert.deepEqual(sealed.error, C.guardRefusalError(sealed.guardRefusal, { transactionRef: 'ring-sealed' }));
  const gapReq = await prepareReq('ring-gap', ring(true));
  const gapPrepared = await ok('PrepareRecoverableTransaction', gapReq);
  const aborted = await ok('AbortPreparedTransaction', { transactionId: 'ring-gap', operationDigest: gapReq.operationDigest });
  step('REAL_G3_NO_ENCLOSURE', { sealed: { error: sealed.error, guardRefusal: sealed.guardRefusal }, gap: { prepared: !!gapPrepared.transactionPayloadDigest, aborted: aborted.status } });

  // 5. G2: a test protection area (chained into core.is_protected like a protection mod).
  await w.probe({ protect: [[[5, 9, 5], [6, 10, 6]]] });
  const prot = await call('PrepareRecoverableTransaction', await prepareReq('prot-1', [cell([5, 9, 5])]));
  assert.equal(JSON.stringify(prot.guardRefusal), JSON.stringify({ guard: 'CELL_PROTECTION', stage: 'PREPARE_RECOVERABLE', finding: 'PROTECTED_CELL' }));
  const rProt = await readR({ min: [5, 9, 5], max: [5, 9, 5] });
  const pc = rProt.chunks[0], psize = pc.box.max.map((v, i) => v - pc.box.min[i] + 1), pIdx = new Int32Array(psize[0] * psize[1] * psize[2]).fill(-1);
  pIdx[(5 - pc.box.min[0]) + (9 - pc.box.min[1]) * psize[0] + (5 - pc.box.min[2]) * psize[0] * psize[1]] = 0;
  const pOps = C.validateRegionPalette(C.encodeRegionBlock({ origin: pc.box.min, size: psize, palette: [{ nodeName: 'mcl_core:stone', param2: 0 }], indices: pIdx }), catalogue);
  const wProt = await rcall('WriteRegion', { transactionId: 'region-prot', purpose: 'APPLY', writes: [{ chunkPos: pc.chunkPos, expectedCurrentDigest: pc.stateDigest, ops: pOps, state: null }] });
  assert.equal(JSON.stringify(wProt.guardRefusal), JSON.stringify({ guard: 'CELL_PROTECTION', stage: 'REGION_APPLY', finding: 'PROTECTED_CELL' }));
  assert.equal(wProt.error.mutationState, 'NONE');
  assert.equal((await readR({ min: [5, 9, 5], max: [5, 9, 5] })).chunks[0].stateDigest, pc.stateDigest, 'zero writes');
  await w.probe({ protect: [] });
  step('REAL_G2_CELL_PROTECTION', { prepare: { error: prot.error, guardRefusal: prot.guardRefusal }, region: { error: wProt.error, guardRefusal: wProt.guardRefusal },
    principal: conn1.capabilities.engineGuards.coverage[1].protectionPrincipal });

  // 6. G1: per-cell rollback whose restore would put stone into the real player's body.
  const T = [3, 9, 3];
  const aReq = await prepareReq('stone-T', [cell(T)]);
  const aPrep = await ok('PrepareRecoverableTransaction', aReq);
  assert.equal((await ok('ApplyCompiledTransaction', { ...aReq, preparedTransaction: C.projectScopedPreparedTransaction(aPrep) })).status, 'VERIFIED');
  const bReq = await prepareReq('dig-T', [cell(T, 'air')]);
  const bPrep = await ok('PrepareRecoverableTransaction', bReq);
  await w.probe({ arm: { at: T, node: 'mcl_core:dirt', player: [3, 8.5, 3] } }); // external edit + player moves in after the write
  const bApply = await call('ApplyCompiledTransaction', { ...bReq, preparedTransaction: C.projectScopedPreparedTransaction(bPrep) });
  assert.equal(JSON.stringify(bApply.guardRefusal), JSON.stringify({ guard: 'BODY_CLEARANCE', stage: 'RESTORE', finding: 'BODY_OCCUPIED' }), JSON.stringify(bApply));
  assert.equal(bApply.error.code, 'RESTORE_FAILED'); assert.equal(bApply.error.retryability, 'AFTER_MANUAL_RECOVERY');
  const q = await ok('QueryTransaction', { transactionId: 'dig-T', transactionPayloadDigest: bPrep.transactionPayloadDigest });
  assert.equal(q.status, 'RESTORE_FAILED'); assert.equal(q.restoreStatus, 'FAILED'); assert.equal(q.error.causeCode, q.applyFailure.error.code);
  const stillDirt = nodeAt(await readR({ min: T, max: T }, 'READBACK'), T);
  assert.equal(stillDirt, 'mcl_core:dirt', 'nothing written into the body');
  assert.equal((await w.probe({ place: [0, 8.5, -6] })).placed, true);
  const restored = await ok('RestoreTransaction', { originTransactionId: 'dig-T', operationDigest: bReq.operationDigest, beforeImageDigest: bPrep.beforeImageDigest,
    restoreAttemptIdentity: 'restore-after-player-left', guarantee: 'RECOVERABLE_VERIFIED' });
  assert.equal(restored.status, 'ROLLED_BACK'); assert.equal(nodeAt(await readR({ min: T, max: T }, 'READBACK'), T), 'mcl_core:stone');
  step('REAL_G1_RESTORE_BODY_RECHECK', { applyResponse: { error: bApply.error, guardRefusal: bApply.guardRefusal },
    receipt: { status: q.status, restoreStatus: q.restoreStatus, error: q.error, guardRefusal: q.guardRefusal, applyFailure: q.applyFailure },
    cellWhileBlocked: stillDirt, afterPlayerLeft: restored.status });

  // 7. REGION_RESTORE: a region rollback that would put stone into the player's body is refused (engine form).
  const R = [-3, 9, -3], rb = { min: R, max: R };
  const rr0 = await readR(rb), c0 = rr0.chunks[0], size = c0.box.max.map((v, i) => v - c0.box.min[i] + 1);
  const at = p => (p[0] - c0.box.min[0]) + (p[1] - c0.box.min[1]) * size[0] + (p[2] - c0.box.min[2]) * size[0] * size[1];
  const one = (name) => { const ix = new Int32Array(size[0] * size[1] * size[2]).fill(-1); ix[at(R)] = 0;
    return C.validateRegionPalette(C.encodeRegionBlock({ origin: c0.box.min, size, palette: [{ nodeName: name, param2: 0 }], indices: ix }), catalogue); };
  assert.equal((await rcall('WriteRegion', { transactionId: 'r-stone', purpose: 'APPLY', writes: [{ chunkPos: c0.chunkPos, expectedCurrentDigest: c0.stateDigest, ops: one('mcl_core:stone'), state: null }] })).error, null);
  const before = (await readR(rb)).chunks[0];
  assert.equal((await rcall('WriteRegion', { transactionId: 'r-dig', purpose: 'APPLY', writes: [{ chunkPos: before.chunkPos, expectedCurrentDigest: before.stateDigest, ops: one('air'), state: null }] })).error, null);
  assert.equal((await w.probe({ place: [-3, 8.5, -3] })).placed, true);
  const now = (await readR(rb)).chunks[0];
  const back = await rcall('WriteRegion', { transactionId: 'r-dig', purpose: 'RESTORE', writes: [{ chunkPos: now.chunkPos, expectedCurrentDigest: now.stateDigest, ops: null, state: before.state }] });
  assert.equal(JSON.stringify(back.guardRefusal), JSON.stringify({ guard: 'BODY_CLEARANCE', stage: 'REGION_RESTORE', finding: 'BODY_OCCUPIED' }), JSON.stringify(back));
  assert.equal(back.error.phase, 'restore'); assert.equal(back.error.causeCode, null); assert.equal(back.error.mutationState, 'NONE');
  assert.equal(nodeAt(await readR(rb, 'READBACK'), R), 'air', 'zero writes');
  assert.equal((await w.probe({ place: [0, 8.5, -6] })).placed, true);
  const now2 = (await readR(rb)).chunks[0];
  const back2 = await rcall('WriteRegion', { transactionId: 'r-dig', purpose: 'RESTORE', writes: [{ chunkPos: now2.chunkPos, expectedCurrentDigest: now2.stateDigest, ops: null, state: before.state }] });
  assert.equal(back2.error, null); assert.equal(nodeAt(await readR(rb, 'READBACK'), R), 'mcl_core:stone');
  step('REAL_REGION_RESTORE_BODY', { refused: { error: back.error, guardRefusal: back.guardRefusal }, afterPlayerLeft: 'restored' });
  results.pass = true;
} catch (error) {
  results.pass = false; results.failure = { message: error.message, stack: error.stack };
  throw error;
} finally {
  results.processes = w.processes;
  await w.close();
  await writeFile(join(E, 'results.json'), JSON.stringify(results, null, 2) + '\n');
}
console.log('REAL_RUNTIME supply+guards PASS: own source, official SDK Cordis, real Luanti/VoxeLibre/WorldEdit, real client player; Host/Canvas/hw_probe FIXTURE');
