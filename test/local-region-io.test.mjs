// SOURCE/FIXTURE: world-adapter-region/v2 host logic against an in-memory engine
// double. Engine semantics (VoxelManip/emerge/light/metadata) are exercised only
// by test/real-region-io.mjs against real Luanti.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readRegion, writeRegion, protocolHandshake, RegionFault } from '../src/region-io.mjs';
import { batches, blocksPerBatch } from '../src/region-batches.mjs';
import { validateRegionRead, validateRegionWrite, requireKnownRegion, expectedRegionState, encodeRegionBlock,
  checkProtocolCompatibility, protocolRequirement, validateRequest, digestValue } from '#contracts';

const W = 'world-adapter-region/v2', world = 'luanti:fixture';
const localContext = { connectionRef: 'c', connectionIncarnationRef: 'i', worldRef: world, selectionRevision: 's' };
const key = p => p.join(',');
const blk = (x, y, z) => [x, y, z].map(v => Math.floor(v / 16)).join(',');

function engine({ unknown = new Set(), failWriteAt = null, guardRefuse = null } = {}) {
  const cells = new Map(), meta = new Map(), log = [];
  const get = (x, y, z) => cells.get(`${x},${y},${z}`) ?? (y < 0 ? ['base:stone', 0] : ['air', 0]);
  const guardOf = b => {
    const t = [];
    for (let z = b.min[2]; z <= b.max[2]; z++) for (let y = b.min[1]; y <= b.max[1]; y++) for (let x = b.min[0]; x <= b.max[0]; x++)
      t.push(get(x, y, z), meta.get(`${x},${y},${z}`) ?? null);
    return JSON.stringify(t);
  };
  let writes = 0;
  return { cells, meta, log, get writes() { return writes; },
    async regionLimits() { return { mapblockSize: 16, maxBodyBytes: 265000, registeredNodes: 4, longestNodeName: 10, mapgenLimit: 31000 }; },
    async regionEmerge(min, max) {
      log.push('emerge'); const blocks = [];
      for (let z = Math.floor(min[2] / 16); z <= Math.floor(max[2] / 16); z++)
        for (let y = Math.floor(min[1] / 16); y <= Math.floor(max[1] / 16); y++)
          for (let x = Math.floor(min[0] / 16); x <= Math.floor(max[0] / 16); x++)
            blocks.push({ blockPos: [x, y, z], action: unknown.has(`${x},${y},${z}`) ? 'CANCELLED' : 'FROM_MEMORY' });
      return { blocks };
    },
    async regionRead({ min, max, boxes }) {
      log.push('read'); const palette = [], index = new Map(), content = [], p2 = [];
      for (let z = min[2]; z <= max[2]; z++) for (let y = min[1]; y <= max[1]; y++) for (let x = min[0]; x <= max[0]; x++) {
        const [n, v] = unknown.has(blk(x, y, z)) ? ['ignore', 0] : get(x, y, z);
        if (!index.has(n)) { index.set(n, palette.length); palette.push(n); }
        const k = index.get(n);
        if (content.at(-2) === k) content[content.length - 1]++; else content.push(k, 1);
        if (p2.at(-2) === v) p2[p2.length - 1]++; else p2.push(v, 1);
      }
      const extras = [...meta.entries()].map(([k, fields]) => ({ position: k.split(',').map(Number), fields, inventory: {} }))
        .filter(e => e.position.every((v, a) => v >= min[a] && v <= max[a]));
      return { min, max, palette, contentRuns: content, param2Runs: p2, extras,
        boxes: boxes.map(b => ({ ...b, guard: guardOf(b), ignoreCells: unknown.has(blk(...b.min)) ? 1 : 0 })) };
    },
    async regionWrite(batch) {
      log.push(batch.checkOnly ? 'check' : 'write');
      for (const c of batch.chunks) if (guardOf(c) !== c.guard) throw new Error('TRANSACTION_CONFLICT');
      // Engine guard double: the payload refuses in the check-only pass with a detail.
      if (batch.checkOnly && guardRefuse?.purpose === batch.purpose)
        throw Object.assign(new Error('SAFETY_INVARIANT_FAILED'), { detail: guardRefuse.detail });
      if (batch.checkOnly) return { written: false, checked: true };
      if (failWriteAt !== null && writes === failWriteAt) { failWriteAt = null; throw new Error('TRANSACTION_CONFLICT'); }
      writes++;
      for (const c of batch.chunks) {
        const t = [], p = [];
        for (let r = 0; r < c.contentRuns.length; r += 2) for (let n = 0; n < c.contentRuns[r + 1]; n++) t.push(c.contentRuns[r]);
        for (let r = 0; r < c.param2Runs.length; r += 2) for (let n = 0; n < c.param2Runs[r + 1]; n++) p.push(c.param2Runs[r]);
        let j = 0;
        for (let z = c.min[2]; z <= c.max[2]; z++) for (let y = c.min[1]; y <= c.max[1]; y++) for (let x = c.min[0]; x <= c.max[0]; x++, j++) {
          if (t[j] === -1) continue;
          cells.set(`${x},${y},${z}`, [c.palette[t[j]], p[j]]); meta.delete(`${x},${y},${z}`);
        }
        for (const e of c.extras ?? []) meta.set(key(e.position), e.metadata);
      }
      return { written: true, changedCells: 1, lightComplete: true, lightBox: { min: batch.min, max: batch.max } };
    } };
}

const box = { min: [-3, -2, -1], max: [36, 2, 2] }; // 4 x 2 x 2 mapblocks
const readReq = (requestId = 'r') => validateRequest(W, 'ReadRegion', { contractVersion: W, sessionRef: 's', requestId,
  worldRef: world, box, purpose: 'BEFORE_IMAGE', localContext });
async function read(e, id) {
  const r = readReq(id), out = await readRegion(e, r);
  return validateRegionRead(r, { contractVersion: W, requestId: r.requestId, result: out.result, error: null }).result;
}
function opsFor(chunk, rule) {
  const { min, max } = chunk.box, size = max.map((v, i) => v - min[i] + 1);
  const palette = [{ nodeName: 'base:stone', param2: 0 }, { nodeName: 'air', param2: 0 }];
  const indices = new Int32Array(size[0] * size[1] * size[2]); let i = 0;
  for (let z = min[2]; z <= max[2]; z++) for (let y = min[1]; y <= max[1]; y++) for (let x = min[0]; x <= max[0]; x++) indices[i++] = rule(x, y, z);
  return encodeRegionBlock({ origin: min, size, palette, indices });
}
const fillDig = (x, y) => y === 1 ? 0 : y === -1 ? 1 : -1;
const writeReq = (purpose, writes, id) => validateRequest(W, 'WriteRegion', { contractVersion: W, sessionRef: 's', requestId: id,
  worldRef: world, transactionId: `tx-${id}`, purpose, writes, localContext });
async function write(e, purpose, writes, id = 'w') {
  const r = writeReq(purpose, writes, id), out = await writeRegion(e, r);
  return { ...validateRegionWrite(r, { contractVersion: W, requestId: r.requestId, result: out.result, error: null, guardRefusal: null }), facts: out.facts };
}
const applyWrites = before => before.chunks.map(c => ({ chunkPos: c.chunkPos, expectedCurrentDigest: c.stateDigest,
  ops: opsFor(c, fillDig), state: null }));

test('protocol handshake: same major + capabilities consumed; v3 requirement and v3 wire rejected', () => {
  const caps = ['world-adapter-region/v2:chunked-read', 'world-adapter-region/v2:chunked-write', 'world-adapter-region/v2:lighting-complete',
    'world-adapter-region/v2:load-then-know', 'world-adapter-region/v2:restore-state'];
  assert.equal(checkProtocolCompatibility(protocolHandshake, [protocolRequirement(W, caps)]).result, 'PROTOCOL_COMPATIBLE');
  assert.throws(() => checkProtocolCompatibility(protocolHandshake, [protocolRequirement('world-adapter-region/v3', caps)]), /UNSUPPORTED_VERSION/);
  assert.throws(() => checkProtocolCompatibility(protocolHandshake, [protocolRequirement(W, ['world-adapter-region/v2:teleport'])]), /CAPABILITY_UNAVAILABLE/);
  assert.throws(() => validateRequest('world-adapter-region/v3', 'ReadRegion', { ...readReq(), contractVersion: 'world-adapter-region/v3' }), /UNSUPPORTED_VERSION/);
  assert.ok(blocksPerBatch({ maxBodyBytes: 4 * 1024 * 1024, registeredNodes: 50, longestNodeName: 20 }) >= 30);
  assert.deepEqual(batches([-5, 0, 0], [40, 3, 3], 2).map(b => [b.min, b.max]), [[[-5, 0, 0], [15, 3, 3]], [[16, 0, 0], [40, 3, 3]]]);
});

test('cross-chunk read with extras; APPLY fill + air dig keeps unspecified and clears overwritten extras', async () => {
  const e = engine(); e.meta.set('0,1,0', { owner: 'x' }); e.meta.set('0,0,0', { keep: 'y' });
  const before = await read(e, 'r0');
  assert.equal(before.chunks.length, 16); requireKnownRegion(before);
  const writes = applyWrites(before);
  const out = await write(e, 'APPLY', writes);
  assert.equal(out.allWritten, true); assert.equal(out.committed, false);
  assert.ok(out.facts.batches.length > 1, 'multi-batch');
  const after = await read(e, 'r1');
  before.chunks.forEach((c, i) => {
    const expected = expectedRegionState(c.state, writes[i].ops); // Canvas-side contract expectation
    assert.equal(digestValue('region-state', expected).sha256, after.chunks[i].stateDigest);
    assert.equal(out.response.result.chunks[i].readbackDigest, after.chunks[i].stateDigest);
  });
  assert.equal(e.meta.has('0,1,0'), false); assert.deepEqual(e.meta.get('0,0,0'), { keep: 'y' });
});

test('unknown chunk or stale digest: rejected before any write', async () => {
  const e = engine({ unknown: new Set(['1,0,0']) });
  const r = await read(e, 'u');
  assert.equal(r.chunks.find(c => c.availability === 'UNKNOWN').unknownReason, 'LOAD_FAILED');
  assert.throws(() => requireKnownRegion(r), /TARGET_FACTS_INCOMPLETE/);
  const ok = engine(); const before = await read(ok, 'b');
  await assert.rejects(writeRegion(e, writeReq('APPLY', applyWrites(before), 'x')), /TARGET_FACTS_INCOMPLETE/);
  assert.equal(e.writes, 0);
  ok.cells.set('20,0,0', ['base:dirt', 0]);
  await assert.rejects(writeRegion(ok, writeReq('APPLY', applyWrites(before), 'y')), /TRANSACTION_CONFLICT/);
  assert.equal(ok.writes, 0); assert.equal(ok.log.includes('write'), false);
});

test('later batch failure: per-chunk WRITTEN/NOT_WRITTEN, never committed; RESTORE returns the before states', async () => {
  const e = engine({ failWriteAt: 1 }); e.meta.set('0,1,0', { owner: 'x' });
  const before = await read(e, 'p0');
  const out = await write(e, 'APPLY', applyWrites(before), 'p');
  assert.equal(out.allWritten, false); assert.equal(out.committed, false);
  const statuses = new Set(out.response.result.chunks.map(c => c.status));
  assert.ok(statuses.has('WRITTEN') && statuses.has('NOT_WRITTEN'));
  const now = await read(e, 'p1');
  const restore = await write(e, 'RESTORE', before.chunks.map((c, i) => ({ chunkPos: c.chunkPos,
    expectedCurrentDigest: now.chunks[i].stateDigest, ops: null, state: c.state })), 'rs');
  assert.equal(restore.allWritten, true);
  const back = await read(e, 'p2');
  assert.deepEqual(back.chunks.map(c => c.stateDigest), before.chunks.map(c => c.stateDigest));
  assert.equal(JSON.stringify(e.meta.get('0,1,0')), JSON.stringify({ owner: 'x' })); // contract objects are frozen/null-prototype
});

test('guard refusals on WriteRegion: REGION_APPLY and REGION_RESTORE answer with GuardRefusal and the engine form, nothing written', async () => {
  for (const [purpose, detail, guard, reason] of [['RESTORE', 'BODY_OCCUPIED', 'BODY_CLEARANCE', 'INVALID_GEOMETRY'],
    ['RESTORE', 'PROTECTED_CELL', 'CELL_PROTECTION', 'SCOPE_DENIED'], ['APPLY', 'PROTECTED_CELL', 'CELL_PROTECTION', 'SCOPE_DENIED']]) {
    const e = engine({ guardRefuse: { purpose, detail } });
    const before = await read(e, 'g0');
    const writes = purpose === 'APPLY' ? applyWrites(before) : before.chunks.map(c => ({ chunkPos: c.chunkPos,
      expectedCurrentDigest: c.stateDigest, ops: null, state: c.state }));
    const r = writeReq(purpose, writes, `g-${purpose}-${detail}`);
    const fault = await writeRegion(e, r).then(() => null, x => x);
    assert.ok(fault instanceof RegionFault && fault.refusal, `${purpose} ${detail}`);
    const stage = purpose === 'APPLY' ? 'REGION_APPLY' : 'REGION_RESTORE';
    assert.equal(JSON.stringify(fault.refusal.guardRefusal), JSON.stringify({ guard, stage, finding: detail }));
    // rc.3 engine form at REGION_RESTORE: phase restore, no cause known to the stateless writer, nothing written.
    const err = fault.refusal.error;
    assert.equal(err.code, 'SAFETY_INVARIANT_FAILED'); assert.equal(err.reason, reason); assert.equal(err.mutationState, 'NONE');
    assert.equal(err.phase, purpose === 'APPLY' ? 'apply' : 'restore'); assert.equal(err.causeCode, null);
    validateRegionWrite(r, { contractVersion: W, requestId: r.requestId, result: null, ...fault.refusal });
    assert.equal(e.writes, 0);
  }
  // Not a declared region guard: enclosure is never claimed for region writes.
  const e = engine({ guardRefuse: { purpose: 'APPLY', detail: 'PLAYER_ENCLOSED' } });
  const before = await read(e, 'g1');
  const fault = await writeRegion(e, writeReq('APPLY', applyWrites(before), 'g-enc')).then(() => null, x => x);
  assert.equal(fault.refusal, null);
});
