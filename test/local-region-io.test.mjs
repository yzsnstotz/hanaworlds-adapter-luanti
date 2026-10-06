// SOURCE/FIXTURE: region I/O host logic against an in-memory engine double.
// The Lua side (VoxelManip/emerge/light) is exercised only by test/real-region-io.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readRegion, writeRegion, describeRegionIO } from '../src/region-io.mjs';
import { negotiate, decodeVoxels, encodeVoxels, subBoxes, blockDigest, batches, blocksPerBatch,
  REGION_PROTOCOL } from '../src/region-voxels.mjs';

const P = { name: 'hanaworlds-region-io', version: '1.0.0', requiredCapabilities: ['region-voxels-v1', 'air-dig'] };

function engine({ unknown = new Set(), failWriteAt = null, maxBodyBytes = 265000 } = {}) {
  const cells = new Map(), log = [];
  const get = (x, y, z) => cells.get(`${x},${y},${z}`) ?? (y < 0 ? ['base:stone', 0] : ['air', 0]);
  let writes = 0;
  return { cells, log, get writes() { return writes; },
    async regionLimits() { log.push('limits'); return { mapblockSize: 16, maxBodyBytes, registeredNodes: 3, longestNodeName: 10 }; },
    async regionEmerge(min, max) {
      log.push('emerge');
      return { blocks: subBoxes(min, max).map(b => ({ blockPos: b.block,
        action: unknown.has(b.block.join(',')) ? 'CANCELLED' : 'FROM_MEMORY' })) };
    },
    async regionRead(min, max) {
      log.push('read');
      const palette = [], index = new Map(), content = [], p2 = [];
      for (let z = min[2]; z <= max[2]; z++) for (let y = min[1]; y <= max[1]; y++) for (let x = min[0]; x <= max[0]; x++) {
        const [n, v] = get(x, y, z);
        if (!index.has(n)) { index.set(n, palette.length); palette.push(n); }
        const k = index.get(n);
        if (content.at(-2) === k) content[content.length - 1]++; else content.push(k, 1);
        if (p2.at(-2) === v) p2[p2.length - 1]++; else p2.push(v, 1);
      }
      return { min, max, palette, contentRuns: content, param2Runs: p2, ignoreCells: 0, metadataCells: 0,
        blocks: subBoxes(min, max).map(sb => ({ blockPos: sb.block, min: sb.min, max: sb.max,
          digest: unknown.has(sb.block.join(',')) ? undefined : blockDigest(sb, get),
          ignoreCells: unknown.has(sb.block.join(',')) ? 1 : 0 })) };
    },
    async regionWrite(batch) {
      log.push(batch.checkOnly ? 'check' : 'write');
      for (const [i, sb] of subBoxes(batch.min, batch.max).entries())
        if (blockDigest(sb, get) !== batch.expected[i].digest) throw new Error('TRANSACTION_CONFLICT');
      if (batch.palette.includes('base:chest')) throw new Error('UNSUPPORTED_MUTATION_SEMANTICS');
      if (batch.checkOnly) return { written: false, checked: true };
      if (failWriteAt !== null && writes === failWriteAt) { failWriteAt = null; throw new Error('TRANSACTION_CONFLICT'); }
      writes++;
      const target = [], p2 = [];
      for (let r = 0; r < batch.contentRuns.length; r += 2) for (let c = 0; c < batch.contentRuns[r + 1]; c++) target.push(batch.contentRuns[r]);
      for (let r = 0; r < batch.param2Runs.length; r += 2) for (let c = 0; c < batch.param2Runs[r + 1]; c++) p2.push(batch.param2Runs[r]);
      let j = 0, changed = 0;
      for (let z = batch.min[2]; z <= batch.max[2]; z++) for (let y = batch.min[1]; y <= batch.max[1]; y++) for (let x = batch.min[0]; x <= batch.max[0]; x++, j++) {
        if (target[j] === -1) continue;
        cells.set(`${x},${y},${z}`, [batch.palette[target[j]], p2[j]]); changed++;
      }
      return { written: true, changedCells: changed, readbackMatches: true, unspecifiedKept: true, lightComplete: true,
        lightDigest: 'x', blocks: subBoxes(batch.min, batch.max).map(sb => ({ blockPos: sb.block, min: sb.min, max: sb.max, digest: blockDigest(sb, get) })) };
    } };
}

test('negotiation: same major and required capabilities only; patch/minor never decide', () => {
  assert.equal(negotiate({ ...P, version: '1.7.3' }).compatible, true);
  assert.throws(() => negotiate({ ...P, version: '2.0.0' }), /PROTOCOL_MAJOR_MISMATCH/);
  assert.throws(() => negotiate({ ...P, version: '0.9.0' }), /PROTOCOL_MAJOR_MISMATCH/);
  assert.throws(() => negotiate({ ...P, requiredCapabilities: ['teleport'] }), /CAPABILITY_UNAVAILABLE/);
  assert.throws(() => negotiate({ ...P, name: 'other' }), /PROTOCOL_UNSUPPORTED/);
  // 0.x: only the same minor line is compatible, never "all 0.x".
  const zero = { ...REGION_PROTOCOL, version: '0.3.1' };
  assert.equal(negotiate({ ...P, version: '0.3.9' }, zero).compatible, true);
  assert.throws(() => negotiate({ ...P, version: '0.4.0' }, zero), /PROTOCOL_MAJOR_MISMATCH/);
  assert.equal(describeRegionIO().atomic, false);
});

test('voxels fixture: air is an explicit dig, null is unspecified, malformed runs rejected', () => {
  const v = { format: 'hanaworlds.region-voxels', version: '1.2.0', origin: [0, 0, 0], size: [2, 1, 1],
    axisOrder: 'X_FASTEST_THEN_Y_THEN_Z', palette: [{ nodeName: 'air', param2: 0 }], runs: [[0, 1], [null, 1]] };
  assert.deepEqual([...decodeVoxels(v).cells], [0, -1]);
  assert.throws(() => decodeVoxels({ ...v, runs: [[0, 1]] }), /SCHEMA_INVALID/);
  assert.throws(() => decodeVoxels({ ...v, version: '2.0.0' }), /PROTOCOL_MAJOR_MISMATCH/);
  assert.throws(() => decodeVoxels({ ...v, palette: [{ nodeName: 'ignore', param2: 0 }] }), /SCHEMA_INVALID/);
});

test('batches are mapblock aligned and derived from the body bound', () => {
  assert.equal(blocksPerBatch({ maxBodyBytes: 4 * 1024 * 1024, registeredNodes: 50, longestNodeName: 20 }) >= 30, true);
  const b = batches([-5, 0, 0], [40, 3, 3], 2);
  assert.deepEqual(b.map(x => [x.min, x.max]), [[[-5, 0, 0], [15, 3, 3]], [[16, 0, 0], [40, 3, 3]]]);
});

const region = { min: [-3, -2, -1], max: [36, 2, 2] }; // spans 4 x-blocks, 2 y-blocks, 2 z-blocks
const read = (e, extra = {}) => readRegion(e, { protocol: P, ...region, ...extra });

function fillDig(before) {
  const size = region.max.map((v, i) => v - region.min[i] + 1), cells = new Int32Array(size[0] * size[1] * size[2]);
  const palette = [{ nodeName: 'base:stone', param2: 0 }, { nodeName: 'air', param2: 0 }];
  let i = 0;
  for (let z = region.min[2]; z <= region.max[2]; z++) for (let y = region.min[1]; y <= region.max[1]; y++) for (let x = region.min[0]; x <= region.max[0]; x++, i++)
    cells[i] = y === 1 ? 0 : y === -1 ? 1 : -1; // fill y=1, dig y=-1, keep the rest
  return { protocol: P, voxels: encodeVoxels(region.min, size, palette, cells),
    expectedBlocks: before.blocks.map(b => ({ blockPos: b.blockPos, digest: b.digest })) };
}

test('fill, explicit dig and unspecified cells across blocks; multi-batch COMPLETE matches readback', async () => {
  const e = engine();
  const before = await read(e);
  assert.equal(before.status, 'KNOWN'); assert.equal(before.blocks.length, 16); assert.ok(before.batches.length > 1);
  const out = await writeRegion(e, fillDig(before));
  assert.equal(out.status, 'COMPLETE', JSON.stringify(out.failure)); assert.equal(out.atomic, false);
  assert.ok(out.batches.every(b => ['WRITTEN_VERIFIED', 'NOT_NEEDED'].includes(b.status)));
  const after = await read(e);
  assert.equal(after.regionDigest, out.regionDigest);
  const get = e.cells;
  assert.deepEqual(get.get('36,1,2'), ['base:stone', 0]); assert.deepEqual(get.get('-3,-1,-1'), ['air', 0]);
  assert.equal(get.has('0,-2,0'), false); // unspecified: untouched
});

test('unknown block or stale digest: REJECTED with zero writes', async () => {
  const e = engine();
  const before = await read(e);
  const unknownEngine = engine({ unknown: new Set(['1,0,0']) });
  const unknownRead = await read(unknownEngine);
  assert.equal(unknownRead.status, 'UNKNOWN'); assert.equal(unknownRead.voxels, null);
  const rejected = await writeRegion(unknownEngine, fillDig(before));
  assert.equal(rejected.status, 'REJECTED'); assert.equal(rejected.failure.code, 'TARGET_FACTS_INCOMPLETE');
  assert.equal(unknownEngine.writes, 0);
  e.cells.set('20,0,0', ['base:stone', 0]); // concurrent change after the caller's read
  const stale = await writeRegion(e, fillDig(before));
  assert.equal(stale.status, 'REJECTED'); assert.equal(stale.failure.code, 'TRANSACTION_CONFLICT'); assert.equal(e.writes, 0);
  const missing = fillDig(before); missing.expectedBlocks.pop();
  const logBefore = e.log.length;
  await assert.rejects(writeRegion(e, missing), /SCHEMA_INVALID/);
  assert.equal(e.log.slice(logBefore).includes('write'), false);
});

test('a failed later batch is PARTIAL (never atomic) and the snapshot restores through writeRegion', async () => {
  const e = engine({ failWriteAt: 1 });
  const before = await read(e);
  const out = await writeRegion(e, fillDig(before));
  assert.equal(out.status, 'PARTIAL'); assert.equal(out.written, true);
  assert.equal(out.batches[0].status, 'WRITTEN_VERIFIED'); assert.equal(out.batches[1].status, 'NOT_WRITTEN');
  const now = await read(e);
  assert.notEqual(now.regionDigest, before.regionDigest);
  const restore = await writeRegion(e, { protocol: P, voxels: before.voxels,
    expectedBlocks: now.blocks.map(b => ({ blockPos: b.blockPos, digest: b.digest })) });
  assert.equal(restore.status, 'COMPLETE');
  assert.equal(restore.regionDigest, before.regionDigest);
});

test('a predictable engine rejection in any batch is found by the precheck: REJECTED, zero writes', async () => {
  const e = engine();
  const before = await read(e);
  const input = fillDig(before);
  input.voxels.palette[0] = { nodeName: 'base:chest', param2: 0 };
  const out = await writeRegion(e, input);
  assert.equal(out.status, 'REJECTED'); assert.equal(out.failure.code, 'UNSUPPORTED_MUTATION_SEMANTICS');
  assert.equal(e.writes, 0); assert.equal(e.log.includes('write'), false);
});
